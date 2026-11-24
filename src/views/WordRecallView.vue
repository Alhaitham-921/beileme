<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { recall, spelling } from '../api'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
const labels = { independent: '独立答出', hinted: '提示后答出', 'needs-practice': '待巩固' }
const state = ref(null)
const spellingState = ref(null)
const spellingUnavailable = ref(false)
const session = ref(null)
const showFeedback = ref(false)
const input = ref('')
const busy = ref(false)
const message = ref('')
const answerField = ref(null)
const nextButton = ref(null)
const mistakes = computed(() => state.value?.daily?.candidates || [])
const selectedWords = ref([])
let spellingRequestKey, spellingSelection
const question = computed(() => session.value?.question)
const feedback = computed(() => showFeedback.value ? session.value?.feedback : null)
const results = computed(() => session.value?.results || [])
const latestSpelling = computed(() => spellingState.value?.active?.[0])
const historyDate = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const historyEntries = computed(() => {
  const last = state.value?.lastCompleted
  const entries = [
    ...(last ? [{
      key: `recall-${last.id}`, icon: 'repeat', label: last.mode === 'retest' ? '复测' : '填词',
      count: last.results?.filter(item => item.result === 'independent').length ?? 0,
      total: last.total, date: last.completedAt,
    }] : []),
    ...(spellingState.value?.recent ?? []).map(item => ({
      key: `spelling-${item.id}`, to: `/recall/spelling/${item.id}`, icon: 'chart',
      label: '拼写', count: item.independent ?? item.completed, total: item.total, date: item.updatedAt,
      progress: item.independent == null,
    })),
  ]
  entries.sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0))
  const active = (spellingState.value?.active ?? []).map(item => ({
    key: `spelling-${item.id}`, to: `/recall/spelling/${item.id}`, icon: 'book',
    label: '续练', count: item.completed, total: item.total, date: item.updatedAt, progress: true,
  }))
  return [...active, ...entries]
})
const daily = computed(() => state.value?.daily)
const canExtend = computed(() => daily.value && (state.value.due
  ? daily.value.remaining === 0
  : daily.value.waiting > 0 && mistakes.value.length === 0))
const screen = computed(() => !session.value ? 'home' : feedback.value || question.value ? 'exercise' : 'results')
const isRetest = computed(() => session.value?.mode === 'retest')
const position = computed(() => Math.min(session.value?.total ?? 0, (session.value?.answered ?? 0) + (feedback.value ? 0 : 1)))
watch([question, feedback, busy], async () => {
  if (busy.value) return
  await nextTick()
  if (busy.value) return
  (feedback.value ? nextButton.value : answerField.value)?.focus({ preventScroll: true })
})

function answerKey(event) {
  if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'F2' && !event.shiftKey) {
    event.preventDefault()
    if (!event.repeat) void hint()
  } else if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault()
    if (!event.repeat) void submit('')
  }
}

async function load() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const [status, history] = await Promise.allSettled([recall.status(), spelling.overview()])
    spellingUnavailable.value = history.status === 'rejected'
    spellingState.value = history.status === 'fulfilled' ? history.value : null
    if (status.status === 'rejected') throw status.reason
    state.value = status.value
    selectSuggestedWords()
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
}

function selectSuggestedWords() {
  selectedWords.value = mistakes.value.map(word => word.id)
}

async function extendPractice() {
  if (busy.value || !canExtend.value) return
  busy.value = true
  message.value = ''
  try {
    state.value = await recall.extend()
    selectSuggestedWords()
  } catch (error) {
    message.value = error.message || '加练额度加载失败，请重试'
  } finally {
    busy.value = false
  }
}

function toggleWord(id) {
  if (busy.value) return
  selectedWords.value = selectedWords.value.includes(id)
    ? selectedWords.value.filter(wordId => wordId !== id)
    : [...selectedWords.value, id]
}

async function startSpelling() {
  if (!selectedWords.value.length || busy.value) return
  const ids = mistakes.value.map(word => Number(word.id)).filter(id => selectedWords.value.includes(id))
  const signature = ids.join(',')
  if (signature !== spellingSelection) {
    spellingRequestKey = crypto.randomUUID()
    spellingSelection = signature
  }
  busy.value = true
  message.value = ''
  try {
    const practice = await spelling.create(ids, spellingRequestKey, true)
    await router.push(`/recall/spelling/${practice.id}`)
  } catch (error) {
    message.value = error.message || '练习未能开始，请重试'
    if (error.status === 409) await refreshAfterEmpty()
  } finally {
    busy.value = false
  }
}

function openActive() {
  session.value = state.value?.active || null
  showFeedback.value = Boolean(session.value?.feedback)
  input.value = ''
}

function home() {
  if (busy.value) return
  session.value = null
  showFeedback.value = false
  input.value = ''
  void load()
}

async function start(mode) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const data = await recall.start(mode)
    session.value = data.session
    showFeedback.value = Boolean(session.value?.feedback)
    input.value = ''
    if (!data.session) { await refreshAfterEmpty(); message.value = daily.value?.remaining === 0 ? '今天的专项练习已完成' : '今天没有到期的词' }
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
}

async function refreshAfterEmpty() {
  try {
    state.value = await recall.status()
    selectSuggestedWords()
  } catch { /* Keep the last known status. */ }
}

async function submit(answer) {
  if (busy.value || !question.value) return
  busy.value = true
  message.value = ''
  try {
    session.value = await recall.answer(session.value.id, question.value.wordId, answer)
    showFeedback.value = true
    input.value = ''
  } catch (error) { message.value = error.message }
  finally { busy.value = false }
}

async function hint() {
  if (busy.value || !question.value || question.value.hint) return
  busy.value = true
  message.value = ''
  try { session.value = await recall.hint(session.value.id, question.value.wordId) }
  catch (error) { message.value = error.message }
  finally { busy.value = false }
}

function viewLast() {
  session.value = state.value.lastCompleted
  showFeedback.value = false
}

onMounted(load)
</script>

<template>
  <main class="recall-page">
    <header class="recall-heading">
      <h1 class="section-title">错词专项</h1>
      <router-link v-if="screen==='home'" to="/notebooks?source=mistakes" class="quiet-link">错题本</router-link>
      <button v-else type="button" class="quiet-link" :disabled="busy" @click="home">返回专项</button>
    </header>
    <p v-if="message" role="status" class="recall-message">{{ message }}</p>
    <section v-if="screen==='home'" class="card recall-card recall-home">
      <template v-if="busy && !state"><LoadingState>读取进度…</LoadingState></template>
      <template v-else-if="state">
        <span class="home-number" v-if="state.active">{{ state.active.answered }}<small> / {{ state.active.total }}</small></span>
        <span class="home-number" v-else-if="latestSpelling">{{ latestSpelling.completed }}<small> / {{ latestSpelling.total }}</small></span>
        <span class="home-number" v-else-if="state.due">{{ state.due }}</span>
        <h2>{{ state.active || latestSpelling ? '上次练习' : daily?.remaining === 0 ? '今天已练完' : state.due ? '到期错词' : '今日待练' }}</h2>
        <button v-if="state.active" class="btn btn-primary" :disabled="busy" @click="openActive">继续练习</button>
        <router-link v-else-if="latestSpelling" class="btn btn-primary" :to="`/recall/spelling/${latestSpelling.id}`">继续拼写</router-link>
        <button v-else-if="state.due && daily?.remaining" class="btn btn-primary" :disabled="busy" @click="start('retest')">开始复测</button>
        <template v-else>
          <template v-if="mistakes.length && !state.due">
            <ul class="mistake-grid" aria-label="选择练习词">
              <li v-for="word in mistakes" :key="word.id">
                <button type="button" class="mistake-word" :aria-pressed="selectedWords.includes(Number(word.id))"
                  :disabled="busy" @click="toggleWord(Number(word.id))">
                  <span lang="en">{{ word.spelling }}</span><span class="selection-mark" aria-hidden="true">✓</span>
                </button>
              </li>
            </ul>
            <button type="button" class="btn btn-primary" :disabled="busy || !selectedWords.length" @click="startSpelling">
              {{ busy ? '正在开始…' : selectedWords.length ? `拼写 ${selectedWords.length} 词` : '开始拼写' }}
            </button>
          </template>
          <p v-else-if="daily?.remaining && !state.due" class="muted">
            {{ !daily.waiting ? '暂无新词待练' : daily.newRemaining ? '今日剩余额度不足以安排新词' : '今日新词名额已用完' }}
          </p>
          <button v-if="canExtend" type="button" class="btn btn-primary" :disabled="busy" @click="extendPractice">
            {{ busy ? '正在安排…' : state.due ? '加练到期错词' : '再练一组错词' }}
          </button>
        </template>
        <div v-if="daily" class="recall-actions schedule-stats" aria-label="今日专项进度">
          <span>今日已答 {{ daily.attempts }} 次 · 额度 {{ daily.limit }} 次</span>
          <span v-if="state.due">到期 {{ state.due }}</span>
          <span v-if="daily.waiting">候选 {{ daily.waiting }}<template v-if="daily.oldestWaitingDays"> · 最久 {{ daily.oldestWaitingDays }} 天</template></span>
          <span v-if="state.focused">重点 {{ state.focused }}</span>
        </div>
        <small v-if="!state.active && !latestSpelling && !state.due && state.nextDate">下次复测 {{ state.nextDate }}</small>
      </template>
      <button v-else class="btn btn-secondary" @click="load">重新读取</button>
    </section>
    <details v-if="screen==='home' && (historyEntries.length || spellingUnavailable || state?.due && latestSpelling)" class="recall-history">
      <summary><AppIcon name="chart" />练习记录 <span aria-hidden="true" class="history-chevron">›</span></summary>
      <button v-if="state?.due && daily?.remaining && latestSpelling && !state.active" class="btn btn-ghost history-action" :disabled="busy" @click="start('retest')">复测 {{ state.due }} 词</button>
      <ul v-if="historyEntries.length" class="history-grid">
        <li v-for="item in historyEntries" :key="item.key">
          <component :is="item.to ? 'RouterLink' : 'button'" :to="item.to" :type="item.to ? undefined : 'button'"
            :disabled="item.to ? undefined : busy" class="history-record" @click="!item.to && viewLast()">
            <span class="history-icon"><AppIcon :name="item.icon" /></span>
            <span class="history-type">{{ item.label }}</span>
            <span class="history-score">{{ item.count }}<small>/{{ item.total }}</small>
              <span class="history-score-label">{{ item.progress ? '进度' : '独立答对' }}</span>
            </span>
            <progress class="history-bar" :value="item.count" :max="item.total" :aria-label="item.progress ? '完成进度' : '独立答对比例'" />
            <time v-if="item.date" :datetime="item.date">{{ historyDate.format(new Date(item.date)) }}</time>
          </component>
        </li>
      </ul>
      <button v-if="spellingUnavailable" class="btn btn-ghost history-action" :disabled="busy" @click="load">重试读取</button>
    </details>
    <div v-if="screen==='exercise'" class="recall-progress">
      <span class="recall-mode">
        <AppIcon :name="isRetest ? 'repeat' : 'book'" />
        {{ isRetest ? '复测' : '练习' }}
      </span>
      <div class="progress-track" aria-hidden="true"><span v-for="n in session.total" :key="n" :class="{ filled:n<=session.answered, current:n===position }"></span></div>
      <span>{{ position }} / {{ session.total }}</span>
    </div>
    <section v-if="feedback" class="card recall-card recall-exercise" aria-live="polite">
      <p class="result-tag" :class="feedback.result">{{ labels[feedback.result] }}</p>
      <h2 lang="en">{{ feedback.spelling }}</h2>
      <p>{{ feedback.meaning }}</p>
      <p v-if="feedback.correction">你的拼写 <span lang="en">{{ feedback.correction }}</span></p>
      <p v-if="feedback.mastered" class="result-tag independent">已巩固</p>
      <p v-if="feedback.example" lang="en" class="recall-context">{{ feedback.example }}</p>
      <div v-if="feedback.previous" class="result-change"><span>上次 {{ labels[feedback.previous] }}</span><span aria-hidden="true">→</span><span>这次 {{ labels[feedback.result] }}</span></div>
      <div class="recall-actions"><button ref="nextButton" type="button" class="btn btn-primary" @click="showFeedback = false" @keydown.enter.prevent="!$event.repeat && !$event.shiftKey && (showFeedback = false)">{{ question ? '下一词' : '查看结果' }} <kbd>Enter</kbd></button></div>
      <details class="feedback-details"><summary>更多</summary>
        <p v-if="feedback.translation">{{ feedback.translation }}</p>
        <p v-if="feedback.collocation"><strong lang="en">{{ feedback.collocation.phrase }}</strong> · {{ feedback.collocation.translation }}</p>
        <p v-if="feedback.dialogue">{{ feedback.dialogue.sourceTitle }} · {{ feedback.dialogue.reason }}</p>
        <p v-if="feedback.nextDate">下次复测 {{ feedback.nextDate }}</p>
        <router-link :to="{path:'/notebooks/collocations',query:{wordId:feedback.wordId}}" class="quiet-link">复习搭配</router-link>
      </details>
    </section>
    <section v-else-if="question" class="card recall-card recall-exercise">
      <h2>{{ question.blank ? '填上缺的词' : '拼出这个词' }}</h2>
      <p v-if="question.blank" lang="en" class="recall-context">{{ question.blank }}</p>
      <p v-if="question.changedContext" class="recall-context-label"><AppIcon name="repeat" />新例句</p>
      <p>{{ question.cue }} <span v-if="question.pos" class="muted">{{ question.pos }}</span></p>
      <p v-if="question.letterCount" class="muted">重点词 · {{ question.letterCount }} 个字符</p>
      <p v-if="question.hint" role="status">首字母 · <strong lang="en">{{ question.hint }}</strong></p>
      <form @submit.prevent="input.trim() && submit(input)">
        <input id="recall-answer" ref="answerField" aria-label="输入英文" placeholder="输入英文" v-model="input" @keydown="answerKey" maxlength="100" autocapitalize="none" autocomplete="off" spellcheck="false" :disabled="busy" />
        <div class="recall-actions">
          <button type="submit" class="btn btn-primary" :disabled="busy || !input.trim()">{{ busy ? '处理中…' : '提交' }} <kbd>Enter</kbd></button>
          <button type="button" class="btn btn-secondary" aria-keyshortcuts="F2" :disabled="busy || Boolean(question.hint)" @click="hint">看首字母 <kbd>F2</kbd></button>
          <button type="button" class="quiet-link" aria-keyshortcuts="Shift+Enter" :disabled="busy" @click="submit('')">跳过 <kbd>Shift + Enter</kbd></button>
        </div>
      </form>
    </section>
    <section v-else-if="screen==='results'" class="card recall-card">
      <h2>本组完成</h2>
      <div class="recall-tallies"><div v-for="(label, key) in labels" :key="key"><strong>{{ results.filter(item => item.result === key).length }}</strong><span>{{ label }}</span></div></div>
      <details class="feedback-details"><summary>逐词结果</summary><ul class="recall-results">
        <li v-for="item in results" :key="item.wordId">
          <strong lang="en">{{ item.spelling }}</strong>
          <span v-if="item.previous">上次 {{ labels[item.previous] }} · </span>本次 {{ labels[item.result] }}
          <small v-if="item.dialogue">对话「{{ item.dialogue.sourceTitle }}」· {{ item.dialogue.reason }}</small>
          <small v-if="item.nextDate">复测 {{ item.nextDate }}</small>
        </li>
      </ul></details>
      <button class="btn btn-secondary" :disabled="busy" @click="home">返回专项</button>
    </section>
  </main>
</template>

<style scoped>
.recall-page { max-width: 720px; margin: 0 auto; padding-bottom: 30px; }
.recall-card { margin-top: 20px; }
.recall-context { font-size: 1.2rem; line-height: 1.6; overflow-wrap: anywhere; }
.recall-card input { display: block; width: 100%; box-sizing: border-box; min-height: 44px; margin: 8px 0 14px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--bg); font: inherit; }
.recall-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.recall-results { padding-left: 20px; line-height: 1.9; }
.recall-results strong { margin-right: 8px; }
.recall-results small { display: block; color: var(--ink-soft); }
.recall-message { margin: 12px 0; color: var(--ink-soft); }
</style>
<style scoped>
.recall-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}
.recall-heading h1{margin:0}
.quiet-link{border:0;background:transparent;color:var(--accent-deep);padding:7px 0;font:inherit;font-size:13px;cursor:pointer}
.recall-home,.recall-exercise{text-align:center;padding:clamp(24px,5vw,40px)}
.recall-home h2,.recall-exercise h2{margin:0 0 18px}
.recall-home .btn{min-width:130px}
.schedule-stats{justify-content:center;margin-top:16px;color:var(--ink-soft);font-size:12px;gap:8px 16px}
.mistake-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,130px),1fr));gap:8px;padding:0;margin:0 0 18px;list-style:none}
.mistake-word{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:100%;min-height:44px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--bg-card);color:var(--ink);font:inherit;text-align:left;overflow-wrap:anywhere}
.mistake-word[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft)}
.selection-mark{visibility:hidden;color:var(--accent-deep)}
.mistake-word[aria-pressed=true] .selection-mark{visibility:visible}
.recall-home small:not(.home-number small){display:block;margin-top:14px;color:var(--ink-soft)}
.home-number{display:block;font:400 48px var(--serif);line-height:1.15;color:var(--accent-deep);margin-bottom:8px}
.home-number small{font-size:24px;color:var(--ink-soft)}
.recall-history,.feedback-details{color:var(--ink-soft);font-size:13px;margin:18px 0}
.recall-history summary,.feedback-details summary{cursor:pointer;padding:7px 0}
.recall-history summary{display:flex;align-items:center;gap:8px;list-style:none}
.recall-history summary::-webkit-details-marker{display:none}
.history-chevron{margin-left:auto;font-size:20px;line-height:1}
.recall-history[open] .history-chevron{transform:rotate(90deg)}
.history-action{margin:8px 0}
.history-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,145px),1fr));gap:8px;margin:8px 0 0;padding:0;list-style:none}
.history-record{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:5px 8px;width:100%;height:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--color-surface);color:var(--ink);text-align:left;font:inherit}
.history-record:hover{border-color:var(--accent)}
.history-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:7px;background:var(--accent-soft);color:var(--accent-deep)}
.history-icon .app-icon{width:16px;height:16px}
.history-type{font-weight:600}
.history-score,.history-bar,.history-record time{grid-column:1/-1}
.history-score{font-size:21px;line-height:1.2;font-variant-numeric:tabular-nums}
.history-score small,.history-score-label,.history-record time{color:var(--ink-soft);font-size:11px}
.history-score-label{margin-left:6px;white-space:nowrap}
.history-bar{width:100%;height:4px;margin:2px 0;appearance:none;border:0;border-radius:5px;overflow:hidden;background:var(--line)}
.history-bar::-webkit-progress-bar{background:var(--line)}
.history-bar::-webkit-progress-value{background:var(--accent)}
.history-bar::-moz-progress-bar{background:var(--accent)}
.recall-progress{display:flex;align-items:center;gap:14px;margin-top:20px;color:var(--ink-soft);font-size:13px;font-variant-numeric:tabular-nums}
.recall-mode,.recall-context-label{display:inline-flex;align-items:center;gap:5px;color:var(--accent-deep);font-size:12px}
.recall-mode .app-icon,.recall-context-label .app-icon{width:15px;height:15px}
.recall-context-label{margin:0}
.progress-track{flex:1;display:flex;gap:5px}
.progress-track span{flex:1;height:5px;border-radius:5px;background:var(--line)}
.progress-track .filled{background:var(--ok)}
.progress-track .current:not(.filled){background:var(--accent)}
.recall-exercise .recall-actions,.result-change{justify-content:center}
.recall-exercise form{max-width:430px;margin:auto}
.recall-exercise input{text-align:center;font-size:17px}
.result-tag{color:var(--warn-ink);font-size:12px}
.result-tag.independent{color:var(--ok)}
.result-change{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0;font-size:12px;color:var(--ink-soft)}
.recall-tallies{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));text-align:center;gap:8px}
.recall-tallies strong,.recall-tallies span{display:block}
.recall-tallies strong{font:400 32px var(--serif);color:var(--accent-deep)}
.recall-tallies span{font-size:12px;color:var(--ink-soft)}
kbd{margin-left:6px;font:inherit;font-size:10px;opacity:.75}
</style>
