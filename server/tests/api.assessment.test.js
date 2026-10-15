import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { execute, queryOne } from '../src/db/pool.js'

test('assessment resumes, isolates users, scores on server and persists profile result', async () => {
  const server = await getTestServer(), client = createClient(server.baseUrl)
  const user = await createOnboardedUser(client), other = await createOnboardedUser(client)
  const book = await queryOne('SELECT wordbook_id FROM user_profiles WHERE user_id = ?', [user.userId])
  try {
  for (let i = 0; i < 40; i++) {
    await execute('INSERT INTO words (wordbook_id, spelling, spelling_norm, difficulty, definitions, examples) VALUES (?, ?, ?, ?, ?, JSON_ARRAY())', [book.wordbook_id, `assessmentword${i}`, `assessmentword${i}`, i % 5 + 1, JSON.stringify([`测评释义${i}`])])
  }
  const unauthorized = await client.post('/api/v1/assessment')
  assert.equal(unauthorized.status, 401)
  let response = await client.post('/api/v1/assessment', { token: user.token })
  assert.equal(response.status, 200)
  let session = response.data
  assert.equal(session.question.correctIndex, undefined)
  const resume = await client.post('/api/v1/assessment', { token: user.token })
  assert.equal(resume.data.id, session.id)
  const denied = await client.post(`/api/v1/assessment/${session.id}/answers`, { token: other.token, body: { wordId: session.question.wordId, selectedIndex: -1, rtMs: 1000 } })
  assert.equal(denied.status, 404)
  const firstBody = { wordId: session.question.wordId, selectedIndex: -1, rtMs: 1000 }
  const first = await client.post(`/api/v1/assessment/${session.id}/answers`, { token: user.token, body: firstBody })
  const duplicate = await client.post(`/api/v1/assessment/${session.id}/answers`, { token: user.token, body: firstBody })
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.data.answered, 1)
  assert.equal(duplicate.data.question.wordId, first.data.question.wordId)
  session = first.data
  while (session.question) {
    response = await client.post(`/api/v1/assessment/${session.id}/answers`, { token: user.token, body: { wordId: session.question.wordId, selectedIndex: -1, rtMs: 1000 } })
    assert.equal(response.status, 200)
    session = response.data
  }
  assert.equal(session.result.estimatedKnown, 0)
  assert.equal(session.result.total, 35)
  const profile = await client.get('/api/v1/profile', { token: user.token })
  assert.equal(profile.data.profile.assessment.estimatedKnown, 0)
  const history = await client.get('/api/v1/assessment', { token: other.token })
  assert.equal(history.data.items.length, 0)
  } finally {
    await execute("DELETE FROM words WHERE wordbook_id = ? AND spelling LIKE 'assessmentword%'", [book.wordbook_id])
  }
})

