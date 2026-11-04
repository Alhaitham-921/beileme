import { queryOne, withTransaction } from '../db/pool.js'
import { badRequest, notFound } from '../utils/errors.js'
import { parseJson } from '../utils/json.js'
import { validateCollectionSelection } from './collectionService.js'
import { buildSelectedReviewQueue, getSession } from './studyService.js'
import { getOrCreateDailyPlan } from './planService.js'
import { reviewBatchState } from './reviewBatchState.js'

const GROUP_SIZE = 10
async function response(userId, sessionId) {
  return { ...await getSession(userId, sessionId), plan: await getOrCreateDailyPlan(userId) }
}
async function insertGroup(conn, userId, batchId, queue) {
  const [saved] = await conn.execute(`INSERT INTO study_sessions (user_id,kind,status,planned_count,queue,study_options)
    VALUES (?,'extra','active',?,?,?)`, [userId, queue.length, JSON.stringify(queue), JSON.stringify({studyMode:'selected-review',reviewBatchId:batchId})])
  return Number(saved.insertId)
}

export async function createCollectionReview(userId, wordIds) {
  const ids = [...new Set(wordIds.map(Number))]
  if (!ids.length) throw badRequest('请至少选择一个单词')
  const allowed = await validateCollectionSelection(userId, ids)
  if (allowed.length !== ids.length) throw badRequest('部分单词已不在你的单词本或错题本中，请刷新后重新选择')
  const queue = await buildSelectedReviewQueue(userId, ids.slice(0, GROUP_SIZE))
  const sessionId = await withTransaction(async conn => {
    const [saved] = await conn.execute('INSERT INTO collection_review_batches (user_id,word_ids,total_count,next_offset) VALUES (?,?,?,?)',
      [userId, JSON.stringify(ids), ids.length, queue.length])
    const sessionId = await insertGroup(conn, userId, Number(saved.insertId), queue)
    await conn.execute('UPDATE collection_review_batches SET active_session_id=? WHERE id=?', [sessionId, saved.insertId])
    return sessionId
  })
  return response(userId, sessionId)
}

export async function continueCollectionReview(userId, id) {
  const before = await queryOne('SELECT * FROM collection_review_batches WHERE id=? AND user_id=?', [id, userId])
  if (!before) throw notFound('复习任务不存在')
  const current = await queryOne('SELECT status FROM study_sessions WHERE id=? AND user_id=?', [before.active_session_id, userId])
  if (!current) throw notFound('本组复习不存在')
  // Retrying, refreshing or resuming never skips an unfinished group.
  if (current.status !== 'finished' || Number(before.next_offset) >= Number(before.total_count)) return response(userId, Number(before.active_session_id))
  const ids = parseJson(before.word_ids, []).slice(Number(before.next_offset), Number(before.next_offset) + GROUP_SIZE)
  // Prepare options without holding a transaction connection or batch lock.
  const queue = await buildSelectedReviewQueue(userId, ids)
  const sessionId = await withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT * FROM collection_review_batches WHERE id=? AND user_id=? FOR UPDATE', [id, userId])
    const row = rows[0]
    if (!row) throw notFound('复习任务不存在')
    // Concurrent duplicate requests both return the one newly created group.
    if (Number(row.active_session_id) !== Number(before.active_session_id) || Number(row.next_offset) !== Number(before.next_offset)) return Number(row.active_session_id)
    const [sessions] = await conn.execute('SELECT status FROM study_sessions WHERE id=? AND user_id=? FOR UPDATE', [row.active_session_id, userId])
    if (sessions[0]?.status !== 'finished') return Number(row.active_session_id)
    const next = await insertGroup(conn, userId, Number(id), queue)
    await conn.execute('UPDATE collection_review_batches SET active_session_id=?,next_offset=?,updated_at=UTC_TIMESTAMP() WHERE id=?',
      [next, Number(row.next_offset) + queue.length, id])
    return next
  })
  return response(userId, sessionId)
}

export async function activeCollectionReview(userId) {
  const row = await queryOne(`SELECT b.id FROM collection_review_batches b JOIN study_sessions s ON s.id=b.active_session_id
    WHERE b.user_id=? AND (s.status='active' OR b.next_offset<b.total_count) ORDER BY b.updated_at DESC,b.id DESC LIMIT 1`, [userId])
  return row ? reviewBatchState(userId, Number(row.id)) : null
}
