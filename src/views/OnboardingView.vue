<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import logo from '../assets/logo.png'

const auth = useAuthStore()
const app = useAppStore()
const router = useRouter()

/** 选项与后端的取值约定保持一致（见 server/src/services/profileService.js） */
const steps = [
  {
    key: 'goal',
    type: 'single',
    title: '你的学习目标是？',
    sub: '我会据此匹配初始词书与内容风格',
    options: ['中考', '高考', '四级', '六级', '考研', '雅思', '托福', '纯兴趣'],
  },
  {
    key: 'examSpan',
    type: 'single',
    title: '大概多久之后考试？',
    sub: '有明确考期的话，我会把词量平摊到每一天（可跳过）',
    optional: true,
    options: [
      { label: '3 个月内', value: '90' },
      { label: '半年内', value: '180' },
      { label: '一年内', value: '365' },
      { label: '暂时没有考试', value: 'none' },
    ],
  },
  {
    key: 'dailyTime',
    type: 'single',
    title: '每天愿意投入多久？',
    sub: '决定你每日新词量的起点',
    options: [
      { label: '5-10 分钟', value: '5-10' },
      { label: '15-20 分钟', value: '15-20' },
      { label: '30 分钟以上', value: '30+' },
    ],
  },
  {
    key: 'selfLevel',
    type: 'single',
    title: '你的词汇量大概在？',
    sub: '帮助我判断起步难度（可跳过）',
    optional: true,
    options: ['不确定', '1000 以下', '1000-3000', '3000-6000', '6000 以上'],
  },
  {
    key: 'memoryPrefs',
    type: 'multi',
    title: '你更喜欢哪种记忆方式？',
    sub: '可多选，我会据此调整 AI 生成内容的侧重点',
    optional: true,
    options: [
      { label: '例句记忆', value: 'example' },
      { label: '词根词缀', value: 'affix' },
      { label: '图像联想', value: 'image' },
      { label: '语境阅读', value: 'context' },
      { label: '游戏化', value: 'game' },
    ],
  },
]

const step = ref(0)
const answers = ref({ goal: null, examSpan: null, dailyTime: null, selfLevel: null, memoryPrefs: [] })
const submitting = ref(false)
const submitError = ref('')
/** 提交成功后展示的「准备就绪」结果 */
const prepared = ref(null)

const current = computed(() => steps[step.value])
const isLast = computed(() => step.value === steps.length - 1)

function optValue(option) {
  return typeof option === 'string' ? option : option.value
}
function optLabel(option) {
  return typeof option === 'string' ? option : option.label
}

function isSelected(option) {
  const value = optValue(option)
  if (current.value.type === 'multi') {
    return answers.value[current.value.key].includes(value)
  }
  return answers.value[current.value.key] === value
}

function pick(option) {
  const { key, type } = current.value
  const value = optValue(option)

  if (type === 'multi') {
    const list = answers.value[key]
    answers.value[key] = list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
    return
  }
  answers.value[key] = value
}

/** 单选未作答时不允许下一步（标记为可跳过的步骤除外） */
const canProceed = computed(() => {
  if (current.value.type === 'multi') return true
  if (answers.value[current.value.key]) return true
  return current.value.optional === true
})

function next() {
  if (isLast.value) {
    finish()
    return
  }
  if (!canProceed.value) return
  step.value += 1
}

function prev() {
  if (step.value > 0) step.value -= 1
}

function skip() {
  answers.value[current.value.key] = current.value.type === 'multi' ? [] : null
  if (isLast.value) finish()
  else step.value += 1
}

/** 把「多久之后考试」换算成具体日期，后端据此平摊每日词量 */
function resolveExamDate(span) {
  if (!span || span === 'none') return null
  const days = Number.parseInt(span, 10)
  if (!Number.isFinite(days)) return null
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

async function finish() {
  if (submitting.value) return
  submitting.value = true
  submitError.value = ''

  try {
    const result = await auth.completeOnboarding({
      goal: answers.value.goal || '纯兴趣',
      examDate: resolveExamDate(answers.value.examSpan),
      dailyTime: answers.value.dailyTime || '15-20',
      selfLevel: answers.value.selfLevel || '不确定',
      memoryPrefs: answers.value.memoryPrefs,
    })
    app.plan = result.plan
    prepared.value = result
  } catch (error) {
    submitError.value = error.message
  } finally {
    submitting.value = false
  }
}

function startLearning() {
  router.replace('/')
}
</script>

<template>
  <div class="onboarding">
    <div class="brand-mark">
      <img :src="logo" alt="" />
    </div>
    <h1 class="ob-title">背了么</h1>
    <p class="ob-slogan">用单词，而不是背单词</p>

    <!-- 提交完成：展示后端算出来的计划 -->
    <div v-if="prepared" class="card ob-card done-card">
      <h2 class="ob-q">都准备好了 ✨</h2>
      <p class="ob-sub">根据你的目标与时间，这是为你安排的起点</p>

      <div class="plan-preview">
        <div class="pp-item">
          <span class="pp-num">{{ prepared.newPerDay }}</span>
          <span class="pp-label">每日新词</span>
        </div>
        <div class="pp-item">
          <span class="pp-num">{{ prepared.plan.reviewTarget }}</span>
          <span class="pp-label">今日待复习</span>
        </div>
        <div class="pp-item">
          <span class="pp-num">{{ prepared.wordbook.wordCount }}</span>
          <span class="pp-label">词书总词数</span>
        </div>
      </div>

      <p class="pp-note">词书：{{ prepared.wordbook.name }}</p>

      <button class="btn btn-primary btn-lg btn-full" @click="startLearning">开始学习</button>
    </div>

    <template v-else>
      <div class="dots">
        <span
          v-for="(s, i) in steps"
          :key="s.key"
          class="dot"
          :class="{ active: i === step, done: i < step }"
        ></span>
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
            <span v-if="current.type === 'multi' && isSelected(o)" class="check">✓</span>
          </button>
        </div>

        <p v-if="submitError" class="ob-error">{{ submitError }}</p>
      </div>

      <div class="ob-nav">
        <button v-if="step > 0" class="btn btn-ghost" @click="prev">上一步</button>
        <button v-else-if="current.optional" class="btn btn-ghost" @click="skip">跳过</button>
        <span v-else></span>

        <button class="btn btn-primary" :disabled="!canProceed || submitting" @click="next">
          {{ submitting ? '正在生成计划…' : isLast ? '完成' : '下一步' }}
        </button>
      </div>

      <button v-if="step > 0 && current.optional" class="skip-link" @click="skip">跳过这一步</button>
    </template>
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

.option {
  position: relative;
}

.option.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.check {
  margin-left: auto;
  color: var(--accent-deep);
  font-weight: 700;
}

.ob-nav {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 24px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.skip-link {
  margin-top: 14px;
  border: none;
  background: none;
  color: var(--ink-soft);
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.skip-link:hover {
  color: var(--ink);
}

.ob-error {
  margin: 16px 0 0;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--bad);
  background: var(--bad-soft);
  border-radius: var(--radius-sm);
}

/* 完成态 */
.done-card {
  text-align: center;
}

.plan-preview {
  display: flex;
  justify-content: center;
  gap: 28px;
  margin: 26px 0 14px;
}

.pp-item {
  display: flex;
  flex-direction: column;
}

.pp-num {
  font-family: var(--serif);
  font-size: 30px;
  font-weight: 600;
  color: var(--accent-deep);
  font-variant-numeric: tabular-nums;
}

.pp-label {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.pp-note {
  font-size: 13px;
  color: var(--ink-soft);
  margin: 0 0 26px;
}
</style>
