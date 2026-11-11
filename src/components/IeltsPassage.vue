<script setup>
import {computed} from 'vue'
const props=defineProps({text:String,sectionId:String,marked:Array,disabled:Boolean})
const emit=defineEmits(['mark'])
const paragraphs=computed(()=>String(props.text||'').split(/\n\s*\n/))
</script>
<template><div class="ielts-passage"><div v-for="(paragraph,index) in paragraphs" :key="index" :class="{'passage-marked':marked.includes(`${sectionId}:${index}`)}"><p>{{paragraph}}</p><button v-if="!disabled" type="button" class="passage-mark" :aria-label="`标记第 ${index+1} 段`" :aria-pressed="marked.includes(`${sectionId}:${index}`)" @click="emit('mark',`${sectionId}:${index}`)">{{marked.includes(`${sectionId}:${index}`)?'已高亮':'高亮本段'}}</button></div></div></template>
<style scoped>.ielts-passage>div{padding:4px 10px;margin:10px -10px;border-radius:6px}.ielts-passage p{white-space:pre-line;font:17px/1.95 var(--serif)}.passage-marked{background:var(--accent-soft)}.passage-mark{border:0;background:transparent;color:var(--ink-muted);font-size:11px;padding:4px 0}.passage-mark[aria-pressed=true]{color:var(--accent-deep)}</style>
