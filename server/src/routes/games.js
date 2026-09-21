import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok, created, paginated, readPagination } from '../utils/http.js'
import { query, execute, queryOne } from '../db/pool.js'
import { toJson, parseJson } from '../utils/json.js'
import { safeLimit, safeOffset } from '../services/wordService.js'
import { markGameDone } from '../services/planService.js'
import { evaluateBadges, unlockBadge } from '../services/badgeService.js'

const router = Router()

router.use(requireAuth)

const GAMES = ['match', 'spell', 'listen', 'chain']

const recordSchema = z.object({
  game: z.enum(GAMES),
  score: z.coerce.number().int().min(0).max(1000000).optional(),
  correctCount: z.coerce.number().int().min(0).max(10000).optional(),
  wrongCount: z.coerce.number().int().min(0).max(10000).optional(),
  durationMs: z.coerce.number().int().min(0).max(3600000).optional(),
  // 逐题明细，用于提取「拼写薄弱」等错因证据（PRD 4.5）
  detail: z
    .array(
      z.object({
        wordId: z.coerce.number().int().positive().optional(),
        correct: z.boolean().optional(),
        wrongPosition: z.coerce.number().int().min(0).optional(),
      })
    )
    .max(200)
    .optional(),
  // 是否把游戏中的拼写错误回写为错因证据
  reportSpellingWeakness: z.boolean().optional(),
})

/**
 * POST /api/v1/games/records
 * 记录一局小游戏结果。游戏本身是纯规则实现、不消耗 AI，
 * 这里只负责落库并回写「拼写薄弱」错因证据（PRD 4.5）。
 */
router.post(
  '/records',
  validate({ body: recordSchema }),
  asyncHandler(async (req, res) => {
    const body = req.valid.body
    const wrongCount = body.wrongCount || 0

    const result = await execute(
      `INSERT INTO game_records (user_id, game, score, correct_count, wrong_count, duration_ms, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        body.game,
        body.score || 0,
        body.correctCount || 0,
        wrongCount,
        body.durationMs || 0,
        body.detail ? toJson(body.detail) : null,
      ]
    )

    // 拼写游戏中反复拼错，作为「拼写薄弱」的补充证据写入错因统计
    let spellingEvidence = 0
    if (body.game === 'spell' && body.reportSpellingWeakness !== false && body.detail?.length) {
      const misspelled = body.detail.filter((item) => item.correct === false && item.wordId)
      for (const item of misspelled) {
        await execute(
          `INSERT INTO user_error_stats (user_id, word_id, error_type, hit_count)
           VALUES (?, ?, 'spelling_weak', 1)
           ON DUPLICATE KEY UPDATE hit_count = hit_count + 1, last_at = NOW()`,
          [req.user.id, item.wordId]
        )
      }
      spellingEvidence = misspelled.length
    }

    // 完成一局游戏即视为完成当日可选游戏任务
    const plan = await markGameDone(req.user.id, undefined, true)

    // 拼词游戏连续 5 次零失误解锁「拼词高手」
    let unlockedBadge = null
    if (body.game === 'spell' && wrongCount === 0) {
      const recent = await query(
        `SELECT wrong_count FROM game_records
          WHERE user_id = ? AND game = 'spell'
          ORDER BY created_at DESC LIMIT 5`,
        [req.user.id]
      )
      if (recent.length === 5 && recent.every((row) => Number(row.wrong_count) === 0)) {
        unlockedBadge = await unlockBadge(req.user.id, 'spell_streak_5')
      }
    }

    return created(res, {
      id: Number(result.insertId),
      spellingEvidence,
      unlockedBadge,
      unlockedBadges: await evaluateBadges(req.user.id),
      plan,
    })
  })
)

/** GET /api/v1/games/records —— 游戏历史战绩 */
router.get(
  '/records',
  validate({
    query: z.object({
      game: z.enum(GAMES).optional(),
      page: z.coerce.number().int().min(1).optional(),
      size: z.coerce.number().int().min(1).max(50).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { page, size } = readPagination(req.query, { defaultSize: 10 })
    const conditions = ['user_id = ?']
    const params = [req.user.id]
    if (req.query.game) {
      conditions.push('game = ?')
      params.push(req.query.game)
    }
    const where = conditions.join(' AND ')

    const totalRow = await queryOne(`SELECT COUNT(*) AS total FROM game_records WHERE ${where}`, params)
    const rows = await query(
      `SELECT * FROM game_records WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ${safeLimit(size, { fallback: 10, max: 50 })}
       OFFSET ${safeOffset((page - 1) * size, { max: 100_000 })}`,
      params
    )

    return paginated(
      res,
      rows.map((row) => ({
        id: Number(row.id),
        game: row.game,
        score: Number(row.score),
        correctCount: Number(row.correct_count),
        wrongCount: Number(row.wrong_count),
        durationMs: Number(row.duration_ms),
        detail: parseJson(row.detail, null),
        createdAt: row.created_at,
      })),
      { page, size, total: Number(totalRow?.total || 0) }
    )
  })
)

/** GET /api/v1/games/summary —— 各游戏的最佳成绩概览 */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT game, COUNT(*) AS plays, MAX(score) AS best_score,
              SUM(correct_count) AS correct, SUM(wrong_count) AS wrong
         FROM game_records WHERE user_id = ?
        GROUP BY game`,
      [req.user.id]
    )
    const byGame = new Map(rows.map((row) => [row.game, row]))
    return ok(res, {
      items: GAMES.map((game) => {
        const row = byGame.get(game)
        return {
          game,
          plays: Number(row?.plays || 0),
          bestScore: Number(row?.best_score || 0),
          correct: Number(row?.correct || 0),
          wrong: Number(row?.wrong || 0),
        }
      }),
    })
  })
)

export default router
