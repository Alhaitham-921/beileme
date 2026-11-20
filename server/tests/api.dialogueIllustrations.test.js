import { createClient,createOnboardedUser,getTestServer,playSession } from './helpers/setup.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { config } from '../src/config.js'
import { execute,queryOne } from '../src/db/pool.js'

const IMAGE=await sharp({create:{width:32,height:32,channels:3,background:'#8f9eab'}}).webp().toBuffer()
const scene=()=>({title:'酒店入住',location:'酒店前台',role:'前台接待员',userRole:'旅客',task:'办理入住并讨论房间安排。',actors:[{id:'partner',name:'交流对象',role:'交流对象',englishName:'Partner',responsibility:'回应当前任务'}],goals:['确认预订','询问房间'],targets:[
  {word:'bank',sense:'银行',phrase:'the bank',example:'Where is the bank?'}],opening:'Welcome! Do you have a reservation?',openingTranslation:'欢迎，请问有预订吗？',example:'I have a reservation.'})
function providers(t,{hold=false,comicEnabled=true}={}){
  const oldImages={...config.wordImages},oldKey=config.ai.apiKey
  const oldComicEnabled=config.dialogueComicEnabled
  Object.assign(config.wordImages,{apiKey:'comic-test-key',baseUrl:'https://comic-images.example.test/v1',model:'comic-model',siliconFlow:false,dailyQuota:10})
  config.ai.apiKey='comic-text-test-key'
  config.dialogueComicEnabled=comicEnabled
  t.after(()=>{Object.assign(config.wordImages,oldImages);config.ai.apiKey=oldKey;config.dialogueComicEnabled=oldComicEnabled})
  const imageStarted=Promise.withResolvers(),imageGate=Promise.withResolvers(),images=[],texts=[]
  const real=globalThis.fetch
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).endsWith('/images/generations')){
      images.push(JSON.parse(options.body));imageStarted.resolve()
      if(hold&&images.length===1)await imageGate.promise
      return Response.json({data:[{b64_json:IMAGE.toString('base64')}]})
    }
    if(!String(url).endsWith('/chat/completions'))return real(url,options)
    const body=JSON.parse(options.body);texts.push(body)
    const data=body.messages[0].content.includes('场景设计师')?scene():{
      reply:'Your room is ready. Shall we go upstairs?',translation:'房间准备好了，要上楼吗？',mixedLanguage:false,corrections:[],usedTargets:[],taskComplete:false,
      visualUpdate:{changed:true,topicKey:'hotel-room',description:'The same hotel guest enters a quiet room with a suitcase, while the receptionist opens the door.',caption:'来到房间'},
    }
    return Response.json({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:40}})
  })
  return {images,texts,imageStarted,imageGate}
}
async function prepared(t,options){const server=await getTestServer(),client=createClient(server.baseUrl),owner=await createOnboardedUser(client),other=await createOnboardedUser(client);return {server,client,owner,other,...providers(t,options)}}
async function generate(client,owner){const word=await queryOne("SELECT id FROM words WHERE spelling_norm='bank' LIMIT 1");return client.post('/api/v1/practice/scenes/generate',{token:owner.token,body:{description:'我想练习到酒店办理入住，并前往房间。',wordIds:[Number(word.id)]}})}
async function waitImages(client,owner,query){for(let n=0;n<100;n++){const response=await client.get('/api/v1/practice/illustrations?'+new URLSearchParams(query),{token:owner.token});assert.equal(response.status,200,JSON.stringify(response.raw));if(response.data.items.length&&response.data.items.every(p=>p.status!=='pending'))return response.data;await new Promise(r=>setTimeout(r,20))}assert.fail('pictures did not finish')}

test('the comic pause overrides previous opt-in without deleting the preference', async t => {
  const {client,owner,images,texts}=await prepared(t,{comicEnabled:false})
  const credentials={token:owner.token}
  const settings=await client.put('/api/v1/practice/illustration-settings',{...credentials,body:{autoImages:true}})
  assert.equal(settings.data.autoImages,true)
  assert.equal(settings.data.available,false)
  const created=await generate(client,owner)
  assert.equal(created.status,201,JSON.stringify(created.raw))
  const sceneId=created.data.scene.id
  const started=await client.post('/api/v1/practice/sessions',{...credentials,body:{sceneId}})
  assert.equal(started.status,201,JSON.stringify(started.raw))
  const turn=await client.post('/api/v1/practice/sessions/'+started.data.id+'/turns',
    {...credentials,body:{text:'Do you have a room?',expectedTurn:0}})
  assert.equal(turn.status,200,JSON.stringify(turn.raw))
  assert.doesNotMatch(texts.at(-1).messages[0].content,/本轮已开启漫画式情境插画/)
  const retry=await client.post('/api/v1/practice/illustrations',{...credentials,body:{sceneId}})
  assert.equal(retry.status,409)
  const frames=await client.get('/api/v1/practice/illustrations?sessionId='+started.data.id,credentials)
  assert.deepEqual(frames.data.items,[])
  assert.equal(images.length,0)
})

test('opening image is nonblocking and private; scene changes append frames and settings stop future generation',async t=>{
  const {server,client,owner,other,images,texts,imageStarted,imageGate}=await prepared(t,{hold:true})
  await client.put('/api/v1/practice/illustration-settings',{token:owner.token,body:{autoImages:true}})
  const created=await generate(client,owner)
  assert.equal(created.status,201,JSON.stringify(created.raw));const sceneId=created.data.scene.id
  await imageStarted.promise
  const pending=await client.get('/api/v1/practice/illustrations?sceneId='+sceneId,{token:owner.token})
  assert.equal(pending.data.items[0].status,'pending')
  assert.equal((await client.get('/api/v1/practice/illustrations?sceneId='+sceneId,{token:other.token})).status,404)
  imageGate.resolve();const ready=await waitImages(client,owner,{sceneId});const imagePath=ready.items[0].imagePath
  assert.equal((await fetch(server.baseUrl+'/api/v1'+imagePath)).status,401)
  assert.equal((await fetch(server.baseUrl+'/api/v1'+imagePath,{headers:{Authorization:'Bearer '+other.token}})).status,404)
  const picture=await fetch(server.baseUrl+'/api/v1'+imagePath,{headers:{Authorization:'Bearer '+owner.token}})
  assert.equal(picture.status,200);assert.match(picture.headers.get('cache-control'),/private/)
  assert.doesNotMatch(images[0].prompt,/Morandi/)
  const started=await client.post('/api/v1/practice/sessions',{token:owner.token,body:{sceneId,mode:'free',maxTurns:8}})
  assert.equal(started.status,201,JSON.stringify(started.raw));const id=started.data.id
  for(let n=0;n<2;n++){const r=await client.post(`/api/v1/practice/sessions/${id}/turns`,{token:owner.token,body:{text:'Hello, thank you.',expectedTurn:n}});assert.equal(r.status,200,JSON.stringify(r.raw));if(n===0)assert.equal(images.length,1)}
  const frames=await waitImages(client,owner,{sessionId:id});assert.deepEqual(frames.items.map(i=>i.turn),[0,2]);assert.equal(images.length,2)
  assert.match(images[1].prompt,/same hotel guest/)
  assert.equal((await client.get('/api/v1/practice/illustrations?sessionId='+id,{token:other.token})).status,404)
  const off=await client.put('/api/v1/practice/illustration-settings',{token:owner.token,body:{autoImages:false}});assert.equal(off.data.autoImages,false)
  assert.equal((await client.get('/api/v1/practice/illustration-settings',{token:other.token})).data.autoImages,false)
  for(let n=2;n<4;n++){const r=await client.post(`/api/v1/practice/sessions/${id}/turns`,{token:owner.token,body:{text:'Thank you.',expectedTurn:n}});assert.equal(r.status,200,JSON.stringify(r.raw))}
  assert.equal(images.length,2);assert.doesNotMatch(texts.at(-1).messages[0].content,/本轮已开启漫画式/)
  assert.equal((await client.get('/api/v1/practice/illustrations?sessionId='+id,{token:owner.token})).data.items.length,2)
  assert.equal((await generate(client,owner)).status,201)
  assert.equal(images.length,2,'disabled accounts do not generate opening pictures either')
})

test('picture quota is shared with memory images and does not block scene creation',async t=>{
  const {client,owner,images}=await prepared(t)
  await client.put('/api/v1/practice/illustration-settings',{token:owner.token,body:{autoImages:true}})
  config.wordImages.dailyQuota=1
  const created=await generate(client,owner);assert.equal(created.status,201,JSON.stringify(created.raw))
  await waitImages(client,owner,{sceneId:created.data.scene.id})
  const next=await generate(client,owner);assert.equal(next.status,201,JSON.stringify(next.raw))
  assert.equal(images.length,1)
  const retry=await client.post('/api/v1/practice/illustrations',{token:owner.token,body:{sceneId:next.data.scene.id}})
  assert.equal(retry.status,429,JSON.stringify(retry.raw))
  const {session,items}=await playSession(client,owner,{strategy:'all-wrong',maxAnswers:1})
  const word=items[0]
  const memory=await client.post(`/api/v1/words/${word.wordId}/memory-image`,{token:owner.token,body:{sense:word.word.definitions[0],sessionId:session.id}})
  assert.equal(memory.status,429,JSON.stringify(memory.raw))
  assert.equal(images.length,1)
})

test('expired background jobs stay failed on reads and concurrent retries generate once',async t=>{
  const {client,owner,images,imageStarted,imageGate}=await prepared(t,{hold:true})
  await client.put('/api/v1/practice/illustration-settings',{token:owner.token,body:{autoImages:false}})
  const created=await generate(client,owner);assert.equal(created.status,201)
  await client.put('/api/v1/practice/illustration-settings',{token:owner.token,body:{autoImages:true}})
  const r=await execute(`INSERT INTO dialogue_illustrations(user_id,scene_id,context_key,topic_key,caption,description,cast_description,generation_token,lease_until,attempt_day)
    VALUES (?,?,SHA2(?,256),'opening','故事开场','A hotel guest approaches a reception desk.','Two adult hotel characters.','expired',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE),CURRENT_DATE())`,[owner.userId,created.data.scene.id,'expired-fixture'])
  // Use the same canonical opening key as the service to verify retry de-duplication.
  const key=(await import('node:crypto')).createHash('sha256').update(JSON.stringify([created.data.scene.id,null,0])).digest('hex')
  await execute('UPDATE dialogue_illustrations SET context_key=? WHERE id=?',[key,r.insertId])
  const read=await client.get('/api/v1/practice/illustrations?sceneId='+created.data.scene.id,{token:owner.token})
  assert.equal(read.data.items[0].status,'failed');assert.equal(images.length,0)
  const requests=await Promise.all([1,2].map(()=>client.post(`/api/v1/practice/illustrations/${r.insertId}/retry`,{token:owner.token})))
  assert.ok(requests.every(r=>r.status===200))
  await imageStarted.promise;assert.equal(images.length,1);imageGate.resolve()
  assert.equal((await waitImages(client,owner,{sceneId:created.data.scene.id})).items[0].status,'ready')
})

test('new accounts do not generate paid scene pictures without opting in',async t=>{
  const {client,owner,images}=await prepared(t)
  assert.equal((await client.get('/api/v1/practice/illustration-settings',{token:owner.token})).data.autoImages,false)
  const created=await generate(client,owner)
  assert.equal(created.status,201,JSON.stringify(created.raw))
  const frames=await client.get('/api/v1/practice/illustrations?sceneId='+created.data.scene.id,{token:owner.token})
  assert.deepEqual(frames.data.items,[])
  assert.equal(images.length,0)
})

test('automatic image settings validate booleans and persist per account',async()=>{
  const {baseUrl}=await getTestServer(),client=createClient(baseUrl),user=await createOnboardedUser(client)
  assert.equal((await client.put('/api/v1/practice/illustration-settings',{body:{autoImages:false}})).status,401)
  assert.equal((await client.put('/api/v1/practice/illustration-settings',{token:user.token,body:{autoImages:'false'}})).status,400)
  assert.equal((await client.put('/api/v1/practice/illustration-settings',{token:user.token,body:{autoImages:false}})).status,200)
  assert.equal((await client.get('/api/v1/practice/illustration-settings',{token:user.token})).data.autoImages,false)
})
