import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { query, queryOne, execute, withTransaction } from '../../db/pool.js'
import { parseJson } from '../../utils/json.js'
import { badRequest, conflict, notFound, ApiError } from '../../utils/errors.js'
import { SKILLS, validatePaper, validateAnswers, publicPaper, objectiveReport, deadlinePassed } from './engine.js'

export const MEDIA_ROOT = path.resolve(process.env.IELTS_MEDIA_DIR || 'server/media')
const unpack = row => ({ ...parseJson(row.body, {}), id: Number(row.id), status: row.status, version: Number(row.version), reviewedAt: row.reviewed_at, reviewNote: row.review_note })
const assertKey = value => { if (typeof value !== 'string' || !/^[\w-]{8,100}$/.test(value)) throw badRequest('请提供有效的请求编号'); return value }

export async function catalog({ skill, admin = false } = {}) {
  if (skill && !SKILLS.includes(skill)) throw badRequest('科目不正确')
  const rows = await query(`SELECT * FROM ielts_papers WHERE ${admin ? '1=1' : "status='published'"}${skill ? ' AND skill=?' : ''} ORDER BY code,version DESC`, skill ? [skill] : [])
  const seen = new Set()
  return rows.filter(r => { if (seen.has(r.code)) return false; seen.add(r.code); return true }).map(row => {
    const paper = unpack(row)
    return { id: paper.id, code: row.code, version: paper.version, title: paper.title, skill: paper.skill, status: row.status, durationSeconds: paper.durationSeconds, questionCount: paper.questions.length, draftNote: row.status !== 'published' ? paper.draftNote || '待教师复核' : '', source: paper.source }
  })
}

export async function paperFor(id, admin = false) {
  const row = await queryOne(`SELECT * FROM ielts_papers WHERE id=?${admin ? '' : " AND status='published'"}`, [id])
  if (!row) throw notFound('试卷尚未发布或不存在')
  return unpack(row)
}

export async function saveDraft(body, actor) {
  const paper = validatePaper(body)
  if (!/^[\w-]{1,100}$/.test(paper.code)) throw badRequest('试卷编号不正确')
  if (!paper.source || !['original','licensed'].includes(paper.source.kind) || typeof paper.source.license !== 'string') throw badRequest('请填写原创或授权来源和许可')
  return withTransaction(async conn => {
    const [versions] = await conn.execute('SELECT version FROM ielts_papers WHERE code=? ORDER BY version DESC LIMIT 1 FOR UPDATE', [paper.code])
    const version = Number(versions[0]?.version || 0) + 1
    const saved = { ...paper, version }
    const [result] = await conn.execute("INSERT INTO ielts_papers(code,version,skill,title,status,body,source_info,review_note) VALUES(?,?,?,?,'draft',?,?,?)", [paper.code,version,paper.skill,paper.title,JSON.stringify(saved),JSON.stringify(paper.source),`草稿创建者：${actor}`])
    return { id: Number(result.insertId), version, status: 'draft' }
  })
}

export async function reviewPaper(id, action, note, actor) {
  if (!['review','publish'].includes(action) || typeof note !== 'string' || note.trim().length < 10 || note.length > 4000) throw badRequest('请填写至少 10 字的审核说明')
  const paper = await paperFor(id, true)
  validatePaper(paper)
  if (action === 'publish') {
    if (paper.status !== 'review') throw conflict('请先提交教师复核，再确认发布')
    if (paper.skill === 'listening') {
      for (const section of paper.sections) {
        if (!section.audioUrl) throw badRequest('听力材料尚未配音')
        const name = section.audioUrl.split('/').at(-1)
        try { await fs.access(path.join(MEDIA_ROOT, 'listening', name)) } catch { throw badRequest(`听力音频 ${name} 尚未准备好`) }
      }
    }
  }
  const next = action === 'publish' ? 'published' : 'review'
  const result = await execute('UPDATE ielts_papers SET status=?,review_note=?,reviewed_by=?,reviewed_at=UTC_TIMESTAMP() WHERE id=? AND status=?', [next,note.trim(),actor,id,paper.status])
  if (!result.affectedRows) throw conflict('审核状态已变化，请刷新')
  return { id, status: next }
}

function attemptView(row, paper) {
  return { id: Number(row.id), mode: row.mode, state: row.state, revision: Number(row.revision), answers: parseJson(row.answers, {}), annotations:parseJson(row.annotations,{highlights:[],flags:[]}), startedAt: row.started_at, deadlineAt: row.deadline_at, serverNow: new Date().toISOString(), submittedAt: row.submitted_at, report: parseJson(row.report, null), paper: publicPaper(paper, { reveal: row.state === 'submitted', mode: row.mode }) }
}

async function finishLocked(conn, row, paper) {
  if (row.state === 'submitted') return row
  const answers = parseJson(row.answers, {})
  const report = objectiveReport(paper, answers)
  await conn.execute("UPDATE ielts_attempts SET state='submitted',report=?,submitted_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(report),row.id])
  for (const question of report.questions) {
    if (question.correct === null) continue
    await conn.execute('INSERT IGNORE INTO learning_evidence(user_id,source_key,skill,ability,correct,evidence) VALUES(?,?,?,?,?,?)', [row.user_id,`attempt:${row.id}:${question.id}`,paper.skill,question.type,question.correct ? 1 : 0,JSON.stringify({ paperId:paper.id,version:paper.version,questionId:question.id,answer:question.answer,expected:question.expected })])
    if (!question.correct && answers[question.id]) {
      const original = paper.questions.find(q=>q.id===question.id)
      for (const spelling of (original.targetWords || []).slice(0,10)) {
        await conn.execute('INSERT IGNORE INTO learning_suggestions(user_id,source_key,spelling,note) VALUES(?,?,?,?)', [row.user_id,`attempt:${row.id}:${question.id}`,spelling,`${paper.title} · ${question.id}：${question.explanation}`.slice(0,500)])
      }
    }
  }
  return { ...row, state:'submitted', report:JSON.stringify(report), submitted_at:new Date() }
}

export async function startAttempt(userId, { paperId, mode = 'practice', requestKey }, admin = false) {
  assertKey(requestKey)
  if (!['practice','mock'].includes(mode)) throw badRequest('训练模式不正确')
  const paper = await paperFor(paperId, admin)
  return withTransaction(async conn => {
    const [prior] = await conn.execute('SELECT * FROM ielts_attempts WHERE user_id=? AND request_key=? FOR UPDATE', [userId,requestKey])
    if (prior.length) {
      if (Number(prior[0].paper_id) !== Number(paperId) || prior[0].mode !== mode) throw conflict('请求编号已用于其他训练')
      return attemptView(prior[0],paper)
    }
    const started = new Date()
    const deadline = mode==='mock' ? new Date(started.getTime()+paper.durationSeconds*1000) : null
    const [result] = await conn.execute('INSERT INTO ielts_attempts(user_id,paper_id,request_key,mode,answers,started_at,deadline_at) VALUES(?,?,?,?,?,?,?)', [userId,paperId,requestKey,mode,'{}',started,deadline])
    const [rows] = await conn.execute('SELECT * FROM ielts_attempts WHERE id=?',[result.insertId])
    return attemptView(rows[0],paper)
  })
}

export async function getAttempt(userId,id) {
  return withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT * FROM ielts_attempts WHERE id=? AND user_id=? FOR UPDATE',[id,userId])
    if (!rows.length) throw notFound('练习记录不存在')
    let row=rows[0]
    const [papers] = await conn.execute('SELECT * FROM ielts_papers WHERE id=?',[row.paper_id])
    const paper=unpack(papers[0])
    if (row.state!=='submitted' && deadlinePassed(row)) row=await finishLocked(conn,row,paper)
    return attemptView(row,paper)
  })
}

export async function saveAttempt(userId,id,{revision,answers,annotations,action='save'}) {
  return withTransaction(async conn => {
    const [rows]=await conn.execute('SELECT * FROM ielts_attempts WHERE id=? AND user_id=? FOR UPDATE',[id,userId])
    if (!rows.length) throw notFound('练习记录不存在')
    let row=rows[0]
    const [papers]=await conn.execute('SELECT * FROM ielts_papers WHERE id=?',[row.paper_id])
    const paper=unpack(papers[0])
    if (row.state==='submitted') return attemptView(row,paper)
    if (deadlinePassed(row)) return attemptView(await finishLocked(conn,row,paper),paper)
    if (!Number.isInteger(revision) || revision!==Number(row.revision)) throw conflict('其他页面已保存较新答案，请先重新载入；当前输入仍保留')
    if (!['save','submit','pause','resume'].includes(action)) throw badRequest('操作不正确')
    if (row.mode==='mock' && ['pause','resume'].includes(action)) throw badRequest('模考计时不能暂停')
    if (row.state==='paused' && !['resume','submit'].includes(action)) throw conflict('请先继续这份练习')
    const nextAnswers=validateAnswers(paper,answers)
    if(annotations&&(!Array.isArray(annotations.highlights)||!Array.isArray(annotations.flags)||annotations.highlights.length>500||annotations.flags.length>100||[...annotations.highlights,...annotations.flags].some(v=>typeof v!=='string'||v.length>120)))throw badRequest('标记格式不正确')
    const nextState=action==='pause'?'paused':'active'
    const nextRevision=Number(row.revision)+1
    await conn.execute('UPDATE ielts_attempts SET answers=?,annotations=?,revision=?,state=?,paused_at=? WHERE id=?',[JSON.stringify(nextAnswers),JSON.stringify(annotations||parseJson(row.annotations,{highlights:[],flags:[]})),nextRevision,nextState,action==='pause'?new Date():null,id])
    if (paper.skill==='writing') await conn.execute('INSERT INTO ielts_answer_versions(attempt_id,revision,answers) VALUES(?,?,?)',[id,nextRevision,JSON.stringify(nextAnswers)])
    row={...row,answers:JSON.stringify(nextAnswers),annotations:JSON.stringify(annotations||parseJson(row.annotations,{highlights:[],flags:[]})),revision:nextRevision,state:nextState}
    if (action==='submit') row=await finishLocked(conn,row,paper)
    return attemptView(row,paper)
  })
}

export async function listAttempts(userId) {
  return query('SELECT a.id,a.mode,a.state,a.revision,a.started_at,a.deadline_at,a.submitted_at,a.updated_at,p.title,p.skill,p.version FROM ielts_attempts a JOIN ielts_papers p ON p.id=a.paper_id WHERE a.user_id=? ORDER BY a.updated_at DESC,a.id DESC LIMIT 50',[userId])
}

export async function answerVersions(userId,id) {
  await getAttempt(userId,id)
  const rows=await query('SELECT revision,answers,created_at FROM ielts_answer_versions WHERE attempt_id=? ORDER BY revision DESC LIMIT 30',[id])
  return rows.map(r=>({...r,answers:parseJson(r.answers,{})}))
}

export async function getProfile(userId) {
  const row=await queryOne('SELECT * FROM ielts_profiles WHERE user_id=?',[userId])
  return {targetBand:Number(row?.target_band||6.5),skillTargets:parseJson(row?.skill_targets,{listening:6.5,reading:6.5,writing:6,speaking:6}),examDate:row?.exam_date ? new Date(row.exam_date).toISOString().slice(0,10) : null,dailyMinutes:Number(row?.daily_minutes||30)}
}
export async function saveProfile(userId,body) {
  const validBand=v=>typeof v==='number' && v>=1 && v<=9 && Number.isInteger(v*2)
  if (!validBand(body.targetBand) || !SKILLS.every(s=>validBand(body.skillTargets?.[s]))) throw badRequest('目标分数需在 1–9 分之间，步长为 0.5')
  if (!Number.isInteger(body.dailyMinutes) || body.dailyMinutes<5 || body.dailyMinutes>240) throw badRequest('每日时长应为 5–240 分钟')
  if (body.examDate && (!/^\d{4}-\d{2}-\d{2}$/.test(body.examDate) || !Number.isFinite(Date.parse(body.examDate)) || new Date(body.examDate).toISOString().slice(0,10)!==body.examDate)) throw badRequest('考试日期不正确')
  await execute('INSERT INTO ielts_profiles(user_id,target_band,skill_targets,exam_date,daily_minutes) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE target_band=VALUES(target_band),skill_targets=VALUES(skill_targets),exam_date=VALUES(exam_date),daily_minutes=VALUES(daily_minutes)',[userId,body.targetBand,JSON.stringify(body.skillTargets),body.examDate||null,body.dailyMinutes])
  return getProfile(userId)
}

export async function overview(userId) {
  const [profile,attempts,evidence,suggestions,retention]=await Promise.all([
    getProfile(userId),listAttempts(userId),
    query('SELECT skill,ability,COUNT(*) total,SUM(correct=1) correct FROM learning_evidence WHERE user_id=? GROUP BY skill,ability',[userId]),
    query("SELECT * FROM learning_suggestions WHERE user_id=? AND state='pending' ORDER BY id DESC LIMIT 30",[userId]),
    query("SELECT ability,COUNT(*) total,SUM(correct=1) correct FROM learning_evidence WHERE user_id=? AND skill='vocabulary' AND DATE(created_at)<UTC_DATE() GROUP BY ability",[userId])
  ])
  const weakest=evidence.filter(e=>Number(e.total)>=3).sort((a,b)=>Number(a.correct)/Number(a.total)-Number(b.correct)/Number(b.total)).slice(0,3)
  const [words]=await query('SELECT COUNT(*) learned,SUM(state=\'mastered\') stable FROM user_word_progress WHERE user_id=?',[userId])
  return {profile,attempts,evidence,suggestions,retention,weakest,wordCounts:{learned:Number(words?.learned||0),stable:Number(words?.stable||0)},nextSkill:weakest.find(e=>SKILLS.includes(e.skill))?.skill||'reading'}
}

export async function decideSuggestion(userId,id,state) {
  if (!['accepted','dismissed'].includes(state)) throw badRequest('请选择加入复习或暂不加入')
  return withTransaction(async conn=>{
    const [rows]=await conn.execute('SELECT * FROM learning_suggestions WHERE id=? AND user_id=? FOR UPDATE',[id,userId])
    if (!rows.length) throw notFound('复习建议不存在')
    if(rows[0].state!=='pending') return {state:rows[0].state}
    let wordId=null
    if(state==='accepted') {
      const [words]=await conn.execute('SELECT id,wordbook_id FROM words WHERE spelling_norm=? ORDER BY id LIMIT 1',[rows[0].spelling.toLowerCase()])
      if(words.length){wordId=Number(words[0].id);await conn.execute('INSERT INTO user_word_progress(user_id,word_id,wordbook_id,first_learned_at,next_review_at) VALUES(?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE next_review_at=LEAST(COALESCE(next_review_at,UTC_TIMESTAMP()),UTC_TIMESTAMP())',[userId,wordId,words[0].wordbook_id])}
    }
    await conn.execute('UPDATE learning_suggestions SET state=? WHERE id=?',[state,id])
    return {state,wordId,note:wordId?'已加入词汇复习':'已保留在学习档案；词书未收录的表达可加入个人素材库'}
  })
}

export async function materials(userId) { return query('SELECT * FROM ielts_materials WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT 100',[userId]) }
export async function saveMaterial(userId,body) {
  if(typeof body.title!=='string'||!body.title.trim()||body.title.length>190||typeof body.body!=='string'||!body.body.trim()||body.body.length>20000||typeof body.topic!=='string'||body.topic.length>100)throw badRequest('请填写标题、话题及不超过 20000 字的素材')
  if(body.id){const result=await execute('UPDATE ielts_materials SET title=?,topic=?,body=? WHERE id=? AND user_id=?',[body.title.trim(),body.topic,body.body,body.id,userId]);if(!result.affectedRows)throw notFound('素材不存在');return {id:body.id}}
  const result=await execute('INSERT INTO ielts_materials(user_id,title,topic,body) VALUES(?,?,?,?)',[userId,body.title.trim(),body.topic,body.body]);return {id:Number(result.insertId)}
}
