import { createHash } from 'node:crypto'
import { query, queryOne, withTransaction } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { badRequest, conflict, notFound } from '../utils/errors.js'
import { resolveWordbookForUser } from './wordService.js'
import { listWordMemoryImages, listRecallExampleReplacements, getWordMemoryImage } from './wordMemoryImageService.js'
import { scheduleCollocation } from './collocationService.js'
import { recordWordEvidence } from './wordLearningEvidence.js'
import { IMAGE_RECALL_EXAMPLES, SPATIAL_RECALL_EXAMPLES } from '../../../src/data/imageRecallExamples.js'
import { buildImageRecallRounds, buildSpatialRecallRounds, matchesImageRecall } from '../../../src/utils/imageRecall.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function imageTargetKey(item) {
  return hash([item.bookId || null, item.origin, item.origin === 'personal' ? item.wordId : item.exampleKey, item.sense])
}
function present(row) {
  if (!row) return null
  const state = parseJson(row.state, {})
  return { id: Number(row.id), source: row.source, answered: state.answers.length, total: state.rounds.length,
    answers: state.answers,
    rounds: state.rounds.map((round, index) => ({ spelling: round.spelling,
      multiple: round.options.filter(item => item.correct).length > 1,
      options: round.options.map(option => index < state.answers.length ? option
        : { key: option.key, imagePath: option.imagePath, url: option.url }) })) }
}

export async function imageRecallStatus(userId) {
  const [counts, active] = await Promise.all([
    queryOne(`SELECT COUNT(*) total,COALESCE(SUM(next_review_at<=UTC_TIMESTAMP(3)),0) due,
      COALESCE(SUM(last_result<>'correct'),0) weak,COALESCE(SUM(times_seen),0) attempts FROM image_recall_progress WHERE user_id=?`, [userId]),
    query('SELECT id,source FROM image_recall_sessions WHERE user_id=? AND completed_at IS NULL ORDER BY id DESC', [userId]),
  ])
  return { total: Number(counts.total), due: Number(counts.due), weak: Number(counts.weak), attempts: Number(counts.attempts), active }
}

async function library(userId) {
  const [book, personal, replacements] = await Promise.all([
    resolveWordbookForUser(userId), listWordMemoryImages(userId), listRecallExampleReplacements(userId),
  ])
  const spellings = [...new Set([...IMAGE_RECALL_EXAMPLES, ...SPATIAL_RECALL_EXAMPLES].map(p => p.spelling))]
  const ids = personal.map(p => p.wordId)
  const rows = await query(`SELECT id,spelling_norm,wordbook_id FROM words WHERE
    (wordbook_id=? AND spelling_norm IN (${spellings.map(() => '?').join(',')}))
    ${ids.length ? `OR id IN (${ids.map(() => '?').join(',')})` : ''}`, [book.id, ...spellings, ...ids])
  function annotate(item) {
    const origin = item.wordId ? 'personal' : item.key?.startsWith('spatial-') ? 'spatial' : 'examples'
    const word = origin === 'personal' ? rows.find(w => Number(w.id) === Number(item.wordId))
      : rows.find(w => Number(w.wordbook_id) === Number(book.id) && w.spelling_norm === item.spelling.toLowerCase())
    const value = { ...item, origin, exampleKey: origin === 'personal' ? null : item.key,
      wordId: word ? Number(word.id) : null, bookId: word ? Number(word.wordbook_id) : Number(book.id) }
    value.targetKey = imageTargetKey(value)
    return value
  }
  return { personal, replacements, annotate }
}

async function resumeImageSession(userId, id) {
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[row]] = await conn.execute('SELECT * FROM image_recall_sessions WHERE user_id=? AND id=? FOR UPDATE', [userId, id])
    if (!row) throw notFound('看图练习不存在')
    const state = parseJson(row.state, {})
    const replacements = await listRecallExampleReplacements(userId), cards = new Map()
    for (const round of state.rounds.slice(state.answers.length)) for (const option of round.options) {
      if (option.origin === 'personal') {
        const key = option.wordId + ':' + option.sense
        if (!cards.has(key)) {
          try { cards.set(key, await getWordMemoryImage(userId, option.wordId, option.sense)) }
          catch (error) { if (error.status !== 404) throw error; cards.set(key, null) }
        }
        const card = cards.get(key)
        if (card?.imagePath && card.selected?.sense === option.sense) {
          option.imagePath = card.imagePath + '/tile'; option.explanation = card.explanation
        }
      } else if (option.origin === 'examples') {
        const replacement = replacements.find(item => item.exampleKey === option.exampleKey)
        if (replacement?.imagePath) { option.imagePath = replacement.imagePath; option.url = undefined; option.explanation = replacement.explanation }
      }
    }
    await conn.execute('UPDATE image_recall_sessions SET state=? WHERE id=?', [JSON.stringify(state), id])
    return { session: present({ ...row, state }), resumed: true }
  })
}

export async function startImageRecall(userId, source = 'examples') {
  const existing = await queryOne('SELECT * FROM image_recall_sessions WHERE user_id=? AND source=? AND completed_at IS NULL ORDER BY id DESC LIMIT 1', [userId, source])
  if (existing) return resumeImageSession(userId, existing.id)
  const data = await library(userId)
  let rounds = []
  if (['due','mistakes'].includes(source)) {
    const targets = await query(`SELECT * FROM image_recall_progress WHERE user_id=?
      AND ${source === 'due' ? 'next_review_at<=UTC_TIMESTAMP(3)' : "last_result<>'correct'"}
      ORDER BY next_review_at,target_key LIMIT 30`, [userId])
    for (const row of targets) {
      const target = parseJson(row.target, {})
      if (target.origin === 'spatial') {
        const round = buildSpatialRecallRounds().find(round => round.spelling === target.spelling)
        if (round) rounds.push({ ...round, options: round.options.map(item => ({ ...data.annotate(item), bookId: target.bookId,
          wordId: item.correct ? target.wordId : null, targetKey: item.correct ? row.target_key : data.annotate(item).targetKey })) })
      } else {
        let current
        if (target.origin === 'personal') {
          let card
          try { card = await getWordMemoryImage(userId, target.wordId, target.sense) }
          catch (error) { if (error.status === 404) continue; throw error }
          if (card.imagePath && card.selected?.sense === target.sense) current = { ...target, imagePath: card.imagePath + '/tile', explanation: card.explanation }
        } else {
          current = IMAGE_RECALL_EXAMPLES.find(item => item.key === target.exampleKey)
          const replacement = data.replacements.find(item => item.exampleKey === target.exampleKey)
          if (current && replacement?.imagePath) current = { ...current, imagePath: replacement.imagePath, explanation: replacement.explanation, url: undefined }
        }
        if (current) {
          const round = buildImageRecallRounds([current], Math.random, data.replacements)[0]
          if (round) rounds.push({ ...round, options: round.options.map(item => item.correct
            ? { ...item, origin: target.origin, exampleKey: target.exampleKey, wordId: target.wordId, bookId: target.bookId, targetKey: row.target_key }
            : data.annotate(item)) })
        }
      }
      if (rounds.length >= 5) break
    }
  } else {
    if (source === 'personal' && !data.personal.length) return { session: null, message: '暂无个人记忆图，可以先用内置图练习。' }
    rounds = source === 'spatial' ? buildSpatialRecallRounds()
      : buildImageRecallRounds(source === 'personal' ? data.personal : [], Math.random, data.replacements)
    rounds = rounds.map(round => ({ ...round, options: round.options.map(data.annotate) }))
  }
  if (!rounds.length) return { session: null, message: '当前没有可练的图片任务。旧图片若已失效，可重新生成后再练。' }
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[active]] = await conn.execute('SELECT * FROM image_recall_sessions WHERE user_id=? AND source=? AND completed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE', [userId, source])
    if (active) return { session: present(active), resumed: true }
    const state = { rounds, answers: [] }
    const [inserted] = await conn.execute('INSERT INTO image_recall_sessions(user_id,source,state) VALUES(?,?,?)', [userId, source, JSON.stringify(state)])
    return { session: present({ id: inserted.insertId, source, state }), resumed: false }
  })
}

const pendingAnswers = new Map()
export function answerImageRecall(userId, id, index, selected, skipped = false) {
  const key = `${userId}:${id}:${index}`
  if (pendingAnswers.has(key)) return pendingAnswers.get(key)
  const request = saveImageAnswer(userId, id, index, selected, skipped).finally(() => pendingAnswers.delete(key))
  pendingAnswers.set(key, request)
  return request
}

async function saveImageAnswer(userId, id, index, selected, skipped) {
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[row]] = await conn.execute('SELECT * FROM image_recall_sessions WHERE id=? AND user_id=? FOR UPDATE', [id, userId])
    if (!row) throw notFound('看图练习不存在')
    const state = parseJson(row.state, {})
    if (state.answers[index]) return present(row)
    if (index !== state.answers.length || !state.rounds[index]) throw conflict('题目已更新，请继续当前练习')
    const round = state.rounds[index]
    if (new Set(selected).size !== selected.length || selected.some(key => !round.options.some(option => option.key === key)) ||
        (!skipped && !selected.length) || (skipped && selected.length)) throw badRequest('请选择本题有效图片，或明确选择跳过')
    const correct = !skipped && matchesImageRecall(round, selected)
    const result = skipped ? 'skipped' : correct ? 'correct' : 'incorrect'
    const details = { selectedKeys: selected, missedKeys: round.options.filter(p => p.correct && !selected.includes(p.key)).map(p => p.key),
      extraKeys: selected.filter(key => !round.options.find(p => p.key === key)?.correct) }
    const [attempt] = await conn.execute('INSERT INTO image_recall_attempts(user_id,session_id,question_index,result,details) VALUES(?,?,?,?,?)',
      [userId, id, index, result, JSON.stringify(details)])
    const nextReviews = [], now = new Date()
    for (const target of round.options.filter(option => option.correct)) {
      const [[previous]] = await conn.execute('SELECT * FROM image_recall_progress WHERE user_id=? AND target_key=? FOR UPDATE', [userId, target.targetKey])
      const next = scheduleCollocation(previous, correct, now.getTime())
      await conn.execute(`INSERT INTO image_recall_progress
        (user_id,target_key,target,last_result,times_seen,times_correct,repetitions,ef,interval_days,next_review_at,last_review_at)
        VALUES(?,?,?,?,1,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE target=VALUES(target),last_result=VALUES(last_result),
        times_seen=times_seen+1,times_correct=times_correct+VALUES(times_correct),repetitions=VALUES(repetitions),ef=VALUES(ef),
        interval_days=VALUES(interval_days),next_review_at=VALUES(next_review_at),last_review_at=VALUES(last_review_at)`,
      [userId, target.targetKey, JSON.stringify(target), result, correct ? 1 : 0, next.repetitions, next.ef, next.intervalDays, next.nextReviewAt, now])
      await recordWordEvidence(conn, { userId, wordId: target.wordId, sense: target.sense, source: 'image',
        sourceKey: `${attempt.insertId}:${target.targetKey.slice(0, 40)}`, result, details: { ...details, origin: target.origin, selected: selected.includes(target.key) }, at: now })
      nextReviews.push({ spelling: target.spelling, sense: target.sense, nextReviewAt: next.nextReviewAt.toISOString() })
    }
    state.answers.push({ index, result, correct, skipped, ...details, nextReviews })
    await conn.execute('UPDATE image_recall_sessions SET state=?,completed_at=? WHERE id=?',
      [JSON.stringify(state), state.answers.length === state.rounds.length ? now : null, id])
    return present({ ...row, state })
  })
}
