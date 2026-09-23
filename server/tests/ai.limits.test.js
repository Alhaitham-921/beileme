/**
 * 用户自定义 AI 额度（token 上限）的测试。
 *
 * 这些用例锚定两个容易搞错的事实：
 *  1. max_tokens 是「天花板」而不是「预留」——设大几乎不花钱，设小会真的失败
 *  2. 未自定义的字段必须回落到系统推荐值，这样以后调默认值时老用户自动受益
 */
import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser, playSession } from './helpers/setup.js'
import {
  RECOMMENDED_LIMITS,
  LIMIT_BOUNDS,
  LIMIT_PRESETS,
  NUMERIC_LIMIT_FIELDS,
} from '../src/services/ai/aiSettingsService.js'
import { config } from '../src/config.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

describe('额度选项', () => {
  test('系统推荐值落在允许范围内', () => {
    for (const field of NUMERIC_LIMIT_FIELDS) {
      const value = RECOMMENDED_LIMITS[field]
      const [min, max] = LIMIT_BOUNDS[field]
      assert.ok(value >= min && value <= max, `${field} 推荐值 ${value} 超出 [${min}, ${max}]`)
    }
  })

  test('每个数值字段都有推荐值与范围，不会出现「有范围没默认」的字段', () => {
    for (const field of Object.keys(LIMIT_BOUNDS)) {
      assert.ok(field in RECOMMENDED_LIMITS, `${field} 缺少推荐值`)
    }
    assert.equal(
      NUMERIC_LIMIT_FIELDS.length,
      Object.keys(LIMIT_BOUNDS).length,
      '两个列表必须一一对应，否则界面上会出现取不到推荐值的输入框'
    )
  })

  test('三个档位的数值也都在允许范围内，且满足 省钱 < 均衡 < 高质量', () => {
    const order = ['frugal', 'balanced', 'quality']
    for (const id of order) {
      const preset = LIMIT_PRESETS[id]
      assert.ok(preset, `${id} 档位应存在`)
      for (const field of NUMERIC_LIMIT_FIELDS) {
        const value = preset.values[field]
        const [min, max] = LIMIT_BOUNDS[field]
        assert.ok(value >= min && value <= max, `${id}.${field}=${value} 超出 [${min}, ${max}]`)
      }
    }

    for (const field of ['articleTokens', 'quizTokens', 'errorCardTokens', 'summaryTokens']) {
      assert.ok(
        LIMIT_PRESETS.frugal.values[field] < LIMIT_PRESETS.balanced.values[field],
        `${field} 省钱档应低于均衡档`
      )
      assert.ok(
        LIMIT_PRESETS.balanced.values[field] < LIMIT_PRESETS.quality.values[field],
        `${field} 均衡档应低于高质量档`
      )
    }
  })

  test('均衡档就是系统推荐值（数值部分）', () => {
    for (const field of NUMERIC_LIMIT_FIELDS) {
      assert.equal(LIMIT_PRESETS.balanced.values[field], RECOMMENDED_LIMITS[field], `${field} 不一致`)
    }
  })

  test('档位不会顺手改掉「允许内部思考」这个开关', () => {
    for (const id of ['frugal', 'balanced', 'quality']) {
      assert.equal(
        LIMIT_PRESETS[id].values.allowThinking,
        undefined,
        `${id} 档位不应包含 allowThinking，否则套用档位会静默关掉用户手动打开的开关`
      )
    }
  })

  test('配置里的默认额度与推荐值一致（避免两处数字漂移）', () => {
    assert.equal(config.ai.maxOutputTokens.article, RECOMMENDED_LIMITS.articleTokens)
    assert.equal(config.ai.maxOutputTokens.quiz, RECOMMENDED_LIMITS.quizTokens)
    assert.equal(config.ai.maxOutputTokens.error_card_batch, RECOMMENDED_LIMITS.errorCardTokens)
    assert.equal(config.ai.maxOutputTokens.weak_summary, RECOMMENDED_LIMITS.summaryTokens)
    assert.equal(config.ai.maxInputTokens, RECOMMENDED_LIMITS.maxInputTokens)
  })
})

describe('读取与保存额度', () => {
  test('新用户默认使用系统推荐值', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/ai/limits', { token: user.token })

    assert.equal(response.status, 200)
    assert.deepEqual(response.data.limits, { ...RECOMMENDED_LIMITS, usingRecommended: true })
    assert.ok(Array.isArray(response.data.presets) && response.data.presets.length === 3)
    assert.ok(response.data.measured.articleTokens > 0, '应给出实测参考值供用户参考')
  })

  test('套用档位后立即生效', async () => {
    const user = await createOnboardedUser(client)

    const applied = await client.put('/api/v1/ai/limits', {
      token: user.token,
      body: { preset: 'frugal' },
    })

    assert.equal(applied.status, 200)
    assert.equal(applied.data.preset, 'frugal')
    assert.equal(applied.data.limits.articleTokens, LIMIT_PRESETS.frugal.values.articleTokens)

    const read = await client.get('/api/v1/ai/limits', { token: user.token })
    assert.equal(read.data.limits.articleTokens, LIMIT_PRESETS.frugal.values.articleTokens)
    assert.equal(read.data.limits.usingRecommended, false)
  })

  test('可以逐项调整，只改传入的字段', async () => {
    const user = await createOnboardedUser(client)

    const saved = await client.put('/api/v1/ai/limits', {
      token: user.token,
      body: { articleTokens: 1500 },
    })

    assert.equal(saved.data.limits.articleTokens, 1500)
    // 未传的字段应保持推荐值
    assert.equal(saved.data.limits.quizTokens, RECOMMENDED_LIMITS.quizTokens)
    assert.equal(saved.data.limits.summaryTokens, RECOMMENDED_LIMITS.summaryTokens)
  })

  test('单个字段传 null 表示恢复该字段的推荐值', async () => {
    const user = await createOnboardedUser(client)
    await client.put('/api/v1/ai/limits', { token: user.token, body: { articleTokens: 2000 } })

    const restored = await client.put('/api/v1/ai/limits', {
      token: user.token,
      body: { articleTokens: null },
    })
    assert.equal(restored.data.limits.articleTokens, RECOMMENDED_LIMITS.articleTokens)
  })

  test('超出范围的数值被拒绝，而不是静默截断', async () => {
    const user = await createOnboardedUser(client)

    const tooSmall = await client.put('/api/v1/ai/limits', {
      token: user.token,
      body: { articleTokens: 10 },
    })
    assert.equal(tooSmall.status, 400)
    assert.match(tooSmall.error.message, /1000|300/)

    const tooLarge = await client.put('/api/v1/ai/limits', {
      token: user.token,
      body: { articleTokens: 999999 },
    })
    assert.equal(tooLarge.status, 400)

    // 越界的请求不应写入任何值
    const read = await client.get('/api/v1/ai/limits', { token: user.token })
    assert.equal(read.data.limits.articleTokens, RECOMMENDED_LIMITS.articleTokens)
  })

  test('未知档位被拒绝', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.put('/api/v1/ai/limits', {
      token: user.token,
      body: { preset: 'free-lunch' },
    })
    assert.equal(response.status, 400)
  })

  test('恢复推荐值会清掉全部自定义', async () => {
    const user = await createOnboardedUser(client)
    await client.put('/api/v1/ai/limits', { token: user.token, body: { preset: 'quality' } })

    const reset = await client.post('/api/v1/ai/limits/reset', { token: user.token })
    assert.equal(reset.status, 200)
    assert.equal(reset.data.limits.usingRecommended, true)
    assert.equal(reset.data.limits.articleTokens, RECOMMENDED_LIMITS.articleTokens)
  })

  test('用户之间互不影响', async () => {
    const a = await createOnboardedUser(client)
    const b = await createOnboardedUser(client)

    await client.put('/api/v1/ai/limits', { token: a.token, body: { preset: 'quality' } })

    const readB = await client.get('/api/v1/ai/limits', { token: b.token })
    assert.equal(readB.data.limits.usingRecommended, true, 'B 不该受 A 的设置影响')
    assert.equal(readB.data.limits.articleTokens, RECOMMENDED_LIMITS.articleTokens)
  })

  test('未登录不能读写额度', async () => {
    const read = await client.get('/api/v1/ai/limits')
    assert.equal(read.status, 401)

    const write = await client.put('/api/v1/ai/limits', { body: { preset: 'balanced' } })
    assert.equal(write.status, 401)
  })
})

describe('额度影响生成前的预估', () => {
  test('预估计使用用户设置的输出上限，而不是系统默认值', async () => {
    const user = await createOnboardedUser(client)
    // 预估需要「最近学过的词」作为目标词，所以先背几个
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    const before = await client.post('/api/v1/content/preflight', {
      token: user.token,
      body: { type: 'article', wordCount: 5 },
    })
    assert.equal(before.data.maxOutputTokens, RECOMMENDED_LIMITS.articleTokens)

    await client.put('/api/v1/ai/limits', { token: user.token, body: { articleTokens: 2500 } })

    const after = await client.post('/api/v1/content/preflight', {
      token: user.token,
      body: { type: 'article', wordCount: 5 },
    })
    assert.equal(after.data.maxOutputTokens, 2500, '预估要与用户设置一致，否则展示的成本不准')
    // 上限提高后，最坏情况成本也应相应提高（诚实反映上限）
    assert.ok(after.data.worstCaseCostUsd > before.data.worstCaseCostUsd)
  })

  test('输入上限调小会让目标词数量自动减少', async () => {
    const user = await createOnboardedUser(client)
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    const generous = await client.post('/api/v1/content/preflight', {
      token: user.token,
      body: { type: 'article', wordCount: 15 },
    })

    await client.put('/api/v1/ai/limits', { token: user.token, body: { maxInputTokens: 700 } })

    const tight = await client.post('/api/v1/content/preflight', {
      token: user.token,
      body: { type: 'article', wordCount: 15 },
    })

    assert.ok(
      tight.data.wordCount <= generous.data.wordCount,
      `输入上限调小后目标词不应反而变多：${tight.data.wordCount} vs ${generous.data.wordCount}`
    )
    assert.ok(tight.data.estimatedInputTokens <= 700, `实际 ${tight.data.estimatedInputTokens} 超过上限`)
  })
})
