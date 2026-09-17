<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'

const router = useRouter()
const store = useAppStore()

const step = ref(0)

const steps = [
  {
    title: '你的学习目标是？',
    sub: '我会据此为你匹配初始词书与内容风格',
    key: 'goal',
    options: ['中考', '高考', '四级', '六级', '考研', '雅思', '托福', '纯兴趣'],
  },
  {
    title: '每天愿意投入多久？',
    sub: '决定你每日新词量的起点',
    key: 'dailyTime',
    options: [
      { label: '5-10 分钟', value: '5-10' },
      { label: '15-20 分钟', value: '15-20' },
      { label: '30 分钟以上', value: '30+' },
    ],
  },
  {
    title: '你的词汇量大概在？',
    sub: '帮助我判断起步难度（可跳过）',
    key: 'level',
    options: ['不确定', '1000 以下', '1000-3000', '3000-6000', '6000 以上'],
  },
]

const answers = ref({ goal: null, dailyTime: null, level: null })
const current = computed(() => steps[step.value])
const isLast = computed(() => step.value === steps.length - 1)

function optValue(o) {
  return typeof o === 'string' ? o : o.value
}
function optLabel(o) {
  return typeof o === 'string' ? o : o.label
}
function isSelected(o) {
  return answers.value[current.value.key] === optValue(o)
}

function pick(o) {
  answers.value[current.value.key] = optValue(o)
}

function next() {
  if (isLast.value) {
    finish()
    return
  }
  if (!answers.value[current.value.key]) return
  step.value += 1
}

function prev() {
  if (step.value > 0) step.value -= 1
}

function finish() {
  store.completeOnboarding({
    goal: answers.value.goal,
    dailyTime: answers.value.dailyTime,
    level: answers.value.level || '不确定',
  })
  router.push('/')
}
</script>

<template>
  <div class="onboarding">
    <div class="brand-mark">
      <img src="/logo.png" alt="" />
    </div>
    <h1 class="ob-title">背了么</h1>
    <p class="ob-slogan">用单词，而不是背单词</p>

    <div class="dots">
      <span v-for="(s, i) in steps" :key="i" class="dot" :class="{ active: i === step, done: i < step }"></span>
    </div>

    <div class="card ob-card">
      <h2 class="ob-q">{{ current.title }}</h2>
      <p class="ob-sub">{{ current.sub }}</p>

      <div class="option-grid">
        <button
          v-for="(o, i) in current.options"
          :key="i"
          class="option"
          :class="{ selected: isSelected(o) }"
          @click="pick(o)"
        >
          <span class="opt-key">{{ String.fromCharCode(65 + i) }}</span>
          <span>{{ optLabel(o) }}</span>
        </button>
      </div>
    </div>

    <div class="ob-nav">
      <button v-if="step > 0" class="btn btn-ghost" @click="prev">上一步</button>
      <span v-else></span>
      <button class="btn btn-primary" :disabled="!answers[current.key] && !isLast" @click="next">
        {{ isLast ? '开始学习' : '下一步' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.onboarding {
  max-width: 520px;
  margin: 0 auto;
  padding: 48px 20px 80px;
  text-align: center;
}

.brand-mark img {
  width: 72px;
  height: 72px;
  border-radius: 22px;
  box-shadow: 0 10px 30px rgba(208, 118, 90, 0.24);
}

.ob-title {
  font-family: var(--serif);
  font-size: 30px;
  margin: 18px 0 2px;
}

.ob-slogan {
  color: var(--ink-soft);
  margin: 0 0 28px;
}

.dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 24px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line);
  transition: background 0.2s, transform 0.2s;
}

.dot.active {
  background: var(--accent);
  transform: scale(1.3);
}

.dot.done {
  background: var(--accent-soft);
}

.ob-card {
  text-align: left;
}

.ob-q {
  font-family: var(--serif);
  font-size: 20px;
  margin: 0 0 4px;
}

.ob-sub {
  color: var(--ink-soft);
  font-size: 14px;
  margin: 0 0 20px;
}

.option.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.ob-nav {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
