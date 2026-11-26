import { ApiError } from '../utils/errors.js'
export function databaseError(error) {
  if(/queue limit reached|no connections available/i.test(error?.message||'')) {
    return new ApiError(503,'DATABASE_BUSY','当前请求较多，请稍后重试。已保存的学习记录仍会保留。')
  }
  return error
}
