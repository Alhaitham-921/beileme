import test, { before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'

let client

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)
})

describe('健康检查', () => {
  test('返回服务状态、数据库与 AI 配置状态', async () => {
    const response = await client.get('/api/v1/health')

    assert.equal(response.status, 200)
    assert.equal(response.data.status, 'ok')
    assert.equal(response.data.database.status, 'ok')
    assert.equal(typeof response.data.uptimeSeconds, 'number')
    assert.equal(response.data.ai.configured, false)
    assert.equal(response.data.ai.model, 'deepseek-v4-pro')
  })

  test('根路径返回服务标识', async () => {
    const response = await client.get('/')
    assert.equal(response.status, 200)
    assert.match(response.data.service, /背了么/)
  })
})

describe('统一的错误响应格式', () => {
  test('未知路由返回 404 且结构统一', async () => {
    const response = await client.get('/api/v1/definitely-not-here')

    assert.equal(response.status, 404)
    assert.equal(response.raw.ok, false)
    assert.equal(response.error.code, 'NOT_FOUND')
    assert.ok(response.error.message)
    assert.equal(response.data, undefined)
  })

  test('错误响应不泄露内部实现细节', async () => {
    const response = await client.get('/api/v1/words/99999999')
    const serialized = JSON.stringify(response.raw)

    assert.equal(serialized.includes('at Object.'), false, '不应包含堆栈')
    assert.equal(serialized.includes('F:\\'), false, '不应包含服务器文件路径')
    assert.equal(serialized.includes('mysql'), false, '不应暴露数据库方言')
    assert.equal(serialized.includes('SELECT'), false, '不应暴露 SQL')
  })

  test('请求体不是合法 JSON 时返回 400 而不是 500', async () => {
    const response = await fetch(`${(await getTestServer()).baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"account": "broken"',
    })

    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.equal(payload.error.code, 'BAD_REQUEST')
    assert.match(payload.error.message, /JSON/)
  })

  test('成功响应统一包在 data 字段内', async () => {
    const response = await client.get('/api/v1/health')
    assert.equal(response.raw.ok, true)
    assert.ok(response.raw.data)
  })
})

describe('跨域配置', () => {
  test('允许配置内的前端来源', async () => {
    const response = await fetch(`${(await getTestServer()).baseUrl}/api/v1/health`, {
      headers: { Origin: 'http://localhost:5173' },
    })
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  })

  test('不在白名单内的来源不返回跨域许可头', async () => {
    const response = await fetch(`${(await getTestServer()).baseUrl}/api/v1/health`, {
      headers: { Origin: 'http://evil.example.com' },
    })
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  })
})

describe('鉴权覆盖面', () => {
  test('所有需要登录的接口在未携带令牌时都返回 401', async () => {
    const protectedRoutes = [
      ['GET', '/api/v1/auth/me'],
      ['GET', '/api/v1/profile'],
      ['GET', '/api/v1/study/sessions/1'],
      ['GET', '/api/v1/plan/today'],
      ['GET', '/api/v1/stats/overview'],
      ['GET', '/api/v1/content'],
      ['GET', '/api/v1/games/records'],
      ['GET', '/api/v1/words/recent'],
    ]

    for (const [method, path] of protectedRoutes) {
      const response = await client.request(method, path)
      assert.equal(response.status, 401, `${method} ${path} 应要求登录`)
      assert.equal(response.error.code, 'UNAUTHORIZED')
    }
  })

  test('公开接口无需登录即可访问', async () => {
    const publicRoutes = [
      '/api/v1/health',
      '/api/v1/words/books',
      '/api/v1/words/books/fixture-demo/words',
      '/api/v1/words/1',
      '/api/v1/words/1/related',
    ]

    for (const path of publicRoutes) {
      const response = await client.get(path)
      assert.ok(response.status < 400, `${path} 应可匿名访问，实际 ${response.status}`)
    }
  })

  test('携带合法令牌后受保护接口正常返回', async () => {
    const user = await createOnboardedUser(client)
    const response = await client.get('/api/v1/profile', { token: user.token })
    assert.equal(response.status, 200)
  })
})
