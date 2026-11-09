import { BASE_URL, getAccessToken, http } from '../api/client.js'

// Audio playback works in Android WebView without an installed system TTS engine.
let generation = 0
let currentAudio = null
let currentUrl = null
let settle = null
let requestController=null
// Short word audio only: bounded, in-memory and scoped to API/login, never persistent recordings.
const wordAudioCache = new Map()
let preload = null

const canCache = text => /^[a-z][a-z '-]{0,79}$/i.test(text)
const audioKey = (text, rate) => JSON.stringify([BASE_URL, getAccessToken(), text, rate])
const normalizeRate = rate => Math.max(0.5, Math.min(1.5, Number(rate) || 1))

function cacheAudio(key, data) {
  if (!data?.audioBase64 || data.audioBase64.length > 400000) return
  wordAudioCache.delete(key)
  wordAudioCache.set(key, data)
  while (wordAudioCache.size > 24) wordAudioCache.delete(wordAudioCache.keys().next().value)
}

function requestAudio(text, rate, signal) {
  return http.post('/tts/synthesize', { signal, timeoutMs: 95000, timeoutMessage: '朗读准备超时，请重试。',
    body: { text, rate } })
}

function cancelPreload() {
  preload?.controller.abort()
  preload = null
}

function preloadWord(text, rate = 1) {
  const content = String(text || '').trim()
  if (!canCache(content) || !getAccessToken()) return
  rate = normalizeRate(rate)
  const key = audioKey(content, rate)
  if (wordAudioCache.has(key) || preload) return
  const controller = new AbortController()
  const job = { key, controller, promise: null }
  preload = job
  job.promise = requestAudio(content, rate, controller.signal).then(data => {
    if (!controller.signal.aborted && audioKey(content, rate) === key) cacheAudio(key, data)
    return data
  }).catch(() => null).finally(() => { if (preload === job) preload = null })
}

const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(new Error('Playback cancelled'))
  const abort = () => { clearTimeout(timer); reject(new Error('Playback cancelled')) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  signal.addEventListener('abort', abort, { once: true })
})
function stop() {
  generation += 1
  requestController?.abort();requestController=null
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.removeAttribute('src')
    currentAudio.load()
  }
  currentAudio = null
  if (currentUrl) URL.revokeObjectURL(currentUrl)
  currentUrl = null
  settle?.()
  settle = null
}
export const nativeSpeech = {
  isSupported: () => typeof Audio !== 'undefined',
  stop: async () => stop(),
  preloadWord,
  cancelPreload,
  clearCache() { cancelPreload(); wordAudioCache.clear() },
  async speak(text, rate = 1, {onReady} = {}) {
    stop()
    const token = generation
    const content = String(text).trim()
    if (!content || content.length > 1500) throw new Error('请选择不超过 1500 个字符的英语句子朗读。')
    requestController=new AbortController()
    const signal = requestController.signal
    const normalizedRate = normalizeRate(rate)
    const cacheable = canCache(content)
    const key = audioKey(content, normalizedRate)
    let data = cacheable ? wordAudioCache.get(key) : null
    if (!data && preload?.key === key) data = await preload.promise
    if (token !== generation) return
    if (!data) {
      // A cancelled word can leave Kokoro finishing its work. Briefly retry BUSY, never rate-limit errors.
      for (let attempt = 0; ; attempt++) {
        try {
          data = await requestAudio(content, normalizedRate, signal)
          break
        } catch (error) {
          if (token !== generation || signal.aborted) return
          if (error.code !== 'TTS_BUSY' || attempt >= 3) throw error
          await delay(600, signal)
        }
      }
      if (token !== generation) return
    }
    if (cacheable && audioKey(content, normalizedRate) === key) cacheAudio(key, data)
    if (token !== generation) return
    onReady?.()
    const bytes = Uint8Array.from(atob(data.audioBase64), ch => ch.charCodeAt(0))
    currentUrl = URL.createObjectURL(new Blob([bytes], { type: data.mimeType }))
    const audio = new Audio(currentUrl)
    currentAudio = audio
    await new Promise((resolve, reject) => {
      const finish = error => {
        if (token === generation) {
          settle = null
          stop()
        }
        error ? reject(error) : resolve()
      }
      settle = resolve
      audio.onended = () => finish()
      audio.onerror = () => finish(new Error('音频播放失败，请重试。'))
      audio.play().catch(cause => {
        const error = new Error(cause?.name === 'NotAllowedError'
          ? '浏览器限制了自动发音，请点一下喇叭开始播放；也可关闭自动发音。'
          : '无法播放音频，请点击喇叭重试。')
        finish(error)
      })
    })
  },
}
