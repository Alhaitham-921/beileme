-- ─────────────────────────────────────────────────────────────
-- 003_content.sql  AI 生成内容 / 用量限额 / 徽章 / 小游戏记录
-- 对应 PRD 4.3 AI 内容生成、4.3.6 成本控制、4.5 小游戏、4.6.2 奖励系统
-- ─────────────────────────────────────────────────────────────

-- AI 生成内容：短文 / 理解题 / 错因巩固卡片 / 薄弱点小结
CREATE TABLE IF NOT EXISTS generated_contents (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  type         ENUM('article','quiz','error_card','weak_summary') NOT NULL,
  title        VARCHAR(190)    NOT NULL DEFAULT '',
  topic        VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '话题池抽取结果：科技/环保/校园/旅行/职场...',
  difficulty   TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT '依据用户词汇量评估调整的难度 1-5',
  target_words JSON            NOT NULL COMMENT '本轮目标词 id 列表',
  content_body MEDIUMTEXT      NOT NULL COMMENT '生成正文（短文/题目 JSON 字符串）',
  meta         JSON            NULL COMMENT '结构化附加信息：生词表、答案、解析等',
  cache_key    CHAR(64)        NULL COMMENT '目标词组合 + 画像摘要 + 难度 的哈希，用于缓存复用',
  content_hash CHAR(64)        NULL COMMENT '正文哈希，用于历史去重校验',
  model        VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '实际调用的模型，如 deepseek-v4',
  prompt_tokens  INT UNSIGNED  NOT NULL DEFAULT 0,
  completion_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_content_cache (cache_key, created_at),
  KEY idx_content_user (user_id, type, created_at),
  CONSTRAINT fk_content_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 生成内容';

-- AI 用量：按用户 + 日期 + 类型计数，实现限额与降级（PRD 4.3.6 第 3 条）
CREATE TABLE IF NOT EXISTS ai_usage (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  usage_date  DATE            NOT NULL,
  type        ENUM('article','quiz','error_card','weak_summary') NOT NULL,
  used_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  cached_count INT UNSIGNED   NOT NULL DEFAULT 0 COMMENT '命中缓存、未实际消耗额度的次数',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_usage_user_date_type (user_id, usage_date, type),
  CONSTRAINT fk_usage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 生成额度用量';

-- 徽章字典（PRD 4.6.2）
CREATE TABLE IF NOT EXISTS badges (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(48)     NOT NULL,
  name        VARCHAR(64)     NOT NULL,
  description VARCHAR(255)    NOT NULL DEFAULT '',
  category    ENUM('streak','milestone','quality','challenge') NOT NULL,
  threshold   INT UNSIGNED    NOT NULL DEFAULT 0,
  icon        VARCHAR(16)     NOT NULL DEFAULT '',
  sort_order  INT             NOT NULL DEFAULT 0,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_badges_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='徽章字典';

-- 用户已解锁徽章
CREATE TABLE IF NOT EXISTS user_badges (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  badge_id    BIGINT UNSIGNED NOT NULL,
  progress    INT UNSIGNED    NOT NULL DEFAULT 0,
  unlocked_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_badge (user_id, badge_id),
  CONSTRAINT fk_ubadge_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_ubadge_badge FOREIGN KEY (badge_id) REFERENCES badges (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户徽章';

-- 小游戏记录：纯规则实现，不消耗 AI，仅回写错因证据（PRD 4.5）
CREATE TABLE IF NOT EXISTS game_records (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  game          ENUM('match','spell','listen','chain') NOT NULL,
  score         INT UNSIGNED    NOT NULL DEFAULT 0,
  correct_count INT UNSIGNED    NOT NULL DEFAULT 0,
  wrong_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  duration_ms   INT UNSIGNED    NOT NULL DEFAULT 0,
  detail        JSON            NULL COMMENT '逐题明细，用于提取拼写薄弱等错因证据',
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_game_user (user_id, created_at),
  CONSTRAINT fk_game_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='单词小游戏记录';
