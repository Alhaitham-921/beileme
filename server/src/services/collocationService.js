import { createHash } from 'node:crypto'
import { query, queryOne, withTransaction } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { recordWordEvidence } from './wordLearningEvidence.js'
import { conflict, notFound } from '../utils/errors.js'
import { getWordById } from './wordService.js'
import { cachedWordCollocations, getWordLearningCard } from './wordLearningService.js'
import { listCollectionWords } from './collectionService.js'
import { reviewItem } from './srs.js'
import { businessDate } from '../utils/time.js'
import { buildCollocationQuestions, matchesCollocationAnswer } from '../../../src/utils/collocationPractice.js'

const normalize = value => String(value || '').normalize('NFKC').trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLowerCase()
export const collocationKey = item => createHash('sha256').update(JSON.stringify([normalize(item.phrase), normalize(item.translation)])).digest('hex')

export function scheduleCollocation(previous, correct, now = Date.now()) {
  const sameDay = previous?.last_review_at && businessDate(new Date(previous.last_review_at)) === businessDate(new Date(now))
  // Repeating a phrase within one day records evidence, but cannot manufacture a long review interval.
  if (correct && previous?.last_result === 'correct' && sameDay && new Date(previous.next_review_at).getTime() > now) return {
    ef: Number(previous.ef), repetitions: Number(previous.repetitions), intervalDays: Number(previous.interval_days),
    nextReviewAt: new Date(previous.next_review_at),
  }
  return reviewItem(previous ? { ef: previous.ef, repetitions: previous.repetitions, intervalDays: previous.interval_days } : {}, correct ? 4 : 1, now)
}

function present(row) {
  if (!row) return null
  const state = parseJson(row.state, {})
  const item = state.items[state.answers.length]
  return { id: Number(row.id), wordId: row.word_id ? Number(row.word_id) : null, mode: state.mode,
    total: state.items.length, answered: state.answers.length,
    question: item ? { index: state.answers.length, wordId: item.wordId, spelling: item.spelling,
      prompt: item.prompt, translation: item.translation, previous: item.previous || null } : null,
    feedback: state.answers.at(-1) || null, results: item ? null : state.answers,
  }
}

export async function collocationStatus(userId, wordId = null) {
  const [active, counts, progress, latestWord] = await Promise.all([
    queryOne('SELECT * FROM collocation_sessions WHERE user_id=? AND word_id <=> ? AND completed_at IS NULL ORDER BY id DESC LIMIT 1', [userId, wordId]),
    queryOne(`SELECT COUNT(*) AS total, COALESCE(SUM(next_review_at<=UTC_TIMESTAMP(3)),0) AS due,
      COALESCE(SUM(last_result<>'correct'),0) AS weak, COALESCE(SUM(times_seen),0) AS attempts,
      COALESCE(SUM(times_correct),0) AS correct FROM collocation_progress
      WHERE user_id=? ${wordId ? 'AND word_id=?' : ''}`, wordId ? [userId, wordId] : [userId]),
    wordId ? query(`SELECT question,last_result,times_seen,times_correct,times_wrong,next_review_at
      FROM collocation_progress WHERE user_id=? AND word_id=? ORDER BY next_review_at,phrase_key LIMIT 30`, [userId, wordId]) : [],
    wordId ? null : queryOne(`SELECT s.id, s.word_id, s.state, w.spelling FROM collocation_sessions s
      JOIN words w ON w.id=s.word_id
      WHERE s.user_id=? AND s.completed_at IS NULL ORDER BY s.id DESC LIMIT 1`, [userId]),
  ])
  const resumable = present(latestWord)
  const wordResume = resumable?.question ? {
    id: resumable.id, wordId: resumable.wordId, spelling: latestWord.spelling,
    answered: resumable.answered, total: resumable.total,
  } : null
  return { active: present(active), total: Number(counts.total), due: Number(counts.due), weak: Number(counts.weak),
    ...(!wordId && { wordResume }),
    attempts: Number(counts.attempts), correct: Number(counts.correct), progress: progress.map(row => ({
      phrase: parseJson(row.question, {}).phrase, translation: parseJson(row.question, {}).translation,
      lastResult: row.last_result, timesSeen: Number(row.times_seen), timesCorrect: Number(row.times_correct),
      timesWrong: Number(row.times_wrong), nextReviewAt: row.next_review_at,
    })) }
}

export async function collocationRecommendations(userId) {
  const { items, total } = await listCollectionWords(userId, { source: 'mistakes', size: 30 })
  const recommendations = []
  for (let offset = 0; offset < items.length && recommendations.length < 3; offset += 5) {
    const batch = await Promise.all(items.slice(offset, offset + 5).map(async word => {
      const collocations = await cachedWordCollocations(userId, word)
      const [question] = buildCollocationQuestions(collocations, word.spelling)
      return question ? { wordId: word.id, spelling: word.spelling, phrase: question.phrase } : null
    }))
    recommendations.push(...batch.filter(Boolean))
  }
  return { items: recommendations.slice(0, 3), mistakeCount: total }
}

export async function startCollocations(userId, { wordId = null, mode = 'practice' } = {}) {
  const existing = await queryOne('SELECT * FROM collocation_sessions WHERE user_id=? AND word_id <=> ? AND completed_at IS NULL ORDER BY id DESC LIMIT 1', [userId, wordId])
  if (existing) return { session: present(existing) }
  let candidates = []
  if (wordId && mode === 'practice') {
    const card = await getWordLearningCard(userId, wordId)
    candidates = buildCollocationQuestions(card.collocations, card.spelling).map(item => ({ ...item, wordId, spelling: card.spelling, key: collocationKey(item) }))
  } else if (wordId) await getWordById(wordId, userId)
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[active]] = await conn.execute('SELECT * FROM collocation_sessions WHERE user_id=? AND word_id <=> ? AND completed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE', [userId, wordId])
    if (active) return { session: present(active) }
    const conditions = mode === 'mistakes' ? "AND p.last_result<>'correct'" : mode === 'due' || !wordId ? 'AND p.next_review_at<=UTC_TIMESTAMP(3)' : ''
    const [rows] = await conn.execute(`SELECT p.*, w.spelling FROM collocation_progress p JOIN words w ON w.id=p.word_id
      WHERE p.user_id=? ${wordId ? 'AND p.word_id=?' : ''} ${conditions}
      ORDER BY (p.last_result<>'correct') DESC, p.next_review_at, p.word_id, p.phrase_key LIMIT 30`, wordId ? [userId, wordId] : [userId])
    const items = new Map(), saved = new Map(rows.map(row => [row.word_id + ':' + row.phrase_key, row]))
    const addRow = row => items.set(row.word_id + ':' + row.phrase_key, { ...parseJson(row.question, {}),
      wordId: Number(row.word_id), spelling: row.spelling, key: row.phrase_key, previous: row.last_result })
    // Due/weak phrases first; unseen material must not be starved by six already-correct phrases.
    for (const row of rows) if (row.last_result !== 'correct' || new Date(row.next_review_at).getTime() <= Date.now()) addRow(row)
    for (const item of candidates) if (!saved.has(item.wordId + ':' + item.key)) items.set(item.wordId + ':' + item.key, item)
    for (const row of rows) if (!items.has(row.word_id + ':' + row.phrase_key)) addRow(row)
    const selected = [...items.values()].slice(0, wordId ? 6 : 10)
    if (!selected.length) return { session: null, message: wordId && mode === 'practice'
      ? '这个词暂缺可练的双语搭配，请先补充搭配，再开始练习。' : '当前没有符合条件的搭配复习任务。' }
    const state = { mode, items: selected, answers: [] }
    const [result] = await conn.execute('INSERT INTO collocation_sessions (user_id,word_id,state) VALUES (?,?,?)', [userId, wordId, JSON.stringify(state)])
    return { session: present({ id: result.insertId, word_id: wordId, state }) }
  })
}

export async function answerCollocation(userId, sessionId, questionIndex, answer) {
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[session]] = await conn.execute('SELECT * FROM collocation_sessions WHERE id=? AND user_id=? FOR UPDATE', [sessionId, userId])
    if (!session) throw notFound('搭配练习不存在')
    const state = parseJson(session.state, {})
    if (state.answers[questionIndex]) return present(session) // Network retries cannot count twice.
    const item = state.items[state.answers.length]
    if (!item || questionIndex !== state.answers.length) throw conflict('题目已更新，请继续当前练习')
    const result = !answer.trim() ? 'unknown' : matchesCollocationAnswer(answer, item.answer) ? 'correct' : 'incorrect'
    const correct = result === 'correct'
    const [[previous]] = await conn.execute('SELECT * FROM collocation_progress WHERE user_id=? AND word_id=? AND phrase_key=? FOR UPDATE', [userId, item.wordId, item.key])
    const now = new Date(), next = scheduleCollocation(previous, correct, now.getTime())
    const feedback = { index: questionIndex, wordId: item.wordId, spelling: item.spelling, phrase: item.phrase,
      translation: item.translation, answer: item.answer, input: answer, result, previous: previous?.last_result || null,
      nextReviewAt: next.nextReviewAt.toISOString() }
    const [attempt] = await conn.execute(`INSERT INTO collocation_attempts
      (user_id,word_id,phrase_key,session_id,question_index,answer,result) VALUES (?,?,?,?,?,?,?)`,
    [userId, item.wordId, item.key, sessionId, questionIndex, answer, result])
    await recordWordEvidence(conn, { userId, wordId: item.wordId, sense: item.sense || null, source: 'collocation',
      sourceKey: attempt.insertId, result, details: { phrase: item.phrase, translation: item.translation }, at: now })
    await conn.execute(`INSERT INTO collocation_progress
      (user_id,word_id,phrase_key,question,times_seen,times_correct,times_wrong,last_result,repetitions,ef,interval_days,next_review_at,last_review_at,last_wrong_at)
      VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
      question=VALUES(question), times_seen=times_seen+1,times_correct=times_correct+VALUES(times_correct),
      times_wrong=times_wrong+VALUES(times_wrong),last_result=VALUES(last_result),repetitions=VALUES(repetitions),
      ef=VALUES(ef),interval_days=VALUES(interval_days),next_review_at=VALUES(next_review_at),last_review_at=VALUES(last_review_at),
      last_wrong_at=COALESCE(VALUES(last_wrong_at),last_wrong_at)`,
    [userId, item.wordId, item.key, JSON.stringify(item), correct ? 1 : 0, correct ? 0 : 1,
      result, next.repetitions, next.ef, next.intervalDays, next.nextReviewAt, now, correct ? null : now])
    state.answers.push(feedback)
    await conn.execute('UPDATE collocation_sessions SET state=?,completed_at=? WHERE id=?',
      [JSON.stringify(state), state.answers.length === state.items.length ? now : null, sessionId])
    return present({ ...session, state })
  })
}
