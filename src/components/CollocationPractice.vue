<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { http } from '../api/client.js'
import { buildCollocationQuestions } from '../utils/collocationPractice.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({ phrases: { type: Array, default: () => [] }, spelling: { type: String, default: '' }, wordId: Number, review: Boolean, resumeId: Number })
const emit = defineEmits(['active', 'finished'])
const available = computed(() => buildCollocationQuestions(props.phrases, props.spelling).length)
const active = ref(false), session = ref(null), status = ref(null), input = ref(''), showFeedback = ref(false)
const busy = ref(true), error = ref(''), message = ref(''), pending = ref(null), panel = ref(null)
const summaryHeading = ref(null)
const nextButton = ref(null), answerField = ref(null)
let focusNextAnswer = false
const controller = new AbortController()
const current = computed(() => session.value?.question)
const feedback = computed(() => showFeedback.value ? session.value?.feedback : null)
const results = computed(() => session.value?.results || [])
const position = computed(() => feedback.value ? session.value.answered : session.value.answered + 1)
const promptParts = computed(() => {
  const prompt = current.value?.prompt || ''
  const blank = prompt.indexOf('____')
  return blank < 0 ? [prompt + ' ', ''] : [prompt.slice(0, blank), prompt.slice(blank + 4)]
})
const correctCount = computed(() => results.value.filter(item => item.result === 'correct').length)
const labels = { correct: '独立答出', incorrect: '本次答错', unknown: '未答出' }
const resultMarks = { correct: '✓', incorrect: '×', unknown: '–' }
const resultLabels = { correct: '答对', incorrect: '答错', unknown: '未答出' }
const date = value => new Date(value).toLocaleString('zh-CN')
const options = () => ({ signal: controller.signal, timeoutMs: 15000 })
watch(active, value => emit('active', value))
watch(nextButton, button => button?.focus(), { flush: 'post' })
watch([answerField, busy], ([field, saving]) => {
  if (!focusNextAnswer || !field || saving) return
  focusNextAnswer = false
  field.focus()
}, { flush: 'post' })

function advance() {
  focusNextAnswer = true
  showFeedback.value = false
}

function advanceOnEnter(event) {
  event.preventDefault()
  if (!event.isComposing && !event.repeat) advance()
}

async function refresh() {
  status.value = await http.get('/collocations', { ...options(), query: props.wordId ? { wordId: props.wordId } : undefined })
}
async function load() {
  busy.value = true; error.value = ''
  try {
    await refresh()
    session.value = status.value.active
    if (props.resumeId && session.value?.id === props.resumeId && session.value.question) openSession(session.value, false)
  }
  catch (cause) { if (!controller.signal.aborted) error.value = cause.message || '搭配记录读取失败，请重试。' }
  finally { busy.value = false }
}
function openSession(value, previousFeedback) {
  session.value = value
  showFeedback.value = previousFeedback && Boolean(value.feedback)
  input.value = ''
  active.value = true
  if (!showFeedback.value) nextTick(() => panel.value?.focus())
}
async function resume() {
  if (busy.value || pending.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    await refresh()
    session.value = status.value.active
    if (session.value?.question) openSession(session.value, false)
  } catch (cause) { if (!controller.signal.aborted) error.value = cause.message }
  finally { busy.value = false }
}
async function start(mode = props.review ? 'due' : 'practice') {
  if (busy.value || pending.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const data = await http.post('/collocations/sessions', { ...options(), body: { wordId: props.wordId, mode } })
    session.value = data.session
    if (!data.session) {
      message.value = data.message; active.value = false
      await refresh()
      return
    }
    openSession(data.session, true)
  } catch (cause) { if (!controller.signal.aborted) error.value = cause.message }
  finally { busy.value = false }
}
async function save() {
  if (busy.value || !pending.value) return
  busy.value = true; error.value = ''
  try {
    const data = await http.post(`/collocations/sessions/${session.value.id}/answers`, { ...options(), body: pending.value })
    session.value = data.session; pending.value = null; showFeedback.value = Boolean(data.session.question); input.value = ''
    if (data.session.results) {
      await nextTick()
      summaryHeading.value?.focus()
    }
    try { await refresh() } catch { message.value = '本题已保存，统计稍后刷新。' }
  } catch (cause) { if (!controller.signal.aborted) error.value = '本题还未确认保存。' + cause.message }
  finally { busy.value = false }
}
function submit(giveUp = false) {
  if (busy.value || pending.value || !current.value || (!giveUp && !input.value.trim())) return
  pending.value = { questionIndex: current.value.index, answer: giveUp ? '' : input.value.trim() }
  void save()
}
async function close() {
  if (busy.value || pending.value) return
  active.value = false
  await nextTick()
  panel.value?.focus()
}
function finish() {
  void close()
  emit('finished')
}
onMounted(load)
onBeforeUnmount(() => { controller.abort(); emit('active', false) })
</script>

<template>
  <div ref="panel" class="collocation-practice"
    :class="{ 'standalone-practice': $slots.overview }" :tabindex="$slots.overview ? -1 : undefined" :aria-busy="busy">
    <p v-if="busy && !status && !active" class="practice-note"><LoadingState>加载练习…</LoadingState></p>
    <p v-if="error" class="practice-error" role="alert">{{ error }}
      <button v-if="pending" type="button" class="text-button" :disabled="busy" @click="save">重试保存</button>
      <button v-else-if="!status" type="button" class="text-button" :disabled="busy" @click="load">重试</button>
    </p>
    <p v-if="message" class="practice-note" role="status">{{ message }}</p>
    <div v-if="active && current" class="round-toolbar">
      <div class="round-progress" role="progressbar" aria-label="搭配练习进度"
        :aria-valuenow="session.answered" :aria-valuemax="session.total"
        :aria-valuetext="`第 ${position} 题，共 ${session.total} 题`">
        <span class="round-count" aria-hidden="true">{{ position }} <small>/ {{ session.total }}</small></span>
        <span class="round-segments" aria-hidden="true">
          <i v-for="n in session.total" :key="n" :class="{ 'segment-done': n <= session.answered, 'segment-current': n === position }"></i>
        </span>
      </div>
      <button type="button" class="btn btn-quiet" aria-label="暂停并保留进度" :disabled="busy || !!pending" @click="close">暂停</button>
    </div>
    <template v-if="!active">
      <slot v-if="$slots.overview" name="overview" :status="status" :busy="busy" :error="error" :start="start" :resume="resume" />
      <template v-else>
        <p v-if="status?.total" class="practice-note">已练 {{ status.total }} 个搭配 · {{ status.weak }} 个待巩固 · {{ status.due }} 个到期</p>
        <div class="practice-actions">
          <button v-if="session?.question" type="button" class="btn btn-primary" :disabled="busy" @click="resume">继续练习 · {{ session.answered }}/{{ session.total }}</button>
          <button v-else-if="available || status?.total" type="button" class="btn btn-ghost" :disabled="busy" @click="start()">练搭配</button>
          <button v-if="status?.weak && !session?.question" type="button" class="text-button" :disabled="busy" @click="start('mistakes')">重练错题</button>
        </div>
        <p v-if="!available && !status?.total && !busy && !error" class="practice-note">暂无可练的双语搭配</p>
        <details v-if="status?.progress?.length" class="practice-history">
          <summary>搭配记录</summary>
          <p v-for="item in status.progress" :key="item.phrase + item.translation"><strong lang="en">{{ item.phrase }}</strong> · {{ item.translation }}<br />
            {{ labels[item.lastResult] }} · 累计答对 {{ item.timesCorrect }}/{{ item.timesSeen }} 次<br />下次复习：{{ date(item.nextReviewAt) }}</p>
        </details>
      </template>
    </template>
    <template v-else-if="feedback">
      <div class="prompt-panel">
        <p class="feedback-state" :class="`result-${feedback.result}`" role="status">
          <span class="result-mark" aria-hidden="true">{{ resultMarks[feedback.result] }}</span> {{ labels[feedback.result] }}
        </p>
        <p lang="en" class="phrase-line">{{ feedback.phrase }}</p>
        <p class="prompt-translation">{{ feedback.translation }}</p>
      </div>
      <div class="question-actions feedback-actions">
        <div class="feedback-details">
          <p v-if="feedback.previous" class="practice-note">上次 {{ labels[feedback.previous] }}</p>
          <p class="practice-note"><AppIcon name="repeat" />下次 {{ date(feedback.nextReviewAt) }}</p>
        </div>
        <button ref="nextButton" type="button" class="btn btn-primary" aria-keyshortcuts="Enter"
          @click="advance" @keydown.enter="advanceOnEnter">下一题 <kbd aria-hidden="true">Enter</kbd></button>
      </div>
    </template>
    <template v-else-if="current">
      <form @submit.prevent="submit()">
        <div class="prompt-panel">
          <p class="prompt-translation">{{ current.translation }}</p>
          <div lang="en" class="phrase-line"><span>{{ promptParts[0] }}</span><input ref="answerField"
            v-model="input" class="phrase-blank" aria-label="缺少的词" type="text" maxlength="320"
            autocomplete="off" autocapitalize="none" spellcheck="false" :disabled="busy || !!pending" /><span>{{ promptParts[1] }}</span></div>
        </div>
        <div class="question-actions">
          <button type="button" class="btn btn-quiet" :disabled="busy || !!pending" @click="submit(true)">想不起来</button>
          <button type="submit" class="btn btn-primary" :disabled="busy || !!pending || !input.trim()">
            {{ busy ? '保存中…' : '提交答案' }} <kbd aria-hidden="true">Enter</kbd>
          </button>
        </div>
      </form>
    </template>
    <template v-else-if="session?.results">
      <div class="summary-header">
        <h3 ref="summaryHeading" tabindex="-1">本组搭配回顾</h3>
        <p class="summary-score">答对 <strong>{{ correctCount }}/{{ session.total }}</strong></p>
      </div>
      <ol class="summary-list" role="list">
        <li v-for="item in results" :key="item.index" class="summary-item" :class="`result-${item.result}`">
          <span class="result-mark" aria-hidden="true">{{ resultMarks[item.result] }}</span>
          <div class="summary-phrase">
            <strong lang="en">{{ item.phrase }}</strong>
            <span>{{ item.translation }}</span>
            <small v-if="item.result === 'incorrect' && item.input">你的填写 <span lang="en">{{ item.input }}</span></small>
          </div>
          <span class="result-label">{{ resultLabels[item.result] }}</span>
        </li>
      </ol>
      <div class="practice-actions summary-actions">
        <button type="button" class="btn btn-primary" :disabled="busy" @click="finish">完成</button>
        <button v-if="status?.weak" type="button" class="btn btn-ghost" :disabled="busy" @click="start('mistakes')">重练错题</button>
        <button v-if="status?.due && review" type="button" class="btn btn-ghost" :disabled="busy" @click="start('due')">下一组复习</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.collocation-practice { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; }
.standalone-practice { border: 0; margin: 0; padding: 0; }
.collocation-practice p { margin: 8px 0; font-size: 14px; line-height: 1.6; }
.practice-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.collocation-practice .practice-note { color: var(--ink-soft); font-size: 12px; }
.practice-error { color: var(--warn-ink); }.practice-history { font-size: 13px; margin-top: 10px; }
.practice-history summary { cursor: pointer; }.practice-history p { border-top: 1px solid var(--line); padding-top: 8px; }
.practice-actions { justify-content: flex-start; margin-top: 10px; }
.round-toolbar,.question-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.round-toolbar .btn,.question-actions .btn { min-height: 44px; }
.round-progress { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.round-count { color: var(--ink); font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.round-count small { color: var(--ink-soft); font-size: 12px; font-weight: 500; }
.round-segments { display: flex; gap: 4px; width: 100%; max-width: 168px; }
.round-segments i { flex: 1; height: 4px; border-radius: 8px; background: var(--line); }
.round-segments .segment-done { background: color-mix(in srgb, var(--accent) 55%, var(--bg-card)); }
.round-segments .segment-current { background: var(--accent); }
.prompt-panel {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 12px;
  min-height: 170px;
  margin: 12px 0;
  padding: clamp(16px, 4vw, 34px) 12px;
  border-block: 1px solid var(--line);
  text-align: center;
}
.collocation-practice .prompt-translation { margin: 0; color: var(--ink-soft); font-size: 15px; overflow-wrap: anywhere; }
.collocation-practice .phrase-line {
  max-width: 100%;
  margin: 0;
  color: var(--ink);
  font: 500 clamp(25px, 4.5vw, 42px)/1.45 var(--serif);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.phrase-blank {
  box-sizing: border-box;
  vertical-align: baseline;
  width: min(4.7em, 100%);
  min-height: 44px;
  padding: 0 .24em;
  border: 1px solid var(--line);
  border-bottom: 2px solid var(--accent);
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  text-align: center;
  font: inherit;
}
.phrase-blank:focus { background: color-mix(in srgb, var(--accent) 18%, var(--bg-card)); }
.feedback-state { display: inline-flex; gap: 7px; align-items: center; color: var(--result-ink, var(--ink-soft)); }
.collocation-practice .feedback-state { margin: 0; }
.feedback-details .practice-note { display: flex; align-items: center; gap: 5px; margin: 0; }
.feedback-details .app-icon { width: 14px; height: 14px; flex: none; }
.question-actions { flex-wrap: wrap; }
.question-actions > .btn:last-child { margin-left: auto; }
@media (max-width: 450px) {
  .prompt-panel { min-height: 150px; }
  .question-actions kbd { display: none; }
}
kbd { margin-left: 5px; padding: 2px 5px; border: 1px solid currentColor; border-radius: 4px; font: 11px var(--sans); opacity: .7; }
.summary-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 16px; }
.summary-header h3 { margin: 0; font-size: clamp(20px, 3vw, 28px); }
.collocation-practice .summary-score { margin: 0; color: var(--ink-soft); }
.summary-score strong { padding-left: 4px; color: var(--accent-deep); font-size: 1.25em; font-variant-numeric: tabular-nums; }
.summary-list { display: grid; gap: 6px; list-style: none; padding: 0; margin: 14px 0 0; }
.summary-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-card);
  --result-ink: var(--ink-soft);
  --result-surface: var(--accent-soft);
}
.result-correct { --result-ink: var(--ok); --result-surface: var(--ok-soft); }
.result-incorrect { --result-ink: var(--bad); --result-surface: var(--bad-soft); }
.result-mark { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--result-surface); color: var(--result-ink); }
.result-label { color: var(--result-ink); font-size: 12px; line-height: 24px; white-space: nowrap; }
.summary-phrase { display: grid; gap: 3px; overflow-wrap: anywhere; }
.summary-phrase > span, .summary-phrase small { color: var(--ink-soft); font-size: 13px; }
.summary-phrase small span { color: var(--bad); }
.summary-actions { margin-top: 16px; }
</style>
