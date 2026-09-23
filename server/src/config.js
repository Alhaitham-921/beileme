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
    // 模型 id 以服务商实际提供的为准。DeepSeek 官方可用的形如
    // deepseek-v4-pro / deepseek-flash（可用 GET /models 查询，设置页里有「获取可用模型」按钮）
    defaultModel: readString('AI_DEFAULT_MODEL', 'deepseek-v4-pro'),
    cacheHours: readInt('AI_CONTENT_CACHE_HOURS', 72),
    // OpenAI 兼容协议的接入点，默认 DeepSeek 官方；换成聚合平台只需改 baseUrl
    baseUrl: readString('AI_BASE_URL', 'https://api.deepseek.com/v1'),
    apiKey: readString('AI_API_KEY', ''),
    timeoutMs: readInt('AI_TIMEOUT_MS', 60000),
    temperature: Number(readString('AI_TEMPERATURE', '1.0')),

    // ── 成本控制参数（PRD 4.3.6）────────────────────────────
    /**
     * 输出 token 上限。放开它等于放开单次成本上限，因此按内容类型分别收紧。
     *
     * 下面的默认值来自 `npm run ai:calibrate` 的实测（约 1.6 倍余量）：
     *   一篇 230 词短文 ≈ 320 输出 token，理解题 ≈ 490，6 张错词卡片 ≈ 560，小结 ≈ 80
     *
     * 注意 max_tokens 是「天花板」而不是「预留」：模型写完就停，用不到的额度不收费。
     * 所以调大它几乎不花钱，调小却会真的导致 JSON 被截断、生成失败。
     * 用户可以在设置页覆盖这些值（见 user_ai_limits 表）。
     */
    maxOutputTokens: {
      article: readInt('AI_MAX_TOKENS_ARTICLE', 1000),
      quiz: readInt('AI_MAX_TOKENS_QUIZ', 2000),
      error_card_batch: readInt('AI_MAX_TOKENS_CARD_BATCH', 3200),
      weak_summary: readInt('AI_MAX_TOKENS_SUMMARY', 600),
    },
    /** 单次输入 token 预算：预计超过就自动减少目标词数量，而不是把长 Prompt 直接发出去 */
    maxInputTokens: readInt('AI_MAX_INPUT_TOKENS', 2000),
    /**
     * 推理型模型（把 token 花在内部思考上的那些）的输出额度放宽倍数。
     * 同一个 max_tokens 预算下，推理模型留给正文的空间远小于普通模型，
     * 不放宽就会出现「JSON 被截断、解析失败」。可用 npm run ai:calibrate 实测后调整。
     */
    reasoningBudgetMultiplier: Number(readString('AI_REASONING_BUDGET_MULTIPLIER', '3')),
    /** token 估算参数（各家分词器不同，取保守值用于预估，不参与实际计费） */
    tokensPerCjkChar: Number(readString('AI_TOKENS_PER_CJK_CHAR', '1.0')),
    tokensPerWord: Number(readString('AI_TOKENS_PER_WORD', '1.4')),
    /**
     * 单价（美元 / 百万 token），只用于估算与展示，不影响真实计费。
     * 默认值取自 DeepSeek 的常见公开报价，**换厂商或官方调价后必须同步修改**，
     * 否则界面展示的成本会失真。也可以把单价全设为 0，只显示 token 数。
     */
    pricePerMillion: {
      input: Number(readString('AI_PRICE_INPUT_PER_M', '0.27')),
      output: Number(readString('AI_PRICE_OUTPUT_PER_M', '1.10')),
      /** 命中上下文缓存的输入单价通常低一个数量级 */
      cachedInput: Number(readString('AI_PRICE_CACHED_INPUT_PER_M', '0.07')),
    },

    dailyQuota: {
      article: readInt('AI_DAILY_ARTICLE_QUOTA', 3),
      quiz: readInt('AI_DAILY_QUIZ_QUOTA', 3),
      error_card: readInt('AI_DAILY_ERROR_CARD_QUOTA', 10),
      // 薄弱点小结同样会调用模型，必须一并限额，否则会出现「唯一不设上限的生成类型」
      weak_summary: readInt('AI_DAILY_WEAK_SUMMARY_QUOTA', 2),
    },
    /**
     * 用户自带 Key 时额度放宽的倍数。
     *
     * 用户用自己的 Key 时花的不是官方预算，因此不该被官方额度卡住；
     * 但仍然保留一个宽松上限，避免脚本化的异常调用把服务当成免费代理。
     */
    userKeyQuotaMultiplier: readInt('AI_USER_KEY_QUOTA_MULTIPLIER', 20),
  },

  security: {
    /**
     * 用户自带 API Key 的加密主密钥。留空时从 JWT_SECRET 派生。
     * 注意：这两个值一旦变更，已存的 Key 就无法解密，用户需要重新填写。
     */
    keyEncryptionSecret: readString('AI_KEY_ENCRYPTION_SECRET', ''),
  },
}

/** 生产环境使用默认密钥属于高危配置，启动时直接失败而不是静默带病运行 */
export function assertRuntimeSafety() {
  if (config.isProduction && config.jwt.secret.startsWith('dev-only')) {
    throw new Error('生产环境必须通过 JWT_SECRET 配置独立密钥，禁止使用开发默认值')
  }
}

export default config
