import { getTestServer, createClient, createOnboardedUser } from './helpers/setup.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../src/config.js'
import { execute } from '../src/db/pool.js'
import { sceneFor } from '../src/services/dialogueEngine.js'
import { hotelChangeScene } from '../src/services/dialogueJourney.js'

test('contextual references support optional memory words, preserve turns and recover without losing prior help', async t => {
  const {baseUrl}=await getTestServer(), client=createClient(baseUrl)
  const owner=await createOnboardedUser(client), other=await createOnboardedUser(client)
  const oldKey=config.ai.apiKey;config.ai.apiKey='context-help-test-only'
  t.after(()=>{config.ai.apiKey=oldKey})
  const originalFetch=globalThis.fetch, calls=[]
  let invalid=false
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!String(url).endsWith('/chat/completions'))return originalFetch(url,options)
    const body=JSON.parse(options.body);calls.push(body)
    const help=body.messages[0].content.includes('接话辅导员'), input=JSON.parse(body.messages[1].content)
    const content=help ? {hint:'先回应想喝茶，再接着聊散步。',example:invalid?'我还没决定':input.target?'Tea sounds good. We could walk along the river bank afterwards.':'Tea sounds lovely. Is the café still open?',translation:'我想先喝茶，再聊聊之后的安排。'}
      : {reply:'The riverside café closes at six. Would you prefer tea or coffee there?',translation:'河边的咖啡店六点关门。你想喝茶还是咖啡？',mixedLanguage:false,corrections:[],usedTargets:input.currentUserText.includes('bank')?[{word:'bank',sense:'河岸',correct:true}]:[],taskComplete:false}
    return Response.json({choices:[{message:{content:JSON.stringify(content)},finish_reason:'stop'}],usage:{prompt_tokens:40,completion_tokens:70}})
  })
  const started=await client.post('/api/v1/practice/sessions',{token:owner.token,body:{sceneId:'bank',mode:'free'}})
  assert.equal(started.status,201)
  const base=`/api/v1/practice/sessions/${started.data.id}`
  const turn=await client.post(`${base}/turns`,{token:owner.token,body:{text:'I would like a hot drink.',expectedTurn:0}})
  assert.equal(turn.status,200)
  const before=turn.data, options={level:4,useMemoryWord:false,text:'我想喝茶',expectedTurn:1}
  assert.equal((await client.post(`${base}/help`,{token:other.token,body:options})).status,404)
  const free=await client.post(`${base}/help`,{token:owner.token,body:options})
  assert.equal(free.status,200,JSON.stringify(free.raw))
  assert.equal(free.data.help.word,null);assert.equal(free.data.help.useMemoryWord,false)
  assert.equal(free.data.turnCount,1)
  assert.deepEqual(free.data.messages,before.messages)
  assert.deepEqual(free.data.targetUsage,before.targetUsage)
  assert.ok(free.data.help.usage.totalTokens>0)
  const input=JSON.parse(calls.at(-1).messages[1].content)
  assert.equal(input.target,null);assert.equal(input.learnerDraft,'我想喝茶')
  assert.match(input.transcript.at(-1).text,/tea or coffee/)

  const targeted=await client.post(`${base}/help`,{token:owner.token,body:{...options,word:'bank',useMemoryWord:true}})
  assert.equal(targeted.status,200,JSON.stringify(targeted.raw))
  assert.match(targeted.data.help.example,/tea/i);assert.match(targeted.data.help.example,/bank/)
  assert.equal(targeted.data.targetUsage.find(item=>item.word==='bank').independent,undefined)
  assert.deepEqual(targeted.data.messages,before.messages)
  const priorHelp=targeted.data.help, priorEvents=targeted.data.helpEvents.length
  const callCount=calls.length
  assert.equal((await client.post(`${base}/help`,{token:owner.token,body:{...options,expectedTurn:0}})).status,409)
  assert.equal((await client.post(`${base}/help`,{token:owner.token,body:{...options,word:'fake',useMemoryWord:true}})).status,400)
  assert.equal(calls.length,callCount)
  invalid=true
  const failed=await client.post(`${base}/help`,{token:owner.token,body:options})
  assert.equal(failed.status,503)
  assert.equal(calls.length,callCount+2)
  const restored=await client.get(base,{token:owner.token})
  assert.deepEqual(restored.data.help,priorHelp)
  assert.equal(restored.data.helpEvents.length,priorEvents)
  assert.deepEqual(restored.data.messages,before.messages)
  invalid=false
  const again=await client.post(`${base}/help`,{token:owner.token,body:{...options,useMemoryWord:true,word:'bank'}})
  assert.equal(again.status,200)
  const copied=await client.post(`${base}/turns`,{token:owner.token,body:{text:again.data.help.example,expectedTurn:1}})
  assert.equal(copied.status,200,JSON.stringify(copied.raw))
  assert.equal(copied.data.targetUsage.find(item=>item.word==='bank').status,'assisted')
  const olderCopy=await client.post(`${base}/turns`,{token:owner.token,body:{text:again.data.help.example,expectedTurn:2}})
  assert.equal(olderCopy.status,200,JSON.stringify(olderCopy.raw))
  assert.equal(olderCopy.data.targetUsage.find(item=>item.word==='bank').status,'assisted')
})

test('actor switches guard stale references and preparation cannot call the reference model', async t => {
  const {baseUrl}=await getTestServer(),client=createClient(baseUrl),owner=await createOnboardedUser(client)
  const key=config.ai.apiKey;config.ai.apiKey='actor-help-test-only';t.after(()=>{config.ai.apiKey=key})
  const realFetch=globalThis.fetch;let calls=0,request
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!String(url).endsWith('/chat/completions'))return realFetch(url,options)
    calls++;request=JSON.parse(JSON.parse(options.body).messages[1].content)
    return Response.json({choices:[{message:{content:JSON.stringify({hint:'向当前经理说明改期意向',example:'Could you help me discuss a date change?',translation:'您能帮我商量一下改期吗？'})},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:30}})
  })
  const multiActorScene=hotelChangeScene(sceneFor('hotel','beginner'))
  const saved=await execute("INSERT INTO dialogue_scenes (user_id,source,difficulty,scene) VALUES (?,'custom','beginner',?)",
    [owner.userId,JSON.stringify(multiActorScene)])
  const started=await client.post('/api/v1/practice/sessions',{token:owner.token,body:{sceneId:`custom-${saved.insertId}`}})
  assert.equal(started.status,201)
  const base=`/api/v1/practice/sessions/${started.data.id}`
  const switched=await client.post(`${base}/actor`,{token:owner.token,body:{actorId:'manager',expectedRevision:started.data.journey.revision,expectedTurn:0}})
  assert.equal(switched.status,200,JSON.stringify(switched.raw))
  const body={level:3,useMemoryWord:false,expectedTurn:0,actorId:'manager',expectedRevision:switched.data.journey.revision}
  assert.equal((await client.post(`${base}/help`,{token:owner.token,body:{...body,expectedRevision:0}})).status,409)
  assert.equal((await client.post(`${base}/help`,{token:owner.token,body:{...body,actorId:'frontdesk'}})).status,409)
  assert.equal(calls,0)
  const helped=await client.post(`${base}/help`,{token:owner.token,body})
  assert.equal(helped.status,200,JSON.stringify(helped.raw))
  assert.equal(helped.data.help.actorId,'manager')
  assert.equal(request.activeActorId,'manager');assert.equal(request.scene.partnerRole,'值班经理')
  assert.equal(request.transcript.at(-1).actorId,'manager')
  assert.equal(helped.data.turnCount,0)
  const preparation=await client.post('/api/v1/practice/sessions',{token:owner.token,body:{sceneId:'hotel',prepareWords:true}})
  const noHelp=await client.post(`/api/v1/practice/sessions/${preparation.data.id}/help`,{token:owner.token,body:{level:3,useMemoryWord:false,expectedTurn:0}})
  assert.equal(noHelp.status,409);assert.equal(calls,1)
})
