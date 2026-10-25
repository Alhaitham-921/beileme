<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { formatDate } from '../utils/dates'

const app = useAppStore()
const auth = useAuthStore()
const router = useRouter()

/** 自适应调节的结果提示（PRD 4.6.1） */
const adjustResult = ref('')
const adjusting = ref(false)

onMounted(() => {
  app.loadHome().catch(() => {})
})

const newTask = computed(() => app.todayNew)
const reviewTask = computed(() => app.todayReviewProgress)

const adjustment = computed(() => app.adjustmentPrompt)

async function chooseAdjustment(reason) {
  if (adjusting.value) return
  adjusting.value = true
  try {
    const result = await app.adjustPlan(reason)
    adjustResult.value = result.applied?.note || '已按你的选择调整'
  } catch (error) {
    adjustResult.value = error.message
  } finally {
    adjusting.value = false
  }
}

function start() {
  router.push('/study')
}

function reload() {
  app.loadHome().catch(() => {})
}
</script>

<template>
  <div class="home">
    <header class="welcome">
      <div>
        <p class="hello"><span class="hello-mark"></span> 每日积累，让语言成为你的世界</p>
        <h1 class="greeting">{{ auth.displayName }}，欢迎回来<span class="greeting-dot">。</span></h1>
        <p class="welcome-sub">留一点时间给学习，每一个词都是新的可能。</p>
      </div>
      <span class="today-date">{{ formatDate() }}</span>
    </header>

    <!-- 首次渲染时 plan 还是 null，统一走加载态，避免闪出全 0 的假数据 -->
    <div v-if="!app.plan && !app.error" class="card skeleton">
      <p class="muted">正在加载今日任务…</p>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="app.error && !app.plan" class="card error-card">
      <p class="error-text">{{ app.error }}</p>
      <button class="btn btn-ghost" @click="reload">重试</button>
    </div>

    <template v-else>
      <!-- 自适应难度调节（PRD 4.6.1）：前一天没完成时才会出现 -->
      <transition name="fade">
        <div v-if="adjustment" class="card adjust-card">
          <p class="adjust-q">{{ adjustment.question }}</p>
          <div class="adjust-options">
            <button
              v-for="option in adjustment.options"
              :key="option.value"
              class="btn btn-ghost adjust-btn"
              :disabled="adjusting"
              @click="chooseAdjustment(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
          <p class="adjust-sub">
            昨天还剩 {{ adjustment.unfinished.newRemaining }} 个新词、{{
              adjustment.unfinished.reviewRemaining
            }}
            个复习没做完
          </p>
        </div>
      </transition>

      <transition name="fade">
        <p v-if="adjustResult" class="adjust-done">{{ adjustResult }}</p>
      </transition>

      <section class="card todo" aria-labelledby="today-title">
        <div class="todo-content">
          <p class="eyebrow"><span class="status-dot"></span> 今日学习计划</p>
          <h2 id="today-title">{{ app.allDoneToday ? '很棒，今天又向前一步。' : '从一个词，走向更大的世界。' }}</h2>
          <p class="section-sub">
            {{ auth.profile?.goal ? `学习目标 · ${auth.profile.goal}` : '让新知慢慢积累，让记忆更加牢固。' }}
            <span v-if="app.dueCount"> · 待复习 {{ app.dueCount }} 词</span>
          </p>

          <div class="task-progress">
            <div class="todo-row">
              <div class="todo-head">
                <span>探索新词</span>
                <span class="mono-num"><b>{{ newTask.done }}</b><span class="muted"> / {{ newTask.target }} 词</span></span>
              </div>
              <div class="progress" role="progressbar" aria-label="今日新词进度" :aria-valuenow="newTask.done" :aria-valuemin="0" :aria-valuemax="newTask.target || 1"><span :style="{ width: newTask.percent + '%' }"></span></div>
            </div>

            <div class="todo-row">
              <div class="todo-head">
                <span>温习旧知</span>
                <span class="mono-num"><b>{{ reviewTask.done }}</b><span class="muted"> / {{ reviewTask.target }} 词</span></span>
              </div>
              <div class="progress" role="progressbar" aria-label="今日复习进度" :aria-valuenow="reviewTask.done" :aria-valuemin="0" :aria-valuemax="reviewTask.target || 1"><span :style="{ width: reviewTask.percent + '%' }"></span></div>
            </div>
          </div>

          <div class="todo-actions">
            <button class="btn btn-primary btn-lg start-btn" @click="start">
              {{ app.allDoneToday ? '再学一组' : '开始今日学习' }}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
            </button>
            <p class="action-note">{{ app.allDoneToday ? '今日计划已完成，继续保持好奇。' : '专注当下，按自己的节奏前进。' }}</p>
          </div>
        </div>

        <div class="hero-art" aria-hidden="true">
          <span class="art-caption">A LITTLE, EVERY DAY.</span>
          <div class="book-art">
            <svg viewBox="0 0 190 190" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="95" cy="95" r="83" stroke-dasharray="2 7" /><circle cx="95" cy="95" r="62" /><path d="M95 75c-18-16-37-15-51-11v61c18-4 33-1 51 11 18-12 33-15 51-11V64c-14-4-33-5-51 11Z" /><path d="M95 75v61m-39-58c9-1 18 2 27 7m-27 7c9-1 18 2 27 7m25-14c9-5 18-8 27-7m-27 21c9-5 18-8 27-7" /><path d="M95 4v15m0 152v15M4 95h15m152 0h15" /></svg>
          </div>
          <p>日积一词<br /><em>自有回响</em></p>
        </div>
      </section>

      <section class="learning-stats" aria-label="学习概况">
        <router-link to="/dashboard" class="stat-item">
          <span class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" /><path d="m8 15 3 3 5-5" /></svg></span>
          <div><span class="stat-value">{{ app.streak }}<small> 天</small></span><span class="stat-label">连续学习</span></div>
        </router-link>
        <router-link to="/dashboard" class="stat-item">
          <span class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 6c-3-3-7-3-10-2v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15" /></svg></span>
          <div><span class="stat-value">{{ app.totalLearned }}<small> 词</small></span><span class="stat-label">累计学习</span></div>
        </router-link>
        <div class="stat-item">
          <span class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg></span>
          <div><span class="stat-value">{{ app.accuracy }}<small>%</small></span><span class="stat-label">整体正确率</span></div>
        </div>
        <router-link class="stats-link" to="/dashboard">学习看板 <span aria-hidden="true">↗</span></router-link>
      </section>

      <section class="explore" aria-labelledby="explore-title">
        <div class="explore-heading"><h2 id="explore-title">让记忆，走得更远</h2><span>换一种方式，遇见学过的词</span></div>
        <div class="home-links">
          <router-link to="/review" class="link-card">
            <svg class="link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6m2-3v5l3 2" /></svg>
            <h3>今日回顾</h3><p>回看错词，让记忆更牢固</p><span class="arrow" aria-hidden="true">↗</span>
          </router-link>
          <router-link to="/practice" class="link-card">
            <svg class="link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M21 11a8 8 0 0 1-8 8H9l-6 3V8a6 6 0 0 1 6-6h4a8 8 0 0 1 8 9Z" /><path d="M7 9h10M7 13h6" /></svg>
            <h3>情境练习</h3><p>把学过的词，用进真实表达</p><span class="arrow" aria-hidden="true">↗</span>
          </router-link>
          <router-link to="/roots" class="link-card">
            <svg class="link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 4v16M5 6v4l7 4 7-4V6m-7 8-7 4m7-4 7 4" /><circle cx="12" cy="3" r="2" /><circle cx="5" cy="4" r="2" /><circle cx="19" cy="4" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /></svg>
            <h3>词根词缀</h3><p>发现词与词之间的联系</p><span class="arrow" aria-hidden="true">↗</span>
          </router-link>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.home { padding-bottom: 16px; }
.welcome { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-bottom: 34px; }
.hello { display: flex; align-items: center; gap: 9px; color: var(--ink-soft); font-size: 11px; letter-spacing: 1.3px; margin: 0 0 12px; }
.hello-mark { width: 15px; height: 1px; background: var(--accent); }
.greeting { font-size: clamp(26px, 3vw, 35px); font-weight: 600; letter-spacing: -1px; margin: 0 0 9px; line-height: 1.45; }
.greeting-dot { color: var(--accent); }
.welcome-sub { margin: 0; font-size: 13px; color: var(--ink-soft); }
.today-date { align-self: flex-end; padding-bottom: 3px; color: var(--ink-soft); font-size: 12px; white-space: nowrap; }
.skeleton { min-height: 270px; display: grid; place-items: center; }
.error-card { text-align: center; padding: 48px 24px; }
.error-text { color: var(--bad); margin: 0 0 16px; }
.todo { display: grid; grid-template-columns: minmax(0, 1fr) 230px; overflow: hidden; padding: 0; }
.todo-content { padding: 34px 0 34px 34px; min-width: 0; position: relative; z-index: 1; }
.eyebrow { display: flex; align-items: center; gap: 8px; color: var(--accent-deep); font-size: 11px; letter-spacing: 1.2px; margin: 0 0 18px; }
.status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.todo h2 { font-size: clamp(21px, 2.4vw, 27px); letter-spacing: -.8px; font-weight: 550; line-height: 1.5; margin: 0 0 10px; }
.section-sub { margin: 0 0 28px; font-size: 12px; line-height: 1.7; }
.task-progress { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 30px; margin-bottom: 28px; }
.todo-head { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 12px; }
.todo-head b { font-size: 15px; font-weight: 500; }
.todo-row .progress { height: 4px; }
.todo-actions { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.start-btn { padding: 13px 21px; font-size: 13px; gap: 25px; }
.start-btn svg { width: 17px; height: 17px; }
.action-note { font-size: 10px; color: var(--ink-soft); margin: 0; }
.hero-art { display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 26px 24px; color: var(--accent-deep); }
.hero-art::before { content: ''; position: absolute; left: 22px; top: 34px; bottom: 34px; width: 1px; background: var(--line); }
.art-caption { font-size: 8px; letter-spacing: 2px; opacity: .6; }
.book-art { width: 145px; margin: 16px 0 12px; opacity: .62; }
.book-art svg { display: block; width: 100%; }
.hero-art p { font-family: var(--serif); color: var(--ink-soft); font-size: 19px; line-height: 1.7; text-align: center; letter-spacing: 4px; margin: 0; }
.hero-art em { font-style: normal; font-size: 12px; letter-spacing: 6px; opacity: .7; }
.learning-stats { display: grid; grid-template-columns: repeat(3, 1fr) auto; align-items: center; gap: 22px; margin: 24px 0 38px; padding: 21px 25px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-card); }
.stat-item { display: flex; align-items: center; gap: 13px; min-width: 0; }
.stat-icon { color: var(--ink-soft); opacity: .7; }
.stat-icon svg { width: 23px; height: 23px; display: block; }
.stat-value { font-size: 24px; font-weight: 500; line-height: 1.3; font-variant-numeric: tabular-nums; }
.stat-value small { font-size: 11px; color: var(--ink-soft); font-weight: 400; }
.stat-label { display: block; font-size: 10px; color: var(--ink-soft); margin-top: 4px; letter-spacing: .4px; }
.stats-link { display: flex; gap: 10px; align-items: center; font-size: 11px; color: var(--ink-soft); white-space: nowrap; }
.stats-link:hover, a.stat-item:hover .stat-value { color: var(--accent-deep); }
.explore-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.explore-heading h2 { margin: 0; font-size: 16px; font-weight: 500; }
.explore-heading > span { font-size: 10px; color: var(--ink-soft); }
.home-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.link-card { position: relative; background: var(--bg-card); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 23px; transition: border-color .18s ease, transform .18s ease; }
.link-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.link-icon { width: 23px; height: 23px; color: var(--accent-deep); margin-bottom: 18px; opacity: .85; }
.link-card h3 { font-size: 14px; font-weight: 500; margin: 0 0 8px; }
.link-card p { color: var(--ink-soft); font-size: 11px; line-height: 1.7; margin: 0; }
.arrow { position: absolute; top: 22px; right: 21px; color: var(--ink-soft); font-size: 16px; opacity: .6; }
.adjust-card { margin-bottom: 16px; border-color: var(--accent-soft); }
.adjust-q { font-size: 16px; margin: 0 0 16px; }
.adjust-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.adjust-btn { padding: 11px 12px; font-size: 13px; font-weight: 500; }
.adjust-sub { margin: 14px 0 0; font-size: 12px; color: var(--ink-soft); }
.adjust-done { margin: 0 0 16px; padding: 10px 14px; font-size: 13px; color: var(--ok); background: var(--ok-soft); border-radius: var(--radius-sm); }
.fade-enter-active, .fade-leave-active { transition: opacity .22s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (max-width: 1100px) { .todo { grid-template-columns: minmax(0, 1fr) 185px; }.todo-content { padding-left: 28px; }.task-progress { gap: 20px; }.hero-art { padding-right: 12px; }.hero-art::before { left: 16px; }.book-art { width: 120px; }.action-note { font-size: 9px; }.learning-stats { padding: 20px; gap: 16px; }.stat-item { gap: 10px; }.stat-icon svg { width: 19px; height: 19px; } }
@media (max-width: 760px) { .welcome { display: block; margin-bottom: 26px; }.today-date { display: block; margin-top: 15px; font-size: 10px; }.todo { grid-template-columns: minmax(0, 1fr); }.todo-content { padding: 28px; }.hero-art { display: none; }.learning-stats { grid-template-columns: repeat(3, 1fr); }.stats-link { display: none; }.link-card { padding: 18px; }.link-card p { font-size: 10px; }.explore-heading > span { display: none; } }
@media (max-width: 480px) { .hello { font-size: 9px; letter-spacing: .6px; }.greeting { font-size: 27px; }.welcome-sub { font-size: 11px; }.todo-content { padding: 24px 20px; }.todo h2 { font-size: 21px; }.task-progress { gap: 20px; }.todo-head { flex-wrap: wrap; gap: 4px; }.todo-actions { gap: 13px; }.start-btn { width: 100%; justify-content: space-between; padding: 14px 20px; }.action-note { width: 100%; text-align: center; }.learning-stats { gap: 12px; padding: 18px 14px; margin-bottom: 30px; }.stat-icon { display: none; }.stat-value { font-size: 22px; }.stat-label { font-size: 9px; }.home-links { grid-template-columns: 1fr; gap: 10px; }.link-card { display: grid; grid-template-columns: 30px 1fr; gap: 5px 13px; padding: 20px; }.link-icon { grid-row: span 2; align-self: center; margin: 0; }.link-card h3 { margin: 0; }.link-card p { font-size: 11px; }.arrow { top: 21px; }.adjust-options { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .link-card, .fade-enter-active, .fade-leave-active { transition: none; }.link-card:hover { transform: none; } }
</style>
