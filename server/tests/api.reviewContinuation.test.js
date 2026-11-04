import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'

import { getTestServer, createClient, createOnboardedUser, correctOptionIndex } from './helpers/setup.js'
const { query, queryOne, execute } = await import('../src/db/pool.js')
const { parseJson } = await import('../src/utils/json.js')
const { todayKey } = await import('../src/utils/time.js')
let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

async function seedProgress(user, words, { future = false } = {}) {
  const nextReviewAt = new Date(Date.now() + (future ? 30 : -2) * 86400000)
  for (const [index, word] of words.entries()) {
    await execute(
      `INSERT INTO user_word_progress
        (user_id, word_id, wordbook_id, state, repetitions, interval_days, times_seen,
         times_correct, first_learned_at, next_review_at)
       VALUES (?, ?, ?, 'reviewing', 1, 1, 1, 1, ?, ?)`,
      [user.userId, word.id, word.wordbook_id, new Date(Date.now() - 7 * 86400000), new Date(nextReviewAt.getTime() + index * 1000)]
    )
  }
}

async function fixture(reviewDone = 0) {
  const user = await createOnboardedUser(client)
  const other = await createOnboardedUser(client)
  const words = await query('SELECT id, wordbook_id FROM words ORDER BY id LIMIT 27')
  assert.equal(words.length, 27)
  const due = words.slice(0, 23)
  const future = words[23]
  await seedProgress(user, due)
  await seedProgress(user, [future], { future: true })
  // One shared word and three words due only for the other account.
  await seedProgress(other, [words[0], ...words.slice(24)])
  await execute(
    'UPDATE daily_plans SET review_target=10, review_done=?, new_target=2, new_done=2 WHERE user_id=? AND plan_date=?',
    [reviewDone, user.userId, todayKey()]
  )
  return { user, other, dueIds: due.map(row => Number(row.id)), futureId: Number(future.id) }
}

async function createGroup(user, kind = 'daily', studyMode = 'review-only', extra = {}) {
  const response = await client.post('/api/v1/study/sessions', {
    token: user.token, body: { kind, studyMode, ...extra },
  })
  assert.equal(response.status, 201, JSON.stringify(response.raw))
  return response.data
}

async function answerItems(user, group, items = group.items) {
  for (const item of items) {
    const response = await client.post(`/api/v1/study/sessions/${group.session.id}/answers`, {
      token: user.token,
      body: { wordId: item.wordId, optionIndex: await correctOptionIndex(group.session.id, item.wordId), hesitationMs: 1200 },
    })
    assert.equal(response.status, 201, JSON.stringify(response.raw))
  }
}

async function finish(user, group) {
  return client.post(`/api/v1/study/sessions/${group.session.id}/finish`, { token: user.token })
}

describe('实时到期复习连续分组', { concurrency: false }, () => {
  for (const initialReviewDone of [0, 10]) {
    test(`23 due words continue 10+10+3 with frozen target=10 and reviewDone=${initialReviewDone}`, async () => {
      const { user, other, dueIds, futureId } = await fixture(initialReviewDone)
      const otherBefore = await query('SELECT * FROM user_word_progress WHERE user_id=? ORDER BY word_id', [other.userId])
      const futureBefore = await queryOne('SELECT * FROM user_word_progress WHERE user_id=? AND word_id=?', [user.userId, futureId])
      const seen = []
      let remaining = 23
      for (const [index, size] of [10, 10, 3].entries()) {
        const group = await createGroup(user, index === 1 ? 'extra' : 'daily')
        assert.equal(group.remainingDueCount, remaining)
        assert.equal(group.items.length, size)
        assert.equal(group.session.plannedCount, size)
        assert.equal(group.session.studyOptions.studyMode, 'review-only')
        for (const item of group.items) {
          assert.equal(item.kind, 'review')
          assert.ok(dueIds.includes(item.wordId), 'only this account\'s currently due words are questions')
          assert.ok(!seen.includes(item.wordId), 'answered words must not recur in the next group')
          seen.push(item.wordId)
        }
        assert.equal((await finish(other, group)).status, 404)
        await answerItems(user, group)
        remaining -= size
        const finished = await finish(user, group)
        assert.equal(finished.status, 200, JSON.stringify(finished.raw))
        assert.equal(finished.data.session.status, 'finished')
        assert.ok(finished.data.session.finishedAt)
        assert.equal(finished.data.summary.remainingDueCount, remaining)
        assert.equal(finished.data.summary.newCount, 0)
        assert.equal(finished.data.summary.reviewCount, size)
        assert.equal(finished.data.plan.newDone, 2)
        assert.equal(finished.data.plan.reviewDone, initialReviewDone + seen.length)
        const repeated = await finish(user, group)
        assert.equal(repeated.status, 200)
        assert.equal(repeated.data.plan.reviewDone, initialReviewDone + seen.length)
      }
      assert.deepEqual([...seen].sort((a, b) => a - b), [...dueIds].sort((a, b) => a - b))
      assert.equal(new Set(seen).size, 23)
      for (const kind of ['daily', 'extra']) {
        const empty = await createGroup(user, kind)
        assert.deepEqual(empty.items, [])
        assert.equal(empty.remainingDueCount, 0)
        const finished = await finish(user, empty)
        assert.equal(finished.status, 200)
        assert.equal(finished.data.summary.remainingDueCount, 0)
      }
      const logs = await queryOne('SELECT COUNT(*) total, SUM(is_new_word) new_total FROM answer_logs WHERE user_id=?', [user.userId])
      assert.equal(Number(logs.total), 23)
      assert.equal(Number(logs.new_total), 0)
      assert.deepEqual(await queryOne('SELECT * FROM user_word_progress WHERE user_id=? AND word_id=?', [user.userId, futureId]), futureBefore)
      assert.deepEqual(await query('SELECT * FROM user_word_progress WHERE user_id=? ORDER BY word_id', [other.userId]), otherBefore)
      const otherGroup = await createGroup(other)
      assert.equal(otherGroup.remainingDueCount, 4)
      assert.equal(otherGroup.items.length, 4)
    })
  }

  test('unfinished group rejects finish, preserves due words and selects them again without skipping', async () => {
    const { user } = await fixture(10)
    const group = await createGroup(user)
    const unanswered = group.items.slice(3).map(item => item.wordId)
    const beforeRows = await query('SELECT * FROM user_word_progress WHERE user_id=? ORDER BY word_id', [user.userId])
    const initialFinish = await finish(user, group)
    assert.equal(initialFinish.status, 409)
    await answerItems(user, group, group.items.slice(0, 3))
    const partialFinish = await finish(user, group)
    assert.equal(partialFinish.status, 409)
    assert.match(partialFinish.error.message, /未作答/)
    const stored = await queryOne('SELECT * FROM study_sessions WHERE id=?', [group.session.id])
    assert.equal(stored.status, 'active')
    assert.equal(stored.finished_at, null)
    assert.equal(Number(stored.answered_count), 3)
    assert.equal(parseJson(stored.queue).filter(item => !item.answered).length, 7)
    const afterRows = await query('SELECT * FROM user_word_progress WHERE user_id=? ORDER BY word_id', [user.userId])
    assert.deepEqual(afterRows.filter(row => unanswered.includes(Number(row.word_id))), beforeRows.filter(row => unanswered.includes(Number(row.word_id))))
    const resumed = await client.get(`/api/v1/study/sessions/${group.session.id}`, { token: user.token })
    assert.equal(resumed.data.items.filter(item => !item.answered).length, 7)
    const next = await createGroup(user, 'extra')
    assert.equal(next.remainingDueCount, 20)
    assert.equal(next.plan.reviewDone, 13)
    assert.equal(next.plan.newDone, 2)
    assert.ok(unanswered.every(id => next.items.some(item => item.wordId === id)), 'all seven unanswered words remain at the live due head')
    assert.ok(group.items.slice(0, 3).every(item => !next.items.some(candidate => candidate.wordId === item.wordId)))
    await answerItems(user, group, group.items.slice(3))
    const finished = await finish(user, group)
    assert.equal(finished.status, 200)
    assert.equal(finished.data.summary.remainingDueCount, 13)
  })

  test('time budget reduces both daily and extra review-only groups below ten', async () => {
    const { user } = await fixture(10)
    const first = await createGroup(user)
    await answerItems(user, first, first.items.slice(0, 1))
    // Workload clamps 60 seconds/word, so five minutes allows five questions.
    await execute('UPDATE answer_logs SET hesitation_ms=60000 WHERE user_id=?', [user.userId])
    for (const kind of ['daily', 'extra']) {
      const group = await createGroup(user, kind, 'review-only', { budgetMinutes: 5 })
      assert.equal(group.items.length, 5)
      assert.ok(group.items.every(item => item.kind === 'review'))
      assert.equal(group.remainingDueCount, 22)
    }
  })

  test('daily new-only honors plan, extra new-only adds fresh words, legacy review-first remains mixed', async () => {
    const { user } = await fixture()
    const daily = await createGroup(user, 'daily', 'new-only')
    assert.deepEqual(daily.items, [])
    const extra = await createGroup(user, 'extra', 'new-only')
    assert.equal(extra.items.length, 10)
    assert.ok(extra.items.every(item => item.kind === 'new'))
    await answerItems(user, extra)
    assert.equal((await finish(user, extra)).data.plan.newDone, 12)
    const legacy = await client.post('/api/v1/study/sessions', { token: user.token, body: { kind: 'daily' } })
    assert.equal(legacy.status, 201)
    assert.equal(legacy.data.session.studyOptions.studyMode, 'review-first')
    assert.equal(legacy.data.items.length, 10)
    assert.ok(legacy.data.items.every(item => item.kind === 'review'))
    const mixed = await createGroup(user, 'extra', 'review-first')
    assert.equal(mixed.items.length, 10)
    assert.ok(mixed.items.every(item => ['new', 'review'].includes(item.kind)))
  })

  test('paused group remains recoverable behind newer finished, empty and unpaused sessions', async () => {
    const { user, other } = await fixture()
    const paused = await createGroup(user)
    await answerItems(user, paused, paused.items.slice(0, 1))
    const response = await client.post(`/api/v1/study/sessions/${paused.session.id}/pause`, { token: user.token })
    assert.equal(response.status, 200)
    const newer = await createGroup(user, 'extra')
    await answerItems(user, newer)
    assert.equal((await finish(user, newer)).status, 200)
    const empty = await createGroup(user, 'daily', 'new-only')
    assert.equal(empty.items.length, 0)
    assert.equal((await client.post(`/api/v1/study/sessions/${empty.session.id}/pause`, { token: user.token })).status, 200)
    const unpaused = await createGroup(user, 'extra')
    assert.ok(unpaused.items.length > 0)
    const restored = await client.get('/api/v1/study/paused-session', { token: user.token })
    assert.equal(restored.status, 200)
    assert.equal(restored.data.session.id, paused.session.id)
    assert.equal(restored.data.session.answeredCount, 1)
    assert.equal(restored.data.items.filter(item => !item.answered).length, 9)
    const isolated = await client.get('/api/v1/study/paused-session', { token: other.token })
    assert.equal(isolated.data.session, null)
  })
})
