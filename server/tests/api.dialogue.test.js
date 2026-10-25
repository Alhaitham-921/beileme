import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { config } from '../src/config.js'
import { query, queryOne, execute } from '../src/db/pool.js'

async function dialogueUser(client) {
  const user = await createOnboardedUser(client)
  const book = await execute("INSERT INTO wordbooks (code,name,scope,is_builtin,word_count) VALUES (?, '情境测试词书', '自定义', 0, 3)", [`dialogue-${user.userId}`])
  await execute('UPDATE user_profiles SET wordbook_id = ? WHERE user_id = ?', [book.insertId, user.userId])
  for (const spelling of ['bank', 'sit', 'nearby']) {
    await execute(`INSERT INTO words (wordbook_id,spelling,spelling_norm,definitions,examples) VALUES (?,?,?, ?, '[]')`, [book.insertId, spelling, spelling, JSON.stringify(['测试释义'])])
  }
  return user
}

async function waitReport(client, user, id) {
  for (let i = 0; i < 150; i++) {
    const response = await client.get(`/api/v1/practice/sessions/${id}`, { token: user.token })
    if (response.data.status !== 'analyzing') return response.data
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('Report did not finish')
}

test('multi-turn dialogue records assistance, sense evidence and idempotent SRS feedback', async () => {
  const server = await getTestServer(), client = createClient(server.baseUrl)
  const user = await dialogueUser(client), other = await createOnboardedUser(client)
  const originalFetch = globalThis.fetch, oldKey = config.ai.apiKey
  config.ai.apiKey = 'dialogue-test-only-key'
  let aiCalls = 0, mode = 'normal'
  globalThis.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return originalFetch(url, options)
    aiCalls++
    const body = JSON.parse(options.body)
    const isReport = body.messages[0].content.includes('复盘教练')
    const content = mode === 'invalid' ? { reply: 'invalid' } : isReport
      ? { summary: '你完成了河岸对话，bank 需要进一步练习。', corrections: [], weakWords: ['bank'], reinforcement: [{ word: 'bank', prompt: '我想沿河岸散步。', answer: 'I would like to walk along the river bank.', explanation: 'bank 在这里表示河岸。' }], grammarWeaknesses: [] }
      : { reply: 'Yes, there is a path along the river bank nearby. Would you like to sit here?', translation: '附近有沿河岸的小路。你想坐这里吗？', mixedLanguage: false, corrections: [], usedTargets: [{ word: 'bank', sense: '河岸', correct: true }, { word: 'nearby', sense: '在附近', correct: true }], taskComplete: false }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 100 } }), { status: 200 })
  }
  try {
    const listing = await client.get('/api/v1/practice', { token: user.token })
    assert.deepEqual(listing.data.scenes.map(s => s.id), ['restaurant', 'directions', 'bank'])
    const created = await client.post('/api/v1/practice/sessions', { token: user.token, body: { sceneId: 'bank', strictness: 'strict', difficulty: 'beginner' } })
    assert.equal(created.status, 201, JSON.stringify(created.raw))
    const id = created.data.id, base = `/api/v1/practice/sessions/${id}`
    assert.equal((await client.get(base, { token: other.token })).status, 404)
    const help = await client.post(`${base}/help`, { token: user.token, body: { level: 4, word: 'bank', expectedTurn: 0 } })
    assert.equal(help.status, 200, JSON.stringify(help.raw))
    assert.equal(help.data.help.level, 4)
    assert.equal(aiCalls, 0)
    const turn = await client.post(`${base}/turns`, { token: user.token, body: { text: 'Is there a path along the river bank nearby?', expectedTurn: 0 } })
    assert.equal(turn.status, 200, JSON.stringify(turn.raw))
    assert.equal(turn.data.turnCount, 1)
    assert.equal(turn.data.targetUsage.find(t => t.word === 'bank').status, 'assisted')
    assert.equal((await client.post(`${base}/turns`, { token: user.token, body: { text: 'Hello', expectedTurn: 0 } })).status, 409)
    await client.post(`${base}/finish`, { token: user.token })
    const ended = await waitReport(client, user, id)
    assert.equal(ended.status, 'finished', JSON.stringify(ended))
    assert.ok(ended.report.reviewWords.some(w => w.spelling === 'bank'))
    const e = await queryOne('SELECT * FROM dialogue_word_evidence WHERE session_id = ? AND spelling = ?', [id, 'bank'])
    assert.equal(e.help_level, 4)
    assert.notEqual(e.result, 'independent')
    assert.ok(Number(e.weight) >= 2)
    const p = await queryOne('SELECT * FROM user_word_progress WHERE user_id = ? AND word_id = ?', [user.userId, e.word_id])
    assert.ok(new Date(p.next_review_at).getTime() <= Date.now())
    await client.post(`${base}/finish`, { token: user.token })
    const p2 = await queryOne('SELECT times_seen FROM user_word_progress WHERE id = ?', [p.id])
    assert.equal(p2.times_seen, p.times_seen)
    assert.equal((await query('SELECT * FROM dialogue_word_evidence WHERE session_id = ? AND spelling = ?', [id, 'bank'])).length, 1)

    // Invalid structured output retries twice and never adds a partial turn to the transcript.
    const next = await client.post('/api/v1/practice/sessions', { token: user.token, body: { sceneId: 'bank' } })
    mode = 'invalid'
    const before = aiCalls
    const rejected = await client.post(`/api/v1/practice/sessions/${next.data.id}/turns`, { token: user.token, body: { text: 'Hello', expectedTurn: 0 } })
    assert.equal(rejected.status, 503)
    assert.equal(aiCalls - before, 2)
    const intact = await client.get(`/api/v1/practice/sessions/${next.data.id}`, { token: user.token })
    assert.equal(intact.data.turnCount, 0)
    assert.equal(intact.data.messages.length, 1)
  } finally { globalThis.fetch = originalFetch; config.ai.apiKey = oldKey }
})

test('independent usage extends review intervals and auto ends at eight turns', async () => {
  const server = await getTestServer(), client = createClient(server.baseUrl)
  const user = await dialogueUser(client)
  const book = await queryOne('SELECT wordbook_id id FROM user_profiles WHERE user_id = ?', [user.userId])
  const bank = await queryOne('SELECT id FROM words WHERE wordbook_id = ? AND spelling_norm = ?', [book.id, 'bank'])
  await execute(`INSERT INTO user_word_progress (user_id,word_id,wordbook_id,first_learned_at,interval_days,repetitions,next_review_at)
    VALUES (?,?,?,UTC_TIMESTAMP(),30,4,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY))`, [user.userId, bank.id, book.id])
  const originalFetch = globalThis.fetch, oldKey = config.ai.apiKey
  config.ai.apiKey = 'dialogue-test-only-key'
  globalThis.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return originalFetch(url, options)
    const body = JSON.parse(options.body)
    const content = body.messages[0].content.includes('复盘教练')
      ? { summary: 'bank 的河岸义使用正确。', corrections: [], weakWords: [], reinforcement: [], grammarWeaknesses: [] }
      : { reply: 'The river bank is nearby. What would you like to do next?', translation: '', mixedLanguage: false, corrections: [], usedTargets: [{ word: 'bank', sense: '河岸', correct: true }], taskComplete: false }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 100 } }), { status: 200 })
  }
  try {
    let { data: session } = await client.post('/api/v1/practice/sessions', { token: user.token, body: { sceneId: 'bank' } })
    for (let i = 0; i < 8; i++) {
      const response = await client.post(`/api/v1/practice/sessions/${session.id}/turns`, { token: user.token, body: { text: 'I would like to walk along the river bank.', expectedTurn: i } })
      assert.equal(response.status, 200, JSON.stringify(response.raw))
      session = response.data
    }
    const ended = await waitReport(client, user, session.id)
    assert.equal(ended.status, 'finished', JSON.stringify(ended))
    assert.equal(ended.turnCount, 8)
    const progress = await queryOne('SELECT interval_days,times_seen FROM user_word_progress WHERE user_id = ? AND word_id = ?', [user.userId, bank.id])
    assert.ok(Number(progress.interval_days) > 30)
    assert.equal(progress.times_seen, 1) // one evidence update per dialogue, not per mention
    assert.equal(ended.report.reviewWords.length, 0)
  } finally { globalThis.fetch = originalFetch; config.ai.apiKey = oldKey }
})

test('Chinese assistance waits for repetition and failed reports can retry without losing history', async () => {
  const server = await getTestServer(), client = createClient(server.baseUrl)
  const user = await createOnboardedUser(client) // chosen fixture book has no bank/sit: exercise dialogue-core fallback
  const originalFetch = globalThis.fetch, oldKey = config.ai.apiKey
  config.ai.apiKey = 'dialogue-test-only-key'
  let failReport = true
  globalThis.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return originalFetch(url, options)
    const body = JSON.parse(options.body)
    const isReport = body.messages[0].content.includes('复盘教练')
    const content = isReport && failReport ? {} : isReport
      ? { summary: '先复述示范，再独立表达。', corrections: [], weakWords: ['bank'], reinforcement: [{ word: 'bank', prompt: '附近有河岸小路吗？', answer: 'Is there a path along the river bank nearby?', explanation: '此处 bank 表示河岸。' }], grammarWeaknesses: [] }
      : { reply: 'Try saying: I sat by the river bank yesterday.', translation: '可以跟着说一遍。', mixedLanguage: true, helpWord: 'bank', helpEnglish: 'I sat by the river bank yesterday.', corrections: [],
        usedTargets: JSON.parse(body.messages.at(-1).content).currentUserText === 'I sat by the river bank yesterday.'
          ? [{ word: 'bank', sense: '河岸', correct: true }, { word: 'sit', sense: '坐', correct: true }] : [], taskComplete: false }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 50 } }), { status: 200 })
  }
  try {
    const started = await client.post('/api/v1/practice/sessions', { token: user.token, body: { sceneId: 'bank' } })
    const id = started.data.id, base = `/api/v1/practice/sessions/${id}`
    const helped = await client.post(`${base}/turns`, { token: user.token, body: { text: '我昨天坐在河岸边', expectedTurn: 0 } })
    assert.equal(helped.status, 200, JSON.stringify(helped.raw))
    assert.equal(helped.data.help.level, 3)
    assert.equal(helped.data.targetUsage.find(t => t.word === 'bank').status, 'weak')
    assert.equal(helped.data.targetUsage.find(t => t.word === 'bank').independent, undefined)
    const repeated = await client.post(`${base}/turns`, { token: user.token, body: { text: 'I sat by the river bank yesterday.', expectedTurn: 1 } })
    assert.equal(repeated.status, 200, JSON.stringify(repeated.raw))
    assert.equal(repeated.data.targetUsage.find(t => t.word === 'sit').status, 'assisted')
    await client.post(`${base}/finish`, { token: user.token })
    const failed = await waitReport(client, user, id)
    assert.equal(failed.status, 'report_failed')
    assert.equal(failed.messages.filter(m => m.role === 'user').length, 2)
    assert.equal((await query('SELECT * FROM dialogue_word_evidence WHERE session_id = ?', [id])).length, 0)
    failReport = false
    await client.post(`${base}/retry-report`, { token: user.token })
    const done = await waitReport(client, user, id)
    assert.equal(done.status, 'finished', JSON.stringify(done))
    assert.ok(done.report.reviewWords.some(w => w.spelling === 'bank'))
    const bankReview = done.report.reviewWords.find(w => w.spelling === 'bank')
    const fallback = await queryOne('SELECT b.code FROM words w JOIN wordbooks b ON b.id = w.wordbook_id WHERE w.id = ?', [bankReview.id])
    assert.equal(fallback.code, 'dialogue-core')
    const untouched = done.targetUsage.find(t => t.word === 'nearby')
    assert.equal(untouched.status, 'unused')
  } finally { globalThis.fetch = originalFetch; config.ai.apiKey = oldKey }
})
