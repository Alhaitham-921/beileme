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

import { listNotebooks, createNotebook, notebookWords, allFavorites, setNotebookWord } from '../services/notebookService.js'

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

// Account-owned notebooks; id 0 preserves the original default favorites.
const notebookId = z.coerce.number().int().min(0)
router.get('/notebooks', requireAuth, validate({ query: z.object({ wordId: z.coerce.number().int().positive().optional() }) }), asyncHandler(async (req, res) => {
  return ok(res, { items: await listNotebooks(req.user.id, req.valid.query.wordId) })
}))
router.post('/notebooks', requireAuth, validate({ body: z.object({ name: z.string().trim().min(1).max(40) }) }), asyncHandler(async (req, res) => {
  return ok(res, { notebook: await createNotebook(req.user.id, req.valid.body.name) })
}))
router.get('/notebooks/:bookId/words', requireAuth, validate({ params: z.object({ bookId: notebookId }) }), asyncHandler(async (req, res) => {
  return ok(res, { items: await notebookWords(req.user.id, req.valid.params.bookId) })
}))
router.get('/favorites', requireAuth, asyncHandler(async (req, res) => {
  return ok(res, { items: await allFavorites(req.user.id) })
}))
router.put('/:id/favorite', requireAuth, validate({ params: wordIdParam, body: z.object({ notebookId: notebookId.optional() }).optional() }), asyncHandler(async (req, res) => {
  await setNotebookWord(req.user.id, req.valid.body?.notebookId ?? 0, req.valid.params.id, true)
  return ok(res, { saved: true })
}))
router.delete('/:id/favorite', requireAuth, validate({ params: wordIdParam, query: z.object({ notebookId: notebookId.optional() }) }), asyncHandler(async (req, res) => {
  await setNotebookWord(req.user.id, req.valid.query.notebookId ?? 0, req.valid.params.id, false)
  return ok(res, { saved: false })
}))

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
