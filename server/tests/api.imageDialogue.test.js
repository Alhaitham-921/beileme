import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { config } from '../src/config.js'
import { queryOne, execute } from '../src/db/pool.js'
import { getWordById } from '../src/services/wordService.js'
import { getWordMemoryImage } from '../src/services/wordMemoryImageService.js'

test('private memory images start reusable three-turn practice with exact sense and durable history', async t => {
  const { baseUrl } = await getTestServer(), client = createClient(baseUrl)
  const owner = await createOnboardedUser(client), other = await createOnboardedUser(client)
  const row = await queryOne("SELECT id FROM words WHERE spelling_norm='bank' LIMIT 1")
  const word = await getWordById(row.id), sense = word.definitions[0]
  const hash = createHash('sha256').update(sense).digest()
  const revision = createHash('sha256').update('test-image').digest()
  await execute('INSERT INTO word_memory_images (user_id,word_id,sense_hash,image,image_revision,explanation,attempt_day) VALUES (?,?,?,?,?,?,CURRENT_DATE())',
    [owner.userId, word.id, hash, Buffer.from('test-image'), revision, '一位旅客在与工作人员交谈。'])
  const card = await getWordMemoryImage(owner.userId, word.id, sense)
  const body = { wordId: word.id, sense, imagePath: card.imagePath }
  const original = config.ai.apiKey
  config.ai.apiKey = 'image-dialogue-test-key'
  t.after(() => { config.ai.apiKey = original })
  const realFetch = globalThis.fetch
  let sceneCalls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return realFetch(url, options)
    const messages = JSON.parse(options.body).messages
    let content
    if (messages[0].content.includes('场景设计师')) {
      sceneCalls++
      const input = JSON.parse(messages[1].content)
      assert.equal(input.memoryImage.sense, sense)
      content = { title: '看图交流', location: '图片中的场景', role: '交流伙伴', userRole: '学习者',
        task: '聊聊记忆图中的情境。', goals: ['说明自己的想法', '回应伙伴的提问'],
        targets: [{ word: word.spelling.toLowerCase(), sense, phrase: 'the bank', example: 'I am at the bank.' }],
        opening: 'Hello! How can I help you?', openingTranslation: '你好，有什么能帮你？', example: 'I am at the bank.' }
    } else if (messages[0].content.includes('复盘教练')) {
      content = { summary: '你完成了看图三轮练习。', corrections: [], weakWords: [], reinforcement: [], grammarWeaknesses: [] }
    } else {
      content = { reply: 'Thank you for telling me.', translation: '谢谢你告诉我。', mixedLanguage: false,
        corrections: [], usedTargets: [{ word: word.spelling.toLowerCase(), sense, correct: true }], taskComplete: true }
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 30 } })
  })
  assert.equal((await client.post('/api/v1/practice/image-sessions', { body })).status, 401)
  assert.equal((await client.post('/api/v1/practice/image-sessions', { token: other.token, body })).status, 404)
  assert.equal((await client.post('/api/v1/practice/image-sessions', { token: owner.token, body: { ...body, sense: '伪造词义' } })).status, 404)
  assert.equal((await client.post('/api/v1/practice/image-sessions', { token: owner.token, body: { ...body, imagePath: card.imagePath.replace(revision.toString('hex'), 'a'.repeat(64)) } })).status, 409)
  assert.equal(sceneCalls, 0)
  const started = await client.post('/api/v1/practice/image-sessions', { token: owner.token, body })
  assert.equal(started.status, 201, JSON.stringify(started.raw))
  const session = started.data
  assert.equal(session.maxTurns, 3)
  assert.equal(session.scene.memoryImage.imagePath, card.imagePath)
  assert.equal(session.targetUsage[0].sense, sense)
  assert.equal((await client.get(`/api/v1/practice/sessions/${session.id}`, { token: other.token })).status, 404)
  const help = await client.post(`/api/v1/practice/sessions/${session.id}/help`, { token: owner.token, body: { level: 4, word: 'bank', expectedTurn: 0 } })
  assert.equal(help.status, 200, JSON.stringify(help.raw))
  for (let i = 0; i < 3; i++) {
    const turn = await client.post(`/api/v1/practice/sessions/${session.id}/turns`, { token: owner.token, body: { text: 'I am at the bank.', expectedTurn: i } })
    assert.equal(turn.status, 200, JSON.stringify(turn.raw))
    assert.equal(turn.data.turnCount, i + 1)
    if (i < 2) assert.equal(turn.data.status, 'active')
    assert.equal(turn.data.targetUsage[0].status, 'assisted')
  }
  let finished
  for (let i = 0; i < 100; i++) {
    finished = (await client.get(`/api/v1/practice/sessions/${session.id}`, { token: owner.token })).data
    if (finished.status !== 'analyzing') break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(finished.status, 'finished', JSON.stringify(finished))
  const next = await client.post('/api/v1/practice/image-sessions', { token: owner.token, body })
  assert.equal(next.status, 201, JSON.stringify(next.raw))
  assert.equal(next.data.maxTurns, 3)
  assert.equal(sceneCalls, 1, 'reuse the prepared scene without another scene-generation charge')
  const repeat = await client.post(`/api/v1/practice/sessions/${session.id}/repeat`, { token: owner.token, body: { mode: 'free', maxTurns: 24 } })
  assert.equal(repeat.status, 201, JSON.stringify(repeat.raw))
  assert.equal(repeat.data.maxTurns, 3)
  assert.equal(repeat.data.mode, 'task')
  assert.equal(repeat.data.scene.memoryImage.imagePath, card.imagePath)
})
