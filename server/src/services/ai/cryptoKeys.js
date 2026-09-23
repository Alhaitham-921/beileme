import crypto from 'node:crypto'
import { config } from '../../config.js'

/**
 * 用户自带 API Key 的加解密（PRD 4.8「Key 加密存储，仅用于该用户自己的请求」）。
 *
 * 方案：AES-256-GCM。GCM 自带完整性校验，密文被篡改会直接解密失败，
 * 而不是悄悄解出一段垃圾去调 API。
 *
 * 存储格式：v1:<iv base64>:<authTag base64>:<ciphertext base64>
 * 版本前缀是为了将来换算法时能平滑迁移——老密文仍可按 v1 解，新写入用新版本。
 */

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // GCM 推荐 96 位
const KEY_BYTES = 32

let cachedKey = null

/**
 * 主密钥。优先用独立的 AI_KEY_ENCRYPTION_SECRET；
 * 没配就从 JWT_SECRET 派生，并在启动日志里提示（方便单机开发，生产环境应显式配置）。
 */
function masterKey() {
  if (cachedKey) return cachedKey

  const secret = config.security.keyEncryptionSecret || config.jwt.secret
  if (!secret) throw new Error('缺少密钥加密的种子：请配置 AI_KEY_ENCRYPTION_SECRET 或 JWT_SECRET')

  // 用 scrypt 把任意长度的口令拉伸成固定 32 字节密钥
  const salt = crypto.createHash('sha256').update('beileme:api-key-encryption').digest()
  cachedKey = crypto.scryptSync(secret, salt, KEY_BYTES, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return cachedKey
}

/** 加密明文 Key，返回可直接入库的字符串 */
export function encryptSecret(plain) {
  if (typeof plain !== 'string' || !plain) throw new Error('待加密内容不能为空')

  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

/**
 * 解密。
 * @returns {string|null} 密文损坏、格式不符或密钥已更换时返回 null（调用方应提示用户重新填写）
 */
export function decryptSecret(stored) {
  if (typeof stored !== 'string' || !stored) return null

  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) return null

  try {
    const [, ivRaw, tagRaw, dataRaw] = parts
    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey(), Buffer.from(ivRaw, 'base64'))
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    // 完整性校验失败（被篡改）或主密钥变更
    return null
  }
}

/**
 * 打码显示，用于回传给前端。
 * 接口永远不返回明文 Key，前端只拿这个来确认「我填过哪一个」。
 */
export function maskSecret(plain) {
  if (typeof plain !== 'string' || !plain) return ''
  if (plain.length <= 10) return `${plain.slice(0, 2)}****`
  return `${plain.slice(0, 6)}****${plain.slice(-4)}`
}

/** 判断库里的密文能否被当前主密钥解开，用于给用户「密钥已失效，请重填」的提示 */
export function isDecryptable(stored) {
  return decryptSecret(stored) != null
}

export default { encryptSecret, decryptSecret, maskSecret, isDecryptable }
