-- ─────────────────────────────────────────────────────────────
-- 010_thinking_control.sql  「关闭模型内部思考」与用户开关
--
-- 背景（同一 Prompt、同一模型、各跑 3 次的实测结果）：
--   不传任何参数               → 3/3 次都在内部思考，正文 0/3 次，
--                                1000 输出额度被思考吃光，生成必然失败
--   thinking:{type:'disabled'} → 0/3 次思考，正文 3/3 次，平均只用 413 输出 token
--   reasoning_effort:'none'    → 0/3 次思考，正文 3/3 次，平均只用 408 输出 token
--
-- 结论：与其事后用「放宽额度」硬扛，不如一开始就让模型直接写正文。
-- 更快（3 秒 vs 17 秒）、更便宜（约 1/2.5）、且不会再出现「额度全花在思考上」。
--
-- 但并非所有 OpenAI 兼容端点都认这两个参数，不认的会直接返回 400。
-- 因此把「该端点认哪种写法」也落库记住，避免每次重启都白白多一次失败请求。
--   thinking_disable_mode 取值：thinking / reasoning_effort / unsupported，空=未探测
-- ─────────────────────────────────────────────────────────────

ALTER TABLE model_capabilities
  ADD COLUMN thinking_disable_mode VARCHAR(16) NOT NULL DEFAULT ''
    COMMENT '关闭思考的可用写法：thinking / reasoning_effort / unsupported；空=未探测';

-- 默认 0（直接写正文）。想更细但更慢更贵的用户可显式打开。
ALTER TABLE user_ai_limits
  ADD COLUMN allow_thinking TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1=允许模型先内部思考（更慢更贵，但可能更细致）；0=直接写正文';
