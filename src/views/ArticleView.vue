<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAiStore } from '../stores/ai'
import { useAppStore } from '../stores/app'

const ai = useAiStore()
const app = useAppStore()
const route = useRoute()
const router = useRouter()

/** 从 URL 取目标词（由背词结果页带入），没有则用最近学过的词 */
const wordIds = computed(() => {
  const raw = String(route.query.words || '')
  return raw
    .split(',')
    .map((item) => Number.parseInt(item, 10))
    .filter((id) => Number.isFinite(id) && id > 0)
})

/** ?id=123 表示打开一篇历史短文（短文回顾里点进来） */
const historyId = computed(() => {
  const parsed = Number.parseInt(String(route.query.id || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
})

const generating = ref(false)
const errorText = ref('')
/** 「加大额度重新生成」的价格预览（倍数 → 预估） */
const boostPreflight = ref(null)
const boostFactor = ref(2)

/** 把失败原因翻译成人话，显示在「本次消耗」旁边 */
function retryReasonLabel(reason) {
  const labels = {
    reasoning_exhausted: '模型把额度用于内部思考',
    truncated: '输出被截断',
    invalid_json: '返回的不是合法 JSON',
  }
  return labels[reason] || '额度不足'
}

/** 预估「加大 N 倍额度」的代价，让用户在点之前就知道要花多少 */
async function loadBoostPreflight(factor) {
  boostFactor.value = factor
  boostPreflight.value = await ai.loadPreflight({
    type: 'article',
    wordIds: wordIds.value,
    wordCount: 10,
    boost: factor,
  })
}

/** 重新生成并加大额度 */
async function regenerateWithBoost(factor) {
  if (generating.value) return
  generating.value = true
  errorText.value = ''
  try {
    await ai.generateArticle({ wordIds: wordIds.value, wordCount: 10, forceNew: true, boost: factor })
  } catch (error) {
    errorText.value = error.message
  } finally {
    generating.value = false
  }
}

const sourceLabel = computed(() => {
  if (ai.articleSource === 'history') return '历史短文'
  if (ai.articleSource === 'ai') return 'AI 生成'
  if (ai.articleSource === 'cache') return '来自缓存'
  return '本地内容'
})

onMounted(async () => {
  // 打开历史短文：直接取回正文，不产生任何费用
  if (historyId.value) {
    generating.value = true
    try {
      await ai.loadContent(historyId.value)
    } catch (error) {
      errorText.value = error.message
    } finally {
      generating.value = false
    }
    return
  }

  // 只做预估（本地计算，不花钱），真正的生成必须由用户点击
  await ai.loadPreflight({ type: 'article', wordIds: wordIds.value, wordCount: 10 })
  // 顺带把「加大额度」的价格也算好，用户随时能对比
  await loadBoostPreflight(2)
})

async function generate(forceNew = false) {
  if (generating.value) return
  generating.value = true
  errorText.value = ''
  try {
    await ai.generateArticle({ wordIds: wordIds.value, wordCount: 10, forceNew })
  } catch (error) {
    errorText.value = error.message
  } finally {
    generating.value = false
  }
}

async function makeQuiz() {
  generating.value = true
  errorText.value = ''
  try {
    await ai.generateQuiz({ count: 3 })
  } catch (error) {
    errorText.value = error.message
  } finally {
    generating.value = false
  }
}

function pickOption(questionIndex, optionIndex) {
  if (ai.quizAnswers[questionIndex] != null) return
  ai.answerQuiz(questionIndex, optionIndex)
}

function optionClass(questionIndex, optionIndex) {
  const chosen = ai.quizAnswers[questionIndex]
  if (chosen == null) return ''
  const question = ai.quizQuestions[questionIndex]
  if (optionIndex === question.answerIndex) return 'correct'
  if (optionIndex === chosen) return 'wrong'
  return 'dim'
}

const quizStats = computed(() => {
  const questions = ai.quizQuestions
  const answered = Object.keys(ai.quizAnswers).length
  const correct = questions.filter((question, index) => ai.quizAnswers[index] === question.answerIndex).length
  return { answered, correct, total: questions.length }
})
</script>

<template>
  <div class="article-page">
    <div class="page-head">
      <button class="back-link" @click="router.push('/')">← 返回首页</button>
      <h1 class="section-title">AI 巩固内容</h1>
    </div>

    <!-- 生成前：显示预估，明确告知会不会花钱 -->
    <div v-if="!ai.article" class="card block">
      <p class="lead">
        用本组单词生成一篇含目标词的短文，再配几道阅读理解题。
      </p>

      <div v-if="ai.preflight" class="preflight">
        <div class="pf-row">
          <span class="pf-key">目标词</span>
          <span class="pf-val">{{ ai.preflight.wordCount }} 个</span>
        </div>
        <div class="pf-row">
          <span class="pf-key">预计输入</span>
          <span class="pf-val">约 {{ ai.preflight.estimatedInputTokens }} token（本地估算）</span>
        </div>
        <div class="pf-row">
          <span class="pf-key">输出上限</span>
          <span class="pf-val">{{ ai.preflight.maxOutputTokens }} token</span>
        </div>
        <div class="pf-row">
          <span class="pf-key">最坏成本</span>
          <span class="pf-val">{{ ai.preflight.worstCaseCostText }}</span>
        </div>
        <div class="pf-row">
          <span class="pf-key">调用次数</span>
          <span class="pf-val">{{ ai.preflight.callCount }} 次</span>
        </div>
      </div>

      <p v-if="ai.preflight?.zeroCost" class="zero-hint">
        {{ ai.preflight.note }}
      </p>
      <p v-else-if="ai.preflight" class="cost-hint">{{ ai.preflight.note }}</p>

      <p v-if="errorText" class="msg error">{{ errorText }}</p>

      <button class="btn btn-primary btn-lg btn-full" :disabled="generating" @click="generate(false)">
        {{ generating ? '生成中…' : ai.mode === 'none' ? '生成复习清单（免费）' : '生成巩固短文' }}
      </button>
      <p class="foot-hint">
        只有点击才会调用模型；生成前会先显示预估用量。
        <router-link to="/settings" class="inline-link">去设置里接入自己的 API Key</router-link>
      </p>
    </div>

    <template v-else>
      <!-- 降级提示：如实告知这是本地内容 -->
      <div v-if="ai.articleSource === 'template'" class="card block notice">
        <p class="notice-title">{{ sourceLabel }}</p>
        <p class="notice-text">{{ ai.articleMessage }}</p>
      </div>

      <!-- 短文（AI 生成） -->
      <div v-if="ai.articleSource !== 'template'" class="card block">
        <div class="article-head">
          <h2 class="article-title">{{ ai.article.title }}</h2>
          <span class="source-tag">{{ sourceLabel }}</span>
        </div>

        <p class="article-body">
          <template v-for="(segment, index) in ai.articleSegments" :key="index">
            <mark v-if="segment.highlight" class="target-word">{{ segment.text }}</mark>
            <template v-else>{{ segment.text }}</template>
          </template>
        </p>

        <div v-if="ai.article.meta?.glossary?.length" class="glossary">
          <p class="glossary-title">生词表</p>
          <div class="glossary-grid">
            <div v-for="item in ai.article.meta.glossary" :key="item.spelling" class="glossary-item">
              <span class="gw">{{ item.spelling }}</span>
              <span class="gd">{{ item.definition }}</span>
            </div>
          </div>
        </div>

        <div class="article-actions">
          <button class="btn btn-ghost" :disabled="generating" @click="generate(true)">
            {{ historyId ? '生成新的一篇' : '换一篇（同一额度）' }}
          </button>
          <button class="btn btn-primary" :disabled="generating || Boolean(ai.quiz)" @click="makeQuiz">
            {{ ai.quiz ? '题目已生成' : generating ? '生成中…' : '生成阅读理解题' }}
          </button>
        </div>

        <!-- 重新生成并加大额度：把价格摆出来让用户自己决定 -->
        <div class="regenerate">
          <div class="regen-head">
            <span class="regen-title">生成得不理想？</span>
            <span class="regen-price" v-if="boostPreflight">
              加大 {{ boostFactor }} 倍额度重新生成，最坏约
              <strong>{{ boostPreflight.worstCaseCostText }}</strong>
            </span>
          </div>
          <div class="regen-actions">
            <button
              class="btn btn-ghost"
              :disabled="generating"
              @click="regenerateWithBoost(2)"
            >
              重新生成（额度 ×2）
            </button>
            <button
              class="btn btn-ghost"
              :disabled="generating"
              @click="regenerateWithBoost(3)"
            >
              重新生成（额度 ×3）
            </button>
          </div>
          <p class="regen-hint">
            额度是「上限」不是「预留」：模型写完就停，用不到不收费。加码主要解决
            <strong>推理模型把额度花在思考上</strong>导致的截断或空内容。
          </p>
        </div>

        <!-- 本次消耗：token 与估算成本 -->
        <p v-if="ai.lastUsage" class="usage-line">
          本次消耗：{{ ai.lastUsage.promptTokens }} 输入 + {{ ai.lastUsage.completionTokens }} 输出
          = {{ ai.lastUsage.totalTokens }} token，约 {{ ai.lastUsage.estimatedCostText }}
          <span v-if="ai.lastUsage.retried" class="usage-retry">
            （首次失败：{{ retryReasonLabel(ai.lastUsage.retryReason) }}，已自动把额度从
            {{ ai.lastUsage.firstAttemptBudget }} 加宽到 {{ ai.lastUsage.retryBudget }} 重试）
          </span>
        </p>
        <p v-else-if="ai.articleSource === 'history' || ai.articleSource === 'cache'" class="usage-line">
          本次没有调用模型，<strong>未产生任何费用</strong>。
        </p>
      </div>

      <!-- 本地复习清单（降级内容） -->
      <div v-else class="card block">
        <h2 class="article-title">{{ ai.article.title }}</h2>
        <p class="article-body">{{ ai.article.body }}</p>

        <div class="sheet">
          <div v-for="item in ai.article.meta?.items || []" :key="item.wordId" class="sheet-item">
            <div class="sheet-head">
              <span class="sw">{{ item.spelling }}</span>
              <span class="sp">{{ item.phonetic }}</span>
              <span class="spos">{{ item.pos }}</span>
            </div>
            <p class="sdef">{{ item.definitions.join('；') }}</p>
            <p v-if="item.example" class="sex">{{ item.example }}</p>
            <div v-if="item.confusables?.length" class="sconf">
              <span class="sconf-label">易混</span>
              <span v-for="conf in item.confusables" :key="conf.spelling" class="sconf-item">
                {{ conf.spelling }}（{{ conf.definitions[0] }}）
              </span>
            </div>
            <p class="shint">{{ item.hint }}</p>
          </div>
        </div>

        <div class="article-actions">
          <router-link to="/settings" class="btn btn-ghost">配置 API Key</router-link>
        </div>
      </div>

      <!-- 理解题 -->
      <div v-if="ai.quiz" class="card block">
        <div class="quiz-head">
          <h2 class="block-title">阅读理解</h2>
          <span class="quiz-score mono-num">
            {{ quizStats.correct }} / {{ quizStats.total }}
          </span>
        </div>
        <p class="block-sub">选一项，立刻看到解析</p>

        <div v-for="(question, qi) in ai.quizQuestions" :key="qi" class="question">
          <p class="stem">
            <span class="q-index">{{ qi + 1 }}</span>
            {{ question.stem }}
            <span class="q-type">{{ question.type }}</span>
          </p>

          <div class="option-grid">
            <button
              v-for="(option, oi) in question.options"
              :key="oi"
              class="option q-option"
              :class="optionClass(qi, oi)"
              :disabled="ai.quizAnswers[qi] != null"
              @click="pickOption(qi, oi)"
            >
              <span class="opt-key">{{ String.fromCharCode(65 + oi) }}</span>
              <span>{{ option }}</span>
            </button>
          </div>

          <div v-if="ai.quizAnswers[qi] != null" class="explanation">
            <span class="ex-tag" :class="ai.quizAnswers[qi] === question.answerIndex ? 'ok' : 'bad'">
              {{ ai.quizAnswers[qi] === question.answerIndex ? '✓ 答对' : '✗ 答错' }}
            </span>
            <span class="ex-text">{{ question.explanation }}</span>
          </div>
        </div>
      </div>

      <!-- 没有 AI 时的自测建议 -->
      <div v-else-if="ai.quizSuggestions?.length" class="card block">
        <h2 class="block-title">没有 AI 时的自测方式</h2>
        <p class="block-sub">{{ ai.quizMessage }}</p>
        <div class="sheet">
          <div v-for="item in ai.quizSuggestions" :key="item.wordId" class="sheet-item">
            <p class="sdef">{{ item.question }}</p>
            <p class="shint">参考答案：{{ item.answer }}</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: 16px;
}

.back-link {
  border: none;
  background: none;
  padding: 0 0 8px;
  font-size: 13px;
  color: var(--ink-soft);
}

.back-link:hover {
  color: var(--ink);
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

.lead {
  font-size: 15px;
  margin: 0 0 18px;
  line-height: 1.7;
}

/* 预估面板 */
.preflight {
  display: grid;
  gap: 8px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  margin-bottom: 14px;
}

.pf-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.pf-key {
  color: var(--ink-soft);
}

.pf-val {
  font-variant-numeric: tabular-nums;
}

.zero-hint {
  margin: 0 0 16px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--ok);
  background: var(--ok-soft);
  border-radius: var(--radius-sm);
}

.cost-hint {
  margin: 0 0 16px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--accent-deep);
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
}

.btn-full {
  width: 100%;
}

.foot-hint {
  margin: 14px 0 0;
  font-size: 12px;
  color: var(--ink-soft);
  text-align: center;
  line-height: 1.7;
}

.inline-link {
  color: var(--accent-deep);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.msg.error {
  margin: 0 0 14px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--bad);
  background: var(--bad-soft);
  border-radius: var(--radius-sm);
}

/* 短文 */
.article-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.article-title {
  font-family: var(--serif);
  font-size: 22px;
  margin: 0;
}

.source-tag {
  font-size: 11.5px;
  color: var(--accent-deep);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 2px 10px;
}

.article-body {
  font-family: var(--serif);
  font-size: 17px;
  line-height: 1.9;
  margin: 0 0 20px;
  white-space: pre-wrap;
}

.target-word {
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 600;
  border-radius: 4px;
  padding: 0 3px;
}

.glossary {
  border-top: 1px dashed var(--line);
  padding-top: 16px;
  margin-bottom: 20px;
}

.glossary-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
  margin: 0 0 10px;
}

.glossary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.glossary-item {
  display: flex;
  gap: 8px;
  font-size: 13px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}

.gw {
  font-family: var(--serif);
  font-weight: 600;
}

.gd {
  color: var(--ink-soft);
}

.article-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

/* 降级提示 */
.notice {
  border-color: var(--accent-soft);
}

.notice-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--accent-deep);
}

.notice-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--ink);
}

/* 复习清单 */
.sheet {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
}

.sheet-item {
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
}

.sheet-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.sw {
  font-family: var(--serif);
  font-size: 18px;
  font-weight: 600;
}

.sp,
.spos {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.sdef {
  margin: 6px 0 0;
  font-size: 14px;
}

.sex {
  margin: 6px 0 0;
  font-family: var(--serif);
  font-size: 14px;
  color: var(--ink-soft);
}

.sconf {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 12.5px;
}

.sconf-label {
  color: var(--ink-soft);
}

.sconf-item {
  color: #6a6485;
  background: #e8e6f0;
  border-radius: 999px;
  padding: 1px 10px;
}

.shint {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--accent-deep);
}

/* 理解题 */
.quiz-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.quiz-score {
  font-family: var(--serif);
  font-size: 18px;
  font-weight: 600;
  color: var(--accent-deep);
}

.question + .question {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px dashed var(--line);
}

.stem {
  font-size: 15px;
  line-height: 1.7;
  margin: 0 0 12px;
}

.q-index {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 700;
  margin-right: 8px;
}

.q-type {
  font-size: 11px;
  color: var(--ink-soft);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 1px 8px;
  margin-left: 6px;
}

.q-option {
  cursor: pointer;
}

.q-option:disabled {
  cursor: default;
}

.q-option.correct {
  border-color: var(--ok);
  background: var(--ok-soft);
  color: var(--ok);
}

.q-option.wrong {
  border-color: var(--bad);
  background: var(--bad-soft);
  color: var(--bad);
}

.q-option.dim {
  opacity: 0.55;
}

.explanation {
  margin-top: 12px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13.5px;
  line-height: 1.7;
}

.usage-line {
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
  font-size: 12.5px;
  color: var(--ink-soft);
  line-height: 1.7;
}

.usage-retry {
  color: var(--accent-deep);
}

/* 重新生成并加大额度 */
.regenerate {
  margin-top: 18px;
  padding: 14px 16px;
  background: var(--bg);
  border-radius: var(--radius-sm);
}

.regen-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.regen-title {
  font-size: 13.5px;
  font-weight: 600;
}

.regen-price {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.regen-price strong {
  color: var(--accent-deep);
}

.regen-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.regen-actions .btn {
  padding: 9px 16px;
  font-size: 13px;
}

.regen-hint {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-soft);
}

.ex-tag {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  padding: 2px 10px;
}

.ex-tag.ok {
  color: var(--ok);
  background: var(--ok-soft);
}

.ex-tag.bad {
  color: var(--bad);
  background: var(--bad-soft);
}

.ex-text {
  color: var(--ink);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
