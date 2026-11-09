import { query, queryOne, withTransaction } from '../db/pool.js'
import { conflict, notFound } from '../utils/errors.js'
import { parseJson } from '../utils/json.js'
import { addDays, todayKey, toDateKey } from '../utils/time.js'
import { mapWordRow } from './wordService.js'
import { WORD_USAGE } from '../../data/wordUsage.js'
import { RECALL_CONTEXTS } from '../../data/recallContexts.js'

const latestRecall = `WITH last_recall AS (
  SELECT a.* FROM word_recall_attempts a JOIN (
    SELECT MAX(id) AS id FROM word_recall_attempts WHERE user_id=? GROUP BY word_id
  ) latest ON latest.id=a.id
)`

function normalize(value) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
}

function question(row) {
  const word = mapWordRow(row)
  const spelling = word.spelling.toLowerCase()
  const escaped = word.spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'gi')
  const usage = WORD_USAGE[spelling]
  const second = RECALL_CONTEXTS[spelling]
  const candidates = [...(usage?.examples || []),
    ...(second ? [{ text: second[0], translation: second[1] }] : []),
    ...(word.examples || []).map(text => ({ text })),
  ]
  const example = candidates.find(entry => typeof entry.text === 'string' && entry.text.trim().length <= 300 &&
    entry.text.trim() !== row.prompt_key && entry.text.replace(pattern, '___') !== entry.text)
  const definitions = word.definitions.filter(text => /\p{Script=Han}/u.test(text))
  const meaning = (definitions.length ? definitions : word.definitions).slice(0, 2).join('；')
  return { wordId: word.id, spelling: word.spelling, pos: word.pos, meaning,
    text: example?.text.trim() || '', translation: example?.translation || '',
    blank: example?.text.replace(pattern, '___') || '',
    cue: (example?.translation || meaning).replace(pattern, '___'),
    promptKey: example?.text.trim() || 'definition',
    changedContext: Boolean(row.prompt_key && example && row.prompt_key !== 'definition'),
    collocation: usage?.collocations[0] || null,
    previous: row.previous_result || null,
  }
}

function present(row) {
  if (!row) return null
  const state = parseJson(row.state, {})
  const item = state.items[state.answers.length]
  return { id: Number(row.id), mode: state.mode, total: state.items.length, answered: state.answers.length,
    question: item ? { wordId: item.wordId, blank: item.blank, cue: item.cue, pos: item.pos,
      changedContext: item.changedContext, hint: item.hinted ? item.spelling[0] : null } : null,
    feedback: state.answers.at(-1)?.feedback || null,
    results: item ? null : state.answers.map(answer => answer.feedback),
  }
}

export async function recallStatus(userId) {
  const [row, counts, completed] = await Promise.all([
    queryOne('SELECT * FROM word_recall_sessions WHERE user_id=? AND completed_at IS NULL ORDER BY id DESC LIMIT 1', [userId]),
    queryOne(`${latestRecall} SELECT SUM(next_check_on <= ?) AS due, MIN(next_check_on) AS nextDate FROM last_recall`, [userId, todayKey()]),
    queryOne('SELECT * FROM word_recall_sessions WHERE user_id=? AND completed_at IS NOT NULL ORDER BY id DESC LIMIT 1', [userId]),
  ])
  return { active: present(row), lastCompleted: present(completed), due: Number(counts?.due || 0), nextDate: toDateKey(counts?.nextDate) }
}

export async function startRecall(userId, mode) {
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [active] = await conn.execute('SELECT * FROM word_recall_sessions WHERE user_id=? AND completed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE', [userId])
    if (active.length) return present(active[0])
    const day = todayKey()
    const [rows] = mode === 'retest'
      ? await conn.execute(`${latestRecall} SELECT w.*, a.result AS previous_result, a.prompt_key
          FROM last_recall a JOIN words w ON w.id=a.word_id WHERE a.next_check_on<=?
          ORDER BY a.next_check_on, a.id LIMIT 5`, [userId, day])
      : await conn.execute(`${latestRecall} SELECT w.*, a.result AS previous_result, a.prompt_key
          FROM words w LEFT JOIN user_word_progress p ON p.user_id=? AND p.word_id=w.id
          LEFT JOIN last_recall a ON a.word_id=w.id
          LEFT JOIN (SELECT word_id, COUNT(*) AS times_wrong, MAX(created_at) AS last_wrong
            FROM answer_logs WHERE user_id=? AND result=0 GROUP BY word_id) logs ON logs.word_id=w.id
          WHERE (COALESCE(p.times_wrong,0)>0 OR logs.times_wrong>0)
            AND (a.id IS NULL OR (a.next_check_on IS NULL AND a.answered_on<?))
          ORDER BY (p.next_review_at IS NOT NULL AND p.next_review_at<=UTC_TIMESTAMP()) DESC,
            a.answered_on ASC, GREATEST(COALESCE(p.times_wrong,0),COALESCE(logs.times_wrong,0)) DESC,
            logs.last_wrong DESC, w.id LIMIT 5`, [userId, userId, userId, day])
    if (!rows.length) return null
    const state = { mode, items: rows.map(question), answers: [] }
    const [inserted] = await conn.execute('INSERT INTO word_recall_sessions (user_id,state) VALUES (?,?)', [userId, JSON.stringify(state)])
    return present({ id: inserted.insertId, state })
  })
}

async function editRecall(userId, id, wordId, edit) {
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [rows] = await conn.execute('SELECT * FROM word_recall_sessions WHERE id=? AND user_id=? FOR UPDATE', [id, userId])
    if (!rows.length) throw notFound('专项练习不存在')
    const row = rows[0]
    const state = parseJson(row.state, {})
    const item = state.items[state.answers.length]
    if (state.answers.some(answer => answer.wordId === wordId)) return present(row)
    if (!item || item.wordId !== wordId) throw conflict('题目已更新，请继续当前练习')
    await edit(conn, state, item)
    const finished = state.answers.length === state.items.length
    await conn.execute('UPDATE word_recall_sessions SET state=?, completed_at=IF(?,UTC_TIMESTAMP(),NULL) WHERE id=?',
      [JSON.stringify(state), finished, id])
    return present({ id, state })
  })
}

export function recallHint(userId, id, wordId) {
  return editRecall(userId, id, wordId, (_conn, _state, item) => { item.hinted = true })
}

export function answerRecall(userId, id, wordId, input) {
  return editRecall(userId, id, wordId, async (conn, state, item) => {
    const correct = normalize(input) === normalize(item.spelling)
    const result = correct ? (item.hinted ? 'hinted' : 'independent') : 'needs-practice'
    const day = todayKey()
    const nextDate = state.mode === 'retest' && result === 'independent' ? null : addDays(day, 1)
    await conn.execute(`INSERT INTO word_recall_attempts
      (user_id,word_id,session_id,mode,result,prompt_key,next_check_on,answered_on) VALUES (?,?,?,?,?,?,?,?)`,
    [userId, wordId, id, state.mode, result, item.promptKey, nextDate, day])
    state.answers.push({ wordId, feedback: { wordId, spelling: item.spelling, result, previous: item.previous,
      meaning: item.meaning, example: item.text, translation: item.translation,
      collocation: item.collocation, nextDate, changedContext: item.changedContext } })
  })
}
