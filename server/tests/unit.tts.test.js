import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { createTtsRouter } from '../src/routes/tts.js'
import { errorHandler } from '../src/middleware/errorHandler.js'
import { nativeSpeech } from '../../src/utils/speechSynthesis.js'
import { http } from '../../src/api/client.js'

async function fixture(t, fetchImpl) {
  const app=express(); app.use(express.json())
  app.use('/tts',createTtsRouter({authenticate:(req,res,next)=>{
    if(req.headers.authorization!=='Bearer test')return res.sendStatus(401)
    req.user={id:7}; next()
  },fetchImpl}));app.use(errorHandler)
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening')
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  return async(body,auth=true)=>fetch('http://127.0.0.1:'+server.address().port+'/tts/synthesize',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test'}:{})},body:JSON.stringify(body)})
}
test('TTS requires login and validates text and rate before contacting model',async t=>{
  const send=await fixture(t,()=>assert.fail('must not synthesize'))
  assert.equal((await send({text:'Hello'},false)).status,401)
  for(const body of [{text:''},{text:'x'.repeat(1501)},{text:'Hello',rate:99}])assert.equal((await send(body)).status,400)
})
test('TTS sends normalized text, returns audio and enforces per-user rate limit',async t=>{
  let calls=0
  const send=await fixture(t,async(url,options)=>{
    calls++;assert.deepEqual(JSON.parse(options.body),{text:'Hello',rate:1})
    return Response.json({audioBase64:'UklGRg==',mimeType:'audio/wav',cached:true})
  })
  for(let i=0;i<20;i++)assert.equal((await send({text:' Hello '})).status,200)
  assert.equal((await send({text:'Hello'})).status,429);assert.equal(calls,20)
})
test('TTS limits concurrent model work and recovers after an upstream failure',async t=>{
  let release
  const send=await fixture(t,()=>new Promise(resolve=>{release=resolve}))
  const pending=send({text:'Hello'})
  while(!release)await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal((await send({text:'Another'})).status,429)
  release(new Response('secret worker details',{status:500}))
  const response=await pending;assert.equal(response.status,503)
  assert.equal((await response.text()).includes('secret worker'),false)
})
test('stopping pending frontend synthesis prevents late audio playback',async t=>{
  const original=http.post;const originalAudio=globalThis.Audio
  let resolve;let played=false
  http.post=()=>new Promise(r=>{resolve=r})
  globalThis.Audio=class {play(){played=true;return Promise.resolve()}}
  t.after(()=>{http.post=original;globalThis.Audio=originalAudio})
  const pending=nativeSpeech.speak('Hello');await nativeSpeech.stop()
  resolve({audioBase64:'UklGRg==',mimeType:'audio/wav'});await pending
  assert.equal(played,false)
})
