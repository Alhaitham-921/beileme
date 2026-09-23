/**
 * AI 内容生成与成本控制的集成测试。
 *
 * 用一个本地的假 AI 服务（模仿 OpenAI 的 /chat/completions）替代真实模型，
 * 这样可以精确断言「发了多少次请求、Prompt 里到底装了什么」——
 * 而这两点正是成本控制的核心，靠读代码是验证不了的。
 *
 * 覆盖：
 *  - 用户自带 Key 的保存（含保存前连通性校验）与 Provider 优先级
 *  - Prompt 精简（不带例句）
 *  - 多错词合并成一次请求
 *  - token 用量与成本被记账
 *  - 缓存复用不重复调用
 */
import test, { before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { getTestServer, createClient, createOnboardedUser, playSession } from './helpers/setup.js'
import { query, queryOne } from '../src/db/pool.js'
import { encryptSecret, decryptSecret, maskSecret } from '../src/services/ai/cryptoKeys.js'
import { normalizeApiKey, matchModel } from '../src/services/ai/aiProvider.js'

let client
/** 假服务收到的全部请求，供断言使用 */
let received = []

/** 假服务宣称支持的模型 */
const MOCK_MODELS = ['mock-model', 'mock-model-mini']
/** 是否让 /models 可用（用来测试「中转没实现 /models」时的回退路径） */
let mockModelListEnabled = true
/** 是否对未知模型返回 400（模拟真实服务商行为） */
let mockRejectUnknownModel = true
/** 是否拒绝 thinking 参数（模拟只认 reasoning_effort 的端点） */
let mockRejectThinkingParam = false
/**
 * 是否让正文永远为空、只返回思考内容。
 * 复刻实测里最坑的一种失败：额度全花在内部思考上，正文一个字都没有。
 */
let mockReasoningOnly = false

/** 根据 user 内容判断该返回哪种结构，模仿真实模型的输出 */
function respondFor(body) {
  const user = body.messages?.find((m) => m.role === 'user')?.content || ''

  if (user.includes('reply with: ok')) {
    return { content: 'ok' }
  }
  if (user.includes('写一篇英语巩固短文')) {
    return {
      content: JSON.stringify({
        title: 'A Test Article',
        body: 'This is a **test** body used by the integration test.',
        glossary: [{ spelling: 'test', definition: '测试' }],
        topicUsed: '环保',
      }),
    }
  }
  if (user.includes('对比记忆卡片')) {
    // 按请求里出现的编号数量返回对应张数的卡片
    const count = (user.match(/^\d+\. /gm) || []).length
    const spellings = [...user.matchAll(/^\d+\. ([a-zA-Z'.]+)\(/gm)].map((m) => m[1])
    return {
      content: JSON.stringify({
        cards: Array.from({ length: count }, (_, i) => ({
          spelling: spellings[i] || `word${i}`,
          headline: '测试用核心区别',
          distinctions: [{ spelling: spellings[i] || `word${i}`, coreMeaning: '测试', usage: '', example: '', translation: '' }],
          mnemonic: '测试用记忆口诀',
          formTip: '测试用词形提示',
        })),
      }),
    }
  }
  if (user.includes('阅读理解题')) {
    return {
      content: JSON.stringify({
        questions: [
          { type: 'vocabulary', stem: 'q1', options: ['A', 'B', 'C', 'D'], answerIndex: 0, explanation: 'e1', targetWord: '' },
          { type: 'detail', stem: 'q2', options: ['A', 'B', 'C', 'D'], answerIndex: 1, explanation: 'e2', targetWord: '' },
          { type: 'inference', stem: 'q3', options: ['A', 'B', 'C', 'D'], answerIndex: 2, explanation: 'e3', targetWord: '' },
        ],
      }),
    }
  }
  if (user.includes('薄弱点小结')) {
    return {
      content: JSON.stringify({ headline: '测试小结', observations: ['o1'], suggestions: ['s1'] }),
    }
  }
  return { content: '{}' }
}

let mockServer
let mockBaseUrl

before(async () => {
  const server = await getTestServer()
  client = createClient(server.baseUrl)

  mockServer = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      let body = {}
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        body = {}
      }
      received.push({ method: req.method, url: req.url, authorization: req.headers.authorization || '', body })

      // 模型列表：用于验证「先用不花钱的 /models 验 Key」这条链路
      if (req.method === 'GET' && req.url.includes('/models')) {
        if (mockModelListEnabled && !req.url.includes('no-models')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ data: MOCK_MODELS.map((id) => ({ id })) }))
        } else {
          res.writeHead(404).end('{}')
        }
        return
      }

      if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
        res.writeHead(404).end('{}')
        return
      }

      // 模拟「模型不存在」：真实服务商会对未知模型返回 400
      if (body.model && !MOCK_MODELS.includes(body.model) && mockRejectUnknownModel) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({ error: { message: 'Model Not Exist', type: 'invalid_request_error' } })
        )
        return
      }

      // 模拟只认 reasoning_effort、不认 thinking 的端点
      if (mockRejectThinkingParam && body.thinking) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Unsupported parameter: thinking' } }))
        return
      }

      /**
       * 模拟「额度全被内部思考吃掉」。
       * 此时正文为空、finish_reason=length，服务端应当降级并在提示里带上具体数字。
       */
      if (mockReasoningOnly) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            model: body.model,
            choices: [
              {
                message: { role: 'assistant', content: '', reasoning_content: '我要先想很久很久……' },
                finish_reason: 'length',
              },
            ],
            usage: {
              prompt_tokens: 150,
              completion_tokens: body.max_tokens,
              completion_tokens_details: { reasoning_tokens: body.max_tokens },
            },
          })
        )
        return
      }

      const { content } = respondFor(body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          model: body.model,
          choices: [{ message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 150, completion_tokens: 90 },
        })
      )
    })
  })

  mockServer.listen(0)
  await once(mockServer, 'listening')
  mockBaseUrl = `http://127.0.0.1:${mockServer.address().port}/v1`
})

after(async () => {
  if (mockServer) await new Promise((resolve) => mockServer.close(resolve))
})

/** 每个用例开始前清空请求记录，避免互相干扰 */
function resetReceived() {
  received = []
}

/** 造一个已完成引导 + 学过几个词的测试用户，并给他配上指向假服务的 Key */
async function userWithMockProvider({ account = true } = {}) {
  const user = await createOnboardedUser(client)
  await playSession(client, user, { strategy: 'all-wrong', maxAnswers: 3 })

  if (!account) return { user }

  const saved = await client.put('/api/v1/ai/keys', {
    token: user.token,
    body: {
      provider: 'custom',
      apiKey: 'sk-integration-test-key',
      baseUrl: mockBaseUrl,
      model: 'mock-model',
      label: '测试假服务',
    },
  })
  assert.equal(saved.status, 201, `保存 Key 失败：${JSON.stringify(saved.raw)}`)

  return { user, key: saved.data.key }
}

describe('用户自带 Key：加密存储与连通性校验', () => {
  test('密文可解回原文，被打码后再回传给前端', () => {
    const plain = 'sk-abcdef1234567890abcdef'
    const cipher = encryptSecret(plain)

    assert.notEqual(cipher, plain)
    assert.ok(cipher.startsWith('v1:'), '应带版本前缀便于日后换算法')
    assert.equal(decryptSecret(cipher), plain)
    assert.match(maskSecret(plain), /^sk-abc\*\*\*\*cdef$/)
    assert.equal(maskSecret(plain).includes('1234567890'), false, '打码后不应出现中间片段')
  })

  test('密文被篡改时解密失败，而不是解出垃圾', () => {
    const cipher = encryptSecret('sk-original-key-value')
    const parts = cipher.split(':')
    // 改动密文最后一段的一个字符
    const tampered = [parts[0], parts[1], parts[2], `${parts[3].slice(0, -2)}XX`].join(':')
    assert.equal(decryptSecret(tampered), null)
  })

  test('格式不对或为空时安全返回 null', () => {
    assert.equal(decryptSecret(null), null)
    assert.equal(decryptSecret(''), null)
    assert.equal(decryptSecret('not-a-cipher'), null)
    assert.equal(decryptSecret('v2:a:b:c'), null, '未知版本应拒绝而不是猜测')
  })

  test('保存 Key 前会先验证连通性，验证失败不入库', async () => {
    const user = await createOnboardedUser(client)
    resetReceived()

    const failed = await client.put('/api/v1/ai/keys', {
      token: user.token,
      body: {
        provider: 'custom',
        apiKey: 'sk-invalid-key-for-test',
        baseUrl: 'http://127.0.0.1:9/v1',
        model: 'nope',
      },
    })

    assert.equal(failed.status, 400)
    assert.equal(failed.error.code, 'AI_KEY_UNVERIFIED')

    const list = await client.get('/api/v1/ai/keys', { token: user.token })
    assert.deepEqual(list.data.items, [], '未通过校验的 Key 不应入库')
  })

  test('保存成功的 Key 只回打码值，明文绝不出现在任何响应里', async () => {
    const { user, key } = await userWithMockProvider()

    assert.ok(key.maskedKey.includes('****'))
    assert.equal(JSON.stringify(key).includes('sk-integration-test-key'), false)

    const status = await client.get('/api/v1/ai/status', { token: user.token })
    const serialized = JSON.stringify(status.data)
    assert.equal(serialized.includes('sk-integration-test-key'), false, '状态接口不得泄露明文 Key')
    assert.equal(status.data.mode, 'user', '配了自带 Key 后应优先使用它')
    assert.equal(status.data.activeProvider.label, '测试假服务')
  })

  test('Key 可以删除，删除后回落到「未配置」', async () => {
    const { user, key } = await userWithMockProvider()

    const removed = await client.del(`/api/v1/ai/keys/${key.id}`, { token: user.token })
    assert.equal(removed.status, 200)

    const status = await client.get('/api/v1/ai/status', { token: user.token })
    assert.equal(status.data.mode, 'none')
    assert.deepEqual(status.data.keys, [])
  })

  test('数据库里存的是密文而不是明文', async () => {
    const { user } = await userWithMockProvider()

    const row = await queryOne('SELECT key_cipher FROM user_api_keys WHERE user_id = ?', [user.userId])
    assert.ok(row, '应有一行记录')
    assert.notEqual(row.key_cipher, 'sk-integration-test-key')
    assert.ok(row.key_cipher.startsWith('v1:'))
    assert.equal(row.key_cipher.includes('sk-integration-test-key'), false)
  })

  test('别人的 Key 删不掉', async () => {
    const { key } = await userWithMockProvider()
    const other = await createOnboardedUser(client)

    const response = await client.del(`/api/v1/ai/keys/${key.id}`, { token: other.token })
    assert.equal(response.status, 404)
  })
})

describe('Key 校验的诊断能力', () => {
  test('模型名匹配忽略大小写（实测遇到的真实问题）', () => {
    const models = ['deepseek-flash', 'deepseek-v4-pro']

    assert.equal(matchModel(models, 'deepseek-flash'), 'deepseek-flash', '完全一致直接命中')
    // 用户手打成 deepSeek-flash / DEEPSEEK-FLASH 都应被纠正，而不是判失败
    assert.equal(matchModel(models, 'deepSeek-flash'), 'deepseek-flash')
    assert.equal(matchModel(models, 'DEEPSEEK-V4-PRO'), 'deepseek-v4-pro')
    assert.equal(matchModel(models, '  deepseek-flash  '), 'deepseek-flash')

    // 真正不存在、或存在歧义时不应乱猜
    assert.equal(matchModel(models, 'deepseek-chat'), null)
    assert.equal(matchModel(['a-b', 'A-B'], 'a-b'), 'a-b', '完全一致优先')
    assert.equal(matchModel([], 'anything'), null)
    assert.equal(matchModel(models, ''), null)
  })

  test('归一化会清掉粘贴时常见的杂质', () => {
    assert.equal(normalizeApiKey('  sk-abc123  '), 'sk-abc123')
    assert.equal(normalizeApiKey('"sk-abc123"'), 'sk-abc123')
    assert.equal(normalizeApiKey("'sk-abc123'"), 'sk-abc123')
    assert.equal(normalizeApiKey('Bearer sk-abc123'), 'sk-abc123')
    assert.equal(normalizeApiKey('sk-abc\n123'), 'sk-abc123')
    assert.equal(normalizeApiKey(null), '')
    // 不应误伤正常的 Key
    assert.equal(normalizeApiKey('sk-proj-AbC-123_xyz'), 'sk-proj-AbC-123_xyz')
  })

  test('模型名不在可用列表时，明确报「模型不存在」并列出可用模型', async () => {
    const user = await createOnboardedUser(client)

    const response = await client.put('/api/v1/ai/keys', {
      token: user.token,
      body: {
        provider: 'custom',
        apiKey: 'sk-valid-looking-key',
        baseUrl: mockBaseUrl,
        model: 'model-that-does-not-exist',
      },
    })

    assert.equal(response.status, 400)
    assert.equal(response.error.code, 'AI_KEY_UNVERIFIED')
    assert.equal(response.error.details.kind, 'model_not_found')
    // Key 本身是有效的，这一点要明确告诉用户，否则他会以为是 Key 填错了
    assert.match(response.error.details.message, /Key 是有效的/)
    assert.deepEqual(response.error.details.availableModels, MOCK_MODELS)
    assert.match(response.error.details.hint, /mock-model/)

    // 诊断过程要能看出是哪一步失败的
    const steps = response.error.details.steps
    assert.ok(steps.some((step) => step.step === '列出可用模型' && step.ok))
    assert.ok(steps.some((step) => step.step === '检查模型名' && !step.ok))

    // 未通过校验，不应入库
    const list = await client.get('/api/v1/ai/keys', { token: user.token })
    assert.deepEqual(list.data.items, [])
  })

  test('校验流程先用不花钱的 /models 验证 Key', async () => {
    const user = await createOnboardedUser(client)
    resetReceived()

    const saved = await client.put('/api/v1/ai/keys', {
      token: user.token,
      body: { provider: 'custom', apiKey: 'sk-verify-flow-key', baseUrl: mockBaseUrl, model: 'mock-model' },
    })
    assert.equal(saved.status, 201, JSON.stringify(saved.raw))

    // 应先用 GET /models（不消耗 token），再做一次真实调用
    const modelsCall = received.find((item) => item.method === 'GET' && item.url.includes('/models'))
    assert.ok(modelsCall, '应先调用 /models 验证 Key')
    assert.match(modelsCall.authorization, /^Bearer sk-verify-flow-key$/, '应带上用户的 Key')

    const verifySteps = saved.data.test.steps.map((step) => step.step)
    assert.deepEqual(verifySteps, ['列出可用模型', '检查模型名', '实际调用'])
    assert.equal(saved.data.test.verifiedBy, 'models+chat')
  })

  test('粘贴时带上引号或 Bearer 前缀也能通过校验', async () => {
    const user = await createOnboardedUser(client)

    const saved = await client.put('/api/v1/ai/keys', {
      token: user.token,
      body: {
        provider: 'custom',
        apiKey: '  "Bearer sk-pasted-messy-key"  ',
        baseUrl: mockBaseUrl,
        model: 'mock-model',
      },
    })

    assert.equal(saved.status, 201, JSON.stringify(saved.raw))

    // 归一化后的 Key 才是实际发出去的
    const chatCall = received.filter((item) => item.url.includes('/chat/completions')).at(-1)
    assert.match(chatCall.authorization, /^Bearer sk-pasted-messy-key$/)
  })

  test('中转服务没实现 /models 时自动回退到真实调用探测', async () => {
    mockModelListEnabled = false
    try {
      const user = await createOnboardedUser(client)
      const saved = await client.put('/api/v1/ai/keys', {
        token: user.token,
        body: { provider: 'custom', apiKey: 'sk-no-models-endpoint', baseUrl: mockBaseUrl, model: 'mock-model' },
      })

      assert.equal(saved.status, 201, JSON.stringify(saved.raw))
      assert.equal(saved.data.test.verifiedBy, 'chat')
      const steps = saved.data.test.steps
      assert.ok(steps.some((step) => step.step === '列出可用模型' && !step.ok), '应记录 /models 不可用')
      assert.ok(steps.some((step) => step.step === '实际调用' && step.ok), '应回退到真实调用')
    } finally {
      mockModelListEnabled = true
    }
  })

  test('试连接口只校验不保存，可以反复调试', async () => {
    const user = await createOnboardedUser(client)

    const failed = await client.post('/api/v1/ai/keys/verify', {
      token: user.token,
      body: { provider: 'custom', apiKey: 'sk-debug-key-123456', baseUrl: mockBaseUrl, model: 'wrong-model' },
    })
    assert.equal(failed.status, 200)
    assert.equal(failed.data.verified, false)
    assert.equal(failed.data.saved, false)
    assert.equal(failed.data.test.kind, 'model_not_found')

    const ok = await client.post('/api/v1/ai/keys/verify', {
      token: user.token,
      body: { provider: 'custom', apiKey: 'sk-debug-key-123456', baseUrl: mockBaseUrl, model: 'mock-model' },
    })
    assert.equal(ok.data.verified, true)

    // 试连不产生任何记录
    const list = await client.get('/api/v1/ai/keys', { token: user.token })
    assert.deepEqual(list.data.items, [], '试连不应留下 Key 记录')
  })

  test('模型名只有大小写不一致时自动纠正，而不是判定失败', async () => {
    const user = await createOnboardedUser(client)

    // 用户手打成 mock-Model，账号里实际是 mock-model
    const saved = await client.put('/api/v1/ai/keys', {
      token: user.token,
      body: { provider: 'custom', apiKey: 'sk-case-test-key-123', baseUrl: mockBaseUrl, model: 'Mock-Model' },
    })

    assert.equal(saved.status, 201, JSON.stringify(saved.raw))
    assert.equal(saved.data.test.modelCorrected, true)
    assert.equal(saved.data.test.resolvedModel, 'mock-model')
    assert.match(
      saved.data.test.steps.find((step) => step.step === '检查模型名').detail,
      /纠正为「mock-model」/
    )

    // 存库的应该是纠正后的规范写法，而不是用户手打的那个
    assert.equal(saved.data.key.model, 'mock-model')
  })

  test('拉取可用模型列表不消耗 token，且给出建议选中的模型', async () => {
    const user = await createOnboardedUser(client)
    resetReceived()

    const result = await client.post('/api/v1/ai/models', {
      token: user.token,
      body: { provider: 'custom', apiKey: 'sk-list-models-key', baseUrl: mockBaseUrl, model: 'MOCK-MODEL' },
    })

    assert.equal(result.status, 200)
    assert.equal(result.data.ok, true)
    assert.deepEqual(result.data.models, MOCK_MODELS)
    assert.equal(result.data.suggested, 'mock-model', '应把大小写不一致的建议值纠正过来')
    assert.equal(result.data.corrected, true)

    // 只调了一次 /models，没有发对话请求，因此不产生任何 token 消耗
    const chatCalls = received.filter((item) => item.url.includes('/chat/completions'))
    assert.equal(chatCalls.length, 0, '拉列表不应触发对话调用')
    assert.ok(received.some((item) => item.url.includes('/models')))
  })

  test('Key 无效时拉列表同样给出可读结论', async () => {
    const user = await createOnboardedUser(client)
    // 指向不存在的端口
    const result = await client.post('/api/v1/ai/models', {
      token: user.token,
      body: { provider: 'custom', apiKey: 'sk-unreachable-key', baseUrl: 'http://127.0.0.1:9/v1', model: 'x' },
    })

    assert.equal(result.status, 200)
    assert.equal(result.data.ok, false)
    assert.ok(result.data.message)
    assert.ok(result.data.hint)
  })

  test('校验失败会被记录到服务端日志（但不含 Key 本身）', async () => {
    const user = await createOnboardedUser(client)
    const warnings = []
    const originalWarn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))

    try {
      await client.put('/api/v1/ai/keys', {
        token: user.token,
        body: { provider: 'custom', apiKey: 'sk-should-never-be-logged', baseUrl: mockBaseUrl, model: 'wrong-model' },
      })
    } finally {
      console.warn = originalWarn
    }

    const logged = warnings.join('\n')
    assert.match(logged, /Key 校验失败/)
    assert.match(logged, /model_not_found|model-that-does-not-exist|wrong-model/)
    assert.equal(logged.includes('sk-should-never-be-logged'), false, '日志绝不能包含明文 Key')
  })
})

describe('Prompt 精简（成本控制）', () => {
  test('发给模型的目标词块不包含例句', async () => {
    const { user } = await userWithMockProvider()

    // 挑两个确定带例句的词，确保断言有意义
    const words = await query(
      `SELECT w.id, w.spelling FROM words w JOIN wordbooks b ON b.id = w.wordbook_id
        WHERE b.code = 'fixture-demo' AND JSON_LENGTH(w.examples) > 0 LIMIT 2`
    )
    assert.equal(words.length, 2)
    const examples = await query(
      `SELECT w.examples FROM words w WHERE w.id IN (${words.map(() => '?').join(',')})`,
      words.map((word) => word.id)
    )
    const exampleTexts = examples.map((row) => {
      const parsed = typeof row.examples === 'string' ? JSON.parse(row.examples) : row.examples
      return parsed[0]
    })

    resetReceived()
    const response = await client.post('/api/v1/content/articles', {
      token: user.token,
      // wordCount 是「最多取几个目标词」，schema 下限为 4；这里靠显式 wordIds 精确指定 2 个词
      body: { wordIds: words.map((word) => word.id), wordCount: 4 },
    })
    assert.equal(response.status, 201)
    assert.equal(response.data.source, 'ai', `应走 AI 路径：${JSON.stringify(response.data.message || '')}`)

    const generationCall = received.find((item) => item.body.messages?.some((m) => m.content?.includes('巩固短文')))
    assert.ok(generationCall, '应发出一次短文生成请求')

    const prompt = generationCall.body.messages.map((m) => m.content).join('\n')
    for (const example of exampleTexts) {
      assert.equal(prompt.includes(example), false, `Prompt 里不应出现例句：${example}`)
    }
    for (const word of words) {
      assert.match(prompt, new RegExp(word.spelling), '目标词本身必须保留')
    }
  })

  test('请求带上了输出 token 上限，等于给单次成本封顶', async () => {
    const { user } = await userWithMockProvider()
    resetReceived()

    await client.post('/api/v1/content/articles', { token: user.token, body: { wordCount: 4 } })

    const call = received.find((item) => item.body.messages?.some((m) => m.content?.includes('巩固短文')))
    assert.ok(call.body.max_tokens > 0, '必须显式限制 max_tokens')
    assert.ok(call.body.max_tokens <= 2000, `输出上限应被收紧，实际 ${call.body.max_tokens}`)
  })
})

describe('合并请求：多个错词只调一次（成本控制的关键）', () => {
  test('5 个错词合并成 1 次调用，而不是 5 次', async () => {
    const { user } = await userWithMockProvider()

    const words = await query(
      `SELECT w.id FROM words w JOIN wordbooks b ON b.id = w.wordbook_id WHERE b.code = 'fixture-demo' LIMIT 5`
    )
    const wordIds = words.map((row) => Number(row.id))

    resetReceived()
    const response = await client.post('/api/v1/content/error-cards', {
      token: user.token,
      body: { wordIds },
    })

    assert.equal(response.status, 201, JSON.stringify(response.raw))
    assert.equal(response.data.source, 'ai')
    assert.equal(response.data.cards.length, 5, '5 个词应拿到 5 张卡片')
    assert.equal(response.data.batchCount, 1, '应只拆成 1 批')

    const generationCalls = received.filter((item) =>
      item.body.messages?.some((m) => m.content?.includes('对比记忆卡片'))
    )
    assert.equal(generationCalls.length, 1, `应只调用 1 次，实际 ${generationCalls.length} 次`)

    // 一次请求里确实带了 5 个词。
    // 注意只统计 user 消息：System Prompt 自身有 6 条编号约定，一起统计会多算。
    const userMessage = generationCalls[0].body.messages.find((m) => m.role === 'user').content
    assert.equal((userMessage.match(/^\d+\. /gm) || []).length, 5)
  })

  test('每个词都拿到对应自己的卡片（按拼写回填 wordId）', async () => {
    const { user } = await userWithMockProvider()

    const words = await query(
      `SELECT w.id, w.spelling FROM words w JOIN wordbooks b ON b.id = w.wordbook_id
        WHERE b.code = 'fixture-demo' LIMIT 4`
    )

    const response = await client.post('/api/v1/content/error-cards', {
      token: user.token,
      body: { wordIds: words.map((row) => Number(row.id)) },
    })

    const returned = response.data.cards.map((card) => card.wordId).sort()
    const expected = words.map((row) => Number(row.id)).sort()
    assert.deepEqual(returned, expected)
  })

  test('不传 wordIds 时自动取最近的错词', async () => {
    const { user } = await userWithMockProvider()
    // userWithMockProvider 内部已经用 all-wrong 答了 3 题，因此一定有错词
    const response = await client.post('/api/v1/content/error-cards', {
      token: user.token,
      body: {},
    })

    assert.equal(response.status, 201)
    assert.ok(response.data.cards.length > 0)
  })
})

describe('用量与成本记账', () => {
  test('生成后会累计 token 与估算成本', async () => {
    const { user } = await userWithMockProvider()

    const before = await client.get('/api/v1/ai/usage?days=30', { token: user.token })
    assert.equal(before.data.totals.used, 0)

    const generated = await client.post('/api/v1/content/articles', {
      token: user.token,
      body: { wordCount: 4 },
    })
    assert.equal(generated.data.source, 'ai')
    assert.equal(generated.data.usage.promptTokens, 150)
    assert.equal(generated.data.usage.completionTokens, 90)
    assert.ok(generated.data.usage.estimatedCostUsd > 0)
    assert.match(generated.data.usage.estimatedCostText, /^¥/)
    assert.equal(generated.data.usage.source, 'user', '应标明花的是用户自己的 Key')

    const after = await client.get('/api/v1/ai/usage?days=30', { token: user.token })
    assert.equal(after.data.totals.used, 1)
    assert.equal(after.data.totals.promptTokens, 150)
    assert.equal(after.data.totals.completionTokens, 90)
    assert.ok(after.data.totals.costUsd > 0)
    assert.equal(after.data.byType.article.used, 1)
  })

  test('返回生成前的预估，让用户知道「这次最多花多少」', async () => {
    const { user } = await userWithMockProvider()
    const response = await client.post('/api/v1/content/articles', {
      token: user.token,
      body: { wordCount: 4 },
    })

    assert.ok(response.data.preflight, '应返回预估信息')
    assert.ok(response.data.preflight.inputTokens > 0)
    assert.ok(response.data.preflight.outputCap > 0)
    assert.ok(response.data.preflight.worstCaseCost > 0)
  })

  test('缓存命中不产生新的 token 消耗', async () => {
    const { user } = await userWithMockProvider()

    const words = await query(
      `SELECT w.id FROM words w JOIN wordbooks b ON w.wordbook_id = b.id WHERE b.code = 'fixture-demo' LIMIT 3`
    )
    const wordIds = words.map((row) => Number(row.id))

    const first = await client.post('/api/v1/content/articles', { token: user.token, body: { wordIds } })
    assert.equal(first.data.source, 'ai')

    const callsAfterFirst = received.filter((item) =>
      item.body.messages?.some((m) => m.content?.includes('巩固短文'))
    ).length

    const second = await client.post('/api/v1/content/articles', { token: user.token, body: { wordIds } })
    assert.equal(second.data.source, 'cache', '相同词组合应命中缓存')
    assert.equal(second.data.content.id, first.data.content.id, '应复用同一条内容')

    const callsAfterSecond = received.filter((item) =>
      item.body.messages?.some((m) => m.content?.includes('巩固短文'))
    ).length
    assert.equal(callsAfterSecond, callsAfterFirst, '缓存命中不应再调用模型')

    const usage = await client.get('/api/v1/ai/usage?days=30', { token: user.token })
    assert.equal(usage.data.byType.article.used, 1, '只有第一次算作真实调用')
    assert.equal(usage.data.byType.article.cached, 1, '第二次记入缓存命中')
  })
})

describe('配额策略：官方额度与自带 Key 区别对待', () => {
  test('自带 Key 的额度上限比官方额度宽（花的是用户自己的钱）', async () => {
    const { user } = await userWithMockProvider()
    const status = await client.get('/api/v1/ai/status', { token: user.token })

    const article = status.data.usage.article
    assert.ok(article.limit > 0)
    assert.ok(article.userKeyLimit > article.limit, '自带 Key 的额度应更宽松')
  })

  test('错因分析与易混词对比不消耗任何额度（零 AI 成本）', async () => {
    const user = await createOnboardedUser(client)
    resetReceived()

    // 答一批题（内部会跑错因分析）
    const results = await playSession(client, user, { strategy: 'all-wrong', maxAnswers: 5 })
    assert.ok(results.results.some((item) => item.analysis.type), '错因分析应有结果')

    // 取算法版的对比卡片
    const wordId = results.items[0].wordId
    const contrast = await client.get(`/api/v1/words/${wordId}/contrast`)
    assert.equal(contrast.status, 200)

    assert.equal(received.length, 0, `错因分析与对比卡片不应调用 AI，实际调用了 ${received.length} 次`)

    const status = await client.get('/api/v1/ai/status', { token: user.token })
    assert.equal(status.data.summary.totals.used, 0)
  })
})

describe('阅读理解题与薄弱点小结', () => {
  test('基于已生成短文出题，并记录用量', async () => {
    const { user } = await userWithMockProvider()

    const article = await client.post('/api/v1/content/articles', { token: user.token, body: { wordCount: 4 } })
    const quiz = await client.post('/api/v1/content/quizzes', {
      token: user.token,
      body: { articleId: article.data.content.id, count: 3 },
    })

    assert.equal(quiz.status, 201, JSON.stringify(quiz.raw))
    assert.equal(quiz.data.source, 'ai')
    assert.equal(quiz.data.usage.source, 'user')

    const questions = JSON.parse(quiz.data.content.body)
    assert.equal(questions.length, 3)
    assert.ok(questions.every((item) => item.explanation), '每题都要有解析')
  })

  test('薄弱点小结由服务端算统计、模型只负责表述', async () => {
    const { user } = await userWithMockProvider()
    resetReceived()

    const response = await client.get('/api/v1/stats/weak-summary?days=7&ai=1', { token: user.token })

    assert.equal(response.status, 200)
    assert.equal(response.data.aiSource, 'ai')
    assert.equal(response.data.ai.headline, '测试小结')

    // 规则版结论始终存在，AI 只是叠加物
    assert.ok(response.data.summary)

    const call = received.find((item) => item.body.messages?.some((m) => m.content?.includes('薄弱点小结')))
    assert.ok(call)
    const prompt = call.body.messages.map((m) => m.content).join('\n')
    assert.match(prompt, /错因分布/, '应把统计结果交给模型，而不是让它自己编')
  })
})

describe('跳过模型内部思考（真实踩到的「生成失败」根因）', () => {
  test('默认请求跳过思考：生成的请求体里带上 thinking=disabled', async () => {
    const { user } = await userWithMockProvider()
    resetReceived()

    const response = await client.post('/api/v1/content/articles', {
      token: user.token,
      body: { wordCount: 4 },
    })
    assert.equal(response.data.source, 'ai')

    const call = received.find((item) => item.body.messages?.some((m) => m.content?.includes('巩固短文')))
    assert.ok(call, '应发起一次真实调用')
    assert.equal(call.body.thinking?.type, 'disabled', '默认必须请求服务商跳过内部思考')
  })

  test('用户在设置里打开「允许内部思考」后，请求体不再带该参数', async () => {
    const { user } = await userWithMockProvider()

    const saved = await client.put('/api/v1/ai/limits', {
      token: user.token,
      body: { allowThinking: true },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.data.limits.allowThinking, true)

    resetReceived()
    const response = await client.post('/api/v1/content/articles', {
      token: user.token,
      body: { wordCount: 4 },
    })
    assert.equal(response.data.source, 'ai')

    const call = received.find((item) => item.body.messages?.some((m) => m.content?.includes('巩固短文')))
    assert.equal(call.body.thinking, undefined, '用户明确要求思考时不应再塞关闭参数')

    // 收尾：恢复默认，避免影响同文件后续用例
    await client.put('/api/v1/ai/limits', { token: user.token, body: { allowThinking: false } })
  })

  test('默认值就是「跳过思考」，且写进推荐值里', async () => {
    const { user } = await userWithMockProvider()
    const limits = await client.get('/api/v1/ai/limits', { token: user.token })

    assert.equal(limits.data.limits.allowThinking, false)
    assert.equal(limits.data.recommended.allowThinking, false)
    assert.equal(limits.data.thinking.recommended, false)
    // 实测证据要能被前端直接渲染，否则界面上就只剩一句空话
    assert.equal(limits.data.thinking.measured.withoutThinking.contentRuns, 3)
    assert.equal(limits.data.thinking.measured.withThinking.contentRuns, 0)
  })

  test('端点不认 thinking 参数时自动改用 reasoning_effort，生成照常成功', async () => {
    const { user } = await userWithMockProvider()
    mockRejectThinkingParam = true
    resetReceived()

    try {
      const response = await client.post('/api/v1/content/articles', {
        token: user.token,
        body: { wordCount: 4 },
      })
      assert.equal(response.data.source, 'ai', '降级后仍应拿到 AI 内容')

      const calls = received.filter((item) =>
        item.body.messages?.some((m) => m.content?.includes('巩固短文'))
      )
      assert.equal(calls.length, 2, '第一次带 thinking 被拒，第二次改用 reasoning_effort')
      assert.equal(calls[0].body.thinking?.type, 'disabled')
      assert.equal(calls[1].body.thinking, undefined)
      assert.equal(calls[1].body.reasoning_effort, 'none')
    } finally {
      mockRejectThinkingParam = false
    }
  })

  test('降级提示里必须带具体数字，而不是一句「AI 暂时不可用」', async () => {
    const { user } = await userWithMockProvider()
    mockReasoningOnly = true
    resetReceived()

    try {
      const response = await client.post('/api/v1/content/articles', {
        token: user.token,
        body: { wordCount: 4 },
      })

      assert.equal(response.data.source, 'template', '应降级成本地复习清单')
      const message = response.data.message || ''
      // 这是用户明确反馈过的问题：只说「AI 暂时不可用」，看不到卡在哪个数字上
      assert.match(message, /内部思考/, `提示应说明是思考吃掉了额度，实际：${message}`)
      assert.match(message, /token/, `提示应带上 token 数字，实际：${message}`)
      assert.match(message, /\d{3,}/, `提示里应出现具体的额度数字，实际：${message}`)
      assert.match(message, /允许模型先内部思考/, '提示应告诉用户怎么解决')
      assert.doesNotMatch(message, /^AI 暂时不可用（模型把输出额度用在了内部思考上/, '不应回退成老的含糊提示')
    } finally {
      mockReasoningOnly = false
    }
  })
})
