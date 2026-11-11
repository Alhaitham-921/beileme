<script setup>
import { ref,onMounted,onBeforeUnmount,watch } from 'vue'
import ielts,{fetchMedia,uploadRecording,requestKey} from '../api/ielts.js'
const props=defineProps({attemptId:Number,question:Object,disabled:Boolean})
const emit=defineEmits(['apply'])
const active=ref(false),elapsed=ref(0),url=ref(''),consent=ref(false),record=ref(null),error=ref(''),busy=ref(false),transcript=ref(''),prepare=ref(0)
let recorder,stream,timer,blob,prepareTimer,generation=0,alive=true
function release(){clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());stream=null}
function stop(){if(recorder&&recorder.state!=='inactive')recorder.stop();release();active.value=false}
function preparation(){prepare.value=props.question.preparationSeconds||0;clearInterval(prepareTimer);prepareTimer=setInterval(()=>{if(prepare.value>0)prepare.value--;else clearInterval(prepareTimer)},1000)}
async function start(){
  error.value=''
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){error.value='当前设备不支持网页录音，可以先输入文字回答。';return}
  const g=++generation
  try{
    const acquired=await navigator.mediaDevices.getUserMedia({audio:true})
    if(!alive||g!==generation){acquired.getTracks().forEach(t=>t.stop());return}
    stream=acquired
    const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t))
    recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined)
    const chunks=[]
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
    recorder.onstop=()=>{blob=new Blob(chunks,{type:recorder.mimeType});if(url.value)URL.revokeObjectURL(url.value);url.value=URL.createObjectURL(blob);record.value=null;release()}
    recorder.start(1000);active.value=true;elapsed.value=0
    timer=setInterval(()=>{elapsed.value++;if(elapsed.value>=(props.question.answerSeconds||120))stop()},1000)
  }catch(e){release();error.value=e.name==='NotAllowedError'?'麦克风权限未开启，请允许录音或继续输入文字。':'无法启动麦克风，请检查设备是否被占用。'}
}
async function save(){busy.value=true;error.value='';try{record.value=await uploadRecording(props.attemptId,props.question.id,blob)}catch(e){error.value=e.message}finally{busy.value=false}}
async function transcribe(){busy.value=true;error.value='';const g=generation;try{const result=await ielts.transcribe(record.value.id,requestKey());if(alive&&g===generation)transcript.value=result.text}catch(e){error.value=e.message}finally{busy.value=false}}
function hidden(){if(document.hidden)stop()}
watch(()=>props.disabled,value=>{if(value)stop()})
onMounted(async()=>{
  document.addEventListener('visibilitychange',hidden)
  try{const data=await ielts.recordings(props.attemptId);const prior=data.recordings.find(r=>r.question_id===props.question.id);if(prior&&alive){record.value=prior;url.value=await fetchMedia(`/ielts/recordings/${prior.id}`)}}catch{}
})
onBeforeUnmount(()=>{alive=false;generation++;if(recorder)recorder.onstop=null;stop();clearInterval(prepareTimer);document.removeEventListener('visibilitychange',hidden);if(url.value)URL.revokeObjectURL(url.value)})
</script>
<template><div class="ielts-recording">
  <div class="ielts-inline-actions"><button v-if="question.preparationSeconds&&!disabled" class="btn btn-ghost" :disabled="active||prepare>0" @click="preparation">准备 {{question.preparationSeconds}} 秒</button><span v-if="prepare" role="timer">准备剩余 {{prepare}} 秒</span><button v-if="!active&&!disabled" class="btn btn-ghost" :disabled="busy||prepare>0" @click="start">录制回答</button><button v-if="active" class="btn btn-primary" @click="stop">停止录音 {{elapsed}} 秒</button></div>
  <audio v-if="url" :src="url" controls aria-label="回放自己的回答"></audio>
  <template v-if="url&&!record&&!disabled"><label><input v-model="consent" type="checkbox"> 我同意将这段录音保存到服务器，用于回放和转写</label><button class="btn btn-ghost" :disabled="!consent||busy" @click="save">{{busy?'正在保存…':'保存录音'}}</button></template>
  <div v-if="record&&!disabled" class="ielts-inline-actions"><span>录音已保存</span><button class="btn btn-ghost" :disabled="busy" @click="transcribe">{{busy?'正在识别…':'使用所选语音服务转写'}}</button></div>
  <template v-if="transcript"><label>请先核对识别内容<textarea v-model="transcript" aria-label="核对转写文字"></textarea></label><button class="btn btn-ghost" :disabled="disabled" @click="emit('apply',transcript)">将核对后的文字填入回答</button></template>
  <p v-if="error" class="ielts-error" role="alert">{{error}}</p><p class="muted">语音转写使用你选择的平台额度或个人语音 Key，不会自动发送回答。发音需要结合原录音评估。</p>
</div></template>
