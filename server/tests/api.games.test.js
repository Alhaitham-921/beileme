import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { queryOne } from '../src/db/pool.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

describe('小游戏记录（PRD 4.5：纯规则实现，不消耗 AI）', () => {
  test('提交一局消消乐结果并标记当日游戏任务完成', async () => {
    const user = await createOnboardedUser(client)

    const response = await client.post('/api/v1/games/records', {
      token: user.token,
      body: { game: 'match', score: 120, correctCount: 12, wrongCount: 2, durationMs: 45000 },
    })

    assert.equal(response.status, 201)
    assert.ok(Number.isInteger(response.data.id))
    assert.equal(response.data.plan.gameDone, true, '完成一局即视为完成当日可选游戏任务')
  })

  test('拼词游戏的字母顺序错误回写为「拼写薄弱」错因证据', async () => {
    const user = await createOnboardedUser(client)
    const words = await client.get('/api/v1/words/books/fixture-demo/words?size=2')
    const [first, second] = words.data.items

    const response = await client.post('/api/v1/games/records', {
      token: user.token,
      body: {
        game: 'spell',
        score: 80,
        correctCount: 3,
        wrongCount: 2,
        durationMs: 30000,
        detail: [
          { wordId: first.id, correct: false, wrongPosition: 2 },
          { wordId: second.id, correct: false, wrongPosition: 0 },
          { wordId: first.id, correct: true },
        ],
      },
    })

    assert.equal(response.status, 201)
    assert.equal(response.data.spellingEvidence, 2, '两处拼错应各记一条证据')

    for (const word of [first, second]) {
      const row = await queryOne(
        "SELECT hit_count FROM user_error_stats WHERE user_id = ? AND word_id = ? AND error_type = 'spelling_weak'",
        [user.userId, word.id]
      )
      assert.ok(row, `${word.spelling} 应有拼写薄弱记录`)
      assert.equal(Number(row.hit_count), 1)
    }
  })

  test('关闭回写开关时不产生错因证据', async () => {
    const user = await createOnboardedUser(client)
    const words = await client.get('/api/v1/words/books/fixture-demo/words?size=1')

    const response = await client.post('/api/v1/games/records', {
      token: user.token,
      body: {
        game: 'spell',
        wrongCount: 1,
        detail: [{ wordId: words.data.items[0].id, correct: false }],
        reportSpellingWeakness: false,
      },
    })

    assert.equal(response.data.spellingEvidence, 0)
    const row = await queryOne(
      "SELECT COUNT(*) AS total FROM user_error_stats WHERE user_id = ? AND error_type = 'spelling_weak'",
      [user.userId]
    )
    assert.equal(Number(row.total), 0)
  })

  test('连续 5 次零失误的拼词游戏解锁「拼词高手」', async () => {
    const user = await createOnboardedUser(client)

    let unlocked = null
    for (let i = 0; i < 5; i += 1) {
      const response = await client.post('/api/v1/games/records', {
        token: user.token,
        body: { game: 'spell', score: 100, correctCount: 10, wrongCount: 0, durationMs: 20000 },
      })
      assert.equal(response.status, 201)
      if (response.data.unlockedBadge) unlocked = response.data.unlockedBadge
    }

    assert.ok(unlocked, '第 5 次零失误后应解锁徽章')
    assert.equal(unlocked.code, 'spell_streak_5')
  })

  test('中途出现失误则不会解锁连续通关徽章', async () => {
    const user = await createOnboardedUser(client)

    for (let i = 0; i < 4; i += 1) {
      await client.post('/api/v1/games/records', {
        token: user.token,
        body: { game: 'spell', wrongCount: 0 },
      })
    }
    const withMistake = await client.post('/api/v1/games/records', {
      token: user.token,
      body: { game: 'spell', wrongCount: 1 },
    })

    assert.equal(withMistake.data.unlockedBadge, null)
    const badges = await client.get('/api/v1/stats/badges', { token: user.token })
    const spell = badges.data.catalog.find((badge) => badge.code === 'spell_streak_5')
    assert.equal(spell.unlocked, false)
  })

  test('非法的游戏类型被拒绝', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/games/records', {
      token: user.token,
      body: { game: 'chess' },
    })
    assert.equal(response.status, 400)
  })

  test('战绩列表按游戏类型过滤并分页', async () => {
    const user = await createOnboardedUser(client)

    await client.post('/api/v1/games/records', { token: user.token, body: { game: 'match', score: 50 } })
    await client.post('/api/v1/games/records', { token: user.token, body: { game: 'spell', score: 90 } })
    await client.post('/api/v1/games/records', { token: user.token, body: { game: 'match', score: 70 } })

    const all = await client.get('/api/v1/games/records', { token: user.token })
    assert.equal(all.data.total, 3)

    const onlyMatch = await client.get('/api/v1/games/records?game=match', { token: user.token })
    assert.equal(onlyMatch.data.total, 2)
    assert.ok(onlyMatch.data.items.every((item) => item.game === 'match'))

    // 最新提交的排在前面
    assert.equal(onlyMatch.data.items[0].score, 70)
  })

  test('汇总接口给出各游戏的最佳成绩', async () => {
    const user = await createOnboardedUser(client)

    await client.post('/api/v1/games/records', {
      token: user.token,
      body: { game: 'match', score: 50, correctCount: 5, wrongCount: 1 },
    })
    await client.post('/api/v1/games/records', {
      token: user.token,
      body: { game: 'match', score: 88, correctCount: 8, wrongCount: 0 },
    })

    const response = await client.get('/api/v1/games/summary', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.items.length, 4, '四种游戏都应返回条目（未玩过的为 0）')

    const match = response.data.items.find((item) => item.game === 'match')
    assert.equal(match.plays, 2)
    assert.equal(match.bestScore, 88)
    assert.equal(match.correct, 13)
    assert.equal(match.wrong, 1)

    const spell = response.data.items.find((item) => item.game === 'spell')
    assert.equal(spell.plays, 0)
    assert.equal(spell.bestScore, 0)
  })

  test('游戏接口需要登录', async () => {
    const list = await client.get('/api/v1/games/records')
    assert.equal(list.status, 401)

    const post = await client.post('/api/v1/games/records', { body: { game: 'match' } })
    assert.equal(post.status, 401)
  })
})
