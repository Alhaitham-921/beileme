<script setup>
import { ref, watch } from 'vue'
import { loadMemoryImage } from '../utils/memoryImageAssets.js'

const props = defineProps({ image: { type: Object, required: true } })
const url = ref(''), failed = ref(false), retry = ref(0)
watch([() => props.image.imagePath, retry], async ([path], _, cleanup) => {
  url.value = ''; failed.value = false
  const controller = new AbortController()
  let objectUrl
  cleanup(() => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) })
  if (!path) return
  try {
    objectUrl = await loadMemoryImage(path, controller.signal)
    if (controller.signal.aborted) URL.revokeObjectURL(objectUrl)
    else url.value = objectUrl
  } catch { if (!controller.signal.aborted) failed.value = true }
}, { immediate: true })
</script>

<template>
  <figure class="practice-image">
    <a v-if="url" :href="url" target="_blank" rel="noopener" aria-label="放大查看练习图片"><img :src="url" alt="本轮对话使用的单词记忆图" width="640" height="640" @error="failed = true; url = ''"></a>
    <div v-else class="practice-image-placeholder"><p v-if="failed">图片暂未显示<button type="button" class="text-button" @click="retry++">重新加载</button></p><LoadingState v-else>正在加载图片…</LoadingState></div>
    <figcaption><strong>看图聊三轮</strong><p>{{ image.word }} · {{ image.sense }}</p><small>围绕这张图开口表达，每轮回复都会保存。</small></figcaption>
  </figure>
</template>

<style scoped>
.practice-image { display:flex; align-items:center; gap:20px; margin:0 0 20px; padding:16px; border:1px solid var(--line); border-radius:14px; background:var(--accent-soft); }
.practice-image a,.practice-image-placeholder { flex:none; width:128px; min-height:128px; border-radius:10px; overflow:hidden; }
.practice-image img { display:block; width:100%; height:auto; }
.practice-image-placeholder { display:grid; place-items:center; font-size:12px; }
figcaption { min-width:0; overflow-wrap:anywhere; } figcaption strong { font-size:17px; } figcaption p { margin:8px 0; } figcaption small { color:var(--ink-soft); line-height:1.7; }
@media(max-width:480px) { .practice-image { gap:12px; padding:12px; } .practice-image a,.practice-image-placeholder { width:96px; min-height:96px; } figcaption strong { font-size:15px; } figcaption p { font-size:13px; } }
</style>
