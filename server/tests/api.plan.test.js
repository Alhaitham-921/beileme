import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser, playSession } from './helpers/setup.js'
import { execute, queryOne } from '../src/db/pool.js'
import { todayKey, addDays } from '../src/utils/time.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

describe('今日 Todo（PRD 4.6）', () => {
  test('Onboarding 后自动生成当日计划，含新词与复习目标', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/plan/today', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.plan.date, todayKey(), '计划日期应是业务日期字符串')
    assert.equal(response.data.plan.newTarget, user.profile.newPerDay)
    assert.equal(response.data.plan.newDone, 0)
    assert.equal(response.data.plan.reviewTarget, 0, '新用户没有待复习的词')
    assert.equal(response.data.plan.status, 'pending')
    assert.equal(response.data.tasks.newWords.target, user.profile.newPerDay)
    assert.equal(response.data.tasks.articleOptional, true)
    assert.equal(response.data.tasks.gameOptional, true)
  })

  test('计划目标在当天固化，重复读取不会跳变', async () => {
    const user = await createOnboardedUser(client)
    const first = await client.get('/api/v1/plan/today', { token: user.token })
    const second = await client.get('/api/v1/plan/today', { token: user.token })

    assert.equal(first.data.plan.id, second.data.plan.id)
    assert.equal(first.data.plan.reviewTarget, second.data.plan.reviewTarget)
  })

  test('学习后计划进度与状态同步更新', async () => {
    const user = await createOnboardedUser(client, { dailyTime: '5-10' })
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 10 })

    const response = await client.get('/api/v1/plan/today', { token: user.token })
    assert.equal(response.data.plan.newDone, 10)
    assert.equal(response.data.plan.newPercent, 100)
    assert.equal(response.data.plan.newTarget, 10)
    assert.equal(response.data.plan.allDone, true)
    assert.equal(response.data.plan.status, 'done')
  })

  test('可选短文与小游戏任务可单独标记完成', async () => {
    const user = await createOnboardedUser(client)

    const article = await client.post('/api/v1/plan/today/article', {
      token: user.token,
      body: { done: true },
    })
    assert.equal(article.status, 200)
    assert.equal(article.data.plan.articleDone, true)
    assert.equal(article.data.plan.gameDone, false)

    const game = await client.post('/api/v1/plan/today/game', {
      token: user.token,
      body: { done: true },
    })
    assert.equal(game.data.plan.gameDone, true)

    // 再次调用可以取消勾选
    const undone = await client.post('/api/v1/plan/today/game', {
      token: user.token,
      body: { done: false },
    })
    assert.equal(undone.data.plan.gameDone, false)
  })
})

describe('自适应难度调节（PRD 4.6.1）', () => {
  /** 造出「昨天没完成」的场景 */
  async function makeYesterdayUnfinished(user, { newTarget = 20, newDone = 5, reviewTarget = 10, reviewDone = 2 } = {}) {
    const yesterday = addDays(todayKey(), -1)
    await execute(
      `INSERT INTO daily_plans
         (user_id, plan_date, new_target, review_target, new_done, review_done, status)
       VALUES (?, ?, ?, ?, ?, ?, 'partial')
       ON DUPLICATE KEY UPDATE
         new_target = VALUES(new_target), review_target = VALUES(review_target),
         new_done = VALUES(new_done), review_done = VALUES(review_done), status = 'partial'`,
      [user.userId, yesterday, newTarget, reviewTarget, newDone, reviewDone]
    )
    return yesterday
  }

  test('昨天未完成时返回询问，含四个选项与未完成数量', async () => {
    const user = await createOnboardedUser(client)
    await makeYesterdayUnfinished(user)

    const response = await client.get('/api/v1/plan/today/prompt', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.shouldPrompt, true)
    assert.equal(response.data.reason, 'unfinished_yesterday')
    assert.equal(response.data.date, addDays(todayKey(), -1))
    assert.equal(response.data.unfinished.newRemaining, 15)
    assert.equal(response.data.unfinished.reviewRemaining, 8)
    assert.equal(response.data.options.length, 4)
    assert.deepEqual(
      response.data.options.map((option) => option.value),
      ['too_hard', 'too_much', 'no_time', 'skip']
    )
  })

  test('昨天已完成则不询问', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 20 })
    // 把昨天标记为已完成
    await execute(
      `INSERT INTO daily_plans (user_id, plan_date, new_target, review_target, new_done, review_done, status)
       VALUES (?, ?, 10, 0, 10, 0, 'done')`,
      [user.userId, addDays(todayKey(), -1)]
    )

    const response = await client.get('/api/v1/plan/today/prompt', { token: user.token })
    assert.equal(response.data.shouldPrompt, false)
    assert.equal(response.data.reason, 'no_unfinished_plan')
  })

  test('刚调整过就不再重复询问，避免频繁打扰', async () => {
    const user = await createOnboardedUser(client)
    await makeYesterdayUnfinished(user)

    const first = await client.get('/api/v1/plan/today/prompt', { token: user.token })
    assert.equal(first.data.shouldPrompt, true)

    await client.post('/api/v1/plan/adjust', { token: user.token, body: { reason: 'no_time' } })

    const second = await client.get('/api/v1/plan/today/prompt', { token: user.token })
    assert.equal(second.data.shouldPrompt, false)
    assert.equal(second.data.reason, 'recently_prompted')
  })

  test('选「太多了」会按比例缩量并合并昨日欠账（设上限）', async () => {
    const user = await createOnboardedUser(client) // newPerDay = 20
    await makeYesterdayUnfinished(user, { newTarget: 20, newDone: 5, reviewTarget: 10, reviewDone: 2 })

    const before = await client.get('/api/v1/plan/today', { token: user.token })
    assert.equal(before.data.plan.newTarget, 20)

    const response = await client.post('/api/v1/plan/adjust', {
      token: user.token,
      body: { reason: 'too_much' },
    })

    assert.equal(response.status, 200)
    assert.equal(response.data.plan.newTarget, 14, '20 × 0.7 = 14')
    assert.equal(response.data.plan.adjustReason, 'too_much')
    assert.equal(response.data.applied.mergedFromYesterday, 23, '昨日欠账 15 + 8 = 23')
    assert.equal(response.data.applied.previousReviewTarget, 0)
    // 缩减后的复习量 (0) + 合并量 (23) = 23
    assert.equal(response.data.plan.reviewTarget, 23)
  })

  test('选「太难了」会放慢新词引入并标记更基础的难度倾向', async () => {
    const user = await createOnboardedUser(client)
    await makeYesterdayUnfinished(user)

    const response = await client.post('/api/v1/plan/adjust', {
      token: user.token,
      body: { reason: 'too_hard' },
    })

    assert.equal(response.data.plan.newTarget, 14)
    assert.equal(response.data.applied.difficultyBias, 'easier')
    assert.match(response.data.applied.note, /更高频|更基础/)
    // 只调整新词，复习量不动
    assert.equal(response.data.plan.reviewTarget, 0)
  })

  test('选「没顾上」与「跳过」都不改变计划量', async () => {
    for (const reason of ['no_time', 'skip']) {
      const user = await createOnboardedUser(client)
      await makeYesterdayUnfinished(user)

      const response = await client.post('/api/v1/plan/adjust', {
        token: user.token,
        body: { reason },
      })

      assert.equal(response.data.plan.newTarget, 20, `${reason} 不应改变新词量`)
      assert.equal(response.data.plan.adjustReason, reason)
    }
  })

  test('非法的调整原因被拒绝', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/plan/adjust', {
      token: user.token,
      body: { reason: 'i-dont-want-to-study' },
    })
    assert.equal(response.status, 400)
    assert.equal(response.error.code, 'VALIDATION_FAILED')
  })

  test('调整记录会写回计划，供后续策略参考', async () => {
    const user = await createOnboardedUser(client)
    await makeYesterdayUnfinished(user)
    await client.post('/api/v1/plan/adjust', { token: user.token, body: { reason: 'too_much' } })

    const row = await queryOne('SELECT adjust_reason, adjust_payload, adjusted_at FROM daily_plans WHERE user_id = ? AND plan_date = ?', [
      user.userId,
      todayKey(),
    ])
    assert.equal(row.adjust_reason, 'too_much')
    assert.ok(row.adjusted_at, '应记录调整时间')
    const payload = typeof row.adjust_payload === 'string' ? JSON.parse(row.adjust_payload) : row.adjust_payload
    assert.equal(payload.mergedFromYesterday, 23)
    assert.equal(payload.mergeCap, 40)
  })
})

describe('打卡日历与连续天数（PRD 4.6.2）', () => {
  test('日历返回区间内每天的完成情况', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    const response = await client.get('/api/v1/plan/calendar', { token: user.token })
    assert.equal(response.status, 200)
    assert.equal(response.data.items.length, 30, '默认返回最近 30 天')

    const today = response.data.items.at(-1)
    assert.equal(today.date, todayKey())
    assert.equal(today.studied, true)
    assert.equal(today.newDone, 3)
    assert.equal(today.correct, 3)
    assert.equal(today.wrong, 0)

    // 未学习的日期应明确标记为未学习
    const earlier = response.data.items[0]
    assert.equal(earlier.studied, false)
  })

  test('日历支持指定区间', async () => {
    const user = await createOnboardedUser(client)
    const from = addDays(todayKey(), -6)
    const response = await client.get(`/api/v1/plan/calendar?from=${from}&to=${todayKey()}`, {
      token: user.token,
    })

    assert.equal(response.data.items.length, 7)
    assert.equal(response.data.items[0].date, from)
    assert.equal(response.data.items.at(-1).date, todayKey())
  })

  test('日期格式非法时返回 400', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/plan/calendar?from=2026/01/01', { token: user.token })
    assert.equal(response.status, 400)
  })

  test('连续打卡天数在统计总览中体现', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 2 })

    // 造出前两天也学习过的记录
    for (const offset of [1, 2]) {
      await execute(
        `INSERT INTO daily_plans (user_id, plan_date, new_target, review_target, new_done, review_done, correct_count, wrong_count, status)
         VALUES (?, ?, 10, 0, 10, 0, 10, 0, 'done')`,
        [user.userId, addDays(todayKey(), -offset)]
      )
    }

    const overview = await client.get('/api/v1/stats/overview', { token: user.token })
    assert.equal(overview.data.streak, 3, '今天 + 前两天应连续 3 天')
  })

  test('今天还没学时不打断连续记录，从昨天起算', async () => {
    const user = await createOnboardedUser(client)
    for (const offset of [1, 2]) {
      await execute(
        `INSERT INTO daily_plans (user_id, plan_date, new_target, review_target, new_done, review_done, status)
         VALUES (?, ?, 10, 0, 10, 0, 'done')`,
        [user.userId, addDays(todayKey(), -offset)]
      )
    }

    const overview = await client.get('/api/v1/stats/overview', { token: user.token })
    assert.equal(overview.data.streak, 2)
  })
})

describe('计划接口的鉴权', () => {
  test('未登录访问计划接口返回 401', async () => {
    for (const path of ['/api/v1/plan/today', '/api/v1/plan/today/prompt', '/api/v1/plan/calendar']) {
      const response = await client.get(path)
      assert.equal(response.status, 401, `${path} 应要求登录`)
    }
  })
})
