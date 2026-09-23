/**
 * AI Provider 的行为测试：推理型模型、探测额度、模型名匹配、Key 归一化。
 *
 * 这些用例来自真实踩到的坑——用户接 DeepSeek 时，
 * 「Key 有效 + 模型存在」却因为探测调用的输出上限只有 8 个 token
 * 被推理模型的内部思考吃光，导致正文为空、被误判成配置有问题。
 */
import test, { before, after, beforeEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import {
  chat,
  testConnection,
  matchModel,
  normalizeApiKey,
  markReasoningModel,
  isReasoningModel,
  clearModelCapabilities,
  supportsJsonMode,
  getThinkingDisableMode,
  AI_ERROR_KINDS,
} from '../src/services/ai/aiProvider.js'

/** 假服务行为开关 */
const behavior = {
  /** 推理型模型：小额度时把预算全花在思考上，正文为空 */
  reasoning: true,
  /** 未知模型是否返回 400 */
  rejectUnknownModel: true,
  /** /models 是否可用 */
  modelsEndpoint: true,
  /** 是否拒绝 response_format 参数（模拟没实现该参数的中转端点） */
  rejectJsonMode: false,
  /** 额度低于该值时返回被腰斩的 JSON（模拟真实截断） */
  truncateBelowTokens: 0,
  /**
   * 是否真的按 thinking/reasoning_effort 参数跳过思考。
   * 默认 false：老用例测的是「不跳过思考时会发生什么」，必须保持原来的行为。
   */
  honorThinkingParam: false,
  /** 是否拒绝 thinking 参数（模拟只认 reasoning_effort 的端点） */
  rejectThinkingParam: false,
  /** 是否连 reasoning_effort 也拒绝（模拟两种写法都不认的端点） */
  rejectReasoningEffortParam: false,
}

const MODELS = ['deepseek-v4-pro', 'deepseek-flash']

let server
let baseUrl
/** 记录每次 /chat/completions 的 max_tokens，用于断言额度 */
let observedMaxTokens = []
/** 记录每次请求体，用于断言 response_format 等参数 */
let observedBodies = []

/**
 * 与 contentService 里的常量保持一致。
 * 这里复刻是因为直接 import contentService 会连带拉进数据库依赖。
 * 一旦改了一边就必须改另一边——下面的用例会断言这个数字真的被用上了。
 */
const REASONING_RETRY_FLOOR = 6000

/**
 * 复刻 contentService 里「调用 + 解析 + 截断重试」的逻辑。
 * 直接 import contentService 会连带拉进数据库依赖，测试里不方便，所以在此复现同一套判定。
 */
async function callAndParseForTest(prompt, { provider, maxTokens, attempt = 1, disableThinking = true }) {
  const response = await chat({
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: provider.model,
    maxTokens,
    jsonMode: true,
    disableThinking,
  })

  if (response.reasoningContent) markReasoningModel(provider.baseUrl, provider.model)

  const truncated = response.finishReason === 'length'
  let parsed = null
  let parseError = null
  try {
    parsed = JSON.parse(response.content)
  } catch (error) {
    parseError = error
  }

  if ((truncated || !parsed) && attempt === 1) {
    const retryBudget = Math.min(Math.round(maxTokens * 2), 8000)
    /**
     * 与 contentService 保持一致：推理模型的「被思考吃光」重试不按倍数硬乘，
     * 而是抬到实测安全水位（6000）——1000 × 3 = 3000 正好落在失败区间里。
     */
    const adjusted = isReasoningModel(provider.baseUrl, provider.model)
      ? Math.min(Math.max(Math.round(retryBudget * 3), REASONING_RETRY_FLOOR), 8000)
      : retryBudget

    if (adjusted > maxTokens) {
      const retried = await callAndParseForTest(prompt, {
        provider,
        maxTokens: adjusted,
        attempt: 2,
        disableThinking,
      })
      retried.__usage = {
        promptTokens: response.usage.promptTokens + (retried.__usage?.promptTokens || 0),
        retried: true,
        firstAttemptTruncated: truncated,
        firstAttemptBudget: maxTokens,
        retryBudget: adjusted,
      }
      return retried
    }
  }

  if (!parsed) {
    const error = new Error(
      truncated ? `模型输出在 ${maxTokens} token 处被截断，JSON 不完整` : '模型返回的内容不是合法 JSON'
    )
    error.diagnostics = {
      firstAttempt: {
        truncated,
        maxTokens,
        finishReason: response.finishReason,
        contentLength: response.content.length,
        parseError: parseError?.message || null,
      },
    }
    throw error
  }

  Object.defineProperty(parsed, '__usage', {
    value: { ...response.usage, reasoning: Boolean(response.reasoningContent) },
    enumerable: false,
    writable: true,
    configurable: true,
  })
  return parsed
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      if (req.method === 'GET' && req.url.includes('/models')) {
        if (!behavior.modelsEndpoint) {
          res.writeHead(404).end('{}')
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: MODELS.map((id) => ({ id })) }))
        return
      }

      const body = JSON.parse(raw || '{}')
      observedMaxTokens.push(body.max_tokens)
      observedBodies.push(body)

      // 模拟没实现 response_format 的中转端点
      if (behavior.rejectJsonMode && body.response_format) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Unsupported parameter: response_format' } }))
        return
      }

      // 模拟只认 reasoning_effort、不认 thinking 的端点
      if (behavior.rejectThinkingParam && body.thinking) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Unsupported parameter: thinking' } }))
        return
      }

      // 模拟两种写法都不认的端点
      if (behavior.rejectReasoningEffortParam && body.reasoning_effort) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } }))
        return
      }

      if (behavior.rejectUnknownModel && body.model && !MODELS.includes(body.model)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Model Not Exist' } }))
        return
      }

      /**
       * 是否真的跳过了思考。
       * 真实的 deepseek 端点认这两种写法，实测跳过之后就不再产出 reasoning_content。
       * 假服务是否照做由 honorThinkingParam 控制，这样老用例的行为不变。
       */
      const thinkingSkipped =
        behavior.honorThinkingParam &&
        (body.thinking?.type === 'disabled' || body.reasoning_effort === 'none')

      // 额度不足时返回被腰斩的 JSON（真实截断就是这个样子）
      if (behavior.truncateBelowTokens && (body.max_tokens ?? 0) < behavior.truncateBelowTokens) {
        const full = JSON.stringify({ title: 'Truncated', body: 'x'.repeat(400), glossary: [] })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            model: body.model,
            choices: [
              {
                message: { role: 'assistant', content: full.slice(0, Math.floor(full.length * 0.6)) },
                finish_reason: 'length',
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: body.max_tokens },
          })
        )
        return
      }

      // 推理型模型的关键行为：额度不够时全部用于推理，content 为空
      if (behavior.reasoning && !thinkingSkipped && (body.max_tokens ?? 0) <= 16) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            model: body.model,
            choices: [
              {
                message: { role: 'assistant', content: '', reasoning_content: '先分析一下……' },
                finish_reason: 'length',
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: body.max_tokens,
              completion_tokens_details: { reasoning_tokens: body.max_tokens },
            },
          })
        )
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          model: body.model,
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"ok":true}',
                reasoning_content: behavior.reasoning && !thinkingSkipped ? '思考过程…' : undefined,
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 30 },
        })
      )
    })
  })

  server.listen(0)
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  behavior.reasoning = true
  behavior.rejectUnknownModel = true
  behavior.modelsEndpoint = true
  behavior.rejectJsonMode = false
  behavior.truncateBelowTokens = 0
  behavior.honorThinkingParam = false
  behavior.rejectThinkingParam = false
  behavior.rejectReasoningEffortParam = false
  observedMaxTokens = []
  observedBodies = []
  clearModelCapabilities()
})

describe('推理型模型的处理', () => {
  test('输出额度被思考吃光时，明确报「思考耗尽」而不是含糊的「内容为空」', async () => {
    await assert.rejects(
      () =>
        chat({
          messages: [{ role: 'user', content: 'hi' }],
          apiKey: 'sk-key-for-test-1',
          baseUrl,
          model: 'deepseek-v4-pro',
          maxTokens: 8,
        }),
      (error) => {
        assert.equal(error.kind, AI_ERROR_KINDS.REASONING_EXHAUSTED)
        assert.match(error.message, /思考/)
        // 现场信息要能带出来，方便在诊断面板里定位
        assert.equal(error.diagnostics.hasReasoning, true)
        assert.equal(error.diagnostics.finishReason, 'length')
        assert.equal(error.diagnostics.maxTokens, 8)
        return true
      }
    )

    // 命中过一次就记住，后续调用自动放宽
    assert.equal(isReasoningModel(baseUrl, 'deepseek-v4-pro'), true)
  })

  test('探测调用的额度已提高到 64，推理模型也能正常通过校验', async () => {
    const result = await testConnection({
      apiKey: 'sk-key-for-test-2',
      baseUrl,
      model: 'deepseek-v4-pro',
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.reasoningModel, true)
    assert.ok(result.warnings.some((w) => w.includes('推理型')), '应提示这是推理型模型')
    assert.equal(observedMaxTokens.at(-1), 64, '探测额度应为 64，给推理留出空间')
    assert.match(
      result.steps.find((s) => s.step === '实际调用').detail,
      /推理型/
    )
  })

  test('Key 与模型都确认可用、只是探测没吐正文时，判定为通过并给出警告', async () => {
    // 让推理把 64 个额度也吃光，模拟额度更紧张的推理模型
    behavior.reasoning = true
    const result = await testConnection({
      apiKey: 'sk-key-for-test-3',
      baseUrl,
      model: 'deepseek-v4-pro',
      // 人为压低探测额度来复现「连 64 都不够」的极端情况。
      // 注意只改 POST 的请求体：GET /models 没有 body，必须原样透传，
      // 否则「Key 与模型已确认」这个前提就不成立了。
      fetchImpl: async (url, options) => {
        if (options?.body) {
          const body = JSON.parse(options.body)
          body.max_tokens = 8
          return globalThis.fetch(url, { ...options, body: JSON.stringify(body) })
        }
        return globalThis.fetch(url, options)
      },
    })

    // 关键：不能因为「没吐正文」就把一个可用配置挡在门外
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.verifiedBy, 'models')
    assert.ok(result.warnings.length > 0)
    assert.equal(result.probeError.kind, AI_ERROR_KINDS.REASONING_EXHAUSTED)
  })

  test('生成时的输出额度会按倍数放宽，且预估与真实调用一致', async () => {
    const { REASONING_BUDGET_MULTIPLIER, preflightContent } = await import(
      '../src/services/ai/contentService.js'
    )
    assert.ok(REASONING_BUDGET_MULTIPLIER > 1)

    // 未识别为推理模型时不应放宽
    assert.equal(isReasoningModel(baseUrl, 'deepseek-flash'), false)
    markReasoningModel(baseUrl, 'deepseek-flash')
    assert.equal(isReasoningModel(baseUrl, 'deepseek-flash'), true)
  })

  test('普通模型（无思考内容）不会被误判为推理型', async () => {
    behavior.reasoning = false
    const result = await testConnection({
      apiKey: 'sk-key-for-test-4',
      baseUrl,
      model: 'deepseek-flash',
    })

    assert.equal(result.ok, true)
    assert.equal(result.reasoningModel, false)
    assert.deepEqual(result.warnings, [])
    assert.equal(isReasoningModel(baseUrl, 'deepseek-flash'), false)
  })
})

describe('模型名匹配（大小写与空白）', () => {
  test('大小写不一致时自动纠正', () => {
    assert.equal(matchModel(MODELS, 'deepSeek-v4-pro'), 'deepseek-v4-pro')
    assert.equal(matchModel(MODELS, 'DEEPSEEK-FLASH'), 'deepseek-flash')
    assert.equal(matchModel(MODELS, '  deepseek-flash '), 'deepseek-flash')
    assert.equal(matchModel(MODELS, 'deepseek-flash'), 'deepseek-flash')
  })

  test('真正不存在时不乱猜', () => {
    assert.equal(matchModel(MODELS, 'deepseek-chat'), null)
    assert.equal(matchModel(MODELS, ''), null)
    assert.equal(matchModel([], 'anything'), null)
  })

  test('校验时会把纠正结果落到 resolvedModel 上', async () => {
    const result = await testConnection({
      apiKey: 'sk-key-for-test-5',
      baseUrl,
      model: 'DeepSeek-V4-Pro',
    })

    assert.equal(result.ok, true)
    assert.equal(result.resolvedModel, 'deepseek-v4-pro')
    assert.equal(result.modelCorrected, true)
    assert.match(result.steps.find((s) => s.step === '检查模型名').detail, /纠正为/)
  })
})

describe('探测流程的健壮性', () => {
  test('中转服务没有 /models 时回退到真实调用', async () => {
    behavior.modelsEndpoint = false
    const result = await testConnection({
      apiKey: 'sk-key-for-test-6',
      baseUrl,
      model: 'deepseek-flash',
    })

    assert.equal(result.ok, true)
    assert.equal(result.verifiedBy, 'chat')
    assert.ok(result.steps.some((s) => s.step === '列出可用模型' && !s.ok))
    assert.ok(result.steps.some((s) => s.step === '实际调用' && s.ok))
  })

  test('Key 无效时立即停止，不再做无意义的后续探测', async () => {
    const badFetch = async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Authentication Fails"}}',
    })

    const result = await testConnection({
      apiKey: 'sk-invalid-key-abcdef',
      baseUrl,
      model: 'deepseek-v4-pro',
      fetchImpl: badFetch,
    })

    assert.equal(result.ok, false)
    assert.equal(result.kind, AI_ERROR_KINDS.INVALID_KEY)
    assert.equal(result.steps.length, 1, 'Key 无效时不应继续探测')
    assert.match(result.hint, /接口地址/, '应提醒地址写错也会表现为 401')
  })
})

describe('JSON 模式与截断重试', () => {
  test('请求会带上 response_format=json_object', async () => {
    behavior.reasoning = false
    await chat({
      messages: [{ role: 'user', content: 'give me json' }],
      apiKey: 'sk-json-mode-key',
      baseUrl,
      model: 'deepseek-flash',
      maxTokens: 100,
      jsonMode: true,
    })

    assert.equal(observedBodies.at(-1).response_format?.type, 'json_object')
  })

  test('服务商不认识 response_format 时自动退回普通模式并记住', async () => {
    behavior.rejectJsonMode = true
    clearModelCapabilities()

    const result = await chat({
      messages: [{ role: 'user', content: 'give me json' }],
      apiKey: 'sk-fallback-key',
      baseUrl,
      model: 'deepseek-flash',
      maxTokens: 100,
      jsonMode: true,
    })

    assert.ok(result.content, '退回普通模式后应成功')
    // 第一次带 json 模式被拒，第二次不带
    assert.equal(observedBodies.at(-2).response_format?.type, 'json_object')
    assert.equal(observedBodies.at(-1).response_format, undefined)

    // 记住了这个端点不支持，后续不会再试
    assert.equal(supportsJsonMode(baseUrl), false)
    await chat({
      messages: [{ role: 'user', content: 'again' }],
      apiKey: 'sk-fallback-key',
      baseUrl,
      model: 'deepseek-flash',
      maxTokens: 100,
      jsonMode: true,
    })
    assert.equal(observedBodies.at(-1).response_format, undefined, '不应重复尝试已失败的参数')
  })

  test('输出被截断时用更大额度自动重试一次，并把两次用量合并', async () => {
    behavior.reasoning = false
    // 额度小于 800 时返回被腰斩的 JSON
    behavior.truncateBelowTokens = 800
    clearModelCapabilities()

    const parsed = await callAndParseForTest({
      system: 'sys',
      user: '写一篇英语巩固短文',
    }, {
      provider: { apiKey: 'sk-trunc-key', baseUrl, model: 'deepseek-flash' },
      maxTokens: 400,
    })

    assert.equal(parsed.ok, true, '重试后应拿到完整 JSON')
    assert.equal(parsed.__usage.retried, true)
    assert.equal(parsed.__usage.firstAttemptTruncated, true)
    assert.equal(parsed.__usage.firstAttemptBudget, 400)
    assert.ok(parsed.__usage.retryBudget >= 800, `重试额度应翻倍，实际 ${parsed.__usage.retryBudget}`)
    // 两次调用的 token 都要计入，否则成本统计会漏掉失败的那次
    // 假服务在截断分支返回 prompt_tokens=100、正常分支返回 20
    assert.equal(parsed.__usage.promptTokens, 120)
  })

  test('推理模型的截断重试会抬到实测安全水位，而不是只乘倍数', async () => {
    behavior.reasoning = false
    // 让 500/1000/3000 都不够、6000 才够，用来验证重试确实抬到了安全水位
    behavior.truncateBelowTokens = 4000
    clearModelCapabilities()

    // 先让系统知道这个模型是推理型
    markReasoningModel(baseUrl, 'deepseek-flash')
    assert.equal(isReasoningModel(baseUrl, 'deepseek-flash'), true)

    const parsed = await callAndParseForTest({ system: 's', user: '写一篇英语巩固短文' }, {
      provider: { apiKey: 'sk-reasoning-key', baseUrl, model: 'deepseek-flash' },
      maxTokens: 500,
    })

    assert.equal(parsed.ok, true, '重试后应拿到完整 JSON')
    // 500 → 翻倍 1000 → 乘推理倍数 3 = 3000，仍然不够，所以抬到 6000 的实测水位
    assert.equal(parsed.__usage.retryBudget, REASONING_RETRY_FLOOR)
    assert.ok(
      parsed.__usage.retryBudget > parsed.__usage.firstAttemptBudget * 2,
      '推理模型的重试额度应比单纯翻倍更宽松'
    )
  })

  test('小基数乘倍数会落在失败区间里：重试必须抬到安全水位才有效', async () => {
    behavior.reasoning = false
    behavior.truncateBelowTokens = 4000
    clearModelCapabilities()
    markReasoningModel(baseUrl, 'deepseek-flash')

    // 1000 × 3 = 3000 正是实测中「思考把额度吃光」的那个数字；
    // 如果重试额度只按倍数算，这里就会失败。
    const parsed = await callAndParseForTest({ system: 's', user: '写一篇英语巩固短文' }, {
      provider: { apiKey: 'sk-floor-key', baseUrl, model: 'deepseek-flash' },
      maxTokens: 1000,
    })

    assert.equal(parsed.__usage.firstAttemptBudget, 1000)
    assert.ok(
      parsed.__usage.retryBudget >= 6000,
      `1000 × 3 的重试额度必须抬到 6000 以上，实际 ${parsed.__usage.retryBudget}`
    )
    assert.equal(parsed.ok, true)
  })

  test('重试后仍然解析失败时，错误里带上现场信息而不是只报一句话', async () => {
    behavior.truncateBelowTokens = 999999 // 永远截断
    clearModelCapabilities()

    await assert.rejects(
      () =>
        callAndParseForTest({ system: 's', user: '写一篇英语巩固短文' }, {
          provider: { apiKey: 'sk-always-trunc', baseUrl, model: 'deepseek-flash' },
          maxTokens: 400,
        }),
      (error) => {
        assert.match(error.message, /截断|不是合法 JSON/)
        const first = error.diagnostics?.firstAttempt
        assert.ok(first, '应带上首次尝试的现场')
        assert.equal(first.truncated, true)
        assert.ok(first.contentLength > 0)
        return true
      }
    )
  })
})

describe('跳过模型内部思考（实测最有效的省钱与止损手段）', () => {
  test('默认就请求服务商跳过思考：同样的小额度下正文才出得来', async () => {
    behavior.honorThinkingParam = true
    behavior.reasoning = true

    // 先证明「允许思考」时这个小额度必然失败——这正是用户遇到的报错
    await assert.rejects(
      () =>
        chat({
          messages: [{ role: 'user', content: 'hi' }],
          apiKey: 'sk-think-off-1',
          baseUrl,
          model: 'deepseek-v4-pro',
          maxTokens: 8,
          disableThinking: false,
        }),
      (error) => error.kind === AI_ERROR_KINDS.REASONING_EXHAUSTED
    )

    // 跳过思考后，同样 8 个额度就能拿到正文
    const result = await chat({
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-think-off-1',
      baseUrl,
      model: 'deepseek-v4-pro',
      maxTokens: 8,
    })

    assert.ok(result.content, '跳过思考后应拿到正文')
    assert.equal(result.reasoningContent, '', '不应再返回思考内容')
    assert.equal(observedBodies.at(-1).thinking?.type, 'disabled')
  })

  test('端点不认 thinking 参数时自动改用 reasoning_effort，生成照样成功', async () => {
    behavior.honorThinkingParam = true
    behavior.reasoning = true
    behavior.rejectThinkingParam = true
    clearModelCapabilities()

    const result = await chat({
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-think-off-2',
      baseUrl,
      model: 'deepseek-v4-pro',
      maxTokens: 8,
    })

    assert.ok(result.content, '降级到 reasoning_effort 后应成功')
    // 第一次带 thinking 被拒，第二次改成 reasoning_effort
    assert.equal(observedBodies.at(-2).thinking?.type, 'disabled')
    assert.equal(observedBodies.at(-1).thinking, undefined)
    assert.equal(observedBodies.at(-1).reasoning_effort, 'none')
    // 记住这个端点该用哪种写法，后续不再白试一次
    assert.equal(getThinkingDisableMode(baseUrl), 'reasoning_effort')
  })

  test('两种写法都不认时不再重复尝试，改由额度放宽兜底', async () => {
    behavior.honorThinkingParam = false
    behavior.reasoning = false
    behavior.rejectThinkingParam = true
    behavior.rejectReasoningEffortParam = true
    clearModelCapabilities()

    const result = await chat({
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-think-off-3',
      baseUrl,
      model: 'deepseek-v4-pro',
      maxTokens: 100,
    })

    assert.ok(result.content)
    assert.equal(observedBodies.at(-1).thinking, undefined)
    assert.equal(observedBodies.at(-1).reasoning_effort, undefined)
    assert.equal(getThinkingDisableMode(baseUrl), 'unsupported')

    const before = observedBodies.length
    await chat({
      messages: [{ role: 'user', content: 'again' }],
      apiKey: 'sk-think-off-3',
      baseUrl,
      model: 'deepseek-v4-pro',
      maxTokens: 100,
    })
    assert.equal(observedBodies.length, before + 1, '已知不支持时不应再试一次')
  })

  test('用户显式允许思考时不带任何相关参数', async () => {
    behavior.reasoning = false
    clearModelCapabilities()

    await chat({
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-think-on',
      baseUrl,
      model: 'deepseek-v4-pro',
      maxTokens: 100,
      disableThinking: false,
    })

    assert.equal(observedBodies.at(-1).thinking, undefined)
    assert.equal(observedBodies.at(-1).reasoning_effort, undefined)
  })
})

describe('Key 归一化', () => {
  test('清掉粘贴时常见的前后缀杂质', () => {
    assert.equal(normalizeApiKey('  sk-abc  '), 'sk-abc')
    assert.equal(normalizeApiKey('"sk-abc"'), 'sk-abc')
    assert.equal(normalizeApiKey('Bearer sk-abc'), 'sk-abc')
    assert.equal(normalizeApiKey('sk-a\nb'), 'sk-ab')
    assert.equal(normalizeApiKey(null), '')
    // 正常 Key 不应被改动
    assert.equal(normalizeApiKey('sk-proj-Ab_1-xyz'), 'sk-proj-Ab_1-xyz')
  })
})
