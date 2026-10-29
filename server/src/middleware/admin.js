import { config } from '../config.js'
import { forbidden } from '../utils/errors.js'

export function isAdmin(user) {
  return Boolean(user && config.adminUserIds.includes(String(user.id)))
}

export function requireAdmin(req, _res, next) {
  if (!isAdmin(req.user)) return next(forbidden('此设置仅管理员可以修改'))
  next()
}
