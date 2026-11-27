import test from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer,createClient,createOnboardedUser } from './helpers/setup.js'
import { queryOne } from '../src/db/pool.js'
import { LISTENING_LESSONS } from '../data/listeningLessons.js'

test('library serves complete sourced texts, preserves notices and isolates reading progress by account',async()=>{
  const client=createClient((await getTestServer()).baseUrl),user=await createOnboardedUser(client),other=await createOnboardedUser(client)
  const auth={token:user.token}
  assert.equal((await client.get('/api/v1/library')).status,401)
  const catalog=await client.get('/api/v1/library',auth)
  assert.equal(catalog.status,200,JSON.stringify(catalog.raw))
  assert.ok(catalog.data.books.length>=14)
  for(const id of ['alice','pride-prejudice','little-women','jane-eyre','great-gatsby','christmas-carol','around-world','robinson-crusoe','tom-sawyer','hound-baskervilles','treasure-island','secret-garden','sherlock-holmes','wizard-of-oz']){
    const item=catalog.data.books.find(b=>b.id===id);assert.ok(item,id);assert.ok(item.chapterCount>0);assert.match(item.sourceSha256,/^[a-f0-9]{64}$/);assert.ok(item.sourceCommit);assert.match(item.sourceUrl,/standardebooks\.org/);
    const first=await client.get('/api/v1/library/books/'+id,auth);assert.equal(first.status,200,id);assert.ok(first.data.chapter.paragraphs.length>0,id)
  }
  assert.equal(catalog.data.books.find(b=>b.id==='alice').chapterCount,12)
  assert.equal(catalog.data.books.find(b=>b.id==='pride-prejudice').chapterCount,61)
  assert.equal(catalog.data.lessons.length,10)
  const book=await client.get('/api/v1/library/books/alice',auth)
  assert.equal(book.data.chapter.id,'1');assert.ok(book.data.chapter.paragraphs.join(' ').includes('Alice'))
  assert.match(book.data.book.licenseUrl,/LICENSE.md/)
  const saved=await client.put('/api/v1/library/books/alice/progress',{...auth,body:{chapterId:'2',paragraph:3}})
  assert.equal(saved.status,200)
  assert.equal((await client.get('/api/v1/library/books/alice',auth)).data.chapter.id,'2')
  assert.equal((await client.get('/api/v1/library/books/alice',{token:other.token})).data.chapter.id,'1')
  assert.equal((await client.put('/api/v1/library/books/alice/progress',{...auth,body:{chapterId:'2',paragraph:100000}})).status,400)
  assert.match((await client.get('/api/v1/library/books/alice/notice',auth)).data.notice,/CC0/)
  assert.equal((await client.get('/api/v1/library/books/does-not-exist',auth)).status,404)
})
test('listening grades on the server, retains separate attempts and never writes word mastery from exposure',async()=>{
  const client=createClient((await getTestServer()).baseUrl),user=await createOnboardedUser(client),auth={token:user.token}
  const id=LISTENING_LESSONS[0].id,path='/api/v1/library/listening/'+id
  const lesson=await client.get(path,auth)
  assert.equal(lesson.data.questions[0].answer,undefined)
  const server=await getTestServer()
  const audio=await fetch(server.baseUrl+path+'/audio',{headers:{Authorization:'Bearer '+user.token}})
  assert.equal(audio.status,200);assert.match(audio.headers.get('content-type'),/audio\/mpeg/)
  const bytes=Buffer.from(await audio.arrayBuffer())
  assert.ok(bytes.subarray(0,32).includes(255)||bytes.toString('ascii',0,3)==='ID3')
  assert.ok(bytes.length>10000)
  assert.equal((await client.get(path+'/audio')).status,401)
  const before=await queryOne('SELECT COUNT(*) AS n FROM user_word_progress WHERE user_id=?',[user.userId])
  for(const transcriptShown of [false,true]) {
    const response=await client.post(path,{...auth,body:{answers:LISTENING_LESSONS[0].questions.map(q=>q.answer),transcriptShown}})
    assert.equal(response.status,200);assert.equal(response.data.correct,LISTENING_LESSONS[0].questions.length);assert.ok(response.data.attemptId)
  }
  const attempts=await queryOne('SELECT COUNT(*) n,SUM(transcript_shown) exposed FROM library_listening_attempts WHERE user_id=?',[user.userId])
  assert.equal(Number(attempts.n),2);assert.equal(Number(attempts.exposed),1)
  assert.deepEqual(await queryOne('SELECT COUNT(*) AS n FROM user_word_progress WHERE user_id=?',[user.userId]),before)
})
