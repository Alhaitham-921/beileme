<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { words } from '../api'
import AppIcon from '../components/AppIcon.vue'

const input = ref('')
const searched = ref('')
const result = ref(null)
const loading = ref('')
const error = ref(null)
let activeRequest

async function lookup(term, useAi = false) {
  const value = term.trim()
  if (!value) return
  activeRequest?.abort()
  const request = new AbortController()
  activeRequest = request
  loading.value = useAi ? 'ai' : 'wordbook'
  error.value = null
  if (!useAi) {
    input.value = value
    searched.value = value
    result.value = null
  }
  try {
    const data = await (useAi ? words.lookupAi(value, request.signal) : words.lookup(value, request.signal))
    if (!request.signal.aborted) result.value = data
  } catch (cause) {
    if (!request.signal.aborted) {
      error.value = {
        code: cause.code,
        message: cause.code === 'VALIDATION_FAILED' ? '请输入英文单词、短语或中文释义（最多 64 字）。' : cause.message,
      }
    }
  } finally {
    if (activeRequest === request) loading.value = ''
  }
}

onBeforeUnmount(() => activeRequest?.abort())
</script>

<template>
  <section class="lookup-page" aria-labelledby="lookup-title">
    <h1 id="lookup-title" class="section-title">查词</h1>
    <p class="section-sub">输入英文单词、短语或中文释义。</p>

    <form class="lookup-form" role="search" aria-label="查词" @submit.prevent="lookup(input)">
      <label class="lookup-input">
        <AppIcon name="search" />
        <input v-model="input" type="search" aria-label="单词、短语或中文释义" placeholder="例如 absorb 或 吸收"
          maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search">
      </label>
      <button type="submit" class="btn btn-primary" :disabled="!input.trim() || (loading === 'wordbook' && input.trim() === searched)">查词</button>
    </form>

    <p v-if="loading === 'wordbook'" class="lookup-status muted" role="status">正在查找「{{ searched }}」…</p>
    <p v-if="error" class="lookup-status lookup-error" role="alert">
      {{ error.message }}
      <router-link v-if="error.code === 'WORD_LOOKUP_AI_UNAVAILABLE'" to="/settings" class="text-button">打开偏好设置</router-link>
    </p>
    <template v-if="result">
      <template v-if="result.entries.length">
        <p class="lookup-status muted" role="status">{{ result.source === 'wordbook' ? '词库结果' : 'AI 补查结果' }} · {{ searched }}</p>
        <article v-for="entry in result.entries" :key="entry.id || entry.spelling" class="card lookup-entry">
          <header class="entry-heading">
            <h2 lang="en">{{ entry.spelling }}</h2>
            <span v-if="entry.phonetic" class="muted">{{ entry.phonetic }}</span>
          </header>
          <p v-if="entry.pos" class="entry-pos muted">{{ entry.pos }}</p>
          <ol class="entry-definitions">
            <li v-for="definition in entry.definitions" :key="definition">{{ definition }}</li>
          </ol>
          <div v-if="entry.example" class="entry-example">
            <p lang="en">{{ entry.example }}</p>
            <p v-if="entry.translation" class="muted">{{ entry.translation }}</p>
          </div>
        </article>
      </template>
      <div v-else class="card lookup-empty">
        <h2>{{ result.source === 'ai' ? 'AI 未找到可靠释义' : '词库未收录「' + searched + '」' }}</h2>
        <div v-if="result.suggestions.length" class="suggestions">
          <span class="muted">词库中的相近拼写</span>
          <button v-for="word in result.suggestions" :key="word" type="button" class="btn btn-quiet" lang="en"
            @click="lookup(word)">{{ word }}</button>
        </div>
        <template v-if="result.source === 'missing'">
          <button type="button" class="btn btn-secondary" :disabled="loading === 'ai'" @click="lookup(searched, true)">
            {{ loading === 'ai' ? '正在补查…' : '用 AI 补查' }}
          </button>
          <p class="muted" role="status">{{ loading === 'ai' ? '正在向 AI 查询「' + searched + '」…' : 'AI 补查可能消耗文字 AI 额度。' }}</p>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.lookup-page { max-width: 660px; margin-inline: auto; padding-bottom: 24px; }
.lookup-form { display: flex; align-items: stretch; gap: 8px; margin: 20px 0 16px; }
.lookup-form > button { min-height: 48px; flex: none; }
.lookup-input { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; padding: 0 12px; background: var(--bg-card); border: 1px solid var(--line); border-radius: 10px; color: var(--ink-soft); }
.lookup-input:focus-within { border-color: var(--accent); }
.lookup-input svg { flex: none; }
.lookup-input input { width: 100%; min-height: 46px; padding: 0; font-size: 16px; border: 0; background: transparent; }
.lookup-input input:focus-visible { outline-offset: -1px; }
.lookup-status { margin: 12px 0; overflow-wrap: anywhere; }
.lookup-error { color: var(--bad); }
.lookup-error a { margin-left: 6px; }
.lookup-entry, .lookup-empty { margin-top: 10px; overflow-wrap: anywhere; }
.entry-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.entry-heading h2 { margin: 0; font: 500 clamp(25px, 7vw, 38px)/1.2 var(--serif); }
.entry-pos { margin: 6px 0 0; }
.entry-definitions { padding-left: 1.45em; margin: 10px 0 0; }
.entry-definitions li + li { margin-top: 4px; }
.entry-example { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 10px; }
.entry-example p { margin: 0; }
.entry-example p + p { margin-top: 4px; }
.lookup-empty h2 { margin: 0 0 12px; font-size: 18px; }
.lookup-empty p { margin: 8px 0 0; font-size: 12px; }
.suggestions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-bottom: 14px; }
.suggestions .btn { min-height: 40px; }
</style>
