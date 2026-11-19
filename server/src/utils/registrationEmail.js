import { badRequest } from './errors.js'

// New registrations only. Never use this policy to block an existing account's login or recovery.
export function assertRegistrationEmail(email) {
  if (!/^[^\s@]+@qq\.com$/i.test(String(email || '').trim())) {
    throw badRequest('新账号仅支持 QQ 邮箱（@qq.com）；已有账号请用原账号登录。')
  }
}
