<script setup>
import { ref,watch } from 'vue'
import { loadMemoryImage } from '../utils/memoryImageAssets.js'
const props=defineProps({panel:Object,canRetry:Boolean,busy:Boolean})
defineEmits(['retry'])
const url=ref(''),failed=ref(false),attempt=ref(0)
watch([()=>props.panel.imagePath,attempt],async([path],_,cleanup)=>{
  url.value='';failed.value=false;const controller=new AbortController();let objectUrl
  cleanup(()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)})
  if(!path)return
  try{objectUrl=await loadMemoryImage(path,controller.signal);if(controller.signal.aborted)URL.revokeObjectURL(objectUrl);else url.value=objectUrl}catch{if(!controller.signal.aborted)failed.value=true}
},{immediate:true})
</script>
<template>
  <figure class="scenario-panel">
    <img v-if="url&&!failed" :src="url" :alt="panel.caption" width="640" height="640" decoding="async" @error="failed=true">
    <div v-else class="panel-placeholder">
      <template v-if="failed"><p>图片暂未加载出来</p><button class="text-button" @click="attempt++">重新加载</button></template>
      <LoadingState v-else-if="panel.status==='pending'">正在画这一幕…</LoadingState>
      <template v-else-if="panel.status==='failed'"><p>{{panel.error==='disabled'?'已停止自动生图':'这一幕暂未生成，仍可继续聊天。'}}</p><button v-if="canRetry" type="button" class="text-button" :disabled="busy" @click="$emit('retry',panel.id)">{{busy?'正在提交…':'重新生成这一幕'}}</button></template>
      <LoadingState v-else>正在加载图片…</LoadingState>
    </div>
    <figcaption><small>{{panel.turn?`第 ${panel.turn} 轮`:'故事开场'}}</small><span>{{panel.caption}}</span></figcaption>
  </figure>
</template>
<style scoped>
.scenario-panel{flex:0 0 min(280px,78vw);margin:0;scroll-snap-align:start;background:var(--bg-card);border:1px solid var(--line);border-radius:14px;overflow:hidden}.scenario-panel img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:contain}.panel-placeholder{aspect-ratio:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;padding:20px;text-align:center;font-size:12px;background:var(--accent-soft)}figcaption{display:grid;gap:5px;padding:12px 14px;font-size:13px;line-height:1.6}figcaption small{color:var(--ink-muted);font-size:10px}
</style>
