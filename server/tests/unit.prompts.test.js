import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SYSTEM_PROMPT,
  TOPIC_POOL,
  pickTopic,
  styleForGoal,
  guideForDifficulty,
  buildArticlePrompt,
  buildQuizPrompt,
  buildErrorCardPrompt,
  buildWeakSummaryPrompt,
  parseJsonResponse,
} from '../src/services/ai/promptTemplates.js'

test('System Prompt 包含 PRD 4.4 要求的全部预设约束', () => {
  assert.match(SYSTEM_PROMPT, /服务于当前学习目标与给定词表/)
  assert.match(SYSTEM_PROMPT, /难度/)
  assert.match(SYSTEM_PROMPT, /健康、积极/)
  assert.match(SYSTEM_PROMPT, /固定格式/)
  assert.match(SYSTEM_PROMPT, /原创/)
  // 防止被当成通用聊天工具（PRD 4.8）
  assert.match(SYSTEM_PROMPT, /不提供任何与英语学习无关的服务/)
})

test('pickTopic：只从话题池中抽取，且权重影响分布', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.ok(TOPIC_POOL.includes(pickTopic({}, Math.random)))
  }

  // 把「科技」权重拉到极高，随机数落在低位时应命中它
  const weighted = pickTopic({ ...Object.fromEntries(TOPIC_POOL.map((t) => [t, 0.05])), 科技: 100 }, () => 0.01)
  assert.equal(weighted, '科技')
})

test('pickTopic：未提供权重时回退到完整话题池', () => {
  const topic = pickTopic(undefined, () => 0.5)
  assert.ok(TOPIC_POOL.includes(topic))
})

test('styleForGoal：不同学习目标给出不同体裁要求', () => {
  assert.match(styleForGoal('四级'), /说明文|议论文/)
  assert.match(styleForGoal('雅思'), /学术/)
  assert.match(styleForGoal('中考'), /记叙文|应用文/)
  // 未知目标回退到兴趣类风格而不是报错
  assert.ok(styleForGoal('不存在的目标').length > 0)
})

test('guideForDifficulty：等级越界时收敛到 1-5', () => {
  assert.match(guideForDifficulty(1), /简单句/)
  assert.match(guideForDifficulty(5), /长难句/)
  assert.equal(guideForDifficulty(99), guideForDifficulty(5))
  assert.equal(guideForDifficulty(-3), guideForDifficulty(1))
  assert.equal(guideForDifficulty('abc'), guideForDifficulty(3))
})

test('短文 Prompt 注入了目标词、话题、易混词与难度（PRD 4.3.1）', () => {
  const prompt = buildArticlePrompt({
    words: [
      { spelling: 'abandon', pos: 'v.', definitions: ['放弃'], example: 'He abandoned it.' },
      { spelling: 'ability', pos: 'n.', definitions: ['能力'] },
    ],
    profile: { goal: '四级', selfLevel: '3000-6000', dailyTime: '15-20' },
    topic: '环保',
    difficulty: 3,
    weakWords: [{ spelling: 'adapt', definitions: ['适应'] }],
    memoryPrefs: ['context'],
  })

  assert.equal(prompt.system, SYSTEM_PROMPT)
  assert.match(prompt.user, /abandon/)
  assert.match(prompt.user, /ability/)
  assert.match(prompt.user, /环保/)
  assert.match(prompt.user, /adapt/, '易混词应进入 Prompt 以制造对比语境')
  assert.match(prompt.user, /四级/)
  assert.match(prompt.user, /语境/, '记忆偏好应影响生成侧重')
  assert.match(prompt.user, /JSON/)
})

test('短文 Prompt 要求目标词加粗且给出固定 JSON 结构', () => {
  const prompt = buildArticlePrompt({ words: [{ spelling: 'test', definitions: ['测试'] }] })
  assert.match(prompt.user, /加粗/)
  assert.match(prompt.user, /glossary/)
  assert.match(prompt.user, /body/)
})

test('理解题 Prompt 覆盖词汇题/细节题/推理题，并附解析要求（PRD 4.3.2）', () => {
  const prompt = buildQuizPrompt({
    article: { title: 'A Story', body: 'Once upon a time...' },
    words: [{ spelling: 'abandon', definitions: ['放弃'] }],
    profile: { goal: '雅思' },
    count: 4,
  })

  assert.match(prompt.user, /词汇题/)
  assert.match(prompt.user, /细节理解题/)
  assert.match(prompt.user, /推理判断/)
  assert.match(prompt.user, /academic|Academic|翻译/, '雅思场景应加长难句翻译题')
  assert.match(prompt.user, /解析/)
  assert.match(prompt.user, /answerIndex/)
})

test('错因卡片 Prompt 带入错因统计，并按错因调整侧重点（PRD 4.3.3）', () => {
  const prompt = buildErrorCardPrompt({
    word: { spelling: 'adapt', pos: 'v.', definitions: ['适应'], example: 'adapt to it' },
    relatedWords: [{ spelling: 'adopt', definitions: ['采用'], relationType: 'form', score: 0.8 }],
    errorBreakdown: { formConfusion: 3, guess: 1 },
    profile: { goal: '四级' },
  })

  assert.match(prompt.user, /adopt/)
  assert.match(prompt.user, /形近/)
  assert.match(prompt.user, /形近混淆 3 次/)
  assert.match(prompt.user, /记忆口诀/)
  assert.match(prompt.user, /mnemonic/)
})

test('薄弱点小结 Prompt 要求基于数据、不得编造', () => {
  const prompt = buildWeakSummaryPrompt({
    stats: {
      days: 7,
      errorDistribution: { items: [{ label: '形近词混淆', count: 5, percent: 50 }] },
      topWrongWords: [{ spelling: 'adapt', definitions: ['适应'], wrongTimes: 3, errorTypes: ['形近词混淆'] }],
    },
    profile: { goal: '考研' },
  })

  assert.match(prompt.user, /形近词混淆/)
  assert.match(prompt.user, /adapt/)
  assert.match(prompt.user, /不得编造/)
  assert.match(prompt.user, /第二人称/)
})

test('parseJsonResponse：兼容裸 JSON、代码块包裹、以及夹带说明文字的情况', () => {
  assert.deepEqual(parseJsonResponse('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJsonResponse('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonResponse('```\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonResponse('好的，结果如下：{"a":1} 请查收'), { a: 1 })
})

test('parseJsonResponse：非 JSON 内容抛出可捕获的错误', () => {
  assert.throws(() => parseJsonResponse('完全不是 JSON'), /不是合法 JSON/)
  assert.throws(() => parseJsonResponse(null), /不是字符串/)
})
