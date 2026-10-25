import { Router, json } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok } from '../utils/http.js'
import { speechService, speechJsonBodyLimit } from '../services/speech.js'

export function createSpeechRouter({ authenticate = requireAuth, service = speechService } = {}) {
  const router = Router()
  router.use(authenticate)
  router.get('/status', (req, res) => ok(res, service.status(req.user.id)))
  router.post('/transcribe', json({ limit: speechJsonBodyLimit() }), asyncHandler(async (req, res) => {
    const controller = new AbortController()
    const abort = () => { if (!res.writableEnded) controller.abort() }
    res.on('close', abort)
    try {
      const result = await service.transcribe(req.user.id, req.body, { signal: controller.signal })
      if (!res.destroyed) ok(res, result)
    } finally {
      res.off('close', abort)
    }
  }))
  return router
}

export default createSpeechRouter()
