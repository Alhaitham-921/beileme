import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { words, study } from '../api/index.js'

export function usePracticeWordPicker(selectedIds, update, { wordApi = words, studyApi = study, searchDelay = 250 } = {}) {
  const source = ref('mistakes'), search = ref(''), page = ref(1), total = ref(0), totalPages = ref(0)
  const list = ref([]), loading = ref(true), error = ref(''), cache = ref({})
  let version = 0, disposed = false, timer, todayWords
  const chosen = computed(() => selectedIds.value.map(id => cache.value[id] || { id }))
  const remember = items => items.forEach(word => { cache.value[word.id] = word })
  watch(selectedIds, async ids => {
    const missing = ids.filter(id => !cache.value[id])
    await Promise.allSettled(missing.map(async id => {
      try {
        const data = await wordApi.detail(id)
        if (!disposed) remember([data.word])
      } catch { /* A later successful list read can restore the word label. */ }
    }))
  }, { immediate: true })

  async function load() {
    const request = ++version, currentSource = source.value, term = search.value.trim(), currentPage = page.value
    clearTimeout(timer); loading.value = true; error.value = ''; list.value = []
    try {
      let data
      if (currentSource === 'wrong') {
        if (!todayWords) todayWords = (await studyApi.reviewToday()).wrongWords.map(w => ({ ...w, id: Number(w.wordId) }))
        const matches = todayWords.filter(word => `${word.spelling} ${(word.definitions || []).join(' ')}`.toLowerCase().includes(term.toLowerCase()))
        data = { items: matches.slice((currentPage - 1) * 30, currentPage * 30), total: matches.length, totalPages: Math.ceil(matches.length / 30) }
      } else {
        data = await wordApi.collection({ source: currentSource === 'saved' ? 'favorites' : 'mistakes', q: term, page: currentPage, size: 30 })
      }
      if (disposed || request !== version) return
      list.value = data.items; total.value = data.total; totalPages.value = data.totalPages
      remember(data.items)
    } catch (cause) {
      if (!disposed && request === version) { error.value = cause.message; total.value = 0; totalPages.value = 0 }
    } finally { if (!disposed && request === version) loading.value = false }
  }
  function selectSource(value) {
    if (!['mistakes', 'wrong', 'saved'].includes(value)) return
    source.value = value; search.value = ''; page.value = 1; void load()
  }
  function setSearch(value) {
    search.value = value; page.value = 1; clearTimeout(timer); version++; list.value = []; error.value = ''; loading.value = true
    timer = setTimeout(() => void load(), searchDelay)
  }
  function goPage(value) {
    if (loading.value || value < 1 || value > totalPages.value) return
    page.value = value; void load()
  }
  function toggle(id) {
    const ids = selectedIds.value
    if (ids.includes(id)) update(ids.filter(value => value !== id))
    else if (ids.length < 5) update([...ids, id])
  }
  onMounted(load)
  onBeforeUnmount(() => { disposed = true; version++; clearTimeout(timer) })
  return { source, search, page, total, totalPages, list, chosen, loading, error, load, selectSource, setSearch, goPage, toggle }
}
