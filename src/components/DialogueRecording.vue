<script setup>
import {ref,watch,onBeforeUnmount} from 'vue'
import {readDialogueRecording,deleteDialogueRecording} from '../utils/dialogueRecordings.js'
const props=defineProps({userId:[Number,String],sessionId:[Number,String],turn:Number,revision:Number})
const recordings=ref([]),error=ref('');let run=0
function clear(){for(const item of recordings.value)URL.revokeObjectURL(item.url);recordings.value=[]}
watch(()=>[props.userId,props.sessionId,props.turn,props.revision],async()=>{
 const generation=++run;clear()
 const saved=await readDialogueRecording(props.userId,props.sessionId,props.turn)
 if(generation!==run||!saved)return
 recordings.value=saved.clips.map(clip=>({url:URL.createObjectURL(clip.blob),durationMs:clip.durationMs}))
},{immediate:true})
async function remove(){try{await deleteDialogueRecording(props.userId,props.sessionId,props.turn);clear()}catch{error.value='未能删除本机录音，请重试'}}
onBeforeUnmount(()=>{run++;clear()})
</script>
<template><section v-if="recordings.length" class="dialogue-recording" aria-label="我的原录音"><small>我的原录音 · 保存在此设备，文字修改不改变录音</small><audio v-for="(item,i) in recordings" :key="item.url" :src="item.url" controls preload="none" :aria-label="'回放原录音 '+(i+1)"/><button class="text-button" @click="remove">删除这条回答的录音</button><p v-if="error" role="alert">{{error}}</p></section></template>
<style scoped>.dialogue-recording{margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}small{display:block;color:var(--ink-soft);line-height:1.6}audio{display:block;width:min(100%,380px);height:38px;margin:8px 0}button{font-size:12px}</style>
