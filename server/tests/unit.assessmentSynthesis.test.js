import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAssessmentBaseline } from '../src/services/assessmentHistory.js'
import { assessmentConclusions, EXPLANATION_VALIDATION_VERSION, validateAssessmentSelection, validatedSavedExplanation } from '../src/services/assessmentExplanation.js'
import { makeAssessmentExplanationPrompt } from '../src/services/assessmentReportService.js'

const levels = ['foundation', 'standard', 'challenge']
function session(id, scores, day = id) {
  const takenAt = `2026-11-${String(day).padStart(2, '0')}T10:${String(id).padStart(2, '0')}:00.000Z`
  return { id, completed_at: takenAt, state: { bookId: 1, bookName: '测试词书', methodVersion: 'book-placement-pilot-v1',
    questionSetVersion: 'same', form: id % 2 ? 'A' : 'B', answers: [], result: { completedAt: takenAt,
      form: id % 2 ? 'A' : 'B', recommended: scores[0] < 6 ? 'foundation' : scores[1] >= 6 && scores[2] >= 4 ? 'challenge' : 'standard',
      bands: levels.map((level, index) => ({ level, correct: scores[index], tested: 8, unsure: 8 - scores[index] })) } } }
}
function report(scores, learning = {}, day = null) {
  const rows = scores.map((score, index) => session(index + 1, score, day || index + 1))
  return buildAssessmentBaseline({ session: rows.at(-1), history: rows.slice(0, -1).reverse(), learning })
}
const selection = (baseline, actionId = 'recall') => ({
  observations: [{ conclusionId: `synthesis-${baseline.synthesis.decision}` }], nextSteps: [{ actionId }],
})

test('multiple dates form an explicit trend and a supported optional learning-start suggestion', () => {
  const result = report([[3, 1, 0], [6, 6, 4], [8, 8, 8]])
  assert.equal(result.synthesis.testDays, 3)
  assert.equal(result.synthesis.trends[0].status, 'rising')
  assert.equal(result.synthesis.decision, 'supported')
  assert.equal(result.synthesis.recommendedLevel, 'challenge')
  assert.equal(result.synthesis.recentSupport, 2)
  assert.equal(result.recommendations.find(item => item.id === 'study-start').level, 'challenge')
  assert.deepEqual(result.synthesis.series.map(item => item.sessionId), [1, 2, 3])
  assert.ok(result.facts.find(item => item.id === 'trend-foundation').text.includes('3/8 → 6/8 → 8/8'))
})

test('repeating within one day cannot create sustained improvement or consensus', () => {
  const result = report([[0, 0, 0], [4, 4, 4], [8, 8, 8]], {}, 5)
  assert.equal(result.synthesis.series.length, 3)
  assert.equal(result.synthesis.daily.length, 1)
  assert.equal(result.synthesis.daily[0].sessionId, 3)
  assert.equal(result.synthesis.decision, 'insufficient')
  assert.equal(result.synthesis.recommendedLevel, null)
  assert.ok(result.synthesis.trends.every(item => item.status === 'insufficient'))
  assert.ok(!result.recommendations.some(item => item.id === 'study-start'))
})

test('a rising last score does not erase earlier fluctuations, and falling trends remain distinguishable', () => {
  const fluctuation = report([[8, 8, 8], [1, 1, 0], [8, 8, 8]])
  assert.ok(fluctuation.comparisons.every(item => item.direction === 'higher'))
  assert.ok(fluctuation.synthesis.trends.every(item => item.status === 'fluctuating'))
  assert.equal(fluctuation.synthesis.decision, 'observe')
  const falling = report([[8, 8, 8], [6, 6, 4], [3, 2, 0]])
  assert.ok(falling.synthesis.trends.every(item => item.status === 'falling'))
  assert.equal(falling.synthesis.recommendedLevel, null)
  const weak = report([[0, 0, 0], [1, 1, 1], [2, 2, 2]])
  assert.ok(weak.synthesis.trends.every(item => item.belowReference))
})

test('practice evidence changes the comprehensive advice without rewriting the single-test result', () => {
  const scores = [[8, 8, 8], [8, 8, 8], [8, 8, 8]]
  const supported = report(scores)
  const consolidate = report(scores, { recall: { total: 6, independent: 1, hinted: 3, weak: 2 } })
  assert.equal(supported.synthesis.decision, 'supported')
  assert.equal(consolidate.synthesis.decision, 'consolidate')
  assert.equal(consolidate.synthesis.recommendedLevel, null)
  assert.deepEqual(consolidate.current, supported.current)
  assert.deepEqual(consolidate.synthesis.priorityActions, ['recall'])
  assert.throws(() => validateAssessmentSelection(selection(consolidate, 'collocations'), consolidate))
  assert.ok(validateAssessmentSelection(selection(consolidate), consolidate))
})

test('incompatible books and versions never contribute to a longitudinal conclusion', () => {
  const current = session(3, [8, 8, 8])
  const otherBook = session(1, [0, 0, 0]); otherBook.state.bookId = 2
  const otherVersion = session(2, [1, 1, 1]); otherVersion.state.questionSetVersion = 'other'
  const result = buildAssessmentBaseline({ session: current, history: [otherVersion, otherBook] })
  assert.equal(result.synthesis.testDays, 1)
  assert.equal(result.synthesis.decision, 'insufficient')
})

test('the trend uses at most five distinct dates and retains the most recent daily score rather than the best score', () => {
  const rows = Array.from({ length: 7 }, (_, index) => session(index + 1, [8, 8, 8]))
  rows.push(session(8, [0, 0, 0], 7))
  const result = buildAssessmentBaseline({ session: rows.at(-1), history: rows.slice(0, -1).reverse() })
  assert.equal(result.synthesis.daily.length, 5)
  assert.equal(result.synthesis.daily.at(-1).sessionId, 8)
  assert.equal(result.synthesis.trends[0].points.at(-1).correct, 0)
})

test('unsupported improvement, wrong direction, invented quantities and free-form claims cannot enter the AI explanation', () => {
  const noHistory = report([[8, 8, 8]])
  for (const conclusionId of ['trend-foundation-rising', 'synthesis-supported', 'knows-ten-thousand-words']) {
    assert.throws(() => validateAssessmentSelection({ observations: [{ conclusionId }], nextSteps: [{ actionId: 'recall' }] }, noHistory))
  }
  assert.throws(() => validateAssessmentSelection({ observations: [{ evidenceId: 'comparison', explanation: '相比过去持续进步。' }], nextSteps: [] }, noHistory))
  const poisoned = selection(noHistory)
  poisoned.observations[0].explanation = '已经掌握一万个词。'
  assert.throws(() => validateAssessmentSelection(poisoned, noHistory))
  const falling = report([[8, 8, 8], [6, 6, 4], [3, 2, 0]])
  const contradicted = selection(falling)
  contradicted.observations.push({ conclusionId: 'trend-foundation-rising' })
  assert.throws(() => validateAssessmentSelection(contradicted, falling))
  assert.ok(assessmentConclusions(falling).some(item => item.id === 'trend-foundation-falling'))
})

test('valid evidence selections render verified text and saved explanations are revalidated', () => {
  const baseline = report([[8, 8, 8]])
  const verified = validateAssessmentSelection(selection(baseline), baseline)
  assert.equal(verified.validationVersion, EXPLANATION_VALIDATION_VERSION)
  assert.match(verified.observations[0].explanation, /不足/)
  assert.ok(verified.observations[0].evidenceIds.includes('synthesis'))
  const poisoned = { ...verified, generatedAt: '2026-11-01T10:00:00Z', observations: verified.observations.map(item => ({ ...item, explanation: '持续进步，完全掌握。' })) }
  const restored = validatedSavedExplanation(poisoned, baseline)
  assert.match(restored.observations[0].explanation, /不足/)
  assert.ok(!restored.observations[0].explanation.includes('完全掌握'))
  assert.equal(validatedSavedExplanation({ ...verified, validationVersion: 'old' }, baseline), null)
  assert.equal(validatedSavedExplanation(verified, report([[8, 8, 8], [8, 8, 8], [8, 8, 8]])), null)
})

test('AI receives the recent multi-test score sequence and cannot omit the comprehensive conclusion', () => {
  const baseline = report([[3, 1, 0], [6, 6, 4], [8, 8, 8]])
  const prompt = makeAssessmentExplanationPrompt(baseline, 12000)
  const sent = JSON.parse(prompt.content)
  assert.equal(sent.history.length, 3)
  assert.deepEqual(sent.history[0].scores[0], ['foundation', 3, 8])
  assert.equal(sent.requiredConclusion, 'synthesis-supported')
  assert.ok(sent.conclusions.some(item => item.id === 'trend-foundation-rising'))
  assert.throws(() => validateAssessmentSelection({ observations: [{ conclusionId: 'current-reference' }], nextSteps: [{ actionId: 'recall' }] }, baseline))
})
