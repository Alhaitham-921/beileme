<script setup>
import {ref,onMounted} from 'vue'
import {http} from '../api/client.js'
const emit=defineEmits(['start'])
const workload=ref(null),error=ref(''),budget=ref(null)
async function load(){try{workload.value=await http.get('/study/workload');error.value=''}catch(e){error.value=e.message}}
onMounted(load)
</script>
<template>
 <section aria-label="安排本次学习">
  <p v-if="workload">今日剩余新词 <strong>{{workload.newRemaining}}</strong> 个 · 当前到期复习 <strong>{{workload.dueCount}}</strong> 个</p>
  <p v-if="workload" role="status">{{workload.recommendation}}</p>
  <p v-if="error" class="error" role="alert">{{error}} <button class="text-button" @click="load">重新读取</button></p>
  <fieldset><legend>这次有多少时间？</legend>
   <label><input type="radio" :value="5" v-model="budget" />约5分钟（最多{{workload?.caps?.[5]||12}}词）</label>
   <label><input type="radio" :value="10" v-model="budget" />约10分钟（最多{{workload?.caps?.[10]||24}}词）</label>
   <label><input type="radio" :value="null" v-model="budget" />完整计划（每组最多60词）</label>
  </fieldset>
  <p class="muted">时长根据近期作答用时估算，不是倒计时考试。只调整本组题量，不修改每日目标，可随时暂停。</p>
  <div class="actions"><button class="btn btn-primary" @click="emit('start','review-first',budget)">先复习，再学新词</button><button class="btn btn-ghost" @click="emit('start','new-only',budget)">直接学新词</button></div>
 </section>
</template>
<style scoped>fieldset{border:0;padding:12px 0;text-align:left}label{display:block;margin:12px 0}.actions{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}.muted{font-size:13px;line-height:1.7}</style>
