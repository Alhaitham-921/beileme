<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'

const app = useAppStore()
const auth = useAuthStore()
const router = useRouter()

onMounted(() => {
  app.loadDashboard().catch(() => {})
})

const trend = computed(() => app.trend)
const dist = computed(() => app.strengthDistribution)
const strengthTotal = computed(() =>
  Object.values(dist.value).reduce((sum, count) => sum + count, 0)
)
const errorItems = computed(() => app.errorDistribution?.items || [])
const weak = computed(() => app.weakSummary)

/** 日历按学习量着色，直观看出坚持情况 */
function dayClass(day) {
  if (!day.studied) return 'empty'
  const total = day.newDone + day.reviewDone
  if (total >= 20) return 'high'
  if (total >= 10) return 'mid'
  return 'low'
}

function reload() {
  app.loadDashboard().catch(() => {})
}

async function logout() {
  await auth.logout()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="dashboard">
    <h1 class="section-title">学习看板</h1>
    <p class="section-sub">你的每一步，都算数</p>

    <!-- 首次渲染时 overview 还是 null，统一走加载态，避免闪出全 0 的假数据 -->
    <div v-if="!app.overview && !app.error" class="card">
      <p class="muted">正在加载学习数据…</p>
    </div>

    <div v-else-if="app.error && !app.overview" class="card error-card">
      <p class="error-text">{{ app.error }}</p>
      <button class="btn btn-ghost" @click="reload">重试</button>
    </div>

    <template v-else>
      <div class="stats-grid">
        <div class="card stat">
          <span class="stat-num">{{ app.totalLearned }}</span>
          <span class="stat-label">累计背词</span>
        </div>
        <div class="card stat">
          <span class="stat-num">{{ app.accuracy }}%</span>
          <span class="stat-label">整体正确率</span>
        </div>
        <div class="card stat">
          <span class="stat-num">{{ app.streak }}</span>
          <span class="stat-label">连续打卡(天)</span>
        </div>
        <div class="card stat">
          <span class="stat-num">{{ app.dueCount }}</span>
          <span class="stat-label">待复习</span>
        </div>
      </div>

      <!-- 本周薄弱点小结（PRD 4.3.3） -->
      <div v-if="weak?.summary" class="card block">
        <h2 class="block-title">本周小结</h2>
        <p class="block-sub">基于你最近 {{ weak.days }} 天的真实作答数据</p>
        <p class="weak-text">{{ weak.summary }}</p>

        <ul v-if="weak.topWrongWords?.length" class="weak-words">
          <li v-for="item in weak.topWrongWords.slice(0, 5)" :key="item.wordId">
            <span class="ww-spell">{{ item.spelling }}</span>
            <span class="ww-times">错 {{ item.wrongTimes }} 次</span>
            <span class="ww-types">{{ item.errorTypes.join('、') }}</span>
          </li>
        </ul>
      </div>

      <div class="card block">
        <h2 class="block-title">近 7 天正确率</h2>
        <div class="trend">
          <div v-for="day in trend" :key="day.date" class="trend-col">
            <div class="trend-track">
              <div class="trend-fill" :style="{ height: (day.accuracy ?? 0) + '%' }"></div>
            </div>
            <span class="trend-val">{{ day.accuracy == null ? '—' : day.accuracy + '%' }}</span>
            <span class="trend-label">{{ day.label }}</span>
          </div>
        </div>
      </div>

      <!-- 错因分布（饼图数据源，此处用条形展示） -->
      <div class="card block">
        <h2 class="block-title">错因分布</h2>
        <p class="block-sub">
          近 {{ app.errorDistribution?.days || 30 }} 天共 {{ app.errorDistribution?.total || 0 }} 次错误
        </p>

        <p v-if="!errorItems.length" class="muted empty-hint">还没有错题，保持住 👍</p>

        <div v-else class="dist">
          <div v-for="item in errorItems" :key="item.type" class="dist-row">
            <span class="dist-name">{{ item.label }}</span>
            <div class="progress dist-bar">
              <span :style="{ width: item.percent + '%' }"></span>
            </div>
            <span class="dist-count mono-num">{{ item.count }} · {{ item.percent }}%</span>
          </div>
        </div>
      </div>

      <div class="card block">
        <h2 class="block-title">记忆强度分布</h2>
        <p class="block-sub">已学 {{ strengthTotal }} 词，按复习次数分层</p>
        <div class="dist">
          <div v-for="(count, name) in dist" :key="name" class="dist-row">
            <span class="dist-name">{{ name }}</span>
            <div class="progress dist-bar">
              <span :style="{ width: strengthTotal ? (count / strengthTotal) * 100 + '%' : '0%' }"></span>
            </div>
            <span class="dist-count mono-num">{{ count }}</span>
          </div>
        </div>
      </div>

      <!-- 打卡日历（PRD 4.6.2） -->
      <div class="card block">
        <h2 class="block-title">打卡日历</h2>
        <p class="block-sub">最近 30 天</p>
        <div class="calendar">
          <span
            v-for="day in app.calendar"
            :key="day.date"
            class="cal-day"
            :class="dayClass(day)"
            :title="`${day.date}：新词 ${day.newDone}，复习 ${day.reviewDone}`"
          ></span>
        </div>
      </div>

      <!-- 徽章墙（PRD 4.6.2） -->
      <div v-if="app.badges" class="card block">
        <h2 class="block-title">成就墙</h2>
        <p class="block-sub">
          已解锁 {{ app.badges.unlocked.length }} / {{ app.badges.catalog.length }}
        </p>
        <div class="badges">
          <div
            v-for="badge in app.badges.catalog"
            :key="badge.code"
            class="badge-cell"
            :class="{ locked: !badge.unlocked }"
            :title="badge.description"
          >
            <span class="badge-icon">{{ badge.unlocked ? badge.icon : '🔒' }}</span>
            <span class="badge-name">{{ badge.name }}</span>
          </div>
        </div>
      </div>

      <div class="card block">
        <h2 class="block-title">账号</h2>
        <p class="block-sub">
          学习记录已保存在服务器，换设备登录同一账号即可继续。
        </p>
        <p class="account-line">
          {{ auth.user?.email || auth.user?.phone }}
          <span v-if="auth.profile?.goal" class="account-goal">目标 · {{ auth.profile.goal }}</span>
        </p>
        <button class="btn btn-ghost" @click="logout">退出登录</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.error-card {
  text-align: center;
}

.error-text {
  color: var(--bad);
  margin: 0 0 16px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat {
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-num {
  font-family: var(--serif);
  font-size: 26px;
  font-weight: 600;
  color: var(--accent-deep);
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 12px;
  color: var(--ink-soft);
  margin-top: 2px;
}

.block {
  margin-bottom: 16px;
}

.block-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 4px;
}

.block-sub {
  color: var(--ink-soft);
  font-size: 13px;
  margin: 0 0 18px;
}

.empty-hint {
  font-size: 14px;
  margin: 0;
}

/* 本周小结 */
.weak-text {
  font-size: 14.5px;
  line-height: 1.75;
  margin: 0;
  color: var(--ink);
}

.weak-words {
  list-style: none;
  padding: 0;
  margin: 16px 0 0;
  display: grid;
  gap: 8px;
}

.weak-words li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}

.ww-spell {
  font-family: var(--serif);
  font-size: 15px;
  font-weight: 600;
  min-width: 92px;
}

.ww-times {
  color: var(--bad);
}

.ww-types {
  color: var(--ink-soft);
  margin-left: auto;
}

/* 趋势 */
.trend {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  height: 140px;
}

.trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.trend-track {
  flex: 1;
  width: 100%;
  background: var(--bg);
  border-radius: 8px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.trend-fill {
  width: 100%;
  background: var(--accent);
  border-radius: 8px 8px 0 0;
  transition: height 0.4s ease;
  min-height: 2px;
}

.trend-val {
  font-size: 11.5px;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
}

.trend-label {
  font-size: 11px;
  color: var(--ink-soft);
}

/* 分布条 */
.dist {
  display: grid;
  gap: 12px;
}

.dist-row {
  display: grid;
  grid-template-columns: 72px 1fr 84px;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.dist-name {
  color: var(--ink-soft);
}

.dist-count {
  text-align: right;
  color: var(--ink-soft);
}

/* 日历 */
.calendar {
  display: grid;
  grid-template-columns: repeat(15, 1fr);
  gap: 6px;
}

.cal-day {
  aspect-ratio: 1;
  border-radius: 5px;
  background: var(--bg);
  border: 1px solid var(--line);
}

.cal-day.low {
  background: var(--accent-soft);
  border-color: var(--accent-soft);
}

.cal-day.mid {
  background: #e6bda8;
  border-color: #e6bda8;
}

.cal-day.high {
  background: var(--accent);
  border-color: var(--accent);
}

/* 徽章 */
.badges {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 12px;
}

.badge-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent-deep);
  text-align: center;
}

.badge-cell.locked {
  background: var(--bg);
  color: var(--ink-soft);
  opacity: 0.65;
}

.badge-icon {
  font-size: 22px;
  line-height: 1;
}

.badge-name {
  font-size: 12px;
  font-weight: 600;
}

.account-line {
  font-size: 14px;
  margin: 0 0 16px;
}

.account-goal {
  color: var(--ink-soft);
  font-size: 13px;
  margin-left: 10px;
}

@media (max-width: 560px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .calendar {
    grid-template-columns: repeat(10, 1fr);
  }

  .dist-row {
    grid-template-columns: 62px 1fr 72px;
  }
}
</style>
