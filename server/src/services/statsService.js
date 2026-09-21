import { query, queryOne } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { config } from '../config.js'
import { recentDateKeys, businessDayStartUtc, todayKey, toDateKey } from '../utils/time.js'
import { countDueWords, getOrCreateDailyPlan, getStreak } from './planService.js'
import { ERROR_TYPE_LABELS } from './errorAnalysis.js'
import { safeLimit } from './wordService.js'

/** 看板总览（PRD 4.7 个人中心数据看板） */
export async function getOverview(userId) {
  const [learnedRow, aggRow, dueCount, streak, plan] = await Promise.all([
    queryOne('SELECT COUNT(*) AS total FROM user_word_progress WHERE user_id = ?', [userId]),
    queryOne(
      `SELECT COALESCE(SUM(times_seen), 0) AS seen,
              COALESCE(SUM(times_correct), 0) AS correct,
              COALESCE(SUM(times_wrong), 0) AS wrong,
              COALESCE(AVG(memory_strength), 0) AS avg_strength
         FROM user_word_progress WHERE user_id = ?`,
      [userId]
    ),
    countDueWords(userId),
    getStreak(userId),
    getOrCreateDailyPlan(userId, todayKey()),
  ])

  const seen = Number(aggRow?.seen || 0)
  const correct = Number(aggRow?.correct || 0)

  return {
    totalLearned: Number(learnedRow?.total || 0),
    totalSeen: seen,
    totalCorrect: correct,
    totalWrong: Number(aggRow?.wrong || 0),
    accuracy: seen ? Math.round((correct / seen) * 100) : 0,
    avgMemoryStrength: Math.round(Number(aggRow?.avg_strength || 0) * 10) / 10,
    dueCount,
    streak,
    today: plan,
  }
}

/** 近 N 天正确率趋势 */
export async function getTrend(userId, { days = 7 } = {}) {
  const count = Math.min(60, Math.max(1, Number.parseInt(days, 10) || 7))
  const keys = recentDateKeys(count, todayKey())

  const rows = await query(
    `SELECT plan_date, correct_count, wrong_count, new_done, review_done
       FROM daily_plans
      WHERE user_id = ? AND plan_date >= ?
      ORDER BY plan_date ASC`,
    [userId, keys[0]]
  )
  const byDate = new Map(rows.map((row) => [toDateKey(row.plan_date), row]))

  return keys.map((date) => {
    const row = byDate.get(date)
    const correct = Number(row?.correct_count || 0)
    const wrong = Number(row?.wrong_count || 0)
    const total = correct + wrong
    const [, month, day] = date.split('-')
    return {
      date,
      label: `${Number(month)}/${Number(day)}`,
      correct,
      wrong,
      total,
      newDone: Number(row?.new_done || 0),
      reviewDone: Number(row?.review_done || 0),
      accuracy: total ? Math.round((correct / total) * 100) : null,
    }
  })
}

/** 记忆强度分布：按连续答对次数分层 */
export async function getStrengthDistribution(userId) {
  const rows = await query(
    `SELECT repetitions, COUNT(*) AS count
       FROM user_word_progress WHERE user_id = ?
      GROUP BY repetitions`,
    [userId]
  )

  const buckets = { 新学: 0, 巩固中: 0, 较熟: 0, 已掌握: 0 }
  for (const row of rows) {
    const reps = Number(row.repetitions)
    const count = Number(row.count)
    if (reps === 0) buckets['新学'] += count
    else if (reps === 1) buckets['巩固中'] += count
    else if (reps <= 3) buckets['较熟'] += count
    else buckets['已掌握'] += count
  }
  return buckets
}

/** 错因分布（饼图数据源） */
export async function getErrorDistribution(userId, { days = 30 } = {}) {
  const count = Math.min(365, Math.max(1, Number.parseInt(days, 10) || 30))
  const since = new Date(Date.now() - count * 24 * 60 * 60 * 1000)

  const rows = await query(
    `SELECT error_type, COUNT(*) AS count FROM answer_logs
      WHERE user_id = ? AND result = 0 AND error_type IS NOT NULL AND created_at >= ?
      GROUP BY error_type ORDER BY count DESC`,
    [userId, since]
  )

  const total = rows.reduce((sum, row) => sum + Number(row.count), 0)
  return {
    days: count,
    total,
    items: rows.map((row) => ({
      type: row.error_type,
      label: ERROR_TYPE_LABELS[row.error_type] || row.error_type,
      count: Number(row.count),
      percent: total ? Math.round((Number(row.count) / total) * 100) : 0,
    })),
  }
}

/**
 * 本周薄弱点小结（PRD 4.3.3）。
 * 当前用确定性规则生成自然语言结论；接入 AI 后可替换为模型生成版本，
 * 但统计口径保持不变，便于对比。
 */
export async function getWeakSummary(userId, { days = 7 } = {}) {
  const count = Math.min(60, Math.max(1, Number.parseInt(days, 10) || 7))
  const since = new Date(Date.now() - count * 24 * 60 * 60 * 1000)

  const [distribution, topWrong, hesitationRow] = await Promise.all([
    getErrorDistribution(userId, { days: count }),
    query(
      `SELECT w.id, w.spelling, w.definitions, COUNT(*) AS wrong_times,
              GROUP_CONCAT(DISTINCT a.error_type) AS error_types
         FROM answer_logs a
         JOIN words w ON w.id = a.word_id
        WHERE a.user_id = ? AND a.result = 0 AND a.created_at >= ?
        GROUP BY w.id
        ORDER BY wrong_times DESC, w.spelling ASC
        LIMIT ${safeLimit(5, { fallback: 5, max: 20 })}`,
      [userId, since]
    ),
    queryOne(
      `SELECT AVG(CASE WHEN result = 1 THEN hesitation_ms END) AS avg_correct_hesitation,
              AVG(CASE WHEN result = 0 THEN hesitation_ms END) AS avg_wrong_hesitation
         FROM answer_logs WHERE user_id = ? AND created_at >= ?`,
      [userId, since],
    ),
  ])

  const sentences = []
  const dominant = distribution.items[0]

  if (!distribution.total) {
    sentences.push('本周还没有产生错题记录，继续保持。')
  } else {
    const dominantLabel = dominant?.label || '记忆模糊'
    sentences.push(
      `本周共记录 ${distribution.total} 次错误，最主要的错因是「${dominantLabel}」，占 ${dominant.percent}%。`
    )
  }

  const confusions = distribution.items
    .filter((item) => ['form_confusion', 'meaning_confusion', 'systematic_confusion'].includes(item.type))
    .reduce((sum, item) => sum + item.count, 0)
  if (confusions > 0) {
    sentences.push(`其中形近/近义混淆类错误共 ${confusions} 次，建议优先完成易混词对比卡片。`)
  }

  const spelling = distribution.items.find((item) => item.type === 'spelling_weak')
  if (spelling) {
    sentences.push(`拼写薄弱导致 ${spelling.count} 次错误，可以通过拼词小游戏强化字母顺序记忆。`)
  }

  const guess = distribution.items.find((item) => item.type === 'guess')
  if (guess && guess.percent >= 30) {
    sentences.push(`盲猜占比达到 ${guess.percent}%，说明这些词基本是全新学习，需要先降速打基础。`)
  }

  if (topWrong.length) {
    sentences.push(`错得最多的词：${topWrong.map((row) => row.spelling).join('、')}。`)
  }

  const avgCorrectHesitation = Number(hesitationRow?.avg_correct_hesitation || 0)
  if (avgCorrectHesitation > 0) {
    sentences.push(
      avgCorrectHesitation > 4000
        ? `答对的平均反应时间 ${Math.round(avgCorrectHesitation / 1000)} 秒，偏慢，属于「半熟」状态，复习间隔已自动缩短。`
        : `答对的平均反应时间 ${Math.round(avgCorrectHesitation / 1000)} 秒，反应速度正常。`
    )
  }

  return {
    days: count,
    generatedAt: new Date(),
    source: 'rule-based',
    sentences,
    summary: sentences.join(''),
    errorDistribution: distribution,
    topWrongWords: topWrong.map((row) => ({
      wordId: Number(row.id),
      spelling: row.spelling,
      definitions: parseJson(row.definitions, []),
      wrongTimes: Number(row.wrong_times),
      errorTypes: String(row.error_types || '')
        .split(',')
        .filter(Boolean)
        .map((type) => ERROR_TYPE_LABELS[type] || type),
    })),
  }
}

/** 学习时长与答题量按小时分布（用于发现用户的活跃时段） */
export async function getHourlyActivity(userId, { days = 7 } = {}) {
  const count = Math.min(60, Math.max(1, Number.parseInt(days, 10) || 7))
  const since = businessDayStartUtc(recentDateKeys(count, todayKey())[0])

  // created_at 以 UTC 存储，这里平移业务时区偏移后再取小时，
  // 否则「几点学习」会整体偏 8 小时。
  const rows = await query(
    `SELECT HOUR(DATE_ADD(created_at, INTERVAL ? MINUTE)) AS hour,
            COUNT(*) AS answers, SUM(result) AS correct
       FROM answer_logs WHERE user_id = ? AND created_at >= ?
      GROUP BY hour ORDER BY hour ASC`,
    [config.timezoneOffsetMinutes, userId, since]
  )

  return rows.map((row) => ({
    hour: Number(row.hour),
    answers: Number(row.answers),
    correct: Number(row.correct || 0),
  }))
}

export default {
  getOverview,
  getTrend,
  getStrengthDistribution,
  getErrorDistribution,
  getWeakSummary,
  getHourlyActivity,
}
