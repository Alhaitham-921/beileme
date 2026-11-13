<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { http } from '../api/client.js'
import { buildImageRecallRounds, matchesImageRecall } from '../utils/imageRecall.js'
import { loadMemoryImage } from '../utils/memoryImageAssets.js'

const loading = ref(true)
const loadError = ref('')
const source = ref('examples')
const saved = ref([])
const replacements = ref([])
const rounds = ref([])
const run = ref(0)
const index = ref(0)
const selected = ref([])
const revealed = ref(false)
const results = ref([])
const images = reactive(new Map())
const heading = ref(null)
const editor = ref(null)
const editorHeading = ref(null)
const showEditor = ref(false)
const pictureKey = ref('')
const learnerCue = ref('')
const replacing = ref(false)
const replacementMessage = ref('')
const replacementError = ref(false)
let requests = new AbortController()
const libraryRequest = new AbortController()
const pending = new Set()
let pollTimer
let stopPoll

const round = computed(() => rounds.value[index.value])
const isMultipleChoice = computed(() => (round.value?.options.filter(option => option.correct).length ?? 0) > 1)
const score = computed(() => results.value.filter(result => result === true).length)
const skipped = computed(() => results.value.filter(result => result === null).length)
const assetKey = option => option.imagePath || option.key
const assetFor = option => images.get(assetKey(option))
const ready = computed(() => round.value?.options.every(option => assetFor(option)?.ready))
const failed = computed(() => round.value?.options.some(option => assetFor(option)?.failed))
const editedPicture = computed(() => round.value?.options.find(option => option.key === pictureKey.value))

function resetImages() {
  requests.abort()
  requests = new AbortController()
  pending.clear()
  for (const asset of images.values()) if (asset.owned) URL.revokeObjectURL(asset.url)
  images.clear()
}

function loadOption(option) {
  const key = assetKey(option)
  if (pending.has(key) || images.get(key)?.url) return
  const signal = requests.signal
  pending.add(key)
  images.delete(key)
  void (async () => {
    try {
      const url = option.url || await loadMemoryImage(option.imagePath, signal)
      if (signal.aborted) {
        if (!option.url) URL.revokeObjectURL(url)
        return
      }
      images.set(key, { url, owned: !option.url, ready: false })
    } catch {
      if (!signal.aborted) images.set(key, { failed: true })
    } finally {
      if (!signal.aborted) pending.delete(key)
    }
  })()
}

function markFailed(option) {
  const asset = assetFor(option)
  if (asset?.owned) URL.revokeObjectURL(asset.url)
  images.set(assetKey(option), { failed: true })
}

function prepare(current) {
  current?.options.forEach(loadOption)
}
watch(round, prepare)
watch(ready, value => {
  if (value) prepare(rounds.value[index.value + 1])
})

async function start(mode, focus = true) {
  resetImages()
  run.value++
  source.value = mode
  index.value = 0
  results.value = []
  selected.value = []
  revealed.value = false
  closeEditor()
  rounds.value = buildImageRecallRounds(mode === 'personal' ? saved.value : [], Math.random, replacements.value)
  await nextTick()
  if (focus) heading.value?.focus()
}

async function load() {
  loading.value = true
  loadError.value = ''
  const signal = libraryRequest.signal
  try {
    const data = await http.get('/words/memory-images', { signal, timeoutMs: 7000 })
    if (signal.aborted) return
    saved.value = data.items
    for (const replacement of data.replacements || []) applyExampleReplacement(replacement)
  } catch {
    if (signal.aborted) return
    loadError.value = '暂时没能读取你的记忆图，可以先用内置图片练习。'
  } finally {
    if (!signal.aborted) loading.value = false
  }
}

function toggle(key) {
  if (revealed.value || !ready.value) return
  selected.value = selected.value.includes(key) ? selected.value.filter(item => item !== key) : [...selected.value, key]
}

function submit() {
  if (!ready.value || !selected.value.length || revealed.value) return
  results.value.push(matchesImageRecall(round.value, selected.value))
  revealed.value = true
}

async function advance() {
  if (!revealed.value) results.value.push(null)
  selected.value = []
  revealed.value = false
  closeEditor()
  index.value++
  await nextTick()
  heading.value?.focus()
}

function closeEditor() {
  showEditor.value = false
  pictureKey.value = ''
  learnerCue.value = ''
}

async function openEditor() {
  showEditor.value = true
  await nextTick()
  editorHeading.value?.focus()
}

async function choosePicture(key) {
  pictureKey.value = key
  learnerCue.value = ''
  await nextTick()
  editor.value?.scrollIntoView({ block: 'nearest' })
}

function replaceInRounds(matches, update) {
  for (const item of rounds.value) {
    for (const option of item.options) {
      if (!matches(option) || option.imagePath === update.imagePath) continue
      const oldKey = assetKey(option)
      Object.assign(option, update, { url: undefined })
      const oldImage = images.get(oldKey)
      if (oldImage?.owned) URL.revokeObjectURL(oldImage.url)
      images.delete(oldKey)
      if (item === round.value) loadOption(option)
    }
  }
}

function applyExampleReplacement(replacement) {
  replacements.value = [
    ...replacements.value.filter(item => item.exampleKey !== replacement.exampleKey), replacement,
  ]
  replaceInRounds(option => option.key === replacement.exampleKey, {
    imagePath: replacement.imagePath, explanation: replacement.explanation,
  })
}

function applyWordReplacement(picture, card) {
  const update = { imagePath: card.imagePath + '/tile', explanation: card.explanation }
  const matches = item => item.wordId === picture.wordId && item.sense === picture.sense
  saved.value = saved.value.map(item => matches(item) ? { ...item, ...update } : item)
  replaceInRounds(matches, update)
}

function waitToPoll() {
  return new Promise(resolve => {
    stopPoll = resolve
    pollTimer = setTimeout(resolve, 2000)
  })
}

async function replacePicture() {
  const picture = editedPicture.value
  if (!picture || replacing.value) return
  const isExample = picture.key.startsWith('example-')
  const path = isExample ? `/words/memory-images/examples/${picture.key}` : `/words/${picture.wordId}/memory-image`
  const query = isExample ? undefined : { sense: picture.sense }
  const body = { learnerCue: learnerCue.value.trim() || undefined }
  if (!isExample) Object.assign(body, { sense: picture.sense, regenerate: true })
  const signal = libraryRequest.signal
  const options = { signal, timeoutMs: 8000 }
  replacing.value = true
  replacementError.value = false
  replacementMessage.value = `正在为 ${picture.spelling} 生成新图，可以继续答题。`
  try {
    await http.post(path, { ...options, body })
    const deadline = Date.now() + 200_000
    let failures = 0
    while (!signal.aborted && Date.now() < deadline) {
      await waitToPoll()
      if (signal.aborted) return
      let card
      try {
        card = await http.get(path, { ...options, query })
        failures = 0
      } catch (error) {
        if (++failures >= 3 || (error.status > 0 && error.status < 500)) throw error
        continue
      }
      const status = isExample ? card : card.selected
      if (status?.status === 'pending') continue
      if (status?.status !== 'ready' || status.generationError || !card.imagePath) {
        throw new Error('这次没能生成新图，原图已保留。')
      }
      if (isExample) applyExampleReplacement(card)
      else applyWordReplacement(picture, card)
      if (pictureKey.value === picture.key) learnerCue.value = ''
      replacementMessage.value = `${picture.spelling} 的图片已更新。`
      return
    }
    if (!signal.aborted) throw new Error('等待超时。生成可能仍在后台进行，下次打开时会读取最新图片。')
  } catch (error) {
    if (!signal.aborted) {
      replacementError.value = true
      replacementMessage.value = error.message
    }
  } finally {
    replacing.value = false
  }
}

onMounted(() => {
  void start('examples', false)
  void load()
})
onBeforeUnmount(() => {
  libraryRequest.abort()
  clearTimeout(pollTimer)
  stopPoll?.()
  resetImages()
})
</script>

<template>
  <section class="image-recall" aria-labelledby="image-recall-title">
    <router-link class="text-button" to="/review">返回今日回顾</router-link>
    <header class="recall-heading">
      <h1 id="image-recall-title" class="section-title">看图回忆</h1>
      <p class="section-sub">从九张图中选出能表示这个单词的所有图片。</p>
    </header>

    <template v-if="round || !loading">
      <div class="recall-source">
        <span>{{ source === 'personal' ? '我的记忆图' : '内置练习' }}</span>
        <button v-if="saved.length" class="text-button" @click="start(source === 'personal' ? 'examples' : 'personal')">
          {{ source === 'personal' ? '试试内置练习' : '用我的记忆图练习' }}
        </button>
        <span v-else-if="loading" role="status">正在查找我的记忆图…</span>
        <button v-else-if="loadError" class="text-button" @click="load">重新读取记忆图</button>
        <router-link v-else class="text-button" to="/notebooks?source=mistakes">去错题本生成记忆图</router-link>
      </div>
      <p v-if="loadError" class="muted" role="status">{{ loadError }}</p>

      <template v-if="round">
        <div class="round-heading">
          <h2 ref="heading" tabindex="-1" lang="en">{{ round.spelling }}</h2>
          <div class="round-meta">
            <span v-if="isMultipleChoice" class="round-type">多选</span>
            <span>第 {{ index + 1 }} / {{ rounds.length }} 题</span>
          </div>
        </div>
        <div :key="run" class="picture-grid" role="group" :aria-label="round.spelling + ' 的图片选项'">
          <button v-for="(option, position) in round.options" :key="option.key" type="button" class="picture-tile"
            :class="{ picked: selected.includes(option.key), correct: revealed && option.correct,
              incorrect: revealed && !option.correct && selected.includes(option.key) }"
            :disabled="!ready || revealed" :aria-pressed="selected.includes(option.key)"
            :aria-label="revealed ? `图片 ${position + 1}：${option.spelling}，${option.sense}${option.correct ? '，正确选项' : '，干扰项'}` : `图片 ${position + 1}`"
            @click="toggle(option.key)">
            <img v-if="assetFor(option)?.url" :key="assetKey(option)" :src="assetFor(option).url" alt="" width="256" height="256"
              decoding="async" @load="assetFor(option) && (assetFor(option).ready = true)" @error="markFailed(option)">
            <span v-else class="picture-placeholder">{{ assetFor(option)?.failed ? '加载失败' : '正在加载' }}</span>
            <span class="tile-mark" aria-hidden="true">{{ revealed && option.correct ? '✓' : revealed && selected.includes(option.key) ? '×' : selected.includes(option.key) ? '✓' : position + 1 }}</span>
            <span v-if="revealed" class="tile-caption">
              <strong class="tile-word" lang="en">{{ option.spelling }}</strong>
              <span class="tile-sense">{{ option.sense }}</span>
            </span>
          </button>
        </div>
        <div class="round-controls">
          <p v-if="revealed" role="status">{{ results.at(-1) ? '全部选对了。' : '带 ✓ 的图是正确选项。' }}</p>
          <p v-else-if="failed" role="status">有图片没有加载成功。 <button class="text-button" @click="prepare(round)">重试图片</button></p>
          <p v-else-if="!ready" role="status">正在加载本题图片…</p>
          <p v-else role="status">已选 {{ selected.length }} 张</p>
          <button v-if="!revealed" class="text-button skip" @click="advance">跳过</button>
          <button v-if="!revealed" class="btn btn-primary" :disabled="!ready || !selected.length" @click="submit">确认选择</button>
          <button v-else class="btn btn-primary" @click="advance">{{ index + 1 === rounds.length ? '查看结果' : '下一题' }}</button>
        </div>
        <ul v-if="revealed" class="scene-notes">
          <li v-for="option in round.options.filter(item => item.correct)" :key="option.key">
            <strong>{{ option.sense }}</strong><span v-if="option.explanation">{{ option.explanation }}</span>
          </li>
        </ul>
      </template>
      <div v-else class="card recall-finish">
        <template v-if="rounds.length">
          <h2 ref="heading" tabindex="-1">本组完成</h2>
          <p>答对 {{ score }} / {{ rounds.length - skipped }} 题<span v-if="skipped">，跳过 {{ skipped }} 题</span>。</p>
          <button class="btn btn-primary" @click="start(source)">再练一组</button>
        </template>
        <template v-else>
          <h2 ref="heading" tabindex="-1">暂时组不出合适的题</h2>
          <p>可以试试内置练习，或在错题本多保存几张不同释义的图。</p>
          <button class="btn btn-primary" @click="start('examples')">开始内置练习</button>
        </template>
      </div>
    </template>

    <section v-if="round || replacementMessage" class="picture-help">
      <button v-if="round" type="button" class="text-button help-toggle" :aria-expanded="showEditor"
        aria-controls="recall-image-editor" @click="showEditor ? closeEditor() : openEditor()">对图片有疑问</button>
      <p v-if="replacementMessage" :class="{ 'replacement-error': replacementError }" role="status">{{ replacementMessage }}</p>
      <div v-if="showEditor && round" id="recall-image-editor" ref="editor" class="card picture-editor">
        <h3 ref="editorHeading" tabindex="-1">选一张想更换的图</h3>
        <div class="editor-grid" role="group" aria-label="选择要更换的图片">
          <button v-for="(option, position) in round.options" :key="option.key" type="button" class="editor-tile"
            :aria-pressed="option.key === pictureKey" :aria-label="'更换图片 ' + (position + 1)" @click="choosePicture(option.key)">
            <img v-if="assetFor(option)?.url" :src="assetFor(option).url" alt="" width="64" height="64">
            <span>{{ position + 1 }}</span>
          </button>
        </div>
        <form v-if="editedPicture" class="replacement-form" @submit.prevent="replacePicture">
          <p class="replacement-word"><strong lang="en">{{ editedPicture.spelling }}</strong> · {{ editedPicture.sense }}</p>
          <label for="recall-learner-cue">补充你的理解（可选）</label>
          <textarea id="recall-learner-cue" v-model="learnerCue" maxlength="300" rows="3"
            placeholder="可以写一个生活场景，或说说你希望图里突出什么。" />
          <button type="submit" class="btn btn-secondary" :disabled="replacing">
            {{ replacing ? '正在生成…' : learnerCue.trim() ? '按我的理解生成' : '重新生成图片' }}
          </button>
        </form>
      </div>
    </section>
  </section>
</template>

<style scoped>
.image-recall { max-width: 540px; margin-inline: auto; padding-bottom: 24px; }
.recall-heading { margin: 14px 0 20px; }
.recall-heading p { margin-bottom: 0; }
.recall-source, .round-heading, .round-controls { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.recall-source { border-bottom: 1px solid var(--line); padding-bottom: 9px; color: var(--ink-soft); font-size: 12px; }
.round-heading { align-items: baseline; margin: 12px 0; color: var(--ink-soft); }
.round-heading h2 { margin: 0; font: 500 clamp(27px, 6vw, 39px)/1.15 var(--serif); color: var(--ink); overflow-wrap: anywhere; }
.round-meta { display: flex; flex: none; align-items: center; gap: 8px; font-size: 12px; }
.round-type { padding: 2px 7px; border-radius: 5px; background: var(--accent-soft); color: var(--accent-deep); font-weight: 600; }
.picture-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(5px, 1.5vw, 10px); }
.picture-tile { display: flex; flex-direction: column; align-items: stretch; position: relative; border: 2px solid transparent; border-radius: 9px; padding: 0; background: var(--bg-card); overflow: hidden; }
.picture-tile:disabled { opacity: 1; }
.picture-tile:not(:disabled):hover, .picture-tile.picked { border-color: var(--accent); }
.picture-tile.correct { border-color: var(--color-success, #44865e); }
.picture-tile.incorrect { border-color: var(--bad); }
.picture-tile img, .picture-placeholder { display: block; width: 100%; height: auto; aspect-ratio: 1; object-fit: contain; background: #e9e1d7; }
.picture-placeholder { display: grid; place-items: center; background: var(--accent-soft); color: var(--ink-soft); font-size: 11px; }
.tile-mark { position: absolute; top: 4px; left: 4px; min-width: 19px; height: 19px; display: grid; place-items: center; border-radius: 50%; background: #514b47; color: white; font-size: 11px; }
.picked .tile-mark { background: var(--accent); color: var(--on-accent); }
.correct .tile-mark { background: #286447; color: white; }
.incorrect .tile-mark { background: #a83837; color: white; }
.tile-caption { display: grid; gap: 2px; padding: 5px 4px; line-height: 1.4; overflow-wrap: anywhere; }
.tile-word { font-size: 13px; }
.tile-sense { color: var(--ink-soft); font-size: 12px; }
.round-controls { justify-content: flex-end; flex-wrap: wrap; margin-top: 12px; }
.round-controls p { margin: 0 auto 0 0; font-size: 12px; }
.round-controls .btn { min-height: 44px; }
.skip { min-height: 44px; padding: 8px 10px; border: 0; background: transparent; }
.scene-notes { list-style: none; margin: 14px 0 0; padding: 0; border-top: 1px solid var(--line); }
.scene-notes li { padding: 6px 0; }
.scene-notes span { margin-left: 8px; color: var(--ink-soft); }
.recall-finish { margin-top: 20px; }
.picture-help { margin-top: 18px; padding-top: 8px; border-top: 1px solid var(--line); }
.help-toggle { min-height: 44px; border: 0; padding: 0; background: transparent; }
.picture-help > p { margin: 4px 0 10px; color: var(--ink-soft); }
.picture-help > .replacement-error { color: var(--bad); }
.picture-editor { padding: 14px; }
.picture-editor h3 { margin: 0 0 10px; font-size: 15px; }
.editor-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(44px, 1fr)); gap: 5px; }
.editor-tile { position: relative; padding: 0; min-height: 44px; aspect-ratio: 1; border: 2px solid var(--line); border-radius: 6px; background: var(--bg-card); overflow: hidden; }
.editor-tile[aria-pressed='true'] { border-color: var(--accent); }
.editor-tile img { display: block; width: 100%; height: 100%; object-fit: contain; background: #e9e1d7; }
.editor-tile span { position: absolute; bottom: 2px; left: 2px; min-width: 17px; padding-inline: 2px; border-radius: 4px; background: #514b47; color: white; font-size: 11px; }
.replacement-form { display: grid; justify-items: start; gap: 8px; margin-top: 14px; }
.replacement-word { margin: 0; overflow-wrap: anywhere; }
.replacement-form textarea { width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 8px; resize: vertical; }
</style>
