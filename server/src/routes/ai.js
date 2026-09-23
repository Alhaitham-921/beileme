import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, ok, created } from '../utils/http.js'
import {
  getAiStatus,
  getUsageSummary,
  saveKeyWithVerification,
  verifyKeyOnly,
  listAvailableModels,
  testActiveKey,
  deleteUserKey,
  listUserKeys,
  resolveLimits,
  saveLimits,
  applyPreset,
  resetLimits,
  describeLimitOptions,
} from '../services/ai/contentService.js'
import { PROVIDER_IDS, PROVIDER_PRESETS } from '../services/ai/apiKeyService.js'
import { describePricing } from '../services/ai/costEstimate.js'
import { notFound } from '../utils/errors.js'

const router = Router()

router.use(requireAuth)

const keyIdParam = z.object({ id: z.coerce.number().int().positive() })

const saveKeySchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  apiKey: z.string().min(8, 'API Key 至少 8 位').max(512),
  baseUrl: z.string().url('接口地址必须是合法 URL').max(255).optional().or(z.literal('')),
  model: z.string().max(64).optional(),
  label: z.string().max(64).optional(),
})

/** 试连不需要 label，其余与保存一致 */
const verifyKeySchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  apiKey: z.string().min(8, 'API Key 至少 8 位').max(512),
  baseUrl: z.string().url('接口地址必须是合法 URL').max(255).optional().or(z.literal('')),
  model: z.string().max(64).optional(),
})

/** 拉模型列表同样只需要 Key 与地址 */
const modelListSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  apiKey: z.string().min(8, 'API Key 至少 8 位').max(512),
  baseUrl: z.string().url('接口地址必须是合法 URL').max(255).optional().or(z.literal('')),
  model: z.string().max(64).optional(),
})

/**
 * 额度可以直接套用档位，也可以逐项调整。
 * 逐项传 null 表示「该字段恢复系统推荐值」。
 *
 * 注意 z.null() 必须放在 z.coerce.number() 前面：
 * Number(null) === 0，coerce 在前会把「恢复推荐值」静默变成「把额度设成 0」。
 */
const optionalLimit = z.union([z.null(), z.coerce.number().int()]).optional()

const limitsSchema = z.object({
  preset: z.enum(['frugal', 'balanced', 'quality']).optional(),
  articleTokens: optionalLimit,
  quizTokens: optionalLimit,
  errorCardTokens: optionalLimit,
  summaryTokens: optionalLimit,
  maxInputTokens: optionalLimit,
  reasoningMultiplier: z.union([z.null(), z.coerce.number()]).optional(),
  /**
   * 是否允许模型先内部思考。用 z.boolean() 而不是 z.coerce.boolean()：
   * coerce 会把字符串 'false' 变成 true，这种静默反转非常难查。
   */
  allowThinking: z.union([z.null(), z.boolean()]).optional(),
})

/**
 * GET /api/v1/ai/status
 * 一次性返回：当前用谁的钱、官方额度状态、可选服务商、我的 Key 列表、今日与近 30 天用量、定价说明。
 * 设置页只需要调这一个接口。
 */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    return ok(res, await getAiStatus(req.user.id))
  })
)

/** GET /api/v1/ai/usage —— 只取用量明细 */
router.get(
  '/usage',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).optional() }) }),
  asyncHandler(async (req, res) => {
    return ok(res, {
      ...(await getUsageSummary(req.user.id, { days: Number(req.query.days) || 30 })),
      pricing: describePricing(),
    })
  })
)

/** GET /api/v1/ai/providers —— 可选服务商预设（Base URL 与默认模型） */
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    return ok(res, {
      items: PROVIDER_IDS.map((id) => ({ id, ...PROVIDER_PRESETS[id] })),
    })
  })
)

/**
 * PUT /api/v1/ai/keys
 * 保存用户自带 Key。**保存前先分步校验**：
 * 先用不花钱的 GET /models 验 Key，再检查模型名，最后发一次 8 token 的调用；
 * 全部通过才入库——存进一把错的 Key，只会让用户在真正生成内容时才遇到失败。
 *
 * 校验失败时返回 400 并带上完整的诊断过程（每一步结果、可用模型、排查建议），
 * 而不是一句「校验未通过」让用户无从下手。
 */
router.put(
  '/keys',
  validate({ body: saveKeySchema }),
  asyncHandler(async (req, res) => {
    const body = req.valid.body
    const result = await saveKeyWithVerification(req.user.id, {
      provider: body.provider,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl || '',
      model: body.model || '',
      label: body.label || '',
    })

    if (!result.saved) {
      // 用 400 而不是 502：这是用户填错了，不是服务故障
      return res.status(400).json({
        ok: false,
        error: {
          code: 'AI_KEY_UNVERIFIED',
          message: `校验未通过：${result.test.message}`,
          details: result.test,
        },
      })
    }

    return created(res, {
      key: result.key,
      test: result.test,
      /** 通过但存在需要用户知晓的情况（例如推理型模型会占用输出额度） */
      warnings: result.test.warnings || [],
      message:
        result.test.warnings?.length > 0
          ? `已保存（${result.test.latencyMs}ms，模型 ${result.test.resolvedModel}），但有需要注意的地方`
          : `校验通过（${result.test.latencyMs}ms，模型 ${result.test.model}）`,
    })
  })
)

/**
 * GET /api/v1/ai/limits
 * 读取该用户当前生效的 token 额度，以及可选的档位与实测参考值。
 */
router.get(
  '/limits',
  asyncHandler(async (req, res) => {
    return ok(res, {
      limits: await resolveLimits(req.user.id),
      ...describeLimitOptions(),
    })
  })
)

/**
 * PUT /api/v1/ai/limits
 * body 可以是 { preset: 'frugal'|'balanced'|'quality' } 一键套用，
 * 也可以是 { articleTokens: 800, ... } 逐项调整（传 null 表示恢复该字段的推荐值）。
 */
router.put(
  '/limits',
  validate({ body: limitsSchema }),
  asyncHandler(async (req, res) => {
    const body = req.valid.body
    if (body.preset) {
      return ok(res, { limits: await applyPreset(req.user.id, body.preset), preset: body.preset })
    }

    const patch = {}
    for (const field of [
      'articleTokens',
      'quizTokens',
      'errorCardTokens',
      'summaryTokens',
      'maxInputTokens',
      'reasoningMultiplier',
      'allowThinking',
    ]) {
      if (field in body) patch[field] = body[field]
    }

    return ok(res, { limits: await saveLimits(req.user.id, patch) })
  })
)

/** POST /api/v1/ai/limits/reset —— 恢复系统推荐值 */
router.post(
  '/limits/reset',
  asyncHandler(async (req, res) => {
    return ok(res, { limits: await resetLimits(req.user.id) })
  })
)

/**
 * POST /api/v1/ai/models
 * 拉取账号可用的模型列表（只调 GET /models，**不消耗 token**），供设置页做下拉选择。
 * 这样用户不用手打模型名——手打极易出现大小写或拼写错误。
 */
router.post(
  '/models',
  validate({ body: modelListSchema }),
  asyncHandler(async (req, res) => {
    const body = req.valid.body
    return ok(
      res,
      await listAvailableModels(req.user.id, {
        provider: body.provider,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl || '',
        model: body.model || '',
      })
    )
  })
)

/**
 * POST /api/v1/ai/keys/verify
 * 只校验不保存：让用户能在不留下记录的前提下反复调试 Key / 地址 / 模型名。
 */
router.post(
  '/keys/verify',
  validate({ body: verifyKeySchema }),
  asyncHandler(async (req, res) => {
    const body = req.valid.body
    return ok(
      res,
      await verifyKeyOnly(req.user.id, {
        provider: body.provider,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl || '',
        model: body.model || '',
      })
    )
  })
)

/** GET /api/v1/ai/keys —— 我的 Key 列表（只回打码值） */
router.get(
  '/keys',
  asyncHandler(async (req, res) => {
    return ok(res, { items: await listUserKeys(req.user.id) })
  })
)

/** DELETE /api/v1/ai/keys/:id —— 删除（PRD 4.8：Key 只用于该用户自己的请求，应可随时移除） */
router.delete(
  '/keys/:id',
  validate({ params: keyIdParam }),
  asyncHandler(async (req, res) => {
    return ok(res, await deleteUserKey(req.user.id, req.valid.params.id))
  })
)

/**
 * POST /api/v1/ai/keys/test
 * 测试当前生效的 Key。走最小请求（输出上限 8 token），成本几乎为 0。
 */
router.post(
  '/keys/test',
  asyncHandler(async (req, res) => {
    const result = await testActiveKey(req.user.id)
    if (!result.ok && result.kind === 'not_configured') {
      throw notFound(result.message)
    }
    return ok(res, result)
  })
)

export default router
