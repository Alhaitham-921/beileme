<script setup>
import IeltsNavigation from '../components/IeltsNavigation.vue'
import { ref,computed,onMounted,watch } from 'vue'
import { useRoute,useRouter } from 'vue-router'
import ielts,{requestKey} from '../api/ielts.js'
const route=useRoute(),router=useRouter(),papers=ref([]),loading=ref(false),error=ref(''),starting=ref(null),canManage=ref(false)
const names={listening:'听力',reading:'阅读',writing:'写作',speaking:'口语'}
const skill=computed(()=>Object.hasOwn(names,route.query.skill)?route.query.skill:'reading')
const mock=computed(()=>route.name==='ielts-mock')
const filtered=computed(()=>papers.value.filter(p=>p.skill===skill.value&&(!mock.value||p.code.startsWith('academic-'))))
async function load(){loading.value=true;error.value='';try{const data=await ielts.catalog();papers.value=data.papers;canManage.value=data.canManage}catch(e){error.value=e.message}finally{loading.value=false}}
async function start(paper){starting.value=paper.id;error.value='';try{const attempt=await ielts.start({paperId:paper.id,mode:mock.value?'mock':'practice',requestKey:requestKey()});router.push(`/ielts/attempt/${attempt.id}`)}catch(e){error.value=e.message}finally{starting.value=null}}
function choose(value){router.replace({query:{...route.query,skill:value}})}
onMounted(load)
</script>
<template><div class="ielts-page"><IeltsNavigation/>
  <header class="ielts-heading"><div><h1>{{mock?'Academic 模考':'找到今天要练的能力'}}</h1><p>{{mock?'按考试时限作答，中断后计时继续。':'按题型训练，完成后查看原文依据，再巩固薄弱项。'}}</p></div><router-link v-if="canManage" class="btn btn-ghost" to="/ielts/admin">内容审核</router-link></header>
  <div class="ielts-tabs" role="tablist" aria-label="选择科目"><button v-for="(name,key) in names" :key="key" class="btn btn-ghost" role="tab" :aria-selected="skill===key" @click="choose(key)">{{name}}</button></div>
  <p v-if="error" class="ielts-error" role="alert">{{error}} <button class="btn btn-ghost" @click="load">重试</button></p><p v-if="loading" role="status">正在加载练习…</p>
  <div v-if="!loading&&!error&&!filtered.length" class="ielts-empty"><h2>这科的审核题目正在准备</h2><p>公开目录只展示经过人工复核的原创或授权材料。你现在可以继续词汇训练和情境表达，已有记录都会保留。</p><router-link class="btn btn-primary" to="/ielts/vocabulary">练习雅思词汇</router-link><router-link class="btn btn-ghost" to="/practice">情境表达</router-link></div>
  <article v-for="paper in filtered" :key="paper.id" class="ielts-paper"><div><h2>{{paper.title}}</h2><p>{{paper.questionCount}} 题 · {{Math.ceil(paper.durationSeconds/60)}} 分钟 · 第 {{paper.version}} 版</p><p>{{paper.source?.author}}，{{paper.source?.license}}</p></div><button class="btn btn-primary" :disabled="starting!==null" @click="start(paper)">{{starting===paper.id?'正在准备…':mock?'开始计时模考':'开始专项训练'}}</button></article>
  <section v-if="!mock" class="ielts-section"><h2>继续词汇与表达练习</h2><div class="ielts-list-row"><router-link to="/ielts/vocabulary">识义、听辨、拼写、搭配与同义替换</router-link></div><div class="ielts-list-row"><router-link to="/study">单词学习与到期复习</router-link><router-link to="/notebooks">我的单词本</router-link></div><div class="ielts-list-row"><router-link to="/practice">情境练习</router-link><router-link to="/roots">词根词缀</router-link></div><div class="ielts-list-row"><router-link to="/assessment">词书掌握量测评</router-link><router-link to="/review">今日回顾</router-link></div></section>
</div></template>
