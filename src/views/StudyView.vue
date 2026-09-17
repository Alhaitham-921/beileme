<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { shuffle } from '../utils/shuffle'

const store = useAppStore()
const router = useRouter()

const queue = ref([])
const idx = ref(0)
const options = ref([])
const status = ref('loading') // question | answered | finished | empty
const selected = ref(null)
const startAt = ref(0)
const session = ref({ correct: 0, wrong: 0 })

const KEYS = ['A', 'B', 'C', 'D']

const current = computed(() => queue.value[idx.value])
const word = computed(() => current.value?.word)
const accuracy = computed(() => {
  const t = session.value.correct + session.value.wrong
  return t ? Math.round((session.value.correct / t) * 100) + '%' : '0%'
})

onMounted(() => start())

function start(extra = false) {
  const q = extra ? store.buildExtraSession() : store.buildSessionQueue()
  if (!q.length) {
    status.value = 'empty'
    return
  }
  queue.value = q
  idx.value = 0
  session.value = { correct: 0, wrong: 0 }
  setupCard()
}

function setupCard() {
  const w = current.value.word
  const correctText = w.definitions[0]
  const distractors = shuffle(store.allWords.filter((x) => x.id !== w.id))
    .slice(0, 3)
    .map((x) => x.definitions[0])
  options.value = shuffle([
    { text: correctText, correct: true },
    ...distractors.map((t) => ({ text: t, correct: false })),
  ])
  selected.value = null
  status.value = 'question'
  startAt.value = Date.now()
}

function choose(i) {
  if (status.value !== 'question') return
  const hes = Date.now() - startAt.value
  const opt = options.value[i]
  selected.value = i
  status.value = 'answered'
  store.submitAnswer(current.value.word.id, opt.correct, hes)
  if (opt.correct) session.value.correct += 1
  else session.value.wrong += 1
}

function next() {
  if (idx.value + 1 < queue.value.length) {
    idx.value += 1
    setupCard()
  } else {
    status.value = 'finished'
  }
}

function optionClass(i) {
  if (status.value !== 'answered') return ''
  const opt = options.value[i]
  if (opt.correct) return 'correct'
  if (i === selected.value) return 'wrong'
  return 'dim'
}

function freqLabel(f) {
  return { high: '高频', med: '中频', low: '低频' }[f] || ''
}

function speak() {
  if (!('speechSynthesis' in window) || !word.value) return
  const u = new SpeechSynthesisUtterance(word.value.spelling)
  u.lang = 'en-US'
  u.rate = 0.9
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

onBeforeUnmount(() => {
  if ('speechSynthesis' in window) speechSynthesis.cancel()
})
</script>

<template>
  <div class="study">
    <!-- 答题中 / 已作答 -->
    <template v-if="status === 'question' || status === 'answered'">
      <div class="study-head">
        <span class="badge" :class="current.kind">{{ current.kind === 'new' ? '新词' : '复习' }}</span>
        <span class="progress-text mono-num">{{ idx + 1 }} / {{ queue.length }}</span>
      </div>

      <div class="card word-card">
        <div class="word-row">
          <h1 class="word-spell">{{ word.spelling }}</h1>
          <button class="speak-btn" title="朗读" @click="speak">🔊</button>
        </div>
        <p class="word-meta">
          {{ word.phonetic }}　{{ word.pos }}
          <span v-if="word.freq" class="freq-tag" :class="word.freq">{{ freqLabel(word.freq) }}</span>
          <span v-if="word.difficulty" class="diff" :title="`难度 ${word.difficulty}/5`">
            {{ '★'.repeat(word.difficulty) }}{{ '☆'.repeat(5 - word.difficulty) }}
          </span>
        </p>

        <p class="q-prompt">选择正确的中文释义</p>

        <div class="option-grid">
          <button
            v-for="(o, i) in options"
            :key="i"
            class="option choice"
            :class="optionClass(i)"
            :disabled="status === 'answered'"
            @click="choose(i)"
          >
            <span class="opt-key">{{ KEYS[i] }}</span>
            <span>{{ o.text }}</span>
          </button>
        </div>

        <transition name="fade">
          <div v-if="status === 'answered'" class="feedback">
            <p class="fb-line" :class="options[selected]?.correct ? 'ok' : 'bad'">
              {{ options[selected]?.correct ? '✓ 回答正确' : '✗ 再记一下这个' }}
            </p>
            <p class="example"><span class="ex-label">例句</span>{{ word.example }}</p>
            <p class="def-line">释义：{{ word.definitions.join('；') }}</p>
          </div>
        </transition>
      </div>

      <div class="study-foot">
        <button v-if="status === 'answered'" class="btn btn-primary btn-lg btn-full" @click="next">
          {{ idx + 1 < queue.length ? '下一个' : '查看结果' }}
        </button>
      </div>
    </template>

    <!-- 会话完成 -->
    <div v-else-if="status === 'finished'" class="card result-card">
      <h1 class="result-title">本组完成 🎉</h1>
      <p class="result-sub">共 {{ queue.length }} 个单词</p>
      <div class="result-stats">
        <div class="rs ok"><span class="rs-num">{{ session.correct }}</span><span class="rs-label">答对</span></div>
        <div class="rs bad"><span class="rs-num">{{ session.wrong }}</span><span class="rs-label">答错</span></div>
        <div class="rs"><span class="rs-num">{{ accuracy }}</span><span class="rs-label">正确率</span></div>
      </div>
      <div class="result-actions">
        <button class="btn btn-ghost" @click="start(true)">再学一组</button>
        <button class="btn btn-primary" @click="router.push('/')">返回首页</button>
      </div>
    </div>

    <!-- 无待学 -->
    <div v-else-if="status === 'empty'" class="card result-card">
      <h1 class="result-title">今天已完成 ☕</h1>
      <p class="result-sub">新词与待复习都学完了，休息一下，或者再巩固一组。</p>
      <div class="result-actions">
        <button class="btn btn-ghost" @click="start(true)">再学一组</button>
        <button class="btn btn-primary" @click="router.push('/')">返回首页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.study-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.badge {
  font-size: 13px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 999px;
}

.badge.new {
  background: var(--accent-soft);
  color: var(--accent-deep);
}

.badge.review {
  background: #e8e6f0;
  color: #6a6485;
}

.progress-text {
  color: var(--ink-soft);
  font-size: 14px;
}

.word-card {
  padding: 34px 28px;
}

.word-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.word-spell {
  font-family: var(--serif);
  font-size: 40px;
  margin: 0;
  letter-spacing: 0.5px;
}

.speak-btn {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  font-size: 18px;
  transition: transform 0.08s;
}

.speak-btn:hover {
  border-color: var(--accent);
}

.speak-btn:active {
  transform: scale(0.92);
}

.word-meta {
  color: var(--ink-soft);
  margin: 6px 0 22px;
  font-size: 15px;
}

.freq-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
  margin-left: 10px;
  vertical-align: middle;
}

.freq-tag.high {
  background: var(--bad-soft);
  color: var(--bad);
}

.freq-tag.med {
  background: var(--accent-soft);
  color: var(--accent-deep);
}

.freq-tag.low {
  background: #e8e6f0;
  color: #6a6485;
}

.diff {
  margin-left: 10px;
  color: #e0a800;
  font-size: 13px;
  letter-spacing: 1px;
  vertical-align: middle;
}

.q-prompt {
  font-size: 14px;
  color: var(--ink-soft);
  margin: 0 0 12px;
}

.choice {
  cursor: pointer;
}

.choice:disabled {
  cursor: default;
}

.choice.correct {
  border-color: var(--ok);
  background: var(--ok-soft);
  color: var(--ok);
}

.choice.wrong {
  border-color: var(--bad);
  background: var(--bad-soft);
  color: var(--bad);
}

.choice.dim {
  opacity: 0.55;
}

.feedback {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px dashed var(--line);
}

.fb-line {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px;
}

.fb-line.ok {
  color: var(--ok);
}

.fb-line.bad {
  color: var(--bad);
}

.example {
  font-family: var(--serif);
  font-size: 16px;
  color: var(--ink);
  margin: 0 0 8px;
  line-height: 1.5;
}

.ex-label {
  display: inline-block;
  font-family: var(--sans);
  font-size: 12px;
  color: var(--accent-deep);
  background: var(--accent-soft);
  border-radius: 6px;
  padding: 1px 8px;
  margin-right: 8px;
}

.def-line {
  color: var(--ink-soft);
  font-size: 14px;
  margin: 0;
}

.study-foot {
  margin-top: 20px;
}

.btn-full {
  width: 100%;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.result-card {
  text-align: center;
  padding: 44px 28px;
}

.result-title {
  font-family: var(--serif);
  font-size: 28px;
  margin: 0 0 6px;
}

.result-sub {
  color: var(--ink-soft);
  margin: 0 0 28px;
}

.result-stats {
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-bottom: 32px;
}

.rs {
  display: flex;
  flex-direction: column;
}

.rs-num {
  font-family: var(--serif);
  font-size: 30px;
  font-weight: 600;
}

.rs.ok .rs-num {
  color: var(--ok);
}

.rs.bad .rs-num {
  color: var(--bad);
}

.rs-label {
  font-size: 13px;
  color: var(--ink-soft);
}

.result-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}
</style>
