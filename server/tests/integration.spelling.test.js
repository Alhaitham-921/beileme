// Opt-in: creates a new isolated DB, retains it, and never runs the reset/delete helper.
import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { config } from '../src/config.js'

test('spelling HTTP and MySQL: selection, ownership, retries, grouping, idempotency and legacy isolation', { skip: process.env.SPELLING_INTEGRATION_TEST !== '1', timeout: 60000 }, async () => {
  const source = config.db.database, database = `blm_spelling_${Date.now()}_test`, originalTest = config.isTest
  const connection = await mysql.createConnection({ ...config.db, multipleStatements: true })
  let server, closePool
  try {
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`)
    for (const table of ['users','wordbooks','words','user_word_progress','answer_logs','collocation_progress','assessment_answers','word_learning_evidence']) {
      await connection.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``)
    }
    await connection.changeUser({ database })
    await connection.query(await fs.readFile(new URL('../src/db/migrations/038_word_spelling.sql',import.meta.url),'utf8'))
    config.db.database = database; config.isTest = true
    const db = await import('../src/db/pool.js'); closePool = db.closePool
    const { signAccessToken } = await import('../src/utils/token.js')
    const { createApp } = await import('../src/app.js')
    const createUser = async name => Number((await db.execute('INSERT INTO users (email,password_hash,nickname) VALUES (?,?,?)',[`${name}@example.test`,'unused',name])).insertId)
    const uid = await createUser('spelling'), other = await createUser('other')
    const token = signAccessToken({id:uid}), otherToken = signAccessToken({id:other})
    const bookId = (await db.execute("INSERT INTO wordbooks (code,name,scope) VALUES ('spelling','拼写测试','自定义')")).insertId
    const ids=[]
    for(let i=0;i<12;i++) {
      const spelling = `word${i}`
      const wordId = Number((await db.execute('INSERT INTO words (wordbook_id,spelling,spelling_norm,definitions,examples) VALUES (?,?,?,?,?)',[bookId,spelling,spelling,JSON.stringify(['释义']),JSON.stringify(['An existing example.'])])).insertId)
      ids.push(wordId)
      await db.execute('INSERT INTO user_word_progress (user_id,word_id,wordbook_id,first_learned_at,next_review_at,times_wrong) VALUES (?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),1)',[uid,wordId,bookId])
    }
    server=createApp().listen(0,'127.0.0.1'); await once(server,'listening')
    const base=`http://127.0.0.1:${server.address().port}/api/v1/spelling`
    async function request(path='',body,auth=token) {
      const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
      return {status:r.status,...await r.json()}
    }
    assert.equal((await request('',undefined,'')).status,401)
    assert.equal((await request('',{requestKey:randomUUID(),wordIds:[]})).status,400)
    assert.equal((await request('',{requestKey:randomUUID(),wordIds:ids},otherToken)).status,400)
    const create={requestKey:randomUUID(),wordIds:[...ids,ids[0]]}
    const made=await request('',create); assert.equal(made.status,201,JSON.stringify(made)); let session=made.data
    const id=session.id
    assert.equal(session.total,12);assert.equal(session.queueLength,10);assert.equal(session.question.id,ids[0])
    assert.equal((await request('',create)).data.id,id)
    assert.equal((await request(`/${id}`,undefined,otherToken)).status,404)
    assert.equal((await request(`/${id}/actions`,{requestKey:randomUUID(),revision:0,action:'reveal',wordId:ids[0]},otherToken)).status,404)
    async function act(action,extra={}) {
      const response=await request(`/${id}/actions`,{requestKey:randomUUID(),revision:session.revision,wordId:session.question?.id,action,...extra})
      assert.equal(response.status,200,JSON.stringify(response));session=response.data
    }
    await act('reveal');assert.ok(session.helped)
    const receipt={requestKey:randomUUID(),revision:session.revision,wordId:ids[0],action:'answer',answer:'WORD0',durationMs:1234}
    const concurrent=await Promise.all([request(`/${id}/actions`,receipt),request(`/${id}/actions`,receipt)])
    assert.ok(concurrent.every(r=>r.status===200));session=concurrent[0].data;assert.equal(session.completed,1)
    assert.equal((await request(`/${id}/actions`,receipt)).data.completed,1)
    const stale=await request(`/${id}/actions`,{requestKey:randomUUID(),revision:0,wordId:ids[0],action:'answer',answer:'word0'})
    assert.equal(stale.status,409)
    assert.equal((await request(`/${id}`)).data.feedback.result,'assisted')
    await act('next')
    const invalid=await request(`/${id}/actions`,{requestKey:randomUUID(),revision:session.revision,wordId:ids[1],action:'answer',answer:'incorrect'})
    assert.equal(invalid.status,400); assert.equal((await request(`/${id}`)).data.stage,'typing')
    await act('answer',{answer:'word1',errorCount:2,durationMs:2500});await act('next')
    await act('skip');await act('next')
    while(session.phase==='first' && session.stage==='typing') {await act('answer',{answer:session.question.spelling});await act('next')}
    assert.equal(session.phase,'retry');assert.equal(session.queueLength,3);assert.equal(session.question.id,ids[0]);assert.equal(session.helped,false)
    await act('answer',{answer:session.question.spelling});await act('next')
    await act('answer',{answer:session.question.spelling});await act('next')
    await act('skip');await act('next');assert.equal(session.stage,'group-end')
    await act('next');assert.equal(session.group,2);assert.equal(session.question.id,ids[10])
    while(session.stage!=='finished') {
      if(session.stage==='typing')await act('answer',{answer:session.question.spelling})
      else await act('next')
    }
    assert.equal(session.completed,12);assert.equal(session.independentCount,9)
    const results=await db.query('SELECT * FROM word_spelling_results WHERE session_id=? ORDER BY word_id',[id])
    assert.equal(results.length,12);assert.equal(results[0].first_result,'assisted');assert.equal(results[0].retry_result,'independent')
    assert.equal(results[1].first_errors,2);assert.equal(results[2].retry_result,'pending')
    assert.equal(Number((await db.queryOne('SELECT SUM(times_wrong) n FROM user_word_progress WHERE user_id=?',[uid])).n),12)
    assert.equal((await db.queryOne('SELECT COUNT(*) n FROM answer_logs')).n,0)
    assert.equal((await db.queryOne('SELECT COUNT(*) n FROM word_learning_evidence')).n,0)
    assert.equal((await request()).data.recent[0].id,id)
    console.log(`Retained isolated database: ${database}`)
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
    if(closePool)await closePool();await connection.end();config.db.database=source;config.isTest=originalTest
  }
})
