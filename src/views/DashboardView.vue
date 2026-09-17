<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const router = useRouter()

const trend = computed(() => store.last7Days)
const dist = computed(() => store.strengthDistribution)

function confirmReset() {
  if (window.confirm('确定要清空所有学习记录吗？此操作不可恢复。')) {
    store.resetAll()
    router.push('/onboarding')
  }
}
</script>

<template>
  <div class="dashboard">
    <h1 class="section-title">学习看板</h1>
    <p class="section-sub">你的每一步，都算数</p>

    <div class="stats-grid">
      <div class="card stat">
        <span class="stat-num">{{ store.totalLearned }}</span>
        <span class="stat-label">累计背词</span>
      </div>
      <div class="card stat">
        <span class="stat-num">{{ store.accuracy }}%</span>
        <span class="stat-label">整体正确率</span>
      </div>
      <div class="card stat">
        <span class="stat-num">{{ store.streak }}</span>
        <span class="stat-label">连续打卡(天)</span>
      </div>
      <div class="card stat">
        <span class="stat-num">{{ store.dueCount }}</span>
        <span class="stat-label">待复习</span>
      </div>
    </div>

    <div class="card block">
      <h2 class="block-title">近 7 天正确率</h2>
      <div class="trend">
        <div v-for="d in trend" :key="d.key" class="trend-col">
          <div class="trend-track">
            <div class="trend-fill" :style="{ height: (d.accuracy ?? 0) + '%' }"></div>
          </div>
          <span class="trend-val">{{ d.accuracy == null ? '—' : d.accuracy + '%' }}</span>
          <span class="trend-label">{{ d.label }}</span>
        </div>
      </div>
    </div>

    <div class="card block">
      <h2 class="block-title">记忆强度分布</h2>
      <p class="block-sub">已学 {{ store.totalLearned }} 词，按复习次数分层</p>
      <div class="dist">
        <div v-for="(count, name) in dist" :key="name" class="dist-row">
          <span class="dist-name">{{ name }}</span>
          <div class="progress dist-bar">
            <span :style="{ width: store.totalLearned ? (count / store.totalLearned) * 100 + '%' : '0%' }"></span>
          </div>
          <span class="dist-count mono-num">{{ count }}</span>
        </div>
      </div>
    </div>

    <div class="card block danger-block">
      <h2 class="block-title">数据管理</h2>
      <p class="block-sub">学习记录保存在本机浏览器，不会上传。</p>
      <button class="btn btn-danger" @click="confirmReset">清空全部学习记录</button>
    </div>
  </div>
</template>

<style scoped>
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

.trend {
  display: flex;
  gap: 10px;
}

.trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.trend-track {
  width: 100%;
  height: 100px;
  background: var(--line);
  border-radius: 6px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.trend-fill {
  width: 100%;
  background: var(--accent);
  border-radius: 6px 6px 0 0;
  transition: height 0.4s ease;
}

.trend-val {
  font-size: 12px;
  color: var(--ink-soft);
}

.trend-label {
  font-size: 12px;
  color: var(--ink-soft);
}

.dist {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dist-row {
  display: grid;
  grid-template-columns: 64px 1fr 40px;
  align-items: center;
  gap: 12px;
}

.dist-name {
  font-size: 13px;
  color: var(--ink-soft);
}

.dist-count {
  text-align: right;
  font-size: 14px;
  font-weight: 600;
}

.danger-block {
  border-color: var(--bad-soft);
}

@media (max-width: 560px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
