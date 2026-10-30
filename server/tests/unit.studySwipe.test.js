import test from 'node:test'
import assert from 'node:assert/strict'
import { studySwipeDirection } from '../../src/utils/studySwipe.js'

const gesture = { startX: 220, startY: 350, endX: 120, endY: 356, elapsedMs: 250 }

test('horizontal swipes navigate forward and back', () => {
  assert.equal(studySwipeDirection(gesture), 'next')
  assert.equal(studySwipeDirection({ ...gesture, endX: 320 }), 'previous')
})

test('vertical reading, taps, long presses and invalid touches never flip a word', () => {
  for (const patch of [
    { endX: 210 }, { endY: 500 }, { vertical: true }, { elapsedMs: 901 },
    { elapsedMs: -1 }, { endX: NaN }, { endY: Infinity },
  ]) assert.equal(studySwipeDirection({ ...gesture, ...patch }), null)
})
