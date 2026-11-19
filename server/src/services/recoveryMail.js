import nodemailer from 'nodemailer'
import { lookup } from 'node:dns/promises'
import { config } from '../config.js'
import { ApiError } from '../utils/errors.js'
let transport
export function smtpOptions(env=process.env) {
 const port=Number(env.SMTP_PORT || (env.SMTP_SECURE==='false'?587:465))
 return {host:env.SMTP_HOST || 'smtp.qq.com',port,secure:env.SMTP_SECURE==null?port===465:env.SMTP_SECURE!=='false',requireTLS:true,
  auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000,logger:false,debug:false}
}
export function mailTransport() {
 if(!process.env.SMTP_USER || !process.env.SMTP_PASS) throw new ApiError(503,'MAIL_NOT_CONFIGURED','邮件服务暂未配置，请联系管理员。')
 return transport ||= nodemailer.createTransport(smtpOptions())
}
export async function resolvedMailTransport() {
 mailTransport() // validate required configuration
 const hostname=process.env.SMTP_HOST || 'smtp.qq.com'
 const {address}=await lookup(hostname,{family:4})
 return nodemailer.createTransport({...smtpOptions(),host:address,tls:{servername:hostname}})
}
export async function sendRecoveryMail({to,purpose,code}) {
 if(config.isTest || process.env.NODE_ENV === 'test') throw new Error('Real mail disabled in tests')
 const transport=await resolvedMailTransport()
 const action=purpose==='notice'?'密码已修改':purpose==='register'?'注册验证码':purpose==='verify'?'验证邮箱':'重置密码'
 const result=await transport.sendMail({from:{name:process.env.SMTP_FROM_NAME || '背了么',address:process.env.SMTP_USER},to,subject:'背了么 · '+action,text:purpose==='notice'?'你的背了么账号密码刚刚通过邮箱找回功能修改，旧设备已退出。如非本人操作，请立即使用忘记密码重新找回账号并联系管理员。':action+'：\n\n'+code+'\n\n请回到背了么对应页面粘贴此码。'+(purpose==='register'?'10':'15')+'分钟内有效，只能使用一次。请勿向他人提供此码。若非本人操作，请忽略本邮件。'})
 if(!result.accepted?.length) throw new Error('Mail not accepted')
}
