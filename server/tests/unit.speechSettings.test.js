import test from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechSettingsService, SPEECH_MODEL } from '../src/services/speechSettings.js'
import { createSpeechService } from '../src/services/speech.js'
import { isAdmin, requireAdmin } from '../src/middleware/admin.js'
import { config } from '../src/config.js'

const defaults = { apiKey: '', baseUrl: 'https://api.siliconflow.cn/v1', model: SPEECH_MODEL,
  dailyQuota: 2, perMinuteQuota: 6, maxSeconds: 60, maxBytes: 2097152, timeoutMs: 1000 }
const form = { enabled: true, apiKey: 'test-shared-speech-secret', dailyQuota: 2, perMinuteQuota: 6 }
function fixture() {
  let row = null, checks = 0
  const service = createSpeechSettingsService({ defaults, read: async () => row,
    write: async (_sql, values) => { row = { enabled: values[0], api_key_cipher: values[1], daily_quota: values[2], per_minute_quota: values[3] } },
    fetchImpl: async (url, options) => {
      checks++; assert.equal(url, 'https://api.siliconflow.cn/v1/models')
      assert.equal(options.headers.Authorization, 'Bearer '+form.apiKey)
      return Response.json({ data: [{ id: SPEECH_MODEL }] })
    },
  })
  return { service, row: () => row, checks: () => checks }
}

test('shared speech settings encrypt key, never return it, and retain it across disable/re-enable', async () => {
  const { service, row, checks } = fixture()
  assert.equal((await service.effective()).apiKey, '')
  const saved = await service.save(1, form)
  assert.equal(saved.keyConfigured, true)
  assert.equal(JSON.stringify(saved).includes(form.apiKey), false)
  assert.ok(row().api_key_cipher.startsWith('v1:'))
  assert.ok(!row().api_key_cipher.includes(form.apiKey))
  assert.equal((await service.effective()).apiKey, form.apiKey)
  await service.save(1, { ...form, apiKey: '', enabled: false })
  assert.equal((await service.effective()).apiKey, '')
  assert.equal((await service.publicSettings()).keyConfigured, true)
  await service.save(1, { ...form, apiKey: '' })
  assert.equal((await service.effective()).apiKey, form.apiKey)
  assert.equal(checks(), 2)
})

test('shared speech refuses arbitrary endpoints, missing keys, invalid quotas, and sanitizes provider failures', async () => {
  const { service } = fixture()
  for (const body of [{ ...form, baseUrl: 'https://attacker.test' }, { ...form, apiKey: '' },
    { ...form, dailyQuota: 0 }, { ...form, perMinuteQuota: 1000 }, { ...form, enabled: 'true' }]) {
    await assert.rejects(service.save(1, body), { status: 400 })
  }
  const invalid = createSpeechSettingsService({ defaults, read: async () => null,
    fetchImpl: async () => { throw new Error(form.apiKey) } })
  await assert.rejects(invalid.verify(form), error => error.code === 'SPEECH_CONFIG_INVALID' && !error.message.includes(form.apiKey))
})

test('new settings snapshots keep user quotas and active-call protection across reconfiguration', async () => {
  const budgets = new Map()
  const settings = { ...defaults, apiKey: form.apiKey }
  const recording = { audioBase64: Buffer.from([0x1a,0x45,0xdf,0xa3,...new Array(28).fill(0)]).toString('base64'), mimeType: 'audio/webm', durationMs: 1000 }
  const provider = async () => Response.json({ text: 'Hello' })
  await createSpeechService({ settings, budgets, fetchImpl: provider }).transcribe(10, recording)
  const next = createSpeechService({ settings, budgets, fetchImpl: provider })
  assert.equal(next.status(10).remaining, 1)
  assert.equal(next.status(11).remaining, 2)
  await next.transcribe(10, recording)
  await assert.rejects(next.transcribe(10, recording), { code: 'QUOTA_EXCEEDED' })
})

test('admin identity comes from server allowlist, not registration fields or client-supplied roles', () => {
  const previous = config.adminUserIds
  config.adminUserIds = ['1']
  try {
    assert.equal(isAdmin({ id: 1 }), true)
    assert.equal(isAdmin({ id: 2, role: 'admin', isAdmin: true }), false)
    assert.equal(isAdmin(null), false)
    let result
    requireAdmin({ user: { id: 2 } }, {}, error => { result = error })
    assert.equal(result.status, 403)
  } finally { config.adminUserIds = previous }
})
