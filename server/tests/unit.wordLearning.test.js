import test from 'node:test'
import assert from 'node:assert/strict'
import { createDictionaryLookup, normalizeDictionary, normalizeAiUsage } from '../src/services/wordLearningService.js'
import { WORD_USAGE } from '../data/wordUsage.js'
import { readAutoPronounce, wordAudioIdentity } from '../../src/utils/wordAudio.js'
const entry = word => [{ word, license: { name:'CC BY-SA 3.0', url:'https://creativecommons.org/licenses/by-sa/3.0/' },
  sourceUrls:['javascript:alert(1)','https://en.wiktionary.org/wiki/'+word],
  meanings:[{ partOfSpeech:'verb', definitions:[{ example:'We develop useful skills.', definition:'To gain or acquire something.' }] }] }]

test('dictionary examples require source license and match requested word; unsafe attribution URLs are dropped', () => {
  const result=normalizeDictionary(entry('develop'),'develop')
  assert.equal(result.examples.length,1)
  assert.equal(result.examples[0].sourceUrl,'https://en.wiktionary.org/wiki/develop')
  assert.deepEqual(normalizeDictionary(entry('develop'),'different').examples,[])
  const noLicense=entry('develop');delete noLicense[0].license
  assert.deepEqual(normalizeDictionary(noLicense,'develop').examples,[])
  assert.deepEqual(normalizeDictionary({},'develop').examples,[])
  const fragment=entry('develop');fragment[0].meanings[0].definitions[0].example='develop a habit'
  const usage=normalizeDictionary(fragment,'develop');assert.equal(usage.examples.length,0)
  assert.equal(usage.collocations[0].phrase,'develop a habit');assert.ok(usage.collocations[0].license.url)
})
test('free lookup coalesces concurrent requests across books and saves positive cache for 30 days', async () => {
  let calls=0,writes=0,release
  const cached=new Map()
  const lookup=createDictionaryLookup({readCache:async key=>cached.get(key),writeCache:async(key,data,days)=>{
    assert.equal(days,30);writes++;cached.set(key,data)
  },fetchImpl:async()=>{calls++;await new Promise(resolve=>{release=resolve});return Response.json(entry('develop'))}})
  const first=lookup('develop'),second=lookup('Develop')
  while(!release)await new Promise(resolve=>setTimeout(resolve,1))
  release();assert.deepEqual(await first,await second)
  assert.equal(calls,1);assert.equal(writes,1)
  assert.equal((await lookup('develop')).cached,true);assert.equal(calls,1)
})
test('not-found is negatively cached; errors back off without inventing examples; invalid input never contacts external API',async()=>{
  let calls=0,writes=0,now=100
  const lookup=createDictionaryLookup({now:()=>now,readCache:async()=>null,writeCache:async(_k,_d,days)=>{writes++;assert.equal(days,7)},
    fetchImpl:async(url)=>{calls++;if(url.endsWith('missing'))return new Response('',{status:404});throw Error('offline')}})
  assert.deepEqual(await lookup('missing'),{examples:[]});assert.equal(writes,1)
  assert.equal((await lookup('network')).unavailable,true);assert.equal((await lookup('network')).unavailable,true);assert.equal(calls,2)
  now+=30001;await lookup('network');assert.equal(calls,3)
  await lookup('../private');assert.equal(calls,3)
})
test('AI usage takes only the target word example and bounded structured phrases',()=>{
  const card={spelling:'develop',distinctions:[{spelling:'develop',example:'We develop skills.',translation:'我们培养技能。'},
    {spelling:'envelope',example:'A different sentence.'}],collocations:[{phrase:'develop a habit',translation:'养成习惯'}]}
  const normalized=normalizeAiUsage(card,'develop')
  assert.equal(normalized.examples.length,1);assert.equal(normalized.collocations[0].source,'ai')
  assert.deepEqual(normalizeAiUsage(card,'other'),{examples:[],collocations:[]})
  assert.deepEqual(normalizeAiUsage({spelling:'develop',collocations:{bad:1}},'develop').collocations,[])
})
test('starter usage set supplies original bilingual examples and structured phrases',()=>{
  assert.ok(Object.keys(WORD_USAGE).length>=40)
  for(const [spelling,usage] of Object.entries(WORD_USAGE)){
    assert.ok(usage.examples[0].text.toLowerCase().includes(spelling),spelling)
    assert.ok(usage.examples[0].translation);assert.equal(usage.collocations.length,2)
    assert.ok(usage.collocations.every(item=>item.phrase&&item.translation))
  }
})
test('auto pronunciation defaults on, respects persisted off, and distinguishes groups at index zero',()=>{
  assert.equal(readAutoPronounce({getItem:()=>null}),true)
  assert.equal(readAutoPronounce({getItem:()=> 'off'}),false)
  assert.equal(readAutoPronounce({getItem:()=>{throw Error('private')}}),true)
  const base={active:true,sessionId:1,index:0,wordId:20}
  assert.notEqual(wordAudioIdentity(base),wordAudioIdentity({...base,sessionId:2}))
  assert.equal(wordAudioIdentity({...base,active:false}),'')
})
