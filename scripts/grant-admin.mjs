import fs from 'node:fs/promises'
import path from 'node:path'
import { config, SERVER_ROOT } from '../server/src/config.js'
import { queryOne, closePool } from '../server/src/db/pool.js'

try {
  const account = process.argv[2]?.trim()
  if (!account) throw new Error('用法：npm run admin:grant -- 已注册的邮箱或手机号')
  const user = await queryOne('SELECT id FROM users WHERE (email = ? OR phone = ?) AND status = ?', [account, account, 'active'])
  if (!user) throw new Error('没有找到有效的已注册账号')
  const envPath = path.join(SERVER_ROOT, '.env')
  const text = await fs.readFile(envPath, 'utf8')
  const ids = [...new Set([...config.adminUserIds, String(user.id)])]
  const cleaned = text.replace(/^ADMIN_USER_IDS=.*\r?\n?/gm, '').trimEnd()
  await fs.writeFile(envPath, `${cleaned}\n\nADMIN_USER_IDS=${ids.join(',')}\n`)
  console.log(`已将账号 ID ${user.id} 设为管理员。重启后端后生效。`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally { await closePool() }
