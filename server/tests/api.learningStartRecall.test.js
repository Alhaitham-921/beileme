import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { execute, queryOne } from '../src/db/pool.js'
import { todayKey, addDays } from '../src/utils/time.js'
import { parseJson } from '../src/utils/json.js'
import { buildMatchedForms } from '../src/services/placementService.js'

let client
before(async () => { client = createClient((await getTestServer()).baseUrl) })

test('pilot placement gives 24 balanced questions, adds boundary questions, and keeps prior placement separate', async () => {
  const user = await createOnboardedUser(client)
  const auth = { token: user.token }
  const legacy = await client.post('/api/v1/assessment', auth)
  assert.equal(legacy.status, 200)
  const inserted = await execute("INSERT INTO wordbooks (code,name,scope) VALUES ('cet4','四级测试词书','四级')")
  const bookId = inserted.insertId
  try {
    await execute('UPDATE user_profiles SET wordbook_id=? WHERE user_id=?', [bookId, user.userId])
    const start = await client.post('/api/v1/assessment/placement', auth)
    assert.equal(start.status, 200)
    assert.equal(start.data.total, 24)
    assert.ok(['A', 'B'].includes(start.data.form))
    assert.equal(start.data.question.correctIndex, undefined)
    assert.equal((await client.post('/api/v1/assessment/placement', auth)).data.id, start.data.id)
    assert.equal((await client.get('/api/v1/assessment', auth)).data.items[0].id, legacy.data.id)
    let placement = start.data
    const count = [0, 0, 0]
    const correctTargets = [6, 5, 3]
    while (placement.question) {
      const row = await queryOne('SELECT state FROM assessment_sessions WHERE id=?', [placement.id])
      const question = parseJson(row.state, {}).current
      const selectedIndex = count[question.band]++ < correctTargets[question.band] ? question.correctIndex : -1
      const answered = await client.post(`/api/v1/assessment/${placement.id}/answers`, { ...auth,
        body: { wordId: question.wordId, selectedIndex, rtMs: 900 },
      })
      assert.equal(answered.status, 200)
      placement = answered.data
    }
    assert.equal(placement.result.total, 28)
    assert.deepEqual(placement.result.bands.map(band => band.tested), [10, 10, 8])
    assert.equal(placement.result.estimatedKnown, undefined)
    const next = await client.post('/api/v1/assessment/placement', auth)
    assert.equal(next.data.form, start.data.form === 'A' ? 'B' : 'A')
    assert.notEqual(next.data.id, placement.id)
  } finally { await execute('DELETE FROM wordbooks WHERE id=?', [bookId]) }
})

test('selecting an entry preference prioritizes that difficulty without replacing the active queue', async () => {
  const user = await createOnboardedUser(client)
  const auth = { token: user.token }
  const old = await client.post('/api/v1/study/sessions', { ...auth, body: { studyMode: 'new-only' } })
  const preference = await client.put('/api/v1/assessment/placement/preference', { ...auth, body: { level: 'challenge' } })
  assert.equal(preference.status, 200)
  const next = await client.post('/api/v1/study/sessions', { ...auth, body: { studyMode: 'new-only' } })
  assert.equal(next.status, 201)
  assert.equal(next.data.session.studyOptions.studyStartLevel, 'challenge')
  const ranks = next.data.items.map(item => Number(item.word.difficulty < 4))
  assert.ok(ranks.includes(0))
  assert.deepEqual(ranks, [...ranks].sort())
  const restored = await client.get(`/api/v1/study/sessions/${old.data.session.id}`, auth)
  assert.deepEqual(restored.data.items, old.data.items)
})

test('wrong-word recall remembers hints, schedules tomorrow, and resumes a changed-context retest once', async () => {
  const user = await createOnboardedUser(client)
  const other = await createOnboardedUser(client)
  const auth = { token: user.token }
  const word = await queryOne("SELECT id FROM words WHERE spelling='adapt' LIMIT 1")
  const wordId = Number(word.id)
  await execute('INSERT INTO answer_logs (user_id,word_id,result,quality) VALUES (?,?,0,1)', [user.userId, wordId])
  const practice = (await client.post('/api/v1/recall', { ...auth, body: { mode: 'practice' } })).data.session
  assert.equal(practice.question.wordId, wordId)
  assert.match(practice.question.blank, /___/)
  assert.equal(practice.question.spelling, undefined)
  const url = `/api/v1/recall/${practice.id}`
  assert.equal((await client.post(`${url}/hint`, { token: other.token, body: { wordId } })).status, 404)
  const hint = await client.post(`${url}/hint`, { ...auth, body: { wordId } })
  assert.equal(hint.data.question.hint, 'a')
  const request = { ...auth, body: { wordId, answer: '  ADAPT  ' } }
  const result = await client.post(`${url}/answers`, request)
  assert.equal(result.status, 200)
  assert.equal(result.data.results[0].result, 'hinted')
  assert.equal(result.data.results[0].nextDate, addDays(todayKey(), 1))
  assert.deepEqual((await client.post(`${url}/answers`, request)).data.results, result.data.results)
  assert.equal((await client.get('/api/v1/recall', auth)).data.due, 0)
  assert.equal((await client.post('/api/v1/recall', { ...auth, body: { mode: 'retest' } })).data.session, null)
  await execute('UPDATE word_recall_attempts SET next_check_on=? WHERE session_id=?', [todayKey(), practice.id])
  const retest = (await client.post('/api/v1/recall', { ...auth, body: { mode: 'retest' } })).data.session
  assert.equal(retest.question.changedContext, true)
  assert.notEqual(retest.question.blank, practice.question.blank)
  const checked = await client.post(`/api/v1/recall/${retest.id}/answers`, request)
  assert.equal(checked.data.results[0].previous, 'hinted')
  assert.equal(checked.data.results[0].result, 'independent')
  assert.equal(checked.data.results[0].nextDate, null)
  assert.equal((await client.get('/api/v1/recall', auth)).data.lastCompleted.id, retest.id)
})


test('imported book forms match by source difficulty and part of speech without sharing target words', () => {
  const rows = [1, 2, 3, 4, 5].flatMap((difficulty, band) => Array.from({ length: 30 }, (_, index) => ({
    spelling: `test${String.fromCharCode(97 + band)}${String.fromCharCode(97 + index % 26)}${index >= 26 ? 'z' : ''}`,
    pos: index % 2 ? 'n.' : 'v.', difficulty,
    definitions: [`词义${String.fromCodePoint(0x4e00 + band * 30 + index)}`],
  })))
  const forms = buildMatchedForms(rows, 'ielts')
  const lookup = new Map(rows.map(row => [row.spelling, row]))
  const used = new Set()
  for (let band = 0; band < 3; band++) {
    assert.equal(forms.A[band].length, 10)
    for (let index = 0; index < 10; index++) {
      const [a, b] = ['A', 'B'].map(form => forms[form][band][index])
      assert.equal(lookup.get(a[0]).difficulty, lookup.get(b[0]).difficulty)
      assert.equal(lookup.get(a[0]).pos, lookup.get(b[0]).pos)
      assert.equal(new Set(a.slice(1)).size, 4)
      assert.equal(new Set(b.slice(1)).size, 4)
      used.add(a[0]); used.add(b[0])
    }
  }
  assert.equal(used.size, 60)
  assert.equal(buildMatchedForms(rows.filter(row => row.difficulty < 4), 'sparse'), null)
})

test('dialogue recall reuses a pending sense, schedules other senses separately and keeps dialogue grades intact', async () => {
  const user = await createOnboardedUser(client)
  const other = await createOnboardedUser(client)
  const auth = { token: user.token }
  const word = await queryOne("SELECT id FROM words WHERE spelling='bank' LIMIT 1")
  const wordId = Number(word.id)
  async function addFollowup(sense) {
    const session = await execute("INSERT INTO dialogue_sessions (user_id,scene,status,state) VALUES (?,'bank','finished','{}')",
      [user.userId])
    const details = { word: 'bank', sense, reason: '本轮尚未尝试使用', sourceTitle: '银行练习', reference: 'Where is the bank?' }
    const followup = await execute(`INSERT INTO practice_followups
      (user_id,source_session_id,spelling,word_id,details,next_check_at) VALUES (?,?,'bank',?,?,UTC_TIMESTAMP())`,
    [user.userId, session.insertId, wordId, JSON.stringify(details)])
    return { id: followup.insertId, sourceId: session.insertId, url: '/api/v1/practice/followups/' + followup.insertId + '/recall' }
  }

  const finance = await addFollowup('银行')
  const repeat = await addFollowup(' 银行 ')
  const river = await addFollowup('河岸')
  assert.equal((await client.post(finance.url, { token: other.token })).status, 404)
  const scheduled = await Promise.all([finance, finance, repeat, river].map(item => client.post(item.url, auth)))
  for (const response of scheduled) {
    assert.equal(response.status, 200)
    assert.equal(response.data.dueOn, addDays(todayKey(), 1))
  }
  assert.equal(Number((await queryOne('SELECT COUNT(*) AS n FROM dialogue_recall_tasks WHERE user_id=?', [user.userId])).n), 2)
  assert.equal(Number((await queryOne('SELECT COUNT(*) AS n FROM word_recall_attempts WHERE user_id=?', [user.userId])).n), 0)
  const listUrl = '/api/v1/practice/followups?sourceId=' + repeat.sourceId
  assert.equal((await client.get(listUrl, auth)).data.tasks[0].recall.dueOn, addDays(todayKey(), 1))
  const startRetest = async () => (await client.post('/api/v1/recall', { ...auth, body: { mode: 'retest' } })).data.session
  assert.equal(await startRetest(), null)
  await execute('UPDATE dialogue_recall_tasks SET due_on=? WHERE user_id=?', [todayKey(), user.userId])
  assert.equal((await client.get('/api/v1/recall', auth)).data.due, 2)
  const first = await startRetest()
  assert.equal(first.total, 1)
  assert.equal(first.question.wordId, wordId)
  assert.equal(first.question.changedContext, true)
  assert.equal(first.question.spelling, undefined)
  assert.match(first.question.blank, /___/)
  assert.match(first.question.cue, /银行|河岸/)
  const answer = session => client.post('/api/v1/recall/' + session.id + '/answers', { ...auth, body: { wordId, answer: 'bank' } })
  const firstResult = (await answer(first)).data.results[0]
  assert.equal(firstResult.result, 'independent')
  assert.equal(firstResult.dialogue.reason, '本轮尚未尝试使用')
  const second = await startRetest()
  assert.notEqual(second.question.cue, first.question.cue)
  await client.post('/api/v1/recall/' + second.id + '/hint', { ...auth, body: { wordId } })
  assert.equal((await answer(second)).data.results[0].nextDate, addDays(todayKey(), 1))
  assert.equal((await client.get(listUrl, auth)).data.tasks[0].status, 'pending')
  assert.equal((await client.get('/api/v1/recall', auth)).data.due, 0)
})
