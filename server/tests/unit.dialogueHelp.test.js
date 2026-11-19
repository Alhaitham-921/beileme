import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneFor } from '../src/services/dialogueEngine.js'
import { buildHelpMessages, validateDialogueHelp, selectHelpTarget, buildHelpRetryMessages, copiedReferenceHelp } from '../src/services/dialogueHelpEngine.js'

function session() {
  return { scene: sceneFor('bank', 'beginner'), difficulty:'beginner', turnCount:2,
    messages:[{role:'assistant',text:'Would you like to sit here?'},{role:'user',text:'I would rather get a hot drink.'},{role:'assistant',text:'The café is open. Would you prefer tea or coffee?'}],
    targetUsage:[{word:'bank',status:'unused'},{word:'sit',status:'independent',independent:true}], helpEvents:[] }
}

test('references receive the current conversation, learner draft and roles without preset examples', () => {
  const data=session(), messages=buildHelpMessages(data,{level:4,word:'bank',text:'我想喝茶，然后散步'})
  const input=JSON.parse(messages[1].content)
  assert.equal(input.transcript.at(-1).text,'The café is open. Would you prefer tea or coffee?')
  assert.equal(input.learnerDraft,'我想喝茶，然后散步')
  assert.equal(input.scene.partnerRole,data.scene.role)
  assert.deepEqual(input.target,{word:'bank',sense:'河岸'})
  assert.equal(input.scene.targets,undefined)
  for(const target of data.scene.targets) assert.ok(!messages[1].content.includes(target.example))
  assert.ok(!messages[1].content.includes(data.scene.example))
  assert.match(messages[0].content,/先回答对方最新一句/)
  assert.match(messages[0].content,/不是扮演对话另一方/)
})

test('free references omit vocabulary constraints even if an old client sends a word', () => {
  const data=session(), options={level:3,word:'not-a-target',useMemoryWord:false}
  assert.equal(selectHelpTarget(data,options),null)
  assert.equal(JSON.parse(buildHelpMessages(data,options)[1].content).target,null)
  const result=validateDialogueHelp({hint:'回答想喝茶',example:'Tea sounds lovely. Is the café still open?',translation:'茶听起来不错，咖啡店还开着吗？'},data,options)
  assert.equal(result.word,null);assert.equal(result.useMemoryWord,false)
})

test('selected words must appear in the English reference and use the selected scene sense', () => {
  const data=session(), options={level:4,word:'bank',useMemoryWord:true}
  assert.throws(()=>validateDialogueHelp({example:'Tea sounds lovely.'},data,options),/记忆词/)
  assert.throws(()=>validateDialogueHelp({example:'我想去 bank'},data,options),/英文/)
  assert.throws(()=>selectHelpTarget(data,{word:'invented'}),/本轮记忆词/)
  const result=validateDialogueHelp({example:'Tea first, then a walk along the river bank.'},data,options)
  assert.equal(result.word,'bank');assert.equal(result.level,4)
  data.scene=sceneFor('bank','beginner','finance')
  assert.equal(JSON.parse(buildHelpMessages(data,options)[1].content).target.sense,'银行')
})

test('bad optional hints and translations do not discard a usable English reply', () => {
  const result=validateDialogueHelp({example:'Tea sounds good.',hint:{unexpected:'object'},translation:null},session(),{level:3,useMemoryWord:false})
  assert.equal(result.example,'Tea sounds good.')
  assert.equal(result.hint,'');assert.equal(result.translation,'')
})

test('another reference gets prior suggestions and retries keep the reference output contract', () => {
  const data=session()
  data.helpEvents=[{turn:1,example:'Older reply.'},{turn:2,hint:'选茶',example:'Tea sounds lovely.'}]
  const messages=buildHelpMessages(data,{level:3,useMemoryWord:false})
  assert.deepEqual(JSON.parse(messages[1].content).previousSuggestions,[{hint:'选茶',example:'Tea sounds lovely.'}])
  const retry=buildHelpRetryMessages(messages,new Error('参考表达必须为英文'))
  assert.match(retry[0].content,/hint、example、translation/)
  assert.ok(!retry[0].content.includes('usedTargets'))
  assert.equal(retry[1].content,messages[1].content)
})

test('copying an older reference remains assisted for its actual words only', () => {
  const data=session()
  data.helpEvents=[{level:2,example:'Let us walk along the river bank.'},{level:4,example:'Let us walk along the river bank!'}]
  assert.deepEqual(copiedReferenceHelp(data,'Let us walk along the river bank.'),{level:4,words:['bank']})
  assert.equal(copiedReferenceHelp(data,'I enjoy tea with my friends.'),null)
})

test('references follow the current actor and retain shared facts and speaker identities', () => {
  const data=session()
  data.scene.userRole='办理入住的旅客'
  data.scene.actors=[{id:'frontdesk',name:'前台',role:'前台'},{id:'manager',name:'值班经理',role:'值班经理',responsibility:'协商改期费用'}]
  data.scene.sharedFacts=['房间尚未确认可改期']
  data.journey={activeActorId:'manager'}
  data.messages.push({role:'assistant',actorId:'manager',actorName:'值班经理',text:'Which date would you prefer?'})
  data.helpEvents=[{turn:2,actorId:'frontdesk',example:'An old front desk reply.'},{turn:2,actorId:'manager',example:'A current reply.'}]
  const input=JSON.parse(buildHelpMessages(data,{level:3,useMemoryWord:false})[1].content)
  assert.equal(input.activeActorId,'manager');assert.equal(input.scene.partnerRole,'值班经理')
  assert.equal(input.scene.learnerRole,'办理入住的旅客')
  assert.deepEqual(input.scene.sharedFacts,['房间尚未确认可改期'])
  assert.equal(input.transcript.at(-1).actorId,'manager')
  assert.deepEqual(input.previousSuggestions,[{example:'A current reply.'}])
})
