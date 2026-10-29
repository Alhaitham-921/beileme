<script setup>
import { computed, onMounted, ref } from 'vue'
import { words } from '../api'
import FavoriteWord from '../components/FavoriteWord.vue'
const books = ref([]), bookId = ref(0), items = ref([]), name = ref(''), search = ref('')
const loading = ref(true), creating = ref(false), error = ref(''), mask = ref('none'), revealed = ref(new Set())
let version = 0
const currentBook = computed(() => books.value.find(book => book.id === bookId.value))
const visibleWords = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  return items.value.filter(word => !term || `${word.spelling} ${word.definitions.join(' ')}`.toLocaleLowerCase().includes(term))
})
async function loadBooks() { books.value = (await words.notebooks()).items }
async function selectBook(id) {
  bookId.value = id; items.value = []; revealed.value = new Set(); search.value = ''; error.value = ''; loading.value = true
  const token = ++version
  try { const data = await words.notebookWords(id); if (token === version) items.value = data.items }
  catch (e) { if (token === version) error.value = e.message }
  finally { if (token === version) loading.value = false }
}
async function refresh() {
  error.value = ''
  try { await loadBooks(); await selectBook(bookId.value) } catch (e) { error.value = e.message; loading.value = false }
}
async function create() {
  if (!name.value.trim() || creating.value) return
  creating.value = true; error.value = ''
  try { const { notebook } = await words.createNotebook(name.value.trim()); name.value = ''; await loadBooks(); await selectBook(notebook.id) }
  catch (e) { error.value = e.message }
  finally { creating.value = false }
}
async function changed() {
  const token = version, id = bookId.value
  try {
    const [list, content] = await Promise.all([words.notebooks(), words.notebookWords(id)])
    books.value = list.items
    if (token === version) items.value = content.items
  } catch (e) { error.value = e.message }
}
function changeMask(value) { mask.value = value; revealed.value = new Set() }
function hidden(id, side) { return mask.value === side && !revealed.value.has(id) }
function reveal(id) { const next = new Set(revealed.value); next.has(id) ? next.delete(id) : next.add(id); revealed.value = next }
onMounted(refresh)
</script>
<template>
  <div class="notebooks-page">
    <header class="page-heading"><div><h1 class="section-title">我的单词本</h1><p class="section-sub">按自己的方式收藏，把想记住的词放在一起。</p></div><router-link to="/study" class="text-button">去背单词</router-link></header>
    <div class="notebooks-layout">
      <aside class="card book-sidebar" aria-label="选择单词本">
        <h2>单词本 <span>{{ books.length }}</span></h2>
        <button v-for="book in books" :key="book.id" type="button" :class="['book-option', { active: bookId === book.id }]" :aria-pressed="bookId === book.id" @click="selectBook(book.id)"><span>{{ book.name }}</span><small>{{ book.wordCount }} 词</small></button>
        <form class="new-book" @submit.prevent="create"><label for="new-notebook">新建单词本</label><input id="new-notebook" v-model="name" maxlength="40" placeholder="例如：旅行、易混词、阅读摘词"><button class="btn btn-ghost" :disabled="creating || !name.trim()">{{ creating ? '创建中…' : '＋ 新建' }}</button></form>
      </aside>
      <section class="card notebook-content" :aria-busy="loading">
        <div class="notebook-title"><h2>{{ currentBook?.name || '单词列表' }}</h2><span>{{ items.length }} 个单词</span></div>
        <p v-if="error" class="book-error" role="alert">{{ error }} <button type="button" class="text-button" @click="refresh">重试</button></p>
        <div class="list-controls"><label class="search-label">查找单词<input v-model="search" type="search" placeholder="搜索英文或中文"></label><fieldset><legend>回顾模式</legend><button v-for="option in [{ value: 'none', label: '中英对照' }, { value: 'zh', label: '遮住中文' }, { value: 'en', label: '遮住英文' }]" :key="option.value" type="button" :class="{ chosen: mask === option.value }" :aria-pressed="mask === option.value" @click="changeMask(option.value)">{{ option.label }}</button></fieldset></div>
        <p v-if="mask !== 'none'" class="mask-hint">先回想，再点击遮罩查看答案；再次点击可遮回。切换回顾模式会重新遮住全部答案。</p>
        <p v-if="loading" role="status" class="empty-book">正在打开单词本…</p>
        <div v-else-if="!items.length && !error" class="empty-book"><h3>把想记住的词收进来</h3><p>在背词或错词列表点击收藏，或通过“选择单词本”收进「{{ currentBook?.name }}」。已有收藏仍在默认单词本中。</p><router-link class="btn btn-ghost" to="/study">去收藏单词</router-link></div>
        <p v-else-if="!visibleWords.length && !error" class="empty-book">没有找到匹配的单词。</p>
        <div v-else-if="visibleWords.length" class="word-table-wrap">
          <table class="word-table"><thead><tr><th scope="col">英文</th><th scope="col">中文释义</th><th scope="col">收藏管理</th></tr></thead><tbody>
            <tr v-for="word in visibleWords" :key="word.id">
              <td><button v-if="mask === 'en'" type="button" :class="['answer', { covered: hidden(word.id, 'en') }]" :aria-label="hidden(word.id, 'en') ? '查看英文答案' : '重新遮住英文答案'" @click="reveal(word.id)">{{ hidden(word.id, 'en') ? '点击查看英文' : word.spelling }}</button><template v-else><strong class="spelling">{{ word.spelling }}</strong><small v-if="word.phonetic" class="phonetic">{{ word.phonetic }}</small></template></td>
              <td><button v-if="mask === 'zh'" type="button" :class="['answer', { covered: hidden(word.id, 'zh') }]" :aria-label="hidden(word.id, 'zh') ? '查看中文答案' : '重新遮住中文答案'" @click="reveal(word.id)">{{ hidden(word.id, 'zh') ? '点击查看中文' : word.definitions.join('；') }}</button><span v-else>{{ word.definitions.join('；') }}</span></td>
              <td><FavoriteWord :word-id="word.id" :initial-saved="true" @change="changed" /></td>
            </tr>
          </tbody></table>
        </div>
      </section>
    </div>
  </div>
</template>
<style scoped>
.notebooks-layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); align-items: start; gap: 22px; }
.book-sidebar { padding: 20px 14px; }.book-sidebar h2 { font-size: 15px; margin: 0 10px 18px; }.book-sidebar h2 span { float: right; color: var(--ink-soft); font-size: 12px; }
.book-option { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 12px; padding: 13px 10px; border: 1px solid transparent; border-radius: 8px; color: var(--ink); background: transparent; text-align: left; }.book-option span { overflow-wrap: anywhere; }.book-option small { flex-shrink: 0; color: var(--ink-soft); }.book-option.active { border-color: var(--line); background: var(--accent-soft); color: var(--accent-deep); }
.new-book { display: grid; gap: 10px; margin: 20px 6px 0; padding-top: 18px; border-top: 1px solid var(--line); }.new-book label { font-size: 12px; }.new-book input { min-width: 0; width: 100%; font-size: 12px; }.new-book .btn { font-size: 12px; }
.notebook-content { min-width: 0; padding: 24px; }.notebook-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }.notebook-title h2 { margin: 0; font-size: 23px; overflow-wrap: anywhere; }.notebook-title span { font-size: 12px; color: var(--ink-soft); }
.list-controls { display: flex; gap: 18px; flex-wrap: wrap; align-items: end; margin-bottom: 20px; }.search-label { flex: 1 1 180px; font-size: 12px; display: grid; gap: 6px; }.search-label input { width: 100%; min-width: 0; }.list-controls fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 4px; }.list-controls legend { font-size: 12px; margin-bottom: 8px; }.list-controls button { padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--ink-soft); font-size: 12px; }.list-controls button.chosen { color: var(--accent-deep); background: var(--accent-soft); }
.mask-hint { color: var(--ink-soft); font-size: 12px; line-height: 1.8; }.word-table-wrap { overflow-x: auto; }.word-table { width: 100%; border-collapse: collapse; table-layout: fixed; }.word-table th { text-align: left; padding: 12px 8px; font-size: 12px; color: var(--ink-soft); font-weight: 500; border-bottom: 1px solid var(--line); }.word-table td { padding: 17px 8px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; font-size: 14px; line-height: 1.8; }.word-table th:nth-child(1) { width: 26%; }.word-table th:nth-child(2) { width: 40%; }.spelling { font-family: var(--serif); font-size: 21px; font-weight: 500; }.phonetic { display: block; color: var(--ink-soft); font-size: 11px; }.answer { width: 100%; text-align: left; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--ink); line-height: 1.8; font-size: inherit; }.answer.covered { background: var(--accent-soft); color: var(--accent-deep); font-size: 12px; }.empty-book { padding: 36px 8px; color: var(--ink-soft); line-height: 1.9; text-align: center; font-size: 13px; }.empty-book h3 { color: var(--ink); font-size: 19px; }.book-error { color: var(--bad); font-size: 13px; }
@media(max-width: 800px) { .notebooks-layout { grid-template-columns: 1fr; }.book-sidebar { padding: 14px; }.book-option { padding: 10px; }.notebook-content { padding: 16px; }.word-table { min-width: 560px; } }
.new-book input, .search-label input { border: 1px solid var(--line); border-radius: 7px; padding: 10px 12px; background: var(--bg-card); color: var(--ink); font: inherit; font-size: 12px; }
.new-book input:focus-visible, .search-label input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
