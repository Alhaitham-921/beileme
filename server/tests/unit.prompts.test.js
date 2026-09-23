import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  SYSTEM_PROMPT,
  TOPIC_POOL,
  MAX_CARDS_PER_REQUEST,
  pickTopic,
  styleForGoal,
  guideForDifficulty,
  wordsBlockCompact,
  profileLineCompact,
  buildArticlePrompt,
  buildQuizPrompt,
  buildErrorCardBatchPrompt,
  buildWeakSummaryPrompt,
  parseJsonResponse,
} from '../src/services/ai/promptTemplates.js'
import { estimateTokens, estimateCost, formatCost } from '../src/services/ai/costEstimate.js'

const sampleWords = [
  { id: 1, spelling: 'abandon', pos: 'v.', definitions: ['放弃', '抛弃'], example: 'He abandoned the plan after the failure.' },
  { id: 2, spelling: 'ability', pos: 'n.', definitions: ['能力', '才能'], example: 'She has the ability to solve hard problems.' },
]

describe('System Prompt 的预设约束（PRD 4.4）', () => {
  test('包含全部强制性约束', () => {
    assert.match(SYSTEM_PROMPT, /服务于给定词表与学习目标/)
    assert.match(SYSTEM_PROMPT, /难度/)
    assert.match(SYSTEM_PROMPT, /健康、积极/)
    assert.match(SYSTEM_PROMPT, /结构固定/)
    assert.match(SYSTEM_PROMPT, /原创/)
    // 防止被当成通用聊天工具（PRD 4.8）
    assert.match(SYSTEM_PROMPT, /不提供任何与英语学习无关的服务/)
  })

  test('System Prompt 保持精简（它每次请求都要发送，属于固定成本）', () => {
    // 这里放一个宽松上限，防止日后加约束加到把固定成本推高
    assert.ok(estimateTokens(SYSTEM_PROMPT) < 320, `实际 ${estimateTokens(SYSTEM_PROMPT)} token`)
  })
})

describe('话题与难度映射', () => {
  test('pickTopic 只从话题池中抽取', () => {
    for (let i = 0; i < 50; i += 1) {
      assert.ok(TOPIC_POOL.includes(pickTopic({}, Math.random)))
    }
  })

  test('权重高的用户偏好会显著提高抽中概率', () => {
    const weights = { ...Object.fromEntries(TOPIC_POOL.map((t) => [t, 0.05])), 科技: 100 }
    assert.equal(pickTopic(weights, () => 0.01), '科技')
  })

  test('未提供权重时回退到完整话题池', () => {
    assert.ok(TOPIC_POOL.includes(pickTopic(undefined, () => 0.5)))
  })

  test('不同学习目标给出不同体裁要求', () => {
    assert.match(styleForGoal('四级'), /说明文|议论文/)
    assert.match(styleForGoal('雅思'), /学术/)
    assert.match(styleForGoal('中考'), /记叙文|应用文/)
    assert.ok(styleForGoal('不存在的目标').length > 0)
  })

  test('难度等级越界时收敛到 1-5', () => {
    assert.match(guideForDifficulty(1), /简单句/)
    assert.match(guideForDifficulty(5), /长难句/)
    assert.equal(guideForDifficulty(99), guideForDifficulty(5))
    assert.equal(guideForDifficulty(-3), guideForDifficulty(1))
    assert.equal(guideForDifficulty('abc'), guideForDifficulty(3))
  })
})

describe('Prompt 的省 token 设计（成本控制的核心）', () => {
  test('目标词用单行紧凑格式，且不携带例句', () => {
    const block = wordsBlockCompact(sampleWords)

    assert.match(block, /abandon\(v\. 放弃\/抛弃\)/)
    assert.match(block, /ability\(n\. 能力\/才能\)/)
    // 例句对「写一篇新文章」帮助很小，却占掉大量输入 token，因此必须不出现在 Prompt 里
    assert.equal(block.includes('abandoned the plan'), false, '目标词块不应包含例句')
    assert.equal(block.includes('\n'), false, '目标词块应是单行')
  })

  test('每个词最多带 2 条释义', () => {
    const block = wordsBlockCompact([{ spelling: 'test', definitions: ['一', '二', '三', '四', '五'] }])
    assert.equal(block, 'test(一/二)')
  })

  test('画像压成一行，不铺开字段', () => {
    const line = profileLineCompact({ goal: '四级', selfLevel: '3000-6000', memoryPrefs: ['context'] })
    assert.equal(line, '目标:四级 词汇量:3000-6000 记忆偏好:context')
    assert.ok(!line.includes('\n'))
  })

  test('短文 Prompt 的体量足够小', () => {
    const prompt = buildArticlePrompt({ words: sampleWords, profile: { goal: '四级' }, topic: '环保' })
    const tokens = estimateTokens(prompt.system) + estimateTokens(prompt.user)
    // 精简后应明显低于旧版（旧版把每个词的例句都塞进 Prompt）
    assert.ok(tokens < 700, `实际 ${tokens} token`)
  })
})

describe('短文 Prompt（PRD 4.3.1）', () => {
  const prompt = buildArticlePrompt({
    words: sampleWords,
    profile: { goal: '四级', selfLevel: '3000-6000' },
    topic: '环保',
    difficulty: 3,
    weakWords: [{ spelling: 'adapt', definitions: ['适应'] }],
  })

  test('注入目标词、话题、易混词、画像与难度', () => {
    assert.equal(prompt.system, SYSTEM_PROMPT)
    assert.match(prompt.user, /abandon/)
    assert.match(prompt.user, /ability/)
    assert.match(prompt.user, /环保/)
    assert.match(prompt.user, /adapt/, '易混词应进入 Prompt 以制造对比语境')
    assert.match(prompt.user, /四级/)
    assert.match(prompt.user, /句子平均 14-18 词/)
  })

  test('要求目标词加粗并给出固定 JSON 结构', () => {
    assert.match(prompt.user, /加粗/)
    assert.match(prompt.user, /glossary/)
    assert.match(prompt.user, /body/)
    assert.match(prompt.user, /只输出 JSON/)
  })

  test('没有易混词时不产生空的说明行', () => {
    const bare = buildArticlePrompt({ words: sampleWords, profile: { goal: '四级' }, topic: '科技' })
    assert.equal(bare.user.includes('易混词（如能制造对比语境更好）'), false)
  })
})

describe('理解题 Prompt（PRD 4.3.2）', () => {
  test('覆盖词汇题 / 细节题 / 推理题，并要求解析', () => {
    const prompt = buildQuizPrompt({
      article: { title: 'A Story', body: 'Once upon a time...' },
      words: sampleWords,
      profile: { goal: '雅思' },
      count: 4,
    })

    assert.match(prompt.user, /词汇题/)
    assert.match(prompt.user, /细节理解题/)
    assert.match(prompt.user, /推理判断/)
    assert.match(prompt.user, /翻译/, '学术类目标应追加长难句翻译题')
    assert.match(prompt.user, /解析/)
    assert.match(prompt.user, /answerIndex/)
  })

  test('非学术类目标不追加翻译题', () => {
    const prompt = buildQuizPrompt({
      article: { title: 'x', body: 'y' },
      words: sampleWords,
      profile: { goal: '中考' },
    })
    assert.equal(prompt.user.includes('再加 1 道长难句'), false)
  })
})

describe('错因卡片 Prompt · 批量版（成本控制的关键）', () => {
  const batchWords = [
    {
      spelling: 'adapt',
      pos: 'v.',
      definitions: ['适应', '改编'],
      relatedWords: [{ spelling: 'adopt', relationType: 'form' }],
      errorBreakdown: { formConfusion: 3, guess: 1 },
    },
    {
      spelling: 'achieve',
      pos: 'v.',
      definitions: ['实现'],
      relatedWords: [{ spelling: 'accomplish', relationType: 'meaning' }],
      errorBreakdown: { meaningConfusion: 2 },
    },
  ]

  test('多个词合并进同一次请求，并带出各自的错因统计', () => {
    const prompt = buildErrorCardBatchPrompt({ words: batchWords, profile: { goal: '四级' } })

    assert.match(prompt.user, /adopt/)
    assert.match(prompt.user, /形近/)
    assert.match(prompt.user, /形近混淆 3 次/)
    assert.match(prompt.user, /盲猜 1 次/)
    assert.match(prompt.user, /accomplish/)
    assert.match(prompt.user, /近义混淆 2 次/)
    assert.match(prompt.user, /记忆口诀/)
    assert.match(prompt.user, /mnemonic/)
    assert.match(prompt.user, /cards/)
  })

  test('一次请求最多合并 MAX_CARDS_PER_REQUEST 个词', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      spelling: `word${i}`,
      definitions: ['释义'],
      relatedWords: [],
      errorBreakdown: {},
    }))
    const prompt = buildErrorCardBatchPrompt({ words: many })
    const matches = prompt.user.match(/^\d+\. /gm) || []
    assert.equal(matches.length, MAX_CARDS_PER_REQUEST)
  })

  test('没有错因统计时不产生「历史错因」空段', () => {
    const prompt = buildErrorCardBatchPrompt({
      words: [{ spelling: 'plain', definitions: ['普通'], relatedWords: [], errorBreakdown: {} }],
    })
    assert.equal(prompt.user.includes('历史错因'), false)
  })
})

describe('薄弱点小结 Prompt（PRD 4.3.3）', () => {
  test('带入统计并要求基于数据、不得编造', () => {
    const prompt = buildWeakSummaryPrompt({
      stats: {
        days: 7,
        errorDistribution: { items: [{ label: '形近词混淆', count: 5, percent: 50 }] },
        topWrongWords: [{ spelling: 'adapt', definitions: ['适应'], wrongTimes: 3 }],
      },
      profile: { goal: '考研' },
    })

    assert.match(prompt.user, /形近词混淆/)
    assert.match(prompt.user, /adapt/)
    assert.match(prompt.user, /不得编造/)
    assert.match(prompt.user, /第二人称/)
  })
})

describe('JSON 解析容错', () => {
  test('兼容裸 JSON、代码块包裹与夹带说明文字', () => {
    assert.deepEqual(parseJsonResponse('{"a":1}'), { a: 1 })
    assert.deepEqual(parseJsonResponse('```json\n{"a":1}\n```'), { a: 1 })
    assert.deepEqual(parseJsonResponse('```\n{"a":1}\n```'), { a: 1 })
    assert.deepEqual(parseJsonResponse('好的，结果如下：{"a":1} 请查收'), { a: 1 })
  })

  test('非 JSON 内容抛出可捕获的错误', () => {
    assert.throws(() => parseJsonResponse('完全不是 JSON'), /不是合法 JSON/)
    assert.throws(() => parseJsonResponse(null), /不是字符串/)
  })
})

describe('成本估算', () => {
  test('中文按字、英文按词计数，空输入为 0', () => {
    assert.equal(estimateTokens(''), 0)
    assert.equal(estimateTokens(null), 0)
    assert.ok(estimateTokens('放弃') >= 2)
    assert.ok(estimateTokens('abandon the plan') >= 3)
  })

  test('成本按输入输出分别计费', () => {
    const onlyInput = estimateCost({ inputTokens: 1_000_000 })
    const onlyOutput = estimateCost({ outputTokens: 1_000_000 })
    assert.ok(onlyOutput > onlyInput, '输出单价通常高于输入')
    assert.equal(estimateCost({}), 0)
  })

  test('命中缓存的输入按更低单价计算', () => {
    const fresh = estimateCost({ inputTokens: 1_000_000 })
    const cached = estimateCost({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000 })
    assert.ok(cached < fresh, '缓存命中的输入应更便宜')
  })

  test('小额成本用足够精度展示，避免显示成 0', () => {
    assert.equal(formatCost(0), '¥0')
    assert.match(formatCost(0.00001), /^¥0\.\d{4}$/)
    assert.match(formatCost(1), /^¥/)
  })
})
