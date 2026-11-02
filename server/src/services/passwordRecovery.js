import crypto from 'node:crypto'
import { queryOne, execute, withTransaction } from '../db/pool.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import { assertPasswordStrength } from './authService.js'
import { ApiError, badRequest } from '../utils/errors.js'
import { mailTransport, sendRecoveryMail } from './recoveryMail.js'
const digest=value=>crypto.createHash('sha256').update(value).digest('hex')
const generic={message:'若该邮箱已验证且账号可找回，系统将尝试发送重置码。请查看收件箱及垃圾邮件。',retryAfterSeconds:60}
export function createPasswordRecovery({sendMail=sendRecoveryMail,ensureMail=mailTransport,now=()=>Date.now(),logger=console}={}) {
 let queued=0
 async function limit(key,max,seconds){
  const bucket=Math.floor(now()/(seconds*1000))
  await execute('DELETE FROM email_recovery_limits WHERE bucket < ?',[Math.floor(now()/1000)-86400])
  const start=bucket*seconds
  await execute('INSERT INTO email_recovery_limits(key_hash,bucket,attempts) VALUES(?,?,1) ON DUPLICATE KEY UPDATE attempts=attempts+1',[digest(key),start])
  const row=await queryOne('SELECT attempts FROM email_recovery_limits WHERE key_hash=? AND bucket=?',[digest(key),start])
  if(row.attempts>max)throw new ApiError(429,'RECOVERY_RATE_LIMIT','请求过于频繁，请稍后再试。')
 }
 async function issue(userId,purpose){
  const code=crypto.randomBytes(16).toString('hex')
  return withTransaction(async conn=>{
   const [users]=await conn.execute('SELECT * FROM users WHERE id=? FOR UPDATE',[userId]);const user=users[0]
   if(!user || user.status!=='active' || !user.email || (purpose==='reset'&&!user.email_verified_at))return null
   await conn.execute('UPDATE email_challenges SET used_at=? WHERE user_id=? AND purpose=? AND used_at IS NULL',[new Date(now()),userId,purpose])
   const [r]=await conn.execute('INSERT INTO email_challenges(user_id,purpose,token_hash,token_version,expires_at) VALUES(?,?,?,?,?)',[userId,purpose,digest(code),user.token_version,new Date(now()+900000)])
   return {id:r.insertId,to:user.email,code,purpose}
  })
 }
 async function deliver(challenge){
  try{await sendMail(challenge)}catch{
   await execute('UPDATE email_challenges SET used_at=? WHERE id=?',[new Date(now()),challenge.id])
   throw new ApiError(503,'MAIL_SEND_FAILED','邮件发送失败，请稍后重试或联系管理员。')
  }
 }
 async function requestReset(email,ip){
  ensureMail()
  await limit('reset-ip:'+ip,20,3600);await limit('reset-email:'+email,1,60);await limit('reset-account-hour:'+email,5,3600)
  await limit('mail-global',100,86400)
  if(queued>=10)throw new ApiError(503,'MAIL_BUSY','邮件服务繁忙，请稍后重试。')
  queued++
  // Same immediate response for existing, unverified and nonexistent accounts.
  setImmediate(async()=>{
   try{const user=await queryOne("SELECT id FROM users WHERE email=? AND status='active' AND email_verified_at IS NOT NULL",[email]);if(user){const challenge=await issue(user.id,'reset');if(challenge)await deliver(challenge)}}
   catch{logger.warn('[mail] Password recovery delivery failed; no credentials logged')}
   finally{queued--}
  })
  return {...generic}
 }
 async function requestVerification(userId,currentPassword,ip){
  ensureMail();await limit('verify-ip:'+ip,10,3600);await limit('verify-user:'+userId,1,60);await limit('mail-global',100,86400)
  const user=await queryOne('SELECT * FROM users WHERE id=?',[userId])
  if(!user || !await verifyPassword(currentPassword,user.password_hash))throw badRequest('当前密码不正确')
  if(!user.email)throw badRequest('当前账号未绑定邮箱，请联系管理员核验。')
  const challenge=await issue(userId,'verify');if(!challenge)throw badRequest('账号暂不可验证')
  await deliver(challenge)
  return {message:'验证邮件已提交发送，请检查收件箱及垃圾邮件。',retryAfterSeconds:60}
 }
 async function consume({userId,email,code,purpose,newPassword,ip}){
  await limit('confirm-ip:'+ip,30,900)
  if(!/^[a-f0-9]{32}$/.test(code))throw badRequest('验证或重置码无效、已过期或已使用。')
  let passwordHash
  if(purpose==='reset'){assertPasswordStrength(newPassword);passwordHash=await hashPassword(newPassword)}
  const result=await withTransaction(async conn=>{
   const [users]=await conn.execute(userId?'SELECT * FROM users WHERE id=? FOR UPDATE':'SELECT * FROM users WHERE email=? FOR UPDATE',[userId || email]);const user=users[0]
   if(!user || user.status!=='active')return false
   const [codes]=await conn.execute('SELECT * FROM email_challenges WHERE user_id=? AND purpose=? AND token_hash=? FOR UPDATE',[user.id,purpose,digest(code)]);const token=codes[0]
   if(!token || token.used_at || new Date(token.expires_at).getTime()<=now() || token.token_version!==user.token_version)return false
   if(purpose==='reset'&&!user.email_verified_at)return false
   if(purpose==='verify')await conn.execute('UPDATE users SET email_verified_at=? WHERE id=?',[new Date(now()),user.id])
   else{
    await conn.execute('UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?',[passwordHash,user.id])
    await conn.execute('UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',[new Date(now()),user.id])
   }
   await conn.execute('UPDATE email_challenges SET used_at=? WHERE user_id=? AND used_at IS NULL',[new Date(now()),user.id])
   return {email:user.email}
  })
  if(!result)throw badRequest('验证或重置码无效、已过期或已使用。')
  if(purpose==='reset') setImmediate(()=>sendMail({to:result.email,purpose:'notice'}).catch(()=>logger.warn('[mail] Password change notification failed')))
  return purpose==='verify'?{verified:true}:{changed:true,reloginRequired:true}
 }
 return {requestReset,requestVerification,consume}
}
export const passwordRecovery=createPasswordRecovery()
