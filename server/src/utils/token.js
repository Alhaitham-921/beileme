import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { unauthorized, ERROR_CODES } from './errors.js'

const ISSUER = 'beileme'

/**
 * 签发访问令牌。token_version 一并写入载荷，
 * 用户改密或强制下线时自增该字段即可让旧令牌全部失效。
 */
export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), tv: user.token_version ?? 0 },
    config.jwt.secret,
    { expiresIn: config.jwt.accessTtl, issuer: ISSUER }
  )
}

/**
 * 校验访问令牌。
 * @returns {{ sub: string, tv: number }} 载荷
 * @throws {ApiError} 令牌无效或过期
 */
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, { issuer: ISSUER })
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw unauthorized('登录状态已过期，请重新登录', ERROR_CODES.TOKEN_EXPIRED)
    }
    throw unauthorized('登录凭证无效，请重新登录')
  }
}

/** 生成不可预测的刷新令牌原文（只回传给客户端一次） */
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url')
}

/** 刷新令牌入库前的哈希，数据库泄露也无法直接冒用 */
export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

/** 刷新令牌过期时间 */
export function refreshTokenExpiry(from = new Date()) {
  return new Date(from.getTime() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000)
}

/** 从 Authorization 头解析 Bearer 令牌 */
export function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim())
  return match ? match[1].trim() : null
}

export default {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  extractBearerToken,
}
