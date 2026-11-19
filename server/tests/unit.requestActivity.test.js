import test from 'node:test'
import assert from 'node:assert/strict'
import { beginRequest, hasActivity, navigating } from '../../src/stores/activity.js'
import { request, setTokens } from '../../src/api/client.js'

test('activity remains visible until every request finishes; release is idempotent', () => {
  const first = beginRequest(), second = beginRequest()
  assert.equal(hasActivity.value, true)
  first(); first()
  assert.equal(hasActivity.value, true)
  second()
  assert.equal(hasActivity.value, false)
  navigating.value = true
  const finish = beginRequest()
  finish()
  assert.equal(hasActivity.value, true)
  navigating.value = false
  assert.equal(hasActivity.value, false)
})

test('request activity includes reading the response body', async t => {
  let resolveBody
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, text: () => new Promise(resolve => { resolveBody = resolve }) }))
  const result = request('GET', '/example', { auth: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(hasActivity.value, true)
  resolveBody('{"ok":true,"data":{"saved":true}}')
  assert.deepEqual(await result, { saved: true })
  assert.equal(hasActivity.value, false)
})

test('failed, cancelled, and blob requests release their loading state', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  await assert.rejects(request('GET', '/example', { auth: false }), { code: 'NETWORK_ERROR' })
  assert.equal(hasActivity.value, false)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(request('GET', '/example', { signal: controller.signal, auth: false }), { code: 'REQUEST_CANCELLED' })
  assert.equal(hasActivity.value, false)
  mock.mock.mockImplementation(async () => new Response(new Blob(['image'])))
  assert.equal(await (await request('GET', '/example', { auth: false, responseType: 'blob' })).text(), 'image')
  assert.equal(hasActivity.value, false)
})

test('authentication refresh and replay complete without leaving activity stuck', async t => {
  setTokens({ accessToken: 'expired', refreshToken: 'refresh' })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    assert.equal(hasActivity.value, true)
    if (calls === 1) return new Response('{}', { status: 401 })
    if (calls === 2) return Response.json({ ok: true, data: { tokens: { accessToken: 'new', refreshToken: 'refresh' } } })
    return Response.json({ ok: true, data: { restored: true } })
  })
  try {
    assert.deepEqual(await request('GET', '/example'), { restored: true })
    assert.equal(calls, 3)
    assert.equal(hasActivity.value, false)
  } finally { setTokens(null) }
})
