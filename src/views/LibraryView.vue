<script setup>
import { onMounted,onBeforeUnmount,ref,computed,watch } from 'vue'
import { useRoute } from 'vue-router'
import { library } from '../api/index.js'
const route=useRoute()
const data=ref(null),error=ref(''),busy=ref(false),tab=ref(route.query.tab==='reading'?'reading':'listening'),lesson=ref(null),answers=ref([]),feedback=ref(null)
const transcriptShown=ref(false),playing=ref(false),rate=ref(1),audioUrl=ref(''),audioPlayer=ref(null)
const ready=computed(()=>lesson.value&&answers.value.length===lesson.value.questions.length&&answers.value.every(Number.isInteger))
let run=0,disposed=false
async function load(){try{data.value=await library.overview()}catch(e){error.value=e.message}}
function stopAudio(){if(audioPlayer.value){audioPlayer.value.pause();audioPlayer.value.currentTime=0}playing.value=false}
function releaseAudio(){stopAudio();if(audioUrl.value)URL.revokeObjectURL(audioUrl.value);audioUrl.value=''}
async function choose(id){
  const serial=++run;error.value='';feedback.value=null;transcriptShown.value=false;releaseAudio();lesson.value=null
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
async function submit(){const serial=run;busy.value=true;error.value='';try{const value=await library.listen(lesson.value.id,{answers:answers.value,transcriptShown:transcriptShown.value});if(!disposed&&serial===run)feedback.value=value}catch(e){if(!disposed&&serial===run)error.value=e.message}finally{busy.value=false}}
watch(tab,stopAudio)
onMounted(load);onBeforeUnmount(()=>{disposed=true;run++;releaseAudio()})
</script>
<template>
  <main class="library-page">
    <header><p class="eyebrow">听懂 · 阅读 · 带到交流中使用</p><h1 class="section-title">听读空间</h1><p class="section-sub">先听大意，再核对细节；读适合自己的原文，把表达带回真实任务。</p></header>
    <nav class="library-tabs" aria-label="学习材料类型"><button v-for="item in [{id:'listening',name:'情境精听'},{id:'reading',name:'英语名著'},{id:'sources',name:'官方课程与播客'}]" :key="item.id" class="btn" :class="tab===item.id?'btn-primary':'btn-ghost'" @click="tab=item.id">{{ item.name }}</button></nav>
    <p v-if="error" role="alert">{{ error }} <button v-if="!data" class="text-button" @click="load">重试</button></p>
    <p v-if="!data&&!error"><LoadingState>正在读取听读材料…</LoadingState></p>
    <template v-if="data">
      <template v-if="tab==='listening'">
        <div class="lesson-layout"><nav class="lesson-list" aria-label="选择听力材料"><button v-for="item in data.lessons" :key="item.id" :class="{chosen:lesson?.id===item.id}" @click="choose(item.id)"><strong>{{ item.title }}</strong><small>{{ item.level }} · {{ item.questionCount }} 道理解题</small></button></nav>
          <section v-if="lesson" class="card listening-detail"><h2>{{ lesson.title }}</h2><p class="source-line">{{ lesson.source }}</p><audio v-if="audioUrl" ref="audioPlayer" :src="audioUrl" controls preload="metadata" @play="playing=true" @pause="playing=false" @ended="playing=false" @error="error='音频播放失败，请重新选择这段材料。'" /><p v-else class="source-line" role="status">正在读取已准备好的音频…</p><div class="audio-tools"><button class="btn btn-primary" :disabled="!audioUrl||playing" @click="play">{{ playing?'正在播放…':'播放材料' }}</button><button class="btn btn-ghost" @click="stopAudio">停止</button><label>播放速度 <select v-model="rate" @change="changeRate"><option :value="0.8">慢一点</option><option :value="1">练习原速</option><option :value="1.15">稍快</option></select></label><button v-if="error" class="text-button" @click="choose(lesson.id)">重新读取音频</button></div>
            <p>第一遍抓住大意，第二遍带着问题听。需要时再展开文本。</p>
            <fieldset v-for="(q,i) in lesson.questions" :key="q.question"><legend>{{ i+1 }}. {{ q.question }}</legend><label v-for="(choice,j) in q.choices" :key="choice"><input v-model="answers[i]" type="radio" :name="'question-'+i" :value="j"> {{ choice }}</label></fieldset>
            <button class="btn btn-primary" :disabled="busy||!ready" @click="submit">提交理解结果</button>
            <div v-if="feedback" class="listening-feedback" role="status"><strong>{{ feedback.correct }} / {{ feedback.total }} 题答对</strong><p>{{ feedback.transcriptShown?'本轮已展开文本，按辅助理解记录。':'本轮未展开文本，记录本次听力理解表现。' }}</p><p v-for="(item,i) in feedback.results" :key="i">{{ i+1 }}. {{ item.correct?'正确':'待巩固' }} · {{ item.answer }}</p></div>
            <button class="text-button transcript-toggle" @click="transcriptShown=true">展开文本核对</button><p v-if="transcriptShown" lang="en" class="transcript">{{ lesson.transcript }}</p><p>{{ lesson.task }}</p><router-link class="btn btn-secondary" :to="{path:'/practice',query:{scene:lesson.scene}}">进入对应情境，用自己的话处理任务</router-link>
          </section>
          <section v-else class="card listening-intro"><h2>把听懂变成可以回应</h2><ol><li>选择一段短材料，先不看文字。</li><li>听出对方问什么、有哪些关键条件。</li><li>核对后换日期、价格或需求，再用自己的话表达。</li></ol></section>
        </div>
        <article class="card source-feature"><h2>真人有声书 · Alice’s Adventures in Wonderland</h2><p>LibriVox 志愿者朗读。可边听原版章节边阅读；不要把合成练习音频与真人录音混为同一种材料。</p><audio controls preload="none" src="https://archive.org/download/alice_in_wonderland_librivox/wonderland_ch_01.mp3" @error="error='外部音频暂时无法连接，可打开来源页面或选择上方情境精听。'" /><p><a href="https://librivox.org/alices-adventures-in-wonderland-by-lewis-carroll/" target="_blank" rel="noopener noreferrer">打开官方来源和其他章节</a></p><small>来源声明在美国属公版，其他地区需核对适用状态。</small></article>
      </template>
      <section v-else-if="tab==='reading'" class="reading-shelf"><article v-for="book in data.books" :key="book.id" class="card reading-book"><small>{{ book.level }} · {{ book.chapterCount }} 章</small><h2>{{ book.titleZh }}</h2><p lang="en">{{ book.title }}</p><p>{{ book.author }}</p><p class="source-line">{{ book.sourceName }} · 完整原文</p><router-link class="btn btn-primary" :to="'/library/read/'+book.id">开始或继续阅读</router-link><p><a :href="book.sourceUrl" target="_blank" rel="noopener noreferrer">原始来源与版本</a></p></article></section>
      <section v-else class="source-list"><article v-for="item in data.resources" :key="item.id" class="card"><small>{{ item.source }} · {{ item.type }} · {{ item.level }}</small><h2>{{ item.title }}</h2><p>{{ item.note }}</p><a class="btn btn-primary" :href="item.url" target="_blank" rel="noopener noreferrer">前往官方学习</a><p class="source-line">{{ item.license }} <a :href="item.licenseUrl" target="_blank" rel="noopener noreferrer">使用说明</a></p></article></section>
    </template>
  </main>
</template>
<style scoped>
.library-page{max-width:1100px;margin:auto}.library-tabs,.audio-tools{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}.lesson-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:22px}.lesson-list{display:grid;align-content:start;gap:8px}.lesson-list button{text-align:left;border:1px solid var(--line);background:var(--bg-card);color:var(--ink);padding:16px;border-radius:10px;font:inherit}.lesson-list strong,.lesson-list small{display:block}.lesson-list small,.source-line{font-size:12px;color:var(--ink-soft);line-height:1.8}.lesson-list .chosen{border-color:var(--accent)}.listening-detail h2,.source-feature h2{font-size:21px}.listening-detail p,.listening-intro li,.source-list p{line-height:1.9}.listening-detail fieldset{border:1px solid var(--line);padding:15px;margin:18px 0}.listening-detail fieldset label{display:block;padding:9px 0}.listening-feedback{margin:20px 0;padding:16px;background:var(--accent-soft);border-radius:10px}.transcript{font-size:18px;line-height:1.9}.transcript-toggle{display:block;margin:22px 0}.reading-shelf,.source-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.reading-book h2{font-size:27px}.reading-book p{line-height:1.8}.source-feature{margin-top:24px}.source-feature audio{width:100%;margin-top:12px}.audio-tools label{align-self:center}.audio-tools select{padding:7px;background:var(--bg-card);color:var(--ink);border:1px solid var(--line)}@media(max-width:760px){.lesson-layout{grid-template-columns:1fr}.lesson-list{grid-template-columns:repeat(2,minmax(0,1fr))}.reading-shelf,.source-list{grid-template-columns:1fr}.lesson-list button{padding:12px;font-size:13px}}
</style>

<style scoped>.listening-detail>audio{width:100%;margin-top:15px}</style>
