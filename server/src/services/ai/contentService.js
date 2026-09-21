import crypto from 'node:crypto'
import { query, queryOne, execute } from '../../db/pool.js'
import { config } from '../../config.js'
import { parseJson, toJson, clamp } from '../../utils/json.js'
import { todayKey } from '../../utils/time.js'
import { badRequest, notFound, quotaExceeded } from '../../utils/errors.js'
import { chat, isConfigured, describeProvider } from './aiProvider.js'
import {
  buildArticlePrompt,
  buildQuizPrompt,
  buildErrorCardPrompt,
  buildWeakSummaryPrompt,
  parseJsonResponse,
  pickTopic,
} from './promptTemplates.js'
import { getProfile, bumpTopicWeight } from '../profileService.js'
import { listWordsByIds, getRelatedWords, getWordById, safeLimit, safeOffset } from '../wordService.js'
import { getErrorDigest } from '../studyService.js'
import { getWeakSummary } from '../statsService.js'

export const CONTENT_TYPES = ['article', 'quiz', 'error_card', 'weak_summary']

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
 * 相比向量检索这是轻量近似，接入 embedding 后可无缝替换本函数。
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

/** 与用户最近的同类历史生成内容比较，返回最大相似度 */
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
    'SELECT type, used_count, cached_count FROM ai_usage WHERE user_id = ? AND usage_date = ?',
    [userId, dateKey]
  )
  const byType = new Map(rows.map((row) => [row.type, row]))
  const result = {}
  for (const type of CONTENT_TYPES) {
    const row = byType.get(type)
    result[type] = {
      used: Number(row?.used_count || 0),
      cached: Number(row?.cached_count || 0),
      limit: config.ai.dailyQuota[type] ?? null,
    }
  }
  return result
}

/** 额度是否还可用于真实生成 */
export async function ensureQuota(userId, type) {
  const limit = config.ai.dailyQuota[type]
  if (limit == null) return
  const usage = (await getUsage(userId))[type]
  if (usage.used >= limit) {
    throw quotaExceeded(
      `今日「${type}」的 AI 生成次数已用完（${limit} 次），可先复习历史生成内容或使用预置例句。`,
      { type, limit, used: usage.used }
    )
  }
}

async function bumpUsage(userId, type, { cached = false } = {}) {
  const column = cached ? 'cached_count' : 'used_count'
  await execute(
    `INSERT INTO ai_usage (user_id, usage_date, type, ${column})
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE ${column} = ${column} + 1`,
    [userId, todayKey(), type]
  )
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

/** 取近期目标词：优先用本轮新学的词，不足时用最近复习过的词补齐 */
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

/** 用户画像摘要作为强 Prompt 变量（PRD 4.4 第 1 条） */
function profileForPrompt(profile) {
  return {
    goal: profile.goal,
    selfLevel: profile.selfLevel,
    dailyTime: profile.dailyTime,
  }
}

// ── 对外生成接口 ────────────────────────────────────────────

/**
 * 生成个性化巩固短文（PRD 4.3.1）
 */
export async function generateArticle(userId, options = {}) {
  const { wordIds, minWords = 150, maxWords = 250, apiKey, forceNew = false } = options

  const profile = await getProfile(userId)
  const words = await resolveTargetWords(userId, { wordIds, limit: clamp(options.wordCount || 10, 4, 15) })

  const difficulty = clamp(
    Number.parseInt(options.difficulty, 10) || estimateDifficulty(words, profile),
    1,
    5
  )

  // 历史易混词：制造对比语境，帮助区分（PRD 4.3.1）
  const digest = await getErrorDigest(userId, { days: 30, limit: 20 })
  const weakWords = digest.wrongWords
    .filter((item) => !words.some((word) => word.id === item.wordId))
    .slice(0, 5)
    .map((item) => ({ spelling: item.spelling, definitions: item.definitions }))

  const topic = options.topic || pickTopic(profile.topicWeights)
  const cacheKey = buildCacheKey({
    type: 'article',
    wordIds: words.map((word) => word.id),
    difficulty,
    goal: profile.goal,
    topic,
  })

  if (!forceNew) {
    const cached = await findCached({ userId, cacheKey, type: 'article' })
    if (cached) {
      await bumpUsage(userId, 'article', { cached: true })
      return { content: cached, cached: true, quota: await getUsage(userId) }
    }
  }

  await ensureQuota(userId, 'article')

  const prompt = buildArticlePrompt({
    words,
    profile: profileForPrompt(profile),
    topic,
    difficulty,
    weakWords,
    memoryPrefs: profile.memoryPrefs,
    minWords,
    maxWords,
  })

  let parsed = await callAndParse(prompt, { apiKey, maxTokens: 3000 })

  // 去重校验：与历史生成过雷同时，换话题重试一次（PRD 4.4 第 4 条）
  const body = String(parsed.body || '')
  const maxSimilarity = await maxHistorySimilarity(userId, 'article', body)
  let retried = false
  if (maxSimilarity >= DEDUP_SIMILARITY_THRESHOLD) {
    retried = true
    const alternateTopic = pickTopic(profile.topicWeights)
    const retryPrompt = buildArticlePrompt({
      words,
      profile: profileForPrompt(profile),
      topic: alternateTopic,
      difficulty,
      weakWords,
      memoryPrefs: profile.memoryPrefs,
      minWords,
      maxWords,
    })
    parsed = await callAndParse(retryPrompt, { apiKey, maxTokens: 3000, temperature: 1.2 })
  }

  const content = await saveContent({
    userId,
    type: 'article',
    title: parsed.title || '',
    topic: parsed.topicUsed || topic,
    difficulty,
    wordIds: words.map((word) => word.id),
    body: String(parsed.body || ''),
    meta: { glossary: parsed.glossary || [], words: words.map((word) => ({ id: word.id, spelling: word.spelling })) },
    cacheKey,
    model: config.ai.defaultModel,
    usage: parsed.__usage,
  })

  await bumpUsage(userId, 'article')
  if (content.topic) await bumpTopicWeight(userId, content.topic, 0.1).catch(() => {})

  return {
    content,
    cached: false,
    dedupRetried: retried,
    maxHistorySimilarity: Math.round(maxSimilarity * 1000) / 1000,
    quota: await getUsage(userId),
  }
}

/**
 * 基于短文生成阅读理解题（PRD 4.3.2）
 */
export async function generateQuiz(userId, { articleId, count = 3, apiKey, forceNew = false } = {}) {
  if (!articleId) throw badRequest('必须提供 articleId')

  const articleRow = await queryOne(
    "SELECT * FROM generated_contents WHERE id = ? AND user_id = ? AND type = 'article'",
    [articleId, userId]
  )
  if (!articleRow) throw notFound('短文不存在')

  const article = mapContentRow(articleRow)
  const profile = await getProfile(userId)
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
      return { content: cached, cached: true, quota: await getUsage(userId) }
    }
  }

  await ensureQuota(userId, 'quiz')

  const prompt = buildQuizPrompt({
    article: { title: article.title, body: article.body },
    words,
    profile: profileForPrompt(profile),
    difficulty: article.difficulty,
    count: clamp(count, 3, 5),
  })

  // 理解题的解析与答案需要结构化保存，正文存题目本体，meta 存答案
  const parsed = await callAndParse(prompt, { apiKey, maxTokens: 2500 })
  const questions = Array.isArray(parsed.questions) ? parsed.questions : []
  if (!questions.length) throw badRequest('AI 未生成有效题目，请重试')

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
    model: config.ai.defaultModel,
    usage: parsed.__usage,
  })

  await bumpUsage(userId, 'quiz')
  return { content, cached: false, quota: await getUsage(userId) }
}

/**
 * 针对易混词生成对比记忆卡片（PRD 4.2.3 / 4.3.3）
 */
export async function generateErrorCard(userId, { wordId, apiKey, forceNew = false } = {}) {
  if (!wordId) throw badRequest('必须提供 wordId')

  const word = await getWordById(wordId)
  const profile = await getProfile(userId)
  const related = await getRelatedWords(wordId, { limit: 4 })
  const digest = await getErrorDigest(userId, { days: 90, limit: 50 })
  const breakdown = digest.wrongWords.find((item) => item.wordId === Number(wordId))?.breakdown || {}

  const cacheKey = buildCacheKey({
    type: 'error_card',
    wordIds: [Number(wordId)],
    difficulty: word.difficulty,
    goal: profile.goal,
    topic: '',
  })

  if (!forceNew) {
    const cached = await findCached({ userId, cacheKey, type: 'error_card' })
    if (cached) {
      await bumpUsage(userId, 'error_card', { cached: true })
      return { content: cached, cached: true, quota: await getUsage(userId) }
    }
  }

  await ensureQuota(userId, 'error_card')

  const prompt = buildErrorCardPrompt({
    word,
    relatedWords: related,
    errorBreakdown: breakdown,
    profile: profileForPrompt(profile),
  })

  const parsed = await callAndParse(prompt, { apiKey, maxTokens: 1800 })

  const content = await saveContent({
    userId,
    type: 'error_card',
    title: `对比记忆 · ${word.spelling}`,
    topic: '',
    difficulty: word.difficulty,
    wordIds: [word.id],
    body: parsed.headline || '',
    meta: {
      word: { id: word.id, spelling: word.spelling, definitions: word.definitions },
      distinctions: parsed.distinctions || [],
      mnemonic: parsed.mnemonic || '',
      formTip: parsed.formTip || '',
      relatedWords: related.map((item) => ({ wordId: item.wordId, spelling: item.spelling })),
    },
    cacheKey,
    model: config.ai.defaultModel,
    usage: parsed.__usage,
  })

  await bumpUsage(userId, 'error_card')
  return { content, cached: false, quota: await getUsage(userId) }
}

/**
 * 生成「本周薄弱点小结」（PRD 4.3.3）。统计数据由服务端算好，模型只负责表述。
 */
export async function generateWeakSummary(userId, { days = 7, apiKey } = {}) {
  const profile = await getProfile(userId)
  const stats = await getWeakSummary(userId, { days })

  if (!stats.errorDistribution.total) {
    return { content: null, cached: false, reason: 'no_errors', fallback: stats }
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
    return { content: cached, cached: true, fallback: stats, quota: await getUsage(userId) }
  }

  await ensureQuota(userId, 'weak_summary')
  const prompt = buildWeakSummaryPrompt({ stats, profile: profileForPrompt(profile) })
  const parsed = await callAndParse(prompt, { apiKey, maxTokens: 1500 })

  const content = await saveContent({
    userId,
    type: 'weak_summary',
    title: '本周薄弱点小结',
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
    model: config.ai.defaultModel,
    usage: parsed.__usage,
  })

  await bumpUsage(userId, 'weak_summary')
  return { content, cached: false, fallback: stats, quota: await getUsage(userId) }
}

async function callAndParse(prompt, { apiKey, maxTokens, temperature } = {}) {
  const response = await chat({
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    maxTokens,
    temperature,
    apiKey,
  })

  const parsed = parseJsonResponse(response.content)
  // usage 挂在返回对象上随内容一起传下去，避免再改一遍函数签名
  Object.defineProperty(parsed, '__usage', {
    value: response.usage,
    enumerable: false,
  })
  return parsed
}

/** 依据自评词汇量与目标词难度估算生成难度（PRD 4.3.1 难度分级输入） */
export function estimateDifficulty(words, profile) {
  const levelBias = {
    '1000 以下': -1,
    '1000-3000': 0,
    '3000-6000': 1,
    '6000 以上': 2,
    不确定: 0,
  }[profile.selfLevel] ?? 0

  const avg =
    words.reduce((sum, word) => sum + (Number(word.difficulty) || 3), 0) / (words.length || 1)

  return clamp(Math.round(avg + levelBias * 0.5), 1, 5)
}

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

/** 供健康检查展示 AI 模块状态 */
export function getProviderStatus() {
  return describeProvider()
}

export { isConfigured as isAiConfigured }

export default {
  CONTENT_TYPES,
  generateArticle,
  generateQuiz,
  generateErrorCard,
  generateWeakSummary,
  listContents,
  getContent,
  getUsage,
  buildCacheKey,
  similarity,
  getProviderStatus,
}
