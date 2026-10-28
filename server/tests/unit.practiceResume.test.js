import test from 'node:test'
import assert from 'node:assert/strict'
import { practiceDay, parsePracticeMemory, selectPracticeResume } from '../../src/utils/practiceResume.js'

const today = new Date('2026-10-26T06:00:00Z')
const entry = (id, createdAt, patch = {}) => ({ id, status: 'active', createdAt, updatedAt: createdAt, ...patch })
const yesterday = entry(1, '2026-10-25T06:00:00Z')
const first = entry(2, '2026-10-26T01:00:00Z')
const last = entry(3, '2026-10-26T05:00:00Z', { status: 'finished' })

test('practice calendar changes at midnight in Shanghai regardless of device timezone', () => {
  assert.equal(practiceDay('2026-10-25T15:59:59Z'), '2026-10-25')
  assert.equal(practiceDay('2026-10-25T16:00:00Z'), '2026-10-26')
  assert.equal(practiceDay('2026-10-25 16:00:00'), '2026-10-26')
  assert.equal(practiceDay('2026-10-25T09:00:00-07:00'), '2026-10-26')
  assert.equal(practiceDay('invalid'), null)
  assert.equal(practiceDay(null), null)
})

test('same-day visits restore the last deliberately opened conversation including its finished report', () => {
  const memory = JSON.stringify({ id: 2, day: '2026-10-26' })
  assert.equal(selectPracticeResume([last, first, yesterday], memory, today)?.id, 2)
  assert.equal(selectPracticeResume([last, first], null, today)?.id, 3)
  assert.equal(selectPracticeResume([last], JSON.stringify({ id: 3, day: '2026-10-26' }), today)?.status, 'finished')
  assert.equal(selectPracticeResume([yesterday], { id: 1, day: '2026-10-26' }, today)?.id, 1)
})

test('next-day entry returns to scene selection even when a background report updated an older chat today', () => {
  const old = { ...yesterday, status: 'finished', updatedAt: today.toISOString() }
  assert.equal(selectPracticeResume([old], { id: 1, day: '2026-10-25' }, today), null)
  assert.equal(selectPracticeResume([old], '1', today), null)
  assert.equal(selectPracticeResume([old], null, today), null)
  assert.equal(selectPracticeResume([last, first], { id: 3, day: '2026-10-26' }, new Date('2026-10-26T16:00:00Z')), null)
})

test('stale, missing and legacy memory fall back only to today without changing history', () => {
  const sessions = [first, yesterday, last]
  assert.equal(selectPracticeResume(sessions, '2', today)?.id, 2)
  assert.equal(selectPracticeResume(sessions, '1', today)?.id, 3)
  assert.equal(selectPracticeResume(sessions, '{broken', today)?.id, 3)
  assert.equal(selectPracticeResume(sessions, { id: 999, day: '2026-10-26' }, today)?.id, 3)
  assert.deepEqual(sessions.map(item => item.id), [2, 1, 3])
  assert.equal(selectPracticeResume([], '3', today), null)
  assert.deepEqual(parsePracticeMemory('42'), { id: '42', day: null })
  assert.equal(parsePracticeMemory('{broken'), null)
})
