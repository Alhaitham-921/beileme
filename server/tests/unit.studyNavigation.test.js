import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import api from '../../src/api/index.js'
import { useAppStore } from '../../src/stores/app.js'

function items() {
  return [1, 2, 3].map(wordId => ({
    wordId,
    answered: false,
    correct: null,
    word: { id: wordId, spelling: `word${wordId}`, definitions: [`释义${wordId}`] },
    options: [{ index: 0, text: `释义${wordId}` }, { index: 1, text: '干扰项' }],
  }))
}

function setup(t) {
  setActivePinia(createPinia())
  const app = useAppStore()
  const values = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  } })
  app.session = { id: 10, status: 'active' }
  app.items = items()
  t.after(() => {
    app.$dispose()
    setActivePinia(undefined)
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous)
    else delete globalThis.sessionStorage
  })
  return { app, values }
}

function result(wordId, isCorrect = true) {
  return { isCorrect, correctText: `释义${wordId}`, analysis: { label: '本次反馈' }, progress: { memoryStrength: 40 } }
}

test('browsing unanswered cards never counts them as completed or finishes a partial queue', async t => {
  const { app } = setup(t)
  const finish = t.mock.method(api.study, 'finish', async () => { throw new Error('must not finish') })
  assert.equal(app.previousQuestion(), false)
  assert.equal(app.nextQuestion(), true)
  assert.equal(app.currentIndex, 1)
  assert.equal(app.goToQuestion(2), true)
  assert.equal(app.nextQuestion(), false)
  assert.equal(app.answeredCount, 0)
  assert.equal(app.allAnswered, false)
  assert.equal(app.firstUnansweredIndex, 0)
  assert.equal(app.lastAnswer, null)
  for (const invalid of [-1, 3, 1.5, '1', NaN]) assert.equal(app.goToQuestion(invalid), false)
  await assert.rejects(app.finishSession(), /未作答/)
  assert.equal(finish.mock.callCount(), 0)
})

test('revisiting an answered card restores its answer and chosen option without another API submission', async t => {
  const { app } = setup(t)
  const answer = t.mock.method(api.study, 'answer', async () => result(1, false))
  await app.submitAnswer({ wordId: 1, optionIndex: 1, hesitationMs: 100 })
  assert.equal(app.sessionWrong, 1)
  assert.equal(app.answeredCount, 1)
  app.nextQuestion()
  assert.equal(app.lastAnswer, null)
  app.previousQuestion()
  assert.equal(app.lastAnswer.isCorrect, false)
  assert.equal(app.lastAnswer.progress.memoryStrength, 40)
  assert.equal(app.currentItem.selectedOptionIndex, 1)
  await assert.rejects(app.submitAnswer({ wordId: 1, optionIndex: 0 }), /已作答/)
  assert.equal(answer.mock.callCount(), 1)
  assert.equal(app.sessionWrong, 1)
})

test('restored cards show persisted correctness without fabricating prior SRS or option selection', async t => {
  const { app, values } = setup(t)
  app.clearSession()
  values.set('beileme:activeSession', '20')
  const restored = items()
  restored[0].answered = true
  restored[0].correct = false
  t.mock.method(api.study, 'getSession', async () => ({ session: { id: 20, status: 'active' }, items: restored }))
  await app.restoreSession()
  assert.equal(app.currentIndex, 1)
  assert.equal(app.lastAnswer, null)
  app.previousQuestion()
  assert.equal(app.lastAnswer.restored, true)
  assert.equal(app.lastAnswer.isCorrect, false)
  assert.equal(app.lastAnswer.correctText, '释义1')
  assert.equal(app.lastAnswer.progress, null)
  assert.equal(app.currentItem.selectedOptionIndex, undefined)
  assert.deepEqual(app.lastAnswer.analysis, {})
})

test('a conflict can refresh the active session without discarding its identity', async t => {
  const { app } = setup(t)
  const restored = items()
  restored[0].answered = true
  restored[0].correct = true
  t.mock.method(api.study, 'getSession', async id => {
    assert.equal(id, 10)
    return { session: { id: 10, status: 'active' }, items: restored }
  })
  const data = await app.restoreSession(true)
  assert.equal(data.session.id, 10)
  assert.equal(app.currentIndex, 1)
  app.previousQuestion()
  assert.equal(app.lastAnswer.isCorrect, true)
  assert.equal(app.answeredCount, 1)
})

test('answer persistence blocks navigation until the response belongs to its initiating card', async t => {
  const { app } = setup(t)
  let resolve
  t.mock.method(api.study, 'answer', () => new Promise(done => { resolve = done }))
  const pending = app.submitAnswer({ wordId: 1, optionIndex: 0 })
  assert.equal(app.loading.answering, true)
  assert.equal(app.nextQuestion(), false)
  assert.equal(app.currentIndex, 0)
  resolve(result(1))
  await pending
  assert.equal(app.loading.answering, false)
  assert.equal(app.currentItem.answered, true)
  assert.equal(app.lastAnswer.correctText, '释义1')
})

test('a late answer cannot mutate a replacement session or clear its pending state', async t => {
  const { app } = setup(t)
  const completions = []
  t.mock.method(api.study, 'answer', () => new Promise(done => { completions.push(done) }))
  const oldAnswer = app.submitAnswer({ wordId: 1, optionIndex: 1 })
  t.mock.method(api.study, 'createSession', async () => ({ session: { id: 30, status: 'active' }, items: items() }))
  await app.startSession()
  assert.equal(app.lastAnswer, null)
  assert.equal(app.loading.answering, false)
  const newAnswer = app.submitAnswer({ wordId: 1, optionIndex: 0 })
  completions[0]({ ...result(1, false), plan: { obsolete: true } })
  await oldAnswer
  assert.equal(app.currentItem.answered, false)
  assert.equal(app.lastAnswer, null)
  assert.equal(app.plan, null)
  assert.equal(app.loading.answering, true)
  completions[1](result(1))
  await newAnswer
  assert.equal(app.lastAnswer.isCorrect, true)
  assert.equal(app.currentItem.selectedOptionIndex, 0)
})

test('only a fully answered queue can finish and finished results stop card navigation', async t => {
  const { app } = setup(t)
  app.items.forEach(item => { item.answered = true; item.correct = true })
  const finish = t.mock.method(api.study, 'finish', async () => ({ summary: { answeredCount: 3 } }))
  assert.equal(app.allAnswered, true)
  assert.equal(app.firstUnansweredIndex, -1)
  await app.finishSession()
  assert.equal(finish.mock.callCount(), 1)
  assert.equal(app.sessionSummary.answeredCount, 3)
  assert.equal(app.nextQuestion(), false)
  assert.equal(app.goToQuestion(0), false)
})

test('starting a review clears the old feedback and completed summary', async t => {
  const { app } = setup(t)
  app.lastAnswer = result(1)
  app.sessionSummary = { answeredCount: 3 }
  t.mock.method(api.study, 'createReviewSession', async () => ({ session: { id: 40, status: 'active' }, items: items() }))
  await app.startReviewSession([1, 2, 3])
  assert.equal(app.session.id, 40)
  assert.equal(app.lastAnswer, null)
  assert.equal(app.sessionSummary, null)
  assert.equal(app.currentIndex, 0)
  assert.equal(app.answeredCount, 0)
})
