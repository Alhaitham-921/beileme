import { ApiError } from '../utils/errors.js'
import { createKokoroProvider } from '../adapters/kokoroProvider.js'

export function createTtsService({ fetchImpl=fetch, provider = createKokoroProvider({fetchImpl}), now = Date.now } = {}) {
  const limits = new Map()
  let busy = false
  return { async synthesize(userId, input) {
    const time = now()
    for (const [key, value] of limits) if (time - value.start >= 60000) limits.delete(key)
    const key = String(userId), usage = limits.get(key) || { start: time, count: 0 }
    if (usage.count >= 20) throw new ApiError(429, 'TTS_RATE_LIMIT', '朗读点击过于频繁，请稍后再试。')
    if (busy) throw new ApiError(429, 'TTS_BUSY', '朗读服务正在处理其他请求，请稍后再试。')
    usage.count++; limits.set(key, usage); busy = true
    try { return await provider.synthesize(input) } finally { busy = false }
  } }
}
