import { query, queryOne, withTransaction } from '../db/pool.js'
import { collectionWordIds } from './collectionService.js'
import { mapWordRow } from './wordService.js'
import { badRequest, notFound, conflict } from '../utils/errors.js'
import { parseJson } from '../utils/json.js'
import { todayKey } from '../utils/time.js'
import { countRecallAttempt, reserveSpelling, scheduleFirstSpelling, spellingCandidates } from './spellingSchedule.js'
import { recallDue } from './wordRecallService.js'
import { newSpellingState, applySpellingAction, spellingPresentation } from '../../../shared/spelling.js'

export async function getSpelling(userId, id) {
  const row = await queryOne('SELECT * FROM word_spelling_sessions WHERE id=? AND user_id=?', [id, userId])
  if (!row) throw notFound('这组拼写练习不存在')
  return spellingPresentation(row)
}
export async function spellingOverview(userId) {
  const columns = `id,updated_at,completed_at,JSON_LENGTH(JSON_EXTRACT(state,'$.words')) AS total,
    JSON_LENGTH(JSON_EXTRACT(state,'$.results')) AS completed,JSON_EXTRACT(state,'$.group') AS group_index`
  const [active, recent] = await Promise.all([
    query(`SELECT ${columns} FROM word_spelling_sessions WHERE user_id=? AND completed_at IS NULL
      ORDER BY JSON_EXTRACT(state,'$.scheduled') DESC, id DESC`, [userId]),
    query(`SELECT ${columns}, (SELECT COUNT(*) FROM word_spelling_results r
      WHERE r.session_id=s.id AND r.first_result='independent') AS independent
      FROM word_spelling_sessions s WHERE user_id=? AND completed_at IS NOT NULL ORDER BY id DESC LIMIT 4`, [userId]),
  ])
  const summary = row => ({ id: Number(row.id), total: Number(row.total), completed: Number(row.completed),
    group: Number(row.group_index) + 1, updatedAt: row.completed_at || row.updated_at,
    ...(row.independent != null && { independent: Number(row.independent) }) })
  return { active: active.map(summary), recent: recent.map(summary) }
}
export async function createSpelling(userId, { wordIds, requestKey, scheduled = false }) {
  const existing = await queryOne('SELECT * FROM word_spelling_sessions WHERE user_id=? AND request_key=?', [userId, requestKey])
  if (existing) return spellingPresentation(existing)
  const ids = [...new Set(wordIds)]
  if (!ids.length) throw badRequest('请先在错题本勾选单词')
  if (!scheduled) {
    const allowed = new Set(await collectionWordIds(userId, { source: 'mistakes' }))
    if (ids.some(id => !allowed.has(id))) throw badRequest('所选词中包含不属于当前账号错题本的单词，请重新选择')
  }
  const rows = await query(`SELECT * FROM words WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
  const byId = new Map(rows.map(row => { const w = mapWordRow(row); return [w.id, { id: w.id, spelling: w.spelling, pos: w.pos, meaning: w.definitions.join('；'), example: w.examples?.[0] || '' }] }))
  if (byId.size !== ids.length) throw badRequest('部分单词已不可用，请刷新后重新选择')
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[replay]] = await conn.execute('SELECT * FROM word_spelling_sessions WHERE user_id=? AND request_key=?', [userId, requestKey])
    if (replay) return spellingPresentation(replay)
    const state = newSpellingState(ids.map(id => byId.get(id)))
    if (scheduled) {
      const [[active]] = await conn.execute(`SELECT * FROM word_spelling_sessions WHERE user_id=? AND completed_at IS NULL
        ORDER BY JSON_EXTRACT(state,'$.scheduled') DESC, id DESC LIMIT 1`, [userId])
      if (active) return spellingPresentation(active)
      const day = todayKey()
      const [[recallActive]] = await conn.execute('SELECT id FROM word_recall_sessions WHERE user_id=? AND completed_at IS NULL LIMIT 1', [userId])
      if (recallActive || (await recallDue(conn, userId, day)).due) throw conflict('请先完成到期复测')
      const { candidates } = await spellingCandidates(conn, userId, day)
      if (ids.some(id => !candidates.some(word => word.id === id))) throw conflict('今日待练词已更新，请重新选词')
      await reserveSpelling(conn, userId, day, ids.length)
      state.scheduled = true
    }
    const [saved] = await conn.execute('INSERT INTO word_spelling_sessions (user_id,request_key,state) VALUES (?,?,?)', [userId, requestKey, JSON.stringify(state)])
    return spellingPresentation({ id: saved.insertId, revision: 0, state })
  })
}
export async function actSpelling(userId, id, input) {
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[row]] = await conn.execute('SELECT * FROM word_spelling_sessions WHERE id=? AND user_id=? FOR UPDATE', [id, userId])
    if (!row) throw notFound('这组拼写练习不存在')
    const state = parseJson(row.state, {})
    if (state.receipts.includes(input.requestKey)) return spellingPresentation(row)
    if (row.revision !== input.revision) throw conflict('进度已在其他页面更新，请重新读取后继续')
    try { applySpellingAction(state, input) } catch (error) { throw badRequest(error.message) }
    state.receipts = [...state.receipts, input.requestKey].slice(-100)
    const entry = state.results[input.wordId]
    if (['answer', 'skip'].includes(input.action) && entry) {
      if (state.scheduled) {
        const day = todayKey()
        await countRecallAttempt(conn, userId, day)
        if (state.phase === 'first') await scheduleFirstSpelling(conn, userId, input.wordId, day)
      }
      await conn.execute(`INSERT INTO word_spelling_results (session_id,word_id,first_result,first_errors,retry_result,retry_errors,duration_ms)
        VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE retry_result=VALUES(retry_result),retry_errors=VALUES(retry_errors),duration_ms=VALUES(duration_ms)`,
      [id, input.wordId, entry.first.result, entry.first.errorCount, entry.retry?.result || null, entry.retry?.errorCount || 0, entry.first.durationMs + (entry.retry?.durationMs || 0)])
    }
    await conn.execute('UPDATE word_spelling_sessions SET state=?,revision=revision+1,completed_at=IF(?,UTC_TIMESTAMP(),NULL) WHERE id=? AND user_id=?', [JSON.stringify(state), state.stage === 'finished', id, userId])
    return spellingPresentation({ ...row, revision: row.revision + 1, state })
  })
}
