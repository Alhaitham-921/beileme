import { randomInt } from 'node:crypto'

export function shuffled(items) {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// 保留已答和当前题，仅保存每层最多 40 个候选，避免每题重写整本词书。
export function compactPool(state) {
  const keep = new Set([...state.answers.map(a => a.wordId), state.current?.wordId])
  state.pool = [1, 2, 3, 4, 5].flatMap(band => {
    const words = state.pool.filter(w => w.band === band)
    const retained = words.filter(w => keep.has(w.id))
    return [...retained, ...words.filter(w => !keep.has(w.id)).slice(0, Math.max(0, 40 - retained.length))]
  })
}

export function nextQuestion(state) {
  if (state.answers.length >= state.total) return null
  const counts = [1, 2, 3, 4, 5].map(b => state.answers.filter(a => a.band === b).length)
  // 每层至少四题，剩余题目优先落在最近作答所指示的难度。
  const available = state.pool.filter(w => !state.answers.some(a => a.wordId === w.id))
  const bands = [...new Set(available.map(w => w.band))]
  const underSampled = bands.filter(b => counts[b - 1] < Math.min(4, state.pool.filter(w => w.band === b).length))
  const candidates = underSampled.length ? underSampled : bands
  const band = candidates.sort((a, b) => Math.abs(a - state.band) - Math.abs(b - state.band))[0]
  const word = shuffled(available.filter(w => w.band === band))[0]
  if (!word) return null
  const distractors = shuffled([...new Set(state.pool.filter(w => w.id !== word.id && w.definition !== word.definition).map(w => w.definition))]).slice(0, 3)
  const options = shuffled([word.definition, ...distractors])
  return { wordId: word.id, band, spelling: word.spelling, options, correctIndex: options.indexOf(word.definition) }
}

export function summarize(state) {
  const bands = [1, 2, 3, 4, 5].map(band => {
    const items = state.answers.filter(a => a.band === band)
    const correct = items.filter(a => a.correct).length
    const rate = items.length ? correct / items.length : null
    // 四选一机会水平校正；“不认识”也计为未掌握。
    const mastery = rate === null ? null : Math.max(0, (rate - 0.25) / 0.75)
    return { band, tested: items.length, correct, mastery, population: state.populations[band] || 0 }
  })
  return { bookName: state.bookName, estimatedKnown: Math.round(bands.reduce((n, b) => n + (b.mastery || 0) * b.population, 0)), bands, total: state.answers.length,
    scope: '当前词书掌握量估算，非总词汇量或口语等级；小样本结果仅供安排学习参考。', methodVersion: 'book-relative-v1' }
}
