import { Router, json } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { isAdmin, requireAdmin } from '../middleware/admin.js'
import { speechSettingsService } from '../services/speechSettings.js'
import { asyncHandler, ok } from '../utils/http.js'
import { speechService, speechJsonBodyLimit } from '../services/speech.js'

export function createSpeechRouter({ authenticate = requireAuth, service = speechService, settingsService = speechSettingsService } = {}) {
  const router = Router()
  router.use(authenticate)
  router.get('/status', asyncHandler(async (req, res) => ok(res, {
    ...await service.status(req.user.id), canManage: isAdmin(req.user),
  })))
  router.get('/admin/settings', requireAdmin, asyncHandler(async (_req, res) => ok(res, await settingsService.publicSettings())))
  router.put('/admin/settings', requireAdmin, asyncHandler(async (req, res) => ok(res, await settingsService.save(req.user.id, req.body))))
  router.post('/admin/test', requireAdmin, asyncHandler(async (req, res) => ok(res, await settingsService.verify(req.body))))
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
