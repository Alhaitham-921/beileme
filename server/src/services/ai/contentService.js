import crypto from 'node:crypto'
import { query, queryOne, execute } from '../../db/pool.js'
import { config } from '../../config.js'
import { parseJson, toJson, clamp } from '../../utils/json.js'
import { todayKey, addDays } from '../../utils/time.js'
import { badRequest, notFound } from '../../utils/errors.js'
import {
  chat,
  testConnection,
  fetchAvailableModels,
  AiCallError,
  AI_ERROR_KINDS,
  describeServerProvider,
  normalizeApiKey,
  markReasoningModel,
  isReasoningModel,
} from './aiProvider.js'
import {
  buildArticlePrompt,
  buildQuizPrompt,
  buildErrorCardBatchPrompt,
  buildWeakSummaryPrompt,
  parseJsonResponse,
  pickTopic,
  MAX_CARDS_PER_REQUEST,
} from './promptTemplates.js'
import {
  resolveProvider,
  listUserKeys,
  saveUserKey,
  deleteUserKey,
  getActiveUserKey,
  markKeyUsed,
  describeProviders,
  resolveKeyTarget,
} from './apiKeyService.js'
import { estimateTokens, estimateCall, estimateCost, buildUsageReport, describePricing, formatCost } from './costEstimate.js'
import { buildReviewSheet, buildTemplateErrorCards, TEMPLATE_MAX_WORDS } from './templateFallback.js'
import {
  ensureCapabilitiesLoaded,
  rememberReasoningModel,
  persistCapabilities,
} from './modelCapabilityStore.js'
import {
  resolveLimits,
  describeLimitOptions,
  saveLimits,
  applyPreset,
  resetLimits,
  effectiveBudget,
} from './aiSettingsService.js'
import { getProfile, bumpTopicWeight } from '../profileService.js'
import { listWordsByIds, getRelatedWords, getWordById, safeLimit, safeOffset } from '../wordService.js'
import { getErrorDigest } from '../studyService.js'
import { getWeakSummary } from '../statsService.js'

/**
 * AI 内容生成的编排层（PRD 4.3 / 4.3.6 / 4.8）。
 *
 * ── 成本控制的实际执行顺序 ──────────────────────────────────
 * 每一次生成请求都严格按下面五步走，越靠前越省钱：
 *
 *   1. 缓存池命中          → 0 成本（跨用户共享，72 小时窗口）
 *   2. 没有可用 Key        → 0 成本，返回本地组装的复习清单
 *   3. 超出预算自动缩目标词 → 少发 token，而不是把一个长 Prompt 直接发出去
 *   4. 合并请求            → N 个错词的卡片只调 1 次
 *   5. 调用失败            → 0 成本降级为本地内容，同时把失败原因回传给用户
 *
 * 另外，**错因分析、易混词对比卡片完全不在这里**：
 * 前者是纯规则引擎（errorAnalysis.js），后者是本地算法（wordRelations.js），
 * 两者的 AI 成本恒为 0，这也是本产品把算力预算集中在「短文 + 理解题」的原因（PRD 4.3.6）。
 */

export const CONTENT_TYPES = ['article', 'quiz', 'error_card', 'weak_summary']

/** 内容来源，前端据此决定怎么渲染与怎么提示 */
export const CONTENT_SOURCES = {
  AI: 'ai',
  CACHE: 'cache',
  TEMPLATE: 'template',
}

/**
 * 历史去重阈值（PRD 4.4 第 4 条）。
 *
 * 实测标定：主题相同但表述完全不同的两篇短文得分 < 0.3；
 * 而成文长度（150-250 词）的文本只改 1-2 个词时得分约 0.85-0.95（文本越短，改动占比越大）。
 * 取 0.85 可以稳定拦住「几乎逐字重复」的生成结果，同时不会误伤正常的不同文章。
 */
export const DEDUP_SIMILARITY_THRESHOLD = 0.85

/**
 * 缓存键：目标词组合 + 难度 + 学习目标 + 话题。
 * 相同键在缓存窗口内直接复用，避免重复消耗 token（PRD 4.3.6 第 1 条）。
 */
export function buildCacheKey({ type, wordIds = [], difficulty = 3, goal = '', topic = '' }) {
  const normalized = [...wordIds].map((id) => Number(id)).sort((a, b) => a - b)
  const payload = JSON.stringify({ type, wordIds: normalized, difficulty, goal, topic })
  return crypto.createHash('sha256').update(payload).digest('hex')
}

export function hashContent(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex')
}

/**
 * 历史去重校验（PRD 4.4 第 4 条）。
 * 用词级 3-gram Jaccard 近似「摘要向量相似度」：达到阈值就认为与历史生成雷同。
 */
export function similarity(textA, textB) {
  const grams = (text) => {
    const words = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
    const set = new Set()
    if (words.length < 3) {
      for (const word of words) set.add(word)
      return set
    }
    for (let i = 0; i < words.length - 2; i += 1) set.add(words.slice(i, i + 3).join(' '))
    return set
  }

  const setA = grams(textA)
  const setB = grams(textB)
  if (!setA.size || !setB.size) return 0

  let intersection = 0
  for (const gram of setA) if (setB.has(gram)) intersection += 1
  return intersection / (setA.size + setB.size - intersection)
}

async function maxHistorySimilarity(userId, type, body, { limit = 5 } = {}) {
  const rows = await query(
    `SELECT content_body FROM generated_contents
      WHERE user_id = ? AND type = ?
      ORDER BY created_at DESC
      LIMIT ${safeLimit(limit, { fallback: 5, max: 20 })}`,
    [userId, type]
  )
  return rows.reduce((max, row) => Math.max(max, similarity(body, row.content_body)), 0)
}

// ── 用量与限额（PRD 4.3.6 第 3 条）──────────────────────────

export async function getUsage(userId, dateKey = todayKey()) {
  const rows = await query(
    `SELECT type, used_count, cached_count, prompt_tokens, completion_tokens, cost_usd
       FROM ai_usage WHERE user_id = ? AND usage_date = ?`,
    [userId, dateKey]
  )
  const byType = new Map(rows.map((row) => [row.type, row]))

  const result = {}
  for (const type of CONTENT_TYPES) {
    const row = byType.get(type)
    result[type] = {
      used: Number(row?.used_count || 0),
      cached: Number(row?.cached_count || 0),
      promptTokens: Number(row?.prompt_tokens || 0),
      completionTokens: Number(row?.completion_tokens || 0),
      costUsd: Number(row?.cost_usd || 0),
      /** 官方额度才有硬上限；自带 Key 走的是防滥用的宽松上限 */
      limit: config.ai.dailyQuota[type] ?? null,
      userKeyLimit: quotaLimitFor(type, 'user'),
    }
  }
  return result
}

/** 限额。官方额度按配置值，用户自带 Key 时放宽（花的是他自己的钱） */
function quotaLimitFor(type, providerSource) {
  const base = config.ai.dailyQuota[type]
  if (base == null) return null
  return providerSource === 'user' ? base * config.ai.userKeyQuotaMultiplier : base
}

async function ensureQuota(userId, type, providerSource) {
  const limit = quotaLimitFor(type, providerSource)
  if (limit == null) return

  const usage = (await getUsage(userId))[type]
  if (usage.used >= limit) {
    const hint =
      providerSource === 'user'
        ? '可稍后再试'
        : '可在设置里填入自己的 API Key，额度不受此限制；也可以先复习历史生成的内容'
    throw Object.assign(new Error(`今日「${type}」生成次数已达上限（${limit} 次），${hint}`), {
      code: 'QUOTA_EXCEEDED',
      status: 429,
      details: { type, limit, used: usage.used, providerSource },
    })
  }
}

async function bumpUsage(
  userId,
  type,
  { cached = false, promptTokens = 0, completionTokens = 0, costUsd = 0 } = {}
) {
  const column = cached ? 'cached_count' : 'used_count'
  await execute(
    `INSERT INTO ai_usage (user_id, usage_date, type, ${column}, prompt_tokens, completion_tokens, cost_usd)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ${column} = ${column} + 1,
       prompt_tokens = prompt_tokens + VALUES(prompt_tokens),
       completion_tokens = completion_tokens + VALUES(completion_tokens),
       cost_usd = cost_usd + VALUES(cost_usd)`,
    [userId, todayKey(), type, Number(promptTokens || 0), Number(completionTokens || 0), Number(costUsd || 0)]
  )
}

/** 今日 + 最近 N 天的汇总，供设置页展示「我花了多少」 */
export async function getUsageSummary(userId, { days = 30 } = {}) {
  const since = addDays(todayKey(), -(Math.max(1, days) - 1))
  const rows = await query(
    `SELECT type, SUM(used_count) AS used, SUM(cached_count) AS cached,
            SUM(prompt_tokens) AS promptTokens, SUM(completion_tokens) AS completionTokens,
            SUM(cost_usd) AS costUsd
       FROM ai_usage WHERE user_id = ? AND usage_date >= ?
      GROUP BY type`,
    [userId, since]
  )

  const totals = { used: 0, cached: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 }
  const byType = {}
  for (const row of rows) {
    const item = {
      used: Number(row.used || 0),
      cached: Number(row.cached || 0),
      promptTokens: Number(row.promptTokens || 0),
      completionTokens: Number(row.completionTokens || 0),
      costUsd: Number(row.costUsd || 0),
    }
    byType[row.type] = item
    for (const key of Object.keys(totals)) totals[key] += item[key]
  }

  return { days, since, totals, byType, today: await getUsage(userId) }
}

// ── 内容存取 ────────────────────────────────────────────────

export function mapContentRow(row, { withBody = true } = {}) {
  if (!row) return null
  return {
    id: Number(row.id),
    type: row.type,
    title: row.title,
    topic: row.topic,
    difficulty: Number(row.difficulty),
    targetWords: parseJson(row.target_words, []),
    ...(withBody ? { body: row.content_body } : {}),
    meta: parseJson(row.meta, null),
    model: row.model,
    createdAt: row.created_at,
  }
}

async function findCached({ userId, cacheKey, type }) {
  const since = new Date(Date.now() - config.ai.cacheHours * 60 * 60 * 1000)
  // 缓存池跨用户共享：相同词组合短期内被多个用户触发时优先复用（PRD 4.3.6 第 1 条）
  const row = await queryOne(
    `SELECT * FROM generated_contents
      WHERE cache_key = ? AND type = ? AND created_at >= ?
      ORDER BY created_at DESC LIMIT 1`,
    [cacheKey, type, since]
  )
  return row ? mapContentRow(row) : null
}

async function saveContent({
  userId,
  type,
  title = '',
  topic = '',
  difficulty = 3,
  wordIds = [],
  body,
  meta = null,
  cacheKey = null,
  model = '',
  usage = {},
}) {
  const result = await execute(
    `INSERT INTO generated_contents
       (user_id, type, title, topic, difficulty, target_words, content_body, meta,
        cache_key, content_hash, model, prompt_tokens, completion_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, type, title, topic, difficulty, toJson(wordIds), body, meta ? toJson(meta) : null,
      cacheKey, hashContent(body), model,
      Number(usage.promptTokens || 0), Number(usage.completionTokens || 0),
    ]
  )
  const row = await queryOne('SELECT * FROM generated_contents WHERE id = ?', [result.insertId])
  return mapContentRow(row)
}

/** 取近期目标词：优先用调用方指定的词，否则用最近复习过的词 */
async function resolveTargetWords(userId, { wordIds, limit = 10 } = {}) {
  if (Array.isArray(wordIds) && wordIds.length) {
    const words = await listWordsByIds(wordIds.slice(0, limit))
    if (!words.length) throw badRequest('给定的目标词都不存在')
    return words
  }

  const rows = await query(
    `SELECT w.id FROM user_word_progress p
       JOIN words w ON w.id = p.word_id
      WHERE p.user_id = ?
      ORDER BY COALESCE(p.last_review_at, p.first_learned_at) DESC
      LIMIT ${safeLimit(limit, { fallback: 10, max: 20 })}`,
    [userId]
  )
  if (!rows.length) throw badRequest('还没有学习记录，先背几个单词再来生成巩固内容吧')
  return listWordsByIds(rows.map((row) => Number(row.id)))
}

function profileForPrompt(profile) {
  return {
    goal: profile.goal,
    selfLevel: profile.selfLevel,
    memoryPrefs: profile.memoryPrefs,
  }
}

/** 统计最近易错词，用于在短文里制造对比语境（PRD 4.3.1） */
async function recentWeakWords(userId, excludeIds = [], limit = 4) {
  try {
    const digest = await getErrorDigest(userId, { days: 30, limit: 20 })
    return digest.wrongWords
      .filter((item) => !excludeIds.includes(item.wordId))
      .slice(0, limit)
      .map((item) => ({ spelling: item.spelling, definitions: item.definitions }))
  } catch {
    return []
  }
}

/**
 * 按输入 token 预算自动缩减目标词。
 * 宁可少放两个词，也不要把一个超预算的 Prompt 发出去——发出去就是按量计费。
 */
function trimToBudget({ words, build, minWords = 4, promptType, maxInputTokens }) {
  const budget = maxInputTokens ?? config.ai.maxInputTokens
  let current = [...words]
  let prompt = build(current)
  let tokens = estimateTokens(prompt.system) + estimateTokens(prompt.user)

  while (tokens > budget && current.length > minWords) {
    current = current.slice(0, Math.max(minWords, current.length - 2))
    prompt = build(current)
    tokens = estimateTokens(prompt.system) + estimateTokens(prompt.user)
  }

  return {
    words: current,
    prompt,
    estimatedInputTokens: tokens,
    trimmed: current.length !== words.length,
    overBudget: tokens > budget,
    promptType,
  }
}

/** 统一记录一次失败：写回用户 Key 的 last_error，方便设置页提示 */
async function recordKeyError(provider, message) {
  if (provider?.source !== 'user' || !provider.id) return
  await execute('UPDATE user_api_keys SET last_error = ? WHERE id = ?', [
    String(message || '').slice(0, 255),
    provider.id,
  ]).catch(() => {})
}

async function recordKeySuccess(provider) {
  if (provider?.source !== 'user' || !provider.id) return
  await execute('UPDATE user_api_keys SET last_error = NULL, last_verified_at = NOW() WHERE id = ?', [
    provider.id,
  ]).catch(() => {})
}

/**
 * 只有 AiCallError 才代表「AI 那边出了问题」，才允许降级成本地内容。
 *
 * 其它异常（比如代码里把变量名写错导致的 ReferenceError）是程序 bug，必须让它冒出来。
 * 实测踩过这个坑：`generateWeakSummary` 里引用了一个不存在的 `boost` 变量，
 * 被 catch 吞掉之后表现成「AI 生成总是失败、走本地兜底」，
 * 排查方向全被带偏到 Key 和模型上去了。
 */
function isAiFailure(error) {
  return error instanceof AiCallError
}

/**
 * 组装「为什么走了本地兜底」的说明，直接展示给用户。
 *
 * 这里的原则是：**能说清具体数字就说清**。
 * 早期版本只报一句「AI 暂时不可用」，用户既不知道卡在哪一步，
 * 也不知道自己只要把额度数字调大就能解决——那等于没给信息。
 */
function degradeMessage(reason, error) {
  if (reason === 'not_configured') {
    return '未配置 AI API Key，已改为用词库本地数据生成复习清单。前往设置填入自己的 Key 即可获得 AI 生成内容。'
  }
  if (error?.kind === AI_ERROR_KINDS.INVALID_KEY) {
    return `API Key 无效（${error.message}），已改为本地复习清单。请到设置里检查 Key。`
  }
  if (error?.kind === AI_ERROR_KINDS.RATE_LIMITED) {
    return `触发了服务商限额（${error.message}），已改为本地复习清单，稍后重试即可。`
  }
  if (error?.kind === AI_ERROR_KINDS.TIMEOUT) {
    return `AI 调用超时（${error.message}），已改为本地复习清单。可以稍后重试，或换一个更快的模型。`
  }
  if (error?.kind === AI_ERROR_KINDS.MODEL_NOT_FOUND) {
    return `模型名不可用（${error.message}），已改为本地复习清单。请到设置里重新选择模型。`
  }

  const d = error?.diagnostics || {}
  const first = d.firstAttempt || {}
  const budget = d.maxTokens ?? first.maxTokens ?? null

  // 额度被内部思考吃光：这是推理型模型上最常见的一类失败
  if (d.hasReasoning || first.hasReasoning || error?.kind === AI_ERROR_KINDS.REASONING_EXHAUSTED) {
    const firstBudget = first.maxTokens ?? null
    const reasoningLength = d.reasoningLength ?? first.reasoningLength ?? null
    const numbers = [
      firstBudget && budget && firstBudget !== budget
        ? `首次给了 ${firstBudget} token，自动放宽到 ${budget} 后仍不足`
        : budget
          ? `输出上限 ${budget} token`
          : null,
      reasoningLength ? `内部思考写了约 ${reasoningLength} 字` : null,
    ]
      .filter(Boolean)
      .join('、')
    return (
      `AI 生成失败：模型把${firstBudget || budget ? ` ${firstBudget || budget} ` : ''}token 的输出额度全用在了内部思考上，` +
      `没有写出正文${numbers ? `（${numbers}）` : ''}。已改为本地复习清单。` +
      `到设置页关掉「允许模型先内部思考」通常就能解决；也可以改用非推理模型（如 deepseek-flash）。`
    )
  }

  // 输出被截断：JSON 不完整
  if (d.truncated || first.truncated) {
    const at = d.maxTokens ?? first.maxTokens
    const finish = d.finishReason ?? first.finishReason
    return (
      `AI 生成失败：模型输出在${at ? ` ${at} ` : ''}token 处被截断${finish ? `（finish_reason=${finish}）` : ''}，` +
      `JSON 不完整，已改为本地复习清单。可点「重新生成（额度 ×2）」重试，或到设置页把额度调大。`
    )
  }

  // 返回了内容但不是合法 JSON：把长度和开头摆出来，便于判断是模型跑偏还是解析太严
  if (d.parseError || first.parseError) {
    const length = d.contentLength ?? first.contentLength
    const head = d.contentHead ? `，开头是「${d.contentHead.slice(0, 40)}…」` : ''
    return (
      `AI 生成失败：模型返回的内容不是合法 JSON${length ? `（共 ${length} 字）` : ''}${head}，已改为本地复习清单。` +
      `可点「重新生成（额度 ×2）」再试一次，或换用其他模型。`
    )
  }

  // 兜底：至少把错误类型和原始信息带上，不要只留一句「暂时不可用」
  const kind = error?.kind ? `（${error.kind}）` : ''
  const extra = budget ? `，本次输出上限 ${budget} token` : ''
  return `AI 暂时不可用${kind}：${error?.message || '未知原因'}${extra}，已改为本地复习清单。`
}

// ── 生成前预估（不调用模型，成本为 0）────────────────────────

/**
 * 预估一次生成要花多少，**完全在本地完成，不产生任何 AI 调用**。
 *
 * 存在的意义：成本控制的最后一步是「让用户在点之前就知道要花多少」。
 * 前端可以据此提示「本次约 1.4 千 token，预计 ¥0.003，可能命中缓存」，
 * 而不是让用户盲点。boost 参数用于「重新生成并加大额度」的场景——
 * 加大后的价格必须如实反映，否则用户会觉得被误导。
 *
 * @param {number} userId
 * @param {{type?:'article'|'error_card', wordIds?:number[], wordCount?:number, limit?:number, boost?:number}} options
 */
export async function preflightContent(userId, options = {}) {
  const type = options.type === 'error_card' ? 'error_card' : 'article'
  const boost = Math.max(1, Math.min(4, Number(options.boost) || 1))
  const profile = await getProfile(userId)
  const provider = await resolveProvider(userId)
  // 预估必须用与真实生成同一套额度，否则展示的成本会与账单对不上
  await ensureCapabilitiesLoaded()
  const limits = await resolveLimits(userId)

  let words
  let difficulty = 3
  let topic = ''

  if (type === 'article') {
    words = await resolveTargetWords(userId, {
      wordIds: options.wordIds,
      limit: clamp(options.wordCount || 10, 4, 15),
    })
    difficulty = clamp(Number.parseInt(options.difficulty, 10) || estimateDifficulty(words, profile), 1, 5)
  } else {
    const resolved = await resolveErrorWords(userId, {
      wordIds: options.wordIds,
      limit: clamp(options.limit || MAX_CARDS_PER_REQUEST, 1, MAX_CARDS_PER_REQUEST),
    })
    words = resolved.words
  }

  // 缓存键与真实生成时保持一致，否则「是否命中缓存」会判断错
  const cacheKey =
    type === 'article'
      ? buildCacheKey({ type: 'article', wordIds: words.map((w) => w.id), difficulty, goal: profile.goal, topic: '' })
      : buildCacheKey({ type: 'error_card', wordIds: words.map((w) => w.id), difficulty: 3, goal: profile.goal, topic: '' })

  const cached = await findCached({ userId, cacheKey, type })

  const prompt =
    type === 'article'
      ? buildArticlePrompt({
          words,
          profile: profileForPrompt(profile),
          topic: topic || pickTopic(profile.topicWeights),
          difficulty,
          weakWords: await recentWeakWords(userId, words.map((w) => w.id)),
        })
      : buildErrorCardBatchPrompt({
          words: words.map((word) => ({
            spelling: word.spelling,
            pos: word.pos,
            definitions: word.definitions,
            relatedWords: [],
            errorBreakdown: {},
          })),
          profile: profileForPrompt(profile),
        })

  // 预估用的额度必须与真实调用一致：推理型模型会被自动放宽，
  // 如果这里还按基础值估算，展示给用户的成本就会偏低。
  const estimate = estimateCall({
    prompt: prompt.system + prompt.user,
    maxOutputTokens: outputBudgetFor(provider, type === 'article' ? 'article' : 'error_card_batch', limits, boost),
  })

  const usage = await getUsage(userId)
  const limit = quotaLimitFor(type, provider.source)
  /** 本次是否会让模型跳过内部思考（默认会，用户可在设置里打开） */
  const thinkingDisabled = !limits.allowThinking

  return {
    type,
    boost,
    wordCount: words.length,
    words: words.map((word) => ({ id: word.id, spelling: word.spelling })),
    providerMode: provider.source,
    willCallModel: provider.source !== 'none' && !cached,
    cacheAvailable: Boolean(cached),
    cachedContentId: cached?.id ?? null,
    estimatedInputTokens: estimate.inputTokens,
    maxOutputTokens: estimate.outputCap,
    worstCaseCostUsd: Number(estimate.worstCaseCost.toFixed(8)),
    worstCaseCostText: formatCost(estimate.worstCaseCost),
    /** 单次调用（不含拆批）的预估；错词卡片合批后固定成本只付一次 */
    callCount: type === 'article' ? 1 : Math.ceil(words.length / MAX_CARDS_PER_REQUEST),
    quota: { type, used: usage[type].used, limit },
    zeroCost: provider.source === 'none' || Boolean(cached),
    /** 界面据此告知「本次会跳过模型的内部思考」 */
    thinkingDisabled,
    model: provider.model || null,
    note:
      provider.source === 'none'
        ? '当前未配置 AI，将返回本地复习清单（不产生费用）'
        : cached
          ? '命中缓存，本次不会调用模型'
          : `预计最多消耗 ${estimate.outputCap} 个输出 token${thinkingDisabled ? '（已让模型跳过内部思考，实测约用 410）' : '（已允许模型内部思考，会更慢更贵）'}`,
  }
}

// ── 生成：巩固短文（PRD 4.3.1）──────────────────────────────

export async function generateArticle(userId, options = {}) {
  const { wordIds, minWords = 150, maxWords = 250, forceNew = false, boost = 1 } = options

  const profile = await getProfile(userId)
  const provider = await resolveProvider(userId)
  await ensureCapabilitiesLoaded()
  const limits = await resolveLimits(userId)
  const limit = clamp(options.wordCount || 10, 4, 15)
  const words = await resolveTargetWords(userId, { wordIds, limit })

  const difficulty = clamp(
    Number.parseInt(options.difficulty, 10) || estimateDifficulty(words, profile),
    1,
    5
  )
  const weakWords = await recentWeakWords(userId, words.map((word) => word.id))
  const topic = options.topic || pickTopic(profile.topicWeights)

  /**
   * 缓存键刻意**不包含话题**。
   *
   * 话题是每次随机抽的（PRD 4.4 要求「相同词表不同输出」），若把它放进缓存键，
   * 同一批词第二次请求只有 1/8 的概率抽到同一个话题，缓存几乎永远不会命中，
   * 等于白花钱。话题的随机性作用于「未命中时才真正生成」的那一次，
   * 而缓存本身负责把「同词组合的重复请求」压掉——这正是 PRD 4.3.6 第 1 条的要求。
   * 用户若确实想要一篇全新的，用 forceNew 显式绕开缓存。
   */
  const cacheKey = buildCacheKey({
    type: 'article',
    wordIds: words.map((word) => word.id),
    difficulty,
    goal: profile.goal,
    topic: '',
  })
  const promptInput = { profile: profileForPrompt(profile), topic, difficulty, weakWords, minWords, maxWords }

  // ① 缓存池命中 → 0 成本
  if (!forceNew) {
    const cached = await findCached({ userId, cacheKey, type: 'article' })
    if (cached) {
      await bumpUsage(userId, 'article', { cached: true })
      return {
        content: cached,
        source: CONTENT_SOURCES.CACHE,
        cached: true,
        usage: null,
        quota: await getUsage(userId),
      }
    }
  }

  // ② 没有可用 Key → 本地复习清单，0 成本
  if (provider.source === 'none') {
    return buildArticleFallback({ userId, words, reason: 'not_configured', profile, cacheKey })
  }

  await ensureQuota(userId, 'article', provider.source)

  // ③ 按预算裁剪目标词
  const fitted = trimToBudget({
    words,
    build: (candidate) => buildArticlePrompt({ words: candidate, ...promptInput }),
    promptType: 'article',
    maxInputTokens: limits.maxInputTokens,
  })

  const preflight = estimateCall({
    prompt: fitted.prompt.system + fitted.prompt.user,
    maxOutputTokens: outputBudgetFor(provider, 'article', limits),
  })

  let parsed
  try {
    parsed = await callAndParse(fitted.prompt, {
      provider,
      maxTokens: outputBudgetFor(provider, 'article', limits, boost),
      limits,
      boost,
    })
    await recordKeySuccess(provider)
  } catch (error) {
    // 程序 bug 不该伪装成「AI 不可用」，直接抛出去
    if (!isAiFailure(error)) throw error
    // ⑤ 调用失败 → 同样降级，而不是把 500 抛给用户
    await recordKeyError(provider, error.message)
    return buildArticleFallback({
      userId,
      words: fitted.words,
      reason: error.kind || 'ai_error',
      profile,
      cacheKey,
      error,
      preflight,
    })
  }

  // 去重校验：与历史生成过雷同时换话题重试一次（PRD 4.4 第 4 条）
  let body = String(parsed.body || '')
  let maxSimilarity = await maxHistorySimilarity(userId, 'article', body)
  let retried = false

  if (maxSimilarity >= DEDUP_SIMILARITY_THRESHOLD) {
    retried = true
    const alternateTopic = pickTopic(profile.topicWeights)
    const retry = trimToBudget({
      words,
      build: (candidate) =>
        buildArticlePrompt({ words: candidate, ...promptInput, topic: alternateTopic }),
      promptType: 'article',
    })
    try {
      const second = await callAndParse(retry.prompt, {
        provider,
        maxTokens: outputBudgetFor(provider, 'article', limits, boost),
        temperature: 1.2,
        limits,
        boost,
      })
      parsed = second
      body = String(second.body || '')
      maxSimilarity = await maxHistorySimilarity(userId, 'article', body)
      parsed.__usage = {
        promptTokens:
          Number(parsed.__usage?.promptTokens || 0) + Number(second.__usage?.promptTokens || 0),
        completionTokens:
          Number(parsed.__usage?.completionTokens || 0) + Number(second.__usage?.completionTokens || 0),
      }
    } catch {
      // 重试失败就沿用第一次的结果，不因此让整个请求失败
    }
  }

  const usageReport = buildUsageReport({
    source: provider.source,
    model: provider.model,
    promptTokens: parsed.__usage?.promptTokens,
    completionTokens: parsed.__usage?.completionTokens,
    retried: Boolean(parsed.__usage?.retried),
    retryReason: parsed.__usage?.retryReason || null,
    firstAttemptBudget: parsed.__usage?.firstAttemptBudget ?? null,
    retryBudget: parsed.__usage?.retryBudget ?? null,
  })

  const content = await saveContent({
    userId,
    type: 'article',
    title: parsed.title || '',
    topic: parsed.topicUsed || topic,
    difficulty,
    wordIds: fitted.words.map((word) => word.id),
    body,
    meta: {
      glossary: parsed.glossary || [],
      words: fitted.words.map((word) => ({ id: word.id, spelling: word.spelling })),
      trimmedToFitBudget: fitted.trimmed,
    },
    cacheKey,
    model: provider.model,
    usage: { promptTokens: usageReport.promptTokens, completionTokens: usageReport.completionTokens },
  })

  await bumpUsage(userId, 'article', {
    promptTokens: usageReport.promptTokens,
    completionTokens: usageReport.completionTokens,
    costUsd: usageReport.estimatedCostUsd,
  })
  if (content.topic) await bumpTopicWeight(userId, content.topic, 0.1).catch(() => {})

  return {
    content,
    source: CONTENT_SOURCES.AI,
    cached: false,
    dedupRetried: retried,
    maxHistorySimilarity: Math.round(maxSimilarity * 1000) / 1000,
    trimmedToFitBudget: fitted.trimmed,
    usage: usageReport,
    preflight,
    quota: await getUsage(userId),
  }
}

/** 短文的本地兜底：复习清单 + 明确的降级说明 */
async function buildArticleFallback({ userId, words, reason, error, preflight }) {
  const relatedMap = await loadRelatedMap(words)
  const sheet = buildReviewSheet({ words, relatedMap, reason })

  return {
    content: {
      id: null,
      type: 'article',
      title: sheet.title,
      topic: '',
      difficulty: 3,
      targetWords: words.map((word) => word.id),
      body: sheet.body,
      meta: { template: true, items: sheet.items },
      model: null,
      createdAt: new Date(),
    },
    source: CONTENT_SOURCES.TEMPLATE,
    cached: false,
    degradedReason: reason,
    message: degradeMessage(reason, error),
    aiError: error ? { kind: error.kind, message: error.message } : null,
    usage: null,
    preflight,
    quota: await getUsage(userId),
  }
}

async function loadRelatedMap(words) {
  const map = {}
  for (const word of words) {
    map[word.id] = await getRelatedWords(word.id, { limit: 4 })
  }
  return map
}

// ── 生成：阅读理解题（PRD 4.3.2）────────────────────────────

export async function generateQuiz(userId, { articleId, count = 3, forceNew = false, boost = 1 } = {}) {
  if (!articleId) throw badRequest('必须提供 articleId')

  const articleRow = await queryOne(
    "SELECT * FROM generated_contents WHERE id = ? AND user_id = ? AND type = 'article'",
    [articleId, userId]
  )
  if (!articleRow) throw notFound('短文不存在')

  const article = mapContentRow(articleRow)
  const profile = await getProfile(userId)
  const provider = await resolveProvider(userId)
  await ensureCapabilitiesLoaded()
  const limits = await resolveLimits(userId)
  const words = await listWordsByIds(article.targetWords)
  const cacheKey = buildCacheKey({
    type: 'quiz',
    wordIds: article.targetWords,
    difficulty: article.difficulty,
    goal: profile.goal,
    topic: article.topic,
  })

  if (!forceNew) {
    const cached = await findCached({ userId, cacheKey, type: 'quiz' })
    if (cached) {
      await bumpUsage(userId, 'quiz', { cached: true })
      return { content: cached, source: CONTENT_SOURCES.CACHE, cached: true, quota: await getUsage(userId) }
    }
  }

  if (provider.source === 'none') {
    return {
      content: null,
      source: CONTENT_SOURCES.TEMPLATE,
      degradedReason: 'not_configured',
      message: '未配置 AI API Key，无法生成阅读理解题。可在设置中填入自己的 Key。',
      suggestions: await quizFallbackSuggestions(words),
      quota: await getUsage(userId),
    }
  }

  await ensureQuota(userId, 'quiz', provider.source)

  const prompt = buildQuizPrompt({
    article: { title: article.title, body: article.body },
    words,
    profile: profileForPrompt(profile),
    difficulty: article.difficulty,
    count: clamp(count, 3, 5),
  })

  const preflight = estimateCall({
    prompt: prompt.system + prompt.user,
    maxOutputTokens: outputBudgetFor(provider, 'quiz', limits),
  })

  let parsed
  try {
    parsed = await callAndParse(prompt, { provider, maxTokens: outputBudgetFor(provider, 'quiz', limits, boost), limits, boost })
    await recordKeySuccess(provider)
  } catch (error) {
    if (!isAiFailure(error)) throw error
    await recordKeyError(provider, error.message)
    return {
      content: null,
      source: CONTENT_SOURCES.TEMPLATE,
      degradedReason: error.kind || 'ai_error',
      message: degradeMessage(error.kind, error),
      suggestions: await quizFallbackSuggestions(words),
      preflight,
      quota: await getUsage(userId),
    }
  }

  const questions = Array.isArray(parsed.questions) ? parsed.questions : []
  if (!questions.length) throw badRequest('AI 未生成有效题目，请重试')

  const usageReport = buildUsageReport({
    source: provider.source,
    model: provider.model,
    promptTokens: parsed.__usage?.promptTokens,
    completionTokens: parsed.__usage?.completionTokens,
    retried: Boolean(parsed.__usage?.retried),
    retryReason: parsed.__usage?.retryReason || null,
    firstAttemptBudget: parsed.__usage?.firstAttemptBudget ?? null,
    retryBudget: parsed.__usage?.retryBudget ?? null,
  })

  const content = await saveContent({
    userId,
    type: 'quiz',
    title: `理解题 · ${article.title || '巩固短文'}`,
    topic: article.topic,
    difficulty: article.difficulty,
    wordIds: article.targetWords,
    body: JSON.stringify(questions),
    meta: { articleId: Number(articleId), questionCount: questions.length },
    cacheKey,
    model: provider.model,
    usage: { promptTokens: usageReport.promptTokens, completionTokens: usageReport.completionTokens },
  })

  await bumpUsage(userId, 'quiz', {
    promptTokens: usageReport.promptTokens,
    completionTokens: usageReport.completionTokens,
    costUsd: usageReport.estimatedCostUsd,
  })

  return {
    content,
    source: CONTENT_SOURCES.AI,
    cached: false,
    usage: usageReport,
    preflight,
    quota: await getUsage(userId),
  }
}

/** 题目兜底：没有 AI 时给出「自测题」的可执行建议，而不是假装有题目 */
async function quizFallbackSuggestions(words) {
  return words.slice(0, 8).map((word) => ({
    wordId: word.id,
    spelling: word.spelling,
    question: `在文中找出 ${word.spelling} 并说出它在本句中的含义`,
    answer: (word.definitions || []).join('；'),
  }))
}

// ── 生成：错因巩固卡片（PRD 4.2.3 / 4.3.3）—— 批量，一次调用 ──

/**
 * 一次为多个易错词生成对比记忆卡片。
 *
 * 这个接口是成本控制的关键：逐词调用会把 system prompt 与固定开销乘以 N，
 * 合并后无论多少个词都只付一次。默认取最近错得最多的词。
 *
 * @param {number} userId
 * @param {{wordIds?:number[], limit?:number, forceNew?:boolean}} options
 */
export async function generateErrorCards(
  userId,
  { wordIds, limit = MAX_CARDS_PER_REQUEST, forceNew = false, boost = 1 } = {}
) {
  const profile = await getProfile(userId)
  const provider = await resolveProvider(userId)
  await ensureCapabilitiesLoaded()
  const limits = await resolveLimits(userId)
  const targetCount = clamp(limit, 1, MAX_CARDS_PER_REQUEST)

  const { words, breakdownMap } = await resolveErrorWords(userId, { wordIds, limit: targetCount })
  if (!words.length) throw badRequest('最近没有错题，先把错题攒起来再来生成巩固卡片')

  const relatedMap = await loadRelatedMap(words)
  const cacheKey = buildCacheKey({
    type: 'error_card',
    wordIds: words.map((word) => word.id),
    difficulty: 3,
    goal: profile.goal,
    topic: '',
  })

  if (!forceNew) {
    const cached = await findCached({ userId, cacheKey, type: 'error_card' })
    if (cached) {
      await bumpUsage(userId, 'error_card', { cached: true })
      return {
        cards: cached.meta?.cards || [],
        content: cached,
        source: CONTENT_SOURCES.CACHE,
        cached: true,
        quota: await getUsage(userId),
      }
    }
  }

  // 没有 Key 或调用失败：用算法算出的对比关系兜底，成本恒为 0
  const fallback = (reason, error) => {
    const template = buildTemplateErrorCards({ words, relatedMap, reason })
    return {
      cards: template.cards,
      content: null,
      source: CONTENT_SOURCES.TEMPLATE,
      cached: false,
      degradedReason: reason,
      message: degradeMessage(reason, error),
      aiError: error ? { kind: error.kind, message: error.message } : null,
      quota: null,
    }
  }

  if (provider.source === 'none') return { ...fallback('not_configured'), quota: await getUsage(userId) }

  await ensureQuota(userId, 'error_card', provider.source)

  const promptInput = words.map((word) => ({
    spelling: word.spelling,
    pos: word.pos,
    definitions: word.definitions,
    relatedWords: (relatedMap[word.id] || []).map((item) => ({
      spelling: item.spelling,
      relationType: item.relationType,
    })),
    errorBreakdown: breakdownMap[word.id] || {},
  }))

  // 一次调用覆盖全部目标词；只有词数超过单次上限时才拆批
  const batches = []
  for (let i = 0; i < promptInput.length; i += MAX_CARDS_PER_REQUEST) {
    const chunk = promptInput.slice(i, i + MAX_CARDS_PER_REQUEST)
    batches.push(buildErrorCardBatchPrompt({ words: chunk, profile: profileForPrompt(profile) }))
  }

  const preflight = estimateCall({
    prompt: batches[0].system + batches[0].user,
    maxOutputTokens: outputBudgetFor(provider, 'error_card_batch', limits),
  })

  const cards = []
  const usageTotals = { promptTokens: 0, completionTokens: 0 }
  let lastModel = provider.model

  for (const batchPrompt of batches) {
    try {
      const parsed = await callAndParse(batchPrompt, {
        provider,
        maxTokens: outputBudgetFor(provider, 'error_card_batch', limits, boost),
        limits,
        boost,
      })
      await recordKeySuccess(provider)
      lastModel = provider.model

      usageTotals.promptTokens += Number(parsed.__usage?.promptTokens || 0)
      usageTotals.completionTokens += Number(parsed.__usage?.completionTokens || 0)
      // 只要有一批发生过重试，整体就算重试过（用量里已经包含失败那次的消耗）
      if (parsed.__usage?.retried) {
        usageTotals.retried = true
        usageTotals.retryReason = parsed.__usage.retryReason || usageTotals.retryReason || null
        usageTotals.firstAttemptBudget = parsed.__usage.firstAttemptBudget ?? usageTotals.firstAttemptBudget ?? null
        usageTotals.retryBudget = parsed.__usage.retryBudget ?? usageTotals.retryBudget ?? null
      }

      const bySpelling = new Map(
        words.map((word) => [word.spelling.toLowerCase(), word.id])
      )
      for (const card of parsed.cards || []) {
        const wordId = bySpelling.get(String(card.spelling || '').toLowerCase())
        cards.push({ ...card, wordId: wordId ?? null })
      }
    } catch (error) {
      if (!isAiFailure(error)) throw error
      await recordKeyError(provider, error.message)
      // 部分批次失败：已成功的保留，失败的用本地卡片补齐
      const missing = words.filter((word) => !cards.some((card) => card.wordId === word.id))
      const template = buildTemplateErrorCards({
        words: missing,
        relatedMap,
        reason: error.kind || 'ai_error',
      })
      return {
        cards: [...cards, ...template.cards],
        content: null,
        source: cards.length ? CONTENT_SOURCES.AI : CONTENT_SOURCES.TEMPLATE,
        cached: false,
        degradedReason: error.kind || 'ai_error',
        message: degradeMessage(error.kind, error),
        aiError: { kind: error.kind, message: error.message },
        usage: buildUsageReport({ source: provider.source, model: lastModel, ...usageTotals }),
        preflight,
        quota: await getUsage(userId),
      }
    }
  }

  const usageReport = buildUsageReport({
    source: provider.source,
    model: lastModel,
    ...usageTotals,
  })

  const content = await saveContent({
    userId,
    type: 'error_card',
    title: `对比记忆 · ${words.map((word) => word.spelling).join('、')}`,
    topic: '',
    difficulty: 3,
    wordIds: words.map((word) => word.id),
    body: JSON.stringify(cards),
    meta: { cards, batchSize: batches.length },
    cacheKey,
    model: lastModel,
    usage: usageTotals,
  })

  await bumpUsage(userId, 'error_card', {
    promptTokens: usageReport.promptTokens,
    completionTokens: usageReport.completionTokens,
    costUsd: usageReport.estimatedCostUsd,
  })

  return {
    cards,
    content,
    source: CONTENT_SOURCES.AI,
    cached: false,
    batchCount: batches.length,
    usage: usageReport,
    preflight,
    quota: await getUsage(userId),
  }
}

/** 解析要生成卡片的错词：优先用指定词，否则取最近错得最多的 */
async function resolveErrorWords(userId, { wordIds, limit = 6 } = {}) {
  const digest = await getErrorDigest(userId, { days: 90, limit: 50 })
  const breakdownMap = {}
  for (const item of digest.wrongWords) breakdownMap[item.wordId] = item.breakdown

  if (Array.isArray(wordIds) && wordIds.length) {
    const words = await listWordsByIds(wordIds.slice(0, limit))
    return { words, breakdownMap }
  }

  const ranked = digest.wrongWords.slice(0, limit).map((item) => item.wordId)
  if (!ranked.length) return { words: [], breakdownMap }
  return { words: await listWordsByIds(ranked), breakdownMap }
}

// ── 生成：本周薄弱点小结（PRD 4.3.3）────────────────────────

export async function generateWeakSummary(userId, { days = 7, boost = 1 } = {}) {
  const profile = await getProfile(userId)
  const provider = await resolveProvider(userId)
  await ensureCapabilitiesLoaded()
  const limits = await resolveLimits(userId)
  const stats = await getWeakSummary(userId, { days })

  // 统计口径永远由服务端算好；AI 只负责把结论写成自然语言
  if (!stats.errorDistribution.total) {
    return { content: null, source: CONTENT_SOURCES.TEMPLATE, reason: 'no_errors', fallback: stats }
  }

  const cacheKey = buildCacheKey({
    type: 'weak_summary',
    wordIds: stats.topWrongWords.map((item) => item.wordId),
    difficulty: 3,
    goal: profile.goal,
    topic: String(stats.days),
  })

  const cached = await findCached({ userId, cacheKey, type: 'weak_summary' })
  if (cached) {
    await bumpUsage(userId, 'weak_summary', { cached: true })
    return { content: cached, source: CONTENT_SOURCES.CACHE, cached: true, fallback: stats }
  }

  if (provider.source === 'none') {
    return {
      content: null,
      source: CONTENT_SOURCES.TEMPLATE,
      reason: 'not_configured',
      message: degradeMessage('not_configured'),
      fallback: stats,
      quota: await getUsage(userId),
    }
  }

  await ensureQuota(userId, 'weak_summary', provider.source)

  const prompt = buildWeakSummaryPrompt({ stats, profile: profileForPrompt(profile) })
  const preflight = estimateCall({
    prompt: prompt.system + prompt.user,
    maxOutputTokens: outputBudgetFor(provider, 'weak_summary', limits),
  })

  let parsed
  try {
    parsed = await callAndParse(prompt, { provider, maxTokens: outputBudgetFor(provider, 'weak_summary', limits, boost), limits, boost })
    await recordKeySuccess(provider)
  } catch (error) {
    if (!isAiFailure(error)) throw error
    await recordKeyError(provider, error.message)
    return {
      content: null,
      source: CONTENT_SOURCES.TEMPLATE,
      reason: error.kind || 'ai_error',
      message: degradeMessage(error.kind, error),
      fallback: stats,
      preflight,
      quota: await getUsage(userId),
    }
  }

  const usageReport = buildUsageReport({
    source: provider.source,
    model: provider.model,
    promptTokens: parsed.__usage?.promptTokens,
    completionTokens: parsed.__usage?.completionTokens,
    retried: Boolean(parsed.__usage?.retried),
    retryReason: parsed.__usage?.retryReason || null,
    firstAttemptBudget: parsed.__usage?.firstAttemptBudget ?? null,
    retryBudget: parsed.__usage?.retryBudget ?? null,
  })

  const content = await saveContent({
    userId,
    type: 'weak_summary',
    title: parsed.headline || '本周薄弱点小结',
    topic: '',
    difficulty: 3,
    wordIds: stats.topWrongWords.map((item) => item.wordId),
    body: parsed.headline || '',
    meta: {
      observations: parsed.observations || [],
      suggestions: parsed.suggestions || [],
      stats: { days: stats.days, errorDistribution: stats.errorDistribution.items },
    },
    cacheKey,
    model: provider.model,
    usage: { promptTokens: usageReport.promptTokens, completionTokens: usageReport.completionTokens },
  })

  await bumpUsage(userId, 'weak_summary', {
    promptTokens: usageReport.promptTokens,
    completionTokens: usageReport.completionTokens,
    costUsd: usageReport.estimatedCostUsd,
  })

  return { content, source: CONTENT_SOURCES.AI, cached: false, usage: usageReport, fallback: stats }
}

/**
 * 调用模型并把返回解析成 JSON。
 *
 * 这里做了四层容错，因为「生成失败」是实测踩到最多的问题：
 *  1. **JSON 模式**：请求带上 response_format=json_object，让服务商保证输出是 JSON
 *  2. **额度被思考吃光**：推理型模型常见，立刻按倍数放宽并重试（不是降级）
 *  3. **JSON 被截断**：finish_reason=length，翻倍额度重试
 *  4. **解析失败**：同上重试一次
 *
 * 重试只做一次：额度放大后仍然失败，说明问题不在额度上（模型不认 JSON 模式、
 * 或提示词让它跑偏了），继续重试只是白花钱。
 *
 * @param {object} [options]
 * @param {number} [options.boost] 用户主动要求「用更大额度重新生成」时的额外倍数
 */
async function callAndParse(prompt, { provider, maxTokens, temperature, attempt = 1, boost = 1, limits = null } = {}) {
  // 默认请求服务商跳过内部思考：更快、更便宜，且不会出现「额度全花在思考上」
  const disableThinking = !limits?.allowThinking
  let response
  try {
    response = await chat({
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      maxTokens,
      temperature,
      jsonMode: true,
      disableThinking,
    })
  } catch (error) {
    /**
     * 关键补救：推理模型把额度全用在内部思考上，正文一个字都没有。
     * 这类失败**不该直接降级成本地内容**——只要把额度放宽就能成功，
     * 而用户看到「AI 不可用」却不知道自己只要调个数字就行。
     *
     * 注意这里必须落库记住这个模型是推理型，否则服务器每次重启都要再失败一次。
     */
    if (error.kind === AI_ERROR_KINDS.REASONING_EXHAUSTED && attempt === 1) {
      await rememberReasoningModel(provider.baseUrl, provider.model)

      const multiplier = Number(limits?.reasoningMultiplier ?? config.ai.reasoningBudgetMultiplier)
      const retryBudget = reasoningRetryBudget(maxTokens, multiplier)

      if (retryBudget > maxTokens) {
        try {
          const retried = await callAndParse(prompt, {
            provider,
            maxTokens: retryBudget,
            temperature,
            attempt: 2,
            boost,
            limits,
          })
          // 把失败那次的用量也算进去，成本统计才不会漏
          retried.__usage = {
            ...(retried.__usage || {}),
            promptTokens:
              Number(error.diagnostics?.usage?.promptTokens || 0) + Number(retried.__usage?.promptTokens || 0),
            completionTokens:
              Number(error.diagnostics?.usage?.completionTokens || 0) +
              Number(retried.__usage?.completionTokens || 0),
            retried: true,
            retryReason: 'reasoning_exhausted',
            firstAttemptBudget: maxTokens,
            retryBudget,
          }
          return retried
        } catch (retryError) {
          /**
           * 重试也失败。这里必须把首次失败的现场并进 diagnostics，
           * 否则降级提示只剩下「AI 暂时不可用」这一句，
           * 用户既看不到是思考吃光了额度，也看不到具体数字。
           */
          retryError.diagnostics = {
            ...(error.diagnostics || {}),
            ...(retryError.diagnostics || {}),
            firstAttempt: {
              kind: error.kind,
              maxTokens,
              hasReasoning: Boolean(error.diagnostics?.hasReasoning),
              reasoningLength: error.diagnostics?.reasoningLength ?? null,
              finishReason: error.diagnostics?.finishReason ?? null,
            },
            retryBudget,
          }
          throw retryError
        }
      }
    }
    throw error
  }

  // 从这次调用里学到「这个模型是推理型的」，后续调用即可自动放宽额度
  if (response.reasoningContent) {
    await rememberReasoningModel(provider.baseUrl, provider.model)
  }

  const truncated = response.finishReason === 'length'
  let parsed = null
  let parseError = null

  try {
    parsed = parseJsonResponse(response.content)
  } catch (error) {
    parseError = error
  }

  // 截断或解析失败 → 放大额度重试一次
  if ((truncated || !parsed) && attempt === 1) {
    const retryBudget = Math.min(Math.round(maxTokens * 2), REASONING_BUDGET_CAP)
    /**
     * 如果是推理模型，重试时按「实测安全水位」放宽而不是只乘倍数——
     * 只乘倍数时 1000 → 3000 正好落在失败区间里，重试了也还是失败。
     */
    const multiplier = Number(limits?.reasoningMultiplier ?? config.ai.reasoningBudgetMultiplier)
    const adjusted = isReasoningModel(provider.baseUrl, provider.model)
      ? reasoningRetryBudget(retryBudget, multiplier)
      : retryBudget

    if (adjusted > maxTokens) {
      try {
        const retried = await callAndParse(prompt, {
          provider,
          maxTokens: adjusted,
          temperature,
          attempt: 2,
          boost,
          limits,
        })
        // 把两次调用的用量合并，成本统计才不会漏掉失败的那一次
        retried.__usage = {
          ...(retried.__usage || {}),
          promptTokens:
            Number(response.usage.promptTokens || 0) + Number(retried.__usage?.promptTokens || 0),
          completionTokens:
            Number(response.usage.completionTokens || 0) +
            Number(retried.__usage?.completionTokens || 0),
          reasoningTokens:
            Number(response.usage.reasoningTokens || 0) +
            Number(retried.__usage?.reasoningTokens || 0),
          retried: true,
          retryReason: truncated ? 'truncated' : 'invalid_json',
          firstAttemptTruncated: truncated,
          firstAttemptBudget: maxTokens,
          retryBudget: adjusted,
        }
        return retried
      } catch (retryError) {
        // 重试也失败：把首次失败的原因一并带出去，便于定位
        retryError.diagnostics = {
          ...(retryError.diagnostics || {}),
          firstAttempt: {
            truncated,
            maxTokens,
            finishReason: response.finishReason,
            contentLength: response.content.length,
            parseError: parseError?.message || null,
          },
        }
        throw retryError
      }
    }
  }

  if (!parsed) {
    const error = new AiCallError(
      AI_ERROR_KINDS.BAD_RESPONSE,
      truncated
        ? `模型输出在 ${maxTokens} token 处被截断，JSON 不完整`
        : `模型返回的内容不是合法 JSON（${parseError?.message || '解析失败'}）`
    )
    // 把现场带出去：调用方要在降级提示里告诉用户到底发生了什么
    error.diagnostics = {
      finishReason: response.finishReason,
      truncated,
      maxTokens,
      contentLength: response.content.length,
      contentHead: response.content.slice(0, 160),
      contentTail: response.content.slice(-80),
      hasReasoning: Boolean(response.reasoningContent),
      usage: response.usage,
      parseError: parseError?.message || null,
    }
    throw error
  }

  // usage 挂在返回对象上随内容一起传下去，避免再改一遍函数签名。
  // 必须是可写的：截断重试路径要在这里累加两次调用的用量。
  Object.defineProperty(parsed, '__usage', {
    value: { ...response.usage, model: response.model, reasoning: Boolean(response.reasoningContent) },
    enumerable: false,
    writable: true,
    configurable: true,
  })
  return parsed
}

/**
 * 推理型模型（把 token 花在内部思考上的那些）在同一个 max_tokens 预算下，
 * 留给正文的空间远小于普通模型，容易把 JSON 截断成不可解析的半截内容。
 * 因此对它们按倍数放宽输出额度——这是「同样的配置换个人就能用」的关键差别。
 * 倍数来自配置，可用 npm run ai:calibrate 实测后调整。
 */
export const REASONING_BUDGET_MULTIPLIER = config.ai.reasoningBudgetMultiplier
const REASONING_BUDGET_CAP = 8000

/**
 * 推理模型「被思考吃光额度」后的重试下限。
 *
 * 实测（deepseek 端点）：额度给 3000 时 reasoning_tokens=3000、正文为空；
 * 给 6000 时才稳定成功（思考用了 4192，正文 436）。
 * 也就是说失败区间正好落在「按倍数放大」的结果里——1000 × 3 = 3000 是最糟的数字。
 * 所以重试不按倍数算，直接跳到实测够用的水位线上。
 */
const REASONING_RETRY_FLOOR = 6000

/**
 * 推理模型被思考吃光额度后，重试该给多少额度。
 *
 * 注意不能只做 `maxTokens * 倍数`：基数小的时候倍数放大也到不了安全水位，
 * 这正是「自动重试了但还是失败」的原因。因此与实测下限取较大值。
 */
function reasoningRetryBudget(maxTokens, multiplier) {
  return Math.min(Math.max(Math.round(maxTokens * multiplier), REASONING_RETRY_FLOOR), REASONING_BUDGET_CAP)
}

/**
 * 算出这次调用该给多少输出额度。
 *
 * 优先级：用户自定义 > 系统默认；再乘上推理型模型的放宽倍数。
 * 生成前预估（preflight）也用同一个函数，否则展示的成本会与真实调用不符。
 *
 * 注意 max_tokens 是「天花板」而不是「预留」：模型写完就停，用不到的额度不收费。
 * 所以调大它的代价接近于零，调小却会真的导致 JSON 被截断、生成失败。
 *
 * 默认会请求服务商「跳过内部思考」，此时模型的表现与普通模型一致，
 * 因此**不再**乘推理倍数。否则预估里会凭空多出两倍额度，
 * 用户会以为一次短文要 3000 token（实测关掉思考后只用约 410）。
 */
function outputBudgetFor(provider, type, limits, boost = 1) {
  const base = effectiveBudget(limits, budgetFieldFor(type), type)
  const multiplier = Number(limits?.reasoningMultiplier ?? config.ai.reasoningBudgetMultiplier)
  const reasoningFactor =
    limits?.allowThinking && isReasoningModel(provider?.baseUrl, provider?.model) ? multiplier : 1
  // boost 是用户主动要求「重新生成、用更大额度」时的额外倍数
  return Math.min(Math.round(base * reasoningFactor * Math.max(1, boost)), REASONING_BUDGET_CAP)
}

/** 内容类型 → 用户额度字段名 */
function budgetFieldFor(type) {
  return (
    {
      article: 'articleTokens',
      quiz: 'quizTokens',
      error_card_batch: 'errorCardTokens',
      weak_summary: 'summaryTokens',
    }[type] || 'articleTokens'
  )
}

/** 依据自评词汇量与目标词难度估算生成难度（PRD 4.3.1 难度分级输入） */
export function estimateDifficulty(words, profile) {
  const levelBias =
    {
      '1000 以下': -1,
      '1000-3000': 0,
      '3000-6000': 1,
      '6000 以上': 2,
      不确定: 0,
    }[profile.selfLevel] ?? 0

  const avg = words.reduce((sum, word) => sum + (Number(word.difficulty) || 3), 0) / (words.length || 1)
  return clamp(Math.round(avg + levelBias * 0.5), 1, 5)
}

// ── 历史内容 ────────────────────────────────────────────────

export async function listContents(userId, { type, page = 1, size = 10 } = {}) {
  const conditions = ['user_id = ?']
  const params = [userId]
  if (type) {
    if (!CONTENT_TYPES.includes(type)) throw badRequest('type 不合法')
    conditions.push('type = ?')
    params.push(type)
  }
  const where = conditions.join(' AND ')

  const totalRow = await queryOne(`SELECT COUNT(*) AS total FROM generated_contents WHERE ${where}`, params)
  const rows = await query(
    `SELECT id, user_id, type, title, topic, difficulty, target_words, meta, model, created_at
       FROM generated_contents WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ${safeLimit(size, { fallback: 10, max: 50 })}
     OFFSET ${safeOffset((page - 1) * size, { max: 100_000 })}`,
    params
  )

  return { items: rows.map((row) => mapContentRow(row, { withBody: false })), total: Number(totalRow?.total || 0) }
}

export async function getContent(userId, id) {
  const row = await queryOne('SELECT * FROM generated_contents WHERE id = ? AND user_id = ?', [id, userId])
  if (!row) throw notFound('生成内容不存在')
  return mapContentRow(row)
}

// ── 状态与设置 ──────────────────────────────────────────────

/** 综合状态：用谁的钱、还剩多少额度、单价说明、今日用量 */
export async function getAiStatus(userId) {
  const provider = await resolveProvider(userId)
  const [keys, usage, summary] = await Promise.all([
    listUserKeys(userId),
    getUsage(userId),
    getUsageSummary(userId, { days: 30 }),
  ])

  return {
    mode: provider.source, // 'user' | 'server' | 'none'
    activeProvider: provider.source === 'none' ? null : { source: provider.source, label: provider.label, model: provider.model },
    serverProvider: describeServerProvider(),
    providers: describeProviders(),
    keys,
    usage,
    summary,
    pricing: describePricing(),
    templateMaxWords: TEMPLATE_MAX_WORDS,
    /** 零成本能力清单，让用户清楚哪些功能不会花他的钱 */
    zeroCostFeatures: [
      '错因分析（纯规则引擎，每次作答都会跑，不调用 AI）',
      '易混词对比卡片（本地编辑距离 + 释义相似度算法）',
      '词库复习清单（释义、音标、易混词均取自数据库）',
    ],
  }
}

/**
 * 保存用户的 Key。
 *
 * 流程刻意做成三段，目的是让失败原因可定位：
 *   归一化输入 → 分步校验（先用不花钱的 /models 验 Key，再检查模型名，最后发一次 8 token 的调用）
 *   → 全部通过才入库
 *
 * 校验失败时不保存，但把完整的诊断过程（每一步的结果、可用模型列表、排查建议）返回给前端。
 */
export async function saveKeyWithVerification(userId, payload) {
  const normalizedKey = normalizeApiKey(payload.apiKey)
  const target = resolveKeyTarget(payload)

  if (!target.baseUrl) throw badRequest('自定义服务商必须填写接口地址（Base URL）')
  if (!target.model) throw badRequest('请填写模型名称')

  const test = await testConnection({
    apiKey: normalizedKey,
    baseUrl: target.baseUrl,
    model: target.model,
  })

  if (!test.ok) {
    // 只记录失败原因与目标地址，绝不记录 Key 本身
    console.warn(
      `[ai] Key 校验失败 user=${userId} provider=${payload.provider} ` +
        `model=${target.model} baseUrl=${target.baseUrl} kind=${test.kind}：${test.message}`
    )
    return { saved: false, verified: false, test }
  }

  const key = await saveUserKey(userId, {
    ...payload,
    apiKey: normalizedKey,
    // 用校验后确定下来的模型 id：它可能是自动纠正过大小写的规范写法
    model: test.resolvedModel || target.model,
  })
  await execute('UPDATE user_api_keys SET last_verified_at = NOW(), last_error = NULL WHERE id = ?', [key.id])

  return { saved: true, verified: true, test, key }
}
/**
 * 只取账号可用的模型列表，供设置页做下拉选择（不消耗 token）。
 */
export async function listAvailableModels(userId, payload) {
  const target = resolveKeyTarget(payload)
  const normalized = normalizeApiKey(payload.apiKey)

  if (!normalized || normalized.length < 8) {
    throw badRequest('请先填写 API Key')
  }
  if (!target.baseUrl) throw badRequest('自定义服务商必须填写接口地址（Base URL）')

  const result = await fetchAvailableModels({
    apiKey: normalized,
    baseUrl: target.baseUrl,
    model: target.model,
  })

  if (!result.ok) {
    console.warn(
      `[ai] 获取模型列表失败 user=${userId} baseUrl=${target.baseUrl} kind=${result.kind}：${result.message}`
    )
  }
  return result
}

/**
 * 只校验不保存。
 * 让用户可以在不留下记录的前提下反复调试 Key / 地址 / 模型名。
 */
export async function verifyKeyOnly(userId, payload) {
  const target = resolveKeyTarget(payload)
  const test = await testConnection({
    apiKey: normalizeApiKey(payload.apiKey),
    baseUrl: target.baseUrl || config.ai.baseUrl,
    model: target.model,
  })

  if (!test.ok) {
    console.warn(
      `[ai] Key 试连失败 user=${userId} model=${target.model} baseUrl=${target.baseUrl} ` +
        `kind=${test.kind}：${test.message}`
    )
  }

  return { saved: false, verified: test.ok, test }
}

/** 测试当前生效的 Key 是否可用（不新建、不修改） */
export async function testActiveKey(userId) {
  const active = await getActiveUserKey(userId)
  if (!active) {
    return { ok: false, kind: 'not_configured', message: '还没有配置自己的 API Key' }
  }
  const result = await pingProvider({
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
    model: active.model,
  })

  await execute('UPDATE user_api_keys SET last_verified_at = NOW(), last_error = ? WHERE id = ?', [
    result.ok ? null : String(result.message || '').slice(0, 255),
    active.id,
  ]).catch(() => {})

  return result
}

export function getProviderStatus() {
  return describeServerProvider()
}

// saveKeyWithVerification 与 verifyKeyOnly 本身就是 export function，无需在此重复导出
// REASONING_BUDGET_MULTIPLIER 已在上文以 export const 声明，无需重复导出
export {
  markKeyUsed,
  deleteUserKey,
  listUserKeys,
  resolveKeyTarget,
  resolveLimits,
  saveLimits,
  applyPreset,
  resetLimits,
  describeLimitOptions,
}

export default {
  CONTENT_TYPES,
  CONTENT_SOURCES,
  generateArticle,
  generateQuiz,
  generateErrorCards,
  generateWeakSummary,
  preflightContent,
  listContents,
  getContent,
  getUsage,
  getUsageSummary,
  getAiStatus,
  saveKeyWithVerification,
  verifyKeyOnly,
  listAvailableModels,
  testActiveKey,
  buildCacheKey,
  similarity,
  getProviderStatus,
  resolveLimits,
  saveLimits,
  applyPreset,
  resetLimits,
  describeLimitOptions,
}
