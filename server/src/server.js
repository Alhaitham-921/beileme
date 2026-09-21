import { createApp } from './app.js'
import { config, assertRuntimeSafety } from './config.js'
import { queryOne, closePool } from './db/pool.js'

/**
 * 服务入口：启动前先验证配置与数据库连通性，把问题暴露在启动阶段而不是首个请求。
 */
async function main() {
  assertRuntimeSafety()

  try {
    const row = await queryOne('SELECT DATABASE() AS db, VERSION() AS version')
    console.log(`[db] 已连接 ${config.db.host}:${config.db.port}/${row.db}（MySQL ${row.version}）`)
  } catch (error) {
    console.error('[db] 连接失败：', error.message)
    console.error('请确认 MySQL 已启动，且 server/.env 中的连接信息正确；首次使用请先执行 npm run db:setup')
    process.exitCode = 1
    return
  }

  const app = createApp()
  const server = app.listen(config.port, () => {
    console.log(`[server] 背了么 API 已启动：http://127.0.0.1:${config.port}/api/v1`)
    if (!config.ai.apiKey) {
      console.log('[ai] 未配置 AI_API_KEY，AI 生成接口将返回 503，背词主链路不受影响')
    }
  })

  /** 优雅退出：停止接收新请求，等连接释放后关闭连接池 */
  const shutdown = async (signal) => {
    console.log(`\n[server] 收到 ${signal}，正在关闭…`)
    server.close(async () => {
      await closePool().catch(() => {})
      console.log('[server] 已安全退出')
      process.exit(0)
    })
    // 兜底：10 秒内没关完就强制退出，避免端口一直占着
    setTimeout(() => process.exit(1), 10000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error) => {
  console.error('[server] 启动失败：', error)
  process.exitCode = 1
})
