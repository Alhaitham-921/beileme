import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAssessmentBaseline } from '../src/services/assessmentHistory.js'
import { newPlacement, advancePlacement, historicalPlacementQuestions, PLACEMENT_VERSION } from '../src/services/placementService.js'
import { CET4_PLACEMENT } from '../data/cet4Placement.js'

function session(id, correct = false, overrides = {}) {
  const snapshot = { spelling: 'bank', options: ['河岸', '银行', '道路', '桥梁'], correctIndex: 0, band: 0, wordId: 100, dictionaryWordId: 8 }
  return { id, completed_at: `2026-11-${String(id).padStart(2, '0')}T10:00:00Z`, state: {
    bookId: 1, bookName: '测试词书', methodVersion: PLACEMENT_VERSION, questionSetVersion: 'test', form: id % 2 ? 'A' : 'B',
    answers: [{ correct, selectedIndex: correct ? 0 : -1, snapshot, band: 0 }],
    result: { form: 'A', recommended: 'foundation', bands: ['foundation', 'standard', 'challenge'].map(level =>
      ({ level, tested: 8, correct: correct ? 8 : 0, unsure: correct ? 0 : 8 })) }, ...overrides,
  } }
}

test('history compares only compatible books and methods and keeps evidence dimensions separate', () => {
  const current = session(5, true)
  const previous = session(4, false)
  const report = buildAssessmentBaseline({ session: current,
    history: [session(3, false, { bookId: 2 }), session(2, true, { methodVersion: 'other' }), previous,
      session(1, true, { questionSetVersion: 'changed' })],
    learning: { collocations: { total: 4, correct: 1, unknown: 2 }, recall: { total: 3, independent: 0, hinted: 1, weak: 2 } } })
  assert.equal(report.previous.sessionId, 4)
  assert.equal(report.history.usedTests, 1)
  assert.ok(report.comparisons.every(item => item.change === 100))
  assert.equal(report.improvedWords.length, 1)
  assert.equal(report.repeatedWeakWords.length, 0)
  assert.equal(report.learning.collocations.correct, 1)
  assert.equal(report.learning.recall.independent, 0)
  assert.equal(report.estimatedKnown, undefined)
  assert.ok(report.recommendations.some(item => item.id === 'recall'))
})

test('recurring errors match the tested meaning, and old snapshots are not invented', () => {
  const old = session(2)
  const anotherMeaning = session(1)
  anotherMeaning.state.answers[0].snapshot.correctIndex = 1
  const current = session(3)
  const report = buildAssessmentBaseline({ session: current, history: [old, anotherMeaning] })
  assert.equal(report.repeatedWeakWords[0].priorFailures, 1)
  assert.deepEqual(report.repeatedWeakWords[0].sourceSessions, [2])
  const legacy = session(4)
  delete legacy.state.answers[0].snapshot
  const oldReport = buildAssessmentBaseline({ session: legacy, history: [] })
  assert.equal(oldReport.weakWords.length, 0)
  assert.equal(oldReport.comparisons.length, 0)
  assert.ok(oldReport.limitations.some(text => text.includes('旧测试')))
})

test('history questions are capped, exclude core targets and do not affect placement scoring', () => {
  const history = Array.from({ length: 8 }, (_, index) => ({ wordId: 9000 + index, spelling: `historic${index}`,
    band: 0, options: ['正确', '其他', '另外', '错误'], correctIndex: 0, purpose: 'history', historySource: { sessionId: 1 } }))
  history.unshift({ ...history[0], wordId: 9999, spelling: CET4_PLACEMENT.A[0][0][0] })
  const state = newPlacement({ id: 1, name: '测试' }, 'A', CET4_PLACEMENT, history)
  while (state.current) {
    const q = state.current
    const correct = q.purpose === 'history'
    state.answers.push({ correct, selectedIndex: correct ? q.correctIndex : -1, band: q.band, purpose: q.purpose, snapshot: q })
    advancePlacement(state)
  }
  assert.equal(state.result.total, 28)
  assert.equal(state.result.coreTotal, 24)
  assert.equal(state.result.historyRetest.length, 4)
  assert.ok(state.result.bands.every(item => item.correct === 0))
  assert.equal(state.result.recommended, 'foundation')
})

test('retest candidates use the latest known result and never reconstruct synthetic IDs', () => {
  const old = session(1), recent = session(2, true)
  assert.equal(historicalPlacementQuestions([recent, old]).length, 0)
  delete old.state.answers[0].snapshot
  assert.equal(historicalPlacementQuestions([old]).length, 0)
})
