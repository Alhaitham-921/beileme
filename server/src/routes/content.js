import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok, created, paginated, readPagination } from '../utils/http.js'
import {
  CONTENT_TYPES,
  generateArticle,
  generateQuiz,
  generateErrorCard,
  generateWeakSummary,
  listContents,
  getContent,
  getUsage,
  getProviderStatus,
} from '../services/ai/contentService.js'
import { MAX_SESSION_SIZE } from '../services/studyService.js'

const router = Router()

router.use(requireAuth)

const listQuery = z.object({
  type: z.enum(CONTENT_TYPES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce.number().int().min(1).max(50).optional(),
})

const articleSchema = z.object({
  wordIds: z.array(z.coerce.number().int().positive()).max(MAX_SESSION_SIZE).optional(),
  wordCount: z.coerce.number().int().min(4).max(15).optional(),
  topic: z.string().max(64).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  minWords: z.coerce.number().int().min(80).max(400).optional(),
  maxWords: z.coerce.number().int().min(100).max(500).optional(),
  forceNew: z.boolean().optional(),
})

const quizSchema = z.object({
  articleId: z.coerce.number().int().positive(),
  count: z.coerce.number().int().min(3).max(5).optional(),
  forceNew: z.boolean().optional(),
})

const errorCardSchema = z.object({
  wordId: z.coerce.number().int().positive(),
  forceNew: z.boolean().optional(),
})

const idParam = z.object({ id: z.coerce.number().int().positive() })

/** GET /api/v1/content/quota —— 今日 AI 额度与 provider 状态（PRD 4.3.6） */
router.get(
  '/quota',
  asyncHandler(async (req, res) => {
    return ok(res, { usage: await getUsage(req.user.id), provider: getProviderStatus() })
  })
)

/**
 * POST /api/v1/content/articles
 * 生成个性化巩固短文。命中缓存时不消耗额度（PRD 4.3.6）
 */
router.post(
  '/articles',
  validate({ body: articleSchema }),
  asyncHandler(async (req, res) => {
    const result = await generateArticle(req.user.id, req.valid.body)
    return created(res, result)
  })
)

/** POST /api/v1/content/quizzes —— 基于短文生成阅读理解题 */
router.post(
  '/quizzes',
  validate({ body: quizSchema }),
  asyncHandler(async (req, res) => {
    const result = await generateQuiz(req.user.id, req.valid.body)
    return created(res, result)
  })
)

/** POST /api/v1/content/error-cards —— 易混词对比记忆卡片 */
router.post(
  '/error-cards',
  validate({ body: errorCardSchema }),
  asyncHandler(async (req, res) => {
    const result = await generateErrorCard(req.user.id, req.valid.body)
    return created(res, result)
  })
)

/** POST /api/v1/content/weak-summary —— AI 版本周薄弱点小结 */
router.post(
  '/weak-summary',
  validate({ body: z.object({ days: z.coerce.number().int().min(1).max(60).optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await generateWeakSummary(req.user.id, { days: req.valid.body.days || 7 })
    return created(res, result)
  })
)

/** GET /api/v1/content —— 历史生成记录（不含正文） */
router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { page, size } = readPagination(req.query, { defaultSize: 10 })
    const { items, total } = await listContents(req.user.id, {
      type: req.query.type,
      page,
      size,
    })
    return paginated(res, items, { page, size, total })
  })
)

/** GET /api/v1/content/:id —— 取单条生成内容的完整正文 */
router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    return ok(res, { content: await getContent(req.user.id, req.valid.params.id) })
  })
)

export default router
