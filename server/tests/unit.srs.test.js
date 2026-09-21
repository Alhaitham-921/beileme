import test from 'node:test'
import assert from 'node:assert/strict'
import { grade, reviewItem, computeMemoryStrength, reviewPriority, SRS } from '../src/services/srs.js'

const DAY_MS = 24 * 60 * 60 * 1000

test('grade：答错一律计 1 分，不论反应快慢', () => {
  assert.equal(grade(300, false), 1)
  assert.equal(grade(9000, false), 1)
})

test('grade：答对且快（≤3s）计 5 分，答对但慢计 3 分', () => {
  assert.equal(grade(1000, true), 5)
  assert.equal(grade(SRS.FAST_RESPONSE_MS, true), 5)
  assert.equal(grade(SRS.FAST_RESPONSE_MS + 1, true), 3)
  assert.equal(grade(9000, true), 3)
})

test('grade：犹豫时长非法时按低置信度处理，而不是判为熟练', () => {
  assert.equal(grade(undefined, true), 3)
  assert.equal(grade(Number.NaN, true), 3)
})

test('reviewItem：首次答对间隔 1 天，第二次 6 天，其后按难度因子增长', () => {
  const now = Date.now()

  const first = reviewItem({}, 5, now)
  assert.equal(first.repetitions, 1)
  assert.equal(first.intervalDays, 1)

  const second = reviewItem(first, 5, now)
  assert.equal(second.repetitions, 2)
  assert.equal(second.intervalDays, 6)

  const third = reviewItem(second, 5, now)
  assert.equal(third.repetitions, 3)
  // 6 * ef，ef 上限 2.5
  assert.ok(third.intervalDays >= 6 && third.intervalDays <= 15, `实际 ${third.intervalDays}`)
})

test('reviewItem：答错后连续答对次数清零并按重学间隔安排', () => {
  const now = Date.now()
  const learned = reviewItem(reviewItem({}, 5, now), 5, now)

  const failed = reviewItem(learned, 1, now, { relearnDays: 0.25 })
  assert.equal(failed.repetitions, 0)
  assert.equal(failed.intervalDays, 0.25)
  assert.equal(failed.state, 'learning')
  assert.equal(failed.nextReviewAt.getTime(), now + 0.25 * DAY_MS)
})

test('reviewItem：难度因子被限制在 [1.3, 2.5]', () => {
  let item = {}
  for (let i = 0; i < 12; i += 1) item = reviewItem(item, 1, Date.now())
  assert.equal(item.ef, SRS.MIN_EF)

  let high = {}
  for (let i = 0; i < 12; i += 1) high = reviewItem(high, 5, Date.now())
  assert.equal(high.ef, SRS.MAX_EF)
})

test('reviewItem：低置信度正确（quality=3）的间隔比熟练正确更短', () => {
  const now = Date.now()
  const base = reviewItem({ ef: 2.2, repetitions: 2, intervalDays: 10 }, 5, now)
  const lowConfidence = reviewItem({ ef: 2.2, repetitions: 2, intervalDays: 10 }, 3, now)
  assert.ok(
    lowConfidence.intervalDays < base.intervalDays,
    `低置信度 ${lowConfidence.intervalDays} 应小于熟练 ${base.intervalDays}`
  )
})

test('reviewItem：易混词的间隔按系数打折（PRD 4.2.2）', () => {
  const now = Date.now()
  const item = { ef: 2.2, repetitions: 2, intervalDays: 10 }
  const normal = reviewItem(item, 5, now, { confusionFactor: 1 })
  const confused = reviewItem(item, 5, now, { confusionFactor: SRS.CONFUSION_INTERVAL_FACTOR })

  assert.ok(confused.intervalDays < normal.intervalDays)
  assert.equal(
    confused.intervalDays,
    Math.round(normal.intervalDays * SRS.CONFUSION_INTERVAL_FACTOR * 100) / 100
  )
})

test('reviewItem：间隔不超过上限，且 state 随间隔升级为 mastered', () => {
  const now = Date.now()
  const result = reviewItem({ ef: 2.5, repetitions: 5, intervalDays: 300 }, 5, now)
  assert.ok(result.intervalDays <= SRS.MAX_INTERVAL_DAYS)
  assert.equal(result.state, 'mastered')
})

test('computeMemoryStrength：从未学过的词强度为 0', () => {
  assert.equal(computeMemoryStrength({ timesSeen: 0 }), 0)
})

test('computeMemoryStrength：连对次数越多强度越高', () => {
  const weak = computeMemoryStrength({
    repetitions: 0,
    ef: 1.5,
    timesSeen: 4,
    timesCorrect: 1,
    lastResult: 0,
    lastHesitationMs: 8000,
  })
  const strong = computeMemoryStrength({
    repetitions: 8,
    ef: 2.5,
    timesSeen: 8,
    timesCorrect: 8,
    lastResult: 1,
    lastHesitationMs: 900,
  })

  assert.ok(strong > weak, `熟练词 ${strong} 应高于生疏词 ${weak}`)
  assert.ok(strong <= 100 && weak >= 0)
})

test('computeMemoryStrength：最近一次答错会压低上限', () => {
  const justFailed = computeMemoryStrength({
    repetitions: 0,
    ef: 2.5,
    timesSeen: 10,
    timesCorrect: 9,
    lastResult: 0,
    lastHesitationMs: 500,
  })
  assert.ok(justFailed <= 40, `实际 ${justFailed}`)
})

test('reviewPriority：逾期越久优先级越高', () => {
  const now = Date.now()
  const overdue = reviewPriority(
    { next_review_at: new Date(now - 5 * DAY_MS), memory_strength: 30, times_seen: 4, times_wrong: 3 },
    now
  )
  const fresh = reviewPriority(
    { next_review_at: new Date(now), memory_strength: 90, times_seen: 4, times_wrong: 0 },
    now
  )
  assert.ok(overdue > fresh, `逾期 ${overdue} 应高于刚到期 ${fresh}`)
})

test('reviewPriority：没有复习记录时为 0', () => {
  assert.equal(reviewPriority(null), 0)
  assert.equal(reviewPriority({ next_review_at: null }), 0)
})
