import test, {before} from 'node:test'
import assert from 'node:assert/strict'
import {getTestServer,createClient,createOnboardedUser,playSession} from './helpers/setup.js'
import {createPasswordRecovery} from '../src/services/passwordRecovery.js'
import {queryOne,execute} from '../src/db/pool.js'
let client
before(async()=>{client=createClient((await getTestServer()).baseUrl)})
function recovery(overrides={}){const mails=[];const service=createPasswordRecovery({ensureMail:()=>{},sendMail:async m=>{mails.push(m)},logger:{warn(){}},...overrides});return {service,mails}}
async function delivered(mails,n=1){for(let i=0;i<100;i++){if(mails.length>=n)return mails[n-1];await new Promise(r=>setTimeout(r,10))}throw Error('No test mail received')}
test('email verification requires password and stores only a token hash',async()=>{
 const u=await createOnboardedUser(client);const {service,mails}=recovery()
 await assert.rejects(service.requestVerification(u.userId,'incorrect','verify-bad'),{status:400})
 await service.requestVerification(u.userId,u.password,'verify-good').catch(async e=>{if(e.status!==429)throw e})
 // Fresh fixture for independent cooldown.
 const v=await createOnboardedUser(client);await service.requestVerification(v.userId,v.password,'verify-good')
 const mail=mails.at(-1);assert.equal(mail.code.length,32)
 const row=await queryOne('SELECT * FROM email_challenges WHERE id=?',[mail.id]);assert.notEqual(row.token_hash,mail.code)
 await service.consume({userId:v.userId,code:mail.code,purpose:'verify',ip:'verify-confirm'})
 assert.ok((await queryOne('SELECT email_verified_at FROM users WHERE id=?',[v.userId])).email_verified_at)
 await assert.rejects(service.consume({userId:v.userId,code:mail.code,purpose:'verify',ip:'verify-confirm'}),{status:400})
})
test('reset request hides missing and unverified accounts; cooldown applies equally',async()=>{
 const u=await createOnboardedUser(client);const {service,mails}=recovery()
 const a=await service.requestReset(u.email,'reset-unverified')
 const b=await service.requestReset('absent-recovery@example.com','reset-missing')
 assert.deepEqual(a,b);await new Promise(r=>setTimeout(r,50));assert.equal(mails.length,0)
 await assert.rejects(service.requestReset(u.email,'reset-unverified'),{status:429})
})
test('password reset is single-use, revokes access and refresh tokens and preserves learning data',async()=>{
 const u=await createOnboardedUser(client);await execute('UPDATE users SET email_verified_at=UTC_TIMESTAMP() WHERE id=?',[u.userId])
 await playSession(client,u,{strategy:'all-correct',maxAnswers:2})
 const learningBefore=await queryOne('SELECT COUNT(*) AS n FROM user_word_progress WHERE user_id=?',[u.userId])
 const {service,mails}=recovery();const response=await service.requestReset(u.email,'reset-success')
 const mail=await delivered(mails);assert.equal(JSON.stringify(response).includes(mail.code),false)
 const before=await queryOne('SELECT * FROM user_profiles WHERE user_id=?',[u.userId])
 const outcomes=await Promise.allSettled([1,2].map(()=>service.consume({email:u.email,code:mail.code,purpose:'reset',newPassword:'Replacement123',ip:'reset-confirm'})))
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
 assert.equal((await client.get('/api/v1/auth/me',{token:u.token})).status,401)
 assert.equal((await client.post('/api/v1/auth/refresh',{body:{refreshToken:u.refreshToken}})).status,401)
 assert.equal((await client.post('/api/v1/auth/login',{body:{account:u.email,password:u.password}})).status,401)
 assert.equal((await client.post('/api/v1/auth/login',{body:{account:u.email,password:'Replacement123'}})).status,200)
 assert.deepEqual(await queryOne('SELECT * FROM user_profiles WHERE user_id=?',[u.userId]),before)
 assert.deepEqual(await queryOne('SELECT COUNT(*) AS n FROM user_word_progress WHERE user_id=?',[u.userId]),learningBefore)
})
test('expired and wrong-purpose tokens cannot change passwords',async()=>{
 const u=await createOnboardedUser(client);const {service,mails}=recovery()
 await service.requestVerification(u.userId,u.password,'purpose-check');const mail=mails[0]
 await assert.rejects(service.consume({email:u.email,code:mail.code,purpose:'reset',newPassword:'Replacement123',ip:'purpose-check'}),{status:400})
 await execute('UPDATE email_challenges SET expires_at=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE id=?',[mail.id])
 await assert.rejects(service.consume({userId:u.userId,code:mail.code,purpose:'verify',ip:'expired-check'}),{status:400})
})
test('SMTP failure invalidates the verification challenge and exposes no credentials',async()=>{
 const u=await createOnboardedUser(client)
 const {service}=recovery({sendMail:async()=>{throw Error('secret smtp diagnostic')}})
 await assert.rejects(service.requestVerification(u.userId,u.password,'smtp-failure'),e=>e.status===503&&!e.message.includes('secret'))
 assert.ok((await queryOne('SELECT used_at FROM email_challenges WHERE user_id=?',[u.userId])).used_at)
})

test('resend invalidates the older reset code and a weak password does not consume the latest code',async()=>{
 const u=await createOnboardedUser(client);await execute('UPDATE users SET email_verified_at=UTC_TIMESTAMP() WHERE id=?',[u.userId])
 let clock=Date.now();const {service,mails}=recovery({now:()=>clock})
 await service.requestReset(u.email,'resend-ip');const first=await delivered(mails)
 clock+=61000;await service.requestReset(u.email,'resend-ip');const second=await delivered(mails,2)
 await assert.rejects(service.consume({email:u.email,code:first.code,purpose:'reset',newPassword:'Replacement123',ip:'resend-confirm'}),{status:400})
 await assert.rejects(service.consume({email:u.email,code:second.code,purpose:'reset',newPassword:'weak',ip:'resend-confirm'}),{status:400})
 await service.consume({email:u.email,code:second.code,purpose:'reset',newPassword:'Replacement123',ip:'resend-confirm'})
})
