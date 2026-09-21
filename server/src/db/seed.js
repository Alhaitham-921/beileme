import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pool, query } from './pool.js'
import { runMigrations } from './migrate.js'
import { SERVER_ROOT } from '../config.js'
import { buildRelations } from '../services/wordRelations.js'

/** 前端内置词库的物理路径：src/data/words.js */
export const BUILTIN_WORDS_PATH = path.resolve(SERVER_ROOT, '..', 'src', 'data', 'words.js')

/**
 * 内置示例词库。
 *
 * 只包含 80 个词，用途是给自动化测试提供一份稳定、可控的数据集
 * （真实词库有 3 万词，测试里没法断言具体词条）。
 * 生产/开发环境的真实词书由 importWordlists.js 从开源词库导入。
 *
 * code 刻意与真实词书区分开（真实四级词书是 cet4），否则两者会写进同一本书。
 */
const BUILTIN_WORDBOOK = {
  code: 'fixture-demo',
  name: '示例词库（测试与离线演示用）',
  scope: '四级',
  description: '由前端 src/data/words.js 导入的 80 词示例词库，仅用于测试与离线演示；真实词库请执行 npm run db:import',
}

const FREQ_VALUES = new Set(['high', 'med', 'low'])

/** 徽章字典（PRD 4.6.2 奖励系统） */
const BADGES = [
  { code: 'streak_3', name: '三日之约', description: '连续学习 3 天', category: 'streak', threshold: 3, icon: '🌱', sort_order: 10 },
  { code: 'streak_7', name: '一周不辍', description: '连续学习 7 天', category: 'streak', threshold: 7, icon: '🔥', sort_order: 11 },
  { code: 'streak_30', name: '月度坚持', description: '连续学习 30 天', category: 'streak', threshold: 30, icon: '🏅', sort_order: 12 },
  { code: 'streak_100', name: '百日之功', description: '连续学习 100 天', category: 'streak', threshold: 100, icon: '👑', sort_order: 13 },
  { code: 'words_100', name: '初窥门径', description: '累计背会 100 个单词', category: 'milestone', threshold: 100, icon: '📗', sort_order: 20 },
  { code: 'words_500', name: '渐入佳境', description: '累计背会 500 个单词', category: 'milestone', threshold: 500, icon: '📘', sort_order: 21 },
  { code: 'words_1000', name: '词汇千军', description: '累计背会 1000 个单词', category: 'milestone', threshold: 1000, icon: '📙', sort_order: 22 },
  { code: 'words_3000', name: '词海轻舟', description: '累计背会 3000 个单词', category: 'milestone', threshold: 3000, icon: '📚', sort_order: 23 },
  { code: 'accuracy_95', name: '精准记忆', description: '单日正确率不低于 95%', category: 'quality', threshold: 95, icon: '🎯', sort_order: 30 },
  { code: 'no_form_confusion_week', name: '明辨形近', description: '单周没有出现形近词混淆错误', category: 'quality', threshold: 7, icon: '🔍', sort_order: 31 },
  { code: 'article_perfect', name: '读以致用', description: '完成一次巩固短文阅读且全对', category: 'challenge', threshold: 1, icon: '📖', sort_order: 40 },
  { code: 'spell_streak_5', name: '拼词高手', description: '连续 5 次拼词游戏一次通关', category: 'challenge', threshold: 5, icon: '🔤', sort_order: 41 },
]

async function importBuiltinWords() {
  const module = await import(pathToFileURL(BUILTIN_WORDS_PATH).href)
  const words = module.WORDS
  if (!Array.isArray(words) || !words.length) {
    throw new Error(`未从 ${BUILTIN_WORDS_PATH} 读取到任何单词`)
  }
  return words
}

/** 把前端词库对象规范化成数据库行，脏数据在这里就地兜底而不是写进库 */
function toRow(word, wordbookId) {
  const spelling = String(word.spelling || word.id || '').trim()
  if (!spelling) throw new Error(`存在缺少 spelling 的词条：${JSON.stringify(word)}`)

  const definitions = (Array.isArray(word.definitions) ? word.definitions : [word.definitions])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
  if (!definitions.length) throw new Error(`单词 ${spelling} 缺少中文释义`)

  const examples = (Array.isArray(word.examples) ? word.examples : [word.example])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)

  const difficulty = Number.parseInt(word.difficulty, 10)

  return {
    wordbook_id: wordbookId,
    spelling,
    spelling_norm: spelling.toLowerCase(),
    phonetic: String(word.phonetic || '').trim(),
    pos: String(word.pos || '').trim(),
    freq: FREQ_VALUES.has(word.freq) ? word.freq : 'med',
    difficulty: Number.isFinite(difficulty) ? Math.min(5, Math.max(1, difficulty)) : 3,
    definitions: JSON.stringify(definitions),
    examples: JSON.stringify(examples.length ? examples : [`${spelling}.`]),
  }
}

async function upsertWordbook() {
  const existing = await query('SELECT id FROM wordbooks WHERE code = ?', [BUILTIN_WORDBOOK.code])
  if (existing.length) {
    await pool.execute(
      'UPDATE wordbooks SET name = ?, scope = ?, description = ? WHERE id = ?',
      [BUILTIN_WORDBOOK.name, BUILTIN_WORDBOOK.scope, BUILTIN_WORDBOOK.description, existing[0].id]
    )
    return existing[0].id
  }
  const [result] = await pool.execute(
    'INSERT INTO wordbooks (code, name, scope, description, is_builtin) VALUES (?, ?, ?, ?, 1)',
    [BUILTIN_WORDBOOK.code, BUILTIN_WORDBOOK.name, BUILTIN_WORDBOOK.scope, BUILTIN_WORDBOOK.description]
  )
  return result.insertId
}

async function upsertWords(wordbookId, rows) {
  // 批量写入，重复词条仅更新内容字段，保留原有 id 以免打断用户学习进度外键
  const values = rows.map((row) => [
    row.wordbook_id,
    row.spelling,
    row.spelling_norm,
    row.phonetic,
    row.pos,
    row.freq,
    row.difficulty,
    row.definitions,
    row.examples,
  ])

  await pool.query(
    `INSERT INTO words
       (wordbook_id, spelling, spelling_norm, phonetic, pos, freq, difficulty, definitions, examples)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       phonetic = VALUES(phonetic),
       pos = VALUES(pos),
       freq = VALUES(freq),
       difficulty = VALUES(difficulty),
       definitions = VALUES(definitions),
       examples = VALUES(examples)`,
    [values]
  )

  const words = await query(
    'SELECT id, spelling, definitions FROM words WHERE wordbook_id = ? ORDER BY id',
    [wordbookId]
  )
  return words.map((row) => ({
    id: row.id,
    spelling: row.spelling,
    definitions: typeof row.definitions === 'string' ? JSON.parse(row.definitions) : row.definitions,
  }))
}

async function rebuildRelations(wordbookId, words) {
  const relations = buildRelations(words)
  await pool.execute(
    `DELETE wr FROM word_relations wr
       JOIN words w ON w.id = wr.word_id
      WHERE w.wordbook_id = ? AND wr.source = 'computed'`,
    [wordbookId]
  )

  if (relations.length) {
    const values = relations.map((rel) => [
      rel.word_id,
      rel.related_word_id,
      rel.relation_type,
      rel.score,
      rel.source,
    ])
    await pool.query(
      `INSERT INTO word_relations (word_id, related_word_id, relation_type, score, source)
       VALUES ?
       ON DUPLICATE KEY UPDATE score = VALUES(score)`,
      [values]
    )
  }
  return relations.length
}

async function upsertBadges() {
  const values = BADGES.map((badge) => [
    badge.code,
    badge.name,
    badge.description,
    badge.category,
    badge.threshold,
    badge.icon,
    badge.sort_order,
  ])
  await pool.query(
    `INSERT INTO badges (code, name, description, category, threshold, icon, sort_order)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       description = VALUES(description),
       category = VALUES(category),
       threshold = VALUES(threshold),
       icon = VALUES(icon),
       sort_order = VALUES(sort_order)`,
    [values]
  )
  return BADGES.length
}

/**
 * 幂等种子导入：可重复执行，不会产生重复词条。
 * @returns {Promise<{wordbookId:number, wordCount:number, relationCount:number, badgeCount:number}>}
 */
export async function seed({ migrate = true, logger = console } = {}) {
  if (migrate) await runMigrations({ logger })

  const rawWords = await importBuiltinWords()
  const wordbookId = await upsertWordbook()
  const rows = rawWords.map((word) => toRow(word, wordbookId))
  const words = await upsertWords(wordbookId, rows)
  const relationCount = await rebuildRelations(wordbookId, words)
  const badgeCount = await upsertBadges()

  await pool.execute('UPDATE wordbooks SET word_count = ? WHERE id = ?', [words.length, wordbookId])

  logger.log(
    `[seed] 词书 ${BUILTIN_WORDBOOK.code}：${words.length} 个单词，${relationCount} 条形近/近义关系，${badgeCount} 个徽章`
  )
  return { wordbookId, wordCount: words.length, relationCount, badgeCount }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isDirectRun) {
  seed()
    .then(() => pool.end())
    .then(() => console.log('[seed] 完成'))
    .catch(async (error) => {
      console.error('[seed] 失败：', error.message)
      await pool.end().catch(() => {})
      process.exitCode = 1
    })
}
