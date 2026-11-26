import mysql from 'mysql2/promise'
import { writeFile } from 'node:fs/promises'

// An isolated local fixture only; never use the application's configured database.
const port=Number(process.env.BENCH_DB_PORT||33087)
if(port===3306)throw new Error('Use a separately started local fixture port, not the application default')
const conn=await mysql.createConnection({host:'127.0.0.1',port,user:process.env.BENCH_DB_USER||'root',password:process.env.BENCH_DB_PASSWORD||'',timezone:'Z'})
const database=`blm_query_benchmark_${Date.now()}_test`
try {
  await conn.query('CREATE DATABASE `'+database+'`')
  await conn.query('USE `'+database+'`')
  await conn.query(`CREATE TABLE assessment_sessions (
    id BIGINT UNSIGNED NOT NULL PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,state JSON NOT NULL,completed_at DATETIME NOT NULL,
    KEY ix_assessment_user(user_id,id)
  )`)
  const count=20000,until=new Date('2026-11-26T00:00:00Z')
  for(let offset=0;offset<count;offset+=500) {
    const rows=Array.from({length:Math.min(500,count-offset)},(_,j)=>{
      const i=offset+j
      return [i+1,i%8+1,JSON.stringify({bookId:i%6+1,methodVersion:'benchmark-v1',questionSetVersion:'paper-v1',answers:Array(6).fill({correct:true,snapshot:{spelling:'example',options:['示例','其他'],correctIndex:0}})}),new Date(until.getTime()-(count-i)*60000)]
    })
    await conn.query('INSERT INTO assessment_sessions(id,user_id,state,completed_at) VALUES ?',[rows])
  }
  await conn.query('ANALYZE TABLE assessment_sessions')
  const common=`user_id=? AND id<? AND completed_at IS NOT NULL AND completed_at<=?`
  const before=`SELECT id,user_id,state,completed_at FROM assessment_sessions WHERE ${common}
    AND CAST(JSON_UNQUOTE(JSON_EXTRACT(state,'$.bookId')) AS UNSIGNED)=?
    AND JSON_UNQUOTE(JSON_EXTRACT(state,'$.methodVersion'))=?
    AND (? IS NULL OR JSON_EXTRACT(state,'$.questionSetVersion') IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(state,'$.questionSetVersion'))=?)
    ORDER BY completed_at DESC,id DESC LIMIT 20`
  const after=`SELECT id,user_id,state,completed_at FROM assessment_sessions WHERE ${common}
    AND report_book_id=? AND report_method_version=?
    AND (? IS NULL OR report_question_version IS NULL OR report_question_version=?)
    ORDER BY completed_at DESC,id DESC LIMIT 20`
  const args=[1,count+1,until,1,'benchmark-v1','paper-v1','paper-v1']
  const [oldRows]=await conn.execute(before,args)
  const baseline=await measure(before)
  // Measure the actual pre-migration table first: MySQL can otherwise rewrite a
  // JSON expression to a generated column and accidentally use the new index.
  await conn.query(`ALTER TABLE assessment_sessions
    ADD COLUMN report_book_id BIGINT UNSIGNED GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(state,'$.bookId')) AS UNSIGNED)) STORED,
    ADD COLUMN report_method_version VARCHAR(80) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(state,'$.methodVersion'))) STORED,
    ADD COLUMN report_question_version VARCHAR(80) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(state,'$.questionSetVersion'))) STORED,
    ADD KEY ix_assessment_completion(user_id,completed_at,id),
    ADD KEY ix_assessment_comparable(user_id,report_book_id,report_method_version,completed_at,id)`)
  await conn.query('ANALYZE TABLE assessment_sessions')
  const [newRows]=await conn.execute(after,args)
  if(JSON.stringify(oldRows.map(r=>r.id))!==JSON.stringify(newRows.map(r=>r.id)))throw new Error('Results differ')
  async function measure(sql) {
    const times=[]
    for(let i=0;i<25;i++){const start=performance.now();await conn.execute(sql,args);times.push(performance.now()-start)}
    times.sort((a,b)=>a-b)
    const [plan]=await conn.execute('EXPLAIN ANALYZE '+sql,args)
    return {samples:times.length,p50Ms:Number(times[Math.floor(times.length*.5)].toFixed(3)),p95Ms:Number(times[Math.floor(times.length*.95)].toFixed(3)),plan:plan[0]['EXPLAIN']}
  }
  const results={scope:'Local MySQL synthetic query benchmark; not a production or concurrency capacity result',rows:count,database,
    sameResultIds:oldRows.map(r=>r.id),before:baseline,after:await measure(after)}
  const output=process.argv[2]||'assessment-query-benchmark.json'
  await writeFile(output,JSON.stringify(results,null,2))
  console.log(JSON.stringify({rows:count,sameResults:true,before:results.before.p95Ms,after:results.after.p95Ms,output}))
} finally {await conn.end()}
