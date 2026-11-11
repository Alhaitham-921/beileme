import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssessmentNavigation } from '../../src/utils/assessmentNavigation.js'

function question(wordId) {
  return { wordId, options: ['A', 'B', 'C', 'D'] }
}

function session(wordId = 1, upcomingId = wordId + 1, id = 10) {
  return { id, answered: wordId - 1, total: 35, question: question(wordId), upcoming: upcomingId ? question(upcomingId) : null }
}

function fixture(initial = session()) {
  const state = {}
  const requests = []
  let time = 100
  const navigation = createAssessmentNavigation({
    state,
    now: () => time,
    submit(sessionId, body) {
      return new Promise((resolve, reject) => requests.push({ sessionId, body, resolve, reject }))
    },
  })
  navigation.reset(initial)
  return { state, requests, navigation, setTime: value => { time = value } }
}

test('a buffered question appears while the previous answer is saving, and rapid answers stay in order', async () => {
  const { state, requests, navigation, setTime } = fixture()
  setTime(300)
  const saving = navigation.answer(2)
  assert.equal(state.session.question.wordId, 2)
  assert.equal(state.saving, true)
  assert.equal(requests[0].body.rtMs, 200)
  setTime(550)
  navigation.answer(-1)
  navigation.answer(3)
  assert.equal(requests.length, 1)
  requests[0].resolve(session(2))
  await Promise.resolve()
  assert.equal(state.session.question.wordId, 3)
  assert.deepEqual(requests[1].body, { wordId: 2, selectedIndex: -1, rtMs: 250 })
  requests[1].resolve(session(3))
  await saving
  assert.equal(state.saving, false)
  assert.equal(state.selected, null)
  assert.equal(state.session.upcoming.wordId, 4)
})

test('confirmation does not reset the timer of a question already on screen', async () => {
  const { requests, navigation, setTime } = fixture()
  const saving = navigation.answer(0)
  setTime(800)
  requests[0].resolve(session(2))
  await saving
  setTime(900)
  const secondSave = navigation.answer(1)
  assert.equal(requests[1].body.rtMs, 800)
  requests[1].resolve(session(3))
  await secondSave
})

test('a failed save retries the original payload before sending the queued choice', async () => {
  const { state, requests, navigation } = fixture()
  const saving = navigation.answer(-1)
  navigation.answer(1)
  requests[0].reject(new Error('网络超时'))
  await saving
  assert.equal(state.error, '网络超时')
  assert.equal(state.selected, 1)
  const retrying = navigation.retry()
  assert.deepEqual(requests[1].body, requests[0].body)
  requests[1].resolve(session(2))
  await Promise.resolve()
  assert.equal(requests[2].body.wordId, 2)
  requests[2].resolve(session(3))
  await retrying
  assert.equal(state.error, '')
  assert.equal(state.session.question.wordId, 3)
})

test('legacy questions and final results advance on confirmation without another action', async () => {
  const { state, requests, navigation } = fixture(session(34, null))
  const saving = navigation.answer(2)
  assert.equal(state.session.question.wordId, 34)
  requests[0].resolve(session(35, null))
  await saving
  assert.equal(state.session.question.wordId, 35)
  const finalSave = navigation.answer(-1)
  const result = { id: 10, answered: 35, total: 35, question: null, result: { estimatedKnown: 1200 } }
  requests[1].resolve(result)
  await finalSave
  assert.equal(state.session, result)
})

test('an old response cannot overwrite a new session or change state after disposal', async () => {
  const { state, requests, navigation } = fixture()
  const oldSave = navigation.answer(0)
  navigation.reset(session(7, 8, 20))
  const newSave = navigation.answer(1)
  requests[0].resolve(session(2))
  await oldSave
  assert.equal(state.session.id, 20)
  assert.equal(state.session.question.wordId, 8)
  assert.equal(state.saving, true)
  navigation.dispose()
  const snapshot = structuredClone(state)
  requests[1].resolve(session(8, 9, 20))
  await newSave
  assert.deepEqual(state, snapshot)
})

test('a stale buffered choice is discarded if the server has advanced beyond it', async () => {
  const { state, requests, navigation } = fixture()
  const saving = navigation.answer(2)
  navigation.answer(1)
  requests[0].resolve(session(3))
  await saving
  assert.equal(state.session.question.wordId, 3)
  assert.equal(state.selected, null)
  assert.equal(requests.length, 1)
})
