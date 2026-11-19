import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { getTestServer,createClient,createOnboardedUser } from './helpers/setup.js'
import { config } from '../src/config.js'
import { query,queryOne,execute,withTransaction } from '../src/db/pool.js'
import { saveChallenge } from '../src/services/dialogueJourneyService.js'

async function fixture() {
  const server=await getTestServer(),client=createClient(server.baseUrl)
  const user=await createOnboardedUser(client),other=await createOnboardedUser(client)
  return {server,client,user,other,post:(path,body={})=>client.post(path,{token:user.token,body}),get:path=>client.get(path,{token:user.token})}
}
async function waitFinished(f,id){
  for(let i=0;i<150;i++){
    const r=await f.get(`/api/v1/practice/sessions/${id}`)
    if(r.data.status!=='analyzing')return r.data
    await delay(15)
  }
  assert.fail('report timeout')
}
function mockText(t,handler){
  const old={...config.ai};t.after(()=>Object.assign(config.ai,old))
  Object.assign(config.ai,{apiKey:'journey-test-key',baseUrl:'https://journey.example.test/v1'})
  const original=globalThis.fetch
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!String(url).startsWith('https://journey.example.test/'))return original(url,options)
    const body=JSON.parse(options.body),content=handler(body)
    return Response.json({choices:[{message:{content:JSON.stringify(content)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:40}})
  })
}
const report={summary:'完成了本次酒店任务。',corrections:[],weakWords:[],reinforcement:[],grammarWeaknesses:[]}
const reply={reply:'Thank you. What would you like to discuss next?',translation:'好的，接下来想讨论什么？',mixedLanguage:false,corrections:[],usedTargets:[],taskComplete:false}

test('optional vocabulary preparation persists without AI, skips safely and isolates accounts',async t=>{
  const f=await fixture(),oldKey=config.ai.apiKey;config.ai.apiKey='';t.after(()=>{config.ai.apiKey=oldKey})
  const started=await f.post('/api/v1/practice/sessions',{sceneId:'hotel',prepareWords:true})
  assert.equal(started.status,201,JSON.stringify(started.raw))
  let s=started.data;const path=`/api/v1/practice/sessions/${s.id}`
  assert.equal(s.messages.length,0);assert.equal(s.journey.phase,'preparation')
  assert.equal(s.journey.preparationQuestions,undefined)
  assert.equal(s.journey.preparation.questions[0].correctIndex,undefined)
  assert.equal((await f.client.get(path,{token:f.other.token})).status,404)
  assert.equal((await f.post(path+'/turns',{text:'Hello',expectedTurn:0})).status,409)
  assert.equal((await f.post(path+'/begin',{skip:true,expectedRevision:0})).status,503)
  const q=s.journey.preparation.questions[0]
  const first=await f.post(path+'/preparation',{questionId:q.id,selectedIndex:0,expectedRevision:0})
  assert.equal(first.status,200,JSON.stringify(first.raw));s=first.data
  const duplicate=await f.post(path+'/preparation',{questionId:q.id,selectedIndex:1,expectedRevision:0})
  assert.equal(duplicate.data.journey.preparation.answers.length,1)
  assert.equal((await f.get(path)).data.journey.preparation.answers.length,1)
  const old={...config.ai};Object.assign(config.ai,{apiKey:'test-key'})
  try{
    assert.equal((await f.post(path+'/begin',{skip:true,expectedRevision:0})).status,409)
    const begun=await f.post(path+'/begin',{skip:true,expectedRevision:s.journey.revision})
    assert.equal(begun.status,200);assert.equal(begun.data.messages.length,1)
    assert.equal(begun.data.journey.phase,'conversation');assert.equal(begun.data.turnCount,0)
  }finally{Object.assign(config.ai,old)}
  assert.equal(await queryOne('SELECT calls FROM dialogue_daily_usage WHERE user_id=?',[f.user.userId]),null)
})

test('partner switching is free, revision guarded, actor addressed and requires confirming a suggested handoff',async t=>{
  const f=await fixture();let calls=0,prompt
  mockText(t,body=>{calls++;prompt=body.messages[0].content;return {...reply,handoff:{actorId:'frontdesk',reason:'请前台核对入住信息'},goalEvidence:[null,{goalId:'goal-1',completed:true,quote:'invented text'}]}})
  let s=(await f.post('/api/v1/practice/sessions',{sceneId:'hotel'})).data
  const path=`/api/v1/practice/sessions/${s.id}`,role=s.scene.userRole
  assert.equal((await f.post(path+'/actor',{actorId:'not-here',expectedRevision:0,expectedTurn:0})).status,400)
  let r=await f.post(path+'/actor',{actorId:'manager',expectedRevision:0,expectedTurn:0})
  assert.equal(r.status,200,JSON.stringify(r.raw));s=r.data
  assert.equal(calls,0);assert.equal(s.turnCount,0);assert.equal(s.scene.userRole,role)
  assert.equal((await f.post(path+'/actor',{actorId:'companion',expectedRevision:0,expectedTurn:0})).status,409)
  assert.equal((await f.post(path+'/turns',{text:'Hello',expectedTurn:0,actorId:'frontdesk',expectedRevision:1})).status,409)
  r=await f.post(path+'/turns',{text:'Can I discuss my reservation?',expectedTurn:0,actorId:'manager',expectedRevision:1})
  assert.equal(r.status,200,JSON.stringify(r.raw));s=r.data
  assert.equal(calls,1);assert.match(prompt,/activeActor.*manager/)
  assert.equal(s.messages.find(m=>m.role==='user').recipientId,'manager')
  assert.equal(s.messages.at(-1).actorId,'manager');assert.equal(s.journey.handoff.actorId,'frontdesk')
  assert.equal(s.journey.activeActorId,'manager');assert.ok(s.journey.goals.every(g=>!g.completed))
  assert.equal((await f.client.post(path+'/actor',{token:f.other.token,body:{actorId:'frontdesk',expectedTurn:1,expectedRevision:s.journey.revision}})).status,404)
  s=(await f.post(path+'/actor',{actorId:'frontdesk',expectedTurn:1,expectedRevision:s.journey.revision})).data
  assert.equal(calls,1);assert.equal(s.turnCount,1);assert.equal(s.journey.handoff,null)
})

test('quoted goals award once, unlock a branch, and summary answers persist without inflating SRS',async t=>{
  const f=await fixture();let turn=0
  mockText(t,body=>{
    if(body.messages[0].content.includes('复盘教练'))return report
    const text=JSON.parse(body.messages.at(-1).content).currentUserText
    turn++
    return {...reply,usedTargets:turn===1?[{word:'reservation',sense:'预订',correct:true}]:[],goalEvidence:[{goalId:`goal-${turn}`,completed:true,quote:text}]}
  })
  let s=(await f.post('/api/v1/practice/sessions',{sceneId:'hotel'})).data
  const path=`/api/v1/practice/sessions/${s.id}`
  assert.equal((await f.post('/api/v1/practice/sessions',{sceneId:'hotel',challenge:'change_dates'})).status,400)
  for(const text of ['I have a reservation under my name.','Could you tell me about the room facilities?','I confirm breakfast at seven and checkout at eleven.']){
    const r=await f.post(path+'/turns',{text,expectedTurn:s.turnCount,expectedRevision:s.journey.revision,actorId:s.journey.activeActorId})
    assert.equal(r.status,200,JSON.stringify(r.raw));s=r.data
  }
  s=await waitFinished(f,s.id);assert.equal(s.status,'finished',JSON.stringify(s))
  assert.equal(s.report.challenge.completed,true);assert.equal(s.report.challenge.independent,true)
  assert.equal(s.report.challenge.transfer,false);assert.ok(s.report.challenge.unlock)
  assert.ok(s.consolidation.questions.some(q=>q.type==='phrase'))
  assert.ok(s.consolidation.questions.every(q=>q.answer===undefined&&q.correctIndex===undefined))
  assert.equal((await f.get('/api/v1/practice')).data.challengeProgress.hotelChangeUnlocked,true)
  const branch=await f.post('/api/v1/practice/sessions',{sceneId:'hotel',challenge:'change_dates',prepareWords:true})
  assert.equal(branch.status,201);assert.match(branch.data.scene.task,/周六/)
  const other=await f.client.get('/api/v1/practice',{token:f.other.token})
  assert.equal(other.data.challengeProgress.hotelChangeUnlocked,false)
  const before=await query('SELECT word_id,times_seen,times_correct,times_wrong FROM user_word_progress WHERE user_id=? ORDER BY word_id',[f.user.userId])
  let q=s.consolidation.questions[0]
  const body={action:'answer',questionId:q.id,selectedIndex:3,expectedRevision:s.journey.revision}
  const answers=await Promise.all([f.post(path+'/consolidation',body),f.post(path+'/consolidation',body)])
  for(const r of answers)assert.equal(r.status,200,JSON.stringify(r.raw))
  s=(await f.get(path)).data
  assert.equal(s.consolidation.answers.length,1)
  assert.equal((await query('SELECT * FROM dialogue_consolidation_attempts WHERE session_id=?',[s.id])).length,1)
  q=s.consolidation.questions[1]
  s=(await f.post(path+'/consolidation',{action:'hint',questionId:q.id,expectedRevision:s.journey.revision})).data
  const index=q.options.indexOf(s.consolidation.hint.correctAnswer)
  s=(await f.post(path+'/consolidation',{questionId:q.id,selectedIndex:index,expectedRevision:s.journey.revision})).data
  assert.equal(s.consolidation.answers[1].result,'hinted')
  for(q of s.consolidation.questions.slice(2)){
    s=(await f.post(path+'/consolidation',{questionId:q.id,skipped:true,expectedRevision:s.journey.revision})).data
  }
  const count=s.consolidation.questions.length
  s=(await f.post(path+'/consolidation',{action:'reset',expectedRevision:s.journey.revision})).data
  assert.equal(s.consolidation.run,2);assert.equal(s.consolidation.answers.length,0);assert.equal(s.consolidation.hint,undefined)
  assert.equal((await query('SELECT * FROM dialogue_consolidation_attempts WHERE session_id=?',[s.id])).length,count)
  assert.deepEqual(await query('SELECT word_id,times_seen,times_correct,times_wrong FROM user_word_progress WHERE user_id=? ORDER BY word_id',[f.user.userId]),before)
  await f.post(path+'/finish')
  assert.equal((await query('SELECT * FROM dialogue_challenge_results WHERE session_id=?',[s.id])).length,1)
})

test('image status never generates; explicit requests deduplicate, enforce quotas and keep images private',async t=>{
  const f=await fixture(),old={...config.wordImages};t.after(()=>Object.assign(config.wordImages,old))
  Object.assign(config.wordImages,{apiKey:'scene-test-image',model:'test-image',baseUrl:'https://scene-images.example.test/v1',dailyQuota:1,siliconFlow:false})
  let textCalls=0,imageCalls=0,imagePrompt
  const held=Promise.withResolvers()
  mockText(t,body=>{
    textCalls++
    assert.match(body.messages[0].content,/不把未做出的用户选择/)
    const input=JSON.parse(body.messages[1].content)
    return {scene:'One hotel receptionist hands a blank key card to a guest, with a breakfast tray nearby.',cues:input.targets.map(target=>({...target,kind:'context',visual:'A hotel desk with blank key cards and a breakfast tray.'})),limitations:'抽象义由酒店情境间接提示，图片不能验证掌握。'}
  })
  const textFetch=globalThis.fetch
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url)!=='https://scene-images.example.test/v1/images/generations')return textFetch(url,options)
    imageCalls++;imagePrompt=JSON.parse(options.body).prompt;return held.promise
  })
  const s=(await f.post('/api/v1/practice/sessions',{sceneId:'hotel',prepareWords:true})).data
  const path=`/api/v1/practice/sessions/${s.id}/scene-image`
  assert.equal((await f.get(path)).data.status,'empty');assert.equal(textCalls,0);assert.equal(imageCalls,0)
  const responses=await Promise.all([f.post(path),f.post(path)])
  for(const r of responses)assert.equal(r.status,200,JSON.stringify(r.raw))
  for(let i=0;i<50&&imageCalls===0;i++)await delay(10)
  assert.equal(textCalls,1);assert.equal(imageCalls,1);assert.match(imagePrompt,/no.*text|No.*text|letters/i)
  const bytes=await sharp({create:{width:640,height:640,channels:3,background:'#eeeeee'}}).webp().toBuffer()
  held.resolve(Response.json({data:[{b64_json:bytes.toString('base64')}]}))
  let status
  for(let i=0;i<100;i++){status=(await f.get(path)).data;if(status.status!=='pending')break;await delay(15)}
  assert.equal(status.status,'ready',JSON.stringify(status));assert.equal(textCalls,1)
  const url=f.server.baseUrl+'/api/v1'+status.imagePath
  assert.equal((await fetch(url)).status,401)
  assert.equal((await fetch(url,{headers:{Authorization:`Bearer ${f.other.token}`}})).status,404)
  const image=await fetch(url,{headers:{Authorization:`Bearer ${f.user.token}`}})
  assert.equal(image.status,200);assert.match(image.headers.get('cache-control'),/private/)
  assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width,640)
  assert.equal((await f.post(path)).data.status,'ready');assert.equal(imageCalls,1)
  assert.equal((await f.post(path,{regenerate:true})).status,429)
  assert.equal((await f.client.get(path,{token:f.other.token})).status,404)
})

test('cross-day reward requires a prior independent different-context task with the same exact meaning',async()=>{
  const f=await fixture()
  async function snapshot(challenge='standard'){
    const s=(await f.post('/api/v1/practice/sessions',{sceneId:'hotel',prepareWords:true})).data
    s.turnCount=3;s.journey.goals.forEach(g=>Object.assign(g,{completed:true,independent:true,quote:'I confirm my reservation.'}))
    s.targetUsage[0].status='independent'
    if(challenge!=='standard'){
      s.scene.challenge=challenge;s.scene.task+=' Different task '+challenge
    }
    return s
  }
  async function save(s){return withTransaction(conn=>saveChallenge(conn,f.user.userId,s))}
  const first=await snapshot(),r1=await save(first)
  assert.equal(r1.completed,true);assert.equal(r1.transfer,false)
  const sameDay=await snapshot('same-day');assert.equal((await save(sameDay)).transfer,false)
  await execute('UPDATE dialogue_challenge_results SET earned_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 25 HOUR) WHERE session_id=?',[first.id])
  const sameContext=await snapshot();assert.equal((await save(sameContext)).transfer,false)
  const otherSense=await snapshot('other-sense');otherSense.scene.targets.forEach(t=>{t.sense='另一词义'})
  assert.equal((await save(otherSense)).transfer,false)
  const different=await snapshot('changed-context');assert.equal((await save(different)).transfer,true)
  const helped=await snapshot('helped');helped.helpEvents=[{level:4}]
  const result=await save(helped);assert.equal(result.completed,true);assert.equal(result.independent,false);assert.equal(result.transfer,false)
  const incomplete=await snapshot('incomplete');incomplete.journey.goals[1].completed=false
  assert.equal((await save(incomplete)).completed,false)
})

test('failed scene planning retains the dialogue and quota reservation without starting image generation',async t=>{
  const f=await fixture(),old={...config.wordImages};t.after(()=>Object.assign(config.wordImages,old))
  Object.assign(config.wordImages,{apiKey:'mock-key',model:'mock',dailyQuota:2})
  let calls=0;mockText(t,()=>{calls++;return {scene:'invalid plan'}})
  const s=(await f.post('/api/v1/practice/sessions',{sceneId:'hotel',prepareWords:true})).data
  const base=`/api/v1/practice/sessions/${s.id}`,path=base+'/scene-image'
  assert.equal((await f.post(path)).status,200)
  let status
  for(let i=0;i<100;i++){status=(await f.get(path)).data;if(status.status!=='pending')break;await delay(10)}
  assert.equal(status.status,'failed');assert.equal(status.imagePath,null)
  assert.equal((await f.get(base)).data.journey.phase,'preparation')
  assert.equal(calls,1)
  assert.equal(Number((await queryOne('SELECT calls FROM dialogue_daily_usage WHERE user_id=?',[f.user.userId])).calls),1)
  await execute('UPDATE dialogue_daily_usage SET calls=200 WHERE user_id=?',[f.user.userId])
  assert.equal((await f.post(path)).status,429);assert.equal(calls,1)
  assert.equal(Number((await queryOne('SELECT daily_attempts FROM dialogue_scene_images WHERE session_id=?',[s.id])).daily_attempts),1)
})
