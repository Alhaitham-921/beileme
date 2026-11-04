<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { http } from '../api/client.js'

const props = defineProps({ word: { type: Object, required: true }, initialContrast: Object })
const card = ref(null), loading = ref(true), error = ref(''), aiLoading = ref(false), aiMessage = ref(''), aiCard = ref(null)
let controller = new AbortController(), aiController = null, alive = true, aiRun = 0
const baseline = computed(() => (props.word.examples || [props.word.example]).filter(Boolean).map(text => ({ text, source: 'wordbook' })))
const currentAi = computed(() => aiCard.value?.distinctions?.find(item => item.spelling?.toLowerCase() === props.word.spelling.toLowerCase()))
const examples = computed(() => currentAi.value?.example
  ? [{ text: currentAi.value.example, translation: currentAi.value.translation, source: 'ai' }]
  : (card.value?.examples?.length ? card.value.examples : baseline.value))
const collocations = computed(() => aiCard.value?.collocations?.length ? aiCard.value.collocations : (card.value?.collocations || []))
const contrasts = computed(() => card.value?.contrasts || props.initialContrast?.contrasts || [])
const formWords = computed(() => contrasts.value.filter(item => item.relationType === 'form'))
const meaningWords = computed(() => contrasts.value.filter(item => item.relationType === 'meaning'))
const label = source => ({ ai: 'AI 辅助内容', local: '背了么用法库', wordbook: '当前词书', dictionary: '免费词典' }[source] || '')
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null } catch { return null } }
// Render text segments with Vue escaping; never inject dictionary or AI HTML.
function segments(text) {
  const escaped = props.word.spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(text || '').split(new RegExp('(' + escaped + ')', 'ig')).map(part => ({ text: part, highlight: part.toLowerCase() === props.word.spelling.toLowerCase() }))
}
async function load() {
  controller.abort(); controller = new AbortController(); loading.value = true; error.value = ''
  try {
    const data = await http.get('/words/' + props.word.id + '/learning-card', { signal: controller.signal, timeoutMs: 12000 })
    if (alive) card.value = data.card
  } catch (cause) { if (alive && !controller.signal.aborted) error.value = cause.message || '用法资料暂时没加载成功。' }
  finally { if (alive) loading.value = false }
}
async function supplement() {
  if (aiLoading.value) return
  const run = ++aiRun
  const request = new AbortController(); aiController = request; aiLoading.value = true; aiMessage.value = ''
  try {
    const data = await http.post('/content/error-cards', { body: { wordIds: [props.word.id] }, signal: request.signal,
      timeoutMs: 120000, timeoutMessage: 'AI 补充超时，可重试；已有卡片和学习进度仍保留。' })
    if (!alive || run !== aiRun) return
    if (data.source === 'template') aiMessage.value = data.message || 'AI 服务当前不可用，已保留词库资料。'
    else {
      const found = Array.isArray(data.cards) ? data.cards.find(item => typeof item.spelling === 'string' && item.spelling.toLowerCase() === props.word.spelling.toLowerCase()) : null
      aiCard.value = found ? { ...found,
        distinctions: (Array.isArray(found.distinctions) ? found.distinctions : []).filter(item => typeof item.spelling === 'string' && typeof item.example === 'string'),
        collocations: (Array.isArray(found.collocations) ? found.collocations : []).filter(item => typeof item.phrase === 'string').slice(0, 4),
      } : null
      aiMessage.value = data.cached ? '已读取之前生成的内容。' : '已补充 AI 例句与搭配，请结合释义核对。'
      if (!aiCard.value) aiMessage.value = '这次未返回该词的用法内容，可稍后重试。'
    }
  } catch (cause) { if (alive && run === aiRun && !request.signal.aborted) aiMessage.value = cause.message }
  finally { if (alive && run === aiRun) aiLoading.value = false }
}
function cancelAi() { aiRun++; aiController?.abort(); aiLoading.value = false; aiMessage.value = '已取消等待。后台可能继续生成，重试会优先读取缓存。' }
void load()
onBeforeUnmount(() => { alive = false; controller.abort(); aiController?.abort() })
</script>

<template>
  <section class="word-learning-card" aria-label="单词用法卡片">
    <header class="usage-header"><div><span class="usage-eyebrow">学会认，也学会用</span><h2>单词用法</h2></div><span class="usage-spelling">{{ word.spelling }}</span></header>
    <section class="usage-section">
      <h3>例句</h3>
      <p v-if="loading && !examples.length" class="usage-hint" role="status">正在查找免费例句…</p>
      <div v-for="(example,index) in examples" :key="index" class="usage-example">
        <p class="english"><template v-for="(part,i) in segments(example.text)" :key="i"><mark v-if="part.highlight">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></p>
        <p v-if="example.translation" class="translation">{{ example.translation }}</p>
        <p v-if="example.sense" class="usage-hint">此处词义（英）：{{ example.sense }}</p>
        <p class="attribution">{{ label(example.source) }}<template v-if="example.source === 'dictionary'"> · <a v-if="safeUrl(example.sourceUrl)" :href="safeUrl(example.sourceUrl)" target="_blank" rel="noopener noreferrer">原词条</a> · <a v-if="safeUrl(example.license?.url)" :href="safeUrl(example.license.url)" target="_blank" rel="noopener noreferrer">{{ example.license.name }}</a></template></p>
      </div>
      <p v-if="!loading && !examples.length" class="usage-hint">暂未收录可靠例句，可选择下方 AI 补充。</p>
    </section>
    <section class="usage-section">
      <h3>短语搭配</h3>
      <ul v-if="collocations.length" class="phrase-list"><li v-for="(phrase,index) in collocations" :key="index"><strong>{{ phrase.phrase }}</strong><span>{{ phrase.translation }}</span><p v-if="phrase.source === 'dictionary'" class="attribution">词典用法片段<span v-if="phrase.sense"> · {{ phrase.sense }}</span> · <a v-if="safeUrl(phrase.sourceUrl)" :href="safeUrl(phrase.sourceUrl)" target="_blank" rel="noopener noreferrer">原词条</a> · <a v-if="safeUrl(phrase.license?.url)" :href="safeUrl(phrase.license.url)" target="_blank" rel="noopener noreferrer">{{ phrase.license.name }}</a></p></li></ul>
      <p v-else class="usage-hint">当前词库暂无搭配，可选择 AI 补充。</p>
      <p v-if="collocations.some(item => item.source === 'ai') || aiCard?.collocations?.length" class="attribution">AI 辅助内容，请结合语境核对。</p>
    </section>
    <section v-for="group in [{ title: '形近词 · 看清拼写', words: formWords }, { title: '近义词 · 对照词义', words: meaningWords }]" :key="group.title" class="usage-section">
      <h3>{{ group.title }}</h3>
      <p v-if="!group.words.length" class="usage-hint">{{ loading ? '正在读取易混词…' : '词库暂未找到可靠的对应词。' }}</p>
      <div v-for="related in group.words" :key="related.wordId" class="usage-contrast">
        <p class="contrast-heading"><span>{{ word.spelling }}</span><span class="versus">与</span><strong>{{ related.diff?.prefix }}<mark>{{ related.diff?.bMiddle || related.spelling }}</mark>{{ related.diff?.suffix }}</strong></p>
        <p>{{ word.spelling }}：{{ word.definitions?.join('；') }}</p><p>{{ related.spelling }}：{{ related.definitions?.join('；') }}</p>
      </div>
      <p v-if="group.words.length && group.title.startsWith('近义')" class="usage-hint">意思接近不代表可以直接互换，注意词性和使用语境。</p>
    </section>
    <div v-if="error || card?.dictionaryUnavailable" class="usage-retry"><p role="status">{{ error || '免费词典暂时不可用，已有资料仍可查看。' }}</p><button type="button" class="text-button" :disabled="loading" @click="load">重新加载资料</button></div>
    <footer class="usage-footer"><p class="usage-hint">免费资料优先。AI 补充仅在点击后调用，按当前 AI 服务计费，优先读取缓存。</p><button v-if="!aiLoading" type="button" class="btn btn-ghost" @click="supplement">{{ aiCard ? '重新读取 AI 补充' : 'AI 补充例句与搭配' }}</button><div v-else role="status">正在补充用法… <button type="button" class="text-button" @click="cancelAi">取消等待</button></div><p v-if="aiMessage" class="usage-hint" role="status">{{ aiMessage }}</p></footer>
  </section>
</template>

<style scoped>
.word-learning-card { margin-top:20px; padding:22px; border:1px solid var(--line); border-radius:16px; background:var(--bg); overflow-wrap:anywhere; }
.usage-header { display:flex; justify-content:space-between; align-items:center; gap:16px; padding-bottom:16px; }
.usage-eyebrow,.usage-hint,.attribution { color:var(--ink-soft); font-size:13px; line-height:1.7; }
h2 { margin:5px 0 0; font-size:21px; } .usage-spelling { color:var(--accent-deep); font-family:var(--serif); font-size:21px; }
.usage-section { border-top:1px solid var(--line); padding:16px 0; } h3 { font-size:15px; margin:0 0 12px; font-weight:650; }
.english { font-size:17px; line-height:1.8; margin:0 0 6px; } mark { background:var(--accent-soft); color:var(--accent-deep); border-radius:3px; padding:0 2px; }
.translation { margin:0; font-size:14px; line-height:1.7; color:var(--ink-soft); } .attribution { font-size:11px; margin:6px 0 0; } a { color:var(--ink-soft); text-decoration:underline; }
.usage-example + .usage-example { margin-top:16px; } .phrase-list { list-style:none; padding:0; margin:0; display:grid; gap:10px; }
.phrase-list li { display:flex; flex-wrap:wrap; gap:6px 16px; align-items:baseline; padding:10px 12px; border-radius:8px; border:1px solid var(--line); }
.phrase-list .attribution { flex-basis:100%; }
.phrase-list strong { font-size:16px; } .phrase-list span,.usage-contrast p { color:var(--ink-soft); font-size:14px; line-height:1.7; }
.usage-contrast { margin:10px 0; padding:12px; border-left:2px solid var(--accent-deep); } .usage-contrast p { margin:4px 0; }
.contrast-heading { display:flex; flex-wrap:wrap; gap:10px; align-items:baseline; } .versus { font-size:12px; }
.usage-footer { border-top:1px solid var(--line); padding-top:14px; } .usage-footer .btn { min-height:44px; width:100%; white-space:normal; }
.usage-retry p { font-size:13px; } .usage-hint { margin:8px 0; }
@media(max-width:600px) { .word-learning-card { padding:16px; } .usage-spelling { display:none; } .english { font-size:16px; } }
</style>
