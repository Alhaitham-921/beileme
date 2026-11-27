import test from 'node:test'
import assert from 'node:assert/strict'
import { journeyScene, hotelChangeScene, initJourney, applyGoalEvidence, challengeOutcome, challengeIdentity, presentJourney } from '../src/services/dialogueJourney.js'
import { sceneFor, buildTurnMessages } from '../src/services/dialogueEngine.js'
import { validateSceneHint, SCENE_HINT_RULES } from '../src/services/dialogueSceneImage.js'

function fixture() {
  const scene = journeyScene(sceneFor('hotel','beginner'))
  scene.actors = hotelChangeScene(scene).actors
  return { scene, journey:initJourney(scene), messages:[], turnCount:1, mode:'task', difficulty:'beginner', helpEvents:[], targetUsage:[{status:'independent'}] }
}
test('goal evidence ignores malformed, invented, Chinese and corrected claims; quotes keep speaker and turn', () => {
  const s=fixture(), text='I have a reservation for tonight.'
  applyGoalEvidence(s,{goalEvidence:[null,1,{goalId:'goal-1',completed:true,quote:'not in this message'},{goalId:'missing',completed:true,quote:text}]},text,0)
  assert.ok(s.journey.goals.every(g=>!g.completed))
  applyGoalEvidence(s,{goalEvidence:[{goalId:'goal-1',completed:true,quote:text}],handoff:{actorId:'invented',reason:'transfer'}},text+' 我想入住',0)
  assert.ok(!s.journey.goals[0].completed);assert.equal(s.journey.handoff,null)
  s.messages=[{role:'user',corrections:[{original:'reservation'}]}]
  applyGoalEvidence(s,{goalEvidence:[{goalId:'goal-1',completed:true,quote:text}]},text,0)
  assert.ok(!s.journey.goals[0].completed)
  s.messages=[]
  applyGoalEvidence(s,{goalEvidence:s.journey.goals.map(g=>({goalId:g.id,completed:true,quote:text})),handoff:{actorId:'manager',reason:'费用需要经理处理'}},text,0)
  assert.equal(s.journey.goals[0].actorId,'frontdesk');assert.equal(s.journey.goals[0].turn,2)
  assert.equal(s.journey.activeActorId,'frontdesk');assert.equal(s.journey.handoff.actorId,'manager')
  assert.equal(challengeOutcome(s).independent,true)
  s.helpEvents.push({level:2});assert.equal(challengeOutcome(s).independent,false)
  s.mode='free';assert.equal(challengeOutcome(s).completed,false)
})
test('private answer keys are removed, old sessions survive, different task facts have distinct contexts',()=>{
  const s=fixture();s._consolidation={run:1,answers:[],questions:[{id:'q',answer:'reservation',correctIndex:0}]}
  const result=presentJourney(s)
  assert.equal(result.journey.preparationQuestions,undefined)
  assert.ok(result.journey.preparation.questions.every(q=>q.correctIndex===undefined&&q.answer===undefined))
  assert.equal(result._consolidation,undefined);assert.equal(result.consolidation.questions[0].answer,undefined)
  assert.equal(s._consolidation.questions[0].answer,'reservation')
  assert.deepEqual(presentJourney({id:1,messages:[]}),{id:1,messages:[]})
  const changed=structuredClone(s);changed.scene=journeyScene(hotelChangeScene(s.scene))
  assert.equal(challengeIdentity(s).family,challengeIdentity(changed).family)
  assert.notEqual(challengeIdentity(s).context,challengeIdentity(changed).context)
  const prompt=buildTurnMessages(changed,'Can you change the date?')[0].content
  assert.match(prompt,/前台不能直接批准/);assert.match(prompt,/用户确认后才切换/);assert.match(prompt,/不强制凑轮数/)
})
test('scene hint plans require exact senses and keep only learner-facing descriptions',()=>{
  const scene={targets:[{word:'reservation',sense:'预订'}]}
  const raw={scene:'One guest shows a blank booking card to a hotel receptionist.',cues:[{word:'reservation',sense:'预订',kind:'context',visual:'A guest presents a blank booking card.'}],description:'你把预订卡递给酒店前台。卡片对应 reservation，也就是你提前订下的房间。',limitations:'旧版局限说明'}
  const plan=validateSceneHint(raw,scene)
  assert.equal(plan.description,raw.description)
  assert.equal(plan.limitations,undefined)
  assert.throws(()=>validateSceneHint({...raw,cues:[{...raw.cues[0],sense:'保留地'}]},scene))
  assert.equal(validateSceneHint({...raw,description:undefined},scene).description,'')
  assert.equal(validateSceneHint({...raw,description:'英文'.repeat(100)},scene).description,'')
  assert.throws(()=>validateSceneHint({...raw,cues:[...raw.cues,...raw.cues]},scene))
  assert.match(SCENE_HINT_RULES,/最多2个人、5件/);assert.match(SCENE_HINT_RULES,/最终费用/);assert.match(SCENE_HINT_RULES,/禁止绘制可读文字/)
  assert.match(SCENE_HINT_RULES,/当前交谈对象是画面重点/)
})


test('ordinary scenes do not invent additional people; explicit participants stay separate', () => {
  for (const id of ['hotel', 'restaurant', 'directions', 'shopping', 'interview', 'campus', 'bank']) {
    assert.equal(journeyScene(sceneFor(id, 'beginner')).actors.length, 1, id)
  }
  const single = journeyScene({id:'custom-1',role:'同学Alex'})
  assert.equal(single.actors.length,1)
  assert.equal(single.actors[0].name,'同学Alex')
  const legacy = journeyScene({...single,actors:[...single.actors,{id:'companion',name:'讨论伙伴'}]})
  assert.equal(legacy.actors.length,1)
  const actors=[{id:'alex',name:'Alex',role:'同学'},{id:'sam',name:'Sam',role:'同学'}]
  assert.deepEqual(journeyScene({...single,actors}).actors.map(a=>a.id),['alex','sam'])
  assert.deepEqual(journeyScene(hotelChangeScene(single)).actors.map(a=>a.id),['frontdesk','manager'])
})
