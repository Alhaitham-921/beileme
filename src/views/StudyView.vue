<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useAiStore } from '../stores/ai'

const app = useAppStore()
const ai = useAiStore()
const router = useRouter()

const booting = ref(true)
const bootError = ref('')
const selectedIndex = ref(null)
const cardShownAt = ref(Date.now())

const item = computed(() => app.currentItem)
const word = computed(() => item.value?.word)
const options = computed(() => item.value?.options || [])
const answer = computed(() => app.lastAnswer)

/** 页面状态机：把「该显示什么」收敛到一个字段，模板里只做分支渲染 */
const status = computed(() => {
  if (booting.value) return 'loading'
  if (bootError.value) return 'error'
  if (app.sessionSummary) return 'finished'
  if (!app.items.length) return 'empty'
  if (answer.value) return 'answered'
  return 'question'
})

/**
 * 服务端不把正确答案下发给客户端，只在作答后回传 correctText。
 * 因此这里靠文本反查正确选项的下标，用于渲染对错样式。
 */
const correctIndex = computed(() => {
  if (!answer.value) return -1
  return options.value.findIndex((option) => option.text === answer.value.correctText)
})

function optionClass(index) {
  if (status.value !== 'answered') return ''
  if (index === correctIndex.value) return 'correct'
  if (index === selectedIndex.value) return 'wrong'
  return 'dim'
}

function freqLabel(freq) {
  return { high: '高频', med: '中频', low: '低频' }[freq] || ''
}

async function boot() {
  booting.value = true
  bootError.value = ''

  try {
    // 刷新页面后优先恢复进行中的会话，没有才新开一轮
    if (!app.items.length || !app.session) {
      const restored = await app.restoreSession()
      if (!restored) await app.startSession('daily')
    }
    cardShownAt.value = Date.now()
  } catch (error) {
    bootError.value = error.message
  } finally {
    booting.value = false
  }
}

onMounted(boot)

// 每翻到新题都重置计时起点，犹豫时长才有意义
watch(
  () => app.currentIndex,
  () => {
    selectedIndex.value = null
    cardShownAt.value = Date.now()
  }
)

async function choose(index) {
  if (status.value !== 'question' || app.loading.answering) return

  // 先记录「展示到首次交互」的间隔，再发请求，避免把网络耗时算进犹豫时长
  const hesitationMs = Date.now() - cardShownAt.value
  selectedIndex.value = index

  try {
    await app.submitAnswer({ wordId: item.value.wordId, optionIndex: index, hesitationMs })
  } catch (error) {
    if (error.status === 409) {
      // 这一题服务端已记过（例如刷新前答过），直接跳到下一题
      advance()
      return
    }
    bootError.value = error.message
  }
}

async function advance() {
  if (app.isLastItem) {
    try {
      await app.finishSession()
    } catch (error) {
      bootError.value = error.message
    }
    return
  }
  app.nextQuestion()
  cardShownAt.value = Date.now()
}

async function startExtra() {
  app.clearSession()
  booting.value = true
  bootError.value = ''
  try {
    await app.startSession('extra')
    cardShownAt.value = Date.now()
  } catch (error) {
    bootError.value = error.message
  } finally {
    booting.value = false
  }
}

function speak() {
  if (!('speechSynthesis' in window) || !word.value) return
  const utterance = new SpeechSynthesisUtterance(word.value.spelling)
  utterance.lang = 'en-US'
  utterance.rate = 0.9
  speechSynthesis.cancel()
  speechSynthesis.speak(utterance)
}

/** 本组答错的词，用于生成错词卡片 */
const wrongWordIds = computed(() =>
  app.items.filter((entry) => entry.correct === false).map((entry) => entry.wordId)
)

/** 本组所有词，用于生成巩固短文 */
const sessionWordIds = computed(() => app.items.map((entry) => entry.wordId))

const generating = ref(false)
const generateError = ref('')

/** 生成巩固短文：只做跳转，真正的生成由用户在下一页点击触发（避免意外花钱） */
function goToArticle() {
  router.push({ name: 'article', query: { words: sessionWordIds.value.join(',') } })
}

/** 批量生成错词卡片：一次请求覆盖本组所有错词 */
async function makeErrorCards() {
  if (generating.value || !wrongWordIds.value.length) return
  generating.value = true
  generateError.value = ''
  try {
    await ai.generateErrorCards({ wordIds: wrongWordIds.value.slice(0, 6) })
  } catch (error) {
    generateError.value = error.message
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="study">
    <!-- 加载中 -->
    <div v-if="status === 'loading'" class="card result-card">
      <p class="muted">正在准备今天的单词…</p>
    </div>

    <!-- 出错 -->
    <div v-else-if="status === 'error'" class="card result-card">
      <h1 class="result-title">出了点问题</h1>
      <p class="result-sub">{{ bootError }}</p>
      <div class="result-actions">
        <button class="btn btn-ghost" @click="boot">重试</button>
        <button class="btn btn-primary" @click="router.push('/')">返回首页</button>
      </div>
    </div>

    <!-- 答题中 / 已作答 -->
    <template v-else-if="status === 'question' || status === 'answered'">
      <div class="study-head">
        <span class="badge" :class="item.kind">{{ item.kind === 'new' ? '新词' : '复习' }}</span>
        <span class="progress-text mono-num">
          {{ app.answeredCount }} / {{ app.totalItems }}
        </span>
      </div>

      <div class="progress head-progress">
        <span :style="{ width: (app.answeredCount / app.totalItems) * 100 + '%' }"></span>
      </div>

      <div class="card word-card">
        <div class="word-row">
          <h1 class="word-spell">{{ word.spelling }}</h1>
          <button class="speak-btn" title="朗读" @click="speak">🔊</button>
        </div>
        <p class="word-meta">
          <!-- 部分开源词表（初高中）没有音标，缺什么就不显示什么，避免留下空白占位 -->
          <span v-if="word.phonetic">{{ word.phonetic }}</span>
          <span v-if="word.phonetic && word.pos" class="meta-sep">·</span>
          <span v-if="word.pos">{{ word.pos }}</span>
          <span v-if="word.freq" class="freq-tag" :class="word.freq">{{ freqLabel(word.freq) }}</span>
          <span v-if="word.difficulty" class="diff" :title="`难度 ${word.difficulty}/5`">
            {{ '★'.repeat(word.difficulty) }}{{ '☆'.repeat(5 - word.difficulty) }}
          </span>
        </p>

        <p class="q-prompt">选择正确的中文释义</p>

        <div class="option-grid">
          <button
            v-for="option in options"
            :key="option.index"
            class="option choice"
            :class="optionClass(option.index)"
            :disabled="status === 'answered'"
            @click="choose(option.index)"
          >
            <span class="opt-key">{{ String.fromCharCode(65 + option.index) }}</span>
            <span class="opt-text">
              <!-- 完整释义，第一条（词表里的主释义）加粗 -->
              <b v-if="option.primary">{{ option.primary }}</b>
              <template v-if="option.primary && option.text.startsWith(option.primary)">
                {{ option.text.slice(option.primary.length) }}
              </template>
              <template v-else>{{ option.text }}</template>
            </span>
          </button>
        </div>

        <transition name="fade">
          <div v-if="status === 'answered'" class="feedback">
            <p class="fb-line" :class="answer.isCorrect ? 'ok' : 'bad'">
              {{ answer.isCorrect ? '✓ 回答正确' : '✗ 再记一下这个' }}
            </p>

            <!-- 错因分析结果（PRD 4.2.3） -->
            <div v-if="answer.analysis.type" class="analysis">
              <span class="analysis-tag">{{ answer.analysis.label }}</span>
              <span class="analysis-action">{{ answer.analysis.action }}</span>
            </div>
            <p v-else-if="answer.analysis.confidence === 'low'" class="analysis-note">
              答对了，但想了一会儿 —— 已标记为「半熟」，复习间隔会自动缩短。
            </p>

            <p v-if="word.example" class="example">
              <span class="ex-label">例句</span>{{ word.example }}
            </p>
            <p class="def-line">释义：{{ word.definitions.join('；') }}</p>

            <!-- 易混词对比记忆卡片 -->
            <div v-if="answer.confusableCard" class="contrast-card">
              <p class="contrast-title">对比记忆</p>
              <div
                v-for="contrast in answer.confusableCard.contrasts"
                :key="contrast.wordId"
                class="contrast-row"
              >
                <div class="contrast-words">
                  <span class="cw">
                    {{ contrast.diff.prefix
                    }}<b class="hl">{{ contrast.diff.aMiddle }}</b>{{ contrast.diff.suffix }}
                  </span>
                  <span class="cw-vs">vs</span>
                  <span class="cw">
                    {{ contrast.diff.prefix
                    }}<b class="hl">{{ contrast.diff.bMiddle }}</b>{{ contrast.diff.suffix }}
                  </span>
                  <span class="cw-tag">{{ contrast.relationType === 'form' ? '形近' : '近义' }}</span>
                </div>
                <p class="contrast-meaning">
                  {{ contrast.meaningContrast.current }}　vs　{{ contrast.meaningContrast.related }}
                </p>
              </div>
            </div>

            <!-- 记忆进度反馈 -->
            <p class="next-review">
              下次复习：{{ answer.progress.intervalDays }} 天后　·　记忆强度
              {{ Math.round(answer.progress.memoryStrength) }}
            </p>
          </div>
        </transition>
      </div>

      <div class="study-foot">
        <button
          v-if="status === 'answered'"
          class="btn btn-primary btn-lg btn-full"
          @click="advance"
        >
          {{ app.isLastItem ? '查看结果' : '下一个' }}
        </button>
      </div>
    </template>

    <!-- 本轮完成 -->
    <div v-else-if="status === 'finished'" class="card result-card">
      <h1 class="result-title">本组完成 🎉</h1>
      <p class="result-sub">
        共 {{ app.sessionSummary.answeredCount }} 个单词
        <template v-if="app.sessionSummary.avgHesitationMs">
          　·　平均反应 {{ (app.sessionSummary.avgHesitationMs / 1000).toFixed(1) }} 秒
        </template>
      </p>
      <div class="result-stats">
        <div class="rs ok">
          <span class="rs-num">{{ app.sessionSummary.correctCount }}</span>
          <span class="rs-label">答对</span>
        </div>
        <div class="rs bad">
          <span class="rs-num">{{ app.sessionSummary.wrongCount }}</span>
          <span class="rs-label">答错</span>
        </div>
        <div class="rs">
          <span class="rs-num">{{ app.sessionSummary.accuracy }}%</span>
          <span class="rs-label">正确率</span>
        </div>
      </div>

      <div v-if="app.newBadges.length" class="badge-toast">
        <span v-for="badge in app.newBadges" :key="badge.code" class="badge-item">
          {{ badge.icon }} 解锁徽章「{{ badge.name }}」
        </span>
      </div>

      <!-- AI 巩固内容：只有点击才会调用模型，不自动生成 -->
      <div class="ai-block">
        <p class="ai-title">要不要巩固一下？</p>
        <div class="ai-actions">
          <button class="btn btn-ghost" @click="goToArticle">
            📖 生成巩固短文
          </button>
          <button
            v-if="wrongWordIds.length"
            class="btn btn-ghost"
            :disabled="generating"
            @click="makeErrorCards"
          >
            {{ generating ? '生成中…' : `🃏 错词对比卡片（${wrongWordIds.length} 个）` }}
          </button>
        </div>
        <p class="ai-hint">
          生成前会先显示预估用量；错词卡片支持一次生成多个，比分次调用省得多。
        </p>
        <p v-if="generateError" class="ai-error">{{ generateError }}</p>

        <!-- 降级提示：如实告知这是本地算法结果而不是 AI 生成 -->
        <p v-if="ai.cardsSource === 'template' && ai.cardsMessage" class="ai-notice">
          {{ ai.cardsMessage }}
        </p>

        <!-- 本次消耗：把 token 与估算成本直接摆出来 -->
        <p v-if="ai.lastUsage" class="usage-line">
          本次消耗：{{ ai.lastUsage.promptTokens }} 输入 + {{ ai.lastUsage.completionTokens }} 输出
          = {{ ai.lastUsage.totalTokens }} token，约 {{ ai.lastUsage.estimatedCostText }}
          <span v-if="ai.lastUsage.source === 'user'" class="usage-note">（你自己的 Key）</span>
          <span v-else-if="ai.lastUsage.source === 'server'" class="usage-note">（官方额度）</span>
        </p>

        <div v-if="ai.cards.length" class="card-list">
          <div v-for="card in ai.cards" :key="card.spelling" class="mini-card">
            <div class="mc-head">
              <span class="mc-word">{{ card.spelling }}</span>
              <span class="mc-headline">{{ card.headline }}</span>
            </div>
            <div v-for="d in card.distinctions || []" :key="d.spelling" class="mc-row">
              <span class="mc-spell">{{ d.spelling }}</span>
              <span class="mc-mean">{{ d.coreMeaning }}</span>
            </div>
            <p v-if="card.mnemonic" class="mc-mnemonic">💡 {{ card.mnemonic }}</p>
            <p v-if="card.formTip" class="mc-tip">{{ card.formTip }}</p>
          </div>
        </div>
      </div>

      <div class="result-actions">
        <button class="btn btn-ghost" @click="startExtra">再学一组</button>
        <button class="btn btn-primary" @click="router.push('/')">返回首页</button>
      </div>
    </div>

    <!-- 今天没有要学的 -->
    <div v-else class="card result-card">
      <h1 class="result-title">今天已完成 ☕</h1>
      <p class="result-sub">新词与待复习都学完了，休息一下，或者再巩固一组。</p>
      <div class="result-actions">
        <button class="btn btn-ghost" @click="startExtra">再学一组</button>
        <button class="btn btn-primary" @click="router.push('/')">返回首页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.study-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.head-progress {
  margin-bottom: 16px;
}

.badge {
  font-size: 13px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 999px;
}

.badge.new {
  background: var(--accent-soft);
  color: var(--accent-deep);
}

.badge.review {
  background: #e8e6f0;
  color: #6a6485;
}

.progress-text {
  color: var(--ink-soft);
  font-size: 14px;
}

.word-card {
  padding: 34px 28px;
}

.word-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.word-spell {
  font-family: var(--serif);
  font-size: 40px;
  margin: 0;
  letter-spacing: 0.5px;
}

.speak-btn {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  font-size: 18px;
  transition: transform 0.08s;
}

.speak-btn:hover {
  border-color: var(--accent);
}

.speak-btn:active {
  transform: scale(0.92);
}

.word-meta {
  color: var(--ink-soft);
  margin: 6px 0 22px;
  font-size: 15px;
}

.meta-sep {
  margin: 0 6px;
}

.freq-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
  margin-left: 10px;
  vertical-align: middle;
}

.freq-tag.high {
  background: var(--bad-soft);
  color: var(--bad);
}

.freq-tag.med {
  background: var(--accent-soft);
  color: var(--accent-deep);
}

.freq-tag.low {
  background: #e8e6f0;
  color: #6a6485;
}

.diff {
  margin-left: 10px;
  color: #e0a800;
  font-size: 13px;
  letter-spacing: 1px;
  vertical-align: middle;
}

.q-prompt {
  font-size: 14px;
  color: var(--ink-soft);
  margin: 0 0 12px;
}

.choice {
  cursor: pointer;
}

.choice:disabled {
  cursor: default;
}

.choice.correct {
  border-color: var(--ok);
  background: var(--ok-soft);
  color: var(--ok);
}

.choice.wrong {
  border-color: var(--bad);
  background: var(--bad-soft);
  color: var(--bad);
}

.choice.dim {
  opacity: 0.55;
}

.opt-text {
  line-height: 1.6;
}

.opt-text b {
  color: var(--accent-deep);
}

.choice.correct .opt-text b,
.choice.wrong .opt-text b {
  color: inherit;
}

.feedback {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px dashed var(--line);
}

.fb-line {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px;
}

.fb-line.ok {
  color: var(--ok);
}

.fb-line.bad {
  color: var(--bad);
}

.analysis {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.analysis-tag {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent-deep);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 3px 12px;
}

.analysis-action {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.analysis-note {
  font-size: 13px;
  color: var(--ink-soft);
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 9px 13px;
  margin: 0 0 14px;
}

.example {
  font-family: var(--serif);
  font-size: 16px;
  color: var(--ink);
  margin: 0 0 8px;
  line-height: 1.5;
}

.ex-label {
  display: inline-block;
  font-family: var(--sans);
  font-size: 12px;
  color: var(--accent-deep);
  background: var(--accent-soft);
  border-radius: 6px;
  padding: 1px 8px;
  margin-right: 8px;
}

.def-line {
  color: var(--ink-soft);
  font-size: 14px;
  margin: 0;
}

/* 对比记忆卡片 */
.contrast-card {
  margin-top: 16px;
  padding: 16px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.contrast-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
}

.contrast-row + .contrast-row {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--line);
}

.contrast-words {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.cw {
  font-family: var(--serif);
  font-size: 19px;
  letter-spacing: 0.4px;
}

/* 词形差异高亮：只强调不同的字母 */
.hl {
  color: var(--accent-deep);
  background: var(--accent-soft);
  border-radius: 4px;
  padding: 0 3px;
}

.cw-vs {
  font-size: 12px;
  color: var(--ink-soft);
}

.cw-tag {
  font-size: 11px;
  font-weight: 600;
  color: #6a6485;
  background: #e8e6f0;
  border-radius: 999px;
  padding: 1px 8px;
}

.contrast-meaning {
  margin: 6px 0 0;
  font-size: 13.5px;
  color: var(--ink-soft);
}

.next-review {
  margin: 16px 0 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.study-foot {
  margin-top: 20px;
}

.btn-full {
  width: 100%;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.result-card {
  text-align: center;
  padding: 44px 28px;
}

.result-title {
  font-family: var(--serif);
  font-size: 28px;
  margin: 0 0 6px;
}

.result-sub {
  color: var(--ink-soft);
  margin: 0 0 28px;
}

.result-stats {
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-bottom: 28px;
}

.rs {
  display: flex;
  flex-direction: column;
}

.rs-num {
  font-family: var(--serif);
  font-size: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.rs.ok .rs-num {
  color: var(--ok);
}

.rs.bad .rs-num {
  color: var(--bad);
}

.rs-label {
  font-size: 13px;
  color: var(--ink-soft);
}

.badge-toast {
  display: grid;
  gap: 8px;
  margin-bottom: 24px;
}

.badge-item {
  font-size: 14px;
  color: var(--accent-deep);
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
}

.result-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

/* AI 巩固内容 */
.ai-block {
  text-align: left;
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 18px;
  margin-bottom: 24px;
}

.ai-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
}

.ai-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.ai-actions .btn {
  padding: 10px 18px;
  font-size: 14px;
}

.ai-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}

.ai-error {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--bad);
}

.ai-notice {
  margin: 12px 0 0;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--accent-deep);
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
}

.usage-line {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--ink-soft);
  line-height: 1.7;
}

.usage-note {
  opacity: 0.8;
}

.card-list {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.mini-card {
  background: var(--bg-card);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 14px;
}

.mc-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.mc-word {
  font-family: var(--serif);
  font-size: 17px;
  font-weight: 600;
}

.mc-headline {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.mc-row {
  display: flex;
  gap: 10px;
  font-size: 13px;
  padding: 3px 0;
}

.mc-spell {
  font-family: var(--serif);
  font-weight: 600;
  min-width: 86px;
}

.mc-mean {
  color: var(--ink-soft);
}

.mc-mnemonic {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--accent-deep);
}

.mc-tip {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}
</style>
