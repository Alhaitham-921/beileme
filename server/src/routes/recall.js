import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler, ok } from '../utils/http.js'
import { recallStatus, startRecall, recallHint, answerRecall } from '../services/wordRecallService.js'

const router = Router()
const params = z.object({ id: z.coerce.number().int().positive() })
const item = z.object({ wordId: z.number().int().positive() })
router.use(requireAuth)
router.get('/', asyncHandler(async (req, res) => ok(res, await recallStatus(req.user.id))))
router.post('/', validate({ body: z.object({ mode: z.enum(['practice', 'retest']) }) }),
  asyncHandler(async (req, res) => ok(res, { session: await startRecall(req.user.id, req.valid.body.mode) })))
router.post('/:id/hint', validate({ params, body: item }), asyncHandler(async (req, res) =>
  ok(res, await recallHint(req.user.id, req.valid.params.id, req.valid.body.wordId))))
router.post('/:id/answers', validate({ params, body: item.extend({ answer: z.string().max(100) }) }),
  asyncHandler(async (req, res) => ok(res, await answerRecall(req.user.id, req.valid.params.id, req.valid.body.wordId, req.valid.body.answer))))
export default router
