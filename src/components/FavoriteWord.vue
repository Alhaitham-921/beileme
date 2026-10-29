<script setup>
import { computed, ref, watch } from 'vue'
import { words } from '../api'
const emit = defineEmits(['change'])
const props = defineProps({ wordId: Number, initialSaved: { type: Boolean, default: undefined } })
const books = ref([]), busy = ref(false), error = ref(''), open = ref(false), name = ref('')
const loaded = ref(false)
const saved = computed(() => loaded.value ? books.value.some(book => book.containsWord) : Boolean(props.initialSaved))
let loadVersion = 0
async function load() {
  const version = ++loadVersion
  try { const data = await words.notebooks(props.wordId); if (version === loadVersion) { books.value = data.items; loaded.value = true } }
  catch (e) { if (version === loadVersion) error.value = e.message }
}
watch(() => props.wordId, () => { books.value = []; loaded.value = false; open.value = false; error.value = ''; if (props.initialSaved === undefined) void load() }, { immediate: true })
async function save(book, value) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    await (value ? words.favorite(props.wordId, book.id) : words.unfavorite(props.wordId, book.id))
    book.containsWord = value
    emit('change', saved.value)
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function quickSave() {
  if (saved.value) { open.value = !open.value; if (open.value) await load(); return }
  if (!books.value.length) await load()
  const book = books.value.find(b => b.id === 0)
  if (book) await save(book, true)
}
async function create() {
  if (!name.value.trim() || busy.value) return
  busy.value = true; error.value = ''
  try {
    const { notebook } = await words.createNotebook(name.value.trim())
    books.value.push(notebook); name.value = ''
    await words.favorite(props.wordId, notebook.id)
    notebook.containsWord = true; emit('change', true)
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
</script>
<template>
  <span class="favorite-word" @click.stop>
    <button type="button" class="btn btn-ghost" :disabled="busy" :aria-expanded="saved ? open : undefined" @click="quickSave">{{ saved ? '★ 已收藏 · 管理' : '☆ 收藏至默认本' }}</button>
    <button type="button" class="choose-book" :aria-expanded="open" :disabled="busy" @click="open = !open; open && load()">选择单词本</button>
    <span v-if="open" class="book-choices" @keydown.esc="open = false">
      <strong>收藏到单词本</strong><small>可同时收藏到多个本，取消勾选仅从该本移除。</small>
      <label v-for="book in books" :key="book.id"><input type="checkbox" :checked="book.containsWord" :disabled="busy" @change="save(book, $event.target.checked)">{{ book.name }}</label>
      <span class="create-book"><input v-model="name" aria-label="新单词本名称" maxlength="40" placeholder="新单词本名称" @keydown.enter.prevent="create"><button type="button" class="btn btn-ghost" :disabled="busy || !name.trim()" @click="create">新建并收藏</button></span>
      <button type="button" class="choose-book" @click="open = false">收起</button>
    </span>
    <small v-if="error" role="alert" class="favorite-error">{{ error }}</small>
  </span>
</template>
<style scoped>
.favorite-word { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; max-width: 100%; }
.choose-book { border: 0; background: transparent; color: var(--accent-deep); font-size: 12px; padding: 6px; cursor: pointer; }
.book-choices { display: flex; flex-direction: column; gap: 10px; flex-basis: 100%; padding: 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-card); font-size: 13px; }
.book-choices small { color: var(--ink-soft); }
.book-choices label { display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
.book-choices input[type=checkbox] { width: 16px; height: 16px; margin: 0; }
.create-book { display: flex; flex-wrap: wrap; gap: 6px; }.create-book input { flex: 1 1 120px; min-width: 0; width: 100%; }
.favorite-error { flex-basis: 100%; color: var(--bad); }
.create-book input { padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg-card); color: var(--ink); font: inherit; }
</style>
