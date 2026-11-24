import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import { queryOne, execute } from '../src/db/pool.js'
import { parseJson } from '../src/utils/json.js'
let client
before(async()=>{
  const base=createClient((await getTestServer()).baseUrl)
  client={...base,get:(url,options={})=>base.get(url+(options.query?'?'+new URLSearchParams(options.query):''),options)}
})
const bodyFor = async (session, answer) => {
  const row=await queryOne('SELECT state FROM collocation_sessions WHERE id=?',[session.id])
  const state=parseJson(row.state,{})
  return {questionIndex:session.question.index,answer:answer??state.items[session.question.index].answer}
}
const start = async (user,wordId,mode='practice') => {
  const r=await client.post('/api/v1/collocations/sessions',{token:user.token,body:{wordId,mode}})
  assert.equal(r.status,200,JSON.stringify(r.raw));return r.data.session
}
const submit = async (user,session,answer) => {
  const r=await client.post(`/api/v1/collocations/sessions/${session.id}/answers`,{token:user.token,body:await bodyFor(session,answer)})
  assert.equal(r.status,200,JSON.stringify(r.raw));return r.data.session
}

test('collocations persist correct, incorrect and unknown evidence; resume and duplicate answers are safe',async()=>{
  const user=await createOnboardedUser(client)
  const word=await queryOne("SELECT id FROM words WHERE spelling='abandon' LIMIT 1")
  assert.equal((await client.get('/api/v1/collocations')).status,401)
  assert.equal((await client.get('/api/v1/collocations/recommendations')).status,401)
  assert.deepEqual((await client.get('/api/v1/collocations/recommendations',{token:user.token})).data,{items:[],mistakeCount:0})
  let session=await start(user,Number(word.id))
  assert.ok(session.total>=4);assert.equal(session.answered,0)
  assert.equal(session.question.answer,undefined);assert.equal(session.question.phrase,undefined)
  const body=await bodyFor(session)
  session=await submit(user,session)
  assert.equal(session.feedback.result,'correct');assert.ok(session.feedback.nextReviewAt)
  const duplicate=await client.post(`/api/v1/collocations/sessions/${session.id}/answers`,{token:user.token,body})
  assert.equal(duplicate.status,200);assert.equal(duplicate.data.session.answered,1)
  const saved=await queryOne('SELECT COUNT(*) n FROM collocation_attempts WHERE session_id=?',[session.id]);assert.equal(Number(saved.n),1)
  const resumed=await client.get('/api/v1/collocations',{token:user.token,query:{wordId:word.id}})
  assert.equal(resumed.data.active.id,session.id);assert.equal(resumed.data.active.answered,1)
  const overview=(await client.get('/api/v1/collocations',{token:user.token})).data
  assert.equal(overview.active,null)
  assert.deepEqual(overview.wordResume,{id:session.id,wordId:Number(word.id),spelling:'abandon',answered:1,total:session.total})
  session=await submit(user,session,'wrong-answer')
  assert.equal(session.feedback.result,'incorrect')
  session=await submit(user,session,'')
  assert.equal(session.feedback.result,'unknown')
  while(session.question)session=await submit(user,session)
  const status=(await client.get('/api/v1/collocations',{token:user.token,query:{wordId:word.id}})).data
  assert.equal(status.active,null);assert.equal(status.weak,2);assert.equal(status.attempts,session.total)
  assert.equal(status.progress.length,session.total)
  const freshClient=createClient((await getTestServer()).baseUrl)
  const completed=(await freshClient.get('/api/v1/collocations',{token:user.token})).data
  assert.equal(completed.weak,2);assert.equal(completed.wordResume,null)
  const list=(await client.get('/api/v1/words/collections',{token:user.token,query:{source:'mistakes'}})).data
  assert.ok(list.items.some(item=>Number(item.id)===Number(word.id)&&item.collocationWrongTimes===2))
  const recommendations=(await client.get('/api/v1/collocations/recommendations',{token:user.token})).data
  assert.equal(recommendations.mistakeCount,1)
  assert.equal(recommendations.items[0].wordId,Number(word.id))
  assert.match(recommendations.items[0].phrase,/abandon/i)
  const ids=(await client.get('/api/v1/words/collections/ids',{token:user.token,query:{source:'mistakes'}})).data.wordIds
  assert.ok(ids.includes(Number(word.id)))
  const selected=await client.post('/api/v1/study/review-batches',{token:user.token,body:{wordIds:[Number(word.id)]}})
  assert.equal(selected.status,201,JSON.stringify(selected.raw))
  const normalProgress=await queryOne('SELECT * FROM user_word_progress WHERE user_id=? AND word_id=?',[user.userId,word.id])
  assert.equal(normalProgress,null,'phrase evidence must not fabricate word-recognition answers')
  let retry=await start(user,Number(word.id),'mistakes');assert.equal(retry.total,2)
  while(retry.question)retry=await submit(user,retry)
  assert.equal((await client.get('/api/v1/collocations',{token:user.token})).data.weak,0)
  assert.ok((await client.get('/api/v1/words/collections/ids',{token:user.token,query:{source:'mistakes'}})).data.wordIds.includes(Number(word.id)))
})

test('sessions, progress and mistake collections are isolated by account; out-of-order answers are rejected',async()=>{
  const user=await createOnboardedUser(client),other=await createOnboardedUser(client)
  const word=await queryOne("SELECT id FROM words WHERE spelling='abandon' LIMIT 1")
  let session=await start(user,Number(word.id))
  assert.equal((await client.post(`/api/v1/collocations/sessions/${session.id}/answers`,{token:other.token,body:{questionIndex:0,answer:''}})).status,404)
  assert.equal((await client.post(`/api/v1/collocations/sessions/${session.id}/answers`,{token:user.token,body:{questionIndex:2,answer:'x'}})).status,409)
  session=await submit(user,session,'')
  assert.equal((await client.get('/api/v1/collocations',{token:other.token})).data.total,0)
  assert.equal((await client.get('/api/v1/collocations',{token:other.token})).data.wordResume,null)
  assert.deepEqual((await client.get('/api/v1/collocations/recommendations',{token:other.token})).data,{items:[],mistakeCount:0})
  assert.equal((await client.get('/api/v1/words/collections',{token:other.token,query:{source:'mistakes'}})).data.total,0)
  const invalid=await client.post('/api/v1/collocations/sessions',{token:user.token,body:{wordId:0}});assert.equal(invalid.status,400)
  assert.equal((await client.post(`/api/v1/collocations/sessions/${session.id}/answers`,{token:user.token,body:{questionIndex:1,answer:'x'.repeat(321)}})).status,400)
})

test('global due queue schedules saved phrases across words; same-day correct drills do not inflate intervals',async()=>{
  const user=await createOnboardedUser(client)
  const word=await queryOne("SELECT id FROM words WHERE spelling='abandon' LIMIT 1")
  let session=await start(user,Number(word.id));const first=await bodyFor(session)
  while(session.question)session=await submit(user,session)
  const prior=await queryOne('SELECT * FROM collocation_progress WHERE user_id=? ORDER BY phrase_key LIMIT 1',[user.userId])
  let repeated=await start(user,Number(word.id));while(repeated.question)repeated=await submit(user,repeated)
  const after=await queryOne('SELECT * FROM collocation_progress WHERE user_id=? AND phrase_key=?',[user.userId,prior.phrase_key])
  assert.equal(Number(after.repetitions),Number(prior.repetitions));assert.equal(Number(after.interval_days),1)
  await execute('UPDATE collocation_progress SET next_review_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE user_id=?',[user.userId])
  const due=await start(user,undefined,'due');assert.equal(due.total,session.total)
  assert.ok(due.question.spelling);assert.equal(due.question.answer,undefined)
  const answered=await submit(user,due);assert.equal(answered.feedback.result,'correct')
  assert.equal((await client.get('/api/v1/collocations',{token:user.token})).data.due,session.total-1)
  assert.ok(first.answer)
})

test('any imported word can practice saved bilingual collocations without a sample-word allowlist',async()=>{
  const user=await createOnboardedUser(client)
  const book=await queryOne('SELECT id FROM wordbooks LIMIT 1')
  const row=await execute('INSERT INTO words (wordbook_id,spelling,spelling_norm,definitions,examples) VALUES (?,?,?,?,?)',
    [book.id,'photosynthesize','photosynthesize',JSON.stringify(['进行光合作用']),JSON.stringify(['Plants photosynthesize in sunlight.'])])
  await execute(`INSERT INTO generated_contents (user_id,type,target_words,content_body,meta) VALUES (?,'error_card',?,'[]',?)`,
    [user.userId,JSON.stringify([row.insertId]),JSON.stringify({cards:[{spelling:'photosynthesize',collocations:[{phrase:'photosynthesize efficiently',translation:'高效地进行光合作用'}]}]})])
  const session=await start(user,Number(row.insertId));assert.equal(session.total,1)
  const answered=await submit(user,session,'efficiently');assert.equal(answered.feedback.result,'correct')
  assert.equal((await client.get('/api/v1/collocations',{token:user.token,query:{wordId:row.insertId}})).data.correct,1)
  const another=await start(user,Number(row.insertId))
  await submit(user,another,'')
  const recommendations=(await client.get('/api/v1/collocations/recommendations',{token:user.token})).data
  assert.deepEqual(recommendations,{items:[{wordId:Number(row.insertId),spelling:'photosynthesize',phrase:'photosynthesize efficiently'}],mistakeCount:1})
})
