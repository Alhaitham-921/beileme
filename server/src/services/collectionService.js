import { query, queryOne } from '../db/pool.js'
import { mapWordRow } from './wordService.js'
import { requireNotebook } from './notebookService.js'

const saved = `(EXISTS (SELECT 1 FROM user_favorite_words f WHERE f.user_id=? AND f.word_id=w.id)
  OR EXISTS (SELECT 1 FROM user_notebook_words n JOIN user_notebooks b ON b.id=n.notebook_id WHERE b.user_id=? AND n.word_id=w.id))`
const wrong = `(COALESCE(p.times_wrong,0)>0 OR EXISTS (SELECT 1 FROM answer_logs a WHERE a.user_id=? AND a.word_id=w.id AND a.result=0))`
const from = 'FROM words w LEFT JOIN user_word_progress p ON p.word_id=w.id AND p.user_id=?'

export async function hasMistake(userId, wordId) {
  return Boolean(await queryOne(`SELECT w.id ${from} WHERE w.id=? AND ${wrong}`, [userId, wordId, userId]))
}

async function filter(userId, { source = 'favorites', notebookId = 0, q = '' } = {}) {
  let sql, params
  if (source === 'notebook') {
    await requireNotebook(userId, notebookId)
    sql = notebookId === 0
      ? 'EXISTS (SELECT 1 FROM user_favorite_words f WHERE f.user_id=? AND f.word_id=w.id)'
      : 'EXISTS (SELECT 1 FROM user_notebook_words n JOIN user_notebooks b ON b.id=n.notebook_id WHERE b.user_id=? AND n.notebook_id=? AND n.word_id=w.id)'
    params = notebookId === 0 ? [userId] : [userId, notebookId]
  } else if (source === 'mistakes') { sql = wrong; params = [userId] }
  else if (source === 'all') { sql = `(${saved} OR ${wrong})`; params = [userId, userId, userId] }
  else { sql = saved; params = [userId, userId] }
  const term = q.trim()
  if (term) {
    const pattern = '%' + term.replace(/[!%_]/g, '!$&') + '%'
    sql += " AND (w.spelling LIKE ? ESCAPE '!' OR CAST(w.definitions AS CHAR) LIKE ? ESCAPE '!')"
    params.push(pattern, pattern)
  }
  return { sql, params }
}

export async function collectionWordIds(userId, options = {}) {
  const where = await filter(userId, options)
  const rows = await query(`SELECT w.id ${from} WHERE ${where.sql} ORDER BY w.id`, [userId, ...where.params])
  return rows.map(row => Number(row.id))
}

export async function listCollectionWords(userId, { page = 1, size = 50, ...options } = {}) {
  const where = await filter(userId, options)
  const offset = (page - 1) * size
  const [count, rows] = await Promise.all([
    queryOne(`SELECT COUNT(*) total ${from} WHERE ${where.sql}`, [userId, ...where.params]),
    query(`SELECT w.*, GREATEST(COALESCE(p.times_wrong,0),
      (SELECT COUNT(*) FROM answer_logs a WHERE a.user_id=? AND a.word_id=w.id AND a.result=0)) AS wrong_times,
      COALESCE((SELECT MAX(a.created_at) FROM answer_logs a WHERE a.user_id=? AND a.word_id=w.id AND a.result=0),
        p.last_review_at,p.first_learned_at) AS last_wrong_at,
      ${saved} AS saved
      ${from} WHERE ${where.sql}
      ORDER BY ${options.source === 'mistakes' ? 'last_wrong_at DESC,' : ''} w.id DESC LIMIT ${size} OFFSET ${offset}`,
    [userId, userId, userId, userId, userId, ...where.params]),
  ])
  return { items: rows.map(row => ({ ...mapWordRow(row), saved: Boolean(row.saved), wrongTimes: Number(row.wrong_times), lastWrongAt: row.last_wrong_at })),
    page, size, total: Number(count.total), totalPages: Math.ceil(Number(count.total) / size) }
}

export async function validateCollectionSelection(userId, wordIds) {
  const ids = [...new Set(wordIds.map(Number))]
  if (!ids.length) return []
  const rows = await query(`SELECT w.id ${from} WHERE w.id IN (${ids.map(() => '?').join(',')}) AND (${saved} OR ${wrong})`,
    [userId, ...ids, userId, userId, userId])
  const allowed = new Set(rows.map(row => Number(row.id)))
  return ids.filter(id => allowed.has(id))
}
