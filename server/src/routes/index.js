import { Router } from 'express'
import authRoutes from './auth.js'
import profileRoutes from './profile.js'
import wordRoutes from './words.js'
import studyRoutes from './study.js'
import planRoutes from './plan.js'
import statsRoutes from './stats.js'
import contentRoutes from './content.js'
import aiRoutes from './ai.js'
import gameRoutes from './games.js'
import healthRoutes from './health.js'

/**
 * API 版本前缀统一为 /api/v1。
 * 各子路由内部只关心自己的相对路径，便于整体升级到 v2。
 */
const router = Router()

router.use('/health', healthRoutes)
router.use('/auth', authRoutes)
router.use('/profile', profileRoutes)
router.use('/words', wordRoutes)
router.use('/study', studyRoutes)
router.use('/plan', planRoutes)
router.use('/stats', statsRoutes)
router.use('/content', contentRoutes)
router.use('/ai', aiRoutes)
router.use('/games', gameRoutes)

export default router
