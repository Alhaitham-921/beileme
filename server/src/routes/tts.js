import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok } from '../utils/http.js'
import { badRequest } from '../utils/errors.js'
import { createTtsService } from '../services/ttsService.js'

export function createTtsRouter({ authenticate = requireAuth, fetchImpl = fetch, service } = {}) {
  const router = Router()
  const schema = z.object({ text:z.string().trim().min(1).max(1500), rate:z.number().min(0.5).max(1.5).default(1) })
  const application = service || createTtsService({fetchImpl})
  router.use(authenticate)
  router.post('/synthesize', asyncHandler(async(req,res)=>{
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw badRequest('朗读内容需为 1–1500 个字符，语速需为 0.5–1.5。')
    const result = await application.synthesize(req.user.id,parsed.data)
    res.set('Cache-Control','no-store'); ok(res,result)
  }))
  return router
}
export default createTtsRouter()
