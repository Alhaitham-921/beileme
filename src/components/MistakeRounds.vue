<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import StudyChoices from './StudyChoices.vue'
import { matchesSpelling } from '../../shared/spelling.js'
import { advanceMistakeReview, startMistakeReview } from '../utils/mistakeReview.js'
import { createTypingSound, submittedSpellingLetters } from '../utils/spellingPractice.js'
import { spellingSoundEnabled, tone } from '../stores/spellingSound.js'
const props = defineProps({ items: { type: Array, required: true }, favoriteOverrides: Map })
const emit = defineEmits(['done', 'favorite'])
const review = ref(startMistakeReview(props.items))
const entry = computed(() => review.value.queue[review.value.index])
const item = computed(() => entry.value?.item)
const step = computed(() => entry.value?.step)
const typed = ref(''), feedback = ref(null), selectedIndex = ref(null), revealed = ref(false)
const field = ref(null), heading = ref(null), continueButton = ref(null), composing = ref(false)
const recallMeaning = ref(null), reviewSection = ref(null)
const pos = computed(() => item.value?.word.pos?.trim() ||
  item.value?.options.find(option => option.index === item.value.correctOptionIndex)?.pos ||
  '词性未标注')
const meaning = computed(() => item.value?.word.definitions.join('；'))
const letters = computed(() => step.value === 2 && feedback.value !== null
  ? submittedSpellingLetters(typed.value, item.value.word.spelling)
  : [])
const sound = createTypingSound()

function play(value) { if (spellingSoundEnabled.value) sound.play(value, tone.value) }
async function check(option) {
  if (feedback.value !== null || (step.value === 2 && (!typed.value.trim() || composing.value))) return
  const ok = step.value === 2
    ? matchesSpelling(typed.value, item.value.word.spelling)
    : option === item.value.correctOptionIndex
  selectedIndex.value = option ?? null
  feedback.value = ok
  play(ok || 'error')
  await nextTick()
  continueButton.value?.focus({ preventScroll: true })
}

function focusQuestion() {
  reviewSection.value?.scrollIntoView({ block: 'start' })
  const target = field.value || heading.value
  target?.focus({ preventScroll: true })
}
async function next(correct) {
  review.value = advanceMistakeReview(review.value, correct)
  if (!review.value.queue.length) {
    emit('done')
    return
  }
  feedback.value = null
  selectedIndex.value = null
  typed.value = ''
  revealed.value = false
  composing.value = false
  await nextTick()
  focusQuestion()
}
async function reveal() {
  revealed.value = true
  await nextTick()
  recallMeaning.value?.focus({ preventScroll: true })
}
function key(e) {
  if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey ||
      e.target?.closest?.('.option-word, .word-dialog')) return
  if (feedback.value !== null && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault()
    if (!e.repeat) next(feedback.value)
  } else if (!e.repeat && step.value === 1 && /^[1-4]$/.test(e.key)) {
    const option = item.value?.options[Number(e.key) - 1]
    if (option) check(option.index)
  }
}
function spellingEnter(event) {
  if (composing.value || event.isComposing || event.keyCode === 229 || event.repeat) event.preventDefault()
}
onMounted(() => { focusQuestion(); window.addEventListener('keydown', key) })
onUnmounted(() => { sound.close(); window.removeEventListener('keydown', key) })
</script>
<template>
  <section v-if="item" ref="reviewSection" class="mistake-review">
    <header class="review-progress">
      <div><span class="review-badge">第 {{ entry.attempt }} 次复习</span><span>第 {{ step }} 步 · {{ ['选词义', '拼写测试', '自主回忆'][step - 1] }}</span></div>
      <span>已完成 {{ review.completed }} / {{ items.length }} 词</span>
    </header>

    <div v-if="step === 1" class="card review-card">
      <h2 ref="heading" class="review-word" lang="en" tabindex="-1">{{ item.word.spelling }}</h2>
      <p class="review-meta">{{ [item.word.phonetic, item.word.pos].filter(Boolean).join(' · ') }}</p>
      <p class="review-prompt">选择正确的中文释义</p>
      <StudyChoices
        :options="item.options"
        :answered="feedback !== null"
        :correct-index="item.correctOptionIndex"
        :selected-index="selectedIndex"
        :favorite-overrides="favoriteOverrides"
        @choose="check"
        @favorite="(id, value) => emit('favorite', id, value)"
      />
      <p v-if="feedback !== null" class="review-feedback" :class="feedback ? 'ok' : 'bad'" role="status">
        {{ feedback ? '回答正确，下一轮测试拼写。' : '这次选错了，下一轮重新选词义。' }}
      </p>
      <div v-if="feedback !== null" class="review-actions"><button ref="continueButton" class="btn btn-primary" type="button" @click="next(feedback)">继续</button></div>
    </div>

    <div v-else-if="step === 2" class="mistake-spelling">
      <div id="mistake-spelling-cue" class="spelling-cue">
        <span class="spelling-pos">{{ pos }}</span>
        <h2>{{ meaning }}</h2>
      </div>
      <form class="spelling-form" @submit.prevent="check()" @keydown.enter="spellingEnter">
        <input
          v-if="feedback === null"
          ref="field"
          v-model="typed"
          class="spelling-line"
          type="text"
          lang="en"
          maxlength="512"
          aria-label="默写英文单词"
          aria-describedby="mistake-spelling-cue"
          placeholder="输入英文拼写"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="done"
          @compositionstart="composing = true"
          @compositionend="composing = false"
          @input="play(false)"
        >
        <div v-else class="spelling-line submitted-spelling" lang="en"><span
          v-for="(letter, i) in letters"
          :key="i"
          :class="letter.status"
        >{{ letter.text }}</span></div>
        <button
          class="btn btn-primary spelling-confirm"
          type="submit"
          aria-label="确认拼写"
          title="确认拼写（Enter）"
          :disabled="feedback !== null || !typed.trim()"
        ><AppIcon name="check" /></button>
      </form>
      <div class="mistake-result" role="status">
        <p v-if="feedback === true">拼写正确，下一轮自主回忆。</p>
        <p v-else-if="feedback === false">正确拼写 <strong lang="en">{{ item.word.spelling }}</strong><br>下一轮重新选词义。</p>
      </div>
      <button v-if="feedback !== null" ref="continueButton" class="btn btn-secondary" type="button" @click="next(feedback)">继续</button>
    </div>

    <div v-else class="card review-card recall-card">
      <h2 ref="heading" class="review-word" lang="en" tabindex="-1">{{ item.word.spelling }}</h2>
      <p class="review-meta">{{ [item.word.phonetic, item.word.pos].filter(Boolean).join(' · ') }}</p>
      <p v-if="!revealed" class="review-prompt">先回想这个词的中文意思，再查看释义。</p>
      <p ref="recallMeaning" class="recall-meaning" :class="{ obscured: !revealed }" :aria-hidden="!revealed" :tabindex="revealed ? -1 : undefined" aria-live="polite">
        {{ revealed ? meaning : '释义暂时隐藏' }}
      </p>
      <button v-if="!revealed" class="btn btn-primary" type="button" @click="reveal">显示释义</button>
      <div v-else class="review-actions">
        <button class="btn btn-secondary" type="button" @click="next(false)">没想起来</button>
        <button class="btn btn-primary" type="button" @click="next(true)">想起来了</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mistake-review { scroll-margin-top: 12px; }
.review-progress { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 20px; color: var(--ink-soft); font-size: 12px; }
.review-progress div { display: flex; gap: 10px; align-items: center; }
.review-badge { padding: 4px 9px; border-radius: 6px; color: var(--hint-ink); background: var(--hint-bg); }
.review-card { padding: clamp(24px, 5vw, 42px) clamp(18px, 5vw, 38px); background: var(--surface-study, var(--bg-card)); }
.review-word { margin: 12px 0; text-align: center; font: 500 clamp(30px, 8vw, 62px)/1.2 var(--serif); overflow-wrap: anywhere; }
.review-meta { margin: 0 0 32px; text-align: center; color: var(--ink-soft); }
.review-prompt { margin: 0 0 12px; color: var(--ink-soft); font-size: 12px; }
.review-feedback { margin: 14px 0 0; }
.review-feedback.ok { color: var(--ok); }
.review-feedback.bad { color: var(--bad); }
.review-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.recall-card { text-align: center; }
.recall-card .review-actions { justify-content: center; }
.recall-meaning { margin: 18px 0; font-size: 1.22rem; overflow-wrap: anywhere; }
.recall-meaning.obscured { filter: blur(7px); user-select: none; }
.mistake-spelling {
  padding: clamp(28px, 7vh, 72px) 0 clamp(36px, 8vh, 76px);
  text-align: center;
}
.spelling-cue { margin: 24px auto 28px; }
.spelling-pos { color: var(--accent); font-size: .95rem; font-weight: 600; }
.spelling-cue h2 {
  margin: 4px 0 0;
  font-size: clamp(1.45rem, 4.5vw, 2rem);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.spelling-form {
  --confirm-size: 44px;
  display: grid;
  grid-template-columns: var(--confirm-size) minmax(0, 1fr) var(--confirm-size);
  align-items: center;
  gap: clamp(8px, 2vw, 16px);
  max-width: 31rem;
  margin-inline: auto;
}
.spelling-line {
  grid-column: 2;
  width: 100%;
  min-height: 54px;
  padding: 6px 2px;
  border: 0;
  border-bottom: 1px solid var(--ink-muted);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  font: 600 clamp(1.375rem, 5vw, 2rem)/1.35 ui-monospace, Consolas, monospace;
  text-align: center;
}
input.spelling-line { caret-color: var(--accent); }
input.spelling-line:focus { border-bottom-color: var(--accent); outline: 0; box-shadow: 0 1px var(--accent); }
input.spelling-line::placeholder { color: var(--ink-soft); font: 400 1rem var(--sans); }
.submitted-spelling { overflow-wrap: anywhere; white-space: pre-wrap; }
.submitted-spelling .correct { color: var(--ok); }
.submitted-spelling :is(.wrong, .missing) { color: var(--bad); }
.submitted-spelling .wrong { text-decoration: underline; text-underline-offset: .14em; }
.spelling-confirm {
  grid-column: 3;
  width: var(--confirm-size);
  height: var(--confirm-size);
  padding: 0;
  border-radius: 50%;
}
.spelling-confirm:disabled {
  opacity: 1;
  color: var(--ink-soft);
  background: var(--accent-soft);
  box-shadow: none;
}
.mistake-spelling .mistake-result p { margin: 18px 0 12px; color: var(--ink-soft); }
.mistake-spelling .mistake-result strong { margin-inline-start: .25em; color: var(--ink); }
</style>
