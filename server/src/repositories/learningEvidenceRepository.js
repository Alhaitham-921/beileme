import { query } from '../db/pool.js'
import { parseJson } from '../utils/json.js'

export async function recordWordEvidence(conn, { userId, wordId, sense = null, source, sourceKey, result, details = {}, at = new Date() }) {
  if (!wordId) return
  await conn.execute(`INSERT IGNORE INTO word_learning_evidence
    (user_id,word_id,wordbook_id,spelling,sense,source,source_key,result,details,occurred_at)
    SELECT ?,w.id,w.wordbook_id,w.spelling,?,?,?,?,?,? FROM words w WHERE w.id=?`,
  [userId, sense || null, source, String(sourceKey), result, JSON.stringify(details), at, wordId])
}

export async function loadWordEvidence(userId, bookId, wordIds, since, until) {
  if (!wordIds.length) return []
  const marks = wordIds.map(() => '?').join(',')
  const [saved, study, phrases, recalls, dialogue] = await Promise.all([
    query(`SELECT * FROM word_learning_evidence WHERE user_id=? AND wordbook_id=? AND word_id IN (${marks})
      AND occurred_at>=? AND occurred_at<=? ORDER BY occurred_at,id`, [userId, bookId, ...wordIds, since, until]),
    query(`SELECT a.* FROM answer_logs a JOIN words w ON w.id=a.word_id WHERE a.user_id=? AND w.wordbook_id=?
      AND a.word_id IN (${marks}) AND a.source IN ('study','review') AND a.created_at>=? AND a.created_at<=?`,
    [userId, bookId, ...wordIds, since, until]),
    query(`SELECT a.* FROM collocation_attempts a JOIN words w ON w.id=a.word_id WHERE a.user_id=? AND w.wordbook_id=?
      AND a.word_id IN (${marks}) AND a.created_at>=? AND a.created_at<=?`, [userId, bookId, ...wordIds, since, until]),
    query(`SELECT a.*,s.state,s.completed_at FROM word_recall_attempts a
      JOIN word_recall_sessions s ON s.id=a.session_id AND s.user_id=a.user_id JOIN words w ON w.id=a.word_id
      WHERE a.user_id=? AND w.wordbook_id=? AND a.word_id IN (${marks}) AND s.completed_at>=? AND s.completed_at<=?`,
    [userId, bookId, ...wordIds, since, until]),
    query(`SELECT a.* FROM dialogue_word_evidence a JOIN words w ON w.id=a.word_id WHERE a.user_id=? AND w.wordbook_id=?
      AND a.word_id IN (${marks}) AND a.created_at>=? AND a.created_at<=?`, [userId, bookId, ...wordIds, since, until]),
  ])
  const events = saved.map(row => ({ wordId: Number(row.word_id), sense: row.sense, source: row.source,
    sourceKey: row.source_key, result: row.result, details: parseJson(row.details, {}), at: new Date(row.occurred_at).toISOString() }))
  const seen = new Set(events.map(event => `${event.source}:${event.sourceKey}`))
  const add = event => { if (!seen.has(`${event.source}:${event.sourceKey}`)) events.push(event) }
  // Old records remain visible, but absent immutable sense annotations are never reconstructed from today's dictionary.
  for (const row of study) add({ wordId: Number(row.word_id), sense: null, source: 'study', sourceKey: String(row.id),
    result: row.result ? 'correct' : 'incorrect', details: { legacy: true }, at: new Date(row.created_at).toISOString() })
  for (const row of phrases) add({ wordId: Number(row.word_id), sense: null, source: 'collocation', sourceKey: String(row.id),
    result: row.result, details: { legacy: true }, at: new Date(row.created_at).toISOString() })
  for (const row of recalls) {
    const item = parseJson(row.state, {}).items?.find(item => Number(item.wordId) === Number(row.word_id))
    add({ wordId: Number(row.word_id), sense: item?.dialogue?.sense || null, source: 'recall', sourceKey: String(row.id),
      result: row.result, details: { mode: row.mode, changedContext: Boolean(item?.changedContext), legacy: true },
      at: new Date(row.completed_at).toISOString() })
  }
  for (const row of dialogue) add({ wordId: Number(row.word_id), sense: row.sense || null, source: 'dialogue', sourceKey: String(row.id),
    result: row.result, details: { helpLevel: Number(row.help_level) }, at: new Date(row.created_at).toISOString() })
  return events.sort((a, b) => a.at.localeCompare(b.at))
}

export async function loadPracticeTotals(userId, bookId, since, until) {
  const [study, collocations, recall] = await Promise.all([
    query(`SELECT COUNT(*) AS total, COALESCE(SUM(a.result=1),0) AS correct, COUNT(DISTINCT a.word_id) AS words
      FROM answer_logs a JOIN words w ON w.id=a.word_id WHERE a.user_id=? AND w.wordbook_id=?
      AND a.source IN ('study','review') AND a.created_at>=? AND a.created_at<=?`, [userId,bookId,since,until]),
    query(`SELECT COUNT(*) AS total, COALESCE(SUM(a.result='correct'),0) AS correct,
      COALESCE(SUM(a.result='unknown'),0) AS unknown FROM collocation_attempts a JOIN words w ON w.id=a.word_id
      WHERE a.user_id=? AND w.wordbook_id=? AND a.created_at>=? AND a.created_at<=?`, [userId,bookId,since,until]),
    query(`SELECT COUNT(*) AS total, COALESCE(SUM(a.result='independent'),0) AS independent,
      COALESCE(SUM(a.result='hinted'),0) AS hinted, COALESCE(SUM(a.result='needs-practice'),0) AS weak
      FROM word_recall_attempts a JOIN word_recall_sessions s ON s.id=a.session_id AND s.user_id=a.user_id
      JOIN words w ON w.id=a.word_id WHERE a.user_id=? AND w.wordbook_id=? AND a.mode='retest'
      AND s.completed_at>=? AND s.completed_at<=?`, [userId,bookId,since,until]),
  ])
  const numbers = row => Object.fromEntries(Object.entries(row || {}).map(([key,value])=>[key,Number(value||0)]))
  return { study:numbers(study[0]), collocations:numbers(collocations[0]), recall:numbers(recall[0]) }
}
