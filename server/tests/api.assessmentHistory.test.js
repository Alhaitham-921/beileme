import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, createOnboardedUser, getTestServer } from './helpers/setup.js'
import { execute, query, queryOne } from '../src/db/pool.js'
import { config } from '../src/config.js'
import { parseJson } from '../src/utils/json.js'
import { encryptSecret } from '../src/services/ai/cryptoKeys.js'

let client, bookId
before(async () => {
  client = createClient((await getTestServer()).baseUrl)
  bookId = (await execute("INSERT INTO wordbooks (code,name,scope) VALUES ('assessment-history-test','历史关联测试词书','自定义')")).insertId
  for (let difficulty = 1; difficulty <= 5; difficulty++) for (let index = 0; index < 30; index++) {
    const spelling = `history${String.fromCharCode(96 + difficulty)}${String.fromCharCode(97 + index % 26)}${index >= 26 ? 'z' : ''}`
    await execute(`INSERT INTO words (wordbook_id,spelling,spelling_norm,pos,difficulty,definitions,examples) VALUES (?,?,?,'n.',?,?,'[]')`,
      [bookId, spelling, spelling, difficulty, JSON.stringify([`词义${String.fromCodePoint(0x4e00 + difficulty * 30 + index)}`])])
  }
})
after(async () => { if (bookId) await execute('DELETE FROM wordbooks WHERE id=?', [bookId]) })

async function user() {
  const result = await createOnboardedUser(client)
  await execute('UPDATE user_profiles SET wordbook_id=? WHERE user_id=?', [bookId, result.userId])
  return result
}
async function finish(user, correct = false, initial = null) {
  const auth = { token: user.token }
  let current = initial || (await client.post('/api/v1/assessment/placement', auth)).data
  while (current.question) {
    assert.equal(current.question.correctIndex, undefined)
    const row = await queryOne('SELECT state FROM assessment_sessions WHERE id=?', [current.id])
    const q = parseJson(row.state).current
    const response = await client.post(`/api/v1/assessment/${current.id}/answers`, { ...auth,
      body: { wordId: q.wordId, selectedIndex: correct ? q.correctIndex : -1, rtMs: 1800 } })
    assert.equal(response.status, 200, JSON.stringify(response.raw))
    current = response.data
  }
  return current
}
const path = id => `/api/v1/assessment/placement/${id}`

test('first and subsequent assessments stay optional and never block direct learning', async () => {
  const learner = await user(), auth = { token: learner.token }
  const countTests = async () => Number((await queryOne('SELECT COUNT(*) AS n FROM assessment_sessions WHERE user_id=?', [learner.userId])).n)
  await client.get('/api/v1/assessment/placement', auth)
  assert.equal(await countTests(), 0)
  const firstStudy = await client.post('/api/v1/study/sessions', { ...auth, body: { studyMode: 'new-only' } })
  assert.equal(firstStudy.status, 201, JSON.stringify(firstStudy.raw))
  assert.equal(await countTests(), 0)
  await finish(learner)
  await client.get('/api/v1/assessment/placement', auth)
  await client.get('/api/v1/assessment/placement', auth)
  assert.equal(await countTests(), 1)
  const subsequentStudy = await client.post('/api/v1/study/sessions', { ...auth, body: { studyMode: 'new-only' } })
  assert.equal(subsequentStudy.status, 201, JSON.stringify(subsequentStudy.raw))
  assert.equal(await countTests(), 1)
})

test('automatic history analysis survives refresh, retests old weaknesses and sends no AI requests', async () => {
  const learner = await user(), other = await user(), auth = { token: learner.token }
  const active = (await client.post('/api/v1/assessment/placement', auth)).data
  assert.equal((await client.get(path(active.id) + '/report', auth)).status, 400)
  assert.equal((await client.get(path(active.id) + '/report')).status, 401)
  assert.equal((await client.get(path(active.id) + '/report', { token: other.token })).status, 404)
  const first = await finish(learner, false, active)
  const firstReport = await client.get(path(first.id) + '/report', auth)
  assert.equal(firstReport.status, 200, JSON.stringify(firstReport.raw))
  assert.equal(firstReport.data.ai.available, false)
  assert.equal(firstReport.data.baseline.previous, null)
  assert.equal(firstReport.data.baseline.weakWords.length, 24)
  assert.ok(firstReport.data.baseline.weakWords.every(word => word.wordId && word.meaning))
  const rows = await query('SELECT * FROM assessment_answers WHERE session_id=?', [first.id])
  assert.equal(rows.length, 24)
  assert.ok(rows.every(row => row.selected_index === -1 && !row.correct && row.rt_ms === 1800 && parseJson(row.question).options.length === 4))
  const fallback = await client.post(path(first.id) + '/explanation', auth)
  assert.equal(fallback.status, 200)
  assert.match(fallback.data.message, /尚未接入/)
  assert.deepEqual(fallback.data.baseline, firstReport.data.baseline)
  assert.equal((await queryOne("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id=? AND type='assessment_analysis'", [learner.userId])).n, 0)

  const second = await finish(learner)
  assert.notEqual(second.form, first.form)
  assert.equal(second.result.coreTotal, 24)
  assert.equal(second.result.historyRetest.length, 4)
  assert.equal(second.result.total, 28)
  const report = (await client.get(path(second.id) + '/report', auth)).data
  assert.equal(report.baseline.previous.sessionId, first.id)
  assert.equal(report.baseline.repeatedWeakWords.length, 4)
  assert.equal(report.baseline.current.tested, 24)
  assert.equal(report.baseline.current.correct, 0)
  assert.ok(report.baseline.historyRetest.every(item => item.source.sessionId === first.id))

  const third = await finish(learner, true)
  const improved = (await client.get(path(third.id) + '/report', auth)).data.baseline
  assert.equal(improved.current.percent, 100)
  assert.equal(improved.current.tested, 24)
  assert.equal(improved.weakWords.length, 0)
  assert.ok(improved.improvedWords.length > 0)
  assert.ok(improved.comparisons.every(item => item.direction === 'higher'))
  assert.deepEqual((await client.get(path(first.id) + '/report', auth)).data.baseline, firstReport.data.baseline)

  const mistakes = (await client.get('/api/v1/words/collections?source=mistakes&size=100', auth)).data
  assert.ok(mistakes.items.some(word => Number(word.id) === firstReport.data.baseline.weakWords[0].wordId))
  const ids = report.baseline.recommendations.find(item => item.id === 'weak-words').wordIds
  const review = await client.post('/api/v1/study/review-batches', { ...auth, body: { wordIds: ids.slice(0, 3) } })
  assert.equal(review.status, 201, JSON.stringify(review.raw))
  assert.ok(review.data.items.length > 0)
  assert.equal((await client.post('/api/v1/recall', { ...auth, body: { mode: 'practice' } })).status, 200)
  assert.equal((await queryOne('SELECT COUNT(*) AS n FROM user_word_progress WHERE user_id=? AND times_seen>0', [learner.userId])).n, 0)
})

test('evidence uses the current book and completion cutoff and retains historical reports unchanged', async () => {
  const learner = await user(), auth = { token: learner.token }
  const word = await queryOne('SELECT id FROM words WHERE wordbook_id=? LIMIT 1', [bookId])
  const otherWord = await queryOne('SELECT id FROM words WHERE wordbook_id<>? LIMIT 1', [bookId])
  for (const [wordId, hours] of [[word.id, -1], [word.id, 24], [otherWord.id, -1]]) {
    await execute(`INSERT INTO answer_logs (user_id,word_id,result,quality,created_at) VALUES (?,?,1,4,DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))`, [learner.userId, wordId, hours])
  }
  const c = await execute("INSERT INTO collocation_sessions (user_id,word_id,state) VALUES (?,?,'{}')", [learner.userId, word.id])
  await execute(`INSERT INTO collocation_attempts (user_id,word_id,phrase_key,session_id,question_index,answer,result,created_at)
    VALUES (?,?,'test-key',?,0,'','unknown',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR))`, [learner.userId, word.id, c.insertId])
  const r = await execute("INSERT INTO word_recall_sessions (user_id,state,completed_at) VALUES (?,'{}',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR))", [learner.userId])
  await execute(`INSERT INTO word_recall_attempts (user_id,word_id,session_id,mode,result,prompt_key,answered_on)
    VALUES (?,?,?,'retest','hinted','test',UTC_DATE())`, [learner.userId, word.id, r.insertId])
  const completed = await finish(learner)
  const first = (await client.get(path(completed.id) + '/report', auth)).data
  assert.equal(first.baseline.learning.study.total, 1)
  assert.equal(first.baseline.learning.collocations.unknown, 1)
  assert.equal(first.baseline.learning.recall.hinted, 1)
  await execute('INSERT INTO answer_logs (user_id,word_id,result,quality) VALUES (?,?,0,1)', [learner.userId, word.id])
  assert.deepEqual((await client.get(path(completed.id) + '/report', auth)).data, first)
})

test('AI is opt in, cites supplied evidence, reuses persisted results and isolates accounts', async t => {
  const learner = await user(), other = await user(), auth = { token: learner.token }
  const completed = await finish(learner)
  const original = { ...config.ai }, realFetch = globalThis.fetch
  t.after(() => Object.assign(config.ai, original))
  Object.assign(config.ai, { apiKey: 'server-fixture-key', baseUrl: 'https://assessment.example.test/v1' })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url !== 'https://assessment.example.test/v1/chat/completions') return realFetch(url, options)
    calls++
    const sent = JSON.parse(JSON.parse(options.body).messages[1].content)
    assert.ok(sent.conclusions.some(item => item.id === sent.requiredConclusion))
    assert.equal(sent.requiredConclusion, 'synthesis-insufficient')
    assert.ok(Array.isArray(sent.history))
    assert.equal(options.headers.Authorization, 'Bearer server-fixture-key')
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      observations: [{ conclusionId: sent.requiredConclusion }],
      nextSteps: [{ actionId: 'recall' }],
    }) } }], usage: { prompt_tokens: 200, completion_tokens: 120 } })
  })
  const automatic = await client.get(path(completed.id) + '/report', auth)
  assert.equal(automatic.data.ai.available, true)
  assert.equal(calls, 0)
  assert.equal((await client.post(path(completed.id) + '/explanation', { token: other.token })).status, 404)
  const responses = await Promise.all([client.post(path(completed.id) + '/explanation', auth), client.post(path(completed.id) + '/explanation', auth)])
  for (const response of responses) {
    assert.equal(response.status, 200, JSON.stringify(response.raw))
    assert.ok(response.data.ai.explanation)
    assert.equal(response.data.ai.explanation.usage.totalTokens, 320)
  }
  assert.equal(calls, 1)
  const saved = (await client.get(path(completed.id) + '/report', auth)).data.ai.explanation
  config.ai.apiKey = ''
  const reused = await client.post(path(completed.id) + '/explanation', auth)
  assert.equal(reused.data.cached, true)
  assert.deepEqual(reused.data.ai.explanation, saved)
  assert.equal(calls, 1)
  const usage = await queryOne("SELECT used_count,prompt_tokens,completion_tokens FROM ai_usage WHERE user_id=? AND type='assessment_analysis'", [learner.userId])
  assert.equal(usage.used_count, 1)
  assert.equal(usage.prompt_tokens, 200)
  assert.equal(usage.completion_tokens, 120)
})

test('personal API takes precedence and invalid or failed responses leave the basic report available', async t => {
  const learner = await user(), auth = { token: learner.token }
  const completed = await finish(learner)
  const original = { ...config.ai }, realFetch = globalThis.fetch
  t.after(() => Object.assign(config.ai, original))
  Object.assign(config.ai, { apiKey: 'unused-platform-key', baseUrl: 'https://unused.example.test/v1' })
  await execute(`INSERT INTO user_api_keys (user_id,provider,key_cipher,base_url,model) VALUES (?,'deepseek',?,'https://personal.example.test/v1','test-model')`, [learner.userId, encryptSecret('personal-fixture-key')])
  let calls = 0, fail = false
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url !== 'https://personal.example.test/v1/chat/completions') return realFetch(url, options)
    calls++
    assert.equal(options.headers.Authorization, 'Bearer personal-fixture-key')
    if (fail) return Response.json({ error: { message: 'Unavailable' } }, { status: 503 })
    return Response.json({ choices: [{ message: { content: JSON.stringify({ observations: [{ evidenceId: 'invented-history', explanation: '历史结果显示基础辨认仍需巩固。' }], nextSteps: [] }) } }], usage: { prompt_tokens: 50, completion_tokens: 20 } })
  })
  await client.get(path(completed.id) + '/report', auth)
  await execute("UPDATE assessment_reports SET generation_token='another-process',generation_started_at=UTC_TIMESTAMP(3) WHERE session_id=?", [completed.id])
  assert.equal((await client.post(path(completed.id) + '/explanation', auth)).status, 409)
  assert.equal(calls, 0)
  await execute('UPDATE assessment_reports SET generation_started_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 3 MINUTE) WHERE session_id=?', [completed.id])
  const first = await client.post(path(completed.id) + '/explanation', auth)
  assert.equal(first.status, 200, JSON.stringify(first.raw))
  assert.equal(first.data.ai.source, 'user')
  assert.equal(first.data.ai.explanation, null)
  assert.match(first.data.message, /保留基础分析/)
  fail = true
  const failed = await client.post(path(completed.id) + '/explanation', auth)
  assert.equal(failed.status, 200)
  assert.equal(failed.data.ai.explanation, null)
  assert.ok(failed.data.baseline.current)
  assert.equal(failed.data.usage.unknownCalls, 1)
  assert.equal(calls, 2)
  assert.equal((await queryOne('SELECT generation_token FROM assessment_reports WHERE session_id=?', [completed.id])).generation_token, null)
  config.ai.dailyQuota = { ...config.ai.dailyQuota, assessment_analysis: 0 }
  const limited = await client.post(path(completed.id) + '/explanation', auth)
  assert.equal(limited.status, 200)
  assert.match(limited.data.message, /额度/)
  assert.equal(calls, 2)
  assert.ok(limited.data.baseline.current)
})

async function backdateSession(id, daysAgo) {
  const row = await queryOne('SELECT state FROM assessment_sessions WHERE id=?', [id])
  const state = parseJson(row.state)
  const date = new Date(Date.now() - daysAgo * 86400_000)
  state.result.completedAt = date.toISOString()
  await execute('UPDATE assessment_sessions SET state=?,completed_at=? WHERE id=?', [JSON.stringify(state), date, id])
}

test('cross-day history reaches the AI and yields a separate optional comprehensive recommendation', async t => {
  const learner = await user(), auth = { token: learner.token }
  const first = await finish(learner)
  await backdateSession(first.id, 2)
  const second = await finish(learner, true)
  await backdateSession(second.id, 1)
  const third = await finish(learner, true)
  const report = await client.get(path(third.id) + '/report', auth)
  assert.equal(report.status, 200, JSON.stringify(report.raw))
  assert.equal(report.data.baseline.synthesis.testDays, 3)
  assert.equal(report.data.baseline.synthesis.decision, 'supported')
  assert.equal(report.data.baseline.synthesis.recommendedLevel, 'challenge')
  assert.equal(report.data.baseline.current.recommended, third.result.recommended)
  assert.equal((await queryOne('SELECT study_start_level FROM user_profiles WHERE user_id=?', [learner.userId])).study_start_level, null)
  const original = { ...config.ai }, realFetch = globalThis.fetch
  t.after(() => Object.assign(config.ai, original))
  Object.assign(config.ai, { apiKey: 'synthesis-fixture-key', baseUrl: 'https://synthesis.example.test/v1' })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url !== 'https://synthesis.example.test/v1/chat/completions') return realFetch(url, options)
    calls++
    const sent = JSON.parse(JSON.parse(options.body).messages[1].content)
    assert.equal(sent.history.length, 3)
    assert.equal(sent.history[0].scores[0][1], 0)
    assert.equal(sent.history[2].scores[0][1], 8)
    assert.equal(sent.requiredConclusion, 'synthesis-supported')
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      observations: [{ conclusionId: sent.requiredConclusion }], nextSteps: [{ actionId: 'study-start' }],
    }) } }], usage: { prompt_tokens: 150, completion_tokens: 50 } })
  })
  const explained = await client.post(path(third.id) + '/explanation', auth)
  assert.equal(explained.status, 200, JSON.stringify(explained.raw))
  assert.equal(explained.data.ai.explanation.validationVersion, 'assessment-explanation-v2')
  assert.ok(explained.data.ai.explanation.observations[0].evidenceIds.includes('trend-foundation'))
  assert.equal(calls, 1)
  assert.equal((await queryOne('SELECT study_start_level FROM user_profiles WHERE user_id=?', [learner.userId])).study_start_level, null)
})

test('legacy reports upgrade from frozen evidence without showing unchecked explanations or making automatic AI calls', async t => {
  const learner = await user(), auth = { token: learner.token }
  const completed = await finish(learner)
  const originalReport = (await client.get(path(completed.id) + '/report', auth)).data
  const legacy = structuredClone(originalReport.baseline)
  legacy.version = 'assessment-history-v1'
  delete legacy.synthesis
  legacy.facts = legacy.facts.filter(item => !item.id.startsWith('trend-') && item.id !== 'synthesis')
  const unchecked = { observations: [{ evidenceId: 'comparison', explanation: '相比过去持续进步，已经完全掌握。' }], nextSteps: [] }
  await execute('UPDATE assessment_reports SET baseline=?,ai_explanation=? WHERE session_id=?', [JSON.stringify(legacy), JSON.stringify(unchecked), completed.id])
  // This newly inserted, backdated learning event must not alter the already frozen report.
  const word = await queryOne('SELECT id FROM words WHERE wordbook_id=? LIMIT 1', [bookId])
  await execute(`INSERT INTO answer_logs (user_id,word_id,result,quality,created_at)
    VALUES (?,?,0,1,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR))`, [learner.userId, word.id])
  const original = { ...config.ai }, realFetch = globalThis.fetch
  t.after(() => Object.assign(config.ai, original))
  Object.assign(config.ai, { apiKey: 'upgrade-fixture-key', baseUrl: 'https://upgrade.example.test/v1' })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url !== 'https://upgrade.example.test/v1/chat/completions') return realFetch(url, options)
    calls++
    const sent = JSON.parse(JSON.parse(options.body).messages[1].content)
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      observations: [{ conclusionId: sent.requiredConclusion }], nextSteps: [{ actionId: 'recall' }],
    }) } }], usage: { prompt_tokens: 100, completion_tokens: 30 } })
  })
  const upgraded = (await client.get(path(completed.id) + '/report', auth)).data
  assert.equal(upgraded.baseline.version, 'assessment-history-v2')
  assert.deepEqual(upgraded.baseline.learning, originalReport.baseline.learning)
  assert.deepEqual(upgraded.baseline.current, originalReport.baseline.current)
  assert.equal(upgraded.baseline.asOf, originalReport.baseline.asOf)
  assert.equal(upgraded.ai.explanation, null)
  assert.equal(upgraded.ai.needsRegeneration, true)
  assert.equal(calls, 0)
  assert.deepEqual(parseJson((await queryOne('SELECT ai_explanation FROM assessment_reports WHERE session_id=?', [completed.id])).ai_explanation), unchecked)
  const regenerated = (await client.post(path(completed.id) + '/explanation', auth)).data
  assert.equal(regenerated.ai.needsRegeneration, false)
  assert.equal(regenerated.ai.explanation.validationVersion, 'assessment-explanation-v2')
  assert.ok(!regenerated.ai.explanation.observations[0].explanation.includes('完全掌握'))
  assert.equal(calls, 1)
  assert.equal((await client.post(path(completed.id) + '/explanation', auth)).data.cached, true)
  assert.equal(calls, 1)
})

test('unsupported AI improvement claims never replace the automatic analysis and require a manual retry', async t => {
  const learner = await user(), auth = { token: learner.token }
  const completed = await finish(learner)
  const original = { ...config.ai }, realFetch = globalThis.fetch
  t.after(() => Object.assign(config.ai, original))
  Object.assign(config.ai, { apiKey: 'guard-fixture-key', baseUrl: 'https://guard.example.test/v1' })
  let calls = 0, bad = true
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url !== 'https://guard.example.test/v1/chat/completions') return realFetch(url, options)
    calls++
    const sent = JSON.parse(JSON.parse(options.body).messages[1].content)
    const observations = [{ conclusionId: sent.requiredConclusion }]
    if (bad) observations.push({ conclusionId: 'trend-foundation-rising' })
    return Response.json({ choices: [{ message: { content: JSON.stringify({ observations, nextSteps: [{ actionId: 'recall' }] }) } }], usage: { prompt_tokens: 120, completion_tokens: 60 } })
  })
  const rejected = (await client.post(path(completed.id) + '/explanation', auth)).data
  assert.equal(rejected.ai.explanation, null)
  assert.equal(rejected.baseline.synthesis.decision, 'insufficient')
  assert.match(rejected.message, /保留基础分析/)
  assert.equal(calls, 1)
  assert.equal((await client.get(path(completed.id) + '/report', auth)).data.ai.explanation, null)
  assert.equal(calls, 1)
  bad = false
  const retried = (await client.post(path(completed.id) + '/explanation', auth)).data
  assert.ok(retried.ai.explanation)
  assert.equal(calls, 2)
})
