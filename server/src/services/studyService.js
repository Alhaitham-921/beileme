import { query, queryOne, execute, withTransaction } from '../db/pool.js'
import { parseJson, toJson, clamp } from '../utils/json.js'
import { todayKey } from '../utils/time.js'
import { badRequest, conflict, notFound } from '../utils/errors.js'
import { grade, reviewItem, computeMemoryStrength } from './srs.js'
import { classifyError, CONFUSION_INTERVAL_FACTOR } from './errorAnalysis.js'
import {
  buildOptionsFor,
  getRelatedWords,
  resolveWordbookForUser,
  mapWordRow,
  safeLimit,
  shuffle,
} from './wordService.js'
import {
  addAnswerToPlan,
  getOrCreateDailyPlan,
  listDueWords,
  listFreshWords,
  listLearnedWords,
} from './planService.js'
import { diffSpelling } from './wordRelations.js'
import { evaluateBadges } from './badgeService.js'

/** 「再学一组」的题量与构成 */
export const EXTRA_SESSION_SIZE = 10
/** 单次每日会话的最大题量，防止一次拉取过多 */
export const MAX_SESSION_SIZE = 60

/**
 * 会话行 → 对外结构。
 * 刻意不返回 queue：队列表里带着每个选项的 correct 标记，
 * 一旦下发就等于把答案给了客户端，提交时服务端判定对错也就失去意义。
 */
export function mapSessionRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    kind: row.kind,
    status: row.status,
    plannedCount: Number(row.planned_count ?? 0),
    answeredCount: Number(row.answered_count ?? 0),
    newCount: Number(row.new_count ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    correctCount: Number(row.correct_count ?? 0),
    wrongCount: Number(row.wrong_count ?? 0),
    avgHesitationMs: Number(row.avg_hesitation_ms ?? 0),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

/** 一道题：单词 id + 服务端持有的选项快照 */
function buildQueueItem(wordRow, kind, options) {
  return {
    wordId: Number(wordRow.id),
    kind,
    options: options.map((option, index) => ({
      index,
      text: option.text,
      correct: Boolean(option.correct),
      wordId: option.wordId ?? null,
    })),
    answered: false,
    correct: null,
  }
}

/** 下发给客户端的单词信息 */
function publicWord(row) {
  const word = mapWordRow(row)
  return {
    id: word.id,
    spelling: word.spelling,
    phonetic: word.phonetic,
    pos: word.pos,
    freq: word.freq,
    difficulty: word.difficulty,
    definitions: word.definitions,
    examples: word.examples,
    example: word.example,
  }
}

/** 去掉 correct 标记，答案只留在服务端 */
function publicOptions(options) {
  return options.map((option) => ({ index: option.index, text: option.text }))
}

/** 一次性把队列中的单词查出来，避免逐题查询造成 N+1 */
async function materializeItems(queueItems) {
  if (!queueItems.length) return []

  const ids = [...new Set(queueItems.map((item) => Number(item.wordId)))]
  const placeholders = ids.map(() => '?').join(',')
  const rows = await query(`SELECT * FROM words WHERE id IN (${placeholders})`, ids)
  const byId = new Map(rows.map((row) => [Number(row.id), row]))

  const items = []
  for (const item of queueItems) {
    const row = byId.get(Number(item.wordId))
    if (!row) continue
    items.push({
      wordId: Number(item.wordId),
      kind: item.kind,
      word: publicWord(row),
      options: publicOptions(item.options),
      answered: Boolean(item.answered),
      // 只有作答过的题才带上结果，未作答时不发这个字段：
      // 避免与「选项是否正确」混淆，也让响应在未作答时完全不含答案信息
      ...(item.answered ? { correct: Boolean(item.correct) } : {}),
    })
  }
  return items
}

/**
 * 创建学习会话（PRD 4.2.1 背词交互流程入口）。
 *
 * @param {number} userId
 * @param {{ kind?: 'daily'|'extra' }} options
 */
export async function createSession(userId, { kind = 'daily' } = {}) {
  if (!['daily', 'extra'].includes(kind)) throw badRequest('kind 只能是 daily 或 extra')

  // 按用户的学习目标取对应词书（四级 → CET4，考研 → 考研词表 …）
  const wordbook = await resolveWordbookForUser(userId)
  const plan = await getOrCreateDailyPlan(userId, todayKey())
  const queue = []

  if (kind === 'daily') {
    // 每日计划：先消化到期复习，再按剩余额度引入新词
    const reviewQuota = clamp(plan.reviewTarget - plan.reviewDone, 0, MAX_SESSION_SIZE)
    const newQuota = clamp(plan.newTarget - plan.newDone, 0, MAX_SESSION_SIZE)

    const dueRows = reviewQuota > 0 ? await listDueWords(userId, { limit: reviewQuota }) : []
    for (const row of dueRows) {
      queue.push(buildQueueItem(row, 'review', await buildOptionsFor(mapWordRow(row))))
    }

    const freshRows = newQuota > 0 ? await listFreshWords(userId, wordbook.id, { limit: newQuota }) : []
    for (const row of freshRows) {
      queue.push(buildQueueItem(row, 'new', await buildOptionsFor(mapWordRow(row))))
    }
  } else {
    // 「再学一组」：不受每日计划限制，提前复习 + 补充新词
    const freshRows = await listFreshWords(userId, wordbook.id, { limit: EXTRA_SESSION_SIZE })
    const learnedRows = await listLearnedWords(userId, { limit: EXTRA_SESSION_SIZE })

    const mixed = shuffle([
      ...freshRows.map((row) => ({ row, kind: 'new' })),
      ...learnedRows.map((row) => ({ row, kind: 'review' })),
    ]).slice(0, EXTRA_SESSION_SIZE)

    for (const entry of mixed) {
      queue.push(buildQueueItem(entry.row, entry.kind, await buildOptionsFor(mapWordRow(entry.row))))
    }
  }

  const result = await execute(
    `INSERT INTO study_sessions (user_id, kind, status, planned_count, queue)
     VALUES (?, ?, 'active', ?, ?)`,
    [userId, kind, queue.length, toJson(queue)]
  )

  const session = await queryOne('SELECT * FROM study_sessions WHERE id = ?', [result.insertId])

  return {
    session: mapSessionRow(session),
    plan,
    items: await materializeItems(queue),
  }
}

/** 取回会话（刷新后续做同一组题） */
export async function getSession(userId, sessionId) {
  const session = await queryOne(
    'SELECT * FROM study_sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId]
  )
  if (!session) throw notFound('学习会话不存在')
  // 队列直接从原始行读取：它包含答案标记，不能随会话对象一起下发
  const queue = parseJson(session.queue, [])
  return { session: mapSessionRow(session), items: await materializeItems(queue) }
}

/**
 * 单词对比记忆卡片（PRD 4.2.3）：词形差异高亮 + 语义区别 + 例句对比
 */
export async function buildConfusableCard(wordId) {
  const row = await queryOne('SELECT * FROM words WHERE id = ?', [wordId])
  if (!row) return null
  const word = mapWordRow(row)

  const related = await getRelatedWords(wordId, { limit: 3 })
  if (!related.length) return null

  return {
    word: {
      id: word.id,
      spelling: word.spelling,
      phonetic: word.phonetic,
      pos: word.pos,
      definitions: word.definitions,
      example: word.example,
    },
    contrasts: related.map((item) => ({
      wordId: item.wordId,
      spelling: item.spelling,
      phonetic: item.phonetic,
      pos: item.pos,
      definitions: item.definitions,
      relationType: item.relationType,
      score: item.score,
      // 公共词缀之外的差异段，供前端做词形高亮
      diff: diffSpelling(word.spelling, item.spelling),
      // 语义区别：左右对照展示
      meaningContrast: {
        current: word.definitions.join('；'),
        related: item.definitions.join('；'),
      },
    })),
  }
}

async function findWordByIdWithConn(conn, id) {
  const [rows] = await conn.execute('SELECT * FROM words WHERE id = ?', [id])
  return rows.length ? mapWordRow(rows[0]) : null
}

/** 无选项来源词时的兜底：按中文释义反查（可能命中同义的其他词，属于近似处理） */
async function findWordByDefinitionWithConn(conn, definitionText) {
  const [rows] = await conn.execute(
    'SELECT * FROM words WHERE JSON_CONTAINS(definitions, JSON_QUOTE(?)) LIMIT 1',
    [definitionText]
  )
  return rows.length ? mapWordRow(rows[0]) : null
}

async function confusionHistoryWithConn(conn, userId, wordId) {
  const [rows] = await conn.execute(
    `SELECT COALESCE(SUM(hit_count), 0) AS hits FROM user_error_stats
      WHERE user_id = ? AND word_id = ?
        AND error_type IN ('form_confusion','meaning_confusion','systematic_confusion')`,
    [userId, wordId]
  )
  return Number(rows[0]?.hits || 0)
}

/**
 * 提交一次作答：判定对错 → 归因错因 → 更新 SRS → 写流水 → 更新会话与每日计划。
 * 全部在一个事务内完成，任一步失败都不会留下半更新的进度。
 *
 * @param {number} userId
 * @param {number} sessionId
 * @param {{ wordId:number, optionIndex?:number, isCorrect?:boolean, wrongOption?:string,
 *           hesitationMs?:number, source?:string, spellingMistake?:boolean }} payload
 */
export async function submitAnswer(userId, sessionId, payload = {}) {
  const {
    wordId,
    optionIndex,
    hesitationMs = 0,
    source = 'study',
    spellingMistake = false,
  } = payload

  const outcome = await withTransaction(async (conn) => {
    const [sessionRows] = await conn.execute(
      'SELECT * FROM study_sessions WHERE id = ? AND user_id = ? FOR UPDATE',
      [sessionId, userId]
    )
    if (!sessionRows.length) throw notFound('学习会话不存在')
    const session = sessionRows[0]
    if (session.status === 'finished') throw conflict('该学习会话已结束')

    const queue = parseJson(session.queue, [])
    const itemIndex = queue.findIndex((item) => Number(item.wordId) === Number(wordId))
    if (itemIndex === -1) throw badRequest('该单词不属于当前学习会话')

    const item = queue[itemIndex]
    if (item.answered) throw conflict('该单词本轮已作答，请勿重复提交')

    // ── 由服务端判定对错，客户端只上报所选下标 ──
    let isCorrect
    let wrongOption = null
    let chosenOption = null
    if (optionIndex != null) {
      chosenOption = item.options.find((option) => Number(option.index) === Number(optionIndex))
      if (!chosenOption) throw badRequest('选项下标不合法')
      isCorrect = Boolean(chosenOption.correct)
      if (!isCorrect) wrongOption = chosenOption.text
    } else if (typeof payload.isCorrect === 'boolean') {
      // 拼写 / 阅读题等没有固定选项的场景，允许直接上报结果
      isCorrect = payload.isCorrect
      wrongOption = payload.wrongOption ?? null
    } else {
      throw badRequest('必须提供 optionIndex')
    }

    const now = new Date()
    const hesitation = clamp(Number.parseInt(hesitationMs, 10) || 0, 0, 10 * 60 * 1000)

    const [wordRows] = await conn.execute('SELECT * FROM words WHERE id = ?', [wordId])
    if (!wordRows.length) throw notFound('单词不存在')
    const word = mapWordRow(wordRows[0])

    const [progressRows] = await conn.execute(
      'SELECT * FROM user_word_progress WHERE user_id = ? AND word_id = ? FOR UPDATE',
      [userId, wordId]
    )
    const existing = progressRows.length ? progressRows[0] : null
    const isNewWord = !existing

    // ── 错因归因上下文：看选错的释义是否属于该词的形近/近义词 ──
    let confusion = null
    if (!isCorrect) {
      // 优先用选项里记录的来源词 id：多个词可能共享同一中文释义
      // （例如 accomplish 与 achieve 都含「实现」），按释义文本反查会归错词。
      // 只有没有选项来源时才退化为按释义文本模糊查找。
      const wrongWord =
        chosenOption?.wordId != null
          ? await findWordByIdWithConn(conn, Number(chosenOption.wordId))
          : wrongOption
            ? await findWordByDefinitionWithConn(conn, wrongOption)
            : null

      if (wrongWord && Number(wrongWord.id) !== Number(wordId)) {
        const [relationRows] = await conn.execute(
          `SELECT relation_type, score FROM word_relations
            WHERE word_id = ? AND related_word_id = ?
            ORDER BY score DESC LIMIT 1`,
          [wordId, wrongWord.id]
        )
        if (relationRows.length) {
          confusion = {
            relationType: relationRows[0].relation_type,
            relatedWordId: Number(wrongWord.id),
            relatedSpelling: wrongWord.spelling,
            priorCount: await confusionHistoryWithConn(conn, userId, wordId),
          }
        }
      }
    }

    const analysis = classifyError({
      isCorrect,
      hesitationMs: hesitation,
      spellingMistake,
      confusion,
    })

    // ── SRS 更新：易混词组间隔更短 ──
    const quality = grade(hesitation, isCorrect)
    const priorConfusionHits = await confusionHistoryWithConn(conn, userId, wordId)
    const srs = reviewItem(existing || {}, quality, now.getTime(), {
      confusionFactor: priorConfusionHits > 0 ? CONFUSION_INTERVAL_FACTOR : 1,
      relearnDays: analysis.relearnDays,
    })

    const timesSeen = Number(existing?.times_seen || 0) + 1
    const timesCorrect = Number(existing?.times_correct || 0) + (isCorrect ? 1 : 0)
    const timesWrong = Number(existing?.times_wrong || 0) + (isCorrect ? 0 : 1)
    const streakCorrect = isCorrect ? Number(existing?.streak_correct || 0) + 1 : 0

    const memoryStrength = computeMemoryStrength({
      repetitions: srs.repetitions,
      ef: srs.ef,
      timesSeen,
      timesCorrect,
      lastResult: isCorrect,
      lastHesitationMs: hesitation,
    })

    if (existing) {
      await conn.execute(
        `UPDATE user_word_progress SET
           state = ?, ef = ?, repetitions = ?, interval_days = ?, memory_strength = ?,
           next_review_at = ?, last_review_at = ?, times_seen = ?, times_correct = ?,
           times_wrong = ?, streak_correct = ?, last_result = ?, last_hesitation_ms = ?
         WHERE user_id = ? AND word_id = ?`,
        [
          srs.state, srs.ef, srs.repetitions, srs.intervalDays, memoryStrength,
          srs.nextReviewAt, now, timesSeen, timesCorrect, timesWrong, streakCorrect,
          isCorrect ? 1 : 0, hesitation, userId, wordId,
        ]
      )
    } else {
      await conn.execute(
        `INSERT INTO user_word_progress
           (user_id, word_id, wordbook_id, state, ef, repetitions, interval_days, memory_strength,
            next_review_at, last_review_at, first_learned_at, times_seen, times_correct, times_wrong,
            streak_correct, last_result, last_hesitation_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId, wordId, word.wordbookId, srs.state, srs.ef, srs.repetitions, srs.intervalDays,
          memoryStrength, srs.nextReviewAt, now, now, timesSeen, timesCorrect, timesWrong,
          streakCorrect, isCorrect ? 1 : 0, hesitation,
        ]
      )
    }

    await conn.execute(
      `INSERT INTO answer_logs
         (user_id, word_id, session_id, result, hesitation_ms, quality, is_new_word,
          source, wrong_option, error_type, interval_before, interval_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, wordId, sessionId, isCorrect ? 1 : 0, hesitation, quality, isNewWord ? 1 : 0,
        source, wrongOption, analysis.type, Number(existing?.interval_days || 0), srs.intervalDays,
      ]
    )

    if (analysis.type) {
      await conn.execute(
        `INSERT INTO user_error_stats (user_id, word_id, error_type, hit_count)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE hit_count = hit_count + 1, last_at = NOW()`,
        [userId, wordId, analysis.type]
      )
    }

    queue[itemIndex] = { ...item, answered: true, correct: isCorrect }

    // 注意：MySQL 的 SET 子句按书写顺序求值，后面的表达式会读到前面刚更新的值。
    // 因此移动平均必须写在 answered_count 自增之前，否则会被当成「已含本次」的计数。
    await conn.execute(
      `UPDATE study_sessions SET
         queue = ?,
         avg_hesitation_ms = FLOOR((avg_hesitation_ms * answered_count + ?) / (answered_count + 1)),
         answered_count = answered_count + 1,
         new_count = new_count + ?,
         review_count = review_count + ?,
         correct_count = correct_count + ?,
         wrong_count = wrong_count + ?
       WHERE id = ?`,
      [
        toJson(queue), hesitation,
        isNewWord ? 1 : 0, isNewWord ? 0 : 1,
        isCorrect ? 1 : 0, isCorrect ? 0 : 1,
        sessionId,
      ]
    )

    await addAnswerToPlan(conn, userId, todayKey(), { isNew: isNewWord, isCorrect })

    return {
      isCorrect,
      isNewWord,
      quality,
      hesitationMs: hesitation,
      word: {
        id: word.id,
        spelling: word.spelling,
        definitions: word.definitions,
        example: word.example,
      },
      correctText: word.definitions[0],
      wrongOption,
      analysis,
      confusion,
      hasConfusionHistory: priorConfusionHits > 0,
      progress: {
        state: srs.state,
        ef: srs.ef,
        repetitions: srs.repetitions,
        intervalDays: srs.intervalDays,
        memoryStrength,
        nextReviewAt: srs.nextReviewAt,
        timesSeen,
        timesCorrect,
        timesWrong,
      },
      session: {
        id: Number(sessionId),
        answeredCount: Number(session.answered_count) + 1,
        plannedCount: Number(session.planned_count),
        correctCount: Number(session.correct_count) + (isCorrect ? 1 : 0),
        wrongCount: Number(session.wrong_count) + (isCorrect ? 0 : 1),
      },
    }
  })

  // 事务提交后再评估徽章：徽章逻辑出错不应回滚学习记录
  let unlockedBadges = []
  try {
    unlockedBadges = await evaluateBadges(userId)
  } catch (error) {
    console.error('[badge] 评估失败：', error.message)
  }

  // 命中混淆类错因时附带对比记忆卡片
  const confusableCard = outcome.analysis.needConfusableCard
    ? await buildConfusableCard(wordId)
    : null

  const plan = await getOrCreateDailyPlan(userId, todayKey())

  return { ...outcome, unlockedBadges, confusableCard, plan }
}

/** 结束会话，返回本轮统计 */
export async function finishSession(userId, sessionId) {
  const session = await queryOne(
    'SELECT * FROM study_sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId]
  )
  if (!session) throw notFound('学习会话不存在')

  const mapped = mapSessionRow(session)

  if (mapped.status !== 'finished') {
    await execute(
      "UPDATE study_sessions SET status = 'finished', finished_at = ? WHERE id = ? AND user_id = ?",
      [new Date(), sessionId, userId]
    )
  }

  const total = mapped.correctCount + mapped.wrongCount
  return {
    session: { ...mapped, status: 'finished' },
    summary: {
      plannedCount: mapped.plannedCount,
      answeredCount: mapped.answeredCount,
      newCount: mapped.newCount,
      reviewCount: mapped.reviewCount,
      correctCount: mapped.correctCount,
      wrongCount: mapped.wrongCount,
      accuracy: total ? Math.round((mapped.correctCount / total) * 100) : 0,
      avgHesitationMs: mapped.avgHesitationMs,
    },
  }
}

/**
 * 错因巩固包素材：汇总近期错词、错因分布与易混词组（PRD 4.3.3）
 */
export async function getErrorDigest(userId, { days = 7, limit = 20 } = {}) {
  const cap = safeLimit(limit, { fallback: 20, max: 100 })
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const wrongWords = await query(
    `SELECT w.id, w.spelling, w.definitions, w.examples, w.phonetic, w.pos,
            COUNT(*) AS wrong_times,
            SUM(a.error_type = 'form_confusion') AS form_times,
            SUM(a.error_type = 'meaning_confusion') AS meaning_times,
            SUM(a.error_type = 'systematic_confusion') AS systematic_times,
            SUM(a.error_type = 'spelling_weak') AS spelling_times,
            SUM(a.error_type = 'guess') AS guess_times,
            SUM(a.error_type = 'vague') AS vague_times
       FROM answer_logs a
       JOIN words w ON w.id = a.word_id
      WHERE a.user_id = ? AND a.result = 0 AND a.created_at >= ?
      GROUP BY w.id
      ORDER BY wrong_times DESC, w.spelling ASC
      LIMIT ${cap}`,
    [userId, since]
  )

  const errorDistribution = await query(
    `SELECT error_type, COUNT(*) AS count FROM answer_logs
      WHERE user_id = ? AND result = 0 AND error_type IS NOT NULL AND created_at >= ?
      GROUP BY error_type ORDER BY count DESC`,
    [userId, since]
  )

  return {
    days,
    wrongWords: wrongWords.map((row) => ({
      wordId: Number(row.id),
      spelling: row.spelling,
      phonetic: row.phonetic,
      pos: row.pos,
      definitions: parseJson(row.definitions, []),
      example: parseJson(row.examples, [])[0] || '',
      wrongTimes: Number(row.wrong_times),
      breakdown: {
        formConfusion: Number(row.form_times || 0),
        meaningConfusion: Number(row.meaning_times || 0),
        systematicConfusion: Number(row.systematic_times || 0),
        spellingWeak: Number(row.spelling_times || 0),
        guess: Number(row.guess_times || 0),
        vague: Number(row.vague_times || 0),
      },
    })),
    errorDistribution: errorDistribution.map((row) => ({
      type: row.error_type,
      count: Number(row.count),
    })),
  }
}

export default {
  createSession,
  getSession,
  submitAnswer,
  finishSession,
  buildConfusableCard,
  getErrorDigest,
  mapSessionRow,
}
