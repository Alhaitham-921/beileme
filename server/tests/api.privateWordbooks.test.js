import test from 'node:test'
import assert from 'node:assert/strict'
import {getTestServer,createClient,createOnboardedUser} from './helpers/setup.js'
import {query,queryOne} from '../src/db/pool.js'

test('imported wordbooks remain private across lookup, preview, scene selection and learning cards',async()=>{
  const client=createClient((await getTestServer()).baseUrl)
  const owner=await createOnboardedUser(client),other=await createOnboardedUser(client)
  const auth={token:owner.token},peer={token:other.token}
  const before=await queryOne('SELECT COUNT(*) n FROM user_word_progress WHERE user_id=?',[owner.userId])
  const imported=await client.post('/api/v1/profile/wordbooks',{...auth,body:{name:'个人测试词书',text:'telescope\t测试私有释义甲\ntelescope\t测试私有释义乙\nlighthouse\t测试私有释义丙'}})
  assert.equal(imported.status,201,JSON.stringify(imported.raw))
  const book=imported.data.book
  assert.equal(book.wordCount,2)
  const saved=await queryOne('SELECT * FROM wordbooks WHERE id=?',[book.id])
  const words=await query('SELECT id FROM words WHERE wordbook_id=? ORDER BY id',[book.id])
  assert.equal(Number(saved.owner_user_id),owner.userId)
  assert.ok((await client.get('/api/v1/profile/wordbooks',auth)).data.items.some(b=>b.id===book.id))
  assert.ok(!(await client.get('/api/v1/profile/wordbooks',peer)).data.items.some(b=>b.id===book.id))
  assert.equal((await client.get(`/api/v1/words/books/${saved.code}/words`,peer)).status,404)
  for(const options of [{},peer])assert.equal((await client.get('/api/v1/words/'+words[0].id,options)).status,404)
  assert.equal((await client.get('/api/v1/words/'+words[0].id+'/learning-card?local=1',peer)).status,404)
  assert.equal((await client.put('/api/v1/profile/wordbooks/current',{...peer,body:{wordbookId:book.id}})).status,404)
  assert.equal((await client.post('/api/v1/practice/scenes/generate',{...peer,body:{description:'请为我生成使用这个单词的咖啡店交流场景。',completeWorkflow:true,wordIds:[Number(words[0].id)]}})).status,404)
  assert.equal((await client.put('/api/v1/profile/wordbooks/current',{...auth,body:{wordbookId:book.id}})).status,200)
  const preview=await client.get('/api/v1/study/preview',auth)
  assert.equal(preview.status,200,JSON.stringify(preview.raw))
  assert.deepEqual(preview.data.words.map(w=>w.id).sort((a,b)=>a-b),words.map(w=>Number(w.id)).sort((a,b)=>a-b))
  assert.ok(!(await client.get('/api/v1/words/lookup?q=telescope',peer)).data.entries.some(e=>Number(e.id)===Number(words[0].id)))
  assert.deepEqual(await queryOne('SELECT COUNT(*) n FROM user_word_progress WHERE user_id=?',[owner.userId]),before)
})

test('invalid private imports are atomic and preserve the selected wordbook',async()=>{
  const client=createClient((await getTestServer()).baseUrl),owner=await createOnboardedUser(client),auth={token:owner.token}
  const before=await queryOne('SELECT wordbook_id FROM user_profiles WHERE user_id=?',[owner.userId])
  const bad=await client.post('/api/v1/profile/wordbooks',{...auth,body:{name:'不完整词书',text:'valid\t有效\ninvalid row'}})
  assert.equal(bad.status,400)
  assert.equal(Number((await queryOne('SELECT COUNT(*) n FROM wordbooks WHERE owner_user_id=?',[owner.userId])).n),0)
  assert.deepEqual(await queryOne('SELECT wordbook_id FROM user_profiles WHERE user_id=?',[owner.userId]),before)
})
