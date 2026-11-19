import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler, ok } from '../utils/http.js'
import { imageRecallStatus, startImageRecall, answerImageRecall } from '../services/imageRecallService.js'
const router = Router()
router.use(requireAuth)
router.get('/', asyncHandler(async (req, res) => ok(res, await imageRecallStatus(req.user.id))))
router.post('/sessions', validate({ body: z.object({ source: z.enum(['examples','personal','spatial','due','mistakes']).default('examples') }).strict() }),
  asyncHandler(async (req, res) => ok(res, await startImageRecall(req.user.id, req.valid.body.source))))
router.post('/sessions/:id/answers', validate({ params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ index: z.number().int().min(0).max(29), selectedKeys: z.array(z.string().min(1).max(512)).max(9), skipped: z.boolean().default(false) }).strict() }),
asyncHandler(async (req, res) => ok(res, await answerImageRecall(req.user.id, req.valid.params.id, req.valid.body.index, req.valid.body.selectedKeys, req.valid.body.skipped))))
export default router
