import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { execute, queryOne } from '../src/db/pool.js'
import { parseJson } from '../src/utils/json.js'

test('assessment resumes, isolates users, scores on server and persists profile result', async () => {
  const server = await getTestServer(), client = createClient(server.baseUrl)
  const user = await createOnboardedUser(client), other = await createOnboardedUser(client)
  const book = await queryOne('SELECT wordbook_id FROM user_profiles WHERE user_id = ?', [user.userId])
  try {
  for (let i = 0; i < 40; i++) {
    await execute('INSERT INTO words (wordbook_id, spelling, spelling_norm, difficulty, pos, definitions, examples) VALUES (?, ?, ?, ?, ?, ?, JSON_ARRAY())', [book.wordbook_id, `assessmentword${i}`, `assessmentword${i}`, i % 5 + 1, 'n./v.', JSON.stringify([`测评释义${i}`, `补充释义${i}`])])
  }
  const unauthorized = await client.post('/api/v1/assessment')
  assert.equal(unauthorized.status, 401)
  let response = await client.post('/api/v1/assessment', { token: user.token })
  assert.equal(response.status, 200)
  let session = response.data
  assert.equal(session.question.correctIndex, undefined)
  assert.equal(session.upcoming.correctIndex, undefined)
  assert.notEqual(session.upcoming.wordId, session.question.wordId)
  for (const question of [session.question, session.upcoming]) {
    assert.equal(question.optionDetails.length, question.options.length)
    assert.deepEqual(question.optionDetails.map(o => o.definitions.join('；')), question.options)
  }
  const resume = await client.post('/api/v1/assessment', { token: user.token })
  assert.equal(resume.data.id, session.id)
  const denied = await client.post(`/api/v1/assessment/${session.id}/answers`, { token: other.token, body: { wordId: session.question.wordId, selectedIndex: -1, rtMs: 1000 } })
  assert.equal(denied.status, 404)
  const firstBody = { wordId: session.question.wordId, selectedIndex: -1, rtMs: 1000 }
  const first = await client.post(`/api/v1/assessment/${session.id}/answers`, { token: user.token, body: firstBody })
  assert.deepEqual(first.data.question, session.upcoming)
  const duplicate = await client.post(`/api/v1/assessment/${session.id}/answers`, { token: user.token, body: firstBody })
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.data.answered, 1)
  assert.equal(duplicate.data.question.wordId, first.data.question.wordId)
  const reopened = await client.get('/api/v1/assessment', { token: user.token })
  assert.equal(reopened.data.items[0].answered, 1)
  assert.deepEqual(reopened.data.items[0].question, first.data.question)
  session = first.data
  while (session.question) {
    response = await client.post(`/api/v1/assessment/${session.id}/answers`, { token: user.token, body: { wordId: session.question.wordId, selectedIndex: -1, rtMs: 1000 } })
    assert.equal(response.status, 200)
    session = response.data
  }
  assert.equal(session.result.estimatedKnown, 0)
  assert.equal(session.result.total, 35)
  assert.equal(session.upcoming, null)
  const profile = await client.get('/api/v1/profile', { token: user.token })
  assert.equal(profile.data.profile.assessment.estimatedKnown, 0)
  const history = await client.get('/api/v1/assessment', { token: other.token })
  assert.equal(history.data.items.length, 0)

  const nextSession = await client.post('/api/v1/assessment', { token: user.token })
  const legacyId = nextSession.data.id
  const stored = await queryOne('SELECT state FROM assessment_sessions WHERE id = ?', [legacyId])
  const legacy = parseJson(stored.state)
  legacy.pool = legacy.pool.map(({ id, spelling, band, definition }) => ({ id, spelling, band, definition }))
  legacy.current.options = legacy.current.optionDetails.map(option => option.definitions[0])
  delete legacy.current.optionDetails
  delete legacy.upcoming
  await execute('UPDATE assessment_sessions SET state = ? WHERE id = ?', [JSON.stringify(legacy), legacyId])
  const restored = await client.get('/api/v1/assessment', { token: user.token })
  assert.deepEqual(restored.data.items[0].question.options, legacy.current.options)
  const upgraded = await client.post(`/api/v1/assessment/${legacyId}/answers`, {
    token: user.token,
    body: { wordId: legacy.current.wordId, selectedIndex: -1, rtMs: 1000 },
  })
  assert.equal(upgraded.status, 200)
  assert.equal(upgraded.data.answered, 1)
  assert.ok(upgraded.data.question.optionDetails.length)
  assert.ok(upgraded.data.upcoming.optionDetails.length)
  } finally {
    await execute("DELETE FROM words WHERE wordbook_id = ? AND spelling LIKE 'assessmentword%'", [book.wordbook_id])
  }
})

