/**
 * 测试基础设施。
 *
 * 关键约束：本模块先只加载 config，改完配置后再动态 import 其余模块，
 * 这样就能保证连接池、迁移等拿到的是测试库配置。
 * ESM 的静态 import 会被提升到赋值语句之前，因此不能用静态 import 做这件事。
 */
import { once } from 'node:events'
import { config } from '../../src/config.js'

const TEST_DB = process.env.DB_TEST_NAME || 'beileme_test'

// 测试会 DROP DATABASE，必须守住命名约定，避免误伤开发库
if (!TEST_DB.endsWith('_test')) {
  throw new Error(
    `拒绝执行：测试库名必须以 _test 结尾，当前为 "${TEST_DB}"。` +
      '这是为了避免测试脚本把开发或生产数据库整个删掉。'
  )
}

config.db.database = TEST_DB
// 测试环境一律切断真实 AI 调用，保证结果确定且不产生费用
config.ai.apiKey = ''

const { resetDatabase, runMigrations } = await import('../../src/db/migrate.js')
const { seed } = await import('../../src/db/seed.js')
const { createApp } = await import('../../src/app.js')
const { closePool } = await import('../../src/db/pool.js')

const silentLogger = { log() {}, warn() {}, error() {} }

/** 重建测试库结构并导入种子数据 */
export async function setupTestDatabase() {
  await resetDatabase(TEST_DB)
  await runMigrations({ database: TEST_DB, logger: silentLogger })
  await seed({ migrate: false, logger: silentLogger })
}

export async function closeTestDatabase() {
  await closePool()
}

/** 在随机端口启动应用，避免与开发服务器抢 3001 */
export async function startTestServer() {
  const app = createApp()
  const server = app.listen(0)
  await once(server, 'listening')
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve)
      }),
  }
}

let databaseReady = null
let sharedServer = null

/**
 * 整个测试进程只建一次库、只起一个服务。
 * 配合 --test-isolation=none，所有测试文件共享同一个进程与同一个模块实例，
 * 因此这里用记忆化避免每个文件重复重建数据库。
 */
export function ensureTestDatabase() {
  if (!databaseReady) databaseReady = setupTestDatabase()
  return databaseReady
}

export async function getTestServer() {
  await ensureTestDatabase()
  if (!sharedServer) sharedServer = await startTestServer()
  return sharedServer
}

/** 轻量 API 客户端，统一拆包 { ok, data } 与 { ok, error } */
export function createClient(baseUrl) {
  async function request(method, path, { token, body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const text = await response.text()
    let payload = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = text
      }
    }

    return {
      status: response.status,
      ok: response.ok,
      raw: payload,
      data: payload && typeof payload === 'object' ? payload.data : undefined,
      error: payload && typeof payload === 'object' ? payload.error : undefined,
    }
  }

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, options) => request('POST', path, options),
    put: (path, options) => request('PUT', path, options),
    del: (path, options) => request('DELETE', path, options),
  }
}

let accountSeq = 0

/**
 * 注册一个测试用户并完成 Onboarding，返回可复用的上下文。
 */
export async function createOnboardedUser(client, overrides = {}) {
  accountSeq += 1
  const email = `tester${process.pid}-${accountSeq}-${Date.now()}@example.com`
  const password = 'Passw0rd123'

  const registered = await client.post('/api/v1/auth/register', {
    body: { email, password, nickname: `测试用户${accountSeq}` },
  })
  if (registered.status !== 201) {
    throw new Error(`注册测试用户失败：${registered.status} ${JSON.stringify(registered.raw)}`)
  }

  const token = registered.data.tokens.accessToken
  const refreshToken = registered.data.tokens.refreshToken

  const onboarding = await client.post('/api/v1/profile/onboarding', {
    token,
    body: {
      goal: '四级',
      dailyTime: '15-20',
      selfLevel: '3000-6000',
      memoryPrefs: ['context', 'example'],
      ...overrides,
    },
  })
  if (onboarding.status !== 200) {
    throw new Error(`Onboarding 失败：${onboarding.status} ${JSON.stringify(onboarding.raw)}`)
  }

  return {
    email,
    password,
    userId: registered.data.user.id,
    token,
    refreshToken,
    profile: onboarding.data.profile,
    plan: onboarding.data.plan,
  }
}

/**
 * 开一轮学习并答完前若干题。
 * @param {'all-correct'|'all-wrong'} strategy
 */
export async function playSession(client, user, { kind = 'daily', strategy = 'all-correct', maxAnswers = 5 } = {}) {
  const created = await client.post('/api/v1/study/sessions', { token: user.token, body: { kind } })
  if (created.status !== 201) {
    throw new Error(`创建会话失败：${created.status} ${JSON.stringify(created.raw)}`)
  }

  const { session, items } = created.data
  const results = []

  for (const item of items.slice(0, maxAnswers)) {
    // 两个分支都必须 await：漏掉 await 会把 Promise 传进请求体，
    // 表现为「optionIndex 不是数字」这种看起来毫不相关的报错
    const optionIndex =
      strategy === 'all-correct'
        ? await correctOptionIndex(session.id, item.wordId)
        : await wrongOptionIndex(session.id, item.wordId)

    const answer = await client.post(`/api/v1/study/sessions/${session.id}/answers`, {
      token: user.token,
      body: {
        wordId: item.wordId,
        optionIndex,
        hesitationMs: strategy === 'all-correct' ? 1200 : 800,
      },
    })
    if (answer.status !== 201) {
      throw new Error(`提交作答失败：${answer.status} ${JSON.stringify(answer.raw)}`)
    }
    results.push(answer.data)
  }

  return { session, items, results }
}

/**
 * 接口刻意不下发选项的正确标记（答案只留在服务端，防止客户端伪造对错），
 * 所以测试直接从数据库的队列表里取正确下标。
 */
async function optionIndexFromQueue(sessionId, wordId, wantCorrect) {
  const { queryOne } = await import('../../src/db/pool.js')
  const row = await queryOne('SELECT queue FROM study_sessions WHERE id = ?', [sessionId])
  const queue = typeof row.queue === 'string' ? JSON.parse(row.queue) : row.queue
  const entry = queue.find((candidate) => Number(candidate.wordId) === Number(wordId))
  const option = entry.options.find((candidate) => Boolean(candidate.correct) === wantCorrect)
  if (!option) throw new Error(`会话 ${sessionId} 中未找到匹配的选项`)
  return option.index
}

export function correctOptionIndex(sessionId, wordId) {
  return optionIndexFromQueue(sessionId, wordId, true)
}

export function wrongOptionIndex(sessionId, wordId) {
  return optionIndexFromQueue(sessionId, wordId, false)
}

export { config, TEST_DB }
