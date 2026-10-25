import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { createSpeechService, validateSpeechAudio } from '../src/services/speech.js'
import { createSpeechRouter } from '../src/routes/speech.js'
import { createApp } from '../src/app.js'
import { errorHandler } from '../src/middleware/errorHandler.js'

const settings = () => ({ apiKey: 'secret-test-key', baseUrl: 'https://speech.example/v1', model: 'test-asr', timeoutMs: 1000, maxBytes: 2097152, maxSeconds: 60, dailyQuota: 2, perMinuteQuota: 6 })
function recording(size = 32) {
  const bytes = Buffer.alloc(size)
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(bytes)
  return { audioBase64: bytes.toString('base64'), mimeType: 'audio/webm;codecs=opus', durationMs: 1200 }
}

test('speech validation rejects forged MIME, invalid base64, excessive bytes and time before billing', () => {
  assert.equal(validateSpeechAudio(recording(), settings()).extension, 'webm')
  for (const body of [
    { ...recording(), mimeType: 'text/html' },
    { ...recording(), mimeType: 'audio/wav' },
    { ...recording(), audioBase64: 'data:audio/webm;base64,abc' },
    { ...recording(), audioBase64: 'AB==' },
    { ...recording(), durationMs: 60001 },
    { ...recording(), durationMs: '1200' },
    recording(2097153),
  ]) assert.throws(() => validateSpeechAudio(body, settings()), (error) => error.status >= 400 && error.status < 500)
})

test('speech sends only multipart audio + model with independent key and preserves mixed Chinese', async () => {
  let calls = 0
  const service = createSpeechService({ settings: settings(), fetchImpl: async (url, options) => {
    calls += 1
    assert.equal(url, 'https://speech.example/v1/audio/transcriptions')
    assert.equal(options.headers.Authorization, 'Bearer secret-test-key')
    assert.equal(options.body.get('file').name, 'practice.webm')
    assert.equal(options.body.get('file').type, 'audio/webm')
    assert.equal(options.body.get('language'), null)
    assert.equal(options.body.get('model'), 'test-asr')
    assert.equal(options.redirect, 'error')
    return Response.json({ text: 'I want to 在河边走一走' })
  } })
  assert.throws(() => validateSpeechAudio({ ...recording(), durationMs: 0 }, settings()))
  assert.equal(service.status(1).remaining, 2)
  const result = await service.transcribe(1, recording())
  assert.equal(result.text, 'I want to 在河边走一走')
  assert.equal(result.remaining, 1)
  assert.equal(service.status(2).remaining, 2)
  await service.transcribe(1, recording())
  await assert.rejects(service.transcribe(1, recording()), { code: 'QUOTA_EXCEEDED' })
  assert.equal(calls, 2)
  assert.equal(JSON.stringify(service.status(1)).includes('secret-test-key'), false)
})

test('speech unavailable configuration never contacts provider or falls back to chat key', async () => {
  for (const override of [{ apiKey: '' }, { baseUrl: 'http://speech.example/v1' }, { baseUrl: 'https://user:password@speech.example/v1' }]) {
    const service = createSpeechService({ settings: { ...settings(), ...override }, fetchImpl: () => assert.fail('must not call provider') })
    assert.equal(service.status(1).configured, false)
    await assert.rejects(service.transcribe(1, recording()), { code: 'SPEECH_NOT_CONFIGURED' })
  }
})

test('speech limits concurrent calls, counts failures and sanitizes provider error', async () => {
  let resolve
  const service = createSpeechService({ settings: settings(), fetchImpl: () => new Promise((done) => { resolve = done }) })
  const first = service.transcribe(1, recording())
  await assert.rejects(service.transcribe(1, recording()), { code: 'QUOTA_EXCEEDED' })
  resolve(new Response('private-provider-body secret-test-key', { status: 401 }))
  await assert.rejects(first, (error) => error.code === 'SPEECH_PROVIDER_ERROR' && !error.message.includes('secret-test-key'))
  assert.equal(service.status(1).remaining, 1)
})

test('speech quota rolls over by business date, rate limits requests and bounds upstream wait', async () => {
  let time = Date.UTC(2026, 9, 15, 15, 59)
  const limited = createSpeechService({ settings: { ...settings(), perMinuteQuota: 1 }, now: () => time, fetchImpl: async () => Response.json({ text: 'hello' }) })
  await limited.transcribe(1, recording())
  await assert.rejects(limited.transcribe(1, recording()), { code: 'QUOTA_EXCEEDED' })
  time += 120000
  assert.equal(limited.status(1).remaining, 2)
  const slow = createSpeechService({ settings: { ...settings(), timeoutMs: 15 }, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  }) })
  await assert.rejects(slow.transcribe(1, recording()), { code: 'SPEECH_TIMEOUT', status: 504 })
})

test('speech router authenticates before parsing large audio and accepts controlled payloads above general limit', async (t) => {
  const app = express()
  app.use('/speech', createSpeechRouter({
    authenticate: (req, res, next) => {
      if (req.headers.authorization !== 'Bearer test') return res.status(401).json({ ok: false })
      req.user = { id: 17 }
      next()
    },
    service: createSpeechService({ settings: settings(), fetchImpl: async () => Response.json({ text: 'Hello there' }) }),
  }))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/speech`
  assert.equal((await fetch(`${url}/status`)).status, 401)
  assert.equal((await fetch(`${url}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 401)
  const response = await fetch(`${url}/transcribe`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify(recording(900000)) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.text, 'Hello there')
})

test('app exposes protected speech routes while retaining 1 MB limit on other endpoints', async (t) => {
  const server = createApp().listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/api/v1`
  assert.equal((await fetch(`${url}/speech/status`)).status, 401)
  const large = JSON.stringify(recording(900000))
  assert.equal((await fetch(`${url}/speech/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: large })).status, 401)
  assert.equal((await fetch(`${url}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: large })).status, 413)
})
