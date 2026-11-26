import test from 'node:test'
import assert from 'node:assert/strict'
import { DIALOGUE_SCENES,sceneFor } from '../src/services/dialogueEngine.js'
import { journeyScene,initJourney,applyGoalEvidence,presentJourney } from '../src/services/dialogueJourney.js'
import { withWorkflow,applyWorkflowAction,activeWorkflowStage,workflowOutcome } from '../src/services/scenarioWorkflow.js'
import { WORKFLOW_ROUTES,workflowActorIds } from '../../shared/scenarioWorkflows.js'
import { validateScenario } from '../src/services/scenarioEngine.js'

function session(id='hotel',options={}) {
  const scene=withWorkflow(journeyScene(sceneFor(id,'beginner',options.variant),options.variant),{fullJourney:true,...options})
  return {scene,journey:initJourney(scene),messages:[],turnCount:0,helpEvents:[],targetUsage:[]}
}
test('every built-in scene and every offered route has a complete, authored, bounded flow',()=>{
  let combinations=0
  for(const scene of DIALOGUE_SCENES)for(const variant of scene.variants?.map(v=>v.id)||[undefined]) {
    for(const route of WORKFLOW_ROUTES[scene.id]||[{id:'standard'}])for(const transfer of [false,true]) {
      const s=session(scene.id,{variant,learningRoute:route.id,transfer}),flow=s.scene.workflow
      assert.ok(flow,scene.id);assert.ok(flow.stages.length>=6,scene.id)
      assert.equal(new Set(flow.stages.map(s=>s.id)).size,flow.stages.length)
      for(const stage of flow.stages) {
        assert.ok(stage.goals.length>=2);assert.ok(stage.expressions.length>=2)
        assert.ok(s.scene.actors.some(a=>a.id===stage.actorId))
        assert.doesNotMatch(stage.opening,/next part of this task/)
        assert.ok(stage.listening.choices[stage.listening.correctIndex])
        assert.equal(new Set(stage.listening.choices).size,stage.listening.choices.length)
      }
      combinations++
    }
  }
  assert.ok(combinations>=30)
})
test('hotel covers booking to receipt, supports breakfast decisions, and cafe routes change the service encounter',()=>{
  const hotel=session().scene.workflow
  assert.deepEqual(hotel.stages.map(s=>s.id),['booking','confirmation','arrival','breakfast-info','key','room-check','room-request','breakfast','checkout','receipt'])
  assert.match(session('hotel',{learningRoute:'online-room-only'}).scene.workflow.stages[7].opening,/ten pounds/)
  assert.match(session('cafe',{learningRoute:'takeaway'}).scene.workflow.sharedFacts.join(' '),/外带/)
  assert.equal(session('cafe',{learningRoute:'table'}).scene.actors[0].id,'waiter')
  assert.notDeepEqual(session('hotel',{transfer:true}).scene.sharedFacts,session().scene.sharedFacts)
})
test('ordinary practice and full-flow repetition remain explicit choices without losing the source plan',()=>{
  const full=session().scene
  const ordinary=withWorkflow(full,{fullJourney:false})
  assert.equal(ordinary.workflow,undefined);assert.ok(ordinary.workflowPlan)
  assert.ok(ordinary.goals.length<full.goals.length)
  const again=withWorkflow(ordinary,{fullJourney:true,transfer:true})
  assert.equal(again.workflow.stages.length,10)
  assert.equal(again.task.split('按完整流程').length,2)
  assert.equal(presentJourney({scene:ordinary,messages:[]}).scene.workflowPlan,undefined)
})
test('future-stage claims cannot complete goals; navigation preserves partial coverage without awarding progress',()=>{
  const s=session(),stage=activeWorkflowStage(s)
  assert.throws(()=>applyWorkflowAction(s,{action:'advance',stageId:stage.id}),/先完成/)
  const text='I would like a standard room for two nights and a booking confirmation.'
  applyGoalEvidence(s,{goalEvidence:[{goalId:s.journey.goals[2].id,completed:true,quote:text}]},text,0)
  assert.equal(s.journey.goals[2].completed,false)
  applyGoalEvidence(s,{goalEvidence:s.journey.goals.slice(0,2).map(g=>({goalId:g.id,completed:true,quote:text}))},text,0)
  applyWorkflowAction(s,{action:'advance',stageId:stage.id})
  assert.equal(s.journey.flow.index,1);assert.equal(s.turnCount,0)
  applyWorkflowAction(s,{action:'skip',stageId:activeWorkflowStage(s).id})
  assert.ok(s.journey.flow.skipped.includes('confirmation'))
  assert.equal(workflowOutcome(s).completed,1)
  applyWorkflowAction(s,{action:'previous',stageId:activeWorkflowStage(s).id})
  assert.equal(s.journey.flow.index,1)
  assert.throws(()=>applyWorkflowAction(s,{action:'listen',stageId:'booking',selectedIndex:0}),/阶段已更新/)
})
test('reference use and transcript exposure are saved separately from first independent listening and expression',()=>{
  const s=session(),stage=activeWorkflowStage(s)
  const clean=presentJourney(s)
  assert.equal(clean.scene.workflow.stages[0].listening.correctIndex,undefined)
  assert.equal(clean.scene.workflow.stages[0].expressions.length,0)
  assert.ok(Number.isInteger(s.scene.workflow.stages[0].listening.correctIndex))
  applyWorkflowAction(s,{action:'transcript',stageId:stage.id})
  applyWorkflowAction(s,{action:'listen',stageId:stage.id,selectedIndex:stage.listening.correctIndex})
  assert.equal(s.journey.flow.listening[stage.id].firstIndependent,false)
  applyWorkflowAction(s,{action:'reference',stageId:stage.id})
  assert.equal(s.helpEvents.length,1)
  const text='Could I have a room for two nights, please?'
  applyGoalEvidence(s,{goalEvidence:[{goalId:s.journey.goals[0].id,completed:true,quote:text}]},text,0)
  assert.equal(s.journey.goals[0].independent,false)
  assert.equal(presentJourney(s).scene.workflow.stages[0].expressions.length,3)
  assert.deepEqual(workflowActorIds(s),['reservations'])
})
test('generated complete scenarios must include valid stages and use defined actors',()=>{
  const base=journeyScene(sceneFor('hotel','beginner'))
  const completed=session().scene
  const raw={...base,actors:completed.actors,workflow:completed.workflow}
  const req={description:'我想练完整的酒店住宿流程，包括网上预订和退房。',difficulty:'beginner',requireWorkflow:true}
  assert.equal(validateScenario(raw,req).workflow.stages.length,10)
  assert.throws(()=>validateScenario(base,req),/完整阶段/)
  const invalid=structuredClone(raw);invalid.workflow.stages[0].actorId='missing'
  assert.throws(()=>validateScenario(invalid,req),/交谈对象/)
})
