import { http } from '../api/client.js'

// Audio playback works in Android WebView without an installed system TTS engine.
let generation = 0
let currentAudio = null
let currentUrl = null
let settle = null
let requestController=null
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
  async speak(text, rate = 1, {onReady} = {}) {
    stop()
    const token = generation
    const content = String(text).trim()
    if (!content || content.length > 1500) throw new Error('请选择不超过 1500 个字符的英语句子朗读。')
    requestController=new AbortController()
    const data = await http.post('/tts/synthesize', {signal:requestController.signal,timeoutMs:95000,timeoutMessage:'朗读准备超时，请重试。', body: { text: content, rate: Math.max(0.5, Math.min(1.5, Number(rate) || 1)) } })
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
      audio.play().catch(() => finish(new Error('无法播放音频，请再次点击朗读。')))
    })
  },
}
