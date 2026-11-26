import test from 'node:test'
import assert from 'node:assert/strict'
import {DIALOGUE_SCENES,sceneFor} from '../src/services/dialogueEngine.js'
import {withClassicVocabulary,CLASSIC_VOCABULARY} from '../../shared/classicLearning.js'
import {workflowFor,WORKFLOW_ROUTES} from '../../shared/scenarioWorkflows.js'
import {journeyScene,initJourney,applyGoalEvidence} from '../src/services/dialogueJourney.js'
import {withWorkflow,autoAdvanceWorkflow} from '../src/services/scenarioWorkflow.js'
import {recordingKey,saveDialogueRecording,readDialogueRecording,deleteDialogueRecording,releaseRecordingMemory} from '../../src/utils/dialogueRecordings.js'

test('all new classics have adjustable real task vocabulary, same-word sense alternatives and translated stages',()=>{
 assert.ok(!DIALOGUE_SCENES.some(s=>s.id==='bank'));assert.ok(DIALOGUE_SCENES.some(s=>s.id==='airport'))
 assert.equal(sceneFor('bank','beginner','finance').targets[0].sense,'银行','retained history must still resolve')
 for(const base of DIALOGUE_SCENES){
  for(const count of [4,8,12]){
   const scene=withClassicVocabulary(base,count)
   assert.equal(scene.targets.length,count,base.id);assert.equal(new Set(scene.targets.map(t=>t.word)).size,count)
   for(const t of scene.targets){assert.ok(t.example.toLowerCase().includes(t.word),t.word);assert.ok(t.otherSenses.length);assert.ok(!t.otherSenses.includes(t.sense))}
   const prepared=initJourney(journeyScene(scene),true)
   for(const [i,q] of prepared.preparationQuestions.entries()){
    assert.equal(q.context,scene.targets[i].example)
    assert.ok(q.options.every(option=>[scene.targets[i].sense,...scene.targets[i].otherSenses].includes(option)))
   }
  }
  for(const route of WORKFLOW_ROUTES[base.id]){
   const plan=workflowFor(journeyScene(sceneFor(base.id,'beginner')),{route:route.id})
   for(const stage of plan.stages){assert.ok(stage.openingTranslation,base.id+':'+stage.id);assert.ok(plan.actors.some(a=>a.id===stage.actorId))}
  }
 }
 assert.equal(CLASSIC_VOCABULARY.hotel.length,12)
})

test('roles match service responsibilities; natural single-person routes remain single-person',()=>{
 for(const id of ['hotel','shopping','restaurant','interview','campus','airport'])assert.ok(workflowFor(journeyScene(sceneFor(id))).actors.length>=2,id)
 assert.equal(workflowFor(journeyScene(sceneFor('library'))).actors.length,1)
 assert.equal(workflowFor(journeyScene(sceneFor('cafe')),{route:'table'}).actors.length,1)
 const shopping=workflowFor(journeyScene(sceneFor('shopping')))
 assert.deepEqual(shopping.stages.map(s=>s.actorId),['assistant','assistant','fitting','service','cashier','service'])
 assert.notEqual(shopping.stages[0].goals[0],shopping.stages[0].goals[1])
})

test('separate grounded utterances can complete a stage, minor grammar does not trap it, and transitions never award future goals',()=>{
 const scene=withWorkflow(journeyScene(sceneFor('shopping')),{fullJourney:true})
 const s={scene,journey:initJourney(scene),messages:[],turnCount:0,helpEvents:[]}
 const first='I wants a jacket for my trip.',second='My budget is forty pounds.'
 s.messages.push({role:'user',text:first,flowStageId:'need',helpLevel:0,corrections:[{type:'grammar',original:'I wants',replacement:'I want'}]})
 applyGoalEvidence(s,{goalEvidence:[{goalId:s.journey.goals[0].id,completed:true,quote:first}]},first,0)
 assert.equal(autoAdvanceWorkflow(s),false)
 s.messages.push({role:'user',text:second,flowStageId:'need',helpLevel:0})
 applyGoalEvidence(s,{goalEvidence:[{goalId:s.journey.goals[1].id,completed:true,quote:second,quotes:[first]}]},second,0)
 assert.equal(autoAdvanceWorkflow(s),true);assert.equal(s.journey.flow.index,1)
 assert.equal(s.messages.at(-1).event,'stage_opening');assert.ok(s.messages.at(-1).translation)
 assert.equal(s.journey.goals[2].completed,false)
 applyGoalEvidence(s,{goalEvidence:[{goalId:s.journey.goals[2].id,completed:true,quote:second}]},'Could you explain the difference?',0)
 assert.equal(s.journey.goals[2].completed,false,'a previous stage cannot be quoted as current performance')
})

test('recording replay is scoped by account/session/turn and survives changing the current recorder',async()=>{
 assert.notEqual(recordingKey(1,1,1),recordingKey(2,1,1));assert.notEqual(recordingKey(1,1,1),recordingKey(1,2,1));assert.throws(()=>recordingKey(0,1,1))
 const clips=[{blob:new Blob(['original audio'],{type:'audio/webm'}),durationMs:1200}]
 await saveDialogueRecording(1,8,1,clips)
 await saveDialogueRecording(1,8,2,[{blob:new Blob(['second recording'],{type:'audio/webm'}),durationMs:1500}])
 assert.equal(await (await readDialogueRecording(1,8,1)).clips[0].blob.text(),'original audio')
 assert.equal(await readDialogueRecording(2,8,1),null)
 await deleteDialogueRecording(1,8,1);assert.equal(await readDialogueRecording(1,8,1),null)
 releaseRecordingMemory(1,8)
})
