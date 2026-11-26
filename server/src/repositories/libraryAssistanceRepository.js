import {queryOne,execute,withTransaction} from '../db/pool.js'
import {conflict} from '../utils/errors.js'
export async function libraryPreferences(userId){const row=await queryOne('SELECT show_chinese FROM library_preferences WHERE user_id=?',[userId]);return {showChinese:Boolean(row?.show_chinese)}}
export async function setLibraryPreferences(userId,showChinese){
 await execute('INSERT INTO library_preferences(user_id,show_chinese) VALUES (?,?) ON DUPLICATE KEY UPDATE show_chinese=VALUES(show_chinese),updated_at=UTC_TIMESTAMP(3)',[userId,Number(showChinese)])
 return {showChinese}
}
export function findExplanation(userId,kind,key){return queryOne('SELECT response,usage_data FROM library_ai_explanations WHERE user_id=? AND kind=? AND content_key=?',[userId,kind,key])}
export function claimExplanation(userId,kind,key,token){return withTransaction(async conn=>{
 await conn.execute('INSERT IGNORE INTO library_ai_explanations(user_id,kind,content_key) VALUES (?,?,?)',[userId,kind,key])
 const [[row]]=await conn.execute('SELECT response,usage_data,lease_until FROM library_ai_explanations WHERE user_id=? AND kind=? AND content_key=? FOR UPDATE',[userId,kind,key])
 if(row.response)return row
 if(row.lease_until&&new Date(row.lease_until).getTime()>Date.now())throw conflict('这份解释正在生成，请稍后读取；不会重复发起生成')
 await conn.execute('UPDATE library_ai_explanations SET generation_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 3 MINUTE) WHERE user_id=? AND kind=? AND content_key=?',[token,userId,kind,key])
 return null
})}
export async function finishExplanation(userId,kind,key,token,response,usage){
 const result=await execute('UPDATE library_ai_explanations SET response=?,usage_data=?,generation_token=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(3) WHERE user_id=? AND kind=? AND content_key=? AND generation_token=?',
 [response?JSON.stringify(response):null,JSON.stringify(usage),userId,kind,key,token])
 if(!result.affectedRows)throw conflict('解释生成状态已经更新，请重新读取')
}
export function ownListeningAttempt(userId,id,contentId){return queryOne('SELECT answers,transcript_shown FROM library_listening_attempts WHERE id=? AND user_id=? AND content_id=?',[id,userId,contentId])}
