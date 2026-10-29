<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import MorphologyCard from '../components/MorphologyCard.vue'

import FavoriteWord from '../components/FavoriteWord.vue'
const app = useAppStore()
const router = useRouter()
const tab = ref('wrong')
const selected = ref([])
const starting = ref(false)
const message = ref('')
const loading = ref(true)
const loadError = ref('')

const review = computed(() => app.todayReview)
const wrongWords = computed(() => review.value?.wrongWords || [])
watch(tab, () => { selected.value = []; message.value = '' })
const articles = computed(() => review.value?.articles || [])
const allSelected = computed(() => wrongWords.value.length > 0 && selected.value.length === wrongWords.value.length)

onMounted(loadReview)

async function loadReview() {
  loading.value = true
  loadError.value = ''
  app.clearError()
  try {
    await app.loadTodayReview()
    selected.value = wrongWords.value.map(item => item.wordId)
  } catch (error) {
    loadError.value = error.message || '暂时无法加载今日回顾，请稍后重试。'
  } finally {
    loading.value = false
  }
}

function toggle(wordId) {
  selected.value = selected.value.includes(wordId)
    ? selected.value.filter(id => id !== wordId)
    : [...selected.value, wordId]
}

function toggleAll() {
  selected.value = allSelected.value ? [] : wrongWords.value.map(item => item.wordId)
}

async function practiceWrongWords() {
  if (!selected.value.length || starting.value) return
  starting.value = true
  message.value = ''
  try {
    await app.startReviewSession(selected.value)
    router.push('/study')
  } catch (error) {
    message.value = error.message || '暂时无法开始重练，请稍后再试。'
  } finally {
    starting.value = false
  }
}

function openArticle(id) {
  router.push({ name: 'article', query: { id: String(id) } })
}

function generateArticleForToday() {
  const ids = selected.value
  if (!ids.length) return
  router.push({ name: 'article', query: ids.length ? { words: ids.join(',') } : {} })
}
</script>

<template>
  <div class="review-page">
    <header class="page-heading">
      <div>
        <p class="page-eyebrow">REFLECT &amp; REMEMBER</p>
        <h1 class="section-title">今日回顾</h1>
        <p class="section-sub">
          <template v-if="review">{{ review.date }} · 今天完成 {{ review.answered }} 次作答，{{ review.wrongCount }} 次需要再巩固</template>
          <template v-else>让学过的词，再熟悉一点。</template>
        </p>
      </div>
      <router-link class="back-link" to="/study">继续背词 <span aria-hidden="true">↗</span></router-link>
    </header>

    <div v-if="loadError" class="card load-error" role="alert">
      <div><p class="load-error-title">今日回顾暂时没有加载完成</p><p>{{ loadError }}</p></div>
      <button class="btn btn-ghost" :disabled="loading" @click="loadReview">{{ loading ? '加载中…' : '重新加载' }}</button>
    </div>

    <div class="tabs" role="group" aria-label="回顾内容">
      <button class="tab" :class="{ active: tab === 'wrong' }" :aria-pressed="tab === 'wrong'" @click="tab = 'wrong'">
        今日错词 <span v-if="wrongWords.length" class="tab-count">{{ wrongWords.length }}</span>
      </button>
      <button class="tab" :class="{ active: tab === 'articles' }" :aria-pressed="tab === 'articles'" @click="tab = 'articles'">
        短文回顾 <span v-if="articles.length" class="tab-count">{{ articles.length }}</span>
      </button>
    </div>

    <div v-if="loading && !review" class="card loading-card" role="status"><span class="loading-mark" aria-hidden="true"></span><p class="muted">正在整理今天的学习记录…</p></div>

    <template v-else-if="review">
      <template v-if="tab !== 'articles'">
        <div v-if="!wrongWords.length" class="card empty-card">
          <span class="empty-icon" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="20" cy="20" r="14" /><path d="m13 20 5 5 10-11" /></svg></span>
          <p class="empty-title">今天还没有错词</p>
          <p class="empty-sub">在背词或错词列表点击收藏，即可加入单词本。</p>
          <button class="btn btn-primary" @click="router.push('/study')">去背单词 <span aria-hidden="true">→</span></button>
        </div>

        <template v-else>
          <div class="card review-content">
            <div class="actions-row">
              <label class="check-all"><input type="checkbox" :checked="allSelected" @change="toggleAll" /> 全选 <span>{{ selected.length }} / {{ wrongWords.length }}</span></label>
              <button class="btn btn-primary" :disabled="!selected.length || starting" @click="practiceWrongWords">{{ starting ? '准备中…' : '再练一遍（' + selected.length + '）' }} <span aria-hidden="true">→</span></button>
            </div>
            <p class="actions-hint">只重练选中的词，不占用今日新词额度；结果会更新复习计划。</p>
            <p v-if="message" class="msg error" role="alert">{{ message }}</p>

            <div class="wrong-list">
              <div v-for="item in wrongWords" :key="item.wordId" class="wrong-item" :class="{ picked: selected.includes(item.wordId) }" @click="!$event.target.closest('details, a, button, input') && toggle(item.wordId)">
                <input type="checkbox" class="item-check" :checked="selected.includes(item.wordId)" :aria-label="'选择 ' + item.spelling" @click.stop @change="toggle(item.wordId)" />
                <div class="item-body">
                  <div class="item-head">
                    <span class="item-word">{{ item.spelling }}</span>
                    <span v-if="item.phonetic" class="item-phonetic">{{ item.phonetic }}</span>
                    <span v-if="item.pos" class="item-pos">{{ item.pos }}</span>
                    <FavoriteWord :key="item.wordId" :word-id="item.wordId" /><span v-if="item.wrongTimes" class="item-wrong">错 {{ item.wrongTimes }} 次</span>
                  </div>
                  <p class="item-def"><b>{{ item.definitions[0] }}</b><template v-if="item.definitions.length > 1">；{{ item.definitions.slice(1).join('；') }}</template></p>
                  <p v-if="item.example" class="item-example">{{ item.example }}</p>
                  <MorphologyCard :word="item.spelling" />
                  <div v-if="item.errorTypes.length" class="item-tags"><span v-for="type in item.errorTypes" :key="type" class="err-tag">{{ type }}</span></div>
                </div>
              </div>
            </div>

            <div class="article-action"><div><p>把错词放回语境</p><span>勾选想练习的单词，再生成短文或情景。</span></div><button class="btn btn-ghost" :disabled="!selected.length" @click="generateArticleForToday">生成巩固短文 <span aria-hidden="true">↗</span></button><button class="btn btn-ghost" :disabled="!selected.length || selected.length > 5" @click="router.push({ name: 'practice', query: { words: selected.join(',') } })">用所选词练对话（最多 5 个）</button></div>
          </div>
        </template>
      </template>

      <template v-else>
        <div v-if="!articles.length" class="card empty-card">
          <span class="empty-icon" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M20 11c-5-4-11-4-16-2v23c6-2 11-1 16 3 5-4 10-5 16-3V9c-5-2-11-2-16 2Zm0 0v24" /></svg></span>
          <p class="empty-title">写下第一篇学习短文</p>
          <p class="empty-sub">背完一组词后，生成一篇含目标词的短文，让单词在语境里留下印象。</p>
          <button class="btn btn-primary" @click="router.push('/article')">去生成一篇 <span aria-hidden="true">→</span></button>
        </div>

        <div v-else class="card list-card">
          <div class="list-heading"><h2>今天的阅读</h2><span>{{ articles.length }} 篇短文</span></div>
          <button v-for="item in articles" :key="item.id" type="button" class="article-item" @click="openArticle(item.id)">
            <span class="article-main">
              <span class="article-title">{{ item.title || '（无标题）' }}</span>
              <span class="article-meta">{{ item.topic || '未指定话题' }} · 难度 {{ item.difficulty }} <template v-if="item.targetWords.length">· {{ item.targetWords.length }} 个目标词</template></span>
            </span>
            <span class="article-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
        <p v-if="articles.length" class="foot-hint">重新阅读，也可以再做一组理解题。</p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.back-link { flex: none; font-size: 12px; color: var(--ink-soft); padding: 8px 0; }
.back-link span { margin-left: 10px; color: var(--accent-deep); }
.tabs { display: inline-flex; gap: 4px; padding: 5px; margin-bottom: 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--color-surface); }
.tab { min-width: 135px; min-height: 40px; border: 1px solid transparent; background: transparent; border-radius: 8px; padding: 9px 18px; font-size: 12px; color: var(--ink-soft); display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.tab:hover { color: var(--ink); }
.tab.active { background: var(--accent-soft); color: var(--accent-deep); border-color: var(--line); }
.tab-count { font-size: 10px; color: var(--accent-deep); border-radius: 5px; padding: 0 6px; background: var(--accent-soft); }
.load-error { margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-color: var(--bad-soft); }
.load-error-title { margin: 0 0 5px; font-size: 14px; }
.load-error p:last-child { margin: 0; color: var(--bad); font-size: 12px; }
.load-error .btn { flex: none; font-size: 12px; }
.loading-card { display: flex; align-items: center; gap: 14px; min-height: 170px; justify-content: center; }
.loading-mark { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 6px var(--accent-soft); }
.empty-card { text-align: center; padding: 52px 26px; }
.empty-icon { display: grid; place-items: center; width: 60px; height: 60px; margin: 0 auto 22px; border: 1px solid var(--line); border-radius: 18px; background: var(--accent-soft); color: var(--accent-deep); }
.empty-icon svg { width: 34px; height: 34px; }
.empty-title { font-size: 21px; font-weight: 500; margin: 0 0 9px; }
.empty-sub { color: var(--ink-soft); font-size: 12px; max-width: 40ch; margin: 0 auto 26px; line-height: 1.9; }
.empty-card .btn { font-size: 13px; }
.actions-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.actions-row > .btn { font-size: 12px; }
.check-all { display: flex; align-items: center; gap: 9px; font-size: 12px; color: var(--ink-soft); cursor: pointer; }
.check-all input { width: 15px; height: 15px; margin: 0; }
.check-all > span { color: var(--ink-muted); font-size: 11px; margin-left: 5px; }
.actions-hint { margin: 13px 0 23px; font-size: 11px; color: var(--ink-muted); }
.wrong-list { border-top: 1px solid var(--line); }
.wrong-item { display: flex; gap: 15px; padding: 24px 12px; margin: 0 -12px; cursor: pointer; border-bottom: 1px solid var(--line); border-radius: 7px; }
.wrong-item.picked { background: color-mix(in srgb, var(--accent-soft) 35%, transparent); }
.item-check { flex: none; margin: 7px 0 0; width: 16px; height: 16px; }
.item-body { flex: 1; min-width: 0; }
.item-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.item-word { font-family: var(--serif); font-size: 23px; font-weight: 500; }
.item-phonetic, .item-pos { font-size: 11px; color: var(--ink-muted); }
.item-wrong { margin-left: auto; font-size: 10px; color: var(--bad); background: var(--bad-soft); border-radius: 6px; padding: 2px 8px; }
.item-def { margin: 7px 0 0; font-size: 13px; line-height: 1.8; color: var(--ink-soft); }
.item-def b { color: var(--ink); font-weight: 400; }
.item-example { margin: 8px 0 0; font-family: var(--serif); font-size: 14px; color: var(--ink-muted); }
.item-body :deep(.morphology) { margin: 12px 0; padding: 10px 13px; border-radius: 9px; background: var(--color-surface); }
.item-body :deep(.morphology > summary) { font-size: 11px; font-weight: 400; color: var(--ink-soft); }
.item-body :deep(.morphology > summary > span) { font-size: 10px; color: var(--ink-muted); }
.item-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.err-tag { font-size: 10px; color: var(--hint-ink); background: var(--hint-bg); border-radius: 5px; padding: 2px 8px; }
.article-action { display: flex; gap: 18px; justify-content: space-between; align-items: center; padding-top: 24px; }
.article-action p { font-size: 13px; margin: 0 0 4px; }
.article-action > div > span { color: var(--ink-muted); font-size: 11px; }
.article-action .btn { flex: none; font-size: 12px; }
.list-card { padding-top: 24px; padding-bottom: 9px; }
.list-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.list-heading h2 { margin: 0; font-size: 13px; font-weight: 500; }
.list-heading > span { font-size: 11px; color: var(--ink-muted); }
.article-item { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 23px 0; border: 0; border-bottom: 1px solid var(--line); text-align: left; background: transparent; line-height: 1.6; }
.article-item:last-child { border-bottom: 0; }
.article-item:hover .article-arrow { color: var(--accent); transform: translate(2px, -2px); }
.article-item:hover .article-title { color: var(--accent-deep); }
.article-main { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.article-title { font-family: var(--serif); font-size: 19px; font-weight: 500; }
.article-meta { font-size: 11px; color: var(--ink-muted); }
.article-arrow { color: var(--ink-soft); transition: color .15s, transform .15s; font-size: 19px; }
.foot-hint { text-align: center; font-size: 11px; color: var(--ink-muted); margin-top: 20px; }
.msg.error { margin: 12px 0 20px; padding: 10px 14px; font-size: 12px; color: var(--bad); background: var(--bad-soft); border-radius: var(--radius-sm); }
@media (max-width: 560px) {
  .tabs { display: flex; width: 100%; }
  .tab { min-width: 0; flex: 1; }
  .load-error { align-items: flex-start; flex-direction: column; }
  .actions-row > .btn { padding: 10px 13px; }
  .wrong-item { padding-top: 21px; padding-bottom: 21px; gap: 11px; }
  .item-word { font-size: 21px; }
  .item-wrong { margin-left: 0; }
  .item-body :deep(.morphology > summary > span) { display: none; }
  .article-action { align-items: flex-start; flex-direction: column; gap: 15px; }
  .article-title { font-size: 17px; }
  .empty-card { padding: 40px 22px; }
}
</style>
