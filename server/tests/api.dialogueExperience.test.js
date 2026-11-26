import test from 'node:test'
import assert from 'node:assert/strict'
import {getTestServer,createClient,createOnboardedUser} from './helpers/setup.js'
import {config} from '../src/config.js'
import {queryOne,execute} from '../src/db/pool.js'
import {parseJson} from '../src/utils/json.js'

test('AI-completed stages open the next topic, preserve quotes and respect flexible length with revision guarded extension',async t=>{
 const client=createClient((await getTestServer()).baseUrl),owner=await createOnboardedUser(client),peer=await createOnboardedUser(client)
 const old={...config.ai},originalFetch=globalThis.fetch
 Object.assign(config.ai,{apiKey:'experience-fixture',baseUrl:'https://experience.example.test/v1'})
 t.after(()=>Object.assign(config.ai,old))
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(!String(url).startsWith('https://experience.example.test/'))return originalFetch(url,options)
  const body=JSON.parse(options.body),system=body.messages[0].content,context=JSON.parse(system.match(/场景与设置：([^\n]+)/)[1])
  const data=JSON.parse(body.messages[1].content)
  assert.match(system,/goalEvidence/);assert.ok(Array.isArray(data.currentStageTranscript))
  return Response.json({choices:[{message:{content:JSON.stringify({reply:'Thank you. We can compare the two jackets next.',translation:'谢谢，接下来可以比较两件夹克。',corrections:[],usedTargets:[],mixedLanguage:false,taskComplete:true,goalEvidence:context.goals.filter(g=>!g.completed).map(g=>({goalId:g.id,completed:true,quote:data.currentUserText}))})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20}})
 })
 const auth={token:owner.token}
 const started=await client.post('/api/v1/practice/sessions',{...auth,body:{sceneId:'shopping',fullJourney:true,vocabularyCount:12,maxTurns:16,flexibleLength:true,textSupport:true}})
 assert.equal(started.status,201,JSON.stringify(started.raw));let s=started.data
 assert.equal(s.maxTurns,16);assert.equal(s.scene.targets.length,12);assert.equal(s.scene.actors.length,4);assert.ok(s.messages[0].translation)
 const path='/api/v1/practice/sessions/'+s.id
 const response=await client.post(path+'/turns',{...auth,body:{text:'I would like a jacket for my trip. My budget is forty pounds and I need medium size.',expectedTurn:0,expectedRevision:s.journey.revision,actorId:s.journey.activeActorId}})
 assert.equal(response.status,200,JSON.stringify(response.raw));s=response.data
 assert.equal(s.status,'active');assert.equal(s.journey.flow.index,1);assert.ok(s.messages.at(-1).transition)
 assert.equal(s.messages.filter(m=>m.role==='user')[0].turn,1)
 assert.equal((await client.get(path,auth)).data.journey.flow.index,1)
 assert.equal((await client.put(path+'/length',{token:peer.token,body:{maxTurns:48,expectedRevision:s.journey.revision}})).status,404)
 let extended=await client.put(path+'/length',{...auth,body:{maxTurns:48,expectedRevision:s.journey.revision}})
 assert.equal(extended.status,200);assert.equal(extended.data.maxTurns,48)
 assert.equal((await client.put(path+'/length',{...auth,body:{maxTurns:80,expectedRevision:s.journey.revision}})).status,409)
 s=extended.data
 const row=await queryOne('SELECT state FROM dialogue_sessions WHERE id=?',[s.id]),saved=parseJson(row.state)
 saved.turnCount=47;await execute('UPDATE dialogue_sessions SET state=? WHERE id=?',[JSON.stringify(saved),s.id])
 const final=await client.post(path+'/turns',{...auth,body:{text:'Could you explain the price difference and show me the lighter one?',expectedTurn:47,expectedRevision:s.journey.revision,actorId:s.journey.activeActorId}})
 assert.equal(final.status,200,JSON.stringify(final.raw));assert.equal(final.data.status,'active');assert.equal(final.data.turnCount,48)
 assert.equal((await client.post(path+'/turns',{...auth,body:{text:'One more question.',expectedTurn:48,expectedRevision:final.data.journey.revision}})).status,409)
 assert.equal((await client.get(path,auth)).data.status,'active')
})
