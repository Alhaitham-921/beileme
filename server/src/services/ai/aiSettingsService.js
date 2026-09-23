import { queryOne, execute } from '../../db/pool.js'
import { config } from '../../config.js'
import { badRequest } from '../../utils/errors.js'
import { clamp } from '../../utils/json.js'

/**
 * 用户的 AI 额度设置。
 *
 * 设计要点：**留空 = 跟随系统推荐值**。
 * 这样以后调整默认值时，没有自定义过的用户会自动享受到新值，不需要迁移数据。
 *
 * 关于额度的两个常识（界面上也要讲清楚）：
 *  1. max_tokens 是「输出上限」而不是「预留」——模型写完就停，用不到不收费
 *  2. 所以它主要防的是「跑飞」和「截断」，不是省钱的旋钮；
 *     真正影响成本的是输入 token 与调用次数
 */

/**
 * 纯数值的额度字段。
 *
 * 「是否允许内部思考」是开关而不是额度，所以**不在**这个列表里：
 * 三个档位只该调数字，不该悄悄把用户亲手打开的开关又关掉。
 */
export const NUMERIC_LIMIT_FIELDS = [
  'articleTokens',
  'quizTokens',
  'errorCardTokens',
  'summaryTokens',
  'maxInputTokens',
  'reasoningMultiplier',
]

/** 只保留数值字段，用于构造档位 */
function numericOnly(values) {
  return Object.fromEntries(NUMERIC_LIMIT_FIELDS.map((field) => [field, values[field]]))
}

/**
 * 系统推荐值。数字来自**真实调用**实测（约 1.3-1.6 倍余量），
 * 复测命令：node server/src/db/calibrateAi.js --email=你的账号 --samples=3
 *
 * 为什么必须用真实调用标定：最早的推荐值是照着一份「想象中精简的输出样本」定的，
 * 结果模型实际写的字远超那个样本。表现是**第一次调用必然被截断**，
 * 系统白白多花一次调用去重试——既慢又贵。实测数字如下（已关掉内部思考）：
 *   短文（230 词）   479 输入 +  567 输出 ≈ ¥0.0054
 *   理解题（3 题）  1578 输入 + 1454 输出 ≈ ¥0.015
 *   错词卡片（6 张）1270 输入 + 2213 输出 ≈ ¥0.018（另一次实测 2431，故额度留到 3200）
 *   薄弱点小结       419 输入 +  349 输出 ≈ ¥0.0036
 */
export const RECOMMENDED_LIMITS = {
  articleTokens: 1000,
  quizTokens: 2000,
  errorCardTokens: 3200,
  summaryTokens: 600,
  maxInputTokens: 2000,
  reasoningMultiplier: 3,
  /**
   * 是否允许模型先做内部思考。默认 false。
   *
   * 实测依据（同一 Prompt、同一模型、各跑 3 次）：
   *   允许思考 → 3/3 次把 1000 输出额度全花在思考上，正文 0/3 次，生成必然失败且照常计费
   *   跳过思考 → 0/3 次思考，正文 3/3 次，平均只用 413 输出 token，耗时 3 秒（对比 17 秒）
   * 因此默认跳过；想要更细致输出、且愿意为此多花钱的用户可以自己打开。
   */
  allowThinking: false,
}

/** 每类内容允许的范围，防止用户填出会直接导致失败的极端值 */
export const LIMIT_BOUNDS = {
  articleTokens: [300, 8000],
  quizTokens: [300, 8000],
  errorCardTokens: [300, 10000],
  summaryTokens: [150, 3000],
  maxInputTokens: [600, 12000],
  reasoningMultiplier: [1, 6],
}

/** 界面上的快捷档位：点一下就把下面几个数字填好，避免用户面对一堆输入框发懵 */
export const LIMIT_PRESETS = {
  frugal: {
    label: '省钱',
    description: '贴着实测值走，够用但余量小；偶尔遇到话多的模型可能截断后自动重试',
    values: {
      articleTokens: 800,
      quizTokens: 1600,
      errorCardTokens: 2400,
      summaryTokens: 450,
      maxInputTokens: 1200,
      reasoningMultiplier: 3,
    },
  },
  balanced: {
    label: '均衡（推荐）',
    description: '约 1.3-1.6 倍余量，正常写作不会截断，成本依然很低',
    // 只带数值字段：档位不该顺手改掉「允许内部思考」这个开关
    values: numericOnly(RECOMMENDED_LIMITS),
  },
  quality: {
    label: '高质量',
    description: '给模型更宽松的空间，文章更长更完整；用不到的额度不收费',
    values: {
      articleTokens: 1800,
      quizTokens: 3000,
      errorCardTokens: 4500,
      summaryTokens: 900,
      maxInputTokens: 3500,
      reasoningMultiplier: 3,
    },
  },
}

const COLUMN_BY_FIELD = {
  articleTokens: 'article_tokens',
  quizTokens: 'quiz_tokens',
  errorCardTokens: 'error_card_tokens',
  summaryTokens: 'summary_tokens',
  maxInputTokens: 'max_input_tokens',
  reasoningMultiplier: 'reasoning_multiplier',
  allowThinking: 'allow_thinking',
}

/**
 * 解析出该用户实际生效的额度。
 * 数据库里为 NULL 的字段回落到系统推荐值。
 */
export async function resolveLimits(userId) {
  const row = userId == null ? null : await queryOne('SELECT * FROM user_ai_limits WHERE user_id = ?', [userId])

  const pick = (field) => {
    const stored = row?.[COLUMN_BY_FIELD[field]]
    if (stored == null) return RECOMMENDED_LIMITS[field]
    const value = Number(stored)
    const [min, max] = LIMIT_BOUNDS[field]
    return clamp(value, min, max)
  }

  return {
    articleTokens: pick('articleTokens'),
    quizTokens: pick('quizTokens'),
    errorCardTokens: pick('errorCardTokens'),
    summaryTokens: pick('summaryTokens'),
    maxInputTokens: pick('maxInputTokens'),
    reasoningMultiplier: pick('reasoningMultiplier'),
    /** 布尔字段：没有记录时跟随推荐值（默认关闭思考） */
    allowThinking: row?.allow_thinking == null ? RECOMMENDED_LIMITS.allowThinking : Number(row.allow_thinking) === 1,
    /** 是否全部使用系统推荐值（界面据此提示「跟随推荐」） */
    usingRecommended: !row,
  }
}

/** 把默认常量展开成前端可直接渲染的形状 */
export function describeLimitOptions() {
  return {
    recommended: RECOMMENDED_LIMITS,
    bounds: LIMIT_BOUNDS,
    presets: Object.entries(LIMIT_PRESETS).map(([id, preset]) => ({ id, ...preset })),
    /** 实测参考值，供界面提示「一篇短文大约需要多少」 */
    measured: {
      articleTokens: 567,
      quizTokens: 1454,
      errorCardTokens: 2431,
      summaryTokens: 349,
      note:
        '来自 node server/src/db/calibrateAi.js --email=你的账号 的真实调用实测' +
        '（230 词短文、3 道理解题、6 张错词卡片、一周小结；已关掉模型的内部思考）',
    },
    /**
     * 「跳过内部思考」的实测证据，直接摆给用户看。
     * 这不是一个需要用户理解的抽象开关，而是一个有明确数字支撑的取舍。
     */
    thinking: {
      supported: true,
      label: '允许模型先内部思考',
      recommended: RECOMMENDED_LIMITS.allowThinking,
      measured: {
        withThinking: { runs: 3, thinkingRuns: 3, contentRuns: 0, outputTokens: 1000, latencyMs: 12233 },
        withoutThinking: { runs: 3, thinkingRuns: 0, contentRuns: 3, outputTokens: 413, latencyMs: 3212 },
      },
      note:
        '实测同一模型、同一个提示词各跑 3 次：允许思考时 3/3 次都把输出额度花在思考上、' +
        '正文一个字都没写出来（额度照常计费）；跳过思考后 3/3 次正常，平均只用约 413 输出 token、快约 4 倍。',
    },
  }
}

/** 保存用户的额度设置；传 null 表示恢复为系统推荐 */
export async function saveLimits(userId, patch = {}) {
  const values = {}
  for (const field of Object.keys(COLUMN_BY_FIELD)) {
    if (!(field in patch)) continue
    const raw = patch[field]
    if (raw === null) {
      // 布尔字段的列是 NOT NULL，用推荐值而不是 NULL
      values[field] = field === 'allowThinking' ? (RECOMMENDED_LIMITS.allowThinking ? 1 : 0) : null
      continue
    }
    if (field === 'allowThinking') {
      if (typeof raw !== 'boolean') throw badRequest('allowThinking 必须是 true 或 false')
      values[field] = raw ? 1 : 0
      continue
    }
    const value = Number(raw)
    if (!Number.isFinite(value)) throw badRequest(`${field} 必须是数字`)
    const [min, max] = LIMIT_BOUNDS[field]
    if (value < min || value > max) {
      throw badRequest(`${field} 需要在 ${min} 到 ${max} 之间`)
    }
    values[field] = field === 'reasoningMultiplier' ? Math.round(value * 100) / 100 : Math.round(value)
  }

  const fields = Object.keys(values)
  if (!fields.length) return resolveLimits(userId)

  const columns = fields.map((field) => COLUMN_BY_FIELD[field])
  const placeholders = fields.map(() => '?').join(', ')
  const updates = columns.map((column) => `${column} = VALUES(${column})`).join(', ')

  await execute(
    `INSERT INTO user_ai_limits (user_id, ${columns.join(', ')})
     VALUES (?, ${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}`,
    [userId, ...fields.map((field) => values[field])]
  )

  return resolveLimits(userId)
}

/** 一键套用某个档位 */
export async function applyPreset(userId, presetId) {
  const preset = LIMIT_PRESETS[presetId]
  if (!preset) throw badRequest(`未知的档位：${presetId}`)
  return saveLimits(userId, preset.values)
}

/** 恢复成系统推荐值 */
export async function resetLimits(userId) {
  await execute('DELETE FROM user_ai_limits WHERE user_id = ?', [userId])
  return resolveLimits(userId)
}

/** 把「用户额度」与「系统配置」合成最终生效值，供生成时使用 */
export function effectiveBudget(limits, field, type) {
  const fromUser = limits?.[field]
  const fromConfig = config.ai.maxOutputTokens[type]
  return fromUser ?? fromConfig
}

export default {
  RECOMMENDED_LIMITS,
  LIMIT_BOUNDS,
  LIMIT_PRESETS,
  resolveLimits,
  saveLimits,
  applyPreset,
  resetLimits,
  describeLimitOptions,
  effectiveBudget,
}
