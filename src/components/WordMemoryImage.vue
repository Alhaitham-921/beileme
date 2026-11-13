<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { http } from '../api/client.js'
import { loadMemoryImage } from '../utils/memoryImageAssets.js'

const props = defineProps({ word: { type: Object, required: true }, canGenerate: Boolean, sessionId: Number })
const card = ref(null)
const busy = ref(false)
const error = ref('')
const imageUrl = ref('')
const imageError = ref(false)
const imageRetry = ref(0)
const options = computed(() => (card.value?.options || []).filter(item => props.canGenerate || item.status !== 'empty'))
const generationError = computed(() => {
  if (card.value?.selected?.generationError === 'scene') return '文字 AI 没能设计出可用场景，请检查文字 AI 配置后重试。'
  if (card.value?.selected?.generationError === 'image' || card.value?.selected?.status === 'failed') return '这次没能生成记忆图，可以重试。'
  return ''
})
const controller = new AbortController()
let pollTimer
let pollFailures = 0
let wantedSense

watch([() => card.value?.imagePath, imageRetry], async ([path], _, onCleanup) => {
  imageUrl.value = ''
  imageError.value = false
  if (!path) return
  const imageRequest = new AbortController()
  let url
  onCleanup(() => {
    imageRequest.abort()
    if (url) URL.revokeObjectURL(url)
  })
  try {
    url = await loadMemoryImage(path, imageRequest.signal)
    if (imageRequest.signal.aborted) URL.revokeObjectURL(url)
    else imageUrl.value = url
  } catch {
    if (!imageRequest.signal.aborted) imageError.value = true
  }
})

async function update(sense, generate = false, polling = false) {
  if (busy.value || controller.signal.aborted) return
  clearTimeout(pollTimer)
  busy.value = true
  error.value = ''
  wantedSense = sense
  if (!polling) pollFailures = 0
  const path = `/words/${props.word.id}/memory-image`
  const request = { signal: controller.signal, timeoutMs: 10_000 }
  try {
    // Let the submission reach the server even when the learner immediately advances.
    if (generate) {
      const result = await http.post(path, { timeoutMs: request.timeoutMs, body: {
        sense, sessionId: props.sessionId, regenerate: Boolean(card.value?.selected?.hasImage),
      } })
      if (controller.signal.aborted) return
      if (result.status === 'pending') {
        card.value = { ...card.value, selected: { ...card.value.selected, status: 'pending', generationError: null } }
        pollTimer = setTimeout(() => void update(sense, false, true), 1500)
        return
      }
    }
    if (controller.signal.aborted) return
    card.value = await http.get(path, { ...request, query: { sense } })
    pollFailures = 0
    if (!controller.signal.aborted && card.value.selected?.status === 'pending') {
      pollTimer = setTimeout(() => void update(card.value.selected.sense, false, true), 2000)
    }
  } catch (cause) {
    if (!controller.signal.aborted) {
      if (polling && (cause.status === 0 || cause.status >= 500) && ++pollFailures <= 3) {
        pollTimer = setTimeout(() => void update(sense, false, true), 1500 * pollFailures)
      } else error.value = cause.message || '暂时无法读取记忆图。'
    }
  } finally {
    busy.value = false
  }
}

onMounted(() => void update())
onBeforeUnmount(() => {
  clearTimeout(pollTimer)
  controller.abort()
})
</script>

<template>
  <section v-if="canGenerate || options.length" class="memory-image" aria-label="单词记忆图">
    <h3>记忆图</h3>
    <label v-if="options.length > 1" class="memory-sense">
      选择词义
      <select :value="card.selected?.sense" :disabled="busy" @change="update($event.target.value)" @keydown.stop>
        <option v-for="item in options" :key="item.sense" :value="item.sense">{{ item.sense }}{{ item.hasImage ? '（已有图）' : '' }}</option>
      </select>
    </label>
    <figure v-if="card?.imagePath">
      <img v-if="imageUrl && !imageError" :src="imageUrl" :alt="`${word.spelling}（${card.selected.sense}）的 AI 记忆插图`" width="640" height="640"
        decoding="async" @error="imageError = true">
      <p v-else-if="imageError" role="status">图片没有加载成功。<button type="button" class="text-button" @click="imageRetry++">重新加载图片</button></p>
      <p v-else role="status">正在加载图片…</p>
      <figcaption>
        <span lang="en">{{ word.spelling }}</span> · {{ card.selected.sense }} · AI 生成
        <p v-if="card.explanation" class="memory-explanation"><strong>这样记</strong> {{ card.explanation }}</p>
      </figcaption>
    </figure>
    <p v-if="!error && card?.selected?.status === 'pending'" role="status">正在设计场景和生成插图，可以继续学习。</p>
    <p v-else-if="!error && !card && busy" role="status">正在查找记忆图…</p>
    <p v-else-if="!error && generationError" role="status">{{ generationError }}</p>
    <p v-else-if="!error && !card?.imagePath && canGenerate && card && !card.enabled">记忆图生成服务尚未启用。</p>
    <p v-else-if="!error && !card?.imagePath && canGenerate && card?.selected">文字 AI 先设计场景，再生成插图，分别按服务商计费。</p>
    <p v-if="error" role="status">{{ error }} <button type="button" class="text-button" @click="update(wantedSense)">重新查看</button></p>
    <button v-if="canGenerate && card?.enabled && card.selected && card.selected.status !== 'pending'" type="button"
      class="btn btn-ghost" :disabled="busy" @click="update(card.selected.sense, true)">
      {{ card.selected.status === 'empty' ? '生成记忆图' : '重新生成记忆图' }}
    </button>
  </section>
</template>

<style scoped>
.memory-image { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; color: var(--ink-soft); }
.memory-image h3 { margin: 0 0 8px; font-size: 14px; color: var(--ink); }
.memory-image p, .memory-sense, figcaption { font-size: 12px; }
.memory-sense { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.memory-sense select { min-width: 0; max-width: 100%; padding: 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg-card); color: var(--ink); }
.memory-image figure { margin: 8px 0 0; }
.memory-image img { display: block; width: min(100%, 320px); height: auto; border-radius: 10px; }
.memory-image figcaption { margin-top: 5px; }
.memory-explanation { margin: 6px 0 0; line-height: 1.65; color: var(--ink); }
</style>
