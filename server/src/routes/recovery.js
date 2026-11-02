import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok } from '../utils/http.js'
import { passwordRecovery } from '../services/passwordRecovery.js'
export function createRecoveryRouter({service=passwordRecovery}={}){
 const router=Router()
 const email=z.string().trim().toLowerCase().email().max(190)
 const code=z.string().trim().toLowerCase().regex(/^[a-f0-9]{32}$/,'请输入邮件中的完整32位码')
 // Do not trust a caller-supplied X-Forwarded-For for recovery rate limits.
 const ip=req=>req.socket.remoteAddress || 'unknown'
 router.post('/forgot-password',validate({body:z.object({email})}),asyncHandler(async(req,res)=>ok(res,await service.requestReset(req.valid.body.email,ip(req)),202)))
 router.post('/reset-password',validate({body:z.object({email,code,newPassword:z.string().min(8).max(128)})}),asyncHandler(async(req,res)=>ok(res,await service.consume({...req.valid.body,purpose:'reset',ip:ip(req)}))))
 router.post('/email-verification',requireAuth,validate({body:z.object({currentPassword:z.string().min(1).max(128)})}),asyncHandler(async(req,res)=>ok(res,await service.requestVerification(req.user.id,req.valid.body.currentPassword,ip(req)))))
 router.post('/verify-email',requireAuth,validate({body:z.object({code})}),asyncHandler(async(req,res)=>ok(res,await service.consume({userId:req.user.id,code:req.valid.body.code,purpose:'verify',ip:ip(req)}))))
 return router
}
export default createRecoveryRouter()
