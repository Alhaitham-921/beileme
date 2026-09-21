/**
 * 响应包装。成功响应统一为 { ok: true, data }，
 * 失败响应统一为 { ok: false, error: { code, message, details } }，
 * 前端只需判断一个 ok 字段即可分流。
 */

/** 包装 async 路由处理器，异常统一交给错误中间件 */
export function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

export function ok(res, data = null, status = 200) {
  return res.status(status).json({ ok: true, data })
}

export function created(res, data = null) {
  return ok(res, data, 201)
}

export function noContent(res) {
  return res.status(204).end()
}

/** 分页响应 */
export function paginated(res, items, { page, size, total }) {
  return ok(res, {
    items,
    page,
    size,
    total,
    totalPages: size > 0 ? Math.ceil(total / size) : 0,
  })
}

/** 解析分页参数，带边界保护 */
export function readPagination(source = {}, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(source.page, 10) || 1)
  const rawSize = Number.parseInt(source.size, 10) || defaultSize
  const size = Math.min(maxSize, Math.max(1, rawSize))
  return { page, size, offset: (page - 1) * size }
}

export default { asyncHandler, ok, created, noContent, paginated, readPagination }
