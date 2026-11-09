import { CET4_PLACEMENT } from '../../data/cet4Placement.js'
import { shuffled } from './assessmentEngine.js'
import { query } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { createHash } from 'node:crypto'

export const PLACEMENT_VERSION = 'book-placement-pilot-v1'
export const START_LEVELS = ['foundation', 'standard', 'challenge']
const CORE_PER_BAND = 8

function item(row, band, index) {
  const [spelling, correct, ...rest] = row
  const options = shuffled([correct, ...rest.slice(0, 3)])
  return { wordId: (band + 1) * 100 + index, band, spelling, options,
    context: rest[3] || '', correctIndex: options.indexOf(correct) }
}

const stableRank = value => createHash('sha256').update(value).digest('hex')

function matchedChoices(target, pool) {
  const eligible = pool.filter(candidate => candidate.pos === target.pos && candidate.definition !== target.definition &&
    !candidate.definition.includes(target.definition) && !target.definition.includes(candidate.definition))
  const distance = candidate => Math.abs(candidate.definition.length - target.definition.length) +
    Math.abs(candidate.difficulty - target.difficulty) * 2
  eligible.sort((left, right) => distance(left) - distance(right))
  const distractors = [...new Set(eligible.map(candidate => candidate.definition))].slice(0, 3)
  return distractors.length === 3 ? [target.spelling, target.definition, ...distractors] : null
}

export function buildMatchedForms(rows, bookCode) {
  const bySpelling = new Map()
  for (const row of rows) {
    const spelling = String(row.spelling).trim()
    const key = spelling.toLowerCase()
    const definitions = parseJson(row.definitions, [])
    if (!Array.isArray(definitions)) continue
    const definition = String(definitions[0] || '').trim()
    const difficulty = Number(row.difficulty)
    if (!/^[a-z][a-z'-]*$/i.test(spelling) || !/\p{Script=Han}/u.test(definition) ||
        definition.length > 30 || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5 || bySpelling.has(key)) continue
    const pos = String(row.pos || '').toLowerCase().match(/\b(adj|adv|pron|prep|conj|num|n|v)\b/)?.[0] || ''
    bySpelling.set(key, { spelling, definition, difficulty, pos, priority: stableRank(`${bookCode}:${key}`), singleSense: definitions.length === 1 })
  }
  const pool = [...bySpelling.values()].sort((a, b) => a.priority.localeCompare(b.priority))
  const bins = new Map()
  for (const word of pool) {
    const key = `${word.difficulty}:${word.pos}`
    if (!bins.has(key)) bins.set(key, [])
    bins.get(key).push(word)
  }
  const pairs = [[], [], []]
  for (const bin of bins.values()) {
    bin.sort((a, b) => Number(b.singleSense) - Number(a.singleSense))
    for (let index = 0; index + 1 < bin.length; index += 2) {
      const [left, right] = bin.slice(index, index + 2)
      const band = left.difficulty <= 2 ? 0 : left.difficulty === 3 ? 1 : 2
      pairs[band].push({ left, right, priority: left.priority, singleSense: left.singleSense && right.singleSense })
    }
  }
  const forms = { A: [[], [], []], B: [[], [], []] }
  for (const [band, candidates] of pairs.entries()) {
    candidates.sort((a, b) => Number(b.singleSense) - Number(a.singleSense) || a.priority.localeCompare(b.priority))
    for (const { left, right } of candidates) {
      const a = matchedChoices(left, pool), b = matchedChoices(right, pool)
      if (a && b) {
        forms.A[band].push(a)
        forms.B[band].push(b)
      }
      if (forms.A[band].length === CORE_PER_BAND + 2) break
    }
    if (forms.A[band].length < CORE_PER_BAND + 2) return null
  }
  return forms
}

export async function placementForms(book) {
  if (book.code === 'cet4') return CET4_PLACEMENT
  const rows = await query('SELECT spelling, pos, difficulty, definitions FROM words WHERE wordbook_id=? ORDER BY id', [book.id])
  return buildMatchedForms(rows, book.code)
}

export function newPlacement(book, form, forms) {
  const bands = forms[form].map((rows, band) => rows.map((row, index) => item(row, band, index)))
  const queue = shuffled(bands.flatMap(rows => rows.slice(0, CORE_PER_BAND)))
  return { methodVersion: PLACEMENT_VERSION, form, bookName: book.name, bookId: book.id,
    queue, reserve: bands.map(rows => rows.slice(CORE_PER_BAND)), answers: [], total: queue.length, current: queue[0] }
}

function counts(state) {
  return START_LEVELS.map((level, band) => {
    const rows = state.answers.filter(answer => answer.band === band)
    return { level, tested: rows.length, correct: rows.filter(answer => answer.correct).length,
      unsure: rows.filter(answer => answer.selectedIndex === -1).length }
  })
}

function threshold(band, ratio) { return Math.ceil(band.tested * ratio) }

function boundaryBand(bands) {
  const [foundation, standard, challenge] = bands
  const near = (band, ratio) => Math.abs(band.correct - threshold(band, ratio)) <= 1
  if (near(foundation, 0.75)) return 0
  if (foundation.correct < threshold(foundation, 0.75)) return -1
  if (near(standard, 0.75) || (standard.correct >= threshold(standard, 0.75) && near(challenge, 0.5))) return 1
  return -1
}

export function advancePlacement(state) {
  if (state.answers.length === state.total && state.reserve.length) {
    const bands = counts(state)
    const boundary = boundaryBand(bands)
    if (boundary >= 0) {
      state.queue.push(...shuffled([...state.reserve[boundary], ...state.reserve[boundary + 1]]))
      state.total = state.queue.length
    }
    state.reserve = []
  }
  state.current = state.queue[state.answers.length] || null
  if (state.current) return
  const bands = counts(state)
  const reaches = (band, ratio) => bands[band].correct >= threshold(bands[band], ratio)
  const recommended = !reaches(0, 0.75) ? 'foundation'
    : reaches(1, 0.75) && reaches(2, 0.5) ? 'challenge' : 'standard'
  state.result = { methodVersion: PLACEMENT_VERSION, form: state.form, bookName: state.bookName,
    bookId: state.bookId, recommended, borderline: boundaryBand(bands) >= 0,
    bands, total: state.answers.length }
  delete state.queue
}

export async function trialSuggestion(userId, profile, bookId) {
  const level = profile.studyStartLevel
  if (!START_LEVELS.includes(level) || !profile.studyStartChangedAt) return null
  const rows = await query(`SELECT a.session_id, COUNT(*) AS total, SUM(a.result = 1 AND a.quality >= 4) AS confident
    FROM answer_logs a JOIN study_sessions s ON s.id=a.session_id AND s.user_id=a.user_id
    WHERE a.user_id=? AND a.is_new_word=1 AND s.status='finished' AND s.started_at>=?
      AND JSON_UNQUOTE(JSON_EXTRACT(s.study_options,'$.studyStartLevel'))=?
      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(s.study_options,'$.wordbookId')) AS UNSIGNED)=?
    GROUP BY a.session_id HAVING COUNT(*) >= 5 ORDER BY a.session_id DESC LIMIT 3`,
  [userId, profile.studyStartChangedAt, level, bookId])
  if (rows.length !== 3) return null
  const index = START_LEVELS.indexOf(level)
  if (index < 2 && rows.every(row => Number(row.confident) / Number(row.total) >= 0.85)) {
    return { recommended: START_LEVELS[index + 1], groups: rows.length, reason: '最近三组新词的正常回忆表现稳定，可以试试高一档。' }
  }
  if (index > 0 && rows.every(row => Number(row.confident) / Number(row.total) <= 0.55)) {
    return { recommended: START_LEVELS[index - 1], groups: rows.length, reason: '最近三组新词中，多数需要更多练习，可以试试低一档。' }
  }
  return null
}
