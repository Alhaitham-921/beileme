<script setup>
import { computed, onMounted, ref } from 'vue'
import { recall } from '../api'

const labels = { independent: '独立答出', hinted: '提示后答出', 'needs-practice': '待巩固' }
const state = ref(null)
const session = ref(null)
const showFeedback = ref(false)
const input = ref('')
const busy = ref(false)
const message = ref('')
const question = computed(() => session.value?.question)
const feedback = computed(() => showFeedback.value ? session.value?.feedback : null)
const results = computed(() => session.value?.results || [])

async function load() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    state.value = await recall.status()
    session.value = state.value.active
    showFeedback.value = Boolean(session.value?.feedback)
    input.value = ''
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
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
    if (!data.session) message.value = mode === 'retest' ? '今天暂时没有到期的复测。' : '当前没有可练的错词，已练的词可等到复测日再练。'
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
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
    <router-link to="/notebooks?source=mistakes" class="text-button">返回错题本</router-link>
    <h1 class="section-title">错词专项</h1>
    <p class="section-sub">每组最多 5 个词。先回想英文，再看答案与用法。</p>
    <p v-if="message" role="status" class="recall-message">{{ message }}</p>
    <section v-if="!session" class="card recall-card">
      <template v-if="state">
        <p>今天有 {{ state.due }} 项到期复测，包含错词专项和对话后加入的词义。</p>
        <p v-if="state.nextDate && !state.due">下一次复测日期 · {{ state.nextDate }}</p>
        <div class="recall-actions">
          <button class="btn btn-primary" :disabled="busy" @click="start('practice')">练 5 个错词</button>
          <button class="btn btn-secondary" :disabled="busy || !state.due" @click="start('retest')">开始到期复测</button>
          <button v-if="state.lastCompleted" class="text-button" :disabled="busy" @click="viewLast">查看上次练习结果</button>
        </div>
      </template>
      <p v-else-if="busy">正在读取练习进度…</p>
      <button v-else class="btn btn-secondary" @click="load">重新读取</button>
    </section>
    <section v-else-if="feedback" class="card recall-card" aria-live="polite">
      <p>{{ session.answered }} / {{ session.total }} · {{ labels[feedback.result] }}</p>
      <h2 lang="en">{{ feedback.spelling }}</h2>
      <p>{{ feedback.meaning }}</p>
      <button type="button" class="btn btn-primary" @click="showFeedback = false">{{ question ? '下一词' : '查看本组结果' }}</button>
      <p v-if="feedback.example" lang="en" class="recall-context">{{ feedback.example }}</p>
      <p v-if="feedback.translation">{{ feedback.translation }}</p>
      <p v-if="feedback.collocation"><strong lang="en">{{ feedback.collocation.phrase }}</strong> · {{ feedback.collocation.translation }}</p>
      <p v-if="feedback.dialogue">对话「{{ feedback.dialogue.sourceTitle }}」· {{ feedback.dialogue.reason }}。本次填词 · {{ labels[feedback.result] }}。</p>
      <p v-if="feedback.previous">上次 {{ labels[feedback.previous] }} · 本次 {{ labels[feedback.result] }}</p>
      <p v-if="feedback.nextDate" class="muted">复测日期 · {{ feedback.nextDate }}</p>
    </section>
    <section v-else-if="question" class="card recall-card">
      <p>{{ session.mode === 'retest' ? '隔天复测' : '错词专项' }} · {{ session.answered + 1 }} / {{ session.total }}</p>
      <h2>{{ question.changedContext ? '换句填词' : question.blank ? '根据语境填词' : '根据中文回忆英文' }}</h2>
      <p v-if="question.blank" lang="en" class="recall-context">{{ question.blank }}</p>
      <p>{{ question.cue }} <span v-if="question.pos" class="muted">{{ question.pos }}</span></p>
      <p v-if="question.hint" role="status">首字母 · <strong lang="en">{{ question.hint }}</strong></p>
      <form @submit.prevent="input.trim() && submit(input)">
        <label for="recall-answer">输入目标词</label>
        <input id="recall-answer" v-model="input" maxlength="100" autocapitalize="none" autocomplete="off" spellcheck="false" :disabled="busy" />
        <div class="recall-actions">
          <button type="submit" class="btn btn-primary" :disabled="busy || !input.trim()">{{ busy ? '处理中…' : '提交' }}</button>
          <button type="button" class="btn btn-secondary" :disabled="busy || Boolean(question.hint)" @click="hint">看首字母</button>
          <button type="button" class="text-button" :disabled="busy" @click="submit('')">想不起来</button>
        </div>
      </form>
    </section>
    <section v-else class="card recall-card">
      <h2>本组完成</h2>
      <p v-for="(label, key) in labels" :key="key">{{ label }} · {{ results.filter(item => item.result === key).length }} 词</p>
      <ul class="recall-results">
        <li v-for="item in results" :key="item.wordId">
          <strong lang="en">{{ item.spelling }}</strong>
          <span v-if="item.previous">上次 {{ labels[item.previous] }} · </span>本次 {{ labels[item.result] }}
          <small v-if="item.dialogue">对话「{{ item.dialogue.sourceTitle }}」· {{ item.dialogue.reason }}</small>
          <small v-if="item.nextDate">复测 {{ item.nextDate }}</small>
        </li>
      </ul>
      <button class="btn btn-secondary" :disabled="busy" @click="load">返回专项首页</button>
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
