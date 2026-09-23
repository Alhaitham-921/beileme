import { query, queryOne, execute } from '../../db/pool.js'
import { config } from '../../config.js'
import { badRequest, notFound } from '../../utils/errors.js'
import { encryptSecret, decryptSecret, maskSecret, isDecryptable } from './cryptoKeys.js'
import { normalizeApiKey } from './aiProvider.js'

/**
 * 用户自带 API Key 的管理（PRD 4.8）。
 *
 * 设计要点：
 *  1. 明文 Key 只在校验与调用时短暂存在于内存，接口永不回传明文，只回打码结果
 *  2. 密文用 AES-256-GCM 存库，主密钥变更会导致解密失败，此时提示用户重填而不是静默失效
 *  3. 即便用户用了自己的 Key，所有生成请求仍走系统预设的 Prompt 模板，
 *     无法绕过学习目标约束（PRD 4.8 的强约束）
 */

/** 预设服务商。model 字段填的是各厂商公开文档里的常见模型 id，可在界面上覆盖 */
export const PROVIDER_PRESETS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    note: '官方 OpenAI 兼容接口。想要更低成本可以改用 deepseek-flash；具体可用模型以「获取可用模型」列出的为准',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: '成本较低的轻量模型',
  },
  moonshot: {
    label: 'Moonshot 月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    note: '国内可直连',
  },
  zhipu: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    note: 'flash 系列价格很低，适合本项目的短内容生成',
  },
  custom: {
    label: '自定义（需兼容 OpenAI 协议）',
    baseUrl: '',
    model: '',
    note: '任何 OpenAI 兼容端点，如中转平台、本地 Ollama',
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDER_PRESETS)

function mapKeyRow(row) {
  if (!row) return null
  const plain = decryptSecret(row.key_cipher)
  return {
    id: Number(row.id),
    provider: row.provider,
    label: row.label || PROVIDER_PRESETS[row.provider]?.label || row.provider,
    baseUrl: row.base_url || '',
    model: row.model || '',
    isActive: Boolean(row.is_active),
    /** 只回打码值；解密失败说明主密钥变了，需要用户重新填写 */
    maskedKey: plain ? maskSecret(plain) : '（无法解密，请重新填写）',
    decryptable: plain != null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listUserKeys(userId) {
  const rows = await query(
    'SELECT * FROM user_api_keys WHERE user_id = ? ORDER BY id DESC',
    [userId]
  )
  return rows.map(mapKeyRow)
}

/**
 * 解析出最终要使用的接口地址与模型。
 * 用户没填就回落到服务商预设，同时统一去掉结尾斜杠。
 */
export function resolveKeyTarget({ provider, baseUrl, model }) {
  const preset = PROVIDER_PRESETS[provider]
  return {
    baseUrl: String(baseUrl || preset?.baseUrl || '')
      .trim()
      .replace(/\/+$/, ''),
    model: String(model || preset?.model || '').trim(),
  }
}

/**
 * 新增或更新一把 Key。同一 provider 只保留一把，避免界面上出现多个「生效中」的困惑。
 * @returns {Promise<object>} 打码后的记录
 */
export async function saveUserKey(userId, { provider, apiKey, baseUrl, model, label }) {
  if (!PROVIDER_IDS.includes(provider)) {
    throw badRequest(`不支持的服务商：${provider}`)
  }

  // 归一化：清掉粘贴时可能带上的空格、换行、引号与 Bearer 前缀
  const trimmedKey = normalizeApiKey(apiKey)
  if (trimmedKey.length < 8) throw badRequest('API Key 看起来不完整')
  if (trimmedKey.length > 512) throw badRequest('API Key 过长')

  const target = resolveKeyTarget({ provider, baseUrl, model })
  if (!target.baseUrl) throw badRequest('自定义服务商必须填写接口地址（Base URL）')
  if (!target.model) throw badRequest('请填写模型名称')

  const cipher = encryptSecret(trimmedKey)

  const existing = await queryOne(
    'SELECT id FROM user_api_keys WHERE user_id = ? AND provider = ?',
    [userId, provider]
  )

  if (existing) {
    await execute(
      `UPDATE user_api_keys SET key_cipher = ?, base_url = ?, model = ?, label = ?, is_active = 1
        WHERE id = ? AND user_id = ?`,
      [cipher, target.baseUrl, target.model, String(label || '').slice(0, 64), existing.id, userId]
    )
  } else {
    await execute(
      `INSERT INTO user_api_keys (user_id, provider, label, key_cipher, base_url, model, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [userId, provider, String(label || '').slice(0, 64), cipher, target.baseUrl, target.model]
    )
  }

  // 只允许一把生效：新保存的这把成为当前使用的那把
  await execute('UPDATE user_api_keys SET is_active = 0 WHERE user_id = ? AND provider <> ?', [
    userId,
    provider,
  ])
  await execute('UPDATE user_api_keys SET is_active = 1 WHERE user_id = ? AND provider = ?', [
    userId,
    provider,
  ])

  const row = await queryOne(
    'SELECT * FROM user_api_keys WHERE user_id = ? AND provider = ?',
    [userId, provider]
  )
  return mapKeyRow(row)
}

export async function deleteUserKey(userId, id) {
  const result = await execute('DELETE FROM user_api_keys WHERE id = ? AND user_id = ?', [id, userId])
  if (result.affectedRows === 0) throw notFound('该 API Key 不存在')
  return { deleted: true }
}

/** 取当前生效的用户 Key（含明文，仅供内部调用） */
export async function getActiveUserKey(userId) {
  const row = await queryOne(
    'SELECT * FROM user_api_keys WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
    [userId]
  )
  if (!row) return null

  const plain = decryptSecret(row.key_cipher)
  if (!plain) return null // 主密钥变更导致无法解密，视为未配置

  return {
    id: Number(row.id),
    provider: row.provider,
    label: row.label || PROVIDER_PRESETS[row.provider]?.label || row.provider,
    apiKey: plain,
    baseUrl: row.base_url || PROVIDER_PRESETS[row.provider]?.baseUrl || config.ai.baseUrl,
    model: row.model || config.ai.defaultModel,
  }
}

/**
 * 解析本次调用应该用哪把 Key。
 * 顺序：用户自带 Key → 服务端官方 Key → 都没有（返回 null，由上层走模板兜底）
 * @returns {Promise<{source:'user'|'server'|'none', apiKey?:string, baseUrl?:string, model?:string, provider?:string, label?:string}>}
 */
export async function resolveProvider(userId) {
  const userKey = await getActiveUserKey(userId)
  if (userKey) {
    return {
      source: 'user',
      apiKey: userKey.apiKey,
      baseUrl: userKey.baseUrl,
      model: userKey.model,
      provider: userKey.provider,
      label: userKey.label,
    }
  }

  if (config.ai.apiKey) {
    return {
      source: 'server',
      apiKey: config.ai.apiKey,
      baseUrl: config.ai.baseUrl,
      model: config.ai.defaultModel,
      provider: 'deepseek',
      label: '官方额度',
    }
  }

  return { source: 'none' }
}

/** 记录一次调用，便于界面展示「我自己那把 Key 用过没有」 */
export async function markKeyUsed(keyId) {
  if (!keyId) return
  await execute('UPDATE user_api_keys SET updated_at = NOW() WHERE id = ?', [keyId]).catch(() => {})
}

/** 供设置页展示的元信息 */
export function describeProviders() {
  return PROVIDER_IDS.map((id) => ({
    id,
    ...PROVIDER_PRESETS[id],
    /** 服务端已配置官方额度时，用户不填 Key 也能用 */
    serverConfigured: Boolean(config.ai.apiKey),
  }))
}

export { isDecryptable }

export default {
  PROVIDER_PRESETS,
  PROVIDER_IDS,
  listUserKeys,
  saveUserKey,
  deleteUserKey,
  getActiveUserKey,
  resolveProvider,
  resolveKeyTarget,
  markKeyUsed,
  describeProviders,
}
