<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { studyKey } from '../utils/studyKeyboard'
import { studySwipeDirection } from '../utils/studySwipe.js'
import FavoriteWord from '../components/FavoriteWord.vue'
import MorphologyCard from '../components/MorphologyCard.vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useAiStore } from '../stores/ai'
import { nativeSpeech } from '../utils/speechSynthesis.js'

const app = useAppStore()
const ai = useAiStore()
const router = useRouter()

const booting = ref(true)
const bootError = ref('')
const selectedIndex = ref(null)
const cardShownAt = ref(Date.now())
const advancing = ref(false)
const speechError = ref('')
const navigationNotice = ref('')
const wordCard = ref(null)
let swipe = null
let speechGeneration = 0
let continueRequested = false

const item = computed(() => app.currentItem)
const word = computed(() => item.value?.word)
const options = computed(() => item.value?.options || [])
const answer = computed(() => app.lastAnswer)
const nextLabel = computed(() => app.isLastItem ? (app.allAnswered ? '查看结果' : '继续未答单词') : '下一个单词')

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
    selectedIndex.value = app.currentItem?.selectedOptionIndex ?? null
  } catch (error) {
    bootError.value = error.message
  } finally {
    booting.value = false
  }
}

function onKey(event) {
  const key = studyKey(event)
  if (key === null || advancing.value) return
  if (key === 'next' && (status.value === 'answered' || app.loading.answering)) {
    event.preventDefault()
    if (app.loading.answering) continueRequested = true
    else advance()
  } else if (typeof key === 'number' && status.value === 'question' && !app.loading.answering && options.value[key]) {
    event.preventDefault(); choose(options.value[key].index)
  }
}
onMounted(() => { boot(); window.addEventListener('keydown', onKey) })
onUnmounted(() => { window.removeEventListener('keydown', onKey); stopSpeaking() })

// 每翻到新题都重置计时起点，犹豫时长才有意义
watch(
  () => app.currentIndex,
  () => {
    selectedIndex.value = app.currentItem?.selectedOptionIndex ?? null
    cardShownAt.value = Date.now()
    speechError.value = ''
    stopSpeaking()
  }
)

async function choose(index) {
  if (status.value !== 'question' || app.loading.answering || item.value?.answered) return
  navigationNotice.value = ''

  // 先记录「展示到首次交互」的间隔，再发请求，避免把网络耗时算进犹豫时长
  const hesitationMs = Date.now() - cardShownAt.value
  selectedIndex.value = index

  try {
    await app.submitAnswer({ wordId: item.value.wordId, optionIndex: index, hesitationMs })
    if (continueRequested) { continueRequested = false; await advance() }
  } catch (error) {
    continueRequested = false
    if (error.status === 409) {
      // Another tab may have answered this word. Restore rather than resubmitting.
      const restored = await app.restoreSession(true)
      if (!restored) { bootError.value = '无法恢复最新答题状态，请重新进入单词学习。'; return }
      selectedIndex.value = app.currentItem?.selectedOptionIndex ?? null
      return
    }
    bootError.value = error.message
  }
}

async function advance() {
  if (advancing.value || app.loading.answering) return
  advancing.value = true
  navigationNotice.value = ''
  try {
    if (app.isLastItem) {
      if (app.allAnswered) {
        await app.finishSession()
        return
      }
      const remaining = app.firstUnansweredIndex
      if (remaining === app.currentIndex) {
        navigationNotice.value = '请先完成这个单词，再查看本组结果。'
        return
      }
      app.goToQuestion(remaining)
      navigationNotice.value = '已回到未作答的单词，滑过的词不会计入完成进度。'
    } else {
      app.nextQuestion()
    }
    await revealWord()
  } catch (error) { bootError.value = error.message }
  finally { advancing.value = false }
}

async function revealWord() {
  await nextTick()
  wordCard.value?.scrollIntoView({ block: 'start', behavior: 'instant' })
}

async function previous() {
  if (advancing.value || app.loading.answering) return
  navigationNotice.value = ''
  if (!app.previousQuestion()) {
    navigationNotice.value = '已经是本组第一个单词。'
    return
  }
  await revealWord()
}

function startSwipe(event) {
  swipe = null
  if (!['question', 'answered'].includes(status.value) || advancing.value || app.loading.answering || event.touches.length !== 1) return
  if (event.target?.closest?.('input, textarea, select, a, .favorite-word, .speak-btn, .next-btn')) return
  if (window.getSelection()?.isCollapsed === false) return
  const touch = event.touches[0]
  // Keep Android system back gestures available at the screen edges.
  if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return
  swipe = { id: touch.identifier, startX: touch.clientX, startY: touch.clientY, startedAt: Date.now(), vertical: false }
}

function moveSwipe(event) {
  if (!swipe) return
  if (event.touches.length !== 1) { swipe = null; return }
  const touch = event.touches[0]
  const dx = Math.abs(touch.clientX - swipe.startX), dy = Math.abs(touch.clientY - swipe.startY)
  if (dy > 12 && dy > dx * 1.2) swipe.vertical = true
}

function endSwipe(event) {
  const start = swipe
  swipe = null
  if (!start || advancing.value || app.loading.answering) return
  const touch = [...event.changedTouches].find(touch => touch.identifier === start.id)
  if (!touch) return
  const direction = studySwipeDirection({ ...start, endX: touch.clientX, endY: touch.clientY, elapsedMs: Date.now() - start.startedAt })
  if (!direction) return
  if (event.cancelable) event.preventDefault() // A swipe on an option must not also select it.
  if (direction === 'next') void advance()
  else void previous()
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
  if (!word.value) return
  stopSpeaking()
  speechError.value = ''
  if (nativeSpeech.isSupported()) {
    const token = speechGeneration
    void nativeSpeech.speak(word.value.spelling, 0.9).catch(error => {
      if (token === speechGeneration) speechError.value = error.message || '系统朗读失败，请检查手机的文字转语音设置。'
    })
    return
  }
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    speechError.value = '当前浏览器不支持朗读，请更换新版浏览器。'
    return
  }
  const utterance = new SpeechSynthesisUtterance(word.value.spelling)
  utterance.lang = 'en-US'
  utterance.rate = 0.9
  speechSynthesis.cancel()
  speechSynthesis.speak(utterance)
}

function stopSpeaking() {
  speechGeneration += 1
  if (nativeSpeech.isSupported()) void nativeSpeech.stop().catch(() => {})
  window.speechSynthesis?.cancel()
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
  <div class="study" @touchstart.passive="startSwipe" @touchmove.passive="moveSwipe" @touchend="endSwipe" @touchcancel="swipe = null">
    <header class="focus-header">
      <router-link to="/" class="back-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg> 返回首页</router-link>
      <span class="focus-label"><span></span> 专注学习</span>
    </header>
    <!-- 加载中 -->
    <div v-if="status === 'loading'" class="card result-card" role="status">
      <span class="state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M12 6c-3-3-7-3-10-2v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15" /></svg></span>
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
        <div class="study-head-left"><span class="badge" :class="item.kind">{{ item.kind === 'new' ? '新词学习' : '复习巩固' }}</span><span class="session-label">今日学习</span></div>
        <span class="progress-text mono-num">
          <b>{{ app.currentIndex + 1 }}</b><span> / {{ app.totalItems }} 词</span>
        </span>
      </div>

      <div class="progress head-progress" role="progressbar" aria-label="本组学习进度" :aria-valuenow="app.answeredCount" :aria-valuemin="0" :aria-valuemax="app.totalItems || 1">
        <span :style="{ width: (app.answeredCount / app.totalItems) * 100 + '%' }"></span>
      </div>

      <div ref="wordCard" class="card word-card">
        <div class="word-row">
          <h1 class="word-spell">{{ word.spelling }}</h1><FavoriteWord :key="word.id" :word-id="word.id" compact-on-mobile />
          <button class="speak-btn" title="朗读单词" aria-label="朗读单词" @click="speak"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m11 4-6 5H2v6h3l6 5V4Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></svg></button>
        </div>
        <p v-if="speechError" class="error-text" role="status">{{ speechError }}</p>
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

        <div class="question-heading"><p class="q-prompt">选择正确的中文释义</p><span class="question-hint">相信你的第一反应</span></div>

        <div class="option-grid">
          <button
            v-for="option in options"
            :key="option.index"
            class="option choice"
            :class="[optionClass(option.index), { selected: app.loading.answering && selectedIndex === option.index }]"
            :disabled="status === 'answered' || app.loading.answering"
            :aria-label="`${option.index + 1}. ${option.text}${status === 'answered' && option.index === correctIndex ? '，正确答案' : status === 'answered' && option.index === selectedIndex ? '，你的选择，回答错误' : ''}`"
            @click="choose(option.index)"
          >
            <span class="opt-key">{{ option.index + 1 }}</span>
            <span class="opt-text">
              <!-- 完整释义，第一条（词表里的主释义）加粗 -->
              <b v-if="option.primary">{{ option.primary }}</b>
              <template v-if="option.primary && option.text.startsWith(option.primary)">
                {{ option.text.slice(option.primary.length) }}
              </template>
              <template v-else>{{ option.text }}</template>
            </span>
            <svg v-if="status === 'answered' && option.index === correctIndex" class="option-status" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
            <svg v-else-if="status === 'answered' && option.index === selectedIndex" class="option-status" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div v-if="status === 'answered'" class="mobile-study-actions">
          <button class="btn btn-primary next-btn" :disabled="advancing || app.loading.answering" @click="advance">
            {{ nextLabel }} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </button>
        </div>
        <p v-if="navigationNotice" class="navigation-notice" role="status">{{ navigationNotice }}</p>

        <transition name="fade">
          <div v-if="status === 'answered'" class="feedback" aria-live="polite">
            <p class="fb-line" :class="answer.isCorrect ? 'ok' : 'bad'">
              {{ answer.isCorrect ? '✓ 回答正确' : '✗ 再记一下这个' }}
            </p>

            <!-- 错因分析结果（PRD 4.2.3） -->
            <div v-if="answer.analysis?.type" class="analysis">
              <span class="analysis-tag">{{ answer.analysis.label }}</span>
              <span class="analysis-action">{{ answer.analysis.action }}</span>
            </div>
            <p v-else-if="answer.analysis?.confidence === 'low'" class="analysis-note">
              答对了，但想了一会儿 —— 已标记为「半熟」，复习间隔会自动缩短。
            </p>

            <p v-if="word.example" class="example">
              <span class="ex-label">例句</span>{{ word.example }}
            </p>
            <p class="def-line">释义：{{ word.definitions.join('；') }}</p>
            <MorphologyCard :key="word.spelling" :word="word.spelling" />

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
            <p v-if="answer.progress" class="next-review">
              下次复习：{{ answer.progress.intervalDays }} 天后　·　记忆强度
              {{ Math.round(answer.progress.memoryStrength) }}
            </p>
          </div>
        </transition>
      </div>

      <div class="study-foot">
        <p class="keyboard-hints"><span><kbd>1</kbd> – <kbd>4</kbd> 选择释义</span><span><kbd>Space</kbd> 作答后继续</span></p>
        <button
          v-if="status === 'answered'"
          class="btn btn-primary btn-lg next-btn"
          :disabled="advancing"
          @click="advance"
        >
          {{ nextLabel }} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
        </button>
      </div>
    </template>

    <!-- 本轮完成 -->
    <div v-else-if="status === 'finished'" class="card result-card">
      <span class="state-icon completed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg></span>
      <p class="result-eyebrow">每一次专注，都在积累</p>
      <h1 class="result-title">这一组，完成了。</h1>
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
        <p class="ai-title">让今天学到的词，留下来</p>
        <div class="ai-actions">
          <button class="btn btn-ghost" @click="goToArticle">
            生成巩固短文
          </button>
          <button
            v-if="wrongWordIds.length"
            class="btn btn-ghost"
            :disabled="generating"
            @click="makeErrorCards"
          >
            {{ generating ? '生成中…' : `错词对比卡片（${wrongWordIds.length} 个）` }}
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
            <p v-if="card.mnemonic" class="mc-mnemonic">记忆提示 · {{ card.mnemonic }}</p>
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
      <span class="state-icon completed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg></span>
      <h1 class="result-title">今天的计划，已完成。</h1>
      <p class="result-sub">新词与待复习都学完了，休息一下，或者再巩固一组。</p>
      <div class="result-actions">
        <button class="btn btn-ghost" @click="startExtra">再学一组</button>
        <button class="btn btn-primary" @click="router.push('/')">返回首页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.study { max-width: 800px; margin: 0 auto; }
.mobile-study-actions { display: none; }
.navigation-notice { margin: 12px 0 0; color: var(--ink-soft); font-size: 12px; }
.word-card { scroll-margin-top: 12px; touch-action: pan-y pinch-zoom; }
.focus-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 32px; }
.back-link { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-soft); font-size: 12px; }
.back-link svg { width: 18px; height: 18px; }
.back-link:hover { color: var(--ink); }
.focus-label { display: inline-flex; align-items: center; gap: 7px; font-size: 10px; letter-spacing: 1px; color: var(--ink-soft); }
.focus-label > span { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
.choice.selected { outline: 2px solid var(--accent); background: var(--accent-soft); opacity: 1; }
.study-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.study-head-left { display: flex; align-items: center; gap: 12px; }
.session-label { font-size: 11px; color: var(--ink-soft); }
.head-progress {
  height: 3px;
  margin-bottom: 22px;
}

.badge {
  font-size: 10px;
  font-weight: 500;
  padding: 5px 10px;
  border-radius: 6px;
}

.badge.new {
  background: var(--accent-soft);
  color: var(--accent-deep);
}

.badge.review {
  background: var(--hint-bg);
  color: var(--hint-ink);
}

.progress-text {
  color: var(--ink-soft);
  font-size: 12px;
}
.progress-text b { color: var(--ink); font-size: 15px; font-weight: 500; }

.word-card {
  padding: 42px 38px 34px;
  background: var(--surface-study, var(--bg-card));
}

.word-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin: 15px 0 12px;
}

.word-spell {
  font-family: var(--serif);
  font-size: clamp(35px, 5.5vw, 62px);
  line-height: 1.2;
  font-weight: 500;
  margin: 0;
  letter-spacing: -1.5px;
  overflow-wrap: anywhere;
}

.speak-btn {
  background: var(--accent-soft);
  color: var(--accent-deep);
  border: 1px solid var(--line);
  border-radius: 50%;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: transform .12s ease, border-color .16s ease;
}
.speak-btn svg { width: 17px; height: 17px; }

.speak-btn:hover {
  border-color: var(--accent);
}

.speak-btn:active {
  transform: scale(0.92);
}

.word-meta {
  color: var(--ink-soft);
  margin: 0 0 42px;
  font-size: 14px;
  text-align: center;
  line-height: 2;
}

.meta-sep {
  margin: 0 6px;
}

.freq-tag {
  display: inline-block;
  font-size: 9px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
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
  background: var(--hint-bg);
  color: var(--hint-ink);
}

.diff {
  margin-left: 10px;
  color: var(--ink-soft);
  font-size: 10px;
  letter-spacing: 1px;
  vertical-align: middle;
}

.question-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 13px; }
.q-prompt {
  font-size: 12px;
  color: var(--ink-soft);
  margin: 0;
}
.question-hint { font-size: 10px; color: var(--ink-soft); opacity: .7; }
.option-grid { gap: 10px; }

.choice {
  cursor: pointer;
  min-height: 66px;
  border-width: 1px;
  background: var(--bg-card);
  padding: 15px 18px;
  font-size: 14px;
  gap: 16px;
}
.choice .opt-key { width: 26px; height: 26px; background: transparent; border: 1px solid var(--line); border-radius: 6px; color: var(--ink-soft); font-size: 11px; font-weight: 400; }
.option-status { width: 18px; height: 18px; margin-left: auto; flex-shrink: 0; }

.choice:disabled {
  cursor: default;
}

.choice.correct {
  opacity: 1;
  border-color: var(--ok);
  background: var(--ok-soft);
  color: var(--ok);
}
.choice.correct .opt-key { border-color: var(--ok); color: var(--ok); }

.choice.wrong {
  opacity: 1;
  border-color: var(--bad);
  background: var(--bad-soft);
  color: var(--bad);
}
.choice.wrong .opt-key { border-color: var(--bad); color: var(--bad); }

.choice.dim {
  opacity: 0.55;
}

.opt-text {
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.opt-text b {
  color: var(--ink);
  font-weight: 500;
}

.choice.correct .opt-text b,
.choice.wrong .opt-text b {
  color: inherit;
}

.feedback {
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
}

.fb-line {
  font-size: 14px;
  font-weight: 500;
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
  color: var(--hint-ink);
  background: var(--hint-bg);
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
  margin-top: 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  min-height: 48px;
}

.keyboard-hints { display: flex; align-items: center; flex-wrap: wrap; gap: 18px; margin: 0; font-size: 10px; color: var(--ink-soft); }
.keyboard-hints > span { display: inline-flex; align-items: center; gap: 5px; }
.keyboard-hints kbd { font: inherit; font-size: 9px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink-soft); background: var(--bg-card); box-shadow: 0 1px 0 var(--line); }
.next-btn { padding: 13px 21px; font-size: 13px; min-width: 170px; gap: 24px; flex-shrink: 0; }
.next-btn svg { width: 16px; height: 16px; }

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
  padding: 46px 34px;
  background: var(--surface-study, var(--bg-card));
}
.state-icon { width: 56px; height: 56px; display: grid; place-items: center; color: var(--accent-deep); margin: 0 auto 24px; border-radius: 50%; background: var(--accent-soft); }
.state-icon svg { width: 30px; height: 30px; }
.state-icon.completed { color: var(--ok); background: var(--ok-soft); }
.result-eyebrow { font-size: 10px; color: var(--ink-soft); letter-spacing: 1px; margin: 0 0 12px; }

.result-title {
  font-size: 27px;
  font-weight: 500;
  letter-spacing: -.6px;
  margin: 0 0 12px;
}

.result-sub {
  color: var(--ink-soft);
  font-size: 12px;
  margin: 0 0 28px;
}

.result-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin: 30px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 24px 0;
}

.rs {
  display: flex;
  flex-direction: column;
}

.rs-num {
  font-size: 32px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.rs.ok .rs-num {
  color: var(--ok);
}

.rs.bad .rs-num {
  color: var(--bad);
}

.rs-label {
  font-size: 11px;
  color: var(--ink-soft);
  margin-top: 6px;
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
  background: var(--bg-card);
  border: 1px solid var(--line);
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
@media (max-width: 600px) {
  .focus-header { margin-bottom: 25px; }
  .word-card { padding: 30px 22px 24px; }
  .word-row { margin-top: 16px; gap: 12px; }
  .word-spell { font-size: clamp(30px, 8vw, 44px); letter-spacing: -.8px; }
  .speak-btn { width: 34px; height: 34px; }
  .word-meta { font-size: 12px; margin-bottom: 32px; }
  .question-hint { display: none; }
  .choice { padding: 13px 14px; min-height: 62px; font-size: 13px; gap: 12px; }
  .choice .opt-key { width: 23px; height: 23px; }
  .study-foot { flex-direction: column-reverse; gap: 17px; }
  .next-btn { width: 100%; justify-content: space-between; }
  .result-card { padding: 34px 22px; }
  .result-title { font-size: 23px; }
  .result-sub { line-height: 1.9; }
  .result-actions { flex-wrap: wrap; }
  .result-actions .btn { font-size: 13px; padding: 12px 20px; }
  .ai-block { padding: 16px; }
  .ai-actions .btn { font-size: 12px; padding: 10px 12px; }
  .mc-row { flex-wrap: wrap; gap: 4px 10px; }
}
@media (max-width: 820px), (hover: none) and (pointer: coarse) {
  .study-foot { display: none; }
  .mobile-study-actions { display: block; margin-top: 14px; }
  .mobile-study-actions .next-btn { width: 100%; justify-content: space-between; }
  .word-row { position: relative; gap: 8px; }
  .word-spell { min-width: 0; }
  .study-foot:has(> .keyboard-hints:only-child) { display: none; }
}
@media (prefers-reduced-motion: reduce) { .speak-btn, .fade-enter-active, .fade-leave-active { transition: none; }.speak-btn:active { transform: none; } }
</style>
