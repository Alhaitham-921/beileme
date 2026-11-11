import { Router, raw } from 'express'
import path from 'node:path'
import { requireAuth } from '../middleware/auth.js'
import { requireAdmin, isAdmin } from '../middleware/admin.js'
import { asyncHandler, ok, created } from '../utils/http.js'
import { badRequest, notFound } from '../utils/errors.js'
import * as service from '../services/ielts/service.js'
import * as jobs from '../services/ielts/jobs.js'
import * as access from '../services/platform/access.js'
import * as media from '../services/ielts/media.js'
import { vocabularyCards } from '../../data/ielts/catalog.js'
import { vocabularyQuestion, vocabularyAnswer } from '../services/ielts/vocabulary.js'
import { query } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { config } from '../config.js'
import { consumeWindow } from '../services/platform/rateLimit.js'

const router=Router()
router.use((req,res,next)=>process.env.IELTS_ENABLED==='false'?next(notFound('雅思功能暂未开放')):next())
router.use(requireAuth)
router.use((req,_res,next)=>{
  if(['POST','PUT'].includes(req.method)&&!req.path.includes('/recordings/')){
    if(req.body==null)req.body={}
    if(typeof req.body!=='object'||Array.isArray(req.body))return next(badRequest('请求内容应为 JSON 对象'))
  }
  next()
})
const id=req=>{const n=Number(req.params.id);if(!Number.isSafeInteger(n)||n<1)throw badRequest('编号不正确');return n}
router.use('/vocabulary',(req,_res,next)=>{
  if((config.isProduction||process.env.PUBLIC_TRIAL_ENABLED==='true')&&process.env.IELTS_STARTER_VOCAB_REVIEWED!=='true'&&!isAdmin(req.user))return next(badRequest('雅思词汇练习正在复核，请先使用现有词书学习'))
  next()
})
router.get('/overview',asyncHandler(async(req,res)=>ok(res,await service.overview(req.user.id))))
router.get('/profile',asyncHandler(async(req,res)=>ok(res,await service.getProfile(req.user.id))))
router.put('/profile',asyncHandler(async(req,res)=>ok(res,await service.saveProfile(req.user.id,req.body))))
router.get('/papers',asyncHandler(async(req,res)=>ok(res,{papers:await service.catalog({skill:req.query.skill}),canManage:isAdmin(req.user)})))
router.get('/attempts',asyncHandler(async(req,res)=>ok(res,{attempts:await service.listAttempts(req.user.id)})))
router.post('/attempts',asyncHandler(async(req,res)=>created(res,await service.startAttempt(req.user.id,req.body,isAdmin(req.user)))))
router.get('/attempts/:id',asyncHandler(async(req,res)=>ok(res,await service.getAttempt(req.user.id,id(req)))))
router.put('/attempts/:id',asyncHandler(async(req,res)=>ok(res,await service.saveAttempt(req.user.id,id(req),req.body))))
router.get('/attempts/:id/versions',asyncHandler(async(req,res)=>ok(res,{versions:await service.answerVersions(req.user.id,id(req))})))
router.get('/attempts/:id/feedback',asyncHandler(async(req,res)=>{
  await service.getAttempt(req.user.id,id(req))
  const rows=await query('SELECT id FROM ai_jobs WHERE attempt_id=? AND user_id=? ORDER BY id DESC LIMIT 1',[id(req),req.user.id])
  ok(res,rows.length?await jobs.getJob(req.user.id,rows[0].id):null)
}))
router.get('/attempts/:id/recordings',asyncHandler(async(req,res)=>{
  await service.getAttempt(req.user.id,id(req))
  ok(res,{recordings:await query('SELECT id,question_id,duration_ms,created_at FROM ielts_recordings WHERE attempt_id=? AND user_id=? ORDER BY created_at DESC',[id(req),req.user.id])})
}))
router.post('/attempts/:id/audio-plays',asyncHandler(async(req,res)=>{
  const attempt=await service.getAttempt(req.user.id,id(req))
  const sectionId=req.body.sectionId
  if(attempt.state!=='active'||attempt.paper.skill!=='listening'||!attempt.paper.sections.some(s=>s.id===sectionId))throw badRequest('当前不能播放该材料')
  const {execute}=await import('../db/pool.js')
  if(attempt.mode==='mock'){
    const result=await execute('INSERT IGNORE INTO ielts_audio_plays(attempt_id,section_id) VALUES(?,?)',[id(req),sectionId])
    if(!result.affectedRows)throw badRequest('本段模考录音已开始过，不能重复播放；完成后可回听')
  }
  ok(res,{started:true})
}))
router.post('/attempts/:id/feedback',asyncHandler(async(req,res)=>ok(res,await jobs.createFeedbackJob(req.user.id,id(req),req.body.requestKey),202)))
router.get('/jobs/:id',asyncHandler(async(req,res)=>ok(res,await jobs.getJob(req.user.id,id(req)))))
router.post('/jobs/:id/cancel',asyncHandler(async(req,res)=>ok(res,await jobs.cancelJob(req.user.id,id(req)))))
router.get('/access',asyncHandler(async(req,res)=>ok(res,{preferences:await access.preferences(req.user.id),wallet:await access.wallet(req.user.id)})))
router.put('/access',asyncHandler(async(req,res)=>ok(res,await access.savePreferences(req.user.id,req.body))))
router.put('/suggestions/:id',asyncHandler(async(req,res)=>ok(res,await service.decideSuggestion(req.user.id,id(req),req.body.state))))
router.get('/materials',asyncHandler(async(req,res)=>ok(res,{materials:await service.materials(req.user.id)})))
router.post('/materials',asyncHandler(async(req,res)=>created(res,await service.saveMaterial(req.user.id,req.body))))
router.get('/vocabulary',asyncHandler(async(req,res)=>ok(res,{questions:vocabularyCards.map(c=>vocabularyQuestion(c,String(req.query.ability||'recognition')))})))
router.post('/vocabulary/answers',asyncHandler(async(req,res)=>ok(res,await vocabularyAnswer(req.user.id,req.body))))
router.get('/vocabulary/:cardId/audio',asyncHandler(async(req,res)=>{
  await consumeWindow(`vocabulary-audio:${req.user.id}`,20,60)
  const card=vocabularyCards.find(c=>c.id===req.params.cardId)
  if(!card)throw notFound('单词不存在')
  const response=await fetch(process.env.KOKORO_URL||'http://127.0.0.1:3003/synthesize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:card.word,rate:1}),signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw badRequest('朗读服务暂不可用，请先使用其他训练模式')
  const audio=await response.json()
  if(audio.mimeType!=='audio/wav'||typeof audio.audioBase64!=='string')throw badRequest('朗读服务返回了无效音频')
  res.type('audio/wav').send(Buffer.from(audio.audioBase64,'base64'))
}))
router.post('/attempts/:id/recordings/:questionId',raw({type:()=>true,limit:'16mb'}),asyncHandler(async(req,res)=>created(res,await media.saveRecording(req.user.id,id(req),req.params.questionId,req.body,req.get('Content-Type')||'',req.get('X-Recording-Consent')))))
router.get('/recordings/:recordingId',asyncHandler(async(req,res)=>{const file=await media.recordingFile(req.user.id,req.params.recordingId);res.type(file.mime_type).sendFile(file.path)}))
router.post('/recordings/:recordingId/transcribe',asyncHandler(async(req,res)=>ok(res,await media.transcribeRecording(req.user.id,req.params.recordingId,req.body.requestKey))))
router.get('/audio/:file',asyncHandler(async(req,res)=>{
  if(!/^[\w.-]+\.(wav|mp3|ogg)$/.test(req.params.file))throw notFound('音频不存在')
  const rows=await query(`SELECT body FROM ielts_papers WHERE ${isAdmin(req.user)?'1=1':"status='published'"} AND skill='listening'`)
  const allowed=rows.some(row=>parseJson(row.body,{}).sections?.some(s=>s.audioUrl===`/api/v1/ielts/audio/${req.params.file}`))
  if(!allowed)throw notFound('音频尚未发布')
  res.sendFile(path.join(service.MEDIA_ROOT,'listening',req.params.file))
}))
router.get('/admin/papers',requireAdmin,asyncHandler(async(req,res)=>ok(res,{papers:await service.catalog({admin:true})})))
router.get('/admin/papers/:id',requireAdmin,asyncHandler(async(req,res)=>ok(res,await service.paperFor(id(req),true))))
router.post('/admin/papers',requireAdmin,asyncHandler(async(req,res)=>created(res,await service.saveDraft(req.body,req.user.id))))
router.post('/admin/papers/:id/review',requireAdmin,asyncHandler(async(req,res)=>ok(res,await service.reviewPaper(id(req),req.body.action,req.body.note,req.user.id))))
router.post('/admin/credits',requireAdmin,asyncHandler(async(req,res)=>ok(res,await access.grantCredits(Number(req.body.userId),req.body.units,req.body.requestKey,req.user.id))))
export default router
