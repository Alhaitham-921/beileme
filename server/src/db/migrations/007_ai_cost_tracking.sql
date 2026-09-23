-- ─────────────────────────────────────────────────────────────
-- 007_ai_cost_tracking.sql  AI 用量与成本的记账字段
--
-- 背景：要「把成本压到极低」，就必须能看见成本。原来 ai_usage 只记了次数，
-- 无法回答「今天这些调用花了多少 token、估算多少钱」，也就没法验证优化是否奏效。
--
-- 同时给 user_api_keys 加上连通性检查结果，方便设置页告诉用户
-- 「你这把 Key 上次验证是什么时候、有没有报错」。
-- ─────────────────────────────────────────────────────────────

ALTER TABLE ai_usage
  ADD COLUMN prompt_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT '累计输入 token（服务端上报值，可能为 0）' AFTER cached_count,
  ADD COLUMN completion_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT '累计输出 token' AFTER prompt_tokens,
  ADD COLUMN cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0
    COMMENT '按配置单价估算的成本（美元），仅供展示与趋势观察' AFTER completion_tokens;

ALTER TABLE user_api_keys
  ADD COLUMN last_verified_at DATETIME NULL
    COMMENT '最近一次连通性测试时间' AFTER is_active,
  ADD COLUMN last_error VARCHAR(255) NULL
    COMMENT '最近一次调用失败的原因，成功时清空' AFTER last_verified_at;
