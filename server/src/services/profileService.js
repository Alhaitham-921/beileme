import { query, queryOne, execute } from '../db/pool.js'
import { parseJson, toJson } from '../utils/json.js'
import { todayKey, toDateKey } from '../utils/time.js'
import { notFound } from '../utils/errors.js'

/** Onboarding 问卷的合法取值（PRD 4.1），同时作为接口层的白名单 */
export const GOALS = ['中考', '高考', '四级', '六级', '考研', '雅思', '托福', '纯兴趣', '自定义']
export const DAILY_TIMES = ['5-10', '15-20', '30+']
export const SELF_LEVELS = ['不确定', '1000 以下', '1000-3000', '3000-6000', '6000 以上']
export const MEMORY_PREFS = ['example', 'affix', 'image', 'context', 'game']

/** 每日学习时长 → 新词量基准（与前端 onboarding 映射保持一致） */
export const DAILY_TIME_TO_NEW_WORDS = {
  '5-10': 10,
  '15-20': 20,
  '30+': 30,
}

/** 话题池初始权重，AI 生成短文时按权重随机抽取（PRD 4.3.1 / 4.4） */
export const DEFAULT_TOPIC_WEIGHTS = {
  科技: 1,
  环保: 1,
  校园: 1,
  旅行: 1,
  职场: 1,
  生活: 1,
  健康: 1,
  文化: 1,
}

export function mapProfileRow(row) {
  if (!row) return null
  return {
    userId: Number(row.user_id),
    goal: row.goal || '',
    examDate: toDateKey(row.exam_date),
    selfLevel: row.self_level || '',
    dailyTime: row.daily_time || '',
    newPerDay: Number(row.new_per_day ?? 15),
    reviewPerDay: Number(row.review_per_day ?? 30),
    /** 用户当前使用的词书 id；为空表示按 goal 映射 */
    wordbookId: row.wordbook_id != null ? Number(row.wordbook_id) : null,
    memoryPrefs: parseJson(row.memory_prefs, []),
    topicWeights: parseJson(row.topic_weights, DEFAULT_TOPIC_WEIGHTS),
    needsWriting: Boolean(row.needs_writing),
    onboardedAt: row.onboarded_at,
    isOnboarded: row.onboarded_at != null,
  }
}

/**
 * 确保用户存在画像行（注册后即有默认画像，避免到处判空）
 */
export async function ensureProfile(userId) {
  await execute(
    `INSERT INTO user_profiles (user_id, topic_weights) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId, toJson(DEFAULT_TOPIC_WEIGHTS)]
  )
  return getProfile(userId)
}

export async function getProfile(userId) {
  const row = await queryOne('SELECT * FROM user_profiles WHERE user_id = ?', [userId])
  if (!row) return ensureProfile(userId)
  return mapProfileRow(row)
}

/**
 * 计算每日新词量（PRD 4.6：目标词书 ÷ 剩余天数，同时不超过时长预算）
 *
 * - 有考试日期：按剩余天数平摊，考期越近每日越多
 * - 时长预算是硬上限，避免把用户压垮
 */
export function computeNewPerDay({ dailyTime, examDate, wordbookTotal, learnedCount }) {
  const base = DAILY_TIME_TO_NEW_WORDS[dailyTime] ?? 15
  const remainingWords = Math.max(0, Number(wordbookTotal || 0) - Number(learnedCount || 0))

  let paced = Number.POSITIVE_INFINITY
  if (examDate && remainingWords > 0) {
    const today = new Date(`${todayKey()}T00:00:00Z`).getTime()
    const exam = new Date(`${examDate}T00:00:00Z`).getTime()
    const daysLeft = Math.max(1, Math.round((exam - today) / (24 * 60 * 60 * 1000)))
    paced = Math.ceil(remainingWords / daysLeft)
  }

  const target = Number.isFinite(paced) ? Math.min(base, paced) : base
  return Math.min(50, Math.max(5, target))
}

/** 部分更新画像，未传字段保持原值 */
export async function updateProfile(userId, patch = {}) {
  await ensureProfile(userId)
  const current = await getProfile(userId)

  const next = {
    goal: patch.goal ?? current.goal,
    examDate: patch.examDate !== undefined ? patch.examDate : current.examDate,
    selfLevel: patch.selfLevel ?? current.selfLevel,
    dailyTime: patch.dailyTime ?? current.dailyTime,
    newPerDay:
      patch.newPerDay != null ? Number(patch.newPerDay) : current.newPerDay,
    reviewPerDay:
      patch.reviewPerDay != null ? Number(patch.reviewPerDay) : current.reviewPerDay,
    memoryPrefs: patch.memoryPrefs ?? current.memoryPrefs,
    topicWeights: patch.topicWeights
      ? { ...current.topicWeights, ...patch.topicWeights }
      : current.topicWeights,
    needsWriting: patch.needsWriting != null ? Boolean(patch.needsWriting) : current.needsWriting,
    wordbookId: patch.wordbookId != null ? Number(patch.wordbookId) : current.wordbookId,
  }

  await execute(
    `UPDATE user_profiles SET
       goal = ?, exam_date = ?, self_level = ?, daily_time = ?,
       new_per_day = ?, review_per_day = ?, wordbook_id = ?, memory_prefs = ?,
       topic_weights = ?, needs_writing = ?
     WHERE user_id = ?`,
    [
      next.goal,
      next.examDate,
      next.selfLevel,
      next.dailyTime,
      next.newPerDay,
      next.reviewPerDay,
      next.wordbookId,
      toJson(next.memoryPrefs),
      toJson(next.topicWeights),
      next.needsWriting ? 1 : 0,
      userId,
    ]
  )

  return getProfile(userId)
}

/**
 * 完成 Onboarding：写入画像、按剩余天数算出新词量、固化词书、标记已引导。
 * @returns {Promise<{profile:object, newPerDay:number}>}
 */
export async function completeOnboarding(
  userId,
  answers = {},
  { wordbookTotal = 0, learnedCount = 0, wordbookId = null } = {}
) {
  const goal = GOALS.includes(answers.goal) ? answers.goal : '纯兴趣'
  const dailyTime = DAILY_TIMES.includes(answers.dailyTime) ? answers.dailyTime : '15-20'
  const selfLevel = SELF_LEVELS.includes(answers.selfLevel) ? answers.selfLevel : '不确定'

  const newPerDay = computeNewPerDay({
    dailyTime,
    examDate: answers.examDate || null,
    wordbookTotal,
    learnedCount,
  })

  await ensureProfile(userId)
  await execute(
    `UPDATE user_profiles SET
       goal = ?, exam_date = ?, self_level = ?, daily_time = ?,
       new_per_day = ?, wordbook_id = ?, memory_prefs = ?, needs_writing = ?, onboarded_at = NOW()
     WHERE user_id = ?`,
    [
      goal,
      answers.examDate || null,
      selfLevel,
      dailyTime,
      newPerDay,
      wordbookId,
      toJson(Array.isArray(answers.memoryPrefs) ? answers.memoryPrefs.filter((p) => MEMORY_PREFS.includes(p)) : []),
      answers.needsWriting ? 1 : 0,
      userId,
    ]
  )

  return { profile: await getProfile(userId), newPerDay }
}

/** 按话题偏好调整权重（AI 生成后回写，实现「越用越懂你」） */
export async function bumpTopicWeight(userId, topic, delta = 0.1) {
  if (!topic) return
  const profile = await getProfile(userId)
  const weights = { ...profile.topicWeights }
  weights[topic] = Math.max(0.1, Math.min(3, Number(weights[topic] ?? 1) + delta))
  await execute('UPDATE user_profiles SET topic_weights = ? WHERE user_id = ?', [
    toJson(weights),
    userId,
  ])
}

/** 供接口层复用的用户基本信息查询 */
export async function getUserById(userId) {
  const row = await queryOne(
    'SELECT id, email, phone, nickname, status, created_at FROM users WHERE id = ?',
    [userId]
  )
  if (!row) throw notFound('用户不存在')
  return row
}

export default {
  GOALS,
  DAILY_TIMES,
  SELF_LEVELS,
  MEMORY_PREFS,
  ensureProfile,
  getProfile,
  updateProfile,
  completeOnboarding,
  computeNewPerDay,
  bumpTopicWeight,
  getUserById,
}
