import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok } from '../utils/http.js'
import {
  getProfile,
  updateProfile,
  completeOnboarding,
  GOALS,
  DAILY_TIMES,
  SELF_LEVELS,
  MEMORY_PREFS,
} from '../services/profileService.js'
import { resolveWordbookForGoal, listWordbooks } from '../services/wordService.js'
import { getOrCreateDailyPlan } from '../services/planService.js'
import { queryOne } from '../db/pool.js'

const router = Router()

router.use(requireAuth)

const profileSchema = z.object({
  goal: z.enum(GOALS).optional(),
  examDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .nullable()
    .optional(),
  selfLevel: z.enum(SELF_LEVELS).optional(),
  dailyTime: z.enum(DAILY_TIMES).optional(),
  newPerDay: z.number().int().min(1).max(100).optional(),
  reviewPerDay: z.number().int().min(0).max(500).optional(),
  memoryPrefs: z.array(z.enum(MEMORY_PREFS)).max(MEMORY_PREFS.length).optional(),
  topicWeights: z.record(z.string(), z.number().min(0.1).max(3)).optional(),
  needsWriting: z.boolean().optional(),
})

const onboardingSchema = z.object({
  goal: z.enum(GOALS),
  examDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .nullable()
    .optional(),
  dailyTime: z.enum(DAILY_TIMES),
  selfLevel: z.enum(SELF_LEVELS).optional(),
  memoryPrefs: z.array(z.enum(MEMORY_PREFS)).optional(),
  needsWriting: z.boolean().optional(),
})

// GET /api/v1/profile
router.get(
  '/',
  asyncHandler(async (req, res) => {
    return ok(res, { profile: await getProfile(req.user.id) })
  })
)

// PUT /api/v1/profile
router.put(
  '/',
  validate({ body: profileSchema }),
  asyncHandler(async (req, res) => {
    const profile = await updateProfile(req.user.id, req.valid.body)
    return ok(res, { profile })
  })
)

/**
 * POST /api/v1/profile/onboarding
 * 完成新用户引导：写入画像 + 按剩余天数算出每日新词量 + 生成当日 Todo（PRD 4.1 / 4.6）
 */
router.post(
  '/onboarding',
  validate({ body: onboardingSchema }),
  asyncHandler(async (req, res) => {
    // 按学习目标选词书：四级 → CET4，考研 → 考研词表，以此类推
    const wordbook = await resolveWordbookForGoal(req.user.id, req.valid.body.goal)
    const learnedRow = await queryOne(
      'SELECT COUNT(*) AS total FROM user_word_progress WHERE user_id = ?',
      [req.user.id]
    )

    const result = await completeOnboarding(req.user.id, req.valid.body, {
      wordbookTotal: wordbook.wordCount,
      learnedCount: Number(learnedRow?.total || 0),
      wordbookId: wordbook.id,
    })

    const plan = await getOrCreateDailyPlan(req.user.id)

    return ok(res, {
      profile: result.profile,
      newPerDay: result.newPerDay,
      wordbook,
      plan,
    })
  })
)

// GET /api/v1/profile/wordbooks —— 可选词书列表（供引导页与设置页展示）
router.get(
  '/wordbooks',
  asyncHandler(async (_req, res) => {
    return ok(res, { items: await listWordbooks() })
  })
)

export default router
