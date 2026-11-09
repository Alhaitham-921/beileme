import { query, queryOne, execute } from '../db/pool.js'
import { getWordById, getRelatedWords } from './wordService.js'
import { diffSpelling, formSimilarity, levenshtein } from './wordRelations.js'
import { parseJson } from '../utils/json.js'
import { WORD_USAGE } from '../../data/wordUsage.js'
import corpus from '../../data/bilingualExamples.json' with { type: 'json' }

const text = (value, max = 320) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const unique = (items, key, max) => [...new Map(items.filter(item => item[key]).map(item => [item[key].toLowerCase(), item])).values()].slice(0, max)
const hasChinese = value => typeof value === 'string' && /\p{Script=Han}/u.test(value)

function pairedUsage(items, key, limit, translations) {
  const byText = new Map()
  for (const item of items) {
    if (!item[key]) continue
    const original = item[key].trim()
    const translation = translations.get(original)
    const entry = hasChinese(item.translation) ? item : translation
      ? { ...item, translation, translationSource: 'ai' }
      : { ...item, translation: '' }
    const normalized = original.toLowerCase()
    if (!byText.has(normalized) || (!byText.get(normalized).translation && entry.translation)) byText.set(normalized, entry)
  }
  return [...byText.values()].sort((a, b) => Number(Boolean(b.translation)) - Number(Boolean(a.translation))).slice(0, limit)
}

const safeLink = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '' } catch { return '' } }

/** Keep only small, attributed examples. External dictionary content is never treated as AI output. */
export function normalizeDictionary(entries, spelling) {
  const examples = [], collocations = []
  if (!Array.isArray(entries)) return { examples, collocations }
  for (const entry of entries.slice(0, 6)) {
    if (!entry || typeof entry !== 'object') continue
    if (String(entry.word || '').toLowerCase() !== spelling.toLowerCase()) continue
    const license = { name: text(entry.license?.name, 80), url: safeLink(entry.license?.url) }
    // Do not redistribute unlicensed dictionary responses.
    if (!license.name || !license.url) continue
    const sourceUrl = (Array.isArray(entry.sourceUrls) ? entry.sourceUrls : []).map(safeLink).find(Boolean) || ''
    for (const meaning of (Array.isArray(entry.meanings) ? entry.meanings : []).slice(0, 10)) {
      for (const definition of (Array.isArray(meaning?.definitions) ? meaning.definitions : []).slice(0, 15)) {
        if (!definition) continue
        const sentence = text(definition.example)
        if (sentence && sentence.length >= 8 && sentence.length <= 300) {
          // Dictionaries sometimes supply a noun phrase rather than a full sentence.
          // Preserve it as an attributed usage fragment, never advertise corpus frequency.
          const fragment = /^[a-z]/.test(sentence) && !/[.!?]/.test(sentence) && sentence.split(/\s+/).length <= 5
          if (fragment) collocations.push({ phrase: sentence, translation: '', sense: text(definition.definition, 200), source: 'dictionary', sourceUrl, license })
          else examples.push({
          text: sentence, translation: '', sense: text(definition.definition, 200),
          pos: text(meaning.partOfSpeech, 32), source: 'dictionary', sourceUrl, license,
          })
        }
      }
    }
  }
  return { examples: unique(examples, 'text', 4), collocations: unique(collocations, 'phrase', 4) }
}

/** Explicit AI button reuses the existing error-card endpoint and its quota/cost controls. */
export function normalizeAiUsage(card, spelling) {
  if (!card || String(card.spelling || '').toLowerCase() !== spelling.toLowerCase()) return { examples: [], collocations: [] }
  const examples = (Array.isArray(card.distinctions) ? card.distinctions : [])
    .filter(item => String(item?.spelling || '').toLowerCase() === spelling.toLowerCase())
    .map(item => ({ text: text(item.example), translation: text(item.translation), source: 'ai' }))
  const collocations = (Array.isArray(card.collocations) ? card.collocations : [])
    .map(item => ({ phrase: text(item?.phrase, 100), translation: text(item?.translation, 150), source: 'ai' }))
  return { examples: unique(examples, 'text', 2), collocations: unique(collocations, 'phrase', 4) }
}

/** Coalesce free dictionary lookups across books/users, bound concurrency and back off on failures. */
export function createDictionaryLookup({ fetchImpl = fetch, readCache, writeCache, now = Date.now } = {}) {
  const pending = new Map(), failures = new Map()
  let busy = 0
  return async function lookup(spelling) {
    const key = String(spelling).trim().toLowerCase()
    if (!/^[a-z][a-z '-]{0,79}$/.test(key)) return { examples: [] }
    if (pending.has(key)) return pending.get(key)
    const work = (async () => {
      const cached = await readCache(key)
      if (cached) return { ...cached, cached: true }
      if ((failures.get(key) || 0) > now() || busy >= 4) return { examples: [], unavailable: true }
      busy++
      try {
        const response = await fetchImpl('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(key), {
          signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' },
        })
        if (response.status !== 404 && !response.ok) throw new Error('Dictionary unavailable')
        const data = response.status === 404 ? { examples: [] } : normalizeDictionary(await response.json(), key)
        await writeCache(key, data, (data.examples.length || data.collocations?.length) ? 30 : 7)
        failures.delete(key)
        return data
      } catch {
        for (const [word, until] of failures) if (until <= now()) failures.delete(word)
        if (failures.size < 500) failures.set(key, now() + 30000)
        return { examples: [], unavailable: true }
      } finally { busy-- }
    })()
    pending.set(key, work)
    try { return await work } finally { pending.delete(key) }
  }
}
const lookupDictionary = createDictionaryLookup({
  readCache: async spelling => {
    const row = await queryOne('SELECT payload FROM word_learning_dictionary_cache WHERE spelling=? AND expires_at > UTC_TIMESTAMP()', [spelling])
    return row ? parseJson(row.payload, null) : null
  },
  writeCache: async (spelling, payload, days) => execute(
    `INSERT INTO word_learning_dictionary_cache (spelling,payload,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? DAY))
     ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)`, [spelling, JSON.stringify(payload), days]),
})

export async function savedAiUsage(userId, word) {
  // Account-scoped: never expose another user's generated materials.
  const rows = await query(`SELECT meta FROM generated_contents WHERE user_id=? AND type='error_card'
    AND JSON_CONTAINS(target_words, ?) ORDER BY id DESC LIMIT 8`, [userId, JSON.stringify(word.id)])
  const examples = [], collocations = []
  const translations = new Map()
  for (const row of rows) {
    const meta = parseJson(row.meta, {})
    const cards = Array.isArray(meta?.cards) ? meta.cards : []
    const entry = cards.find(card => String(card?.spelling || '').toLowerCase() === word.spelling.toLowerCase())
    if (!entry) continue
    const current = normalizeAiUsage(entry, word.spelling)
    examples.push(...current.examples)
    collocations.push(...current.collocations)
    for (const item of Array.isArray(entry.usageTranslations) ? entry.usageTranslations : []) {
      const original = text(item?.text)
      if (original && hasChinese(item?.translation) && !translations.has(original)) translations.set(original, text(item.translation))
    }
  }
  return { examples, collocations, translations }
}


export function bilingualExamplesFor(word) {
  const spelling = word.spelling.toLowerCase()
  const entries = Object.hasOwn(corpus.words, spelling) ? corpus.words[spelling] : []
  return entries.filter(([, , , , gloss]) => word.definitions.some(definition => definition.includes(gloss)))
    .map(([text, translation, enId, zhId]) => ({
      text, translation, source: 'tatoeba', sourceUrl: 'https://tatoeba.org/en/sentences/show/' + enId,
      translationUrl: 'https://tatoeba.org/en/sentences/show/' + zhId,
      license: { name: 'CC BY 2.0 FR', url: corpus.license },
    }))
}

async function extraFormWords(word) {
  const spelling = word.spelling.toLowerCase()
  if (!/^[a-z]{4,32}$/.test(spelling)) return []
  // The spelling index gives a small cross-book candidate set. Distance and a score
  // floor prevent unrelated words or duplicate spellings from filling the card.
  const rows = await query(`SELECT id, spelling, definitions
    FROM words WHERE spelling_norm LIKE ? AND spelling_norm<>?
      AND CHAR_LENGTH(spelling_norm) BETWEEN ? AND ?
    ORDER BY spelling_norm LIMIT 400`, [spelling.slice(0, 2) + '%', spelling, spelling.length - 2, spelling.length + 2])
  const candidates = new Map()
  for (const row of rows) {
    const other = row.spelling.toLowerCase()
    if (candidates.has(other) || levenshtein(spelling, other) > 2) continue
    const score = formSimilarity(spelling, other)
    const definitions = parseJson(row.definitions, [])
    if (score < 0.72 || !definitions.some(hasChinese)) continue
    candidates.set(other, { wordId: Number(row.id), spelling: row.spelling, definitions, relationType: 'form', score })
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 2)
}

export async function getWordLearningCard(userId, wordId, { dictionaryLookup = lookupDictionary, localOnly = false } = {}) {
  const word = await getWordById(wordId)
  const spelling = word.spelling.toLowerCase()
  const local = Object.hasOwn(WORD_USAGE, spelling) ? WORD_USAGE[spelling] : { examples: [], collocations: [] }
  const [related, saved] = await Promise.all([getRelatedWords(wordId, { limit: 16 }), savedAiUsage(userId, word)])
  const examples = [
    ...local.examples.map(item => ({ ...item, source: 'local' })),
    ...bilingualExamplesFor(word),
    ...(word.examples || []).filter(item => typeof item === 'string').map(example => ({ text: example, translation: '', source: 'wordbook' })),
    ...saved.examples,
  ]
  const collocations = [...local.collocations.map(item => ({ ...item, source: 'local' })), ...saved.collocations]
  const needsDictionary = !examples.length || !collocations.length
  const remote = !localOnly && needsDictionary ? await dictionaryLookup(spelling) : { examples: [] }
  const choices = related.some(item => item.relationType === 'form') ? related : [...related, ...await extraFormWords(word)]
  const contrasts = ['form', 'meaning'].flatMap(type => choices.filter(item => item.relationType === type).slice(0, 2))
    .map(item => ({ ...item, diff: diffSpelling(word.spelling, item.spelling) }))
  return {
    wordId: word.id, spelling: word.spelling,
    examples: pairedUsage([...examples, ...remote.examples], 'text', 3, saved.translations),
    collocations: pairedUsage([...collocations, ...(remote.collocations || [])], 'phrase', 4, saved.translations),
    contrasts, needsDictionary, dictionaryUnavailable: Boolean(remote.unavailable),
  }
}
