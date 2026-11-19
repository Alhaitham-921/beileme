import crypto from 'node:crypto'
import { execute, queryOne, withTransaction } from '../db/pool.js'
import { config } from '../config.js'
import { ApiError, badRequest, conflict } from '../utils/errors.js'
import { mailTransport, sendRecoveryMail } from './recoveryMail.js'
import { assertRegistrationEmail } from '../utils/registrationEmail.js'

const normalize = email => String(email || '').trim().toLowerCase()
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const invalidCode = () => badRequest('验证码不正确、已过期或已使用，请重新获取。')
const codeHash = (email, id, code) => crypto.createHmac('sha256', config.jwt.secret)
  .update(`registration:${email}:${id}:${code}`).digest('hex')

export function createRegistrationVerification({ sendMail = sendRecoveryMail, ensureMail = mailTransport, now = () => Date.now() } = {}) {
  async function limit(key, max, seconds) {
    const bucket = Math.floor(now() / (seconds * 1000)) * seconds
    await execute('INSERT INTO email_recovery_limits(key_hash,bucket,attempts) VALUES(?,?,1) ON DUPLICATE KEY UPDATE attempts=attempts+1', [digest(key), bucket])
    const row = await queryOne('SELECT attempts FROM email_recovery_limits WHERE key_hash=? AND bucket=?', [digest(key), bucket])
    if (row.attempts > max) throw new ApiError(429, 'EMAIL_RATE_LIMIT', '请求过于频繁，请稍后再试。')
  }

  async function requestCode(email, ip) {
    email = normalize(email)
    if (await queryOne('SELECT id FROM users WHERE email=?', [email])) {
      throw conflict('该邮箱已注册，请直接登录。原账号及学习记录会保留。')
    }
    assertRegistrationEmail(email)
    ensureMail()
    await limit('signup-ip:' + ip, 20, 3600)
    await limit('signup-email:' + email, 1, 60)
    await limit('signup-hour:' + email, 5, 3600)
    await limit('mail-global', 100, 86400)
    await execute('DELETE FROM email_recovery_limits WHERE bucket < ?', [Math.floor(now() / 1000) - 86400])
    await execute('DELETE FROM registration_email_codes WHERE expires_at < ?', [new Date(now() - 86400000)])
    let code = crypto.randomInt(1_000_000).toString().padStart(6, '0')
    const id = crypto.randomBytes(16).toString('hex')
    await withTransaction(async conn => {
      const [rows] = await conn.execute('SELECT created_at,challenge_id,code_hash FROM registration_email_codes WHERE email=? FOR UPDATE', [email])
      if (rows[0] && now() - new Date(rows[0].created_at).getTime() < 60000) {
        throw new ApiError(429, 'EMAIL_RATE_LIMIT', '重新发送验证码需间隔60秒。')
      }
      while (rows[0] && codeHash(email, rows[0].challenge_id, code) === rows[0].code_hash) {
        code = crypto.randomInt(1_000_000).toString().padStart(6, '0')
      }
      await conn.execute(`INSERT INTO registration_email_codes
      (email,challenge_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)
      ON DUPLICATE KEY UPDATE challenge_id=VALUES(challenge_id),code_hash=VALUES(code_hash),
        expires_at=VALUES(expires_at),created_at=VALUES(created_at),delivered_at=NULL,used_at=NULL,attempts=0`,
      [email, id, codeHash(email, id, code), new Date(now() + 600000), new Date(now())])
    })
    try {
      await sendMail({ to: email, purpose: 'register', code })
      await execute('UPDATE registration_email_codes SET delivered_at=? WHERE email=? AND challenge_id=?', [new Date(now()), email, id])
    } catch {
      await execute('UPDATE registration_email_codes SET used_at=? WHERE email=? AND challenge_id=?', [new Date(now()), email, id])
      throw new ApiError(503, 'MAIL_SEND_FAILED', '邮件发送失败，请稍后重试或换一个可接收邮件的邮箱。')
    }
    return { message: '注册验证码已提交发送，10分钟内有效，请检查收件箱和垃圾邮件。', retryAfterSeconds: 60, expiresInSeconds: 600 }
  }

  // Code consumption and account creation commit together. Failed guesses must also commit.
  async function registerVerified(email, code, createUser, ip) {
    email = normalize(email)
    assertRegistrationEmail(email)
    await limit('signup-confirm-ip:' + ip, 40, 900)
    if (!/^\d{6}$/.test(String(code || ''))) throw invalidCode()
    const result = await withTransaction(async conn => {
      const [rows] = await conn.execute('SELECT * FROM registration_email_codes WHERE email=? FOR UPDATE', [email])
      const row = rows[0]
      if (!row || !row.delivered_at || row.used_at || row.attempts >= 5 || new Date(row.expires_at).getTime() <= now()) return null
      const actual = Buffer.from(codeHash(email, row.challenge_id, code), 'hex')
      if (!crypto.timingSafeEqual(Buffer.from(row.code_hash, 'hex'), actual)) {
        await conn.execute('UPDATE registration_email_codes SET attempts=attempts+1 WHERE email=?', [email])
        return null
      }
      const userId = await createUser(conn, new Date(now()))
      await conn.execute('UPDATE registration_email_codes SET used_at=? WHERE email=?', [new Date(now()), email])
      return { userId }
    })
    if (!result) throw invalidCode()
    return result.userId
  }
  return { requestCode, registerVerified }
}

export const registrationVerification = createRegistrationVerification()
