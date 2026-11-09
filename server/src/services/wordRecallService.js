import { createHash } from 'node:crypto'
import { query, queryOne, withTransaction } from '../db/pool.js'
import { badRequest, conflict, notFound } from '../utils/errors.js'
import { parseJson } from '../utils/json.js'
import { addDays, todayKey, toDateKey } from '../utils/time.js'
import { mapWordRow } from './wordService.js'
import { WORD_USAGE } from '../../data/wordUsage.js'
import { RECALL_CONTEXTS } from '../../data/recallContexts.js'

const latestRecall = `WITH last_recall AS (
  SELECT a.* FROM word_recall_attempts a JOIN (
    SELECT MAX(id) AS id FROM word_recall_attempts WHERE user_id=? AND dialogue_task_id IS NULL GROUP BY word_id
  ) latest ON latest.id=a.id
)`

function normalize(value) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
}

// Only use a sentence when its meaning matches the one recorded in the dialogue.
const dialogueContexts = {
  bank: [
    { sense: /河岸|河边|riverbank|river bank/, text: 'A heron stood on the bank of the river.', translation: '一只苍鹭站在河岸边。' },
    { sense: /银行|financial institution/, text: 'I stopped by the bank to deposit a check.', translation: '我去银行存了一张支票。' },
  ],
  reservation: [
    { sense: /预订|预约|booking/, text: 'The restaurant confirmed our reservation for six.', translation: '餐厅确认了我们六点的预订。' },
  ],
}

export async function scheduleDialogueRecall(userId, id) {
  return withTransaction(async conn => {
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId])
    const [[followup]] = await conn.execute(
      'SELECT * FROM practice_followups WHERE id=? AND user_id=? FOR UPDATE', [id, userId])
    if (!followup) throw notFound('练习任务不存在')
    if (followup.recall_task_id) {
      const [[task]] = await conn.execute('SELECT due_on, last_result FROM dialogue_recall_tasks WHERE id=? AND user_id=?',
        [followup.recall_task_id, userId])
      return { dueOn: toDateKey(task.due_on), result: task.last_result }
    }
    if (!followup.word_id || followup.status !== 'pending') throw badRequest('这条巩固建议暂不可加入填词复测')
    const details = parseJson(followup.details, {})
    const senseKey = createHash('sha256')
      .update(JSON.stringify([normalize(followup.spelling), normalize(details.sense || '')])).digest()
    const [[pending]] = await conn.execute(
      'SELECT id,due_on,last_result FROM dialogue_recall_tasks WHERE user_id=? AND sense_key=? AND due_on IS NOT NULL LIMIT 1',
      [userId, senseKey])
    const dueOn = pending ? toDateKey(pending.due_on) : addDays(todayKey(), 1)
    let taskId = pending?.id
    if (!taskId) {
      const [inserted] = await conn.execute(
        'INSERT INTO dialogue_recall_tasks (user_id,word_id,sense_key,details,due_on) VALUES (?,?,?,?,?)',
        [userId, followup.word_id, senseKey, JSON.stringify(details), dueOn])
      taskId = inserted.insertId
    }
    await conn.execute('UPDATE practice_followups SET recall_task_id=? WHERE id=? AND user_id=?', [taskId, id, userId])
    return { dueOn, result: pending?.last_result || null }
  })
}

function question(row) {
  const word = mapWordRow(row)
  const spelling = word.spelling.toLowerCase()
  const escaped = word.spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'gi')
  const dialogue = row.dialogue_task_id ? parseJson(row.dialogue_details, {}) : null
  const usage = dialogue ? null : WORD_USAGE[spelling]
  const second = RECALL_CONTEXTS[spelling]
  const candidates = dialogue
    ? (dialogueContexts[spelling] || []).filter(entry => entry.sense.test(normalize(dialogue.sense || '')))
    : [...(usage?.examples || []),
    ...(second ? [{ text: second[0], translation: second[1] }] : []),
    ...(word.examples || []).map(text => ({ text })),
  ]
  const example = candidates.find(entry => typeof entry.text === 'string' && entry.text.trim().length <= 300 &&
    entry.text.trim() !== row.prompt_key &&
    ![dialogue?.quote, dialogue?.reference].some(text => text && normalize(text).includes(normalize(entry.text))) &&
    entry.text.replace(pattern, '___') !== entry.text)
  const definitions = word.definitions.filter(text => /\p{Script=Han}/u.test(text))
  const meaning = dialogue?.sense || (definitions.length ? definitions : word.definitions).slice(0, 2).join('；')
  return { wordId: word.id, spelling: word.spelling, pos: word.pos, meaning,
    text: example?.text.trim() || '', translation: example?.translation || '',
    blank: example?.text.replace(pattern, '___') || '',
    cue: (example?.translation || meaning).replace(pattern, '___'),
    promptKey: example?.text.trim() || 'definition',
    changedContext: Boolean(example && (dialogue || (row.prompt_key && row.prompt_key !== 'definition'))),
    dialogueTaskId: row.dialogue_task_id ? Number(row.dialogue_task_id) : null,
    dialogue: dialogue ? { sourceTitle: dialogue.sourceTitle, reason: dialogue.reason, sense: dialogue.sense } : null,
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
    queryOne(`${latestRecall} SELECT SUM(due_on <= ?) AS due, MIN(due_on) AS nextDate FROM (
      SELECT next_check_on AS due_on FROM last_recall UNION ALL
      SELECT due_on FROM dialogue_recall_tasks WHERE user_id=?
    ) schedule`, [userId, todayKey(), userId]),
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
      ? await conn.execute(`${latestRecall} SELECT w.*, ranked.previous_result, ranked.prompt_key, ranked.dialogue_task_id, ranked.dialogue_details
          FROM (
            SELECT due.*, ROW_NUMBER() OVER (PARTITION BY word_id ORDER BY due_on, dialogue_task_id DESC, task_id) AS rank_in_word
            FROM (
              SELECT word_id, id AS task_id, next_check_on AS due_on, result AS previous_result,
                prompt_key, NULL AS dialogue_task_id, NULL AS dialogue_details
              FROM last_recall WHERE next_check_on<=?
              UNION ALL
              SELECT word_id, id, due_on, last_result, prompt_key, id, details
              FROM dialogue_recall_tasks WHERE user_id=? AND due_on<=?
            ) due
          ) ranked JOIN words w ON w.id=ranked.word_id
          WHERE ranked.rank_in_word=1 ORDER BY ranked.due_on, ranked.task_id LIMIT 5`, [userId, day, userId, day])
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
      (user_id,word_id,session_id,mode,result,prompt_key,next_check_on,answered_on,dialogue_task_id) VALUES (?,?,?,?,?,?,?,?,?)`,
    [userId, wordId, id, state.mode, result, item.promptKey, nextDate, day, item.dialogueTaskId ?? null])
    if (item.dialogueTaskId) {
      await conn.execute('UPDATE dialogue_recall_tasks SET due_on=?, last_result=?, prompt_key=? WHERE id=? AND user_id=?',
        [nextDate, result, item.promptKey, item.dialogueTaskId, userId])
    }
    state.answers.push({ wordId, feedback: { wordId, spelling: item.spelling, result, previous: item.previous,
      meaning: item.meaning, example: item.text, translation: item.translation, dialogue: item.dialogue || null,
      collocation: item.collocation, nextDate, changedContext: item.changedContext } })
  })
}
