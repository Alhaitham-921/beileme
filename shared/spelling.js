export const SPELLING_LABELS = { independent: '首次无错拼对', corrected: '纠正后拼对', assisted: '查看答案后完成', pending: '仍待巩固' }
export const normalizeSpelling = text => String(text ?? '').normalize('NFKC').replace(/[‘’]/g, "'").toLowerCase()
export const matchesSpelling = (text, target) => normalizeSpelling(text).trim() === normalizeSpelling(target).trim()

// Input events are also used by mobile keyboards, paste, and IME composition.
// Once a wrong character appears, only deletion can unlock the prefix again.
export function spellingInput(previous, next, target) {
  const old = normalizeSpelling(previous), value = normalizeSpelling(next), expected = normalizeSpelling(target)
  const oldWrong = [...old].some((letter, i) => letter !== [...expected][i])
  if (oldWrong && value.length >= old.length && value !== old) return { value: previous, errors: 0, blocked: true }
  let errors = 0
  const chars = [...value], oldChars = [...old], answer = [...expected]
  chars.forEach((letter, i) => { if (letter !== answer[i] && (letter !== oldChars[i] || i >= oldChars.length)) errors++ })
  return { value: next, errors, blocked: false }
}
export function spellingLetters(input, target) {
  const typed = [...normalizeSpelling(input)], expected = [...normalizeSpelling(target)]
  return Array.from({ length: Math.max(typed.length, expected.length) }, (_, i) => ({
    text: typed[i] ?? (expected[i] === ' ' ? ' ' : '_'),
    status: typed[i] === undefined ? 'waiting' : typed[i] === expected[i] ? 'correct' : 'wrong',
    cursor: i === typed.length,
  }))
}
export function newSpellingState(words) {
  return { words, group: 0, phase: 'first', queue: words.slice(0, 10).map(w => w.id), index: 0,
    stage: 'typing', helped: false, results: {}, streak: 0, bestStreak: 0, receipts: [] }
}
export const currentSpellingWord = state => state.words.find(w => w.id === state.queue[state.index])
export function spellingContext(example, spelling) {
  if (typeof example !== 'string' || !example.trim() || !spelling?.trim()) return ''
  const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'giu')
  const blank = example.replace(pattern, '___')
  return blank === example ? '' : blank
}
function resetQuestion(state) { state.helped = false; state.stage = 'typing'; state.feedback = null }
export function applySpellingAction(state, action) {
  const word = currentSpellingWord(state)
  if (action.action === 'next') {
    if (state.stage === 'group-end') {
      state.group++; state.phase = 'first'; state.queue = state.words.slice(state.group * 10, (state.group + 1) * 10).map(w => w.id); state.index = 0
      resetQuestion(state); return
    }
    if (state.stage !== 'feedback') throw new Error('请先完成当前词')
    if (++state.index < state.queue.length) { resetQuestion(state); return }
    if (state.phase === 'first') {
      const retry = state.queue.filter(id => state.results[id].first.result !== 'independent')
      if (retry.length) { state.queue = retry; state.index = 0; state.phase = 'retry'; resetQuestion(state); return }
    }
    state.stage = (state.group + 1) * 10 < state.words.length ? 'group-end' : 'finished'
    state.feedback = null; return
  }
  if (state.stage !== 'typing' || !word) throw new Error('当前词已完成，请继续练习')
  if (action.wordId !== word.id) throw new Error('题目已更新，请重新读取进度')
  if (action.action === 'reveal') { state.helped = true; return }
  if (action.action !== 'skip' && !matchesSpelling(action.answer, word.spelling)) throw new Error('拼写还未正确，请修正后继续')
  const result = action.action === 'skip' ? 'pending' : state.helped ? 'assisted' : action.errorCount > 0 ? 'corrected' : 'independent'
  const entry = { result, errorCount: action.errorCount || 0, durationMs: action.durationMs || 0 }
  const record = state.results[word.id] || (state.results[word.id] = {})
  record[state.phase === 'first' ? 'first' : 'retry'] = entry
  if (state.phase === 'first') {
    state.streak = result === 'independent' ? state.streak + 1 : 0
    state.bestStreak = Math.max(state.bestStreak, state.streak)
  }
  state.feedback = { ...word, ...entry, phase: state.phase }
  state.stage = 'feedback'
}
export function spellingPresentation(row) {
  const state = typeof row.state === 'string' ? JSON.parse(row.state) : row.state
  const word = currentSpellingWord(state)
  const results = state.words.filter(w => state.results[w.id]?.first).map(w => ({ ...w, ...state.results[w.id] }))
  return { id: Number(row.id), revision: Number(row.revision), stage: state.stage, group: state.group + 1,
    groupCount: Math.ceil(state.words.length / 10), total: state.words.length, completed: results.length,
    phase: state.phase, index: Math.min(state.index + 1, state.queue.length), queueLength: state.queue.length,
    helped: state.helped, streak: state.streak, bestStreak: state.bestStreak,
    independentCount: results.filter(r => r.first.result === 'independent').length,
    // Instant per-letter training intentionally exposes this word, never the future queue.
    question: state.stage === 'typing' && word ? { id: word.id, spelling: word.spelling, meaning: word.meaning, pos: word.pos,
      blank: state.phase === 'retry' ? spellingContext(word.example, word.spelling) : '' } : null,
    feedback: state.stage === 'feedback' ? state.feedback : null, results }
}
