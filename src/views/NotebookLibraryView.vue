<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { words } from '../api/index.js'
import NotebookCreateDialog from '../components/NotebookCreateDialog.vue'
import NotebooksView from './NotebooksView.vue'
const route = useRoute(), router = useRouter(), books = ref([]), wrongCount = ref(0), totalCount = ref(0)
const creating = ref(false), loading = ref(true), error = ref('')
const selection = ref([])
const opened = computed(() => Object.hasOwn(route.query,'book') || ['mistakes','favorites'].includes(route.query.source))
const source = computed(() => route.query.source === 'mistakes' ? 'mistakes' : route.query.source === 'favorites' ? 'favorites' : 'notebook')
const bookId = computed(() => Number(route.query.book || 0))
const covers = ['slate','olive','plum','blue']
async function load() {
  loading.value = true; error.value = ''
  try { const [list, wrong, all] = await Promise.all([words.notebooks(),words.collection({source:'mistakes',size:1}),words.collection({source:'favorites',size:1})]); books.value=list.items; wrongCount.value=wrong.total; totalCount.value=all.total }
  catch(e) {error.value=e.message} finally {loading.value=false}
}
function open(book) { router.push({path:'/notebooks',query:{book:book.id}}) }
async function created(book) { await load(); open(book) }
onMounted(load)
</script>
<template>
  <NotebooksView v-if="opened" :key="`${source}:${bookId}`" embedded :initial-source="source" :initial-book-id="bookId" :initial-selection="selection" @selection-change="selection=$event" @books-changed="load" />
  <div v-else class="notebook-library">
    <header class="library-heading"><div><h1 class="section-title">我的单词书</h1><p class="section-sub">翻开一本书，遇见想记住的词。</p></div><details class="library-menu"><summary aria-label="书架菜单"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></summary><div><button @click="router.push({path:'/notebooks',query:{source:'favorites'}})">查看全部收藏词</button><button @click="creating=true">新建单词书</button></div></details></header>
    <p v-if="error" class="library-error" role="alert">{{ error }} <button class="text-button" @click="load">重试</button></p>
    <p v-if="loading" class="library-loading"><LoadingState>正在整理你的书架…</LoadingState></p>
    <template v-else>
      <div class="shelf-caption"><span>{{ books.length + 1 }} 本单词书</span><span>共收藏 {{ totalCount }} 个词</span></div>
      <section class="book-shelf" aria-label="我的单词书书架">
        <button v-for="(book,index) in books" :key="book.id" class="book-card" :aria-label="`打开${book.name}，${book.wordCount}个词`" @click="open(book)"><div :class="['book-cover',covers[index % covers.length]]"><span class="cover-label">{{ book.isDefault ? '随手收藏，慢慢记住' : '我的专属词集' }}</span><strong>{{ book.name }}</strong><span class="cover-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M7 8c5-2 8-1 11 1 3-2 6-3 11-1v21c-5-2-8-1-11 1-3-2-6-3-11-1zM18 9v21" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></span></div><span class="book-caption"><span>{{ book.name }}</span><small>{{ book.wordCount }} 词</small></span></button>
        <button class="book-card mistake-card" :aria-label="`打开错题本，${wrongCount}个词`" @click="router.push({path:'/notebooks',query:{source:'mistakes'}})"><div class="book-cover mistakes"><span class="cover-label">再遇见，就多记住一点</span><strong>错题本</strong><span class="cover-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M10 8h16v23H10zM14 5h8v6h-8zM14 17h8m-8 5h8" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></span></div><span class="book-caption"><span>错题本</span><small>{{ wrongCount }} 词</small></span></button>
        <button class="new-book-card" @click="creating=true" aria-label="新建单词书"><span class="new-book-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="10" y="7" width="28" height="35" rx="3" stroke="currentColor" stroke-width="1.4"/><path d="M16 7v35m10-24v12m-6-6h12" stroke="currentColor" stroke-width="1.4"/></svg></span><strong>新建单词书</strong><span>为一组词，留一本书</span></button>
      </section>
      <p class="shelf-note">点击书封查看单词。在书内菜单中开启批量编辑。</p>
    </template>
    <NotebookCreateDialog v-if="creating" @close="creating=false" @created="created" />
  </div>
</template>
<style scoped>
.library-heading{display:flex;align-items:center;justify-content:space-between;gap:20px}.library-heading h1{margin-top:0}.library-menu{position:relative;align-self:flex-start;margin-top:8px;z-index:5}.library-menu summary{list-style:none;cursor:pointer;display:grid;place-items:center;width:42px;height:42px;border:1px solid var(--line);border-radius:50%;background:var(--color-surface)}summary::-webkit-details-marker{display:none}.library-menu svg{width:21px;height:21px;fill:var(--ink-soft)}.library-menu>div{position:absolute;right:0;top:50px;padding:7px;min-width:170px;background:var(--bg-card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}.library-menu button{display:block;width:100%;padding:10px;border:0;border-radius:7px;background:transparent;text-align:left;font:inherit;font-size:12px}.library-menu button:hover{background:var(--accent-soft)}.shelf-caption{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:10px 0 18px;margin:26px 0 30px;font-size:12px;color:var(--ink-soft)}.book-shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:32px 35px;align-items:start}.book-card{display:block;text-align:left;background:none;border:0;padding:0 7px 0 0;min-width:0;font:inherit}.book-cover{position:relative;min-height:235px;aspect-ratio:3/4;padding:25px 21px 20px 27px;border-radius:4px 13px 13px 4px;display:flex;flex-direction:column;box-shadow:4px 2px 0 #cdd7df30,7px 3px 0 #cdd7df1a,9px 12px 22px #0003;transition:transform .2s;overflow:hidden;border:1px solid #dce5f51a;background:linear-gradient(100deg,#24313f 0 5%,#4d6179 6%,#304258 10%,#26374c 100%)}.book-cover:before{content:'';position:absolute;inset:0 auto 0 10%;border-left:1px solid #dce5f518}.book-card:hover .book-cover{transform:translateY(-5px)}.cover-label{font-size:10px;line-height:1.8;color:#d4dde5b0}.book-cover strong{font-family:var(--serif);font-size:27px;font-weight:500;line-height:1.6;letter-spacing:1px;overflow-wrap:anywhere;margin:24px 0;color:#edf2f6}.cover-mark{margin-top:auto;color:#c5d3e199;width:35px}.cover-mark svg{width:100%}.olive{background:linear-gradient(100deg,#2a3838 0 5%,#657b72 6%,#3c5550 10%,#304541 100%)}.plum{background:linear-gradient(100deg,#332c43 0 5%,#786383 6%,#52405b 10%,#3c314b 100%)}.blue{background:linear-gradient(100deg,#223e4b 0 5%,#577c8c 6%,#355968 10%,#294651 100%)}.mistakes{background:linear-gradient(100deg,#40373c 0 5%,#887178 6%,#5c4952 10%,#4c3c45 100%)}.book-caption{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;margin-top:20px;color:var(--ink-soft)}.book-caption>span{overflow-wrap:anywhere}.book-caption small{font-size:11px;color:var(--ink-muted);white-space:nowrap}.new-book-card{min-height:235px;aspect-ratio:3/4;border:1px dashed var(--line);border-radius:5px 13px 13px 5px;background:#c9ddff03;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;color:var(--ink-soft);padding:18px;font:inherit}.new-book-icon{display:grid;place-items:center;width:54px;color:var(--accent)}.new-book-icon svg{width:48px}.new-book-card strong{font-size:13px;font-weight:500}.new-book-card>span:last-child{font-size:10px;color:var(--ink-muted)}.new-book-card:hover{background:var(--accent-soft);border-color:var(--accent)}.shelf-note{color:var(--ink-muted);font-size:12px;line-height:1.8;margin-top:38px}.library-error{color:var(--bad);font-size:13px}.library-loading{padding:40px;text-align:center;color:var(--ink-soft)}.text-button{background:transparent;border:0;color:var(--accent);font:inherit;font-size:12px;padding:7px}@media(min-width:1150px){.book-shelf{grid-template-columns:repeat(auto-fill,minmax(175px,1fr))}}@media(max-width:600px){.book-shelf{grid-template-columns:repeat(2,minmax(0,1fr));gap:28px 22px}.book-cover,.new-book-card{min-height:205px;padding:18px 15px 17px 22px}.book-cover strong{font-size:23px;margin-top:18px}.cover-label{font-size:9px}.book-caption{font-size:12px;gap:5px}.shelf-caption{margin-top:15px}.shelf-note{font-size:11px}.library-heading h1{font-size:27px}}
@media(prefers-reduced-motion:reduce){.book-cover{transition:none}.book-card:hover .book-cover{transform:none}}
</style>
