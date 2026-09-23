import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok } from '../utils/http.js'
import {
  getOverview,
  getTrend,
  getStrengthDistribution,
  getErrorDistribution,
  getWeakSummary,
  getHourlyActivity,
} from '../services/statsService.js'
import { listBadgeCatalog, listUserBadges } from '../services/badgeService.js'
import { generateWeakSummary } from '../services/ai/contentService.js'

const router = Router()

router.use(requireAuth)

const daysQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
})

/** GET /api/v1/stats/overview —— 看板总览 */
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    return ok(res, await getOverview(req.user.id))
  })
)

/** GET /api/v1/stats/trend —— 近 N 天正确率趋势 */
router.get(
  '/trend',
  validate({ query: daysQuery }),
  asyncHandler(async (req, res) => {
    return ok(res, { items: await getTrend(req.user.id, { days: Number(req.query.days) || 7 }) })
  })
)

/** GET /api/v1/stats/strength —— 记忆强度分布 */
router.get(
  '/strength',
  asyncHandler(async (req, res) => {
    const distribution = await getStrengthDistribution(req.user.id)
    return ok(res, {
      distribution,
      total: Object.values(distribution).reduce((sum, value) => sum + value, 0),
    })
  })
)

/** GET /api/v1/stats/errors —— 错因分布（饼图数据源） */
router.get(
  '/errors',
  validate({ query: daysQuery }),
  asyncHandler(async (req, res) => {
    return ok(res, await getErrorDistribution(req.user.id, { days: Number(req.query.days) || 30 }))
  })
)

/**
 * GET /api/v1/stats/weak-summary
 * 本周薄弱点小结。默认用规则生成，加 ?ai=1 时尝试调用 AI 润色表述（PRD 4.3.3）。
 *
 * AI 不可用（未配置 Key、额度用尽、调用失败）时降级为规则版结论而不是直接报错，
 * 保证「背词主链路始终可用」（PRD 4.3.6 第 3 条）。
 */
router.get(
  '/weak-summary',
  validate({
    query: daysQuery.extend({ ai: z.coerce.boolean().optional() }),
  }),
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 7
    const ruleBased = await getWeakSummary(req.user.id, { days })

    if (!req.query.ai) {
      return ok(res, { ...ruleBased, ai: null, aiUnavailableReason: null })
    }

    try {
      const result = await generateWeakSummary(req.user.id, { days })
      return ok(res, {
        ...ruleBased,
        ai: result.content
          ? {
              headline: result.content.title,
              observations: result.content.meta?.observations || [],
              suggestions: result.content.meta?.suggestions || [],
              cached: result.cached,
              model: result.content.model,
            }
          : null,
        aiSource: result.source,
        aiUnavailableReason: result.content ? null : (result.reason || 'no_content'),
        aiMessage: result.message || null,
        usage: result.usage || null,
      })
    } catch (error) {
      // generateWeakSummary 内部已对 AI 失败做过降级，走到这里一般是统计或数据库问题
      return ok(res, {
        ...ruleBased,
        ai: null,
        aiSource: 'template',
        aiUnavailableReason: 'ai_error',
        aiMessage: error.message,
      })
    }
  })
)

/** GET /api/v1/stats/hourly —— 活跃时段分布 */
router.get(
  '/hourly',
  validate({ query: daysQuery }),
  asyncHandler(async (req, res) => {
    return ok(res, { items: await getHourlyActivity(req.user.id, { days: Number(req.query.days) || 7 }) })
  })
)

/** GET /api/v1/stats/badges —— 徽章墙（PRD 4.6.2） */
router.get(
  '/badges',
  asyncHandler(async (req, res) => {
    const [catalog, unlocked] = await Promise.all([
      listBadgeCatalog(),
      listUserBadges(req.user.id),
    ])
    const unlockedCodes = new Set(unlocked.map((item) => item.code))
    return ok(res, {
      unlocked,
      catalog: catalog.map((badge) => ({
        ...badge,
        unlocked: unlockedCodes.has(badge.code),
      })),
    })
  })
)

export default router
