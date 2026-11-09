<script setup>
import { reactive, ref, toRefs, onMounted, onUnmounted } from 'vue'
import { assessment } from '../api'
import { studyKey } from '../utils/studyKeyboard'
import { createAssessmentNavigation } from '../utils/assessmentNavigation'
const labels = { foundation: '高频基础', standard: '常规难度', challenge: '更有挑战' }
const samples = { foundation: 'arrive、borrow', standard: 'confirm、require', challenge: 'retain、interpret' }
const settings = ref(null), preferenceBusy = ref(false), preferenceMessage = ref('')
const state = reactive({ session: null, history: [], busy: false, error: '', selected: null, pending: null, continueRequested: false })
const { session, history, busy, error, selected, continueRequested } = toRefs(state)
const navigation = createAssessmentNavigation({
  state,
  submit: assessment.answer,
  onAdvance(next) {
    if (next.result) history.value = [next, ...history.value.filter(s => s.id !== next.id)]
  },
})
const { answer, advance, retry } = navigation
let operation = 0
async function load() {
  if (busy.value || selected.value !== null) return
  const currentOperation = ++operation
  busy.value = true
  error.value = ''
  try {
    const data = await assessment.history()
    const { items } = data
    if (currentOperation !== operation) return
    settings.value = data
    history.value = items
    navigation.reset(items.find(s => !s.result) || items[0] || null)
  } catch (e) { if (currentOperation === operation) error.value = e.message }
  finally { if (currentOperation === operation) busy.value = false }
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
onUnmounted(() => { operation++; navigation.dispose(); window.removeEventListener('keydown', onKey) })
async function start() {
  if (busy.value) return
  const currentOperation = ++operation
  busy.value = true; error.value = ''
  try {
    const next = await assessment.start()
    if (currentOperation === operation) navigation.reset(next)
  } catch (e) { if (currentOperation === operation) error.value = e.message }
  finally { if (currentOperation === operation) busy.value = false }
}
async function applyLevel(level) {
  if (preferenceBusy.value || !settings.value) return
  preferenceBusy.value = true
  preferenceMessage.value = ''
  try {
    const { preference } = await assessment.setPreference(level)
    settings.value = { ...settings.value, preference, suggestion: null }
    preferenceMessage.value = `已选择「${labels[preference]}」，从下一组新词开始生效。`
  } catch (cause) { preferenceMessage.value = cause.message }
  finally { preferenceBusy.value = false }
}
</script>
<template>
  <main class="assessment">
    <p class="page-eyebrow">FIND YOUR STARTING POINT</p>
    <h1 class="section-title">选择学习起点</h1>
    <p class="section-sub">{{ settings?.book.name }} · 自选起点，试学后随时调整</p>
    <section v-if="settings && !session?.question" class="card start-options">
      <h2>我想从这档开始</h2>
      <div class="choices">
        <button v-for="(label, level) in labels" :key="level" class="btn btn-secondary"
          :class="{ selected: settings.preference === level }" :aria-pressed="settings.preference === level"
          :disabled="preferenceBusy" @click="applyLevel(level)">
          {{ label }}<small v-if="settings.curated"> · {{ samples[level] }}</small>
        </button>
      </div>
      <p v-if="preferenceMessage" role="status">{{ preferenceMessage }}</p>
      <p v-if="settings.suggestion">{{ settings.suggestion.reason }}
        <button class="text-button" :disabled="preferenceBusy" @click="applyLevel(settings.suggestion.recommended)">采用试学建议</button>
      </p>
      <router-link class="btn btn-primary" to="/">直接开始学习</router-link>
    </section>
    <p v-if="error" role="alert" class="error">
      {{ error }}
      <template v-if="selected !== null">已保留本题选择，请重试保存。 <button class="btn" :disabled="busy" @click="retry">重试保存</button></template>
      <button v-else class="btn" :disabled="busy" @click="load">恢复测评</button>
    </p>
    <section v-if="session?.question" class="card">
      <p>起点短测 {{ session.form }} · 已完成 {{ session.answered }} / {{ session.total }}</p>
      <p v-if="session.total > 24" class="muted">正在补测相邻档位，帮你选择合适的起点。</p>
      <router-link to="/" class="text-button">先学习，稍后继续短测</router-link>
      <progress :value="session.answered" :max="session.total" aria-label="测评进度"></progress>
      <p>请选择这个词的含义。不确定时选“不认识”，无需猜测或查词。</p>
      <h2 class="word">{{ session.question.spelling }}</h2>
      <p v-if="session.question.context" lang="en" class="sense-context">{{ session.question.context }}</p>
      <div class="choices">
        <button v-for="(option, i) in session.question.options" :key="session.question.wordId + ':' + i" class="btn btn-secondary" :class="{ selected: selected === i }" :aria-pressed="selected === i" :disabled="busy || selected !== null" @click="answer(i)"><kbd class="desktop-shortcut">{{ i + 1 }}</kbd> {{ option }}</button>
        <button class="btn" :class="{ selected: selected === -1 }" :aria-pressed="selected === -1" :disabled="busy || selected !== null" @click="answer(-1)">不认识 / 不确定</button>
      </div>
      <p class="muted desktop-shortcut">数字键 1–4 选择 · 空格进入下一题</p>
      <button v-if="selected !== null && !error" class="btn btn-primary next-button" :disabled="continueRequested" @click="advance">
        {{ continueRequested ? '已请求，保存后继续' : session.answered + 1 === session.total ? '查看结果' : '下一题' }}<span v-if="!continueRequested" class="desktop-shortcut"> · 空格</span>
      </button>
      <p v-if="selected !== null && !error" role="status" aria-live="polite" class="muted">
        {{ busy ? continueRequested ? '正在保存选择，完成后将继续，请稍候…' : '正在保存选择，可点击按钮等待继续…' : '选择已保存，请继续。' }}
      </p>
    </section>
    <section v-else-if="session?.result" class="card">
      <h2>建议从「{{ labels[session.result.recommended] }}」试学</h2>
      <p>{{ session.result.bookName }} · {{ session.result.form }} 卷 · {{ session.result.total }} 题</p>
      <p>结果反映本次抽样的词义辨认表现，作为选起点的参考。</p>
      <p v-if="session.result.borderline">相邻档位的结果接近，先试学一组，再根据实际表现调整。</p>
      <ul class="placement-bands">
        <li v-for="band in session.result.bands" :key="band.level">
          {{ labels[band.level] }} · 答对 {{ band.correct }} / {{ band.tested }} · {{ band.unsure }} 题不确定
        </li>
      </ul>
      <button class="btn btn-primary" :disabled="preferenceBusy" @click="applyLevel(session.result.recommended)">采用测评建议</button>
      <button class="btn btn-secondary" :disabled="busy" @click="start">换卷复测</button>
    </section>
    <section v-else-if="settings" class="card">
      <h2>帮我选起点</h2>
      <template v-if="settings.eligible">
        <p>从当前词书出 24 道分层题。接近分档边界时追加 4 题。</p>
        <button class="btn btn-secondary" :disabled="busy" @click="start">{{ busy ? '正在准备…' : '开始可选短测' }}</button>
      </template>
      <p v-else>当前词书的可用题量暂时不足，可以直接选择学习起点。</p>
    </section>
    <section v-if="!session?.question && history.some(s => s.result)" class="history">
      <h2>历史起点建议</h2>
      <button v-for="item in history.filter(s => s.result)" :key="item.id" class="btn" :disabled="busy" @click="navigation.reset(item)">
        {{ item.takenAt ? new Date(item.takenAt).toLocaleDateString() : '' }} · {{ item.result.form }} 卷 · {{ labels[item.result.recommended] }}
      </button>
    </section>
  </main>
</template>
<style scoped>
.assessment { max-width: 800px; margin: auto; padding: 0 0 28px; }
.start-options { margin-bottom: 16px; }
.start-options .btn-primary { margin-top: 14px; }
.sense-context { text-align: center; font-size: 18px; }
.placement-bands { line-height: 1.9; }
.word { font-family: var(--serif); text-align: center; font-size: 38px; margin: 30px 0; }
.choices { display: grid; gap: 12px; }
.choices button { white-space: normal; text-align: left; min-height: 48px; }
.choices .selected { outline: 2px solid var(--accent); opacity: 1; background: var(--accent-soft); }
.assessment button { touch-action: manipulation; }
.next-button { display: flex; width: 100%; margin-top: 12px; }
kbd { border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; font: inherit; }
progress { width: 100%; accent-color: var(--accent); }
.band { display: grid; grid-template-columns: 150px 1fr 50px; align-items: center; gap: 10px; margin: 18px 0; }
.error { color: var(--bad); }.history { margin-top: 30px; }.history button { display: block; margin-bottom: 10px; }
@media (max-width: 820px), (hover: none) and (pointer: coarse) { .desktop-shortcut { display: none; } }
@media (max-width: 480px) { .band { grid-template-columns: 1fr 1fr 40px; font-size: 13px; } }
</style>
