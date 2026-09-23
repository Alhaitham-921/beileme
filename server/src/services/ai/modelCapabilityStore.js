import { query, pool } from '../../db/pool.js'
import {
  restoreModelCapabilities,
  snapshotModelCapabilities,
  markReasoningModel,
  capabilityKeyOf,
} from './aiProvider.js'

/**
 * 模型能力的持久化（`model_capabilities` 表）。
 *
 * 存在的理由：推理型模型必须放宽输出额度，否则会一直生成失败。
 * 这个结论最早只存在内存里，服务器一重启就丢，表现是
 * 「重启后第一次生成必然失败」——现象随机、极难定位。
 * 落库之后进程启动即可恢复结论，第一次调用就是对的。
 */

let hydrated = null

/**
 * 已经写进库的 key。
 *
 * 必须和内存里的「已知能力」分开跟踪：`chat()` 在抛错前就会把推理标记写进内存，
 * 如果这里用 `isReasoningModel()` 判断「是否已记录」，永远会得到 true，
 * 结果就是**永远不落库**——服务器一重启结论就丢，重启后第一次生成必然失败。
 */
const persistedKeys = new Set()

/** 进程内只从库里读一次，之后都走内存 */
export function ensureCapabilitiesLoaded() {
  if (!hydrated) {
    hydrated = (async () => {
      try {
        const rows = await query('SELECT * FROM model_capabilities')
        restoreModelCapabilities(rows)
        // 从库里恢复的本来就已经在库里了，不需要再写一次
        for (const row of rows) persistedKeys.add(row.capability_key)
        return rows.length
      } catch {
        // 表还没建好时不该影响主流程（首次迁移前）
        return 0
      }
    })()
  }
  return hydrated
}

/** 把内存里新观察到的能力写回库（失败不影响调用本身） */
export async function persistCapabilities() {
  try {
    const rows = snapshotModelCapabilities()
    if (!rows.length) return 0

    for (const row of rows) {
      await pool.execute(
        `INSERT INTO model_capabilities
           (capability_key, base_url, model, is_reasoning, json_mode_unsupported, thinking_disable_mode)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           is_reasoning = GREATEST(is_reasoning, VALUES(is_reasoning)),
           json_mode_unsupported = GREATEST(json_mode_unsupported, VALUES(json_mode_unsupported)),
           thinking_disable_mode = IF(VALUES(thinking_disable_mode) = '', thinking_disable_mode, VALUES(thinking_disable_mode)),
           observed_at = NOW()`,
        [
          row.capability_key,
          row.base_url,
          row.model || '',
          Number(row.is_reasoning || 0),
          Number(row.json_mode_unsupported || 0),
          String(row.thinking_disable_mode || ''),
        ]
      )
    }
    return rows.length
  } catch (error) {
    console.warn('[ai] 模型能力写库失败（不影响本次调用）：', error.message)
    return 0
  }
}

/**
 * 记住「这个模型是推理型」并落库。
 * 内存立即生效（本次调用就能用上），落库只做一次（同一能力不重复写）。
 */
export async function rememberReasoningModel(baseUrl, model) {
  if (!model) return
  markReasoningModel(baseUrl, model)

  const key = capabilityKeyOf(baseUrl, model)
  if (persistedKeys.has(key)) return
  persistedKeys.add(key)
  await persistCapabilities()
}

/** 清空进程内的缓存，测试用 */
export function resetCapabilityCache() {
  hydrated = null
  persistedKeys.clear()
}

export default {
  ensureCapabilitiesLoaded,
  persistCapabilities,
  rememberReasoningModel,
  resetCapabilityCache,
}
