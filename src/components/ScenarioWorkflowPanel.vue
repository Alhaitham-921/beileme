<script setup>
import { computed } from 'vue'
const props=defineProps({session:Object,busy:Boolean})
const emit=defineEmits(['action','speak','finish'])
const flow=computed(()=>props.session.journey.flow)
const stages=computed(()=>props.session.scene.workflow.stages)
const stage=computed(()=>stages.value[flow.value.index])
const goals=computed(()=>props.session.journey.goals.filter(g=>g.stageId===stage.value.id))
const hearing=computed(()=>flow.value.listening[stage.value.id])
function act(action,extra={}) {emit('action',{action,stageId:stage.value.id,...extra})}
</script>
<template>
  <section class="workflow-panel" aria-label="完整场景流程">
    <div class="flow-header"><div><small>完整流程 · 第 {{ flow.index+1 }} / {{ stages.length }} 步</small><h3>{{ stage.title }}</h3></div><span>{{ session.journey.workflowOutcome.completed }}/{{ stages.length }} 阶段完成</span></div>
    <ol class="flow-map"><li v-for="(item,i) in stages" :key="item.id" :class="{current:i===flow.index,done:session.journey.workflowOutcome.stages[i].completed}">{{ i+1 }} {{ item.title }}<small v-if="flow.skipped.includes(item.id)"> · 留待重练</small></li></ol>
    <ul><li v-for="goal in goals" :key="goal.id">{{ goal.completed ? goal.independent ? '已独立表达' : '已在帮助下完成' : '待表达' }} · {{ goal.description }}</li></ul>
    <div class="stage-listening"><strong>先听懂对方</strong><button class="btn btn-ghost" :disabled="busy" @click="emit('speak',stage.opening)">播放本阶段开场</button><p>{{ stage.listening.question }}</p><div class="listen-choices"><button v-for="(choice,i) in stage.listening.choices" :key="choice" class="btn btn-secondary" :disabled="busy" @click="act('listen',{selectedIndex:i})">{{ choice }}</button></div><p v-if="hearing" role="status">{{ hearing.feedback }} <small v-if="hearing.revealed">已查看文字，理解表现单独记录。</small></p><button v-if="!hearing?.revealed" class="text-button" :disabled="busy" @click="act('transcript')">需要时查看开场文字</button><p v-else lang="en">{{ stage.opening }}</p></div>
    <div class="expression-paths"><button v-if="!stage.expressions.length" class="text-button" :disabled="busy" @click="act('reference')">看看不同的表达方法</button><template v-else><strong>可选说法 · 无需照抄，使用后按提示完成记录</strong><ul><li v-for="example in stage.expressions" :key="example" lang="en">{{ example }}</li></ul></template></div>
    <div class="stage-actions" v-if="session.status==='active' && session.journey.phase==='conversation'">
      <button v-if="flow.index>0" class="btn btn-ghost" :disabled="busy" @click="act('previous')">回看上一步</button>
      <button v-if="flow.index<stages.length-1" class="btn btn-primary" :disabled="busy || !goals.every(g=>g.completed)" @click="act('advance')">进入下一阶段</button>
      <button v-else class="btn btn-primary" :disabled="busy" @click="emit('finish')">结束并查看完整小结</button>
      <button v-if="flow.index<stages.length-1" class="text-button" :disabled="busy" @click="act('skip')">本步留待重练，先继续</button>
    </div>
    <p class="flow-note">一次任务先观察听懂、表达和流程覆盖；隔天更换日期、价格或需求再练，查看是否仍能独立处理。</p>
  </section>
</template>
<style scoped>
.workflow-panel{border:1px solid var(--line);border-radius:14px;padding:20px;margin:18px 0;background:var(--bg-card)}.flow-header{display:flex;align-items:center;justify-content:space-between;gap:16px}.flow-header h3{margin:6px 0;font-size:21px}.flow-header small,.flow-header>span,.flow-note{color:var(--ink-soft);font-size:12px}.flow-map{display:flex;gap:8px;overflow-x:auto;list-style:none;padding:12px 0;margin:8px 0}.flow-map li{flex:0 0 155px;padding:10px;border-bottom:2px solid var(--line);font-size:12px}.flow-map .current{border-color:var(--accent);color:var(--accent)}.flow-map .done{color:var(--ok)}.workflow-panel>ul,.expression-paths ul{padding-left:20px;line-height:1.9;font-size:14px}.stage-listening{border-block:1px solid var(--line);padding:15px 0}.stage-listening>strong{margin-right:15px}.stage-listening p{line-height:1.8}.listen-choices,.stage-actions{display:flex;gap:10px;flex-wrap:wrap}.expression-paths{padding:14px 0}.expression-paths strong{font-size:12px;color:var(--ink-soft)}.flow-note{line-height:1.8;margin-bottom:0}@media(max-width:600px){.workflow-panel{padding:14px}.flow-header{align-items:start}.flow-map li{flex-basis:125px}.listen-choices .btn{width:100%}}
</style>
