import { query, queryOne, execute } from '../db/pool.js'
import { parseJson, toJson, clamp } from '../utils/json.js'
import { todayKey, addDays, recentDateKeys, businessDayStartUtc, businessDayEndUtc, toDateKey } from '../utils/time.js'
import { getProfile } from './profileService.js'

/** 单日复习量上限，避免欠账无限堆积（PRD 4.6.1） */
export const MAX_REVIEW_PER_DAY = 200
/** 未完成任务合并进当日复习队列的上限 */
export const MERGE_CAP = 40
/** 自适应调节询问的最小间隔天数，避免频繁打扰（PRD 4.6.1） */
export const ADJUST_PROMPT_INTERVAL_DAYS = 2

export const ADJUST_REASONS = ['too_hard', 'too_much', 'no_time', 'skip']

export function mapPlanRow(row) {
  if (!row) return null
  const newTarget = Number(row.new_target ?? 0)
  const reviewTarget = Number(row.review_target ?? 0)
  const newDone = Number(row.new_done ?? 0)
  const reviewDone = Number(row.review_done ?? 0)

  return {
    id: Number(row.id),
    date: toDateKey(row.plan_date),
    newTarget,
    reviewTarget,
    newDone,
    reviewDone,
    correctCount: Number(row.correct_count ?? 0),
    wrongCount: Number(row.wrong_count ?? 0),
    articleOptional: Boolean(row.article_optional),
    gameOptional: Boolean(row.game_optional),
    articleDone: Boolean(row.article_done),
    gameDone: Boolean(row.game_done),
    status: row.status,
    adjustReason: row.adjust_reason || null,
    adjustPayload: parseJson(row.adjust_payload, null),
    adjustedAt: row.adjusted_at,
    newPercent: newTarget ? Math.min(100, Math.round((newDone / newTarget) * 100)) : 0,
    reviewPercent: reviewTarget ? Math.min(100, Math.round((reviewDone / reviewTarget) * 100)) : 0,
    allDone: newDone >= newTarget && (reviewTarget === 0 || reviewDone >= reviewTarget),
  }
}

/** 待复习单词数（next_review_at 已到期） */
export async function countDueWords(userId, now = new Date()) {
  const row = await queryOne(
    'SELECT COUNT(*) AS total FROM user_word_progress WHERE user_id = ? AND next_review_at <= ?',
    [userId, now]
  )
  return Number(row?.total || 0)
}

/** 待复习单词列表（按到期时间升序）。
 *  显式列出字段而不写 p.*，避免 p.id（进度行 id）覆盖 w.id（单词 id）。 */
const PROGRESS_WORD_COLUMNS = `
  w.id, w.wordbook_id, w.spelling, w.phonetic, w.pos, w.freq, w.difficulty, w.definitions, w.examples,
  p.state, p.ef, p.repetitions, p.interval_days, p.memory_strength,
  p.next_review_at, p.last_review_at, p.first_learned_at,
  p.times_seen, p.times_correct, p.times_wrong, p.streak_correct,
  p.last_result, p.last_hesitation_ms`

export async function listDueWords(userId, { limit = 200, now = new Date() } = {}) {
  const cap = clamp(Number.parseInt(limit, 10) || 200, 1, 500)
  return query(
    `SELECT ${PROGRESS_WORD_COLUMNS}
       FROM user_word_progress p
       JOIN words w ON w.id = p.word_id
      WHERE p.user_id = ? AND p.next_review_at <= ?
      ORDER BY p.next_review_at ASC, p.memory_strength ASC
      LIMIT ${cap}`,
    [userId, now]
  )
}

/** 已学过但未到期的单词（「再学一组」提前复习时用） */
export async function listLearnedWords(userId, { limit = 50 } = {}) {
  const cap = clamp(Number.parseInt(limit, 10) || 50, 1, 200)
  return query(
    `SELECT ${PROGRESS_WORD_COLUMNS}
       FROM user_word_progress p
       JOIN words w ON w.id = p.word_id
      WHERE p.user_id = ?
      ORDER BY p.next_review_at ASC, p.memory_strength ASC
      LIMIT ${cap}`,
    [userId]
  )
}

/** 尚未学过的新词，按词频优先、组内乱序（避免按字母顺序背词） */
export async function listFreshWords(userId, wordbookId, { limit = 20 } = {}) {
  const cap = clamp(Number.parseInt(limit, 10) || 20, 1, 100)
  const rows = await query(
    `SELECT w.* FROM words w
      WHERE w.wordbook_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM user_word_progress p WHERE p.user_id = ? AND p.word_id = w.id
        )
      ORDER BY FIELD(w.freq, 'high', 'med', 'low'), w.difficulty ASC, RAND()
      LIMIT ${cap}`,
    [wordbookId, userId]
  )
  return rows
}

/**
 * 取当日计划，不存在则按画像与当前到期量创建。
 * review_target 在创建时固化，避免背完后数字跳变（与前端 ensureTodayPlan 行为一致）。
 */
export async function getOrCreateDailyPlan(userId, dateKey = todayKey()) {
  const existing = await queryOne(
    'SELECT * FROM daily_plans WHERE user_id = ? AND plan_date = ?',
    [userId, dateKey]
  )
  if (existing) return mapPlanRow(existing)

  const profile = await getProfile(userId)
  const dueCount = await countDueWords(userId)
  const reviewTarget = Math.min(MAX_REVIEW_PER_DAY, Math.max(0, dueCount))

  // 并发下可能重复插入，靠唯一键吸收，随后统一重新读取
  await execute(
    `INSERT INTO daily_plans (user_id, plan_date, new_target, review_target)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [userId, dateKey, profile.newPerDay, reviewTarget]
  )

  const row = await queryOne(
    'SELECT * FROM daily_plans WHERE user_id = ? AND plan_date = ?',
    [userId, dateKey]
  )
  return mapPlanRow(row)
}

/** 根据完成度推导计划状态 */
export function deriveStatus({ newDone, newTarget, reviewDone, reviewTarget }) {
  const newFinished = newDone >= newTarget
  const reviewFinished = reviewTarget === 0 || reviewDone >= reviewTarget
  if (newFinished && reviewFinished) return 'done'
  if (newDone > 0 || reviewDone > 0) return 'partial'
  return 'pending'
}

/**
 * 把一次作答计入当日计划。传入事务连接，保证与进度更新同生共死。
 * @param {import('mysql2/promise').PoolConnection} conn
 */
export async function addAnswerToPlan(conn, userId, dateKey, { isNew, isCorrect }) {
  await conn.execute(
    `UPDATE daily_plans SET
       new_done = new_done + ?,
       review_done = review_done + ?,
       correct_count = correct_count + ?,
       wrong_count = wrong_count + ?
     WHERE user_id = ? AND plan_date = ?`,
    [isNew ? 1 : 0, isNew ? 0 : 1, isCorrect ? 1 : 0, isCorrect ? 0 : 1, userId, dateKey]
  )

  const [rows] = await conn.execute(
    'SELECT new_done, new_target, review_done, review_target FROM daily_plans WHERE user_id = ? AND plan_date = ?',
    [userId, dateKey]
  )
  if (!rows.length) return

  const row = rows[0]
  const status = deriveStatus({
    newDone: Number(row.new_done),
    newTarget: Number(row.new_target),
    reviewDone: Number(row.review_done),
    reviewTarget: Number(row.review_target),
  })
  await conn.execute(
    'UPDATE daily_plans SET status = ? WHERE user_id = ? AND plan_date = ?',
    [status, userId, dateKey]
  )
}

export async function markArticleDone(userId, dateKey = todayKey(), done = true) {
  await getOrCreateDailyPlan(userId, dateKey)
  await execute(
    'UPDATE daily_plans SET article_done = ? WHERE user_id = ? AND plan_date = ?',
    [done ? 1 : 0, userId, dateKey]
  )
  return getOrCreateDailyPlan(userId, dateKey)
}

export async function markGameDone(userId, dateKey = todayKey(), done = true) {
  await getOrCreateDailyPlan(userId, dateKey)
  await execute(
    'UPDATE daily_plans SET game_done = ? WHERE user_id = ? AND plan_date = ?',
    [done ? 1 : 0, userId, dateKey]
  )
  return getOrCreateDailyPlan(userId, dateKey)
}

/**
 * 前一天未完成时，判断是否该弹出「自适应难度调节」询问（PRD 4.6.1）。
 * 约束：最多每 2 天触发一次。
 */
export async function getAdjustmentPrompt(userId, dateKey = todayKey()) {
  const yesterdayKey = addDays(dateKey, -1)
  const yesterday = await queryOne(
    'SELECT * FROM daily_plans WHERE user_id = ? AND plan_date = ?',
    [userId, yesterdayKey]
  )

  if (!yesterday || yesterday.status === 'done') {
    return { shouldPrompt: false, reason: 'no_unfinished_plan' }
  }

  const since = addDays(dateKey, -ADJUST_PROMPT_INTERVAL_DAYS)
  const recentAdjustment = await queryOne(
    `SELECT plan_date FROM daily_plans
      WHERE user_id = ? AND adjusted_at IS NOT NULL AND plan_date >= ?
      ORDER BY plan_date DESC LIMIT 1`,
    [userId, since]
  )

  if (recentAdjustment) {
    return { shouldPrompt: false, reason: 'recently_prompted' }
  }

  const plan = mapPlanRow(yesterday)
  return {
    shouldPrompt: true,
    reason: 'unfinished_yesterday',
    date: yesterdayKey,
    unfinished: {
      newRemaining: Math.max(0, plan.newTarget - plan.newDone),
      reviewRemaining: Math.max(0, plan.reviewTarget - plan.reviewDone),
    },
    question: '昨天的计划没完成，是单词有点难吗？',
    options: [
      { value: 'too_hard', label: '太难了，帮我调整' },
      { value: 'too_much', label: '太多了，减点量' },
      { value: 'no_time', label: '就是没顾上，不用调整' },
      { value: 'skip', label: '跳过，不想选' },
    ],
  }
}

/**
 * 应用自适应难度调节（PRD 4.6.1）。
 * 调整记录写入 adjust_payload，长期反馈进 AI 生成难度与 SRS 参数。
 */
export async function adjustPlan(userId, reason, dateKey = todayKey()) {
  if (!ADJUST_REASONS.includes(reason)) {
    throw new Error(`未知的调整原因：${reason}`)
  }

  const plan = await getOrCreateDailyPlan(userId, dateKey)
  let newTarget = plan.newTarget
  let reviewTarget = plan.reviewTarget
  let payload = { note: '' }

  if (reason === 'too_hard') {
    // 放慢新词引入速度，并优先给更基础的词
    newTarget = clamp(Math.round(newTarget * 0.7), 3, 50)
    payload = {
      note: '降低新词难度分布，优先从更高频、更基础的词开始',
      difficultyBias: 'easier',
      previousNewTarget: plan.newTarget,
    }
  } else if (reason === 'too_much') {
    newTarget = clamp(Math.round(newTarget * 0.7), 3, 50)
    const reducedReview = clamp(Math.round(reviewTarget * 0.7), 0, MAX_REVIEW_PER_DAY)

    // 未完成的旧任务合并进复习队列，但设上限，避免无限堆积
    const yesterdayKey = addDays(dateKey, -1)
    const yesterday = await queryOne(
      'SELECT * FROM daily_plans WHERE user_id = ? AND plan_date = ?',
      [userId, yesterdayKey]
    )
    let merged = 0
    if (yesterday) {
      const leftover =
        Math.max(0, Number(yesterday.new_target) - Number(yesterday.new_done)) +
        Math.max(0, Number(yesterday.review_target) - Number(yesterday.review_done))
      merged = Math.min(leftover, MERGE_CAP)
    }

    reviewTarget = clamp(reducedReview + merged, 0, MAX_REVIEW_PER_DAY)
    payload = {
      note: '按比例缩减当日任务量，未完成的旧任务合并进复习队列',
      previousNewTarget: plan.newTarget,
      previousReviewTarget: plan.reviewTarget,
      mergedFromYesterday: merged,
      mergeCap: MERGE_CAP,
    }
  } else if (reason === 'no_time') {
    payload = { note: '计划量不变，仅记录一次「未完成非难度原因」，用于后续统计' }
  } else {
    payload = { note: '用户选择跳过，不做任何调整' }
  }

  await execute(
    `UPDATE daily_plans SET
       new_target = ?, review_target = ?,
       adjust_reason = ?, adjust_payload = ?, adjusted_at = ?
     WHERE user_id = ? AND plan_date = ?`,
    [newTarget, reviewTarget, reason, toJson(payload), new Date(), userId, dateKey]
  )

  await execute(
    `UPDATE daily_plans SET status = ?
      WHERE user_id = ? AND plan_date = ?`,
    [
      deriveStatus({
        newDone: plan.newDone,
        newTarget,
        reviewDone: plan.reviewDone,
        reviewTarget,
      }),
      userId,
      dateKey,
    ]
  )

  return { plan: await getOrCreateDailyPlan(userId, dateKey), applied: payload }
}

/**
 * 打卡日历：返回区间内每天的学习完成情况（PRD 4.6.2）
 */
export async function getCalendar(userId, { from, to } = {}) {
  const endKey = to || todayKey()
  const startKey = from || addDays(endKey, -29)

  const rows = await query(
    `SELECT * FROM daily_plans
      WHERE user_id = ? AND plan_date BETWEEN ? AND ?
      ORDER BY plan_date ASC`,
    [userId, startKey, endKey]
  )
  const byDate = new Map(rows.map((row) => [toDateKey(row.plan_date), mapPlanRow(row)]))

  return recentDateKeys(
    Math.max(1, Math.round((new Date(`${endKey}T00:00:00Z`) - new Date(`${startKey}T00:00:00Z`)) / 86400000) + 1),
    endKey
  ).map((date) => {
    const plan = byDate.get(date) || null
    return {
      date,
      studied: plan ? plan.newDone + plan.reviewDone > 0 : false,
      status: plan?.status || null,
      newDone: plan?.newDone || 0,
      reviewDone: plan?.reviewDone || 0,
      correct: plan?.correctCount || 0,
      wrong: plan?.wrongCount || 0,
    }
  })
}

/** 连续打卡天数：从今天（或昨天）向前数连续有学习记录的天数 */
export async function getStreak(userId) {
  const rows = await query(
    `SELECT plan_date, new_done, review_done FROM daily_plans
      WHERE user_id = ? AND plan_date >= ?
      ORDER BY plan_date DESC`,
    [userId, addDays(todayKey(), -400)]
  )
  const studied = new Set(
    rows
      .filter((row) => Number(row.new_done) + Number(row.review_done) > 0)
      .map((row) => toDateKey(row.plan_date))
  )
  if (!studied.size) return 0

  let cursor = todayKey()
  // 今天还没学则从昨天起算，否则早起打卡会被判为断签
  if (!studied.has(cursor)) cursor = addDays(cursor, -1)

  let streak = 0
  while (studied.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

/** 指定日期的 UTC 起止边界，供答题流水按业务日期聚合 */
export function dayBounds(dateKey) {
  return { start: businessDayStartUtc(dateKey), end: businessDayEndUtc(dateKey) }
}

export default {
  getOrCreateDailyPlan,
  countDueWords,
  listDueWords,
  listLearnedWords,
  listFreshWords,
  addAnswerToPlan,
  markArticleDone,
  markGameDone,
  getAdjustmentPrompt,
  adjustPlan,
  getCalendar,
  getStreak,
  deriveStatus,
  mapPlanRow,
}
