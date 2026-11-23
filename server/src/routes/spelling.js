import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler, ok } from '../utils/http.js'
import { createSpelling, spellingOverview, getSpelling, actSpelling } from '../services/spellingService.js'
const router = Router()
router.use(requireAuth)
const params = z.object({ id: z.coerce.number().int().positive().safe() })
router.get('/', asyncHandler(async (req, res) => ok(res, await spellingOverview(req.user.id))))
router.post('/', validate({ body: z.object({ wordIds: z.array(z.number().int().positive().safe()).min(1).max(10000), requestKey: z.string().uuid() }) }), asyncHandler(async (req, res) => ok(res, await createSpelling(req.user.id, req.valid.body), 201)))
router.get('/:id', validate({ params }), asyncHandler(async (req, res) => ok(res, await getSpelling(req.user.id, req.valid.params.id))))
router.post('/:id/actions', validate({ params, body: z.object({ requestKey: z.string().uuid(), revision: z.number().int().nonnegative(),
  action: z.enum(['answer','reveal','skip','next']), wordId: z.number().int().positive().safe().optional(), answer: z.string().max(512).default(''),
  errorCount: z.number().int().min(0).max(100000).default(0), durationMs: z.number().int().min(0).max(86400000).default(0),
}) }), asyncHandler(async (req, res) => ok(res, await actSpelling(req.user.id, req.valid.params.id, req.valid.body))))
export default router
