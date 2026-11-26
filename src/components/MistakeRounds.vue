<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { createTypingSound } from '../utils/spellingPractice.js'
import { spellingSoundEnabled, tone } from '../stores/spellingSound.js'
const props = defineProps({ items:Array })
const emit = defineEmits(['done'])
const queue = ref([...props.items]), index = ref(0), phase = ref('spell')
const missed = ref([]), typed = ref(''), feedback = ref(null), field = ref(null)
const spellingAttempts = ref(0), correctSpellings = ref(0)
const item = computed(() => queue.value[index.value])
const sound = createTypingSound()
function play(value) { if(spellingSoundEnabled.value) sound.play(value,tone.value) }
function check(option) {
  if(feedback.value !== null) return
  const ok = phase.value === 'spell' ? typed.value.trim().normalize('NFKC').toLowerCase().replace(/’/g,"'") === item.value.word.spelling.toLowerCase().replace(/’/g,"'") : option === item.value.correctOptionIndex
  feedback.value = ok
  if (phase.value === 'spell') {
    spellingAttempts.value++
    if (ok) correctSpellings.value++
  }
  if (!ok && phase.value === 'choice') missed.value.push(item.value)
  play(ok || 'error')
}
async function next() {
  if(feedback.value === null) return
  if (++index.value >= queue.value.length) {
    if (phase.value === 'spell') phase.value = 'choice'
    else if (!missed.value.length) { emit('done'); return }
    else { queue.value = missed.value; missed.value = []; phase.value = 'spell' }
    index.value = 0
  }
  feedback.value = null; typed.value = ''
  await nextTick(); field.value?.focus({preventScroll:true})
}
function key(e) {
  if(e.isComposing || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
  if(feedback.value !== null && [' ','Enter'].includes(e.key)) { e.preventDefault(); next() }
  else if(phase.value === 'choice' && /^[1-4]$/.test(e.key) && item.value?.options[Number(e.key)-1]) check(item.value.options[Number(e.key)-1].index)
}
onMounted(()=>{field.value?.focus({preventScroll:true}); window.addEventListener('keydown',key)})
onUnmounted(()=>{sound.close();window.removeEventListener('keydown',key)})
</script>
<template><section v-if="item" class="card">
  <small>错词{{ phase === 'spell' ? '默写' : '释义重选' }} · {{ index+1 }} / {{ queue.length }}</small>
  <small v-if="spellingAttempts"> · 默写正确率 {{ Math.round(correctSpellings * 100 / spellingAttempts) }}%</small>
  <h2>{{ phase === 'spell' ? item.word.definitions.join('；') : item.word.spelling }}</h2>
  <form v-if="phase === 'spell'" @submit.prevent="check()"><input ref="field" v-model="typed" :readonly="feedback !== null" aria-label="默写英文单词" autocomplete="off" spellcheck="false" @input="play(false)"> <button class="btn btn-primary" :disabled="feedback !== null">核对</button></form>
  <template v-else><button v-for="option in item.options" :key="option.index" class="option" :disabled="feedback !== null" @click="check(option.index)">{{ option.index+1 }}. {{ option.text }}</button></template>
  <p v-if="feedback !== null">{{ feedback ? '✓ 正确' : '正确答案 · '+item.word.spelling+' · '+item.word.definitions.join('；') }} <button class="btn btn-secondary" @click="next">继续（空格）</button></p>
</section></template>
