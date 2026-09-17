// 简化版 SM-2 间隔重复算法
// quality（作答质量 0~5）由「对错 + 犹豫时长」推导，见 grade()

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 根据作答结果和犹豫时长给出质量分。
 * - 答错 → 1（生疏）
 * - 答对且快（≤3s）→ 5（熟练）
 * - 答对但慢（>3s）→ 3（半熟 / 低置信度）
 */
export function grade(hesitationMs, isCorrect) {
  if (!isCorrect) return 1
  return hesitationMs <= 3000 ? 5 : 3
}

/**
 * 更新单个单词的复习参数，返回 { ef, repetitions, intervalDays, nextReviewAt }。
 * @param {object} item 当前进度（含 ef / repetitions / intervalDays）
 * @param {number} quality 0~5
 * @param {number} now 时间戳
 */
export function reviewItem(item, quality, now = Date.now()) {
  let ef = item.ef ?? 2.5
  let repetitions = item.repetitions ?? 0

  // SM-2 难度因子更新
  ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  ef = Math.max(1.3, Math.min(2.5, ef))

  let intervalDays
  if (quality >= 3) {
    if (repetitions === 0) intervalDays = 1
    else if (repetitions === 1) intervalDays = 6
    else intervalDays = Math.round((item.intervalDays || 6) * ef)
    repetitions += 1
  } else {
    repetitions = 0
    intervalDays = 1
  }

  return {
    ef,
    repetitions,
    intervalDays,
    nextReviewAt: now + intervalDays * DAY_MS,
  }
}
