import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser, playSession, correctOptionIndex } from './helpers/setup.js'
import { queryOne, execute } from '../src/db/pool.js'
import { toJson } from '../src/utils/json.js'
import { todayKey, addDays } from '../src/utils/time.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

/** 造一次确定的形近混淆错误，便于断言错因分布 */
async function createFormConfusion(user, targetSpelling, wrongSpelling) {
  const target = await queryOne('SELECT * FROM words WHERE spelling = ?', [targetSpelling])
  const wrong = await queryOne('SELECT * FROM words WHERE spelling = ?', [wrongSpelling])
  const targetDefs = typeof target.definitions === 'string' ? JSON.parse(target.definitions) : target.definitions
  const wrongDefs = typeof wrong.definitions === 'string' ? JSON.parse(wrong.definitions) : wrong.definitions

  const queue = [
    {
      wordId: Number(target.id),
      kind: 'new',
      options: [
        { index: 0, text: targetDefs[0], correct: true, wordId: Number(target.id) },
        { index: 1, text: wrongDefs[0], correct: false, wordId: Number(wrong.id) },
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
  await client.post(`/api/v1/study/sessions/${result.insertId}/answers`, {
    token: user.token,
    body: { wordId: Number(target.id), optionIndex: 1, hesitationMs: 4000 },
  })
}

describe('看板总览', () => {
  test('新用户的总览为零值而不是报错', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/stats/overview', { token: user.token })

    assert.equal(response.status, 200)
    assert.deepEqual(
      {
        totalLearned: response.data.totalLearned,
        totalSeen: response.data.totalSeen,
        accuracy: response.data.accuracy,
        dueCount: response.data.dueCount,
        streak: response.data.streak,
      },
      { totalLearned: 0, totalSeen: 0, accuracy: 0, dueCount: 0, streak: 0 }
    )
    assert.ok(response.data.today, '应附带今日计划')
  })

  test('学习后累计背词、正确率与待复习数正确', async () => {
    const user = await createOnboardedUser(client)
    const { results } = await playSession(client, user, { strategy: 'all-correct', maxAnswers: 5 })

    const response = await client.get('/api/v1/stats/overview', { token: user.token })

    assert.equal(response.data.totalLearned, 5)
    assert.equal(response.data.totalSeen, results.length)
    assert.equal(response.data.totalCorrect, results.length)
    assert.equal(response.data.totalWrong, 0)
    assert.equal(response.data.accuracy, 100)
    // 刚学完的词下次复习在 1 天后，因此当前没有到期的词
    assert.equal(response.data.dueCount, 0)
    assert.ok(response.data.avgMemoryStrength > 0)
  })

  test('答错会拉低正确率并计入错题数', async () => {
    const user = await createOnboardedUser(client)
    await createFormConfusion(user, 'adapt', 'adopt')

    const response = await client.get('/api/v1/stats/overview', { token: user.token })
    assert.equal(response.data.totalWrong, 1)
    assert.equal(response.data.totalCorrect, 0)
    assert.equal(response.data.accuracy, 0)
  })

  test('到期的复习词会被统计为待复习', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    // 把复习时间提前到过去，模拟第二天到期
    await execute(
      'UPDATE user_word_progress SET next_review_at = DATE_SUB(?, INTERVAL 1 HOUR) WHERE user_id = ?',
      [new Date(), user.userId]
    )

    const response = await client.get('/api/v1/stats/overview', { token: user.token })
    assert.equal(response.data.dueCount, 3)
  })
})

describe('正确率趋势', () => {
  test('默认返回近 7 天，缺失日期补 null 而不是 0', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 2 })

    const response = await client.get('/api/v1/stats/trend', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.items.length, 7)
    assert.match(response.data.items[0].label, /^\d+\/\d+$/)

    const today = response.data.items.at(-1)
    assert.equal(today.accuracy, 100)
    assert.equal(today.correct, 2)

    // 没有学习记录的日期正确率为 null，前端可渲染为「—」
    assert.equal(response.data.items[0].accuracy, null)
    assert.equal(response.data.items[0].total, 0)
  })

  test('支持自定义天数，且服务端最多返回 60 天', async () => {
    const user = await createOnboardedUser(client)

    const thirty = await client.get('/api/v1/stats/trend?days=30', { token: user.token })
    assert.equal(thirty.data.items.length, 30)

    // 参数层允许到 365 天，服务层再收敛到 60 天，避免趋势图过长
    const capped = await client.get('/api/v1/stats/trend?days=365', { token: user.token })
    assert.equal(capped.data.items.length, 60)

    // 超出参数上限则直接拒绝，而不是静默截断
    const rejected = await client.get('/api/v1/stats/trend?days=9999', { token: user.token })
    assert.equal(rejected.status, 400)
  })
})

describe('记忆强度分布', () => {
  test('四档分层与已学总数一致', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 6 })

    const response = await client.get('/api/v1/stats/strength', { token: user.token })

    assert.equal(response.status, 200)
    assert.deepEqual(Object.keys(response.data.distribution).sort(), ['已掌握', '新学', '巩固中', '较熟'].sort())
    // 首次答对后 repetitions = 1，应落在「巩固中」
    assert.equal(response.data.distribution['巩固中'], 6)
    assert.equal(response.data.total, 6)
  })

  test('答错的词落在「新学」档', async () => {
    const user = await createOnboardedUser(client)
    await createFormConfusion(user, 'adapt', 'adopt')

    const response = await client.get('/api/v1/stats/strength', { token: user.token })
    assert.equal(response.data.distribution['新学'], 1)
  })
})

describe('错因分布（饼图数据源）', () => {
  test('按错因聚合且百分比之和接近 100', async () => {
    const user = await createOnboardedUser(client)
    await createFormConfusion(user, 'adapt', 'adopt')
    await createFormConfusion(user, 'abandon', 'ability')

    const response = await client.get('/api/v1/stats/errors?days=30', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.total, 2)
    assert.ok(response.data.items.length >= 1)

    for (const item of response.data.items) {
      assert.ok(item.label, '应带中文错因标签')
      assert.ok(item.count > 0)
      assert.ok(item.percent >= 0 && item.percent <= 100)
    }

    const sum = response.data.items.reduce((total, item) => total + item.percent, 0)
    assert.ok(sum >= 95 && sum <= 105, `百分比之和应接近 100，实际 ${sum}`)
  })

  test('没有错题时返回空列表', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/stats/errors', { token: user.token })
    assert.deepEqual(response.data.items, [])
    assert.equal(response.data.total, 0)
  })
})

describe('薄弱点小结（PRD 4.3.3）', () => {
  test('无错题时给出鼓励性结论', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/stats/weak-summary', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.source, 'rule-based')
    assert.equal(response.data.errorDistribution.total, 0)
    assert.match(response.data.summary, /还没有产生错题记录/)
  })

  test('基于真实数据生成结论，包含主要错因与错得最多的词', async () => {
    const user = await createOnboardedUser(client)
    await createFormConfusion(user, 'adapt', 'adopt')
    await createFormConfusion(user, 'adapt', 'adopt')

    const response = await client.get('/api/v1/stats/weak-summary?days=7', { token: user.token })

    assert.equal(response.data.errorDistribution.total, 2)
    assert.equal(response.data.errorDistribution.items[0].type, 'form_confusion')
    assert.match(response.data.summary, /形近词混淆/)
    assert.match(response.data.summary, /易混词对比卡片/)

    assert.equal(response.data.topWrongWords.length, 1)
    assert.equal(response.data.topWrongWords[0].spelling, 'adapt')
    assert.equal(response.data.topWrongWords[0].wrongTimes, 2)
    assert.ok(response.data.topWrongWords[0].errorTypes.includes('形近词混淆'))
  })

  test('盲猜占比过高时给出降速建议', async () => {
    const user = await createOnboardedUser(client)
    const target = await queryOne('SELECT * FROM words WHERE spelling = ?', ['abandon'])
    const defs = typeof target.definitions === 'string' ? JSON.parse(target.definitions) : target.definitions

    // 造 3 次盲猜（极快选错）
    for (let i = 0; i < 3; i += 1) {
      const queue = [
        {
          wordId: Number(target.id),
          kind: 'new',
          options: [
            { index: 0, text: defs[0], correct: true, wordId: Number(target.id) },
            { index: 1, text: '错误释义占位', correct: false, wordId: null },
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
      await client.post(`/api/v1/study/sessions/${result.insertId}/answers`, {
        token: user.token,
        body: { wordId: Number(target.id), optionIndex: 1, hesitationMs: 600 },
      })
    }

    const response = await client.get('/api/v1/stats/weak-summary', { token: user.token })
    assert.equal(response.data.errorDistribution.items[0].type, 'guess')
    assert.equal(response.data.errorDistribution.items[0].percent, 100)
    assert.match(response.data.summary, /盲猜占比/)
  })

  test('请求 AI 版本但未配置 Key 时降级为规则版结论', async () => {
    const user = await createOnboardedUser(client)
    await createFormConfusion(user, 'adapt', 'adopt')

    const response = await client.get('/api/v1/stats/weak-summary?ai=1', { token: user.token })

    // AI 只是叠加物，不可用时接口仍应 200 并返回规则版结论
    assert.equal(response.status, 200)
    assert.ok(response.data.summary, '规则版结论必须仍然可用')
    assert.equal(response.data.ai, null)
    assert.equal(response.data.aiUnavailableReason, 'not_configured')
    assert.match(response.data.aiErrorMessage, /AI API Key/)
  })
})

describe('活跃时段分布', () => {
  test('按小时聚合答题量，小时值在业务时区内', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    const response = await client.get('/api/v1/stats/hourly?days=7', { token: user.token })

    assert.equal(response.status, 200)
    assert.ok(response.data.items.length >= 1)
    for (const item of response.data.items) {
      assert.ok(item.hour >= 0 && item.hour <= 23, `小时值应在 0-23，实际 ${item.hour}`)
      assert.ok(item.answers > 0)
    }
    const totalAnswers = response.data.items.reduce((sum, item) => sum + item.answers, 0)
    assert.equal(totalAnswers, 3)
  })
})

describe('徽章墙（PRD 4.6.2）', () => {
  test('返回完整徽章字典与解锁状态', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/stats/badges', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.catalog.length, 12)
    assert.equal(response.data.unlocked.length, 0)

    for (const badge of response.data.catalog) {
      assert.ok(badge.code)
      assert.ok(badge.name)
      assert.ok(['streak', 'milestone', 'quality', 'challenge'].includes(badge.category))
      assert.equal(badge.unlocked, false)
    }
  })

  test('连续打卡达标后解锁连续类徽章', async () => {
    const user = await createOnboardedUser(client)

    // 造出前两天已学习的记录，今天再真实答一题凑成连续 3 天
    for (const offset of [1, 2]) {
      await execute(
        `INSERT INTO daily_plans (user_id, plan_date, new_target, review_target, new_done, review_done, correct_count, status)
         VALUES (?, ?, 10, 0, 10, 0, 10, 'done')`,
        [user.userId, addDays(todayKey(), -offset)]
      )
    }

    const created = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })
    const item = created.data.items[0]
    const optionIndex = await correctOptionIndex(created.data.session.id, item.wordId)

    const answer = await client.post(`/api/v1/study/sessions/${created.data.session.id}/answers`, {
      token: user.token,
      body: { wordId: item.wordId, optionIndex, hesitationMs: 1000 },
    })

    const codes = answer.data.unlockedBadges.map((badge) => badge.code)
    assert.ok(codes.includes('streak_3'), `应解锁 streak_3，实际 ${JSON.stringify(codes)}`)

    const badges = await client.get('/api/v1/stats/badges', { token: user.token })
    const streak3 = badges.data.catalog.find((badge) => badge.code === 'streak_3')
    assert.equal(streak3.unlocked, true)
    // 只断言目标徽章，避免依赖同时达成的其他徽章（例如这几天全对也会解锁 accuracy_95）
    assert.ok(badges.data.unlocked.some((item) => item.code === 'streak_3'))
    assert.ok(badges.data.unlocked.every((item) => item.unlockedAt))
  })

  test('同一徽章不会重复解锁', async () => {
    const user = await createOnboardedUser(client)
    for (const offset of [1, 2]) {
      await execute(
        `INSERT INTO daily_plans (user_id, plan_date, new_target, review_target, new_done, review_done, status)
         VALUES (?, ?, 10, 0, 10, 0, 'done')`,
        [user.userId, addDays(todayKey(), -offset)]
      )
    }

    const created = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })

    const firstCodes = []
    for (const item of created.data.items.slice(0, 2)) {
      const optionIndex = await correctOptionIndex(created.data.session.id, item.wordId)
      const answer = await client.post(`/api/v1/study/sessions/${created.data.session.id}/answers`, {
        token: user.token,
        body: { wordId: item.wordId, optionIndex, hesitationMs: 1000 },
      })
      firstCodes.push(...answer.data.unlockedBadges.map((badge) => badge.code))
    }

    assert.ok(firstCodes.includes('streak_3'))
    // 第二次作答时该徽章已在名下，不应再次上报
    const duplicates = firstCodes.filter((code) => code === 'streak_3')
    assert.equal(duplicates.length, 1, 'streak_3 只应上报一次')
  })
})

describe('统计接口的鉴权与隔离', () => {
  test('未登录返回 401', async () => {
    for (const path of [
      '/api/v1/stats/overview',
      '/api/v1/stats/trend',
      '/api/v1/stats/strength',
      '/api/v1/stats/errors',
      '/api/v1/stats/weak-summary',
      '/api/v1/stats/badges',
    ]) {
      const response = await client.get(path)
      assert.equal(response.status, 401, `${path} 应要求登录`)
    }
  })
})
