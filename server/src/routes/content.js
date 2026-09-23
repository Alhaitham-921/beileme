import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok, created, paginated, readPagination } from '../utils/http.js'
import {
  CONTENT_TYPES,
  generateArticle,
  generateQuiz,
  generateErrorCards,
  generateWeakSummary,
  preflightContent,
  listContents,
  getContent,
  getUsage,
  getProviderStatus,
} from '../services/ai/contentService.js'
import { MAX_CARDS_PER_REQUEST } from '../services/ai/promptTemplates.js'
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
  /**
   * 「重新生成并用更大额度」：倍数会乘到该类型的基础额度上。
   * 上限 4 倍，避免用户误操作把单次成本抬得过高。
   */
  boost: z.coerce.number().min(1).max(4).optional(),
})

const quizSchema = z.object({
  articleId: z.coerce.number().int().positive(),
  count: z.coerce.number().int().min(3).max(5).optional(),
  forceNew: z.boolean().optional(),
})

const errorCardSchema = z.object({
  /** 不传则自动取最近错得最多的若干个词 */
  wordIds: z.array(z.coerce.number().int().positive()).max(MAX_CARDS_PER_REQUEST).optional(),
  /** 与 wordIds 二选一，兼容只生成单个词的场景 */
  wordId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_CARDS_PER_REQUEST).optional(),
  forceNew: z.boolean().optional(),
  /** 与短文一致：「重新生成并用更大额度」 */
  boost: z.coerce.number().min(1).max(4).optional(),
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
 * POST /api/v1/content/preflight
 * 生成前预估：本地组装 Prompt 并算 token，**不调用模型**，因此成本为 0。
 * 前端用它实现「点之前先告诉用户这次要花多少、会不会命中缓存」。
 */
router.post(
  '/preflight',
  validate({
    body: z.object({
      type: z.enum(['article', 'error_card']).optional(),
      wordIds: z.array(z.coerce.number().int().positive()).max(MAX_SESSION_SIZE).optional(),
      wordCount: z.coerce.number().int().min(4).max(15).optional(),
      limit: z.coerce.number().int().min(1).max(MAX_CARDS_PER_REQUEST).optional(),
      difficulty: z.coerce.number().int().min(1).max(5).optional(),
      /** 预估「加大额度重新生成」的价格时传这个 */
      boost: z.coerce.number().min(1).max(4).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    return ok(res, await preflightContent(req.user.id, req.valid.body))
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

/**
 * POST /api/v1/content/error-cards
 * 易错词的对比记忆卡片，**批量生成**（一次请求覆盖多个词）。
 *
 * 这是成本控制的关键接口：逐词调用会把 system prompt 与固定开销乘以 N，
 * 合批后无论几个词都只付一次固定成本。不传 wordIds 时默认取最近错得最多的词。
 */
router.post(
  '/error-cards',
  validate({ body: errorCardSchema }),
  asyncHandler(async (req, res) => {
    const body = req.valid.body
    // wordId 是单词场景的便捷写法，统一成数组后交给批量接口
    const wordIds = body.wordIds || (body.wordId ? [body.wordId] : undefined)
    const result = await generateErrorCards(req.user.id, {
      wordIds,
      limit: body.limit,
      forceNew: body.forceNew,
    })
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
