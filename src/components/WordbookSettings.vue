<script setup>
import { onMounted, ref } from 'vue'
import { profile } from '../api'

const items = ref([])
const currentId = ref(null)
const selectedId = ref(null)
const name = ref('')
const file = ref(null)
const fileInput = ref(null)
const busy = ref(false)
const error = ref('')
const message = ref('')

async function run(action) {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = cause.message
  } finally {
    busy.value = false
  }
}

onMounted(() => run(async () => {
  const result = await profile.wordbooks()
  items.value = result.items
  currentId.value = selectedId.value = result.currentId
}))

function selectBook() {
  return run(async () => {
    const { currentId: id } = await profile.selectWordbook(selectedId.value)
    currentId.value = id
    message.value = '当前词书已切换，接下来学习的新词将从这本词书中选取。'
  })
}

function importBook() {
  return run(async () => {
    if (file.value.size > 900000) throw new Error('文件不能超过 900 KB')
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(await file.value.arrayBuffer())
    } catch {
      throw new Error('请上传 UTF-8 编码的文本文件')
    }
    if (new TextEncoder().encode(JSON.stringify({ name: name.value, text })).length >= 1048576) {
      throw new Error('词表内容过大，请拆分为多个文件')
    }
    const { book } = await profile.importWordbook({ name: name.value, text })
    items.value.push(book)
    selectedId.value = book.id
    name.value = ''
    file.value = null
    fileInput.value.value = ''
    message.value = `已导入「${book.name}」，共 ${book.wordCount} 个单词。点击「设为当前词书」即可开始学习。`
  })
}
</script>

<template>
  <section class="card wordbook-settings">
    <h2>学习词书</h2>
    <form @submit.prevent="selectBook">
      <label for="study-wordbook">选择词书</label>
      <div class="wordbook-select">
        <select id="study-wordbook" class="wordbook-field" v-model="selectedId" :disabled="busy || !items.length">
          <option :value="null" disabled>请选择词书</option>
          <option v-for="book in items" :key="book.id" :value="book.id" :disabled="!book.wordCount">
            {{ book.name }}（{{ book.wordCount }} 词）{{ book.id === currentId ? ' · 当前' : '' }}
          </option>
        </select>
      </div>
      <button class="btn btn-primary" :disabled="busy || !selectedId || selectedId === currentId">设为当前词书</button>
    </form>
    <form @submit.prevent="importBook">
      <h3>导入词书</h3>
      <p id="import-format">上传 UTF-8 编码的 .tsv 或 .txt 文件。每行填写一个英文单词和释义，用 Tab 分隔，无需表头。每本最多 5000 个单词。</p>
      <label for="wordbook-name">词书名称</label>
      <input id="wordbook-name" class="wordbook-field" v-model.trim="name" maxlength="96" required :disabled="busy" />
      <label for="wordbook-file">词表文件</label>
      <input id="wordbook-file" ref="fileInput" type="file" accept=".tsv,.txt" required
        aria-describedby="import-format" :disabled="busy" @change="file = $event.target.files[0] ?? null" />
      <button class="btn btn-primary" :disabled="busy || !name || !file">导入</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.wordbook-settings { padding: 1rem; }
form { display: grid; gap: .5rem; }
form + form { margin-top: 1.5rem; }
input, select { min-width: 0; width: 100%; }
.wordbook-field {
  appearance: none;
  min-height: 44px;
  padding: 11px 14px;
  font-size: 14px;
  background: var(--bg);
  border: 1.5px solid var(--line);
  border-radius: var(--radius-sm);
  box-shadow: none;
}
.wordbook-field:focus {
  border-color: var(--accent);
  background: var(--bg-card);
}
.wordbook-select { position: relative; min-width: 0; }
.wordbook-select select { padding-inline-end: 36px; }
.wordbook-select::after {
  content: '';
  position: absolute;
  inset-inline-end: 16px;
  top: calc(50% - 5px);
  width: 7px;
  height: 7px;
  border: solid var(--ink-soft);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
  pointer-events: none;
}
button { justify-self: start; }
</style>
