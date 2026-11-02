/**
 * 间隔重复引擎（PRD 4.2.2）
 *
 * 在经典 SM-2 基础上扩展了三个输入维度：
 *  1. 主动标记不确定 → 适度缩短间隔；答题时长不参与置信度判定
 *  2. 历史错误次数 → 折算进记忆强度，决定复习优先级
 *  3. 易混词组 → 存在形近/近义混淆时，间隔按系数打折，因为混淆概率高于单纯遗忘
 *
 * 评分与复习安排统一由后端负责。
 */

const DAY_MS = 24 * 60 * 60 * 1000

export const SRS = {
  /** 旧版速度阈值，保留兼容；不再用于判定熟练度 */
  FAST_RESPONSE_MS: 3000,
  /** 旧版描述性速度阈值，不再用于判定熟练度 */
  SLOW_RESPONSE_MS: 6000,
  INITIAL_EF: 2.5,
  MIN_EF: 1.3,
  MAX_EF: 2.5,
  /** 间隔达到该天数视为已掌握 */
  MASTERED_INTERVAL_DAYS: 21,
  /** 存在形近/近义混淆时的间隔折扣 */
  CONFUSION_INTERVAL_FACTOR: 0.7,
  /** low-confidence（用户主动标记不确定）的间隔折扣 */
  LOW_CONFIDENCE_INTERVAL_FACTOR: 0.8,
  MAX_INTERVAL_DAYS: 365,
  /** 记忆强度低于该值的词优先进入复习队列 */
  WEAK_STRENGTH_THRESHOLD: 45,
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function round2(value) {
  return Math.round(value * 100) / 100
}

/**
 * 由「对错 + 犹豫时长」推导 SM-2 质量分 0~5。
 * - 答错 → 1（生疏）
 * - 答对且主动标记不确定 → 3；正常回忆答对 → 4。时间不决定等级。
 */
export function grade(_hesitationMs, isCorrect, recall = 'normal') {
  if (!isCorrect) return 1
  // Reading options, motor speed and interruptions are not evidence of forgetting.
  return recall === 'hard' ? 3 : 4
}

/**
 * 记忆强度 0~100：用于生成复习优先级队列。
 * 组成：连续答对次数 40% + 难度因子 30% + 历史正确率 30%。反应时间仅作描述性记录。
 * 最近一次答错则强制压低上限，避免「历史正确率很高但刚忘掉」的词被排到队尾。
 */
export function computeMemoryStrength({
  repetitions = 0,
  ef = SRS.INITIAL_EF,
  timesSeen = 0,
  timesCorrect = 0,
  lastResult = null,
  lastHesitationMs = null,
} = {}) {
  const repsScore = clamp(repetitions / 6, 0, 1)
  const efScore = clamp((ef - SRS.MIN_EF) / (SRS.MAX_EF - SRS.MIN_EF), 0, 1)
  const accScore = timesSeen > 0 ? clamp(timesCorrect / timesSeen, 0, 1) : 0

  let strength = 100 * (0.4 * repsScore + 0.3 * efScore + 0.3 * accScore)

  if (lastResult === 0 || lastResult === false) strength = Math.min(strength, 40)
  if (timesSeen === 0) strength = 0

  return round2(clamp(strength, 0, 100))
}

/**
 * 计算下一次复习参数。
 *
 * @param {object} item 当前进度（ef / repetitions / intervalDays）
 * @param {number} quality 0~5 质量分，见 grade()
 * @param {number} now 时间戳
 * @param {object} [options]
 * @param {number} [options.confusionFactor] 易混词间隔折扣，默认 1
 * @param {number} [options.relearnDays] 答错后的重学间隔（天），可按错因覆盖
 * @returns {{ ef:number, repetitions:number, intervalDays:number, nextReviewAt:Date, state:string }}
 */
export function reviewItem(item = {}, quality, now = Date.now(), options = {}) {
  const { confusionFactor = 1, relearnDays } = options

  let ef = Number(item.ef ?? SRS.INITIAL_EF)
  let repetitions = Number(item.repetitions ?? 0)

  // SM-2 难度因子更新
  ef += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  ef = clamp(round2(ef), SRS.MIN_EF, SRS.MAX_EF)

  let intervalDays
  if (quality >= 3) {
    if (repetitions === 0) intervalDays = 1
    else if (repetitions === 1) intervalDays = 6
    else intervalDays = Number(item.intervalDays || 6) * ef

    repetitions += 1

    // 答对但犹豫久 → 低置信度，间隔适度缩短
    if (quality === 3) intervalDays *= SRS.LOW_CONFIDENCE_INTERVAL_FACTOR
    // 易混词组 → 混淆概率高于单纯遗忘，间隔再打折
    if (confusionFactor !== 1) intervalDays *= confusionFactor

    intervalDays = clamp(round2(intervalDays), 1, SRS.MAX_INTERVAL_DAYS)
  } else {
    repetitions = 0
    intervalDays = clamp(round2(Number(relearnDays ?? 1)), 0.25, SRS.MAX_INTERVAL_DAYS)
  }

  // state 语义：
  //   learning  = 连续答对次数为 0，尚未通过一次（含答错后被重置）
  //   reviewing = 已进入复习周期，间隔尚未达到「已掌握」阈值
  //   mastered  = 间隔达到 MASTERED_INTERVAL_DAYS 天
  // 注意：首次答对后即进入 reviewing（间隔 1 天已排入复习队列），而不是 learning。
  const state =
    repetitions === 0
      ? 'learning'
      : intervalDays >= SRS.MASTERED_INTERVAL_DAYS
        ? 'mastered'
        : 'reviewing'

  return {
    ef,
    repetitions,
    intervalDays,
    nextReviewAt: new Date(now + intervalDays * DAY_MS),
    state,
  }
}

/**
 * 复习优先级分值，越大越该先复习。
 * 逾期越久、记忆强度越低、历史错误越多，分值越高。
 */
export function reviewPriority(progress, now = Date.now()) {
  if (!progress || !progress.next_review_at) return 0

  const due = new Date(progress.next_review_at).getTime()
  const overdueDays = Math.max(0, (now - due) / DAY_MS)
  const strength = Number(progress.memory_strength ?? 0)
  const wrongRatio =
    progress.times_seen > 0 ? Number(progress.times_wrong ?? 0) / Number(progress.times_seen) : 0

  return round2(overdueDays * 2 + (100 - strength) * 0.05 + wrongRatio * 10)
}

export default { SRS, grade, computeMemoryStrength, reviewItem, reviewPriority }
