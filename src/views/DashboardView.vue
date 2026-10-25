<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'

const app = useAppStore()
const auth = useAuthStore()
const router = useRouter()
const loading = ref(true)
const loaded = ref(false)
const loadError = ref('')

const trend = computed(() => app.trend)
const hasTrend = computed(() => trend.value.some(day => day.accuracy != null))
const dist = computed(() => app.strengthDistribution)
const strengthTotal = computed(() => Object.values(dist.value).reduce((sum, count) => sum + count, 0))
const errorItems = computed(() => app.errorDistribution?.items || [])
const weak = computed(() => app.weakSummary)

onMounted(reload)

function dayClass(day) {
  if (!day.studied) return 'empty'
  const total = day.newDone + day.reviewDone
  if (total >= 20) return 'high'
  if (total >= 10) return 'mid'
  return 'low'
}

async function reload() {
  loading.value = true
  loadError.value = ''
  try {
    await app.loadDashboard()
    loaded.value = true
  } catch (error) {
    loadError.value = error.message || '暂时无法加载学习数据，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function logout() {
  await auth.logout()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="dashboard">
    <header class="page-heading">
      <div>
        <p class="page-eyebrow">YOUR LEARNING JOURNEY</p>
        <h1 class="section-title">学习足迹</h1>
        <p class="section-sub">看见每一点进步，让积累慢慢发生。</p>
      </div>
      <nav class="heading-links" aria-label="学习工具">
        <router-link to="/roots">词根词缀库 <span aria-hidden="true">↗</span></router-link>
        <router-link to="/assessment">词汇测评 <span aria-hidden="true">↗</span></router-link>
      </nav>
    </header>

    <div v-if="loading && !loaded" class="card loading-card" role="status">
      <span class="loading-mark" aria-hidden="true"></span>
      <p class="muted">正在整理你的学习足迹…</p>
    </div>
    <div v-else-if="loadError && !loaded" class="card error-card" role="alert">
      <p class="error-title">学习数据暂时没有加载完成</p>
      <p class="error-text">{{ loadError }}</p>
      <button class="btn btn-ghost" @click="reload">重新加载</button>
    </div>

    <template v-else>
      <div v-if="loadError" class="refresh-error" role="alert">
        <span>{{ loadError }}</span>
        <button class="btn btn-ghost" :disabled="loading" @click="reload">重试</button>
      </div>
      <section class="card stats-grid" aria-label="学习概况">
        <div class="stat"><span class="stat-label">累计背词</span><span class="stat-num">{{ app.totalLearned }}<small>词</small></span></div>
        <div class="stat"><span class="stat-label">整体正确率</span><span class="stat-num">{{ app.accuracy }}<small>%</small></span></div>
        <div class="stat"><span class="stat-label">连续学习</span><span class="stat-num">{{ app.streak }}<small>天</small></span></div>
        <div class="stat"><span class="stat-label">待复习</span><span class="stat-num">{{ app.dueCount }}<small>词</small></span></div>
      </section>

      <section v-if="weak?.summary" class="card weekly-summary">
        <div class="block-heading"><h2 class="block-title">本周小结</h2><span>最近 {{ weak.days }} 天</span></div>
        <p class="weak-text">{{ weak.summary }}</p>
        <ul v-if="weak.topWrongWords?.length" class="weak-words">
          <li v-for="item in weak.topWrongWords.slice(0, 5)" :key="item.wordId">
            <span class="ww-spell">{{ item.spelling }}</span>
            <span class="ww-times">错 {{ item.wrongTimes }} 次</span>
            <span class="ww-types">{{ item.errorTypes.join('、') }}</span>
          </li>
        </ul>
      </section>

      <div class="analytics-grid">
        <section class="card block">
          <div class="block-heading"><h2 class="block-title">正确率趋势</h2><span>最近 7 天</span></div>
          <p class="block-sub">每一次作答，都在让记忆更清晰。</p>
          <div v-if="hasTrend" class="trend">
            <div v-for="day in trend" :key="day.date" class="trend-col">
              <span class="trend-val">{{ day.accuracy == null ? '—' : day.accuracy + '%' }}</span>
              <div class="trend-track" :title="day.date + '：' + (day.accuracy == null ? '暂无作答记录' : '正确率 ' + day.accuracy + '%')">
                <div v-if="day.accuracy != null" class="trend-fill" :style="{ height: Math.max(0, Math.min(100, day.accuracy)) + '%' }"></div>
              </div>
              <span class="trend-label">{{ day.label }}</span>
            </div>
          </div>
          <div v-else class="chart-empty">
            <svg viewBox="0 0 48 36" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M5 4v27h38M12 23l9-8 9 5 10-13" /></svg>
            <p>还没有正确率记录</p>
            <span>完成一次学习后，在这里看见变化。</span>
          </div>
        </section>

        <section class="card block">
          <div class="block-heading"><h2 class="block-title">错因分布</h2><span>最近 {{ app.errorDistribution?.days || 30 }} 天</span></div>
          <p class="block-sub">共 {{ app.errorDistribution?.total || 0 }} 次错误，找到值得多练习的方向。</p>
          <div v-if="!errorItems.length" class="chart-empty">
            <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="20" cy="20" r="14" /><path d="m13 20 5 5 10-11" /></svg>
            <p>还没有错题记录</p>
            <span>有错题时，这里会整理你的薄弱点。</span>
          </div>
          <div v-else class="dist">
            <div v-for="item in errorItems" :key="item.type" class="dist-row">
              <span class="dist-name">{{ item.label }}</span>
              <div class="progress dist-bar"><span :style="{ width: item.percent + '%' }"></span></div>
              <span class="dist-count mono-num">{{ item.count }} · {{ item.percent }}%</span>
            </div>
          </div>
        </section>

        <section class="card block">
          <div class="block-heading"><h2 class="block-title">记忆强度</h2><span>{{ strengthTotal }} 个已学词</span></div>
          <p class="block-sub">按复习次数分层，记录词汇逐渐熟悉的过程。</p>
          <div v-if="strengthTotal" class="dist">
            <div v-for="(count, name) in dist" :key="name" class="dist-row">
              <span class="dist-name">{{ name }}</span>
              <div class="progress dist-bar"><span :style="{ width: (count / strengthTotal) * 100 + '%' }"></span></div>
              <span class="dist-count mono-num">{{ count }}</span>
            </div>
          </div>
          <div v-else class="chart-empty">
            <p>从第一个词开始积累</p>
            <span>学习和复习后，就能看到记忆的分布。</span>
          </div>
        </section>

        <section class="card block">
          <div class="block-heading"><h2 class="block-title">学习日历</h2><span>最近 30 天</span></div>
          <p class="block-sub">点滴坚持，会留下自己的颜色。</p>
          <div class="calendar">
            <span v-for="day in app.calendar" :key="day.date" class="cal-day" :class="dayClass(day)" :title="day.date + '：新词 ' + day.newDone + '，复习 ' + day.reviewDone" :aria-label="day.date + '：新词 ' + day.newDone + '，复习 ' + day.reviewDone" role="img"></span>
          </div>
          <div class="calendar-legend"><span>学习量</span><i class="cal-day empty"></i><i class="cal-day low"></i><i class="cal-day mid"></i><i class="cal-day high"></i><span>更多</span></div>
        </section>
      </div>

      <section v-if="app.badges?.catalog?.length" class="card achievements">
        <div class="block-heading"><h2 class="block-title">成长印记</h2><span>已解锁 {{ app.badges.unlocked.length }} / {{ app.badges.catalog.length }}</span></div>
        <div class="badges">
          <div v-for="badge in app.badges.catalog" :key="badge.code" class="badge-cell" :class="{ locked: !badge.unlocked }" :title="badge.description">
            <span class="badge-icon" aria-hidden="true">{{ badge.unlocked ? badge.icon : '🔒' }}</span>
            <span class="badge-name">{{ badge.name }}</span>
            <span class="badge-state">{{ badge.unlocked ? '已解锁' : '待解锁' }}</span>
          </div>
        </div>
      </section>

      <section class="account-block">
        <div><h2>学习账号</h2><p class="account-line">{{ auth.user?.email || auth.user?.phone }} <span v-if="auth.profile?.goal" class="account-goal">目标 · {{ auth.profile.goal }}</span></p><p class="account-note">记录已保存，换设备登录同一账号即可继续。</p></div>
        <button class="btn btn-ghost" @click="logout">退出登录</button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.heading-links { display: flex; gap: 18px; flex-wrap: wrap; padding-bottom: 5px; font-size: 11px; color: var(--ink-soft); }
.heading-links a { min-height: 32px; display: inline-flex; gap: 8px; align-items: center; }
.heading-links a:hover, .heading-links span { color: var(--accent-deep); }
.loading-card { display: flex; align-items: center; gap: 14px; min-height: 160px; justify-content: center; }
.loading-mark { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 6px var(--accent-soft); }
.error-card { text-align: center; }
.error-title { font-size: 17px; margin: 0 0 10px; }
.error-text { margin: 0 0 20px; font-size: 13px; }
.refresh-error { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; background: var(--bad-soft); color: var(--bad); border-radius: 12px; margin-bottom: 18px; font-size: 13px; gap: 16px; }
.stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 26px 0; margin-bottom: 24px; }
.stat { display: flex; flex-direction: column; gap: 10px; padding: 2px 30px; border-right: 1px solid var(--line); }
.stat:last-child { border: 0; }
.stat-num { font-family: var(--serif); font-size: 34px; line-height: 1.1; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--ink); }
.stat-num small { font-family: var(--sans); font-size: 11px; color: var(--ink-muted); font-weight: 400; margin-left: 8px; }
.stat-label { font-size: 11px; color: var(--ink-soft); }
.weekly-summary { margin-bottom: 24px; }
.block-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.block-title { margin: 0; font-size: 15px; font-weight: 550; letter-spacing: .2px; }
.block-heading > span { color: var(--ink-muted); font-size: 10px; flex: none; }
.block-sub { color: var(--ink-muted); font-size: 11px; margin: 0 0 24px; line-height: 1.8; }
.analytics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.block { min-width: 0; }
.weak-text { font-size: 13px; line-height: 1.9; margin: 12px 0 0; color: var(--ink-soft); }
.weak-words { list-style: none; padding: 0; margin: 16px 0 0; }
.weak-words li { display: flex; align-items: center; gap: 15px; font-size: 12px; border-top: 1px solid var(--line); padding: 11px 0; }
.ww-spell { font-family: var(--serif); font-size: 16px; min-width: 110px; }
.ww-times { color: var(--bad); white-space: nowrap; }
.ww-types { color: var(--ink-muted); margin-left: auto; }
.trend { display: flex; justify-content: space-between; gap: 12px; height: 170px; margin-top: 8px; }
.trend-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.trend-track { flex: 1; width: min(100%, 22px); background: var(--line); border-radius: 5px; display: flex; align-items: flex-end; overflow: hidden; }
.trend-fill { width: 100%; background: var(--accent); border-radius: 5px 5px 0 0; transition: height .4s ease; }
.trend-val { font-size: 10px; color: var(--ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }
.trend-label { font-size: 10px; color: var(--ink-muted); white-space: nowrap; }
.chart-empty { min-height: 170px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.chart-empty svg { width: 40px; height: 36px; color: var(--ink-muted); margin-bottom: 14px; opacity: .75; }
.chart-empty p { margin: 0 0 6px; font-size: 13px; color: var(--ink-soft); }
.chart-empty > span { font-size: 11px; color: var(--ink-muted); }
.dist { display: grid; gap: 20px; padding: 10px 0 5px; }
.dist-row { display: grid; grid-template-columns: 64px minmax(0, 1fr) 64px; align-items: center; gap: 12px; font-size: 11px; }
.dist-name { color: var(--ink-soft); }
.dist-count { text-align: right; color: var(--ink-muted); }
.calendar { display: grid; grid-template-columns: repeat(10, 1fr); gap: 7px; }
.cal-day { aspect-ratio: 1; border-radius: 5px; background: var(--line); border: 1px solid var(--line); }
.cal-day.low { background: var(--accent-soft); border-color: var(--accent-soft); }
.cal-day.mid { background: color-mix(in srgb, var(--accent) 50%, transparent); border-color: transparent; }
.cal-day.high { background: var(--accent); border-color: var(--accent); }
.calendar-legend { display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin-top: 15px; color: var(--ink-muted); font-size: 9px; }
.calendar-legend > span { margin: 0 3px; }
.calendar-legend .cal-day { width: 9px; height: 9px; border-radius: 2px; }
.achievements { margin-top: 24px; }
.badges { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 12px; margin-top: 20px; }
.badge-cell { display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 17px 8px; border-radius: 12px; background: var(--accent-soft); text-align: center; }
.badge-cell.locked { background: transparent; border: 1px solid var(--line); color: var(--ink-muted); }
.badge-icon { font-size: 23px; line-height: 1; margin-bottom: 4px; }
.badge-cell.locked .badge-icon { filter: grayscale(1); opacity: .45; }
.badge-name { font-size: 11px; }
.badge-state { color: var(--ink-muted); font-size: 9px; }
.account-block { margin-top: 28px; border-top: 1px solid var(--line); padding: 25px 3px 0; display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.account-block h2 { font-size: 12px; font-weight: 500; margin: 0 0 7px; color: var(--ink-soft); }
.account-line { font-size: 12px; margin: 0; }
.account-goal { color: var(--ink-muted); font-size: 11px; margin-left: 12px; }
.account-note { color: var(--ink-muted); font-size: 10px; margin: 5px 0 0; }
.account-block .btn { font-size: 11px; flex: none; }
@media (max-width: 1100px) and (min-width: 821px) { .analytics-grid { gap: 16px; } .block { padding: 23px; } .stat { padding: 2px 22px; } }
@media (max-width: 640px) {
  .analytics-grid { grid-template-columns: 1fr; gap: 16px; }
  .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 8px 0; gap: 0; }
  .stat { padding: 18px 24px; }
  .stat:nth-child(2) { border-right: 0; }
  .stat:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
  .stat-num { font-size: 31px; }
  .heading-links { gap: 22px; }
  .account-block { align-items: flex-start; flex-wrap: wrap; }
  .account-goal { display: block; margin: 3px 0 0; }
  .weak-words li { flex-wrap: wrap; gap: 5px 12px; }
  .ww-types { margin-left: 0; width: 100%; font-size: 11px; }
}
</style>
