import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok, paginated, readPagination } from '../utils/http.js'
import {
  listWordbooks,
  getWordbookByCode,
  listWords,
  getWordById,
  getRelatedWords,
  recentLearnedWords,
} from '../services/wordService.js'
import { buildConfusableCard } from '../services/studyService.js'

const router = Router()

const wordIdParam = z.object({ id: z.coerce.number().int().positive() })
const codeParam = z.object({ code: z.string().min(1).max(48) })

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce.number().int().min(1).max(100).optional(),
  freq: z.enum(['high', 'med', 'low']).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
})

// GET /api/v1/words/books
router.get(
  '/books',
  asyncHandler(async (_req, res) => {
    return ok(res, { items: await listWordbooks() })
  })
)

// GET /api/v1/words/books/:code/words
router.get(
  '/books/:code/words',
  validate({ params: codeParam, query: listQuery }),
  asyncHandler(async (req, res) => {
    const book = await getWordbookByCode(req.valid.params.code)
    const { page, size } = readPagination(req.valid.query, { defaultSize: 20 })
    const { items, total } = await listWords({
      wordbookId: book.id,
      page,
      size,
      freq: req.valid.query.freq,
      difficulty: req.valid.query.difficulty,
    })
    return paginated(res, items, { page, size, total })
  })
)

/**
 * GET /api/v1/words/recent
 * 「背了么」图标气泡彩蛋的数据来源（PRD 4.9）：
 * 取用户最近学过的单词与中文释义，纯查询不写学习数据。
 *
 * 注意：必须声明在 /:id 之前，否则 "recent" 会被当成 id 匹配。
 */
// GET /api/v1/words/recent
router.get(
  '/recent',
  requireAuth,
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(30).optional() }) }),
  asyncHandler(async (req, res) => {
    const items = await recentLearnedWords(req.user.id, { limit: req.valid.query.limit || 8 })
    return ok(res, {
      items: items.map((item) => ({
        wordId: item.wordId,
        spelling: item.spelling,
        definitions: item.definitions,
        meaning: item.definitions[0] || '',
        learnedAt: item.learnedAt,
      })),
      empty: items.length === 0,
      emptyHint: items.length === 0 ? '先去背几个单词吧~' : null,
    })
  })
)

// GET /api/v1/words/:id
router.get(
  '/:id',
  validate({ params: wordIdParam }),
  asyncHandler(async (req, res) => {
    return ok(res, { word: await getWordById(req.valid.params.id) })
  })
)

// GET /api/v1/words/:id/related —— 形近词 / 近义词列表
router.get(
  '/:id/related',
  validate({
    params: wordIdParam,
    query: z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const word = await getWordById(req.valid.params.id)
    const items = await getRelatedWords(word.id, { limit: req.valid.query.limit || 6 })
    return ok(res, { word, items })
  })
)

/**
 * GET /api/v1/words/:id/contrast
 * 对比记忆卡片：词形差异高亮 + 语义区别（PRD 4.2.3），纯算法生成不消耗 AI 额度
 */
router.get(
  '/:id/contrast',
  validate({ params: wordIdParam }),
  asyncHandler(async (req, res) => {
    const card = await buildConfusableCard(req.valid.params.id)
    return ok(res, { card })
  })
)

export default router
