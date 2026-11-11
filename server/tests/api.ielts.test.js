import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { getTestServer,createClient,createOnboardedUser } from './helpers/setup.js'
import { execute,queryOne,query } from '../src/db/pool.js'
import { config } from '../src/config.js'
import { seedPapers } from '../data/ielts/catalog.js'
import { grantCredits,reserveUsage,settleUsage,wallet,savePreferences,resolveTrainingProvider } from '../src/services/platform/access.js'
import { resolveProvider } from '../src/services/ai/apiKeyService.js'
import { processOneJob,startJobWorker } from '../src/services/ielts/jobs.js'

const key=()=>crypto.randomUUID()
async function fixture(skill='reading',status='published'){
  const client=createClient((await getTestServer()).baseUrl),user=await createOnboardedUser(client),other=await createOnboardedUser(client)
  const paper=structuredClone(seedPapers.find(p=>p.skill===skill))
  paper.code=`test-${key()}`
  const row=await execute('INSERT INTO ielts_papers(code,skill,title,status,body,source_info) VALUES(?,?,?,?,?,?)',[paper.code,paper.skill,paper.title,status,JSON.stringify(paper),JSON.stringify(paper.source)])
  return {client,user,other,paper,paperId:Number(row.insertId)}
}

test('IELTS draft visibility, immutable versions and admin ownership',async()=>{
  const {client,user,paperId}=await fixture('reading','draft')
  const list=await client.get('/api/v1/ielts/papers',{token:user.token})
  assert.equal(list.status,200,JSON.stringify(list.raw));assert.ok(!list.data.papers.some(p=>p.id===paperId))
  assert.equal((await client.post('/api/v1/ielts/attempts',{token:user.token,body:{paperId,mode:'practice',requestKey:key()}})).status,404)
  assert.equal((await client.get('/api/v1/ielts/admin/papers',{token:user.token})).status,403)
})
test('IELTS autosave revisions, hidden answers, account isolation and idempotent marking',async()=>{
  const {client,user,other,paper,paperId}=await fixture()
  const requestKey=key()
  const first=await client.post('/api/v1/ielts/attempts',{token:user.token,body:{paperId,mode:'practice',requestKey}})
  assert.equal(first.status,201,JSON.stringify(first.raw));const id=first.data.id
  assert.equal(first.data.paper.questions[0].answer,undefined)
  const again=await client.post('/api/v1/ielts/attempts',{token:user.token,body:{paperId,mode:'practice',requestKey}})
  assert.equal(again.data.id,id)
  const save=await client.put(`/api/v1/ielts/attempts/${id}`,{token:user.token,body:{revision:0,answers:{q1:'March'},annotations:{highlights:['p1:0'],flags:['q2']}}})
  assert.equal(save.status,200,JSON.stringify(save.raw));assert.equal(save.data.revision,1)
  const restored=await client.get(`/api/v1/ielts/attempts/${id}`,{token:user.token});assert.deepEqual(restored.data.annotations,{highlights:['p1:0'],flags:['q2']})
  assert.equal((await client.put(`/api/v1/ielts/attempts/${id}`,{token:user.token,body:{revision:0,answers:{q1:'forged'}}})).status,409)
  assert.equal((await client.get(`/api/v1/ielts/attempts/${id}`,{token:other.token})).status,404)
  const submit=()=>client.put(`/api/v1/ielts/attempts/${id}`,{token:user.token,body:{revision:1,answers:{q1:'March'},action:'submit'}})
  const report=await submit();assert.equal(report.status,200,JSON.stringify(report.raw));assert.equal(report.data.report.correct,1);assert.deepEqual(report.data.paper.questions[0].answer,paper.questions[0].answer)
  await submit()
  const count=await queryOne('SELECT COUNT(*) n FROM learning_evidence WHERE user_id=?',[user.userId]);assert.equal(Number(count.n),40)
})
test('IELTS mock deadline uses persisted answers and cannot be paused or extended by reload',async()=>{
  const {client,user,paperId}=await fixture()
  const created=await client.post('/api/v1/ielts/attempts',{token:user.token,body:{paperId,mode:'mock',requestKey:key()}})
  const id=created.data.id,deadline=created.data.deadlineAt
  const reload=await client.get(`/api/v1/ielts/attempts/${id}`,{token:user.token});assert.equal(reload.data.deadlineAt,deadline)
  assert.equal((await client.put(`/api/v1/ielts/attempts/${id}`,{token:user.token,body:{revision:0,answers:{},action:'pause'}})).status,400)
  await execute('UPDATE ielts_attempts SET deadline_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE id=?',[id])
  const late=await client.put(`/api/v1/ielts/attempts/${id}`,{token:user.token,body:{revision:0,answers:{q1:'March'},action:'submit'}})
  assert.equal(late.data.state,'submitted');assert.equal(late.data.report.correct,0);assert.deepEqual(late.data.answers,{})
})
test('IELTS writing versions preserve old text and profiles validate half-band steps',async()=>{
  const {client,user,paperId}=await fixture('writing')
  const a=await client.post('/api/v1/ielts/attempts',{token:user.token,body:{paperId,requestKey:key()}})
  await client.put(`/api/v1/ielts/attempts/${a.data.id}`,{token:user.token,body:{revision:0,answers:{task1:'First draft.'}}})
  await client.put(`/api/v1/ielts/attempts/${a.data.id}`,{token:user.token,body:{revision:1,answers:{task1:'Revised draft.'}}})
  const versions=await client.get(`/api/v1/ielts/attempts/${a.data.id}/versions`,{token:user.token});assert.equal(versions.data.versions[1].answers.task1,'First draft.')
  assert.equal((await client.put('/api/v1/ielts/profile',{token:user.token,body:{targetBand:6.3,skillTargets:{},dailyMinutes:30}})).status,400)
  const overview=await client.get('/api/v1/ielts/overview',{token:user.token});assert.equal(overview.status,200,JSON.stringify(overview.raw))
})
test('platform reservations serialize concurrent spend, settle once, and release failures',async()=>{
  const {user}=await fixture()
  const grantKey=key();await grantCredits(user.userId,1,grantKey,0);await grantCredits(user.userId,1,grantKey,0)
  assert.equal((await wallet(user.userId)).available,1)
  const one=`test:${key()}`,two=`test:${key()}`
  const results=await Promise.allSettled([reserveUsage({userId:user.userId,requestKey:one,kind:'test',source:'server'}),reserveUsage({userId:user.userId,requestKey:two,kind:'test',source:'server'})])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  const used=results.find(r=>r.status==='fulfilled').value.request_key
  await settleUsage(used,false,{error:'mocked upstream failure'});assert.equal((await wallet(user.userId)).available,1)
  const last=`test:${key()}`;await reserveUsage({userId:user.userId,requestKey:last,kind:'test',source:'server'});await settleUsage(last,true);await settleUsage(last,true)
  assert.equal((await wallet(user.userId)).available,0)
})
test('vocabulary evidence separates abilities, stores real FSRS shadow and deduplicates retries',async()=>{
  const {client,user}=await fixture()
  const requestKey=key(),body={cardId:'v1',ability:'spelling',answer:'sustainable',requestKey}
  const first=await client.post('/api/v1/ielts/vocabulary/answers',{token:user.token,body})
  assert.equal(first.status,200,JSON.stringify(first.raw));assert.equal(first.data.correct,true);assert.ok(first.data.shadow.card)
  const repeat=await client.post('/api/v1/ielts/vocabulary/answers',{token:user.token,body});assert.equal(repeat.status,200)
  const later=await client.post('/api/v1/ielts/vocabulary/answers',{token:user.token,body:{...body,requestKey:key()}});assert.equal(later.status,200,JSON.stringify(later.raw))
  const listening=await client.post('/api/v1/ielts/vocabulary/answers',{token:user.token,body:{...body,ability:'listening',answer:'wrong',requestKey:key()}});assert.equal(listening.status,200)
  const rows=await query("SELECT ability,correct FROM learning_evidence WHERE user_id=? AND skill='vocabulary'",[user.userId]);assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.ability==='listening')[0].correct,0)
})
test('existing authentication retains its original Bearer transport when IELTS is added',async()=>{
  const server=await getTestServer(),email=`cookie-${key()}@example.com`
  const headers={'Content-Type':'application/json','X-Session-Transport':'web',Origin:config.corsOrigins[0]}
  const response=await fetch(`${server.baseUrl}/api/v1/auth/register`,{method:'POST',headers,body:JSON.stringify({email,password:'Passw0rd123'})})
  assert.equal(response.status,201);const data=(await response.json()).data
  assert.equal(typeof data.tokens.refreshToken,'string');assert.equal(data.tokens.tokenType,'Bearer')
  assert.equal(response.headers.get('set-cookie'),null)
  const refreshed=await fetch(`${server.baseUrl}/api/v1/auth/refresh`,{method:'POST',headers,body:JSON.stringify({refreshToken:data.tokens.refreshToken})});assert.equal(refreshed.status,200)
})

test('IELTS provider preferences do not change the existing scenario and word-learning provider',async()=>{
  const {user}=await fixture()
  const previous=config.ai.apiKey
  config.ai.apiKey='test-only-existing-platform-key'
  try{
    await savePreferences(user.userId,{textMode:'byok'})
    assert.equal((await resolveTrainingProvider(user.userId)).source,'none')
    assert.equal((await resolveProvider(user.userId)).source,'server')
    await savePreferences(user.userId,{textMode:'platform'})
    assert.equal((await resolveTrainingProvider(user.userId)).source,'server')
    assert.equal((await resolveProvider(user.userId)).source,'server')
  }finally{config.ai.apiKey=previous}
})

test('durable AI reports debit only validated results, failures release credits and restart does not repeat paid work',async()=>{
  const {client,user,other,paperId}=await fixture('writing')
  const a=await client.post('/api/v1/ielts/attempts',{token:user.token,body:{paperId,requestKey:key()}})
  const text='I think public libraries should provide useful community services.'
  await client.put(`/api/v1/ielts/attempts/${a.data.id}`,{token:user.token,body:{revision:0,answers:{task1:text},action:'submit'}})
  await grantCredits(user.userId,3,key(),0)
  const originalFetch=globalThis.fetch,originalKey=config.ai.apiKey
  config.ai.apiKey='test-only-feedback-key'
  let invented=false,calls=0
  globalThis.fetch=async(url,options)=>{
    if(!String(url).endsWith('/chat/completions'))return originalFetch(url,options)
    calls++
    const content={summary:'可以进一步展开观点',criteria:['task','coherence','lexical','grammar'].map(key=>({key,feedback:'请增加具体说明。',band:6,evidence:[{questionId:'task1',quote:'public libraries'}]})),corrections:invented?[{questionId:'task1',quote:'this was never written',replacement:'x',explanation:'invalid'}]:[]}
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:200}}),{status:200})
  }
  try{
    const requestKey=key(),endpoint=`/api/v1/ielts/attempts/${a.data.id}/feedback`
    const first=await client.post(endpoint,{token:user.token,body:{requestKey}});assert.equal(first.status,202,JSON.stringify(first.raw))
    await processOneJob({fetchImpl:globalThis.fetch})
    const report=await client.get(`/api/v1/ielts/jobs/${first.data.id}`,{token:user.token});assert.equal(report.data.state,'succeeded');assert.ok(report.data.result.criteria[0].evidence.length);assert.equal((await wallet(user.userId)).available,2)
    const repeated=await client.post(endpoint,{token:user.token,body:{requestKey}});assert.equal(repeated.data.id,first.data.id);assert.equal(calls,1)
    assert.equal((await client.get(`/api/v1/ielts/jobs/${first.data.id}`,{token:other.token})).status,404)
    assert.ok(!JSON.stringify(report.raw).includes('test-only-feedback-key'))
    invented=true
    const failed=await client.post(endpoint,{token:user.token,body:{requestKey:key()}});await processOneJob({fetchImpl:globalThis.fetch})
    assert.equal((await client.get(`/api/v1/ielts/jobs/${failed.data.id}`,{token:user.token})).data.state,'failed');assert.equal((await wallet(user.userId)).available,2)
    const pending=await client.post(endpoint,{token:user.token,body:{requestKey:key()}})
    await execute("UPDATE ai_jobs SET state='running' WHERE id=?",[pending.data.id])
    await reserveUsage({userId:user.userId,requestKey:`ielts-job:${pending.data.id}`,kind:'writing-feedback',source:'server'})
    const stop=await startJobWorker();stop()
    assert.equal((await client.get(`/api/v1/ielts/jobs/${pending.data.id}`,{token:user.token})).data.state,'interrupted');assert.equal((await wallet(user.userId)).reserved,0);assert.equal(calls,2)
  }finally{globalThis.fetch=originalFetch;config.ai.apiKey=originalKey}
})
