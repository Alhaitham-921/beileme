<script setup>
import {ref,computed,onMounted,watch} from 'vue'
import {http} from '../api/client.js'
import {useRouter} from 'vue-router'
import {useAppStore} from '../stores/app.js'
const props=defineProps({sourceId:Number,compact:Boolean}),emit=defineEmits(['transfer'])
const router=useRouter(),app=useAppStore(),tasks=ref([]),error=ref(''),message=ref(''),answers=ref({}),shown=ref({}),busy=ref(false)
const visible=computed(()=>tasks.value.filter(t=>!props.sourceId||t.sourceSessionId===props.sourceId).slice(0,props.compact?3:5))
async function load(){try{tasks.value=(await http.get('/practice/followups',{query:{sourceId:props.sourceId}})).tasks;for(const task of tasks.value)answers.value[task.id]??=task.practiceAnswer||'';error.value=''}catch(e){error.value=e.message}}
onMounted(load);watch(()=>props.sourceId,load)
async function save(task){busy.value=true;try{message.value=(await http.post('/practice/followups/'+task.id+'/short',{body:{answer:answers.value[task.id]}})).message;shown.value[task.id]=true}catch(e){error.value=e.message}finally{busy.value=false}}
async function review(task){busy.value=true;try{await app.startReviewSession([task.wordId]);await router.push('/study')}catch(e){error.value=e.message}finally{busy.value=false}}
function transfer(task){if(props.compact)router.push({path:'/practice',query:{followup:String(task.id)}});else emit('transfer',task)}
function date(value){return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
</script>
<template><section v-if="visible.length||error" class="followups" aria-label="下一次练习">
 <h2>下一次练什么</h2><p>根据之前的对话安排巩固，不把一次练习等同于长期掌握。</p>
 <p v-if="error" role="alert">{{error}} <button class="text-button" @click="load">重试</button></p>
 <article v-for="task in visible" :key="task.id">
  <h3>{{task.word}} <small>{{task.sense}}</small></h3>
  <p>来自「{{task.sourceTitle}}」· {{task.reason}}</p>
  <p v-if="task.status==='independent'">已在另一场景独立使用，继续按词汇复习计划巩固。</p>
  <p v-else>{{task.due?'已到建议检查时间':'建议下次检查：'+date(task.nextCheckAt)}}（也可提前练习）</p>
  <blockquote v-if="task.quote">你的原句：{{task.quote}}</blockquote><p v-else class="muted">本轮没有可引用的该词原句，不推断你已经使用过。</p>
  <p v-if="task.explanation">{{task.explanation}}</p>
  <template v-if="!compact"><label :for="'followup-'+task.id">{{task.prompt}}</label><textarea :id="'followup-'+task.id" v-model="answers[task.id]" rows="2" maxlength="1000" placeholder="先独立写一句，再看参考"></textarea>
   <button class="text-button" :disabled="busy||!answers[task.id]?.trim()" @click="save(task)">保存短句并对照参考</button>
   <button class="text-button" @click="shown[task.id]=!shown[task.id]">{{shown[task.id]?'收起':'查看'}}参考</button><p v-if="shown[task.id]">{{task.reference||'尝试使用目标词表达，再在新情境中检验。'}}（表达可以有多种说法）</p>
  </template>
  <div class="actions"><button v-if="task.wordId" class="btn btn-secondary" :disabled="busy" @click="review(task)">复习这个词</button><button class="btn btn-primary" :disabled="busy" @click="transfer(task)">换个情境再用一次</button></div>
 </article><p role="status">{{message}}</p>
</section></template>
<style scoped>.followups{margin:24px 0;text-align:left}.followups article{padding:18px 0;border-bottom:1px solid var(--line)}small,.muted{opacity:.75}blockquote{margin:12px 0;padding-left:12px;border-left:2px solid var(--line)}textarea{display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:12px;background:var(--bg);color:inherit;border:1px solid var(--line);border-radius:8px;font:inherit}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}</style>
