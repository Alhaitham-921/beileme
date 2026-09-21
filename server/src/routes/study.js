import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok, created } from '../utils/http.js'
import {
  createSession,
  getSession,
  submitAnswer,
  finishSession,
  getErrorDigest,
} from '../services/studyService.js'
import { getOrCreateDailyPlan } from '../services/planService.js'
import { getRelatedWords } from '../services/wordService.js'

const router = Router()

router.use(requireAuth)

const sessionParam = z.object({ id: z.coerce.number().int().positive() })

const createSessionSchema = z.object({
  kind: z.enum(['daily', 'extra']).optional(),
})

const answerSchema = z
  .object({
    wordId: z.coerce.number().int().positive(),
    optionIndex: z.coerce.number().int().min(0).max(9).optional(),
    // 无固定选项的场景（拼写 / 阅读题）可直接上报结果
    isCorrect: z.boolean().optional(),
    wrongOption: z.string().max(255).optional(),
    hesitationMs: z.coerce.number().int().min(0).max(600000).optional(),
    source: z.enum(['study', 'review', 'game', 'reading']).optional(),
    spellingMistake: z.boolean().optional(),
  })
  .refine((data) => data.optionIndex != null || typeof data.isCorrect === 'boolean', {
    message: '必须提供 optionIndex 或 isCorrect',
    path: ['optionIndex'],
  })

/** POST /api/v1/study/sessions —— 开始一轮学习，返回题目队列 */
router.post(
  '/sessions',
  validate({ body: createSessionSchema }),
  asyncHandler(async (req, res) => {
    const result = await createSession(req.user.id, { kind: req.valid.body.kind || 'daily' })
    return created(res, result)
  })
)

/** GET /api/v1/study/sessions/:id —— 取回会话（刷新后续做同一组题） */
router.get(
  '/sessions/:id',
  validate({ params: sessionParam }),
  asyncHandler(async (req, res) => {
    return ok(res, await getSession(req.user.id, req.valid.params.id))
  })
)

/**
 * POST /api/v1/study/sessions/:id/answers
 * 提交作答：服务端判定对错 → 错因归因 → 更新 SRS → 返回对比卡片与进度
 */
router.post(
  '/sessions/:id/answers',
  validate({ params: sessionParam, body: answerSchema }),
  asyncHandler(async (req, res) => {
    const result = await submitAnswer(req.user.id, req.valid.params.id, req.valid.body)
    return created(res, result)
  })
)

/** POST /api/v1/study/sessions/:id/finish —— 结束会话，返回本轮统计 */
router.post(
  '/sessions/:id/finish',
  validate({ params: sessionParam }),
  asyncHandler(async (req, res) => {
    return ok(res, await finishSession(req.user.id, req.valid.params.id))
  })
)

/** GET /api/v1/study/errors/digest —— 错题/错因汇总，巩固内容生成的素材（PRD 4.3.3） */
router.get(
  '/errors/digest',
  validate({
    query: z.object({
      days: z.coerce.number().int().min(1).max(365).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const digest = await getErrorDigest(req.user.id, {
      days: Number(req.query.days) || 7,
      limit: Number(req.query.limit) || 20,
    })

    // 附带每个错词最容易混淆的对象，便于直接渲染专项巩固入口
    const enriched = []
    for (const item of digest.wrongWords.slice(0, 10)) {
      enriched.push({ ...item, related: await getRelatedWords(item.wordId, { limit: 3 }) })
    }

    return ok(res, { ...digest, wrongWords: enriched, plan: await getOrCreateDailyPlan(req.user.id) })
  })
)

export default router
