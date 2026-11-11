<script setup>
import IeltsNavigation from '../components/IeltsNavigation.vue'
import { ref,onMounted } from 'vue'
import ielts from '../api/ielts.js'
import { useAuthStore } from '../stores/auth.js'
const auth=useAuthStore(), data=ref(null), error=ref(''), loading=ref(false)
const names={listening:'听力',reading:'阅读',writing:'写作',speaking:'口语',vocabulary:'词汇'}
const abilityNames={recognition:'识义',listening:'听辨',spelling:'拼写',collocation:'搭配',paraphrase:'同义替换',single:'单选',multiple:'多选',completion:'填空',headings:'标题匹配',true_false:'事实判断',yes_no:'观点判断',matching:'匹配',map:'地图标注',diagram:'图示标注',short_answer:'简答',expression:'表达'}
async function load(){loading.value=true;error.value='';try{data.value=await ielts.overview()}catch(e){error.value=e.message}finally{loading.value=false}}
onMounted(load)
</script>
<template>
  <div class="ielts-page"><IeltsNavigation/>
    <header class="ielts-heading"><div><h1>{{auth.displayName}}，今天向目标再走一步</h1><p>从词汇积累，到听懂、读懂和独立表达。</p></div><router-link class="btn btn-ghost" to="/ielts/settings">调整目标</router-link></header>
    <p v-if="loading&&!data" role="status">正在准备你的学习计划…</p>
    <div v-if="error" class="card" role="alert"><p>{{error}}</p><button class="btn btn-ghost" @click="load">重新加载</button><router-link class="btn btn-ghost" to="/study">继续单词学习</router-link></div>
    <template v-if="data">
      <section class="ielts-focus">
        <div><h2>目标 {{data.profile.targetBand.toFixed(1)}} 分</h2><p>每天 {{data.profile.dailyMinutes}} 分钟<span v-if="data.profile.examDate">，考期 {{data.profile.examDate}}</span></p><p class="muted">先完成一组复习，再练习一个薄弱题型。四科表现来自实际作答。</p><router-link class="btn btn-primary" to="/ielts/specialties">开始今日训练</router-link><router-link class="btn btn-ghost" to="/study">复习单词</router-link></div>
        <dl class="ielts-targets"><div v-for="skill in ['listening','reading','writing','speaking']" :key="skill"><dt>{{names[skill]}}</dt><dd>{{Number(data.profile.skillTargets[skill]).toFixed(1)}}<small>目标</small></dd></div></dl>
      </section>
      <section v-if="data.attempts.some(a=>a.state!=='submitted')" class="ielts-section"><h2>接着上次的进度</h2><router-link v-for="a in data.attempts.filter(a=>a.state!=='submitted').slice(0,3)" :key="a.id" :to="`/ielts/attempt/${a.id}`" class="ielts-list-row"><span><strong>{{a.title}}</strong><small>{{a.mode==='mock'?'模考计时继续运行':'训练进度已保留'}}</small></span><span>继续练习</span></router-link></section>
      <section class="ielts-section"><div class="ielts-section-head"><h2>四科专项</h2><router-link to="/ielts/mock">进入模考</router-link></div><div class="ielts-skill-grid"><router-link v-for="(description,skill) in {listening:'精听、听写与信息定位',reading:'题型训练与原文证据',writing:'图表描述、论证与修改',speaking:'Part 1–3 与个人素材'}" :key="skill" :to="`/ielts/specialties?skill=${skill}`"><h3>{{names[skill]}}</h3><p>{{description}}</p><small>{{data.evidence.filter(e=>e.skill===skill).reduce((n,e)=>n+Number(e.total),0)}} 条学习记录</small></router-link></div></section>
      <section class="ielts-section"><h2>看见自己的积累</h2><div class="ielts-metrics"><div><strong>{{data.wordCounts.learned}}</strong><span>累计接触词汇</span></div><div><strong>{{data.wordCounts.stable}}</strong><span>达到当前复习稳定标准</span></div><div><strong>{{data.attempts.filter(a=>a.state==='submitted').length}}</strong><span>最近完成的训练</span></div></div><p class="muted">不同能力分别记录。一次识义答对，不代表已经能听出、拼写或用于表达。</p></section>
      <section class="ielts-section"><div class="ielts-section-head"><h2>建议下一步</h2><router-link to="/ielts/records">查看学习档案</router-link></div><p v-if="!data.weakest.length" class="muted">完成几次专项后，这里会根据实际错题推荐练习。</p><router-link v-for="e in data.weakest" :key="`${e.skill}-${e.ability}`" class="ielts-list-row" :to="e.skill==='vocabulary'?'/ielts/vocabulary':`/ielts/specialties?skill=${e.skill}`"><span>{{names[e.skill]}} · {{abilityNames[e.ability] || '专项练习'}}</span><span>{{e.correct}} / {{e.total}} 答对，继续巩固</span></router-link></section>
    </template>
  </div>
</template>
