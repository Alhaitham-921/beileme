import test from 'node:test'
import assert from 'node:assert/strict'
import { spellingInput, spellingLetters, normalizeSpelling, matchesSpelling, newSpellingState, applySpellingAction, spellingPresentation } from '../../shared/spelling.js'
import { createPracticeClock, spellingDraftKey, readSpellingDraft } from '../../src/utils/spellingPractice.js'
const words = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, spelling: ['another','future','live'][i % 3], meaning: '测试释义', pos: 'n.', example: 'An existing example.' }))
const answer = (state, extras = {}) => applySpellingAction(state, { action: 'answer', wordId: state.queue[state.index], answer: state.words.find(w => w.id === state.queue[state.index]).spelling, errorCount: 0, durationMs: 1200, ...extras })
test('typing supports correction, paste, case/fullwidth and explicit deletion after a mistake', () => {
  assert.equal(normalizeSpelling('ＦＵＴＵＲＥ'), 'future')
  assert.ok(matchesSpelling(" Mother’s ", "mother's"))
  assert.ok(!matchesSpelling('motherinlaw','mother-in-law'))
  assert.ok(!matchesSpelling('lookat','look at'))
  assert.equal(spellingInput('fu','futuer','future').errors, 2)
  assert.deepEqual(spellingInput('futuer','future','future'), { value: 'futuer', errors: 0, blocked: true })
  assert.equal(spellingInput('futuer','futu','future').value, 'futu')
  assert.equal(spellingInput('futu','future','future').errors, 0)
  assert.equal(spellingInput('','FUTURE','future').errors, 0)
  assert.deepEqual(spellingLetters('fx','future').slice(0,3).map(l => l.status), ['correct','wrong','waiting'])
})
test('more than ten words retain order, group boundaries require an explicit action', () => {
  const state = newSpellingState(words)
  assert.deepEqual(state.queue, words.slice(0,10).map(w => w.id))
  for (let i = 0; i < 10; i++) { answer(state); assert.equal(state.stage,'feedback'); applySpellingAction(state,{action:'next'}) }
  assert.equal(state.stage,'group-end'); assert.equal(Object.keys(state.results).length,10)
  applySpellingAction(state,{action:'next'}); assert.equal(state.group,1); assert.equal(state.queue[0],11)
  while(state.stage !== 'finished') {
    if (state.stage === 'typing') answer(state)
    else applySpellingAction(state,{action:'next'})
  }
  assert.equal(Object.keys(state.results).length,23)
  assert.equal(state.bestStreak,23)
})
test('corrections, help and skips retry once and preserve first results', () => {
  const state = newSpellingState(words.slice(0,4))
  answer(state); applySpellingAction(state,{action:'next'})
  answer(state,{errorCount:2}); applySpellingAction(state,{action:'next'})
  applySpellingAction(state,{action:'reveal',wordId:3}); answer(state); applySpellingAction(state,{action:'next'})
  applySpellingAction(state,{action:'skip',wordId:4}); applySpellingAction(state,{action:'next'})
  assert.equal(state.phase,'retry'); assert.deepEqual(state.queue,[2,3,4]); assert.equal(state.streak,0)
  const first = structuredClone(state.results[2].first)
  answer(state); applySpellingAction(state,{action:'next'})
  answer(state); applySpellingAction(state,{action:'next'})
  applySpellingAction(state,{action:'skip',wordId:4}); applySpellingAction(state,{action:'next'})
  assert.equal(state.stage,'finished'); assert.equal(state.results[4].retry.result,'pending')
  assert.deepEqual(state.results[2].first,first); assert.equal(state.results[2].retry.result,'independent')
  assert.equal(spellingPresentation({id:1,revision:7,state}).independentCount,1)
})
test('wrong full spellings, stale words and premature next do not advance', () => {
  const state = newSpellingState(words.slice(0,1))
  assert.throws(()=>applySpellingAction(state,{action:'next'}))
  assert.throws(()=>answer(state,{answer:'wrong'}))
  assert.throws(()=>answer(state,{wordId:999}))
  assert.equal(state.stage,'typing'); assert.deepEqual(state.results,{})
})
test('clock excludes pauses/background and resumes from restored time', () => {
  let now=0; const clock=createPracticeClock(()=>now)
  clock.resume(); now=1000; assert.equal(clock.elapsed(),1000)
  clock.pause(); now=10000; assert.equal(clock.elapsed(),1000)
  clock.resume(); now=10500; clock.pause(); assert.equal(clock.elapsed(),1500)
  clock.reset(800); now=50000; assert.equal(clock.elapsed(),800)
})
test('drafts are scoped to account/session/round and tolerate absent or malformed storage', () => {
  assert.notEqual(spellingDraftKey(1,2,3,'first'),spellingDraftKey(2,2,3,'first'))
  assert.notEqual(spellingDraftKey(1,2,3,'first'),spellingDraftKey(1,2,3,'retry'))
  for(const raw of ['null','{}','bad']) assert.equal(readSpellingDraft('x',{getItem:()=>raw}),null)
  assert.deepEqual(readSpellingDraft('x',{getItem:()=>JSON.stringify({input:'futu',errors:2,durationMs:800})}),{input:'futu',errors:2,durationMs:800})
})
