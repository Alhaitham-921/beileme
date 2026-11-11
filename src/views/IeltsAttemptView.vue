<script setup>
import IeltsNavigation from '../components/IeltsNavigation.vue'
import { ref,reactive,computed,watch,onMounted,onBeforeUnmount,nextTick } from 'vue'
import { useRoute,onBeforeRouteLeave,onBeforeRouteUpdate } from 'vue-router'
import ielts,{requestKey,fetchMedia} from '../api/ielts.js'
import IeltsChart from '../components/IeltsChart.vue'
import IeltsRecorder from '../components/IeltsRecorder.vue'
import IeltsDiagram from '../components/IeltsDiagram.vue'
import IeltsPassage from '../components/IeltsPassage.vue'
const route=useRoute(),attempt=ref(null),answers=reactive({}),error=ref(''),status=ref(''),saving=ref(false),dirty=ref(false),selected=ref(''),job=ref(null),versions=ref([]),clock=ref(Date.now()),busyJob=ref(false)
const audioUrls=reactive({}),played=reactive({}),audioElements=new Map()
const annotations=reactive({highlights:[],flags:[]})
let offset=0,debounce,tick,jobPoll,saveChain=Promise.resolve(),alive=true,suspended=false,feedbackRequestKey=null
const paper=computed(()=>attempt.value?.paper),submitted=computed(()=>attempt.value?.state==='submitted'),locked=computed(()=>submitted.value||attempt.value?.state==='paused'||(remaining.value!==null&&remaining.value<=0))
const remaining=computed(()=>attempt.value?.deadlineAt?Math.max(0,Math.ceil((new Date(attempt.value.deadlineAt).getTime()-(clock.value+offset))/1000)):null)
const timeLabel=computed(()=>remaining.value===null?'自主训练':`${Math.floor(remaining.value/60)}:${String(remaining.value%60).padStart(2,'0')}`)
const section=computed(()=>paper.value?.sections.find(s=>s.id===selected.value)||paper.value?.sections[0])
const questions=computed(()=>paper.value?.questions.filter(q=>q.sectionId===section.value?.id)||[])
const answered=computed(()=>Object.values(answers).filter(v=>Array.isArray(v)?v.length:String(v||'').trim()).length)
const count=value=>String(value||'').trim().split(/\s+/).filter(Boolean).length
function adopt(value,replaceAnswers=false){attempt.value=value;offset=new Date(value.serverNow).getTime()-Date.now();if(replaceAnswers){Object.keys(answers).forEach(k=>delete answers[k]);Object.assign(answers,value.answers);Object.assign(annotations,value.annotations||{highlights:[],flags:[]});value.paper.questions.filter(q=>q.type==='multiple').forEach(q=>{answers[q.id] ||= []})}if(!selected.value)selected.value=value.paper.sections[0]?.id}
async function load(){error.value='';try{adopt(await ielts.attempt(Number(route.params.id)),true);dirty.value=false;suspended=false;if(submitted.value)await restoreJob()}catch(e){error.value=e.message}}
async function restoreJob(){try{job.value=await ielts.latestFeedback(attempt.value.id);if(job.value&&['queued','running'].includes(job.value.state))pollJob()}catch{}}
function changed(){if(locked.value||suspended)return;dirty.value=true;status.value='有未保存修改';clearTimeout(debounce);debounce=setTimeout(()=>persist(),900)}
function persist(action='save'){
  clearTimeout(debounce)
  const snapshot=JSON.parse(JSON.stringify(answers))
  const marks=JSON.parse(JSON.stringify(annotations))
  const task=saveChain.catch(()=>{}).then(async()=>{
    if(!alive||submitted.value||suspended)return false
    saving.value=true;error.value=''
    try{const value=await ielts.save(attempt.value.id,{revision:attempt.value.revision,answers:snapshot,annotations:marks,action});if(!alive)return false;adopt(value);dirty.value=JSON.stringify(answers)!==JSON.stringify(snapshot)||JSON.stringify(annotations)!==JSON.stringify(marks);status.value=dirty.value?'正在保存新修改…':'进度已保存';if(value.state==='submitted'){dirty.value=false;status.value='已提交';await restoreJob()}return true}
    catch(e){error.value=e.message;if(e.status===409){suspended=true;status.value='检测到其他页面修改，已保留当前输入'}else status.value='保存失败，输入仍保留在当前页面';return false}
    finally{saving.value=false}
  });saveChain=task;return task
}
async function feedback(){busyJob.value=true;error.value='';try{feedbackRequestKey ||= requestKey();job.value=await ielts.feedback(attempt.value.id,feedbackRequestKey);pollJob()}catch(e){error.value=e.message;feedbackRequestKey=null}finally{busyJob.value=false}}
function pollJob(){clearInterval(jobPoll);jobPoll=setInterval(async()=>{if(!job.value||!alive)return;try{job.value=await ielts.job(job.value.id);if(!['queued','running'].includes(job.value.state))clearInterval(jobPoll)}catch(e){error.value=e.message;clearInterval(jobPoll)}},2000)}
async function retryFeedback(){feedbackRequestKey=null;await feedback()}
async function loadVersions(){try{versions.value=(await ielts.versions(attempt.value.id)).versions}catch(e){error.value=e.message}}
async function playAudio(){
  if(!section.value?.audioUrl)return
  const s=section.value,key=s.id
  error.value=''
  try{if(!audioUrls[key])audioUrls[key]=await fetchMedia(s.audioUrl);if(!submitted.value&&attempt.value.mode==='mock'&&!played[key]){await ielts.claimAudio(attempt.value.id,key);played[key]=true}await nextTick();await audioElements.get(key)?.play()}catch(e){error.value=e.message}
}
function resultFor(id){return attempt.value?.report?.questions.find(q=>q.id===id)}
function pageLeave(event){if(dirty.value){event.preventDefault();event.returnValue=''}}
function keyForQuestion(q){return `${attempt.value.id}-${q.id}`}
function toggleMark(key){annotations.highlights=annotations.highlights.includes(key)?annotations.highlights.filter(k=>k!==key):[...annotations.highlights,key];changed()}
function jump(id){document.getElementById(`question-${id}`)?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}
async function leaveSafely(){if(!dirty.value)return true;await persist();return !dirty.value}
onBeforeRouteLeave(leaveSafely)
onBeforeRouteUpdate(leaveSafely)
watch(()=>route.params.id,()=>{selected.value='';job.value=null;load()})
onMounted(async()=>{await load();window.addEventListener('beforeunload',pageLeave);tick=setInterval(async()=>{clock.value=Date.now();if(attempt.value?.state!=='submitted'&&remaining.value!==null&&remaining.value<=0){try{adopt(await ielts.attempt(attempt.value.id));dirty.value=false}catch{status.value='时间已到，连接恢复后确认已保存的作答'}}},1000)})
onBeforeUnmount(()=>{alive=false;clearTimeout(debounce);clearInterval(tick);clearInterval(jobPoll);window.removeEventListener('beforeunload',pageLeave);Object.values(audioUrls).forEach(URL.revokeObjectURL);audioElements.forEach(a=>a?.pause())})
watch(selected,()=>audioElements.forEach(a=>a?.pause()))
</script>
<template><div class="ielts-page"><IeltsNavigation/>
  <p v-if="!attempt&&!error" role="status">正在恢复你的练习…</p><p v-if="error" class="ielts-error" role="alert">{{error}}</p>
  <template v-if="attempt">
    <header class="ielts-heading"><div><h1>{{paper.title}}</h1><p>{{attempt.mode==='mock'?'模考模式，计时不会因离开页面而暂停':'训练模式，按自己的节奏练习'}} · 第 {{paper.version}} 版</p></div><router-link class="btn btn-ghost" to="/ielts/specialties">专项目录</router-link></header>
    <p v-if="paper.status!=='published'" class="ielts-warning">管理员草稿预览：{{paper.draftNote||'本材料尚未完成教师复核，未公开发布。'}}</p>
    <div class="ielts-toolbar"><strong role="timer" aria-live="off">{{submitted?'已完成':timeLabel}}</strong><span>已作答 {{answered}} / {{paper.questions.length}}</span><span role="status">{{status}}</span><button v-if="!submitted" class="btn btn-ghost" :disabled="saving||suspended" @click="persist()">保存进度</button></div>
    <p v-if="attempt.state==='paused'" class="ielts-warning">训练已暂停。<button class="btn btn-ghost" @click="persist('resume')">继续训练</button></p>
    <div class="ielts-tabs" role="tablist" aria-label="材料分段"><button v-for="s in paper.sections" :key="s.id" class="btn btn-ghost" role="tab" :aria-selected="selected===s.id" @click="selected=s.id">{{s.title}}</button></div>
    <div class="ielts-workspace">
      <aside v-if="section" class="ielts-reading">
        <h2>{{section.title}}</h2>
        <IeltsChart v-if="section.chart" :chart="section.chart"/>
        <IeltsDiagram v-if="section.diagram" :diagram="section.diagram"/>
        <IeltsPassage v-if="section.text" :text="section.text" :section-id="section.id" :marked="annotations.highlights" :disabled="locked" @mark="toggleMark"/>
        <template v-if="section.audioUrl"><button v-if="!submitted" class="btn btn-ghost" :disabled="attempt.mode==='mock'&&played[section.id]" @click="playAudio">{{played[section.id]&&attempt.mode==='mock'?'本段已开始播放':'播放本段录音'}}</button><audio v-if="audioUrls[section.id]" :ref="el=>audioElements.set(section.id,el)" :src="audioUrls[section.id]" :controls="attempt.mode==='practice'||submitted" style="width:100%"></audio><button v-if="submitted" class="btn btn-ghost" @click="playAudio">回听录音</button></template>
        <p v-if="paper.skill==='listening'&&!submitted" class="muted">提交后可查看完整原文与答案依据。</p>
        <nav class="ielts-chips" aria-label="题号"><a v-for="q in questions" :key="q.id" :href="`#question-${q.id}`" @click.prevent="jump(q.id)">{{annotations.flags.includes(q.id)?'★ ':''}}{{q.id}}</a></nav>
        <label v-for="q in questions" :key="`flag-${q.id}`" style="display:inline-block;margin:8px"><input v-model="annotations.flags" type="checkbox" :value="q.id" :disabled="locked" @change="changed"> 标记 {{q.id}}</label>
      </aside>
      <section aria-label="作答区"><article v-for="q in questions" :id="`question-${q.id}`" :key="q.id" class="ielts-question"><h3>{{q.id}}. {{q.prompt}}</h3><div class="ielts-answer">
        <div v-if="q.options" class="ielts-options"><label v-for="option in q.options" :key="option.value"><input v-model="answers[q.id]" :type="q.type==='multiple'?'checkbox':'radio'" :value="option.value" :name="q.id" :disabled="locked" @change="changed">{{option.label}}</label></div>
        <template v-else-if="['essay','spoken'].includes(q.type)"><IeltsRecorder v-if="q.type==='spoken'" :key="keyForQuestion(q)" :attempt-id="attempt.id" :question="q" :disabled="locked" @apply="text=>{answers[q.id]=text;changed()}"/><textarea v-model="answers[q.id]" :aria-label="`${q.id} 回答`" :disabled="locked" :spellcheck="attempt.mode!=='mock'" :autocorrect="attempt.mode==='mock'?'off':'on'" autocomplete="off" :autocapitalize="attempt.mode==='mock'?'off':'sentences'" @input="changed"></textarea><p class="muted">{{count(answers[q.id])}} 词<span v-if="q.minimumWords">，建议至少 {{q.minimumWords}} 词</span></p></template>
        <label v-else><span v-if="q.maxWords" class="muted">不超过 {{q.maxWords}} 个词</span><input v-model="answers[q.id]" :aria-label="`${q.id} 答案`" :disabled="locked" autocomplete="off" :spellcheck="false" @input="changed"></label>
      </div><div v-if="submitted&&resultFor(q.id)?.correct!==null" class="ielts-result" :class="{wrong:!resultFor(q.id)?.correct}"><strong>{{resultFor(q.id)?.correct?'答对':'需要巩固'}}</strong><p>参考答案：{{Array.isArray(q.answer)?q.answer.join(' / '):q.answer}}</p><p>{{q.explanation}}</p><blockquote>{{q.evidence}}</blockquote></div></article></section>
    </div>
    <div v-if="!submitted" class="ielts-submit"><button class="btn btn-primary" :disabled="saving||locked||suspended" @click="persist('submit')">提交整份作答</button><button v-if="attempt.mode==='practice'&&attempt.state!=='paused'" class="btn btn-ghost" :disabled="saving" @click="persist('pause')">暂停并保存</button><span class="muted">提交后不可继续修改本次答案，可新开一次练习。</span></div>
    <section v-if="submitted" class="ielts-section"><h2>本次复盘</h2><p v-if="attempt.report.total">答对 {{attempt.report.correct}} / {{attempt.report.total}} 题</p><p class="muted">{{attempt.report.note}}</p><template v-if="['writing','speaking'].includes(paper.skill)"><button v-if="!job" class="btn btn-primary" :disabled="busyJob" @click="feedback">申请 AI 练习反馈</button><p v-if="job&&['queued','running'].includes(job.state)" role="status">{{job.state==='queued'?'报告已排队，可以离开页面，稍后回来查看。':'正在分析你的真实作答…'}}</p><p v-if="job&&['failed','interrupted'].includes(job.state)" class="ielts-warning">报告未完成，平台预占额度已释放。<button class="btn btn-ghost" :disabled="busyJob" @click="retryFeedback">重新申请</button></p><div v-if="job?.result"><h3>练习反馈</h3><p>{{job.result.summary}}</p><div v-for="c in job.result.criteria" :key="c.key" class="ielts-result"><strong>{{({task:'任务完成',coherence:'连贯与衔接',lexical:'词汇运用',grammar:'语法'})[c.key]}}<span v-if="c.band!==null"> · 参考 {{c.band}} 分</span></strong><p>{{c.feedback}}</p><blockquote v-for="e in c.evidence" :key="`${e.questionId}-${e.quote}`">{{e.questionId}}：{{e.quote}}</blockquote></div><div v-for="(c,i) in job.result.corrections" :key="i" class="ielts-result"><blockquote>{{c.quote}}</blockquote><p>建议：{{c.replacement}}</p><p>{{c.explanation}}</p></div><p class="muted">{{job.result.pronunciation.note}}</p><p class="muted">{{job.result.disclaimer}}</p></div></template>
    <template v-if="paper.skill==='writing'"><button class="btn btn-ghost" @click="loadVersions">查看已保存的写作版本</button><details v-for="v in versions" :key="v.revision" class="ielts-archive"><summary>版本 {{v.revision}}</summary><pre v-for="(text,key) in v.answers" :key="key">{{key}}：{{text}}</pre></details></template></section>
  </template>
</div></template>
