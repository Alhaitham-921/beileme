import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import {getTestServer,createClient,createOnboardedUser,correctOptionIndex} from './helpers/setup.js'
import {query,queryOne,execute} from '../src/db/pool.js'
let client
before(async()=>{client=createClient((await getTestServer()).baseUrl)})
async function fixture(count=73) {
  const user=await createOnboardedUser(client),other=await createOnboardedUser(client)
  const book=await queryOne('SELECT id FROM wordbooks ORDER BY id LIMIT 1')
  const ids=[]
  for(let i=0;i<count;i++) {
    const spelling=`collection${user.userId}word${i}`
    const row=await execute('INSERT INTO words (wordbook_id,spelling,spelling_norm,definitions,examples) VALUES (?,?,?,?,JSON_ARRAY())',[book.id,spelling,spelling,JSON.stringify([`选词复习释义${i}`])]);ids.push(Number(row.insertId))
    if(i<Math.min(65,count)) await execute(`INSERT INTO user_word_progress (user_id,word_id,wordbook_id,first_learned_at,next_review_at,times_seen,times_wrong) VALUES (?,?,?,'2020-01-01',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY),2,2)`,[user.userId,row.insertId,book.id])
    if(i>=Math.min(60,count-1)) await client.put(`/api/v1/words/${row.insertId}/favorite`,{token:user.token})
  }
  const notebook=await client.post('/api/v1/words/notebooks',{token:user.token,body:{name:'批量复习词'}})
  for(const id of ids.slice(0,5))await client.put(`/api/v1/words/${id}/favorite`,{token:user.token,body:{notebookId:notebook.data.notebook.id}})
  return {user,other,ids,notebookId:notebook.data.notebook.id}
}
async function correctGroup(user,group,limit=group.items.length) {
  for(const item of group.items.slice(0,limit)) {
    const result=await client.post(`/api/v1/study/sessions/${group.session.id}/answers`,{token:user.token,body:{wordId:item.wordId,optionIndex:await correctOptionIndex(group.session.id,item.wordId),hesitationMs:1500}})
    assert.equal(result.status,201,JSON.stringify(result.raw))
  }
}
async function finish(user,group) {
  const result=await client.post(`/api/v1/study/sessions/${group.session.id}/finish`,{token:user.token})
  assert.equal(result.status,200,JSON.stringify(result.raw));return result.data
}
test('historical mistake notebook includes all pages, old errors and words subsequently answered correctly',async()=>{
  const {user,other,ids,notebookId}=await fixture()
  for(const result of [0,0,0,1])await execute("INSERT INTO answer_logs (user_id,word_id,result,quality,created_at) VALUES (?,?,?,?,?)",[user.userId,ids[0],result,result?4:1,result?'2021-01-01':'2020-01-01'])
  // An imported log without a progress row is still part of this account's history.
  await execute('DELETE FROM user_word_progress WHERE user_id=? AND word_id=?',[user.userId,ids[1]])
  await execute("INSERT INTO answer_logs (user_id,word_id,result,quality,created_at) VALUES (?,?,0,1,'2020-01-01')",[user.userId,ids[1]])
  const before=await queryOne('SELECT COUNT(*) n FROM answer_logs WHERE user_id=?',[user.userId])
  const pages=[]
  for(let page=1;page<=4;page++) {
    const response=await client.get(`/api/v1/words/collections?source=mistakes&size=20&page=${page}`,{token:user.token})
    assert.equal(response.status,200,JSON.stringify(response.raw));assert.equal(response.data.total,65)
    pages.push(...response.data.items)
  }
  assert.equal(pages.length,65);assert.equal(new Set(pages.map(w=>w.id)).size,65)
  assert.equal(pages.find(w=>w.id===ids[0]).wrongTimes,3)
  assert.ok(pages.some(w=>w.id===ids[1]))
  const all=await client.get('/api/v1/words/collections/ids?source=all',{token:user.token})
  assert.deepEqual(all.data.wordIds,[...ids].sort((a,b)=>a-b))
  const custom=await client.get(`/api/v1/words/collections?source=notebook&notebookId=${notebookId}`,{token:user.token})
  assert.equal(custom.data.total,5)
  assert.equal((await client.get('/api/v1/words/collections?source=mistakes',{token:other.token})).data.total,0)
  assert.equal((await client.get(`/api/v1/words/collections?source=notebook&notebookId=${notebookId}`,{token:other.token})).status,404)
  assert.deepEqual(await queryOne('SELECT COUNT(*) n FROM answer_logs WHERE user_id=?',[user.userId]),before)
})

test('search and select-all IDs cover the same full result and treat wildcard characters literally',async()=>{
  const {user,ids}=await fixture(4)
  await execute('UPDATE words SET definitions=? WHERE id=?',[JSON.stringify(['进度 100% 完成']),ids[0]])
  const result=await client.get('/api/v1/words/collections?source=all&q='+encodeURIComponent('%'),{token:user.token})
  assert.equal(result.status,200,JSON.stringify(result.raw));assert.equal(result.data.total,1);assert.equal(result.data.items[0].id,ids[0])
  const selected=await client.get('/api/v1/words/collections/ids?source=all&q='+encodeURIComponent('%'),{token:user.token})
  assert.deepEqual(selected.data.wordIds,[ids[0]])
  const upper=await client.get('/api/v1/words/collections?source=all&q=COLLECTION',{token:user.token})
  assert.equal(upper.data.total,4)
  assert.equal((await client.get('/api/v1/words/collections?source=unknown',{token:user.token})).status,400)
})

test('a 73-word mixed selection persists, deduplicates and completes eight groups without truncation or concurrent skips',async()=>{
  const {user,other,ids}=await fixture()
  const created=await client.post('/api/v1/study/review-batches',{token:user.token,body:{wordIds:[...ids,ids[0],ids[1]]}})
  assert.equal(created.status,201,JSON.stringify(created.raw))
  let group=created.data;const batchId=group.reviewBatch.id,seen=[]
  assert.equal(group.reviewBatch.totalCount,73)
  assert.equal((await client.post(`/api/v1/study/review-batches/${batchId}/continue`,{token:other.token})).status,404)
  for(let index=0;index<8;index++) {
    assert.equal(group.items.length,index===7?3:10)
    assert.ok(group.items.every(item=>/选择/.test(item.reviewReason)))
    for(const item of group.items){assert.ok(!seen.includes(item.wordId));seen.push(item.wordId)}
    await correctGroup(user,group)
    const summary=await finish(user,group)
    assert.equal(summary.reviewBatch.completedCount,seen.length)
    assert.equal(summary.reviewBatch.remainingCount,73-seen.length)
    if(index<7) {
      const [a,b]=await Promise.all([client.post(`/api/v1/study/review-batches/${batchId}/continue`,{token:user.token}),client.post(`/api/v1/study/review-batches/${batchId}/continue`,{token:user.token})])
      assert.equal(a.status,200,JSON.stringify(a.raw));assert.equal(b.status,200,JSON.stringify(b.raw));assert.equal(a.data.session.id,b.data.session.id)
      group=a.data
    }
  }
  assert.deepEqual(seen,ids)
  const sessions=await queryOne("SELECT COUNT(*) n FROM study_sessions WHERE user_id=? AND JSON_EXTRACT(study_options,'$.reviewBatchId')=?",[user.userId,batchId])
  assert.equal(Number(sessions.n),8)
  const repeated=await client.post(`/api/v1/study/review-batches/${batchId}/continue`,{token:user.token})
  assert.equal(repeated.data.session.id,group.session.id);assert.equal(repeated.data.reviewBatch.complete,true)
  assert.equal((await client.get('/api/v1/study/review-batches/active',{token:user.token})).data.batch,null)
  const wrong=await client.get('/api/v1/words/collections?source=mistakes',{token:user.token});assert.equal(wrong.data.total,65)
})

test('partial review and pause resume the same group, with all remaining selected words kept on the server',async()=>{
  const {user,ids}=await fixture(23)
  const created=await client.post('/api/v1/study/review-batches',{token:user.token,body:{wordIds:ids}})
  assert.equal(created.status,201,JSON.stringify(created.raw));const group=created.data,batchId=group.reviewBatch.id
  await correctGroup(user,group,3)
  const before=await queryOne('SELECT next_offset,word_ids FROM collection_review_batches WHERE id=?',[batchId])
  const resumed=await client.post(`/api/v1/study/review-batches/${batchId}/continue`,{token:user.token})
  assert.equal(resumed.data.session.id,group.session.id);assert.equal(resumed.data.reviewBatch.completedCount,3);assert.equal(resumed.data.reviewBatch.remainingCount,20)
  assert.equal(resumed.data.items.filter(w=>!w.answered).length,7)
  await client.post(`/api/v1/study/sessions/${group.session.id}/pause`,{token:user.token})
  const active=await client.get('/api/v1/study/review-batches/active',{token:user.token})
  assert.equal(active.data.batch.id,batchId)
  const restored=await client.get(`/api/v1/study/sessions/${group.session.id}`,{token:user.token})
  assert.equal(restored.data.reviewBatch.id,batchId);assert.equal(restored.data.items.filter(w=>!w.answered).length,7)
  assert.deepEqual(await queryOne('SELECT next_offset,word_ids FROM collection_review_batches WHERE id=?',[batchId]),before)
  assert.equal((await client.post(`/api/v1/study/sessions/${group.session.id}/finish`,{token:user.token})).status,409)
})

test('collection review requires login and account-owned selected words; rejected requests do not create a task',async()=>{
  const {user,other,ids}=await fixture(2)
  for(const path of ['/api/v1/words/collections','/api/v1/words/collections/ids','/api/v1/study/review-batches/active'])assert.equal((await client.get(path)).status,401)
  assert.equal((await client.post('/api/v1/study/review-batches',{body:{wordIds:ids}})).status,401)
  assert.equal((await client.post('/api/v1/study/review-batches',{token:other.token,body:{wordIds:ids}})).status,400)
  for(const wordIds of [[],[0],[999999999]])assert.equal((await client.post('/api/v1/study/review-batches',{token:user.token,body:{wordIds}})).status,400)
  assert.equal(Number((await queryOne('SELECT COUNT(*) n FROM collection_review_batches WHERE user_id=?',[user.userId])).n),0)
})
