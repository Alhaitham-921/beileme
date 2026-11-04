import test from 'node:test'
import assert from 'node:assert/strict'
import {getTestServer,createClient,createOnboardedUser} from './helpers/setup.js'
import {config} from '../src/config.js'
import {query,queryOne,execute} from '../src/db/pool.js'
import {restoreFailedDialogueReport} from '../src/services/dialogueService.js'
async function waitReport(client,user,id){
 for(let i=0;i<200;i++){
  const r=await client.get('/api/v1/practice/sessions/'+id,{token:user.token})
  if(r.data.status!=='analyzing')return r.data
  await new Promise(resolve=>setTimeout(resolve,10))
 }
 assert.fail('report did not complete')
}
function provider(t,{failReport=false}={}){
 const originalFetch=globalThis.fetch,originalKey=config.ai.apiKey
 config.ai.apiKey='report-regression-test-key'
 let reports=0,calls=0
 globalThis.fetch=async(url,options)=>{
  if(!String(url).endsWith('/chat/completions'))return originalFetch(url,options)
  calls++;const body=JSON.parse(options.body),isReport=body.messages[0].content.includes('复盘教练')
  let value
  if(isReport){reports++;value=failReport?{}:{summary:'你完成了河岸交流，可以继续练习过去时。',corrections:[],weakWords:[],reinforcement:[],grammarWeaknesses:[{type:'tense',description:'注意过去时',count:2}]}}
  else {
   const text=JSON.parse(body.messages.at(-1).content).currentUserText
   const correction=text==='Yesterday I go to the river bank.'?{type:'grammar',original:'go',replacement:'went',explanation:'使用过去时',grammarTag:'tense'}
    :text==='Last night I walk along the river bank.'?{type:'grammar',original:'walk',replacement:'walked',explanation:'使用过去时',grammarTag:'tense'}:null
   value={reply:'There is a quiet path along the river. What else would you like to know?',translation:'',mixedLanguage:false,corrections:correction?[correction]:[],usedTargets:text.includes('bank')?[{word:'bank',sense:'河岸',correct:true}]:[],taskComplete:false}
  }
  return Response.json({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:30,completion_tokens:70}})
 }
 t.after(()=>{globalThis.fetch=originalFetch;config.ai.apiKey=originalKey})
 return{get reports(){return reports},get calls(){return calls}}
}
test('17-turn dialogue finishes with provider grammar objects in one report call and keeps full history',async t=>{
 const server=await getTestServer(),client=createClient(server.baseUrl),user=await createOnboardedUser(client),p=provider(t)
 const created=await client.post('/api/v1/practice/sessions',{token:user.token,body:{sceneId:'bank',mode:'free',maxTurns:24}})
 assert.equal(created.status,201);const id=created.data.id,base='/api/v1/practice/sessions/'+id
 const texts=['Yesterday I go to the river bank.','Last night I walk along the river bank.',...Array(15).fill('Thank you for the information.')]
 for(let i=0;i<texts.length;i++)assert.equal((await client.post(base+'/turns',{token:user.token,body:{text:texts[i],expectedTurn:i}})).status,200)
 assert.equal((await client.post(base+'/finish',{token:user.token})).status,200)
 const finished=await waitReport(client,user,id)
 assert.equal(finished.status,'finished');assert.equal(finished.reportAttempts,1);assert.equal(p.reports,1)
 assert.equal(finished.messages.filter(m=>m.role==='user').length,17)
 assert.deepEqual(finished.report.grammarWeaknesses,['时态'])
 const before=await query('SELECT * FROM dialogue_word_evidence WHERE session_id=?',[id])
 await client.post(base+'/finish',{token:user.token});assert.equal(p.reports,1)
 assert.equal((await query('SELECT * FROM dialogue_word_evidence WHERE session_id=?',[id])).length,before.length)
})
test('operator restores a capped failed report from saved response exactly once without model calls or raising limits',async t=>{
 const server=await getTestServer(),client=createClient(server.baseUrl),user=await createOnboardedUser(client),other=await createOnboardedUser(client),p=provider(t,{failReport:true})
 const created=await client.post('/api/v1/practice/sessions',{token:user.token,body:{sceneId:'bank'}})
 const id=created.data.id,base='/api/v1/practice/sessions/'+id
 await client.post(base+'/help',{token:user.token,body:{level:4,word:'bank',expectedTurn:0}})
 assert.equal((await client.post(base+'/turns',{token:user.token,body:{text:'Is there a path along the river bank nearby?',expectedTurn:0}})).status,200)
 await client.post(base+'/finish',{token:user.token});const failed=await waitReport(client,user,id);assert.equal(failed.status,'report_failed')
 await execute("UPDATE dialogue_sessions SET state=JSON_SET(state,'$.reportAttempts',3) WHERE id=?",[id])
 assert.equal((await client.post(base+'/retry-report',{token:user.token})).status,400)
 const calls=p.calls,beforeUsage=await queryOne('SELECT * FROM dialogue_daily_usage WHERE user_id=?',[user.userId])
 const raw={summary:'已保留对话，接下来独立练习bank。',corrections:[],weakWords:['bank'],reinforcement:[],grammarWeaknesses:[{type:'tense',count:99}]}
 await assert.rejects(restoreFailedDialogueReport(other.userId,id,{raw,expectedTurn:1}),error=>error.status===404)
 await assert.rejects(restoreFailedDialogueReport(user.userId,id,{raw,expectedTurn:2}),error=>error.status===409)
 await assert.rejects(restoreFailedDialogueReport(user.userId,id,{raw:{},expectedTurn:1}))
 assert.equal((await client.get(base,{token:user.token})).data.status,'report_failed')
 const repaired=await restoreFailedDialogueReport(user.userId,id,{raw,expectedTurn:1,usage:{promptTokens:10,completionTokens:30}})
 assert.equal(repaired.status,'finished');assert.equal(repaired.reportAttempts,3);assert.equal(p.calls,calls)
 assert.equal(repaired.messages.filter(m=>m.role==='user').length,1);assert.deepEqual(repaired.report.grammarWeaknesses,[])
 assert.equal(repaired.reportRecovery.source,'saved_provider_response');assert.ok(repaired.report.reviewWords.some(w=>w.spelling==='bank'))
 const evidence=await query('SELECT * FROM dialogue_word_evidence WHERE session_id=?',[id])
 const firstSeen=await queryOne('SELECT times_seen FROM user_word_progress WHERE user_id=? AND word_id=?',[user.userId,repaired.report.reviewWords.find(w=>w.spelling==='bank').id])
 await restoreFailedDialogueReport(user.userId,id,{raw,expectedTurn:1,usage:{promptTokens:10,completionTokens:30}})
 assert.equal((await query('SELECT * FROM dialogue_word_evidence WHERE session_id=?',[id])).length,evidence.length)
 assert.equal((await queryOne('SELECT times_seen FROM user_word_progress WHERE user_id=? AND word_id=?',[user.userId,repaired.report.reviewWords.find(w=>w.spelling==='bank').id])).times_seen,firstSeen.times_seen)
 assert.equal(p.calls,calls);assert.deepEqual(await queryOne('SELECT * FROM dialogue_daily_usage WHERE user_id=?',[user.userId]),beforeUsage)
})
