<script setup>
import { computed } from 'vue'
import { usePracticeWordPicker } from '../composables/usePracticeWordPicker.js'
const props = defineProps({ modelValue: { type: Array, default: () => [] }, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const { source, search, page, total, totalPages, list, chosen, error, loading, load, selectSource, setSearch, goPage, toggle } =
  usePracticeWordPicker(computed(() => props.modelValue), ids => emit('update:modelValue', ids))
</script>
<template>
  <fieldset :disabled="disabled">
    <legend>用我的单词生成情景（可选，最多 5 个）</legend>
    <div class="picker-actions">
      <select :value="source" aria-label="单词来源" @change="selectSource($event.target.value)"><option value="mistakes">错词本 · 全部历史</option><option value="wrong">今日错词</option><option value="saved">收藏单词本</option></select>
      <span>已选 {{ modelValue.length }} / 5</span>
      <button type="button" class="btn btn-quiet" :disabled="!modelValue.length" @click="emit('update:modelValue', [])">清空</button>
    </div>
    <label class="picker-search">搜索单词或释义<input type="search" :value="search" maxlength="100" placeholder="在当前来源中搜索" @input="setSearch($event.target.value)"></label>
    <ul v-if="chosen.length" class="word-options chosen-words" aria-label="已选情境词">
      <li v-for="word in chosen" :key="word.id">
        <button type="button" class="btn btn-quiet" :aria-label="'移除 ' + (word.spelling || '单词 ' + word.id)" @click="toggle(word.id)">
          {{ word.spelling || '单词 ' + word.id }} ×
        </button>
      </li>
    </ul>
    <p v-if="error" role="alert">{{ error }} <button type="button" class="text-button" @click="load">重试加载</button></p>
    <p v-else-if="loading">正在加载单词…</p>
    <p v-else-if="!list.length">{{ search.trim() ? '没有匹配的单词，试试其他关键词。' : source==='mistakes' ? '错词本暂无记录，可以切换今日错词或收藏单词本。' : '当前来源暂无单词，可以切换其他来源。' }}</p>
    <div class="word-options">
      <label v-for="w in list" :key="w.id">
        <input type="checkbox" :checked="modelValue.includes(w.id)" :disabled="!modelValue.includes(w.id) && modelValue.length >= 5" @change="toggle(w.id)">
        {{ w.spelling }} · {{ w.definitions?.[0] || '暂无释义' }}
      </label>
    </div>
    <div v-if="!error && total" class="picker-actions picker-pages"><span>共 {{ total }} 个词 · 第 {{ page }} / {{ totalPages }} 页</span><button type="button" class="btn btn-quiet" :disabled="loading || page<=1" @click="goPage(page-1)">上一页</button><button type="button" class="btn btn-quiet" :disabled="loading || page>=totalPages" @click="goPage(page+1)">下一页</button></div>
    <p>所选词会成为情景的目标词，在对话中练习用出它们。</p>
  </fieldset>
</template>
<style scoped>
fieldset { min-width: 0; border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 18px; }
legend, p { font-size: 12px; color: var(--ink-soft); }
.picker-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; color: var(--ink-soft); font-size: 13px; }
.picker-actions select { min-height: 44px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 11px; }
.picker-search { margin-top:12px; flex-wrap:wrap; }.picker-search input { flex:1; min-width:120px; width:100%; box-sizing:border-box; border:1px solid var(--line); border-radius:8px; padding:9px 10px; background:var(--bg-card); color:var(--ink); font:inherit; }.picker-pages { margin-top:12px; }
.word-options { display: flex; gap: 12px; flex-wrap: wrap; max-height: 220px; overflow: auto; margin-top: 12px; }
.chosen-words { list-style: none; padding: 0; }
label { font-size: 13px; display: flex; gap: 6px; align-items: center; }
</style>
