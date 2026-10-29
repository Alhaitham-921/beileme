import { config } from '../config.js'
import { speechSettingsService } from './speechSettings.js'
import { ApiError, badRequest, quotaExceeded } from '../utils/errors.js'

const AUDIO_TYPES = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
}

export function speechJsonBodyLimit(settings = config.speech) {
  return Math.ceil(settings.maxBytes / 3) * 4 + 4096
}

function matchesContainer(bytes, extension) {
  if (bytes.length < 12) return false
  switch (extension) {
    case 'webm': return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    case 'mp4': return bytes.toString('ascii', 4, 8) === 'ftyp'
    case 'ogg': return bytes.toString('ascii', 0, 4) === 'OggS'
    case 'wav': return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
    case 'mp3': return bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    default: return false
  }
}

/** Reject malformed/oversized uploads before reserving quota or contacting a paid API. */
export function validateSpeechAudio(body, settings = config.speech) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('缺少录音内容')
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.split(';')[0].trim().toLowerCase() : ''
  const extension = AUDIO_TYPES[mimeType]
  if (!extension) throw new ApiError(415, 'SPEECH_FORMAT_UNSUPPORTED', '不支持此录音格式，请使用新版 Chrome、Edge、Safari 或 Firefox')
  if (!Number.isInteger(body.durationMs) || body.durationMs < 200 || body.durationMs > settings.maxSeconds * 1000) {
    throw badRequest(`每段录音应在 0.2 秒至 ${settings.maxSeconds} 秒之间`)
  }
  const base64 = body.audioBase64
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(settings.maxBytes / 3) * 4) {
    throw new ApiError(413, 'SPEECH_AUDIO_TOO_LARGE', '录音过大，请缩短后重试')
  }
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw badRequest('录音编码无效')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.toString('base64') !== base64) throw badRequest('录音编码无效')
  if (bytes.length > settings.maxBytes) throw new ApiError(413, 'SPEECH_AUDIO_TOO_LARGE', '录音过大，请缩短后重试')
  if (!matchesContainer(bytes, extension)) throw badRequest('录音内容与格式不符，请重新录制')
  return { bytes, mimeType, extension, durationMs: body.durationMs }
}

function providerUrl(settings) {
  let url
  try { url = new URL(settings.baseUrl) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
  return `${url.toString().replace(/\/+$/, '')}/audio/transcriptions`
}

/** Process-local quota: failed upstream attempts also consume quota to bound spend. */
export function createSpeechService({ settings = config.speech, now = Date.now, fetchImpl = (...args) => fetch(...args), budgets = new Map() } = {}) {
  function dayKey() {
    return new Date(now() + config.timezoneOffsetMinutes * 60000).toISOString().slice(0, 10)
  }
  function budgetFor(userId) {
    const day = dayKey()
    // Keep only today's counters; no recordings or transcripts are retained.
    for (const [key, entry] of budgets) if (entry.day !== day && !entry.active) budgets.delete(key)
    const key = String(userId)
    let budget = budgets.get(key)
    if (!budget || budget.day !== day) {
      budget = { day, used: 0, requests: [], active: false }
      budgets.set(key, budget)
    }
    return budget
  }
  function status(userId) {
    const configured = Boolean(settings.apiKey?.trim() && settings.model?.trim() && providerUrl(settings))
    const budget = budgetFor(userId)
    return {
      configured,
      reason: configured ? '' : '语音识别尚未开启，请联系管理员在「偏好设置 → 语音服务」配置共享服务。',
      maxBytes: settings.maxBytes,
      maxSeconds: settings.maxSeconds,
      dailyQuota: settings.dailyQuota,
      remaining: Math.max(0, settings.dailyQuota - budget.used),
      timeoutMs: settings.timeoutMs,
      acceptedMimeTypes: Object.keys(AUDIO_TYPES),
    }
  }
  async function transcribe(userId, body, { signal } = {}) {
    if (!status(userId).configured) throw new ApiError(503, 'SPEECH_NOT_CONFIGURED', status(userId).reason)
    const audio = validateSpeechAudio(body, settings)
    const budget = budgetFor(userId)
    budget.requests = budget.requests.filter((time) => time > now() - 60000)
    if (budget.active) throw quotaExceeded('上一段录音还在识别，请稍候')
    if (budget.used >= settings.dailyQuota) throw quotaExceeded('今日语音识别次数已用完，可以继续打字练习')
    if (budget.requests.length >= settings.perMinuteQuota) throw quotaExceeded('录音提交过于频繁，请稍后再试')
    budget.used += 1
    budget.requests.push(now())
    budget.active = true
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, settings.timeoutMs)
    try {
      const form = new FormData()
      form.append('file', new Blob([audio.bytes], { type: audio.mimeType }), `practice.${audio.extension}`)
      form.append('model', settings.model)
      // Do not force English: Chinese/English mixed speech must remain visible to the tutor.
      const response = await fetchImpl(providerUrl(settings), {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        body: form,
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        if (response.status === 429) throw new ApiError(503, 'SPEECH_PROVIDER_BUSY', '语音服务额度不足或正忙，请稍后重试，或继续打字')
        if ([400, 415, 422].includes(response.status)) throw new ApiError(502, 'SPEECH_PROVIDER_FORMAT', '语音服务无法读取此录音格式，请重新录音或继续打字')
        throw new ApiError(502, 'SPEECH_PROVIDER_ERROR', '语音识别服务暂时不可用，请稍后再试')
      }
      const result = await response.json().catch(() => null)
      if (typeof result?.text !== 'string' || result.text.length > 10000) {
        throw new ApiError(502, 'SPEECH_INVALID_RESPONSE', '语音识别结果不完整，请重新录音')
      }
      const text = result.text.trim()
      if (!text) throw badRequest('没有听清说话内容，请靠近麦克风重新录音')
      return { text, source: 'microphone', remaining: Math.max(0, settings.dailyQuota - budget.used) }
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (controller.signal.aborted) throw new ApiError(504, 'SPEECH_TIMEOUT', '语音识别超时，请重新录音或继续打字')
      throw new ApiError(502, 'SPEECH_PROVIDER_ERROR', '无法连接语音识别服务，请稍后重试')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      budget.active = false
    }
  }
  return { status, transcribe }
}

// 每次请求读取生效配置，管理员保存后立即生效；并发请求各自持有配置快照。
// 复用计数器，避免配置变化或创建服务实例时重置普通用户额度。
const sharedBudgets = new Map()
export const speechService = {
  async status(userId) {
    return createSpeechService({ settings: await speechSettingsService.effective(), budgets: sharedBudgets }).status(userId)
  },
  async transcribe(userId, body, options) {
    return createSpeechService({ settings: await speechSettingsService.effective(), budgets: sharedBudgets }).transcribe(userId, body, options)
  },
}
