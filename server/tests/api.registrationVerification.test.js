import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { getTestServer, createClient, createOnboardedUser, playSession } from './helpers/setup.js'
import { config } from '../src/config.js'
import { createRegistrationVerification, registrationVerification } from '../src/services/registrationVerification.js'
import { queryOne, execute } from '../src/db/pool.js'
import { runMigrations, resetDatabase } from '../src/db/migrate.js'
import { smtpOptions } from '../src/services/recoveryMail.js'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../../src/stores/auth.js'
import { BASE_URL, setBaseUrl, clearTokens } from '../../src/api/client.js'

let client, sequence = 0
before(async () => { client = createClient((await getTestServer()).baseUrl) })
function fixture(t, overrides = {}) {
  const mails = [], originals = { ...registrationVerification }
  let clock = Date.now()
  const service = createRegistrationVerification({ ensureMail() {}, sendMail: async mail => { mails.push(mail) }, now: () => clock, ...overrides })
  Object.assign(registrationVerification, service)
  config.auth.requireRegistrationEmailVerification = true
  t.after(() => { Object.assign(registrationVerification, originals); config.auth.requireRegistrationEmailVerification = false })
  const email = `signup-${process.pid}-${++sequence}@qq.com`
  const register = (emailCode, extra = {}) => client.post('/api/v1/auth/register', { body: { email, emailCode, password: 'Passw0rd123', ...extra } })
  return { service, mails, email, register, advance: ms => { clock += ms } }
}

test('new accounts require an email code even when calling the API directly; no pending account is created', async t => {
  const f = fixture(t)
  assert.equal((await f.register()).status, 400)
  assert.equal(await queryOne('SELECT id FROM users WHERE email=?', [f.email]), null)
  assert.equal((await client.post('/api/v1/auth/register', { body: { phone: '+8613800013800', password: 'Passw0rd123' } })).status, 400)
  assert.equal((await client.post('/api/v1/auth/registration-code', { body: { email: 'not-an-email' } })).status, 400)
})

test('mail code registers a verified account, preserves normalization and is never returned through the API', async t => {
  const f = fixture(t)
  const response = await client.post('/api/v1/auth/registration-code', { body: { email: ` ${f.email.toUpperCase()} ` } })
  assert.equal(response.status, 202)
  assert.equal(f.mails.length, 1)
  const code = f.mails[0].code
  assert.match(code, /^\d{6}$/)
  assert.equal(Object.hasOwn(response.data, 'code'), false)
  const row = await queryOne('SELECT * FROM registration_email_codes WHERE email=?', [f.email])
  assert.equal(row.code_hash.length, 64)
  assert.equal(Object.hasOwn(row, 'code'), false)
  const result = await f.register(code, { email: ` ${f.email.toUpperCase()} ` })
  assert.equal(result.status, 201)
  assert.equal(result.data.user.emailVerified, true)
  assert.equal(result.data.profile.isOnboarded, false)
  assert.ok(result.data.tokens.accessToken)
  assert.equal((await f.register(code)).status, 409)
  assert.ok((await queryOne('SELECT used_at FROM registration_email_codes WHERE email=?', [f.email])).used_at)
})

test('five wrong guesses persist and lock the code; resend waits a full 60 seconds across minute boundaries', async t => {
  const f = fixture(t)
  await f.service.requestCode(f.email, 'signup-attempts')
  const old = f.mails[0].code, wrong = old === '000000' ? '000001' : '000000'
  for (let i = 0; i < 5; i++) assert.equal((await f.register(wrong)).status, 400)
  assert.equal((await queryOne('SELECT attempts FROM registration_email_codes WHERE email=?', [f.email])).attempts, 5)
  assert.equal((await f.register(old)).status, 400)
  f.advance(59000)
  await assert.rejects(f.service.requestCode(f.email, 'signup-attempts'), { status: 429 })
  f.advance(61000)
  await f.service.requestCode(f.email, 'signup-attempts')
  assert.equal((await f.register(f.mails.at(-1).code)).status, 201)
})

test('expired, replaced and wrong-email codes cannot create accounts', async t => {
  const f = fixture(t)
  await f.service.requestCode(f.email, 'signup-expiry')
  const first = f.mails[0].code
  f.advance(601000)
  assert.equal((await f.register(first)).status, 400)
  await f.service.requestCode(f.email, 'signup-expiry')
  assert.notEqual(f.mails.at(-1).code, first)
  assert.equal((await f.register(first)).status, 400)
  assert.equal((await queryOne('SELECT attempts FROM registration_email_codes WHERE email=?', [f.email])).attempts, 1)
  assert.equal((await f.register(f.mails.at(-1).code, { email: 'another-' + f.email })).status, 400)
  assert.equal((await f.register(f.mails.at(-1).code)).status, 201)
})

test('SMTP failure invalidates the code and does not create an account or expose provider errors', async t => {
  let captured
  const f = fixture(t, { sendMail: async mail => { captured = mail; throw Error('private smtp diagnostic') } })
  await assert.rejects(f.service.requestCode(f.email, 'signup-smtp'), error => error.status === 503 && !error.message.includes('private'))
  assert.ok((await queryOne('SELECT used_at FROM registration_email_codes WHERE email=?', [f.email])).used_at)
  assert.equal((await f.register(captured.code)).status, 400)
  assert.equal(await queryOne('SELECT id FROM users WHERE email=?', [f.email]), null)
})

test('parallel submissions create exactly one account and weak passwords do not consume a valid code', async t => {
  const f = fixture(t)
  await f.service.requestCode(f.email, 'signup-parallel')
  const code = f.mails[0].code
  assert.equal((await f.register(code, { password: 'onlyletters' })).status, 400)
  const results = await Promise.all([f.register(code), f.register(code)])
  assert.equal(results.filter(item => item.status === 201).length, 1)
  assert.ok(results.every(item => [201, 400, 409].includes(item.status)))
  assert.equal((await queryOne('SELECT COUNT(*) n FROM users WHERE email=?', [f.email])).n, 1)
})

test('old unverified accounts keep their ID, password, profile and learning data after migration, login and rejected re-registration', async t => {
  const old = await createOnboardedUser(client)
  await playSession(client, old, { strategy: 'all-correct', maxAnswers: 2 })
  const userBefore = await queryOne('SELECT id,password_hash,status,email_verified_at FROM users WHERE id=?', [old.userId])
  const profileBefore = await queryOne('SELECT * FROM user_profiles WHERE user_id=?', [old.userId])
  const progressBefore = await queryOne('SELECT COUNT(*) n FROM user_word_progress WHERE user_id=?', [old.userId])
  const f = fixture(t)
  await runMigrations({ database: config.db.database, logger: { log() {} } })
  const login = await client.post('/api/v1/auth/login', { body: { account: old.email, password: old.password } })
  assert.equal(login.status, 200)
  assert.equal(login.data.user.id, old.userId)
  assert.equal(login.data.user.emailVerified, false)
  assert.equal((await client.get('/api/v1/auth/me', { token: old.token })).status, 200)
  assert.equal((await client.post('/api/v1/auth/refresh', { body: { refreshToken: old.refreshToken } })).status, 200)
  assert.equal((await f.register('123456', { email: old.email })).status, 409)
  await assert.rejects(f.service.requestCode(old.email, 'signup-existing'), { status: 409 })
  assert.deepEqual(await queryOne('SELECT id,password_hash,status,email_verified_at FROM users WHERE id=?', [old.userId]), userBefore)
  assert.deepEqual(await queryOne('SELECT * FROM user_profiles WHERE user_id=?', [old.userId]), profileBefore)
  assert.deepEqual(await queryOne('SELECT COUNT(*) n FROM user_word_progress WHERE user_id=?', [old.userId]), progressBefore)
})

test('new registration only supports exact QQ domain, rejects other providers and spoofed domains before sending', async t => {
  const f = fixture(t)
  for (const domain of ['163.com', 'outlook.com', 'gmail.com', 'student.example.edu.cn', 'qq.com.evil.test', 'mail.qq.com', 'foxmail.com']) {
    const email = `signup-provider-${process.pid}@${domain}`
    const sent = await client.post('/api/v1/auth/registration-code', { body: { email } })
    assert.equal(sent.status, 400)
    assert.match(sent.error.message, /QQ/)
    assert.equal((await f.register('123456', { email })).status, 400)
    assert.equal(await queryOne('SELECT id FROM users WHERE email=?', [email]), null)
    assert.equal(await queryOne('SELECT email FROM registration_email_codes WHERE email=?', [email]), null)
  }
  assert.equal(f.mails.length, 0)
  let createCalled = false
  await assert.rejects(f.service.registerVerified('stale@example.com', '123456', () => { createCalled = true }, 'stale-code'), { status: 400 })
  assert.equal(createCalled, false)
})

test('existing phone accounts still log in with original password under QQ-only registration', async t => {
  const old = await createOnboardedUser(client)
  const phone = '+8613900' + String(old.userId).padStart(6, '0')
  await execute('UPDATE users SET email=NULL,phone=? WHERE id=?', [phone, old.userId])
  fixture(t)
  const logged = await client.post('/api/v1/auth/login', { body: { account: phone, password: old.password } })
  assert.equal(logged.status, 200)
  assert.equal(logged.data.user.id, old.userId)
  assert.equal((await client.get('/api/v1/auth/me', { token: old.token })).status, 200)
})

test('database reset rejects real database names before opening a connection', async () => {
  await assert.rejects(resetDatabase('beileme'), /仅允许.*_test/)
  await assert.rejects(resetDatabase('beileme_production'), /仅允许.*_test/)
  await assert.rejects(resetDatabase('accidental_test'), /显式确认/)
})

test('the actual frontend auth store sends the email code and establishes the verified login', async t => {
  const f = fixture(t)
  const previousBase = BASE_URL, previousPinia = getActivePinia()
  t.after(() => { clearTokens(); setBaseUrl(previousBase); setActivePinia(previousPinia) })
  setBaseUrl((await getTestServer()).baseUrl + '/api/v1')
  setActivePinia(createPinia())
  await f.service.requestCode(f.email, 'signup-frontend')
  const auth = useAuthStore()
  const result = await auth.register({ email: f.email, emailCode: f.mails[0].code, password: 'Passw0rd123', nickname: '邮箱测试' })
  assert.equal(result.user.emailVerified, true)
  assert.equal(auth.isLoggedIn, true)
  assert.equal(auth.user.email, f.email)
  assert.equal(auth.error, '')
})

test('SMTP supports implicit TLS on 465 and STARTTLS on 587 for different sending providers', () => {
  assert.equal(smtpOptions({}).secure, true)
  assert.equal(smtpOptions({ SMTP_PORT: '587', SMTP_HOST: 'smtp.example.com' }).secure, false)
  assert.equal(smtpOptions({ SMTP_SECURE: 'false' }).port, 587)
  assert.equal(smtpOptions({ SMTP_PORT: '587' }).requireTLS, true)
})
