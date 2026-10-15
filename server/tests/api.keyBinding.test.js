import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { saveUserKey, getActiveUserKey } from '../src/services/ai/apiKeyService.js'

test('saved key survives logout/login; empty-key edits and model listing reuse only own account', async () => {
  const server = await getTestServer(), client = createClient(server.baseUrl)
  const user = await createOnboardedUser(client), other = await createOnboardedUser(client)
  const mock = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url.endsWith('/models')) res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-mini' }] }))
    else { req.resume(); res.end(JSON.stringify({ model: 'mock-mini', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })) }
  })
  mock.listen(0); await once(mock, 'listening')
  try {
    const plain = 'sk-account-persistence-test'
    await saveUserKey(user.userId, { provider: 'custom', apiKey: plain, baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, model: 'mock-model' })
    await client.post('/api/v1/auth/logout', { token: user.token })
    const login = await client.post('/api/v1/auth/login', { body: { account: user.email, password: user.password } })
    assert.equal(login.status, 200)
    const token = login.data.tokens.accessToken
    const status = await client.get('/api/v1/ai/status', { token })
    assert.equal(status.data.mode, 'user')
    assert.ok(!JSON.stringify(status.data).includes(plain))
    const models = await client.post('/api/v1/ai/models', { token, body: { provider: 'custom', apiKey: '' } })
    assert.equal(models.status, 200)
    assert.ok(models.data.models.includes('mock-mini'))
    const saved = await client.put('/api/v1/ai/keys', { token, body: { provider: 'custom', apiKey: '', model: 'mock-mini' } })
    assert.equal(saved.status, 201, JSON.stringify(saved.raw))
    const active = await getActiveUserKey(user.userId)
    assert.equal(active.apiKey, plain)
    assert.equal(active.model, 'mock-mini')
    const denied = await client.post('/api/v1/ai/models', { token: other.token, body: { provider: 'custom', apiKey: '' } })
    assert.equal(denied.status, 400)
    const isolated = await client.get('/api/v1/ai/keys', { token: other.token })
    assert.equal(isolated.data.items.length, 0)
  } finally { await new Promise(resolve => mock.close(resolve)) }
})
