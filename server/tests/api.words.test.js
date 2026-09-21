import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser, playSession } from './helpers/setup.js'
import { queryOne } from '../src/db/pool.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

describe('词书与单词', () => {
  test('词书列表包含 seed 导入的示例词库', async () => {
    const response = await client.get('/api/v1/words/books')

    assert.equal(response.status, 200)
    const fixture = response.data.items.find((book) => book.code === 'fixture-demo')
    assert.ok(fixture, '应包含 fixture-demo 示例词库')
    assert.equal(fixture.isBuiltin, true)
    assert.equal(fixture.scope, '四级')
    assert.ok(fixture.wordCount > 0)
  })

  test('词书单词列表分页且按词频优先排序', async () => {
    const response = await client.get('/api/v1/words/books/fixture-demo/words?page=1&size=10')

    assert.equal(response.status, 200)
    assert.equal(response.data.items.length, 10)
    assert.equal(response.data.page, 1)
    assert.equal(response.data.size, 10)
    assert.equal(response.data.total, 80, '示例词库共 80 个单词')
    assert.equal(response.data.totalPages, 8)

    // 高频词应排在前面
    const freqRank = { high: 0, med: 1, low: 2 }
    const ranks = response.data.items.map((word) => freqRank[word.freq])
    for (let i = 1; i < ranks.length; i += 1) {
      assert.ok(ranks[i] >= ranks[i - 1], '词频排序应单调不降')
    }
  })

  test('单词字段完整，且 example 为首个例句（兼容前端旧字段）', async () => {
    const response = await client.get('/api/v1/words/books/fixture-demo/words?size=1')
    const word = response.data.items[0]

    assert.ok(Number.isInteger(word.id))
    assert.ok(word.spelling)
    assert.ok(word.phonetic)
    assert.ok(word.pos)
    assert.ok(['high', 'med', 'low'].includes(word.freq))
    assert.ok(word.difficulty >= 1 && word.difficulty <= 5)
    assert.ok(Array.isArray(word.definitions) && word.definitions.length > 0)
    assert.ok(Array.isArray(word.examples))
    assert.equal(word.example, word.examples[0] || '')
  })

  test('支持按词频与难度过滤', async () => {
    const response = await client.get('/api/v1/words/books/fixture-demo/words?freq=high&difficulty=1&size=100')

    assert.equal(response.status, 200)
    assert.ok(response.data.total > 0)
    for (const word of response.data.items) {
      assert.equal(word.freq, 'high')
      assert.equal(word.difficulty, 1)
    }
  })

  test('分页越界返回空列表而不是报错', async () => {
    const response = await client.get('/api/v1/words/books/fixture-demo/words?page=999&size=20')
    assert.equal(response.status, 200)
    assert.deepEqual(response.data.items, [])
    assert.equal(response.data.total, 80)
  })

  test('不存在的词书返回 404', async () => {
    const response = await client.get('/api/v1/words/books/not-a-book/words')
    assert.equal(response.status, 404)
    assert.equal(response.error.code, 'NOT_FOUND')
  })

  test('非法分页参数返回 400', async () => {
    const response = await client.get('/api/v1/words/books/fixture-demo/words?size=9999')
    assert.equal(response.status, 400)
  })

  test('按 id 取单词详情', async () => {
    const list = await client.get('/api/v1/words/books/fixture-demo/words?size=1')
    const wordId = list.data.items[0].id

    const response = await client.get(`/api/v1/words/${wordId}`)
    assert.equal(response.status, 200)
    assert.equal(response.data.word.id, wordId)

    const missing = await client.get('/api/v1/words/99999999')
    assert.equal(missing.status, 404)
  })
})

describe('易混词与对比记忆卡片（PRD 4.2.3）', () => {
  test('形近词列表按相似度降序，且包含关系类型', async () => {
    const adapt = await queryOne('SELECT id FROM words WHERE spelling = ?', ['adapt'])
    const response = await client.get(`/api/v1/words/${adapt.id}/related`)

    assert.equal(response.status, 200)
    assert.equal(response.data.word.spelling, 'adapt')
    assert.ok(response.data.items.length > 0)

    const adopt = response.data.items.find((item) => item.spelling === 'adopt')
    assert.ok(adopt, 'adapt 的易混词应包含 adopt')
    assert.ok(['form', 'meaning'].includes(adopt.relationType))
    assert.ok(adopt.score > 0 && adopt.score <= 1)

    const scores = response.data.items.map((item) => item.score)
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(scores[i] <= scores[i - 1], '相似度应降序')
    }
  })

  test('对比卡片提供词形差异切分与语义区别，且不消耗 AI', async () => {
    const adapt = await queryOne('SELECT * FROM words WHERE spelling = ?', ['adapt'])
    const response = await client.get(`/api/v1/words/${adapt.id}/contrast`)

    assert.equal(response.status, 200)
    const card = response.data.card
    assert.ok(card, '应返回对比卡片')
    assert.equal(card.word.spelling, 'adapt')

    const adopt = card.contrasts.find((item) => item.spelling === 'adopt')
    assert.ok(adopt)
    // 词形差异：公共前后缀与各自的差异段，前端据此做高亮
    assert.equal(adopt.diff.prefix + adopt.diff.aMiddle + adopt.diff.suffix, 'adapt')
    assert.equal(adopt.diff.prefix + adopt.diff.bMiddle + adopt.diff.suffix, 'adopt')
    // 语义区别：左右对照
    assert.ok(adopt.meaningContrast.current)
    assert.ok(adopt.meaningContrast.related)
  })

  test('没有易混关系的词返回空卡片而不是错误', async () => {
    // 取一个确实没有任何关系的词
    const lonely = await queryOne(
      `SELECT w.id, w.spelling FROM words w
        WHERE NOT EXISTS (SELECT 1 FROM word_relations r WHERE r.word_id = w.id)
        LIMIT 1`
    )
    if (!lonely) return // 词库中若所有词都有关系则跳过

    const response = await client.get(`/api/v1/words/${lonely.id}/contrast`)
    assert.equal(response.status, 200)
    assert.equal(response.data.card, null)
  })
})

describe('最近所学词（PRD 4.9 气泡彩蛋）', () => {
  test('未登录时拒绝访问', async () => {
    const response = await client.get('/api/v1/words/recent')
    assert.equal(response.status, 401)
  })

  test('没有学习记录时返回引导文案而不是空报错', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/words/recent', { token: user.token })

    assert.equal(response.status, 200)
    assert.deepEqual(response.data.items, [])
    assert.equal(response.data.empty, true)
    assert.match(response.data.emptyHint, /先去背几个单词/)
  })

  test('返回最近学过的单词与中文释义', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    const response = await client.get('/api/v1/words/recent?limit=5', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.items.length, 3)
    assert.equal(response.data.empty, false)
    assert.equal(response.data.emptyHint, null)

    for (const item of response.data.items) {
      assert.ok(Number.isInteger(item.wordId))
      assert.ok(item.spelling)
      assert.ok(Array.isArray(item.definitions) && item.definitions.length > 0)
      // meaning 是气泡里要显示的中文释义
      assert.equal(item.meaning, item.definitions[0])
      assert.ok(item.learnedAt)
    }
  })

  test('limit 参数被校验，越界返回 400', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/words/recent?limit=999', { token: user.token })
    assert.equal(response.status, 400)
  })

  test('查看最近单词不会写入学习数据（纯回顾，不进入 SRS 队列）', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 2 })

    const before = await queryOne('SELECT COUNT(*) AS total FROM answer_logs WHERE user_id = ?', [user.userId])
    await client.get('/api/v1/words/recent', { token: user.token })
    await client.get('/api/v1/words/recent', { token: user.token })
    const after = await queryOne('SELECT COUNT(*) AS total FROM answer_logs WHERE user_id = ?', [user.userId])

    assert.equal(Number(before.total), Number(after.total), '彩蛋查询不应产生答题流水')
  })

  test('路由顺序正确：recent 不会被当作单词 id', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/words/recent', { token: user.token })
    // 若被 /:id 抢先匹配，会因 id 非数字而返回 400
    assert.equal(response.status, 200)
  })
})
