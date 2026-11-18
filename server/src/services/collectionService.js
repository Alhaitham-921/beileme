import { query, queryOne } from '../db/pool.js'
import { mapWordRow } from './wordService.js'
import { requireNotebook } from './notebookService.js'

const saved = `(EXISTS (SELECT 1 FROM user_favorite_words f WHERE f.user_id=? AND f.word_id=w.id)
  OR EXISTS (SELECT 1 FROM user_notebook_words n JOIN user_notebooks b ON b.id=n.notebook_id WHERE b.user_id=? AND n.word_id=w.id))`
const wrong = `(COALESCE(p.times_wrong,0)>0 OR EXISTS (SELECT 1 FROM answer_logs a WHERE a.user_id=? AND a.word_id=w.id AND a.result=0)
  OR EXISTS (SELECT 1 FROM collocation_progress cp WHERE cp.user_id=learner.user_id AND cp.word_id=w.id AND cp.times_wrong>0)
  OR EXISTS (SELECT 1 FROM assessment_answers aa WHERE aa.user_id=learner.user_id AND aa.word_id=w.id AND aa.correct=0)
  OR EXISTS (SELECT 1 FROM word_learning_evidence ie WHERE ie.user_id=learner.user_id AND ie.word_id=w.id AND ie.source='image' AND ie.result IN ('incorrect','skipped')))`
const from = 'FROM words w CROSS JOIN (SELECT ? AS user_id) learner LEFT JOIN user_word_progress p ON p.word_id=w.id AND p.user_id=learner.user_id'

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
      (SELECT COUNT(*) FROM answer_logs a WHERE a.user_id=? AND a.word_id=w.id AND a.result=0),
      COALESCE((SELECT SUM(cp.times_wrong) FROM collocation_progress cp WHERE cp.user_id=learner.user_id AND cp.word_id=w.id),0),
      (SELECT COUNT(*) FROM assessment_answers aa WHERE aa.user_id=learner.user_id AND aa.word_id=w.id AND aa.correct=0),
      (SELECT COUNT(*) FROM word_learning_evidence ie WHERE ie.user_id=learner.user_id AND ie.word_id=w.id AND ie.source='image' AND ie.result IN ('incorrect','skipped'))) AS wrong_times,
      GREATEST(COALESCE((SELECT MAX(a.created_at) FROM answer_logs a WHERE a.user_id=? AND a.word_id=w.id AND a.result=0),'1970-01-01'),
        COALESCE((SELECT MAX(ie.occurred_at) FROM word_learning_evidence ie WHERE ie.user_id=learner.user_id AND ie.word_id=w.id AND ie.source='image' AND ie.result IN ('incorrect','skipped')),'1970-01-01'),
        COALESCE((SELECT MAX(cp.last_wrong_at) FROM collocation_progress cp WHERE cp.user_id=learner.user_id AND cp.word_id=w.id),'1970-01-01'),
        COALESCE((SELECT MAX(aa.created_at) FROM assessment_answers aa WHERE aa.user_id=learner.user_id AND aa.word_id=w.id AND aa.correct=0),'1970-01-01'),
        COALESCE(p.last_review_at,p.first_learned_at,'1970-01-01')) AS last_wrong_at,
      COALESCE((SELECT SUM(cp.times_wrong) FROM collocation_progress cp WHERE cp.user_id=learner.user_id AND cp.word_id=w.id),0) AS collocation_wrong_times,
      (SELECT COUNT(*) FROM word_learning_evidence ie WHERE ie.user_id=learner.user_id AND ie.word_id=w.id AND ie.source='image' AND ie.result IN ('incorrect','skipped')) AS image_wrong_times,
      ${saved} AS saved
      ${from} WHERE ${where.sql}
      ORDER BY ${options.source === 'mistakes' ? 'last_wrong_at DESC,' : ''} w.id DESC LIMIT ${size} OFFSET ${offset}`,
    [userId, userId, userId, userId, userId, ...where.params]),
  ])
  return { items: rows.map(row => ({ ...mapWordRow(row), saved: Boolean(row.saved), wrongTimes: Number(row.wrong_times),
    collocationWrongTimes: Number(row.collocation_wrong_times), imageWrongTimes: Number(row.image_wrong_times), lastWrongAt: row.last_wrong_at })),
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
