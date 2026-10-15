<script setup>
import { ref, computed, onMounted } from 'vue'
import { practice } from '../api'
const scenes = ref([]), history = ref([]), sceneId = ref('library'), answer = ref(''), feedback = ref(null), error = ref(''), busy = ref(false), showExample = ref(false)
const scene = computed(() => scenes.value.find(s => s.id === sceneId.value))
async function load() {
  try { const data = await practice.list(); scenes.value = data.scenes; history.value = data.history }
  catch (e) { error.value = e.message }
}
onMounted(load)
function changeScene() { answer.value = ''; feedback.value = null; showExample.value = false; error.value = '' }
async function submit() {
  busy.value = true; error.value = ''; feedback.value = null
  try { feedback.value = (await practice.submit({ scene: sceneId.value, answer: answer.value })).feedback; await load() }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
const labels = { grammar: '语法', word_usage: '用词', spelling: '拼写', chinese_help: '中文求助' }
</script>
<template>
  <div class="practice">
    <h1 class="section-title">在情境里用单词</h1>
    <p>尝试表达 → 查看纠错 → 修改重试 → 薄弱词复习</p>
    <p v-if="error" role="alert" class="error">{{ error }} <button v-if="!scenes.length" class="btn" @click="load">重试</button></p>
    <section v-if="scene" class="card">
      <label>练习情境 <select v-model="sceneId" :disabled="busy" @change="changeScene"><option v-for="s in scenes" :key="s.id" :value="s.id">{{ s.title }}</option></select></label>
      <p>{{ scene.task }}</p>
      <p>目标词：<strong>{{ scene.words.join(' · ') }}</strong></p>
      <blockquote>{{ scene.opening }}</blockquote>
      <form @submit.prevent="submit">
        <label for="expression">你的表达（可以夹中文）</label>
        <textarea id="expression" v-model="answer" rows="5" maxlength="2000" :disabled="busy" placeholder="试着用英语回答，不会的部分可以写中文。" required></textarea>
        <button class="btn btn-primary" :disabled="busy || answer.trim().length < 2">{{ busy ? '正在分析，请稍候…' : feedback ? '提交修改后的表达' : '提交并分析' }}</button>
      </form>
      <button class="btn" @click="showExample = !showExample">{{ showExample ? '收起' : '查看' }}参考表达</button>
      <p v-if="showExample">{{ scene.example }}</p>
      <p class="note">自动纠错需使用已配置的 AI，每日最多 30 次。分析用于学习参考，不评估发音或雅思分数。</p>
    </section>
    <section v-if="feedback" class="card feedback" aria-live="polite">
      <h2>表达反馈</h2><p>{{ feedback.reply }}</p><p>{{ feedback.summary }}</p>
      <h3>建议表达</h3><p>{{ feedback.corrected }}</p>
      <h3>问题与原因</h3>
      <p v-if="!feedback.corrections.length">本次未发现需要修改的问题。</p>
      <article v-for="(c, i) in feedback.corrections" :key="i"><strong>{{ labels[c.type] }}</strong><p>{{ c.original }} → {{ c.replacement }}</p><p>{{ c.explanation }}</p></article>
      <p>已加入复习：{{ feedback.reviewWords.map(w => w.spelling).join('、') || '无' }}</p>
      <p v-if="feedback.unmatchedWords.length">当前词书未收录：{{ feedback.unmatchedWords.join('、') }}（未加入复习）</p>
      <router-link class="btn" to="/study">去复习</router-link>
      <p>请根据反馈修改上方表达，再提交检验。</p>
    </section>
    <section v-if="history.length"><h2>最近练习</h2><details v-for="item in history" :key="item.id"><summary>{{ scenes.find(s => s.id === item.scene)?.title }} · {{ new Date(item.created_at).toLocaleString() }}</summary><p>{{ item.answer }}</p><p>{{ item.feedback.corrected }}</p><p>{{ item.feedback.summary }}</p><p v-for="(c,i) in item.feedback.corrections" :key="i">{{ labels[c.type] }}：{{ c.original }} → {{ c.replacement }}。{{ c.explanation }}</p></details></section>
  </div>
</template>
<style scoped>
.practice { max-width: 760px; margin: auto; padding: 30px 20px 80px; }.card { margin: 24px 0; }textarea { width: 100%; box-sizing: border-box; margin: 12px 0; padding: 14px; font: inherit; resize: vertical; border: 1px solid var(--line); border-radius: 12px; background: var(--bg-card); color: var(--ink); }select { padding: 8px; font: inherit; }article, details { border-top: 1px solid var(--line); padding: 16px 0; }.error { color: var(--bad); }.note { color: var(--ink-soft); font-size: 13px; }blockquote { margin: 20px 0; padding-left: 16px; border-left: 3px solid var(--accent); }
</style>
