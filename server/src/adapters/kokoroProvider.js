import { ApiError } from '../utils/errors.js'

export function createKokoroProvider({ fetchImpl = fetch, url = process.env.KOKORO_URL || 'http://127.0.0.1:3003/synthesize' } = {}) {
  return { async synthesize(input) {
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input), signal: AbortSignal.timeout(90000), redirect: 'error' })
      if (!response.ok) throw new Error('Worker unavailable')
      const result = await response.json()
      if (!result.audioBase64 || result.mimeType !== 'audio/wav') throw new Error('Invalid audio response')
      return result
    } catch { throw new ApiError(503, 'TTS_UNAVAILABLE', '朗读服务暂时不可用，请稍后重试。') }
  } }
}
