/**
 * MySQL 的 JSON 列经 mysql2 返回时通常已是对象，但在某些驱动配置或原生 SQL 场景下会是字符串。
 * 这里统一兜底，避免上层到处写 typeof 判断。
 */
export function parseJson(value, fallback = null) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed == null ? fallback : parsed
  } catch {
    return fallback
  }
}

/** 序列化为 JSON 列可写入的值 */
export function toJson(value) {
  return value == null ? null : JSON.stringify(value)
}

/** 安全取整，非法值回退 */
export function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 数值裁剪 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** 保留指定小数位 */
export function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

export default { parseJson, toJson, toInt, clamp, round }
