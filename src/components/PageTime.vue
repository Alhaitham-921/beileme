<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
const props = defineProps({ storageKey:String, paused:Boolean })
const key = 'blm:time:' + props.storageKey
let elapsed = Number(sessionStorage.getItem(key)) || 0
let since = null, timer, active = true
const label = ref('')
function draw() {
  const seconds = Math.floor((elapsed + (since === null ? 0 : performance.now()-since))/1000)
  label.value = Math.floor(seconds/60)+'分 '+String(seconds%60).padStart(2,'0')+'秒'
}
function pause() {
  if (since !== null) elapsed += performance.now()-since
  since = null
  sessionStorage.setItem(key,String(elapsed))
  draw()
}
function sync() {
  if (props.paused || document.hidden || !document.hasFocus() || !active) return pause()
  since ??= performance.now()
  draw()
}
watch(() => props.paused, sync, {flush:"sync"})
function activity(e) { active = !!e.detail; sync() }
onMounted(() => {
  sync(); timer = setInterval(draw,500)
  window.addEventListener('blur',pause); window.addEventListener('focus',sync)
  window.addEventListener('pagehide',pause); window.addEventListener('pageshow',sync)
  document.addEventListener('visibilitychange',sync); document.addEventListener('beileme:app-activity',activity)
})
onUnmounted(() => {
  pause(); clearInterval(timer)
  window.removeEventListener('blur',pause); window.removeEventListener('focus',sync)
  window.removeEventListener('pagehide',pause); window.removeEventListener('pageshow',sync)
  document.removeEventListener('visibilitychange',sync); document.removeEventListener('beileme:app-activity',activity)
})
</script>
<template><slot :label="label"><small class="time">本页学习时长 · <strong>{{ label }}</strong></small></slot></template>
<style scoped>.time{display:block;color:var(--ink-muted);text-align:right;font-size:16px;font-variant-numeric:tabular-nums}</style>
