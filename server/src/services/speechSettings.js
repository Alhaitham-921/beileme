import { z } from 'zod'
import { config } from '../config.js'
import { queryOne, execute } from '../db/pool.js'
import { encryptSecret, decryptSecret } from './ai/cryptoKeys.js'
import { ApiError, badRequest } from '../utils/errors.js'

export const SPEECH_PROVIDER_URL = 'https://api.siliconflow.cn/v1'
export const SPEECH_MODEL = 'FunAudioLLM/SenseVoiceSmall'
const schema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().trim().max(4096).optional().default(''),
  dailyQuota: z.number().int().min(1).max(1000),
  perMinuteQuota: z.number().int().min(1).max(60),
}).strict()

// 单行共享设置，不属于任何普通用户的个人 Key。只返回配置状态，不返回明文或密文。
export function createSpeechSettingsService({ read = queryOne, write = execute, defaults = config.speech,
  encrypt = encryptSecret, decrypt = decryptSecret, fetchImpl = (...args) => fetch(...args) } = {}) {
  async function effective({ includeDisabledKey = false } = {}) {
    const row = await read('SELECT * FROM shared_speech_settings WHERE id = 1')
    if (!row) return { ...defaults, source: 'environment' }
    return { ...defaults, apiKey: row.enabled || includeDisabledKey ? decrypt(row.api_key_cipher) || '' : '',
      baseUrl: SPEECH_PROVIDER_URL, model: SPEECH_MODEL, dailyQuota: Number(row.daily_quota),
      perMinuteQuota: Number(row.per_minute_quota), source: 'administrator', enabled: Boolean(row.enabled) }
  }
  async function publicSettings() {
    const value = await effective({ includeDisabledKey: true })
    return { enabled: value.enabled ?? Boolean(value.apiKey), keyConfigured: Boolean(value.apiKey),
      provider: '硅基流动', model: SPEECH_MODEL, baseUrl: SPEECH_PROVIDER_URL,
      dailyQuota: value.dailyQuota, perMinuteQuota: value.perMinuteQuota, source: value.source }
  }
  async function prepare(body) {
    const result = schema.safeParse(body)
    if (!result.success) throw badRequest('语音设置不合法，请检查开关、Key 和使用限额')
    const current = await effective({ includeDisabledKey: true })
    // 留空保留已保存的 Key，也可沿用本机环境变量中的现有 Key。
    const apiKey = result.data.apiKey || current.apiKey || ''
    if (result.data.enabled && apiKey.length < 8) throw badRequest('请先填写有效的硅基流动 API Key')
    return { ...result.data, apiKey }
  }
  async function verify(body) {
    const value = await prepare(body)
    if (!value.apiKey) throw badRequest('请填写 API Key 后再测试')
    try {
      const response = await fetchImpl(`${SPEECH_PROVIDER_URL}/models`, {
        headers: { Authorization: `Bearer ${value.apiKey}` }, signal: AbortSignal.timeout(10000), redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw new Error('Provider rejected credential')
      }
      const payload = await response.json()
      if (!payload.data?.some(model => model.id === SPEECH_MODEL)) throw new Error('Model unavailable')
      return { verified: true, message: '账号连接正常，SenseVoiceSmall 可用；可到语音转文字页面试录。' }
    } catch {
      throw new ApiError(400, 'SPEECH_CONFIG_INVALID', '验证失败，请检查硅基流动 Key、模型权限及网络连接')
    }
  }
  async function save(userId, body) {
    const value = await prepare(body)
    if (value.enabled) await verify({ ...value })
    await write(`INSERT INTO shared_speech_settings (id, enabled, api_key_cipher, daily_quota, per_minute_quota, updated_by)
      VALUES (1, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled),
      api_key_cipher = VALUES(api_key_cipher), daily_quota = VALUES(daily_quota),
      per_minute_quota = VALUES(per_minute_quota), updated_by = VALUES(updated_by)`,
    [value.enabled, value.apiKey ? encrypt(value.apiKey) : null, value.dailyQuota, value.perMinuteQuota, userId])
    return publicSettings()
  }
  return { effective, publicSettings, verify, save }
}

export const speechSettingsService = createSpeechSettingsService()
