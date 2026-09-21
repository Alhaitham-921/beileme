import { config } from '../../config.js'
import { ApiError, ERROR_CODES } from '../../utils/errors.js'

/**
 * AI 接入抽象层（PRD 4.3.6 / 4.8）
 *
 * 默认走 DeepSeek 的 OpenAI 兼容协议；改用聚合平台或用户自带 Key 时，
 * 只要仍实现 chat() 的输入输出约定，上层生成逻辑无需改动。
 */

export class AiNotConfiguredError extends ApiError {
  constructor(message = '尚未配置 AI API Key，无法生成内容。可在设置中填入自己的 Key，或先使用预置例句复习。') {
    super(503, 'AI_NOT_CONFIGURED', message)
  }
}

function readApiKey(explicitKey) {
  return explicitKey || config.ai.apiKey || ''
}

export function isConfigured(explicitKey) {
  return Boolean(readApiKey(explicitKey))
}

/** 供接口层展示的可用状态 */
export function describeProvider() {
  return {
    configured: isConfigured(),
    model: config.ai.defaultModel,
    baseUrl: config.ai.baseUrl,
    temperature: config.ai.temperature,
    dailyQuota: config.ai.dailyQuota,
    cacheHours: config.ai.cacheHours,
  }
}

/**
 * 调用对话补全接口。
 *
 * @param {object} params
 * @param {Array<{role:'system'|'user'|'assistant', content:string}>} params.messages
 * @param {string} [params.model]
 * @param {number} [params.temperature] 非零温度是「相同输入不同输出」的保证之一（PRD 4.4）
 * @param {number} [params.maxTokens]
 * @param {string} [params.apiKey] 用户自带 Key，优先于服务端配置
 * @param {string} [params.baseUrl]
 * @returns {Promise<{ content:string, model:string, usage:{promptTokens:number, completionTokens:number} }>}
 */
export async function chat({
  messages,
  model,
  temperature,
  maxTokens = 2000,
  apiKey,
  baseUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = readApiKey(apiKey)
  if (!key) throw new AiNotConfiguredError()

  const endpoint = `${(baseUrl || config.ai.baseUrl).replace(/\/+$/, '')}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs)

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || config.ai.defaultModel,
        messages,
        temperature: temperature ?? config.ai.temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new ApiError(
        502,
        ERROR_CODES.INTERNAL,
        `AI 服务调用失败（${response.status}）${detail ? `：${detail.slice(0, 200)}` : ''}`
      )
    }

    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new ApiError(502, ERROR_CODES.INTERNAL, 'AI 返回内容为空，请重试')
    }

    return {
      content,
      model: payload.model || model || config.ai.defaultModel,
      usage: {
        promptTokens: Number(payload?.usage?.prompt_tokens || 0),
        completionTokens: Number(payload?.usage?.completion_tokens || 0),
      },
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error.name === 'AbortError') {
      throw new ApiError(504, ERROR_CODES.INTERNAL, 'AI 生成超时，请稍后重试')
    }
    throw new ApiError(502, ERROR_CODES.INTERNAL, `AI 服务不可用：${error.message}`)
  } finally {
    clearTimeout(timer)
  }
}

export default { chat, isConfigured, describeProvider, AiNotConfiguredError }
