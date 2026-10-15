<script setup>
import { ref, computed, watch } from 'vue'
import { morphologyGroups, morphologyEntries, morphologySources, entriesForGroup } from '../data/morphology'
import MorphologyCard from '../components/MorphologyCard.vue'
const search = ref(''), type = ref('all'), recall = ref(false)
const page = ref(1), pageSize = 12
watch([search, type], () => { page.value = 1 })
const searchIndex = new Map(morphologyGroups.map(g => [g.id, `${g.label} ${g.meaning} ${g.tip} ${entriesForGroup(g.id).map(e => e.word + ' ' + e.meaning).join(' ')} ${(g.examples || []).map(e => e.word + ' ' + e.meaning).join(' ')}`.toLowerCase()]))
const labels = { root: '词根', prefix: '前缀', suffix: '后缀' }
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return morphologyGroups.filter(g => (type.value === 'all' || g.type === type.value) && (!q || searchIndex.get(g.id).includes(q)))
})
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const pages = computed(() => Math.ceil(filtered.value.length / pageSize))
function examples(group) { return entriesForGroup(group).slice(0, 8) }
function movePage(delta) { page.value += delta; window.scrollTo({ top: 0, behavior: 'auto' }) }
</script>
<template>
  <div class="roots">
    <router-link class="muted" to="/study">← 返回背词</router-link>
    <h1 class="section-title">词根词缀记忆库</h1>
    <p class="section-sub">{{ morphologyGroups.length }} 组构词线索 · {{ morphologyEntries.length }} 个拆解示例 · 本地加载，无需等待 AI</p>
    <div class="card controls">
      <label for="root-search">搜索词根、英文单词或中文含义</label>
      <input id="root-search" v-model="search" type="search" placeholder="例如 port、careful、搬运" />
      <div class="filters" role="group" aria-label="构词类型"><button v-for="(label,key) in { all: '全部', root: '词根', prefix: '前缀', suffix: '后缀' }" :key="key" class="btn btn-secondary" :aria-pressed="type === key" :class="{ active: type === key }" @click="type = key">{{ label }}</button></div>
      <label><input v-model="recall" type="checkbox" /> 回忆模式：先隐藏词义，点击后核对</label>
    </div>
    <p v-if="!filtered.length" role="status">未找到匹配内容。可以换个词搜索；未收录的词不会自动猜测拆解。</p>
    <p class="muted">共 {{ filtered.length }} 组，当前第 {{ page }} / {{ pages || 1 }} 页。开源英文原释义保留展示，已整理内容提供中文提示。</p>
    <section v-for="group in visible" :key="group.id" class="card group">
      <div class="group-head"><h2>{{ group.label }}</h2><span>{{ labels[group.type] }}</span></div>
      <p class="meaning">{{ group.meaning }}</p><p class="muted">{{ group.tip }}</p>
      <p v-if="group.source" class="muted">来源：{{ group.source }}</p>
      <div v-for="entry in examples(group.id)" :key="entry.word" class="entry">
        <strong>{{ entry.word }}</strong>
        <details v-if="recall" :key="entry.word + ':recall'"><summary>想好词义了吗？点击核对</summary><p>{{ entry.meaning }}</p></details>
        <span v-else class="entry-meaning">{{ entry.meaning }}</span>
        <MorphologyCard :key="entry.word + ':' + recall" :word="entry.word" />
      </div>
      <div v-if="group.examples?.length"><p class="muted">上游关联例词（不代表完整拆解）：</p><span v-for="example in group.examples" :key="example.word" class="related-example">{{ example.word }} · {{ example.meaning }}</span></div>
      <p v-if="!examples(group.id).length && !group.examples?.length" class="muted">当前词书暂无匹配例词，可通过搜索学习其他词根词缀。</p>
    </section>
    <div v-if="pages > 1" class="filters"><button class="btn btn-secondary" :disabled="page === 1" @click="movePage(-1)">上一页</button><button class="btn btn-secondary" :disabled="page === pages" @click="movePage(1)">下一页</button></div>
    <footer><p>本项目仅用于非商业学生学习。MorphoLex：Sánchez-Gutiérrez、Mailhot、Deacon 等，CC BY-NC-SA 4.0；morphemes：Copyright © 2019 Colin Goldberg，MIT。数据经过筛选和格式转换；许可原文随项目保留。<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">MorphoLex 数据许可</a></p><p>构词是理解与联想的线索，不能仅凭首尾字母推断词义。MorphoLex 仅导入与现有词书匹配、组成部分能还原拼写的记录；中文教学提示优先使用人工整理版本。</p><p>参考：<a v-for="source in morphologySources" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗ </a></p></footer>
  </div>
</template>
<style scoped>
.related-example { display: inline-block; padding: 6px 10px; margin: 4px; background: var(--accent-soft); border-radius: 8px; font-size: 13px; }
.roots { padding: 12px 0 40px; }.section-title { margin-top: 20px; }.controls { display: grid; gap: 16px; }.controls > input { width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 10px; font: inherit; }.filters { display: flex; flex-wrap: wrap; gap: 8px; }.filters .btn { font-size: 13px; padding: 8px 16px; }.active { outline: 2px solid var(--accent); }.group { margin-top: 22px; }.group-head { display: flex; align-items: center; gap: 14px; }.group-head h2 { font-family: var(--serif); font-size: 32px; margin: 0; }.group-head span { color: var(--accent-deep); font-size: 12px; }.meaning { margin: 4px 0; font-size: 18px; }.entry { padding-top: 18px; margin-top: 18px; border-top: 1px solid var(--line); }.entry > strong { font-size: 19px; }.entry-meaning { margin-left: 16px; color: var(--ink-soft); }footer { margin-top: 30px; font-size: 12px; color: var(--ink-soft); }footer a { display: inline-block; margin: 6px; text-decoration: underline; }
</style>
