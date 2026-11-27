<script setup>
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { http } from '../api/client.js'
import { loadMemoryImage } from '../utils/memoryImageAssets.js'
const props=defineProps({sessionId:Number,actorId:String})
const mobile=typeof window!=='undefined'&&window.matchMedia('(max-width: 900px)').matches
const state=ref(null),url=ref(''),busy=ref(false),error=ref(''),open=ref(!mobile)
const enlarged=ref(false),closeButton=ref(null),imageButton=ref(null)
const queued=ref(false)
const pending=computed(()=>queued.value||state.value?.status==='pending')
let previousOverflow
async function enlarge(){
  if(!url.value)return
  previousOverflow=document.body.style.overflow
  document.body.style.overflow='hidden'
  enlarged.value=true
  await nextTick();closeButton.value?.focus()
}
function closeImage(){
  if(!enlarged.value)return
  enlarged.value=false
  document.body.style.overflow=previousOverflow??''
  imageButton.value?.focus()
}
function modalKey(event){
  if(event.key==='Escape'){event.preventDefault();closeImage()}
  if(event.key==='Tab'){event.preventDefault();closeButton.value?.focus()}
}
let timer, statusRequest, imageRequest
async function load({ generate = false, regenerate = false, auto = false } = {}) {
  const { signal } = statusRequest
  const { sessionId, actorId } = props
  const path = `/practice/sessions/${sessionId}/scene-image`
  clearTimeout(timer)
  busy.value = true
  error.value = ''
  const start = () => http.post(path, { body: { regenerate, actorId }, signal })
  try {
    let data = generate ? await start() : await http.get(path, { signal })
    if (signal.aborted || data.actorId !== (actorId ?? null)) return
    state.value = data
    if (auto && data.enabled && data.status === 'empty') {
      data = await start()
      if (signal.aborted || data.actorId !== (actorId ?? null)) return
      state.value = data
    }
    queued.value = false
    if (data.status === 'pending') timer = setTimeout(() => load(), 2000)
  } catch (e) {
    if (signal.aborted) return
    if (e.details?.reason === 'image_generation_pending') {
      queued.value = true
      timer = setTimeout(() => load({ generate: true, regenerate }), 2000)
    } else {
      queued.value = false
      error.value = e.message
    }
  } finally {
    if (!signal.aborted) busy.value = false
  }
}
watch([()=>props.sessionId,()=>props.actorId],()=>{
  closeImage()
  statusRequest?.abort()
  statusRequest = new AbortController()
  state.value = null
  queued.value = false
  void load({ auto: true })
},{immediate:true})
watch(()=>state.value?.imagePath,async path=>{
  imageRequest?.abort();if(url.value)URL.revokeObjectURL(url.value);url.value='';if(!path)return
  const request=new AbortController();imageRequest=request
  try{const image=await loadMemoryImage(path,request.signal);if(request.signal.aborted)URL.revokeObjectURL(image);else url.value=image}catch(e){if(!request.signal.aborted)error.value=e.message}
})
onBeforeUnmount(()=>{closeImage();clearTimeout(timer);statusRequest?.abort();imageRequest?.abort();if(url.value)URL.revokeObjectURL(url.value)})
</script>
<template>
  <aside class="scene-hint card" aria-label="场景视觉提示">
    <div class="hint-heading"><h3>场景提示图</h3><button class="text-button" :aria-expanded="open" @click="open=!open">{{ open?'收起':pending?'生成中 · 展开':url?'查看图片':'展开' }}</button></div>
    <template v-if="open">
      <button v-if="url" ref="imageButton" class="image-preview" aria-label="放大场景提示图" @click="enlarge"><img :src="url" alt="当前交谈对象与场景中的词汇线索" width="640" height="640" /><span>点击放大</span></button>
      <p v-if="url && state?.description">{{ state.description }}</p>
      <p v-if="pending || (busy && !url)" role="status">{{ queued ? '提示图排队中，可以先继续对话。' : '正在准备提示图，可以先继续对话。' }}</p>
      <p v-if="error||state?.error" role="alert">{{ error||state.error }}</p>
      <button v-if="!pending && state?.enabled" class="btn btn-secondary" :disabled="busy" @click="load({ generate: true, regenerate: Boolean(state.imagePath) })">{{ state.imagePath?'重新生成提示图':'生成提示图' }}</button>
      <button v-if="error" class="text-button" :disabled="busy" @click="load({ auto: true })">重新读取</button>
      <p v-if="state && !state.enabled && !url" class="muted">生图服务尚未配置，可以继续对话。</p>
    </template>
  </aside>
  <Teleport to="body">
    <div v-if="enlarged" class="hint-lightbox" @click.self="closeImage" @keydown="modalKey">
      <section role="dialog" aria-modal="true" aria-label="放大的场景提示图" class="hint-dialog">
        <div class="hint-dialog-heading"><span>场景提示图</span><button ref="closeButton" class="btn btn-secondary" @click="closeImage">关闭</button></div>
        <div class="hint-image-scroll"><img :src="url" alt="放大的情境视觉提示，可以使用浏览器缩放查看细节" /></div>
        <p v-if="state?.description">{{ state.description }}</p>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.scene-hint { padding:16px; }.hint-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }.hint-heading h3 { font-size:15px; margin:0; }.scene-hint img { display:block;width:100%;height:auto;border-radius:10px;margin-top:12px; }.scene-hint p { line-height:1.7;font-size:13px; }.hint-note { color:var(--ink-soft); font-size:12px!important; }
.image-preview{display:block;width:100%;padding:0;border:0;background:transparent;cursor:zoom-in;color:var(--ink-soft)}.image-preview span{display:block;padding:7px;font-size:12px}.hint-lightbox{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:16px}.hint-dialog{background:var(--surface,#fff);color:var(--ink,#222);border-radius:16px;padding:16px;width:min(900px,100%);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;box-sizing:border-box}.hint-dialog-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.hint-image-scroll{overflow:auto;min-height:0;overscroll-behavior:contain}.hint-image-scroll img{display:block;width:100%;height:auto;object-fit:contain}.hint-dialog p{font-size:12px;line-height:1.6;margin:10px 0 0;flex-shrink:0}@media(max-width:900px){.scene-hint{padding:12px}.image-preview{max-width:320px;margin:auto}.hint-lightbox{padding:8px}.hint-dialog{padding:12px;max-height:calc(100dvh - 16px)}}
</style>
