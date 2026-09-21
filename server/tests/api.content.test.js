import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser, playSession } from './helpers/setup.js'
import {
  buildCacheKey,
  similarity,
  DEDUP_SIMILARITY_THRESHOLD,
} from '../src/services/ai/contentService.js'
import { pickTopic, TOPIC_POOL } from '../src/services/ai/promptTemplates.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

describe('AI 额度与 provider 状态（PRD 4.3.6）', () => {
  test('返回各类型额度与 provider 配置状态', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/content/quota', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.provider.configured, false, '测试环境不应配置真实 Key')
    assert.equal(response.data.provider.model, 'deepseek-v4')
    assert.equal(response.data.provider.cacheHours, 72)

    assert.deepEqual(Object.keys(response.data.usage).sort(), [
      'article',
      'error_card',
      'quiz',
      'weak_summary',
    ])
    assert.equal(response.data.usage.article.limit, 3)
    assert.equal(response.data.usage.article.used, 0)
    assert.equal(response.data.usage.article.cached, 0)
  })

  test('未配置 Key 时生成短文返回 503 与明确提示，而不是 500', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    const response = await client.post('/api/v1/content/articles', {
      token: user.token,
      body: { wordCount: 5 },
    })

    assert.equal(response.status, 503)
    assert.equal(response.error.code, 'AI_NOT_CONFIGURED')
    assert.match(response.error.message, /AI API Key/)
    // 提示里应给出降级路径，保证背词主链路可用
    assert.match(response.error.message, /预置例句|历史生成/)
  })

  test('未配置 Key 时生成对比卡片同样返回 503', async () => {
    const user = await createOnboardedUser(client)
    const words = await client.get('/api/v1/words/books/fixture-demo/words?size=1')

    const response = await client.post('/api/v1/content/error-cards', {
      token: user.token,
      body: { wordId: words.data.items[0].id },
    })
    assert.equal(response.status, 503)
    assert.equal(response.error.code, 'AI_NOT_CONFIGURED')
  })

  test('没有学习记录时不调用 AI，直接提示先去背词', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/content/articles', {
      token: user.token,
      body: {},
    })

    assert.equal(response.status, 400)
    assert.match(response.error.message, /先背几个单词/)
  })

  test('生成理解题必须提供 articleId', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/content/quizzes', {
      token: user.token,
      body: { count: 3 },
    })

    assert.equal(response.status, 400)
    assert.equal(response.error.code, 'VALIDATION_FAILED')
  })

  test('引用不存在的短文返回 404，不会去调用 AI', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/content/quizzes', {
      token: user.token,
      body: { articleId: 999999 },
    })

    assert.equal(response.status, 404)
    assert.equal(response.error.code, 'NOT_FOUND')
  })

  test('生成的内容列表初始为空，且按类型过滤可用', async () => {
    const user = await createOnboardedUser(client)

    const all = await client.get('/api/v1/content', { token: user.token })
    assert.equal(all.status, 200)
    assert.deepEqual(all.data.items, [])
    assert.equal(all.data.total, 0)

    const filtered = await client.get('/api/v1/content?type=article', { token: user.token })
    assert.equal(filtered.status, 200)

    const invalid = await client.get('/api/v1/content?type=poem', { token: user.token })
    assert.equal(invalid.status, 400)
  })

  test('取不存在的生成内容返回 404', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/content/999999', { token: user.token })
    assert.equal(response.status, 404)
  })

  test('内容接口需要登录', async () => {
    for (const path of ['/api/v1/content', '/api/v1/content/quota', '/api/v1/content/1']) {
      const response = await client.get(path)
      assert.equal(response.status, 401, `${path} 应要求登录`)
    }
  })
})

describe('生成缓存键（PRD 4.3.6 第 1 条）', () => {
  test('同一组词的缓存键稳定，与词的顺序无关', () => {
    const a = buildCacheKey({ type: 'article', wordIds: [5, 2, 9], difficulty: 3, goal: '四级', topic: '科技' })
    const b = buildCacheKey({ type: 'article', wordIds: [9, 5, 2], difficulty: 3, goal: '四级', topic: '科技' })
    assert.equal(a, b, '词序不同但组合相同应命中同一缓存')
  })

  test('话题、难度、学习目标或类型不同都会产生不同缓存键', () => {
    const base = { type: 'article', wordIds: [1, 2], difficulty: 3, goal: '四级', topic: '科技' }
    const baseline = buildCacheKey(base)

    assert.notEqual(baseline, buildCacheKey({ ...base, topic: '环保' }))
    assert.notEqual(baseline, buildCacheKey({ ...base, difficulty: 4 }))
    assert.notEqual(baseline, buildCacheKey({ ...base, goal: '考研' }))
    assert.notEqual(baseline, buildCacheKey({ ...base, type: 'quiz' }))
    assert.notEqual(baseline, buildCacheKey({ ...base, wordIds: [1, 3] }))
  })

  test('缓存键为 sha256 十六进制串', () => {
    const key = buildCacheKey({ type: 'article', wordIds: [1] })
    assert.match(key, /^[0-9a-f]{64}$/)
  })
})

describe('历史生成去重校验（PRD 4.4 第 4 条）', () => {
  test('完全不同的文本相似度接近 0', () => {
    const score = similarity(
      'The quick brown fox jumps over the lazy dog in the forest near the river.',
      'Students often discuss climate policy and renewable energy in academic essays today.'
    )
    assert.ok(score < 0.05, `无关文本相似度应接近 0，实际 ${score}`)
  })

  test('几乎相同的文本相似度接近 1', () => {
    const text =
      'The quick brown fox jumps over the lazy dog in the forest near the river every single morning.'
    const score = similarity(text, text)
    assert.equal(score, 1)
  })

  test('接近成文长度的文本仅少量改动时相似度仍然很高，可触发重新生成', () => {
    // 阈值 0.9 是按 PRD 要求的 150-250 词短文长度校准的：
    // 文本越短，改动一个词影响的 3-gram 占比越大，因此这里用真实长度的样本来验证。
    const sentences = [
      'The morning light fell across the quiet classroom where students reviewed their notes.',
      'A teacher explained how small habits compound into lasting progress over many months.',
      'Later they discussed the article about renewable energy and its effect on small towns.',
      'Every student wrote a short summary and shared it with the group before the bell rang.',
      'The lesson ended with a reminder to review the vocabulary list before the next class.',
      'Outside the window the rain continued, softening the noise of the busy street below.',
      'She decided to adapt her plan after noticing which words she kept forgetting.',
      'By the end of the week the group had built a routine that felt sustainable and calm.',
    ]
    const original = sentences.join(' ')
    const changed = original.replace('She decided to adapt her plan', 'He decided to adapt his plan')

    assert.ok(original.split(/\s+/).length >= 100, '样本长度应接近真实短文')

    const score = similarity(original, changed)
    assert.ok(
      score >= DEDUP_SIMILARITY_THRESHOLD,
      `少量改动后相似度应达到去重阈值 ${DEDUP_SIMILARITY_THRESHOLD}，实际 ${score}`
    )
  })

  test('去重阈值不会被主题相同但表述不同的文章误触发', () => {
    const first =
      'The morning light fell across the quiet classroom where students reviewed their notes carefully before the exam.'
    const second =
      'Sunlight streamed into the lecture hall as learners skimmed their flashcards, preparing themselves for the upcoming test.'

    const score = similarity(first, second)
    assert.ok(
      score < DEDUP_SIMILARITY_THRESHOLD,
      `同主题不同表述不应被判为雷同，实际 ${score}`
    )
    assert.ok(score < 0.3, `同主题不同表述的得分应远低于阈值，实际 ${score}`)
  })

  test('空文本不会误判为雷同', () => {
    assert.equal(similarity('', 'anything at all here'), 0)
    assert.equal(similarity('some text here', ''), 0)
  })
})

describe('话题抽取（PRD 4.4 第 2 条）', () => {
  test('权重高的用户偏好会显著提高对应话题抽中概率', () => {
    const weights = Object.fromEntries(TOPIC_POOL.map((topic) => [topic, 0.05]))
    weights['职场'] = 100

    let hits = 0
    for (let i = 0; i < 200; i += 1) {
      if (pickTopic(weights) === '职场') hits += 1
    }
    assert.ok(hits > 180, `高权重话题应占绝大多数，实际命中 ${hits}/200`)
  })

  test('相同输入因随机性产生不同话题，保证「相同词表不同输出」', () => {
    const weights = Object.fromEntries(TOPIC_POOL.map((topic) => [topic, 1]))
    const seen = new Set()
    for (let i = 0; i < 200; i += 1) seen.add(pickTopic(weights))
    assert.ok(seen.size > 3, `话题应有多样性，实际只抽到 ${seen.size} 种`)
  })
})
