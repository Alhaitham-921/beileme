import { workflowFor } from '../../../shared/scenarioWorkflows.js'
export { workflowActorIds } from '../../../shared/scenarioWorkflows.js'

export function withWorkflow(scene, options={}) {
  if (scene.memoryImage || scene.challenge==='change_dates') return scene
  const source={...scene,task:scene.baseTask||scene.task,goals:scene.baseGoals||scene.goals,
    opening:scene.baseOpening||scene.opening,actors:scene.baseActors||scene.actors,sharedFacts:scene.baseSharedFacts||scene.sharedFacts}
  if (!options.fullJourney) {
    const plan=scene.workflowPlan||scene.workflow
    delete source.workflow
    return {...source,...(plan?{workflowPlan:plan}:{})}
  }
  const workflow=workflowFor(source,{route:options.learningRoute,transfer:options.transfer})
  if (!workflow) return scene
  const actors=workflow.actors?.length?workflow.actors:scene.actors
  return {...source,baseTask:source.task,baseGoals:source.goals,baseOpening:source.opening,baseActors:source.actors,baseSharedFacts:source.sharedFacts||[],
    workflowPlan:workflow,workflow,actors,sharedFacts:workflow.sharedFacts||source.sharedFacts||[],
    opening:workflow.stages[0].opening,
    goals:workflow.stages.flatMap(s=>s.goals),
    task:`${source.task} 按完整流程逐步处理；当前阶段以外的目标不提前完成。仅为模拟交流，不执行真实交易。`}
}


export function workflowState(scene) {
  if (!scene.workflow) return null
  return {index:0,skipped:[],references:[],listening:{},events:[],stageStartedTurn:0}
}
export function workflowGoals(scene) {
  return scene.workflow.stages.flatMap(stage=>stage.goals.map((description,index)=>({
    id:`${stage.id}-goal-${index+1}`,stageId:stage.id,description,completed:false,
  })))
}
export function activeWorkflowStage(session) {
  return session.scene.workflow?.stages[session.journey?.flow?.index] || null
}
export function stageGoals(session) {
  const stage=activeWorkflowStage(session)
  return (session.journey?.goals||[]).filter(g=>!stage||g.stageId===stage.id)
}
export function sharedTaskEvidence(session) {
  if(!session.journey?.flow)return []
  return session.journey.goals.filter(g=>g.completed&&g.quote).slice(-16)
    .map(g=>({stageId:g.stageId,actorId:g.actorId,goal:g.description,quote:g.quote.slice(0,500)}))
}
export function applyWorkflowAction(session,{action,stageId,selectedIndex}) {
  const stage=activeWorkflowStage(session),flow=session.journey?.flow
  if(!stage||stage.id!==stageId)throw new Error('阶段已更新，请读取当前进度')
  if(action==='reference') {
    if(!flow.references.includes(stage.id)) {
      flow.references.push(stage.id)
      session.helpEvents ||= []
      session.helpEvents.push({level:2,source:'workflow_reference',stageId:stage.id,turn:session.turnCount})
    }
    return
  }
  if(action==='transcript') {
    const saved=flow.listening[stage.id]||{attempts:0}
    saved.revealed=true;flow.listening[stage.id]=saved;return
  }
  if(action==='listen') {
    if(!Number.isInteger(selectedIndex)||!stage.listening.choices[selectedIndex])throw new Error('请选择有效的听力选项')
    const saved=flow.listening[stage.id]||{attempts:0}
    const correct=selectedIndex===stage.listening.correctIndex
    flow.listening[stage.id]={...saved,attempts:saved.attempts+1,correct,
      firstIndependent:saved.attempts===0?correct&&!saved.revealed:saved.firstIndependent,
      feedback:correct?'本次理解正确':'再听一次，核对关键信息后重试'}
    return
  }
  if(!['advance','skip','previous'].includes(action))throw new Error('不支持的阶段操作')
  if(action==='previous'&&flow.index===0)throw new Error('当前已经是第一阶段')
  if(action==='advance'&&!stageGoals(session).every(g=>g.completed))throw new Error('请先完成本阶段交流目标，也可跳过并保留待练记录')
  if(action!=='previous'&&flow.index>=session.scene.workflow.stages.length-1)throw new Error('已到最后阶段，请结束并查看完整小结')
  if(action==='skip'&&!flow.skipped.includes(stage.id))flow.skipped.push(stage.id)
  flow.events=[...(flow.events||[]),{stageId:stage.id,action,turn:session.turnCount}].slice(-100)
  flow.index+=action==='previous'?-1:1;flow.stageStartedTurn=session.turnCount
  const next=activeWorkflowStage(session)
  session.journey.activeActorId=next.actorId
  session.help=null;session.journey.handoff=null
  const actor=session.scene.actors.find(a=>a.id===next.actorId)
  session.messages.push({role:'assistant',actorId:next.actorId,actorName:actor?.name,
    text:next.opening,flowStageId:next.id,event:'stage_opening'})
}

export function workflowOutcome(session) {
  if(!session.journey?.flow)return null
  const flow=session.journey.flow
  const stages=session.scene.workflow.stages.map(stage=>{
    const goals=session.journey.goals.filter(g=>g.stageId===stage.id)
    return {id:stage.id,title:stage.title,completed:goals.every(g=>g.completed),
      independent:goals.every(g=>g.completed&&g.independent),skipped:flow.skipped.includes(stage.id),
      listening:flow.listening[stage.id]?.firstIndependent===true}
  })
  return {stages,completed:stages.filter(s=>s.completed).length,total:stages.length,
    listeningComplete:stages.every(s=>s.listening),
    note:'分别观察听懂、独立表达与完整流程覆盖；本次完成不等于长期掌握，仍需隔天换条件复练。'}
}

export function sanitizeWorkflow(result) {
  if(result.scene?.workflowPlan)delete result.scene.workflowPlan
  if(result.scene)for(const key of ['baseTask','baseGoals','baseOpening','baseActors','baseSharedFacts'])delete result.scene[key]
  if(!result.scene?.workflow)return result
  const flow=result.journey?.flow
  result.scene.workflow.stages=result.scene.workflow.stages.map(stage=>{
    const {correctIndex,...listening}=stage.listening
    return {...stage,listening,expressions:flow?.references.includes(stage.id)?stage.expressions:[]}
  })
  result.journey.workflowOutcome=workflowOutcome({...result,scene:{...result.scene}})
  return result
}
