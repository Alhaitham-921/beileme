import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok } from '../utils/http.js'
import { ApiError, badRequest } from '../utils/errors.js'

export function createTtsRouter({ authenticate = requireAuth, fetchImpl = fetch } = {}) {
  const router = Router()
  const schema = z.object({ text: z.string().trim().min(1).max(1500), rate: z.number().min(0.5).max(1.5).default(1) })
  const limits = new Map()
  let busy = false
  router.use(authenticate)
  router.post('/synthesize', asyncHandler(async (req, res) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw badRequest('朗读内容需为 1–1500 个字符，语速需为 0.5–1.5。')
    const now = Date.now()
    for (const [key, value] of limits) if (now - value.start >= 60000) limits.delete(key)
    const key = String(req.user.id)
    const usage = limits.get(key) || { start: now, count: 0 }
    if (usage.count >= 20) throw new ApiError(429, 'TTS_RATE_LIMIT', '朗读点击过于频繁，请稍后再试。')
    if (busy) throw new ApiError(429, 'TTS_BUSY', '朗读服务正在处理其他请求，请稍后再试。')
    usage.count += 1
    limits.set(key, usage)
    busy = true
    try {
      const response = await fetchImpl(process.env.KOKORO_URL || 'http://127.0.0.1:3003/synthesize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data), signal: AbortSignal.timeout(90000),
      })
      if (!response.ok) throw new Error('Worker unavailable')
      const result = await response.json()
      if (!result.audioBase64 || result.mimeType !== 'audio/wav') throw new Error('Invalid audio response')
      res.set('Cache-Control', 'no-store')
      ok(res, result)
    } catch {
      throw new ApiError(503, 'TTS_UNAVAILABLE', '本地朗读服务未就绪，请启动 Kokoro 后重试。')
    } finally { busy = false }
  }))
  return router
}
export default createTtsRouter()
