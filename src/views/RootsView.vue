<script setup>
import { ref, computed, watch } from 'vue'
import { morphologyGroups, morphologyEntries, morphologySources, entriesForGroup } from '../data/morphology'
import MorphologyCard from '../components/MorphologyCard.vue'

const search = ref('')
const type = ref('all')
const recall = ref(false)
const page = ref(1)
const pageSize = 12
const labels = { root: '词根', prefix: '前缀', suffix: '后缀' }
const filters = { all: '全部', root: '词根', prefix: '前缀', suffix: '后缀' }
const searchIndex = new Map(morphologyGroups.map(group => [
  group.id,
  [group.label, group.meaning, group.tip, ...entriesForGroup(group.id).map(entry => entry.word + ' ' + entry.meaning), ...(group.examples || []).map(entry => entry.word + ' ' + entry.meaning)].join(' ').toLowerCase(),
]))

watch([search, type], () => { page.value = 1 })
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return morphologyGroups.filter(group =>
    (type.value === 'all' || group.type === type.value) && (!query || searchIndex.get(group.id).includes(query))
  )
})
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const pages = computed(() => Math.ceil(filtered.value.length / pageSize))
function examples(group) { return entriesForGroup(group).slice(0, 8) }
function movePage(delta) {
  page.value += delta
  window.scrollTo({ top: 0, behavior: 'auto' })
}
</script>

<template>
  <div class="roots">
    <header class="page-heading">
      <div>
        <p class="page-eyebrow">MORPHOLOGY LIBRARY</p>
        <h1 class="section-title">词根词缀记忆库</h1>
        <p class="section-sub">从熟悉的构词线索，记住更多词汇。</p>
      </div>
      <router-link class="back-link" to="/study">返回背词 <span aria-hidden="true">↗</span></router-link>
    </header>

    <div class="card controls">
      <label class="search-label" for="root-search">查找构词线索</label>
      <div class="search-field">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input id="root-search" v-model="search" type="search" placeholder="搜索词根、英文单词或中文含义，例如 port、搬运" />
      </div>
      <div class="control-options">
        <div class="filters" role="group" aria-label="构词类型">
          <button v-for="(label, key) in filters" :key="key" class="filter-tab" :aria-pressed="type === key" :class="{ active: type === key }" @click="type = key">{{ label }}</button>
        </div>
        <label class="recall-toggle"><input v-model="recall" type="checkbox" /> 回忆模式 <span>展开后核对词义</span></label>
      </div>
    </div>

    <div class="results-heading" role="status" aria-live="polite">
      <span>共 <b>{{ filtered.length }}</b> 组构词线索 <span class="result-total">/ {{ morphologyEntries.length }} 个拆解示例</span></span>
      <span v-if="filtered.length">第 {{ page }} / {{ pages }} 页</span>
    </div>

    <div v-if="!filtered.length" class="card empty-card" role="status">
      <p class="empty-title">还没有找到这条线索</p>
      <p class="muted">换个词根、单词或中文含义试试。未收录的词不会自动猜测拆解。</p>
      <button class="btn btn-ghost" @click="search = ''; type = 'all'">查看全部词根</button>
    </div>

    <div v-else class="card group-list">
      <section v-for="group in visible" :key="group.id" class="root-group" :aria-labelledby="'group-' + group.id">
        <div class="group-intro">
          <div class="group-head"><h2 :id="'group-' + group.id">{{ group.label }}</h2><span>{{ labels[group.type] }}</span></div>
          <p class="meaning">{{ group.meaning }}</p>
          <p class="group-tip">{{ group.tip }}</p>
          <p v-if="group.source" class="group-source">来源：{{ group.source }}</p>
        </div>
        <div class="group-examples">
          <details v-for="entry in examples(group.id)" :key="entry.word + ':' + recall" class="entry">
            <summary>
              <strong>{{ entry.word }}</strong>
              <span v-if="!recall" class="entry-meaning">{{ entry.meaning }}</span>
              <span v-else class="recall-hint">回忆词义后展开</span>
              <svg class="entry-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
            </summary>
            <div class="entry-content">
              <p v-if="recall" class="recalled-meaning">{{ entry.meaning }}</p>
              <MorphologyCard :word="entry.word" open class="entry-morphology" />
            </div>
          </details>
          <div v-if="group.examples?.length" class="related-examples">
            <p>关联例词 <span>· 仅作联想，不代表完整拆解</span></p>
            <span v-for="example in group.examples" :key="example.word" class="related-example">{{ example.word }} <span v-if="!recall">· {{ example.meaning }}</span></span>
          </div>
          <p v-if="!examples(group.id).length && !group.examples?.length" class="no-examples">当前词书暂无匹配例词，可通过搜索学习其他构词线索。</p>
        </div>
      </section>
    </div>

    <nav v-if="pages > 1" class="pagination" aria-label="词根库分页">
      <button class="btn btn-ghost" :disabled="page === 1" @click="movePage(-1)">← 上一页</button>
      <span class="muted">{{ page }} / {{ pages }}</span>
      <button class="btn btn-ghost" :disabled="page === pages" @click="movePage(1)">下一页 →</button>
    </nav>

    <footer>
      <details class="source-notes">
        <summary>数据来源与使用说明</summary>
        <p>本项目仅用于非商业学生学习。MorphoLex：Sánchez-Gutiérrez、Mailhot、Deacon 等，CC BY-NC-SA 4.0；morphemes：Copyright © 2019 Colin Goldberg，MIT。数据经过筛选和格式转换；许可原文随项目保留。<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">MorphoLex 数据许可 ↗</a></p>
        <p>构词是理解与联想的线索，不能仅凭首尾字母推断词义。MorphoLex 仅导入与现有词书匹配、组成部分能还原拼写的记录；中文教学提示优先使用人工整理版本。开源英文原释义保留展示，已整理内容提供中文提示。</p>
        <p>参考：<a v-for="source in morphologySources" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗ </a></p>
      </details>
    </footer>
  </div>
</template>

<style scoped>
.back-link { flex: none; font-size: 12px; color: var(--ink-soft); padding: 8px 0; }
.back-link span { margin-left: 10px; color: var(--accent-deep); }
.controls { display: grid; gap: 12px; padding: 23px 26px; }
.search-label { font-size: 12px; font-weight: 500; color: var(--ink-soft); }
.search-field { position: relative; }
.search-field svg { position: absolute; left: 15px; top: 15px; width: 18px; height: 18px; color: var(--ink-muted); pointer-events: none; }
.search-field input { width: 100%; min-height: 48px; padding: 11px 15px 11px 44px; border: 1px solid var(--line); border-radius: 11px; background: var(--bg-card); }
.control-options { display: flex; align-items: center; justify-content: space-between; gap: 15px; flex-wrap: wrap; }
.filters { display: flex; gap: 4px; }
.filter-tab { min-height: 39px; padding: 8px 17px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--ink-soft); font-size: 12px; }
.filter-tab:hover { color: var(--ink); }
.filter-tab.active { background: var(--accent-soft); color: var(--accent-deep); border-color: var(--line); }
.recall-toggle { display: inline-flex; gap: 8px; align-items: center; font-size: 12px; color: var(--ink-soft); cursor: pointer; }
.recall-toggle input { width: 15px; height: 15px; margin: 0; }
.recall-toggle > span { color: var(--ink-muted); font-size: 11px; }
.results-heading { display: flex; justify-content: space-between; gap: 12px; padding: 24px 2px 13px; font-size: 11px; color: var(--ink-muted); }
.results-heading b { color: var(--ink-soft); font-weight: 500; }
.result-total { margin-left: 6px; }
.group-list { padding: 0 26px; }
.root-group { display: grid; grid-template-columns: 175px minmax(0, 1fr); gap: 28px; padding: 28px 0; border-bottom: 1px solid var(--line); }
.root-group:last-child { border-bottom: 0; }
.group-head { display: flex; gap: 12px; align-items: baseline; }
.group-head h2 { margin: 0; font-family: var(--serif); font-size: 29px; font-weight: 500; line-height: 1.3; }
.group-head > span { font-size: 10px; color: var(--accent-deep); white-space: nowrap; }
.meaning { margin: 7px 0 9px; font-size: 13px; }
.group-tip { font-size: 11px; color: var(--ink-soft); line-height: 1.8; margin: 0; }
.group-source { font-size: 10px; color: var(--ink-muted); margin: 12px 0 0; overflow-wrap: anywhere; }
.entry { border-bottom: 1px solid var(--line); }
.entry:last-child { border-bottom: 0; }
.entry > summary { display: flex; gap: 16px; align-items: center; list-style: none; cursor: pointer; min-height: 48px; padding: 10px 4px; border-radius: 5px; }
.entry > summary::-webkit-details-marker { display: none; }
.entry > summary:hover { color: var(--accent-deep); }
.entry strong { min-width: 112px; font-family: var(--serif); font-size: 17px; font-weight: 500; }
.entry-meaning { font-size: 12px; color: var(--ink-soft); flex: 1; min-width: 0; }
.recall-hint { font-size: 11px; color: var(--ink-muted); }
.entry-chevron { flex: none; width: 17px; height: 17px; margin-left: auto; color: var(--ink-muted); transition: transform .2s; }
.entry[open] .entry-chevron { transform: rotate(180deg); }
.entry-content { padding: 5px 4px 14px; }
.recalled-meaning { color: var(--accent-deep); margin: 0 0 12px; font-size: 13px; }
.entry-morphology { padding: 0; margin: 0; border: 0; }
.entry-morphology :deep(> summary), .entry-morphology :deep(.library-link) { display: none; }
.entry-morphology :deep(.parts) { margin: 8px 0 12px; }
.entry-morphology :deep(.hint) { font-size: 12px; font-weight: 500; }
.entry-morphology :deep(.part strong) { min-width: 0; font-size: 21px; }
.related-examples { margin-top: 15px; }
.related-examples > p { margin: 0 0 7px; color: var(--ink-soft); font-size: 11px; }
.related-examples > p > span { color: var(--ink-muted); }
.related-example { display: inline-block; font-size: 11px; color: var(--ink-soft); margin: 3px 12px 3px 0; }
.related-example > span { color: var(--ink-muted); }
.no-examples { margin: 5px 0; font-size: 12px; color: var(--ink-muted); }
.empty-card { text-align: center; }
.empty-card .muted { margin: 0 0 22px; font-size: 13px; }
.pagination { display: flex; justify-content: center; align-items: center; gap: 22px; margin-top: 24px; font-size: 12px; }
.pagination .btn { font-size: 12px; }
footer { margin-top: 28px; color: var(--ink-muted); font-size: 11px; line-height: 1.9; }
.source-notes { border-top: 1px solid var(--line); padding: 17px 2px 0; }
.source-notes summary { cursor: pointer; color: var(--ink-soft); }
.source-notes a { display: inline-block; margin: 0 7px; color: var(--ink-soft); text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 1100px) { .root-group { grid-template-columns: 145px minmax(0, 1fr); gap: 20px; } .entry strong { min-width: 90px; } }
@media (max-width: 640px) {
  .controls { padding: 19px; }
  .group-list { padding: 0 20px; }
  .root-group { grid-template-columns: 1fr; gap: 14px; padding: 24px 0; }
  .group-tip { max-width: 48ch; }
  .group-source { margin-top: 6px; }
  .entry strong { min-width: 90px; }
  .result-total, .recall-toggle > span { display: none; }
  .filter-tab { padding: 8px 14px; }
  .recall-toggle { min-height: 38px; }
  .entry > summary { gap: 12px; }
  .pagination { gap: 15px; }
}
</style>
