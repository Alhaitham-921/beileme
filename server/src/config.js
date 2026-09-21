import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** server/ 目录绝对路径 */
export const SERVER_ROOT = path.resolve(here, '..')

// 使用 Node 内置的 .env 加载能力，避免引入 dotenv 依赖
try {
  process.loadEnvFile(path.join(SERVER_ROOT, '.env'))
} catch {
  // 没有 .env 文件时全部走下面的默认值
}

function readString(name, fallback) {
  const raw = process.env[name]
  return raw == null || raw === '' ? fallback : raw
}

function readInt(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readList(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const env = readString('NODE_ENV', 'development')
const isTest = env === 'test'

export const config = {
  env,
  isProduction: env === 'production',
  isTest,
  port: readInt('PORT', 3001),
  // 业务「今天」的时区偏移（分钟）。数据统一按 UTC 存储，但每日计划的日期归属按东八区切分，
  // 否则用户在晚上 8 点之后的学习会被算进 UTC 的第二天。
  timezoneOffsetMinutes: readInt('APP_TIMEZONE_OFFSET_MINUTES', 480),
  corsOrigins: readList('CORS_ORIGIN', ['http://localhost:5173', 'http://127.0.0.1:5173']),

  db: {
    host: readString('DB_HOST', '127.0.0.1'),
    port: readInt('DB_PORT', 3306),
    user: readString('DB_USER', 'root'),
    password: readString('DB_PASSWORD', ''),
    // 测试环境固定使用独立的库，避免污染开发数据
    database: isTest
      ? readString('DB_TEST_NAME', 'beileme_test')
      : readString('DB_NAME', 'beileme'),
    connectionLimit: readInt('DB_CONNECTION_LIMIT', 10),
  },

  jwt: {
    secret: readString('JWT_SECRET', 'dev-only-change-me-please-0123456789abcdef'),
    accessTtl: readString('ACCESS_TOKEN_TTL', '2h'),
    refreshTtlDays: readInt('REFRESH_TOKEN_TTL_DAYS', 30),
  },

  ai: {
    defaultModel: readString('AI_DEFAULT_MODEL', 'deepseek-v4'),
    cacheHours: readInt('AI_CONTENT_CACHE_HOURS', 72),
    // OpenAI 兼容协议的接入点，默认 DeepSeek 官方；换成聚合平台只需改 baseUrl
    baseUrl: readString('AI_BASE_URL', 'https://api.deepseek.com/v1'),
    apiKey: readString('AI_API_KEY', ''),
    timeoutMs: readInt('AI_TIMEOUT_MS', 60000),
    temperature: Number(readString('AI_TEMPERATURE', '1.0')),
    dailyQuota: {
      article: readInt('AI_DAILY_ARTICLE_QUOTA', 3),
      quiz: readInt('AI_DAILY_QUIZ_QUOTA', 3),
      error_card: readInt('AI_DAILY_ERROR_CARD_QUOTA', 10),
      // 薄弱点小结同样会调用模型，必须一并限额，否则会出现「唯一不设上限的生成类型」
      weak_summary: readInt('AI_DAILY_WEAK_SUMMARY_QUOTA', 2),
    },
  },
}

/** 生产环境使用默认密钥属于高危配置，启动时直接失败而不是静默带病运行 */
export function assertRuntimeSafety() {
  if (config.isProduction && config.jwt.secret.startsWith('dev-only')) {
    throw new Error('生产环境必须通过 JWT_SECRET 配置独立密钥，禁止使用开发默认值')
  }
}

export default config
