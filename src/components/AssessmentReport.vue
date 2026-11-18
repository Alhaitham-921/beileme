<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { assessment } from '../api'
import { useAppStore } from '../stores/app'
import WordEvidenceReport from './WordEvidenceReport.vue'

const props = defineProps({ sessionId: { type: Number, required: true }, preferenceBusy: Boolean })
const emit = defineEmits(['retest', 'adopt'])
const router = useRouter(), app = useAppStore()
const report = ref(null), loading = ref(false), generating = ref(false), reviewing = ref(false)
const error = ref(''), message = ref('')
const baseline = computed(() => report.value?.baseline)
const explanation = computed(() => report.value?.ai.explanation)
const reviewIds = computed(() => baseline.value?.recommendations.find(item => item.id === 'weak-words')?.wordIds || [])
const labels = { foundation: '高频基础', standard: '常规难度', challenge: '更有挑战' }
let request, revision = 0, alive = true
const date = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const fact = id => baseline.value?.facts.find(item => item.id === id)
const rate = band => band?.tested ? `${Math.round(band.correct / band.tested * 100)}%` : '未测'

async function load() {
  request?.abort()
  request = new AbortController()
  const active = request, token = ++revision
  loading.value = true; error.value = ''; message.value = ''; report.value = null
  try {
    const data = await assessment.report(props.sessionId, { signal: active.signal })
    if (alive && token === revision) report.value = data
  } catch (cause) { if (alive && token === revision && !active.signal.aborted) error.value = cause.message }
  finally { if (alive && token === revision) loading.value = false }
}
watch(() => props.sessionId, load, { immediate: true })
onBeforeUnmount(() => { alive = false; revision++; request?.abort() })

async function explain() {
  if (generating.value || explanation.value) return
  const token = revision
  generating.value = true; message.value = ''
  try {
    const data = await assessment.explain(props.sessionId)
    if (alive && token === revision) { report.value = data; message.value = data.message || '' }
  } catch (cause) { if (alive && token === revision) message.value = cause.message }
  finally { if (alive && token === revision) generating.value = false }
}
async function review() {
  if (reviewing.value || !reviewIds.value.length) return
  reviewing.value = true; message.value = ''
  try { await app.startCollectionReview(reviewIds.value); if (alive) await router.push('/study') }
  catch (cause) { if (alive) message.value = cause.message }
  finally { if (alive) reviewing.value = false }
}
</script>

<template>
  <section class="card assessment-report" aria-label="自测历史与综合分析">
    <p v-if="loading" role="status">正在关联历史自测和学习记录…</p>
    <p v-else-if="error" role="alert">{{ error }} <button class="btn btn-ghost" @click="load">重试读取分析</button></p>
    <template v-if="baseline">
      <h2>复测对比</h2>
      <template v-if="baseline.previous">
        <p class="muted">已关联此前 {{ baseline.history.usedTests }} 次可比较的自测。答对率按各次实际题量计算。</p>
        <div class="comparison-scroll" tabindex="0" role="region" aria-label="自测分档对比，可左右滑动">
        <table class="comparison-table" aria-label="上次与本次的分档结果">
          <thead>
            <tr>
              <th scope="col">难度</th>
              <th scope="col">上次<small>{{ baseline.previous.form }} 卷 · {{ date(baseline.previous.takenAt) }}</small></th>
              <th scope="col">本次<small>{{ baseline.current.form }} 卷 · {{ date(baseline.current.takenAt) }}</small></th>
              <th scope="col">答对率变化</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in baseline.comparisons" :key="item.level">
              <th scope="row">{{ labels[item.level] }}</th>
              <td v-if="item.previous">{{ item.previous.correct }}/{{ item.previous.tested }} · {{ rate(item.previous) }}<small>{{ item.previous.unsure }} 题不确定</small></td>
              <td v-else>暂无</td>
              <td>{{ item.current.correct }}/{{ item.current.tested }} · {{ rate(item.current) }}<small>{{ item.current.unsure }} 题不确定</small></td>
              <td v-if="item.change !== null">{{ item.change > 0 ? '+' : '' }}{{ item.change }}<small>百分点</small></td>
              <td v-else>暂无</td>
            </tr>
          </tbody>
        </table>
        </div>
        <p class="muted">不同试卷的对比仅供参考，一次答对率变化不代表长期进步或退步。</p>
      </template>
      <p v-else>{{ fact('comparison').text }}</p>
      <div v-if="baseline.synthesis" class="synthesis">
        <h2>综合学习建议</h2>
        <strong>{{ baseline.synthesis.title }}</strong>
        <p>{{ baseline.synthesis.detail }}</p>
        <ul v-if="baseline.synthesis.enoughHistory" class="trend-list">
          <li v-for="trend in baseline.synthesis.trends" :key="trend.level">{{ trend.text }}</li>
        </ul>
        <p v-else class="muted">已关联 {{ baseline.history.usedTests + 1 }} 次自测，趋势采用其中最近 {{ baseline.synthesis.testDays }} 个测试日。至少三个不同测试日才能判断持续变化，同一天重复测试不增加测试日。</p>
        <details>
          <summary>查看多次自测记录</summary>
          <ol class="history-series">
            <li v-for="item in baseline.synthesis.series" :key="item.sessionId">
              <strong>{{ date(item.takenAt) }} · {{ item.form }} 卷</strong>
              <span v-for="band in item.bands" :key="band.level">{{ labels[band.level] }} {{ band.correct }}/{{ band.tested }}</span>
            </li>
          </ol>
        </details>
      </div>
      <WordEvidenceReport :history="baseline.wordHistory" :reliability="baseline.reliability" />
      <p v-if="fact('history-retest')">{{ fact('history-retest').text }}</p>
      <p v-if="fact('recurring')">{{ fact('recurring').text }}</p>
      <p v-if="fact('recovered')">{{ fact('recovered').text }}</p>
      <details v-if="baseline.weakWords.length">
        <summary>本次待巩固的词义（{{ baseline.weakWords.length }}）</summary>
        <ul class="weak-words">
          <li v-for="word in baseline.weakWords" :key="`${word.spelling}:${word.meaning}`">
            <strong lang="en">{{ word.spelling }}</strong> · {{ word.meaning }}
            <span class="muted">{{ word.unsure ? '不认识 / 不确定' : '答错' }}<template v-if="word.priorFailures"> · 此前 {{ word.priorFailures }} 次未答出</template></span>
            <router-link v-if="word.wordId" :to="{ path: '/collocations', query: { wordId: word.wordId } }">练搭配</router-link>
          </li>
        </ul>
      </details>
      <h3>结合近期练习</h3>
      <p v-for="id in ['study', 'collocations', 'recall']" :key="id">{{ fact(id).text }}</p>
      <h3>接下来练什么</h3>
      <div v-for="action in baseline.recommendations" :key="action.id" class="next-action">
        <div><strong>{{ action.title }}</strong><p class="muted">{{ action.detail }}</p></div>
        <button v-if="action.id === 'weak-words' && reviewIds.length" class="btn btn-secondary" :disabled="reviewing" @click="review">{{ reviewing ? '正在准备…' : `复习 ${reviewIds.length} 个词` }}</button>
        <button v-else-if="action.id === 'weak-words'" class="btn btn-secondary" @click="emit('retest')">换卷复查（可选）</button>
        <button v-else-if="action.id === 'study-start'" class="btn btn-secondary" :disabled="preferenceBusy" @click="emit('adopt', action.level)">采用综合建议</button>
        <router-link v-else class="btn btn-ghost" :to="action.to">去练习</router-link>
      </div>
      <div class="ai-explanation">
        <h3>AI 综合解释</h3>
        <template v-if="explanation">
          <p class="muted">已保存 · {{ date(explanation.generatedAt) }} · 再次查看不调用 AI</p>
          <div v-for="item in explanation.observations" :key="item.conclusionId || item.evidenceId" class="ai-observation">
            <p>{{ item.explanation }}</p>
            <details><summary>查看依据</summary><p v-for="id in item.evidenceIds || [item.evidenceId]" :key="id" class="muted">{{ fact(id)?.label }}：{{ fact(id)?.text }}</p></details>
          </div>
          <p v-for="item in explanation.nextSteps" :key="item.actionId">{{ item.explanation }}</p>
        </template>
        <template v-else-if="report.ai.available">
          <p v-if="report.ai.needsRegeneration" class="muted">解释核对规则已更新，旧解释暂不展示；可按需重新生成。</p>
          <p class="muted">点击后使用{{ report.ai.source === 'user' ? '个人' : '平台' }}文字 AI 额度，生成后保存。</p>
          <button class="btn btn-secondary" :disabled="generating" @click="explain">{{ generating ? '正在综合历史记录…' : report.ai.generating ? '查看生成结果' : '生成综合解释' }}</button>
        </template>
        <p v-else class="muted">当前使用自动分析。<router-link to="/settings">接入文字 AI</router-link>后可生成综合解释。</p>
        <p v-if="message" role="status">{{ message }}</p>
      </div>
      <details class="analysis-scope">
        <summary>分析依据与范围</summary>
        <p class="muted">本报告以 {{ date(baseline.asOf) }} 完成自测时的记录为准；练习数据范围为此前 {{ baseline.learning.days }} 天的当前词书。</p>
        <p v-if="baseline.synthesis" class="muted">{{ baseline.synthesis.scope }}</p>
        <p v-for="note in baseline.limitations" :key="note" class="muted">{{ note }}</p>
      </details>
    </template>
  </section>
</template>

<style scoped>
.assessment-report { margin-top: 18px; line-height: 1.7; }
h2 { margin-top: 0; } h3 { margin: 24px 0 10px; font-size: 17px; }
.muted { color: var(--ink-soft); font-size: 13px; }
.comparison-scroll { overflow-x: auto; }
.comparison-table { width: 100%; min-width: 440px; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.comparison-table th, .comparison-table td { padding: 8px 4px; border-bottom: 1px solid var(--line); text-align: center; }
.comparison-table th:first-child { text-align: left; }
.comparison-table small { display: block; color: var(--ink-soft); font-weight: 400; }
.synthesis { margin-block: 22px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
.trend-list { padding-left: 20px; }.trend-list li { margin: 8px 0; }
.history-series { padding-left: 22px; font-size: 13px; }.history-series li { margin: 12px 0; }
.history-series span { display: block; color: var(--ink-soft); }
.weak-words { padding-left: 20px; }.weak-words .muted { margin-left: 6px; }.weak-words a { margin-left: 10px; }
.next-action { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; }
.next-action p { margin: 4px 0 0; }.next-action .btn { flex-shrink: 0; }
.ai-explanation { border-top: 1px solid var(--line); margin-top: 16px; }.ai-observation { margin: 14px 0; }
.ai-observation p { margin-bottom: 5px; }.analysis-scope { margin-top: 20px; font-size: 13px; }
summary { cursor: pointer; } button { touch-action: manipulation; }
@media (max-width: 480px) { .next-action { align-items: flex-start; flex-direction: column; gap: 7px; }.comparison-table { font-size: 13px; } }
</style>
