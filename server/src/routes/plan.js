import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok } from '../utils/http.js'
import {
  getOrCreateDailyPlan,
  getAdjustmentPrompt,
  adjustPlan,
  getCalendar,
  markArticleDone,
  markGameDone,
  ADJUST_REASONS,
} from '../services/planService.js'

const router = Router()

router.use(requireAuth)

const calendarQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
})

/** GET /api/v1/plan/today —— 今日 Todo（新词 / 复习 / 可选任务） */
router.get(
  '/today',
  asyncHandler(async (req, res) => {
    const plan = await getOrCreateDailyPlan(req.user.id)
    return ok(res, {
      plan,
      tasks: {
        newWords: { target: plan.newTarget, done: plan.newDone },
        reviewWords: { target: plan.reviewTarget, done: plan.reviewDone },
        articleOptional: plan.articleOptional,
        articleDone: plan.articleDone,
        gameOptional: plan.gameOptional,
        gameDone: plan.gameDone,
      },
    })
  })
)

/**
 * GET /api/v1/plan/today/prompt
 * 前一天未完成时的自适应难度调节询问（PRD 4.6.1），最多每 2 天触发一次
 */
router.get(
  '/today/prompt',
  asyncHandler(async (req, res) => {
    return ok(res, await getAdjustmentPrompt(req.user.id))
  })
)

/** POST /api/v1/plan/adjust —— 应用难度 / 量的调整 */
router.post(
  '/adjust',
  validate({ body: z.object({ reason: z.enum(ADJUST_REASONS) }) }),
  asyncHandler(async (req, res) => {
    const result = await adjustPlan(req.user.id, req.valid.body.reason)
    return ok(res, result)
  })
)

/** GET /api/v1/plan/calendar —— 打卡日历（PRD 4.6.2） */
router.get(
  '/calendar',
  validate({ query: calendarQuery }),
  asyncHandler(async (req, res) => {
    const items = await getCalendar(req.user.id, {
      from: req.query.from,
      to: req.query.to,
    })
    return ok(res, { items })
  })
)

/** POST /api/v1/plan/today/article —— 标记可选巩固短文任务完成 */
router.post(
  '/today/article',
  validate({ body: z.object({ done: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    const plan = await markArticleDone(req.user.id, undefined, req.valid.body.done !== false)
    return ok(res, { plan })
  })
)

/** POST /api/v1/plan/today/game —— 标记可选小游戏任务完成 */
router.post(
  '/today/game',
  validate({ body: z.object({ done: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    const plan = await markGameDone(req.user.id, undefined, req.valid.body.done !== false)
    return ok(res, { plan })
  })
)

export default router
