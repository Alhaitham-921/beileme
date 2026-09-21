import { query, queryOne, execute } from '../db/pool.js'
import { todayKey, addDays, businessDayStartUtc } from '../utils/time.js'
import { getStreak } from './planService.js'

/** 质量类徽章要求的最小样本量，避免「只答了 2 题全对」就解锁 */
const MIN_SAMPLE_FOR_QUALITY = 10
/** 形近辨析徽章要求的最少答题量 */
const MIN_SAMPLE_FOR_FORM_BADGE = 20

export async function listBadgeCatalog() {
  const rows = await query('SELECT * FROM badges ORDER BY sort_order ASC, id ASC')
  return rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    threshold: Number(row.threshold),
    icon: row.icon,
  }))
}

export async function listUserBadges(userId) {
  const rows = await query(
    `SELECT b.*, ub.unlocked_at
       FROM user_badges ub
       JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = ?
      ORDER BY ub.unlocked_at DESC`,
    [userId]
  )
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    unlockedAt: row.unlocked_at,
  }))
}

/** 收集评估徽章所需的各项指标 */
async function collectMetrics(userId) {
  const [learnedRow, streak, accuracyRow, formRow, spellRow] = await Promise.all([
    queryOne('SELECT COUNT(*) AS total FROM user_word_progress WHERE user_id = ?', [userId]),
    getStreak(userId),
    queryOne(
      `SELECT MAX(CASE WHEN correct_count + wrong_count >= ? THEN correct_count / (correct_count + wrong_count) ELSE 0 END) AS best
         FROM daily_plans WHERE user_id = ?`,
      [MIN_SAMPLE_FOR_QUALITY, userId]
    ),
    queryOne(
      `SELECT COUNT(*) AS total,
              SUM(error_type = 'form_confusion') AS form_confusions
         FROM answer_logs
        WHERE user_id = ? AND created_at >= ?`,
      [userId, businessDayStartUtc(addDays(todayKey(), -6))]
    ),
    query(
      `SELECT wrong_count FROM game_records
        WHERE user_id = ? AND game = 'spell'
        ORDER BY created_at DESC LIMIT 5`,
      [userId]
    ),
  ])

  // 连续 5 次拼词游戏零失误
  const spellPerfectStreak =
    spellRow.length === 5 && spellRow.every((row) => Number(row.wrong_count) === 0)

  return {
    totalLearned: Number(learnedRow?.total || 0),
    streak,
    bestDailyAccuracy: Number(accuracyRow?.best || 0),
    weeklyAnswers: Number(formRow?.total || 0),
    weeklyFormConfusions: Number(formRow?.form_confusions || 0),
    spellPerfectStreak,
  }
}

/** 判断某枚徽章当前是否达成 */
function isUnlocked(badge, metrics) {
  switch (badge.code) {
    case 'streak_3':
    case 'streak_7':
    case 'streak_30':
    case 'streak_100':
      return metrics.streak >= badge.threshold
    case 'words_100':
    case 'words_500':
    case 'words_1000':
    case 'words_3000':
      return metrics.totalLearned >= badge.threshold
    case 'accuracy_95':
      return metrics.bestDailyAccuracy >= badge.threshold / 100
    case 'no_form_confusion_week':
      return (
        metrics.weeklyAnswers >= MIN_SAMPLE_FOR_FORM_BADGE && metrics.weeklyFormConfusions === 0
      )
    case 'spell_streak_5':
      return metrics.spellPerfectStreak
    default:
      // article_perfect 等需要 AI 生成内容反馈的徽章，由对应模块显式调用 unlockBadge
      return false
  }
}

/**
 * 评估并解锁用户新达成的徽章。
 * @returns {Promise<Array<{code:string,name:string,icon:string}>>} 本次新解锁的徽章
 */
export async function evaluateBadges(userId) {
  const [catalog, ownedRows, metrics] = await Promise.all([
    listBadgeCatalog(),
    query('SELECT badge_id FROM user_badges WHERE user_id = ?', [userId]),
    collectMetrics(userId),
  ])

  const owned = new Set(ownedRows.map((row) => Number(row.badge_id)))
  const newlyUnlocked = []

  for (const badge of catalog) {
    if (owned.has(badge.id)) continue
    if (!isUnlocked(badge, metrics)) continue

    await execute(
      `INSERT INTO user_badges (user_id, badge_id, progress) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE unlocked_at = unlocked_at`,
      [userId, badge.id, badge.threshold]
    )
    newlyUnlocked.push({ code: badge.code, name: badge.name, icon: badge.icon })
  }

  return newlyUnlocked
}

/** 供 AI/游戏等模块显式解锁需要外部信号的徽章 */
export async function unlockBadge(userId, code) {
  const badge = await queryOne('SELECT * FROM badges WHERE code = ?', [code])
  if (!badge) return null

  const result = await execute(
    `INSERT INTO user_badges (user_id, badge_id, progress) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE unlocked_at = unlocked_at`,
    [userId, badge.id, badge.threshold]
  )
  // affectedRows 为 1 表示确实插入了新记录（重复时 ON DUPLICATE 不改变行数）
  return result.affectedRows === 1
    ? { code: badge.code, name: badge.name, icon: badge.icon }
    : null
}

export default { listBadgeCatalog, listUserBadges, evaluateBadges, unlockBadge }
