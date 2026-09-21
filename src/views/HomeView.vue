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
const reviewTask = computed(() => app.todayReview)

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
    <p class="hello">{{ formatDate() }}</p>
    <h1 class="greeting">{{ auth.displayName }}，今天也要加油呀</h1>

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
      <div class="chips">
        <router-link to="/dashboard" class="chip">
          <span class="chip-num">{{ app.streak }}</span>
          <span class="chip-label">连续打卡</span>
        </router-link>
        <router-link to="/dashboard" class="chip">
          <span class="chip-num">{{ app.totalLearned }}</span>
          <span class="chip-label">已背单词</span>
        </router-link>
        <div class="chip">
          <span class="chip-num">{{ app.accuracy }}%</span>
          <span class="chip-label">整体正确率</span>
        </div>
      </div>

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

      <div class="card todo">
        <h2 class="section-title">今日任务</h2>
        <p class="section-sub">
          {{ auth.profile?.goal ? `目标 · ${auth.profile.goal}` : '' }}
          <span v-if="app.dueCount">　待复习 {{ app.dueCount }} 词</span>
        </p>

        <div class="todo-row">
          <div class="todo-head">
            <span>新词</span>
            <span class="muted mono-num">{{ newTask.done }} / {{ newTask.target }}</span>
          </div>
          <div class="progress"><span :style="{ width: newTask.percent + '%' }"></span></div>
        </div>

        <div class="todo-row">
          <div class="todo-head">
            <span>复习</span>
            <span class="muted mono-num">{{ reviewTask.done }} / {{ reviewTask.target }}</span>
          </div>
          <div class="progress"><span :style="{ width: reviewTask.percent + '%' }"></span></div>
        </div>

        <button class="btn btn-primary btn-lg btn-full" @click="start">
          {{ app.allDoneToday ? '再学一组' : '开始学习' }}
        </button>
        <p v-if="app.allDoneToday" class="done-hint">今日任务已完成 🎉</p>
      </div>

      <div class="home-links">
        <router-link to="/dashboard" class="link-card">
          <span>📊 查看学习看板</span>
          <span class="arrow">→</span>
        </router-link>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hello {
  color: var(--ink-soft);
  margin: 8px 0 0;
}

.greeting {
  font-family: var(--serif);
  font-size: 30px;
  margin: 4px 0 20px;
}

.skeleton {
  color: var(--ink-soft);
}

.error-card {
  text-align: center;
}

.error-text {
  color: var(--bad);
  margin: 0 0 16px;
}

.chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.chip {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 14px 12px;
  text-align: center;
  display: flex;
  flex-direction: column;
}

.chip-num {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 600;
  color: var(--accent-deep);
  font-variant-numeric: tabular-nums;
}

.chip-label {
  font-size: 12px;
  color: var(--ink-soft);
  margin-top: 2px;
}

.todo-row {
  margin-bottom: 18px;
}

.todo-head {
  display: flex;
  justify-content: space-between;
  font-size: 15px;
  margin-bottom: 8px;
}

.btn-full {
  width: 100%;
  margin-top: 8px;
}

.done-hint {
  text-align: center;
  color: var(--ok);
  font-size: 14px;
  margin: 12px 0 0;
}

/* 自适应调节 */
.adjust-card {
  margin-bottom: 16px;
  border-color: var(--accent-soft);
}

.adjust-q {
  font-family: var(--serif);
  font-size: 17px;
  margin: 0 0 16px;
}

.adjust-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.adjust-btn {
  padding: 11px 12px;
  font-size: 14px;
  font-weight: 500;
}

.adjust-sub {
  margin: 14px 0 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.adjust-done {
  margin: 0 0 16px;
  padding: 10px 14px;
  font-size: 13.5px;
  color: var(--ok);
  background: var(--ok-soft);
  border-radius: var(--radius-sm);
}

.home-links {
  margin-top: 16px;
}

.link-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 16px 18px;
  font-size: 15px;
  transition: border-color 0.15s;
}

.link-card:hover {
  border-color: var(--accent);
}

.arrow {
  color: var(--ink-soft);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 480px) {
  .adjust-options {
    grid-template-columns: 1fr;
  }
}
</style>
