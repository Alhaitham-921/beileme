import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCollocationQuestions, matchesCollocationAnswer } from '../../src/utils/collocationPractice.js'
import { localCollocationsFor, normalizeAiUsage } from '../src/services/wordLearningService.js'
import { COLLOCATION_SUPPLEMENTS } from '../data/collocationSupplements.js'
import { collocationKey, scheduleCollocation } from '../src/services/collocationService.js'

test('practice keeps the target visible and recalls a meaningful partner word or preposition', () => {
  const [decision] = buildCollocationQuestions([{ phrase: 'make a decision', translation: '做决定' }], 'decision')
  assert.equal(decision.prompt, '____ a decision')
  assert.equal(decision.answer, 'make')
  const [interested] = buildCollocationQuestions([{ phrase: 'be interested in', translation: '对……感兴趣' }], 'interested')
  assert.equal(interested.prompt, 'be interested ____')
  assert.equal(interested.answer, 'in')
  assert.equal(buildCollocationQuestions([{ phrase: 'in the meantime', translation: '与此同时' }], 'time').length, 0)
})

test('only bilingual, distinct phrases with an exact target and a partner become questions', () => {
  const entries = [{ phrase: 'depend on', translation: '取决于' }, { phrase: 'DEPEND ON', translation: '依靠' },
    { phrase: 'depend entirely on', translation: '' }, { phrase: 'an independent study', translation: '独立研究' },
    { phrase: 'depend', translation: '依靠' }, { phrase: 'to depend', translation: '依靠' }, null]
  assert.equal(buildCollocationQuestions(entries, 'depend').length, 1)
  assert.deepEqual(buildCollocationQuestions(entries, ''), [])
  assert.ok(matchesCollocationAnswer('  MAKE ', 'make'))
  assert.ok(matchesCollocationAnswer('somebody’s', "somebody's"))
  assert.equal(matchesCollocationAnswer('do', 'make'), false)
})

test('supplemental phrases expand existing entries and cover common words missing from the starter set', () => {
  assert.equal(localCollocationsFor('abandon').length, 4)
  assert.equal(localCollocationsFor('Decision').length, 6)
  assert.deepEqual(localCollocationsFor('uncataloguedtestword'), [])
  assert.deepEqual(localCollocationsFor('constructor'), [])
  for (const [word, phrases] of Object.entries(COLLOCATION_SUPPLEMENTS)) {
    assert.ok(phrases.every(item => item.phrase && /\p{Script=Han}/u.test(item.translation)), word)
    assert.equal(new Set(phrases.map(item => item.phrase.toLowerCase())).size, phrases.length, word)
    assert.ok(buildCollocationQuestions(localCollocationsFor(word), word).length, word)
  }
})

test('larger AI sets keep up to six unique phrases when reloaded from saved cards', () => {
  const collocations = Array.from({ length: 8 }, (_, i) => ({ phrase: `decision ${i}`, translation: '测试' }))
  collocations.push(collocations[0])
  const usage = normalizeAiUsage({ spelling: 'decision', collocations }, 'decision')
  assert.equal(usage.collocations.length, 6)
})

test('inflected target forms can practice too, without accepting unrelated substrings', () => {
  const [item]=buildCollocationQuestions([{phrase:'be interested in',translation:'对……感兴趣'}],'interest')
  assert.equal(item.answer,'in');assert.equal(item.prompt,'be interested ____')
  assert.equal(buildCollocationQuestions([{phrase:'an independent study',translation:'独立研究'}],'depend').length,0)
  assert.equal(buildCollocationQuestions([{phrase:'taken into account',translation:'被考虑在内'}],'take')[0].answer,'into')
})

test('phrase meanings have separate identity and same business-day drills cannot manufacture mastery', () => {
  assert.notEqual(collocationKey({phrase:'take off',translation:'起飞'}),collocationKey({phrase:'take off',translation:'脱下'}))
  assert.equal(collocationKey({phrase:'  TAKE OFF ',translation:'起飞'}),collocationKey({phrase:'take off',translation:'起飞'}))
  const now=Date.parse('2026-11-14T16:20:00Z')
  const previous={last_result:'correct',last_review_at:new Date('2026-11-15T00:10:00+08:00'),next_review_at:new Date(now+86400000),repetitions:1,ef:2.5,interval_days:1}
  assert.equal(scheduleCollocation(previous,true,now).repetitions,1)
  assert.equal(scheduleCollocation(previous,false,now).repetitions,0)
  assert.equal(scheduleCollocation({...previous,last_review_at:new Date(now-86400000)},true,now).intervalDays,6)
})
