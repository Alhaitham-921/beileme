<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  text: { type: String, default: '' },
  targets: { type: Array, default: () => [] },
  corrections: { type: Array, default: () => [] },
})
const selected = ref(null)
const labels = { grammar: '语法', word_usage: '用词', word_sense: '词义', sense: '词义', sense_misuse: '词义用错', spelling: '拼写', chinese_help: '中文求助' }
const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const parts = computed(() => {
  const spans = []
  for (const correction of props.corrections) {
    if (!correction.original) continue
    let start = props.text.indexOf(correction.original)
    while (start !== -1) {
      spans.push({ start, end: start + correction.original.length, kind: 'correction', data: correction })
      start = props.text.indexOf(correction.original, start + correction.original.length)
    }
  }
  for (const target of props.targets) {
    if (!target.word) continue
    const pattern = new RegExp(`\\b${escape(target.word)}\\b`, 'gi')
    for (const match of props.text.matchAll(pattern)) {
      spans.push({ start: match.index, end: match.index + match[0].length, kind: 'word', data: target })
    }
  }
  spans.sort((a, b) => a.start - b.start || Number(b.kind === 'correction') - Number(a.kind === 'correction') || b.end - a.end)
  const result = []
  let end = 0
  for (const span of spans) {
    if (span.start < end) continue
    if (span.start > end) result.push({ text: props.text.slice(end, span.start), kind: 'text' })
    result.push({ ...span, text: props.text.slice(span.start, span.end) })
    end = span.end
  }
  if (end < props.text.length) result.push({ text: props.text.slice(end), kind: 'text' })
  return result
})
watch(() => props.text, () => { selected.value = null })
</script>

<template>
  <div class="practice-text">
    <p class="message-text"><template v-for="(part, index) in parts" :key="index"><button v-if="part.kind !== 'text'" type="button" :class="['inline-token', part.kind]" :aria-label="part.kind === 'word' ? `查看 ${part.text} 在本场景的释义` : `查看 ${part.text} 的表达建议`" :aria-expanded="selected === index" @click="selected = selected === index ? null : index">{{ part.text }}</button><template v-else>{{ part.text }}</template></template></p>
    <div v-if="selected !== null && parts[selected]" class="inline-detail" aria-live="polite">
      <template v-if="parts[selected].kind === 'word'"><strong>{{ parts[selected].data.word }}</strong> · {{ parts[selected].data.sense }}<span v-if="parts[selected].data.phrase"> · {{ parts[selected].data.phrase }}</span></template>
      <template v-else><span class="label">{{ labels[parts[selected].data.type] || '表达建议' }}</span> {{ parts[selected].data.original }} → <strong>{{ parts[selected].data.replacement }}</strong><p>{{ parts[selected].data.explanation }}</p></template>
      <button class="close-detail" type="button" aria-label="收起说明" @click="selected = null">收起</button>
    </div>
  </div>
</template>

<style scoped>
.message-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.9; }
.inline-token { display: inline; padding: 0 1px; border: 0; color: inherit; font: inherit; line-height: inherit; border-radius: 3px; }
.word { background: var(--accent-soft); color: var(--accent-deep); font-weight: 650; }
.correction { background: transparent; text-decoration: underline; text-decoration-color: var(--ink-soft); text-decoration-style: dotted; text-underline-offset: 5px; text-decoration-thickness: 1px; }
.inline-detail { margin-top: 10px; padding: 10px 12px; border-radius: 9px; background: var(--bg-card); border: 1px solid var(--line); color: var(--ink); font-size: 13px; }
.inline-detail p { margin: 5px 0; }.label { color: var(--ink-soft); }.close-detail { border: 0; color: var(--accent-deep); font: inherit; background: transparent; margin-left: 8px; }
</style>
