import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { config } from '../src/config.js'
import { queryOne } from '../src/db/pool.js'

test('context practice validates AI feedback, stores history and queues matched weak words', async () => {
  const server = await getTestServer(), client = createClient(server.baseUrl)
  const user = await createOnboardedUser(client), other = await createOnboardedUser(client)
  const listed = await client.get('/api/v1/practice', { token: user.token })
  assert.deepEqual(listed.data.legacyScenes.map(scene => scene.id), ['library', 'hotel', 'ielts'])
  const word = await queryOne('SELECT w.* FROM words w JOIN user_profiles p ON p.wordbook_id = w.wordbook_id WHERE p.user_id = ? LIMIT 1', [user.userId])
  const originalFetch = globalThis.fetch, originalKey = config.ai.apiKey
  config.ai.apiKey = 'test-only-key'
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: 'Of course!', corrected: 'I borrowed a book.', summary: '过去时间使用过去式', corrections: [{ type: 'grammar', original: 'borrow', replacement: 'borrowed', explanation: 'yesterday 表示过去时间' }], weakWords: [word.spelling] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 50 } }), { status: 200 })
    return originalFetch(url, options)
  }
  try {
    const response = await client.post('/api/v1/practice', { token: user.token, body: { scene: 'library', answer: 'I borrow a book yesterday.' } })
    assert.equal(response.status, 200, JSON.stringify(response.raw))
    assert.equal(response.data.feedback.corrections[0].type, 'grammar')
    assert.equal(response.data.feedback.reviewWords[0].id, Number(word.id))
    assert.ok(await queryOne('SELECT id FROM user_word_progress WHERE user_id = ? AND word_id = ?', [user.userId, word.id]))
    const history = await client.get('/api/v1/practice', { token: other.token })
    assert.equal(history.data.history.length, 0)
  } finally { globalThis.fetch = originalFetch; config.ai.apiKey = originalKey }
})
