<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { words, study } from '../api'
const props = defineProps({ modelValue: Array, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const source = ref('wrong'), wrong = ref([]), saved = ref([]), error = ref(''), loading = ref(true)
const list = computed(() => source.value === 'wrong' ? wrong.value : saved.value)
const extraWords = ref({})
const chosen = computed(() => props.modelValue.map(id =>
  wrong.value.find(word => word.id === id) || saved.value.find(word => word.id === id) || extraWords.value[id] || { id }))
watch(() => props.modelValue, async ids => {
  const missing = ids.filter(id => !wrong.value.some(word => word.id === id) && !saved.value.some(word => word.id === id) && !extraWords.value[id])
  await Promise.all(missing.map(async id => {
    try { extraWords.value[id] = (await words.detail(id)).word }
    catch { extraWords.value[id] = { id } }
  }))
}, { immediate: true })
onMounted(async () => { try {
 const [a,b] = await Promise.all([study.reviewToday(), words.favorites()])
 wrong.value = a.wrongWords.map(w => ({ ...w, id: w.wordId })); saved.value = b.items
} catch(e) { error.value = e.message } finally { loading.value = false } })
function toggle(id) { emit('update:modelValue', props.modelValue.includes(id) ? props.modelValue.filter(w => w !== id) : [...props.modelValue, id]) }
</script>
<template>
  <fieldset :disabled="disabled">
    <legend>用我的单词生成情景（可选，最多 5 个）</legend>
    <div class="picker-actions">
      <select v-model="source" aria-label="单词来源"><option value="wrong">今日错词</option><option value="saved">收藏单词本</option></select>
      <span>已选 {{ modelValue.length }} / 5</span>
      <button type="button" class="btn btn-quiet" :disabled="!modelValue.length" @click="emit('update:modelValue', [])">清空</button>
    </div>
    <ul v-if="chosen.length" class="word-options chosen-words" aria-label="已选情境词">
      <li v-for="word in chosen" :key="word.id">
        <button type="button" class="btn btn-quiet" :aria-label="'移除 ' + (word.spelling || '单词 ' + word.id)" @click="toggle(word.id)">
          {{ word.spelling || '单词 ' + word.id }} ×
        </button>
      </li>
    </ul>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="loading">正在加载单词…</p>
    <p v-else-if="!list.length">暂无单词，可先去背词或收藏。</p>
    <div class="word-options">
      <label v-for="w in list" :key="w.id">
        <input type="checkbox" :checked="modelValue.includes(w.id)" :disabled="!modelValue.includes(w.id) && modelValue.length >= 5" @change="toggle(w.id)">
        {{ w.spelling }} · {{ w.definitions[0] }}
      </label>
    </div>
    <p>所选词会成为情景的目标词，在对话中练习用出它们。</p>
  </fieldset>
</template>
<style scoped>
fieldset { min-width: 0; border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 18px; }
legend, p { font-size: 12px; color: var(--ink-soft); }
.picker-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; color: var(--ink-soft); font-size: 13px; }
.picker-actions select { min-height: 44px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 11px; }
.word-options { display: flex; gap: 12px; flex-wrap: wrap; max-height: 220px; overflow: auto; margin-top: 12px; }
.chosen-words { list-style: none; padding: 0; }
label { font-size: 13px; display: flex; gap: 6px; align-items: center; }
</style>
