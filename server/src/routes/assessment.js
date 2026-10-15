import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler, ok } from '../utils/http.js'
import { query, execute, withTransaction } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { badRequest, notFound, conflict } from '../utils/errors.js'
import { resolveWordbookForUser } from '../services/wordService.js'
import { getProfile } from '../services/profileService.js'
import { nextQuestion, summarize, shuffled, compactPool } from '../services/assessmentEngine.js'

const router = Router()
router.use(requireAuth)
function present(row, state) {
  const q = state.current
  return { id: Number(row.id), answered: state.answers.length, total: state.total,
    question: q ? { wordId: q.wordId, spelling: q.spelling, options: q.options } : null,
    result: state.result || null }
}
router.get('/', asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM assessment_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 10', [req.user.id])
  return ok(res, { items: rows.map(row => ({ ...present(row, parseJson(row.state, {})), takenAt: row.completed_at })) })
}))
router.post('/', asyncHandler(async (req, res) => {
  const active = await query('SELECT * FROM assessment_sessions WHERE user_id = ? AND completed_at IS NULL ORDER BY id DESC LIMIT 1', [req.user.id])
  if (active.length) return ok(res, present(active[0], parseJson(active[0].state, {})))
  const book = await resolveWordbookForUser(req.user.id)
  const profile = await getProfile(req.user.id)
  const rows = await query('SELECT id, spelling, difficulty, definitions FROM words WHERE wordbook_id = ?', [book.id])
  const seen = new Set()
  const pool = shuffled(rows).flatMap(w => {
    const definition = parseJson(w.definitions, [])[0]
    if (!definition || seen.has(w.spelling)) return []
    seen.add(w.spelling)
    return [{ id: Number(w.id), spelling: w.spelling, band: Number(w.difficulty), definition }]
  }).filter(w => w.band >= 1 && w.band <= 5)
  if (pool.length < 30 || new Set(pool.map(w => w.definition)).size < 4) throw badRequest('当前词书题量不足，请先导入至少 30 个带释义的单词')
  const state = { pool, bookName: book.name, populations: {}, answers: [], total: Math.min(35, pool.length), band: ({ '1000 以下': 1, '1000-3000': 2, '3000-6000': 3, '6000 以上': 5 })[profile.selfLevel] || 2 }
  for (const w of pool) state.populations[w.band] = (state.populations[w.band] || 0) + 1
  compactPool(state)
  state.current = nextQuestion(state)
  const saved = await execute('INSERT INTO assessment_sessions (user_id, state) VALUES (?, ?)', [req.user.id, JSON.stringify(state)])
  return ok(res, present({ id: saved.insertId }, state))
}))
router.post('/:id/answers', validate({ body: z.object({ wordId: z.number().int().positive(), selectedIndex: z.number().int().min(-1).max(3), rtMs: z.number().int().min(0).max(3600000) }) }), asyncHandler(async (req, res) => {
  const response = await withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT * FROM assessment_sessions WHERE id = ? AND user_id = ? FOR UPDATE', [req.params.id, req.user.id])
    if (!rows.length) throw notFound('测评不存在')
    const row = rows[0], state = parseJson(row.state, {})
    if (state.result) return present(row, state)
    const answer = req.valid.body
    if (answer.wordId !== state.current.wordId) {
      const previous = state.answers.find(a => a.wordId === answer.wordId)
      if (previous && previous.selectedIndex === answer.selectedIndex) return present(row, state)
      throw conflict('题目已更新，请恢复测评')
    }
    const correct = answer.selectedIndex === state.current.correctIndex
    state.answers.push({ ...answer, band: state.current.band, correct })
    state.band = Math.min(5, Math.max(1, state.current.band + (correct ? 1 : -1)))
    compactPool(state)
    state.current = nextQuestion(state)
    if (!state.current) state.result = summarize(state)
    await conn.execute('UPDATE assessment_sessions SET state = ?, completed_at = IF(?, NOW(), NULL) WHERE id = ?', [JSON.stringify(state), Boolean(state.result), row.id])
    return present(row, state)
  })
  return ok(res, response)
}))
export default router
