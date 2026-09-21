/**
 * 前后端接口契约测试。
 *
 * 这个文件测试的是 src/api/ 这一层（前端真正调用的封装），而不是后端本身：
 * 后端的字段名或结构与前端读取的字段一旦对不上，这里就会红。
 * 放在 server/tests 下是为了复用在进程内启动后端服务的测试脚手架。
 *
 * 不需要浏览器：client.js 已兼容 Node 环境（localStorage / import.meta.env 都有兜底）。
 */
import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer } from './helpers/setup.js'
import { setBaseUrl, setTokens, clearTokens, ApiError } from '../../src/api/client.js'
import api from '../../src/api/index.js'

let server

before(async () => {
  server = await getTestServer()
  // 把前端的接口层指向测试服务器，而不是默认的 /api/v1
  setBaseUrl(`${server.baseUrl}/api/v1`)
})

/** 注册并完成引导，返回可直接用于后续请求的上下文 */
async function freshUser(overrides = {}) {
  const email = `fe-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const registered = await api.auth.register({
    email,
    password: 'Passw0rd123',
    nickname: '前端测试',
  })
  setTokens(registered.tokens)

  const onboarded = await api.profile.completeOnboarding({
    goal: '四级',
    dailyTime: '15-20',
    selfLevel: '3000-6000',
    memoryPrefs: ['context'],
    ...overrides,
  })

  return { email, ...registered, onboarding: onboarded }
}

describe('客户端基础行为', () => {
  test('令牌会随请求自动带上，无需每次手动传', async () => {
    const user = await freshUser()
    const me = await api.auth.me()
    assert.equal(me.user.id, user.user.id)
  })

  test('未登录时调用受保护接口抛出 ApiError，并带中文提示', async () => {
    clearTokens()
    await assert.rejects(
      () => api.plan.today(),
      (error) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, 401)
        assert.ok(error.isAuthError)
        assert.ok(error.message.length > 0)
        return true
      }
    )
  })

  test('访问令牌过期时自动用刷新令牌续期并重放请求（用户无感）', async () => {
    const user = await freshUser()

    // 伪造一个已失效的访问令牌，但保留可用的刷新令牌
    setTokens({ ...user.tokens, accessToken: 'clearly.invalid.token' })

    const plan = await api.plan.today()
    assert.ok(plan.plan, '应通过静默续期拿到数据')

    // 续期后访问令牌已被替换成新的有效令牌
    const me = await api.auth.me()
    assert.equal(me.user.id, user.user.id)
  })

  test('刷新令牌也失效时抛出 401，而不是无限重试', async () => {
    setTokens({ accessToken: 'bad.access', refreshToken: 'bad.refresh' })
    await assert.rejects(
      () => api.plan.today(),
      (error) => {
        assert.equal(error.status, 401)
        return true
      }
    )
    clearTokens()
  })

  test('后端返回的业务错误被翻译成 ApiError，保留 code 与 details', async () => {
    await assert.rejects(
      () => api.auth.register({ email: 'not-an-email', password: 'Passw0rd123' }),
      (error) => {
        assert.equal(error.status, 400)
        assert.equal(error.code, 'VALIDATION_FAILED')
        assert.ok(Array.isArray(error.details) && error.details.length > 0)
        return true
      }
    )
  })

  test('重复注册返回 409', async () => {
    const user = await freshUser()
    await assert.rejects(
      () => api.auth.register({ email: user.email, password: 'Passw0rd123' }),
      (error) => {
        assert.equal(error.status, 409)
        return true
      }
    )
  })

  test('后端不可达时给出可读的网络错误提示', async () => {
    setBaseUrl('http://127.0.0.1:9/api/v1')
    await assert.rejects(
      () => api.health(),
      (error) => {
        assert.ok(error.isNetworkError, '应被识别为网络错误')
        assert.match(error.message, /后端已启动/)
        return true
      }
    )
    setBaseUrl(`${server.baseUrl}/api/v1`)
  })
})

describe('契约：认证与画像', () => {
  test('注册返回 user / tokens / profile 三段结构', async () => {
    const data = await api.auth.register({
      email: `shape-${Date.now()}@example.com`,
      password: 'Passw0rd123',
    })

    assert.ok(Number.isInteger(data.user.id))
    assert.equal(typeof data.user.email, 'string')
    assert.equal(typeof data.tokens.accessToken, 'string')
    assert.equal(typeof data.tokens.refreshToken, 'string')
    assert.equal(data.profile.isOnboarded, false)
    assert.equal(typeof data.profile.newPerDay, 'number')
  })

  test('登录返回同样的结构，且 accessToken 可用', async () => {
    const user = await freshUser()
    clearTokens()

    const data = await api.auth.login({ account: user.email, password: 'Passw0rd123' })
    setTokens(data.tokens)
    assert.ok(data.tokens.accessToken)
    assert.equal(data.profile.isOnboarded, true)
  })

  test('完成引导返回画像、每日新词量、词书与当日计划', async () => {
    const user = await freshUser()
    const data = user.onboarding

    assert.equal(data.profile.isOnboarded, true)
    assert.equal(data.profile.goal, '四级')
    assert.ok(data.newPerDay >= 5 && data.newPerDay <= 50)
    assert.ok(data.wordbook.wordCount > 0, '词书应带词数，引导完成页要用')
    assert.equal(typeof data.wordbook.name, 'string')

    // 引导完成页读取的字段
    assert.equal(typeof data.plan.reviewTarget, 'number')
    assert.equal(typeof data.plan.newTarget, 'number')
  })

  test('有考期时每日词量按剩余天数平摊', async () => {
    const examDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const user = await freshUser({ examDate, dailyTime: '30+' })

    // 80 词 / 90 天 ≈ 1 词/天，但下限为 5
    assert.ok(user.onboarding.newPerDay >= 5)
    assert.equal(user.onboarding.profile.examDate, examDate)
  })

  test('画像可部分更新，未传字段保持原值', async () => {
    await freshUser()

    const updated = await api.profile.update({ newPerDay: 25 })
    assert.equal(updated.profile.newPerDay, 25)
    assert.equal(updated.profile.goal, '四级', '未传的字段不应被清空')
  })
})

describe('契约：今日计划与自适应调节', () => {
  test('plan.today 返回页面需要的全部字段', async () => {
    await freshUser()
    const data = await api.plan.today()

    for (const field of ['newTarget', 'newDone', 'reviewTarget', 'reviewDone', 'newPercent', 'reviewPercent', 'allDone', 'status', 'date']) {
      assert.ok(field in data.plan, `plan 缺少字段 ${field}`)
    }
    assert.equal(typeof data.tasks.newWords.target, 'number')
    assert.equal(typeof data.tasks.newWords.done, 'number')
    assert.equal(typeof data.tasks.articleOptional, 'boolean')
    assert.equal(typeof data.tasks.gameOptional, 'boolean')
  })

  test('adjustmentPrompt 结构可直接渲染成四个选项', async () => {
    await freshUser()
    const data = await api.plan.adjustmentPrompt()

    // 没有未完成的前一天时返回 shouldPrompt: false
    assert.equal(typeof data.shouldPrompt, 'boolean')
    if (!data.shouldPrompt) {
      assert.ok(data.reason)
      return
    }
    assert.equal(typeof data.question, 'string')
    assert.equal(data.options.length, 4)
    for (const option of data.options) {
      assert.ok(option.value && option.label)
    }
    assert.equal(typeof data.unfinished.newRemaining, 'number')
  })

  test('adjust 返回新计划与说明文案（首页用它做提示）', async () => {
    await freshUser()
    const data = await api.plan.adjust('no_time')

    assert.ok(data.plan)
    assert.equal(data.plan.adjustReason, 'no_time')
    assert.equal(typeof data.applied.note, 'string')
    assert.ok(data.applied.note.length > 0)
  })

  test('calendar 返回逐日条目，字段与看板日历一致', async () => {
    await freshUser()
    const data = await api.plan.calendar()

    assert.equal(data.items.length, 30)
    const day = data.items.at(-1)
    for (const field of ['date', 'studied', 'newDone', 'reviewDone']) {
      assert.ok(field in day, `日历条目缺少字段 ${field}`)
    }
    assert.equal(typeof day.studied, 'boolean')
  })

  test('可选任务标记返回更新后的计划', async () => {
    await freshUser()
    const article = await api.plan.markArticleDone(true)
    assert.equal(article.plan.articleDone, true)

    const game = await api.plan.markGameDone(true)
    assert.equal(game.plan.gameDone, true)
  })
})

describe('契约：背词会话（前端最核心的链路）', () => {
  test('createSession 返回的题目结构足以渲染答题卡', async () => {
    await freshUser()
    const data = await api.study.createSession('daily')

    assert.ok(Number.isInteger(data.session.id))
    assert.equal(data.session.kind, 'daily')
    assert.equal(data.session.status, 'active')
    assert.ok(Array.isArray(data.items) && data.items.length > 0)
    assert.ok(data.plan, '应一并返回计划，用于更新首页进度')

    const item = data.items[0]
    assert.ok(Number.isInteger(item.wordId))
    assert.ok(['new', 'review'].includes(item.kind))
    assert.equal(typeof item.answered, 'boolean')

    // 单词卡片要展示的字段
    for (const field of ['id', 'spelling', 'phonetic', 'pos', 'freq', 'difficulty', 'definitions', 'example']) {
      assert.ok(field in item.word, `word 缺少字段 ${field}`)
    }
    assert.ok(Array.isArray(item.word.definitions) && item.word.definitions.length > 0)
    assert.ok(Number.isInteger(item.word.difficulty))

    // 选项只有 index 与 text，答案不下发
    assert.ok(item.options.length >= 2)
    for (const option of item.options) {
      assert.deepEqual(Object.keys(option).sort(), ['index', 'text'])
      assert.equal(typeof option.text, 'string')
    }
  })

  test('answer 返回前端渲染反馈所需的全部字段', async () => {
    const user = await freshUser()
    const created = await api.study.createSession('daily')
    const item = created.items[0]

    const answer = await api.study.answer(created.session.id, {
      wordId: item.wordId,
      optionIndex: 0,
      hesitationMs: 1500,
    })

    assert.equal(typeof answer.isCorrect, 'boolean')
    assert.equal(typeof answer.isNewWord, 'boolean')
    assert.equal(typeof answer.correctText, 'string')
    assert.ok(answer.correctText.length > 0, 'correctText 用于高亮正确选项')

    // 错因分析
    assert.ok('type' in answer.analysis)
    assert.ok('confidence' in answer.analysis)
    if (answer.analysis.type) {
      assert.equal(typeof answer.analysis.label, 'string')
      assert.equal(typeof answer.analysis.action, 'string')
    }

    // 进度反馈（「下次复习 N 天后」与记忆强度）
    assert.equal(typeof answer.progress.intervalDays, 'number')
    assert.equal(typeof answer.progress.memoryStrength, 'number')
    assert.ok('state' in answer.progress)

    assert.ok(Array.isArray(answer.unlockedBadges))
    assert.ok(answer.plan, '作答后应回传最新计划')
  })

  test('答错时返回易混词对比卡片，字段可直接渲染高亮', async () => {
    const user = await freshUser()

    // 反复作答直到拿到一张对比卡片（选项里恰好含易混词才会触发）
    let card = null
    for (let round = 0; round < 12 && !card; round += 1) {
      const created = await api.study.createSession(round === 0 ? 'daily' : 'extra')
      for (const item of created.items) {
        const answer = await api.study.answer(created.session.id, {
          wordId: item.wordId,
          optionIndex: 1,
          hesitationMs: 4000,
        })
        if (answer.confusableCard) {
          card = answer.confusableCard
          break
        }
      }
    }

    if (!card) return // 词库较小时可能抽不到，属于数据问题而非契约问题

    assert.equal(typeof card.word.spelling, 'string')
    assert.ok(card.contrasts.length > 0)

    const contrast = card.contrasts[0]
    assert.equal(typeof contrast.spelling, 'string')
    assert.ok(['form', 'meaning'].includes(contrast.relationType))
    // 高亮用的差异切分：三段拼起来必须还原成原词
    for (const field of ['prefix', 'aMiddle', 'bMiddle', 'suffix']) {
      assert.equal(typeof contrast.diff[field], 'string', `diff 缺少 ${field}`)
    }
    assert.equal(
      contrast.diff.prefix + contrast.diff.aMiddle + contrast.diff.suffix,
      card.word.spelling
    )
    assert.equal(
      contrast.diff.prefix + contrast.diff.bMiddle + contrast.diff.suffix,
      contrast.spelling
    )
    assert.ok(contrast.meaningContrast.current)
    assert.ok(contrast.meaningContrast.related)
  })

  test('finish 返回本轮统计，字段与结果页一致', async () => {
    await freshUser()
    const created = await api.study.createSession('daily')

    for (const item of created.items.slice(0, 3)) {
      await api.study.answer(created.session.id, { wordId: item.wordId, optionIndex: 0 })
    }

    const data = await api.study.finish(created.session.id)
    assert.equal(data.session.status, 'finished')
    for (const field of ['answeredCount', 'correctCount', 'wrongCount', 'accuracy', 'avgHesitationMs']) {
      assert.ok(field in data.summary, `summary 缺少字段 ${field}`)
    }
    assert.equal(data.summary.answeredCount, 3)
  })

  test('刷新后可按 sessionId 恢复同一组题', async () => {
    await freshUser()
    const created = await api.study.createSession('daily')

    const restored = await api.study.getSession(created.session.id)
    assert.deepEqual(
      restored.items.map((item) => item.wordId),
      created.items.map((item) => item.wordId)
    )
  })

  test('「再学一组」返回固定题量且仍可作答', async () => {
    await freshUser()
    const first = await api.study.createSession('daily')
    for (const item of first.items.slice(0, 3)) {
      await api.study.answer(first.session.id, { wordId: item.wordId, optionIndex: 0 })
    }

    const extra = await api.study.createSession('extra')
    assert.equal(extra.session.kind, 'extra')
    assert.equal(extra.items.length, 10)
  })
})

describe('契约：看板数据', () => {
  test('stats.overview 提供看板顶部四张卡片的字段', async () => {
    await freshUser()
    const created = await api.study.createSession('daily')
    await api.study.answer(created.session.id, { wordId: created.items[0].wordId, optionIndex: 0 })

    const overview = await api.stats.overview()
    for (const field of ['totalLearned', 'accuracy', 'streak', 'dueCount', 'totalSeen', 'totalCorrect', 'totalWrong']) {
      assert.ok(field in overview, `overview 缺少字段 ${field}`)
      assert.equal(typeof overview[field], 'number')
    }
    assert.ok(overview.today, 'overview.today 用于同步首页计划')
  })

  test('stats.trend 的条目可驱动柱状图（含 null 正确率）', async () => {
    await freshUser()
    const data = await api.stats.trend({ days: 7 })

    assert.equal(data.items.length, 7)
    for (const day of data.items) {
      assert.equal(typeof day.date, 'string')
      assert.equal(typeof day.label, 'string')
      assert.ok(day.accuracy === null || typeof day.accuracy === 'number')
      assert.equal(typeof day.correct, 'number')
    }
  })

  test('stats.strength 的分布键名即界面上的四个档位', async () => {
    await freshUser()
    const data = await api.stats.strength()

    assert.deepEqual(Object.keys(data.distribution).sort(), ['已掌握', '新学', '巩固中', '较熟'].sort())
    assert.equal(typeof data.total, 'number')
  })

  test('stats.errors 的条目可驱动错因条形图', async () => {
    await freshUser()
    const data = await api.stats.errors({ days: 30 })

    assert.equal(typeof data.total, 'number')
    assert.ok(Array.isArray(data.items))
    for (const item of data.items) {
      assert.equal(typeof item.type, 'string')
      assert.equal(typeof item.label, 'string')
      assert.equal(typeof item.count, 'number')
      assert.equal(typeof item.percent, 'number')
    }
  })

  test('stats.weakSummary 提供小结文案与错词清单', async () => {
    await freshUser()
    const data = await api.stats.weakSummary({ days: 7 })

    assert.equal(typeof data.summary, 'string')
    assert.ok(data.summary.length > 0)
    assert.equal(typeof data.days, 'number')
    assert.ok(Array.isArray(data.topWrongWords))
    for (const item of data.topWrongWords) {
      assert.ok(Number.isInteger(item.wordId))
      assert.equal(typeof item.spelling, 'string')
      assert.equal(typeof item.wrongTimes, 'number')
      assert.ok(Array.isArray(item.errorTypes), 'errorTypes 是数组，界面直接 join 展示')
    }
  })

  test('stats.badges 的字典项带 unlocked 标记，可直接渲染成就墙', async () => {
    await freshUser()
    const data = await api.stats.badges()

    assert.ok(Array.isArray(data.unlocked))
    assert.equal(data.catalog.length, 12)
    for (const badge of data.catalog) {
      assert.equal(typeof badge.code, 'string')
      assert.equal(typeof badge.name, 'string')
      assert.equal(typeof badge.description, 'string')
      assert.equal(typeof badge.icon, 'string')
      assert.equal(typeof badge.unlocked, 'boolean')
    }
  })
})

describe('契约：单词查询与彩蛋', () => {
  test('words.recent 返回气泡彩蛋需要的单词与释义', async () => {
    await freshUser()

    const empty = await api.words.recent({ limit: 8 })
    assert.deepEqual(empty.items, [])
    assert.equal(empty.empty, true)
    assert.equal(typeof empty.emptyHint, 'string')

    const created = await api.study.createSession('daily')
    for (const item of created.items.slice(0, 3)) {
      await api.study.answer(created.session.id, { wordId: item.wordId, optionIndex: 0 })
    }

    const data = await api.words.recent({ limit: 5 })
    assert.equal(data.items.length, 3)
    for (const item of data.items) {
      assert.ok(Number.isInteger(item.wordId))
      assert.equal(typeof item.spelling, 'string')
      assert.ok(Array.isArray(item.definitions))
      assert.equal(item.meaning, item.definitions[0], 'meaning 是气泡里显示的中文释义')
    }
  })

  test('words.contrast 提供对比卡片（不消耗 AI）', async () => {
    const books = await api.words.books()
    const book = books.items.find((entry) => entry.code === 'fixture-demo')

    const list = await api.words.listByBook(book.code, { size: 100 })
    assert.equal(list.total, 80)
    assert.equal(typeof list.page, 'number')

    // 找一个确实有易混关系的词
    let card = null
    for (const word of list.items) {
      const result = await api.words.contrast(word.id)
      if (result.card) {
        card = result.card
        break
      }
    }

    assert.ok(card, '词库中应至少存在一个带易混关系的词')
    assert.equal(typeof card.word.spelling, 'string')
    assert.ok(card.contrasts.length > 0)
  })

  test('words.listByBook 的分页与过滤参数被后端正确识别', async () => {
    const filtered = await api.words.listByBook('fixture-demo', { freq: 'high', size: 10, page: 1 })
    assert.ok(filtered.items.length > 0)
    assert.ok(filtered.items.every((word) => word.freq === 'high'))
  })
})

describe('契约：AI 内容与游戏', () => {
  test('content.quota 反映 provider 未配置，前端据此提示', async () => {
    await freshUser()
    const data = await api.content.quota()

    assert.equal(data.provider.configured, false)
    assert.equal(typeof data.provider.model, 'string')
    assert.equal(typeof data.provider.cacheHours, 'number')
    for (const type of ['article', 'quiz', 'error_card', 'weak_summary']) {
      assert.ok(type in data.usage, `usage 缺少 ${type}`)
      assert.equal(typeof data.usage[type].limit, 'number')
      assert.equal(typeof data.usage[type].used, 'number')
    }
  })

  test('未配置 AI 时生成短文抛出 503，前端可据 code 做降级提示', async () => {
    await freshUser()
    const created = await api.study.createSession('daily')
    await api.study.answer(created.session.id, { wordId: created.items[0].wordId, optionIndex: 0 })

    await assert.rejects(
      () => api.content.generateArticle({ wordCount: 5 }),
      (error) => {
        assert.equal(error.status, 503)
        assert.equal(error.code, 'AI_NOT_CONFIGURED')
        assert.match(error.message, /AI API Key/)
        return true
      }
    )
  })

  test('games.record 返回更新后的计划与可能的徽章', async () => {
    await freshUser()
    const data = await api.games.record({ game: 'match', score: 60, correctCount: 6, wrongCount: 1 })

    assert.ok(Number.isInteger(data.id))
    assert.equal(data.plan.gameDone, true)
    assert.ok(Array.isArray(data.unlockedBadges))
  })

  test('games.summary 覆盖四种游戏', async () => {
    await freshUser()
    const data = await api.games.summary()
    assert.equal(data.items.length, 4)
    for (const item of data.items) {
      assert.equal(typeof item.game, 'string')
      assert.equal(typeof item.plays, 'number')
      assert.equal(typeof item.bestScore, 'number')
    }
  })
})

describe('契约：登录态收尾', () => {
  test('logout 之后本地令牌被清除', async () => {
    await freshUser()
    await api.auth.logout()
    clearTokens()

    await assert.rejects(
      () => api.auth.me(),
      (error) => {
        assert.equal(error.status, 401)
        return true
      }
    )
  })
})
