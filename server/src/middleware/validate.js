import { z } from 'zod'
import { validationFailed } from '../utils/errors.js'

/**
 * 用 zod schema 校验请求的 body / query / params。
 * 校验通过的结果挂在 req.valid 上而不是覆盖 req.query
 * （Express 5 的 req.query 是只读取值器，直接赋值会抛错）。
 *
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas = {}) {
  return function validateMiddleware(req, _res, next) {
    const collected = []

    for (const key of ['params', 'query', 'body']) {
      const schema = schemas[key]
      if (!schema) continue

      const result = schema.safeParse(req[key] ?? {})
      if (result.success) {
        req.valid = req.valid || {}
        req.valid[key] = result.data
      } else {
        collected.push(
          ...result.error.issues.map((issue) => ({
            source: key,
            path: issue.path.join('.'),
            message: issue.message,
          }))
        )
      }
    }

    if (collected.length) {
      return next(validationFailed('请求参数不合法', collected))
    }
    return next()
  }
}

/** 常用可复用片段 */
export const idParam = z.object({
  id: z.coerce.number().int().positive({ message: 'id 必须是正整数' }),
})

export default { validate, idParam }
