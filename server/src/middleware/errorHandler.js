import { config } from '../config.js'
import { ApiError, ERROR_CODES, notFound } from '../utils/errors.js'

/** 未命中任何路由 */
export function notFoundHandler(req, _res, next) {
  next(notFound(`接口不存在：${req.method} ${req.originalUrl}`))
}

/** 将 MySQL 驱动错误翻译成对用户有意义的响应 */
function fromMysqlError(error) {
  switch (error.code) {
    case 'ER_DUP_ENTRY':
      return new ApiError(409, ERROR_CODES.CONFLICT, '该记录已存在，请勿重复提交')
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return new ApiError(400, ERROR_CODES.BAD_REQUEST, '关联的数据不存在')
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return new ApiError(409, ERROR_CODES.CONFLICT, '该数据仍被其他记录引用，无法删除')
    case 'ER_DATA_TOO_LONG':
      return new ApiError(400, ERROR_CODES.BAD_REQUEST, '提交的内容过长')
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
    case 'ER_ACCESS_DENIED_ERROR':
      return new ApiError(503, ERROR_CODES.INTERNAL, '数据库暂时不可用，请稍后重试')
    default:
      return null
  }
}

/** 将 body-parser / express 内置的请求体错误翻译成客户端错误 */
function fromBodyParserError(error) {
  switch (error.type) {
    case 'entity.parse.failed':
      return new ApiError(400, ERROR_CODES.BAD_REQUEST, '请求体不是合法的 JSON')
    case 'entity.too.large':
      return new ApiError(413, ERROR_CODES.BAD_REQUEST, '请求体过大')
    case 'encoding.unsupported':
      return new ApiError(415, ERROR_CODES.BAD_REQUEST, '不支持的请求体编码')
    default:
      return null
  }
}

/**
 * 全局错误处理。必须在所有路由之后注册。
 * 4 个入参是 Express 识别错误中间件的约定，缺一不可（next 未使用也要保留）。
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  const mapped =
    error instanceof ApiError ? error : fromBodyParserError(error) || fromMysqlError(error)

  if (!mapped) {
    // 未预期的异常：完整堆栈只进服务端日志，响应里不暴露内部细节
    console.error(`[error] ${req.method} ${req.originalUrl}`, error)
    return res.status(500).json({
      ok: false,
      error: { code: ERROR_CODES.INTERNAL, message: '服务器内部错误' },
    })
  }

  if (mapped.status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, error)
  } else if (!config.isTest) {
    console.warn(`[warn] ${req.method} ${req.originalUrl} -> ${mapped.status} ${mapped.message}`)
  }

  return res.status(mapped.status).json({
    ok: false,
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details ? { details: mapped.details } : {}),
    },
  })
}

export default { notFoundHandler, errorHandler }
