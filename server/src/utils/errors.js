/**
 * 统一错误类型与错误码。
 * 所有可预期的业务失败都抛 ApiError，由 errorHandler 中间件翻译成 JSON 响应；
 * 未预期的异常一律按 500 处理，不把内部细节泄露给客户端。
 */

export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INTERNAL: 'INTERNAL',
}

export class ApiError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} code 业务错误码
   * @param {string} message 面向用户的中文提示
   * @param {object} [details] 附加信息，例如字段级校验错误
   */
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.expose = true
  }
}

export const badRequest = (message, details) =>
  new ApiError(400, ERROR_CODES.BAD_REQUEST, message, details)

export const unauthorized = (message = '请先登录', code = ERROR_CODES.UNAUTHORIZED) =>
  new ApiError(401, code, message)

export const forbidden = (message = '没有权限执行该操作') =>
  new ApiError(403, ERROR_CODES.FORBIDDEN, message)

export const notFound = (message = '资源不存在') => new ApiError(404, ERROR_CODES.NOT_FOUND, message)

export const conflict = (message, details) =>
  new ApiError(409, ERROR_CODES.CONFLICT, message, details)

export const quotaExceeded = (message, details) =>
  new ApiError(429, ERROR_CODES.QUOTA_EXCEEDED, message, details)

export const validationFailed = (message = '请求参数不合法', details) =>
  new ApiError(400, ERROR_CODES.VALIDATION_FAILED, message, details)
