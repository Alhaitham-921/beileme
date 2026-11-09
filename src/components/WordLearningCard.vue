<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { http } from '../api/client.js'

const props = defineProps({ word: { type: Object, required: true }, initialContrast: Object, compact: Boolean })
const expanded = ref(false)
const card = ref(null), loading = ref(true), error = ref(''), aiLoading = ref(false), aiMessage = ref(''), aiCard = ref(null)
let controller = new AbortController(), aiController = null, alive = true, aiRun = 0
const baseline = computed(() => (props.word.examples || [props.word.example]).filter(Boolean).map(text => ({ text, source: 'wordbook' })))
const currentAi = computed(() => aiCard.value?.distinctions?.find(item => item.spelling?.toLowerCase() === props.word.spelling.toLowerCase()))
const hasChinese = value => typeof value === 'string' && /\p{Script=Han}/u.test(value)
const translations = ref(new Map())

function withTranslations(items, key) {
  return items.map(item => {
    if (hasChinese(item.translation)) return item
    const translation = translations.value.get(item[key]?.trim())
    return translation ? { ...item, translation, translationSource: 'ai' } : { ...item, translation: '' }
  })
}

const examples = computed(() => {
  const existing = card.value?.examples?.length ? card.value.examples : baseline.value
  const generated = currentAi.value
  const items = withTranslations(existing, 'text')
  if (generated?.example && hasChinese(generated.translation) && !items.some(item => item.translation)) {
    return [{ text: generated.example, translation: generated.translation, source: 'ai' },
      ...items.filter(item => item.text !== generated.example)].slice(0, 3)
  }
  return items
})
const collocations = computed(() => {
  const items = withTranslations([...(card.value?.collocations || []),
    ...(aiCard.value?.collocations || []).map(item => ({ ...item, source: 'ai' }))], 'phrase')
  items.sort((a, b) => Number(Boolean(b.translation)) - Number(Boolean(a.translation)))
  return items.filter((item, i) => items.findIndex(other => other.phrase.toLowerCase() === item.phrase.toLowerCase()) === i).slice(0, 4)
})
const missingTranslations = computed(() => [...new Set([
  ...examples.value.filter(item => !item.translation).map(item => item.text),
  ...collocations.value.filter(item => !item.translation).map(item => item.phrase),
].filter(value => typeof value === 'string').map(value => value.trim()).filter(value => value && value.length <= 320))].slice(0, 7))
const supplementLabel = computed(() => missingTranslations.value.length ? 'AI 补充中文译文' : 'AI 补充双语例句与搭配')
const needsSupplement = computed(() => !examples.value.length || !collocations.value.length ||
  examples.value.some(item => !item.translation) || collocations.value.some(item => !item.translation))
const contrasts = computed(() => card.value?.contrasts || props.initialContrast?.contrasts || [])
const formWords = computed(() => contrasts.value.filter(item => item.relationType === 'form'))
const meaningWords = computed(() => contrasts.value.filter(item => item.relationType === 'meaning'))
const label = source => ({ tatoeba: 'Tatoeba 英中语料', ai: 'AI 辅助内容', local: '背了么用法库', wordbook: '当前词书', dictionary: '免费词典' }[source] || '')
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null } catch { return null } }
// Render text segments with Vue escaping; never inject dictionary or AI HTML.
function segments(text) {
  const escaped = props.word.spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(text || '').split(new RegExp('(' + escaped + ')', 'ig')).map(part => ({ text: part, highlight: part.toLowerCase() === props.word.spelling.toLowerCase() }))
}
async function load() {
  controller.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = ''
  try {
    const path = '/words/' + props.word.id + '/learning-card'
    const options = { signal: request.signal, timeoutMs: 12000 }
    const local = await http.get(path, { ...options, query: { local: '1' } })
    if (request.signal.aborted) return
    card.value = local.card
    if (local.card.needsDictionary) {
      const remote = await http.get(path, options)
      if (!request.signal.aborted) card.value = remote.card
    }
  } catch (cause) { if (alive && !request.signal.aborted) error.value = cause.message || '用法资料暂时没加载成功。' }
  finally { if (alive && !request.signal.aborted) loading.value = false }
}
async function supplement() {
  if (aiLoading.value) return
  const run = ++aiRun
  const request = new AbortController(); aiController = request; aiLoading.value = true; aiMessage.value = ''
  try {
    const usageTexts = missingTranslations.value
    const data = await http.post('/content/error-cards', { body: { wordIds: [props.word.id], usageTexts }, signal: request.signal,
      timeoutMs: 120000, timeoutMessage: 'AI 补充超时，可重试；已有卡片和学习进度仍保留。' })
    if (!alive || run !== aiRun) return
    if (data.source === 'template') aiMessage.value = data.message || 'AI 服务当前不可用，已保留词库资料。'
    else {
      const found = Array.isArray(data.cards) ? data.cards.find(item => typeof item.spelling === 'string' && item.spelling.toLowerCase() === props.word.spelling.toLowerCase()) : null
      aiCard.value = found ? { ...found,
        distinctions: (Array.isArray(found.distinctions) ? found.distinctions : []).filter(item => typeof item.spelling === 'string' && typeof item.example === 'string'),
        collocations: (Array.isArray(found.collocations) ? found.collocations : []).filter(item => typeof item.phrase === 'string').slice(0, 4),
      } : null
      let translated = 0
      const updated = new Map(translations.value)
      for (const entry of Array.isArray(found?.usageTranslations) ? found.usageTranslations : []) {
        if (usageTexts.includes(entry?.text) && hasChinese(entry.translation)) {
          updated.set(entry.text, entry.translation)
          translated++
        }
      }
      translations.value = updated
      if (usageTexts.length) aiMessage.value = translated
        ? `已补充 ${translated} 条中文译文，译文由 AI 提供。`
        : '这次未返回对应的中文译文，已保留英文原文。'
      else aiMessage.value = (examples.value.some(item => item.source === 'ai' && item.translation) ||
        collocations.value.some(item => item.translation && item.source === 'ai'))
        ? '已补充双语用法资料，请结合语境核对。' : '这次未返回可展示的双语用法，可稍后重试。'
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
    <div v-if="compact && !expanded" class="usage-preview">
      <section>
        <h3>例句</h3>
        <template v-if="examples[0]">
          <p lang="en"><template v-for="(part,i) in segments(examples[0].text)" :key="i"><mark v-if="part.highlight">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></p>
          <p class="preview-translation">{{ examples[0].translation || '暂无中文译文' }}<small v-if="examples[0].translationSource === 'ai'"> · AI 译文</small></p>
          <p v-if="['dictionary', 'tatoeba'].includes(examples[0].source)" class="preview-credits">
            <a v-if="safeUrl(examples[0].sourceUrl)" :href="safeUrl(examples[0].sourceUrl)" target="_blank" rel="noopener noreferrer">{{ label(examples[0].source) }}</a>
            <template v-if="safeUrl(examples[0].translationUrl)"> · <a :href="safeUrl(examples[0].translationUrl)" target="_blank" rel="noopener noreferrer">译文</a></template>
            <template v-if="safeUrl(examples[0].license?.url)"> · <a :href="safeUrl(examples[0].license.url)" target="_blank" rel="noopener noreferrer">{{ examples[0].license.name }}</a></template>
          </p>
        </template>
        <p v-else class="preview-translation">{{ loading ? '正在读取例句…' : '暂未收录例句' }}</p>
      </section>
      <section>
        <h3>短语搭配</h3>
        <p v-if="collocations[0]"><strong lang="en">{{ collocations[0].phrase }}</strong><span class="preview-translation"> · {{ collocations[0].translation || '暂无中文译文' }}</span><small v-if="collocations[0].translationSource === 'ai'"> · AI 译文</small></p>
        <p v-else class="preview-translation">{{ loading ? '正在读取搭配…' : '暂未收录搭配' }}</p>
      </section>
      <section>
        <h3>形近词</h3>
        <p v-if="formWords[0]"><strong lang="en">{{ formWords[0].spelling }}</strong><span class="preview-translation"> · {{ formWords[0].definitions?.[0] || '暂无中文释义' }}</span></p>
        <p v-else class="preview-translation">{{ loading ? '正在读取形近词…' : '暂未找到可靠形近词' }}</p>
      </section>
    </div>
    <button v-if="compact" type="button" class="text-button usage-toggle" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起用法详情' : '更多用法与近义词' }}</button>
    <template v-if="!compact || expanded">
    <header class="usage-header"><div><span class="usage-eyebrow">学会认，也学会用</span><h2>单词用法</h2></div><span class="usage-spelling">{{ word.spelling }}</span></header>
    <section class="usage-section">
      <h3>例句</h3>
      <p v-if="loading && !examples.length" class="usage-hint" role="status">正在查找免费例句…</p>
      <div v-for="(example,index) in examples" :key="index" class="usage-example">
        <p class="english" lang="en"><template v-for="(part,i) in segments(example.text)" :key="i"><mark v-if="part.highlight">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></p>
        <p class="translation" lang="zh-CN">{{ example.translation || '暂无中文译文' }}<small v-if="example.translationSource === 'ai'"> · AI 译文</small></p>
        <p v-if="example.sense" class="usage-hint">此处词义（英）：{{ example.sense }}</p>
        <p class="attribution">{{ label(example.source) }}<template v-if="['dictionary', 'tatoeba'].includes(example.source)"> · <a v-if="safeUrl(example.sourceUrl)" :href="safeUrl(example.sourceUrl)" target="_blank" rel="noopener noreferrer">原文</a><template v-if="safeUrl(example.translationUrl)"> · <a :href="safeUrl(example.translationUrl)" target="_blank" rel="noopener noreferrer">译文</a></template> · <a v-if="safeUrl(example.license?.url)" :href="safeUrl(example.license.url)" target="_blank" rel="noopener noreferrer">{{ example.license.name }}</a></template></p>
      </div>
      <p v-if="!loading && !examples.length" class="usage-hint">暂未收录可靠例句，可选择下方 AI 补充。</p>
    </section>
    <section class="usage-section">
      <h3>短语搭配</h3>
      <ul v-if="collocations.length" class="phrase-list"><li v-for="(phrase,index) in collocations" :key="index"><strong lang="en">{{ phrase.phrase }}</strong><span lang="zh-CN">{{ phrase.translation || '暂无中文译文' }}<small v-if="phrase.translationSource === 'ai'"> · AI 译文</small></span><p v-if="phrase.source === 'dictionary'" class="attribution">词典用法片段<span v-if="phrase.sense"> · {{ phrase.sense }}</span> · <a v-if="safeUrl(phrase.sourceUrl)" :href="safeUrl(phrase.sourceUrl)" target="_blank" rel="noopener noreferrer">原词条</a> · <a v-if="safeUrl(phrase.license?.url)" :href="safeUrl(phrase.license.url)" target="_blank" rel="noopener noreferrer">{{ phrase.license.name }}</a></p></li></ul>
      <p v-else class="usage-hint">当前词库暂无搭配，可选择 AI 补充。</p>
      <p v-if="collocations.some(item => item.source === 'ai') || aiCard?.collocations?.length" class="attribution">AI 辅助内容，请结合语境核对。</p>
    </section>
    <section v-for="group in [{ title: '形近词 · 看清拼写', words: formWords }, { title: '近义词 · 对照词义', words: meaningWords }]" :key="group.title" class="usage-section">
      <h3>{{ group.title }}</h3>
      <p v-if="!group.words.length" class="usage-hint">{{ loading ? '正在读取易混词…' : '词库暂未找到可靠的对应词。' }}</p>
      <div v-for="related in group.words" :key="related.wordId" class="usage-contrast">
        <p class="contrast-heading"><span>{{ word.spelling }}</span><span class="versus">与</span><strong>{{ related.diff?.prefix }}<mark>{{ related.diff?.bMiddle || related.spelling }}</mark>{{ related.diff?.suffix }}</strong></p>
        <p><strong lang="en">{{ word.spelling }}</strong> <span lang="zh-CN">{{ word.definitions?.join('；') || '暂无中文释义' }}</span></p>
        <p><strong lang="en">{{ related.spelling }}</strong> <span lang="zh-CN">{{ related.definitions?.join('；') || '暂无中文释义' }}</span></p>
      </div>
      <p v-if="group.words.length && group.title.startsWith('近义')" class="usage-hint">意思接近不代表可以直接互换，注意词性和使用语境。</p>
    </section>
    <div v-if="error || card?.dictionaryUnavailable" class="usage-retry"><p role="status">{{ error || '免费词典暂时不可用，已有资料仍可查看。' }}</p><button type="button" class="text-button" :disabled="loading" @click="load">重新加载资料</button></div>
    </template>
    <footer v-if="needsSupplement || aiLoading || aiMessage" class="usage-footer" :class="{ 'usage-footer-compact': compact && !expanded }"><p v-if="!compact || expanded" class="usage-hint">免费资料优先。AI 补充仅在点击后调用，按当前 AI 服务计费，优先读取缓存。</p><button v-if="needsSupplement && !aiLoading" :disabled="loading" type="button" :class="compact && !expanded ? 'text-button' : 'btn btn-ghost'" @click="supplement">{{ supplementLabel }}<span v-if="compact && !expanded">（按服务计费）</span></button><div v-if="aiLoading" role="status">正在补充用法… <button type="button" class="text-button" @click="cancelAi">取消等待</button></div><p v-if="aiMessage" class="usage-hint" role="status">{{ aiMessage }}</p></footer>
  </section>
</template>

<style scoped>
.word-learning-card { margin-top:20px; padding:22px; border:1px solid var(--line); border-radius:16px; background:var(--bg); overflow-wrap:anywhere; }
.word-learning-card:has(.usage-toggle) { margin-top:12px; padding:12px; }
.usage-preview { display:grid; gap:8px; }
.usage-preview section + section { border-top:1px solid var(--line); padding-top:8px; }
.usage-preview h3 { font-size:12px; margin:0 0 3px; color:var(--accent-deep); }
.usage-preview p { margin:0; font-size:14px; line-height:1.42; }
.usage-preview .preview-translation { font-size:12px; color:var(--ink-soft); }
.usage-preview .preview-credits { font-size:10px; margin-top:2px; }
.usage-footer.usage-footer-compact { display:inline; border:0; padding:0; margin-left:8px; }
.usage-footer-compact button { min-height:36px; }
.usage-toggle { min-height:36px; margin-top:2px; }
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
