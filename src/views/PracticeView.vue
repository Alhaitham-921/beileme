<script setup>
import {CLASSIC_VOCABULARY,withClassicVocabulary} from '../../shared/classicLearning.js'
import DialogueRecording from '../components/DialogueRecording.vue'
import {saveDialogueRecording,releaseRecordingMemory} from '../utils/dialogueRecordings.js'
import { workflowFor,WORKFLOW_ROUTES,workflowActorIds } from '../../shared/scenarioWorkflows.js'
import ScenarioWorkflowPanel from '../components/ScenarioWorkflowPanel.vue'
import { actorMessages } from '../utils/actorConversation.js'
import PracticeFollowups from '../components/PracticeFollowups.vue'
import NameAvatar from '../components/NameAvatar.vue'
import DialogueQuiz from '../components/DialogueQuiz.vue'
import SceneHintImage from '../components/SceneHintImage.vue'
import SpeechRecoveryControls from '../components/SpeechRecoveryControls.vue'
import { http } from '../api/client.js'
import AiUsage from '../components/AiUsage.vue'
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import PracticeWordPicker from '../components/PracticeWordPicker.vue'
import { useRoute, useRouter } from 'vue-router'
import { practice } from '../api'
import { useAuthStore } from '../stores/auth'
import { useAiStore } from '../stores/ai.js'
import { useAppStore } from '../stores/app'
import { usePracticeSpeech } from '../composables/usePracticeSpeech'
import PracticeText from '../components/PracticeText.vue'
import PracticeImage from '../components/PracticeImage.vue'
import { practiceDay, selectPracticeResume } from '../utils/practiceResume.js'
import { scenarioRequestDescription, DEFAULT_WORD_SCENARIO } from '../utils/scenarioRequest.js'
import { exportPracticeReport } from '../utils/practiceReportExport.js'
import { Capacitor } from '@capacitor/core'

const route = useRoute()
const practiceWords = ref([...new Set(String(route.query.words || '').split(',').map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 5))
const auth = useAuthStore()
const app = useAppStore(), router = useRouter(), startingReview = ref(false)
const scenes = ref([]), recommendations = ref([]), sessions = ref([]), legacyScenes = ref([]), history = ref([])
const savedScenes = ref([]), libraryTab = ref(practiceWords.value.length?'create':'classic'), description = ref(practiceWords.value.length ? DEFAULT_WORD_SCENARIO : ''), latestGeneratedId = ref(''), generationUsage = ref(null)
const descriptionError = ref(''), descriptionInput = ref(null)
const generatedSelections = new Map()
const aiStore = useAiStore(), aiMode = computed(() => aiStore.status?.mode ?? null)
const followupId=ref(null),transferTask=ref(null)
let sceneController=null,sceneRun=0
const fullJourney=ref(true),learningRoute=ref(''),transferVariation=ref(false),vocabularyCount=ref(8),autoProgress=ref(true)
const playbackRate=ref(1),onlyCurrentActor=ref(false),audioRevision=ref(0),pendingRecordings=new Map()
const recordingContext=()=>`${session.value?.id}:${session.value?.journey?.flow?.index??''}:${session.value?.journey?.activeActorId}`
const mode = ref('task'), maxTurns = ref(64), sceneFilter = ref(''), generating = ref(false)
const challenge = ref('standard'), challengeProgress = ref({items:[],hotelChangeUnlocked:false})
const sceneExamples = ['我想练习去国外咖啡店点餐。我对牛奶过敏，需要询问配料，再礼貌地更换饮品。', '模拟一次软件工程师英文面试。请追问我的项目经历，帮我练习解释技术方案和表达自己的优势。', '我想和新认识的外国同学聊电影，从推荐喜欢的电影开始，深入讨论角色的选择和不同的观点。']
const sceneIcons = { cafe:'☕',library:'▤',airport:'✈',restaurant: '♨', directions: '↗', hotel: '⌂', interview: '◎', shopping: '♧', campus: '◇' }
const drafts = new Map()
const sceneId = ref(''), variant = ref('river'), strictness = ref('standard'), difficulty = ref('beginner')
const session = ref(null), draft = ref(''), busy = ref(false), loading = ref(true), error = ref(''), notice = ref('')
const startError = ref(null), startErrorElement = ref(null)
const selectedWord = ref(''), showTranslations = ref(true), waitingHelp = ref(false), conversationEnd = ref(null)
const helpGenerating = ref(false)
const revealedAnswers = ref([]), shortAnswers = ref({}), checkedAnswers = ref([])
const exporting = ref(''), exportError = ref('')
const speech = usePracticeSpeech()
const { available: voiceAvailable, supported: voiceSupported, statusLoading: voiceLoading, statusReason: voiceReason,
  isRecording, isTranscribing, isStarting, error: voiceError, transcript, elapsedSeconds, maxSeconds, isSpeaking,
  waveform, microphoneName, recordingUrl, inputStatus,
  microphones, selectedMicrophone, rawAudio, deviceError, isRefreshingMicrophones } = speech
let pollTimer, idleTimer, disposed = false, pollFailures = 0
const scene = computed(() => [...savedScenes.value, ...scenes.value].find(item => item.id === sceneId.value))
const selectionKey = computed(() => [...practiceWords.value].sort((a, b) => a - b).join(','))
const needsWordScene = computed(() => practiceWords.value.length > 0 &&
  generatedSelections.get(sceneId.value) !== selectionKey.value)
const visibleScenes = computed(() => (libraryTab.value === 'saved' ? savedScenes.value : scenes.value).filter(item =>
  `${item.title} ${item.task} ${(item.words || []).join(' ')}`.toLowerCase().includes(sceneFilter.value.trim().toLowerCase())))
const chosenVariant = computed(() => {
  const variants = scene.value?.variants
  if (Array.isArray(variants)) return variants.find(item => item.id === variant.value || item.variant === variant.value)
  return variants?.[variant.value]
})
const selectedScene = computed(() => withClassicVocabulary({ ...scene.value, ...chosenVariant.value, id: scene.value?.id, variant: chosenVariant.value?.id || scene.value?.variant || null },vocabularyCount.value))
const vocabularyPool=computed(()=>CLASSIC_VOCABULARY[selectedScene.value?.sourceSceneId||selectedScene.value?.id])
const previewActors=computed(()=>workflowPreview.value?.actors||selectedScene.value?.actors||[])
const active = computed(() => session.value?.status === 'active')
const workflowPreview=computed(()=>selectedScene.value?.id ? workflowFor(selectedScene.value,{route:learningRoute.value,transfer:transferVariation.value}) : null)
const routeOptions=computed(()=>WORKFLOW_ROUTES[selectedScene.value?.sourceSceneId||selectedScene.value?.id]||[])
const stageTranscriptHidden=()=>false
const preparing = computed(() => active.value && session.value?.journey?.phase === 'preparation')
const talking = computed(() => active.value && !preparing.value)
const activeActor = computed(() => session.value?.scene?.actors?.find(actor=>actor.id===session.value?.journey?.activeActorId))
const availableActors=computed(()=>session.value?.scene?.actors.filter(a=>workflowActorIds(session.value).includes(a.id))||[])
const plannedTurns=computed(()=>maxTurns.value)
const conversationMessages = computed(() => active.value && onlyCurrentActor.value ? actorMessages(session.value || {}) : session.value?.messages || [])
const actorDrafts = new Map()
const completedGoals = computed(() => session.value?.journey?.goals?.filter(goal=>goal.completed).length||0)
const learnerName = computed(() => currentScene.value?.userRoleEnglish || 'Learner')
function avatarName(message) { return message.role==='user'?learnerName.value:session.value?.scene?.actors?.find(actor=>actor.id===message.actorId)?.englishName||'Partner' }
const working = computed(() => busy.value || generating.value || exporting.value || startingReview.value || isRecording.value || isTranscribing.value || isStarting.value)
const targets = computed(() => session.value?.targetUsage || selectedScene.value?.targets || [])
const currentScene = computed(() => session.value?.scene || selectedScene.value)
const sceneIsSaved = computed(() => savedScenes.value.some(item => item.id === currentScene.value?.id ||
  (item.sourceSceneId === currentScene.value?.id && (item.variant || null) === (currentScene.value?.variant || null) && item.difficulty === (session.value?.difficulty || difficulty.value))))
const report = computed(() => session.value?.report)
const resumableSession = computed(() => selectPracticeResume(
  sessions.value.filter(item => item.status === 'active'), remembered(),
))
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
const speechRate = computed(() => playbackRate.value)
const storageKey = () => auth.user?.id ? `beileme:practice-session:${auth.user.id}` : null
const unwrap = data => data?.session || data

function remember(id) {
  try { const key = storageKey(); if (key) id ? localStorage.setItem(key, JSON.stringify({ id: String(id), day: practiceDay() })) : localStorage.removeItem(key) } catch { /* Private mode may disable storage. */ }
}
function remembered() { try { const key = storageKey(); return key ? localStorage.getItem(key) : null } catch { return null } }
function formatDate(value) { return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' }
function clearTimers() { clearTimeout(pollTimer); clearTimeout(idleTimer) }
function resetIdle() {
  clearTimeout(idleTimer); waitingHelp.value = false
  if (talking.value && !working.value) idleTimer = setTimeout(() => { waitingHelp.value = true }, 12000)
}
function scrollConversation() { nextTick(() => conversationEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })) }
function applySession(data) {
  if (disposed) return
  const next = unwrap(data)
  if (!next?.id) throw new Error('练习进度未能读取，请恢复进度后重试。')
  const changedSession = session.value?.id !== next.id
  session.value = next; startError.value = null; remember(next.id)
  if (route.query.session && String(route.query.session) !== String(next.id)) router.replace({ path: '/practice', query: { session: next.id } })
  const index = sessions.value.findIndex(item => item.id === next.id)
  const summary = { ...next, updatedAt: next.updatedAt || new Date().toISOString() }
  if (index === -1) sessions.value.unshift(summary)
  else sessions.value.splice(index, 1, summary)
  if (changedSession) selectedWord.value = next.help?.useMemoryWord === false ? '' : next.help?.word || ''
  if (selectedWord.value && !next.scene?.targets?.some(item => item.word === selectedWord.value)) selectedWord.value = ''
  resetIdle(); clearTimeout(pollTimer)
  if (next.status === 'analyzing') schedulePoll()
}
async function loadList() {
  const data = await practice.list()
  if (disposed) return
  scenes.value = data.scenes || []; recommendations.value = data.recommendations || []
  savedScenes.value = data.savedScenes || []
  challengeProgress.value = data.challengeProgress || {items:[],hotelChangeUnlocked:false}
  sessions.value = data.sessions || []; legacyScenes.value = data.legacyScenes || []; history.value = data.history || []
  if (!sceneId.value && libraryTab.value === 'classic') sceneId.value = suggestedScenes.value[0]?.id || scenes.value[0]?.id || ''
  if (!session.value && !sceneId.value && data.recommendedDifficulty) difficulty.value = data.recommendedDifficulty
}
async function load() {
  loading.value = true; error.value = ''
  try {
    await loadList()
    if (route.query.session) {
      const id = Number(route.query.session)
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('练习编号无效，请从最近练习中重新打开。')
      applySession(await practice.getSession(id))

      return
    }
    if(route.query.scene && scenes.value.some(s=>s.id===route.query.scene)){libraryTab.value='classic';sceneId.value=String(route.query.scene)}
    if(route.query.followup){const task=await http.get('/practice/followups/'+encodeURIComponent(route.query.followup));startTransfer(task);return}
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
function selectScene(id,scrollToSetup=false) {
  challenge.value = 'standard'; learningRoute.value='';transferVariation.value=false
  if(scrollToSetup)nextTick(()=>document.getElementById('task-title')?.scrollIntoView({behavior:'smooth',block:'start'}))
  sceneId.value = id; variant.value = 'river'; error.value = ''; notice.value = ''; startError.value = null
  const saved = savedScenes.value.find(item => item.id === id)
  if (saved?.difficulty) difficulty.value = saved.difficulty
  if (saved?.memoryImage) { mode.value = 'task'; maxTurns.value = 3 }
  else if (maxTurns.value === 3) maxTurns.value = 16
}
function changeTab(tab) {
  if (working.value) return
  libraryTab.value = tab; sceneFilter.value = ''
  selectScene(tab === 'create' ? latestGeneratedId.value : tab === 'saved' ? savedScenes.value[0]?.id || '' : suggestedScenes.value[0]?.id || scenes.value[0]?.id || '')
}
function addSavedScene(value) {
  const index = savedScenes.value.findIndex(item => item.id === value.id)
  if (index < 0) savedScenes.value.unshift(value)
  else savedScenes.value.splice(index, 1, value)
}
async function generateScene() {
  if (working.value) return
  const brief = scenarioRequestDescription(description.value, practiceWords.value)
  if (brief.error) {
    descriptionError.value = brief.error
    await nextTick(); descriptionInput.value?.focus()
    return
  }
  descriptionError.value = ''; description.value = brief.description
  const requestedWords = selectionKey.value
  sceneController=new AbortController();const run=++sceneRun
  generating.value = true; error.value = ''; notice.value = ''; generationUsage.value = null
  try {
    const status = await aiStore.loadStatus()
    if (disposed || run!==sceneRun || !status) return
    if (status.mode === 'none') { error.value = '未检测到可用的文字 AI，请在设置中确认 API 已保存并启用，再重试。'; return }
    const data = await practice.generateScene({completeWorkflow:fullJourney.value, description: brief.description, difficulty: difficulty.value, ...(followupId.value?{followupId:followupId.value}:{}),...(practiceWords.value.length ? { wordIds: practiceWords.value } : {}) },{signal:sceneController.signal})
    if (disposed || run!==sceneRun) return
    generatedSelections.set(data.scene.id, requestedWords)
    addSavedScene(data.scene); latestGeneratedId.value = data.scene.id; selectScene(data.scene.id)
    generationUsage.value = data.usage; notice.value = '场景已生成并保存到「我的场景」。先看看角色和词汇，再开始练习。'
  } catch (e) { if(run===sceneRun){error.value = e.message; generationUsage.value = e.details?.usage || null} }
  finally { if(run===sceneRun)generating.value = false }
}
function cancelScene(){sceneRun++;sceneController?.abort();generating.value=false;notice.value='已取消等待，需求已保留。后台可能已生成场景，可先刷新我的场景，避免重复生成。'}
function startTransfer(task){backToScenes();transferTask.value=task;followupId.value=task.id;practiceWords.value=[];libraryTab.value='create';description.value='请换一个不同于'+task.sourceTitle+'的日常场景，让我独立练习使用 '+task.word+'。';notice.value='请先修改下方需求，选择新的地点、角色和任务，再点击生成。'}
async function saveScene() {
  if (working.value || sceneIsSaved.value || !currentScene.value?.id) return
  busy.value = true; error.value = ''
  try {
    const source = currentScene.value
    const data = await practice.saveScene({ sceneId: session.value?.sceneId || sceneId.value, difficulty: session.value?.difficulty || difficulty.value,
      ...(source.id === 'bank' ? { variant: session.value?.variant || variant.value } : {}) })
    addSavedScene(data.scene); notice.value = '已保存到「我的场景」，以后可以回顾词汇或重新练习。'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
function prepareCustomVariation(){const previous=session.value.scene;backToScenes();libraryTab.value='create';fullJourney.value=true;description.value=((previous.description||previous.baseTask||previous.task||previous.title)+'。保留交流目标和用户身份，更改日期、数量、费用或需要协商的问题，生成另一套完整流程供复练。').slice(0,1500);notice.value='请核对变化条件，再点击生成新情境。已有对话会保留。'}
async function repeatSession(id,options={}) {
  if (working.value) return
  if (session.value) drafts.set(session.value.id, draft.value)
  busy.value = true; error.value = ''; notice.value = ''; speech.cancel(); speech.stopSpeaking(); clearTimers(); pollFailures = 0
  try {
    applySession(await practice.repeatSession(id,{prepareWords:true,...options})); draft.value = '';
    revealedAnswers.value = []; checkedAnswers.value = []; shortAnswers.value = {}; scrollConversation()
  } catch (e) { error.value = e.message }
  finally { busy.value = false; resetIdle() }
}
async function start(prepareWords = true) {
  if (working.value || !sceneId.value) return
  if (needsWordScene.value) {
    const { title, location, userRole, role, task } = selectedScene.value
    description.value = [`请以「${title}」为模板，把所选词自然融入对话。`, location && `地点为${location}。`,
      userRole && `我的身份是${userRole}。`, role && `AI 扮演${role}。`, task].filter(Boolean).join('').slice(0, 1500)
    changeTab('create')
    notice.value = '已带入场景和所选词。确认需求后，生成包含这些词的新场景。'
    await nextTick()
    document.getElementById('scenario-description')?.focus()
    return
  }
  busy.value = true; error.value = ''; notice.value = ''; draft.value = ''; startError.value = null
  speech.cancel(); speech.stopSpeaking(); clearTimers(); pollFailures = 0
  try {
    applySession(await practice.startSession({ sceneId: sceneId.value, strictness: strictness.value, difficulty: difficulty.value, mode: mode.value, maxTurns: maxTurns.value,flexibleLength:true,autoProgress:autoProgress.value,textSupport:true,...(vocabularyPool.value?{vocabularyCount:vocabularyCount.value}:{}), prepareWords:Boolean(prepareWords),challenge:challenge.value,fullJourney:mode.value==='task'&&fullJourney.value&&Boolean(workflowPreview.value),learningRoute:learningRoute.value,transfer:transferVariation.value, ...(sceneId.value === 'bank' ? { variant: variant.value } : {}) }))
    ; revealedAnswers.value = []; checkedAnswers.value = []; shortAnswers.value = {}
    scrollConversation()
  } catch (e) {
    startError.value = { code: e.code || '', message: e.message || '对话暂时无法开始，请稍后重试。' }
    await nextTick()
    startErrorElement.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  finally { busy.value = false; resetIdle() }
}
async function restore(id) {
  if (working.value) return
  if (session.value) drafts.set(session.value.id, draft.value)
  busy.value = true; error.value = ''; notice.value = ''
  speech.cancel(); speech.stopSpeaking(); clearTimers(); pollFailures = 0
  try {
    applySession(await practice.getSession(id)); draft.value = drafts.get(id) || '';
    revealedAnswers.value = []; checkedAnswers.value = []; shortAnswers.value = {}; scrollConversation()
  } catch (e) { error.value = e.message }
  finally { busy.value = false; resetIdle() }
}
async function recoverAfterError(caught, id, turnBefore) {
  error.value = caught.message
  try {
    if (session.value?.id !== id) return
    applySession(await practice.getSession(id))
    if (session.value.turnCount > turnBefore) { const clips=pendingRecordings.get(recordingContext());if(clips?.length){await saveDialogueRecording(auth.user.id,id,turnBefore+1,clips);audioRevision.value++;pendingRecordings.delete(recordingContext())}draft.value = ''; notice.value = '刚才的回答已保存，已恢复最新进度。'; error.value = '' }
  } catch { /* Preserve the draft for manual recovery. */ }
}
async function send() {
  const text = draft.value.trim()
  if (working.value || !active.value || !text) return
  const id = session.value.id, expectedTurn = session.value.turnCount,voiceContext=recordingContext(),voiceClips=[...(pendingRecordings.get(recordingContext())||[])]
  busy.value = true; error.value = ''; notice.value = ''; clearTimeout(idleTimer); speech.stopSpeaking()
  try { applySession(await practice.turn(id, { text, expectedTurn, expectedRevision:session.value.journey?.revision, actorId:activeActor.value?.id }));if(voiceClips.length){const saved=await saveDialogueRecording(auth.user.id,id,expectedTurn+1,voiceClips);audioRevision.value++;pendingRecordings.delete(voiceContext);speech.discardRecording();if(!saved.persistent)notice.value='本机存储不可用，原录音本页仍可回放。'} draft.value = ''; scrollConversation() }
  catch (e) { await recoverAfterError(e, id, expectedTurn);if(session.value?.turnCount>expectedTurn&&voiceClips.length){await saveDialogueRecording(auth.user.id,id,expectedTurn+1,voiceClips);audioRevision.value++;pendingRecordings.delete(voiceContext);speech.discardRecording()}scrollConversation() }
  finally { busy.value = false; resetIdle() }
}
const nextHelpLevel = computed(() => Math.min(4, Math.max(2, (session.value?.help?.level || 1) + 1)))
async function journeyAction(kind, payload = {}) {
  if (working.value || !session.value) return
  const id=session.value.id
  busy.value=true;error.value='';speech.stopSpeaking();clearTimeout(idleTimer)
  try {
    const body={...payload,expectedRevision:session.value.journey.revision}
    let data
    if(kind==='prepare'){delete body.answer;data=await practice.prepare(id,body)}
    else if(kind==='workflow'){
      if(['advance','skip','previous'].includes(payload.action))actorDrafts.set(`${id}:${session.value.journey.flow.index}:${activeActor.value?.id}`,draft.value)
      data=await practice.workflow(id,body)
    }
    else if(kind==='begin')data=await practice.begin(id,body)
    else if(kind==='actor'){
      actorDrafts.set(`${id}:${session.value.journey.flow?.index??''}:${activeActor.value?.id}`, draft.value)
      data=await practice.switchActor(id,{...body,expectedTurn:session.value.turnCount})
    }
    else data=await practice.consolidate(id,body)
    applySession(data)
    if(kind==='actor'||(kind==='workflow'&&['advance','skip','previous'].includes(payload.action))){draft.value=actorDrafts.get(`${id}:${session.value.journey.flow?.index??''}:${activeActor.value?.id}`)||'';scrollConversation()}
  }catch(e){error.value=e.message;try{applySession(await practice.getSession(id))}catch{}}
  finally{busy.value=false;resetIdle()}
}
const helpLabels = { 2: '接话思路', 3: '参考回复', 4: '完整示范句' }
async function help(level = nextHelpLevel.value) {
  if (working.value || !active.value) return
  const id = session.value.id
  busy.value = true; helpGenerating.value = true; error.value = ''; notice.value = ''; speech.stopSpeaking(); clearTimeout(idleTimer)
  try {
    applySession(await practice.help(id, { level, useMemoryWord: Boolean(selectedWord.value), word: selectedWord.value || undefined, text: draft.value.trim() || undefined, expectedTurn: session.value.turnCount, expectedRevision: session.value.journey?.revision, actorId: activeActor.value?.id }))
    if (level >= 3 && session.value.help?.example) speech.speak(session.value.help.example, { rate: speechRate.value })
    scrollConversation()
  } catch (e) { error.value = e.message; try { applySession(await practice.getSession(id)) } catch { /* Manual recovery remains available. */ } }
  finally { busy.value = false; helpGenerating.value = false; resetIdle() }
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
  if (working.value) return
  if (session.value) drafts.set(session.value.id, draft.value)
  speech.cancel(); speech.stopSpeaking(); clearTimers(); remember(null)
  session.value = null; draft.value = ''; error.value = ''; notice.value = ''; selectedWord.value = ''
  if (route.query.session) router.replace({ path: '/practice' })
  loadList().catch(e => { error.value = e.message })
}
async function openScenarioCreator() {
  if (working.value) return
  backToScenes()
  changeTab('create')
  await nextTick()
  descriptionInput.value?.focus()
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
async function exportReport(format) {
  if (working.value || !session.value?.report) return
  exporting.value = format; exportError.value = ''; notice.value = ''
  try {
    const name = await exportPracticeReport(session.value, format)
    if (name) notice.value = Capacitor.isNativePlatform()
      ? '小结已生成并打开系统分享，可选择应用保存或发送。'
      : `${format === 'pdf' ? 'PDF' : 'PNG 图片'}已生成，请在浏览器下载列表中查看。`
  } catch (e) { exportError.value = e.message || '导出失败，请重试。' }
  finally { exporting.value = '' }
}
watch(() => session.value?.id, () => { exportError.value = '' })
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
watch(transcript, text => { if (text && active.value) { const clip=speech.getRecording();if(clip){const key=recordingContext();pendingRecordings.set(key,[...(pendingRecordings.get(key)||[]),{...clip,transcript:text}])}draft.value = `${draft.value.trim()}${draft.value.trim() ? ' ' : ''}${text}`; notice.value = '识别文字已填入输入框，请检查后发送。' } })
watch([isRecording, isTranscribing, isStarting], resetIdle)
watch(draft, resetIdle)
watch([description, selectionKey], () => { descriptionError.value = '' })
watch(sceneFilter, () => {
  if (libraryTab.value !== 'create' && !visibleScenes.value.some(item => item.id === sceneId.value)) selectScene(visibleScenes.value[0]?.id || '')
})
async function extendRound(){if(working.value||!session.value||session.value.maxTurns>=240)return;busy.value=true;error.value='';try{applySession(await practice.extendLength(session.value.id,{maxTurns:Math.min(240,session.value.maxTurns+32),expectedRevision:session.value.journey.revision}));notice.value='已增加练习轮次，继续当前对话。'}catch(e){error.value=e.message}finally{busy.value=false}}
const exposureSynced=new Set()
watch(()=>[session.value?.id,session.value?.journey?.flow?.index],async()=>{const current=session.value,flow=current?.journey?.flow;if(!flow||flow.textSupport||current.status!=='active'||current.journey.phase!=='conversation'||exposureSynced.has(current.id))return;exposureSynced.add(current.id);try{const updated=await practice.workflow(current.id,{action:'text',stageId:current.scene.workflow.stages[flow.index].id,expectedRevision:current.journey.revision});if(session.value?.id===current.id&&session.value.journey.revision===current.journey.revision)applySession(updated)}catch{/* A concurrent action will keep its own progress. */}})
watch(showTranslations,value=>{try{localStorage.setItem('beileme:dialogue-translation:'+auth.user?.id,JSON.stringify(value))}catch{}})
onMounted(()=>{try{const value=localStorage.getItem('beileme:dialogue-translation:'+auth.user?.id);if(value!==null)showTranslations.value=JSON.parse(value)}catch{}})
onMounted(load)
onMounted(async () => {
  try { await aiStore.loadStatus() } catch { /* Generation refreshes status and displays any service error. */ }
})
onUnmounted(() => { disposed = true;if(session.value)releaseRecordingMemory(auth.user?.id,session.value.id);pendingRecordings.clear(); sceneRun++; sceneController?.abort(); clearTimers(); speech.cancel(); speech.stopSpeaking() })
</script>

<template>
  <main class="practice">
    <nav v-if="session" class="journey-steps" aria-label="任务流程"><span :class="{current:preparing}">1 · 认识词汇</span><span :class="{current:talking}">2 · 情境交流</span><span :class="{current:Boolean(report)}">3 · 小结巩固</span></nav><header class="page-intro"><div><span class="eyebrow">AI 情境对话 · 从想说到会说</span><h1 v-if="!session" class="section-title">{{ currentScene?.memoryImage ? "看图说英语 · 三轮交流" : "选个生活场景，开口练英语" }}</h1><p v-if="!session" class="section-sub">选场景 → 调整词汇与长度 → 开始交流。AI 会按任务进度衔接下一步，你也可以随时继续追问。</p></div><div class="button-row">
      <button v-if="session" type="button" class="btn btn-primary" :disabled="working" @click="openScenarioCreator">＋ 创建新情境</button>
      <router-link class="small-link" to="/study">返回背词 →</router-link>
    </div></header>
    <p v-if="error && (!talking)" role="alert" class="error-banner">{{ error }} <button class="text-button" :disabled="working" @click="session ? refreshCurrent() : load()">{{ session ? '恢复最新进度' : '重新加载' }}</button></p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <p v-if="loading"><LoadingState>正在准备你的练习场景…</LoadingState></p>
    <template v-if="!session && !loading">
      <p class="note"><router-link class="small-link" to="/practice/demo">先试一轮示范 →</router-link>
        · {{ aiMode === 'none' ? '正式对话需要配置文字 AI 服务。' : '示范使用预设内容，免费体验。' }}
        <router-link v-if="aiMode === 'none'" class="small-link" to="/settings">去设置</router-link>
      </p>
      <p v-if="resumableSession && !practiceWords.length && !transferTask" class="note">
        <button type="button" class="text-button" :disabled="working" @click="restore(resumableSession.id)">继续上次练习 →</button>
        <span v-if="resumableSession.scene?.title">{{ resumableSession.scene.title }}</span>
      </p>
      <p v-if="practiceWords.length && libraryTab !== 'create'" class="note">已选 {{ practiceWords.length }} 个词。可选一个场景作模板，再生成包含所选词的情境。</p>
      <nav class="library-tabs" aria-label="选择场景来源"><button v-for="tab in [{ id: 'create', label: '✦ 创建新情境' }, { id: 'classic', label: '经典场景' }, { id: 'saved', label: '我的场景' }]" :key="tab.id" type="button" :class="{ selected: libraryTab === tab.id }" :aria-pressed="libraryTab === tab.id" :disabled="working" @click="changeTab(tab.id)">{{ tab.label }}<span v-if="tab.id === 'saved'" class="tab-count">{{ savedScenes.length }}</span></button></nav>
      <section v-if="libraryTab === 'create'" class="card scene-studio" aria-labelledby="create-scene-title">
        <div class="section-heading"><div><span class="eyebrow">01 / 说说你的练习想法</span><h2 id="create-scene-title">今天，想用英语聊什么？</h2></div><span class="studio-badge">AI 场景生成</span></div>
        <p class="muted">可以写下地点、双方身份、想完成的事情，或希望练习的词汇。AI 会准备角色、交流目标和相关词汇。</p>
        <form @submit.prevent="generateScene">
          <PracticeWordPicker v-model="practiceWords" :disabled="working" />
          <label class="input-label" for="scenario-description">对话需求 <span>选词后可留空，否则至少 10 个字</span></label>
<p v-if="transferTask" class="note">迁移练习：{{transferTask.word}} · 来源 {{transferTask.sourceTitle}}。请换一个地点和交流任务。<button class="text-button" @click="transferTask=null;followupId=null">退出迁移练习</button></p>
          <textarea id="scenario-description" ref="descriptionInput" v-model="description" rows="4" maxlength="1500" :aria-invalid="Boolean(descriptionError)" aria-describedby="scenario-description-hint" :disabled="working" placeholder="例如：我准备独自去伦敦旅行，想练习酒店入住。我需要询问早餐时间，并解决房间太吵的问题，希望 AI 扮演前台，耐心地和我交流。"></textarea>
          <p id="scenario-description-hint" :class="descriptionError ? 'error' : 'note'" :role="descriptionError ? 'alert' : undefined">{{ descriptionError || (practiceWords.length ? '已选词，可以直接点击生成；未填写具体需求时会围绕所选词设计日常情境。' : '填写至少 10 个字的需求，或先从上方选词，也可以点击下方示例。') }}</p>
          <div class="description-meta"><span>越具体，越贴近你真正需要的表达</span><span>{{ description.trim().length }} / 1500</span></div>
          <div class="prompt-examples"><span class="muted">试试这些想法</span><button v-for="(example, index) in sceneExamples" :key="example" type="button" :disabled="working" @click="description = example">{{ ['☕ 旅行点餐', '◎ 求职面试', '◇ 电影深聊'][index] }}</button></div>
          <div class="studio-controls"><label>我的练习水平 <select v-model="difficulty" :disabled="working"><option value="beginner">入门 · 简单短句</option><option value="intermediate">进阶 · 日常交流</option><option value="advanced">挑战 · 深入表达</option></select></label><button class="btn btn-primary" type="submit" :disabled="working">{{ generating ? '正在准备并生成场景…' : latestGeneratedId ? '✦ 按当前需求重新生成' : '✦ 生成我的场景' }}</button></div>
          <p class="note" role="status">{{ generating ? '正在安排角色、交流目标和实用词汇，请稍候。' : '生成成功后自动存入「我的场景」，可随时回顾和重复练习。' }}</p>
          <AiUsage :usage="generationUsage" label="场景生成消耗" />
        </form>
      </section>
      <section v-else class="scene-picker" aria-labelledby="scene-library-title">
        <div class="section-heading"><div><h2 id="scene-library-title">{{ libraryTab === 'saved' ? '留住每一个想练的场景' : '从熟悉的生活开始' }}</h2><p class="muted">{{ libraryTab === 'saved' ? '场景和词汇一直在这里，每次开练都是一段新的对话。' : '挑一个经典场景，AI 会根据你的回答自然接话。' }}</p></div></div>
        <label class="scene-search">搜索场景<input v-model="sceneFilter" type="search" placeholder="搜索名称、任务或单词" :disabled="working"></label>
        <div v-if="visibleScenes.length" class="scene-grid"><button v-for="item in visibleScenes" :key="item.id" type="button" :disabled="working" :class="['scene-option', { chosen: sceneId === item.id }]" :aria-pressed="sceneId === item.id" @click="selectScene(item.id,true)"><span class="scene-icon" aria-hidden="true">{{ sceneIcons[item.sourceSceneId || item.id] || '✦' }}</span><strong>{{ item.title }}</strong><span v-if="libraryTab === 'saved'" class="scene-origin">{{ item.source === 'custom' ? 'AI 自定义' : '经典收藏' }} · {{ difficultyLabels[item.difficulty] || '自由练习' }}</span><span class="scene-description">{{ item.task }}</span><span class="scene-words">{{ (item.words || (item.targets || []).map(target => target.word)).join(' · ') }}</span></button></div>
        <div v-else class="empty-scenes"><strong>{{ sceneFilter ? '暂时没有匹配的场景' : '你的场景库，等你来填满' }}</strong><p>{{ sceneFilter ? '试试其他关键词。' : '生成一个专属场景，或把喜欢的经典场景保存下来。' }}</p><button v-if="!sceneFilter" class="text-button" @click="changeTab('create')">创建第一个场景 →</button></div>
      </section>
      <section v-if="scene" class="card setup" aria-labelledby="task-title">
        <div class="section-heading"><div><span class="eyebrow">{{ libraryTab === 'create' ? '02 / 你的专属场景' : '场景预览' }}</span><h2 id="task-title">{{ selectedScene.title }}</h2></div><button class="text-button" :disabled="working || sceneIsSaved" @click="saveScene">{{ sceneIsSaved ? '✓ 已保存到我的场景' : '＋ 保存这个场景' }}</button></div>
        <PracticeImage v-if="selectedScene.memoryImage" :image="selectedScene.memoryImage" />

        <p class="task-description">{{ selectedScene.task }}</p><div class="role-pair"><span v-if="selectedScene.userRole"><small>你的身份</small>{{ selectedScene.userRole }}</span><span><small>AI 扮演</small>{{ previewActors.length?previewActors.map(a=>a.name).join('、'):selectedScene.role }}</span><span v-if="selectedScene.location"><small>地点</small>{{ selectedScene.location }}</span></div>
        <ul v-if="selectedScene.goals?.length" class="scene-goals"><li v-for="goal in selectedScene.goals" :key="goal">{{ goal }}</li></ul>
        <details v-if="selectedScene.description" class="original-request"><summary>回看我的对话需求</summary><p>{{ selectedScene.description }}</p></details>
        <div v-if="vocabularyPool" class="vocabulary-settings"><h3>这次想练多少任务词？</h3><div class="word-count-presets"><button v-for="count in [4,8,12]" :key="count" class="btn" :class="vocabularyCount===count?'btn-primary':'btn-ghost'" :disabled="working" @click="vocabularyCount=count">{{count}} 个 · {{count===4?'轻量':count===8?'标准':'拓展'}}</button></div><label>微调数量 <input v-model.number="vocabularyCount" type="range" min="4" :max="vocabularyPool.length" :disabled="working"> {{vocabularyCount}} 个</label><small>选择的是本轮学习目标，未用出的词会在小结中单独呈现。</small></div>
        <details class="vocab-preview"><summary>查看本轮 {{selectedScene.targets?.length||0}} 个词和释义</summary><div class="vocabulary-preview"><div v-for="target in selectedScene.targets || []" :key="target.word" class="vocabulary-item"><strong>{{target.word}}</strong><p>{{target.sense}}</p><button class="text-button" type="button" @click="read(target.word)">听单词</button></div></div></details>
        <label v-if="(selectedScene.sourceSceneId||selectedScene.id)==='hotel'" class="challenge-select">任务路线 <select v-model="challenge" :disabled="working"><option value="standard">基础任务 · 酒店入住</option><option value="change_dates" :disabled="!challengeProgress.hotelChangeUnlocked">改期支线{{ challengeProgress.hotelChangeUnlocked?' · 已解锁':' · 完成基础酒店任务后解锁' }}</option></select></label>
        <section v-if="!selectedScene.memoryImage && challenge==='standard'" class="complete-flow-setup"><label><input v-model="fullJourney" type="checkbox"> 按完整流程练习</label><template v-if="fullJourney && workflowPreview"><label v-if="routeOptions.length">选择路线 <select v-model="learningRoute"><option value="">默认完整路线</option><option v-for="item in routeOptions" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><label v-if="routeOptions.length"><input v-model="transferVariation" type="checkbox"> 更换条件复练</label><details><summary>查看 {{workflowPreview.stages.length}} 个阶段与 {{previewActors.length}} 位交谈对象</summary><ol><li v-for="step in workflowPreview.stages" :key="step.id">{{ step.title }}</li></ol></details><p>阶段由 AI 根据实际表达自动推进；也可以手动继续，未核实目标会保留。</p></template><p v-else-if="fullJourney">旧自定义场景可以继续普通对话；重新生成后可使用完整阶段流程。</p></section>
        <div class="settings-grid"><label>对话难度<select v-model="difficulty" :disabled="working"><option value="beginner">入门 · 短句 + 中文提示</option><option value="intermediate">进阶 · 日常交流</option><option value="advanced">挑战 · 更完整的表达</option></select></label><label>纠错严格度<select v-model="strictness" :disabled="working"><option value="lenient">宽松 · 先把意思说清楚</option><option value="standard">标准 · 兼顾准确和流畅</option><option value="strict">严格 · 适合考试备考</option></select></label><label>对话方式<select v-model="mode" :disabled="working"><option value="free">自由交流 · 延伸话题，深入追问</option><option value="task">任务练习 · 完成目标后复盘</option></select></label><label>本次练习长度<select v-model="maxTurns" :disabled="working"><option v-for="count in [16,32,64,96,160,240]" :key="count" :value="count">{{count}} 轮</option></select></label></div>
        <p class="note">{{ mode === 'free' ? '不用按顺序完成任务，跟着兴趣聊下去，随时可以结束并复盘。' : '围绕交流目标练习，完成任务后由 AI 引导收尾。' }} 本次先安排 {{plannedTurns}} 轮，可在对话中继续增加。轮数不等于已经覆盖所有问题。</p><button class="btn btn-primary" :disabled="working" :aria-describedby="startError ? 'practice-start-error' : undefined" @click="start(false)">{{ busy ? '正在准备对话…' : needsWordScene ? '用这个情境练所选词 →' : '开始对话 →' }}</button>
        <button class="text-button direct-start" type="button" :disabled="working" @click="start(true)">先认识本轮情境词汇 →</button>
        <div v-if="startError" id="practice-start-error" ref="startErrorElement" class="start-error" role="alert">
          <strong>{{ startError.code === 'AI_NOT_CONFIGURED' ? '先配置 AI 对话服务' : '对话暂时无法开始' }}</strong>
          <p>{{ startError.message }}</p>
          <router-link v-if="startError.code === 'AI_NOT_CONFIGURED'" class="small-link" to="/settings">前往 AI 设置 →</router-link>
        </div>
      </section>
    </template>
    <section v-if="session" class="conversation-shell" aria-label="情境练习">
      <header class="scene-bar"><div class="section-heading"><div><span class="eyebrow">{{ currentScene?.location || '情境对话' }} · {{ activeActor?.name || currentScene?.role || 'AI 伙伴' }}</span><h2>{{ currentScene?.title || '情境练习' }}</h2></div><span class="rounds">{{ session.turnCount }} / {{ session.maxTurns || 8 }} 轮</span></div><details class="session-task"><summary>本轮任务说明</summary><p>{{currentScene.displayTask || currentScene.task.split(' 按完整流程')[0]}}</p></details>
        <PracticeImage v-if="currentScene?.memoryImage" :image="currentScene.memoryImage" />
        <div class="journey-identity"><NameAvatar :name="learnerName" /><div><small>你的身份固定</small><strong>{{ currentScene.userRole || '学习者' }} · {{ learnerName }}</strong></div></div>

        <div v-if="session.journey && !session.journey.flow" class="goal-progress"><strong>交流目标 · {{ completedGoals }} / {{ session.journey.goals.length }}</strong><ul><li v-for="goal in session.journey.goals" :key="goal.id" :class="{done:goal.completed}"><span>{{ goal.completed?'已完成':'待完成' }}</span> {{ goal.description }}<details v-if="goal.quote"><summary>查看表达依据</summary><q lang="en">{{ goal.quote }}</q></details></li></ul><small>依据本轮表达核对目标，结束对话不会自动视为通关。</small></div>
        <div v-if="talking && currentScene.actors?.length > 1" class="actor-picker" aria-label="选择交谈对象"><button v-for="actor in currentScene.actors" :key="actor.id" :class="{chosen:activeActor?.id===actor.id}" :aria-pressed="activeActor?.id===actor.id" :disabled="working || !talking || !availableActors.some(a=>a.id===actor.id)" @click="journeyAction('actor',{actorId:actor.id})"><NameAvatar :name="actor.englishName" :size="48" /><span><strong>{{ actor.name }}</strong><small>{{ activeActor?.id===actor.id?'正在交谈':availableActors.some(a=>a.id===actor.id)?'切换交谈对象':'后续阶段' }}</small></span></button></div>
        <p v-if="talking" class="current-recipient" role="status">你正在对 <strong>{{ activeActor?.name || currentScene.role }}</strong> 说话。</p>
        <div v-if="talking && session.journey?.handoff" class="handoff-card"><p>{{ session.journey.handoff.reason }}</p><button class="btn btn-secondary" :disabled="working || !talking || !availableActors.some(a=>a.id===actor.id)" @click="journeyAction('actor',{actorId:session.journey.handoff.actorId})">确认转接到 {{ currentScene.actors.find(a=>a.id===session.journey.handoff.actorId)?.name }}</button></div>
        <details class="session-vocabulary"><summary>本轮任务词汇 · {{usedCount}} / {{targets.length}} 个已用出</summary><div class="target-list"><button v-for="target in targets" :key="target.word + ':' + target.sense" type="button" :class="['target-chip', target.status, { focused: selectedWord === target.word }]" :disabled="working" :aria-pressed="selectedWord === target.word" :title="`${target.word} · ${target.sense || ''} · ${usageLabels[target.status] || '待使用'}`" @click="selectedWord = selectedWord === target.word ? '' : target.word"><strong>{{ ['independent', 'assisted'].includes(target.status) ? '✓ ' : '' }}{{ target.word }}</strong><span>{{ target.sense }}</span><span class="usage-label">{{ usageLabels[target.status] || '待使用' }}</span></button></div></details>
        <div class="scene-meta"><span>{{ usedCount }} / {{ targets.length }} 个词已用出 · {{ session.mode === 'free' ? '自由交流' : '任务练习' }} · {{ difficultyLabels[session.difficulty] }} · {{ strictnessLabels[session.strictness] }}纠错</span><label><input v-model="showTranslations" type="checkbox"> 显示中文翻译</label><label>朗读速度 <select v-model.number="playbackRate"><option :value=".85">0.85×</option><option :value="1">1×</option><option :value="1.15">1.15×</option><option :value="1.3">1.3×</option></select></label><label><input v-model="onlyCurrentActor" type="checkbox"> 只看当前对象</label></div>
        <div class="scene-actions"><button class="text-button" :disabled="working || sceneIsSaved" @click="saveScene">{{ sceneIsSaved ? '✓ 场景已收藏' : '＋ 保存场景与词汇' }}</button><button class="text-button" :disabled="working" @click="backToScenes">{{ active ? '稍后继续，返回场景' : '返回场景库' }} →</button></div>
      </header>
      <DialogueQuiz v-if="preparing" :session="session" preparation :busy="working" @submit="journeyAction('prepare',$event)" @begin="journeyAction('begin',{skip:$event})" />
      <div v-if="!preparing" class="dialogue-layout" :class="{single:currentScene?.memoryImage || !session.journey}"><div class="dialogue-main"><ScenarioWorkflowPanel v-if="talking && session.journey?.flow" :session="session" :busy="working" @action="journeyAction('workflow',$event)" @speak="read" @finish="finish" /><div class="conversation" role="log" aria-label="对话记录" aria-live="polite" aria-relevant="additions"><article v-for="(message, index) in conversationMessages" :key="message.id || `${session.id}-${index}`" :class="['message', message.role === 'user' ? 'from-user' : 'from-ai']"><div class="message-meta"><NameAvatar :name="avatarName(message)" :size="42" /><span>{{ message.role==='user'?'你 · '+learnerName:(message.actorName||currentScene?.role||'AI') }}<small v-if="message.recipientName"> · 对 {{ message.recipientName }} 说</small></span><button v-if="message.role !== 'user'" class="read-button" type="button" :disabled="isRecording || isTranscribing" :aria-label="`朗读第 ${index + 1} 条回复`" @click="read(message.text)">{{ isSpeaking ? '■ 停止' : '◖ 朗读' }}</button><span v-if="message.helpLevel >= 3" class="muted">跟读提示</span></div><p v-if="message.transition" class="stage-transition" role="status">✓ {{message.transition.from}} → {{message.transition.to}}</p><div class="bubble"><p v-if="stageTranscriptHidden(message)">先用上方听力任务理解开场；也可主动展开文字。</p><PracticeText v-else :text="message.text" :targets="targets" :corrections="message.role === 'user' ? message.corrections || [] : []" /><p v-if="!stageTranscriptHidden(message) && showTranslations && message.translation" class="translation">{{ message.translation }}</p></div><DialogueRecording v-if="message.role==='user' && message.turn" :user-id="auth.user.id" :session-id="session.id" :turn="message.turn" :revision="audioRevision"/><details v-if="message.usage" class="message-usage"><summary>本条用量</summary><AiUsage :usage="message.usage" label="本条回复消耗" /></details></article><div v-if="busy" class="thinking" role="status"><LoadingState>{{ helpGenerating ? 'AI 正在准备接话参考…' : active ? 'AI 正在组织回复…' : '正在保存练习…' }}</LoadingState></div><div ref="conversationEnd"></div></div>
      <div v-if="talking" class="composer"><div class="round-budget"><span>已交流 {{session.turnCount}} 轮 · 当前安排 {{session.maxTurns}} 轮</span><button v-if="!currentScene.memoryImage && session.maxTurns<240" class="text-button" :disabled="working" @click="extendRound">再加 {{Math.min(32,240-session.maxTurns)}} 轮</button><p v-if="session.turnCount>=session.maxTurns">本次轮次已用完。可增加轮次继续，或结束并查看小结；未完成阶段会保留。</p></div>
        <p v-if="error" role="alert" class="error-banner">{{ error }} <button type="button" class="text-button" :disabled="working || !draft.trim()" @click="send">重试发送</button> <button type="button" class="text-button" :disabled="working" @click="refreshCurrent">恢复最新进度</button></p>
        <div v-if="session.help" class="help-card" aria-live="polite"><div class="section-heading"><strong>{{ helpLabels[session.help.level] || '接话参考' }}</strong><span class="muted">{{ session.help.word ? `带入 ${session.help.word}` : '自然接话 · 不要求记忆词' }}</span></div><p v-if="session.help.hint" class="help-hint">{{ session.help.hint }}</p><p v-if="session.help.example" class="example">{{ session.help.example }}</p><p v-if="session.help.translation" class="muted">{{ session.help.translation }}</p><AiUsage :usage="session.help.usage" label="本次参考消耗" /><div v-if="session.help.example" class="button-row"><button class="text-button" :disabled="isRecording || isTranscribing" @click="read(session.help.example)">◖ 听一遍</button><button class="text-button" :disabled="working" @click="insertExample">填入输入框，再试着表达</button></div></div>
        <p v-if="waitingHelp && !session.help" class="waiting-hint">慢慢想，没关系。需要时点「不会说？」获取提示。</p>
        <div class="help-options"><label>参考用词 <select v-model="selectedWord" :disabled="working"><option value="">暂时不用记忆词</option><option v-for="target in targets" :key="target.word" :value="target.word">{{ target.word }} · {{ target.sense }}</option></select></label><button v-for="level in [2, 3, 4]" :key="level" type="button" class="text-button" :disabled="working" @click="help(level)">{{ helpLabels[level] }}</button><small>结合当前对话生成 AI 参考，计入本轮用量。</small></div>
        <form @submit.prevent="send"><label for="practice-expression" class="input-label">你的回答 <span>可以夹中文，也可以用麦克风输入</span></label><textarea id="practice-expression" v-model="draft" rows="3" maxlength="2000" :disabled="busy || isRecording || isTranscribing || isStarting" placeholder="试着用英语回答。不会的部分可以写中文…" @keydown="keyboard"></textarea><div class="composer-controls"><div class="input-tools"><button class="btn mic-button" type="button" :class="{ recording: isRecording }" :disabled="busy || isTranscribing || isStarting || (!isRecording && !voiceAvailable)" :aria-pressed="isRecording" @click="toggleMicrophone">{{ isStarting ? '连接麦克风…' : isTranscribing ? '正在识别…' : isRecording ? `■ 完成录音 ${elapsedSeconds}s` : '♩ 麦克风' }}</button><button v-if="isRecording || isTranscribing || isStarting" class="text-button" type="button" @click="speech.cancel()">取消</button><button class="btn help-button" type="button" :disabled="working" :aria-busy="helpGenerating" @click="help()">{{ helpGenerating ? '正在生成参考…' : '不会说？' }}</button></div><button class="btn btn-primary send-button" type="submit" :disabled="working || !draft.trim() || session.turnCount>=session.maxTurns">{{ busy ? '请稍候…' : '发送 ↑' }}</button></div></form>
        <details class="microphone-advanced"><summary>麦克风设置与故障排查</summary><div class="microphone-settings">
          <label for="practice-microphone">录音设备</label>
          <select id="practice-microphone" v-model="selectedMicrophone" :disabled="isRecording || isStarting || isTranscribing">
            <option value="">浏览器默认麦克风</option><option v-for="device in microphones" :key="device.id" :value="device.id">{{ device.label }}</option>
          </select>
          <button type="button" class="text-button" :disabled="isRecording || isStarting || isRefreshingMicrophones" @click="speech.refreshMicrophones({ requestPermission: true })">{{ isRefreshingMicrophones ? '正在获取设备…' : '授权并刷新设备' }}</button>
          <label><input v-model="rawAudio" type="checkbox" :disabled="isRecording || isStarting || isTranscribing"> 原始收音（关闭降噪）</label>
        </div>
        <p v-if="deviceError" class="note error">{{ deviceError }}</p>
        <p class="note">录音无声时，请选用与你其他语音软件相同的麦克风。首次允许录音后会显示完整设备名称；如果仍无声，可在 Chrome 或 Edge 中打开此页面对比。</p>
        </details><div v-if="isRecording" class="microphone-monitor">
          <div class="microphone-wave" aria-hidden="true"><span v-for="(level, index) in waveform" :key="index" :style="{ height: `${3 + level * 33}px` }"></span></div>
          <div class="microphone-details"><strong role="status">{{ inputStatus }}</strong><span>{{ microphoneName }} · {{ elapsedSeconds }} / {{ maxSeconds }} 秒</span></div>
        </div>
        <p v-if="isRecording" class="recording-note">波形随实际输入音量变化；收到声音不代表已识别出文字。完成后先检查文字，再发送。</p><p v-if="voiceError" role="status" class="note error">{{ voiceError }}</p><p v-else-if="!voiceAvailable && !voiceLoading" class="note"><template v-if="!voiceSupported">当前浏览器无法录音，请使用支持麦克风的浏览器，并通过 HTTPS 或 localhost 打开。</template><template v-else>{{ voiceReason || '语音识别尚未配置，可先打字练习。' }} <router-link to="/settings" class="small-link">查看设置</router-link></template></p><p v-else class="note">{{ isTranscribing ? '语音正在转成文字，识别后可以修改。' : 'Ctrl / ⌘ + Enter 发送 · 点击目标词看释义 · 浅色下划线点开看建议' }}</p>
        <div class="session-footer"><span class="muted">帮助越少，独立使用的记忆证据越强。</span><button class="text-button" :disabled="working" @click="finish">结束对话，查看小结 →</button></div>
      </div>
      </div><SceneHintImage v-if="session?.journey && !currentScene?.memoryImage" :key="session.id" :session-id="session.id" :actor-id="activeActor?.id" /></div>
    </section>
<SpeechRecoveryControls :speech="speech" /><p v-if="!active && voiceError" role="alert" class="error">{{voiceError}}</p>
<p v-if="generating" role="status">正在按需求生成情境… <button class="text-button" @click="cancelScene">取消等待</button></p>
    <button v-if="!generating && notice.includes('取消等待')" class="text-button" @click="loadList">刷新已保存场景</button>
    <section v-if="session?.status === 'analyzing'" class="card report-status" aria-live="polite"><span class="eyebrow">对话已保存</span><h2><LoadingState>正在整理你的练习小结…</LoadingState></h2><p>检查完整对话、目标词义项和薄弱点，并准备一轮短句练习。</p><p class="muted">离开页面后也能从最近练习回来查看。</p><button class="text-button" :disabled="busy" @click="refreshCurrent">刷新小结</button></section>
    <section v-if="session?.status === 'report_failed'" class="card report-status" role="status"><h2>对话已保存，小结暂未生成</h2><p>{{ session.reportError || '暂时无法完成分析，请稍后重试。' }}</p><button class="btn btn-primary" :aria-busy="Boolean(busy)" :disabled="busy" @click="retryReport">{{ busy ? '正在重试…' : '重新生成小结' }}</button></section>
    <PracticeFollowups v-if="!active && !loading" :source-id="report ? session.id : undefined" @transfer="startTransfer" />
    <section v-if="report" class="card report" aria-labelledby="report-title"><div class="section-heading report-heading"><div><span class="eyebrow">这一轮，你做得怎么样</span><h2 id="report-title">练习小结</h2></div><div class="button-row"><button class="btn btn-secondary compact" type="button" :disabled="working" @click="exportReport('pdf')">{{ exporting === 'pdf' ? '正在生成 PDF…' : '导出 PDF' }}</button><button class="btn btn-secondary compact" type="button" :disabled="working" @click="exportReport('png')">{{ exporting === 'png' ? '正在生成图片…' : '导出图片' }}</button></div></div><p class="note">导出包含词汇表现、纠错和短句参考答案，文件在本机生成。</p><p v-if="exportError" class="error" role="alert">{{ exportError }}</p><p v-if="exporting" role="status" class="note">正在排版完整小结，请稍候…</p><p>{{ report.summary }}</p>
      <section v-if="report.challenge" class="challenge-result"><h3>{{ report.challenge.completed?'任务通关':'本轮练习已记录' }}</h3><p v-if="report.challenge.rewards.length">{{ report.challenge.rewards.join(' · ') }}</p><p v-else>还有交流目标等待完成，可以查看上方依据再练一次。</p><ol><li v-for="(criterion,index) in report.challenge.criteria" :key="criterion">{{ index+1 }} 星条件：{{ criterion }}</li></ol><p v-if="report.challenge.unlock">已解锁：{{ report.challenge.unlock }}。返回经典场景，选择酒店的改期支线即可体验。</p><p v-if="report.challenge.comparison">同类任务比较：上次 {{ report.challenge.comparison.previousIndependentWords }} 个词独立用出、求助 {{ report.challenge.comparison.previousHelpCount }} 次；本次 {{ targets.filter(t=>t.status==='independent').length }} 个词独立用出、求助 {{ session.helpEvents.length }} 次。</p><small>{{ report.challenge.note }}</small></section>
      <DialogueQuiz v-if="session.consolidation" :session="session" :busy="working" @submit="journeyAction('consolidate',$event)" @hint="journeyAction('consolidate',{...$event,action:'hint'})" @reset="journeyAction('consolidate',{action:'reset'})" />
      <section v-if="session.journey?.workflowOutcome" class="card"><h3>完整场景覆盖</h3><p>{{ session.journey.workflowOutcome.note }}</p><ul><li v-for="item in session.journey.workflowOutcome.stages" :key="item.id">{{ item.title }} · {{ item.completed ? item.independent ? '独立表达完成' : '帮助后完成' : '留待重练' }} · {{ item.listening ? '首次听懂' : '听力仍待验证' }}</li></ul><button v-if="WORKFLOW_ROUTES[session.scene.sourceSceneId||session.scene.id]" class="btn btn-secondary" :disabled="working" @click="repeatSession(session.id,{fullJourney:true,learningRoute:session.scene.workflow.route,transfer:true,prepareWords:false})">换条件再练完整流程</button><button v-else class="btn btn-secondary" :disabled="working" @click="prepareCustomVariation">调整条件，生成另一套完整流程</button></section><h3>目标词使用情况</h3><div class="usage-report"><div v-for="target in report.targetUsage || targets" :key="target.word + ':' + target.sense" class="usage-row"><span><strong>{{ target.word }}</strong> · {{ target.sense }}</span><span :class="['usage-badge', target.status]">{{ usageLabels[target.status] || '待使用' }}<small v-if="target.helpLevel"> · 帮助 {{ target.helpLevel }} 级</small></span></div></div>
      <h3>值得改进的表达 <span class="muted">{{ (report.corrections || []).slice(0, 5).length }} 条</span></h3><p v-if="!report.corrections?.length" class="muted">这一轮没有需要展开的纠错，继续保持。</p><article v-for="(correction, index) in (report.corrections || []).slice(0, 5)" :key="index" class="correction-card"><span :class="['correction-tag', { sense: ['word_sense', 'sense', 'sense_misuse'].includes(correction.type) }]">{{ correctionLabels[correction.type] || '表达建议' }}</span><p class="original"><span>原句</span>{{ correction.originalSentence || correction.original }}</p><p class="corrected"><span>改后</span>{{ correction.correctedSentence || correction.replacement }}</p><p class="reason">{{ correction.explanation }}</p></article>
      <h3>回到复习队列</h3><p v-if="report.reviewWords?.length"><span v-for="word in report.reviewWords" :key="word.id || word.spelling" class="weak-word">{{ word.spelling }}<small v-if="wordTags(word.tags)"> · {{ wordTags(word.tags) }}</small></span></p><p v-else class="muted">这一轮没有新增需要回流的词。</p><p v-if="report.unmatchedWords?.length" class="note">词库暂未收录：{{ report.unmatchedWords.join('、') }}。可以先做下方短句练习。</p><button v-if="report.reviewWords?.length" class="btn btn-secondary" :disabled="working" @click="startReview">{{ startingReview ? '正在准备复习…' : '去复习薄弱词 →' }}</button>
      <div v-if="report.grammarWeaknesses?.length" class="grammar-note"><h3>留意这些表达习惯</h3><ul><li v-for="item in report.grammarWeaknesses" :key="typeof item === 'string' ? item : JSON.stringify(item)">{{ typeof item === 'string' ? item : item.description || item.label || item.type }}</li></ul></div>
      <section v-if="report.reinforcement?.length" class="reinforcement" aria-labelledby="reinforcement-title"><h3 id="reinforcement-title">再说一句，巩固薄弱点</h3><p class="muted">试着用目标词写一句英文，再对照参考表达。</p><form v-for="(item, index) in report.reinforcement" :key="index" class="short-practice" @submit.prevent="checkShort(index)"><label :for="`short-${index}`"><strong>{{ index + 1 }} · {{ item.word }}</strong> {{ item.prompt }}</label><textarea :id="`short-${index}`" v-model="shortAnswers[index]" rows="2" maxlength="1000" placeholder="写下你的英文表达…"></textarea><div class="button-row"><button class="btn btn-secondary compact" :disabled="!shortAnswers[index]?.trim()">对照答案</button><button class="text-button" type="button" @click="revealedAnswers.includes(index) ? revealedAnswers = revealedAnswers.filter(value => value !== index) : revealedAnswers.push(index)">{{ revealedAnswers.includes(index) ? '收起' : '查看' }}参考</button></div><div v-if="checkedAnswers.includes(index) || revealedAnswers.includes(index)" class="short-answer"><p v-if="checkedAnswers.includes(index)" class="note">{{ shortMatches(index, item.answer) ? '与你的参考表达一致。试着再独立说一遍。' : '表达可以有多种说法。对照下面的用词和结构，再完善你的句子。' }}</p><strong>{{ item.answer }}</strong><p>{{ item.explanation }}</p><button type="button" class="text-button" @click="read(item.answer)">◖ 听参考表达</button></div></form></section>
    </section>
    <div v-if="session && !active" class="after-session button-row"><button class="btn btn-primary" :disabled="working" @click="repeatSession(session.id)">同一场景，再练一次 ↻</button><button class="btn btn-secondary" :disabled="working" @click="backToScenes">选择其他场景 →</button></div>
    <section v-if="sessions.length" class="session-history" aria-labelledby="recent-practice"><div class="section-heading"><h2 id="recent-practice">练习记录</h2><span class="muted">回看原对话，或重新开始一轮</span></div><article v-for="item in sessions" :key="item.id" class="history-item"><div><strong>{{ item.scene?.title || scenes.find(value => value.id === item.sceneId)?.title || '情境练习' }}</strong><small>{{ formatDate(item.updatedAt || item.createdAt) }} · {{ item.turnCount || 0 }} 轮 · {{ item.mode === 'free' ? '自由交流' : '任务练习' }}</small></div><div class="history-actions"><button class="text-button" type="button" :disabled="working || item.id === session?.id" @click="restore(item.id)" :aria-label="`${item.scene?.title || '情境练习'}，${sessionLabels[item.status]}`">{{ item.id === session?.id ? '当前练习' : sessionLabels[item.status] || '查看' }} →</button><button class="text-button" type="button" :disabled="working" @click="repeatSession(item.id)" :aria-label="`重新练习${item.scene?.title || '此场景'}`">再练一次 ↻</button></div></article></section>
    <section v-if="history.length" class="legacy-history"><h2>以前的单次表达练习</h2><details v-for="item in history" :key="item.id"><summary>{{ legacyScenes.find(value => value.id === item.scene)?.title || scenes.find(value => value.id === item.scene)?.title || item.scene }} · {{ formatDate(item.created_at) }}</summary><p>{{ item.answer }}</p><p>{{ item.feedback?.corrected }}</p><p>{{ item.feedback?.summary }}</p><p v-for="(correction, index) in item.feedback?.corrections || []" :key="index">{{ correctionLabels[correction.type] || '表达建议' }}：{{ correction.original }} → {{ correction.replacement }}。{{ correction.explanation }}</p></details></section>
  </main>
</template>

<style scoped>
.journey-steps { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:18px; font-size:13px; }.journey-steps span { padding:8px 12px;border-radius:20px;background:var(--bg);color:var(--ink-soft); }.journey-steps .current { color:var(--ink);border:1px solid var(--accent); }.journey-identity { display:flex;align-items:center;gap:10px;margin:14px 0; }.journey-identity small,.journey-identity strong { display:block; }.goal-progress { margin:14px 0;padding:14px;border:1px solid var(--line);border-radius:12px; }.goal-progress ul { padding:0;list-style:none; }.goal-progress li { margin:8px 0;font-size:13px; }.goal-progress li span { color:var(--ink-soft); }.goal-progress li.done span { color:var(--ok); }.goal-progress small { color:var(--ink-soft); }.goal-progress details { margin:6px 0; }.actor-picker { display:flex;gap:8px;flex-wrap:wrap; }.actor-picker button { display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);padding:9px;text-align:left;font:inherit; }.actor-picker button.chosen { border-color:var(--accent);background:var(--accent-soft); }.actor-picker strong,.actor-picker small { display:block; }.actor-picker small { margin-top:4px;font-size:11px;color:var(--ink-soft); }.current-recipient { font-size:13px; }.handoff-card,.challenge-result { padding:16px;background:var(--bg);border:1px solid var(--line);border-radius:12px;margin:14px 0; }.challenge-result p,.challenge-result li { font-size:13px;line-height:1.8; }.challenge-result small { color:var(--ink-soft); }.dialogue-layout { display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:16px;align-items:start; }.dialogue-layout.single { grid-template-columns:1fr; }.dialogue-main { min-width:0; }.dialogue-layout>aside { position:sticky;top:80px; }.direct-start { margin:12px; }.challenge-select { display:flex;align-items:center;gap:12px;margin:16px 0; }.message-meta { flex-wrap:wrap; }.message-meta small { font-size:11px; }
@media(max-width:900px){.dialogue-layout{grid-template-columns:1fr}.dialogue-layout>aside{position:static;grid-row:1}.actor-picker button{flex:1;min-width:145px}}
.start-error { margin-top: 14px; padding: 14px; border: 1px solid var(--bad); border-radius: 12px; background: var(--bad-soft); }
.start-error strong { color: var(--bad); font-size: 14px; }
.start-error p { margin: 7px 0; font-size: 13px; line-height: 1.7; }
.practice { max-width: 1160px; margin: auto; padding: 30px 20px 90px; }
.report-heading { flex-wrap: wrap; align-items: flex-start; }.report-heading .button-row { margin-top: 7px; }
.library-tabs { display: flex; gap: 6px; padding: 5px; background: var(--bg); border: 1px solid var(--line); border-radius: 13px; margin-bottom: 24px; }
.library-tabs button { flex: 1; border: 0; background: transparent; color: var(--ink-soft); border-radius: 9px; font: inherit; font-size: 14px; padding: 12px 8px; }
.library-tabs button.selected { color: var(--accent-deep); background: var(--bg-card); box-shadow: var(--shadow); font-weight: 600; }
.tab-count { font-size: 10px; margin-left: 7px; padding: 1px 5px; border-radius: 5px; background: var(--accent-soft); }
.scene-studio { padding: 28px; background: linear-gradient(130deg, var(--accent-soft), var(--bg-card) 75%); }
.studio-badge { padding: 5px 9px; border: 1px solid var(--line); border-radius: 999px; font-size: 10px; color: var(--accent-deep); flex-shrink: 0; }
.scene-studio > .muted { margin: 16px 0 24px; line-height: 1.8; }
.description-meta { display: flex; justify-content: space-between; gap: 15px; font-size: 11px; color: var(--ink-soft); }
.prompt-examples { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 18px 0 24px; }
.prompt-examples button { background: var(--bg-card); border: 1px solid var(--line); color: var(--ink); padding: 7px 10px; border-radius: 8px; font: inherit; font-size: 12px; }
.studio-controls { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.studio-controls label { display: grid; gap: 6px; color: var(--ink-soft); font-size: 12px; }
.scene-search { display: flex; gap: 12px; align-items: center; font-size: 12px; color: var(--ink-soft); margin: 8px 0 20px; }
.scene-search input { flex: 1; min-width: 0; border: 1px solid var(--line); background: var(--bg-card); color: var(--ink); border-radius: 8px; padding: 10px 12px; font: inherit; }
.scene-origin { font-size: 10px; color: var(--accent-deep); }
.empty-scenes { text-align: center; border: 1px dashed var(--line); border-radius: 14px; padding: 40px 20px; margin: 20px 0; }
.empty-scenes p { color: var(--ink-soft); font-size: 13px; }
.role-pair { display: flex; flex-wrap: wrap; gap: 12px 28px; padding: 15px; background: var(--bg); border-radius: 10px; font-size: 13px; }
.role-pair span { display: grid; gap: 4px; }.role-pair small { color: var(--ink-soft); font-size: 10px; }
.scene-goals { display: grid; gap: 7px; padding-left: 22px; color: var(--ink-soft); font-size: 13px; margin: 18px 0; }
.vocab-title { font-size: 14px; margin: 24px 0 10px; }.vocab-title span { color: var(--ink-soft); font-size: 10px; font-weight: 400; margin-left: 8px; }
.vocabulary-preview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.vocabulary-item { border: 1px solid var(--line); border-radius: 10px; padding: 11px 13px; align-self: start; }
.vocabulary-item summary strong { font-size: 14px; }.vocabulary-item summary span { margin-left: 9px; font-size: 12px; color: var(--ink-soft); }
.vocabulary-item p { overflow-wrap: anywhere; margin: 8px 0; line-height: 1.7; }.vocabulary-item .phrase { color: var(--accent-deep); }
.original-request { margin-top: 14px; color: var(--ink-soft); }.original-request p { white-space: pre-wrap; }
.scene-actions { display: flex; justify-content: space-between; gap: 10px; margin-top: 14px; }
.after-session.button-row { justify-content: center; }.history-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
button:disabled { cursor: not-allowed; opacity: .55; }button, textarea, input, select { outline-offset: 3px; }
.task-description, .scene-description, .role-pair, .scene-goals { overflow-wrap: anywhere; }
.page-intro, .section-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }.page-intro { align-items: flex-start; }.page-intro .small-link { flex-shrink: 0; margin-top: 5px; }
.eyebrow { display: block; color: var(--accent-deep); font-size: 12px; letter-spacing: .06em; margin-bottom: 7px; }.section-sub { margin-bottom: 26px; }.section-heading h2 { margin: 0; font-size: 18px; }
.muted, .note { color: var(--ink-soft); font-size: 13px; }.note { margin: 12px 0; }.small-link, .text-button { color: var(--accent-deep); font-size: 13px; }.text-button { border: 0; background: transparent; padding: 4px; font-family: inherit; }.text-button:disabled { opacity: .45; cursor: not-allowed; }
.error { color: var(--bad); }.error-banner { background: var(--bad-soft); color: var(--bad); padding: 12px 16px; border-radius: 12px; font-size: 14px; }.notice { background: var(--hint-bg); color: var(--hint-ink); border-radius: 10px; padding: 10px 14px; font-size: 13px; }
.help-options small { flex-basis: 100%; color: var(--ink-soft); line-height: 1.8; }.help-options { padding-bottom: 14px; }.help-card .section-heading { flex-wrap: wrap; gap: 6px; }
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
@media (max-width: 600px) {
  .scene-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .library-tabs button { font-size: 12px; padding: 11px 5px; }.studio-badge { display: none; }
  .studio-controls, .studio-controls label, .studio-controls .btn { width: 100%; }
  .vocabulary-preview { grid-template-columns: 1fr; }.vocab-title span { display: block; margin: 6px 0 0; }
  .history-item { align-items: flex-start; flex-wrap: wrap; gap: 8px; }.history-actions { width: 100%; justify-content: flex-start; }
  .scene-actions { flex-wrap: wrap; }.setup > .section-heading { align-items: flex-start; }
}
.microphone-monitor { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 14px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
.microphone-wave { display: flex; align-items: center; gap: 3px; height: 40px; color: var(--ink); }
.microphone-wave span { width: 4px; border-radius: 2px; background: currentColor; }
.microphone-details { display: grid; gap: 4px; font-size: 12px; }
.microphone-details span { color: var(--ink-soft); overflow-wrap: anywhere; }
.recording-preview { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 12px; font-size: 12px; color: var(--ink-soft); }
.recording-preview audio { width: 280px; max-width: 100%; height: 36px; }
.microphone-settings { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; font-size: 12px; }
.microphone-settings select { flex: 1 1 180px; min-width: 0; max-width: 100%; padding: 6px; }
.microphone-settings label { display: inline-flex; align-items: center; gap: 5px; }
.microphone-settings input { width: auto; margin: 0; }
</style>

<style scoped>
.vocabulary-settings{border:1px solid var(--line);border-radius:12px;padding:16px;margin:18px 0}.vocabulary-settings h3{margin:0 0 12px;font-size:16px}.word-count-presets{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.vocabulary-settings label{display:flex;gap:12px;align-items:center;font-size:13px}.vocabulary-settings small{display:block;color:var(--ink-soft);line-height:1.7;margin-top:8px}.vocab-preview,.complete-flow-setup details,.session-task,.session-vocabulary{margin:12px 0;font-size:13px}.vocab-preview summary,.session-task summary,.session-vocabulary summary{cursor:pointer;color:var(--ink-soft)}.scene-bar{padding:16px}.scene-bar .section-heading{margin-bottom:8px}.scene-bar h2{font-size:22px}.scene-bar .journey-identity{margin:10px 0}.scene-bar .journey-identity :deep(.name-avatar){width:40px!important;height:40px!important}.scene-bar .journey-identity small{display:none}.scene-bar .journey-identity strong{font-size:13px}.scene-meta{gap:12px;flex-wrap:wrap}.scene-meta label{display:flex;align-items:center;gap:5px}.scene-meta select{padding:4px;font-size:12px}.actor-picker{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.actor-picker button{padding:8px;min-width:125px}.actor-picker :deep(.name-avatar){width:34px!important;height:34px!important}.actor-picker button small{font-size:10px}.current-recipient{margin:10px 0!important;font-size:13px!important}.round-budget{font-size:12px;color:var(--ink-soft);display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}.round-budget p{width:100%;margin:4px 0;line-height:1.7}.stage-transition{font-size:12px;line-height:1.6;color:var(--accent);padding:9px 12px;background:var(--accent-soft);border-radius:8px}.message-usage{font-size:11px;color:var(--ink-soft);margin-top:6px}.microphone-advanced{margin-top:14px;font-size:12px;color:var(--ink-soft)}.microphone-advanced summary{cursor:pointer}.session-task p{font-size:14px;line-height:1.8;font-weight:400}.dialogue-main{min-width:0}.scene-option.chosen{outline:2px solid var(--accent);outline-offset:2px}.complete-flow-setup p{font-size:12px;line-height:1.7}.scene-description{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.scene-goals{display:none}@media(max-width:900px){.dialogue-layout>aside{grid-row:auto}}@media(max-width:600px){.scene-bar{padding:12px}.actor-picker button{min-width:120px;flex:1}.scene-meta{line-height:1.7}.scene-meta>span{width:100%}.word-count-presets .btn{flex:1;padding:8px}.vocabulary-settings input{max-width:150px}.scene-bar .journey-identity{margin:6px 0}}
</style>

<style scoped>
.complete-flow-setup{border:1px solid var(--line);padding:18px;border-radius:12px;margin:20px 0}.complete-flow-setup>label{display:inline-flex;align-items:center;gap:8px;margin-right:20px;font-size:13px}.complete-flow-setup select{color:var(--ink);background:var(--bg-card);padding:8px;border:1px solid var(--line)}.complete-flow-setup ol{display:flex;gap:12px;flex-wrap:wrap;padding-left:20px;font-size:12px;line-height:1.9}.complete-flow-setup p{font-size:12px;color:var(--ink-soft);line-height:1.8}
</style>
