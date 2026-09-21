/**
 * 从开源词库导入词表。
 *
 * 用法：
 *   node server/src/db/importWordlists.js                 # 用缓存（没有则下载）
 *   node server/src/db/importWordlists.js --refresh       # 强制重新下载
 *   node server/src/db/importWordlists.js --inspect       # 只解析并打印统计，不写数据库
 *   node server/src/db/importWordlists.js --book=cet4     # 只导入指定词书
 *
 * 导入是幂等的：重复执行只会更新词条内容，不会产生重复数据，
 * 也不会删除词条（删除会连带清空用户在那本书上的学习进度）。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pool, query, execute } from './pool.js'
import { runMigrations } from './migrate.js'
import {
  BOOK_SOURCES,
  FREQUENCY_SOURCE,
  loadSource,
} from '../services/wordlist/sources.js'
import { parseWordlist } from '../services/wordlist/parse.js'
import { buildRelationsBulk } from '../services/wordRelations.js'

/** 词频分档的边界：按书内分位数切分，保证任何一本书里都有高频词优先可言 */
const FREQ_HIGH_PERCENTILE = 0.25
const FREQ_MED_PERCENTILE = 0.75

/** 难度分档：词频越高（越常见）难度越低 */
const DIFFICULTY_STEPS = [
  { maxPercentile: 0.2, difficulty: 1 },
  { maxPercentile: 0.4, difficulty: 2 },
  { maxPercentile: 0.6, difficulty: 3 },
  { maxPercentile: 0.8, difficulty: 4 },
  { maxPercentile: 1, difficulty: 5 },
]

/** 批量写库的分片大小，避免单条 SQL 过大触发 max_allowed_packet */
const INSERT_CHUNK = 400

function readFlag(argv, name) {
  return argv.includes(`--${name}`)
}

function readOption(argv, name) {
  const prefix = `--${name}=`
  const found = argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

/**
 * 解析 COCA 词频表，得到 单词 → 排名（越小越常见）。
 */
function parseFrequencyRanks(text) {
  const ranks = new Map()
  let rank = 0
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim().toLowerCase()
    if (!word || !/^[a-z][a-z'’\-]*$/.test(word)) continue
    rank += 1
    if (!ranks.has(word)) ranks.set(word, rank)
  }
  return ranks
}

/**
 * 读取并解析所有词书源文件。
 * @returns {Promise<{books:Array, frequencyRanks:Map<string,number>}>}
 */
async function loadAllBooks({ refresh = false, only = null, logger = console } = {}) {
  const books = []

  for (const source of BOOK_SOURCES) {
    if (only && source.code !== only) continue

    const { text, source: origin, bytes, encoding } = await loadSource(source.repo, source.file, {
      refresh,
      logger,
    })
    const { entries, skipped, merged, format } = parseWordlist(text, source.format)
    books.push({ source, entries, skipped, merged, format, origin, bytes, encoding })

    logger.log(
      `[import] ${source.code.padEnd(9)} 解析出 ${String(entries.length).padStart(5)} 词` +
        `（格式 ${format}，合并同词多词性 ${merged} 行，跳过 ${skipped} 行，` +
        `${origin === 'cache' ? '缓存' : '下载'}，编码 ${encoding}）`
    )
  }

  const frequency = await loadSource(FREQUENCY_SOURCE.repo, FREQUENCY_SOURCE.file, { refresh, logger })
  const frequencyRanks = parseFrequencyRanks(frequency.text)
  logger.log(`[import] COCA 词频表载入 ${frequencyRanks.size} 个单词的排名`)

  return { books, frequencyRanks, frequencyOrigin: frequency.source }
}

/**
 * 释义质量打分：先看最长的单条释义，再看条数。
 *
 * 不能简单按条数取，否则 `部,司,局,处,系`（5 条单字）会盖过 `部门,学部`（2 条完整释义），
 * 反而把质量更差的释义选进总词典。
 */
function definitionQuality(definitions) {
  if (!definitions?.length) return 0
  const longest = Math.max(...definitions.map((item) => item.length))
  return longest * 10 + definitions.length
}

/**
 * 建立「单词 → 释义」总词典，用于两件事：
 *  1. 给裸词表（小学、以及未来任何只有单词没有释义的来源）补全释义
 *  2. 给释义全是单字的词条挑一个更完整的版本
 * 同名词条按释义质量择优。
 */
function buildDictionary(books) {
  const dictionary = new Map()
  for (const book of books) {
    for (const entry of book.entries) {
      if (!entry.definitions.length) continue
      const existing = dictionary.get(entry.spelling)
      if (!existing || definitionQuality(entry.definitions) > definitionQuality(existing.definitions)) {
        dictionary.set(entry.spelling, {
          phonetic: entry.phonetic,
          pos: entry.pos,
          definitions: entry.definitions,
        })
      }
    }
  }
  return dictionary
}

/** 释义是否全是单字（说明是按逗号切碎的列举，如 `部,司,局,处`） */
function isAllSingleChar(definitions) {
  return definitions.length > 0 && definitions.every((item) => item.length === 1)
}

/**
 * 用总词典补全词条：
 *  - 裸词表（没有释义）→ 整条补上
 *  - 释义全是单字 → 换成更完整的版本
 */
function enrichEntries(books, dictionary) {
  const stats = { filled: 0, upgraded: 0, dropped: 0 }

  for (const book of books) {
    for (const entry of book.entries) {
      if (entry.definitions.length && !isAllSingleChar(entry.definitions)) continue

      const candidate = dictionary.get(entry.spelling)
      const hasBetter =
        candidate && definitionQuality(candidate.definitions) > definitionQuality(entry.definitions)

      if (!hasBetter) {
        // 完全没有释义才需要丢弃；只有单字释义的仍保留，否则这个词就没了
        if (!entry.definitions.length) stats.dropped += 1
        continue
      }

      if (entry.definitions.length) stats.upgraded += 1
      else stats.filled += 1

      entry.definitions = candidate.definitions
      entry.phonetic = entry.phonetic || candidate.phonetic
      entry.pos = entry.pos || candidate.pos
    }
  }
  return stats
}

/**
 * 用 COCA 排名给一本书里的词打上词频与难度。
 *
 * 采用「书内分位数」而不是绝对阈值：GRE 词表里几乎全是低频词，
 * 用绝对阈值会导致整本书都是 low，复习顺序就失去了意义。
 * 分位数保证任何一本书内部都是「更常见的词先背」。
 */
function assignTiers(entries, frequencyRanks) {
  const ordered = entries
    .map((entry) => ({ entry, rank: frequencyRanks.get(entry.spelling) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.rank - b.rank)

  const total = ordered.length
  ordered.forEach((item, index) => {
    const percentile = total <= 1 ? 0 : index / (total - 1)

    item.entry.freq =
      percentile <= FREQ_HIGH_PERCENTILE ? 'high' : percentile <= FREQ_MED_PERCENTILE ? 'med' : 'low'

    const step = DIFFICULTY_STEPS.find((candidate) => percentile <= candidate.maxPercentile)
    item.entry.difficulty = step ? step.difficulty : 5
    item.entry.rank = item.rank
  })

  const withRank = ordered.filter((item) => Number.isFinite(item.rank)).length
  return { total, withRank }
}

async function upsertBook(source, wordCount = 0) {
  const existing = await query('SELECT id FROM wordbooks WHERE code = ?', [source.code])
  if (existing.length) {
    await execute(
      'UPDATE wordbooks SET name = ?, scope = ?, description = ?, word_count = ? WHERE id = ?',
      [source.name, source.scope, source.description, wordCount, existing[0].id]
    )
    return existing[0].id
  }
  const result = await execute(
    `INSERT INTO wordbooks (code, name, scope, description, is_builtin, word_count)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [source.code, source.name, source.scope, source.description, wordCount]
  )
  return result.insertId
}

async function upsertWords(bookId, entries) {
  for (let offset = 0; offset < entries.length; offset += INSERT_CHUNK) {
    const chunk = entries.slice(offset, offset + INSERT_CHUNK)
    const values = chunk.map((entry) => [
      bookId,
      entry.spelling,
      entry.spelling,
      entry.phonetic || '',
      entry.pos || '',
      entry.freq,
      entry.difficulty,
      JSON.stringify(entry.definitions),
      // 开源词表都不带例句；存空数组，前端在无例句时隐藏例句行
      JSON.stringify([]),
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
         definitions = VALUES(definitions)`,
      [values]
    )
  }
}

async function rebuildRelations(bookId, logger) {
  const rows = await query(
    'SELECT id, spelling, definitions FROM words WHERE wordbook_id = ? ORDER BY id',
    [bookId]
  )
  const words = rows.map((row) => ({
    id: row.id,
    spelling: row.spelling,
    definitions: typeof row.definitions === 'string' ? JSON.parse(row.definitions) : row.definitions,
  }))

  await execute(
    `DELETE wr FROM word_relations wr
       JOIN words w ON w.id = wr.word_id
      WHERE w.wordbook_id = ? AND wr.source = 'computed'`,
    [bookId]
  )

  const relations = buildRelationsBulk(words)
  for (let offset = 0; offset < relations.length; offset += INSERT_CHUNK) {
    const chunk = relations.slice(offset, offset + INSERT_CHUNK)
    await pool.query(
      `INSERT INTO word_relations (word_id, related_word_id, relation_type, score, source)
       VALUES ?
       ON DUPLICATE KEY UPDATE score = VALUES(score)`,
      [chunk.map((rel) => [rel.word_id, rel.related_word_id, rel.relation_type, rel.score, rel.source])]
    )
  }
  return relations.length
}

/**
 * 导入全部词书。
 * @param {{refresh?:boolean, inspect?:boolean, only?:string|null, logger?:Console}} options
 */
export async function importWordlists(options = {}) {
  const { refresh = false, inspect = false, only = null, logger = console } = options

  if (!inspect) await runMigrations({ logger })

  const { books, frequencyRanks, frequencyOrigin } = await loadAllBooks({ refresh, only, logger })
  const dictionary = buildDictionary(books)
  const enrichment = enrichEntries(books, dictionary)

  logger.log(
    `[import] 总词典含 ${dictionary.size} 词；补全释义 ${enrichment.filled} 条，` +
      `升级单字释义（如 部,司,局,处 → 部门）${enrichment.upgraded} 条` +
      (enrichment.dropped ? `，丢弃无释义词条 ${enrichment.dropped} 条` : '')
  )

  // 丢弃仍然没有释义的词条：没有释义就无法生成选择题
  const report = []
  for (const book of books) {
    const usable = book.entries.filter((entry) => entry.definitions.length > 0)
    const tiers = assignTiers(usable, frequencyRanks)

    report.push({
      ...book,
      entries: usable,
      missingDefinitions: book.entries.length - usable.length,
      ...tiers,
    })
  }

  logger.log('')
  logger.log('词书'.padEnd(12) + '词数'.padStart(7) + '有词频'.padStart(8) + '高频'.padStart(7) + '中频'.padStart(7) + '低频'.padStart(7))
  for (const book of report) {
    const high = book.entries.filter((entry) => entry.freq === 'high').length
    const med = book.entries.filter((entry) => entry.freq === 'med').length
    const low = book.entries.filter((entry) => entry.freq === 'low').length
    logger.log(
      book.source.code.padEnd(14) +
        String(book.entries.length).padStart(5) +
        String(book.withRank).padStart(7) +
        String(high).padStart(7) +
        String(med).padStart(7) +
        String(low).padStart(7) +
        (book.missingDefinitions ? `   （${book.missingDefinitions} 词查不到释义已丢弃）` : '')
    )
  }

  if (inspect) {
    logger.log('')
    logger.log('[import] --inspect 模式：仅解析，未写入数据库')
    return { report, frequencyOrigin, written: false }
  }

  for (const book of report) {
    const bookId = await upsertBook(book.source, book.entries.length)
    await upsertWords(bookId, book.entries)
    const relationCount = await rebuildRelations(bookId, logger)
    await execute('UPDATE wordbooks SET word_count = ? WHERE id = ?', [book.entries.length, bookId])
    logger.log(
      `[import] ${book.source.code} 写入 ${book.entries.length} 词、${relationCount} 条易混词关系`
    )
  }

  return { report, frequencyOrigin, written: true }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isDirectRun) {
  const argv = process.argv.slice(2)
  importWordlists({
    refresh: readFlag(argv, 'refresh'),
    inspect: readFlag(argv, 'inspect'),
    only: readOption(argv, 'book'),
  })
    .then(async (result) => {
      await pool.end()
      if (result.written) {
        const total = result.report.reduce((sum, book) => sum + book.entries.length, 0)
        console.log(`\n[import] 完成，共导入 ${result.report.length} 本词书、${total} 个词条`)
      }
    })
    .catch(async (error) => {
      console.error('[import] 失败：', error.message)
      if (error.stack) console.error(error.stack.split('\n').slice(1, 4).join('\n'))
      await pool.end().catch(() => {})
      process.exitCode = 1
    })
}
