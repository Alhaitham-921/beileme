-- ─────────────────────────────────────────────────────────────
-- 008_user_ai_limits.sql  用户自定义 AI 额度
--
-- 背景（来自实测）：max_tokens 是「输出上限」而不是「预留额度」——
-- 模型写完就停，用不到的部分不收费。所以设小了会真的失败（JSON 被截断），
-- 设大了几乎不花钱，但也不能无上限（防止模型跑飞）。
--
-- 不同用户的诉求差异很大：有人要最省，有人要最长最完整的文章。
-- 因此把额度开放给用户自己调，字段留空表示「跟随系统推荐值」。
--
-- 实测参考（用 npm run ai:calibrate 可复测）：
--   一篇 230 词短文 ≈ 320 输出 token，理解题 ≈ 490，6 张错词卡片 ≈ 560，小结 ≈ 80
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_ai_limits (
  user_id            BIGINT UNSIGNED NOT NULL,
  article_tokens     INT UNSIGNED NULL COMMENT '巩固短文的输出上限；NULL 表示用系统推荐值',
  quiz_tokens        INT UNSIGNED NULL COMMENT '阅读理解题的输出上限',
  error_card_tokens  INT UNSIGNED NULL COMMENT '一批错词卡片的输出上限',
  summary_tokens     INT UNSIGNED NULL COMMENT '薄弱点小结的输出上限',
  max_input_tokens   INT UNSIGNED NULL COMMENT '输入上限：超过会自动减少目标词数量',
  reasoning_multiplier DECIMAL(4,2) NULL COMMENT '推理型模型的额度放宽倍数',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_ai_limits_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户自定义 AI 额度';
