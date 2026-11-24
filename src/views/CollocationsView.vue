<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '../api/client.js'
import AiUsage from '../components/AiUsage.vue'
import AppIcon from '../components/AppIcon.vue'
import WordLearningCard from '../components/WordLearningCard.vue'
import CollocationPractice from '../components/CollocationPractice.vue'
import { latestAiUsage } from '../stores/aiUsage.js'

const route = useRoute()
const router = useRouter()
const path = '/notebooks/collocations'
const mistakesPath = '/notebooks?source=mistakes'
const word = ref(null)
const error = ref('')
const loading = ref(false)
const practicing = ref(false)
const recommendations = ref(null)
const hasUsage = computed(() => {
  const usage = latestAiUsage.value
  return Boolean(usage && (usage.promptTokens || usage.completionTokens || usage.estimatedCostText || usage.unknownCalls))
})

function positiveId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}
const wordId = computed(() => positiveId(route.query.wordId))
const resumeId = computed(() => wordId.value ? positiveId(route.query.resume) : undefined)
const wordPath = (id, resume) => ({ path, query: resume ? { wordId: id, resume } : { wordId: id } })
const resumeSummary = status => status.active || status.wordResume
const progress = session => `${session.total ? session.answered / session.total * 100 : 0}%`
function finishPractice() {
  if (resumeId.value) void router.replace(path)
}

let wordRequest, recommendationRequest
async function loadWord() {
  wordRequest?.abort()
  word.value = null
  error.value = ''
  loading.value = false
  if (!wordId.value || resumeId.value) return
  const request = new AbortController()
  wordRequest = request
  loading.value = true
  try {
    const data = await http.get('/words/' + wordId.value, { signal: request.signal })
    if (!request.signal.aborted) word.value = data.word
  } catch (cause) {
    if (!request.signal.aborted) error.value = cause.message
  } finally {
    if (!request.signal.aborted) loading.value = false
  }
}

watch([wordId, resumeId], loadWord, { immediate: true })
watch([wordId, practicing], async ([id, active]) => {
  recommendationRequest?.abort()
  if (id || active) return
  const request = new AbortController()
  recommendationRequest = request
  try {
    const data = await http.get('/collocations/recommendations', { signal: request.signal, timeoutMs: 15000 })
    if (!request.signal.aborted) recommendations.value = data
  } catch {
    if (!request.signal.aborted) recommendations.value = null
  }
}, { immediate: true })
onBeforeUnmount(() => {
  wordRequest?.abort()
  recommendationRequest?.abort()
})
</script>

<template>
  <main class="collocations-page">
    <header class="collocations-heading">
      <router-link :to="wordId ? path : mistakesPath" class="back-link">
        <AppIcon name="arrow" />{{ wordId ? '返回搭配练习' : '返回错题本' }}
      </router-link>
      <h1 class="section-title">搭配练习</h1>
    </header>

    <template v-if="wordId && !resumeId">
      <p v-if="loading"><LoadingState>正在读取单词…</LoadingState></p>
      <p v-else-if="error" role="alert">{{ error }} <button class="text-button" type="button" @click="loadWord">重试</button></p>
      <WordLearningCard v-else-if="word" :key="word.id" :word="word" @practice-active="practicing = $event" />
    </template>
    <template v-else>
      <section class="card practice-card" aria-label="搭配任务">
        <CollocationPractice :key="resumeId ?? 'overview'" :word-id="wordId" :resume-id="resumeId" :review="!wordId"
          @active="practicing = $event" @finished="finishPractice">
          <template #overview="{ status, busy, error: statusError, start, resume }">
            <div v-if="status && resumeId && status.active?.id !== resumeId" class="hero">
              <div class="hero-copy">
                <h2>这组练习已结束</h2>
              </div>
              <div class="hero-actions">
                <router-link :to="wordPath(wordId)" class="btn btn-primary">查看单词搭配</router-link>
              </div>
            </div>
            <div v-else-if="status" class="hero">
              <div class="hero-copy">
                <template v-if="resumeSummary(status)">
                  <h2>上次练习</h2>
                  <p v-if="resumeSummary(status).spelling || resumeSummary(status).question?.spelling" class="resume-word" lang="en">
                    {{ resumeSummary(status).spelling || resumeSummary(status).question.spelling }}
                  </p>
                </template>
                <h2 v-else-if="status.due">到期复习</h2>
                <h2 v-else-if="status.weak">巩固搭配</h2>
                <h2 v-else-if="status.total">暂无到期搭配</h2>
                <h2 v-else>练一组搭配</h2>
              </div>

              <div v-if="resumeSummary(status)" class="hero-visual">
                <div class="progress-ring" :style="{ '--completed': progress(resumeSummary(status)) }"
                  role="progressbar" aria-label="已答题数" :aria-valuenow="resumeSummary(status).answered"
                  :aria-valuemax="resumeSummary(status).total">
                  <span>{{ resumeSummary(status).answered }}<small>/{{ resumeSummary(status).total }}</small></span>
                </div>
              </div>
              <dl v-else-if="status.total" class="hero-visual metrics">
                <div v-if="status.due" class="metric primary-metric"><dt>已到期</dt><dd>{{ status.due }}</dd></div>
                <div v-if="status.weak" class="metric" :class="{ 'primary-metric': !status.due }"><dt>待巩固</dt><dd>{{ status.weak }}</dd></div>
                <div v-if="!status.due && !status.weak" class="metric primary-metric"><dt>已练搭配</dt><dd>{{ status.total }}</dd></div>
              </dl>
              <div v-else class="hero-visual word-tiles" aria-hidden="true">
                <span lang="en">make</span><span lang="en">progress</span>
              </div>

              <div class="hero-actions">
                <button v-if="status.active" class="btn btn-primary" type="button" :disabled="busy" @click="resume">
                  继续练习 <AppIcon name="arrow" />
                </button>
                <router-link v-else-if="status.wordResume" class="btn btn-primary" :to="wordPath(status.wordResume.wordId, status.wordResume.id)">
                  继续练习 <AppIcon name="arrow" />
                </router-link>
                <template v-else-if="status.due || status.weak">
                  <button v-if="status.due" class="btn btn-primary" type="button" :disabled="busy" @click="start('due')">
                    开始复习 <AppIcon name="arrow" />
                  </button>
                  <button v-if="status.weak" class="btn" :class="status.due ? 'btn-ghost' : 'btn-primary'"
                    type="button" :disabled="busy" @click="start('mistakes')">重练错题</button>
                  <router-link v-if="!status.due" class="btn btn-ghost" to="/lookup"><AppIcon name="search" />查词</router-link>
                </template>
                <template v-else-if="status.total || recommendations?.mistakeCount === 0">
                  <router-link class="btn btn-primary" to="/lookup"><AppIcon name="search" />查词练搭配</router-link>
                  <router-link class="btn btn-ghost" :to="mistakesPath">错题本</router-link>
                </template>
                <template v-else>
                  <router-link class="btn btn-primary" :to="mistakesPath"><AppIcon name="book" />从错题本选词</router-link>
                  <router-link class="btn btn-ghost" to="/lookup"><AppIcon name="search" />查词</router-link>
                </template>
              </div>
            </div>
            <div v-else-if="statusError" class="hero-actions">
              <router-link class="btn btn-ghost" :to="mistakesPath">错题本</router-link>
              <router-link class="btn btn-ghost" to="/lookup"><AppIcon name="search" />查词</router-link>
            </div>
          </template>
        </CollocationPractice>
      </section>

      <section v-if="!wordId && !practicing && recommendations?.items.length" class="recommendations">
        <h2>错词推荐</h2>
        <ul class="recommendation-grid">
          <li v-for="item in recommendations.items" :key="item.wordId">
            <router-link class="word-card" :to="wordPath(item.wordId)">
              <strong lang="en">{{ item.spelling }}</strong>
              <span lang="en">{{ item.phrase }}</span>
              <AppIcon name="arrow" />
            </router-link>
          </li>
        </ul>
      </section>
    </template>

    <details v-if="hasUsage && !practicing" class="usage-details">
      <summary>AI 用量</summary>
      <AiUsage :usage="latestAiUsage" :label="`${latestAiUsage.label || 'AI'}最近一次消耗${latestAiUsage.failed ? '（生成失败）' : ''}`" />
    </details>
  </main>
</template>

<style scoped>
.collocations-page { max-width: 820px; margin: 0 auto; padding-bottom: 24px; }
.collocations-heading { margin-bottom: clamp(16px, 3vw, 28px); }
.collocations-heading h1 { margin: 8px 0 0; }
.back-link { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; font-size: 13px; color: var(--ink-soft); }
.back-link .app-icon { width: 16px; transform: rotate(180deg); }
.practice-card {
  padding: clamp(20px, 4vw, 36px);
  background-image: radial-gradient(ellipse at 80% 5%, var(--accent-soft), transparent 66%);
}
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: 'copy visual' 'actions visual';
  align-content: center;
  gap: clamp(14px, 3vw, 24px);
}
.hero h2 { margin: 0; font-size: clamp(23px, 3.6vw, 34px); letter-spacing: -.035em; line-height: 1.2; }
.hero-copy { grid-area: copy; align-self: end; }
.resume-word { color: var(--accent-deep); overflow-wrap: anywhere; }
.hero-actions { grid-area: actions; display: flex; flex-wrap: wrap; gap: 8px; align-self: start; }
.hero-actions .app-icon { width: 16px; }
.hero-visual { grid-area: visual; align-self: center; justify-self: end; }
.word-tiles { display: flex; align-items: center; padding: 16px 10px; }
.word-tiles span {
  display: grid;
  place-items: center;
  min-height: 58px;
  padding: 0 .8em;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--bg-card);
  box-shadow: 0 8px 20px #060d1740;
  font-size: clamp(23px, 3vw, 36px);
  font-weight: 650;
  letter-spacing: -.05em;
  transform: rotate(-8deg);
}
.word-tiles span + span {
  margin-left: -5px;
  border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
  background: color-mix(in srgb, var(--accent) 19%, var(--bg-card));
  color: var(--accent-deep);
  transform: translateY(9px) rotate(6deg);
}
.progress-ring {
  display: grid;
  place-items: center;
  width: 104px;
  aspect-ratio: 1;
  padding: 6px;
  border-radius: 50%;
  background: conic-gradient(var(--accent) var(--completed), var(--accent-soft) 0%);
}
.progress-ring span {
  display: grid;
  place-content: center;
  grid-auto-flow: column;
  align-items: baseline;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--bg-card);
  font-size: 29px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}
.progress-ring small { color: var(--ink-soft); font-size: 15px; font-weight: 500; }
.metrics { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
.metric {
  display: flex;
  flex-direction: column-reverse;
  justify-content: center;
  min-width: 82px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--bg-card);
}
.metric dd { margin: 0; font-size: clamp(29px, 4vw, 42px); font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1; }
.metric dt { margin-top: 6px; color: var(--ink-soft); font-size: 12px; }
.primary-metric { color: var(--accent-deep); border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); }
.recommendations { margin-top: clamp(22px, 4vw, 34px); }
.recommendations h2 { font-size: 17px; margin: 0 0 12px; }
.recommendation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 165px), 1fr));
  align-items: stretch;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.word-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-content: center;
  gap: 4px 10px;
  min-height: 80px;
  height: 100%;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--color-surface);
  color: var(--ink);
}
.word-card:hover { border-color: var(--accent); }
.word-card strong { font-size: 17px; overflow-wrap: anywhere; }
.word-card span { grid-row: 2; color: var(--ink-soft); font-size: 13px; overflow-wrap: anywhere; }
.word-card .app-icon { grid-column: 2; grid-row: 1 / span 2; align-self: center; width: 16px; color: var(--accent-deep); }
.usage-details { margin-top: 20px; color: var(--ink-soft); font-size: 12px; }
.usage-details summary { width: fit-content; cursor: pointer; padding: 8px 0; }
@media (max-width: 540px) {
  .hero { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'copy' 'visual' 'actions'; }
  .hero-visual { justify-self: start; }
  .word-tiles { padding: 4px 6px 11px; }
  .word-tiles span { min-height: 46px; font-size: 24px; }
  .progress-ring { width: 82px; }
  .metric { min-width: 75px; padding: 10px 12px; }
}
</style>
