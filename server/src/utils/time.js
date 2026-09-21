import { config } from '../config.js'

const OFFSET_MS = config.timezoneOffsetMinutes * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** 业务日期键（YYYY-MM-DD）。数据以 UTC 存储，但「今天」按配置的时区偏移切分，
 * 例如东八区用户在 23:30 学习，仍应记入当天而不是 UTC 的次日。
 */
export function businessDate(date = new Date()) {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10)
}

/** businessDate 的语义化别名 */
export const todayKey = businessDate

/**
 * 把数据库取回的日期值统一转成 'YYYY-MM-DD' 字符串。
 *
 * 必须用本函数而不是 String(value).slice(0, 10)：
 * mysql2 会把 DATE 列解析成 JS Date，而 String(new Date()) 得到的是
 * "Mon Sep 21 2026 ..." 这类可读形式，截取前 10 位只会得到 "Mon Sep 21"。
 * 连接池已设置 timezone: 'Z'，因此按 UTC 取值不会偏移。
 */
export function toDateKey(value) {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

/** 业务日期对应的 UTC 起始时刻（可直接作为 SQL 的 DATETIME 边界） */
export function businessDayStartUtc(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS)
}

/** 业务日期对应的 UTC 结束时刻（含当天最后一毫秒） */
export function businessDayEndUtc(dateKey) {
  return new Date(businessDayStartUtc(dateKey).getTime() + DAY_MS - 1)
}

/** 日期键加减天数，返回新的日期键 */
export function addDays(dateKey, days) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10)
}

/** later - earlier 的天数差 */
export function diffDays(laterKey, earlierKey) {
  const toUtc = (key) => {
    const [year, month, day] = String(key).split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((toUtc(laterKey) - toUtc(earlierKey)) / DAY_MS)
}

/** 生成最近 n 天的日期键数组（含今天，按时间升序） */
export function recentDateKeys(n, endKey = todayKey()) {
  const keys = []
  for (let i = n - 1; i >= 0; i -= 1) keys.push(addDays(endKey, -i))
  return keys
}

/** 格式化为 MySQL DATETIME 字符串（UTC） */
export function formatDateTime(date = new Date()) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ')
}

export default {
  businessDate,
  todayKey,
  toDateKey,
  businessDayStartUtc,
  businessDayEndUtc,
  addDays,
  diffDays,
  recentDateKeys,
  formatDateTime,
}
