import test from 'node:test'
import assert from 'node:assert/strict'
import { nextQuestion, summarize, compactPool } from '../src/services/assessmentEngine.js'
function fixture() {
  return { pool: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, band: i % 5 + 1, spelling: `word${i}`, definition: `释义${i}` })), populations: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 }, total: 35, band: 3, answers: [], bookName: '测试词书' }
}
test('adaptive sampling covers all bands without repeating words', () => {
  const s = fixture()
  for (let i = 0; i < 35; i++) {
    const q = nextQuestion(s)
    assert.equal(q.options.length, 4)
    assert.equal(new Set(q.options).size, 4)
    assert.ok(!s.answers.some(a => a.wordId === q.wordId))
    s.answers.push({ wordId: q.wordId, band: q.band, correct: true })
    s.band = Math.min(5, q.band + 1)
  }
  assert.equal(nextQuestion(s), null)
  const result = summarize(s)
  assert.ok(result.bands.every(b => b.tested >= 4))
  assert.equal(result.estimatedKnown, 50)
})
test('unknown answers give zero estimate and chance correction is bounded', () => {
  const s = fixture()
  s.answers = s.pool.map(w => ({ wordId: w.id, band: w.band, correct: false }))
  assert.equal(summarize(s).estimatedKnown, 0)
  assert.ok(summarize(s).bands.every(b => b.mastery === 0))
})
test('large pools shrink while preserving population, answers and current question', () => {
  const s = fixture()
  s.pool = Array.from({ length: 10000 }, (_, i) => ({ id: i + 1, band: i % 5 + 1, spelling: `word${i}`, definition: `释义${i}` }))
  s.answers = [{ wordId: 9999, band: 4, correct: true }]
  s.current = { wordId: 9998 }
  const populations = JSON.stringify(s.populations)
  compactPool(s)
  assert.ok(s.pool.length <= 200)
  assert.ok(s.pool.some(w => w.id === 9999))
  assert.ok(s.pool.some(w => w.id === 9998))
  assert.equal(JSON.stringify(s.populations), populations)
  assert.ok(nextQuestion(s))
})
