<script setup>
import {ref,onMounted,onBeforeUnmount,nextTick} from 'vue'
import {library} from '../api/index.js'
const props=defineProps({translationMode:Boolean,bookId:String})
const emit=defineEmits(['close','imported'])
const dialog=ref(null),fileInput=ref(null),file=ref(null),title=ref(''),author=ref(''),busy=ref(false),error=ref('')
let disposed=false
onMounted(async()=>{dialog.value.showModal();await nextTick();fileInput.value?.focus()})
onBeforeUnmount(()=>{disposed=true})
function choose(event){file.value=event.target.files?.[0]||null;error.value=''}
async function submit(){
 if(!file.value||busy.value)return
 if(!/\.(txt|epub)$/i.test(file.value.name)){error.value='请选择 TXT 或未加密的 EPUB 书籍';return}
 if(file.value.size>8*1024*1024){error.value='文件超过 8 MB，请分卷或移除 EPUB 中的大图片后导入';return}
 busy.value=true;error.value=''
 try{
  const input=file.value
  const contentBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件读取失败，请重新选择'));reader.readAsDataURL(input)})
  if(disposed)return
  const payload={filename:input.name,contentBase64,title:title.value.trim(),author:author.value.trim()}
  const result=props.translationMode?await library.importCompanion(props.bookId,payload):await library.importBook(payload)
  if(!disposed)emit('imported',result)
 }catch(e){if(!disposed)error.value=e.message}finally{busy.value=false}
}
</script>
<template>
 <dialog ref="dialog" class="reading-import" aria-labelledby="reading-import-title" @cancel.prevent="!busy&&emit('close')" @click="$event.target===dialog&&!busy&&emit('close')">
  <header><h2 id="reading-import-title">{{translationMode?'导入中文对照':'添加英文书籍'}}</h2><button class="text-button" :disabled="busy" @click="emit('close')">关闭</button></header>
  <form @submit.prevent="submit">
   <p>{{translationMode?'导入你有权使用的中文译本，手动选择与英文对应的章节。中文对照不调用 AI，不假设不同版本逐页一致。':'把自己的英文书放进个人书架，继续翻页阅读、查词和选句分析。'}}</p>
   <label>选择书籍<input ref="fileInput" type="file" accept=".txt,.epub,text/plain,application/epub+zip" :disabled="busy" @change="choose"></label>
   <small>支持 TXT、未加密 EPUB，文件不超过 8 MB，提取的正文不超过 2 MB。PDF、扫描件请先转换为文本。</small>
   <label>书名（可选）<input v-model="title" maxlength="160" :disabled="busy" placeholder="留空时读取书籍信息或文件名"></label>
   <label>{{translationMode?'译者':'作者'}}（可选）<input v-model="author" maxlength="120" :disabled="busy" placeholder="EPUB 可自动读取作者"></label>
   <p class="privacy-note">{{translationMode?'中文译本只保存至当前账号，不会送给 AI。请导入有权使用的译本。':'仅你的账号可见，导入不会调用 AI。主动生成解释时，相关英文才会发送到你配置的文字接口。请导入有权使用的书籍。'}}</p>
   <p v-if="error" role="alert" class="import-error">{{error}}</p>
   <button class="btn btn-primary" :disabled="!file||busy">{{busy?'正在导入并整理章节…':translationMode?'导入中文对照':'导入并开始阅读'}}</button>
  </form>
 </dialog>
</template>
<style scoped>
.reading-import{width:min(560px,calc(100vw - 28px));max-height:90dvh;overflow:auto;padding:26px;border:1px solid var(--line);border-radius:18px;background:var(--bg-card);color:var(--ink);box-shadow:0 24px 80px #0006}.reading-import::backdrop{background:#07111dbb;backdrop-filter:blur(5px)}.reading-import header{display:flex;align-items:center;justify-content:space-between;gap:12px}.reading-import h2{font-size:22px;margin:0}.reading-import form{display:grid;gap:16px;margin-top:18px}.reading-import label{display:grid;gap:8px;font-size:13px}.reading-import input{width:100%;min-width:0;padding:11px;border:1px solid var(--line);border-radius:8px;background:var(--surface-study);color:var(--ink);font:inherit}.reading-import p,.reading-import small{margin:0;line-height:1.8;color:var(--ink-soft);font-size:12px}.reading-import .privacy-note{padding:12px;border-radius:8px;background:var(--accent-soft)}.reading-import .import-error{color:var(--bad)}@media(max-width:600px){.reading-import{padding:20px}}
</style>
