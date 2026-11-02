import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import {once} from 'node:events'
import {createRecoveryRouter} from '../src/routes/recovery.js'
import {errorHandler} from '../src/middleware/errorHandler.js'
async function fixture(t,service){const app=express();app.use(express.json());app.use('/auth',createRecoveryRouter({service}));app.use(errorHandler);const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));return async(path,body)=>fetch('http://127.0.0.1:'+server.address().port+'/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
test('public recovery endpoints normalize email and never return codes',async t=>{
 let called
 const send=await fixture(t,{requestReset:async email=>{called=email;return {message:'generic'}},consume:async body=>{assert.equal(body.purpose,'reset');return {changed:true}}})
 const r=await send('forgot-password',{email:' User@Example.com '});assert.equal(r.status,202);assert.equal(called,'user@example.com');assert.deepEqual((await r.json()).data,{message:'generic'})
 assert.equal((await send('reset-password',{email:'user@example.com',code:'a'.repeat(32),newPassword:'Replacement123'})).status,200)
 assert.equal((await send('reset-password',{email:'bad',code:'x',newPassword:'short'})).status,400)
})
test('email verification endpoints require a logged-in account',async t=>{const send=await fixture(t,{requestVerification:()=>assert.fail(),consume:()=>assert.fail()});assert.equal((await send('email-verification',{currentPassword:'x'})).status,401);assert.equal((await send('verify-email',{code:'a'.repeat(32)})).status,401)})
