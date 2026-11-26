<script setup>
import {computed} from 'vue'
const props=defineProps({session:Object,busy:Boolean,showTranslations:Boolean})
const emit=defineEmits(['action','speak','finish'])
const flow=computed(()=>props.session.journey.flow),stages=computed(()=>props.session.scene.workflow.stages)
const stage=computed(()=>stages.value[flow.value.index]),goals=computed(()=>props.session.journey.goals.filter(g=>g.stageId===stage.value.id))
const hearing=computed(()=>flow.value.listening[stage.value.id]),complete=computed(()=>goals.value.every(g=>g.completed))
function act(action,extra={}){emit('action',{action,stageId:stage.value.id,...extra})}
</script>
<template>
 <section class="workflow-panel" aria-label="当前交流阶段">
  <header><div><small>第 {{flow.index+1}} / {{stages.length}} 阶段</small><h3>{{stage.title}}</h3></div><span>{{session.journey.workflowOutcome.completed}} 阶段已覆盖</span></header>
  <ul class="current-goals"><li v-for="g in goals" :key="g.id" :class="{done:g.completed}"><span>{{g.completed?'✓':'○'}}</span>{{g.description}}</li></ul>
  <p class="flow-guidance">{{complete?'这一阶段已表达清楚，可以继续追问或进入下一步。':'围绕上面的目标回答对方，信息可以分几次说。需要时点下方“接话思路”。'}}</p>
  <div v-if="session.status==='active'" class="stage-actions">
   <label><input type="checkbox" :checked="flow.autoProgress!==false" :disabled="busy" @change="act('automatic',{selectedIndex:$event.target.checked?1:0})"> AI 判断完成后自动推进</label>
   <button v-if="flow.index<stages.length-1" class="btn btn-secondary" :disabled="busy" @click="act(complete?'advance':'skip')">{{complete?'进入下一阶段 →':'先进入下一阶段 →'}}</button>
   <button v-else class="text-button" :disabled="busy" @click="emit('finish')">生成本轮小结</button>
  </div>
  <small v-if="!complete" class="coverage-note">手动跳过会保留未核实的目标，不算完成。</small>
  <details class="workflow-details"><summary>查看完整路线和可选练习</summary>
   <ol class="flow-map"><li v-for="(s,i) in stages" :key="s.id" :class="{current:i===flow.index}">{{i+1}}. {{s.title}} <span v-if="session.journey.workflowOutcome.stages[i].completed">✓</span></li></ol>
   <button v-if="flow.index>0" class="text-button" :disabled="busy" @click="act('previous')">回到上一步</button>
   <details><summary>不同表达方法</summary><button v-if="!stage.expressions.length" class="text-button" :disabled="busy" @click="act('reference')">展开参考表达（会记录使用帮助）</button><ul v-else><li v-for="example in stage.expressions" :key="example" lang="en">{{example}}</li></ul></details>
   <details><summary>开场听力理解（可选）</summary><button class="text-button" :disabled="busy" @click="emit('speak',stage.opening)">播放开场</button><p>{{stage.listening.question}}</p><div class="listen-choices"><button v-for="(choice,i) in stage.listening.choices" :key="choice" class="btn btn-ghost" :disabled="busy" @click="act('listen',{selectedIndex:i})">{{choice}}</button></div><p v-if="hearing" role="status">{{hearing.feedback}} <small v-if="hearing.revealed">本阶段已显示文字，按辅助理解记录。</small></p></details>
  </details>
 </section>
</template>
<style scoped>
.workflow-panel{border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px;background:var(--bg-card)}header{display:flex;justify-content:space-between;gap:12px;align-items:center}h3{margin:5px 0;font-size:20px}header small,header>span,.coverage-note{font-size:12px;color:var(--ink-soft)}.current-goals{list-style:none;padding:0;display:grid;gap:8px;margin:14px 0;font-size:14px;line-height:1.7}.current-goals span{margin-right:8px;color:var(--accent)}.done{color:var(--ink-soft)}.flow-guidance{font-size:13px;line-height:1.7;color:var(--ink-soft);margin:10px 0}.stage-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.stage-actions label{font-size:12px;display:flex;gap:6px;align-items:center}.stage-actions .btn{padding:8px 12px;font-size:12px}.coverage-note{display:block;margin-top:7px}.workflow-details{margin-top:14px;border-top:1px solid var(--line);padding-top:10px;font-size:13px}.workflow-details details{margin-top:14px}.flow-map{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;list-style:none;padding:0}.flow-map li{padding:5px}.flow-map .current{color:var(--accent);font-weight:600}summary{cursor:pointer}.listen-choices{display:flex;flex-wrap:wrap;gap:6px}.workflow-details p,.workflow-details li{line-height:1.8}@media(max-width:600px){.workflow-panel{padding:14px}header>span{max-width:90px}.flow-map{grid-template-columns:1fr}.stage-actions{align-items:flex-start}.stage-actions .btn{width:100%}}
</style>
