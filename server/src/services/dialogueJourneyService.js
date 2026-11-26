import { applyWorkflowAction,workflowActorIds } from './scenarioWorkflow.js'
import { actorMessages } from '../../../src/utils/actorConversation.js'
import { queryOne, withTransaction } from '../db/pool.js'
import { parseJson } from '../utils/json.js'
import { badRequest, conflict, notFound } from '../utils/errors.js'
import { recordWordEvidence } from './wordLearningEvidence.js'
import { resolveProvider } from './ai/apiKeyService.js'
import { questionFeedback, presentJourney, challengeIdentity, challengeOutcome } from './dialogueJourney.js'

export function currentActor(session) {
  return session.scene.actors?.find(actor => actor.id === session.journey?.activeActorId)
}
export function assertRevision(session, revision) {
  if (revision != null && revision !== session.journey?.revision) throw conflict('练习进度已更新，请刷新后继续')
}
export function assertConversation(session) {
  if (session.journey?.phase === 'preparation') throw conflict('请先完成或跳过词汇认识，再开始对话')
}

async function mutate(userId, id, statuses, change) {
  return withTransaction(async conn => {
    const [[row]] = await conn.execute('SELECT * FROM dialogue_sessions WHERE id=? AND user_id=? FOR UPDATE', [id, userId])
    if (!row) throw notFound('这轮情境对话不存在')
    if (!statuses.includes(row.status)) throw conflict('这轮练习当前不能执行此操作')
    if (row.lease_until && new Date(row.lease_until).getTime() > Date.now()) throw conflict('上一条还在处理中，请稍候')
    const session = { ...parseJson(row.state, {}), id: Number(row.id), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }
    if (!session.journey) throw badRequest('旧练习记录已保留，请开始新一轮体验任务挑战')
    const changed = await change(session, conn)
    if (changed !== false) {
      session.journey.revision++
      await conn.execute('UPDATE dialogue_sessions SET state=?,updated_at=UTC_TIMESTAMP() WHERE id=? AND user_id=?', [JSON.stringify(session), id, userId])
    }
    return presentJourney(session)
  })
}

export function answerPreparation(userId, id, { questionId, selectedIndex, skipped = false, expectedRevision }) {
  return mutate(userId, id, ['active'], session => {
    if (session.journey.preparation.answers.some(answer => answer.questionId === questionId)) return false
    assertRevision(session, expectedRevision)
    if (session.journey.phase !== 'preparation') throw conflict('词汇认识环节已结束')
    const question = session.journey.preparationQuestions[session.journey.preparation.answers.length]
    if (!question || question.id !== questionId || (!skipped && (!Number.isInteger(selectedIndex) || !question.options[selectedIndex]))) throw badRequest('请选择当前题目的有效选项')
    session.journey.preparation.answers.push(questionFeedback(question, { selectedIndex, skipped }))
  })
}

export async function beginConversation(userId, id, { expectedRevision, skip = false }) {
  const provider = await resolveProvider(userId)
  if (provider.source === 'none') {
    const { ApiError } = await import('../utils/errors.js')
    throw new ApiError(503, 'AI_NOT_CONFIGURED', '词汇练习已保存，请先在设置中配置文字 AI，再进入情境对话')
  }
  return mutate(userId, id, ['active'], session => {
    if (session.journey.phase === 'conversation') return false
    assertRevision(session, expectedRevision)
    if (!skip && session.journey.preparation.answers.length < session.journey.preparationQuestions.length) throw badRequest('可以继续认识词汇，也可以选择跳过后直接对话')
    session.journey.preparation.skipped = skip
    session.journey.phase = 'conversation'
    const actor = currentActor(session)
    session.messages.push({ role: 'assistant', actorId: actor.id, actorName: actor.name, flowStageId:session.scene.workflow?.stages[0].id,event:session.scene.workflow?'stage_opening':undefined, text: session.scene.opening,
      translation: session.scene.workflow?.stages[0].openingTranslation || session.scene.openingTranslation || '' })
  })
}

export function switchDialogueActor(userId, id, { actorId, expectedRevision, expectedTurn }) {
  return mutate(userId, id, ['active'], session => {
    assertConversation(session)
    const next = session.scene.actors.find(actor => actor.id === actorId)
    if (!next) throw badRequest('请选择本场景中的交谈对象')
    if(!workflowActorIds(session).includes(actorId))throw badRequest('当前阶段请联系负责本步骤的角色；进入后续阶段可联系其他对象')
    if (session.journey.activeActorId === actorId) return false
    assertRevision(session, expectedRevision)
    if (session.turnCount !== expectedTurn) throw conflict('对话已更新，请刷新后切换')
    const prior = currentActor(session)
    session.journey.actorEvents.push({ from: prior.id, to: actorId, turn: session.turnCount, at: new Date().toISOString() })
    session.journey.activeActorId = actorId
    session.help = null
    session.journey.handoff = null
    // Returning to a person resumes their existing conversation without a new greeting.
    if (!actorMessages(session, actorId).length) session.messages.push({ role: 'assistant', actorId, actorName: next.name, event: 'actor_switch',
      text: next.opening || `Hello, I'm ${next.englishName || next.name}. What would you like to discuss?`,
      translation: next.openingTranslation || `你好，我是${next.name}。你想聊些什么？` })
    // This is a free transition. It does not consume a user turn, call AI, or award evidence.
  })
}

export function consolidateDialogue(userId, id, { action = 'answer', questionId, answer = '', selectedIndex, skipped = false, expectedRevision }) {
  return mutate(userId, id, ['finished'], async (session, conn) => {
    const practice = session._consolidation
    if (!practice) throw badRequest('这轮练习没有巩固题，请开始新一轮情境练习')
    if (action === 'reset') {
      assertRevision(session, expectedRevision)
      if (practice.answers.length !== practice.questions.length) throw conflict('请先完成或跳过本组题目')
      practice.run++; practice.answers = []; practice.hints = []
      delete practice.hint
      return
    }
    if (practice.answers.some(item => item.questionId === questionId)) return false
    assertRevision(session, expectedRevision)
    const question = practice.questions[practice.answers.length]
    if (!question || question.id !== questionId) throw badRequest('请按顺序练习当前题目')
    if (action === 'hint') {
      if (!practice.hints.includes(questionId)) practice.hints.push(questionId)
      practice.hint = { questionId, correctAnswer: question.answer }
      return
    }
    if (!skipped && (question.type === 'meaning' ? !Number.isInteger(selectedIndex) || !question.options[selectedIndex] : !answer.trim())) throw badRequest('请作答或选择暂时想不起来')
    const feedback = questionFeedback(question, { selectedIndex, answer, skipped }, practice.hints.includes(questionId))
    practice.answers.push(feedback)
    delete practice.hint
    const bookId = session.journey.wordbookId
    const [[word]] = bookId ? await conn.execute('SELECT id FROM words WHERE wordbook_id=? AND spelling_norm=? LIMIT 1', [bookId, question.word.toLowerCase()]) : [[]]
    const [saved] = await conn.execute(`INSERT INTO dialogue_consolidation_attempts
      (session_id,user_id,run_number,question_id,word_id,spelling,sense,question_type,result,answer,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
    [id, userId, practice.run, question.id, word?.id || null, question.word, question.sense, question.type, feedback.result, feedback.answer])
    await recordWordEvidence(conn, { userId, wordId: word?.id, sense: question.sense, source: 'dialogue_quiz', sourceKey: saved.insertId,
      result: feedback.result, details: { sessionId: id, type: question.type, hinted: practice.hints.includes(questionId) } })
  })
}

export async function saveChallenge(conn, userId, session) {
  const identity = challengeIdentity(session), outcome = challengeOutcome(session)
  let transfer = false
  if (outcome.independent) {
    const [previous] = await conn.execute(`SELECT target_keys FROM dialogue_challenge_results
      WHERE user_id=? AND family=? AND independent=1 AND context_key<>? AND earned_at<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)`, [userId, identity.family, identity.context])
    transfer = previous.some(row => parseJson(row.target_keys, []).some(key => identity.targets.includes(key)))
  }
  await conn.execute(`INSERT INTO dialogue_challenge_results(session_id,user_id,challenge_key,family,context_key,target_keys,completed,independent,transfer,earned_at)
    VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, [session.id, userId, identity.key, identity.family, identity.context, JSON.stringify(identity.targets), Number(outcome.completed), Number(outcome.independent), Number(transfer)])
  const rewards = [outcome.completed && '任务通关印记', outcome.independent && '独立表达星', transfer && '跨日迁移星'].filter(Boolean)
  return { ...outcome, transfer, rewards, family: identity.family,
    unlock: outcome.completed && identity.family === 'hotel' && session.scene.challenge !== 'change_dates' ? '酒店改期挑战' : null,
    criteria: ['完成全部交流目标，并能在用户原话中找到依据', '交流目标独立完成，且独立用出本场景目标词', '至少间隔24小时，在同主题的不同任务中独立使用相同词义'],
    comparison: await previousChallenge(conn, userId, session.id, identity.key) }
}

async function previousChallenge(conn, userId, sessionId, key) {
  const [[row]] = await conn.execute(`SELECT s.state FROM dialogue_challenge_results r JOIN dialogue_sessions s ON s.id=r.session_id
    WHERE r.user_id=? AND r.challenge_key=? AND r.session_id<? ORDER BY r.session_id DESC LIMIT 1`, [userId, key, sessionId])
  if (!row) return null
  const prior = parseJson(row.state, {})
  return { previousIndependentWords: (prior.targetUsage || []).filter(t => t.status === 'independent').length,
    previousHelpCount: (prior.helpEvents || []).length }
}

export function actWorkflow(userId,id,input) {
  return mutate(userId,id,['active'],session=>{
    assertConversation(session); assertRevision(session,input.expectedRevision)
    try { applyWorkflowAction(session,input) } catch(error) { throw badRequest(error.message) }
  })
}

export function extendDialogue(userId,id,{maxTurns,expectedRevision}){
 return mutate(userId,id,['active'],session=>{
  assertRevision(session,expectedRevision)
  if(session.scene.memoryImage)throw badRequest('看图三轮请结束后开始新一轮')
  if(maxTurns<=session.maxTurns||maxTurns<=session.turnCount)throw badRequest('新的练习长度应大于当前长度和已进行轮次')
  session.maxTurns=maxTurns;session.scene.maxTurns=maxTurns;session.flexibleLength=true
 })
}
