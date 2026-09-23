import { query, queryOne } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { notFound } from '../utils/errors.js'
import { GOAL_TO_BOOK, FALLBACK_BOOK_CODE } from './wordlist/sources.js'

/** LIMIT 参数经过整数校验后内联，规避驱动对 LIMIT 占位符的兼容问题 */
export function safeLimit(value, { fallback = 20, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(1, parsed))
}

/** OFFSET 参数，允许 0 且非负 */
export function safeOffset(value, { fallback = 0, max = 1_000_000 } = {}) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(0, parsed))
}

/** 数据库行 → 对外单词结构（兼容前端既有字段：example 取首个例句） */
export function mapWordRow(row) {
  if (!row) return null
  const definitions = parseJson(row.definitions, [])
  const examples = parseJson(row.examples, [])
  return {
    id: Number(row.id),
    wordbookId: row.wordbook_id != null ? Number(row.wordbook_id) : null,
    spelling: row.spelling,
    phonetic: row.phonetic || '',
    pos: row.pos || '',
    freq: row.freq || 'med',
    difficulty: Number(row.difficulty ?? 3),
    definitions,
    examples,
    example: examples[0] || '',
  }
}

export async function listWordbooks() {
  const rows = await query(
    `SELECT id, code, name, scope, description, is_builtin, word_count
       FROM wordbooks ORDER BY is_builtin DESC, id ASC`
  )
  return rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    scope: row.scope,
    description: row.description,
    isBuiltin: Boolean(row.is_builtin),
    wordCount: Number(row.word_count),
  }))
}

export async function getWordbookByCode(code) {
  const row = await queryOne('SELECT * FROM wordbooks WHERE code = ?', [code])
  if (!row) throw notFound(`词书不存在：${code}`)
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    scope: row.scope,
    description: row.description,
    isBuiltin: Boolean(row.is_builtin),
    wordCount: Number(row.word_count),
  }
}

/** 取默认词书：用户未指定时按学习目标映射，最后兜底到任意一本 */
export async function resolveWordbookForUser(userId) {
  if (userId != null) {
    // 1) 画像上已固化的选择优先。注意必须选出 b.id——
    //    漏掉它会让词书 id 变成 NaN，进而让取新词的查询静默返回空集合。
    const profileRow = await queryOne(
      `SELECT b.id, b.code, b.name, b.scope, b.description, b.word_count
         FROM user_profiles p
         JOIN wordbooks b ON b.id = p.wordbook_id
        WHERE p.user_id = ?`,
      [userId]
    )
    if (profileRow) return mapWordbookRow(profileRow)

    // 2) 否则按学习目标映射（四级 → cet4，考研 → npee …）
    const goalRow = await queryOne('SELECT goal FROM user_profiles WHERE user_id = ?', [userId])
    const code = GOAL_TO_BOOK[goalRow?.goal] || FALLBACK_BOOK_CODE
    const mapped = await queryOne(
      'SELECT id, code, name, scope, description, word_count FROM wordbooks WHERE code = ?',
      [code]
    )
    if (mapped) return mapWordbookRow(mapped)
  }

  // 3) 兜底：随便给一本，至少不让学习流程中断
  const fallback = await queryOne(
    'SELECT id, code, name, scope, description, word_count FROM wordbooks ORDER BY is_builtin DESC, id ASC LIMIT 1'
  )
  if (!fallback) throw notFound('尚未导入任何词书，请先执行 npm run db:import')
  return mapWordbookRow(fallback)
}

function mapWordbookRow(row) {
  const id = Number(row?.id)
  // 显式校验：取词书时少选一个字段是最容易犯又最难查的错误，
  // 它会表现为「接口正常但一道题都没有」，所以宁可当场报错。
  if (!Number.isFinite(id)) {
    throw new Error(`词书数据异常：缺少有效的 id（code=${row?.code}），请检查查询是否漏选了 b.id`)
  }
  return {
    id,
    code: row.code,
    name: row.name,
    scope: row.scope,
    description: row.description,
    wordCount: Number(row.word_count),
  }
}

/**
 * 按学习目标解析词书，供 Onboarding 使用。
 *
 * 与 resolveWordbookForUser 的区别：这里允许「映射到的词书不存在」。
 * 例如只导入了内置示例词库的环境里没有 cet4，此时应该退回任意可用词书，
 * 而不是让引导流程直接报 404。
 */
export async function resolveWordbookForGoal(userId, goal) {
  const code = GOAL_TO_BOOK[goal] || FALLBACK_BOOK_CODE
  const row = await queryOne(
    'SELECT id, code, name, scope, description, word_count FROM wordbooks WHERE code = ?',
    [code]
  )
  if (row) {
    return { ...mapWordbookRow(row), matchedGoal: true }
  }
  const fallback = await resolveWordbookForUser(userId)
  return { ...fallback, matchedGoal: false }
}

export async function listWords({ wordbookId, page = 1, size = 20, freq, difficulty }) {
  const conditions = ['wordbook_id = ?']
  const params = [wordbookId]

  if (freq) {
    conditions.push('freq = ?')
    params.push(freq)
  }
  if (difficulty) {
    conditions.push('difficulty = ?')
    params.push(difficulty)
  }

  const where = conditions.join(' AND ')
  const totalRow = await queryOne(`SELECT COUNT(*) AS total FROM words WHERE ${where}`, params)
  const total = Number(totalRow?.total || 0)

  const rows = await query(
    `SELECT * FROM words WHERE ${where}
      ORDER BY FIELD(freq, 'high', 'med', 'low'), difficulty ASC, spelling ASC
      LIMIT ${safeLimit(size, { fallback: 20, max: 200 })}
     OFFSET ${safeOffset((page - 1) * size, { max: 1_000_000 })}`,
    params
  )

  return { items: rows.map(mapWordRow), total }
}

export async function getWordById(id) {
  const row = await queryOne('SELECT * FROM words WHERE id = ?', [id])
  if (!row) throw notFound('单词不存在')
  return mapWordRow(row)
}

/** 按 id 批量取词，返回顺序与传入的 ids 保持一致（缺失的词直接跳过） */
export async function listWordsByIds(ids = []) {
  const normalized = [...new Set(ids.map((id) => Number(id)).filter(Number.isFinite))]
  if (!normalized.length) return []

  const placeholders = normalized.map(() => '?').join(',')
  const rows = await query(`SELECT * FROM words WHERE id IN (${placeholders})`, normalized)
  const byId = new Map(rows.map((row) => [Number(row.id), mapWordRow(row)]))
  return normalized.map((id) => byId.get(id)).filter(Boolean)
}

/**
 * 易混词（形近 / 近义）查询，供对比记忆卡片使用（PRD 4.2.3）。
 * @returns {Promise<Array<{wordId:number, spelling:string, definitions:string[], phonetic:string, pos:string, relationType:'form'|'meaning', score:number}>>}
 */
export async function getRelatedWords(wordId, { limit = 6 } = {}) {
  const rows = await query(
    `SELECT r.related_word_id, r.relation_type, r.score,
            w.spelling, w.phonetic, w.pos, w.definitions
       FROM word_relations r
       JOIN words w ON w.id = r.related_word_id
      WHERE r.word_id = ?
      ORDER BY r.score DESC, r.relation_type ASC
      LIMIT ${safeLimit(limit, { fallback: 6, max: 50 })}`,
    [wordId]
  )
  return rows.map((row) => ({
    wordId: Number(row.related_word_id),
    spelling: row.spelling,
    phonetic: row.phonetic || '',
    pos: row.pos || '',
    definitions: parseJson(row.definitions, []),
    relationType: row.relation_type,
    score: Number(row.score),
  }))
}

/** 按中文释义反查单词，用于识别用户选错的干扰项究竟属于哪个词 */
export async function findWordByDefinition(definitionText) {
  if (typeof definitionText !== 'string' || !definitionText.trim()) return null
  const row = await queryOne(
    'SELECT * FROM words WHERE JSON_CONTAINS(definitions, JSON_QUOTE(?)) LIMIT 1',
    [definitionText.trim()]
  )
  return mapWordRow(row)
}

/** 两个词之间的关系类型与相似度 */
export async function getRelationBetween(wordId, relatedWordId) {
  const row = await queryOne(
    `SELECT relation_type, score FROM word_relations
      WHERE word_id = ? AND related_word_id = ?
      ORDER BY score DESC LIMIT 1`,
    [wordId, relatedWordId]
  )
  return row ? { relationType: row.relation_type, score: Number(row.score) } : null
}

/**
 * 生成选择题选项：1 个正确释义 + 若干个干扰项。
 * 干扰项优先取形近/近义词（更有训练价值），不足时用同词书其他词随机补齐。
 *
 * 选项文本用**完整释义**（`丢弃；放弃，抛弃`）而不是只取第一条：
 * 只给两个字的选项会让题目退化成「认字形」，看不出用户是否真的理解词义。
 * 同时单列 `primary`（词表里的第一条释义）供前端加粗——
 * 需要说明的是：这是「来源词表里的第一条」，属于排序位置，不是真实的词频标注，
 * 词库本身没有重点/高频释义字段。
 */
export async function buildOptionsFor(word, { count = 4 } = {}) {
  const optionCount = Math.max(2, Math.min(6, count))
  const fullText = (definitions) => (definitions || []).join('；')
  const correctText = fullText(word.definitions)

  const rows = await query(
    `SELECT w.id, w.definitions, w.pos, COALESCE(r.score, 0) AS relation_score
       FROM words w
       LEFT JOIN word_relations r ON r.word_id = ? AND r.related_word_id = w.id
      WHERE w.wordbook_id = ? AND w.id <> ?
      ORDER BY relation_score DESC, RAND()
      LIMIT 40`,
    [word.id, word.wordbookId, word.id]
  )

  const seen = new Set([correctText])
  const related = []
  const others = []

  for (const row of rows) {
    const definitions = parseJson(row.definitions, [])
    const text = fullText(definitions)
    if (!text || seen.has(text)) continue
    seen.add(text)

    const option = { text, primary: definitions[0] || '', correct: false, wordId: Number(row.id) }
    if (Number(row.relation_score) > 0 && related.length < optionCount - 1) related.push(option)
    else others.push(option)
  }

  const distractors = [...related, ...others].slice(0, optionCount - 1)

  return shuffle([
    { text: correctText, primary: word.definitions[0] || '', correct: true, wordId: word.id },
    ...distractors,
  ])
}

/**
 * 最近学过的单词（PRD 4.9 气泡彩蛋的数据来源）。
 * @returns {Promise<Array<{wordId:number, spelling:string, definitions:string[], learnedAt:Date|null}>>}
 */
export async function recentLearnedWords(userId, { limit = 8 } = {}) {
  const rows = await query(
    `SELECT w.id, w.spelling, w.definitions,
            COALESCE(p.last_review_at, p.first_learned_at) AS learned_at
       FROM user_word_progress p
       JOIN words w ON w.id = p.word_id
      WHERE p.user_id = ?
      ORDER BY learned_at DESC
      LIMIT ${safeLimit(limit, { fallback: 8, max: 30 })}`,
    [userId]
  )
  return rows.map((row) => ({
    wordId: Number(row.id),
    spelling: row.spelling,
    definitions: parseJson(row.definitions, []),
    learnedAt: row.learned_at,
  }))
}

/** Fisher-Yates 洗牌，返回新数组 */
export function shuffle(list) {
  const output = [...list]
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[output[i], output[j]] = [output[j], output[i]]
  }
  return output
}

export default {
  listWordbooks,
  getWordbookByCode,
  resolveWordbookForUser,
  resolveWordbookForGoal,
  listWords,
  getWordById,
  listWordsByIds,
  getRelatedWords,
  findWordByDefinition,
  getRelationBetween,
  buildOptionsFor,
  recentLearnedWords,
  mapWordRow,
  shuffle,
  safeLimit,
  safeOffset,
}
