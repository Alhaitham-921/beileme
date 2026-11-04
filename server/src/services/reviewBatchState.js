import { queryOne } from '../db/pool.js'
import { notFound } from '../utils/errors.js'

export async function reviewBatchState(userId, id) {
  const row = await queryOne(`SELECT b.id,b.total_count,b.next_offset,b.active_session_id,
    COALESCE(s.answered_count,0) answered_count,COALESCE(s.planned_count,0) planned_count,s.status
    FROM collection_review_batches b LEFT JOIN study_sessions s ON s.id=b.active_session_id
    WHERE b.id=? AND b.user_id=?`, [id, userId])
  if (!row) throw notFound('复习任务不存在')
  const totalCount = Number(row.total_count)
  const completedCount = Math.max(0, Math.min(totalCount, Number(row.next_offset) - Number(row.planned_count) + Number(row.answered_count)))
  return { id: Number(row.id), sessionId: Number(row.active_session_id), totalCount, completedCount,
    remainingCount: totalCount - completedCount, pendingCount: totalCount - Number(row.next_offset),
    hasMore: Number(row.next_offset) < totalCount, complete: completedCount === totalCount && row.status === 'finished' }
}
