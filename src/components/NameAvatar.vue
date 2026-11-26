<script setup>
import { computed } from 'vue'
const props = defineProps({ name: { type: String, default: 'Learner' }, size: { type: Number, default: 48 } })
const label = computed(() => props.name.trim() || 'Learner')
const fontSize = computed(() => Math.max(7,Math.min(16,(props.size-10)/Math.max(...label.value.split(/\s+/).map(w=>w.length))*1.65)))
</script>
<template><span class="name-avatar" role="img" :aria-label="`${label} 的文字头像`" :title="label" :style="{width:size+'px',height:size+'px',fontSize:fontSize+'px'}"><span>{{ label }}</span></span></template>
<style scoped>
.name-avatar { flex-shrink:0; display:inline-flex; justify-content:center; align-items:center; box-sizing:border-box; border:1.5px solid var(--accent); border-radius:50%; background:var(--accent-soft,var(--surface)); color:var(--ink); padding:5px; line-height:1.15; text-align:center; font-weight:600; overflow:hidden; }
.name-avatar span { word-break:normal;overflow-wrap:normal;display:block;max-width:100%; }
</style>
