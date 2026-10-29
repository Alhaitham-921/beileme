import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser, config } from './helpers/setup.js'

test('admin config is shared with keyless users; anonymous/user settings access denied; disabling overrides environment key', async () => {
  const { baseUrl } = await getTestServer()
  const client = createClient(baseUrl)
  const admin = await createOnboardedUser(client)
  const user = await createOnboardedUser(client)
  const oldIds = config.adminUserIds, oldSpeechKey = config.speech.apiKey, originalFetch = globalThis.fetch
  const key = 'integration-shared-speech-secret'
  config.adminUserIds = [String(admin.userId)]
  config.speech.apiKey = 'environment-key-must-not-override-disable'
  let audioCalls = 0
  globalThis.fetch = async (input, options) => {
    const url = String(input)
    if (url === 'https://api.siliconflow.cn/v1/models') {
      assert.equal(options.headers.Authorization, `Bearer ${key}`)
      return Response.json({ data: [{ id: 'FunAudioLLM/SenseVoiceSmall' }] })
    }
    if (url === 'https://api.siliconflow.cn/v1/audio/transcriptions') {
      assert.equal(options.headers.Authorization, `Bearer ${key}`)
      audioCalls++
      return Response.json({ text: 'I would like to book a room.' })
    }
    return originalFetch(input, options)
  }
  try {
    const endpoint = '/api/v1/speech/admin/settings'
    assert.equal((await client.get(endpoint)).status, 401)
    for (const method of ['get', 'put']) assert.equal((await client[method](endpoint, { token: user.token, body: method === 'put' ? {} : undefined })).status, 403)
    assert.equal((await client.post('/api/v1/speech/admin/test', { token: user.token, body: {} })).status, 403)
    const form = { enabled: true, apiKey: key, dailyQuota: 2, perMinuteQuota: 6 }
    const saved = await client.put(endpoint, { token: admin.token, body: form })
    assert.equal(saved.status, 200)
    assert.ok(!JSON.stringify(saved.raw).includes(key))
    const status = await client.get('/api/v1/speech/status', { token: user.token })
    assert.equal(status.data.configured, true)
    assert.equal(status.data.canManage, false)
    assert.ok(!JSON.stringify(status.raw).includes(key))
    const audio = { mimeType: 'audio/webm', durationMs: 1000,
      audioBase64: Buffer.from([0x1a,0x45,0xdf,0xa3,...new Array(28).fill(0)]).toString('base64') }
    const transcribed = await client.post('/api/v1/speech/transcribe', { token: user.token, body: audio })
    assert.equal(transcribed.status, 200)
    assert.equal(transcribed.data.text, 'I would like to book a room.')
    assert.equal(transcribed.data.remaining, 1)
    const { queryOne } = await import('../src/db/pool.js')
    const stored = await queryOne('SELECT api_key_cipher FROM shared_speech_settings WHERE id = 1')
    assert.ok(stored.api_key_cipher.startsWith('v1:'))
    assert.ok(!stored.api_key_cipher.includes(key))
    await client.put(endpoint, { token: admin.token, body: { ...form, enabled: false, apiKey: '' } })
    assert.equal((await client.get('/api/v1/speech/status', { token: user.token })).data.configured, false)
    assert.equal((await client.post('/api/v1/speech/transcribe', { token: user.token, body: audio })).status, 503)
    await client.put(endpoint, { token: admin.token, body: { ...form, apiKey: '' } })
    assert.equal((await client.get('/api/v1/speech/status', { token: user.token })).data.remaining, 1)
    assert.equal((await client.post('/api/v1/speech/transcribe', { token: user.token, body: audio })).status, 200)
    assert.equal((await client.post('/api/v1/speech/transcribe', { token: user.token, body: audio })).status, 429)
    assert.equal(audioCalls, 2)
  } finally {
    globalThis.fetch = originalFetch; config.adminUserIds = oldIds; config.speech.apiKey = oldSpeechKey
  }
})
