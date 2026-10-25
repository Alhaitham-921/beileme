import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { config } from '../src/config.js'
import { execute, queryOne } from '../src/db/pool.js'

test('second-turn whitespace JSON output retries without response_format and retains all usage', async () => {
  const client = createClient((await getTestServer()).baseUrl)
  const user = await createOnboardedUser(client), token = user.token
  await client.put('/api/v1/ai/limits', { token, body: { preset: 'unlimited' } })
  const originalFetch = globalThis.fetch, originalKey = config.ai.apiKey
  const bodies = []
  config.ai.apiKey = 'test-only-key'
  globalThis.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return originalFetch(url, options)
    const body = JSON.parse(options.body); bodies.push(body)
    const blank = bodies.length === 2
    const content = { reply: 'Would you like to sit here?', translation: '你想坐这里吗？', corrections: [], usedTargets: [], mixedLanguage: false, taskComplete: false }
    return new Response(JSON.stringify({ choices: [{ message: { content: blank ? ' '.repeat(28) : JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: blank ? 25 : 100 } }), { status: 200 })
  }
  try {
    const started = await client.post('/api/v1/practice/sessions', { token, body: { sceneId: 'bank' } })
    const base = `/api/v1/practice/sessions/${started.data.id}`
    assert.equal((await client.post(`${base}/turns`, { token, body: { text: 'Hello!', expectedTurn: 0 } })).status, 200)
    const second = await client.post(`${base}/turns`, { token, body: { text: 'May I sit here?', expectedTurn: 1 } })
    assert.equal(second.status, 200, JSON.stringify(second.raw))
    assert.equal(second.data.turnCount, 2)
    assert.equal(second.data.lastUsage.totalTokens, 205)
    assert.equal(second.data.usage.totalTokens, 345)
    assert.equal(second.data.lastUsage.retried, true)
    assert.equal(second.data.lastAiError.whitespaceOnly, true)
    assert.equal(second.data.lastAiError.recovered, true)
    assert.deepEqual(bodies[1].response_format, { type: 'json_object' })
    assert.equal(bodies[2].response_format, undefined)
    const input = JSON.parse(bodies[1].messages.at(-1).content)
    assert.equal(input.currentUserText, 'May I sit here?')
    assert.equal(input.transcript.length, 3)
    assert.deepEqual(bodies[1].messages.map(m => m.role), ['system', 'user'])
    assert.ok(bodies.every(body => !('max_tokens' in body)))
    const restored = await client.get(base, { token })
    assert.equal(restored.data.turnCount, 2)
    assert.equal(restored.data.messages.filter(m => m.role === 'user').length, 2)
    await client.post(`${base}/turns`, { token, body: { text: 'Thank you!', expectedTurn: 2 } })
    assert.deepEqual(bodies[3].response_format, { type: 'json_object' })
  } finally { globalThis.fetch = originalFetch; config.ai.apiKey = originalKey }
})

test('unlimited persists, bypasses daily caps, omits max_tokens, and tracks second-turn retries and failures', async () => {
  const client = createClient((await getTestServer()).baseUrl)
  const user = await createOnboardedUser(client)
  const token = user.token
  const saved = await client.put('/api/v1/ai/limits', { token, body: { preset: 'unlimited' } })
  assert.equal(saved.data.limits.unlimited, true)
  assert.equal((await client.get('/api/v1/ai/limits', { token })).data.limits.unlimited, true)
  assert.equal((await client.put('/api/v1/ai/limits', { token, body: { unlimited: 'false' } })).status, 400)
  const originalFetch = globalThis.fetch, originalKey = config.ai.apiKey
  config.ai.apiKey = 'test-unlimited-key'
  let mode = 'valid', calls = 0, truncated = false
  const bodies = []
  globalThis.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return originalFetch(url, options)
    const body = JSON.parse(options.body); bodies.push(body); calls++
    if (mode === 'rate') return new Response('quota exhausted', { status: 429 })
    const content = { reply: 'Would you like to sit here?', translation: '你想坐这里吗？', corrections: [], usedTargets: [], mixedLanguage: false, taskComplete: false }
    const length = mode === 'truncate' && !truncated
    if (length) truncated = true
    return new Response(JSON.stringify({ choices: [{ message: { content: length ? '{' : mode === 'invalid' ? '{}' : JSON.stringify(content) }, finish_reason: length ? 'length' : 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 100 } }), { status: 200 })
  }
  try {
    const started = await client.post('/api/v1/practice/sessions', { token, body: { sceneId: 'bank' } })
    assert.equal(started.status, 201)
    const base = `/api/v1/practice/sessions/${started.data.id}`
    await execute('INSERT INTO dialogue_daily_usage (user_id,usage_date,calls) VALUES (?,CURRENT_DATE(),200)', [user.userId])
    // Use the app's business-day key (host timezone can differ).
    const { todayKey } = await import('../src/utils/time.js')
    await execute('UPDATE dialogue_daily_usage SET usage_date=? WHERE user_id=?', [todayKey(), user.userId])
    const first = await client.post(`${base}/turns`, { token, body: { text: 'Hello!', expectedTurn: 0 } })
    assert.equal(first.status, 200, JSON.stringify(first.raw))
    assert.equal(first.data.lastUsage.totalTokens, 140)
    mode = 'truncate'
    const second = await client.post(`${base}/turns`, { token, body: { text: 'May I sit here?', expectedTurn: 1 } })
    assert.equal(second.status, 200, JSON.stringify(second.raw))
    assert.equal(second.data.turnCount, 2)
    assert.equal(second.data.lastUsage.calls, 2)
    assert.equal(second.data.messages.at(-1).usage.totalTokens, 280)
    assert.equal(second.data.usage.totalTokens, 420)
    assert.ok(bodies.every(body => !('max_tokens' in body)))
    mode = 'invalid'
    const failed = await client.post(`${base}/turns`, { token, body: { text: 'Hello again!', expectedTurn: 2 } })
    assert.equal(failed.status, 503)
    assert.equal(failed.raw.error.details.usage.totalTokens, 280)
    const restored = await client.get(base, { token })
    assert.equal(restored.data.turnCount, 2)
    assert.equal(restored.data.usage.totalTokens, 700)
    mode = 'rate'
    const before = calls
    const rate = await client.post(`${base}/turns`, { token, body: { text: 'Hello!', expectedTurn: 2 } })
    assert.equal(rate.status, 429)
    assert.equal(rate.raw.error.details.reason, 'rate_limited')
    assert.equal(calls - before, 1)
    assert.equal(rate.raw.error.details.usage.unknownCalls, 1)
    const ledger = await queryOne('SELECT * FROM dialogue_daily_usage WHERE user_id=?', [user.userId])
    assert.equal(Number(ledger.prompt_tokens), 200)
    assert.equal(Number(ledger.completion_tokens), 500)
    const status = await client.get('/api/v1/ai/status', { token })
    assert.equal(status.data.usage.dialogue.promptTokens, 200)
    assert.ok(status.data.summary.totals.completionTokens >= 500)
    await client.put('/api/v1/ai/limits', { token, body: { preset: 'balanced' } })
    assert.equal((await client.get('/api/v1/ai/limits', { token })).data.limits.unlimited, false)
    assert.equal((await client.post(`${base}/turns`, { token, body: { text: 'Hello!', expectedTurn: 2 } })).status, 429)
  } finally { globalThis.fetch = originalFetch; config.ai.apiKey = originalKey }
})
