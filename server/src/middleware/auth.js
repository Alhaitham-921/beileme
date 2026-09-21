import { queryOne } from '../db/pool.js'
import { extractBearerToken, verifyAccessToken } from '../utils/token.js'
import { unauthorized } from '../utils/errors.js'

async function resolveUser(req) {
  const token = extractBearerToken(req.headers.authorization)
  if (!token) return null

  const payload = verifyAccessToken(token)
  const user = await queryOne(
    `SELECT id, email, phone, nickname, status, token_version, created_at
       FROM users WHERE id = ?`,
    [payload.sub]
  )
  if (!user) throw unauthorized('账号不存在或已注销')
  if (user.status !== 'active') throw unauthorized('账号已被停用')

  // 令牌里记录签发时的 token_version，与库中不一致说明已被强制下线
  if (Number(payload.tv ?? 0) !== Number(user.token_version ?? 0)) {
    throw unauthorized('登录状态已失效，请重新登录')
  }
  return user
}

/** 强制登录：未登录直接 401 */
export async function requireAuth(req, _res, next) {
  try {
    const user = await resolveUser(req)
    if (!user) throw unauthorized()
    req.user = user
    next()
  } catch (error) {
    next(error)
  }
}

/** 可选登录：有令牌则解析，无令牌或无效令牌都放行（供公开接口做个性化用） */
export async function optionalAuth(req, _res, next) {
  try {
    req.user = await resolveUser(req)
  } catch {
    req.user = null
  }
  next()
}

export default { requireAuth, optionalAuth }
