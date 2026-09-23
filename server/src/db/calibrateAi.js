/**
 * AI 额度标定：测出「生成一次到底需要多少 token」，并给出推荐额度。
 *
 * 为什么要专门做这个工具：
 *  - 额度设小了 → 正文被截断、JSON 解析失败、生成失败
 *  - 额度设大了 → 每次调用都在为用不到的空间付费（输出 token 单价远高于输入）
 *  而这两个数字跟「词表长度、话题、模型是否推理型」都相关，拍脑袋定不准。
 *
 * 两种运行方式：
 *  1. 不带 Key：用真实词库数据构建 Prompt，精确测量**输入** token，
 *     并用一份代表性的合规输出估算**输出** token —— 成本为 0
 *  2. 带 Key（推荐）：真实调用一次，读出服务商返回的真实用量，
 *     包括推理模型独有的 reasoning_tokens —— 成本约几分钱
 *
 * 用法：
 *   node server/src/db/calibrateAi.js                          # 只测量输入与估算
 *   node server/src/db/calibrateAi.js --email=you@example.com  # 用该用户已保存的 Key 实测
 *   node server/src/db/calibrateAi.js --samples=3              # 每种内容实测 3 次取平均
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pool, query, queryOne } from './pool.js'
import { config } from '../config.js'
import { estimateTokens, estimateCost, formatCost } from '../services/ai/costEstimate.js'
import {
  buildArticlePrompt,
  buildQuizPrompt,
  buildErrorCardBatchPrompt,
  buildWeakSummaryPrompt,
} from '../services/ai/promptTemplates.js'
import { getActiveUserKey, resolveProvider } from '../services/ai/apiKeyService.js'
import { chat, isReasoningModel } from '../services/ai/aiProvider.js'
import { getProfile } from '../services/profileService.js'
import { listWordsByIds } from '../services/wordService.js'

/**
 * 一份「代表性的合规输出」。
 *
 * 用来在不调用模型的情况下估算输出规模。关键是要**按真实规格**来：
 * PRD 要求短文 150-250 词，所以这里就是一篇约 230 词的正常英文短文 +
 * 10 条生词表 + JSON 外壳，不多不少。样本写长了会把推荐额度整体抬高。
 *
 * ⚠ 这里的「代表性输出」只是给没有 Key 的情况兜底用的估算。
 * 最早的版本凭想象写得太短，导致推荐额度整体偏小、第一次调用必然被截断，
 * 每次生成都白白多花一次调用去重试。**有 Key 时一律以实测为准**，
 * 实测数字见 aiSettingsService.RECOMMENDED_LIMITS 的注释。
 */
function referenceArticleOutput() {
  const sentences = [
    'Every morning the same small ritual plays out on the quiet campus.',
    'Students drift into the library, open their notebooks, and review the words they met the day before.',
    'It looks unremarkable, yet something important is happening beneath the surface.',
    'A single review session changes very little, but a hundred of them change how a person reads.',
    'Researchers who study learning describe the same pattern again and again.',
    'Memory does not respond to effort alone; it responds to timing.',
    'When a word is recalled just before it fades, the trace grows stronger and lasts longer.',
    'That is why a short daily habit outperforms a long weekend of cramming.',
    'The same principle applies to how we adapt when our plans collapse.',
    'A missed week is not a failure; it is simply information about what needs adjusting.',
    'Students who accept that and continue tend to reach their goals far more often.',
    'The campus is quieter now, and the notebooks are almost full.',
    'Tomorrow the ritual will begin again, unremarkable and quietly decisive.',
  ]
  const body = sentences.join(' ')

  return JSON.stringify({
    title: 'Small Habits, Lasting Change',
    body,
    glossary: Array.from({ length: 10 }, (_, i) => ({
      spelling: `word${i + 1}`,
      definition: '中文释义示例',
    })),
    topicUsed: '环保',
  })
}

/**
 * 一份代表性的理解题输出：3-4 题，每题带解析。
 *
 * 注意把 explanation 写到真实长度（40-70 字）——实测模型给每道题的解析
 * 都是这个量级，样本写太短会把推荐额度压低，最终导致第一次调用被截断。
 */
function referenceQuizOutput() {
  const explanations = [
    '第二段明确指出小习惯会持续累积，并强调这种积累很难被逆转；其余选项都与原文表述不符或过度推断。',
    '原文用「unremarkable yet decisive」点出这种日常行为的双重性：表面平常、结果决定性，故选此项。',
    '作者在结尾用「the ritual will begin again」暗示循环性，说明这不是一次性的努力而是长期机制。',
    '第三段把「a missed week」定义为信息而非失败，说明作者反对把中断等同于失败的态度。',
  ]
  return JSON.stringify({
    questions: Array.from({ length: 4 }, (_, i) => ({
      type: ['vocabulary', 'detail', 'inference', 'translation'][i],
      stem: 'According to the passage, what does the author suggest about small daily habits and their long-term effect on learners who keep reviewing?',
      options: [
        'They matter far less than most people assume in everyday practice.',
        'They compound quietly into results that are hard to reverse later on.',
        'They only work for students who study in the morning hours every day.',
        'They should be avoided when the weekly schedule becomes too crowded.',
      ],
      answerIndex: 1,
      explanation: explanations[i],
      targetWord: 'adapt',
    })),
  })
}

/**
 * 一份代表性的错词卡片输出：6 个词各一张。
 *
 * 实测一个词约 370 输出 token（含例句与翻译），6 张约 2213。
 * 这里按同样规模写，否则推荐额度会明显偏小。
 */
function referenceCardsOutput() {
  return JSON.stringify({
    cards: Array.from({ length: 6 }, (_, i) => ({
      spelling: `word${i}`,
      headline: '核心区别：一个强调过程与持续投入，另一个强调最终达成的结果与状态',
      distinctions: [
        {
          spelling: `word${i}`,
          coreMeaning: '核心语义：表示通过持续努力逐步达成某个目标的过程',
          usage: '多用于描述主观努力带来的变化，主语通常是人，后面可接具体成果或状态。',
          example: 'She worked steadily for a year and finally managed to pass the exam.',
          translation: '她稳步努力了一年，最终通过了考试。',
        },
        {
          spelling: `other${i}`,
          coreMeaning: '另一语义：表示已经处于某种结果或状态之中',
          usage: '强调结果而非过程，常用于客观描述，主语可以是人或事物。',
          example: 'The new policy had a measurable effect on how people commuted.',
          translation: '新政策对人们的通勤方式产生了可衡量的影响。',
        },
      ],
      mnemonic: '记一句好记的口诀：过程用前者、结果用后者，看句子在问「怎么做到」还是「变成了什么」。',
      formTip: '注意这两个词中间的两个字母不同，前者是双辅音，后者是单个辅音加元音。',
    })),
  })
}

function referenceSummaryOutput() {
  return JSON.stringify({
    headline: '本周你在形近词上有些吃力，但整体节奏是稳的。',
    observations: ['形近词混淆占了大多数错误', '答对时的反应速度正常'],
    suggestions: ['优先完成易混词对比卡片', '把错词排进明早的第一组复习'],
  })
}

const REFERENCES = {
  article: referenceArticleOutput,
  quiz: referenceQuizOutput,
  error_card_batch: referenceCardsOutput,
  weak_summary: referenceSummaryOutput,
}

/**
 * 从真实词库里取一批词，作为标定用的样本。
 * 用真实数据而不是编造的样例，测出来的输入 token 才有参考价值。
 */
async function sampleWords({ count = 10 } = {}) {
  const limit = Math.max(1, Math.min(20, count))
  const rows = await query(
    `SELECT w.id FROM words w
      JOIN wordbooks b ON b.id = w.wordbook_id
     WHERE b.code = 'cet4' AND JSON_LENGTH(w.definitions) >= 2
     ORDER BY FIELD(w.freq, 'high', 'med', 'low'), RAND()
     LIMIT ${limit}`
  )
  if (!rows.length) return []
  return listWordsByIds(rows.map((row) => Number(row.id)))
}

/** 造一份最小的统计样本，用于错词卡片标定（只需要词汇信息） */
function fakeDigestStats() {
  return {
    days: 7,
    errorDistribution: {
      items: [
        { label: '形近词混淆', count: 12, percent: 40 },
        { label: '记忆模糊', count: 10, percent: 33 },
        { label: '盲猜 / 生疏', count: 8, percent: 27 },
      ],
    },
    topWrongWords: [
      { spelling: 'adapt', definitions: ['适应'], wrongTimes: 4, errorTypes: ['形近词混淆'] },
      { spelling: 'effect', definitions: ['影响'], wrongTimes: 3, errorTypes: ['形近词混淆'] },
      { spelling: 'achieve', definitions: ['实现'], wrongTimes: 3, errorTypes: ['近义词混淆'] },
    ],
  }
}

/** 构建各内容类型的 Prompt（与真实生成走同一套模板，否则测了也没意义） */
async function buildPrompts() {
  const words = await sampleWords({ count: 10 })
  const profile = { goal: '四级', selfLevel: '3000-6000', memoryPrefs: ['context'] }
  const weakWords = [
    { spelling: 'adapt', definitions: ['适应'] },
    { spelling: 'effect', definitions: ['影响'] },
  ]

  const article = buildArticlePrompt({ words, profile, topic: '环保', difficulty: 3, weakWords })

  const articleForQuiz = {
    title: 'Small Habits, Lasting Change',
    body: REFERENCES.article()
      ? JSON.parse(REFERENCES.article()).body
      : '',
  }

  const cards = buildErrorCardBatchPrompt({
    words: words.slice(0, 6).map((word) => ({
      spelling: word.spelling,
      pos: word.pos,
      definitions: word.definitions,
      relatedWords: [{ spelling: 'sample', relationType: 'form' }],
      errorBreakdown: { formConfusion: 3, vague: 1 },
    })),
    profile,
  })

  return {
    words,
    prompts: {
      article,
      quiz: buildQuizPrompt({ article: articleForQuiz, words, profile, difficulty: 3, count: 3 }),
      error_card_batch: cards,
      weak_summary: buildWeakSummaryPrompt({ stats: fakeDigestStats(), profile }),
    },
  }
}

/**
 * 真实调用一次，读出服务商返回的用量。
 * @returns {Promise<{promptTokens:number, completionTokens:number, reasoningTokens:number, contentTokens:number, truncated:boolean}>}
 */
async function measureRealCall({ provider, prompt, type }) {
  const maxTokens = config.ai.maxOutputTokens[type] ?? 1200
  const response = await chat({
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: provider.model,
    maxTokens,
    temperature: config.ai.temperature,
  })

  return {
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    reasoningTokens: response.usage.reasoningTokens || 0,
    /** 扣除思考后，真正写正文用的量 */
    contentTokens: Math.max(0, response.usage.completionTokens - (response.usage.reasoningTokens || 0)),
    contentChars: response.content.length,
    reasoning: Boolean(response.reasoningContent),
    truncated: response.finishReason === 'length',
  }
}

/** 按类型算出推荐额度：测量值留出余量，并对推理模型按倍数放宽 */
function recommendBudget({ type, measuredOutputTokens, isReasoning, headroom = 1.6, min, max }) {
  const base = Math.max(measuredOutputTokens || 0, min)
  const withHeadroom = Math.ceil((base * headroom) / 50) * 50
  const reasoningFactor = isReasoning ? config.ai.reasoningBudgetMultiplier : 1
  const final = Math.ceil((withHeadroom * reasoningFactor) / 50) * 50
  return { recommended: Math.min(Math.max(final, min), max), baseWithHeadroom: withHeadroom, reasoningFactor }
}

export async function calibrateAi({ email = null, samples = 1, logger = console } = {}) {
  const { words, prompts } = await buildPrompts()

  logger.log('='.repeat(78))
  logger.log('AI 额度标定')
  logger.log('='.repeat(78))
  logger.log(
    `词库样本：${words.length} 个词（${words.slice(0, 4).map((w) => w.spelling).join('、')}…）`
  )

  // ── 解析调用方用哪个 Key ──
  let provider = { source: 'none' }
  if (email) {
    const user = await queryOne('SELECT id, email FROM users WHERE email = ?', [email])
    if (!user) throw new Error(`找不到用户：${email}`)
    provider = await resolveProvider(user.id)
    if (provider.source === 'none') {
      logger.log(`用户 ${email} 没有可用的 Key，退回「只测量估算」模式`)
    } else {
      logger.log(`使用 ${provider.source === 'user' ? `用户 ${email} 自带的 Key` : '服务端官方额度'}（模型 ${provider.model}）`)
    }
  } else if (config.ai.apiKey) {
    provider = {
      source: 'server',
      apiKey: config.ai.apiKey,
      baseUrl: config.ai.baseUrl,
      model: config.ai.defaultModel,
    }
    logger.log(`使用服务端官方额度（模型 ${provider.model}）`)
  } else {
    logger.log('未提供 Key，进入「只测量输入 + 估算输出」模式（不产生任何费用）')
    logger.log('提示：加上 --email=你的账号 可以用已保存的 Key 真实测一次')
  }

  const rows = []

  for (const [type, prompt] of Object.entries(prompts)) {
    const inputTokens = estimateTokens(prompt.system) + estimateTokens(prompt.user)
    const referenceOutput = REFERENCES[type]()
    const estimatedOutputTokens = estimateTokens(referenceOutput)

    let real = null
    if (provider.source !== 'none' && provider.apiKey) {
      const runs = []
      for (let i = 0; i < Math.max(1, Math.min(5, samples)); i += 1) {
        try {
          runs.push(await measureRealCall({ provider, prompt, type }))
        } catch (error) {
          logger.log(`  ! ${type} 实测失败：${error.message}`)
          break
        }
      }
      if (runs.length) {
        const avg = (key) => Math.round(runs.reduce((sum, run) => sum + run[key], 0) / runs.length)
        real = {
          runs: runs.length,
          promptTokens: avg('promptTokens'),
          completionTokens: avg('completionTokens'),
          reasoningTokens: avg('reasoningTokens'),
          contentTokens: avg('contentTokens'),
          contentChars: avg('contentChars'),
          reasoning: runs.some((run) => run.reasoning),
          truncated: runs.some((run) => run.truncated),
        }
      }
    }

    rows.push({ type, prompt, inputTokens, estimatedOutputTokens, real })
  }

  // ── 输出表格 ──
  logger.log('')
  logger.log('内容类型            输入token   估算输出   实测输入   实测输出   其中思考   正文用量   是否截断')
  logger.log('-'.repeat(78))
  for (const row of rows) {
    const r = row.real
    logger.log(
      row.type.padEnd(20) +
        String(row.inputTokens).padStart(9) +
        String(row.estimatedOutputTokens).padStart(11) +
        String(r ? r.promptTokens : '—').padStart(11) +
        String(r ? r.completionTokens : '—').padStart(11) +
        String(r ? r.reasoningTokens : '—').padStart(11) +
        String(r ? r.contentTokens : '—').padStart(11) +
        '   ' +
        (r ? (r.truncated ? '是 ⚠' : '否') : '—')
    )
  }

  // ── 推荐额度 ──
  const isReasoning = rows.some((row) => row.real?.reasoning)
  logger.log('')
  logger.log('推荐额度（当前配置 → 建议值）')
  logger.log('-'.repeat(78))

  const limits = { article: [600, 8000], quiz: [500, 6000], error_card_batch: [800, 10000], weak_summary: [300, 3000] }
  const recommendations = {}

  for (const row of rows) {
    // 没有实测时，参考样本本身就是「预期输出规模」，不要再乘一遍系数——
    // 重复放大只会把推荐额度虚推高，最终让用户为用不到的空间付费。
    const measured = row.real ? row.real.completionTokens : row.estimatedOutputTokens
    const rec = recommendBudget({
      type: row.type,
      measuredOutputTokens: measured,
      isReasoning,
      min: limits[row.type][0],
      max: limits[row.type][1],
    })
    recommendations[row.type] = rec.recommended

    const current = config.ai.maxOutputTokens[row.type]
    const verdict = current >= rec.recommended ? '✓ 够用' : '✗ 偏小，有截断风险'
    logger.log(
      `  ${row.type.padEnd(20)} 当前 ${String(current).padStart(5)} → 建议 ${String(rec.recommended).padStart(5)}   ${verdict}`
    )
  }

  const inputRec = Math.max(...rows.map((row) => (row.real?.promptTokens || row.inputTokens))) * 1.5
  logger.log(
    `  ${'max_input_tokens'.padEnd(20)} 当前 ${String(config.ai.maxInputTokens).padStart(5)} → 建议 ${String(Math.ceil(inputRec / 100) * 100).padStart(5)}`
  )

  // ── 成本参考 ──
  logger.log('')
  logger.log('单次生成成本参考（按当前配置单价估算）')
  logger.log('-'.repeat(78))
  let totalPerDay = 0
  for (const row of rows) {
    const input = row.real?.promptTokens || row.inputTokens
    const output = row.real?.completionTokens || row.estimatedOutputTokens
    const cost = estimateCost({ inputTokens: input, outputTokens: output })
    if (['article', 'error_card_batch'].includes(row.type)) totalPerDay += cost
    logger.log(`  ${row.type.padEnd(20)} 约 ${String(input).padStart(5)} 输入 + ${String(output).padStart(5)} 输出 ≈ ${formatCost(cost)}`)
  }
  logger.log('')
  logger.log(`  一天按「1 篇短文 + 1 组错词卡片」估算 ≈ ${formatCost(totalPerDay)}`)

  if (!provider.apiKey) {
    logger.log('')
    logger.log('⚠ 以上输出用量是按「代表性合规输出」估算的，不是真实调用结果。')
    logger.log('  要拿到真实数字，请先保存 Key，然后运行：')
    logger.log(`    node server/src/db/calibrateAi.js --email=你的账号邮箱 --samples=3`)
  }

  return { rows, recommendations, isReasoning, provider: provider.source }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isDirectRun) {
  const argv = process.argv.slice(2)
  const readOption = (name) => {
    const found = argv.find((arg) => arg.startsWith(`--${name}=`))
    return found ? found.slice(name.length + 3) : null
  }

  calibrateAi({
    email: readOption('email'),
    samples: Number.parseInt(readOption('samples') || '1', 10),
  })
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('[calibrate] 失败：', error.message)
      await pool.end().catch(() => {})
      process.exitCode = 1
    })
}
