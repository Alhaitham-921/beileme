<script setup>
import { computed, ref, watch } from 'vue'
const props = defineProps({ session: Object, preparation: Boolean, busy: Boolean })
const emit = defineEmits(['submit','hint','reset','begin'])
const progress = computed(() => props.preparation ? props.session.journey.preparation : props.session.consolidation)
const current = computed(() => progress.value?.questions?.[progress.value.answers.length])
const selectedIndex = ref(null), answer = ref('')
const labels = { correct:'独立答出', hinted:'看提示后答出', incorrect:'本次答错', skipped:'暂未答出' }
watch(() => `${props.session.id}:${progress.value?.run}:${current.value?.id}`, () => { selectedIndex.value=null;answer.value='' })
const last = computed(() => progress.value?.answers.at(-1))
function submit(skipped=false) { emit('submit',{questionId:current.value.id,selectedIndex:selectedIndex.value??undefined,answer:answer.value.trim()||undefined,skipped}) }
function choose(index){if(props.busy)return;selectedIndex.value=index;submit()}
</script>
<template>
  <section v-if="progress" class="dialogue-quiz card" :aria-label="preparation?'认识任务词汇':'情境小结巩固题'">
    <div class="quiz-heading"><h2>{{ preparation?'认识任务词汇':'小结巩固 · 把刚用过的表达留下来' }}</h2><span>{{ progress.answers.length }} / {{ progress.questions.length }}</span></div>
    <p class="muted">{{ preparation?'读例句，从同一个词的其他义项中辨认当前含义。点击选项即保存，也可跳过。':'根据本次情境练习词义和搭配。答案由服务器核对，结果自动保存。' }}</p>
    <p v-if="last" class="quiz-feedback" role="status">上一题：{{ labels[last.result] }} · {{ last.correctAnswer }}<span v-if="last.explanation"> · {{ last.explanation }}</span></p>
    <form v-if="current" @submit.prevent="submit()">
      <h3>{{ current.prompt }}</h3>
      <p v-if="current.context" class="quiz-context" lang="en">{{current.context}}</p>
      <div v-if="current.type==='meaning'" class="quiz-options"><button v-for="(option,index) in current.options" :key="index" type="button" :disabled="busy" :class="{selected:selectedIndex===index}" :aria-pressed="selectedIndex===index" @click="choose(index)">{{ option }}</button></div>
      <input v-else v-model="answer" class="input" maxlength="200" autocomplete="off" placeholder="填写目标词" :disabled="busy" aria-label="搭配填空答案" />
      <p v-if="progress.hint?.questionId===current.id" class="quiz-feedback">提示：{{ progress.hint.correctAnswer }}。本题会记录为看提示后作答。</p>
      <div class="quiz-actions"><button v-if="current.type!=='meaning'" class="btn btn-primary" :disabled="busy||(current.type==='meaning'?selectedIndex===null:!answer.trim())">{{ busy?'正在保存…':'提交并继续' }}</button><button class="text-button" type="button" :disabled="busy" @click="submit(true)">暂时想不起来</button><button v-if="!preparation" class="text-button" type="button" :disabled="busy" @click="emit('hint',{questionId:current.id})">看提示</button></div>
    </form>
    <template v-else><p>本组已完成 · {{ progress.answers.filter(a=>a.result==='correct').length }} 题独立答出</p><button v-if="!preparation" class="btn btn-secondary" :disabled="busy" @click="emit('reset')">再巩固一组</button></template>
    <div v-if="preparation" class="quiz-actions"><button class="btn btn-primary" :disabled="busy" @click="emit('begin',Boolean(current))">{{ current?'跳过剩余词汇，进入对话':'进入情境对话' }}</button></div>
  </section>
</template>
<style scoped>
.dialogue-quiz { padding:20px; margin:16px 0; }.quiz-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }.quiz-heading h2 { font-size:18px; margin:0; }.quiz-heading span { white-space:nowrap; color:var(--ink-soft); }.quiz-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }.quiz-options button { padding:12px; border:1px solid var(--line); border-radius:10px; background:var(--surface);color:var(--ink);font:inherit; }.quiz-options button.selected { border-color:var(--accent); background:var(--accent-soft); }.quiz-feedback { padding:10px; background:var(--bg); border-radius:8px; font-size:13px; line-height:1.7; }.quiz-actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:16px; align-items:center; }@media(max-width:480px){.quiz-options{grid-template-columns:1fr}}
</style>

<style scoped>.quiz-context{font-size:18px;line-height:1.8;padding:14px;background:var(--bg);border-radius:10px}.quiz-options button{text-align:left;line-height:1.7}.quiz-options button:hover{border-color:var(--accent)}.quiz-actions .text-button{font-size:12px}</style>
