<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { hasActivity } from '../stores/activity.js'

const visible = ref(false)
let showTimer, hideTimer, shownAt = 0
watch(hasActivity, busy => {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  if (busy) {
    if (!visible.value) showTimer = setTimeout(() => { shownAt = Date.now(); visible.value = true }, 180)
  } else if (visible.value) {
    hideTimer = setTimeout(() => { visible.value = false }, Math.max(0, 350 - (Date.now() - shownAt)))
  }
}, { immediate: true })
onBeforeUnmount(() => { clearTimeout(showTimer); clearTimeout(hideTimer) })
</script>

<template>
  <Transition name="activity"><div v-if="visible" class="activity-indicator" role="status" aria-label="正在加载"><span></span></div></Transition>
</template>
