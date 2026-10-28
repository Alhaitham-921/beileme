<script setup>
import { ref, onMounted } from 'vue'
import { words } from '../api'
const emit = defineEmits(['change'])
const props = defineProps({ wordId: Number })
const saved = ref(false), busy = ref(false), error = ref('')
onMounted(async () => { try { saved.value = (await words.favorites()).items.some(w => w.id === props.wordId) } catch (e) { error.value = e.message } })
async function toggle() {
 if (busy.value) return
 busy.value = true; error.value = ''
 try { await (saved.value ? words.unfavorite(props.wordId) : words.favorite(props.wordId)); saved.value = !saved.value; emit('change', saved.value) }
 catch (e) { error.value = e.message }
 finally { busy.value = false }
}
</script>
<template><span><button type="button" class="btn btn-ghost" :disabled="busy" :aria-pressed="saved" @click.stop="toggle">{{ saved ? '★ 已收藏' : '☆ 收藏至单词本' }}</button><small v-if="error" role="alert">{{ error }}</small></span></template>
