<script setup>
import { nextTick, ref, useId } from 'vue'
import { words } from '../api/index.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  options: { type: Array, required: true },
  answered: Boolean,
  disabled: Boolean,
  correctIndex: Number,
  selectedIndex: Number,
  favoriteOverrides: Map,
})
const emit = defineEmits(['choose', 'favorite'])
const dialog = ref(null), detail = ref(null), titleId = useId()
const saving = ref(new Set()), errors = ref(new Map())

function choiceClass(index) {
  if (!props.answered) return index === props.selectedIndex ? 'selected' : ''
  if (index === props.correctIndex) return 'correct'
  return index === props.selectedIndex ? 'wrong' : 'dim'
}

async function openWord(word) {
  detail.value = word
  await nextTick()
  dialog.value?.showModal()
}

function saved(word) {
  return props.favoriteOverrides?.get(word.id) ?? word.defaultSaved
}

async function toggleFavorite(word) {
  if (saving.value.has(word.id)) return
  const next = !saved(word)
  saving.value.add(word.id)
  errors.value.delete(word.id)
  try {
    await (next ? words.favorite(word.id) : words.unfavorite(word.id))
    emit('favorite', word.id, next)
  } catch (error) {
    errors.value.set(word.id, error.message)
  } finally {
    saving.value.delete(word.id)
  }
}
</script>

<template>
  <div class="option-grid study-choices">
    <component
      :is="answered ? 'div' : 'button'"
      v-for="option in options"
      :key="option.index"
      class="option choice"
      :class="choiceClass(option.index)"
      :type="answered ? undefined : 'button'"
      :disabled="answered ? undefined : disabled"
      @click="!answered && emit('choose', option.index)"
    >
      <span class="opt-key">{{ option.index + 1 }}</span>
      <span class="opt-text">
        <span v-if="option.pos" class="option-pos">{{ option.pos }} </span>
        <template v-if="option.primary && option.text.startsWith(option.primary)">
          <strong>{{ option.primary }}</strong>{{ option.text.slice(option.primary.length) }}
        </template>
        <template v-else>{{ option.text }}</template>
        <span v-if="answered && option.word" class="option-word">
          <button class="word-detail" type="button" lang="en" @click="openWord(option.word)">{{ option.word.spelling }}</button>
          <button
            class="word-star"
            type="button"
            :aria-label="`收藏 ${option.word.spelling} 至默认生词本`"
            :aria-pressed="saved(option.word)"
            :disabled="saving.has(option.word.id)"
            :title="saved(option.word) ? '从默认生词本移除' : '收藏至默认生词本'"
            @click="toggleFavorite(option.word)"
          ><AppIcon name="star" /></button>
        </span>
        <small v-if="answered && errors.has(option.word?.id)" class="favorite-error" role="alert">{{ errors.get(option.word.id) }}</small>
      </span>
      <template v-if="answered && (option.index === correctIndex || option.index === selectedIndex)">
        <span class="visually-hidden">{{ option.index === correctIndex ? '正确答案' : '你的选择，回答错误' }}</span>
        <AppIcon class="option-status" :name="option.index === correctIndex ? 'check' : 'close'" />
      </template>
    </component>
  </div>

  <dialog ref="dialog" class="word-dialog" :aria-labelledby="titleId" @keydown.stop @touchstart.stop @click.self="dialog.close()">
    <template v-if="detail">
      <div class="word-dialog-heading">
        <h2 :id="titleId" lang="en">{{ detail.spelling }}</h2>
        <button class="icon-button" type="button" aria-label="关闭单词详情" autofocus @click="dialog.close()"><AppIcon name="close" /></button>
      </div>
      <p v-if="detail.phonetic || detail.pos" class="word-dialog-meta"><span>{{ detail.phonetic }}</span><span>{{ detail.pos }}</span></p>
      <ul class="word-definitions"><li v-for="(definition, i) in detail.definitions" :key="i">{{ definition }}</li></ul>
    </template>
  </dialog>
</template>

<style scoped>
.study-choices { gap: 10px; }
.choice { min-height: 66px; background: var(--bg-card); padding: 15px 18px; font-size: 14px; gap: 16px; touch-action: manipulation; }
button.choice:disabled { cursor: default; }
.choice.selected { outline: 2px solid var(--accent); background: var(--accent-soft); opacity: 1; }
.choice .opt-key { width: 26px; height: 26px; background: transparent; border: 1px solid var(--line); border-radius: 6px; color: var(--ink-soft); font-size: 11px; font-weight: 400; }
.opt-text { min-width: 0; flex: 1; line-height: 1.8; overflow-wrap: anywhere; }
.opt-text strong { font-weight: 500; }
.option-pos { color: var(--ink-soft); font-size: .875em; margin-right: 4px; }
div.choice { cursor: default; }
div.choice:hover { border-color: var(--line); background: var(--bg-card); }
div.choice.correct { border-color: var(--ok); background: var(--ok-soft); color: var(--ok); }
div.choice.wrong { border-color: var(--bad); background: var(--bad-soft); color: var(--bad); }
.choice.correct .opt-key, .choice.wrong .opt-key { border-color: currentColor; color: inherit; }
.choice.dim { color: var(--ink-soft); }
.option-status { width: 18px; height: 18px; flex: none; }
.option-word { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; margin-inline-start: 8px; vertical-align: middle; }
.word-detail, .word-star { background: transparent; border: 0; color: var(--accent-deep); }
.word-detail { padding: 4px 0; min-width: 0; font: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: .18em; overflow-wrap: anywhere; }
.word-star { flex: none; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border-radius: 50%; }
.word-star:hover { background: var(--accent-soft); }
.word-star svg { width: 17px; height: 17px; }
.word-star[aria-pressed='true'] { color: var(--color-warning); }
.word-star[aria-pressed='true'] svg { fill: currentColor; }
.favorite-error { display: block; color: var(--bad); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.word-dialog { width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 22px; border: 1px solid var(--line); border-radius: var(--radius); color: var(--ink); background: var(--bg-card); box-shadow: var(--shadow); }
.word-dialog::backdrop { background: rgba(4, 10, 18, .68); }
.word-dialog-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.word-dialog h2 { margin: 0; font: 500 2rem/1.2 var(--serif); overflow-wrap: anywhere; }
.word-dialog-meta { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 0; color: var(--ink-soft); }
.word-definitions { margin: 16px 0 0; padding-inline-start: 20px; overflow-wrap: anywhere; }
.word-definitions li + li { margin-top: 6px; }
@media (max-width: 600px) {
  .choice { padding: 13px 14px; min-height: 62px; font-size: 13px; gap: 12px; }
  .choice .opt-key { width: 23px; height: 23px; }
}
</style>
