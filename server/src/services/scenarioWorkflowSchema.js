import { z } from 'zod'
const text=max=>z.string().trim().min(1).max(max)
const english=max=>text(max).refine(value=>/[A-Za-z]/.test(value)&&!/\p{Script=Han}/u.test(value),'需要英文开场或表达')
const id=text(40).regex(/^[a-z][a-z0-9-]*$/)
export const ScenarioWorkflowSchema=z.object({
  id,title:text(100),route:text(32).default('custom'),
  sharedFacts:z.array(text(300)).max(8).optional(),
  stages:z.array(z.object({id,title:text(100),actorId:id,allowedActorIds:z.array(id).min(1).max(8).optional(),opening:english(500),
    goals:z.array(text(160)).min(2).max(3),expressions:z.array(english(220)).min(2).max(3),
    listening:z.object({question:text(180),choices:z.array(text(100)).min(3).max(4),correctIndex:z.number().int().min(0).max(3)})
      .superRefine((value,ctx)=>{if(value.correctIndex>=value.choices.length||new Set(value.choices).size!==value.choices.length)ctx.addIssue({code:'custom',message:'听力选项必须不同且答案下标有效'})}),
  })).min(4).max(12),
})
export function validateWorkflowActors(scene) {
  if(!scene.workflow)return
  const ids=new Set(scene.actors.map(a=>a.id)),stages=scene.workflow.stages
  if(new Set(stages.map(s=>s.id)).size!==stages.length)throw new Error('完整流程的阶段id不能重复')
  if(stages.some(stage=>!ids.has(stage.actorId)||(stage.allowedActorIds||[]).some(id=>!ids.has(id))))throw new Error('阶段必须使用本场景已定义的交谈对象')
}
export const WORKFLOW_PROMPT=`还必须返回workflow完整流程，不只给一个总任务：{id:英文短横线标识,title:中文流程名,route:"custom",stages:[{id:阶段id,title:阶段名,actorId:已有角色id,opening:该阶段对方自然说出的英文开场,goals:[两个可观察的交流目标],expressions:[两至三种可选的自然英文表达],listening:{question:关于opening中实际信息的中文理解题,choices:[三个不同的中文选项],correctIndex:正确选项下标}}]}。
根据用户需求组织4至12个有先后关系的具体阶段，从准备或发起需求，到确认、处理问题、完成与后续。每步都要贴合该场景，不用“下一部分”代替真实开场，不把所有场景套成相同四步。比如餐厅要考虑座位、菜单、饮食要求、订单核对、用餐问题和结账；其他场景也应同样完整。同一阶段提供不同表达或处理方法，合理同义表达均可。听力题答案必须在该开场中有明确依据。开放协商不预设用户已经同意。沿用已有actors中的真实参与者，不为凑步骤增加用户未要求的人。
长度：id及actorId最多40字符，阶段title最多100字，opening最多500字符，goals每项最多160字，expressions每项最多220字符，听力question最多180字，choices每项最多100字。所有交易只作语言模拟，证件或付款使用虚构占位。`
