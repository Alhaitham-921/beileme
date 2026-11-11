import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { queryOne, execute } from '../../db/pool.js'
import { getAttempt, MEDIA_ROOT } from './service.js'
import { ApiError, badRequest, notFound } from '../../utils/errors.js'
import { validateSpeechAudio, createSpeechService } from '../speech.js'
import { speechSettingsService } from '../speechSettings.js'
import { speechProvider, reserveUsage, settleUsage } from '../platform/access.js'
import { consumeWindow } from '../platform/rateLimit.js'
import { safeProviderFetch } from '../platform/security.js'

export async function probeAudio(bytes, { command=process.env.FFPROBE_PATH||'ffprobe', maximumSeconds=180 }={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,['-v','error','-protocol_whitelist','pipe','-show_entries','format=duration:packet=pts_time,duration_time','-of','json','-i','pipe:0'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    let output='';let diagnostic='';let finished=false
    const stop=error=>{if(finished)return;finished=true;clearTimeout(timer);child.kill();reject(error)}
    const timer=setTimeout(()=>stop(new ApiError(422,'AUDIO_PROBE_TIMEOUT','录音校验超时，请缩短后重试')),8000)
    child.on('error',()=>stop(new ApiError(503,'MEDIA_TOOL_UNAVAILABLE','服务器尚未安装 ffprobe，暂不能保存录音；文字练习仍可使用')))
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2*1024*1024)stop(badRequest('录音数据过于复杂'))})
    child.stderr.on('data',chunk=>{if(diagnostic.length<1000)diagnostic+=chunk})
    child.stdin.on('error',()=>{})
    child.on('close',code=>{
      if(finished)return
      finished=true;clearTimeout(timer)
      try {
        if(code!==0)throw badRequest('录音文件无法解码，请重新录音')
        const data=JSON.parse(output)
        const packets=(data.packets||[]).filter(p=>Number.isFinite(Number(p.pts_time)))
        const start=packets.length?Math.min(...packets.map(p=>Number(p.pts_time))):0
        const end=packets.length?Math.max(...packets.map(p=>Number(p.pts_time)+Number(p.duration_time||0))):0
        const duration=Math.max(Number(data.format?.duration)||0,end-start)
        if(!Number.isFinite(duration)||duration<0.2||duration>maximumSeconds+0.5)throw badRequest(`录音时长应为 0.2–${maximumSeconds} 秒`)
        resolve(Math.ceil(duration*1000))
      }catch(error){reject(error instanceof ApiError?error:badRequest('无法核实录音时长'))}
    })
    child.stdin.end(bytes)
  })
}

export async function saveRecording(userId,attemptId,questionId,bytes,mimeType,consent) {
  if(consent!=='yes')throw badRequest('请先同意将本段录音保存到服务器用于回放和转写')
  const attempt=await getAttempt(userId,attemptId)
  const question=attempt.paper.questions.find(q=>q.id===questionId&&q.type==='spoken')
  if(!question||attempt.state==='submitted')throw badRequest('当前题目不能保存录音')
  if(!Buffer.isBuffer(bytes)||bytes.length>16*1024*1024)throw badRequest('录音不能超过 16 MB')
  await consumeWindow(`recording-upload:${userId}`,30,3600)
  const checked=validateSpeechAudio({audioBase64:bytes.toString('base64'),mimeType,durationMs:1000},{maxBytes:16*1024*1024,maxSeconds:180})
  const durationMs=await probeAudio(bytes,{maximumSeconds:Math.min(180,(question.answerSeconds||120)+15)})
  const id=crypto.randomUUID(),fileName=`${id}.${checked.extension}`
  const directory=path.join(MEDIA_ROOT,'recordings')
  await fs.mkdir(directory,{recursive:true})
  await fs.writeFile(path.join(directory,fileName),bytes,{flag:'wx',mode:0o600})
  await execute('INSERT INTO ielts_recordings(id,user_id,attempt_id,question_id,file_name,mime_type,duration_ms,bytes) VALUES(?,?,?,?,?,?,?,?)',[id,userId,attemptId,questionId,fileName,checked.mimeType,durationMs,bytes.length])
  return {id,durationMs,bytes:bytes.length,questionId}
}

export async function recordingFile(userId,id) {
  const row=await queryOne('SELECT * FROM ielts_recordings WHERE id=? AND user_id=?',[id,userId])
  if(!row)throw notFound('录音不存在')
  return {...row,path:path.join(MEDIA_ROOT,'recordings',row.file_name)}
}

export async function transcribeRecording(userId,id,requestKey) {
  if(!/^[\w-]{8,100}$/.test(requestKey||''))throw badRequest('请求编号不正确')
  const row=await recordingFile(userId,id)
  const settings=await speechProvider(userId,await speechSettingsService.effective())
  const bytes=await fs.readFile(row.path)
  const key=`transcribe:${userId}:${requestKey}`
  const existing=await queryOne('SELECT state,usage_detail FROM platform_usage WHERE request_key=? AND user_id=?',[key,userId])
  if(existing) {
    const detail=typeof existing.usage_detail==='string'?JSON.parse(existing.usage_detail):existing.usage_detail
    if(detail?.recordingId&&detail.recordingId!==id)throw badRequest('该编号已用于其他录音')
    if(existing.state==='settled'&&detail?.text)return {text:detail.text,source:'microphone'}
    throw new ApiError(409,'TRANSCRIPTION_ALREADY_REQUESTED','该转写请求已处理或中断；请查看结果，明确重试时使用新编号')
  }
  await consumeWindow(`transcribe-user:${userId}`,6,60)
  const reservation=await reserveUsage({userId,requestKey:key,kind:'transcription',source:settings.source})
  if(reservation.reused)throw new ApiError(409,'TRANSCRIPTION_ALREADY_REQUESTED','这段转写请求已经开始，请稍候查看结果')
  try {
    const service=createSpeechService({settings:{...settings,maxBytes:16*1024*1024,maxSeconds:180},fetchImpl:safeProviderFetch})
    const result=await service.transcribe(userId,{audioBase64:bytes.toString('base64'),mimeType:row.mime_type,durationMs:Number(row.duration_ms)})
    await settleUsage(key,true,{recordingId:id,text:result.text})
    return result
  }catch(error){await settleUsage(key,false,{recordingId:id,error:error.code||'TRANSCRIPTION_FAILED'});throw error}
}
