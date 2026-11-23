<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { recall, spelling } from '../api'

const labels = { independent: '独立答出', hinted: '提示后答出', 'needs-practice': '待巩固' }
const state = ref(null)
const spellingState = ref(null)
const spellingUnavailable = ref(false)
const session = ref(null)
const showFeedback = ref(false)
const input = ref('')
const busy = ref(false)
const message = ref('')
const answerField = ref(null)
const nextButton = ref(null)
const question = computed(() => session.value?.question)
const feedback = computed(() => showFeedback.value ? session.value?.feedback : null)
const results = computed(() => session.value?.results || [])
const latestSpelling = computed(() => spellingState.value?.active?.[0])
const screen = computed(() => !session.value ? 'home' : feedback.value || question.value ? 'exercise' : 'results')
const steps = ['拼一遍', '换个提示', '隔天测']
const currentStep = computed(() => session.value?.mode === 'retest' || state.value?.due && !state.value?.active && !latestSpelling.value ? 2 : question.value?.changedContext || feedback.value?.changedContext ? 1 : 0)
const position = computed(() => Math.min(session.value?.total ?? 0, (session.value?.answered ?? 0) + (feedback.value ? 0 : 1)))
watch([question, feedback, busy], async () => {
  if (busy.value) return
  await nextTick()
  if (busy.value) return
  (feedback.value ? nextButton.value : answerField.value)?.focus({ preventScroll: true })
})

function answerKey(event) {
  if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'F2' && !event.shiftKey) {
    event.preventDefault()
    if (!event.repeat) void hint()
  } else if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault()
    if (!event.repeat) void submit('')
  }
}

async function load() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const [status, history] = await Promise.allSettled([recall.status(), spelling.overview()])
    spellingUnavailable.value = history.status === 'rejected'
    spellingState.value = history.status === 'fulfilled' ? history.value : null
    if (status.status === 'rejected') throw status.reason
    state.value = status.value
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
}

function openActive() {
  session.value = state.value?.active || null
  showFeedback.value = Boolean(session.value?.feedback)
  input.value = ''
}

function home() {
  if (busy.value) return
  session.value = null
  showFeedback.value = false
  input.value = ''
  void load()
}

async function start(mode) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const data = await recall.start(mode)
    session.value = data.session
    showFeedback.value = Boolean(session.value?.feedback)
    input.value = ''
    if (!data.session) { await refreshAfterEmpty(); message.value = '今天没有到期的词。' }
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
}

async function refreshAfterEmpty() {
  try { state.value = await recall.status() } catch { /* Keep the last known status. */ }
}

async function submit(answer) {
  if (busy.value || !question.value) return
  busy.value = true
  message.value = ''
  try {
    session.value = await recall.answer(session.value.id, question.value.wordId, answer)
    showFeedback.value = true
    input.value = ''
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
}

async function hint() {
  if (busy.value || !question.value || question.value.hint) return
  busy.value = true
  message.value = ''
  try { session.value = await recall.hint(session.value.id, question.value.wordId) }
  catch (error) { message.value = error.message }
  finally { busy.value = false }
}

function viewLast() {
  session.value = state.value.lastCompleted
  showFeedback.value = false
}

onMounted(load)
</script>

<template>
  <main class="recall-page">
    <header class="recall-heading">
      <h1 class="section-title">错词专项</h1>
      <router-link v-if="screen==='home'" to="/notebooks?source=mistakes" class="quiet-link">错题本</router-link>
      <button v-else type="button" class="quiet-link" :disabled="busy" @click="home">返回专项</button>
    </header>
    <ol class="recall-path" aria-label="练习步骤">
      <li v-for="(step, i) in steps" :key="step" :aria-current="currentStep===i ? 'step' : undefined">
        <span class="step-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path v-if="i===0" d="m5 15-1 5 5-1L20 8l-4-4ZM14 6l4 4"/>
            <path v-else-if="i===1" d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>
            <path v-else d="M7 3v4m10-4v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 10 2 2 4-4"/>
          </svg>
        </span>
        <span>{{ step }}</span>
      </li>
    </ol>
    <p v-if="message" role="status" class="recall-message">{{ message }}</p>
    <section v-if="screen==='home'" class="card recall-card recall-home">
      <template v-if="busy && !state"><LoadingState>读取进度…</LoadingState></template>
      <template v-else-if="state">
        <span class="home-number" v-if="state.active">{{ state.active.answered }}<small> / {{ state.active.total }}</small></span>
        <span class="home-number" v-else-if="latestSpelling">{{ latestSpelling.completed }}<small> / {{ latestSpelling.total }}</small></span>
        <span class="home-number" v-else-if="state.due">{{ state.due }}</span>
        <h2>{{ state.active || latestSpelling ? '上次练习' : state.due ? '到期错词' : '选几个错词试试' }}</h2>
        <button v-if="state.active" class="btn btn-primary" :disabled="busy" @click="openActive">继续练习</button>
        <router-link v-else-if="latestSpelling" class="btn btn-primary" :to="`/recall/spelling/${latestSpelling.id}`">继续拼写</router-link>
        <button v-else-if="state.due" class="btn btn-primary" :disabled="busy" @click="start('retest')">开始复测</button>
        <router-link v-else class="btn btn-primary" to="/notebooks?source=mistakes">去选错词</router-link>
        <small v-if="!state.active && !latestSpelling && !state.due && state.nextDate">下次复测 {{ state.nextDate }}</small>
      </template>
      <button v-else class="btn btn-secondary" @click="load">重新读取</button>
    </section>
    <details v-if="screen==='home' && (state?.lastCompleted || spellingState?.recent?.length || spellingState?.active?.length || spellingUnavailable || state?.due && latestSpelling)" class="recall-history">
      <summary>练习记录</summary>
      <button v-if="state?.due && latestSpelling && !state.active" class="quiet-link" :disabled="busy" @click="start('retest')">复测 {{ state.due }} 词</button>
      <button v-if="state?.lastCompleted" class="quiet-link" :disabled="busy" @click="viewLast">上次复测或填词</button>
      <router-link v-for="item in spellingState?.active || []" :key="item.id" :to="`/recall/spelling/${item.id}`">拼写进行中 · {{ item.completed }}/{{ item.total }}</router-link>
      <router-link v-for="item in spellingState?.recent || []" :key="item.id" :to="`/recall/spelling/${item.id}`">拼写结果 · {{ item.total }} 词</router-link>
      <button v-if="spellingUnavailable" class="quiet-link" :disabled="busy" @click="load">重试读取拼写记录</button>
    </details>
    <div v-if="screen==='exercise'" class="recall-progress">
      <div class="progress-track" aria-hidden="true"><span v-for="n in session.total" :key="n" :class="{ filled:n<=session.answered, current:n===position }"></span></div>
      <span>{{ position }} / {{ session.total }}</span>
    </div>
    <section v-if="feedback" class="card recall-card recall-exercise" aria-live="polite">
      <p class="result-tag" :class="feedback.result">{{ labels[feedback.result] }}</p>
      <h2 lang="en">{{ feedback.spelling }}</h2>
      <p>{{ feedback.meaning }}</p>
      <p v-if="feedback.example" lang="en" class="recall-context">{{ feedback.example }}</p>
      <div v-if="feedback.previous" class="result-change"><span>上次 {{ labels[feedback.previous] }}</span><span aria-hidden="true">→</span><span>这次 {{ labels[feedback.result] }}</span></div>
      <div class="recall-actions"><button ref="nextButton" type="button" class="btn btn-primary" @click="showFeedback = false" @keydown.enter.prevent="!$event.repeat && !$event.shiftKey && (showFeedback = false)">{{ question ? '下一词' : '查看结果' }} <kbd>Enter</kbd></button></div>
      <details class="feedback-details"><summary>更多</summary>
        <p v-if="feedback.translation">{{ feedback.translation }}</p>
        <p v-if="feedback.collocation"><strong lang="en">{{ feedback.collocation.phrase }}</strong> · {{ feedback.collocation.translation }}</p>
        <p v-if="feedback.dialogue">{{ feedback.dialogue.sourceTitle }} · {{ feedback.dialogue.reason }}</p>
        <p v-if="feedback.nextDate">下次复测 {{ feedback.nextDate }}</p>
        <router-link :to="{path:'/notebooks/collocations',query:{wordId:feedback.wordId}}" class="quiet-link">复习搭配</router-link>
      </details>
    </section>
    <section v-else-if="question" class="card recall-card recall-exercise">
      <h2>{{ question.blank ? '填上缺的词' : '拼出这个词' }}</h2>
      <p v-if="question.blank" lang="en" class="recall-context">{{ question.blank }}</p>
      <p>{{ question.cue }} <span v-if="question.pos" class="muted">{{ question.pos }}</span></p>
      <p v-if="question.hint" role="status">首字母 · <strong lang="en">{{ question.hint }}</strong></p>
      <form @submit.prevent="input.trim() && submit(input)">
        <input id="recall-answer" ref="answerField" aria-label="输入英文" placeholder="输入英文" v-model="input" @keydown="answerKey" maxlength="100" autocapitalize="none" autocomplete="off" spellcheck="false" :disabled="busy" />
        <div class="recall-actions">
          <button type="submit" class="btn btn-primary" :disabled="busy || !input.trim()">{{ busy ? '处理中…' : '提交' }} <kbd>Enter</kbd></button>
          <button type="button" class="btn btn-secondary" aria-keyshortcuts="F2" :disabled="busy || Boolean(question.hint)" @click="hint">看首字母 <kbd>F2</kbd></button>
          <button type="button" class="quiet-link" aria-keyshortcuts="Shift+Enter" :disabled="busy" @click="submit('')">跳过 <kbd>Shift + Enter</kbd></button>
        </div>
      </form>
    </section>
    <section v-else-if="screen==='results'" class="card recall-card">
      <h2>本组完成</h2>
      <div class="recall-tallies"><div v-for="(label, key) in labels" :key="key"><strong>{{ results.filter(item => item.result === key).length }}</strong><span>{{ label }}</span></div></div>
      <details class="feedback-details"><summary>逐词结果</summary><ul class="recall-results">
        <li v-for="item in results" :key="item.wordId">
          <strong lang="en">{{ item.spelling }}</strong>
          <span v-if="item.previous">上次 {{ labels[item.previous] }} · </span>本次 {{ labels[item.result] }}
          <small v-if="item.dialogue">对话「{{ item.dialogue.sourceTitle }}」· {{ item.dialogue.reason }}</small>
          <small v-if="item.nextDate">复测 {{ item.nextDate }}</small>
        </li>
      </ul></details>
      <button class="btn btn-secondary" :disabled="busy" @click="home">返回专项</button>
    </section>
  </main>
</template>

<style scoped>
.recall-page { max-width: 720px; margin: 0 auto; padding-bottom: 30px; }
.recall-card { margin-top: 20px; }
.recall-context { font-size: 1.2rem; line-height: 1.6; overflow-wrap: anywhere; }
.recall-card input { display: block; width: 100%; box-sizing: border-box; min-height: 44px; margin: 8px 0 14px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--bg); font: inherit; }
.recall-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.recall-results { padding-left: 20px; line-height: 1.9; }
.recall-results strong { margin-right: 8px; }
.recall-results small { display: block; color: var(--ink-soft); }
.recall-message { margin: 12px 0; color: var(--ink-soft); }
</style>
<style scoped>
.recall-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}
.recall-heading h1{margin:0}
.quiet-link{border:0;background:transparent;color:var(--accent-deep);padding:7px 0;font:inherit;font-size:13px;cursor:pointer}
.recall-path{display:flex;list-style:none;margin:32px 0 26px;padding:0;max-width:430px}
.recall-path li{flex:1;position:relative;display:grid;justify-items:center;gap:8px;color:var(--ink-soft);font-size:12px;text-align:center}
.recall-path li+li::before{content:'';position:absolute;right:calc(50% + 24px);width:calc(100% - 48px);top:21px;border-top:1px solid var(--line)}
.step-icon{width:43px;height:43px;display:grid;place-items:center;border:1px solid var(--line);border-radius:50%;background:var(--color-surface)}
.step-icon svg{width:21px;height:21px}
.recall-path [aria-current=step]{color:var(--accent-deep)}
.recall-path [aria-current=step] .step-icon{background:var(--accent-soft);border-color:var(--accent)}
.recall-home,.recall-exercise{text-align:center;padding:clamp(24px,5vw,40px)}
.recall-home h2,.recall-exercise h2{margin:0 0 18px}
.recall-home .btn{min-width:130px}
.recall-home small:not(.home-number small){display:block;margin-top:14px;color:var(--ink-soft)}
.home-number{display:block;font:400 48px var(--serif);line-height:1.15;color:var(--accent-deep);margin-bottom:8px}
.home-number small{font-size:24px;color:var(--ink-soft)}
.recall-history,.feedback-details{color:var(--ink-soft);font-size:13px;margin:18px 0}
.recall-history summary,.feedback-details summary{cursor:pointer;padding:7px 0}
.recall-history a,.recall-history button{display:block;padding:6px 0;color:var(--accent-deep)}
.recall-progress{display:flex;align-items:center;gap:14px;color:var(--ink-soft);font-variant-numeric:tabular-nums}
.progress-track{flex:1;display:flex;gap:5px}
.progress-track span{flex:1;height:5px;border-radius:5px;background:var(--line)}
.progress-track .filled{background:var(--ok)}
.progress-track .current:not(.filled){background:var(--accent)}
.recall-exercise .recall-actions,.result-change{justify-content:center}
.recall-exercise form{max-width:430px;margin:auto}
.recall-exercise input{text-align:center;font-size:17px}
.result-tag{color:var(--warn-ink);font-size:12px}
.result-tag.independent{color:var(--ok)}
.result-change{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0;font-size:12px;color:var(--ink-soft)}
.recall-tallies{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));text-align:center;gap:8px}
.recall-tallies strong,.recall-tallies span{display:block}
.recall-tallies strong{font:400 32px var(--serif);color:var(--accent-deep)}
.recall-tallies span{font-size:12px;color:var(--ink-soft)}
kbd{margin-left:6px;font:inherit;font-size:10px;opacity:.75}
</style>
