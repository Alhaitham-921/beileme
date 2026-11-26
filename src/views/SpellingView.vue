<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { spelling } from '../api/index.js'
import { SPELLING_LABELS, spellingInput, spellingLetters, matchesSpelling } from '../../shared/spelling.js'
import { createPracticeClock, createTypingSound, spellingDraftKey, readSpellingDraft, saveSpellingDraft } from '../utils/spellingPractice.js'

const route = useRoute(), auth = useAuthStore(), session = ref(null), loading = ref(true), busy = ref(false), error = ref('')
const input = ref(''), errors = ref(0), paused = ref(false), notice = ref(''), composing = ref(false), inputRef = ref(null), continueRef = ref(null)
import { spellingSoundEnabled as soundEnabled, tone } from '../stores/spellingSound.js'
const clock = createPracticeClock(), sound = createTypingSound()
const question = computed(() => session.value?.question)
const letters = computed(() => spellingLetters(input.value, question.value?.spelling || ''))
const canSave = computed(() => question.value && matchesSpelling(input.value, question.value.spelling))
const identity = value => value?.question ? `${value.id}:${value.phase}:${value.question.id}` : ''
const draftKey = () => spellingDraftKey(auth.user?.id, session.value?.id, question.value?.id, session.value?.phase)
const groups = computed(() => Object.keys(SPELLING_LABELS).map(key => ({ key, label: SPELLING_LABELS[key], count: session.value?.results.filter(r => r.first.result === key).length || 0 })))
const stillWeak = computed(() => session.value?.results.filter(r => ['pending','assisted'].includes((r.retry || r.first).result)).length || 0)
let generation = 0, alive = true, noticeTimer, pendingAction, focused = document.hasFocus()
function saveDraft() {
  if (question.value) saveSpellingDraft(draftKey(), { input: input.value, errors: errors.value, durationMs: clock.elapsed() })
}
function syncClock() {
  if (question.value && !paused.value && !busy.value && focused && document.visibilityState === 'visible') clock.resume()
  else clock.pause()
}
async function focusInput() { await nextTick(); if (!paused.value && !busy.value) (inputRef.value || continueRef.value)?.focus({ preventScroll: true }) }
function apply(value, restore = false) {
  const old = identity(session.value), next = identity(value)
  if (old && old !== next) saveDraft()
  session.value = value
  if (restore || old !== next) {
    const saved = question.value ? readSpellingDraft(draftKey()) : null
    input.value = saved?.input || ''; errors.value = saved?.errors || 0; clock.reset(saved?.durationMs || 0)
    notice.value = ''; composing.value = false
  }
  syncClock()
}
async function load() {
  const token = ++generation, id = String(route.params.id)
  saveDraft(); loading.value = true; busy.value = false; error.value = ''; pendingAction = null
  try { const value = await spelling.get(id); if (alive && token === generation) apply(value, true) }
  catch (e) { if (alive && token === generation) error.value = e.message }
  finally { if (alive && token === generation) { loading.value = false; void focusInput() } }
}
async function act(action) {
  if (busy.value || paused.value || !session.value) return
  const value = session.value, token = generation
  if (action === 'answer' && !canSave.value) return
  saveDraft(); clock.pause(); busy.value = true; error.value = ''
  const signature = `${value.id}:${value.revision}:${action}:${input.value}:${errors.value}`
  if (pendingAction?.signature !== signature) pendingAction = { signature, body: { action, requestKey: crypto.randomUUID(), revision: value.revision,
    ...(question.value ? { wordId: question.value.id } : {}), answer: action === 'answer' ? input.value : '', errorCount: errors.value, durationMs: clock.elapsed() } }
  try {
    const response = await spelling.action(value.id, pendingAction.body)
    if (!alive || token !== generation) return
    if (action === 'answer' && soundEnabled.value) sound.play(true)
    pendingAction = null; apply(response)
  } catch (e) {
    if (!alive || token !== generation) return
    error.value = `${e.message} 输入已保留，可重试或重新读取进度。`
    try { const latest = await spelling.get(value.id); if (alive && token === generation && latest.revision !== value.revision) { pendingAction = null; apply(latest); error.value = '' } } catch { /* Keep the draft and replay key. */ }
  } finally { if (alive && token === generation) { busy.value = false; syncClock(); void focusInput() } }
}
function type(event) {
  if (composing.value || event.isComposing || !question.value || busy.value || paused.value) return
  const result = spellingInput(input.value, event.target.value, question.value.spelling)
  input.value = result.value; event.target.value = result.value
  errors.value = Math.min(100000, errors.value + result.errors)
  if (result.errors || result.blocked) {
    notice.value = '有字母没拼对，先退格修正再继续。'
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.value = '' }, 1600)
  }
  if (soundEnabled.value) sound.play(result.errors || result.blocked ? 'error' : false, tone.value)
  syncClock(); saveDraft()
  if (canSave.value && !result.blocked) void act('answer')
}
function compositionEnd(event) { composing.value = false; type(event) }
function practiceKey(event) {
  if (event.defaultPrevented || event.isComposing || composing.value || event.keyCode === 229 ||
      event.altKey || event.ctrlKey || event.metaKey || busy.value || paused.value || !question.value ||
      event.target !== inputRef.value) return
  const action = event.key === 'F2' && !event.shiftKey && !session.value.helped ? 'reveal'
    : event.key === 'Enter' && event.shiftKey ? 'skip' : null
  if (!action) return
  event.preventDefault()
  if (!event.repeat) void act(action)
}
function advanceKey(event) {
  if (!event.repeat && !event.shiftKey) void act('next')
}
function togglePause() { paused.value = !paused.value; syncClock(); saveDraft(); if (!paused.value) void focusInput() }
function onVisibility() { syncClock(); saveDraft() }
function onBlur() { focused = false; syncClock(); saveDraft() }
function onFocus() { focused = true; syncClock() }
window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus)
document.addEventListener('visibilitychange', onVisibility); window.addEventListener('pagehide', saveDraft)
const draftTimer = setInterval(saveDraft, 5000)
watch(() => route.params.id, load, { immediate: true })
onUnmounted(() => {
  saveDraft(); alive = false; generation++; clearInterval(draftTimer); clearTimeout(noticeTimer); sound.close()
  window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', saveDraft)
})
</script>
<template>
  <div class="spelling-page" @keydown="practiceKey">
    <header class="spell-heading"><div><router-link class="text-button" to="/notebooks?source=mistakes">返回错题本</router-link><h1 class="section-title">错词拼写</h1></div><router-link class="text-button" to="/recall">专项与复测</router-link></header>
    <section v-if="error" class="spell-error" role="alert"><p>{{ error }}</p><button class="text-button" @click="load" :disabled="busy">重新读取进度</button></section>
    <section v-if="loading" class="card spell-loading"><LoadingState>正在读取所选词与拼写进度…</LoadingState></section>
    <template v-else-if="session">
      <div class="spell-toolbar"><span>第 {{ session.group }} / {{ session.groupCount }} 组 <strong>{{ session.phase==='retry' ? '错词回练' : '看中文盲拼' }}</strong></span><div><label><input v-model="soundEnabled" type="checkbox">机械键盘音效与完成提示音</label><button v-if="question" class="text-button" @click="togglePause" :disabled="busy">{{ paused ? '继续练习' : '暂停' }}</button></div></div>
      <div class="spell-progress"><span>{{ session.phase==='retry' ? '本组回练' : '本组首轮' }} {{ session.index }} / {{ session.queueLength }}</span><span>首次无错 {{ session.independentCount }} 词 · 当前连对 {{ session.streak }}</span><progress :max="session.total" :value="session.completed" :aria-label="`已练 ${session.completed} / ${session.total} 个所选词`"></progress><small>共选 {{ session.total }} 词 · 首轮已练 {{ session.completed }} 词</small></div>
      <section v-if="paused && question" class="card spell-pause"><span aria-hidden="true">Ⅱ</span><h2>休息一下，再继续</h2><p>暂停期间不计时，输入和错误状态已保留。</p><button class="btn btn-primary" @click="togglePause">继续拼写</button></section>
      <section v-else-if="question" class="card spell-workspace" :aria-busy="busy">
        <p class="spell-instruction">{{ session.helped ? '跟打' : question.blank ? '换句填词' : '看中文拼写' }}</p>
        <h2 v-if="question.blank" id="spelling-cue" class="spell-meaning" lang="en">{{ question.blank }}</h2>
        <h2 v-else id="spelling-cue" class="spell-meaning">{{ question.meaning }}</h2>
        <p v-if="question.blank" class="spell-pos">{{ question.meaning }}</p>
        <p v-else-if="question.pos" class="spell-pos">{{ question.pos }}</p>
        <p v-if="session.helped" class="spell-reference" lang="en">{{ question.spelling }}</p>
        <form @submit.prevent="act('answer')">
          <div class="spell-input-zone" :class="{'has-error':letters.some(l=>l.status==='wrong')}">
            <div class="spell-letters" aria-hidden="true"><span v-for="(letter,i) in letters" :key="i" :class="[letter.status,{'spell-cursor':letter.cursor}]">{{ letter.text===' ' ? '\u00a0' : letter.text }}</span><span v-if="input.length>=question.spelling.length" class="end-cursor"></span></div>
            <input ref="inputRef" :value="input" @input="type" @compositionstart="composing=true" @compositionend="compositionEnd" @keydown.enter="(composing || $event.isComposing) && $event.preventDefault()" :disabled="busy" maxlength="512" aria-labelledby="spelling-cue" aria-describedby="spell-input-help" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="text" lang="en" />
          </div>
          <p id="spell-input-help" class="spell-input-help" role="status">{{ busy ? '保存中…' : notice || (canSave ? 'Enter 重试保存' : '直接打字，拼对自动保存') }}</p>
          <div class="spell-actions"><button v-if="canSave || error" class="btn btn-primary" :disabled="busy || !canSave" type="submit">重试保存</button><button type="button" class="text-button" aria-keyshortcuts="F2" :disabled="busy || session.helped" @click="act('reveal')">查看答案 <kbd>F2</kbd></button><button type="button" class="text-button" aria-keyshortcuts="Shift+Enter" :disabled="busy" @click="act('skip')">跳过 <kbd>Shift + Enter</kbd></button></div>
        </form>
        <p class="spell-bottom-note">{{ session.helped ? '跟打完成会单独记录，不算独立拼对。' : '逐字纠错不清空已输入内容，错过的词会在组末再练一次。' }}</p>
      </section>
      <section v-else-if="session.stage==='feedback'" class="card spell-feedback" aria-live="polite">
        <span :class="['spell-result-label',session.feedback.result]">{{ session.phase==='retry' ? '回练结果' : '本次记录' }} · {{ SPELLING_LABELS[session.feedback.result] }}</span>
        <h2 lang="en">{{ session.feedback.spelling }}</h2><p>{{ session.feedback.meaning }}</p><blockquote v-if="session.feedback.example" lang="en">{{ session.feedback.example }}</blockquote>
        <button ref="continueRef" class="btn btn-primary" :disabled="busy" @click="act('next')" @keydown.enter.prevent="advanceKey">{{ busy ? '正在保存…' : '下一步' }} <kbd>Enter</kbd></button>
      </section>
      <section v-else class="card spell-summary">
        <p class="spell-instruction">{{ session.stage==='finished' ? '本次所选词已练完' : '这一组，练完了' }}</p><h2>{{ session.stage==='finished' ? '每一次纠正，都算进步。' : '稍作停顿，再练下一组。' }}</h2>
        <div class="spell-tallies"><div v-for="group in groups" :key="group.key"><strong>{{ group.count }}</strong><span>{{ group.label }}</span></div></div>
        <p class="spell-summary-note">以上保留首轮表现，回练不覆盖首次记录。最高连对 {{ session.bestStreak }} 词。</p>
        <p v-if="stillWeak" class="spell-summary-note">末次仍未独立拼出的词有 {{ stillWeak }} 个，可以留到下次继续巩固。</p>
        <ul class="spell-results"><li v-for="word in session.results" :key="word.id"><div><strong lang="en">{{ word.spelling }}</strong><span>{{ word.meaning }}</span></div><div><span>{{ SPELLING_LABELS[word.first.result] }}</span><small v-if="word.retry">回练：{{ word.retry.result==='independent' ? '无错拼对' : SPELLING_LABELS[word.retry.result] }}</small><small>错字 {{ word.first.errorCount + (word.retry?.errorCount || 0) }} 次 · 有效用时 {{ Math.ceil((word.first.durationMs + (word.retry?.durationMs || 0))/1000) }} 秒</small></div></li></ul>
        <div class="spell-actions"><button v-if="session.stage==='group-end'" ref="continueRef" class="btn btn-primary" :disabled="busy" @click="act('next')" @keydown.enter.prevent="advanceKey">继续下一组 <kbd>Enter</kbd></button><router-link class="btn btn-secondary" to="/notebooks?source=mistakes">回错题本选词</router-link><router-link class="text-button" to="/recall">查看到期复测</router-link></div>
      </section>
    </template>
    <section v-else-if="!loading" class="card spell-loading"><p>暂时未能打开这组练习。</p><router-link class="btn btn-primary" to="/notebooks?source=mistakes">回错题本选词</router-link></section>
  </div>
</template>
<style scoped>
.spelling-page{max-width:900px;margin:0 auto}.spell-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:25px}.spell-heading h1{margin:10px 0 0}.spell-toolbar{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap;font-size:12px;color:var(--ink-soft)}.spell-toolbar strong{font-weight:500;color:var(--accent);padding-left:12px}.spell-toolbar>div{display:flex;align-items:center;gap:15px}.spell-toolbar label{display:flex;gap:7px;align-items:center;cursor:pointer}.spell-progress{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:22px 0;font-size:12px;color:var(--ink-soft)}.spell-progress progress{width:100%;height:3px;appearance:none;border:0;background:var(--line);color:var(--accent)}progress::-webkit-progress-bar{background:var(--line)}progress::-webkit-progress-value{background:var(--accent)}progress::-moz-progress-bar{background:var(--accent)}.spell-progress small{color:var(--ink-muted);font-size:11px}.spell-workspace{text-align:center;padding:35px 30px 25px;min-height:390px}.spell-instruction{font-size:12px;color:var(--ink-muted);margin:0 0 24px}.spell-meaning{font-size:27px;font-weight:500;line-height:1.6;margin:0 auto;max-width:26ch}.spell-pos{font-size:13px;color:var(--ink-soft);margin:6px 0 0}.spell-input-zone{position:relative;margin:38px 0 16px;padding:14px 8px;min-height:94px;border-bottom:1px solid var(--line);border-radius:8px 8px 0 0;cursor:text}.spell-input-zone:focus-within{border-bottom-color:var(--accent);background:color-mix(in srgb,var(--accent-soft) 40%,transparent)}.spell-input-zone input{position:absolute;inset:0;width:100%;height:100%;opacity:.015;color:transparent;caret-color:transparent;background:transparent;border:0;font-size:32px;padding:10px;outline:0}.spell-letters{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:5px;min-height:60px;font-family:var(--serif);font-size:clamp(32px,4vw,48px);line-height:1.4;pointer-events:none}.spell-letters>span{min-width:.65em;white-space:pre;position:relative}.spell-letters .waiting{color:var(--ink-muted)}.spell-letters .correct{color:var(--ok)}.spell-letters .wrong{color:var(--bad);text-decoration:underline;text-decoration-thickness:2px}.spell-cursor:before,.end-cursor:before{content:'';position:absolute;height:1.05em;width:2px;left:-2px;top:.18em;background:var(--accent);animation:spell-blink 1.2s step-end infinite}.spell-input-help{font-size:12px;color:var(--ink-soft);min-height:25px;line-height:1.7;margin:0}.has-error+.spell-input-help{color:var(--bad)}.spell-actions{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:12px 24px;margin-top:25px}.spell-bottom-note{color:var(--ink-muted);font-size:11px;line-height:1.8;margin:26px 0 0}.spell-reference{font-family:var(--serif);font-size:28px;letter-spacing:2px;color:var(--accent);overflow-wrap:anywhere;margin:16px 0 -20px}.spell-feedback{padding:36px;text-align:center}.spell-feedback h2{font-family:var(--serif);font-size:48px;font-weight:500;line-height:1.3;overflow-wrap:anywhere;margin:20px 0 12px}.spell-feedback>p{color:var(--ink-soft)}.spell-feedback blockquote{font-family:var(--serif);font-size:20px;line-height:1.8;margin:25px 0;padding:18px;background:var(--accent-soft);border-radius:10px}.spell-feedback>.btn{margin-top:20px}.spell-result-label{font-size:12px;color:var(--ink-soft)}.spell-result-label.independent{color:var(--ok)}.spell-result-label.assisted,.spell-result-label.corrected{color:var(--warn-ink)}kbd{font:10px var(--sans);padding:2px 5px;border:1px solid currentColor;border-radius:3px;opacity:.6;margin-left:14px}.spell-error{border:1px solid var(--bad);border-radius:12px;padding:14px 20px;margin-bottom:20px;color:var(--bad);font-size:13px}.spell-error p{margin:0}.spell-summary h2{font-family:var(--serif);font-size:29px;font-weight:500;line-height:1.5;margin:0 0 26px}.spell-tallies{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px;border-block:1px solid var(--line);padding:22px 0}.spell-tallies>div{display:grid;gap:9px}.spell-tallies strong{font-family:var(--serif);font-size:35px;font-weight:400;line-height:1}.spell-tallies span{font-size:11px;color:var(--ink-soft)}.spell-summary-note{font-size:12px;color:var(--ink-muted);line-height:1.9}.spell-results{padding:0;list-style:none}.spell-results li{display:flex;justify-content:space-between;gap:15px;border-bottom:1px solid var(--line);padding:17px 0;align-items:start}.spell-results li>div{min-width:0;display:grid;gap:5px}.spell-results li>div:last-child{text-align:right;flex:none;max-width:45%}.spell-results strong{font-family:var(--serif);font-weight:500;font-size:23px;overflow-wrap:anywhere}.spell-results span,.spell-results small{font-size:12px;color:var(--ink-soft);overflow-wrap:anywhere}.spell-results small{font-size:11px;color:var(--ink-muted)}.spell-pause,.spell-loading{text-align:center;padding:40px 25px}.spell-pause>span{font-size:40px;color:var(--accent)}.spell-pause h2{font-family:var(--serif);font-weight:500}.spell-pause p{font-size:13px;color:var(--ink-soft)}.spell-pause .btn{margin-top:20px}
@keyframes spell-blink{50%{opacity:0}}@media(prefers-reduced-motion:reduce){.spell-cursor:before,.end-cursor:before{animation:none}}@media(max-width:600px){.spell-workspace{padding:28px 18px 20px;min-height:370px}.spell-meaning{font-size:23px}.spell-toolbar{font-size:11px}.spell-toolbar>div{gap:8px}.spell-progress{font-size:11px}.spell-tallies{grid-template-columns:repeat(2,minmax(0,1fr));gap:25px}.spell-feedback{padding:28px 20px}.spell-feedback h2{font-size:37px}.spell-summary{padding:25px 20px}.spell-summary h2{font-size:25px}.spell-feedback blockquote{font-size:18px}.spell-results li{gap:10px}.spell-results li>div:last-child{max-width:48%}.spell-actions .btn{width:100%}.spell-input-zone{margin-top:30px}.spell-bottom-note{font-size:10px}}
</style>
<style scoped>
.spelling-page .text-button{border:0;background:transparent;color:var(--accent-deep);font:inherit;font-size:12px;padding:7px 4px;border-radius:6px}.spelling-page .text-button:hover{background:var(--accent-soft)}.spelling-page .text-button:disabled{opacity:.45;cursor:default}
</style>
