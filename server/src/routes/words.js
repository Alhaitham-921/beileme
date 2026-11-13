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
import { getWordLearningCard } from '../services/wordLearningService.js'
import { lookupInput, lookupInWordbooks, lookupWithAi } from '../services/wordLookupService.js'
import {
  getWordMemoryImage, listWordMemoryImages, readWordMemoryImage, startWordMemoryImage,
  getRecallExampleReplacement, listRecallExampleReplacements, readRecallExampleReplacement, startRecallExampleReplacement,
} from '../services/wordMemoryImageService.js'
import { buildConfusableCard } from '../services/studyService.js'

import { listCollectionWords, collectionWordIds } from '../services/collectionService.js'
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

const collectionQuery = z.object({
  source: z.enum(['favorites','notebook','mistakes','all']).default('favorites'),
  notebookId: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(50),
})
router.get('/collections', requireAuth, validate({query:collectionQuery}), asyncHandler(async(req,res) =>
  ok(res, await listCollectionWords(req.user.id, req.valid.query))))
router.get('/collections/ids', requireAuth, validate({query:collectionQuery}), asyncHandler(async(req,res) =>
  ok(res, {wordIds:await collectionWordIds(req.user.id, req.valid.query)})))

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

router.get('/lookup', requireAuth, validate({ query: lookupInput }), asyncHandler(async (req, res) => {
  return ok(res, await lookupInWordbooks(req.valid.query.q))
}))
router.post('/lookup/ai', requireAuth, validate({ body: lookupInput }), asyncHandler(async (req, res) => {
  return ok(res, await lookupWithAi(req.user.id, req.valid.body.q))
}))

router.get('/memory-images', requireAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const [items, replacements] = await Promise.all([
    listWordMemoryImages(req.user.id), listRecallExampleReplacements(req.user.id),
  ])
  return ok(res, { items, replacements })
}))

const imageKey = z.string().regex(/^[0-9a-f]{64}$/)
const exampleParam = z.object({ exampleKey: z.string().regex(/^example-\d{1,5}$/) })
const learnerCue = z.string().trim().min(1).max(300).optional()
router.get('/memory-images/examples/:exampleKey', requireAuth, validate({ params: exampleParam }),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    return ok(res, await getRecallExampleReplacement(req.user.id, req.valid.params.exampleKey))
  }))
router.post('/memory-images/examples/:exampleKey', requireAuth, validate({ params: exampleParam, body: z.object({ learnerCue }) }),
  asyncHandler(async (req, res) => ok(res,
    await startRecallExampleReplacement(req.user.id, req.valid.params.exampleKey, req.valid.body.learnerCue))))
router.get('/memory-images/examples/:exampleKey/:revision', requireAuth, validate({ params: exampleParam.extend({ revision: imageKey }) }),
  asyncHandler(async (req, res) => {
    const { exampleKey, revision } = req.valid.params
    const image = await readRecallExampleReplacement(req.user.id, exampleKey, revision)
    res.vary('Authorization')
    res.set('Cache-Control', 'private, max-age=3600')
    return res.type('image/webp').send(image)
  }))

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

// Free dictionary reads never call AI; generation requires the separate explicit content action.
router.get('/:id/learning-card', requireAuth, validate({ params: wordIdParam, query: z.object({ local: z.literal('1').optional() }) }),
  asyncHandler(async (req,res) => ok(res, { card: await getWordLearningCard(req.user.id, req.valid.params.id, { localOnly: req.valid.query.local === '1' }) })))

const memorySense = z.string().min(1).max(1000)
router.get('/:id/memory-image/:senseHash/:revision{/:variant}', requireAuth, validate({ params: wordIdParam.extend({
  senseHash: imageKey, revision: imageKey, variant: z.literal('tile').optional(),
}) }), asyncHandler(async (req, res) => {
  const { id, senseHash, revision, variant } = req.valid.params
  const image = await readWordMemoryImage(req.user.id, id, senseHash, revision, variant === 'tile')
  res.vary('Authorization')
  res.set('Cache-Control', 'private, max-age=3600')
  return res.type('image/webp').send(image)
}))
router.get('/:id/memory-image', requireAuth, validate({ params: wordIdParam, query: z.object({ sense: memorySense.optional() }) }),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    return ok(res, await getWordMemoryImage(req.user.id, req.valid.params.id, req.valid.query.sense))
  }))
router.post('/:id/memory-image', requireAuth, validate({ params: wordIdParam, body: z.object({
  sense: memorySense, sessionId: z.number().int().positive().optional(), regenerate: z.boolean().optional(), learnerCue,
}) }), asyncHandler(async (req, res) => {
  const { sense, sessionId, regenerate, learnerCue } = req.valid.body
  return ok(res, await startWordMemoryImage(req.user.id, req.valid.params.id, sense, { sessionId, regenerate, learnerCue }))
}))

export default router
