<script setup>
import { ref, watch } from 'vue'
import { usePracticeSpeech } from '../composables/usePracticeSpeech.js'
import AppIcon from '../components/AppIcon.vue'

const speech = usePracticeSpeech()
const { available, statusLoading, statusReason, supported, isStarting, isRecording, isTranscribing,
  error, transcript, elapsedSeconds, maxSeconds, remaining } = speech
const draft = ref(''), copyMessage = ref('')
watch(transcript, text => { if (text) { draft.value = text; copyMessage.value = '' } })
async function copy() {
  try { await navigator.clipboard.writeText(draft.value); copyMessage.value = '已复制' }
  catch { copyMessage.value = '无法自动复制，请在文本框内选中文字复制。' }
}
</script>

<template>
  <div class="speech-page">
    <p class="page-eyebrow">SPEAK YOUR MIND</p>
    <h1 class="section-title">语音转文字</h1>
    <p class="intro">说一句英语，或用中英混合表达你的想法。录音停止后，文字会出现在下方，你可以检查和修改。</p>
    <section class="card recorder" aria-label="录音转写">
      <p>语音识别由管理员统一提供，无需填写个人 Key，也无需先开始 AI 对话。</p>
      <p v-if="statusLoading" role="status">正在检查语音服务…</p>
      <p v-else-if="!supported" role="alert">当前环境无法录音。请使用 HTTPS 或 localhost，并在新版浏览器中打开。</p>
      <p v-else-if="!available" role="status">{{ statusReason }}</p>
      <p v-else class="quota">每段最多 {{ maxSeconds }} 秒 · 今日剩余 {{ remaining }} 次</p>
      <div class="actions">
        <button v-if="!isRecording" class="btn btn-primary" :disabled="!available || statusLoading || isStarting || isTranscribing" @click="speech.start"><AppIcon name="microphone" /> {{ isTranscribing ? '正在识别…' : isStarting ? '正在开启麦克风…' : '开始录音' }}</button>
        <button v-else class="btn btn-primary" @click="speech.stop">停止并转文字 · {{ elapsedSeconds }} 秒</button>
        <button v-if="isRecording || isStarting || isTranscribing" class="btn" @click="speech.cancel">取消</button>
        <button v-else class="btn" :disabled="statusLoading" @click="speech.refreshStatus">刷新服务状态</button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="isRecording" role="status">正在录音，停止后才会上传识别。</p>
      <label for="speech-result">识别结果（可编辑）</label>
      <textarea id="speech-result" v-model="draft" rows="8" placeholder="录音识别后的文字会显示在这里…"></textarea>
      <div class="actions"><button class="btn" :disabled="!draft" @click="copy">复制文字</button><router-link to="/practice" class="btn">前往情境练习</router-link></div>
      <p role="status">{{ copyMessage }}</p>
      <small>录音会发送至管理员配置的语音服务。本功能将声音转成文字，不提供发音评分。</small>
    </section>
  </div>
</template>

<style scoped>
.speech-page { max-width: 820px; margin: auto; padding: 32px 20px 80px; }.intro { line-height: 1.8; margin: 18px 0 24px; }
.recorder { padding: 28px; }.recorder p { line-height: 1.8; margin-bottom: 16px; }.quota, small { opacity: .75; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 18px 0; }.actions .btn { display: inline-flex; align-items: center; gap: 8px; }
label { display: block; margin: 24px 0 10px; }textarea { width: 100%; box-sizing: border-box; resize: vertical; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: inherit; font: inherit; line-height: 1.8; }
.error { color: var(--bad); }small { line-height: 1.7; }
</style>
