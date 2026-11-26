<script setup>
import {computed,ref,watch,nextTick,onMounted,onBeforeUnmount} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {library,words} from '../api/index.js'
import LibraryAiResult from '../components/LibraryAiResult.vue'
import {createReadingPress,readingTokens} from '../utils/readingPress.js'
import {paginateReading,pageForAnchor,pageRange,normalizeReadingText} from '../utils/readingPagination.js'
const windowCoarse=typeof window!=='undefined'&&window.matchMedia('(pointer:coarse)').matches
const route=useRoute(),router=useRouter(),data=ref(null),error=ref(''),loading=ref(false)
const viewport=ref({width:typeof window==='undefined'?1000:window.innerWidth,height:typeof window==='undefined'?800:window.innerHeight})
const fontSize=ref(viewport.value.width<680?19:21),mode=ref('lookup'),held=ref(''),selected=ref(''),definition=ref(null),lookupError=ref(''),lookupBusy=ref(false)
const notice=ref(''),saved=ref(''),audioError=ref(''),pages=ref([]),pageIndex=ref(0),leaf=ref(null),body=ref(null),probe=ref(null)
const prefsLoaded=ref(false),showChinese=ref(false),prefsBusy=ref(false),prefsError=ref(''),pageExplanation=ref(null),pageAiBusy=ref(false),pageAiError=ref('')
const selection=ref(''),selectionResult=ref(null),analysing=ref(false),analysisError=ref(''),analysisOpen=ref(false)
let serial=0,lookupSerial=0,lookupController,saveTimer,aiTimer,frame,observer,disposed=false,pageRun=0,analysisRun=0,pageController,analysisController,pendingSave=null,anchor={paragraph:0,offset:0},openAtEnd=false,swipe=null
const bookId=computed(()=>String(route.params.id||'')),chapterIndex=computed(()=>data.value?.chapters.findIndex(c=>c.id===data.value.chapter.id)??0)
const currentPage=computed(()=>pages.value[pageIndex.value]),range=computed(()=>pageRange(currentPage.value))
const pageKey=computed(()=>data.value&&range.value?JSON.stringify([bookId.value,data.value.chapter.id,range.value]):'')
const pageHeight=computed(()=>Math.max(180,Math.min(680,viewport.value.height-(viewport.value.width<680?310:270))))
const segments=computed(()=>currentPage.value?.segments.map(s=>({...s,tokens:readingTokens(s.text)}))||[])
const press=createReadingPress({onOpen:lookupToken,onCancel:()=>{held.value=''}})
function startPress(word,event,key){if(mode.value==='selection'||event.button!==0)return;press.start(word,event);held.value=key}
function measurePages(){
 if(!data.value||!leaf.value||!probe.value||!body.value||disposed)return
 const width=body.value.clientWidth,height=leaf.value.clientHeight
 if(width<80||height<80)return
 probe.value.style.width=width+'px'
 const fits=items=>{
  const nodes=items.map(item=>{const p=document.createElement('p');p.className='reader-paragraph';p.style.margin='0 0 .85em';p.textContent=item.text;return p})
  if(nodes.length)nodes.at(-1).style.marginBottom='0'
  probe.value.replaceChildren(...nodes)
  return probe.value.scrollHeight<=height-2
 }
 const next=paginateReading(data.value.chapter.paragraphs,fits)
 pages.value=next;pageIndex.value=openAtEnd?Math.max(0,next.length-1):pageForAnchor(next,anchor);openAtEnd=false
 probe.value.replaceChildren()
}
function scheduleLayout(){cancelAnimationFrame(frame);frame=requestAnimationFrame(measurePages)}
async function load(){
 const run=++serial;loading.value=true;error.value='';audioError.value='';data.value=null;pages.value=[];press.cancel();closeLookup();clearSelection();notice.value='';saved.value=''
 try{const value=await library.read(bookId.value,route.query.chapter);if(disposed||run!==serial)return;data.value=value;anchor=value.progress.chapterId===value.chapter.id?{paragraph:value.progress.paragraph||0,offset:value.progress.offset||0}:{paragraph:0,offset:0}}
 catch(e){if(!disposed&&run===serial)error.value=e.message}
 finally{if(run===serial){loading.value=false;await nextTick();if(leaf.value){observer?.disconnect();observer?.observe(leaf.value)}scheduleLayout()}}
}
async function loadPrefs(){try{const value=await library.preferences();if(!disposed){showChinese.value=value.showChinese;prefsLoaded.value=true;prefsError.value=''}}catch(e){prefsError.value=e.message}}
async function changeChinese(event){
 const value=event.target.checked;prefsBusy.value=true;prefsError.value=''
 try{const next=await library.savePreferences({showChinese:value});if(!disposed)showChinese.value=next.showChinese}catch(e){event.target.checked=showChinese.value;prefsError.value=e.message}finally{prefsBusy.value=false}
}
async function lookupToken(word){
 if(word.length>64)return
 const run=++lookupSerial;lookupController?.abort();lookupController=new AbortController();selected.value=word;definition.value=null;lookupError.value='';lookupBusy.value=true
 try{const value=await words.lookup(word,lookupController.signal);if(!disposed&&run===lookupSerial)definition.value=value}catch(e){if(!disposed&&run===lookupSerial&&!lookupController.signal.aborted)lookupError.value=e.message}finally{if(run===lookupSerial)lookupBusy.value=false}
}
async function aiLookup(){const run=++lookupSerial;lookupBusy.value=true;lookupError.value='';try{const value=await words.lookupAi(selected.value);if(!disposed&&run===lookupSerial)definition.value=value}catch(e){if(!disposed&&run===lookupSerial)lookupError.value=e.message}finally{if(run===lookupSerial)lookupBusy.value=false}}
function closeLookup(){press.cancel();selected.value='';lookupController?.abort();lookupSerial++;lookupBusy.value=false}
async function addWord(entry){try{await words.favorite(entry.id);saved.value=`已收藏 ${entry.spelling}`}catch(e){lookupError.value=e.message}}
async function flush(){
 clearTimeout(saveTimer);const position=pendingSave;pendingSave=null;if(!position)return
 try{await library.saveReading(position.bookId,position.body);if(!disposed)saved.value='阅读位置已保存'}catch{if(!pendingSave)pendingSave=position;if(!disposed)saved.value='位置暂未同步，可点击重试保存'}
}
function rememberPage(){const first=currentPage.value?.segments[0];if(!first||!data.value)return;anchor={paragraph:first.paragraph,offset:first.start};pendingSave={bookId:bookId.value,body:{chapterId:data.value.chapter.id,...anchor}};clearTimeout(saveTimer);saveTimer=setTimeout(flush,500)}
async function chapter(id,last=false){await flush();openAtEnd=last;await router.push({path:route.path,query:{chapter:id}})}
async function turnPage(direction){
 press.cancel();closeLookup();clearSelection()
 const next=pageIndex.value+direction
 if(next>=0&&next<pages.value.length){pageIndex.value=next;await nextTick();if(leaf.value?.getBoundingClientRect().top<0)leaf.value.scrollIntoView({block:'start'});return}
 const nextChapter=chapterIndex.value+direction
 if(nextChapter>=0&&nextChapter<data.value.chapters.length)await chapter(data.value.chapters[nextChapter].id,direction<0)
}
function captureSelection(){
 if(!body.value)return
 const value=window.getSelection();if(!value?.rangeCount||value.isCollapsed)return
 const selectedRange=value.getRangeAt(0)
 if(!body.value.contains(selectedRange.startContainer)||!body.value.contains(selectedRange.endContainer))return
 press.cancel();const text=normalizeReadingText(value.toString())
 if(text.length<2)return
 if(text.length>2400){analysisError.value='一次请选择不超过 2400 个字符，分句分析更清楚';return}
 if(text===selection.value)return
 analysisRun++;analysisController?.abort();analysing.value=false;analysisOpen.value=false
 selection.value=text;selectionResult.value=null;analysisError.value=''
}
function clearSelection(){analysing.value=false;selection.value='';selectionResult.value=null;analysisError.value='';analysisOpen.value=false;analysisRun++;analysisController?.abort()}
async function analyse(){
 if(!selection.value||!range.value||analysing.value)return
 const run=++analysisRun,key=pageKey.value,text=selection.value
 analysisController?.abort();analysisController=new AbortController();analysing.value=true;analysisOpen.value=true;analysisError.value='';closeLookup()
 try{const result=await library.analyseSelection(bookId.value,{chapterId:data.value.chapter.id,range:range.value,text},analysisController.signal);if(!disposed&&run===analysisRun&&key===pageKey.value)selectionResult.value=result}catch(e){if(!disposed&&run===analysisRun)analysisError.value=e.message}finally{if(run===analysisRun)analysing.value=false}
}
async function explainPage(){
 if(!range.value||!showChinese.value||!prefsLoaded.value)return
 const run=++pageRun,key=pageKey.value;pageController?.abort();pageController=new AbortController();pageAiBusy.value=true;pageAiError.value=''
 try{const result=await library.explainPage(bookId.value,{chapterId:data.value.chapter.id,range:range.value},pageController.signal);if(!disposed&&run===pageRun&&key===pageKey.value&&showChinese.value)pageExplanation.value=result}catch(e){if(!disposed&&run===pageRun)pageAiError.value=e.message}finally{if(run===pageRun)pageAiBusy.value=false}
}
async function showNotice(){try{notice.value=await library.notice(bookId.value)}catch(e){error.value=e.message}}
function resize(){viewport.value={width:window.innerWidth,height:window.innerHeight};scheduleLayout()}
function keyboard(event){if(event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||['INPUT','SELECT','TEXTAREA','AUDIO','BUTTON'].includes(event.target.tagName)||window.getSelection()?.toString())return;if(event.key==='ArrowRight'){event.preventDefault();void turnPage(1)}if(event.key==='ArrowLeft'){event.preventDefault();void turnPage(-1)}}
function pointerStart(event){swipe={x:event.clientX,y:event.clientY};}
function pointerEnd(event){if(!swipe)return;const x=event.clientX-swipe.x,y=event.clientY-swipe.y;swipe=null;if(mode.value!=='selection'&&!window.getSelection()?.toString()&&Math.abs(x)>85&&Math.abs(y)<35)void turnPage(x<0?1:-1)}
watch(()=>[route.params.id,route.query.chapter],load,{immediate:true})
watch(fontSize,async()=>{await nextTick();scheduleLayout()})
watch(currentPage,()=>{if(!loading.value)rememberPage()})
watch(pageKey,()=>{clearSelection();closeLookup()})
watch(mode,()=>{press.cancel();clearSelection()})
watch([pageKey,showChinese,prefsLoaded],()=>{
 clearTimeout(aiTimer);pageRun++;pageController?.abort();pageExplanation.value=null;pageAiBusy.value=false;pageAiError.value=''
 if(pageKey.value&&showChinese.value&&prefsLoaded.value)aiTimer=setTimeout(explainPage,700)
})
onMounted(()=>{observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(scheduleLayout);if(leaf.value)observer?.observe(leaf.value);window.addEventListener('resize',resize);window.addEventListener('keydown',keyboard);document.addEventListener('selectionchange',captureSelection);void loadPrefs();scheduleLayout()})
onBeforeUnmount(()=>{disposed=true;serial++;lookupSerial++;pageRun++;analysisRun++;clearTimeout(aiTimer);cancelAnimationFrame(frame);observer?.disconnect();press.cancel();lookupController?.abort();pageController?.abort();analysisController?.abort();window.removeEventListener('resize',resize);window.removeEventListener('keydown',keyboard);document.removeEventListener('selectionchange',captureSelection);void flush()})
</script>
<template>
 <main class="reader-page">
  <header class="reader-top"><router-link class="btn btn-secondary reader-back" to="/library?tab=reading">← 返回听读空间</router-link><span v-if="data">{{data.book.titleZh}} · {{chapterIndex+1}} / {{data.chapters.length}} 章</span></header>
  <p v-if="error" role="alert">{{error}} <button class="text-button" @click="load">重试</button></p>
  <p v-if="loading" role="status">正在准备阅读页面…</p>
  <template v-if="data&&!loading">
   <h1 class="chapter-title">{{data.chapter.title}}</h1>
   <div class="reader-controls"><label>章节 <select :value="data.chapter.id" @change="chapter($event.target.value)"><option v-for="item in data.chapters" :key="item.id" :value="item.id">{{item.title}}</option></select></label><label>字号 <input v-model.number="fontSize" type="range" min="17" max="29" aria-label="阅读字号"></label><label><input type="checkbox" :checked="showChinese" :disabled="!prefsLoaded||prefsBusy" @change="changeChinese"> 中文解释</label></div>
   <div class="reading-modes" role="group" aria-label="原文操作方式"><button class="btn" :class="mode==='lookup'?'btn-primary':'btn-ghost'" @click="mode='lookup'">查词 · 长按 2 秒</button><button class="btn" :class="mode==='selection'?'btn-primary':'btn-ghost'" @click="mode='selection'">选句分析 · 拖动选择</button><button class="text-button" @click="flush">保存位置</button></div>
   <p class="reader-note">{{mode==='selection'?'像复制文字一样选取英文，再点击“AI 分析选句”；手机可拖动原生选择手柄。':'长按单词 2 秒查词；电脑可拖动选句，手机选句时先切换“选句分析”。'}} <span role="status">{{saved}}</span></p>
   <p v-if="prefsError" role="alert">{{prefsError}} <button class="text-button" @click="loadPrefs">重读偏好</button></p>
   <div class="leaf-frame" @pointerdown="pointerStart" @pointerup="pointerEnd" @pointercancel="swipe=null">
    <div ref="leaf" class="reading-leaf" :style="{height:pageHeight+'px'}">
     <article ref="body" :class="['reader-text','mode-'+mode]" :style="{fontSize:fontSize+'px'}" lang="en" aria-label="本页英语原文"><p v-for="segment in segments" :key="segment.paragraph+':'+segment.start" class="reader-paragraph"><template v-for="(token,j) in segment.tokens" :key="j"><span v-if="token.word" tabindex="0" :aria-label="'长按2秒查释义 '+token.text" :class="['reader-word',{holding:held===`${segment.paragraph}:${segment.start}:${j}`}]" @pointerdown="startPress(token.text,$event,`${segment.paragraph}:${segment.start}:${j}`)" @pointermove="press.move($event)" @pointerup="press.cancel" @pointercancel="press.cancel" @pointerleave="press.cancel" @contextmenu="mode==='lookup'&&windowCoarse&&$event.preventDefault()" @keydown.enter.prevent="!$event.repeat&&lookupToken(token.text)">{{token.text}}</span><template v-else>{{token.text}}</template></template></p></article>
    </div>
    <div ref="probe" class="reader-text reader-probe" :style="{fontSize:fontSize+'px'}" aria-hidden="true"></div>
   </div>
   <nav class="page-navigation" aria-label="阅读翻页"><button class="btn btn-secondary" :disabled="pageIndex===0&&chapterIndex===0" @click="turnPage(-1)">← 上一页</button><label>本章 <select v-model.number="pageIndex" aria-label="跳转本章页码"><option v-for="(_,i) in pages" :key="i" :value="i">{{i+1}} / {{pages.length}} 页</option></select></label><button class="btn btn-primary" :disabled="pageIndex===pages.length-1&&chapterIndex===data.chapters.length-1" @click="turnPage(1)">下一页 →</button></nav>
   <p class="reader-note">页码随屏幕和字号调整，保存的是原文位置。电脑可用左右方向键，手机也可在查词模式横滑翻页。</p>
   <section v-if="showChinese" class="page-chinese card" aria-label="本页中文解释"><h2>本页中文解释</h2><p class="reader-note">按当前页调用已接入的文字 AI；已生成内容会保存复用，非出版译文。</p><p v-if="pageAiBusy" role="status">正在解释本页原文，翻页和英文阅读不受影响…</p><p v-if="pageAiError" role="alert">{{pageAiError}} <button class="text-button" :disabled="pageAiBusy" @click="explainPage">重试生成</button> <router-link to="/settings">文字 AI 设置</router-link></p><LibraryAiResult :result="pageExplanation" kind="page"/></section>
   <details v-if="data.chapter.audioUrl" class="chapter-audio"><summary>本章真人朗读 · {{data.book.audio.source}}</summary><audio :key="data.chapter.id" controls preload="none" :src="data.chapter.audioUrl" @error="audioError='外部音频暂不可用，可打开来源或继续阅读。'"/><p>{{data.book.audio.note}} <a :href="data.book.audio.sourceUrl" target="_blank" rel="noopener noreferrer">音频来源</a></p><p v-if="audioError">{{audioError}}</p></details>
   <details class="reader-license"><summary>书籍来源与授权</summary><p>{{data.book.title}} · {{data.book.author}}</p><p>{{data.book.licenseLabel}}</p><a :href="data.book.sourceUrl" target="_blank" rel="noopener noreferrer">原文来源</a> · <a :href="data.book.licenseUrl" target="_blank" rel="noopener noreferrer">授权说明</a> · <button class="text-button" @click="showNotice">查看保留声明</button><pre v-if="notice">{{notice}}</pre></details>
  </template>
  <aside v-if="selection&&!analysisOpen" class="selection-toolbar" role="region" aria-label="选句操作"><span>已选择 {{selection.length}} 个字符</span><button class="btn btn-primary" @pointerdown.prevent @click="analyse">AI 分析选句</button><button class="text-button" @click="clearSelection">取消</button></aside>
  <aside v-if="analysisOpen" class="reader-panel selection-analysis" role="dialog" aria-label="句式和单词用法分析"><header><strong>选句分析</strong><button class="text-button" @click="clearSelection">关闭</button></header><blockquote lang="en">{{selection}}</blockquote><p v-if="analysing" role="status">正在分析句式和词语用法…</p><p v-if="analysisError" role="alert">{{analysisError}} <button class="text-button" :disabled="analysing" @click="analyse">重试</button> <router-link to="/settings">文字 AI 设置</router-link></p><LibraryAiResult :result="selectionResult" kind="selection"/></aside>
  <aside v-if="selected" class="reader-panel reader-definition" role="dialog" aria-label="单词释义"><header><strong lang="en">{{selected}}</strong><button class="text-button" @click="closeLookup">关闭</button></header><p v-if="lookupBusy" role="status">正在查询…</p><p v-if="lookupError" role="alert">{{lookupError}}</p><template v-if="definition"><article v-for="entry in definition.entries" :key="entry.spelling"><p><strong>{{entry.spelling}}</strong> {{entry.phonetic}} {{entry.pos}}</p><ul><li v-for="meaning in entry.definitions" :key="meaning">{{meaning}}</li></ul><button v-if="entry.id" class="text-button" @click="addWord(entry)">收藏到生词本</button></article><p v-if="!definition.entries?.length">词库暂未找到，可主动选择 AI 补释。</p></template><p class="reader-note">词典候选义项需结合句意选择。</p><button class="btn btn-secondary" :disabled="lookupBusy" @click="aiLookup">AI 补充释义</button></aside>
 </main>
</template>
<style scoped>
.reader-page{max-width:960px;margin:auto;padding:10px 0 25px}.reader-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.reader-top>span{font-size:12px;color:var(--ink-soft)}.reader-back{border:1.5px solid var(--accent);font-weight:600;white-space:nowrap}.chapter-title{font-family:var(--serif);font-size:clamp(21px,3vw,28px);line-height:1.4;margin:20px 0 12px}.reader-controls,.reading-modes{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:12px 0}.reader-controls label{display:flex;align-items:center;gap:6px;font-size:12px}.reader-controls select{max-width:300px}.reader-controls input[type=range]{width:90px}.reader-controls select,.page-navigation select{padding:7px;color:var(--ink);background:var(--bg-card);border:1px solid var(--line);border-radius:6px;font:inherit}.reading-modes .btn{font-size:12px;padding:8px 11px}.reader-note{font-size:12px;line-height:1.8;color:var(--ink-soft);margin:10px 0}.leaf-frame{padding:22px;border:1px solid var(--line);border-radius:12px;background:var(--bg-card);box-shadow:var(--shadow);position:relative}.reading-leaf{overflow:hidden}.reader-text{font-family:Georgia,'Times New Roman',serif;line-height:1.85;overflow-wrap:anywhere;white-space:pre-wrap;word-break:normal;padding:0;margin:0;box-sizing:border-box}.reader-paragraph{margin:0 0 .85em}.reader-paragraph:last-child{margin-bottom:0}.reader-probe{position:fixed;left:-30000px;top:0;visibility:hidden;pointer-events:none;height:auto}.reader-word{cursor:help;border-radius:3px;position:relative}.reader-word:focus-visible{outline:2px solid var(--accent)}.reader-word.holding{background:var(--accent-soft)}.reader-word.holding:after{content:'';height:2px;position:absolute;left:0;bottom:-2px;background:var(--accent);animation:reading-hold 2s linear forwards}@keyframes reading-hold{from{width:0}to{width:100%}}.page-navigation{position:sticky;bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;margin:14px 0;padding:12px;background:var(--bg-card);border:1px solid var(--line);border-radius:12px;z-index:15;box-shadow:var(--shadow)}.page-navigation label{display:flex;align-items:center;gap:7px;font-size:12px}.page-navigation .btn{font-size:13px;padding:9px 14px}.page-chinese{padding:20px;margin:18px 0}.page-chinese h2{font-size:18px;margin:0}.chapter-audio,.reader-license{padding:16px 0;border-top:1px solid var(--line);font-size:12px;line-height:1.9}.chapter-audio audio{display:block;width:100%;margin-top:12px}.reader-license pre{white-space:pre-wrap;font:inherit}summary{cursor:pointer}.reader-panel{position:fixed;right:24px;bottom:24px;width:min(490px,calc(100vw - 32px));max-height:78dvh;overflow:auto;padding:22px;border:1px solid var(--line);border-radius:14px;background:var(--bg-card);color:var(--ink);z-index:80;box-shadow:var(--shadow);font-size:14px;line-height:1.8}.reader-panel header{display:flex;justify-content:space-between;align-items:center;gap:12px}.reader-panel header strong{font-size:20px}.reader-panel blockquote{margin:14px 0;padding:12px;border-left:3px solid var(--accent);background:var(--accent-soft)}.selection-toolbar{position:fixed;left:50%;transform:translateX(-50%);bottom:85px;z-index:70;display:flex;gap:12px;align-items:center;border:1px solid var(--accent);border-radius:12px;padding:12px;background:var(--bg-card);box-shadow:var(--shadow);font-size:12px;max-width:calc(100vw - 24px);white-space:nowrap}.selection-toolbar .btn{font-size:12px;padding:8px 12px}@media(pointer:coarse){.mode-lookup .reader-word{-webkit-touch-callout:none;user-select:none}.mode-selection,.mode-selection .reader-word{-webkit-touch-callout:default;user-select:text;cursor:text}.leaf-frame{touch-action:pan-y}}@media(max-width:680px){.reader-top{align-items:flex-start}.reader-top>span{max-width:140px;line-height:1.6;text-align:right}.reader-back{font-size:12px;padding:9px 12px}.reader-controls{gap:9px}.reader-controls select{max-width:200px}.reader-controls input[type=range]{width:65px}.chapter-title{margin:14px 0 10px}.leaf-frame{padding:14px}.page-navigation{gap:6px;padding:9px;bottom:calc(8px + env(safe-area-inset-bottom,0px))}.page-navigation .btn{padding:9px;font-size:12px}.page-navigation select{padding:5px;max-width:105px}.reader-panel{right:12px;bottom:12px;padding:16px;width:calc(100vw - 24px)}.selection-toolbar{gap:8px;padding:9px}.selection-toolbar>span{max-width:100px;white-space:normal}.page-chinese{padding:15px}}
</style>
