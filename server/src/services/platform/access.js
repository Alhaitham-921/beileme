import { config } from '../../config.js'
import { query, queryOne, execute, withTransaction } from '../../db/pool.js'
import { ApiError, badRequest } from '../../utils/errors.js'
import { encryptSecret, decryptSecret } from '../ai/cryptoKeys.js'
import { validatePublicUrl, rateKey } from './security.js'
import { getActiveUserKey } from '../ai/apiKeyService.js'

// IELTS-only policy. Existing vocabulary and scenario features keep their original provider resolution.
export async function resolveTrainingProvider(userId) {
  const choice=await preferences(userId)
  if(choice.textMode==='byok'){
    const key=await getActiveUserKey(userId)
    return key?{...key,userId,source:'user'}:{userId,source:'none',reason:'个人 Key 未配置或失效，不会自动切换到平台额度'}
  }
  return config.ai.apiKey?{userId,source:'server',apiKey:config.ai.apiKey,baseUrl:config.ai.baseUrl,model:config.ai.defaultModel}:{userId,source:'none',reason:'雅思专项的平台 AI 尚未配置，可选择个人 Key'}
}

export async function preferences(userId) {
  const row = await queryOne('SELECT * FROM ai_access_preferences WHERE user_id=?', [userId])
  const active = await queryOne('SELECT id FROM user_api_keys WHERE user_id=? AND is_active=1 LIMIT 1', [userId])
  return { textMode: row?.text_mode || (active ? 'byok' : 'platform'), speechMode: row?.speech_mode || 'platform', speechConfigured: Boolean(row?.speech_cipher), speechBaseUrl: row?.speech_base_url || '', speechModel: row?.speech_model || '' }
}

export async function savePreferences(userId, body) {
  const current = await preferences(userId)
  const textMode = body.textMode || current.textMode
  const speechMode = body.speechMode || current.speechMode
  if (![textMode, speechMode].every(v => ['byok', 'platform'].includes(v))) throw badRequest('请选择平台服务或个人 Key')
  const baseUrl = body.speechBaseUrl ?? current.speechBaseUrl
  if (baseUrl) await validatePublicUrl(baseUrl)
  if (body.speechKey && (typeof body.speechKey !== 'string' || body.speechKey.length < 8 || body.speechKey.length > 512)) throw badRequest('语音 Key 格式不正确')
  const model = body.speechModel ?? current.speechModel
  if (typeof model !== 'string' || model.length > 100) throw badRequest('语音模型名称不正确')
  if (speechMode === 'byok' && (!baseUrl || !model || !(body.speechKey || current.speechConfigured))) throw badRequest('请先填写个人语音服务的地址、模型和 Key')
  await execute(`INSERT INTO ai_access_preferences(user_id,text_mode,speech_mode,speech_cipher,speech_base_url,speech_model) VALUES(?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE text_mode=VALUES(text_mode),speech_mode=VALUES(speech_mode),speech_cipher=COALESCE(VALUES(speech_cipher),speech_cipher),speech_base_url=VALUES(speech_base_url),speech_model=VALUES(speech_model)`,
    [userId, textMode, speechMode, body.speechKey ? encryptSecret(body.speechKey.trim()) : null, baseUrl || null, model || null])
  return preferences(userId)
}

export async function speechProvider(userId, platformSettings) {
  const prefs = await preferences(userId)
  if (prefs.speechMode === 'platform') return { ...platformSettings, source: 'server', userId }
  const row = await queryOne('SELECT * FROM ai_access_preferences WHERE user_id=?', [userId])
  const apiKey = decryptSecret(row?.speech_cipher)
  if (!apiKey) throw new ApiError(400, 'BYOK_REQUIRED', '个人语音 Key 未配置或无法解密，请重新填写；不会改用平台额度')
  return { ...platformSettings, apiKey, baseUrl: row.speech_base_url, model: row.speech_model, source: 'user', userId }
}

export async function wallet(userId) {
  const row = await queryOne('SELECT balance,reserved FROM platform_wallets WHERE user_id=?', [userId])
  const usage = await query('SELECT kind,source,state,COUNT(*) calls FROM platform_usage WHERE user_id=? AND created_at>=UTC_TIMESTAMP()-INTERVAL 30 DAY GROUP BY kind,source,state', [userId])
  return { balance: Number(row?.balance || 0), reserved: Number(row?.reserved || 0), available: Math.max(0, Number(row?.balance || 0) - Number(row?.reserved || 0)), usage, onlinePayments: false }
}

export async function grantCredits(userId, units, key, actor) {
  if(!Number.isSafeInteger(userId)||userId<1)throw badRequest('用户编号不正确')
  if (!Number.isInteger(units) || units < 1 || units > 100000 || !/^[\w-]{8,100}$/.test(key)) throw badRequest('额度或幂等编号不正确')
  return withTransaction(async conn => {
    await conn.execute('INSERT IGNORE INTO platform_wallets(user_id) VALUES(?)', [userId])
    await conn.execute('SELECT user_id FROM platform_wallets WHERE user_id=? FOR UPDATE', [userId])
    const [existing] = await conn.execute('SELECT user_id,units FROM platform_usage WHERE request_key=?', [`grant:${key}`])
    if (existing.length) {
      if (Number(existing[0].user_id) !== Number(userId) || Number(existing[0].units) !== units) throw badRequest('该编号已用于其他额度发放')
      return { granted: false, duplicate: true }
    }
    await conn.execute('UPDATE platform_wallets SET balance=balance+? WHERE user_id=?', [units, userId])
    await conn.execute("INSERT INTO platform_usage(request_key,user_id,kind,source,units,state,usage_detail) VALUES(?,?,'invitation','server',?,'grant',?)", [`grant:${key}`, userId, units, JSON.stringify({ grantedBy: actor })])
    return { granted: true, units }
  })
}

export async function reserveUsage({ userId, requestKey, kind, source, units = 1 }) {
  if (!['user','server'].includes(source)) throw badRequest('AI 服务尚未配置')
  return withTransaction(async conn => {
    // Lock the shared daily budget before user wallets: stable lock ordering across workers.
    const bucket = rateKey('platform-daily-budget')
    const day = Math.floor(Date.now() / 86400000)
    await conn.execute('INSERT IGNORE INTO shared_rate_windows(bucket,window_start,used) VALUES(?,?,0)', [bucket, day])
    const [budget] = await conn.execute('SELECT used FROM shared_rate_windows WHERE bucket=? AND window_start=? FOR UPDATE', [bucket, day])
    const [prior] = await conn.execute('SELECT * FROM platform_usage WHERE request_key=?', [requestKey])
    if (prior.length) {
      if (Number(prior[0].user_id) !== Number(userId)) throw badRequest('调用编号不属于当前用户')
      return { ...prior[0], reused: true }
    }
    const [active] = await conn.execute("SELECT COUNT(*) n FROM platform_usage WHERE user_id=? AND state='reserved'",[userId])
    if (Number(active[0].n) >= 2) throw new ApiError(429, 'AI_CONCURRENT_LIMIT', '已有两次 AI 调用在处理中，请稍候')
    if (source === 'server') {
      const cap = Number(process.env.PLATFORM_DAILY_UNITS || 500)
      if (Number(budget[0].used) + units > cap) throw new ApiError(429, 'PLATFORM_BUDGET_EXHAUSTED', '今日平台试运营预算已用完，基础练习仍可使用')
      await conn.execute('INSERT IGNORE INTO platform_wallets(user_id) VALUES(?)', [userId])
      const [balances] = await conn.execute('SELECT balance,reserved FROM platform_wallets WHERE user_id=? FOR UPDATE', [userId])
      if (Number(balances[0].balance) - Number(balances[0].reserved) < units) throw new ApiError(402, 'CREDITS_REQUIRED', '平台体验额度不足，请申请邀请额度或切换到个人 Key')
      await conn.execute('UPDATE platform_wallets SET reserved=reserved+? WHERE user_id=?', [units,userId])
      await conn.execute('UPDATE shared_rate_windows SET used=used+? WHERE bucket=? AND window_start=?', [units,bucket,day])
    }
    await conn.execute("INSERT INTO platform_usage(request_key,user_id,kind,source,units,state) VALUES(?,?,?,?,?,'reserved')", [requestKey,userId,kind,source,units])
    return { request_key: requestKey, user_id: userId, source, units, state: 'reserved' }
  })
}

export async function settleUsage(requestKey, success, detail = {}) {
  return withTransaction(async conn => {
    const [rows] = await conn.execute('SELECT * FROM platform_usage WHERE request_key=? FOR UPDATE', [requestKey])
    const row = rows[0]
    if (!row || row.state !== 'reserved') return false
    if (row.source === 'server') await conn.execute('UPDATE platform_wallets SET reserved=reserved-?,balance=balance-? WHERE user_id=?', [row.units, success ? row.units : 0, row.user_id])
    await conn.execute('UPDATE platform_usage SET state=?,usage_detail=? WHERE request_key=?', [success ? 'settled' : 'released', JSON.stringify(detail),requestKey])
    return true
  })
}
