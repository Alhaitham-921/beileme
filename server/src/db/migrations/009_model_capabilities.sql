-- ─────────────────────────────────────────────────────────────
-- 009_model_capabilities.sql  模型能力的持久化记忆
--
-- 背景（实测踩到的坑）：推理型模型会把输出 token 花在内部思考上，
-- 必须为它放宽额度，否则「Key 有效、模型存在」却始终生成失败。
--
-- 最初这个标记只存在内存里，服务器一重启就丢了：
-- 表现就是「刚重启后的第一次生成必然失败」，非常难查。
-- 因此改为落库，进程启动后按需载入。
--
-- capability_key 形如 `https://api.deepseek.com/v1|deepseek-v4-pro`。
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS model_capabilities (
  capability_key        VARCHAR(255) NOT NULL,
  base_url              VARCHAR(255) NOT NULL DEFAULT '',
  model                 VARCHAR(64)  NOT NULL DEFAULT '',
  is_reasoning          TINYINT(1)   NOT NULL DEFAULT 0
    COMMENT '1=推理型模型，输出额度需按倍数放宽',
  json_mode_unsupported TINYINT(1)   NOT NULL DEFAULT 0
    COMMENT '1=该端点不认 response_format，需退回普通模式',
  observed_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (capability_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模型能力探测结果';
