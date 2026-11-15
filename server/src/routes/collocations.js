import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler, ok } from '../utils/http.js'
import { collocationStatus, startCollocations, answerCollocation } from '../services/collocationService.js'

const router = Router()
const wordId = z.coerce.number().int().positive().optional()
router.use(requireAuth)
router.get('/', validate({ query: z.object({ wordId }) }), asyncHandler(async (req,res) => {
  res.set('Cache-Control','no-store')
  return ok(res, await collocationStatus(req.user.id, req.valid.query.wordId ?? null))
}))
router.post('/sessions', validate({ body: z.object({ wordId, mode: z.enum(['practice','due','mistakes']).default('practice') }) }),
  asyncHandler(async (req,res) => ok(res, await startCollocations(req.user.id, req.valid.body))))
router.post('/sessions/:id/answers', validate({ params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ questionIndex: z.number().int().min(0).max(9), answer: z.string().max(320) }) }),
asyncHandler(async (req,res) => ok(res, { session: await answerCollocation(req.user.id, req.valid.params.id, req.valid.body.questionIndex, req.valid.body.answer) })))
export default router
