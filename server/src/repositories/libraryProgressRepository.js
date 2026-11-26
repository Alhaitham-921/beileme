import { queryOne,execute,withTransaction } from '../db/pool.js'
export function findLibraryProgress(userId,kind,id) {
  return queryOne('SELECT position FROM library_progress WHERE user_id=? AND kind=? AND content_id=?',[userId,kind,id])
}
export function saveLibraryProgress(userId,kind,id,progress) {
  return execute(`INSERT INTO library_progress(user_id,kind,content_id,position) VALUES (?,?,?,?)
    ON DUPLICATE KEY UPDATE position=VALUES(position),updated_at=UTC_TIMESTAMP(3)`,[userId,kind,id,JSON.stringify(progress)])
}
export function recordListeningAttempt(userId,id,progress) {
  return withTransaction(async conn=>{
    const [saved]=await conn.execute(`INSERT INTO library_listening_attempts
      (user_id,content_id,answers,transcript_shown,correct_count,total) VALUES (?,?,?,?,?,?)`,
    [userId,id,JSON.stringify(progress.answers),progress.transcriptShown,progress.correct,progress.total])
    await conn.execute(`INSERT INTO library_progress(user_id,kind,content_id,position) VALUES (?,'listening',?,?)
      ON DUPLICATE KEY UPDATE position=VALUES(position),updated_at=UTC_TIMESTAMP(3)`,[userId,id,JSON.stringify(progress)])
    return Number(saved.insertId)
  })
}
