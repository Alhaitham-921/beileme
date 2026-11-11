<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { words, study } from '../api'
import { useAppStore } from '../stores/app'
import { toggleCollectionIds, allCollectionIdsSelected } from '../utils/collectionSelection.js'
import FavoriteWord from '../components/FavoriteWord.vue'
import WordMemoryImage from '../components/WordMemoryImage.vue'
const route = useRoute(), router = useRouter(), app = useAppStore()
const books = ref([]), bookId = ref(0), items = ref([]), name = ref(''), search = ref('')
const source = ref(route.query.source === 'mistakes' ? 'mistakes' : 'favorites')
const loading = ref(true), creating = ref(false), error = ref(''), mask = ref('none'), revealed = ref(new Set())
const selected = ref(new Set()), matchingIds = ref([]), selectingAll = ref(false), starting = ref(false)
const openMemoryWord = ref(null)
const page = ref(1), total = ref(0), totalPages = ref(0), wrongCount = ref(0), savedCount = ref(0), previousBatch = ref(null)
const currentBook = computed(() => books.value.find(book => Number(book.id) === bookId.value))
const title = computed(() => source.value === 'mistakes' ? '错题本' : source.value === 'favorites' ? '全部单词本' : currentBook.value?.name || '单词本')
const allSelected = computed(() => allCollectionIdsSelected(selected.value, matchingIds.value))
const partlySelected = computed(() => !allSelected.value && matchingIds.value.some(id => selected.value.has(id)))
let version = 0, timer, alive = true
function query() { return {source:source.value, notebookId:bookId.value, q:search.value.trim()} }
async function loadList(reset = true) {
  if (reset) page.value = 1
  const token = ++version, options = query()
  loading.value = true; error.value = ''; revealed.value = new Set()
  openMemoryWord.value = null
  if (reset) { items.value = []; matchingIds.value = [] }
  try {
    const [content, ids] = await Promise.all([
      words.collection({...options,page:page.value,size:50}),
      reset ? words.collectionIds(options) : null,
    ])
    if (token !== version || !alive) return
    items.value = content.items; total.value = content.total; totalPages.value = content.totalPages
    if (ids) matchingIds.value = ids.wordIds
  } catch (e) { if (token === version) error.value = e.message }
  finally { if (token === version) loading.value = false }
}
async function loadOverview() {
  const [list, wrong, saved, active] = await Promise.all([
    words.notebooks(), words.collection({source:'mistakes',size:1}), words.collection({source:'favorites',size:1}), study.activeCollectionReview(),
  ])
  if (!alive) return
  books.value = list.items; wrongCount.value = wrong.total; savedCount.value = saved.total; previousBatch.value = active.batch
}
async function refresh() {
  try { await loadOverview(); await loadList() }
  catch (e) { error.value = e.message; loading.value = false }
}
function selectSource(value, id = 0) {
  clearTimeout(timer); version++; source.value = value; bookId.value = Number(id); search.value = ''
  void loadList()
}
watch(search, () => { clearTimeout(timer); version++; loading.value = true; timer = setTimeout(() => void loadList(),250) })
async function create() {
  if (!name.value.trim() || creating.value) return
  creating.value = true; error.value = ''
  try { const {notebook} = await words.createNotebook(name.value.trim()); name.value = ''; await loadOverview(); selectSource('notebook',notebook.id) }
  catch (e) { error.value = e.message }
  finally { creating.value = false }
}
function toggle(id, checked) { selected.value = toggleCollectionIds(selected.value,[id],checked) }
function toggleAll(checked) { selected.value = toggleCollectionIds(selected.value,matchingIds.value,checked) }
async function selectEverything() {
  if (selectingAll.value) return
  selectingAll.value = true; error.value = ''
  try { const {wordIds} = await words.collectionIds({source:'all'}); if (alive) selected.value = toggleCollectionIds(selected.value,wordIds,true) }
  catch (e) { error.value = e.message }
  finally { selectingAll.value = false }
}
function practiceSelected() {
  if (selected.value.size < 1 || selected.value.size > 5) return
  router.push({ name: 'practice', query: { words: [...selected.value].join(',') } })
}
async function startReview(batchId = null) {
  if (starting.value || (!batchId && !selected.value.size)) return
  starting.value = true; error.value = ''
  try {
    if (batchId) await app.continueCollectionReview(batchId)
    else await app.startCollectionReview([...selected.value])
    await router.push('/study')
  } catch (e) { error.value = e.message }
  finally { starting.value = false }
}
async function changed() {
  try { await loadOverview(); await loadList() } catch (e) { error.value = e.message }
}
async function changePage(value) { if (loading.value || value<1 || value>totalPages.value) return; page.value=value; await loadList(false) }
function changeMask(value) { mask.value = value; revealed.value = new Set(); openMemoryWord.value = null }
function hidden(id, side) { return mask.value === side && !revealed.value.has(id) }
function reveal(id) { const next = new Set(revealed.value); next.has(id) ? next.delete(id) : next.add(id); revealed.value = next }
function date(value) { return value ? new Date(value).toLocaleDateString() : '' }
onMounted(refresh)
onUnmounted(() => { alive=false; version++; clearTimeout(timer) })
</script>
<template>
  <div class="notebooks-page">
    <header class="page-heading"><div><h1 class="section-title">单词本与错题本</h1><p class="section-sub">收藏词和历史错词，选好后一起复习。</p></div><router-link to="/study" class="text-button">去背单词</router-link></header>
    <section v-if="previousBatch" class="card resume-review" aria-label="继续上次选词复习">
      <p>上次所选 {{ previousBatch.totalCount }} 词，已完成 {{ previousBatch.completedCount }} 词。</p>
      <button class="btn btn-ghost" :disabled="starting" @click="startReview(previousBatch.id)">继续上次复习</button>
    </section>
    <div class="notebooks-layout">
      <aside class="card book-sidebar" aria-label="选择单词本或错题本">
        <button type="button" :class="['book-option',{active:source==='favorites'}]" :aria-pressed="source==='favorites'" @click="selectSource('favorites')"><span>全部单词本</span><small>{{savedCount}} 词</small></button>
        <button type="button" :class="['book-option','mistakes-option',{active:source==='mistakes'}]" :aria-pressed="source==='mistakes'" @click="selectSource('mistakes')"><span>错题本</span><small>{{wrongCount}} 词</small></button>
        <h2>我的单词本</h2>
        <button v-for="book in books" :key="book.id" type="button" :class="['book-option',{active:source==='notebook'&&bookId===Number(book.id)}]" :aria-pressed="source==='notebook'&&bookId===Number(book.id)" @click="selectSource('notebook',book.id)"><span>{{book.name}}</span><small>{{book.wordCount}} 词</small></button>
        <form class="new-book" @submit.prevent="create"><label for="new-notebook">新建单词本</label><input id="new-notebook" v-model="name" maxlength="40" placeholder="例如：旅行、易混词"><button class="btn btn-ghost" :disabled="creating||!name.trim()">{{creating?'创建中…':'＋ 新建'}}</button></form>
      </aside>
      <section class="card notebook-content" :aria-busy="loading">
        <div class="notebook-title"><h2>{{title}}</h2><span>共 {{total}} 个单词</span></div>
        <p v-if="source==='mistakes'" class="list-hint">收录所有曾答错的单词，答对后仍保留，方便随时回顾。</p>
        <router-link v-if="source==='mistakes'" to="/recall" class="btn btn-primary">错词专项与隔天复测</router-link>
        <p v-if="error" class="book-error" role="alert">{{error}} <button type="button" class="text-button" @click="refresh">重试</button></p>
        <div class="list-controls"><label class="search-label">查找单词<input v-model="search" type="search" maxlength="100" placeholder="搜索英文或中文"></label><fieldset><legend>回顾模式</legend><button v-for="option in [{value:'none',label:'中英对照'},{value:'zh',label:'遮住中文'},{value:'en',label:'遮住英文'}]" :key="option.value" type="button" :class="{chosen:mask===option.value}" :aria-pressed="mask===option.value" @click="changeMask(option.value)">{{option.label}}</button></fieldset></div>
        <div class="selection-tools" aria-label="批量选择复习词">
          <label class="select-all"><input type="checkbox" :checked="allSelected" :indeterminate="partlySelected" :disabled="loading||!matchingIds.length||selectingAll" @change="toggleAll($event.target.checked)">全选当前列表<span v-if="search.trim()">的搜索结果</span></label>
          <button class="text-button" :disabled="selectingAll||starting" @click="selectEverything">{{selectingAll?'正在选择…':'全选全部收藏与错词'}}</button>
          <span class="selected-count" role="status">已选 {{selected.size}} 词（去重）</span>
          <button class="text-button" :disabled="!selected.size||selectingAll||starting" @click="selected=new Set()">清空选择</button>
          <button class="btn btn-primary start-review" :disabled="!selected.size||starting||selectingAll" @click="startReview()">{{starting?'准备中…':'复习所选（'+selected.size+'）'}}</button>
        </div>
        <div v-if="source==='mistakes'" class="selection-tools">
          <button class="btn btn-secondary" :disabled="!selected.size||selected.size>5||starting||selectingAll" @click="practiceSelected">用这些词练情境</button>
          <span class="list-hint">选择 1–5 个词，带入自定义情境。</span>
        </div>
        <p class="list-hint">切换单词本、错题本或翻页会保留选择；全选包含当前列表所有页，每组复习十词，可继续下一组。</p>
        <p v-if="mask!=='none'" class="list-hint">先回想，再点击遮罩查看答案。</p>
        <p v-if="loading" role="status" class="empty-book">正在打开单词列表…</p>
        <div v-else-if="!items.length&&!error" class="empty-book"><h3>{{search?'没有找到匹配单词':source==='mistakes'?'还没有历史错词':'这里还没有收藏词'}}</h3><p>{{source==='mistakes'?'之后答错的单词会自动收进来。':'在背词或错词旁点击收藏，即可收进单词本。'}}</p></div>
        <div v-else-if="items.length" class="word-table-wrap">
          <table class="word-table"><thead><tr><th scope="col">选择</th><th scope="col">英文</th><th scope="col">中文释义</th><th scope="col">收藏管理</th></tr></thead><tbody>
            <template v-for="word in items" :key="word.id">
            <tr :class="{picked:selected.has(word.id)}">
              <td class="check-cell"><input type="checkbox" :checked="selected.has(word.id)" :aria-label="'选择 '+word.spelling" :disabled="selectingAll||starting" @change="toggle(word.id,$event.target.checked)"></td>
              <td class="english-cell"><button v-if="mask==='en'" type="button" :class="['answer',{covered:hidden(word.id,'en')}]" :aria-label="hidden(word.id,'en')?'查看英文答案':'重新遮住英文答案'" @click="reveal(word.id)">{{hidden(word.id,'en')?'点击查看英文':word.spelling}}</button><template v-else><strong class="spelling">{{word.spelling}}</strong><small v-if="word.phonetic" class="phonetic">{{word.phonetic}}</small></template><small v-if="source==='mistakes'" class="wrong-meta">累计错 {{word.wrongTimes}} 次<span v-if="word.lastWrongAt"> · 最近 {{date(word.lastWrongAt)}}</span></small></td>
              <td class="meaning-cell"><button v-if="mask==='zh'" type="button" :class="['answer',{covered:hidden(word.id,'zh')}]" :aria-label="hidden(word.id,'zh')?'查看中文答案':'重新遮住中文答案'" @click="reveal(word.id)">{{hidden(word.id,'zh')?'点击查看中文':word.definitions.join('；')}}</button><span v-else>{{word.definitions.join('；')}}</span></td>
              <td class="favorite-cell">
                <FavoriteWord :word-id="word.id" :initial-saved="word.saved" @change="changed" />
                <button v-if="source==='mistakes' && !hidden(word.id,mask)" type="button" class="text-button"
                  :aria-expanded="openMemoryWord===word.id" @click="openMemoryWord=openMemoryWord===word.id ? null : word.id">
                  {{ openMemoryWord===word.id ? '收起记忆图' : '查看记忆图' }}
                </button>
              </td>
            </tr>
            <tr v-if="source==='mistakes' && openMemoryWord===word.id && !hidden(word.id,mask)" class="memory-row">
              <td colspan="4"><WordMemoryImage :word="word" can-generate /></td>
            </tr>
            </template>
          </tbody></table>
        </div>
        <nav v-if="totalPages>1" class="pagination" aria-label="单词列表翻页"><button class="btn btn-ghost" :disabled="loading||page===1" @click="changePage(page-1)">上一页</button><span>第 {{page}} / {{totalPages}} 页</span><button class="btn btn-ghost" :disabled="loading||page===totalPages" @click="changePage(page+1)">下一页</button></nav>
      </section>
    </div>
  </div>
</template>
<style scoped>
.notebooks-layout { display:grid;grid-template-columns:220px minmax(0,1fr);align-items:start;gap:22px; }
.book-sidebar { padding:20px 14px; }.book-sidebar h2 { font-size:13px;margin:22px 10px 10px;color:var(--ink-soft); }
.book-option { display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;padding:13px 10px;border:1px solid transparent;border-radius:8px;color:var(--ink);background:transparent;text-align:left; }.book-option span { overflow-wrap:anywhere; }.book-option small { flex-shrink:0;color:var(--ink-soft); }.book-option.active { border-color:var(--line);background:var(--accent-soft);color:var(--accent-deep); }.mistakes-option { margin-top:6px; }
.new-book { display:grid;gap:10px;margin:20px 6px 0;padding-top:18px;border-top:1px solid var(--line); }.new-book label { font-size:12px; }.new-book input { min-width:0;width:100%;font-size:12px; }.new-book .btn { font-size:12px; }
.notebook-content { min-width:0;padding:24px; }.notebook-title { display:flex;align-items:baseline;flex-wrap:wrap;gap:12px;margin-bottom:12px; }.notebook-title h2 { margin:0;font-size:23px;overflow-wrap:anywhere; }.notebook-title span { font-size:12px;color:var(--ink-soft); }
.list-controls { display:flex;gap:18px;flex-wrap:wrap;align-items:end;margin:18px 0; }.search-label { flex:1 1 180px;font-size:12px;display:grid;gap:6px; }.search-label input { width:100%;min-width:0; }.list-controls fieldset { border:0;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:4px; }.list-controls legend { font-size:12px;margin-bottom:8px; }.list-controls button { padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--ink-soft);font-size:12px; }.list-controls button.chosen { color:var(--accent-deep);background:var(--accent-soft); }
.selection-tools { display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line); }.select-all { display:flex;align-items:center;gap:8px;font-size:13px; }.selected-count { font-size:13px;color:var(--accent-deep); }.selection-tools .btn { font-size:13px; }.start-review { margin-left:auto; }.selection-tools input,.check-cell input { width:17px;height:17px;accent-color:var(--accent); }.list-hint { color:var(--ink-soft);font-size:12px;line-height:1.8; }
.word-table { width:100%;border-collapse:collapse;table-layout:fixed; }.word-table th { text-align:left;padding:12px 8px;font-size:12px;color:var(--ink-soft);font-weight:500;border-bottom:1px solid var(--line); }.word-table td { padding:17px 8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere;font-size:14px;line-height:1.8; }.word-table th:nth-child(1) { width:7%; }.word-table th:nth-child(2) { width:25%; }.word-table th:nth-child(3) { width:40%; }.word-table .picked { background:var(--accent-soft); }.spelling { font-family:var(--serif);font-size:21px;font-weight:500; }.phonetic,.wrong-meta { display:block;color:var(--ink-soft);font-size:11px; }.answer { width:100%;text-align:left;padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--ink);line-height:1.8;font-size:inherit; }.answer.covered { background:var(--accent-soft);color:var(--accent-deep);font-size:12px; }.empty-book { padding:36px 8px;color:var(--ink-soft);line-height:1.9;text-align:center;font-size:13px; }.empty-book h3 { color:var(--ink);font-size:19px; }.book-error { color:var(--bad);font-size:13px; }
.pagination,.resume-review { display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap; }.pagination { margin-top:20px;font-size:12px; }.pagination .btn { font-size:12px; }.resume-review { margin-bottom:20px;padding:16px 20px; }.resume-review p { margin:0;font-size:13px; }.resume-review .btn { font-size:12px; }
.new-book input,.search-label input { border:1px solid var(--line);border-radius:7px;padding:10px 12px;background:var(--bg-card);color:var(--ink);font:inherit;font-size:12px; }
.text-button { border:0;background:transparent;color:var(--accent-deep);font:inherit;font-size:12px;padding:7px 4px;cursor:pointer; }.text-button:disabled { opacity:.45;cursor:default; }
button { touch-action:manipulation; }
.memory-row td { grid-column: 1 / -1; }
@media(max-width:800px) { .notebooks-layout { grid-template-columns:1fr; }.book-sidebar { padding:14px; }.book-option { padding:10px; }.notebook-content { padding:16px; }.start-review { width:100%;margin-left:0; }.word-table,.word-table tbody { display:block; }.word-table thead { display:none; }.word-table tr { display:grid;grid-template-columns:30px minmax(0,1fr);padding:14px 0;border-bottom:1px solid var(--line); }.word-table td { display:block;border:0;padding:3px 6px; }.check-cell { grid-column:1;grid-row:1 / span 3; }.english-cell,.meaning-cell,.favorite-cell { grid-column:2; }.selection-tools { gap:12px 16px; } }
</style>
