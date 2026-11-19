<script setup>
import { ref,watch,onBeforeUnmount,nextTick } from 'vue'
import { practice } from '../api'
import ScenarioPanel from './ScenarioPanel.vue'
const props=defineProps({sceneId:String,sessionId:Number,turn:Number})
const items=ref([]),autoImages=ref(true),available=ref(false),loading=ref(true),error=ref(''),retrying=ref(null),rail=ref(null)
let timer,controller,disposed=false,run=0,failures=0
async function load(reset=false){
  clearTimeout(timer);controller?.abort();const token=++run;controller=new AbortController()
  if(reset){items.value=[];loading.value=true;failures=0}
  try{
    const data=await practice.illustrations(props.sessionId?{sessionId:props.sessionId}:{sceneId:props.sceneId},{signal:controller.signal,timeoutMs:10000})
    if(disposed||token!==run)return
    const added=data.items.length>items.value.length;items.value=data.items;autoImages.value=data.autoImages;available.value=data.available;error.value='';failures=0
    if(added){await nextTick();rail.value?.scrollTo({left:rail.value.scrollWidth,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
    if(data.items.some(p=>p.status==='pending'))timer=setTimeout(()=>load(),2500)
  }catch(e){if(!disposed&&token===run){error.value=e.message;if(++failures<=3)timer=setTimeout(()=>load(),3000*failures)}}
  finally{if(token===run)loading.value=false}
}
async function retry(id=null){if(retrying.value!==null)return;retrying.value=id||0;error.value='';try{await practice.retryIllustration(id,props.sceneId);await load()}catch(e){error.value=e.message}finally{retrying.value=null}}
const refresh=()=>load()
document.addEventListener('beileme:illustration-settings',refresh)
watch([()=>props.sceneId,()=>props.sessionId],()=>load(true),{immediate:true})
watch(()=>props.turn,()=>load())
onBeforeUnmount(()=>{disposed=true;run++;clearTimeout(timer);controller?.abort();document.removeEventListener('beileme:illustration-settings',refresh)})
</script>
<template>
  <details v-if="items.length||available||loading||error" class="scenario-comic" open>
    <summary>情境分镜 <small>{{autoImages?'随对话展开，图片在后台生成':'自动生图已关闭，已有图片保留'}}</small></summary>
    <div v-if="items.length" ref="rail" class="comic-rail" aria-label="按对话顺序排列的情境图片"><ScenarioPanel v-for="panel in items" :key="panel.id" :panel="panel" :can-retry="autoImages&&available" :busy="retrying!==null" @retry="retry" /></div>
    <LoadingState v-else-if="loading">正在读取情境图…</LoadingState>
    <p v-else-if="autoImages&&available" class="comic-note">还没有情境图。<button type="button" class="text-button" :disabled="retrying!==null" @click="retry()">{{retrying!==null?'正在提交…':'生成开场图'}}</button></p>
    <p v-if="error" class="comic-note" role="status">{{error}} <button class="text-button" @click="load()">重新读取</button></p>
  </details>
</template>
<style scoped>
.scenario-comic{padding:18px 24px;border-bottom:1px solid var(--line)}summary{cursor:pointer;font-size:14px;font-weight:550}summary small{display:inline-block;font-weight:400;font-size:11px;color:var(--ink-soft);margin-left:10px}.comic-rail{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:14px 0 6px;overscroll-behavior-x:contain}.comic-note{font-size:12px;color:var(--ink-soft)}@media(max-width:600px){.scenario-comic{padding:14px}summary small{display:block;margin:5px 0 0}}
</style>
