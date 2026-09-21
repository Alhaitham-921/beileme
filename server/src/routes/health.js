import { Router } from 'express'
import { asyncHandler, ok } from '../utils/http.js'
import { queryOne } from '../db/pool.js'
import { getProviderStatus } from '../services/ai/contentService.js'

const router = Router()

/** GET /api/v1/health —— 存活与依赖状态探测 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    let database = { status: 'ok' }
    try {
      await queryOne('SELECT 1 AS ok')
    } catch (error) {
      database = { status: 'error', message: error.message }
    }

    const healthy = database.status === 'ok'
    return ok(
      res,
      {
        status: healthy ? 'ok' : 'degraded',
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date(),
        database,
        ai: getProviderStatus(),
      },
      healthy ? 200 : 503
    )
  })
)

export default router
