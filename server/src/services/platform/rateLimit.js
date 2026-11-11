import { execute, queryOne, withTransaction } from '../../db/pool.js'
import { rateKey } from './security.js'
import { ApiError } from '../../utils/errors.js'

export async function consumeWindow(key, maximum, seconds, now = Date.now()) {
  const start = Math.floor(now / (seconds * 1000))
  const bucket = rateKey(key, seconds)
  return withTransaction(async conn => {
    await conn.execute('INSERT IGNORE INTO shared_rate_windows(bucket, window_start, used) VALUES(?,?,0)', [bucket, start])
    const [rows] = await conn.execute('SELECT used FROM shared_rate_windows WHERE bucket=? AND window_start=? FOR UPDATE', [bucket, start])
    if (Number(rows[0].used) >= maximum) throw new ApiError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试', { retryAfterSeconds: seconds - Math.floor(now / 1000) % seconds })
    await conn.execute('UPDATE shared_rate_windows SET used=used+1 WHERE bucket=? AND window_start=?', [bucket, start])
    return maximum - Number(rows[0].used) - 1
  })
}

export function sharedLimit({ prefix, maximum, seconds, key = req => req.ip, enabled = () => true }) {
  return async (req, res, next) => {
    if (!enabled()) return next()
    try { await consumeWindow(`${prefix}:${key(req)}`, maximum, seconds); next() }
    catch (error) { if (error.status === 429) res.set('Retry-After', String(error.details?.retryAfterSeconds || seconds)); next(error) }
  }
}
