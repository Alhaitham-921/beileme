import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { getTestServer,createClient,createOnboardedUser } from './helpers/setup.js'
import { queryOne, execute } from '../src/db/pool.js'
import { parseJson } from '../src/utils/json.js'
import { loadWordEvidence } from '../src/services/wordLearningEvidence.js'
let client,bookId,wordIds={}
before(async()=>{
  client=createClient((await getTestServer()).baseUrl)
  bookId=(await execute("INSERT INTO wordbooks(code,name,scope) VALUES('image-review-tests','图片复习测试','test')")).insertId
  for(const [spelling,sense] of [['in','在……里面'],['on','在……上面（接触表面）'],['under','在……下面'],['between','在……之间'],['light','光线']]) {
    wordIds[spelling]=(await execute('INSERT INTO words(wordbook_id,spelling,spelling_norm,pos,definitions,examples) VALUES(?,?,?,?,?,JSON_ARRAY())',[bookId,spelling,spelling,'prep.',JSON.stringify([sense])])).insertId
  }
})
async function user(){const u=await createOnboardedUser(client);await execute('UPDATE user_profiles SET wordbook_id=? WHERE user_id=?',[bookId,u.userId]);return u}
const auth=u=>({token:u.token})
const start=(u,source)=>client.post('/api/v1/image-recall/sessions',{...auth(u),body:{source}})
async function correctKeys(session,index=0){const row=await queryOne('SELECT state FROM image_recall_sessions WHERE id=?',[session.id]);return parseJson(row.state,{}).rounds[index].options.filter(p=>p.correct).map(p=>p.key)}
const answer=(u,s,index,selectedKeys,skipped=false)=>client.post(`/api/v1/image-recall/sessions/${s.id}/answers`,{...auth(u),body:{index,selectedKeys,skipped}})

test('same-day image repetition records attempts without inflating review intervals; a later due success advances the interval',async()=>{
  const u=await user()
  const first=(await start(u,'spatial')).data.session
  for(let i=0;i<first.total;i++)assert.equal((await answer(u,first,i,await correctKeys(first,i))).status,200)
  const before=await queryOne('SELECT * FROM image_recall_progress WHERE user_id=? ORDER BY target_key LIMIT 1',[u.userId])
  const second=(await start(u,'spatial')).data.session
  for(let i=0;i<second.total;i++)await answer(u,second,i,await correctKeys(second,i))
  const after=await queryOne('SELECT * FROM image_recall_progress WHERE user_id=? AND target_key=?',[u.userId,before.target_key])
  assert.equal(after.times_seen,2);assert.equal(after.repetitions,before.repetitions)
  assert.equal(Number(after.interval_days),Number(before.interval_days))
  assert.equal(after.next_review_at.getTime(),before.next_review_at.getTime())
  await execute('UPDATE image_recall_progress SET last_review_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY),next_review_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE user_id=? AND target_key=?',[u.userId,before.target_key])
  const due=(await start(u,'due')).data.session
  assert.equal(due.total,1)
  await answer(u,due,0,await correctKeys(due))
  const later=await queryOne('SELECT * FROM image_recall_progress WHERE user_id=? AND target_key=?',[u.userId,before.target_key])
  assert.equal(later.repetitions,before.repetitions+1)
  assert.equal(Number(later.interval_days),6)
})

test('resuming a personal image session refreshes changed image revisions while retaining completed answers and stable task identity',async()=>{
  const u=await user()
  for(const spelling of ['light','in']) {
    const wordId=wordIds[spelling],sense=spelling==='light'?'光线':'在……里面'
    const image=await sharp({create:{width:16,height:16,channels:3,background:{r:180,g:160,b:130}}}).webp().toBuffer()
    await execute('INSERT INTO word_memory_images(user_id,word_id,sense_hash,image,image_revision,attempt_day) VALUES(?,?,UNHEX(?),?,?,UTC_DATE())',
      [u.userId,wordId,createHash('sha256').update(sense).digest('hex'),image,createHash('sha256').update(image).digest()])
  }
  const s=(await start(u,'personal')).data.session
  assert.equal(s.total,2)
  await answer(u,s,0,await correctKeys(s))
  const state=parseJson((await queryOne('SELECT state FROM image_recall_sessions WHERE id=?',[s.id])).state,{})
  const target=state.rounds[1].options.find(p=>p.correct),oldPath=target.imagePath
  const image=await sharp({create:{width:16,height:16,channels:3,background:{r:30,g:80,b:100}}}).webp().toBuffer()
  await execute('UPDATE word_memory_images SET image=?,image_revision=? WHERE user_id=? AND word_id=?',[image,createHash('sha256').update(image).digest(),u.userId,target.wordId])
  const resumed=(await start(u,'personal')).data.session
  assert.equal(resumed.id,s.id);assert.equal(resumed.answered,1)
  assert.notEqual(resumed.rounds[1].options.find(p=>p.key===target.key).imagePath,oldPath)
  const saved=parseJson((await queryOne('SELECT state FROM image_recall_sessions WHERE id=?',[s.id])).state,{})
  assert.equal(saved.rounds[1].options.find(p=>p.correct).targetKey,target.targetKey)
})

test('image sessions hide answers, resume across reloads and save correct/wrong/skipped results without duplicate grading',async()=>{
  const u=await user(),response=await start(u,'spatial'),s=response.data.session
  assert.equal(response.status,200);assert.equal(s.total,4)
  assert.ok(s.rounds.every(r=>r.options.every(p=>p.correct===undefined&&p.sense===undefined&&p.spelling===undefined)))
  const keys=await correctKeys(s)
  const concurrent=await Promise.all([answer(u,s,0,keys),answer(u,s,0,keys)])
  assert.ok(concurrent.every(r=>r.status===200))
  assert.equal((await queryOne('SELECT COUNT(*) n FROM image_recall_attempts WHERE session_id=?',[s.id])).n,1)
  assert.equal(Number((await queryOne('SELECT SUM(times_seen) n FROM image_recall_progress WHERE user_id=?',[u.userId])).n),1)
  const resumed=(await start(u,'spatial')).data
  assert.equal(resumed.resumed,true);assert.equal(resumed.session.id,s.id);assert.equal(resumed.session.answered,1)
  assert.ok(resumed.session.rounds[0].options.some(p=>p.correct))
  assert.ok(resumed.session.rounds[1].options.every(p=>p.correct===undefined))
  const wrong=resumed.session.rounds[1].options.find(p=>p.key!=='spatial-'+resumed.session.rounds[1].spelling).key
  assert.equal((await answer(u,s,1,[wrong])).data.answers[1].result,'incorrect')
  assert.equal((await answer(u,s,2,[],true)).data.answers[2].result,'skipped')
  const final=await answer(u,s,3,await correctKeys(s,3))
  assert.equal(final.data.answered,4)
  assert.ok((await queryOne('SELECT completed_at FROM image_recall_sessions WHERE id=?',[s.id])).completed_at)
  assert.equal((await queryOne('SELECT COUNT(*) n FROM user_word_progress WHERE user_id=?',[u.userId])).n,0)
  assert.equal((await queryOne('SELECT COUNT(*) n FROM ai_usage WHERE user_id=?',[u.userId])).n,0)
  const status=(await client.get('/api/v1/image-recall',auth(u))).data
  assert.equal(status.total,4);assert.equal(status.weak,2)
  const wrongSession=(await start(u,'mistakes')).data.session
  assert.equal(wrongSession.total,2)
  assert.ok(wrongSession.rounds.every(r=>r.options.length===4))
  assert.equal((await start(u,'due')).data.session,null)
  await execute('UPDATE image_recall_progress SET next_review_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE user_id=?',[u.userId])
  assert.equal((await start(u,'due')).data.session.total,4)
})

test('the server rejects forged answers and cross-account sessions; concurrent retries cannot pollute another account',async()=>{
  const u=await user(),v=await user(),s=(await start(u,'examples')).data.session
  assert.equal((await client.get('/api/v1/image-recall')).status,401)
  assert.equal((await answer(v,s,0,await correctKeys(s))).status,404)
  assert.equal((await answer(u,s,0,['forged-key'])).status,400)
  assert.equal((await answer(u,s,0,[],false)).status,400)
  assert.equal((await answer(u,s,1,await correctKeys(s,1))).status,409)
  assert.equal((await client.post(`/api/v1/image-recall/sessions/${s.id}/answers`,{...auth(u),body:{index:0,selectedKeys:[],correct:true}})).status,400)
  assert.equal((await queryOne('SELECT COUNT(*) n FROM image_recall_attempts WHERE session_id=?',[s.id])).n,0)
  assert.equal((await client.get('/api/v1/image-recall',auth(v))).data.total,0)
})

test('personal image selection creates exact-sense evidence with missed/extra details and book/account/time isolation',async()=>{
  const u=await user(),v=await user(),sense='光线',wordId=wordIds.light
  const image=await sharp({create:{width:16,height:16,channels:3,background:{r:180,g:160,b:130}}}).webp().toBuffer()
  await execute('INSERT INTO word_memory_images(user_id,word_id,sense_hash,image,image_revision,attempt_day) VALUES(?,?,UNHEX(?),?,?,UTC_DATE())',
    [u.userId,wordId,createHash('sha256').update(sense).digest('hex'),image,createHash('sha256').update(image).digest()])
  const s=(await start(u,'personal')).data.session
  assert.equal(s.total,1)
  const good=await correctKeys(s),wrong=s.rounds[0].options.find(p=>!good.includes(p.key)).key
  const result=await answer(u,s,0,[...good,wrong])
  assert.equal(result.data.answers[0].result,'incorrect')
  assert.equal(result.data.answers[0].extraKeys.length,1)
  assert.equal(result.data.answers[0].missedKeys.length,0)
  const events=await loadWordEvidence(u.userId,bookId,[wordId],new Date(Date.now()-3600000),new Date(Date.now()+1000))
  assert.equal(events.length,1);assert.equal(events[0].sense,sense);assert.equal(events[0].source,'image')
  assert.equal((await loadWordEvidence(v.userId,bookId,[wordId],new Date(0),new Date())).length,0)
  assert.equal((await loadWordEvidence(u.userId,bookId,[wordId],new Date(0),new Date(Date.now()-3600000))).length,0)
  assert.equal((await loadWordEvidence(u.userId,bookId+1000,[wordId],new Date(0),new Date())).length,0)
  const progress=await queryOne('SELECT * FROM image_recall_progress WHERE user_id=?',[u.userId])
  assert.equal(parseJson(progress.target,{}).sense,sense)
  const mistakes=(await client.get('/api/v1/words/collections?source=mistakes',auth(u))).data
  assert.ok(mistakes.items.some(word=>word.id===wordId&&word.imageWrongTimes===1))
  assert.equal((await client.get('/api/v1/words/collections?source=mistakes',auth(v))).data.items.some(word=>word.id===wordId),false)
  const previousSeen=progress.times_seen
  await answer(u,s,0,good)
  assert.equal((await queryOne('SELECT times_seen FROM image_recall_progress WHERE user_id=?',[u.userId])).times_seen,previousSeen)
  const recall=await client.post('/api/v1/recall',{...auth(u),body:{mode:'practice'}})
  assert.equal(recall.status,200)
  assert.ok(recall.data.session)
})
