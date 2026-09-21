-- ─────────────────────────────────────────────────────────────
-- 001_core.sql  用户体系 / 词书 / 单词 / 词形词义关系
-- 对应 PRD 第五章数据模型：User、WordBook、Word、Word.related_words
-- ─────────────────────────────────────────────────────────────

-- 用户：支持邮箱或手机号注册，多用户数据严格隔离（PRD 4.7）
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(190)    NULL COMMENT '注册邮箱，与 phone 至少填一个',
  phone         VARCHAR(32)     NULL COMMENT '注册手机号，与 email 至少填一个',
  password_hash VARCHAR(255)    NOT NULL COMMENT 'scrypt 派生结果，格式 scrypt$N$r$p$salt$hash',
  nickname      VARCHAR(64)     NOT NULL DEFAULT '',
  status        ENUM('active','disabled') NOT NULL DEFAULT 'active',
  token_version INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '自增后可使该用户已签发的 access token 全部失效',
  last_login_at DATETIME        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email),
  UNIQUE KEY uk_users_phone (phone),
  CONSTRAINT ck_users_account CHECK (email IS NOT NULL OR phone IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户账号';

-- 刷新令牌：只存哈希，支持登出与轮换
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64)        NOT NULL COMMENT 'sha256(refreshToken) 十六进制',
  user_agent VARCHAR(255)    NULL,
  ip         VARCHAR(64)     NULL,
  expires_at DATETIME        NOT NULL,
  revoked_at DATETIME        NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_refresh_hash (token_hash),
  KEY idx_refresh_user (user_id, expires_at),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='刷新令牌';

-- 用户画像：Onboarding 问卷结果，作为 AI 生成的强 Prompt 变量（PRD 4.1 / 4.4）
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id       BIGINT UNSIGNED NOT NULL,
  goal          VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '中考/高考/四级/六级/考研/雅思/托福/纯兴趣/自定义',
  exam_date     DATE            NULL COMMENT '考试日期，用于反推每日任务量',
  self_level    VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '自评词汇量档位',
  daily_time    VARCHAR(16)     NOT NULL DEFAULT '' COMMENT '5-10 / 15-20 / 30+',
  new_per_day   SMALLINT UNSIGNED NOT NULL DEFAULT 15 COMMENT '每日新词量',
  review_per_day SMALLINT UNSIGNED NOT NULL DEFAULT 30 COMMENT '每日复习量上限',
  memory_prefs  JSON            NULL COMMENT '倾向的记忆方式多选：example/affix/image/context/game',
  topic_weights JSON            NULL COMMENT '话题权重，随用户行为演化实现「越用越懂你」',
  needs_writing TINYINT(1)      NOT NULL DEFAULT 0,
  onboarded_at  DATETIME        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户学习画像';

-- 自定义 AI API Key（PRD 4.8），密文存储，预留字段供 P1 落地
CREATE TABLE IF NOT EXISTS user_api_keys (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  provider   VARCHAR(32)     NOT NULL COMMENT 'deepseek/openai/anthropic/...',
  label      VARCHAR(64)     NOT NULL DEFAULT '',
  key_cipher VARCHAR(1024)   NOT NULL COMMENT 'AES-256-GCM 密文，仅用于该用户自己的请求',
  base_url   VARCHAR(255)    NULL,
  model      VARCHAR(64)     NULL,
  is_active  TINYINT(1)      NOT NULL DEFAULT 1,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_api_user (user_id, is_active),
  CONSTRAINT fk_api_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户自定义 AI 接入';

-- 词书
CREATE TABLE IF NOT EXISTS wordbooks (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(48)     NOT NULL COMMENT '唯一标识，如 cet4 / gaokao / ielts',
  name        VARCHAR(96)     NOT NULL,
  scope       VARCHAR(32)     NOT NULL COMMENT '中考/高考/四级/六级/考研/雅思/托福/自定义',
  description VARCHAR(255)    NOT NULL DEFAULT '',
  is_builtin  TINYINT(1)      NOT NULL DEFAULT 1,
  word_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wordbooks_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='词书';

-- 单词：definitions / examples 使用 JSON 保留多释义与多例句
CREATE TABLE IF NOT EXISTS words (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wordbook_id   BIGINT UNSIGNED NOT NULL,
  spelling      VARCHAR(64)     NOT NULL,
  spelling_norm VARCHAR(64)     NOT NULL COMMENT '小写拼写，用于唯一约束与快速匹配',
  phonetic      VARCHAR(64)     NOT NULL DEFAULT '',
  pos           VARCHAR(32)     NOT NULL DEFAULT '',
  freq          ENUM('high','med','low') NOT NULL DEFAULT 'med' COMMENT '词频，决定新词学习先后',
  difficulty    TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT '难度 1-5，1 最简单',
  definitions   JSON            NOT NULL COMMENT '中文释义数组',
  examples      JSON            NOT NULL COMMENT '英文例句数组',
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_words_book_spelling (wordbook_id, spelling_norm),
  KEY idx_words_freq (wordbook_id, freq, difficulty),
  KEY idx_words_spelling (spelling_norm),
  CONSTRAINT fk_words_book FOREIGN KEY (wordbook_id) REFERENCES wordbooks (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='单词';

-- 形近词 / 近义词关系（PRD 4.2.3 易混词推荐）
CREATE TABLE IF NOT EXISTS word_relations (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  word_id         BIGINT UNSIGNED NOT NULL,
  related_word_id BIGINT UNSIGNED NOT NULL,
  relation_type   ENUM('form','meaning') NOT NULL COMMENT 'form=形近，meaning=近义',
  score           DECIMAL(4,3)    NOT NULL DEFAULT 0.500 COMMENT '相似度 0-1，越大越易混',
  source          ENUM('builtin','computed','ai') NOT NULL DEFAULT 'computed',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_relation (word_id, related_word_id, relation_type),
  KEY idx_relation_word (word_id, relation_type, score),
  CONSTRAINT fk_relation_word FOREIGN KEY (word_id) REFERENCES words (id) ON DELETE CASCADE,
  CONSTRAINT fk_relation_related FOREIGN KEY (related_word_id) REFERENCES words (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='形近词/近义词关系';
