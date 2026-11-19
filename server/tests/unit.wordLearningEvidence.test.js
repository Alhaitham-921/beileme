import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWordHistory } from '../src/services/wordLearningEvidence.js'
import { assessReliability } from '../src/services/assessmentReliability.js'
import { buildAssessmentBaseline } from '../src/services/assessmentHistory.js'

function session(id, sense = '河岸', correct = true, day = id) {
  const at = `2026-11-${String(day).padStart(2,'0')}T10:00:00Z`
  return { id, completed_at: at, state: { bookId: 1, bookName: '测试词书', methodVersion: 'book-placement-pilot-v1', questionSetVersion: 'v1', form: id % 2 ? 'A' : 'B',
    answers: [{ correct, purpose: 'core', selectedIndex: correct ? 0 : -1, snapshot: { wordId: 100, dictionaryWordId: 8, spelling: 'bank', options: [sense,'无关释义'], correctIndex: 0 } }],
    result: { completedAt: at, form: id % 2 ? 'A' : 'B', recommended: 'foundation', bands: ['foundation','standard','challenge'].map(level => ({ level,tested:8,correct:correct?8:0,unsure:0 })) } } }
}
const event = (source, result, day, extra = {}) => ({ wordId: 8, sense: '河岸', source, result, at: `2026-11-${String(day).padStart(2,'0')}T10:00:00Z`, details: {}, ...extra })

test('same spelling with different senses and unconfirmed collocations stay separate', () => {
  const current = session(7)
  const report = buildWordHistory(current, [session(1, '河岸', false)], [event('study','correct',2),
    event('recall','needs-practice',3), event('collocation','incorrect',4,{sense:null}), event('dialogue','independent',4,{sense:'银行'})])
  const word = report.words[0], sense = word.senses[0]
  assert.equal(sense.sense, '河岸')
  assert.equal(sense.state, 'needs-practice')
  assert.ok(!sense.channels.some(c => c.source === 'collocation' || c.source === 'dialogue'))
  assert.deepEqual(word.otherSenses, ['银行'])
  assert.equal(word.unscoped[0].source, 'collocation')
  assert.equal(word.unscoped[0].correct, 0)
})

test('recognition and image success alone cannot establish independent recall or learning improvement', () => {
  const current = session(7), history = [session(1,'河岸',false)]
  const words = buildWordHistory(current, history, [event('image','correct',3),event('image','correct',5)])
  assert.equal(words.words[0].senses[0].state, 'recognition-only')
  assert.equal(words.supportedImprovements.length, 0)
  assert.equal(assessReliability(current,history,words).status, 'test-scores-only')
})

test('two delayed changed-context independent recalls can corroborate improvement for that exact sense', () => {
  const current = session(7), history = [session(1,'河岸',false)]
  const words = buildWordHistory(current, history, [3,5].map(day => event('recall','independent',day,{details:{mode:'retest',changedContext:true}})))
  assert.equal(words.words[0].senses[0].delayedDays, 2)
  assert.equal(words.supportedImprovements.length, 1)
  const result = assessReliability(current,history,words)
  assert.equal(result.status, 'word-evidence')
  assert.equal(result.calibrated, false)
  assert.match(result.text, /仅针对这些词义/)
})

test('same-day, hinted, unchanged-context, wrong-sense and future results cannot manufacture improvement', () => {
  const current = session(7), history = [session(1,'河岸',false)]
  for (const extra of [{result:'hinted'}, {sense:'银行'}, {details:{mode:'retest',changedContext:false}}, {details:{mode:'practice',changedContext:true}}, {details:{mode:'retest',changedContext:true,legacy:true}}]) {
    const events = [3,5].map(day => event('recall','independent',day,{details:{mode:'retest',changedContext:true},...extra}))
    assert.equal(buildWordHistory(current,history,events).supportedImprovements.length,0)
  }
  const future = buildWordHistory(current,history,[event('recall','independent',9,{details:{mode:'retest',changedContext:true}})])
  assert.ok(future.words[0].senses[0].timeline.every(item => new Date(item.at) <= new Date(current.completed_at)))
  const rapid = buildWordHistory(current,history,[event('recall','independent',3,{details:{mode:'retest',changedContext:true}}),
    event('recall','independent',3,{at:'2026-11-03T11:00:00Z',details:{mode:'retest',changedContext:true}})])
  assert.equal(rapid.supportedImprovements.length,0)
})

test('repeated questions are exposed separately from questions absent in the comparison window, without assuming form equivalence', () => {
  const current = session(7), history = [session(1,'河岸',false)]
  const repeated = assessReliability(current,history,buildWordHistory(current,history))
  assert.equal(repeated.repeated,1)
  assert.equal(repeated.fresh,0)
  assert.equal(repeated.repeatedCorrect,1)
  const other = session(7,'银行')
  assert.equal(assessReliability(other,history,buildWordHistory(other,history)).fresh,1)
  assert.equal(repeated.calibrated,false)
  assert.ok(repeated.warnings.some(text=>text.includes('等值校准')))
  assert.ok(repeated.forms.every(form=>form.form && Number.isInteger(form.tests)))
})

test('a later lapse invalidates older successful recall evidence instead of being hidden by the current correct answer', () => {
  const history=[session(1,'河岸',false),session(6,'河岸',false)]
  const events=[3,5].map(day=>event('recall','independent',day,{details:{mode:'retest',changedContext:true}}))
  const report=buildWordHistory(session(7),history,events)
  assert.equal(report.supportedImprovements.length,0)
  assert.equal(report.words[0].senses[0].delayedDays,0)
})

test('missing question snapshots are unknown rather than fresh; frozen report includes source evidence and cautious explanation', () => {
  const current=session(7), history=[session(1,'河岸',false)]
  const report=buildAssessmentBaseline({session:current,history,wordEvidence:[event('collocation','incorrect',3,{sense:null})]})
  assert.equal(report.wordHistory.words[0].unscoped[0].source,'collocation')
  assert.match(report.synthesis.detail,/只能描述自测成绩变化/)
  assert.ok(report.facts.some(f=>f.id==='word-8'))
  delete current.state.answers[0].snapshot
  const r=assessReliability(current,history,buildWordHistory(current,history))
  assert.equal(r.identifiable,0);assert.equal(r.fresh,0)
})
