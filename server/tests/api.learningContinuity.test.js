import test from 'node:test'
import assert from 'node:assert/strict'
import {getTestServer,createClient,createOnboardedUser,correctOptionIndex} from './helpers/setup.js'
import {queryOne,execute,withTransaction} from '../src/db/pool.js'
import {followupCandidates,saveFollowups} from '../src/services/practiceFollowups.js'
import {taskCap} from '../src/services/studyWorkload.js'

const source=()=>({scene:{title:'酒店入住',location:'酒店前台',targets:[{word:'reservation',sense:'预订',example:'I have a reservation.'}]},messages:[{role:'assistant',text:'Do you have a reservation?'},{role:'user',text:'I has a reservation.'}],targetUsage:[{word:'reservation',status:'independent'}]})
const report=()=>({evidence:[{word:'reservation',status:'weak',helpLevel:0}],corrections:[{originalSentence:'I has a reservation.',explanation:'主语 I 搭配 have。'}],reinforcement:[],reviewWords:[]})
async function fixture(user,session,details){const row=await execute("INSERT INTO dialogue_sessions(user_id,scene,status,state) VALUES(?,'hotel','finished',?)",[user.userId,JSON.stringify({...session,report:details})]);return {...session,id:Number(row.insertId)}}

test('followups ground quotations in learner text, prefer report evidence and do not invent attempts',()=>{
 const s=source(),r=report(),tasks=followupCandidates(s,r)
 assert.equal(followupCandidates(s,{evidence:r.evidence})[0].quote,'I has a reservation.');
 assert.equal(tasks.length,1);assert.equal(tasks[0].quote,'I has a reservation.');assert.match(tasks[0].explanation,/have/)
 assert.equal(followupCandidates({...s,messages:[]},r).length,0)
 const unused=followupCandidates({...s,messages:[{role:'assistant',text:'I have a reservation.'},{role:'user',text:'Hello!'}]},{targetUsage:{reservation:{word:'reservation',status:'unused'}}})
 assert.equal(unused[0].quote,'');assert.match(unused[0].reason,/尚未尝试/)
 assert.equal(followupCandidates(s,{evidence:[{word:'reservation',status:'independent'}]}).length,0)
})

test('practice followups backfill once, retain saved short answers and enforce account ownership',async()=>{
 const client=createClient((await getTestServer()).baseUrl),user=await createOnboardedUser(client),other=await createOnboardedUser(client)
 await fixture(user,source(),report())
 const list=()=>client.get('/api/v1/practice/followups',{token:user.token})
 const first=await list();assert.equal(first.status,200,JSON.stringify(first.raw));assert.equal(first.data.tasks.length,1)
 const task=first.data.tasks[0];assert.equal(task.quote,'I has a reservation.');assert.equal(task.status,'pending');assert.ok(new Date(task.nextCheckAt)>new Date())
 assert.equal((await client.get('/api/v1/practice/followups/'+task.id,{token:other.token})).status,404)
 assert.equal((await client.post('/api/v1/practice/followups/'+task.id+'/short',{token:other.token,body:{answer:'private'}})).status,404)
 const saved=await client.post('/api/v1/practice/followups/'+task.id+'/short',{token:user.token,body:{answer:'I have a reservation.'}})
 assert.equal(saved.status,200);assert.match(saved.data.message,/不会自动/)
 const again=await list();assert.equal(again.data.tasks.length,1);assert.equal(again.data.tasks[0].practiceAnswer,'I have a reservation.');assert.equal(again.data.tasks[0].status,'pending');assert.equal(again.data.tasks[0].nextCheckAt,task.nextCheckAt)
 assert.equal((await client.get('/api/v1/practice/followups',{token:other.token})).data.tasks.length,0)
})

test('only independent production in another setting completes a transfer task',async()=>{
 const client=createClient((await getTestServer()).baseUrl),user=await createOnboardedUser(client)
 const original=await fixture(user,source(),report());await withTransaction(c=>saveFollowups(c,user.userId,original,report()))
 const task=await queryOne('SELECT * FROM practice_followups WHERE user_id=?',[user.userId])
 const next={...source(),scene:{...source().scene,followupId:Number(task.id)},messages:[{role:'user',text:'I have a reservation.'}]}
 const fresh=await fixture(user,next,{}),independent={evidence:[{word:'reservation',status:'independent'}]}
 await withTransaction(c=>saveFollowups(c,user.userId,fresh,independent))
 assert.equal((await queryOne('SELECT status FROM practice_followups WHERE id=?',[task.id])).status,'pending')
 fresh.scene.location='餐厅';await withTransaction(c=>saveFollowups(c,user.userId,fresh,{evidence:[{word:'reservation',status:'assisted',helpLevel:3}]}))
 assert.equal((await queryOne('SELECT status FROM practice_followups WHERE id=?',[task.id])).status,'pending')
 await withTransaction(c=>saveFollowups(c,user.userId,fresh,independent))
 assert.equal((await queryOne('SELECT status FROM practice_followups WHERE id=?',[task.id])).status,'independent')
})

test('manual followup schedules enter the next group once per word and survive until an answer', async () => {
 const client = createClient((await getTestServer()).baseUrl)
 const user = await createOnboardedUser(client)
 const other = await createOnboardedUser(client)
 const word = await queryOne('SELECT id FROM words ORDER BY id LIMIT 1')
 const original = await fixture(user, source(), report())
 const tasksPath = '/api/v1/practice/followups'
 const list = () => client.get(tasksPath + '?sourceId=' + original.id, { token: user.token })
 const task = (await list()).data.tasks[0]
 await execute('UPDATE practice_followups SET word_id=? WHERE id=?', [word.id, task.id])
 const schedulePath = tasksPath + '/' + task.id + '/schedule'
 const schedule = body => client.post(schedulePath, { token: user.token, body })
 const createGroup = (token = user.token) => client.post('/api/v1/study/sessions', { token, body: { studyMode: 'review-only' } })
 const future = new Date(Date.now() + 3_600_000).toISOString()

 assert.equal((await client.post(schedulePath, { token: other.token, body: { mode: 'next' } })).status, 404)
 assert.equal((await schedule({ mode: 'time', scheduledAt: new Date(0).toISOString() })).status, 400)
 const scheduled = await schedule({ mode: 'time', scheduledAt: future })
 assert.equal(scheduled.status, 200, JSON.stringify(scheduled.raw))
 assert.equal((await list()).data.tasks[0].scheduledAt, future)
 assert.equal((await createGroup()).data.items.length, 0)
 await execute('UPDATE practice_followups SET scheduled_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?', [task.id])
 assert.equal((await createGroup()).data.items[0].wordId, Number(word.id))
 assert.equal((await list()).data.tasks[0].scheduleMode, 'time')

 const next = await schedule({ mode: 'next' })
 assert.equal(next.status, 200, JSON.stringify(next.raw))
 assert.equal(next.data.remainingDueCount, 1)
 assert.equal((await createGroup(other.token)).data.items.length, 0)
 const group = await createGroup()
 assert.equal(group.status, 201, JSON.stringify(group.raw))
 assert.equal(group.data.items.length, 1)
 const { session, items: [item] } = group.data
 assert.equal(item.wordId, Number(word.id))
 assert.match(item.reviewReason, /情境练习/)
 const result = await client.post('/api/v1/study/sessions/' + session.id + '/answers', {
  token: user.token, body: { wordId: item.wordId, optionIndex: await correctOptionIndex(session.id, item.wordId), hesitationMs: 800 },
 })
 assert.equal(result.status, 201, JSON.stringify(result.raw))
 const after = (await list()).data.tasks[0]
 assert.equal(after.scheduleMode, null)
 assert.equal(after.status, 'pending')
})

test('short grading accepts alternative wording and keeps failed model output separate from learning records', async () => {
 const client = createClient((await getTestServer()).baseUrl)
 const user = await createOnboardedUser(client)
 const other = await createOnboardedUser(client)
 const original = await fixture(user, source(), report())
 const tasksPath = '/api/v1/practice/followups'
 const list = () => client.get(tasksPath + '?sourceId=' + original.id, { token: user.token })
 const task = (await list()).data.tasks[0]
 const path = tasksPath + '/' + task.id + '/grade'
 const answer = 'My reservation is under Lee.'
 assert.equal((await client.post(path, { token: other.token, body: { answer } })).status, 404)

 const { config } = await import('../src/config.js')
 const oldKey = config.ai.apiKey
 const oldFetch = globalThis.fetch
 config.ai.apiKey = 'followup-test-only'
 let feedback = { verdict: 'correct', explanation: '用 reservation 表达预订自然且符合题意。', revision: '' }
 globalThis.fetch = async (url, options) => {
  if (!String(url).endsWith('/chat/completions')) return oldFetch(url, options)
  const request = JSON.parse(options.body)
  assert.deepEqual(JSON.parse(request.messages[1].content), { word: 'reservation', sense: '预订', prompt: task.prompt, answer })
  return Response.json({ choices: [{ message: { content: JSON.stringify(feedback) }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 15 } })
 }
 try {
  const graded = await client.post(path, { token: user.token, body: { answer } })
  assert.equal(graded.status, 200, JSON.stringify(graded.raw))
  assert.deepEqual(graded.data.feedback, feedback)
  feedback = { verdict: 'invalid' }
  const failed = await client.post(path, { token: user.token, body: { answer } })
  assert.equal(failed.status, 503, JSON.stringify(failed.raw))
  const after = (await list()).data.tasks[0]
  assert.equal(after.practiceAnswer, undefined)
  assert.equal(after.status, 'pending')
  assert.equal(after.nextCheckAt, task.nextCheckAt)
 } finally {
  config.ai.apiKey = oldKey
  globalThis.fetch = oldFetch
 }
})

test('time budgets cap the group without changing the daily plan and pause retains unanswered work',async()=>{
 assert.equal(taskCap(5,25),12);assert.equal(taskCap(10,25),24);assert.equal(taskCap(null),60)
 const client=createClient((await getTestServer()).baseUrl),user=await createOnboardedUser(client),other=await createOnboardedUser(client)
 const workload=await client.get('/api/v1/study/workload',{token:user.token});assert.equal(workload.status,200,JSON.stringify(workload.raw));assert.equal(workload.data.dueCount,0)
 const created=await client.post('/api/v1/study/sessions',{token:user.token,body:{studyMode:'new-only',budgetMinutes:5}})
 assert.equal(created.status,201,JSON.stringify(created.raw));const {session,items}=created.data
 assert.ok(items.length>1&&items.length<=workload.data.caps[5]);assert.ok(items.every(i=>i.kind==='new'&&i.reviewReason));assert.equal(session.studyOptions.budgetMinutes,5)
 const answered=await client.post('/api/v1/study/sessions/'+session.id+'/answers',{token:user.token,body:{wordId:items[0].wordId,optionIndex:await correctOptionIndex(session.id,items[0].wordId),hesitationMs:12000}})
 assert.equal(answered.status,201);assert.ok(answered.data.progress.nextReviewAt)
 const paused=await client.post('/api/v1/study/sessions/'+session.id+'/pause',{token:user.token})
 assert.equal(paused.status,200,JSON.stringify(paused.raw));assert.equal(paused.data.savedCount,1);assert.equal(paused.data.remaining,items.length-1)
 assert.equal((await client.post('/api/v1/study/sessions/'+session.id+'/pause',{token:other.token})).status,404)
 const resumed=await client.get('/api/v1/study/sessions/'+session.id,{token:user.token});assert.equal(resumed.data.session.status,'active');assert.ok(resumed.data.session.pausedAt);
 const persisted=await client.get('/api/v1/study/paused-session',{token:user.token});assert.equal(persisted.data.session.id,session.id);assert.equal((await client.get('/api/v1/study/paused-session',{token:other.token})).data.session,null);
 assert.equal(resumed.data.items.filter(i=>i.answered).length,1)
 const after=await client.get('/api/v1/study/workload',{token:user.token});assert.equal(after.data.plan.newTarget,workload.data.plan.newTarget);assert.equal(after.data.newRemaining,workload.data.newRemaining-1)
 const ten=await client.post('/api/v1/study/sessions',{token:user.token,body:{studyMode:'new-only',budgetMinutes:10}})
 assert.ok(ten.data.items.length<=after.data.caps[10]);assert.equal((await client.post('/api/v1/study/sessions',{token:user.token,body:{budgetMinutes:1}})).status,400)
})


test('a task carries its history through generated scene, dialogue and final report',async()=>{
 const client=createClient((await getTestServer()).baseUrl),user=await createOnboardedUser(client)
 const original=await fixture(user,source(),report())
 const list=await client.get('/api/v1/practice/followups',{token:user.token,body:undefined});const task=list.data.tasks[0]
 const {config}=await import('../src/config.js');const oldKey=config.ai.apiKey,oldFetch=globalThis.fetch;config.ai.apiKey='followup-test-only'
 let stage='scene'
 globalThis.fetch=async(url,options)=>{
  if(!String(url).endsWith('/chat/completions'))return oldFetch(url,options)
  const request=JSON.parse(options.body),isReport=request.messages[0].content.includes('复盘教练')
  let result
  if(stage==='scene'){
   assert.match(request.messages[1].content,/reservation/);assert.match(request.messages[1].content,/酒店前台/)
   result={title:'餐厅预订',location:'餐厅入口',role:'餐厅接待员',userRole:'就餐客人',task:'确认两人座位的预订，并说明到店时间。',goals:['说明已有预订','确认就餐人数','说明到店时间'],targets:[{word:'reservation',sense:'预订',phrase:'a reservation',example:'I have a reservation for two.'}],opening:'Welcome! Do you have a reservation?',openingTranslation:'欢迎，您有预订吗？',example:'I have a reservation for two.'}
  }else if(isReport)result={summary:'你在餐厅独立表达了预订。',corrections:[],weakWords:[],reinforcement:[],grammarWeaknesses:[]}
  else result={reply:'Your table is ready.',translation:'您的座位已准备好。',mixedLanguage:false,corrections:[],usedTargets:[{word:'reservation',sense:'预订',correct:true}],taskComplete:false}
  return Response.json({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:80}})
 }
 try{
  const created=await client.post('/api/v1/practice/scenes/generate',{token:user.token,body:{description:'请在餐厅接待处检验我能否独立表达已有预订。',followupId:task.id}})
  assert.equal(created.status,201,JSON.stringify(created.raw));assert.equal(created.data.scene.followupId,task.id)
  stage='turn';const started=await client.post('/api/v1/practice/sessions',{token:user.token,body:{sceneId:created.data.scene.id,mode:'free',maxTurns:16}})
  assert.equal(started.status,201,JSON.stringify(started.raw));const id=started.data.id,base='/api/v1/practice/sessions/'+id
  const sent=await client.post(base+'/turns',{token:user.token,body:{text:'I have a reservation for two.',expectedTurn:0}});assert.equal(sent.status,200,JSON.stringify(sent.raw))
  await client.post(base+'/finish',{token:user.token})
  let ended
  for(let i=0;i<150;i++){ended=await client.get(base,{token:user.token});if(ended.data.status!=='analyzing')break;await new Promise(r=>setTimeout(r,10))}
  assert.equal(ended.data.status,'finished',JSON.stringify(ended.raw))
  const saved=await queryOne('SELECT * FROM practice_followups WHERE id=?',[task.id]);assert.equal(saved.status,'independent');assert.equal(Number(saved.completed_session_id),id)
  // Source-specific access must still show the task after other reports are present.
  const scoped=await client.get('/api/v1/practice/followups?sourceId='+original.id,{token:user.token});assert.equal(scoped.data.tasks[0].id,task.id)
 }finally{config.ai.apiKey=oldKey;globalThis.fetch=oldFetch}
})
