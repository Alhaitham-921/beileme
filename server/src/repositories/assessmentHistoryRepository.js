import { query, queryOne } from '../db/pool.js'

export function findComparableAssessments({ userId, sessionId, until, bookId, methodVersion, questionVersion }) {
  return query(`SELECT id,user_id,state,completed_at FROM assessment_sessions
    WHERE user_id=? AND id<? AND completed_at IS NOT NULL AND completed_at<=?
      AND report_book_id=? AND report_method_version=?
      AND (? IS NULL OR report_question_version IS NULL OR report_question_version=?)
    ORDER BY completed_at DESC,id DESC LIMIT 20`,
  [userId, sessionId, until, bookId, methodVersion, questionVersion || null, questionVersion || null])
}
export function countAssessmentHistory({ userId, sessionId, until, bookId, methodVersion }) {
  return queryOne(`SELECT COUNT(*) AS total,
    SUM(COALESCE(report_book_id,0)<>?) AS otherBook,
    SUM(report_book_id=? AND COALESCE(report_method_version,'')<>?) AS otherVersion
    FROM assessment_sessions WHERE user_id=? AND id<? AND completed_at IS NOT NULL AND completed_at<=?`,
  [bookId, bookId, methodVersion, userId, sessionId, until])
}
