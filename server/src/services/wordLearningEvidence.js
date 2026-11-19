import { query } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { businessDate } from '../utils/time.js'

export const normalizeSense = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

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

const names = { assessment: '自测辨义', study: '日常辨义', collocation: '搭配填空', recall: '独立回忆', image: '看图辨义', dialogue: '情境使用', dialogue_quiz: '情境小结巩固' }
function channels(events) {
  return Object.entries(names).flatMap(([source, label]) => {
    const rows = events.filter(row => row.source === source)
    if (!rows.length) return []
    return [{ source, label, total: rows.length, correct: rows.filter(row => ['correct','independent'].includes(row.result)).length,
      hinted: rows.filter(row => row.result === 'hinted').length, skipped: rows.filter(row => row.result === 'skipped').length,
      latest: rows.at(-1).result }]
  })
}

export function buildWordHistory(session, history, practiceEvents = []) {
  const answers = session.state.answers || []
  const targets = new Map()
  for (const answer of answers) {
    const q = answer.snapshot, wordId = Number(q?.dictionaryWordId)
    if (!wordId || !q?.options?.[q.correctIndex]) continue
    if (!targets.has(wordId)) targets.set(wordId, { wordId, spelling: q.spelling, senses: new Map() })
    targets.get(wordId).senses.set(normalizeSense(q.options[q.correctIndex]), q.options[q.correctIndex])
  }
  const cutoff = new Date(session.state.result.completedAt || session.completed_at).getTime()
  const events = practiceEvents.filter(event => new Date(event.at).getTime() <= cutoff)
  for (const row of [...history, session]) for (const answer of row.state.answers || []) {
    const q = answer.snapshot, wordId = Number(q?.dictionaryWordId)
    if (!targets.has(wordId) || !q?.options?.[q.correctIndex]) continue
    events.push({ wordId, sense: q.options[q.correctIndex], source: 'assessment', sourceKey: `${row.id}:${q.wordId}`,
      result: answer.correct ? 'correct' : 'incorrect', details: { sessionId: Number(row.id) },
      at: new Date(row.state.result.completedAt || row.completed_at).toISOString() })
  }
  events.sort((a, b) => a.at.localeCompare(b.at))
  const words = [...targets.values()].map(target => {
    const rows = events.filter(event => event.wordId === target.wordId)
    const senses = [...target.senses].map(([key, sense]) => {
      const matching = rows.filter(event => event.sense && normalizeSense(event.sense) === key)
      const stats = channels(matching)
      const assessment = stats.find(item => item.source === 'assessment')
      const recall = stats.find(item => item.source === 'recall')
      const weak = stats.filter(item => ['incorrect','unknown','needs-practice','hinted','skipped','assisted','weak'].includes(item.latest))
      const previouslyWrong = matching.some(event => event.source === 'assessment' && event.result === 'incorrect')
      const lastFailure = matching.filter(event => ['assessment','recall'].includes(event.source) &&
        !['correct','independent'].includes(event.result)).at(-1)?.at
      const delayed = matching.filter((event, index) => event.source === 'recall' && event.result === 'independent' &&
        !event.details?.legacy && event.details?.mode === 'retest' && event.details?.changedContext && index > 0 &&
        (!lastFailure || event.at > lastFailure) &&
        new Date(event.at) - new Date(matching[index - 1].at) >= 86400000)
      const delayedDays = new Set(delayed.map(event => businessDate(new Date(event.at)))).size
      const state = weak.length ? 'needs-practice' : delayedDays >= 2 ? 'delayed-evidence' : assessment?.latest === 'correct' ? 'recognition-only' : 'insufficient'
      const label = state === 'needs-practice' ? '仍有待巩固的练习' : state === 'delayed-evidence' ? '已有跨日独立回忆依据'
        : state === 'recognition-only' ? '本次能辨认，独立使用仍待验证' : '证据不足'
      return { sense, channels: stats, state, label, delayedDays,
        improvementSupported: previouslyWrong && assessment?.latest === 'correct' && delayedDays >= 2 && !weak.length,
        timeline: matching.slice(-12).map(({ source, result, at, details }) => ({ source, label: names[source], result, at,
          mode: details?.mode, changedContext: Boolean(details?.changedContext) })) }
    })
    const known = new Set(target.senses.keys())
    return { wordId: target.wordId, spelling: target.spelling, senses,
      unscoped: channels(rows.filter(event => !event.sense)),
      otherSenses: [...new Set(rows.filter(event => event.sense && !known.has(normalizeSense(event.sense))).map(event => event.sense))] }
  })
  words.sort((a, b) => Number(b.senses.some(s => s.state === 'needs-practice')) - Number(a.senses.some(s => s.state === 'needs-practice')))
  return { words, supportedImprovements: words.flatMap(word => word.senses.filter(s => s.improvementSupported).map(s => ({ wordId: word.wordId, spelling: word.spelling, sense: s.sense }))),
    scope: '仅关联当前测试词。义项按保存的明确文本匹配；未标义项的旧记录单独呈现，不合并推断。辨义、搭配、回忆和看图分别统计，一次答对不代表长期掌握。' }
}
