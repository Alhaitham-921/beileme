import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import apiRoutes from './routes/index.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'

/**
 * 构建 Express 应用。测试直接调用本函数拿到 app，无需监听端口。
 */
export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  // 反向代理后取到真实客户端 IP，用于刷新令牌来源记录
  app.set('trust proxy', true)

  app.use(
    cors({
      origin(origin, callback) {
        // 同源请求或非浏览器请求没有 Origin 头，直接放行
        if (!origin) return callback(null, true)
        if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
          return callback(null, true)
        }
        return callback(null, false)
      },
      credentials: true,
    })
  )

  // 生成内容与短文可能较长，放宽 body 上限
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))

  // 开发环境打印精简访问日志；测试环境保持安静
  if (!config.isTest && !config.isProduction) {
    app.use((req, res, next) => {
      const startedAt = Date.now()
      res.on('finish', () => {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`)
      })
      next()
    })
  }

  app.use('/api/v1', apiRoutes)

  // 根路径给一个可读的服务标识，便于确认端口起对了
  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      data: {
        service: '背了么 API',
        version: 'v1',
        docs: '/api/v1/health',
      },
    })
  })

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export default createApp
