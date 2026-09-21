import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

describe('注册', () => {
  test('邮箱注册成功，返回令牌与默认画像', async () => {
    const email = `reg-${Date.now()}@example.com`
    const response = await client.post('/api/v1/auth/register', {
      body: { email, password: 'Passw0rd123', nickname: '小明' },
    })

    assert.equal(response.status, 201)
    assert.equal(response.data.user.email, email)
    assert.equal(response.data.user.nickname, '小明')
    assert.ok(response.data.tokens.accessToken)
    assert.ok(response.data.tokens.refreshToken)
    assert.equal(response.data.tokens.tokenType, 'Bearer')
    // 注册即建默认画像，避免后续接口判空
    assert.equal(response.data.profile.isOnboarded, false)
    assert.equal(response.data.profile.newPerDay, 15)
  })

  test('响应中绝不包含口令哈希等敏感字段', async () => {
    const response = await client.post('/api/v1/auth/register', {
      body: { email: `safe-${Date.now()}@example.com`, password: 'Passw0rd123' },
    })
    const serialized = JSON.stringify(response.raw)
    assert.equal(serialized.includes('password_hash'), false)
    assert.equal(serialized.includes('scrypt'), false)
    assert.equal(serialized.includes('Passw0rd123'), false)
  })

  test('重复邮箱返回 409', async () => {
    const email = `dup-${Date.now()}@example.com`
    const first = await client.post('/api/v1/auth/register', {
      body: { email, password: 'Passw0rd123' },
    })
    assert.equal(first.status, 201)

    const second = await client.post('/api/v1/auth/register', {
      body: { email, password: 'Passw0rd123' },
    })
    assert.equal(second.status, 409)
    assert.equal(second.error.code, 'CONFLICT')
  })

  test('口令过短或过于简单被拒绝', async () => {
    const short = await client.post('/api/v1/auth/register', {
      body: { email: `a-${Date.now()}@example.com`, password: 'a1b2' },
    })
    assert.equal(short.status, 400)
    assert.equal(short.error.code, 'VALIDATION_FAILED')

    const noDigit = await client.post('/api/v1/auth/register', {
      body: { email: `b-${Date.now()}@example.com`, password: 'onlyletters' },
    })
    assert.equal(noDigit.status, 400)
  })

  test('既无邮箱也无手机号时拒绝注册', async () => {
    const response = await client.post('/api/v1/auth/register', {
      body: { password: 'Passw0rd123' },
    })
    assert.equal(response.status, 400)
  })

  test('邮箱格式非法时返回字段级错误', async () => {
    const response = await client.post('/api/v1/auth/register', {
      body: { email: 'not-an-email', password: 'Passw0rd123' },
    })
    assert.equal(response.status, 400)
    assert.ok(Array.isArray(response.error.details))
    assert.ok(response.error.details.some((detail) => detail.path.includes('email')))
  })
})

describe('登录', () => {
  test('正确的邮箱与口令可登录', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/auth/login', {
      body: { account: user.email, password: user.password },
    })

    assert.equal(response.status, 200)
    assert.equal(response.data.user.id, user.userId)
    assert.ok(response.data.tokens.accessToken)
    assert.ok(response.data.profile.isOnboarded)
  })

  test('邮箱大小写不敏感', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/auth/login', {
      body: { account: user.email.toUpperCase(), password: user.password },
    })
    assert.equal(response.status, 200)
  })

  test('口令错误与账号不存在返回同一种提示，避免账号枚举', async () => {
    const user = await createOnboardedUser(client)

    const wrongPassword = await client.post('/api/v1/auth/login', {
      body: { account: user.email, password: 'WrongPass123' },
    })
    const missingAccount = await client.post('/api/v1/auth/login', {
      body: { account: `nobody-${Date.now()}@example.com`, password: 'Passw0rd123' },
    })

    assert.equal(wrongPassword.status, 401)
    assert.equal(missingAccount.status, 401)
    assert.equal(wrongPassword.error.message, missingAccount.error.message)
  })

  test('账号格式不合法时返回 400 而不是 401', async () => {
    const response = await client.post('/api/v1/auth/login', {
      body: { account: '既不是邮箱也不是手机号', password: 'Passw0rd123' },
    })
    assert.equal(response.status, 400)
  })
})

describe('令牌与登录态', () => {
  test('未携带令牌访问受保护接口返回 401', async () => {
    const response = await client.get('/api/v1/auth/me')
    assert.equal(response.status, 401)
    assert.equal(response.error.code, 'UNAUTHORIZED')
  })

  test('伪造令牌返回 401', async () => {
    const response = await client.get('/api/v1/auth/me', { token: 'not.a.real.token' })
    assert.equal(response.status, 401)
  })

  test('携带有效令牌可获取当前用户与画像', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/auth/me', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.user.id, user.userId)
    assert.equal(response.data.profile.goal, '四级')
    assert.equal(response.data.profile.isOnboarded, true)
  })

  test('刷新令牌会轮换：旧令牌用过一次后立即失效', async () => {
    const user = await createOnboardedUser(client)

    const first = await client.post('/api/v1/auth/refresh', {
      body: { refreshToken: user.refreshToken },
    })
    assert.equal(first.status, 200)
    assert.ok(first.data.tokens.accessToken)
    assert.notEqual(first.data.tokens.refreshToken, user.refreshToken)

    const replay = await client.post('/api/v1/auth/refresh', {
      body: { refreshToken: user.refreshToken },
    })
    assert.equal(replay.status, 401, '旧刷新令牌被重放时应拒绝')

    // 新令牌仍可继续使用
    const second = await client.post('/api/v1/auth/refresh', {
      body: { refreshToken: first.data.tokens.refreshToken },
    })
    assert.equal(second.status, 200)
  })

  test('登出后原访问令牌立即失效', async () => {
    const user = await createOnboardedUser(client)

    const before = await client.get('/api/v1/auth/me', { token: user.token })
    assert.equal(before.status, 200)

    const logout = await client.post('/api/v1/auth/logout', { token: user.token })
    assert.equal(logout.status, 200)

    // token_version 自增后，已签发的 access token 也不该再被接受
    const after = await client.get('/api/v1/auth/me', { token: user.token })
    assert.equal(after.status, 401)
  })

  test('修改密码后强制重新登录', async () => {
    const user = await createOnboardedUser(client)

    const changed = await client.post('/api/v1/auth/password', {
      token: user.token,
      body: { currentPassword: user.password, newPassword: 'NewPassw0rd456' },
    })
    assert.equal(changed.status, 200)
    assert.equal(changed.data.reloginRequired, true)

    const stale = await client.get('/api/v1/auth/me', { token: user.token })
    assert.equal(stale.status, 401)

    const relogin = await client.post('/api/v1/auth/login', {
      body: { account: user.email, password: 'NewPassw0rd456' },
    })
    assert.equal(relogin.status, 200)
  })

  test('修改密码时当前密码错误被拒绝', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.post('/api/v1/auth/password', {
      token: user.token,
      body: { currentPassword: 'WrongPass123', newPassword: 'NewPassw0rd456' },
    })
    assert.equal(response.status, 401)
  })
})

describe('多用户数据隔离（PRD 4.7）', () => {
  test('用户 A 的学习会话不能被用户 B 读取', async () => {
    const userA = await createOnboardedUser(client)
    const userB = await createOnboardedUser(client)

    const created = await client.post('/api/v1/study/sessions', {
      token: userA.token,
      body: { kind: 'daily' },
    })
    assert.equal(created.status, 201)
    const sessionId = created.data.session.id

    const asOwner = await client.get(`/api/v1/study/sessions/${sessionId}`, { token: userA.token })
    assert.equal(asOwner.status, 200)

    const asOther = await client.get(`/api/v1/study/sessions/${sessionId}`, { token: userB.token })
    assert.equal(asOther.status, 404, '越权访问应表现为资源不存在，而不是泄露存在性')
  })

  test('用户 B 无法向用户 A 的会话提交作答', async () => {
    const userA = await createOnboardedUser(client)
    const userB = await createOnboardedUser(client)

    const created = await client.post('/api/v1/study/sessions', {
      token: userA.token,
      body: { kind: 'daily' },
    })
    const sessionId = created.data.session.id
    const wordId = created.data.items[0].wordId

    const response = await client.post(`/api/v1/study/sessions/${sessionId}/answers`, {
      token: userB.token,
      body: { wordId, optionIndex: 0 },
    })
    assert.equal(response.status, 404)
  })

  test('用户 A 的学习进度不影响用户 B 的统计', async () => {
    const userA = await createOnboardedUser(client)
    const userB = await createOnboardedUser(client)

    const { playSession } = await import('./helpers/setup.js')
    await playSession(client, userA, { strategy: 'all-correct', maxAnswers: 3 })

    const statsA = await client.get('/api/v1/stats/overview', { token: userA.token })
    const statsB = await client.get('/api/v1/stats/overview', { token: userB.token })

    assert.ok(statsA.data.totalLearned >= 3, `A 应有学习记录，实际 ${statsA.data.totalLearned}`)
    assert.equal(statsB.data.totalLearned, 0, 'B 不该看到 A 的进度')
    assert.equal(statsB.data.totalSeen, 0)
  })
})
