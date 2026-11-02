import { query, queryOne, execute } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { notFound } from '../utils/errors.js'

/** Reports can schedule a practice, but quotations must come from the learner. */
export function followupCandidates(session, report) {
  const texts = (session.messages || []).filter(m => m.role === 'user').map(m => String(m.text || m.content || ''))
  if (!texts.length && !session.helpEvents?.length) return []
  const raw = report.targetUsage || session.targetUsage || []
  const usage = Array.isArray(raw) ? raw : Object.values(raw)
  // Final grounded evidence takes precedence over a checkmark shown during the dialogue.
  const entries = new Map([...usage, ...(report.evidence || [])]
    .filter(t => /^[a-z]+(?:['-][a-z]+)*$/i.test(t.word || ''))
    .map(t => [t.word.toLowerCase(), t]))
  return [...entries.values()]
    .filter(t => t.status !== 'independent' || t.weak || t.helpLevel > 1)
    .slice(0, 5).map(t => {
      const target = session.scene?.targets?.find(x => x.word.toLowerCase() === t.word.toLowerCase()) || t
      const correction = (report.corrections || []).find(c => {
        const original = c.originalSentence || c.original || ''
        return original.toLowerCase().includes(t.word.toLowerCase()) && texts.some(text => text.includes(original))
      })
      const matchingText = texts.find(text => new RegExp('\\b' + t.word + '\\b', 'i').test(text))
      const quote = correction ? (correction.originalSentence || texts.find(text => text.includes(correction.original)) || correction.original) : matchingText || ''
      const exercise = (report.reinforcement || []).find(x => x.word === t.word)
      return {
        word: t.word, sense: t.sense || target.sense || '',
        reason: t.status === 'unused' ? '本轮尚未尝试使用' : t.helpLevel > 1 ? '本轮使用过提示，需要再独立尝试' : '本轮表达仍需巩固',
        quote: quote.slice(0, 500), explanation: correction?.explanation || '',
        prompt: exercise?.prompt || ('试着用 ' + t.word + ' 写一句更短的英语表达。'),
        reference: exercise?.answer || target.example || '',
        sourceTitle: session.scene?.title || '情境练习', sourceLocation: session.scene?.location || '',
      }
    })
}

export async function saveFollowups(conn, userId, session, report) {
  for (const task of followupCandidates(session, report)) {
    let word = (report.reviewWords || []).find(w => w.spelling?.toLowerCase() === task.word.toLowerCase())
    if (!word) {
      const [matches] = await conn.execute(`SELECT id FROM words WHERE spelling_norm=?
        ORDER BY (wordbook_id=(SELECT wordbook_id FROM user_profiles WHERE user_id=?)) DESC,id ASC LIMIT 1`, [task.word.toLowerCase(), userId])
      word = matches[0]
    }
    // Linking an unused dictionary word does not create SRS progress or record a wrong answer.
    await conn.execute(`INSERT IGNORE INTO practice_followups
      (user_id,source_session_id,spelling,word_id,details,next_check_at)
      VALUES(?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY))`,
    [userId, session.id, task.word, word?.id || null, JSON.stringify(task)])
  }
  const id = session.scene?.followupId
  if (!id) return
  const [tasks] = await conn.execute('SELECT * FROM practice_followups WHERE id=? AND user_id=? FOR UPDATE', [id, userId])
  const task = tasks[0]
  const evidence = (report.evidence || []).find(e => e.word.toLowerCase() === task?.spelling.toLowerCase())
  const details = parseJson(task?.details, {})
  if (task && evidence?.status === 'independent' && session.id !== Number(task.source_session_id) && session.scene?.location !== details.sourceLocation) {
    await conn.execute("UPDATE practice_followups SET status='independent',completed_session_id=? WHERE id=? AND user_id=?", [session.id, id, userId])
  }
}

export async function listFollowups(userId, { sourceId } = {}) {
  // Backfill a viewed historical report or the latest reports without repeating their SRS writes.
  const params = sourceId ? [userId, sourceId] : [userId]
  const condition = sourceId ? ' AND id=?' : ''
  const sessions = await query("SELECT id,state FROM dialogue_sessions WHERE user_id=? AND status='finished'" + condition + ' ORDER BY id DESC LIMIT 10', params)
  const connection = { execute: async (sql, args) => {
    const result = /^\s*SELECT/i.test(sql) ? await query(sql, args) : await execute(sql, args)
    return [result]
  } }
  for (const row of sessions) {
    const session = { ...parseJson(row.state, {}), id: Number(row.id) }
    if (session.report) await saveFollowups(connection, userId, { ...session, scene: { ...session.scene, followupId: null } }, session.report)
  }
  const rows = await query("SELECT * FROM practice_followups WHERE user_id=?" + (sourceId ? ' AND source_session_id=?' : '') +
    " ORDER BY (status='pending') DESC,next_check_at ASC,id DESC LIMIT 20", params)
  return rows.map(r => ({ ...parseJson(r.details, {}), id: Number(r.id), sourceSessionId: Number(r.source_session_id),
    wordId: r.word_id ? Number(r.word_id) : null, status: r.status, nextCheckAt: r.next_check_at, due: new Date(r.next_check_at) <= new Date() }))
}

export async function getFollowup(userId, id) {
  const row = await queryOne('SELECT * FROM practice_followups WHERE id=? AND user_id=?', [id, userId])
  if (!row) throw notFound('练习任务不存在')
  return { ...parseJson(row.details, {}), id: Number(row.id), wordId: row.word_id ? Number(row.word_id) : null, sourceSessionId: Number(row.source_session_id) }
}

export async function saveShortPractice(userId, id, answer) {
  await getFollowup(userId, id)
  await execute("UPDATE practice_followups SET details=JSON_SET(details,'$.practiceAnswer',?) WHERE id=? AND user_id=?", [answer, id, userId])
  return { saved: true, message: '短句已保存。请对照参考表达；这不会自动判定为掌握。' }
}
