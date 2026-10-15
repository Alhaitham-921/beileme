<script setup>
import { computed } from 'vue'
import { getMorphology } from '../data/morphology'
const props = defineProps({ word: { type: String, default: '' } })
const entry = computed(() => getMorphology(props.word))
const labels = { prefix: '前缀', root: '词根 / 词干', suffix: '后缀', base: '基础词', spelling: '拼写' }
</script>
<template>
  <details class="morphology" @click.stop>
    <summary>词根词缀记忆 <span>{{ entry ? '拆开看，更好记' : '查看收录情况' }}</span></summary>
    <template v-if="entry">
      <div class="parts"><div v-for="(part,i) in entry.parts" :key="i" class="part" :class="part.type"><strong>{{ part.text }}</strong><span>{{ labels[part.type] }}</span><small>{{ part.meaning }}</small></div></div>
      <p class="hint">{{ entry.hint }}</p>
      <p v-if="entry.source" class="note">来源：{{ entry.source }} · 英文原释义可能尚未翻译，整词含义见中文释义。</p>
      <p>联想词：<span v-for="relative in entry.family" :key="relative.word" class="relative">{{ relative.word }} <small>{{ relative.meaning }}</small></span></p>
      <p class="note">教学性简化拆解，辅助记忆；整词释义与实际语境优先。</p>
    </template>
    <p v-else class="note">暂未收录这个词的可靠拆解。可先用例句记忆，或到词根词缀库学习常见构词规律。</p>
    <router-link class="library-link" to="/roots">打开词根词缀库 →</router-link>
  </details>
</template>
<style scoped>
.part { overflow-wrap: anywhere; }.part small { line-height: 1.6; }
.morphology { margin: 20px 0; padding: 16px; border: 1px solid var(--line); border-radius: 12px; text-align: left; }summary { cursor: pointer; font-weight: 600; }summary span { margin-left: 10px; font-weight: 400; font-size: 12px; color: var(--ink-soft); }.parts { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }.part { display: flex; flex-direction: column; min-width: 75px; flex: 1; padding: 10px; border-radius: 10px; background: var(--accent-soft); }.part.root { background: var(--hint-bg); }.part strong { font-family: var(--serif); font-size: 23px; }.part span, .note { font-size: 12px; color: var(--ink-soft); }.part small { font-size: 13px; }.relative { display: inline-block; margin: 4px 10px 4px 0; }.relative small { color: var(--ink-soft); }.hint { font-weight: 600; }.library-link { color: var(--accent-deep); font-size: 13px; }
</style>
