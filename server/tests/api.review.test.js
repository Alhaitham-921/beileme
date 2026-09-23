/**
 * 今日回顾：错词重练 + 短文重复阅读。
 *
 * 这是「能够让用户重复复习单词」的落点：
 *  - 今日错词集中列出，可勾选后一键再练一遍
 *  - 重练结果照常写回 SRS（复习计划本来就该受影响）
 *  - 今日生成的短文可反复打开重读，且**不产生任何 AI 费用**
 */
import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser, playSession } from './helpers/setup.js'
import { query, queryOne, execute } from '../src/db/pool.js'
import { toJson } from '../src/utils/json.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

/**
 * 造一条「已生成的短文」记录。
 *
 * 不通过接口生成，是因为测试环境没有 AI：无 Key 时接口会降级为本地复习清单，
 * 而复习清单**按设计不写入 generated_contents**（它不是 AI 生成的内容，
 * 写进去只会污染短文列表）。所以这里直接把记录写进库，专门测回顾逻辑。
 */
async function insertArticle(user, { title = 'Test Article', topic = '环保' } = {}) {
  const words = await query('SELECT id FROM words ORDER BY id LIMIT 3')
  const wordIds = words.map((row) => Number(row.id))

  const result = await execute(
    `INSERT INTO generated_contents
       (user_id, type, title, topic, difficulty, target_words, content_body, meta, model)
     VALUES (?, 'article', ?, ?, 3, ?, ?, ?, 'mock-model')`,
    [
      user.userId,
      title,
      topic,
      toJson(wordIds),
      JSON.stringify({
        title,
        body: 'The morning light fell across the quiet campus. **adapt** was the word of the day.',
        glossary: [{ spelling: 'adapt', definition: '适应' }],
      }),
      toJson({ glossary: [{ spelling: 'adapt', definition: '适应' }] }),
    ]
  )
  return Number(result.insertId)
}
async function forceWrongAnswer(user, { fast = false } = {}) {
  const target = await queryOne('SELECT * FROM words ORDER BY id LIMIT 1')
  const definitions = typeof target.definitions === 'string' ? JSON.parse(target.definitions) : target.definitions

  const queue = [
    {
      wordId: Number(target.id),
      kind: 'new',
      options: [
        { index: 0, text: definitions.join('；'), primary: definitions[0], correct: true, wordId: Number(target.id) },
        { index: 1, text: '干扰释义', primary: '干扰释义', correct: false, wordId: null },
      ],
      answered: false,
      correct: null,
    },
  ]
  const result = await execute(
    `INSERT INTO study_sessions (user_id, kind, status, planned_count, queue)
     VALUES (?, 'daily', 'active', 1, ?)`,
    [user.userId, toJson(queue)]
  )
  const answer = await client.post(`/api/v1/study/sessions/${result.insertId}/answers`, {
    token: user.token,
    body: { wordId: Number(target.id), optionIndex: 1, hesitationMs: fast ? 600 : 4000 },
  })
  return { wordId: Number(target.id), answer: answer.data }
}

describe('今日回顾接口', () => {
  test('新用户当天没有记录时返回空结构而不是报错', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/study/review/today', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(typeof response.data.date, 'string')
    assert.equal(response.data.answered, 0)
    assert.equal(response.data.wrongCount, 0)
    assert.deepEqual(response.data.wrongWords, [])
    assert.deepEqual(response.data.articles, [])
  })

  test('答错的词出现在今日错词里，并带出错因标签', async () => {
    const user = await createOnboardedUser(client)
    const { wordId } = await forceWrongAnswer(user, { fast: true })

    const response = await client.get('/api/v1/study/review/today', { token: user.token })
    assert.equal(response.data.wrongCount, 1)
    assert.equal(response.data.wrongWords.length, 1)

    const item = response.data.wrongWords[0]
    assert.equal(item.wordId, wordId)
    assert.equal(item.wrongTimes, 1)
    assert.ok(item.spelling)
    assert.ok(Array.isArray(item.definitions) && item.definitions.length > 0)
    assert.ok(item.errorTypes.length > 0, '应带上错因标签供回顾时参考')
    // 600ms 就选错 → 盲猜
    assert.ok(item.errorTypes.includes('盲猜 / 生疏'))
  })

  test('同一个词错多次会累计次数', async () => {
    const user = await createOnboardedUser(client)
    await forceWrongAnswer(user)
    await forceWrongAnswer(user)

    const response = await client.get('/api/v1/study/review/today', { token: user.token })
    assert.equal(response.data.wrongWords.length, 1, '同一个词只出现一条')
    assert.equal(response.data.wrongWords[0].wrongTimes, 2)
    assert.equal(response.data.wrongCount, 2)
  })

  test('答对的词不会进错词列表', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    const response = await client.get('/api/v1/study/review/today', { token: user.token })
    assert.equal(response.data.answered, 3)
    assert.equal(response.data.wrongCount, 0)
    assert.deepEqual(response.data.wrongWords, [])
  })

  test('今日生成的短文会出现在短文回顾里', async () => {
    const user = await createOnboardedUser(client)
    const articleId = await insertArticle(user, { title: '今日短文' })

    const response = await client.get('/api/v1/study/review/today', { token: user.token })
    assert.equal(response.data.articles.length, 1)

    const article = response.data.articles[0]
    assert.equal(article.id, articleId)
    assert.equal(article.title, '今日短文')
    assert.equal(article.topic, '环保')
    assert.ok(Array.isArray(article.targetWords) && article.targetWords.length > 0)
    assert.ok(article.createdAt)
  })

  test('用户之间互不可见', async () => {
    const a = await createOnboardedUser(client)
    const b = await createOnboardedUser(client)
    await forceWrongAnswer(a)

    const readB = await client.get('/api/v1/study/review/today', { token: b.token })
    assert.equal(readB.data.wrongCount, 0, 'B 不该看到 A 的错词')
  })

  test('未登录不能访问', async () => {
    const response = await client.get('/api/v1/study/review/today')
    assert.equal(response.status, 401)
  })
})

describe('错词重练', () => {
  test('可以为指定单词开一轮重练，题量等于传入的词数', async () => {
    const user = await createOnboardedUser(client)
    const words = await query('SELECT id FROM words ORDER BY id LIMIT 3')
    const wordIds = words.map((row) => Number(row.id))

    const response = await client.post('/api/v1/study/review-sessions', {
      token: user.token,
      body: { wordIds },
    })

    assert.equal(response.status, 201)
    assert.equal(response.data.items.length, 3)
    assert.deepEqual(
      response.data.items.map((item) => item.wordId).sort((a, b) => a - b),
      [...wordIds].sort((a, b) => a - b)
    )
    // 重练同样要能渲染答题卡
    for (const item of response.data.items) {
      assert.ok(item.options.length >= 2)
      assert.ok(item.word.spelling)
    }
  })

  test('重练不消耗每日新词额度', async () => {
    const user = await createOnboardedUser(client)
    const words = await query('SELECT id FROM words ORDER BY id LIMIT 2')

    const before = await client.get('/api/v1/plan/today', { token: user.token })
    const session = await client.post('/api/v1/study/review-sessions', {
      token: user.token,
      body: { wordIds: words.map((row) => Number(row.id)) },
    })
    assert.equal(session.status, 201)

    // 只是开了一轮，还没作答，所以计划进度不应变化
    const after = await client.get('/api/v1/plan/today', { token: user.token })
    assert.equal(after.data.plan.newDone, before.data.plan.newDone)
    assert.equal(after.data.plan.newTarget, before.data.plan.newTarget)
  })

  test('重练结果照常写回 SRS 与复习计划', async () => {
    const user = await createOnboardedUser(client)
    const words = await query('SELECT id FROM words ORDER BY id LIMIT 2')
    const wordIds = words.map((row) => Number(row.id))

    const session = await client.post('/api/v1/study/review-sessions', {
      token: user.token,
      body: { wordIds },
    })

    // 用服务端保存的选项快照取得正确下标
    const row = await queryOne('SELECT queue FROM study_sessions WHERE id = ?', [session.data.session.id])
    const queue = typeof row.queue === 'string' ? JSON.parse(row.queue) : row.queue
    const correctIndex = queue[0].options.find((option) => option.correct).index

    const answer = await client.post(
      `/api/v1/study/sessions/${session.data.session.id}/answers`,
      { token: user.token, body: { wordId: session.data.items[0].wordId, optionIndex: correctIndex, hesitationMs: 1200 } }
    )

    assert.equal(answer.status, 201)
    assert.equal(answer.data.isCorrect, true)
    assert.equal(answer.data.progress.timesSeen, 1, '重练同样会建立学习记录')

    const progress = await queryOne(
      'SELECT repetitions, next_review_at FROM user_word_progress WHERE user_id = ? AND word_id = ?',
      [user.userId, session.data.items[0].wordId]
    )
    assert.ok(progress, '应写入学习进度')
    assert.equal(Number(progress.repetitions), 1)
    assert.ok(progress.next_review_at, '应排出下次复习时间')
  })

  test('空数组或非法词表被拒绝', async () => {
    const user = await createOnboardedUser(client)

    const empty = await client.post('/api/v1/study/review-sessions', {
      token: user.token,
      body: { wordIds: [] },
    })
    assert.equal(empty.status, 400)

    const missing = await client.post('/api/v1/study/review-sessions', {
      token: user.token,
      body: { wordIds: [99999999] },
    })
    assert.equal(missing.status, 400)
    assert.match(missing.error.message, /不存在/)
  })

  test('未登录不能开重练', async () => {
    const response = await client.post('/api/v1/study/review-sessions', {
      body: { wordIds: [1] },
    })
    assert.equal(response.status, 401)
  })
})

describe('短文回顾：读取历史短文不花钱', () => {
  test('可以按 id 取回完整正文与生词表', async () => {
    const user = await createOnboardedUser(client)
    const articleId = await insertArticle(user, { title: '可重读的短文' })

    // 先产生一些真实用量，用来验证「重读不增加调用」
    const usageBefore = await client.get('/api/v1/ai/usage?days=30', { token: user.token })
    const usedBefore = usageBefore.data.totals.used

    const response = await client.get(`/api/v1/content/${articleId}`, { token: user.token })
    assert.equal(response.status, 200)
    assert.equal(response.data.content.id, articleId)
    assert.equal(response.data.content.title, '可重读的短文')
    assert.ok(response.data.content.body, '应能取到正文用于重读')
    assert.ok(response.data.content.meta.glossary.length > 0, '生词表也要能取回')

    const usageAfter = await client.get('/api/v1/ai/usage?days=30', { token: user.token })
    assert.equal(usageAfter.data.totals.used, usedBefore, '重读历史短文不产生任何 AI 调用')
  })

  test('不能读取别人的短文', async () => {
    const a = await createOnboardedUser(client)
    const b = await createOnboardedUser(client)
    const articleId = await insertArticle(a)

    const response = await client.get(`/api/v1/content/${articleId}`, { token: b.token })
    assert.equal(response.status, 404)
  })

  test('别人的短文也不会出现在我的回顾列表里', async () => {
    const a = await createOnboardedUser(client)
    const b = await createOnboardedUser(client)
    await insertArticle(a, { title: 'A 的短文' })

    const readB = await client.get('/api/v1/study/review/today', { token: b.token })
    assert.deepEqual(readB.data.articles, [])
  })
})
