<script setup>
import { ref,onMounted } from 'vue'
import { practice } from '../api'
const autoImages=ref(false), available=ref(false), loading=ref(true), saving=ref(false), error=ref('')
async function load(){loading.value=true;error.value='';try{const data=await practice.illustrationSettings();autoImages.value=data.autoImages;available.value=data.available}catch(e){error.value=e.message}finally{loading.value=false}}
async function save(value){const previous=autoImages.value;autoImages.value=value;saving.value=true;error.value='';try{const data=await practice.saveIllustrationSettings(value);autoImages.value=data.autoImages;document.dispatchEvent(new Event('beileme:illustration-settings'))}catch(e){autoImages.value=previous;error.value=e.message}finally{saving.value=false}}
onMounted(load)
</script>
<template>
  <section class="card scenario-image-settings" aria-label="情境配图设置">
    <h2>像看漫画一样练对话</h2>
    <label><input type="checkbox" :checked="autoImages" :disabled="loading||saving||Boolean(error)" @change="save($event.target.checked)">情境自动生图</label>
    <p>默认关闭。主动开启后，生成情境时准备开场图；对话中的地点、行动或内容明显变化时追加新的一幕。不用等图才能聊天；场景提示图仍可在每轮对话中单独点击生成。</p>
    <p class="muted">与记忆图共用每日图片额度。关闭后保留已有图片；已提交的生图请求仍可能完成。设置跟随账号保存。</p>
    <p v-if="!loading&&!available" class="muted">服务器暂未启用生图服务。开关会保留，服务可用后生效。</p>
    <LoadingState v-if="loading||saving">{{saving?'正在保存…':'正在读取设置…'}}</LoadingState>
    <p v-if="error" role="alert">{{error}} <button type="button" class="text-button" @click="load">重新读取</button></p>
  </section>
</template>
<style scoped>
.scenario-image-settings{margin-top:16px}.scenario-image-settings h2{font-size:19px;margin:0 0 16px}.scenario-image-settings label{display:flex;align-items:center;gap:10px;cursor:pointer}.scenario-image-settings input{accent-color:var(--accent);width:18px;height:18px}.scenario-image-settings p{font-size:13px;line-height:1.8}.scenario-image-settings .muted{font-size:12px}
</style>
