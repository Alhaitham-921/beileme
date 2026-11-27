<script setup>
import { onMounted,onBeforeUnmount,ref,computed,watch,nextTick } from 'vue'
import { useRoute,useRouter } from 'vue-router'
import { library } from '../api/index.js'
import LibraryAiResult from '../components/LibraryAiResult.vue'
import ReadingBookImportDialog from '../components/ReadingBookImportDialog.vue'
const route=useRoute(),router=useRouter()
const importOpen=ref(false),bookSearch=ref(''),removeCandidate=ref(null),removing=ref(false)
const matches=book=>[book.title,book.titleZh,book.author].join(' ').toLowerCase().includes(bookSearch.value.trim().toLowerCase())
const classicBooks=computed(()=>data.value?.books.filter(matches)||[])
const personalBooks=computed(()=>data.value?.personalBooks?.filter(matches)||[])
function imported(result){importOpen.value=false;void router.push('/library/read/'+result.id)}
async function removeBook(){if(!removeCandidate.value||removing.value)return;const id=removeCandidate.value.id;removing.value=true;error.value='';try{await library.removeBook(id);data.value.personalBooks=data.value.personalBooks.filter(book=>book.id!==id);removeCandidate.value=null}catch(e){error.value=e.message}finally{removing.value=false}}
const data=ref(null),error=ref(''),busy=ref(false),tab=ref(route.query.tab==='reading'?'reading':'listening'),lesson=ref(null),answers=ref([]),feedback=ref(null)
const transcriptElement=ref(null)
const transcriptVisible=ref(false)
async function toggleTranscript(){transcriptVisible.value=!transcriptVisible.value;if(transcriptVisible.value){await nextTick();transcriptElement.value?.scrollIntoView({block:'start',behavior:'smooth'})}}
const transcriptShown=ref(false),playing=ref(false),rate=ref(1),audioUrl=ref(''),audioPlayer=ref(null)
const ready=computed(()=>lesson.value&&answers.value.length===lesson.value.questions.length&&answers.value.every(Number.isInteger))
const aiFeedback=ref(null),aiBusy=ref(false),aiError=ref('')
let run=0,disposed=false,aiRun=0
function clearAi(){aiRun++;aiFeedback.value=null;aiBusy.value=false;aiError.value=''}
async function analyseAnswers(){
  if(!lesson.value||!feedback.value?.attemptId||aiBusy.value)return
  const serial=++aiRun,attemptId=feedback.value.attemptId,id=lesson.value.id;aiBusy.value=true;aiError.value=''
  try{const result=await library.explainListening(id,attemptId);if(!disposed&&serial===aiRun&&feedback.value?.attemptId===attemptId)aiFeedback.value=result}catch(e){if(!disposed&&serial===aiRun)aiError.value=e.message}finally{if(serial===aiRun)aiBusy.value=false}
}
async function load(){try{data.value=await library.overview()}catch(e){error.value=e.message}}
function stopAudio(){if(audioPlayer.value){audioPlayer.value.pause();audioPlayer.value.currentTime=0}playing.value=false}
function releaseAudio(){stopAudio();if(audioUrl.value)URL.revokeObjectURL(audioUrl.value);audioUrl.value=''}
async function choose(id){
  const serial=++run;clearAi();error.value='';feedback.value=null;transcriptVisible.value=false;transcriptShown.value=false;releaseAudio();lesson.value=null
  try {
    const item=await library.lesson(id)
    if(disposed||serial!==run)return
    lesson.value=item;answers.value=Array(item.questions.length).fill(null)
    const bytes=await library.audio(id,item.audioRevision)
    if(disposed||serial!==run)return
    audioUrl.value=URL.createObjectURL(bytes)
  }catch(e){if(!disposed&&serial===run)error.value=e.message}
}
async function play(){if(!audioPlayer.value)return;error.value='';try{audioPlayer.value.playbackRate=rate.value;await audioPlayer.value.play()}catch(e){error.value=e.message||'音频暂时无法播放，请重试。'}}
function changeRate(){if(audioPlayer.value)audioPlayer.value.playbackRate=rate.value}
async function submit(){const serial=run;clearAi();busy.value=true;error.value='';try{const value=await library.listen(lesson.value.id,{answers:answers.value,transcriptShown:transcriptShown.value||transcriptVisible.value});if(!disposed&&serial===run)feedback.value=value}catch(e){if(!disposed&&serial===run)error.value=e.message}finally{busy.value=false}}
watch(transcriptVisible,value=>{if(value)transcriptShown.value=true})
const duration=seconds=>{const value=Math.round(seconds);return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`}
watch(tab,stopAudio)
onMounted(load);onBeforeUnmount(()=>{disposed=true;run++;clearAi();releaseAudio()})
</script>
<template>
  <main class="library-page">
    <header><p class="eyebrow">听懂 · 阅读 · 带到交流中使用</p><h1 class="section-title">听读空间</h1><p class="section-sub">先听大意，再核对细节；读适合自己的原文，把表达带回真实任务。</p></header>
    <nav class="library-tabs" aria-label="学习材料类型"><button v-for="item in [{id:'listening',name:'情境精听'},{id:'reading',name:'英文书籍'},{id:'sources',name:'官方课程与播客'}]" :key="item.id" class="btn" :class="tab===item.id?'btn-primary':'btn-ghost'" @click="tab=item.id">{{ item.name }}</button></nav>
    <p v-if="error" role="alert">{{ error }} <button v-if="!data" class="text-button" @click="load">重试</button></p>
    <p v-if="!data&&!error"><LoadingState>正在读取听读材料…</LoadingState></p>
    <template v-if="data">
      <template v-if="tab==='listening'">
        <div class="lesson-layout"><nav class="lesson-list" aria-label="选择听力材料"><button v-for="item in data.lessons" :key="item.id" :class="{chosen:lesson?.id===item.id}" @click="choose(item.id)"><strong>{{ item.title }}</strong><small>{{ item.level }} · {{duration(item.durationSeconds)}} · {{ item.questionCount }} 道理解题</small></button></nav>
          <section v-if="lesson" class="card listening-detail"><h2>{{ lesson.title }}</h2><p class="source-line">{{ lesson.source }}</p><audio v-if="audioUrl" ref="audioPlayer" :src="audioUrl" controls preload="metadata" @play="playing=true" @pause="playing=false" @ended="playing=false" @error="error='音频播放失败，请重新选择这段材料。'" /><p v-else class="source-line" role="status">正在读取已准备好的音频…</p><div class="audio-tools"><button class="btn btn-primary" :disabled="!audioUrl||playing" @click="play">{{ playing?'正在播放…':'播放材料' }}</button><button class="btn btn-ghost" @click="stopAudio">停止</button><label>播放速度 <select v-model="rate" @change="changeRate"><option :value="0.8">慢一点</option><option :value="1">练习原速</option><option :value="1.15">稍快</option></select></label><button v-if="error" class="text-button" @click="choose(lesson.id)">重新读取音频</button></div>
            <div class="transcript-controls"><label><input v-model="transcriptVisible" type="checkbox"> 显示听力原文</label><span class="source-line">{{duration(lesson.durationSeconds)}} · {{lesson.questions.length}} 道理解题</span></div><section v-if="transcriptVisible" ref="transcriptElement" class="listening-transcript" aria-label="听力原文"><h3>听力原文</h3><template v-if="lesson.turns"><p v-for="(turn,i) in lesson.turns" :key="i" lang="en"><strong>{{turn.speaker}}:</strong> {{turn.text}}</p></template><p v-else lang="en">{{lesson.transcript}}</p></section><p>第一遍抓住大意，第二遍带着问题听。原文可以随时显示或隐藏；本轮一旦查看过原文，会保留辅助理解标记。</p>
            <fieldset v-for="(q,i) in lesson.questions" :key="q.question"><legend>{{ i+1 }}. {{ q.question }}</legend><label v-for="(choice,j) in q.choices" :key="choice"><input v-model="answers[i]" type="radio" :name="'question-'+i" :value="j"> {{ choice }}</label></fieldset>
            <button class="btn btn-primary" :disabled="busy||!ready" @click="submit">提交理解结果</button>
            <div v-if="feedback" class="listening-feedback" role="status"><strong>{{ feedback.correct }} / {{ feedback.total }} 题答对</strong><p>{{ feedback.transcriptShown?'本轮已展开文本，按辅助理解记录。':'本轮未展开文本，记录本次听力理解表现。' }}</p><p v-for="(item,i) in feedback.results" :key="i">{{ i+1 }}. {{ item.correct?'正确':'待巩固' }} · {{ item.answer }}</p><button class="btn btn-secondary" :disabled="busy||aiBusy" @click="analyseAnswers">{{aiBusy?'正在分析原文与选项…':aiFeedback?'重新读取 AI 分析':'AI 分析选项与错因'}}</button><p class="source-line">按已提交的本次答案分析；调用你接入的文字 AI，结果保存后可复用。错因只作可能性解释。</p><p v-if="aiError" role="alert">{{aiError}} <router-link to="/settings">文字 AI 设置</router-link></p><LibraryAiResult :result="aiFeedback" kind="listening"/></div>
            <button class="btn btn-secondary transcript-toggle" :aria-expanded="transcriptVisible" @click="toggleTranscript">{{transcriptVisible?'隐藏听力原文':'显示听力原文'}}</button><p>{{ lesson.task }}</p><router-link class="btn btn-secondary" :to="{path:'/practice',query:{scene:lesson.scene}}">进入对应情境，用自己的话处理任务</router-link>
          </section>
          <section v-else class="card listening-intro"><h2>把听懂变成可以回应</h2><ol><li>选择一段两三分钟的材料，先不看文字。</li><li>听出对方问什么、有哪些关键条件。</li><li>核对后换日期、价格或需求，再用自己的话表达。</li></ol></section>
        </div>

      </template>
      <section v-else-if="tab==='reading'" class="reading-library">
        <div class="shelf-tools"><div><h2>英语书架</h2><p class="source-line">经典原文和你的个人书籍，随时开始或继续阅读。</p></div><button class="btn btn-primary" @click="importOpen=true">＋ 添加书籍</button></div>
        <label class="book-search">查找书籍<input v-model="bookSearch" type="search" placeholder="搜索书名或作者"></label>
        <h3>英文小说与名著 <small>{{data.books.length}} 本</small></h3>
        <div class="reading-shelf"><article v-for="book in classicBooks" :key="book.id" class="card reading-book"><small>{{book.level}} · {{book.chapterCount}} 节</small><h2>{{book.titleZh||book.title}}</h2><p lang="en">{{book.title}}</p><p>{{book.author}}</p><p class="source-line">{{book.sourceName}} · {{book.translator?'完整英文译本':'完整原文'}}</p><router-link class="btn btn-primary" :to="'/library/read/'+book.id">开始或继续阅读</router-link><p><a :href="book.sourceUrl" target="_blank" rel="noopener noreferrer">原始来源与版本</a></p></article></div>
        <h3 class="personal-heading">我的书籍 <small>{{data.personalBooks?.length||0}} / 20 本 · 仅自己可见</small></h3>
        <div v-if="personalBooks.length" class="reading-shelf"><article v-for="book in personalBooks" :key="book.id" class="card reading-book"><small>{{book.sourceFormat.toUpperCase()}} · {{book.chapterCount}} 节</small><h2>{{book.title}}</h2><p>{{book.author}}</p><div class="personal-book-actions"><router-link class="btn btn-primary" :to="'/library/read/'+book.id">开始或继续阅读</router-link><button class="text-button" @click="removeCandidate=book">移除</button></div></article></div>
        <p v-else class="source-line">{{bookSearch?'没有匹配的个人书籍。':'还没有个人书籍，点击“添加书籍”导入 TXT 或 EPUB。'}}</p>
        <p v-if="bookSearch&&!classicBooks.length&&!personalBooks.length" role="status">未找到匹配书籍，请换个名称试试。</p>
        <div v-if="removeCandidate" class="card remove-book-confirm" role="alert"><p>移除《{{removeCandidate.title}}》及其阅读位置？本机原文件会保留。</p><button class="btn btn-secondary" :disabled="removing" @click="removeCandidate=null">保留书籍</button><button class="btn btn-ghost" :disabled="removing" @click="removeBook">{{removing?'正在移除…':'确认移除'}}</button></div>
      </section>
      <section v-else class="source-list"><article v-for="item in data.resources" :key="item.id" class="card"><small>{{ item.source }} · {{ item.type }} · {{ item.level }}</small><h2>{{ item.title }}</h2><p>{{ item.note }}</p><a class="btn btn-primary" :href="item.url" target="_blank" rel="noopener noreferrer">前往官方学习</a><p class="source-line">{{ item.license }} <a :href="item.licenseUrl" target="_blank" rel="noopener noreferrer">使用说明</a></p></article></section>
    </template>
    <ReadingBookImportDialog v-if="importOpen" @close="importOpen=false" @imported="imported"/>
  </main>
</template>
<style scoped>
.shelf-tools,.personal-book-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.shelf-tools h2{margin:0}.book-search{display:flex;align-items:center;gap:12px;margin:20px 0;font-size:13px}.book-search input{flex:1;max-width:420px;min-width:0;padding:10px;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:var(--bg-card);font:inherit}.reading-library h3{font-size:18px}.reading-library h3 small{font-size:12px;color:var(--ink-soft);font-weight:400}.personal-heading{margin-top:30px}.remove-book-confirm{margin-top:18px;padding:18px}.remove-book-confirm p{line-height:1.8}.remove-book-confirm .btn{margin:5px 10px 0 0}.transcript-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:18px 0}.transcript-controls label{padding:8px 0}.listening-transcript{max-height:400px;overflow:auto;padding:16px;background:var(--accent-soft);border:1px solid var(--line);border-radius:10px}.listening-transcript p{font-size:16px;line-height:1.8}.listening-transcript h3{font-size:16px;margin:0}.library-page{max-width:1100px;margin:auto}.library-tabs,.audio-tools{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}.lesson-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:22px}.lesson-list{display:grid;align-content:start;gap:8px}.lesson-list button{text-align:left;border:1px solid var(--line);background:var(--bg-card);color:var(--ink);padding:16px;border-radius:10px;font:inherit}.lesson-list strong,.lesson-list small{display:block}.lesson-list small,.source-line{font-size:12px;color:var(--ink-soft);line-height:1.8}.lesson-list .chosen{border-color:var(--accent)}.listening-detail h2,.source-feature h2{font-size:21px}.listening-detail p,.listening-intro li,.source-list p{line-height:1.9}.listening-detail fieldset{border:1px solid var(--line);padding:15px;margin:18px 0}.listening-detail fieldset label{display:block;padding:9px 0}.listening-feedback{margin:20px 0;padding:16px;background:var(--accent-soft);border-radius:10px}.transcript{font-size:18px;line-height:1.9}.transcript-toggle{display:block;margin:22px 0}.reading-shelf,.source-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.reading-book h2{font-size:27px}.reading-book p{line-height:1.8}.source-feature{margin-top:24px}.source-feature audio{width:100%;margin-top:12px}.audio-tools label{align-self:center}.audio-tools select{padding:7px;background:var(--bg-card);color:var(--ink);border:1px solid var(--line)}@media(max-width:760px){.lesson-layout{grid-template-columns:1fr}.lesson-list{grid-template-columns:repeat(2,minmax(0,1fr))}.reading-shelf,.source-list{grid-template-columns:1fr}.lesson-list button{padding:12px;font-size:13px}}
</style>

<style scoped>.listening-detail>audio{width:100%;margin-top:15px;position:sticky;top:8px;z-index:20;border-radius:8px;background:var(--bg-card)}</style>
