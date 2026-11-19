<script setup>
import { ref, watch } from 'vue'
import { http } from '../api/client.js'
import { useAuthStore } from '../stores/auth.js'
import NameAvatar from './NameAvatar.vue'
const props = defineProps({ src: String, label: { type: String, default: '学习者' }, size: { type: Number, default: 38 } })
const auth = useAuthStore(), image = ref('')
watch([() => props.src, () => auth.user?.id], async ([src], _, onCleanup) => {
  const controller = new AbortController()
  let url
  image.value = ''
  onCleanup(() => { controller.abort(); if (url) URL.revokeObjectURL(url) })
  if (!src || !/^\/profile\/avatars\/\d+\/[a-f0-9]{32}$/.test(src)) return
  try {
    const blob = await http.getBlob(src, { signal: controller.signal, timeoutMs: 10000 })
    if (controller.signal.aborted) return
    url = URL.createObjectURL(blob); image.value = url
  } catch { /* Keep the initial when offline or the avatar has been replaced. */ }
}, { immediate: true })
</script>
<template><span class="user-avatar" :style="{width:size+'px',height:size+'px'}"><img v-if="image" :src="image" :alt="`${label}的头像`" loading="lazy" @error="image=''" /><NameAvatar v-else :name="label" :size="size" /></span></template>
<style scoped>
.user-avatar{display:inline-grid;place-items:center;flex:none;width:38px;height:38px;overflow:hidden;border-radius:50%;background:var(--accent-soft);color:var(--accent-deep);font-size:14px}.user-avatar img{width:100%;height:100%;object-fit:cover;display:block}
</style>
