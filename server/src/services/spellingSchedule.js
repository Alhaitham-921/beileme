import { addDays, diffDays, toDateKey, todayKey } from '../utils/time.js'
import { conflict } from '../utils/errors.js'

const DAILY_ATTEMPTS = 20
const DAILY_NEW_WORDS = 5
const EXTRA_ATTEMPTS = 10
const EXTRA_NEW_WORDS = 5
const intervals = [1, 3, 7, 14, 30]

const candidates = `WITH mistakes AS (
  SELECT word_id, created_at AS happened_at, error_type = 'spelling_weak' AS spelling_error
    FROM answer_logs WHERE user_id=? AND result=0
  UNION ALL
  SELECT word_id, created_at, 0 FROM assessment_answers WHERE user_id=? AND correct=0
  UNION ALL
  SELECT word_id, occurred_at, 0 FROM word_learning_evidence WHERE user_id=? AND source='image' AND result IN ('incorrect','skipped')
  UNION ALL
  SELECT word_id, last_wrong_at, 0 FROM collocation_progress WHERE user_id=? AND times_wrong>0
  UNION ALL
  SELECT word_id, COALESCE(last_review_at,first_learned_at), 0 FROM user_word_progress WHERE user_id=? AND times_wrong>0
  UNION ALL
  SELECT r.word_id, s.created_at, 1 FROM word_spelling_results r JOIN word_spelling_sessions s ON s.id=r.session_id
    WHERE s.user_id=? AND JSON_EXTRACT(s.state,'$.scheduled') IS NULL AND r.first_result<>'independent'
), waiting AS (
  SELECT m.word_id, MIN(m.happened_at) AS waiting_since
  FROM mistakes m LEFT JOIN word_spelling_schedule s ON s.user_id=? AND s.word_id=m.word_id
  WHERE m.happened_at IS NOT NULL
    AND (s.word_id IS NULL OR (s.status='mastered' AND m.spelling_error=1 AND m.happened_at>s.mastered_at))
  GROUP BY m.word_id
)`

export async function dailyRecallBudget(conn, userId, day) {
  const [[daily]] = await conn.execute('SELECT attempts, admitted, extra_batches FROM word_recall_daily WHERE user_id=? AND practice_on=?', [userId, day])
  const attempts = Number(daily?.attempts ?? 0)
  const extraBatches = Number(daily?.extra_batches ?? 0)
  const limit = DAILY_ATTEMPTS + extraBatches * EXTRA_ATTEMPTS
  const newLimit = DAILY_NEW_WORDS + extraBatches * EXTRA_NEW_WORDS
  return { attempts, remaining: limit - attempts, newRemaining: newLimit - Number(daily?.admitted ?? 0), limit }
}

export async function extendRecallBudget(conn, userId, day) {
  await conn.execute(`INSERT INTO word_recall_daily (user_id,practice_on,extra_batches) VALUES (?,?,1)
    ON DUPLICATE KEY UPDATE extra_batches=extra_batches+1`, [userId, day])
}

export async function spellingCandidates(conn, userId, day) {
  const budget = await dailyRecallBudget(conn, userId, day)
  // Reserve room for the optional correction of each new word.
  const limit = Math.min(budget.newRemaining, Math.floor(budget.remaining / 2))
  const [rows] = await conn.execute(`${candidates}
    SELECT w.id, w.spelling, COUNT(*) OVER () AS waiting_count, MIN(waiting_since) OVER () AS oldest
    FROM waiting JOIN words w ON w.id=waiting.word_id ORDER BY waiting_since, w.id LIMIT ?`,
  [...Array(7).fill(userId), Math.max(1, limit)])
  const oldest = rows[0]?.oldest
  return { ...budget, waiting: Number(rows[0]?.waiting_count ?? 0),
    oldestWaitingDays: oldest ? Math.max(0, diffDays(day, todayKey(new Date(oldest)))) : null,
    candidates: limit ? rows.map(row => ({ id: Number(row.id), spelling: row.spelling })) : [] }
}

export async function reserveSpelling(conn, userId, day, count) {
  await conn.execute(`INSERT INTO word_recall_daily (user_id,practice_on,admitted) VALUES (?,?,?)
    ON DUPLICATE KEY UPDATE admitted=admitted+VALUES(admitted)`, [userId, day, count])
}

export async function countRecallAttempt(conn, userId, day) {
  const { remaining } = await dailyRecallBudget(conn, userId, day)
  if (remaining <= 0) throw conflict('今天的专项练习已完成，明天可以继续')
  await conn.execute(`INSERT INTO word_recall_daily (user_id,practice_on,attempts) VALUES (?,?,1)
    ON DUPLICATE KEY UPDATE attempts=attempts+1`, [userId, day])
}

export async function scheduleFirstSpelling(conn, userId, wordId, day) {
  await conn.execute(`INSERT INTO word_spelling_schedule (user_id,word_id,due_on) VALUES (?,?,?)
    ON DUPLICATE KEY UPDATE due_on=VALUES(due_on), status='review', stage=0, failure_days=0,
    last_check_on=NULL, mastered_at=NULL`, [userId, wordId, addDays(day, intervals[0])])
}

export function nextSpellingReview(previous, day, independent) {
  const stage = independent ? previous.stage + 1 : 0
  const failureDays = independent ? 0
    : Math.min(255, previous.failure_days + Number(toDateKey(previous.last_check_on) !== day))
  const dueOn = stage < intervals.length ? addDays(day, failureDays >= 3 ? 3 : intervals[stage]) : null
  return { stage, failureDays, dueOn, status: !dueOn ? 'mastered' : failureDays >= 3 ? 'focus' : 'review' }
}

export async function recordSpellingRetest(conn, userId, wordId, day, independent) {
  const [[previous]] = await conn.execute('SELECT * FROM word_spelling_schedule WHERE user_id=? AND word_id=? FOR UPDATE', [userId, wordId])
  if (!previous?.due_on || toDateKey(previous.due_on) > day || toDateKey(previous.last_check_on) === day) {
    throw conflict('这个词的复测日期已更新')
  }
  const next = nextSpellingReview(previous, day, independent)
  await conn.execute(`UPDATE word_spelling_schedule
    SET status=?, due_on=?, stage=?, failure_days=?, last_check_on=?, mastered_at=IF(?='mastered',UTC_TIMESTAMP(3),NULL)
    WHERE user_id=? AND word_id=?`, [next.status, next.dueOn, next.stage, next.failureDays, day, next.status, userId, wordId])
  return { dueOn: next.dueOn, interval: intervals[previous.stage], status: next.status }
}
