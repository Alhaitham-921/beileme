<script setup>
import { ref, watch } from 'vue'
import { appearance, backgroundUrl } from '../stores/theme'

const visibleImage = ref('')
watch(backgroundUrl, (url, _, onCleanup) => {
  let cancelled = false
  const image = new Image()
  image.onload = () => { if (!cancelled) visibleImage.value = url }
  image.onerror = () => { if (!cancelled) visibleImage.value = '' }
  image.src = url
  onCleanup(() => { cancelled = true; image.onload = null; image.onerror = null })
}, { immediate: true })
</script>
<template>
  <div class="environment" aria-hidden="true">
    <Transition name="landscape"><div v-if="visibleImage" :key="visibleImage" class="environment-image" :style="{ backgroundImage: `url('${visibleImage}')`, backgroundPosition: appearance.position, filter: `blur(${appearance.blur}px)` }"></div></Transition>
    <div class="environment-dim" :style="{ opacity: appearance.dim / 100 }"></div>
    <div class="environment-vignette"></div>
  </div>
</template>
