<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { words } from '../api/index.js'
const emit = defineEmits(['close','created'])
const dialog = ref(null), input = ref(null), name = ref(''), busy = ref(false), error = ref('')
onMounted(async () => { dialog.value.showModal(); await nextTick(); input.value?.focus() })
async function create() {
  if (busy.value || !name.value.trim()) return
  busy.value = true; error.value = ''
  try { const { notebook } = await words.createNotebook(name.value.trim()); emit('created', notebook); emit('close') }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
</script>
<template>
  <dialog ref="dialog" class="create-notebook" aria-labelledby="create-book-title" @cancel.prevent="!busy && emit('close')" @click="$event.target===dialog && !busy && emit('close')">
    <div class="create-heading"><h2 id="create-book-title">新建单词书</h2><button class="close" :disabled="busy" aria-label="关闭新建单词书" @click="emit('close')">关闭</button></div>
    <div class="create-content"><div class="cover-preview" aria-hidden="true"><span>我的单词书</span><strong>{{ name.trim() || '写下书名' }}</strong><i></i></div><form @submit.prevent="create"><p>为想记住的词，留一本专属的书。</p><label for="notebook-name">单词书名称</label><input id="notebook-name" ref="input" v-model="name" maxlength="40" placeholder="例如：旅行英语、易混词" :disabled="busy"><small>{{ name.length }} / 40</small><p v-if="error" role="alert" class="error">{{ error }}</p><button class="btn btn-primary" :disabled="busy || !name.trim()">{{ busy ? '创建中…' : '创建单词书' }}</button></form></div>
  </dialog>
</template>
<style scoped>
.create-notebook{width:min(580px,calc(100vw - 32px));padding:28px;border:1px solid var(--line);border-radius:22px;background:var(--bg-card);color:var(--ink);box-shadow:0 25px 90px #0007}.create-notebook::backdrop{background:#07111dc7;backdrop-filter:blur(8px)}.create-heading{display:flex;align-items:center;justify-content:space-between;gap:18px}.create-heading h2{margin:0;font-size:21px}.close{border:0;background:transparent;color:var(--ink-soft);padding:8px;font:inherit;font-size:12px}.create-content{display:grid;grid-template-columns:150px minmax(0,1fr);gap:28px;margin-top:26px;align-items:center}.cover-preview{min-height:210px;border-radius:4px 12px 12px 4px;background:linear-gradient(100deg,#283645 0 7%,#435770 8%,#2b3c52 13%,#26374c 100%);padding:24px 20px 20px 27px;box-shadow:5px 4px 0 #c2cbd533,8px 10px 18px #0004;display:flex;flex-direction:column;gap:25px}.cover-preview span{font-size:10px;color:#bec9d6}.cover-preview strong{font-family:var(--serif);font-weight:500;line-height:1.7;overflow-wrap:anywhere;font-size:20px}.cover-preview i{height:1px;width:25px;background:var(--accent);margin-top:auto}.create-content form{display:grid;gap:9px;min-width:0}.create-content p{color:var(--ink-soft);font-size:13px;margin:0 0 12px}.create-content label{font-size:12px}.create-content input{padding:12px;border:1px solid var(--line);border-radius:9px;background:var(--surface-study);font:inherit;min-width:0;width:100%}.create-content small{text-align:right;color:var(--ink-muted);font-size:10px}.create-content .error{color:var(--bad)}.create-content .btn{margin-top:12px}@media(max-width:520px){.create-content{grid-template-columns:1fr}.cover-preview{display:none}.create-notebook{padding:22px}}
</style>
