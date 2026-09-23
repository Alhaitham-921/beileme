import { config } from '../../config.js'

/**
 * AI 接入抽象层（PRD 4.3.6 / 4.8）
 *
 * 默认走 DeepSeek 的 OpenAI 兼容协议；用户自带 Key、聚合平台或本地 Ollama
 * 只要兼容同一套 /chat/completions 约定就能接入，上层逻辑无需改动。
 *
 * 这里只负责「把一次请求发出去、把结果与用量拿回来」。
 * 「用谁的钱、要不要限额、失败了怎么降级」由 contentService 决定。
 */

/** 调用失败的原因分类，供上层决定降级还是提示用户 */
export const AI_ERROR_KINDS = {
  NOT_CONFIGURED: 'not_configured',
  INVALID_KEY: 'invalid_key',
  MODEL_NOT_FOUND: 'model_not_found',
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  UPSTREAM: 'upstream_error',
  BAD_RESPONSE: 'bad_response',
  /** 推理型模型把输出额度用在了思考上，没产出正文 */
  REASONING_EXHAUSTED: 'reasoning_exhausted',
}

/**
 * 「这个模型是推理型」的运行期记忆。
 *
 * 推理模型会先花 token 做内部思考（reasoning_content），正文才写在 content 里。
 * 同一个 max_tokens 预算下，推理模型留给正文的空间远小于普通模型，
 * 因此命中过一次就记下来，后续调用自动放宽输出额度。
 *
 * 只存在内存里：重启后重新探测一次即可，不值得落库。
 */
const reasoningModelKeys = new Set()

/**
 * 「这个服务商不支持 response_format: json_object」的运行期记忆。
 * 少数中转/自建端点没实现这个参数，直接返回 400，需要自动退回普通模式。
 */
const jsonModeUnsupportedKeys = new Set()

/**
 * 「关闭模型内部思考」的可用写法，按端点记忆（与具体模型无关）。
 *
 * 实测（deepseek 端点，同一个 Prompt 各跑 3 次）：
 *   不传任何参数                 → 3/3 次都在思考，正文 0/3 次，额度被吃光
 *   thinking:{type:'disabled'}   → 0/3 次思考，正文 3/3 次，平均 413 输出 token
 *   reasoning_effort:'none'      → 0/3 次思考，正文 3/3 次，平均 408 输出 token
 *
 * 所以默认就把思考关掉：更快、更便宜，而且不会再出现「额度全花在思考上、
 * 正文一个字都没有」这种失败。少数端点不认这两个参数会返回 400，
 * 那就依次降级到下一个写法；全都不认时退回「靠放宽额度硬扛」。
 */
const THINKING_DISABLE_MODES = ['thinking', 'reasoning_effort', 'unsupported']
const thinkingModeByEndpoint = new Map()

function capabilityKey(baseUrl, model) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}|${String(model || '')}`
}

function endpointCapabilityKey(baseUrl) {
  return capabilityKey(baseUrl, '')
}

/** 该端点当前该用哪种写法来关闭思考；未探测过则先试最可靠的 thinking */
export function getThinkingDisableMode(baseUrl) {
  return thinkingModeByEndpoint.get(endpointCapabilityKey(baseUrl)) || THINKING_DISABLE_MODES[0]
}

function setThinkingDisableMode(baseUrl, mode) {
  thinkingModeByEndpoint.set(endpointCapabilityKey(baseUrl), mode)
}

/** 把「关闭思考」的写法翻译成请求体字段；null 表示该端点没有可用写法 */
function thinkingPayloadFor(mode) {
  if (mode === 'thinking') return { thinking: { type: 'disabled' } }
  if (mode === 'reasoning_effort') return { reasoning_effort: 'none' }
  return null
}

/** 降级到下一个写法，已经到底就返回 null */
function nextThinkingDisableMode(mode) {
  const index = THINKING_DISABLE_MODES.indexOf(mode)
  if (index < 0 || index >= THINKING_DISABLE_MODES.length - 1) return null
  return THINKING_DISABLE_MODES[index + 1]
}

/**
 * 判断这个 400/422 是不是在抱怨我们塞进去的「关闭思考」参数。
 * 判错了也不要紧：降级后重试一次，真正的错误会原样抛出来。
 */
function isThinkingParamRejection(status, detail) {
  if (status !== 400 && status !== 422) return false
  return (
    /thinking|reasoning_effort/i.test(detail) ||
    /unknown|unsupported|unexpected|unrecognized|unrecognised/i.test(detail)
  )
}

/** 能力变化后顺手落库；失败不影响调用本身，也不阻塞返回 */
function persistCapabilitiesInBackground() {
  import('./modelCapabilityStore.js')
    .then((mod) => mod.persistCapabilities())
    .catch(() => {})
}

export function markReasoningModel(baseUrl, model) {
  if (model) reasoningModelKeys.add(capabilityKey(baseUrl, model))
}

export function isReasoningModel(baseUrl, model) {
  return reasoningModelKeys.has(capabilityKey(baseUrl, model))
}

export function markJsonModeUnsupported(baseUrl) {
  jsonModeUnsupportedKeys.add(capabilityKey(baseUrl, ''))
}

export function supportsJsonMode(baseUrl) {
  return !jsonModeUnsupportedKeys.has(capabilityKey(baseUrl, ''))
}

/**
 * 把落库的能力记录灌回内存。
 * 进程启动后必须调用一次，否则「上次已经探测出这是推理模型」这个结论会丢失，
 * 表现就是服务器重启后的第一次生成必然失败。
 */
export function restoreModelCapabilities(rows = []) {
  for (const row of rows) {
    const key = row.capability_key || capabilityKey(row.base_url, row.model)
    if (!key) continue
    if (Number(row.is_reasoning) === 1) reasoningModelKeys.add(key)
    if (Number(row.json_mode_unsupported) === 1) {
      jsonModeUnsupportedKeys.add(capabilityKey(row.base_url, ''))
    }
    // 「关闭思考」的写法是按端点记的，解析出来的字段也放在以 thinking| 开头的行里
    const thinkingMode = String(row.thinking_disable_mode || '')
    if (thinkingMode) setThinkingDisableMode(row.base_url, thinkingMode)
  }
}

/** 导出内存中的能力，供上层落库 */
export function snapshotModelCapabilities() {
  const rows = []
  for (const key of reasoningModelKeys) {
    const [baseUrl, model] = key.split('|')
    rows.push({ capability_key: key, base_url: baseUrl, model: model || '', is_reasoning: 1 })
  }
  for (const key of jsonModeUnsupportedKeys) {
    const [baseUrl] = key.split('|')
    rows.push({
      capability_key: `json|${baseUrl}`,
      base_url: baseUrl,
      model: '',
      json_mode_unsupported: 1,
    })
  }
  for (const [key, mode] of thinkingModeByEndpoint) {
    const [baseUrl] = key.split('|')
    rows.push({
      capability_key: `thinking|${baseUrl}`,
      base_url: baseUrl,
      model: '',
      thinking_disable_mode: mode,
    })
  }
  return rows
}

export function capabilityKeyOf(baseUrl, model) {
  return capabilityKey(baseUrl, model)
}

export function clearModelCapabilities() {
  reasoningModelKeys.clear()
  jsonModeUnsupportedKeys.clear()
  thinkingModeByEndpoint.clear()
}

export class AiCallError extends Error {
  constructor(kind, message, status = 502) {
    super(message)
    this.name = 'AiCallError'
    this.kind = kind
    this.status = status
  }
}

export function isConfigured(explicitKey) {
  return Boolean(explicitKey || config.ai.apiKey)
}

/** 把上游 HTTP 状态码翻译成可读的失败原因 */
function classifyStatus(status, detail) {
  if (status === 401 || status === 403) {
    return new AiCallError(
      AI_ERROR_KINDS.INVALID_KEY,
      'API Key 无效或没有权限，请检查设置里填写的 Key',
      400
    )
  }
  if (status === 429) {
    return new AiCallError(AI_ERROR_KINDS.RATE_LIMITED, '触发了服务商的频率或额度限制，请稍后重试', 429)
  }
  if (status === 402) {
    return new AiCallError(AI_ERROR_KINDS.RATE_LIMITED, '服务商账户余额不足', 429)
  }
  // 模型名不存在也是 400 家族，单独识别出来，因为这是用户最容易填错的地方
  if (/model[\s_-]*(not[\s_-]*exist|not[\s_-]*found)|invalid[\s_-]*model|does not exist/i.test(detail)) {
    return new AiCallError(AI_ERROR_KINDS.MODEL_NOT_FOUND, '模型名不存在，请核对模型 id', 400)
  }
  return new AiCallError(
    AI_ERROR_KINDS.UPSTREAM,
    `AI 服务调用失败（${status}）${detail ? `：${detail.slice(0, 160)}` : ''}`
  )
}

/**
 * 归一化用户粘贴的 Key。
 *
 * 复制粘贴很容易带上首尾空格、换行、包裹的引号，或者连 "Bearer " 前缀一起复制进来。
 * 这些都会导致「明明是好的 Key 却校验失败」，所以在这里统一清掉。
 */
export function normalizeApiKey(raw) {
  let key = String(raw ?? '').trim()
  // 去掉整体包裹的引号（成对才去，避免误伤）
  if (key.length >= 2 && /^["'`]/.test(key) && key.endsWith(key[0])) {
    key = key.slice(1, -1)
  }
  // 去掉误粘贴的 Bearer 前缀
  key = key.replace(/^Bearer\s+/i, '')
  // 去掉可能夹在中间的换行与空白
  key = key.replace(/\s+/g, '')
  return key.trim()
}

/** 针对不同失败原因给出可执行的排查建议 */
export function hintFor(kind, { baseUrl, model } = {}) {
  switch (kind) {
    case AI_ERROR_KINDS.NOT_CONFIGURED:
      return '还没有配置 API Key'
    case AI_ERROR_KINDS.INVALID_KEY:
      return (
        '请确认：① Key 是从服务商控制台完整复制的；② 没有多余空格或引号；③ Key 未被删除或过期。' +
        '另外请核对接口地址——地址填错时部分服务商（如 DeepSeek）同样会返回 401，看起来像 Key 有问题'
      )
    case AI_ERROR_KINDS.MODEL_NOT_FOUND:
      return `请核对模型 id 是否与服务商文档一致（当前填的是「${model}」），或点「获取可用模型」直接选`
    case AI_ERROR_KINDS.REASONING_EXHAUSTED:
      return '这是推理型模型，内部思考会占用输出额度。系统已为其自动放宽；若仍失败可改用非推理模型（如 deepseek-flash）'
    case AI_ERROR_KINDS.RATE_LIMITED:
      return '可能是账户余额不足或触发频率限制，请到服务商控制台确认'
    case AI_ERROR_KINDS.TIMEOUT:
      return '请求超时，可能是网络不稳定或服务商侧较慢，可稍后重试'
    default:
      return `请确认接口地址能否访问（当前填的是「${baseUrl}」），自定义服务商需兼容 OpenAI 协议`
  }
}

/** 把上游返回的原始英文错误翻译成用户看得懂的话 */
function explainUpstream(error) {
  const raw = String(error.message || '')
  if (/authentication fails|invalid_api_key|incorrect api key/i.test(raw)) {
    return `服务商判定这个 Key 无效。原始信息：${raw}`
  }
  if (/insufficient balance|quota exceeded|余额/i.test(raw)) {
    return `服务商账户余额不足。原始信息：${raw}`
  }
  return raw
}

/**
 * 列出账号可用的模型（GET /models）。
 * **这一步不消耗 token**，因此优先用它来验证 Key 是否有效，比直接发一条对话便宜。
 */
export async function listModels({ apiKey, baseUrl, fetchImpl = globalThis.fetch } = {}) {
  const key = apiKey || config.ai.apiKey
  if (!key) throw new AiCallError(AI_ERROR_KINDS.NOT_CONFIGURED, '尚未配置 AI API Key', 503)

  const endpoint = `${(baseUrl || config.ai.baseUrl).replace(/\/+$/, '')}/models`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs)

  try {
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw classifyStatus(response.status, detail)
    }
    const payload = await response.json()
    const models = (payload?.data || [])
      .map((item) => item?.id)
      .filter((id) => typeof id === 'string' && id)
    return { models, endpoint }
  } catch (error) {
    if (error instanceof AiCallError) throw error
    if (error.name === 'AbortError') {
      throw new AiCallError(AI_ERROR_KINDS.TIMEOUT, '获取模型列表超时', 504)
    }
    throw new AiCallError(
      AI_ERROR_KINDS.UPSTREAM,
      `无法连接 ${endpoint}：${error.message}`
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 调用对话补全接口。
 *
 * @param {object} params
 * @param {Array<{role:'system'|'user'|'assistant', content:string}>} params.messages
 * @param {string} params.apiKey 由上层先解析出该用哪把 Key
 * @param {string} [params.baseUrl]
 * @param {string} [params.model]
 * @param {number} [params.temperature] 非零温度是「相同输入不同输出」的保证之一（PRD 4.4）
 * @param {number} [params.maxTokens] 输出上限，直接决定单次成本上限
 * @param {boolean} [params.jsonMode] 要求服务商以 JSON 对象格式输出（response_format）
 * @param {boolean} [params.disableThinking] 是否请求服务商跳过内部思考，直接写正文（默认是）
 * @returns {Promise<{ content:string, model:string, finishReason:string, reasoningContent:string, usage:object }>}
 */
export async function chat({
  messages,
  apiKey,
  baseUrl,
  model,
  temperature,
  maxTokens,
  jsonMode = false,
  disableThinking = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = apiKey || config.ai.apiKey
  if (!key) {
    throw new AiCallError(AI_ERROR_KINDS.NOT_CONFIGURED, '尚未配置 AI API Key', 503)
  }

  const resolvedBaseUrl = baseUrl || config.ai.baseUrl
  const endpoint = `${resolvedBaseUrl.replace(/\/+$/, '')}/chat/completions`
  const useJsonMode = jsonMode && supportsJsonMode(resolvedBaseUrl)
  const thinkingMode = getThinkingDisableMode(resolvedBaseUrl)
  const thinkingPayload = disableThinking ? thinkingPayloadFor(thinkingMode) : null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs)

  try {
    const requestBody = {
      model: model || config.ai.defaultModel,
      messages,
      temperature: temperature ?? config.ai.temperature,
      max_tokens: maxTokens,
      stream: false,
    }
    /**
     * JSON 模式能显著降低「返回不是合法 JSON」的概率——那是我们踩到最多的问题。
     * 少数中转端点没实现这个参数，会被上游以 400 拒绝，因此下面做了自动退回。
     */
    if (useJsonMode) requestBody.response_format = { type: 'json_object' }

    /**
     * 跳过内部思考。这是「同样的配置换个人就能用」的关键：
     * 推理型模型有相当大概率把整个输出额度花在思考上，正文一个字都写不出来，
     * 而且花的钱照算。关掉之后同一次生成只用约 400 输出 token。
     */
    if (thinkingPayload) Object.assign(requestBody, thinkingPayload)

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')

      // 上游不认识 response_format：记住并且立刻用普通模式重试一次
      if (useJsonMode && response.status === 400 && /response_format|json_object/i.test(detail)) {
        markJsonModeUnsupported(resolvedBaseUrl)
        return chat({
          messages,
          apiKey,
          baseUrl,
          model,
          temperature,
          maxTokens,
          jsonMode: false,
          disableThinking,
          fetchImpl,
        })
      }

      // 上游不认识「关闭思考」的参数：换成下一种写法重试一次
      if (thinkingPayload && isThinkingParamRejection(response.status, detail)) {
        const next = nextThinkingDisableMode(thinkingMode)
        if (next) {
          setThinkingDisableMode(resolvedBaseUrl, next)
          persistCapabilitiesInBackground()
          return chat({
            messages,
            apiKey,
            baseUrl,
            model,
            temperature,
            maxTokens,
            jsonMode,
            disableThinking,
            fetchImpl,
          })
        }
      }

      throw classifyStatus(response.status, detail)
    }

    const payload = await response.json()
    const choice = payload?.choices?.[0]
    const content = choice?.message?.content
    // 推理型模型（如 deepseek 的 pro / reasoner 系列）把思考过程放在这个字段里
    const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning
    const finishReason = choice?.finish_reason
    const usage = {
      promptTokens: Number(payload?.usage?.prompt_tokens || 0),
      completionTokens: Number(payload?.usage?.completion_tokens || 0),
      reasoningTokens: Number(
        payload?.usage?.completion_tokens_details?.reasoning_tokens || 0
      ),
    }

    if (typeof content !== 'string' || !content.trim()) {
      // 记录该模型是推理型，后续调用自动放宽额度
      if (reasoning) markReasoningModel(resolvedBaseUrl, model)

      const error = new AiCallError(
        reasoning ? AI_ERROR_KINDS.REASONING_EXHAUSTED : AI_ERROR_KINDS.BAD_RESPONSE,
        reasoning
          ? '模型把输出额度用在了内部思考上，没有产出正文（输出上限设得太小）'
          : 'AI 返回内容为空'
      )
      // 把现场信息带出去，便于在设置页的诊断面板里定位
      error.diagnostics = {
        finishReason: finishReason || null,
        hasReasoning: Boolean(reasoning),
        reasoningLength: reasoning ? String(reasoning).length : 0,
        maxTokens: maxTokens ?? null,
        usage,
      }
      throw error
    }

    // 只要看到思考内容就记下来（即使这次正文正常），后续调用才能提前放宽额度
    if (reasoning) markReasoningModel(resolvedBaseUrl, model)

    return {
      content,
      reasoningContent: reasoning ? String(reasoning) : '',
      finishReason: finishReason || null,
      model: payload.model || model || config.ai.defaultModel,
      usage,
    }
  } catch (error) {
    if (error instanceof AiCallError) throw error
    if (error.name === 'AbortError') {
      throw new AiCallError(AI_ERROR_KINDS.TIMEOUT, 'AI 生成超时，请稍后重试', 504)
    }
    throw new AiCallError(AI_ERROR_KINDS.UPSTREAM, `AI 服务不可用：${error.message}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 在可用模型列表里匹配用户填写的模型名。
 *
 * 大小写不敏感：模型 id 在 API 层是区分大小写的，但用户手打时极容易写成
 * `deepSeek-flash` 这种形式（实测就踩到了）。与其直接判失败让人来回试，
 * 不如匹配到唯一结果后**自动纠正成列表里的规范写法**再发出去。
 *
 * @returns {string|null} 规范化的模型 id；没匹配到返回 null
 */
export function matchModel(availableModels = [], input) {
  const wanted = String(input || '').trim()
  if (!wanted) return null

  const exact = availableModels.find((id) => id === wanted)
  if (exact) return exact

  const lower = wanted.toLowerCase()
  const caseInsensitive = availableModels.filter((id) => id.toLowerCase() === lower)
  // 只在唯一匹配时才纠正，避免歧义
  if (caseInsensitive.length === 1) return caseInsensitive[0]

  return null
}

/**
 * 分步校验 Key / 接口地址 / 模型名，并把每一步的结果都返回给调用方。
 *
 * 为什么要分步：
 *  1. **GET /models 不消耗 token**，所以优先用它验证 Key，比直接发对话便宜
 *  2. 「Key 无效」和「模型名不存在」是两类完全不同的错误，混在一起报会让人无从下手
 *  3. 部分中转服务没有实现 /models，这种情况下自动退回真实调用探测
 *
 * @returns {Promise<object>} 永远不抛错，失败也以 { ok:false } 返回，便于前端展示诊断过程
 */
export async function testConnection({ apiKey, baseUrl, model, fetchImpl } = {}) {
  const startedAt = Date.now()
  const steps = []
  const requestedModel = String(model || config.ai.defaultModel || '').trim()
  const resolvedBaseUrl = baseUrl || config.ai.baseUrl
  /** 最终真正发出去的模型 id，可能在大小写纠正后与用户填写的不一致 */
  let effectiveModel = requestedModel

  const finish = (payload) => ({
    ...payload,
    checkedModel: requestedModel,
    resolvedModel: effectiveModel,
    modelCorrected: effectiveModel !== requestedModel,
    checkedBaseUrl: resolvedBaseUrl,
    steps,
    latencyMs: Date.now() - startedAt,
  })

  // ── 第一步：GET /models，不消耗 token ──
  let availableModels = null
  try {
    const result = await listModels({ apiKey, baseUrl, fetchImpl })
    availableModels = result.models
    steps.push({ step: '列出可用模型', ok: true, detail: `共 ${result.models.length} 个` })
  } catch (error) {
    steps.push({ step: '列出可用模型', ok: false, kind: error.kind, detail: error.message })

    if (error.kind === AI_ERROR_KINDS.NOT_CONFIGURED || error.kind === AI_ERROR_KINDS.INVALID_KEY) {
      // Key 本身就不对，继续探测没有意义
      return finish({
        ok: false,
        kind: error.kind,
        message: explainUpstream(error),
        hint: hintFor(error.kind, { baseUrl: resolvedBaseUrl, model: requestedModel }),
      })
    }
    // 其它情况（中转未实现 /models、网络抖动等）继续用真实调用探测
  }

  // ── 第二步：模型名是否存在于账号的可用列表里 ──
  if (availableModels?.length && requestedModel) {
    const canonical = matchModel(availableModels, requestedModel)
    if (!canonical) {
      steps.push({ step: '检查模型名', ok: false, detail: `「${requestedModel}」不在可用列表中` })
      return finish({
        ok: false,
        kind: AI_ERROR_KINDS.MODEL_NOT_FOUND,
        message: `Key 是有效的，但模型「${requestedModel}」不在该账号的可用模型里`,
        hint: `可用模型：${availableModels.slice(0, 12).join('、')}`,
        availableModels,
      })
    }

    effectiveModel = canonical
    steps.push({
      step: '检查模型名',
      ok: true,
      detail:
        canonical === requestedModel
          ? `「${canonical}」可用`
          : `已把「${requestedModel}」纠正为「${canonical}」`,
    })
  }

  // ── 第三步：真实调用一次 ──
  //
  // 输出上限给到 64 而不是 8：推理型模型会先把额度花在内部思考上，
  // 8 个 token 会让它一个字正文都吐不出来，从而被误判成「Key 有问题」。
  // 64 个 token 的成本依然可以忽略（百万元级单价下不到一分钱的千分之一）。
  //
  // 同时主动请求「跳过内部思考」：这既是真实生成时的默认行为，
  // 也能让这次探测的结论与正式调用一致（探测时顺带发现该端点认不认这个参数）。
  const probeMaxTokens = 64
  try {
    const result = await chat({
      messages: [
        { role: 'system', content: '你是连通性测试端点，只需回一个词。' },
        { role: 'user', content: 'reply with: ok' },
      ],
      apiKey,
      baseUrl,
      model: effectiveModel,
      temperature: 0,
      maxTokens: probeMaxTokens,
      disableThinking: true,
      fetchImpl,
    })

    // 如果这次调用暴露了「该模型是推理型」，记下来供后续生成放宽额度
    if (result.reasoningContent) markReasoningModel(baseUrl, effectiveModel)

    steps.push({
      step: '实际调用',
      ok: true,
      detail: result.reasoningContent
        ? `模型 ${result.model} 返回正常（该模型为推理型，生成时会自动放宽输出额度）`
        : `模型 ${result.model} 返回正常`,
    })

    return finish({
      ok: true,
      model: result.model,
      sample: result.content.slice(0, 40),
      usage: result.usage,
      availableModels,
      verifiedBy: availableModels ? 'models+chat' : 'chat',
      /** 已知是推理型，用于前端提示与后续额度放宽 */
      reasoningModel: Boolean(result.reasoningContent),
      /** 该端点可用的「关闭思考」写法，供前端告知用户实际发生了什么 */
      thinkingDisableMode: getThinkingDisableMode(baseUrl),
      warnings: result.reasoningContent
        ? ['该模型是推理型：内部思考会占用输出额度，已为其自动放宽，成本也会相应高于非推理模型']
        : [],
    })
  } catch (error) {
    steps.push({ step: '实际调用', ok: false, kind: error.kind, detail: error.message })

    /**
     * 关键取舍：如果前两步已经证明「Key 有效 + 模型存在」，
     * 那么第三步只是锦上添花的验证。此时不应因为「没吐正文」就判定校验失败——
     * 那会把一个完全可用的配置挡在门外（实测就是这么被挡住的）。
     * 因此这类情况按「通过但有警告」处理，让用户能保存并实际试用。
     */
    const keyAndModelAlreadyProven = Boolean(availableModels?.length)
    const softFailureKinds = [AI_ERROR_KINDS.REASONING_EXHAUSTED, AI_ERROR_KINDS.BAD_RESPONSE]

    if (keyAndModelAlreadyProven && softFailureKinds.includes(error.kind)) {
      return finish({
        ok: true,
        model: effectiveModel,
        availableModels,
        verifiedBy: 'models',
        reasoningModel: error.kind === AI_ERROR_KINDS.REASONING_EXHAUSTED,
        sample: '',
        warnings: [
          `Key 与模型都已确认可用，但测试调用没有返回正文：${error.message}`,
          error.diagnostics?.hasReasoning
            ? '该模型是推理型，实际生成时已自动放宽输出额度；若仍失败，可改用非推理模型（如 deepseek-flash）'
            : '可先保存后实际生成一次；若生成失败再换用其它模型',
        ],
        probeError: {
          kind: error.kind,
          message: error.message,
          diagnostics: error.diagnostics || null,
        },
      })
    }

    return finish({
      ok: false,
      kind: error.kind || AI_ERROR_KINDS.UPSTREAM,
      message: explainUpstream(error),
      hint: hintFor(error.kind, { baseUrl: resolvedBaseUrl, model: effectiveModel }),
      availableModels,
      probeError: {
        kind: error.kind,
        message: error.message,
        diagnostics: error.diagnostics || null,
      },
    })
  }
}

/**
 * 只取账号可用的模型列表（不发对话，0 token 成本）。
 * 供设置页做「模型下拉选择」用。
 */
export async function fetchAvailableModels({ apiKey, baseUrl, model, fetchImpl } = {}) {
  const requestedModel = String(model || config.ai.defaultModel || '').trim()
  const resolvedBaseUrl = baseUrl || config.ai.baseUrl

  try {
    const { models } = await listModels({ apiKey, baseUrl, fetchImpl })
    const canonical = matchModel(models, requestedModel)
    return {
      ok: true,
      models,
      requestedModel,
      /** 推荐选中的模型：填写的能匹配就用它，否则用列表第一个 */
      suggested: canonical || models[0] || '',
      corrected: Boolean(canonical && canonical !== requestedModel),
      baseUrl: resolvedBaseUrl,
    }
  } catch (error) {
    return {
      ok: false,
      kind: error.kind || AI_ERROR_KINDS.UPSTREAM,
      message: explainUpstream(error),
      hint: hintFor(error.kind, { baseUrl: resolvedBaseUrl, model: requestedModel }),
      baseUrl: resolvedBaseUrl,
    }
  }
}

/** 供健康检查展示服务端官方额度的配置状态（不含任何密钥内容） */
export function describeServerProvider() {
  return {
    configured: Boolean(config.ai.apiKey),
    model: config.ai.defaultModel,
    baseUrl: config.ai.baseUrl,
    temperature: config.ai.temperature,
    dailyQuota: config.ai.dailyQuota,
    cacheHours: config.ai.cacheHours,
  }
}

export default {
  chat,
  listModels,
  fetchAvailableModels,
  matchModel,
  testConnection,
  isConfigured,
  describeServerProvider,
  normalizeApiKey,
  hintFor,
  markReasoningModel,
  isReasoningModel,
  markJsonModeUnsupported,
  supportsJsonMode,
  getThinkingDisableMode,
  restoreModelCapabilities,
  snapshotModelCapabilities,
  capabilityKeyOf,
  clearModelCapabilities,
  AiCallError,
  AI_ERROR_KINDS,
}
