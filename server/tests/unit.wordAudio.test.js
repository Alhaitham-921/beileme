import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeSpeech} from '../../src/utils/speechSynthesis.js'
import {http} from '../../src/api/client.js'

function fixture(t,{blocked=false}={}){
  const originalPost=http.post,originalAudio=globalThis.Audio
  let calls=0,plays=0,pauses=0,signals=[]
  nativeSpeech.clearCache()
  http.post=async(_url,options)=>{calls++;signals.push(options.signal);return{audioBase64:'UklGRg==',mimeType:'audio/wav'}}
  globalThis.Audio=class {
    play(){plays++;if(blocked)return Promise.reject(Object.assign(Error('gesture'),{name:'NotAllowedError'}));queueMicrotask(()=>this.onended?.());return Promise.resolve()}
    pause(){pauses++}removeAttribute(){}load(){}
  }
  t.after(async()=>{await nativeSpeech.stop();nativeSpeech.clearCache();http.post=originalPost;globalThis.Audio=originalAudio})
  return{get calls(){return calls},get plays(){return plays},get pauses(){return pauses},signals}
}
test('replaying a short word uses audio cache, with rate part of the cache key',async t=>{
  const state=fixture(t)
  await nativeSpeech.speak('abandon',.9);await nativeSpeech.speak('abandon',.9)
  assert.equal(state.calls,1);assert.equal(state.plays,2)
  await nativeSpeech.speak('abandon',1);assert.equal(state.calls,2)
})
test('autoplay rejection gives an actionable manual playback message',async t=>{
  fixture(t,{blocked:true})
  await assert.rejects(nativeSpeech.speak('ability'),/浏览器限制了自动发音/)
})
test('switching words before synthesis finishes cancels late playback',async t=>{
  const state=fixture(t);const requests=[]
  http.post=(_url,options)=>new Promise(resolve=>requests.push({resolve,signal:options.signal}))
  const first=nativeSpeech.speak('oldword');const second=nativeSpeech.speak('newword')
  assert.equal(requests[0].signal.aborted,true)
  requests[1].resolve({audioBase64:'UklGRg==',mimeType:'audio/wav'});await second
  requests[0].resolve({audioBase64:'UklGRg==',mimeType:'audio/wav'});await first
  assert.equal(state.plays,1)
})
test('rate limit is surfaced without automatic repeated requests',async t=>{
  fixture(t);let calls=0
  http.post=async()=>{calls++;throw Object.assign(Error('too frequent'),{code:'TTS_RATE_LIMIT'})}
  await assert.rejects(nativeSpeech.speak('account'),/too frequent/);assert.equal(calls,1)
})
