import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok, created } from '../utils/http.js'
import { getProfile } from '../services/profileService.js'
import {
  register,
  login,
  refresh,
  logout,
  changePassword,
  publicUser,
  MIN_PASSWORD_LENGTH,
} from '../services/authService.js'

const router = Router()

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `密码长度至少 ${MIN_PASSWORD_LENGTH} 位`)
  .max(128, '密码过长')

const registerSchema = z
  .object({
    email: z.string().email('邮箱格式不正确').max(190).optional(),
    phone: z.string().regex(/^\+?\d{6,20}$/, '手机号格式不正确').optional(),
    password: passwordSchema,
    nickname: z.string().max(64).optional(),
  })
  .refine((data) => Boolean(data.email || data.phone), {
    message: '请至少提供邮箱或手机号',
    path: ['email'],
  })

const loginSchema = z.object({
  account: z.string().min(1, '请输入邮箱或手机号').max(190),
  password: z.string().min(1, '请输入密码').max(128),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'refreshToken 不合法'),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码').max(128),
  newPassword: passwordSchema,
})

/** 从请求头提取设备信息，仅用于记录刷新令牌来源 */
function requestMeta(req) {
  return {
    userAgent: req.headers['user-agent'] || null,
    ip: req.ip || req.socket?.remoteAddress || null,
  }
}

// POST /api/v1/auth/register
router.post(
  '/register',
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const result = await register({ ...req.valid.body, ...requestMeta(req) })
    return created(res, { ...result, profile: await getProfile(result.user.id) })
  })
)

// POST /api/v1/auth/login
router.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const result = await login({ ...req.valid.body, ...requestMeta(req) })
    return ok(res, { ...result, profile: await getProfile(result.user.id) })
  })
)

// POST /api/v1/auth/refresh
router.post(
  '/refresh',
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    const result = await refresh({ ...req.valid.body, ...requestMeta(req) })
    return ok(res, result)
  })
)

// POST /api/v1/auth/logout
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await logout(req.user.id)
    return ok(res, { loggedOut: true })
  })
)

// GET /api/v1/auth/me
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    return ok(res, { user: publicUser(req.user), profile: await getProfile(req.user.id) })
  })
)

// POST /api/v1/auth/password
router.post(
  '/password',
  requireAuth,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    await changePassword(req.user.id, req.valid.body)
    // 改密后旧令牌已全部失效，提示前端跳回登录页
    return ok(res, { changed: true, reloginRequired: true })
  })
)

export default router
