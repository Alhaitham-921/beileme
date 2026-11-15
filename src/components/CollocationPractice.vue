<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { http } from '../api/client.js'
import { buildCollocationQuestions } from '../utils/collocationPractice.js'

const props = defineProps({ phrases: { type: Array, default: () => [] }, spelling: { type: String, default: '' }, wordId: Number, review: Boolean })
const emit = defineEmits(['active'])
const available = computed(() => buildCollocationQuestions(props.phrases, props.spelling).length)
const active = ref(false), session = ref(null), status = ref(null), input = ref(''), showFeedback = ref(false)
const busy = ref(false), error = ref(''), message = ref(''), pending = ref(null)
const controller = new AbortController()
const current = computed(() => session.value?.question)
const feedback = computed(() => showFeedback.value ? session.value?.feedback : null)
const results = computed(() => session.value?.results || [])
const labels = { correct: '独立答出', incorrect: '本次答错', unknown: '未答出' }
const date = value => new Date(value).toLocaleString('zh-CN')
const options = () => ({ signal: controller.signal, timeoutMs: 15000 })
watch(active, value => emit('active', value))
async function refresh() {
  status.value = await http.get('/collocations', { ...options(), query: props.wordId ? { wordId: props.wordId } : undefined })
}
async function load() {
  busy.value = true; error.value = ''
  try { await refresh(); session.value = status.value.active }
  catch (cause) { if (!controller.signal.aborted) error.value = cause.message || '搭配记录读取失败，请重试。' }
  finally { busy.value = false }
}
async function start(mode = props.review ? 'due' : 'practice') {
  if (busy.value || pending.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const data = await http.post('/collocations/sessions', { ...options(), body: { wordId: props.wordId, mode } })
    session.value = data.session
    if (!data.session) { message.value = data.message; active.value = false; return }
    active.value = true; showFeedback.value = Boolean(data.session.feedback); input.value = ''
  } catch (cause) { if (!controller.signal.aborted) error.value = cause.message }
  finally { busy.value = false }
}
async function save() {
  if (busy.value || !pending.value) return
  busy.value = true; error.value = ''
  try {
    const data = await http.post(`/collocations/sessions/${session.value.id}/answers`, { ...options(), body: pending.value })
    session.value = data.session; pending.value = null; showFeedback.value = true; input.value = ''
    try { await refresh() } catch { message.value = '本题已保存，统计稍后刷新。' }
  } catch (cause) { if (!controller.signal.aborted) error.value = '本题还未确认保存。' + cause.message }
  finally { busy.value = false }
}
function submit(giveUp = false) {
  if (busy.value || pending.value || !current.value || (!giveUp && !input.value.trim())) return
  pending.value = { questionIndex: current.value.index, answer: giveUp ? '' : input.value.trim() }
  void save()
}
function close() { if (!busy.value && !pending.value) active.value = false }
onMounted(load)
onBeforeUnmount(() => { controller.abort(); emit('active', false) })
</script>

<template>
  <div class="collocation-practice" :aria-busy="busy">
    <p v-if="busy && !status && !active" class="practice-note" role="status">正在读取搭配学习记录…</p>
    <p v-if="error" class="practice-error" role="alert">{{ error }}
      <button v-if="pending" type="button" class="text-button" :disabled="busy" @click="save">重试保存</button>
      <button v-else-if="!status" type="button" class="text-button" :disabled="busy" @click="load">重新读取</button>
    </p>
    <p v-if="message" class="practice-note" role="status">{{ message }}</p>
    <template v-if="!active">
      <p v-if="status?.total" class="practice-note">已练 {{ status.total }} 个搭配 · {{ status.weak }} 个待巩固 · {{ status.due }} 个到期</p>
      <div class="practice-actions">
        <button v-if="session?.question" type="button" class="btn btn-primary" :disabled="busy" @click="start()">继续上次搭配练习 · {{ session.answered }}/{{ session.total }}</button>
        <button v-else-if="review || available || status?.total" type="button" class="btn btn-ghost" :disabled="busy || (review && !status?.due)" @click="start()">{{ review ? '复习到期搭配' : '练搭配' }}</button>
        <button v-if="status?.weak" type="button" class="text-button" :disabled="busy" @click="start('mistakes')">再练没记住的搭配</button>
      </div>
      <p v-if="!review && (available || status?.total)" class="practice-note">先记搭配，再独立回忆。结果保存到账号，之后按复习时间再练。</p>
      <p v-else-if="!review && !busy" class="practice-note">暂缺可练的双语搭配，补充搭配后即可练习并记录。</p>
      <details v-if="status?.progress?.length" class="practice-history">
        <summary>查看搭配记忆记录</summary>
        <p v-for="item in status.progress" :key="item.phrase + item.translation"><strong lang="en">{{ item.phrase }}</strong> · {{ item.translation }}<br />
          {{ labels[item.lastResult] }} · 累计答对 {{ item.timesCorrect }}/{{ item.timesSeen }} 次<br />下次复习：{{ date(item.nextReviewAt) }}</p>
      </details>
    </template>
    <template v-else-if="feedback">
      <p role="status">{{ labels[feedback.result] }} · 本题结果已保存</p>
      <p v-if="feedback.previous" class="practice-note">上次：{{ labels[feedback.previous] }} → 本次：{{ labels[feedback.result] }}</p>
      <p lang="en" class="phrase-prompt"><strong>{{ feedback.phrase }}</strong></p><p>{{ feedback.translation }}</p>
      <p class="practice-note">下次复习：{{ date(feedback.nextReviewAt) }}</p>
      <button type="button" class="btn btn-primary" @click="showFeedback = false">{{ current ? '下一题' : '查看结果' }}</button>
    </template>
    <template v-else-if="current">
      <div class="practice-heading"><strong>搭配回忆 · {{ session.answered + 1 }}/{{ session.total }}<span v-if="review"> · {{ current.spelling }}</span></strong><button type="button" class="text-button" :disabled="busy || !!pending" @click="close">暂停并保留进度</button></div>
      <p>{{ current.translation }}</p><p lang="en" class="phrase-prompt">{{ current.prompt }}</p>
      <p class="practice-note">回忆学过的原搭配，填写缺少的词。其他表达可能也成立。</p>
      <form @submit.prevent="submit()">
        <label>缺少的词<input v-model="input" maxlength="320" autocomplete="off" autocapitalize="none" spellcheck="false" :disabled="busy || !!pending" /></label>
        <div class="practice-actions"><button type="submit" class="btn btn-primary" :disabled="busy || !!pending || !input.trim()">{{ busy ? '保存中…' : '提交并记录' }}</button><button type="button" class="text-button" :disabled="busy || !!pending" @click="submit(true)">想不起来</button></div>
      </form>
    </template>
    <template v-else-if="session?.results">
      <p role="status">本组独立答出 {{ results.filter(item => item.result === 'correct').length }}/{{ session.total }} 个搭配，结果已保存。</p>
      <p class="practice-note">本次答出不等于长期掌握，到期后会再次复习。</p>
      <div class="practice-actions"><button type="button" class="btn btn-ghost" :disabled="busy" @click="start(review ? 'due' : 'mistakes')">{{ review ? '继续下一组到期搭配' : '重练未答出的搭配' }}</button><button type="button" class="text-button" @click="close">返回</button></div>
    </template>
  </div>
</template>

<style scoped>
.collocation-practice { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; }
.collocation-practice p { margin: 8px 0; font-size: 14px; line-height: 1.6; }
.practice-heading,.practice-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.practice-heading strong { font-size: 14px; }
.collocation-practice .phrase-prompt { font-size: 19px; color: var(--accent-deep); overflow-wrap: anywhere; }
.collocation-practice .practice-note { color: var(--ink-soft); font-size: 12px; }
.practice-error { color: var(--warn-ink); }.practice-history { font-size: 13px; margin-top: 10px; }
.practice-history summary { cursor: pointer; }.practice-history p { border-top: 1px solid var(--line); padding-top: 8px; }
label { display: grid; gap: 6px; font-size: 13px; }
input { width: 100%; box-sizing: border-box; min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-card); color: var(--ink); font: inherit; }
.practice-actions { justify-content: flex-start; margin-top: 10px; }
</style>
