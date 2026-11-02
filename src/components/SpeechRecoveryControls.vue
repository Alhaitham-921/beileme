<script setup>
import {computed} from 'vue'
const props=defineProps({speech:{type:Object,required:true}})
const phase=computed(()=>props.speech.phase.value),retry=computed(()=>props.speech.canRetry.value),busy=computed(()=>props.speech.isTranscribing.value)
const labels={preparing:'正在整理录音…',uploading:'正在上传录音…',recognizing:'上传完成，语音服务正在识别…'}
</script>
<template><div class="recovery-controls">
 <p v-if="busy" role="status">{{labels[phase]||'正在处理录音…'}}</p>
 <p v-if="speech.isPreparingSpeech.value" role="status">正在准备朗读音频…再次点击朗读可取消。</p>
 <template v-if="retry"><audio v-if="speech.recordingUrl.value" :src="speech.recordingUrl.value" controls aria-label="回放保留的录音"></audio>
 <button class="btn btn-secondary" :disabled="busy" @click="speech.retryTranscription">用这段录音重新识别</button><small>重试会再次提交识别；未发送的文字仍可编辑。</small></template>
 <button v-if="busy" class="text-button" @click="speech.cancel">取消等待，保留录音</button>
</div></template>
<style scoped>.recovery-controls{display:grid;gap:8px;margin:12px 0}.recovery-controls audio{max-width:100%}small{opacity:.75}</style>
