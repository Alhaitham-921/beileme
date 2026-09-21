/**
 * 形近词 / 近义词判定（PRD 4.2.3）
 *
 * - 形近词：编辑距离（Levenshtein）归一化得分，同时奖励共同前缀（词根词缀线索）
 * - 近义词：中文释义的字符 bigram + 词条重叠，近似语义相似度
 *
 * 纯本地算法，不消耗 AI 额度；后续可叠加 AI 语义相似度做二次校准。
 */

/** 经典编辑距离，滚动数组实现，空间 O(min(m,n)) */
export function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = new Array(b.length + 1)

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = curr.slice()
  }
  return prev[b.length]
}

/** 共同前缀长度 */
export function commonPrefixLength(a, b) {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i += 1
  return i
}

/**
 * 词形相似度 0-1。
 * 编辑距离占比为主，共同前缀超过 3 个字母时给少量加成（形近且同词根，最易混）。
 */
export function formSimilarity(spellingA, spellingB) {
  const a = String(spellingA || '').toLowerCase()
  const b = String(spellingB || '').toLowerCase()
  if (!a || !b) return 0
  if (a === b) return 1

  const maxLen = Math.max(a.length, b.length)
  const base = 1 - levenshtein(a, b) / maxLen
  const prefix = commonPrefixLength(a, b)
  const bonus = prefix >= 3 ? Math.min(0.1, (prefix - 2) * 0.03) : 0
  return Math.max(0, Math.min(1, base + bonus))
}

/** 把中文释义拆成字符 bigram 集合，短词（单字）保留原字符 */
function bigrams(text) {
  const clean = String(text || '').replace(/[\s，,；;、。.（）()]/g, '')
  const out = new Set()
  if (clean.length <= 1) {
    if (clean) out.add(clean)
    return out
  }
  for (let i = 0; i < clean.length - 1; i += 1) out.add(clean.slice(i, i + 2))
  return out
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0
  let intersection = 0
  for (const item of setA) if (setB.has(item)) intersection += 1
  return intersection / (setA.size + setB.size - intersection)
}

/**
 * 语义相似度 0-1：词条完全重叠比例 与 bigram 重叠比例的加权。
 * 完全重叠权重更高，因为「同义」通常表现为释义词条直接复用。
 */
export function meaningSimilarity(definitionsA = [], definitionsB = []) {
  const listA = (Array.isArray(definitionsA) ? definitionsA : []).map((d) => String(d).trim()).filter(Boolean)
  const listB = (Array.isArray(definitionsB) ? definitionsB : []).map((d) => String(d).trim()).filter(Boolean)
  if (!listA.length || !listB.length) return 0

  const setA = new Set(listA)
  const setB = new Set(listB)
  const exact = jaccard(setA, setB)

  const gramsA = bigrams(listA.join(''))
  const gramsB = bigrams(listB.join(''))
  const gramScore = jaccard(gramsA, gramsB)

  return Math.max(0, Math.min(1, exact * 0.65 + gramScore * 0.35))
}

/**
 * 为一批单词计算形近 / 近义关系。
 *
 * 注意 perTypeLimit 是「每个词、每种关系类型」的上限，而不是每个词的总上限：
 * 同一个词既可能有形近易混对象，也可能有近义易混对象，两类都应保留。
 *
 * @param {Array<{id:number|string, spelling:string, definitions:string[]}>} words
 * @param {{ formThreshold?:number, meaningThreshold?:number, perTypeLimit?:number }} options
 * @returns {Array<{word_id:any, related_word_id:any, relation_type:'form'|'meaning', score:number, source:'computed'}>}
 */
export function buildRelations(words, options = {}) {
  // 阈值来自内置词库的实测分布：真实近义对得分 ≥0.267，噪声均 ≤0.05，0.2 落在中间的干净间隙
  const { formThreshold = 0.6, meaningThreshold = 0.2, perTypeLimit = 6 } = options
  const list = Array.isArray(words) ? words : []
  const collected = new Map() // `${wordId}|${type}` -> 候选数组

  const push = (wordId, candidate) => {
    const key = `${wordId}|${candidate.relation_type}`
    if (!collected.has(key)) collected.set(key, [])
    collected.get(key).push(candidate)
  }

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]
      const b = list[j]

      const form = formSimilarity(a.spelling, b.spelling)
      if (form >= formThreshold) {
        push(a.id, { word_id: a.id, related_word_id: b.id, relation_type: 'form', score: round3(form), source: 'computed' })
        push(b.id, { word_id: b.id, related_word_id: a.id, relation_type: 'form', score: round3(form), source: 'computed' })
      }

      const meaning = meaningSimilarity(a.definitions, b.definitions)
      if (meaning >= meaningThreshold) {
        push(a.id, { word_id: a.id, related_word_id: b.id, relation_type: 'meaning', score: round3(meaning), source: 'computed' })
        push(b.id, { word_id: b.id, related_word_id: a.id, relation_type: 'meaning', score: round3(meaning), source: 'computed' })
      }
    }
  }

  const output = []
  for (const candidates of collected.values()) {
    candidates.sort((x, y) => y.score - x.score)
    output.push(...candidates.slice(0, perTypeLimit))
  }
  return output
}

/** 关系计算的默认阈值。两套实现共用，避免口径漂移。 */
export const RELATION_THRESHOLDS = {
  /** 真实易混对的形近得分普遍 ≥0.6（adapt/adopt 为 0.8） */
  form: 0.6,
  /** 实测分布：真实近义对 ≥0.267，噪声 ≤0.05，0.2 落在中间的干净间隙 */
  meaning: 0.2,
  perTypeLimit: 6,
}

/**
 * 大批量词库的关系计算（数千词规模）。
 *
 * 为什么不能直接用上面的 buildRelations：那是 O(n²) 的全量两两比较，
 * 6000 个词会产生约 1800 万次编辑距离计算，导入耗时无法接受。
 *
 * 这里用两个索引把候选集压下来，且保证「不漏掉真正相似的词对」：
 *
 *  1. 形近：按「首字母分组 + 组内按长度排序后滑窗」比较。
 *     编辑距离 ≤ d 必然满足长度差 ≤ d，所以长度窗取 4 已经覆盖所有得分 ≥0.6、
 *     且长度 ≥10 的组合（长度更短时，距离超过 4 就达不到 0.6 了）。
 *     元音开头的词合并成一组，因为 across/aeross、affect/effect、accept/except
 *     这类「元音互换」正是最典型的形近混淆，按首字母硬分会整对漏掉。
 *
 *  2. 近义：用释义字符 bigram 建倒排索引。
 *     任何 bigram 重叠非零的词对必然共享至少一个 bigram，因此这个索引是完备的；
 *     只对超大桶（如「的」这种常见组合）做截断以免退化。
 *
 * @param {Array<{id:any, spelling:string, definitions:string[]}>} words
 * @param {object} [options]
 * @returns {Array<{word_id:any, related_word_id:any, relation_type:'form'|'meaning', score:number, source:'computed'}>}
 */
export function buildRelationsBulk(words, options = {}) {
  const {
    formThreshold = RELATION_THRESHOLDS.form,
    meaningThreshold = RELATION_THRESHOLDS.meaning,
    perTypeLimit = RELATION_THRESHOLDS.perTypeLimit,
    lengthWindow = 4,
    maxBigramBucket = 300,
  } = options

  const list = (Array.isArray(words) ? words : []).filter((word) => word && word.spelling)
  if (list.length < 2) return []

  /** key `${index}|${type}` -> 候选数组（用下标，最后再映射回 word_id） */
  const collected = new Map()
  const addCandidate = (index, relatedIndex, relationType, score) => {
    const key = `${index}|${relationType}`
    if (!collected.has(key)) collected.set(key, [])
    collected.get(key).push({ relatedIndex, score })
  }
  const recordPair = (i, j, relationType, score) => {
    const value = round3(score)
    addCandidate(i, j, relationType, value)
    addCandidate(j, i, relationType, value)
  }

  // ── 形近：首字母（元音合并）分组 + 长度滑窗 ──
  const formGroups = new Map()
  list.forEach((word, index) => {
    const spelling = word.spelling.toLowerCase()
    const groupKey = /^[aeiou]/.test(spelling) ? '*' : spelling[0]
    if (!formGroups.has(groupKey)) formGroups.set(groupKey, [])
    formGroups.get(groupKey).push(index)
  })

  for (const group of formGroups.values()) {
    // 按长度排序后，一旦长度差超出窗口即可跳出内层循环
    group.sort((a, b) => list[a].spelling.length - list[b].spelling.length)
    for (let a = 0; a < group.length; a += 1) {
      const wordA = list[group[a]]
      for (let b = a + 1; b < group.length; b += 1) {
        const wordB = list[group[b]]
        if (wordB.spelling.length - wordA.spelling.length > lengthWindow) break
        const score = formSimilarity(wordA.spelling, wordB.spelling)
        if (score >= formThreshold) recordPair(group[a], group[b], 'form', score)
      }
    }
  }

  // ── 近义：释义 bigram 倒排索引 ──
  const bigramIndex = new Map()
  list.forEach((word, index) => {
    const definitions = Array.isArray(word.definitions) ? word.definitions : []
    for (const definition of definitions) {
      for (const gram of bigrams(definition)) {
        if (!bigramIndex.has(gram)) bigramIndex.set(gram, [])
        bigramIndex.get(gram).push(index)
      }
    }
  })

  const compared = new Set()
  for (const bucket of bigramIndex.values()) {
    if (bucket.length < 2 || bucket.length > maxBigramBucket) continue
    for (let a = 0; a < bucket.length; a += 1) {
      for (let b = a + 1; b < bucket.length; b += 1) {
        const i = bucket[a]
        const j = bucket[b]
        // 同一个词会因为多个释义共享 bigram 而在桶里出现多次，
        // 不排除自身就会生成「play 与 play 相似度 1.0」这种自比较关系。
        if (i === j) continue

        const pairKey = i < j ? `${i}|${j}` : `${j}|${i}`
        if (compared.has(pairKey)) continue
        compared.add(pairKey)

        const score = meaningSimilarity(list[i].definitions, list[j].definitions)
        if (score >= meaningThreshold) recordPair(i, j, 'meaning', score)
      }
    }
  }

  // ── 每个词、每种关系各取前 N，再映射回 word_id ──
  const output = []
  for (const [key, candidates] of collected) {
    const [indexRaw, relationType] = key.split('|')
    const index = Number(indexRaw)
    candidates.sort((x, y) => y.score - x.score)

    for (const candidate of candidates.slice(0, perTypeLimit)) {
      // 双保险：自比较关系对学习毫无意义，且会渲染成空差异的对比卡片
      if (candidate.relatedIndex === index) continue
      output.push({
        word_id: list[index].id,
        related_word_id: list[candidate.relatedIndex].id,
        relation_type: relationType,
        score: candidate.score,
        source: 'computed',
      })
    }
  }
  return output
}

function round3(value) {
  return Math.round(value * 1000) / 1000
}

/**
 * 拆出两个拼写的「公共词缀 + 差异段」，供对比记忆卡片做词形差异高亮
 * （PRD 4.2.3：展示两个词的词形差异高亮）。
 *
 * @returns {{ prefix:string, suffix:string, aMiddle:string, bMiddle:string }}
 */
export function diffSpelling(spellingA, spellingB) {
  const a = String(spellingA || '')
  const b = String(spellingB || '')

  let start = 0
  const limit = Math.min(a.length, b.length)
  while (start < limit && a[start] === b[start]) start += 1

  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }

  return {
    prefix: a.slice(0, start),
    suffix: a.slice(endA),
    aMiddle: a.slice(start, endA),
    bMiddle: b.slice(start, endB),
  }
}

export default {
  levenshtein,
  formSimilarity,
  meaningSimilarity,
  buildRelations,
  buildRelationsBulk,
  RELATION_THRESHOLDS,
  diffSpelling,
}
