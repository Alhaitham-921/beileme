<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '../api/client.js'
import { practice } from '../api'
import PracticeImage from '../components/PracticeImage.vue'

const route = useRoute(), router = useRouter()
const image = ref(null), loading = ref(true), busy = ref(false), error = ref(''), errorCode = ref('')
const difficulty = ref('beginner')
const controller = new AbortController()
let disposed = false
const wordId = Number(route.query.word)
const sense = typeof route.query.sense === 'string' ? route.query.sense : ''
async function load() {
  loading.value = true; image.value = null; error.value = ''; errorCode.value = ''
  try {
    if (!Number.isSafeInteger(wordId) || wordId <= 0 || !sense) throw new Error('请从单词记忆图打开看图练习。')
    const card = await http.get(`/words/${wordId}/memory-image`, { query: { sense }, signal: controller.signal, timeoutMs: 10000 })
    if (disposed) return
    if (card.selected?.sense !== sense || !card.imagePath) throw new Error('这条词义还没有可用的记忆图，请返回单词页面先生成图片。')
    // Fetch the word from the same authenticated dictionary endpoint as the learning card.
    const word = await http.get(`/words/${wordId}`, { signal: controller.signal, timeoutMs: 10000 })
    if (!disposed) image.value = { wordId, word: (word.word || word).spelling, sense, imagePath: card.imagePath }
  } catch (e) { if (!disposed) { error.value = e.message; errorCode.value = e.code || '' } }
  finally { if (!disposed) loading.value = false }
}
async function start() {
  if (busy.value || !image.value) return
  busy.value = true; error.value = ''; errorCode.value = ''
  try {
    const session = await practice.startImageSession({ wordId, sense, imagePath: image.value.imagePath, difficulty: difficulty.value })
    if (!disposed) await router.replace({ path: '/practice', query: { session: session.id } })
  } catch (e) { if (!disposed) { error.value = e.message; errorCode.value = e.code || '' } }
  finally { if (!disposed) busy.value = false }
}
onMounted(load)
onBeforeUnmount(() => { disposed = true; controller.abort() })
</script>

<template>
  <div class="image-practice-entry">
    <router-link class="text-button" to="/study">返回背词</router-link>
    <h1 class="section-title">把图里的单词，说出来</h1>
    <p class="section-sub">沿用这张记忆图，和 AI 聊三轮，练习这个词的同一种用法。</p>
    <section class="card">
      <LoadingState v-if="loading" skeleton>正在准备看图练习…</LoadingState>
      <template v-else-if="image">
        <PracticeImage :image="image" />
        <p>AI 会安排一个简短情境。你可以打字，也可以用语音回答；三轮后查看表达小结。</p>
        <label class="image-level">练习难度<select v-model="difficulty" :disabled="busy"><option value="beginner">入门 · 简单短句</option><option value="intermediate">进阶 · 日常交流</option><option value="advanced">挑战 · 解释与讨论</option></select></label>
        <button type="button" class="btn btn-primary" :disabled="busy" :aria-busy="busy" @click="start">{{ busy ? '正在准备角色和开场…' : '开始三轮对话' }}</button>
        <p class="muted">使用已有图片，不重新生图。首次准备情境和后续回复会使用文字 AI 额度。</p>
      </template>
      <div v-if="error" role="alert" class="image-practice-error"><p>{{ error }}</p><router-link v-if="errorCode === 'AI_NOT_CONFIGURED'" class="text-button" to="/settings">配置文字 AI</router-link><button v-else-if="!busy" type="button" class="text-button" @click="load">重新读取图片</button></div>
    </section>
  </div>
</template>

<style scoped>
.image-practice-entry { max-width:760px; margin:auto; }.section-title { margin-top:20px; }.image-level { display:flex; align-items:center; gap:12px; margin:24px 0; }.image-level select { max-width:100%; }.muted { font-size:12px; line-height:1.8; }.image-practice-error { color:var(--bad); margin-top:16px; }
</style>
