<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { http } from '../api/client.js'
import WordLearningCard from '../components/WordLearningCard.vue'
import CollocationPractice from '../components/CollocationPractice.vue'
const route = useRoute(), word = ref(null), error = ref(''), loading = ref(false)
let request = new AbortController()
watch(() => route.query.wordId, async value => {
  request.abort(); request = new AbortController()
  const current = request, wordId = Number(value)
  word.value = null; error.value = ''; loading.value = false
  if (!Number.isSafeInteger(wordId) || wordId <= 0) return
  loading.value = true
  try { const data = await http.get('/words/' + wordId, { signal: current.signal }); if (!current.signal.aborted) word.value = data.word }
  catch (cause) { if (!current.signal.aborted) error.value = cause.message }
  finally { if (!current.signal.aborted) loading.value = false }
}, { immediate: true })
onBeforeUnmount(() => request.abort())
</script>
<template>
  <main class="collocations-page">
    <router-link to="/notebooks?source=mistakes" class="text-button">返回错题本</router-link>
    <h1 class="section-title">搭配学习与复习</h1>
    <p class="section-sub">单词和短语一起记。答题结果按账号保存，答出后按间隔复习，没答出的可再次练习。</p>
    <p v-if="loading" role="status">正在读取单词…</p><p v-if="error" role="alert">{{ error }}</p>
    <WordLearningCard v-if="word" :key="word.id" :word="word" />
    <section v-else-if="!loading && !error" class="card"><h2>我的搭配复习</h2><CollocationPractice review /></section>
    <p class="section-sub"><router-link to="/lookup">查找其他单词练搭配</router-link> · 在背词用法卡或单词本中也能进入。</p>
  </main>
</template>
<style scoped>.collocations-page { max-width: 760px; margin: 0 auto; padding-bottom: 24px; } .card { margin-top: 20px; }</style>
