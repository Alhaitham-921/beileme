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
import { PLACEMENT_VERSION, START_LEVELS, advancePlacement, newPlacement, placementForms, trialSuggestion } from '../services/placementService.js'

const router = Router()
router.use(requireAuth)
function present(row, state) {
  const q = state.current
  return { id: Number(row.id), answered: state.answers.length, total: state.total,
    form: state.form || null,
    question: q ? { wordId: q.wordId, spelling: q.spelling, options: q.options, context: q.context || '' } : null,
    result: state.result || null }
}
router.get('/', asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM assessment_sessions WHERE user_id = ? AND JSON_EXTRACT(state,'$.methodVersion') IS NULL ORDER BY id DESC LIMIT 10", [req.user.id])
  return ok(res, { items: rows.map(row => ({ ...present(row, parseJson(row.state, {})), takenAt: row.completed_at })) })
}))
router.post('/', asyncHandler(async (req, res) => {
  const active = await query("SELECT * FROM assessment_sessions WHERE user_id = ? AND completed_at IS NULL AND JSON_EXTRACT(state,'$.methodVersion') IS NULL ORDER BY id DESC LIMIT 1", [req.user.id])
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
const placementRows = `SELECT * FROM assessment_sessions WHERE user_id=?
  AND JSON_UNQUOTE(JSON_EXTRACT(state,'$.methodVersion'))=?
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(state,'$.bookId')) AS UNSIGNED)=?`

router.get('/placement', asyncHandler(async (req, res) => {
  const userId = req.user.id
  const [book, profile] = await Promise.all([resolveWordbookForUser(userId), getProfile(userId)])
  const [rows, suggestion, forms] = await Promise.all([
    query(`${placementRows} ORDER BY id DESC LIMIT 10`, [userId, PLACEMENT_VERSION, book.id]),
    trialSuggestion(userId, profile, book.id),
    placementForms(book),
  ])
  return ok(res, { book, eligible: Boolean(forms), curated: book.code === 'cet4', preference: profile.studyStartLevel, suggestion,
    items: rows.map(row => ({ ...present(row, parseJson(row.state, {})), takenAt: row.completed_at })) })
}))

router.put('/placement/preference', validate({ body: z.object({ level: z.enum(START_LEVELS) }) }),
  asyncHandler(async (req, res) => {
    const { level } = req.valid.body
    await getProfile(req.user.id)
    await execute(`UPDATE user_profiles SET
      study_start_changed_at=IF(study_start_level <=> ?,study_start_changed_at,UTC_TIMESTAMP()),
      study_start_level=? WHERE user_id=?`, [level, level, req.user.id])
    return ok(res, { preference: level })
  }))

router.post('/placement', asyncHandler(async (req, res) => {
  const userId = req.user.id
  const book = await resolveWordbookForUser(userId)
  const forms = await placementForms(book)
  const result = await withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [rows] = await conn.execute(`${placementRows} ORDER BY id DESC LIMIT 1 FOR UPDATE`, [userId, PLACEMENT_VERSION, book.id])
    const latest = rows[0] ? parseJson(rows[0].state, {}) : null
    if (latest && !rows[0].completed_at) return present(rows[0], latest)
    if (!forms) throw badRequest('当前词书暂时无法组成两套分层题，可直接自选学习起点。')
    const form = latest ? (latest.form === 'A' ? 'B' : 'A') : (userId % 2 === 0 ? 'A' : 'B')
    const state = newPlacement(book, form, forms)
    const [saved] = await conn.execute('INSERT INTO assessment_sessions (user_id,state) VALUES (?,?)', [userId, JSON.stringify(state)])
    return present({ id: saved.insertId }, state)
  })
  return ok(res, result)
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
    if (state.methodVersion === PLACEMENT_VERSION) advancePlacement(state)
    else {
      state.band = Math.min(5, Math.max(1, state.current.band + (correct ? 1 : -1)))
      compactPool(state)
      state.current = nextQuestion(state)
      if (!state.current) state.result = summarize(state)
    }
    await conn.execute('UPDATE assessment_sessions SET state = ?, completed_at = IF(?, NOW(), NULL) WHERE id = ?', [JSON.stringify(state), Boolean(state.result), row.id])
    return present(row, state)
  })
  return ok(res, response)
}))
export default router
