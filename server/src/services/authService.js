import { query, queryOne, execute } from '../db/pool.js'
import { config } from '../config.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  verifyAccessToken,
} from '../utils/token.js'
import { conflict, unauthorized, badRequest, ERROR_CODES } from '../utils/errors.js'
import { ensureProfile } from './profileService.js'

/** 口令强度下限，注册与改密共用 */
export const MIN_PASSWORD_LENGTH = 8

export function publicUser(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    email: row.email || null,
    phone: row.phone || null,
    nickname: row.nickname || '',
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  }
}

/** 判断输入的是邮箱还是手机号 */
export function detectAccountType(account) {
  const value = String(account || '').trim()
  if (!value) return null
  if (value.includes('@')) return 'email'
  if (/^\+?\d{6,20}$/.test(value)) return 'phone'
  return null
}

export function assertPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`密码长度至少 ${MIN_PASSWORD_LENGTH} 位`)
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw badRequest('密码需要同时包含字母和数字')
  }
}

/**
 * 签发访问令牌 + 刷新令牌。刷新令牌只把哈希入库，原文仅返回一次。
 */
async function issueTokens(user, { userAgent = null, ip = null } = {}) {
  const accessToken = signAccessToken(user)
  const refreshToken = generateRefreshToken()

  await execute(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [user.id, hashRefreshToken(refreshToken), userAgent?.slice(0, 255) || null, ip || null, refreshTokenExpiry()]
  )

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: config.jwt.accessTtl,
  }
}

/** 注册 */
export async function register({ email, phone, password, nickname = '', userAgent, ip }) {
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null
  const normalizedPhone = phone ? String(phone).trim() : null

  if (!normalizedEmail && !normalizedPhone) throw badRequest('请提供邮箱或手机号')
  assertPasswordStrength(password)

  if (normalizedEmail) {
    const exists = await queryOne('SELECT id FROM users WHERE email = ?', [normalizedEmail])
    if (exists) throw conflict('该邮箱已注册')
  }
  if (normalizedPhone) {
    const exists = await queryOne('SELECT id FROM users WHERE phone = ?', [normalizedPhone])
    if (exists) throw conflict('该手机号已注册')
  }

  const passwordHash = await hashPassword(password)
  const result = await execute(
    'INSERT INTO users (email, phone, password_hash, nickname) VALUES (?, ?, ?, ?)',
    [normalizedEmail, normalizedPhone, passwordHash, String(nickname || '').slice(0, 64)]
  )

  const user = await queryOne('SELECT * FROM users WHERE id = ?', [result.insertId])
  // 注册即建立默认画像，避免后续每个接口都要处理画像缺失
  await ensureProfile(user.id)

  return { user: publicUser(user), tokens: await issueTokens(user, { userAgent, ip }) }
}

/** 登录，account 可为邮箱或手机号 */
export async function login({ account, password, userAgent, ip }) {
  const type = detectAccountType(account)
  if (!type) throw badRequest('请输入邮箱或手机号')

  const column = type === 'email' ? 'email' : 'phone'
  const value = type === 'email' ? String(account).trim().toLowerCase() : String(account).trim()

  const user = await queryOne(`SELECT * FROM users WHERE ${column} = ?`, [value])
  // 不区分「账号不存在」与「密码错误」，避免账号枚举
  if (!user) throw unauthorized('账号或密码不正确')

  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) throw unauthorized('账号或密码不正确')
  if (user.status !== 'active') throw unauthorized('账号已被停用')

  await execute('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date(), user.id])
  await ensureProfile(user.id)

  const fresh = await queryOne('SELECT * FROM users WHERE id = ?', [user.id])
  return { user: publicUser(fresh), tokens: await issueTokens(fresh, { userAgent, ip }) }
}

/**
 * 刷新令牌轮换：旧令牌立即作废，防止被重放。
 */
export async function refresh({ refreshToken, userAgent, ip }) {
  if (!refreshToken) throw badRequest('缺少 refreshToken')

  const tokenHash = hashRefreshToken(refreshToken)
  const row = await queryOne('SELECT * FROM refresh_tokens WHERE token_hash = ?', [tokenHash])
  if (!row) throw unauthorized('刷新令牌无效，请重新登录')
  if (row.revoked_at) throw unauthorized('刷新令牌已失效，请重新登录')
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw unauthorized('刷新令牌已过期，请重新登录', ERROR_CODES.TOKEN_EXPIRED)
  }

  const user = await queryOne('SELECT * FROM users WHERE id = ?', [row.user_id])
  if (!user) throw unauthorized('账号不存在')
  if (user.status !== 'active') throw unauthorized('账号已被停用')

  await execute('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', [new Date(), row.id])

  return { user: publicUser(user), tokens: await issueTokens(user, { userAgent, ip }) }
}

/**
 * 登出：撤销该用户全部刷新令牌。
 * 同时自增 token_version，让已签发的 access token 也立即失效。
 */
export async function logout(userId, { allDevices = true } = {}) {
  if (allDevices) {
    await execute('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
      new Date(),
      userId,
    ])
  }
  await execute('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId])
}

/** 校验 access token 后取用户（供接口层复用） */
export async function resolveAccessToken(token) {
  const payload = verifyAccessToken(token)
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [payload.sub])
  if (!user) throw unauthorized('账号不存在')
  if (Number(payload.tv ?? 0) !== Number(user.token_version ?? 0)) {
    throw unauthorized('登录状态已失效，请重新登录')
  }
  return user
}

/** 修改密码后强制所有设备重新登录 */
export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId])
  if (!user) throw unauthorized()

  const ok = await verifyPassword(currentPassword, user.password_hash)
  if (!ok) throw unauthorized('当前密码不正确')
  assertPasswordStrength(newPassword)

  const passwordHash = await hashPassword(newPassword)
  await execute(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    [passwordHash, userId]
  )
  await execute('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
    new Date(),
    userId,
  ])
}

/** 清理过期刷新令牌（可挂到定时任务） */
export async function purgeExpiredTokens() {
  const result = await execute('DELETE FROM refresh_tokens WHERE expires_at < ?', [new Date()])
  return result.affectedRows
}

export default {
  register,
  login,
  refresh,
  logout,
  changePassword,
  publicUser,
  detectAccountType,
  assertPasswordStrength,
  purgeExpiredTokens,
}
