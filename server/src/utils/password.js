import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)

// scrypt 参数：N=16384 / r=8 / p=1 属于 OWASP 推荐区间，内存开销约 16MB
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 }
const SALT_BYTES = 16

/**
 * 生成口令哈希，格式：scrypt$N$r$p$saltBase64$hashBase64
 * 参数写进字符串，便于日后提高强度时新旧口令仍可校验。
 */
export async function hashPassword(plain) {
  if (typeof plain !== 'string' || !plain) throw new Error('口令不能为空')
  const salt = crypto.randomBytes(SALT_BYTES)
  const derived = await scrypt(plain, salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: PARAMS.maxmem,
  })
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/** 恒定时间校验口令 */
export async function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false

  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts
  const N = Number.parseInt(nRaw, 10)
  const r = Number.parseInt(rRaw, 10)
  const p = Number.parseInt(pRaw, 10)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false

  const salt = Buffer.from(saltRaw, 'base64')
  const expected = Buffer.from(hashRaw, 'base64')

  try {
    const derived = await scrypt(plain, salt, expected.length, {
      N,
      r,
      p,
      maxmem: PARAMS.maxmem,
    })
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export default { hashPassword, verifyPassword }
