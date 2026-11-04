import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssessmentNavigation } from '../../src/utils/assessmentNavigation.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function question(wordId = 1, id = 10) {
  return { id, answered: wordId - 1, total: 35, question: { wordId, options: ['A', 'B', 'C', 'D'] } }
}

function fixture() {
  const state = {}
  const requests = []
  const advanced = []
  let time = 100
  const navigation = createAssessmentNavigation({
    state,
    now: () => time,
    submit(sessionId, body) {
      const response = deferred()
      requests.push({ sessionId, body, ...response })
      return response.promise
    },
    onAdvance: next => advanced.push(next),
  })
  navigation.reset(question())
  return { state, requests, advanced, navigation, setTime: value => { time = value } }
}

test('selecting submits once and waits for explicit continuation after saving', async () => {
  const { state, requests, advanced, navigation } = fixture()
  const saving = navigation.answer(2)
  navigation.answer(1)
  navigation.retry()
  assert.equal(requests.length, 1)
  assert.equal(state.selected, 2)
  assert.equal(state.busy, true)
  assert.equal(state.pending, null)
  assert.equal(state.session.question.wordId, 1)
  const next = question(2)
  requests[0].resolve(next)
  await saving
  assert.equal(state.busy, false)
  assert.equal(state.session.question.wordId, 1)
  assert.equal(state.selected, 2)
  assert.equal(state.pending, next)
  assert.deepEqual(advanced, [])
  navigation.advance()
  assert.equal(state.session, next)
  assert.equal(state.selected, null)
  assert.deepEqual(advanced, [next])
})

test('continuation during saving queues one transition without another submission', async () => {
  const { state, requests, advanced, navigation } = fixture()
  navigation.advance()
  assert.equal(state.continueRequested, false)
  const saving = navigation.answer(0)
  navigation.advance()
  navigation.advance()
  assert.equal(state.continueRequested, true)
  assert.equal(state.session.question.wordId, 1)
  assert.equal(state.pending, null)
  assert.equal(requests.length, 1)
  requests[0].resolve(question(2))
  await saving
  navigation.advance()
  assert.equal(state.session.question.wordId, 2)
  assert.equal(state.continueRequested, false)
  assert.equal(state.selected, null)
  assert.equal(advanced.length, 1)
  assert.equal(requests.length, 1)
})

test('failed save keeps the selection and retries the identical payload including response time', async () => {
  const { state, requests, advanced, navigation, setTime } = fixture()
  setTime(345)
  const saving = navigation.answer(-1)
  navigation.advance()
  const original = structuredClone(requests[0].body)
  requests[0].reject(new Error('网络超时'))
  await saving
  assert.equal(state.session.question.wordId, 1)
  assert.equal(state.selected, -1)
  assert.equal(state.error, '网络超时')
  assert.equal(state.continueRequested, false)
  assert.equal(state.busy, false)
  assert.equal(state.pending, null)
  navigation.advance()
  navigation.answer(3)
  assert.equal(requests.length, 1)
  setTime(5000)
  const retrying = navigation.retry()
  navigation.retry()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].sessionId, requests[0].sessionId)
  assert.deepEqual(requests[1].body, original)
  assert.deepEqual(original, { wordId: 1, selectedIndex: -1, rtMs: 245 })
  assert.equal(state.error, '')
  requests[1].resolve(question(2))
  await retrying
  assert.equal(state.session.question.wordId, 1)
  assert.deepEqual(advanced, [])
  navigation.advance()
  assert.equal(state.session.question.wordId, 2)
})

test('retry can explicitly request continuation while still waiting for confirmation', async () => {
  const { state, requests, navigation } = fixture()
  const saving = navigation.answer(1)
  requests[0].reject(new Error('保存失败'))
  await saving
  const retrying = navigation.retry()
  navigation.advance()
  assert.equal(state.session.question.wordId, 1)
  requests[1].resolve(question(2))
  await retrying
  assert.equal(state.session.question.wordId, 2)
  assert.equal(state.selected, null)
})

for (const outcome of ['success', 'failure']) {
  test(`old ${outcome} cannot overwrite or unlock a new assessment's in-flight save`, async () => {
    const { state, requests, advanced, navigation } = fixture()
    const oldSaving = navigation.answer(0)
    navigation.advance()
    navigation.reset(question(7, 20))
    const newSaving = navigation.answer(3)
    if (outcome === 'success') requests[0].resolve(question(2))
    else requests[0].reject(new Error('旧测评保存失败'))
    await oldSaving
    assert.equal(state.session.id, 20)
    assert.equal(state.session.question.wordId, 7)
    assert.equal(state.selected, 3)
    assert.equal(state.busy, true)
    assert.equal(state.pending, null)
    assert.equal(state.error, '')
    assert.equal(state.continueRequested, false)
    assert.deepEqual(advanced, [])
    requests[1].resolve(question(8, 20))
    await newSaving
    assert.equal(state.busy, false)
    assert.equal(state.pending.id, 20)
    navigation.advance()
    assert.equal(state.session.question.wordId, 8)
  })
}

test('unmount invalidates pending submission and queued navigation', async () => {
  const { state, requests, advanced, navigation } = fixture()
  const saving = navigation.answer(1)
  navigation.advance()
  navigation.dispose()
  const snapshot = structuredClone(state)
  requests[0].resolve(question(2))
  await saving
  assert.deepEqual(state, snapshot)
  assert.deepEqual(advanced, [])
})

test('final result appears only after confirmed save and requested continuation', async () => {
  const { state, requests, advanced, navigation } = fixture()
  navigation.reset({ ...question(35), answered: 34 })
  const saving = navigation.answer(2)
  navigation.advance()
  assert.equal(state.session.result, undefined)
  const result = { id: 10, answered: 35, total: 35, question: null, result: { estimatedKnown: 1200 } }
  requests[0].resolve(result)
  await saving
  assert.equal(state.session, result)
  assert.deepEqual(advanced, [result])
  navigation.advance()
  navigation.answer(1)
  assert.equal(requests.length, 1)
  assert.equal(advanced.length, 1)
})

test('response time starts again when the next question becomes visible', async () => {
  const { requests, navigation, setTime } = fixture()
  setTime(500)
  const saving = navigation.answer(0)
  requests[0].resolve(question(2))
  await saving
  setTime(1000)
  navigation.advance()
  setTime(1200)
  const secondSaving = navigation.answer(3)
  assert.equal(requests[0].body.rtMs, 400)
  assert.equal(requests[1].body.rtMs, 200)
  requests[1].resolve(question(3))
  await secondSaving
})

test('invalid choice indices do not submit or lock the question', () => {
  const { state, requests, navigation } = fixture()
  for (const index of [-2, 4, 1.5, NaN, null]) navigation.answer(index)
  assert.equal(requests.length, 0)
  assert.equal(state.selected, null)
  assert.equal(state.busy, false)
})
