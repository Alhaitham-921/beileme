/**
 * 开源词表解析器。
 *
 * 处理的三种排版（都来自真实仓库，不是假想格式）：
 *
 *  A. 带音标的词条行
 *     `abandon [əˈbændən] vt.丢弃；放弃，抛弃`
 *     `about [ˈəbaut] prep.关于…周围`
 *     `abandon [əˈbændən] v. 1. 抛弃，放弃 2. 离弃(家园、船只、飞机等)`
 *     `abandon           [ə'bændən]            vt.  放弃,沉溺n.  放任`   ← 多空格对齐，词性会夹在释义中间
 *
 *  B. 裸词表（每行一个单词，无释义）
 *     `abandon`
 *
 *  C. 制表符分隔
 *     `although\tconj. 尽管；虽然；但是；然而`
 *
 * 这些文件的排版细节相当杂乱（音标可能缺失、词性可能写在释义中间、释义带 1./2. 编号、
 * 括号里塞语法说明），因此解析策略是「尽量挖出信息，挖不到就留空」，而不是严格要求匹配。
 * 解析失败的条目统一丢弃并计数上报，不会把脏数据写进数据库。
 */

/** 词性标记。按长度降序排列，避免 `adj.` 被 `a.` 或 `ad.` 抢先匹配。 */
const POS_TOKENS = [
  'interj', 'abbr', 'prep', 'conj', 'pron', 'adj', 'adv', 'aux', 'num', 'art',
  'vt', 'vi', 'pl', 'int', 'n', 'v', 'a', 'ad',
]

/**
 * 词性标记匹配。
 * 前缀用否定回溯 `(?<![A-Za-z])` 而不是 `\b`：
 * `\b` 不认得汉字，反过来正好让我们能匹配 `沉溺n. 放任` 这种夹在中文后面的词性。
 */
const POS_PATTERN = new RegExp(`(?<![A-Za-z])(${POS_TOKENS.join('|')})\\.`, 'gi')

/** 词性归一化：把 `a.`/`ad.` 这类缩写统一成更易读的形式 */
const POS_CANONICAL = {
  a: 'adj',
  ad: 'adv',
  int: 'interj',
}

const CJK = /[\u4e00-\u9fa5]/

/** 单个词的释义条数上限：作为选择题选项，过多会让干扰项过长 */
const MAX_DEFINITIONS = 4

/** 只保留字母、连字符、撇号与点（词条可能含 `ice-cream`、`don't`、`a.m.`） */
const SPELLING_PATTERN = /^([A-Za-z][A-Za-z'’\-]*(?:\.[A-Za-z]+)*\.?)/

/**
 * 英文语法注释。这类说明在中文释义里没有价值，作为选择题选项更是噪音，
 * 例如 `a\tindefinite article. 一〔用于…〕` 里的 `indefinite article.`。
 */
const GRAMMAR_ANNOTATION =
  /\b(?:indefinite|definite)\s+article\.|\b(?:modal|auxiliary|phrasal)\s+verb\.|\bplural\s+(?:noun|verb|form)\.|\bsingular\s+(?:noun|verb)\./gi

/** 判定为「表头/分段标题」而非词条的行 */
function isHeaderLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return true
  // 单个字母：CET4 / 中考词表用 A、B、C 分段
  if (/^[A-Za-z]$/.test(trimmed)) return true
  // 标题行：大学英语四级大纲单词表 / (共 4615 词)
  if (/词汇表|单词表|大纲|共\s*\d+\s*词|^\s*[（(]/.test(trimmed)) return true
  // 纯符号行（如 `？？？`）是脏数据而不是表头，交给「跳过」统计，不要在这里吞掉
  if (!/[A-Za-z\u4e00-\u9fa5]/.test(trimmed)) return false
  // 全是非中日韩说明文字且没有音标/词性，基本是注释
  if (!CJK.test(trimmed) && !/\[/.test(trimmed) && !/[a-z]\./.test(trimmed) && !/^[A-Za-z]+\s*$/.test(trimmed)) {
    return true
  }
  return false
}

function normalizeSpelling(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function cleanPhonetic(raw) {
  if (!raw) return ''
  // 去掉内部多余空白，统一括号为方括号
  const inner = raw.replace(/^[\[(（]|[\])）]$/g, '').trim().replace(/\s+/g, ' ')
  return inner ? `[${inner}]` : ''
}

/**
 * 提取并移除词性标记，返回归一化后的词性与剩余文本。
 *
 * 词性标记被替换成分隔符而不是空格：像 `boat n. 小船；轮船 v. 划船` 这种写法里，
 * 中间的 `v.` 本身就是一个释义的分界，替换成空格会让「轮船」和「划船」粘成一条释义。
 */
export function extractPos(text) {
  const found = []
  const rest = String(text || '').replace(POS_PATTERN, (_match, token) => {
    found.push(token.toLowerCase())
    return '；'
  })

  const canonical = []
  for (const token of found) {
    const value = POS_CANONICAL[token] || token
    if (!canonical.includes(value)) canonical.push(value)
  }
  // 保持出现顺序即可：来源文件里第一个词性通常就是主词性（如 `v./n.` 先动词）

  return { pos: canonical.join('/'), rest }
}

/**
 * 只在括号外切分。
 *
 * 必须这样做：`离弃(家园、船只、飞机等)` 与 `一(个)；每一(个)` 里的顿号/分号
 * 属于同一个释义内部的列举，按普通 split 会把释义切碎成毫无意义的碎片
 * （实测会出现 `离弃(家园`、`船只` 这种选项）。
 */
function splitOutsideBrackets(text, separators) {
  const opening = '（(【〔['
  const closing = '）)】〕]'
  const parts = []
  let depth = 0
  let current = ''

  for (const char of text) {
    if (opening.includes(char)) depth += 1
    else if (closing.includes(char)) depth = Math.max(0, depth - 1)

    if (depth === 0 && separators.includes(char)) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/**
 * 把释义文本切成「释义数组」。
 * 来源文件里释义用分号/逗号分隔，部分还带 `1. 2. 3.` 编号，需要先归一成同一分隔符。
 */
export function parseDefinitions(text) {
  if (!text) return []

  const normalized = String(text)
    // 去掉语法注释与方括号说明（KyleBing 的词表常带 `[复数 parties]`）
    .replace(GRAMMAR_ANNOTATION, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    // 编号 `1.` `2、` 统一变成分隔符，避免编号被当成释义内容
    .replace(/(?<![A-Za-z0-9])\d+\s*[.、]\s*/g, '；')
    .replace(/[;；]/g, '；')
    // 来源文件里 `为...伴奏` 常被排版成 `为. . . 伴奏`，先规整成统一写法再切分
    .replace(/(?:\.\s*){3,}/g, '...')
    .replace(/[ \t]{2,}/g, ' ')

  return splitOutsideBrackets(normalized, '；，,、/|')
    .map((piece) =>
      piece
        // 兜底：万一仍有词性标记没被 extractPos 摘掉（例如被分隔符隔在中间），这里再摘一次。
        // 仅当后面紧跟汉字时才摘，避免误伤 `a.m.` 这类正常内容。
        .replace(/^[a-z]{1,7}\.\s*(?=[\u4e00-\u9fa5])/i, '')
        // 只修剪空白与标点。刻意不修剪括号：来源里括号是配对的（`一(个)`、`离弃(家园…)`），
        // 一并修剪会把右括号削掉，得到 `一(个` 这种残缺释义。
        .replace(/^[\s.．·・:：]+/, '')
        .replace(/[\s.．·・:：]+$/, '')
        .trim()
    )
    .filter((piece) => piece && CJK.test(piece))
    // 过长的多半是整句解释，作为选项不合适
    .filter((piece) => piece.length <= 24)
    .filter((piece, index, list) => list.indexOf(piece) === index)
    // 单字释义的过滤必须排在截断之前：
    // `部，司，局，处；部门` 按逗号切出 5 段，若先截断到 4 段就会把唯一的「部门」丢掉，
    // 于是单字全部留存，正确选项反而显示成「部」。
    .filter((piece, _index, list) => keepShortDefinitions(piece, list))
    .slice(0, MAX_DEFINITIONS)
}

/**
 * 过滤掉单字释义。
 *
 * 来源里 `部，局，处，科；部门` 这种列举，按逗号切开后会得到「部」「局」「处」「科」
 * 四条单字释义，作为选择题选项毫无意义（正确的那个反而显示成「部」）。
 * 但只要还有更完整的释义可选，就把单字的丢掉；若整条词就只有单字释义则保留，
 * 否则这个词会因为「没有释义」而被整个丢弃。
 */
function keepShortDefinitions(piece, list) {
  if (piece.length > 1) return true
  return !list.some((other) => other.length > 1)
}

/**
 * 解析格式 A（带音标）。
 * @returns {{spelling:string, phonetic:string, pos:string, definitions:string[]}|null}
 */
export function parseEntryLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed || isHeaderLine(trimmed)) return null

  const spellingMatch = SPELLING_PATTERN.exec(trimmed)
  if (!spellingMatch) return null

  const spelling = normalizeSpelling(spellingMatch[1])
  // 过滤掉被误当成单词的说明性短语
  if (!spelling || spelling.length > 32) return null

  let rest = trimmed.slice(spellingMatch[0].length)

  // 跳过词形变体，例如 `a (an) [ə, eɪ(ən)] art.一（个、件……）`
  rest = rest.replace(/^\s*[（(][^)）]*[)）]/, '')

  // 提取音标（第一个方括号块）
  let phonetic = ''
  const phoneticMatch = /\[([^\]]*)\]/.exec(rest)
  if (phoneticMatch) {
    phonetic = cleanPhonetic(phoneticMatch[0])
    rest = rest.slice(0, phoneticMatch.index) + rest.slice(phoneticMatch.index + phoneticMatch[0].length)
  }

  const { pos, rest: afterPos } = extractPos(rest)
  const definitions = parseDefinitions(afterPos)

  if (!definitions.length) return null
  return { spelling, phonetic, pos, definitions }
}

/** 解析格式 C（制表符分隔） */
export function parseTabLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed || !trimmed.includes('\t')) return null

  // 拼写可能在第一个制表符前，也可能因为对齐而多出空格
  const [head, ...tailParts] = trimmed.split('\t')
  const spelling = normalizeSpelling(head)
  if (!spelling || spelling.length > 32) return null
  // 允许 a.m. 这类缩略词，但排除带数字或中文的杂项行
  if (!/^[A-Za-z][A-Za-z'’\-]*(?:\.[A-Za-z]+)*\.?$/.test(spelling)) return null

  const { pos, rest } = extractPos(tailParts.join(' '))
  const definitions = parseDefinitions(rest)
  if (!definitions.length) return null

  return { spelling, phonetic: '', pos, definitions }
}

/** 解析格式 B（裸词表），只取单词 */
export function parseBareLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return null
  const match = /^([A-Za-z][A-Za-z'’\-]*)$/.exec(trimmed)
  if (!match) return null
  return { spelling: normalizeSpelling(match[1]), phonetic: '', pos: '', definitions: [] }
}

/** 自动识别排版：制表符占比高即视为格式 C，否则按格式 A 解析（无释义行会自然被丢弃） */
export function detectFormat(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 200)
  if (!lines.length) return 'rich'

  const tabRatio = lines.filter((line) => line.includes('\t')).length / lines.length
  if (tabRatio > 0.8) return 'tab'

  const withDefinitions = lines.filter((line) => CJK.test(line)).length / lines.length
  if (withDefinitions < 0.05) return 'bare'

  return 'rich'
}

/**
 * 合并同一单词的多条词条。
 *
 * 来源词表里同一个词常按词性分行（`miss n. 女士` 与 `miss v. 错过；思念`），
 * 直接去重会丢掉释义，所以这里做并集：释义按出现顺序合并，词性取并集。
 */
function mergeEntry(target, incoming) {
  for (const definition of incoming.definitions) {
    if (target.definitions.includes(definition)) continue
    if (target.definitions.length >= MAX_DEFINITIONS) break
    target.definitions.push(definition)
  }
  if (!target.phonetic && incoming.phonetic) target.phonetic = incoming.phonetic

  const posList = new Set(
    [...target.pos.split('/'), ...incoming.pos.split('/')].map((item) => item.trim()).filter(Boolean)
  )
  target.pos = [...posList].join('/')
}

/**
 * 解析整份词表。
 * @param {string} text 文件内容
 * @param {'rich'|'tab'|'bare'|'auto'} [format]
 * @returns {{entries:Array, skipped:number, merged:number, format:string}}
 */
export function parseWordlist(text, format = 'auto') {
  const resolved = format === 'auto' ? detectFormat(text) : format
  const parser =
    resolved === 'tab' ? parseTabLine : resolved === 'bare' ? parseBareLine : parseEntryLine

  const bySpelling = new Map()
  let skipped = 0
  let merged = 0

  for (const line of String(text || '').split(/\r?\n/)) {
    const parsed = parser(line)
    if (!parsed) {
      // 只统计「真正解析失败」的行。表头与 A/B/C 分段行属于正常内容，
      // 计入跳过数会虚高数据质量指标，掩盖真正需要关注的脏数据。
      if (line.trim() && !isHeaderLine(line)) skipped += 1
      continue
    }

    const existing = bySpelling.get(parsed.spelling)
    if (existing) {
      mergeEntry(existing, parsed)
      merged += 1
      continue
    }
    bySpelling.set(parsed.spelling, parsed)
  }

  return { entries: [...bySpelling.values()], skipped, merged, format: resolved }
}

export default { parseWordlist, parseEntryLine, parseTabLine, parseBareLine, detectFormat, parseDefinitions, extractPos }
