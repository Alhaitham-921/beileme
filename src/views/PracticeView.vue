<script setup>
import AiUsage from '../components/AiUsage.vue'
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { practice } from '../api'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { usePracticeSpeech } from '../composables/usePracticeSpeech'
import PracticeText from '../components/PracticeText.vue'

const auth = useAuthStore()
const app = useAppStore(), router = useRouter(), startingReview = ref(false)
const scenes = ref([]), recommendations = ref([]), sessions = ref([]), legacyScenes = ref([]), history = ref([])
const sceneId = ref(''), variant = ref('river'), strictness = ref('standard'), difficulty = ref('beginner')
const session = ref(null), draft = ref(''), busy = ref(false), loading = ref(true), error = ref(''), notice = ref('')
const selectedWord = ref(''), showTranslations = ref(true), waitingHelp = ref(false), conversationEnd = ref(null)
const revealedAnswers = ref([]), shortAnswers = ref({}), checkedAnswers = ref([])
const speech = usePracticeSpeech()
const { available: voiceAvailable, supported: voiceSupported, statusLoading: voiceLoading, statusReason: voiceReason,
  isRecording, isTranscribing, isStarting, error: voiceError, transcript, elapsedSeconds, maxSeconds, isSpeaking } = speech
let pollTimer, idleTimer, disposed = false, pollFailures = 0
const scene = computed(() => scenes.value.find(item => item.id === sceneId.value))
const chosenVariant = computed(() => {
  const variants = scene.value?.variants
  if (Array.isArray(variants)) return variants.find(item => item.id === variant.value || item.variant === variant.value)
  return variants?.[variant.value]
})
const selectedScene = computed(() => ({ ...scene.value, ...chosenVariant.value }))
const active = computed(() => session.value?.status === 'active')
const working = computed(() => busy.value || startingReview.value || isRecording.value || isTranscribing.value || isStarting.value)
const targets = computed(() => session.value?.targetUsage || selectedScene.value?.targets || [])
const currentScene = computed(() => session.value?.scene || selectedScene.value)
const report = computed(() => session.value?.report)
const usedCount = computed(() => targets.value.filter(target => ['independent', 'assisted'].includes(target.status)).length)
const suggestedScenes = computed(() => recommendations.value.map(item => {
  const id = typeof item === 'string' ? item : (item.sceneId || item.id)
  const source = scenes.value.find(entry => entry.id === id)
  return source ? { ...source, ...(typeof item === 'object' ? item : {}) } : null
}).filter(Boolean).slice(0, 3))
const strictnessLabels = { lenient: '宽松', standard: '标准', strict: '严格' }
const difficultyLabels = { beginner: '入门', intermediate: '进阶', advanced: '挑战' }
const usageLabels = { unused: '待使用', independent: '独立用出', assisted: '提示后用出', weak: '需要巩固' }
const correctionLabels = { grammar: '语法', tense: '时态', word_usage: '用词', word_sense: '词义用错', sense: '词义用错', sense_misuse: '词义用错', spelling: '拼写', article: '冠词', chinese_help: '中文求助' }
const evidenceLabels = { ...correctionLabels, dialogue_help: '提示后表达', dialogue_report: '对话复盘', dialogue_error: '表达待巩固', stuck: '表达卡壳' }
function wordTags(tags = []) { return [...new Set(tags.map(tag => evidenceLabels[tag]).filter(Boolean))].join('、') }
const sessionLabels = { active: '继续对话', analyzing: '小结生成中', finished: '查看小结', report_failed: '小结待重试' }
const speechRate = computed(() => ({ beginner: .8, intermediate: .95, advanced: 1.1 })[session.value?.difficulty || difficulty.value])
const storageKey = () => auth.user?.id ? `beileme:practice-session:${auth.user.id}` : null
const unwrap = data => data?.session || data

function remember(id) {
  try { const key = storageKey(); if (key) id ? localStorage.setItem(key, id) : localStorage.removeItem(key) } catch { /* Private mode may disable storage. */ }
}
function remembered() { try { const key = storageKey(); return key ? localStorage.getItem(key) : null } catch { return null } }
function formatDate(value) { return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' }
function clearTimers() { clearTimeout(pollTimer); clearTimeout(idleTimer) }
function resetIdle() {
  clearTimeout(idleTimer); waitingHelp.value = false
  if (active.value && !working.value) idleTimer = setTimeout(() => { waitingHelp.value = true }, 12000)
}
function scrollConversation() { nextTick(() => conversationEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })) }
function applySession(data) {
  if (disposed) return
  const next = unwrap(data)
  if (!next?.id) throw new Error('练习进度未能读取，请恢复进度后重试。')
  session.value = next; remember(next.id)
  const index = sessions.value.findIndex(item => item.id === next.id)
  const summary = { ...next, updatedAt: next.updatedAt || new Date().toISOString() }
  if (index === -1) sessions.value.unshift(summary)
  else sessions.value.splice(index, 1, summary)
  if (!selectedWord.value || !next.targetUsage?.some(item => item.word === selectedWord.value)) selectedWord.value = next.targetUsage?.find(item => ['unused', 'weak'].includes(item.status))?.word || next.targetUsage?.[0]?.word || ''
  resetIdle(); clearTimeout(pollTimer)
  if (next.status === 'analyzing') schedulePoll()
}
async function loadList() {
  const data = await practice.list()
  if (disposed) return
  scenes.value = data.scenes || []; recommendations.value = data.recommendations || []
  sessions.value = data.sessions || []; legacyScenes.value = data.legacyScenes || []; history.value = data.history || []
  if (!sceneId.value) sceneId.value = suggestedScenes.value[0]?.id || scenes.value[0]?.id || ''
  if (!session.value && data.recommendedDifficulty) difficulty.value = data.recommendedDifficulty
}
async function load() {
  loading.value = true; error.value = ''
  try {
    await loadList()
    const id = remembered()
    const resumable = sessions.value.find(item => String(item.id) === id) || sessions.value.find(item => ['active', 'analyzing', 'report_failed'].includes(item.status))
    if (resumable) {
      try { applySession(await practice.getSession(resumable.id)); showTranslations.value = session.value.difficulty === 'beginner' }
      catch (e) { remember(null); error.value = `上次练习暂未恢复：${e.message}` }
    }
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
function selectScene(id) { sceneId.value = id; variant.value = 'river'; error.value = ''; notice.value = '' }
async function start() {
  if (working.value || !sceneId.value) return
  busy.value = true; error.value = ''; notice.value = ''; draft.value = ''
  speech.cancel(); speech.stopSpeaking(); clearTimers(); pollFailures = 0
  try {
    applySession(await practice.startSession({ sceneId: sceneId.value, strictness: strictness.value, difficulty: difficulty.value, ...(sceneId.value === 'bank' ? { variant: variant.value } : {}) }))
    showTranslations.value = session.value.difficulty === 'beginner'; revealedAnswers.value = []; checkedAnswers.value = []; shortAnswers.value = {}
    scrollConversation()
  } catch (e) { error.value = e.message }
  finally { busy.value = false; resetIdle() }
}
async function restore(id) {
  if (working.value) return
  busy.value = true; error.value = ''; notice.value = ''
  speech.cancel(); speech.stopSpeaking(); clearTimers(); pollFailures = 0
  try {
    applySession(await practice.getSession(id)); draft.value = ''; showTranslations.value = session.value.difficulty === 'beginner'
    revealedAnswers.value = []; checkedAnswers.value = []; shortAnswers.value = {}; scrollConversation()
  } catch (e) { error.value = e.message }
  finally { busy.value = false; resetIdle() }
}
async function recoverAfterError(caught, id, turnBefore) {
  error.value = caught.message
  try {
    if (session.value?.id !== id) return
    applySession(await practice.getSession(id))
    if (session.value.turnCount > turnBefore) { draft.value = ''; notice.value = '刚才的回答已保存，已恢复最新进度。'; error.value = '' }
  } catch { /* Preserve the draft for manual recovery. */ }
}
async function send() {
  const text = draft.value.trim()
  if (working.value || !active.value || !text) return
  const id = session.value.id, expectedTurn = session.value.turnCount
  busy.value = true; error.value = ''; notice.value = ''; clearTimeout(idleTimer); speech.stopSpeaking()
  try { applySession(await practice.turn(id, { text, expectedTurn })); draft.value = ''; scrollConversation() }
  catch (e) { await recoverAfterError(e, id, expectedTurn) }
  finally { busy.value = false; resetIdle() }
}
const nextHelpLevel = computed(() => Math.min(4, Math.max(2, (session.value?.help?.level || 1) + 1)))
const helpLabels = { 2: '提示词', 3: '中文转英文 · 带读', 4: '完整示范句' }
async function help(level = nextHelpLevel.value) {
  if (working.value || !active.value) return
  const id = session.value.id
  busy.value = true; error.value = ''; notice.value = ''; speech.stopSpeaking(); clearTimeout(idleTimer)
  try {
    applySession(await practice.help(id, { level, word: selectedWord.value || undefined, text: draft.value.trim() || undefined, expectedTurn: session.value.turnCount }))
    if (level >= 3 && session.value.help?.example) speech.speak(session.value.help.example, { rate: speechRate.value })
    scrollConversation()
  } catch (e) { error.value = e.message; try { applySession(await practice.getSession(id)) } catch { /* Manual recovery remains available. */ } }
  finally { busy.value = false; resetIdle() }
}
async function finish() {
  if (working.value || !active.value) return
  busy.value = true; error.value = ''; notice.value = ''; speech.cancel(); speech.stopSpeaking(); clearTimers()
  try { applySession(await practice.finish(session.value.id)); scrollConversation() }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
function schedulePoll() {
  if (disposed) return
  const id = session.value?.id
  pollTimer = setTimeout(async () => {
    if (disposed || session.value?.id !== id || session.value?.status !== 'analyzing') return
    try { const data = await practice.getSession(id); if (session.value?.id === id && !disposed) { pollFailures = 0; notice.value = ''; applySession(data) } }
    catch (e) { pollFailures += 1; notice.value = `小结仍在后台处理，暂时无法读取：${e.message}`; if (pollFailures < 5) schedulePoll() }
  }, Math.min(15000, 2500 * (pollFailures + 1)))
}
async function refreshCurrent() {
  if (working.value || !session.value) return
  busy.value = true; error.value = ''; pollFailures = 0
  try { applySession(await practice.getSession(session.value.id)) }
  catch (e) { error.value = e.message }
  finally { busy.value = false; resetIdle() }
}
async function retryReport() {
  if (busy.value) return
  busy.value = true; error.value = ''; pollFailures = 0
  try { applySession(await practice.retryReport(session.value.id)) }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
function backToScenes() {
  if (working.value || active.value) return
  speech.cancel(); speech.stopSpeaking(); clearTimers(); remember(null)
  session.value = null; draft.value = ''; error.value = ''; notice.value = ''; selectedWord.value = ''
  loadList().catch(e => { error.value = e.message })
}
function keyboard(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); send() }
}
async function toggleMicrophone() {
  if (isRecording.value) speech.stop()
  else if (!working.value && active.value) { clearTimeout(idleTimer); speech.stopSpeaking(); await speech.start() }
}
function read(text) { if (isSpeaking.value) speech.stopSpeaking(); else speech.speak(text, { rate: speechRate.value }) }
function insertExample() { draft.value = session.value?.help?.example || ''; nextTick(() => document.getElementById('practice-expression')?.focus()) }
function checkShort(index) { if (!checkedAnswers.value.includes(index)) checkedAnswers.value.push(index) }
async function startReview() {
  const wordIds = [...new Set((report.value?.reviewWords || []).map(word => Number(word.id)).filter(id => Number.isSafeInteger(id) && id > 0))]
  if (working.value || !wordIds.length) return
  startingReview.value = true; error.value = ''; speech.stopSpeaking()
  try { await app.startReviewSession(wordIds); await router.push('/study') }
  catch (e) { error.value = e.message }
  finally { startingReview.value = false }
}
function shortMatches(index, expected) {
  const normalize = value => String(value || '').toLowerCase().replace(/[.,!?;:'"“”’]/g, '').replace(/\s+/g, ' ').trim()
  return normalize(shortAnswers.value[index]) === normalize(expected)
}
watch(transcript, text => { if (text && active.value) { draft.value = `${draft.value.trim()}${draft.value.trim() ? ' ' : ''}${text}`; notice.value = '识别文字已填入输入框，请检查后发送。' } })
watch([isRecording, isTranscribing, isStarting], resetIdle)
watch(draft, resetIdle)
onMounted(load)
onUnmounted(() => { disposed = true; clearTimers(); speech.cancel(); speech.stopSpeaking() })
</script>

<template>
  <main class="practice">
    <header class="page-intro"><div><span class="eyebrow">情境对话 · 学完，试着用出来</span><h1 class="section-title">在情境里用单词</h1><p class="section-sub">完成一个小任务，用英语聊几轮。卡壳时，随时求助。</p></div><router-link class="small-link" to="/study">返回背词 →</router-link></header>
    <p v-if="error" role="alert" class="error-banner">{{ error }} <button class="text-button" :disabled="working" @click="session ? refreshCurrent() : load()">{{ session ? '恢复最新进度' : '重新加载' }}</button></p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <p v-if="loading" role="status">正在准备你的练习场景…</p>
    <template v-if="!session && !loading">
      <section v-if="suggestedScenes.length" class="scene-picker" aria-labelledby="recommended-scenes">
        <div class="section-heading"><h2 id="recommended-scenes">今天推荐</h2><span class="muted">结合今日新词与薄弱词</span></div>
        <div class="scene-grid"><button v-for="item in suggestedScenes" :key="item.id" type="button" :class="['scene-option', { chosen: sceneId === item.id }]" :aria-pressed="sceneId === item.id" @click="selectScene(item.id)"><span class="scene-icon" aria-hidden="true">{{ item.id === 'restaurant' ? '☕' : item.id === 'directions' ? '↗' : '≋' }}</span><strong>{{ item.title }}</strong><span class="scene-description">{{ item.reason || item.recommendationReason || item.location || item.task }}</span><span class="scene-words">{{ (item.words || []).join(' · ') }}</span></button></div>
      </section>
      <section v-if="scene" class="card setup" aria-labelledby="task-title">
        <div class="section-heading"><h2 id="task-title">你的任务卡</h2><label class="scene-select">自选场景 <select :value="sceneId" @change="selectScene($event.target.value)"><option v-for="item in scenes" :key="item.id" :value="item.id">{{ item.title }}</option></select></label></div>
        <fieldset v-if="sceneId === 'bank'" class="variant-options"><legend>bank · 这次练哪一种用法？</legend><label><input v-model="variant" type="radio" value="river"> 河岸 · 公园散步</label><label><input v-model="variant" type="radio" value="finance"> 银行 · 办理业务</label></fieldset>
        <p class="task-description">{{ selectedScene.task }}</p><p v-if="selectedScene.role" class="muted">AI 扮演：{{ selectedScene.role }}<span v-if="selectedScene.location"> · {{ selectedScene.location }}</span></p>
        <div class="target-list"><span v-for="target in selectedScene.targets || (selectedScene.words || []).map(word => ({ word }))" :key="target.word + ':' + target.sense" class="target-chip"><strong>{{ target.word }}</strong><span v-if="target.sense">{{ target.sense }}</span></span></div>
        <div class="settings-grid"><label>对话难度<select v-model="difficulty"><option value="beginner">入门 · 短句 + 中文提示</option><option value="intermediate">进阶 · 日常交流</option><option value="advanced">挑战 · 更完整的表达</option></select></label><label>纠错严格度<select v-model="strictness"><option value="lenient">宽松 · 先把意思说清楚</option><option value="standard">标准 · 兼顾准确和流畅</option><option value="strict">严格 · 适合考试备考</option></select></label></div>
        <p class="note">每次最多 8 轮。对话中轻提示，结束后看完整纠错和强化练习。</p><button class="btn btn-primary" :disabled="working" @click="start">{{ busy ? '正在准备对话…' : '开始情境对话 →' }}</button>
      </section>
    </template>
    <section v-if="session" class="conversation-shell" aria-label="情境练习">
      <AiUsage :usage="session.usage" label="本轮对话累计消耗" /><header class="scene-bar"><div class="section-heading"><div><span class="eyebrow">{{ currentScene?.location || '情境对话' }} · {{ currentScene?.role || 'AI 伙伴' }}</span><h2>{{ currentScene?.title || '情境练习' }}</h2></div><span class="rounds">{{ session.turnCount }} / {{ session.maxTurns || 8 }} 轮</span></div><p class="task-description">{{ currentScene?.task }}</p>
        <div class="target-list"><button v-for="target in targets" :key="target.word + ':' + target.sense" type="button" :class="['target-chip', target.status, { focused: selectedWord === target.word }]" :aria-pressed="selectedWord === target.word" :title="`${target.word} · ${target.sense || ''} · ${usageLabels[target.status] || '待使用'}`" @click="selectedWord = target.word"><strong>{{ ['independent', 'assisted'].includes(target.status) ? '✓ ' : '' }}{{ target.word }}</strong><span>{{ target.sense }}</span><span class="usage-label">{{ usageLabels[target.status] || '待使用' }}</span></button></div>
        <div class="scene-meta"><span>{{ usedCount }} / {{ targets.length }} 个词已用出 · {{ difficultyLabels[session.difficulty] }} · {{ strictnessLabels[session.strictness] }}纠错</span><label><input v-model="showTranslations" type="checkbox"> 中文提示</label></div>
      </header>
      <div class="conversation" role="log" aria-label="对话记录" aria-live="polite" aria-relevant="additions"><article v-for="(message, index) in session.messages || []" :key="message.id || `${session.id}-${index}`" :class="['message', message.role === 'user' ? 'from-user' : 'from-ai']"><div class="message-meta"><span>{{ message.role === 'user' ? '你' : currentScene?.role || 'AI' }}</span><button v-if="message.role !== 'user'" class="read-button" type="button" :disabled="isRecording || isTranscribing" :aria-label="`朗读第 ${index + 1} 条回复`" @click="read(message.text)">{{ isSpeaking ? '■ 停止' : '◖ 朗读' }}</button><span v-if="message.helpLevel >= 3" class="muted">跟读提示</span></div><div class="bubble"><PracticeText :text="message.text" :targets="targets" :corrections="message.role === 'user' ? message.corrections || [] : []" /><p v-if="showTranslations && message.translation" class="translation">{{ message.translation }}</p></div><AiUsage :usage="message.usage" label="本条回复消耗" /></article><div v-if="busy" class="thinking" role="status">{{ active ? 'AI 正在组织回复…' : '正在保存练习…' }}</div><div ref="conversationEnd"></div></div>
      <div v-if="active" class="composer">
        <div v-if="session.help" class="help-card" aria-live="polite"><div class="section-heading"><strong>{{ session.help.level === 2 ? '提示词' : session.help.level === 3 ? '试着用英文说' : '跟读示范句' }}</strong><span class="muted">帮助 {{ session.help.level }} / 4</span></div><p v-if="session.help.hint" class="help-hint">{{ session.help.hint }}</p><p v-if="session.help.example" class="example">{{ session.help.example }}</p><p v-if="session.help.translation" class="muted">{{ session.help.translation }}</p><div v-if="session.help.example" class="button-row"><button class="text-button" :disabled="isRecording || isTranscribing" @click="read(session.help.example)">◖ 听一遍</button><button class="text-button" :disabled="working" @click="insertExample">填入输入框，再试着表达</button></div></div>
        <p v-if="waitingHelp && !session.help" class="waiting-hint">慢慢想，没关系。需要时点「不会说？」获取提示。</p>
        <form @submit.prevent="send"><label for="practice-expression" class="input-label">你的回答 <span>可以夹中文，也可以用麦克风输入</span></label><textarea id="practice-expression" v-model="draft" rows="3" maxlength="2000" :disabled="busy || isRecording || isTranscribing || isStarting" placeholder="试着用英语回答。不会的部分可以写中文…" @keydown="keyboard"></textarea><div class="composer-controls"><div class="input-tools"><button class="btn mic-button" type="button" :class="{ recording: isRecording }" :disabled="busy || isTranscribing || isStarting || (!isRecording && !voiceAvailable)" :aria-pressed="isRecording" @click="toggleMicrophone">{{ isStarting ? '连接麦克风…' : isTranscribing ? '正在识别…' : isRecording ? `■ 完成录音 ${elapsedSeconds}s` : '♩ 麦克风' }}</button><button v-if="isRecording || isTranscribing || isStarting" class="text-button" type="button" @click="speech.cancel()">取消</button><button class="btn help-button" type="button" :disabled="working" @click="help()">不会说？</button></div><button class="btn btn-primary send-button" type="submit" :disabled="working || !draft.trim()">{{ busy ? '请稍候…' : '发送 ↑' }}</button></div></form>
        <div v-if="session.help" class="help-options"><label>求助词 <select v-model="selectedWord" :disabled="working"><option v-for="target in targets" :key="target.word" :value="target.word">{{ target.word }} · {{ target.sense }}</option></select></label><button v-for="level in [2, 3, 4]" :key="level" type="button" class="text-button" :disabled="working" @click="help(level)">{{ level }} · {{ helpLabels[level] }}</button></div>
        <p v-if="isRecording" role="status" class="recording-note">正在录音，最长 {{ maxSeconds }} 秒。完成后先检查文字，再发送。</p><p v-if="voiceError" role="status" class="note error">{{ voiceError }}</p><p v-else-if="!voiceAvailable && !voiceLoading" class="note"><template v-if="!voiceSupported">当前浏览器无法录音，请使用支持麦克风的浏览器，并通过 HTTPS 或 localhost 打开。</template><template v-else>{{ voiceReason || '语音识别尚未配置，可先打字练习。' }} <router-link to="/settings" class="small-link">查看设置</router-link></template></p><p v-else class="note">{{ isTranscribing ? '语音正在转成文字，识别后可以修改。' : 'Ctrl / ⌘ + Enter 发送 · 点击目标词看释义 · 浅色下划线点开看建议' }}</p>
        <div class="session-footer"><span class="muted">帮助越少，独立使用的记忆证据越强。</span><button class="text-button" :disabled="working" @click="finish">结束对话，查看小结 →</button></div>
      </div>
    </section>
    <section v-if="session?.status === 'analyzing'" class="card report-status" aria-live="polite"><span class="eyebrow">对话已保存</span><h2>正在整理你的练习小结…</h2><p>检查完整对话、目标词义项和薄弱点，并准备一轮短句练习。</p><p class="muted">离开页面后也能从最近练习回来查看。</p><button class="text-button" :disabled="busy" @click="refreshCurrent">刷新小结</button></section>
    <section v-if="session?.status === 'report_failed'" class="card report-status" role="status"><h2>对话已保存，小结暂未生成</h2><p>{{ session.reportError || '暂时无法完成分析，请稍后重试。' }}</p><button class="btn btn-primary" :disabled="busy" @click="retryReport">{{ busy ? '正在重试…' : '重新生成小结' }}</button></section>
    <section v-if="report" class="card report" aria-labelledby="report-title"><span class="eyebrow">这一轮，你做得怎么样</span><h2 id="report-title">练习小结</h2><p>{{ report.summary }}</p>
      <h3>目标词使用情况</h3><div class="usage-report"><div v-for="target in report.targetUsage || targets" :key="target.word + ':' + target.sense" class="usage-row"><span><strong>{{ target.word }}</strong> · {{ target.sense }}</span><span :class="['usage-badge', target.status]">{{ usageLabels[target.status] || '待使用' }}<small v-if="target.helpLevel"> · 帮助 {{ target.helpLevel }} 级</small></span></div></div>
      <h3>值得改进的表达 <span class="muted">{{ (report.corrections || []).slice(0, 5).length }} 条</span></h3><p v-if="!report.corrections?.length" class="muted">这一轮没有需要展开的纠错，继续保持。</p><article v-for="(correction, index) in (report.corrections || []).slice(0, 5)" :key="index" class="correction-card"><span :class="['correction-tag', { sense: ['word_sense', 'sense', 'sense_misuse'].includes(correction.type) }]">{{ correctionLabels[correction.type] || '表达建议' }}</span><p class="original"><span>原句</span>{{ correction.originalSentence || correction.original }}</p><p class="corrected"><span>改后</span>{{ correction.correctedSentence || correction.replacement }}</p><p class="reason">{{ correction.explanation }}</p></article>
      <h3>回到复习队列</h3><p v-if="report.reviewWords?.length"><span v-for="word in report.reviewWords" :key="word.id || word.spelling" class="weak-word">{{ word.spelling }}<small v-if="wordTags(word.tags)"> · {{ wordTags(word.tags) }}</small></span></p><p v-else class="muted">这一轮没有新增需要回流的词。</p><p v-if="report.unmatchedWords?.length" class="note">词库暂未收录：{{ report.unmatchedWords.join('、') }}。可以先做下方短句练习。</p><button v-if="report.reviewWords?.length" class="btn btn-secondary" :disabled="working" @click="startReview">{{ startingReview ? '正在准备复习…' : '去复习薄弱词 →' }}</button>
      <div v-if="report.grammarWeaknesses?.length" class="grammar-note"><h3>留意这些表达习惯</h3><ul><li v-for="item in report.grammarWeaknesses" :key="typeof item === 'string' ? item : JSON.stringify(item)">{{ typeof item === 'string' ? item : item.description || item.label || item.type }}</li></ul></div>
      <section v-if="report.reinforcement?.length" class="reinforcement" aria-labelledby="reinforcement-title"><h3 id="reinforcement-title">再说一句，巩固薄弱点</h3><p class="muted">试着用目标词写一句英文，再对照参考表达。</p><form v-for="(item, index) in report.reinforcement" :key="index" class="short-practice" @submit.prevent="checkShort(index)"><label :for="`short-${index}`"><strong>{{ index + 1 }} · {{ item.word }}</strong> {{ item.prompt }}</label><textarea :id="`short-${index}`" v-model="shortAnswers[index]" rows="2" maxlength="1000" placeholder="写下你的英文表达…"></textarea><div class="button-row"><button class="btn btn-secondary compact" :disabled="!shortAnswers[index]?.trim()">对照答案</button><button class="text-button" type="button" @click="revealedAnswers.includes(index) ? revealedAnswers = revealedAnswers.filter(value => value !== index) : revealedAnswers.push(index)">{{ revealedAnswers.includes(index) ? '收起' : '查看' }}参考</button></div><div v-if="checkedAnswers.includes(index) || revealedAnswers.includes(index)" class="short-answer"><p v-if="checkedAnswers.includes(index)" class="note">{{ shortMatches(index, item.answer) ? '与你的参考表达一致。试着再独立说一遍。' : '表达可以有多种说法。对照下面的用词和结构，再完善你的句子。' }}</p><strong>{{ item.answer }}</strong><p>{{ item.explanation }}</p><button type="button" class="text-button" @click="read(item.answer)">◖ 听参考表达</button></div></form></section>
    </section>
    <div v-if="session && !active" class="after-session"><button class="btn btn-primary" :disabled="working" @click="backToScenes">再选一个场景 →</button></div>
    <section v-if="sessions.length" class="session-history" aria-labelledby="recent-practice"><div class="section-heading"><h2 id="recent-practice">最近练习</h2><span class="muted">可恢复对话和小结</span></div><button v-for="item in sessions.slice(0, 10)" :key="item.id" class="history-item" type="button" :disabled="working || item.id === session?.id" @click="restore(item.id)" :aria-label="`${item.scene?.title || scenes.find(value => value.id === item.sceneId)?.title || '情境练习'}，${sessionLabels[item.status]}`"><span><strong>{{ item.scene?.title || scenes.find(value => value.id === item.sceneId)?.title || '情境练习' }}</strong><small>{{ formatDate(item.updatedAt || item.createdAt) }}</small></span><span>{{ item.id === session?.id ? '当前练习' : sessionLabels[item.status] || '查看' }} →</span></button></section>
    <section v-if="history.length" class="legacy-history"><h2>以前的单次表达练习</h2><details v-for="item in history" :key="item.id"><summary>{{ legacyScenes.find(value => value.id === item.scene)?.title || scenes.find(value => value.id === item.scene)?.title || item.scene }} · {{ formatDate(item.created_at) }}</summary><p>{{ item.answer }}</p><p>{{ item.feedback?.corrected }}</p><p>{{ item.feedback?.summary }}</p><p v-for="(correction, index) in item.feedback?.corrections || []" :key="index">{{ correctionLabels[correction.type] || '表达建议' }}：{{ correction.original }} → {{ correction.replacement }}。{{ correction.explanation }}</p></details></section>
  </main>
</template>

<style scoped>
.practice { max-width: 850px; margin: auto; padding: 30px 20px 90px; }
.page-intro, .section-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }.page-intro { align-items: flex-start; }.page-intro .small-link { flex-shrink: 0; margin-top: 5px; }
.eyebrow { display: block; color: var(--accent-deep); font-size: 12px; letter-spacing: .06em; margin-bottom: 7px; }.section-sub { margin-bottom: 26px; }.section-heading h2 { margin: 0; font-size: 18px; }
.muted, .note { color: var(--ink-soft); font-size: 13px; }.note { margin: 12px 0; }.small-link, .text-button { color: var(--accent-deep); font-size: 13px; }.text-button { border: 0; background: transparent; padding: 4px; font-family: inherit; }.text-button:disabled { opacity: .45; cursor: not-allowed; }
.error { color: var(--bad); }.error-banner { background: var(--bad-soft); color: var(--bad); padding: 12px 16px; border-radius: 12px; font-size: 14px; }.notice { background: var(--hint-bg); color: var(--hint-ink); border-radius: 10px; padding: 10px 14px; font-size: 13px; }
.scene-picker { margin: 3px 0 24px; }.scene-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 13px; }.scene-option { text-align: left; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 14px; background: var(--bg-card); color: var(--ink); padding: 18px 16px; gap: 8px; }.scene-option.chosen { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); background: var(--accent-soft); }.scene-icon { font-size: 25px; line-height: 1.2; }.scene-option strong { font-size: 16px; }.scene-description { font-size: 12px; color: var(--ink-soft); flex: 1; }.scene-words { font-size: 12px; color: var(--accent-deep); }
.card { margin: 22px 0; }.setup { padding: 24px; }.scene-select { color: var(--ink-soft); font-size: 12px; }.scene-select select { max-width: 180px; margin-left: 6px; }.task-description { font-size: 15px; line-height: 1.8; margin: 14px 0; }.variant-options { display: flex; flex-wrap: wrap; gap: 16px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-top: 18px; font-size: 13px; }.variant-options legend { color: var(--ink-soft); padding: 0 5px; }.variant-options label { display: flex; gap: 6px; align-items: center; }
.target-list { display: flex; flex-wrap: wrap; gap: 8px; }.target-chip { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; font-family: inherit; font-size: 12px; background: var(--bg); border: 1px solid var(--line); color: var(--ink); border-radius: 10px; padding: 7px 10px; }.target-chip strong { font-size: 14px; }.target-chip > span { color: var(--ink-soft); }.target-chip.independent, .target-chip.assisted { background: var(--ok-soft); border-color: var(--ok); }.target-chip.weak { background: var(--warn-bg); border-color: var(--warn-ink); }.target-chip.focused { outline: 2px solid var(--accent); outline-offset: 2px; }.usage-label { font-size: 10px; }
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 24px; }.settings-grid label { display: grid; gap: 7px; font-size: 13px; }.settings-grid select { width: 100%; }select { border: 1px solid var(--line); padding: 7px 10px; border-radius: 8px; font: inherit; color: var(--ink); background: var(--bg-card); }textarea { width: 100%; display: block; box-sizing: border-box; margin: 10px 0; padding: 13px 15px; font: inherit; font-size: 15px; resize: vertical; border: 1px solid var(--line); border-radius: 12px; background: var(--bg-card); color: var(--ink); }textarea:disabled { opacity: .65; }
.conversation-shell { background: var(--bg-card); border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow); overflow: hidden; margin-top: 8px; }.scene-bar { padding: 22px 24px 16px; border-bottom: 1px solid var(--line); }.rounds { flex-shrink: 0; font-size: 12px; color: var(--ink-soft); padding: 6px 10px; border: 1px solid var(--line); border-radius: 999px; }.scene-meta { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-top: 16px; font-size: 11px; color: var(--ink-soft); }.scene-meta label { display: inline-flex; gap: 4px; align-items: center; }
.conversation { padding: 24px; max-height: 520px; min-height: 160px; overflow-y: auto; overscroll-behavior: contain; }.message { max-width: 88%; margin: 0 0 20px; }.message:last-of-type { margin-bottom: 4px; }.from-user { margin-left: auto; }.message-meta { display: flex; align-items: center; gap: 12px; margin: 0 3px 5px; color: var(--ink-soft); font-size: 11px; }.from-user .message-meta { justify-content: flex-end; }.read-button { font-size: 11px; border: 0; color: var(--accent-deep); background: transparent; padding: 2px 5px; }.read-button:disabled { opacity: .4; }.bubble { border-radius: 2px 15px 15px; background: var(--bg); padding: 12px 15px; border: 1px solid var(--line); font-size: 15px; }.from-user .bubble { border-radius: 15px 2px 15px 15px; background: var(--accent-soft); border-color: transparent; }.translation { color: var(--ink-soft); border-top: 1px solid var(--line); padding-top: 8px; margin-bottom: 0; font-size: 12px; }.thinking { font-size: 13px; color: var(--ink-soft); padding: 5px; }
.composer { border-top: 1px solid var(--line); padding: 18px 24px 15px; background: var(--bg-card); }.input-label { font-size: 13px; font-weight: 600; }.input-label span { font-size: 11px; font-weight: 400; color: var(--ink-soft); margin-left: 6px; }.composer-controls, .input-tools, .button-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }.composer-controls { justify-content: space-between; }.composer .btn { padding: 9px 15px; font-size: 13px; }.help-button { background: var(--hint-bg) !important; color: var(--hint-ink) !important; }.mic-button { background: var(--bg) !important; border: 1px solid var(--line); }.mic-button.recording { color: var(--bad) !important; background: var(--bad-soft) !important; }.send-button { min-width: 90px; }.help-options { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; padding-top: 14px; font-size: 11px; }.help-options label { color: var(--ink-soft); }.help-options select { max-width: 170px; padding: 4px; font-size: 11px; }.help-options .text-button { font-size: 11px; }
.help-card { background: var(--hint-bg); color: var(--hint-ink); border-radius: 12px; padding: 14px; margin-bottom: 16px; font-size: 13px; }.help-card p { margin: 8px 0; }.help-card .example { font-size: 16px; color: var(--ink); }.help-hint { font-weight: 600; }.waiting-hint { color: var(--hint-ink); font-size: 12px; margin-top: 0; }.recording-note { color: var(--bad); font-size: 12px; }.session-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); margin-top: 14px; padding-top: 10px; gap: 8px; }.session-footer .muted { font-size: 10px; }
.report-status h2, .report h2 { font-size: 21px; margin: 4px 0 12px; }.report-status p { font-size: 14px; }.report h3 { font-size: 16px; margin-top: 28px; }.usage-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 13px; }.usage-badge { flex-shrink: 0; color: var(--ink-soft); font-size: 12px; }.usage-badge.independent, .usage-badge.assisted { color: var(--ok); }.usage-badge.weak { color: var(--warn-ink); }.correction-card { padding: 16px 0; border-bottom: 1px solid var(--line); }.correction-tag { display: inline-flex; font-size: 11px; background: var(--hint-bg); color: var(--hint-ink); padding: 2px 8px; border-radius: 5px; }.correction-tag.sense { background: var(--warn-bg); color: var(--warn-ink); }.correction-card p { font-size: 14px; margin: 9px 0; overflow-wrap: anywhere; }.original { color: var(--ink-soft); }.corrected { color: var(--ok); }.original span, .corrected span { color: var(--ink-soft); font-size: 10px; margin-right: 12px; }.correction-card .reason { font-size: 12px; color: var(--ink-soft); }.weak-word { display: inline-block; padding: 4px 9px; background: var(--warn-bg); color: var(--warn-ink); border-radius: 6px; margin: 0 6px 6px 0; font-size: 14px; }.weak-word small { font-size: 10px; }
.grammar-note { margin-top: 22px; padding: 1px 14px 6px; background: var(--bg); border-radius: 10px; }.grammar-note h3 { margin-top: 16px; }.grammar-note ul { padding-left: 20px; font-size: 13px; }.short-practice { border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 14px 0; }.short-practice label { display: grid; gap: 6px; font-size: 13px; }.short-practice textarea { font-size: 14px; }.compact { padding: 8px 15px; font-size: 12px; }.short-answer { margin-top: 14px; background: var(--bg); padding: 12px; border-radius: 8px; font-size: 13px; }.short-answer p { margin: 6px 0; font-size: 12px; color: var(--ink-soft); }.after-session { text-align: center; margin: 24px 0; }
.session-history, .legacy-history { margin-top: 34px; }.history-item { display: flex; width: 100%; gap: 15px; justify-content: space-between; align-items: center; padding: 14px 2px; border: 0; border-bottom: 1px solid var(--line); background: transparent; font: inherit; color: var(--ink); text-align: left; }.history-item > span:last-child { color: var(--accent-deep); font-size: 12px; flex-shrink: 0; }.history-item strong { font-size: 14px; }.history-item small { display: block; font-size: 11px; color: var(--ink-soft); }.history-item:disabled { opacity: .5; cursor: default; }.legacy-history h2 { font-size: 16px; }details { border-top: 1px solid var(--line); padding: 15px 0; font-size: 13px; }summary { cursor: pointer; }
@media (max-width: 600px) { .practice { padding: 22px 12px 80px; }.page-intro { display: block; }.page-intro .small-link { display: inline-block; margin: -12px 0 20px; }.scene-grid { gap: 8px; }.scene-option { padding: 13px 10px; }.scene-option strong { font-size: 14px; }.scene-description { font-size: 11px; }.scene-words { font-size: 10px; overflow-wrap: anywhere; }.setup, .card { padding: 18px; }.setup > .section-heading { flex-wrap: wrap; }.scene-select { width: 100%; }.scene-select select { max-width: calc(100% - 70px); }.settings-grid { grid-template-columns: 1fr; gap: 12px; }.scene-bar { padding: 18px 16px 14px; }.conversation { padding: 18px 14px; max-height: 460px; }.message { max-width: 94%; }.bubble { padding: 10px 12px; }.composer { padding: 16px 14px; }.input-label span { display: block; margin-left: 0; }.input-tools { gap: 5px; }.composer .btn { padding: 9px 10px; }.scene-meta { font-size: 10px; }.usage-row { align-items: flex-start; flex-wrap: wrap; gap: 5px; }.short-practice { padding: 12px; }.session-footer { display: block; }.session-footer .text-button { display: block; margin-top: 5px; }.rounds { padding: 4px 8px; }.target-chip { padding: 6px 8px; font-size: 11px; }.target-chip strong { font-size: 13px; } }
</style>
