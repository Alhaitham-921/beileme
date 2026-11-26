<script setup>
import PageTime from '../components/PageTime.vue'
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore()

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { http } from '../api/client.js'
import WordLearningCard from '../components/WordLearningCard.vue'
import MorphologyCard from '../components/MorphologyCard.vue'
import { tone, spellingSoundEnabled } from '../stores/spellingSound.js'
import { createTypingSound } from '../utils/spellingPractice.js'
import { nativeSpeech } from '../utils/speechSynthesis.js'
import { readAutoPronounce } from '../utils/wordAudio.js'

import { useRouter } from 'vue-router'
const router = useRouter()
const offset = ref(0), hits = ref(0), attempts = ref(0), exhausted = ref(false)
const words = ref([])
const index = ref(0)
const typed = ref('')
const caret = ref(0)
const field = ref(null)
const finished = ref(new Set())
const loading = ref(true)
const error = ref('')
const audioError = ref('')
const word = computed(() => words.value[index.value])
const normalize = value => value.normalize('NFKC').replace(/[’‘]/g, "'").toLowerCase()
const target = computed(() => normalize(word.value?.spelling || ''))
const complete = computed(() => !!word.value && normalize(typed.value) === target.value)
const settled = computed(() => !loading.value && !error.value && !word.value)
const sound = createTypingSound()
let playback = 0
let utterance

function stopAudio() {
  playback++
  if (utterance) {
    window.speechSynthesis.cancel()
    utterance = null
  }
  nativeSpeech.stop()
}
function pronounce() {
  stopAudio()
  audioError.value = ''
  if (!word.value) return
  const token = playback
  const text = word.value.spelling
  function playRecording() {
    if (token !== playback) return
    nativeSpeech.speak(text, 0.9, { onReady() {
      if (token === playback && readAutoPronounce()) nativeSpeech.preloadWord(words.value[index.value + 1]?.spelling, 0.9)
    } }).catch(() => {
      if (token === playback) audioError.value = '点击喇叭重播'
    })
  }
  const voice = window.speechSynthesis?.getVoices().find(v => v.localService && /^en([-_]|$)/i.test(v.lang))
  if (!voice) return playRecording()
  utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = voice
  utterance.lang = voice.lang
  utterance.rate = 0.9
  utterance.onerror = playRecording
  window.speechSynthesis.speak(utterance)
}
watch(word, current => {
  audioError.value = ''
  if (current && readAutoPronounce()) pronounce()
  else stopAudio()
})
async function load() {
  loading.value = true
  error.value = ''
  try {
    const batch = (await http.get('/study/preview', {query:{offset:offset.value}})).words
    exhausted.value = !batch.length
    if (batch.length) {
      words.value = batch; index.value = 0; typed.value = ''; caret.value = 0
      finished.value = new Set(); hits.value = 0; attempts.value = 0
    }
  }
  catch (cause) { error.value = cause.message }
  finally { loading.value = false; await nextTick(); field.value?.focus() }
}
function update(event) {
  if (event.isComposing || typed.value === event.target.value) return
  const value = event.target.value
  const end = event.target.selectionEnd
  const inserted = event.inputType?.startsWith('delete') ? 0 : (event.data?.length ?? Math.max(0,value.length-typed.value.length))
  for(let i=Math.max(0,end-inserted); i<end; i++) {
    attempts.value++
    if(normalize(value[i]) === target.value[i]) hits.value++
  }
  typed.value = value
  caret.value = event.target.selectionEnd
  if (complete.value) finished.value.add(index.value)
  if (spellingSoundEnabled.value) sound.play(complete.value || (target.value.startsWith(normalize(typed.value)) ? false : 'error'), tone.value)
}
async function selectWord(i) {
  if (i !== index.value) {
    typed.value = ''
    caret.value = 0
    index.value = i
  }
  await nextTick()
  field.value?.focus({ preventScroll: true })
}
function advance() {
  if (!complete.value) return
  const next = index.value + 1
  const remaining = words.value.findIndex((_, i) => !finished.value.has(i))
  selectWord(next < words.value.length ? next : remaining < 0 ? words.value.length : remaining)
}
function space(event) {
  if (event.isComposing) return
  if (complete.value || event.repeat) {
    event.preventDefault()
    if (!event.repeat) advance()
  }
}
function nextGroup() {
  if(loading.value || exhausted.value) return
  offset.value += words.value.length
  load()
}
function enterStudy() { router.push('/study?mode=new-only') }
function groupKey(e) {
  if(word.value || loading.value || error.value || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.target?.closest('input,textarea,select')) return
  if(e.key === ' ') { e.preventDefault(); nextGroup() }
  if(e.key === 'Enter') { e.preventDefault(); enterStudy() }
}
onMounted(() => { window.addEventListener('keydown',groupKey); window.speechSynthesis?.getVoices(); load() })
onUnmounted(() => { window.removeEventListener('keydown',groupKey); stopAudio(); nativeSpeech.cancelPreload(); sound.close() })
</script>

<template>
  <section class="preview">
    <header><router-link to="/">← 主页</router-link><h1>预习单词</h1></header>
    <div class="summary" :class="{ settled }">
      <h2 v-if="settled">{{ exhausted ? '当前词书没有更多待预习的新词' : '这组词已预习完' }}</h2>
      <div class="metrics">
        <div v-if="attempts"><span>拼写正确率</span><strong>{{ Math.round(100*hits/attempts) }}%</strong></div>
        <PageTime :storage-key="auth.user?.id + '/study/preview'" :paused="!word || loading || !!error" v-slot="{ label }">
          <div><span>本页学习时长</span><strong>{{ label }}</strong></div>
        </PageTime>
      </div>
      <div v-if="settled" class="actions">
        <button v-if="!exhausted" class="btn btn-secondary" @click="nextGroup">预习下一组 <kbd>空格</kbd></button>
        <button class="btn btn-primary" @click="enterStudy">开始背单词 <kbd>Enter</kbd></button>
      </div>
    </div>
    <p v-if="loading">正在读取新词…</p>
    <p v-else-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
    <div v-else-if="word" class="layout">
      <div class="lesson">
        <div class="practice">
          <button class="phonetic" aria-label="播放单词读音" @click="pronounce(); field?.focus()">
            {{ word.phonetic }}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14"/></svg>
          </button>
          <div class="entry">
            <div class="letters" lang="en" aria-hidden="true"><span v-for="(letter,i) in word.spelling" :key="i" :class="{right:typed[i] && normalize(typed[i]) === normalize(letter), wrong:typed[i] && normalize(typed[i]) !== normalize(letter), cursor:i === caret}">{{ letter }}</span><i v-if="caret === word.spelling.length" class="cursor"></i></div>
            <input ref="field" :value="typed" :maxlength="word.spelling.length" :aria-label="'跟写 ' + word.spelling"
              @input="update" @compositionend="update" @select="caret = $event.target.selectionEnd" @keyup="caret = $event.target.selectionEnd"
              @keydown.space="space" autocomplete="off" autocapitalize="none" spellcheck="false">
          </div>
          <button class="continue" :disabled="!complete" @click="advance">{{ complete ? '✓ 已拼对 · 按空格继续' : '跟写单词，完成后按空格继续' }}</button>
          <small v-if="audioError" role="status">{{ audioError }}</small>
        </div>
        <p class="meaning"><em>{{ word.pos }}</em> {{ word.definitions?.join('；') }}</p>
        <WordLearningCard :key="word.id" :word="word" compact />
        <MorphologyCard :key="word.spelling" :word="word.spelling" />
      </div>
      <aside aria-label="本组单词">
        <div class="list-title">本组单词 <span>{{ finished.size }} / {{ words.length }}</span></div>
        <nav><button v-for="(item,i) in words" :key="item.id" :aria-current="i === index ? 'step' : undefined" @click="selectWord(i)"><span>{{ item.spelling }}</span><b v-if="finished.has(i)" aria-label="已拼对">✓</b></button></nav>
      </aside>
    </div>

  </section>
</template>

<style scoped>
.metrics,.metrics div,.actions { display:flex; align-items:center; justify-content:center; gap:12px; }
.metrics { justify-content:flex-end; gap:24px; padding:12px 0; font-variant-numeric:tabular-nums; }
.metrics span { color:var(--ink-soft); font-size:15px; }
.metrics strong { font-size:19px; }
.settled { min-height:54vh; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; gap:24px; }
.settled h2 { margin:0; font-weight:400; letter-spacing:.035em; font-size:clamp(26px,3vw,36px); }
.settled .metrics { justify-content:center; gap:clamp(24px,6vw,80px); }
.settled .metrics div { flex-direction:column; gap:6px; }
.settled strong { font-weight:400; font-size:clamp(26px,3vw,40px); line-height:1.2; }
.actions { flex-wrap:wrap; }
.actions .btn-primary { background:#bccaff; color:#172342; font-weight:500; }
.actions kbd { opacity:.78; }
.actions button { min-width:148px; gap:10px; }
kbd { font:inherit; font-size:.8em; border:1px solid currentColor; border-radius:4px; padding:1px 5px; }
@media(max-width:520px) { .metrics { justify-content:center; gap:14px; flex-wrap:wrap; }.metrics div { gap:6px; } }

.preview { color:var(--ink); }
header,.list-title,nav button { display:flex; align-items:center; justify-content:space-between; }
header { padding-bottom:14px; border-bottom:1px solid var(--line); }
header a,.list-title span { color:var(--ink-muted); }
h1 { margin:0; font-size:15px; font-weight:600; }
.layout { display:grid; grid-template-columns:minmax(0,1fr) clamp(150px,18vw,210px); gap:clamp(18px,3vw,40px); }
.practice { min-height:240px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; text-align:center; }
button { font:inherit; color:inherit; cursor:pointer; }
.phonetic,.continue,nav button { background:transparent; border:0; }
.phonetic { display:flex; align-items:center; gap:8px; color:var(--ink-muted); }
.entry { position:relative; max-width:100%; }
.letters { font:normal clamp(36px,5vw,72px)/1.2 Georgia,serif; letter-spacing:.025em; white-space:pre-wrap; overflow-wrap:anywhere; color:#a6abb2; }
.entry input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:text; }
.right,nav b { color:#54c992; }.wrong { color:#f78383; text-decoration:underline; }
.entry:focus-within .cursor { border-inline-start:2px solid var(--ink); margin-inline-start:-2px; }
.continue { padding:5px 10px; font-size:13px; color:var(--ink); }.continue:disabled { color:var(--ink-muted); cursor:text; }
.meaning { margin:4px 0 16px; padding-bottom:16px; border-bottom:1px dashed var(--line); line-height:1.7; font-size:19px; }.meaning em { color:var(--accent); }
aside { align-self:start; position:sticky; top:20px; margin-top:20px; padding-left:16px; border-left:1px solid var(--line); }
.list-title { font-size:13px; margin:0 8px 12px; }
nav { max-height:68vh; overflow:auto; }
nav button { width:100%; text-align:left; padding:9px 10px; gap:6px; border-radius:6px; overflow-wrap:anywhere; }
nav button[aria-current],nav button:hover { background:var(--accent-soft); }
@media(max-width:650px) {
  .layout { grid-template-columns:minmax(0,1fr); gap:10px; }
  aside { position:static; grid-row:1; padding:0; border:0; margin-top:12px; }
  nav { display:flex; gap:4px; } nav button { width:auto; white-space:nowrap; }
  .practice { min-height:190px; }
}
</style>
