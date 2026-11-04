import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import {getTestServer,createClient,createOnboardedUser} from './helpers/setup.js'
import {queryOne,execute} from '../src/db/pool.js'
import {getWordLearningCard} from '../src/services/wordLearningService.js'
let client
before(async()=>{const server=await getTestServer();client=createClient(server.baseUrl)})

test('learning card endpoint requires login and provides usage for words whether previously answered or not',async()=>{
  const user=await createOnboardedUser(client)
  const word=await queryOne("SELECT id FROM words WHERE spelling='abandon' LIMIT 1")
  assert.equal((await client.get(`/api/v1/words/${word.id}/learning-card`)).status,401)
  const response=await client.get(`/api/v1/words/${word.id}/learning-card`,{token:user.token})
  assert.equal(response.status,200);const card=response.data.card
  assert.equal(card.wordId,Number(word.id));assert.ok(card.examples[0].translation);assert.equal(card.collocations.length,2)
  assert.ok(Array.isArray(card.contrasts));assert.equal(card.dictionaryUnavailable,false)
  assert.equal((await client.get('/api/v1/words/0/learning-card',{token:user.token})).status,400)
  assert.equal((await client.get('/api/v1/words/999999999/learning-card',{token:user.token})).status,404)
})
test('saved AI usage is private to its owner and automatically reused without generation',async()=>{
  const owner=await createOnboardedUser(client),other=await createOnboardedUser(client)
  const word=await queryOne("SELECT id,spelling FROM words WHERE spelling='abandon' LIMIT 1")
  await execute(`INSERT INTO generated_contents (user_id,type,target_words,content_body,meta) VALUES (?,'error_card',?,'[]',?)`,[
    owner.userId,JSON.stringify([Number(word.id)]),JSON.stringify({cards:[{spelling:word.spelling,collocations:[{phrase:'abandon a proposal',translation:'放弃提议'}]}]})])
  const owned=await getWordLearningCard(owner.userId,word.id)
  assert.ok(owned.collocations.some(item=>item.phrase==='abandon a proposal'))
  const foreign=await getWordLearningCard(other.userId,word.id)
  assert.ok(!foreign.collocations.some(item=>item.phrase==='abandon a proposal'))
})
test('dictionary failure preserves definitions, existing contrast and an explicit missing-content state',async()=>{
  const user=await createOnboardedUser(client)
  const source=await queryOne("SELECT wordbook_id FROM words LIMIT 1")
  const row=await execute('INSERT INTO words (wordbook_id,spelling,spelling_norm,definitions,examples) VALUES (?,?,?,?,JSON_ARRAY())',[
    source.wordbook_id,'uncataloguedtestword','uncataloguedtestword',JSON.stringify(['仅测试用词'])])
  let calls=0
  const card=await getWordLearningCard(user.userId,row.insertId,{dictionaryLookup:async()=>{calls++;return{examples:[],unavailable:true}}})
  assert.equal(calls,1);assert.equal(card.dictionaryUnavailable,true);assert.deepEqual(card.examples,[]);assert.deepEqual(card.collocations,[])
  assert.equal(card.wordId,Number(row.insertId))
})
