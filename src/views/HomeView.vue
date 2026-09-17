<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { formatDate } from '../utils/dates'

const store = useAppStore()
const router = useRouter()

onMounted(() => store.ensureTodayPlan())

const day = computed(() => store.todayStats)
const newDone = computed(() => day.value.new || 0)
const reviewDone = computed(() => day.value.review || 0)
const newTarget = computed(() => store.newPerDay)
const reviewTarget = computed(() => day.value.reviewTarget ?? 0)

const newPct = computed(() =>
  newTarget.value ? Math.min(100, Math.round((newDone.value / newTarget.value) * 100)) : 0
)
const reviewPct = computed(() =>
  reviewTarget.value ? Math.min(100, Math.round((reviewDone.value / reviewTarget.value) * 100)) : 0
)

const allDone = computed(
  () => newDone.value >= newTarget.value && (reviewTarget.value === 0 || reviewDone.value >= reviewTarget.value)
)

function start() {
  router.push('/study')
}
</script>

<template>
  <div class="home">
    <p class="hello">{{ formatDate() }}</p>
    <h1 class="greeting">今天也要加油呀</h1>

    <div class="chips">
      <router-link to="/dashboard" class="chip">
        <span class="chip-num">{{ store.streak }}</span>
        <span class="chip-label">连续打卡</span>
      </router-link>
      <router-link to="/dashboard" class="chip">
        <span class="chip-num">{{ store.totalLearned }}</span>
        <span class="chip-label">已背单词</span>
      </router-link>
      <div class="chip">
        <span class="chip-num">{{ store.accuracy }}%</span>
        <span class="chip-label">整体正确率</span>
      </div>
    </div>

    <div class="card todo">
      <h2 class="section-title">今日任务</h2>
      <p class="section-sub">{{ store.profile.goal ? `目标 · ${store.profile.goal}` : '' }}</p>

      <div class="todo-row">
        <div class="todo-head">
          <span>新词</span>
          <span class="muted mono-num">{{ newDone }} / {{ newTarget }}</span>
        </div>
        <div class="progress"><span :style="{ width: newPct + '%' }"></span></div>
      </div>

      <div class="todo-row">
        <div class="todo-head">
          <span>复习</span>
          <span class="muted mono-num">{{ reviewDone }} / {{ reviewTarget }}</span>
        </div>
        <div class="progress"><span :style="{ width: reviewPct + '%' }"></span></div>
      </div>

      <button class="btn btn-primary btn-lg btn-full" @click="start">
        {{ allDone ? '再学一组' : '开始学习' }}
      </button>
      <p v-if="allDone" class="done-hint">今日任务已完成 🎉</p>
    </div>

    <div class="home-links">
      <router-link to="/dashboard" class="link-card">
        <span>📊 查看学习看板</span>
        <span class="arrow">→</span>
      </router-link>
    </div>
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
</style>
