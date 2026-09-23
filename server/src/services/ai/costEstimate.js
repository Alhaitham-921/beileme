import { config } from '../../config.js'

/**
 * token 与成本估算。
 *
 * 用途是「生成前预估、生成后核算、界面上展示」，**不参与真实计费**。
 * 各家分词器不同，这里用中英文字符加权近似：中文按字计、英文按词计，
 * 取值偏保守（宁可高估，让用户在超预算前就被拦住）。
 *
 * 注意：这里只做量级判断（例如「这次大概花 0.0004 美元」），
 * 不要把估算值当作对账依据。
 */

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g

/** 粗略估算一段文本的 token 数 */
export function estimateTokens(text) {
  const source = String(text ?? '')
  if (!source) return 0

  const cjkCount = (source.match(CJK_PATTERN) || []).length
  // 去掉中日韩字符后按空白切词，近似英文词数
  const rest = source.replace(CJK_PATTERN, ' ')
  const wordCount = rest.split(/\s+/).filter(Boolean).length

  return Math.ceil(
    cjkCount * config.ai.tokensPerCjkChar + wordCount * config.ai.tokensPerWord
  )
}

/**
 * 估算一次调用的成本（美元）。
 * @param {{inputTokens?:number, outputTokens?:number, cachedInputTokens?:number}} usage
 */
export function estimateCost({ inputTokens = 0, outputTokens = 0, cachedInputTokens = 0 } = {}) {
  const price = config.ai.pricePerMillion
  const cached = Math.min(cachedInputTokens, inputTokens)
  const fresh = Math.max(0, inputTokens - cached)

  const inputCost = (fresh * price.input + cached * price.cachedInput) / 1_000_000
  const outputCost = (outputTokens * price.output) / 1_000_000
  return inputCost + outputCost
}

/** 生成前的预估：给出预计输入 token、输出上限与最坏情况成本 */
export function estimateCall({ prompt, maxOutputTokens }) {
  const inputTokens = estimateTokens(prompt)
  const outputCap = Number(maxOutputTokens || 0)
  return {
    inputTokens,
    outputCap,
    /** 最坏情况（输出打满）的成本，用于「这次最多花多少」的提示 */
    worstCaseCost: estimateCost({ inputTokens, outputTokens: outputCap }),
  }
}

/** 人类可读的成本。低于 1 分钱时用「¥0.0003」这种精度展示，否则四舍五入到分 */
export function formatCost(usd, { usdToCny = 7.2 } = {}) {
  const cny = Number(usd || 0) * usdToCny
  if (cny <= 0) return '¥0'
  if (cny < 0.01) return `¥${cny.toFixed(4)}`
  if (cny < 1) return `¥${cny.toFixed(3)}`
  return `¥${cny.toFixed(2)}`
}

/** 汇总一次生成的真实用量，直接塞进接口响应 */
export function buildUsageReport({
  source,
  model,
  promptTokens = 0,
  completionTokens = 0,
  retried = false,
  retryReason = null,
  firstAttemptBudget = null,
  retryBudget = null,
}) {
  const cost = estimateCost({ inputTokens: promptTokens, outputTokens: completionTokens })
  return {
    source,
    model: model || null,
    promptTokens: Number(promptTokens || 0),
    completionTokens: Number(completionTokens || 0),
    totalTokens: Number(promptTokens || 0) + Number(completionTokens || 0),
    estimatedCostUsd: Number(cost.toFixed(8)),
    estimatedCostText: formatCost(cost),
    /**
     * 重试信息要带出去：否则用户看到「消耗 2300 token」会疑惑为什么比预期多，
     * 而且前端也要靠它提示「本次失败一次后自动加大额度重试过」。
     */
    ...(retried
      ? { retried: true, retryReason, firstAttemptBudget, retryBudget }
      : { retried: false }),
  }
}

/** 供接口层展示的计费说明，避免用户误以为展示值就是账单 */
export function describePricing() {
  return {
    pricePerMillion: config.ai.pricePerMillion,
    maxInputTokens: config.ai.maxInputTokens,
    maxOutputTokens: config.ai.maxOutputTokens,
    note: '价格为估算用参考值，请以服务商账单为准；可在 .env 中调整 AI_PRICE_* 系列参数',
  }
}

export default {
  estimateTokens,
  estimateCost,
  estimateCall,
  formatCost,
  buildUsageReport,
  describePricing,
}
