import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceMistakeReview, startMistakeReview } from '../../src/utils/mistakeReview.js'

const current = state => state.queue[state.index]
const queue = state => state.queue.map(({ item, step, attempt }) => [item, step, attempt])

test('each word gets one task per round and a passed word exits after recall', () => {
  let state = startMistakeReview(['first', 'second', 'third'])
  state = advanceMistakeReview(state, true)
  assert.equal(current(state).item, 'second')
  state = advanceMistakeReview(state, false)
  state = advanceMistakeReview(state, true)
  assert.deepEqual(queue(state), [['first', 2, 1], ['third', 2, 1], ['second', 1, 2]])

  state = advanceMistakeReview(state, true)
  state = advanceMistakeReview(state, false)
  state = advanceMistakeReview(state, true)
  assert.deepEqual(queue(state), [['first', 3, 1], ['second', 2, 2], ['third', 1, 2]])

  state = advanceMistakeReview(state, true)
  assert.equal(state.completed, 1)
  state = advanceMistakeReview(state, true)
  state = advanceMistakeReview(state, false)
  assert.deepEqual(queue(state), [['second', 3, 2], ['third', 1, 3]])
})

test('a miss at the recall step restarts only that word', () => {
  let state = startMistakeReview(['word'])
  for (const correct of [true, true, false]) state = advanceMistakeReview(state, correct)
  assert.deepEqual(queue(state), [['word', 1, 2]])
  for (const correct of [true, true, true]) state = advanceMistakeReview(state, correct)
  assert.deepEqual(state.queue, [])
  assert.equal(state.completed, 1)
})
