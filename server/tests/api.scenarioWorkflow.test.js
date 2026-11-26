import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer,createClient,createOnboardedUser } from './helpers/setup.js'
import { parseJson } from '../src/utils/json.js'
import { config } from '../src/config.js'
import { queryOne,execute } from '../src/db/pool.js'
import { sceneFor } from '../src/services/dialogueEngine.js'
import { journeyScene } from '../src/services/dialogueJourney.js'
import { withWorkflow } from '../src/services/scenarioWorkflow.js'

test('custom complete workflows receive enough output space and can start a durable multi-stage session',async t=>{
  const client=createClient((await getTestServer()).baseUrl),user=await createOnboardedUser(client)
  const originalFetch=globalThis.fetch,old={...config.ai}
  t.after(()=>Object.assign(config.ai,old))
  Object.assign(config.ai,{apiKey:'workflow-generation-fixture',baseUrl:'https://workflow-generation.example.test/v1'})
  const base=journeyScene(sceneFor('hotel','beginner'))
  const full=withWorkflow(base,{fullJourney:true})
  const authored={...base,actors:full.actors,workflow:full.workflow}
  let calls=0
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!String(url).startsWith('https://workflow-generation.example.test/'))return originalFetch(url,options)
    calls++
    const body=JSON.parse(options.body)
    assert.ok(body.max_tokens>=8192,'a complete plan must not use the smaller report output limit')
    assert.match(body.messages[0].content,/4至12个/)
    return Response.json({choices:[{message:{content:JSON.stringify(authored)},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:100}})
  })
  const auth={token:user.token}
  const generated=await client.post('/api/v1/practice/scenes/generate',{...auth,body:{description:'我想在酒店练习从线上预订到离店的完整住宿交流。',completeWorkflow:true}})
  assert.equal(generated.status,201,JSON.stringify(generated.raw))
  assert.equal(calls,1)
  const started=await client.post('/api/v1/practice/sessions',{...auth,body:{sceneId:generated.data.scene.id,fullJourney:true}})
  assert.equal(started.status,201,JSON.stringify(started.raw))
  assert.equal(started.data.scene.workflow.stages.length,10)
  assert.equal(started.data.maxTurns,80)
})

test('full workflow is durable, revision protected, actor scoped and does not end after one stage',async t=>{
  const client=createClient((await getTestServer()).baseUrl),user=await createOnboardedUser(client),other=await createOnboardedUser(client)
  const old={...config.ai},originalFetch=globalThis.fetch
  t.after(()=>Object.assign(config.ai,old))
  Object.assign(config.ai,{apiKey:'workflow-fixture',baseUrl:'https://workflow.example.test/v1'})
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!String(url).startsWith('https://workflow.example.test/'))return originalFetch(url,options)
    const body=JSON.parse(options.body),system=body.messages[0].content
    const context=JSON.parse(system.match(/场景与设置：([^\n]+)/)[1])
    const input=JSON.parse(body.messages[1].content).currentUserText
    assert.equal(context.goals.length,2)
    return Response.json({choices:[{message:{content:JSON.stringify({reply:'Thank you. Please confirm the details.',translation:'谢谢，请核对信息。',mixedLanguage:false,corrections:[],usedTargets:[],taskComplete:true,
      goalEvidence:context.goals.map(g=>({goalId:g.id,completed:true,quote:input}))})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20}})
  })
  const auth={token:user.token},started=await client.post('/api/v1/practice/sessions',{...auth,body:{sceneId:'hotel',fullJourney:true,learningRoute:'online'}})
  assert.equal(started.status,201,JSON.stringify(started.raw))
  let s=started.data;const path=`/api/v1/practice/sessions/${s.id}`
  assert.equal(s.scene.workflow.stages.length,10);assert.equal(s.maxTurns,80)
  assert.equal(s.scene.workflow.stages[0].listening.correctIndex,undefined)
  assert.equal(s.messages[0].event,'stage_opening')
  assert.equal((await client.get(path,{token:other.token})).status,404)
  const early=await client.post(path+'/workflow',{...auth,body:{action:'advance',stageId:'booking',expectedRevision:0}})
  assert.equal(early.status,400)
  const saved=parseJson((await queryOne('SELECT state FROM dialogue_sessions WHERE id=?',[s.id])).state)
  const correct=saved.scene.workflow.stages[0].listening.correctIndex
  let result=await client.post(path+'/workflow',{...auth,body:{action:'listen',stageId:'booking',selectedIndex:correct,expectedRevision:0}})
  assert.equal(result.status,200);s=result.data
  assert.equal(s.journey.flow.listening.booking.firstIndependent,true)
  assert.equal((await client.post(path+'/workflow',{...auth,body:{action:'transcript',stageId:'booking',expectedRevision:0}})).status,409)
  result=await client.post(path+'/turns',{...auth,body:{text:'I would like a standard room for two nights. Please confirm the price and cancellation policy.',expectedTurn:0,expectedRevision:s.journey.revision,actorId:'reservations'}})
  assert.equal(result.status,200,JSON.stringify(result.raw));s=result.data
  assert.equal(s.status,'active');assert.equal(s.journey.goals.filter(g=>g.completed).length,2)
  result=await client.post(path+'/workflow',{...auth,body:{action:'advance',stageId:'booking',expectedRevision:s.journey.revision}})
  assert.equal(result.status,200);s=result.data;assert.equal(s.journey.flow.index,1)
  assert.equal((await client.get(path,auth)).data.journey.flow.index,1)
  assert.equal((await client.post(path+'/actor',{...auth,body:{actorId:'breakfast',expectedTurn:1,expectedRevision:s.journey.revision}})).status,400)
  // The longer, bounded session must still accept actor/turn revision checks after turn 24.
  const row=await queryOne('SELECT state FROM dialogue_sessions WHERE id=?',[s.id]),state=parseJson(row.state)
  state.turnCount=25
  await execute('UPDATE dialogue_sessions SET state=? WHERE id=?',[JSON.stringify(state),s.id])
  result=await client.post(path+'/turns',{...auth,body:{text:'Please confirm the two dates and send a booking confirmation.',expectedTurn:25,expectedRevision:s.journey.revision,actorId:'reservations'}})
  assert.equal(result.status,200,JSON.stringify(result.raw))
  assert.equal(result.data.turnCount,26)
})
