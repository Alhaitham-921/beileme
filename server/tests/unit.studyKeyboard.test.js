import test from 'node:test'
import assert from 'node:assert/strict'
import { studyKey } from '../../src/utils/studyKeyboard.js'
test('numbers and space map to study controls', () => {
  for (let i = 1; i <= 4; i++) assert.equal(studyKey({ key: String(i) }), i - 1)
  assert.equal(studyKey({ key: ' ', code: 'Space' }), 'next')
  assert.equal(studyKey({ key: '5' }), null)
})
test('typing, held keys and modified keys never trigger study controls', () => {
  assert.equal(studyKey({ key: '1', repeat: true }), null)
  assert.equal(studyKey({ key: '1', ctrlKey: true }), null)
  assert.equal(studyKey({ key: '1', isComposing: true }), null)
  assert.equal(studyKey({ key: '1', target: { closest: () => ({}) } }), null)
})
