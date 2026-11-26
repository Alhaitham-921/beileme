import express from 'express'
import { once } from 'node:events'
import { mkdir,writeFile } from 'node:fs/promises'
import path from 'node:path'
import { LISTENING_LESSONS } from '../server/data/listeningLessons.js'
import { errorHandler } from '../server/src/middleware/errorHandler.js'

const target=process.env.VERIFY_AUDIO_URL||'http://127.0.0.1:30031/synthesize'
const parsed=new URL(target)
if(parsed.hostname!=='127.0.0.1'||parsed.protocol!=='http:')throw new Error('Verification uses only a local speech worker')
process.env.KOKORO_URL=target
const {createTtsRouter}=await import('../server/src/routes/tts.js')
const app=express();app.use(express.json());app.use('/tts',createTtsRouter({authenticate:(req,_res,next)=>{req.user={id:1};next()}}));app.use(errorHandler)
const server=app.listen(0,'127.0.0.1');await once(server,'listening')
const directory=process.argv[2];if(!directory)throw new Error('Supply an output directory')
await mkdir(directory,{recursive:true})
const checks=[]
try {
  for(const lesson of LISTENING_LESSONS){
    const started=performance.now()
    const response=await fetch(`http://127.0.0.1:${server.address().port}/tts/synthesize`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:lesson.transcript,rate:.85})})
    const payload=await response.json()
    if(!response.ok)throw new Error(lesson.id+': '+payload.error?.code)
    const bytes=Buffer.from(payload.data.audioBase64,'base64')
    if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.length<1000)throw new Error('Invalid generated WAV')
    const duration=Number(((bytes.length-44)/bytes.readUInt32LE(28)).toFixed(2))
    if(duration<1)throw new Error('Silent or incomplete lesson')
    await writeFile(path.join(directory,lesson.id+'.wav'),bytes)
    checks.push({id:lesson.id,bytes:bytes.length,durationSeconds:duration,generationMs:Math.round(performance.now()-started)})
    console.log(JSON.stringify(checks.at(-1)))
  }
  await writeFile(path.join(directory,'verification.json'),JSON.stringify({source:'Actual local Kokoro via route → application service → provider',checks},null,2))
} finally {await new Promise(resolve=>server.close(resolve))}
