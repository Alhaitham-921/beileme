import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { config } from '../src/config.js'
import { queryOne } from '../src/db/pool.js'

const description = '我想练习去酒店办理入住，并向前台说明我的预订和房间要求。'
const generatedScene = () => ({
  title: '旅行中的酒店入住', location: '酒店前台', role: '酒店前台接待员', userRole: '办理入住的旅客',
  task: '向前台确认预订，询问房间情况，并说明你需要安静的房间。',
  goals: ['确认预订信息', '询问房间情况', '提出安静房间的要求'],
  targets: [
    { word: 'reservation', sense: '预订', phrase: 'a reservation', example: 'I have a reservation for tonight.' },
    { word: 'quiet', sense: '安静的', phrase: 'a quiet room', example: 'Could I have a quiet room, please?' },
    { word: 'available', sense: '可用的', phrase: 'a room available', example: 'Is a room available on the top floor?' },
  ],
  opening: 'Welcome to our hotel. Do you have a reservation?', openingTranslation: '欢迎来到我们酒店。您有预订吗？',
  example: 'I have a reservation. Is a quiet room available?',
})
const report = { summary: '你已经完成入住交流，可以尝试说明更多房间要求。', corrections: [], weakWords: [], reinforcement: [], grammarWeaknesses: [] }

async function withMockAi(respond, run) {
  const originalFetch = globalThis.fetch, oldKey = config.ai.apiKey
  const calls = []
  config.ai.apiKey = 'scenario-test-only-key'
  globalThis.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return originalFetch(url, options)
    const body = JSON.parse(options.body)
    calls.push(body)
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(respond(body)) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 40, completion_tokens: 100 },
    }), { status: 200 })
  }
  try { await run(calls) }
  finally { globalThis.fetch = originalFetch; config.ai.apiKey = oldKey }
}

async function waitReport(client, user, id) {
  for (let i = 0; i < 150; i++) {
    const response = await client.get(`/api/v1/practice/sessions/${id}`, { token: user.token })
    assert.equal(response.status, 200, JSON.stringify(response.raw))
    if (response.data.status !== 'analyzing') return response.data
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('Scenario report did not finish')
}

test('AI scenarios persist their brief and vocabulary and are private to the owning account', async () => {
  const { baseUrl } = await getTestServer(), client = createClient(baseUrl)
  const user = await createOnboardedUser(client), other = await createOnboardedUser(client)
  await withMockAi(generatedScene, async calls => {
    const unauthenticated = await client.post('/api/v1/practice/scenes/generate', { body: { description } })
    assert.equal(unauthenticated.status, 401)
    const created = await client.post('/api/v1/practice/scenes/generate', { token: user.token, body: { description, difficulty: 'intermediate' } })
    assert.equal(created.status, 201, JSON.stringify(created.raw))
    const scene = created.data.scene
    assert.match(scene.id, /^custom-\d+$/)
    assert.equal(scene.source, 'custom')
    assert.equal(scene.saved, true)
    assert.equal(scene.description, description)
    assert.equal(scene.difficulty, 'intermediate')
    assert.deepEqual(scene.targets, generatedScene().targets)
    assert.equal(calls.length, 1)
    assert.equal(created.data.usage.totalTokens, 140)
    assert.ok(calls[0].messages.some(message => message.role === 'user' && message.content.includes(description)))
    const listing = await client.get('/api/v1/practice', { token: user.token })
    assert.equal(listing.data.savedScenes.find(item => item.id === scene.id)?.title, scene.title)
    const otherListing = await client.get('/api/v1/practice', { token: other.token })
    assert.ok(!otherListing.data.savedScenes.some(item => item.id === scene.id))
    assert.equal((await client.post('/api/v1/practice/sessions', { token: other.token, body: { sceneId: scene.id } })).status, 404)
    assert.equal((await client.post('/api/v1/practice/scenes/save', { token: other.token, body: { sceneId: scene.id } })).status, 404)
    const savedAgain = await client.post('/api/v1/practice/scenes/save', { token: user.token, body: { sceneId: scene.id } })
    assert.ok(savedAgain.ok, JSON.stringify(savedAgain.raw))
    assert.equal(savedAgain.data.scene.id, scene.id)
    assert.equal((await client.get('/api/v1/practice', { token: user.token })).data.savedScenes.length, 1)
    const ledger = await queryOne('SELECT calls, prompt_tokens, completion_tokens FROM dialogue_daily_usage WHERE user_id = ?', [user.userId])
    assert.equal(ledger.calls, 1)
    assert.equal(ledger.prompt_tokens, 40)
    assert.equal(ledger.completion_tokens, 100)
  })
})

test('invalid scenario descriptions and malformed AI output never create partial saved scenes', async () => {
  const { baseUrl } = await getTestServer(), client = createClient(baseUrl)
  const user = await createOnboardedUser(client)
  await withMockAi(() => ({ title: '不完整的场景', targets: [] }), async calls => {
    for (const body of [{ description: 'hi' }, { description: 'x'.repeat(1501) }, { description, difficulty: 'expert' }]) {
      const invalid = await client.post('/api/v1/practice/scenes/generate', { token: user.token, body })
      assert.equal(invalid.status, 400, JSON.stringify(invalid.raw))
    }
    assert.equal(calls.length, 0)
    const failed = await client.post('/api/v1/practice/scenes/generate', { token: user.token, body: { description } })
    assert.equal(failed.status, 503, JSON.stringify(failed.raw))
    assert.equal(calls.length, 2)
    assert.equal(failed.error.details.usage.totalTokens, 280)
    const listing = await client.get('/api/v1/practice', { token: user.token })
    assert.deepEqual(listing.data.savedScenes, [])
    assert.deepEqual(listing.data.sessions, [])
    const ledger = await queryOne('SELECT calls, prompt_tokens, completion_tokens FROM dialogue_daily_usage WHERE user_id = ?', [user.userId])
    assert.equal(ledger.calls, 2)
    assert.equal(ledger.prompt_tokens, 80)
    assert.equal(ledger.completion_tokens, 200)
  })
})

test('saving classic scenes is idempotent while preserving distinct bank variants', async () => {
  const { baseUrl } = await getTestServer(), client = createClient(baseUrl)
  const user = await createOnboardedUser(client)
  const save = variant => client.post('/api/v1/practice/scenes/save', { token: user.token, body: { sceneId: 'bank', variant, difficulty: 'beginner' } })
  const [first, duplicate] = await Promise.all([save('river'), save('river')])
  assert.ok(first.ok, JSON.stringify(first.raw))
  assert.ok(duplicate.ok, JSON.stringify(duplicate.raw))
  assert.equal(first.data.scene.id, duplicate.data.scene.id)
  assert.equal(first.data.scene.source, 'classic')
  assert.equal(first.data.scene.targets.find(item => item.word === 'bank').sense, '河岸')
  const finance = await save('finance')
  assert.ok(finance.ok, JSON.stringify(finance.raw))
  assert.notEqual(finance.data.scene.id, first.data.scene.id)
  assert.equal(finance.data.scene.targets.find(item => item.word === 'bank').sense, '银行')
  const listing = await client.get('/api/v1/practice', { token: user.token })
  assert.equal(listing.data.savedScenes.length, 2)
  for (const id of ['hotel', 'interview', 'shopping', 'campus']) assert.ok(listing.data.scenes.some(scene => scene.id === id))
})

test('free dialogue continues beyond eight turns and repeats the saved scenario without reusing progress', async () => {
  const { baseUrl } = await getTestServer(), client = createClient(baseUrl)
  const user = await createOnboardedUser(client), other = await createOnboardedUser(client)
  let generating = true
  await withMockAi(body => generating ? generatedScene() : body.messages[0].content.includes('复盘教练') ? report : {
    reply: 'Your reservation is confirmed. What else would make your stay comfortable?', translation: '您的预订已确认。还有什么能让您住得更舒适？',
    mixedLanguage: false, corrections: [], usedTargets: [{ word: 'reservation', sense: '预订', correct: true }], taskComplete: true,
  }, async calls => {
    const created = await client.post('/api/v1/practice/scenes/generate', { token: user.token, body: { description, difficulty: 'intermediate' } })
    assert.equal(created.status, 201, JSON.stringify(created.raw))
    generating = false
    const started = await client.post('/api/v1/practice/sessions', { token: user.token, body: { sceneId: created.data.scene.id, mode: 'free', maxTurns: 16, difficulty: 'intermediate' } })
    assert.equal(started.status, 201, JSON.stringify(started.raw))
    const id = started.data.id, base = `/api/v1/practice/sessions/${id}`
    assert.equal(started.data.mode, 'free')
    assert.equal(started.data.maxTurns, 16)
    assert.equal(started.data.scene.title, generatedScene().title)
    const assisted = await client.post(`${base}/help`, { token: user.token, body: { level: 2, word: 'reservation', expectedTurn: 0 } })
    assert.equal(assisted.status, 200, JSON.stringify(assisted.raw))
    for (let i = 0; i < 9; i++) {
      const response = await client.post(`${base}/turns`, { token: user.token, body: { text: 'I have a reservation for tonight.', expectedTurn: i } })
      assert.equal(response.status, 200, JSON.stringify(response.raw))
      assert.equal(response.data.status, 'active', `Free conversation ended on turn ${i + 1}`)
      assert.equal(response.data.turnCount, i + 1)
    }
    const beyondEightHelp = await client.post(`${base}/help`, { token: user.token, body: { level: 2, word: 'quiet', expectedTurn: 9 } })
    assert.equal(beyondEightHelp.status, 200, JSON.stringify(beyondEightHelp.raw))
    await client.post(`${base}/finish`, { token: user.token })
    const ended = await waitReport(client, user, id)
    assert.equal(ended.status, 'finished', JSON.stringify(ended))
    assert.equal(ended.messages.length, 19)
    assert.ok(ended.helpEvents.length > 0)
    const beforeRepeatCalls = calls.length
    assert.equal((await client.post(`${base}/repeat`, { token: other.token, body: {} })).status, 404)
    const repeated = await client.post(`${base}/repeat`, { token: user.token, body: { difficulty: 'advanced', strictness: 'strict', mode: 'task', maxTurns: 24 } })
    assert.equal(repeated.status, 201, JSON.stringify(repeated.raw))
    const fresh = repeated.data
    assert.notEqual(fresh.id, id)
    assert.equal(fresh.scene.title, ended.scene.title)
    assert.deepEqual(fresh.scene.targets, ended.scene.targets)
    assert.equal(fresh.status, 'active')
    assert.equal(fresh.difficulty, 'advanced')
    assert.equal(fresh.strictness, 'strict')
    assert.equal(fresh.mode, 'task')
    assert.equal(fresh.maxTurns, 24)
    assert.equal(fresh.turnCount, 0)
    assert.equal(fresh.messages.length, 1)
    assert.equal(fresh.report, null)
    assert.equal(fresh.reportAttempts, 0)
    assert.deepEqual(fresh.helpEvents, [])
    assert.ok(fresh.targetUsage.every(target => target.status === 'unused' && !target.attempts && !target.independent))
    assert.equal(Number(fresh.usage?.calls || 0), 0)
    assert.equal(calls.length, beforeRepeatCalls)
    const original = await client.get(base, { token: user.token })
    assert.equal(original.data.turnCount, 9)
    assert.equal(original.data.status, 'finished')
    assert.equal(original.data.messages.length, 19)
  })
})

test('selected word IDs become mandatory scene targets', async () => {
 const { baseUrl } = await getTestServer(), client = createClient(baseUrl)
 const user = await createOnboardedUser(client)
 const word = (await client.get('/api/v1/words/books/fixture-demo/words?size=1')).data.items[0]
 await withMockAi(body => {
  const input = JSON.parse(body.messages[1].content)
  assert.deepEqual(input.targetWords, [word.spelling.toLowerCase()])
  const raw = generatedScene()
  raw.targets = [{ word: word.spelling, sense: '练习词', phrase: `the ${word.spelling}`, example: `I said ${word.spelling}.` }]
  return raw
 }, async () => {
  const response = await client.post('/api/v1/practice/scenes/generate', { token: user.token, body: { description, wordIds: [word.id] } })
  assert.equal(response.status, 201, JSON.stringify(response.raw))
  assert.deepEqual(response.data.scene.words, [word.spelling.toLowerCase()])
 })
})
