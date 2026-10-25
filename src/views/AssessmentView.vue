<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { assessment } from '../api'
import { studyKey } from '../utils/studyKeyboard'
const session = ref(null), history = ref([]), busy = ref(false), error = ref('')
const selected = ref(null), pending = ref(null)
let continueRequested = false
let shownAt = 0
async function load() {
  busy.value = true
  error.value = ''
  try {
    history.value = (await assessment.history()).items
    session.value = history.value.find(s => !s.result) || history.value[0] || null
    selected.value = null; pending.value = null; continueRequested = false
    shownAt = performance.now()
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
function onKey(event) {
  const key = studyKey(event)
  if (key === null || !session.value?.question || error.value) return
  if (key === 'next') {
    if (selected.value === null) return
    event.preventDefault(); advance()
  } else if (!busy.value && selected.value === null) {
    event.preventDefault(); answer(key)
  }
}
onMounted(() => { load(); window.addEventListener('keydown', onKey) })
onUnmounted(() => window.removeEventListener('keydown', onKey))
async function start() {
  busy.value = true; error.value = ''
  try { session.value = await assessment.start(); selected.value = null; pending.value = null; continueRequested = false; shownAt = performance.now() }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function answer(selectedIndex) {
  if (busy.value || selected.value !== null) return
  selected.value = selectedIndex
  busy.value = true; error.value = ''
  try {
    pending.value = await assessment.answer(session.value.id, { wordId: session.value.question.wordId, selectedIndex, rtMs: Math.min(3600000, Math.round(performance.now() - shownAt)) })
  } catch (e) { error.value = e.message }
  finally {
    busy.value = false
    if (continueRequested && pending.value) advance()
  }
}
function advance() {
  if (busy.value) { continueRequested = true; return }
  if (!pending.value) return
  session.value = pending.value; pending.value = null; selected.value = null; continueRequested = false
  shownAt = performance.now()
  if (session.value.result) history.value = [session.value, ...history.value.filter(s => s.id !== session.value.id)]
}
</script>
<template>
  <main class="assessment">
    <p class="page-eyebrow">FIND YOUR STARTING POINT</p>
    <h1 class="section-title">了解你的词汇起点</h1>
    <p class="section-sub">约 3–5 分钟 · 30–35 题 · 不消耗 AI 额度</p>
    <p v-if="error" role="alert" class="error">{{ error }} <button class="btn" :disabled="busy" @click="load">恢复测评</button></p>
    <section v-if="session?.question" class="card">
      <p>已完成 {{ session.answered }} / {{ session.total }}</p>
      <progress :value="session.answered" :max="session.total" aria-label="测评进度"></progress>
      <p>请选择这个词的含义。不确定时选“不认识”，无需猜测或查词。</p>
      <h2 class="word">{{ session.question.spelling }}</h2>
      <div class="choices">
        <button v-for="(option, i) in session.question.options" :key="session.question.wordId + ':' + i" class="btn btn-secondary" :class="{ selected: selected === i }" :aria-pressed="selected === i" :disabled="busy || selected !== null" @click="answer(i)"><kbd>{{ i + 1 }}</kbd> {{ option }}</button>
        <button class="btn" :class="{ selected: selected === -1 }" :disabled="busy || selected !== null" @click="answer(-1)">不认识 / 不确定</button>
      </div>
      <p class="muted">数字键 1–4 选择 · 空格进入下一题</p>
      <button v-if="selected !== null && !error" class="btn btn-primary" @click="advance">{{ busy ? '保存中，可按空格等待继续' : session.answered + 1 === session.total ? '查看结果 · 空格' : '下一题 · 空格' }}</button>
      <p v-if="busy" role="status">正在保存选择…</p>
    </section>
    <section v-else-if="session?.result" class="card">
      <h2>{{ session.result.bookName }}：约掌握 {{ session.result.estimatedKnown }} 词</h2>
      <p>{{ session.result.scope }}</p>
      <p>共完成 {{ session.result.total }} 题，掌握率已做四选一机会水平校正。</p>
      <div v-for="band in session.result.bands" :key="band.band" class="band">
        <span>词书难度 {{ band.band }} · {{ band.tested }} 题</span>
        <progress :value="band.mastery || 0" max="1" :aria-label="'难度 ' + band.band + ' 掌握率'"></progress>
        <span>{{ band.mastery === null ? '未测' : Math.round(band.mastery * 100) + '%' }}</span>
      </div>
      <p>建议优先巩固掌握率较低的层级，2–4 周后再测。测评不会把抽测词直接标记为已学会。</p>
      <button class="btn btn-secondary" :disabled="busy" @click="start">重新测评</button>
      <router-link class="btn btn-primary" to="/">进入今日学习</router-link>
    </section>
    <section v-else class="card">
      <p>从当前词书抽题，覆盖五档难度，并根据作答调整后续题目。结果用于了解词书掌握情况。</p>
      <button class="btn btn-primary" :disabled="busy" @click="start">{{ busy ? '正在准备…' : '开始测评' }}</button>
    </section>
    <section v-if="!session?.question && history.some(s => s.result)" class="history">
      <h2>历史测评</h2>
      <button v-for="item in history.filter(s => s.result)" :key="item.id" class="btn" :disabled="busy" @click="session = item">{{ item.takenAt ? new Date(item.takenAt).toLocaleDateString() : '' }} · {{ item.result.bookName }} · 约 {{ item.result.estimatedKnown }} 词</button>
    </section>
  </main>
</template>
<style scoped>
.assessment { max-width: 800px; margin: auto; padding: 0 0 28px; }
.word { font-family: var(--serif); text-align: center; font-size: 38px; margin: 30px 0; }
.choices { display: grid; gap: 12px; }
.choices button { white-space: normal; text-align: left; min-height: 48px; }
.choices .selected { outline: 2px solid var(--accent); opacity: 1; background: var(--accent-soft); }
kbd { border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; font: inherit; }
progress { width: 100%; accent-color: var(--accent); }
.band { display: grid; grid-template-columns: 150px 1fr 50px; align-items: center; gap: 10px; margin: 18px 0; }
.error { color: var(--bad); }.history { margin-top: 30px; }.history button { display: block; margin-bottom: 10px; }
@media (max-width: 480px) { .band { grid-template-columns: 1fr 1fr 40px; font-size: 13px; } }
</style>
