import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  getTestServer,
  createClient,
  createOnboardedUser,
  playSession,
  correctOptionIndex,
} from './helpers/setup.js'
import { queryOne, execute } from '../src/db/pool.js'
import { toJson } from '../src/utils/json.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

/**
 * 构造一个确定的会话：目标词与干扰项都由测试指定，
 * 用于精确验证错因归因链路（真实抽题无法保证抽到想要的易混对）。
 */
async function craftSession(userId, targetSpelling, wrongSpelling, { hesitationFriendly = true } = {}) {
  const target = await queryOne('SELECT * FROM words WHERE spelling = ?', [targetSpelling])
  const wrong = await queryOne('SELECT * FROM words WHERE spelling = ?', [wrongSpelling])
  assert.ok(target, `词库中应存在 ${targetSpelling}`)
  assert.ok(wrong, `词库中应存在 ${wrongSpelling}`)

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
    [userId, toJson(queue)]
  )

  return {
    sessionId: Number(result.insertId),
    wordId: Number(target.id),
    wrongWordId: Number(wrong.id),
    targetSpelling,
    wrongSpelling,
    hesitationFriendly,
  }
}

describe('创建学习会话', () => {
  test('每日会话按计划返回新词，且每个单词带 4 个选项', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })

    assert.equal(response.status, 201)
    assert.equal(response.data.session.kind, 'daily')
    assert.equal(response.data.session.status, 'active')
    assert.ok(response.data.items.length > 0, '首次学习应返回新词')
    assert.equal(response.data.items.length, response.data.session.plannedCount)

    for (const item of response.data.items) {
      assert.equal(item.options.length, 4, '选择题应有 4 个选项')
      assert.ok(item.word.spelling)
      assert.ok(item.word.definitions.length > 0)
      assert.equal(item.kind, 'new')
    }
  })

  test('接口不下发正确答案，防止客户端伪造对错', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })

    const serialized = JSON.stringify(response.data)
    assert.equal(serialized.includes('"correct"'), false, '响应体不应出现 correct 字段')

    for (const item of response.data.items) {
      for (const option of item.options) {
        assert.deepEqual(Object.keys(option).sort(), ['index', 'text'])
      }
    }
  })

  test('每日新词量受 onboarding 结果约束', async () => {
    const user = await createOnboardedUser(client, { dailyTime: '5-10' })
    const response = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })

    // 5-10 分钟对应 10 个新词基准，「15-20」则为 20
    assert.ok(response.data.items.length <= 10, `实际 ${response.data.items.length}`)
    assert.ok(response.data.items.length >= 5)
  })

  test('「再学一组」不受每日计划限制，题量固定为 10', async () => {
    const user = await createOnboardedUser(client, { dailyTime: '5-10' })

    // 先学完一轮，制造出「已学过的词」
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 5 })

    const response = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'extra' },
    })

    assert.equal(response.status, 201)
    assert.equal(response.data.session.kind, 'extra')
    assert.equal(response.data.items.length, 10)
  })

  test('每日额度再大也会被单会话上限截断', async () => {
    const user = await createOnboardedUser(client)

    // 当日计划的目标量在创建时固化，改画像不会追溯今天已生成的计划，
    // 因此这里直接改当日计划来构造「额度很大」的场景
    await execute('UPDATE daily_plans SET new_target = 100 WHERE user_id = ? AND plan_date = ?', [
      user.userId,
      user.plan.date,
    ])

    const response = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })
    assert.equal(response.status, 201)
    // 单会话最多 60 题（MAX_SESSION_SIZE），避免一次拉取过多
    assert.equal(response.data.items.length, 60)
  })

  test('未登录不能创建会话', async () => {
    const response = await client.post('/api/v1/study/sessions', { body: { kind: 'daily' } })
    assert.equal(response.status, 401)
  })
})

describe('提交作答：正确路径', () => {
  test('答对后进度被创建，记忆强度大于 0，计划计数增加', async () => {
    const user = await createOnboardedUser(client)

    const created = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })
    const { session, items } = created.data
    const item = items[0]
    const optionIndex = await correctOptionIndex(session.id, item.wordId)

    const response = await client.post(`/api/v1/study/sessions/${session.id}/answers`, {
      token: user.token,
      body: { wordId: item.wordId, optionIndex, hesitationMs: 1200 },
    })

    assert.equal(response.status, 201)
    const data = response.data

    assert.equal(data.isCorrect, true)
    assert.equal(data.isNewWord, true)
    assert.equal(data.quality, 5, '答对且快应为 5 分')
    assert.equal(data.analysis.type, null, '答对不产生错因')
    assert.equal(data.analysis.confidence, 'high')
    assert.equal(data.confusableCard, null)

    assert.equal(data.progress.repetitions, 1)
    assert.equal(data.progress.intervalDays, 1)
    // 首次答对即排入复习队列，因此是 reviewing 而不是 learning
    assert.equal(data.progress.state, 'reviewing')
    assert.ok(data.progress.memoryStrength > 0, '记忆强度应大于 0')
    assert.equal(data.progress.timesSeen, 1)
    assert.equal(data.progress.timesCorrect, 1)
    assert.equal(data.progress.timesWrong, 0)

    // 计划计数（新词）应 +1
    assert.equal(data.plan.newDone, 1)
    assert.equal(data.plan.status === 'done' || data.plan.status === 'partial', true)
  })

  test('答对但犹豫久记为低置信度，复习间隔比熟练更短', async () => {
    const fastUser = await createOnboardedUser(client)
    const slowUser = await createOnboardedUser(client)

    async function firstAnswer(user, hesitationMs) {
      const created = await client.post('/api/v1/study/sessions', {
        token: user.token,
        body: { kind: 'daily' },
      })
      const { session, items } = created.data
      const optionIndex = await correctOptionIndex(session.id, items[0].wordId)
      const response = await client.post(`/api/v1/study/sessions/${session.id}/answers`, {
        token: user.token,
        body: { wordId: items[0].wordId, optionIndex, hesitationMs },
      })
      return response.data
    }

    const fast = await firstAnswer(fastUser, 900)
    const slow = await firstAnswer(slowUser, 7000)

    assert.equal(fast.quality, 5)
    assert.equal(slow.quality, 3, '答对但慢应为 3 分')
    assert.equal(slow.analysis.confidence, 'low')
    assert.match(slow.analysis.action, /低置信度/)
  })

  test('同一单词首次作答后再次提交被拒绝', async () => {
    const user = await createOnboardedUser(client)
    const created = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })
    const { session, items } = created.data
    const optionIndex = await correctOptionIndex(session.id, items[0].wordId)

    const first = await client.post(`/api/v1/study/sessions/${session.id}/answers`, {
      token: user.token,
      body: { wordId: items[0].wordId, optionIndex },
    })
    assert.equal(first.status, 201)

    const second = await client.post(`/api/v1/study/sessions/${session.id}/answers`, {
      token: user.token,
      body: { wordId: items[0].wordId, optionIndex },
    })
    assert.equal(second.status, 409)
  })

  test('提交不属于本会话的单词被拒绝', async () => {
    const user = await createOnboardedUser(client)
    const created = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })

    const sessionWordIds = created.data.items.map((item) => Number(item.wordId))
    // 显式展开占位符：NOT IN (?) 依赖驱动做数组展开，行为不够确定
    const placeholders = sessionWordIds.map(() => '?').join(',')
    const outsider = await queryOne(
      `SELECT id FROM words WHERE id NOT IN (${placeholders}) LIMIT 1`,
      sessionWordIds
    )
    assert.ok(outsider, '本会话未覆盖全部词库，应能找到一个外部词')

    const response = await client.post(`/api/v1/study/sessions/${created.data.session.id}/answers`, {
      token: user.token,
      body: { wordId: Number(outsider.id), optionIndex: 0 },
    })
    assert.equal(response.status, 400)
    assert.match(response.error.message, /不属于当前学习会话/)
  })

  test('选项下标越界被拒绝', async () => {
    const user = await createOnboardedUser(client)
    const created = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })

    const response = await client.post(`/api/v1/study/sessions/${created.data.session.id}/answers`, {
      token: user.token,
      body: { wordId: created.data.items[0].wordId, optionIndex: 99 },
    })
    // 99 超出 schema 上限 9，被参数校验拦下
    assert.equal(response.status, 400)
  })

  test('既不传 optionIndex 也不传 isCorrect 时被拒绝', async () => {
    const user = await createOnboardedUser(client)
    const created = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })

    const response = await client.post(`/api/v1/study/sessions/${created.data.session.id}/answers`, {
      token: user.token,
      body: { wordId: created.data.items[0].wordId },
    })
    assert.equal(response.status, 400)
  })
})

describe('错因分析引擎（PRD 4.2.3）', () => {
  test('极短时间选错 → 盲猜，间隔缩短为 0.25 天且连续答对清零', async () => {
    const user = await createOnboardedUser(client)
    const context = await craftSession(user.userId, 'abandon', 'ability')

    const response = await client.post(`/api/v1/study/sessions/${context.sessionId}/answers`, {
      token: user.token,
      body: { wordId: context.wordId, optionIndex: 1, hesitationMs: 800 },
    })

    assert.equal(response.status, 201)
    const data = response.data
    assert.equal(data.isCorrect, false)
    assert.equal(data.analysis.type, 'guess')
    assert.equal(data.analysis.label, '盲猜 / 生疏')
    assert.equal(data.progress.repetitions, 0)
    assert.equal(data.progress.intervalDays, 0.25)
    assert.equal(data.progress.state, 'learning')
    assert.equal(data.progress.timesWrong, 1)
    assert.equal(data.confusableCard, null, '盲猜不触发易混词卡片')
  })

  test('犹豫很久选错 → 记忆模糊', async () => {
    const user = await createOnboardedUser(client)
    const context = await craftSession(user.userId, 'abandon', 'ability')

    const response = await client.post(`/api/v1/study/sessions/${context.sessionId}/answers`, {
      token: user.token,
      body: { wordId: context.wordId, optionIndex: 1, hesitationMs: 9000 },
    })

    assert.equal(response.data.analysis.type, 'vague')
    assert.equal(response.data.progress.intervalDays, 0.5)
  })

  test('选错的释义属于形近词 → 形近混淆并返回对比记忆卡片', async () => {
    const user = await createOnboardedUser(client)
    // adapt / adopt 是词库中相似度最高的形近对（0.8）
    const context = await craftSession(user.userId, 'adapt', 'adopt')

    const response = await client.post(`/api/v1/study/sessions/${context.sessionId}/answers`, {
      token: user.token,
      body: { wordId: context.wordId, optionIndex: 1, hesitationMs: 4000 },
    })

    assert.equal(response.status, 201)
    const data = response.data

    assert.equal(data.analysis.type, 'form_confusion')
    assert.equal(data.analysis.label, '形近词混淆')
    assert.equal(data.analysis.needConfusableCard, true)
    assert.equal(data.analysis.matchedRelatedWordId, context.wrongWordId)
    assert.match(data.analysis.action, /易混词对比卡片/)

    // 对比卡片应包含目标词与易混词，并带词形差异切分
    assert.ok(data.confusableCard, '应返回对比记忆卡片')
    assert.equal(data.confusableCard.word.spelling, 'adapt')
    const adopt = data.confusableCard.contrasts.find((item) => item.spelling === 'adopt')
    assert.ok(adopt, '卡片中应包含 adopt')
    assert.equal(adopt.relationType, 'form')
    assert.equal(adopt.diff.prefix, 'ad')
    assert.equal(adopt.diff.aMiddle, 'a')
    assert.equal(adopt.diff.bMiddle, 'o')
    assert.ok(adopt.meaningContrast.current.includes('适应'))
  })

  test('选错的释义属于近义词 → 语义混淆', async () => {
    const user = await createOnboardedUser(client)
    // accomplish / achieve 共享释义「实现」
    const context = await craftSession(user.userId, 'accomplish', 'achieve')

    const response = await client.post(`/api/v1/study/sessions/${context.sessionId}/answers`, {
      token: user.token,
      body: { wordId: context.wordId, optionIndex: 1, hesitationMs: 4000 },
    })

    const type = response.data.analysis.type
    // 二者既形近又近义时，取相似度更高的关系（此处为近义）
    assert.ok(
      ['meaning_confusion', 'form_confusion'].includes(type),
      `应归为混淆类错因，实际 ${type}`
    )
    assert.equal(response.data.analysis.needConfusableCard, true)
  })

  test('反复在同一组词间答错 → 升级为系统性混淆', async () => {
    const user = await createOnboardedUser(client)

    const types = []
    for (let round = 0; round < 3; round += 1) {
      const context = await craftSession(user.userId, 'adapt', 'adopt')
      const response = await client.post(`/api/v1/study/sessions/${context.sessionId}/answers`, {
        token: user.token,
        body: { wordId: context.wordId, optionIndex: 1, hesitationMs: 4000 },
      })
      types.push(response.data.analysis.type)
    }

    assert.equal(types[0], 'form_confusion')
    assert.equal(types[1], 'form_confusion')
    assert.equal(types[2], 'systematic_confusion', '第三次应升级为系统性混淆')

    // 错因按类型分别累计：前两次记在 form_confusion，第三次升级后记在 systematic_confusion
    const stats = await queryOne(
      `SELECT COALESCE(SUM(hit_count), 0) AS total FROM user_error_stats
        WHERE user_id = ? AND word_id = ?`,
      [user.userId, (await queryOne('SELECT id FROM words WHERE spelling = ?', ['adapt'])).id]
    )
    assert.equal(Number(stats.total), 3, '同一单词的错因命中总数应为 3')
  })

  test('拼写模式下的字母顺序错误 → 拼写薄弱（无选项场景）', async () => {
    const user = await createOnboardedUser(client)
    const context = await craftSession(user.userId, 'abandon', 'ability')

    const response = await client.post(`/api/v1/study/sessions/${context.sessionId}/answers`, {
      token: user.token,
      body: {
        wordId: context.wordId,
        isCorrect: false,
        spellingMistake: true,
        source: 'game',
        hesitationMs: 3000,
      },
    })

    assert.equal(response.status, 201)
    assert.equal(response.data.analysis.type, 'spelling_weak')
    assert.equal(response.data.analysis.needSpellingGame, true)
    assert.equal(response.data.isCorrect, false)
  })

  test('易混词存在历史混淆时，复习间隔进一步打折（PRD 4.2.2）', async () => {
    const cleanUser = await createOnboardedUser(client)
    const confusedUser = await createOnboardedUser(client)

    const adapt = await queryOne('SELECT id FROM words WHERE spelling = ?', ['adapt'])
    const adaptId = Number(adapt.id)

    async function answerCorrectly(user) {
      const context = await craftSession(user.userId, 'adapt', 'adopt')
      const response = await client.post(`/api/v1/study/sessions/${context.sessionId}/answers`, {
        token: user.token,
        body: { wordId: context.wordId, optionIndex: 0, hesitationMs: 1000 },
      })
      assert.equal(response.status, 201)
      return response.data
    }

    // 第一次答对：repetitions 从 0 到 1，间隔固定 1 天，体现不出折扣（有 1 天下限）
    await answerCorrectly(cleanUser)
    await answerCorrectly(confusedUser)

    // 给其中一方制造「该词存在形近混淆历史」的证据
    await execute(
      `INSERT INTO user_error_stats (user_id, word_id, error_type, hit_count)
       VALUES (?, ?, 'form_confusion', 2)
       ON DUPLICATE KEY UPDATE hit_count = hit_count + 2`,
      [confusedUser.userId, adaptId]
    )

    // 第二次答对：间隔进入 6 天档，此时混淆折扣才会体现在结果里
    const clean = await answerCorrectly(cleanUser)
    const confused = await answerCorrectly(confusedUser)

    assert.equal(clean.hasConfusionHistory, false)
    assert.equal(confused.hasConfusionHistory, true)
    assert.equal(clean.progress.intervalDays, 6, '干净词的第二次间隔应为 6 天')
    assert.equal(
      confused.progress.intervalDays,
      4.2,
      '易混词间隔应打 0.7 折（6 × 0.7 = 4.2）'
    )
  })
})

describe('会话收尾与统计', () => {
  test('结束会话返回本轮统计', async () => {
    const user = await createOnboardedUser(client)
    const { session, results } = await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    const finished = await client.post(`/api/v1/study/sessions/${session.id}/finish`, {
      token: user.token,
    })

    assert.equal(finished.status, 200)
    assert.equal(finished.data.session.status, 'finished')
    assert.equal(finished.data.summary.answeredCount, 3)
    assert.equal(finished.data.summary.correctCount, results.length)
    assert.equal(finished.data.summary.wrongCount, 0)
    assert.equal(finished.data.summary.accuracy, 100)
    assert.ok(finished.data.summary.avgHesitationMs > 0, '平均犹豫时长应被统计')
  })

  test('会话结束后不能再提交作答', async () => {
    const user = await createOnboardedUser(client)
    const created = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })
    const { session, items } = created.data

    await client.post(`/api/v1/study/sessions/${session.id}/finish`, { token: user.token })

    const response = await client.post(`/api/v1/study/sessions/${session.id}/answers`, {
      token: user.token,
      body: { wordId: items[0].wordId, optionIndex: 0 },
    })
    assert.equal(response.status, 409)
  })

  test('会话可按 id 取回，题目与创建时保持一致', async () => {
    const user = await createOnboardedUser(client)
    const created = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'daily' },
    })
    const { session, items } = created.data

    const refetched = await client.get(`/api/v1/study/sessions/${session.id}`, { token: user.token })
    assert.equal(refetched.status, 200)
    assert.deepEqual(
      refetched.data.items.map((item) => item.wordId),
      items.map((item) => item.wordId),
      '刷新后应恢复同一组题'
    )
  })

  test('答题流水被正确写入 answer_logs', async () => {
    const user = await createOnboardedUser(client)
    const { session, items, results } = await playSession(client, user, {
      strategy: 'all-correct',
      maxAnswers: 4,
    })

    const rows = await queryOne(
      'SELECT COUNT(*) AS total FROM answer_logs WHERE user_id = ? AND session_id = ?',
      [user.userId, session.id]
    )
    assert.equal(Number(rows.total), results.length)

    const first = await queryOne(
      'SELECT * FROM answer_logs WHERE user_id = ? AND word_id = ?',
      [user.userId, items[0].wordId]
    )
    assert.equal(Number(first.result), 1)
    assert.equal(Number(first.is_new_word), 1)
    assert.equal(Number(first.quality), 5)
  })

  test('计划计数区分新词与复习', async () => {
    const user = await createOnboardedUser(client)
    // 第一轮全是新词
    await playSession(client, user, { strategy: 'all-correct', maxAnswers: 3 })

    const plan = await client.get('/api/v1/plan/today', { token: user.token })
    assert.equal(plan.data.plan.newDone, 3)
    assert.equal(plan.data.plan.reviewDone, 0)

    // 第二轮针对同一批词（用「再学一组」拿到已学词）时计为复习
    const second = await client.post('/api/v1/study/sessions', {
      token: user.token,
      body: { kind: 'extra' },
    })
    const reviewItem = second.data.items.find((item) => item.kind === 'review')
    assert.ok(reviewItem, '再学一组应包含已学过的词')

    const optionIndex = await correctOptionIndex(second.data.session.id, reviewItem.wordId)
    const answer = await client.post(`/api/v1/study/sessions/${second.data.session.id}/answers`, {
      token: user.token,
      body: { wordId: reviewItem.wordId, optionIndex, hesitationMs: 1000 },
    })

    assert.equal(answer.data.isNewWord, false)
    assert.equal(answer.data.plan.reviewDone, 1)
    assert.equal(answer.data.plan.newDone, 3, '新词计数不应被复习影响')
  })
})

describe('错题汇总接口（PRD 4.3.3）', () => {
  test('汇总近期错词、错因分布与易混词', async () => {
    const user = await createOnboardedUser(client)

    for (let i = 0; i < 2; i += 1) {
      const context = await craftSession(user.userId, 'adapt', 'adopt')
      await client.post(`/api/v1/study/sessions/${context.sessionId}/answers`, {
        token: user.token,
        body: { wordId: context.wordId, optionIndex: 1, hesitationMs: 4000 },
      })
    }

    const response = await client.get('/api/v1/study/errors/digest?days=7', { token: user.token })
    assert.equal(response.status, 200)

    const adapt = response.data.wrongWords.find((item) => item.spelling === 'adapt')
    assert.ok(adapt, '应包含错词 adapt')
    assert.equal(adapt.wrongTimes, 2)
    assert.equal(adapt.breakdown.formConfusion, 2)
    assert.ok(adapt.related.length > 0, '应附带易混词，便于直接生成专项巩固')

    const formEntry = response.data.errorDistribution.find((item) => item.type === 'form_confusion')
    assert.ok(formEntry)
    assert.equal(formEntry.count, 2)
  })

  test('没有错题时返回空结构而不是报错', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/study/errors/digest', { token: user.token })

    assert.equal(response.status, 200)
    assert.deepEqual(response.data.wrongWords, [])
    assert.deepEqual(response.data.errorDistribution, [])
  })
})
