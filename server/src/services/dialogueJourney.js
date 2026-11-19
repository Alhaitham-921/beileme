import { createHash } from 'node:crypto'

const actor = (id, name, responsibility) => ({ id, name, role: name, responsibility })
const catalogs = {
  hotel: [actor('frontdesk', '酒店前台', '核对预订和日常入住信息；需要协商费用或例外处理时建议联系值班经理'), actor('manager', '值班经理', '处理房间、改期与费用协商，遵守共同任务事实，不擅自改变已经确认的条件'), actor('companion', '同行朋友', '与住客商量方案和偏好，没有酒店审批权限')],
  restaurant: [actor('waiter', '餐厅服务员', '接待、点餐和账单'), actor('chef', '厨师', '回答配料与饮食需求，不替用户决定点什么'), actor('companion', '同桌朋友', '商量菜品和预算，没有餐厅审批权限')],
  directions: [actor('passerby', '热心路人', '说明附近路线'), actor('guide', '游客中心工作人员', '核对路线和交通选择'), actor('companion', '同行朋友', '商量路线和出行偏好')],
  finance: [actor('teller', '银行柜员', '核对开户需求和证件'), actor('advisor', '客户顾问', '解释账户方案和办理安排'), actor('companion', '陪同朋友', '商量需求，没有银行审批权限')],
  river: [actor('elder', '公园里的老人', '与游客闲聊河岸与公园'), actor('guide', '公园工作人员', '解释步道和公园信息'), actor('companion', '同行朋友', '商量散步计划')],
  interview: [actor('interviewer', '招聘面试官', '询问学习背景和项目经历'), actor('lead', '团队负责人', '追问项目细节和团队合作'), actor('hr', '招聘协调员', '说明岗位职责和后续安排')],
  shopping: [actor('assistant', '店员', '尺码、款式、价格和收据'), actor('manager', '门店经理', '处理退换申请和例外协商'), actor('companion', '同行朋友', '商量选择和预算，没有店铺审批权限')],
  campus: [actor('teammate', '项目组同学', '讨论想法和分工'), actor('coordinator', '小组协调人', '协商截止日期和会议'), actor('mentor', '指导老师', '讨论项目要求，不代替学生完成任务')],
}
const goals = { restaurant: ['说明点餐需求', '询问菜品或推荐', '确认选择和价格'], directions: ['说明目的地', '询问具体路线', '确认路线细节'], river: ['说明来意', '询问河岸步道', '确认散步安排'], finance: ['说明开户需求', '询问证件或账户条件', '确认办理安排'] }
const normalized = text => String(text || '').normalize('NFKC').trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLowerCase()
const hash = value => createHash('sha256').update(value).digest('hex')

export function journeyScene(input, variant) {
  const scene = structuredClone(input)
  const family = scene.sourceSceneId || scene.id
  const template = family === 'bank' ? variant || scene.variant || 'river' : family
  scene.userRole ||= template === 'finance' ? '前来开户的客户' : template === 'river' ? '公园游客' : '完成当前交流任务的学习者'
  scene.actors = scene.actors?.length ? scene.actors : structuredClone(catalogs[template] || [actor('partner', scene.role || '交流伙伴', '围绕当前任务与用户交流'), actor('companion', '讨论伙伴', '帮助用户商量选择，不代替任务中的工作人员做决定')])
  const englishNames = {frontdesk:'Front Desk',manager:'Manager',companion:'Friend',waiter:'Waiter',chef:'Chef',passerby:'Passerby',guide:'Guide',teller:'Teller',advisor:'Advisor',elder:'Visitor',interviewer:'Interviewer',lead:'Team Lead',hr:'HR',assistant:'Assistant',teammate:'Teammate',coordinator:'Coordinator',mentor:'Mentor',partner:'Partner'}
  scene.actors = scene.actors.map(item => ({...item,englishName:item.englishName||englishNames[item.id]||'Partner'}))
  scene.userRoleEnglish ||= ({hotel:'Guest',restaurant:'Diner',directions:'Visitor',river:'Visitor',finance:'Customer',interview:'Candidate',shopping:'Customer',campus:'Student'})[template] || 'Learner'
  scene.goals = scene.goals?.length ? scene.goals : goals[template] || ['说明具体需求', '讨论可行方案', '确认交流结果']
  scene.sharedFacts ||= []
  scene.challengeFamily = family
  return scene
}

export function hotelChangeScene(scene) {
  return { ...scene, title: '酒店改期挑战', challenge: 'change_dates',
    task: '你是住客，原预订周五入住，现在希望改到周六。说明问题、协商改期方案，并确认最终日期和额外费用。',
    goals: ['说明原预订与改期需求', '讨论可用房间及费用方案', '确认新入住日期和最终费用'],
    sharedFacts: ['用户始终是住客，原预订周五入住，希望改到周六', '周六有可用房间，标准改期差价为每晚80元', '值班经理可以在用户提出协商后减免40元，最终差价为每晚40元；前台不能直接批准减免', '同行朋友只能提供建议；必须由住客向酒店确认最终选择'],
    targets: [{ word: 'reservation', sense: '预订', phrase: 'change a reservation', example: 'I would like to change my reservation.' },
      { word: 'available', sense: '可用的；有空的', phrase: 'an available room', example: 'Is there an available room for Saturday?' },
      { word: 'confirm', sense: '确认', phrase: 'confirm the new date', example: 'Could you confirm the new date and the extra charge?' }],
    words: ['reservation', 'available', 'confirm'], opening: 'Welcome! How can I help with your reservation?', openingTranslation: '欢迎！你的预订需要什么帮助？' }
}

function meaningQuestions(targets, prefix) {
  return targets.map((target, index) => {
    const distractors = [...new Set([...targets.filter(t => t.sense !== target.sense).map(t => t.sense), '一种交通工具', '一种天气现象', '一种运动项目', '一种食物'])]
      .filter(sense => sense !== target.sense).slice(0, 3)
    const options = [target.sense, ...distractors]
    const offset = index % options.length
    const rotated = [...options.slice(offset), ...options.slice(0, offset)]
    return { id: `${prefix}-${index}`, type: 'meaning', word: target.word, sense: target.sense,
      prompt: `${target.word} 在本次情境中是什么意思？`, options: rotated, answer: target.sense, correctIndex: rotated.indexOf(target.sense) }
  })
}

export function consolidationQuestions(scene) {
  const targets = scene.targets || []
  const meaning = meaningQuestions(targets.slice(0, 2), 'meaning')
  const phrases = targets.slice(0, 3).flatMap((target, index) => {
    const pattern = new RegExp(`\\b${target.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (!pattern.test(target.phrase)) return []
    return [{ id: `phrase-${index}`, type: 'phrase', word: target.word, sense: target.sense,
      prompt: `填入本次情境的目标词：${target.phrase.replace(pattern, '______')}`, answer: target.word, explanation: `${target.phrase} · ${target.sense}` }]
  })
  return [...meaning, ...phrases]
}

export function initJourney(scene, prepare = false) {
  return { version: 1, phase: prepare ? 'preparation' : 'conversation', revision: 0,
    activeActorId: scene.actors[0].id, actorEvents: [], handoff: null,
    goals: scene.goals.map((description, index) => ({ id: `goal-${index + 1}`, description, completed: false })),
    preparation: { skipped: !prepare, answers: [] }, preparationQuestions: meaningQuestions(scene.targets, 'prepare') }
}

export function applyGoalEvidence(session, raw, text, helpLevel) {
  const journey = session.journey
  if (!journey) return
  const assessments = Array.isArray(raw.goalEvidence) ? raw.goalEvidence.slice(0, 4) : []
  for (const evidence of assessments) {
    if (!evidence || typeof evidence !== 'object') continue
    const goal = journey.goals.find(goal => goal.id === evidence.goalId)
    const quote = typeof evidence.quote === 'string' ? evidence.quote.trim() : ''
    // Completion is a model assessment with a verifiable excerpt, not a keyword or turn-count score.
    if (!goal || evidence.completed !== true || quote.length < 5 || !/[A-Za-z]/.test(quote) || !text.includes(quote) || /\p{Script=Han}/u.test(text)) continue
    if (session.messages.at(-1)?.role === 'user' && session.messages.at(-1)?.corrections?.some(c => c.original && quote.includes(c.original))) continue
    const independent = helpLevel < 2
    if (goal.completed && (goal.independent || !independent)) continue
    Object.assign(goal, { completed: true, independent, quote, actorId: journey.activeActorId, turn: session.turnCount + 1 })
  }
  const handoff = raw.handoff
  journey.handoff = handoff && typeof handoff.reason === 'string' && handoff.reason.trim().length > 0 && handoff.reason.length <= 250 &&
    session.scene.actors.some(actor => actor.id === handoff.actorId && actor.id !== journey.activeActorId)
    ? { actorId: handoff.actorId, reason: handoff.reason.trim() } : null
}

export function challengeIdentity(session) {
  const scene = session.scene
  const family = scene.challengeFamily || scene.sourceSceneId || scene.id || session.sceneId
  return { family, key: `${family}:${session.variant || ''}:${scene.challenge || 'standard'}:${session.difficulty}`,
    context: hash(JSON.stringify([scene.task, scene.sharedFacts || []])),
    targets: (scene.targets || []).map(t => normalized(t.word) + ':' + normalized(t.sense)) }
}

export function challengeOutcome(session) {
  const goals = session.journey?.goals || []
  const completed = session.mode === 'task' && session.turnCount > 0 && goals.length > 0 && goals.every(goal => goal.completed)
  const independent = completed && goals.every(goal => goal.independent) && !(session.helpEvents || []).some(event => event.level >= 2) &&
    (session.targetUsage || []).some(target => target.status === 'independent')
  return { completed, independent, goals: structuredClone(goals), assessedBy: 'ai_with_quoted_user_evidence',
    note: '通关记录代表本次任务表现，不是英语等级或长期掌握证明。' }
}

export function questionFeedback(question, { selectedIndex, answer = '', skipped = false }, hinted = false) {
  const correct = !skipped && (question.type === 'meaning' ? selectedIndex === question.correctIndex : normalized(answer) === normalized(question.answer))
  return { questionId: question.id, result: skipped ? 'skipped' : correct ? hinted ? 'hinted' : 'correct' : 'incorrect',
    answer: question.type === 'meaning' ? question.options[selectedIndex] ?? '' : answer,
    correctAnswer: question.answer, explanation: question.explanation || `${question.word} · ${question.sense}` }
}

export function presentJourney(session) {
  const result = structuredClone(session)
  if (result.journey) {
    result.journey.preparation.questions = (result.journey.preparationQuestions || []).map(({ answer, correctIndex, sense, explanation, ...question }) => question)
    delete result.journey.preparationQuestions
  }
  if (result._consolidation) {
    const { questions, ...progress } = result._consolidation
    result.consolidation = { ...progress, questions: questions.map(({ answer, correctIndex, ...question }) => question) }
    delete result._consolidation
  }
  return result
}
