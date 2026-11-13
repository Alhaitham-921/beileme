import assert from 'node:assert/strict'
import test from 'node:test'
import { config } from '../src/config.js'
import { createClient, createOnboardedUser, getTestServer } from './helpers/setup.js'

test('查词优先返回词库的英文精确匹配和中文释义匹配，只有未收录才调用 AI', async t => {
  const server = await getTestServer()
  const client = createClient(server.baseUrl)
  const { token } = await createOnboardedUser(client)
  const path = '/api/v1/words/lookup'
  const search = q => client.get(`${path}?q=${encodeURIComponent(q)}`, { token })
  const supplement = q => client.post(path + '/ai', { token, body: { q } })
  const original = { ...config.ai }
  t.after(() => Object.assign(config.ai, original))
  config.ai.apiKey = ''

  assert.equal((await client.get(path + '?q=abandon')).status, 401)
  assert.equal((await search('   ')).status, 400)
  assert.equal((await search('%')).status, 400)
  const noProvider = await supplement('photosynthesis')
  assert.equal(noProvider.error.code, 'WORD_LOOKUP_AI_UNAVAILABLE')

  Object.assign(config.ai, { apiKey: 'test-key', baseUrl: 'https://lookup.example.test/v1' })
  const realFetch = globalThis.fetch
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url !== 'https://lookup.example.test/v1/chat/completions') return realFetch(url, options)
    const { query } = JSON.parse(JSON.parse(options.body).messages[1].content)
    requests.push(query)
    let reply
    if (query === 'notaword') reply = { found: false }
    else reply = { found: true, entry: { spelling: 'photosynthesis', pos: 'n.', definitions: ['光合作用'] } }
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] })
  })

  const exact = await search('　ＡＢＡＮＤＯＮ　')
  assert.equal(exact.data.source, 'wordbook')
  assert.ok(exact.data.entries[0].definitions.includes('放弃'))
  const reverse = await search('放弃')
  assert.equal(reverse.data.source, 'wordbook')
  assert.ok(reverse.data.entries.some(entry => entry.spelling === 'abandon'))
  assert.equal((await supplement('abandon')).data.source, 'wordbook')
  const prefix = await search('aband')
  assert.equal(prefix.data.source, 'missing')
  assert.ok(prefix.data.suggestions.includes('abandon'))
  assert.equal((await search('photosynthesis')).data.source, 'missing')
  assert.deepEqual(requests, [])

  const results = await Promise.all([supplement('photosynthesis'), supplement('PHOTOSYNTHESIS')])
  for (const response of results) {
    assert.equal(response.data.source, 'ai')
    assert.deepEqual(response.data.entries[0].definitions, ['光合作用'])
  }
  assert.deepEqual(requests, ['photosynthesis'])
  assert.equal((await supplement('photosynthesis')).data.cached, true)
  assert.deepEqual(requests, ['photosynthesis'])
  assert.deepEqual((await supplement('notaword')).data.entries, [])
  const wrongSpelling = await supplement('xylophone')
  assert.equal(wrongSpelling.status, 502)
  assert.equal(wrongSpelling.error.code, 'WORD_LOOKUP_AI_FAILED')
})
