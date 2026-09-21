-- ─────────────────────────────────────────────────────────────
-- 002_progress.sql  学习进度 / 答题流水 / 错因 / 会话 / 每日计划
-- 对应 PRD 第五章：UserWordProgress 及 4.2 背词核心引擎
-- ─────────────────────────────────────────────────────────────

-- 用户-单词学习记录（核心表）：SRS 参数 + 记忆强度 + 汇总计数
CREATE TABLE IF NOT EXISTS user_word_progress (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  word_id           BIGINT UNSIGNED NOT NULL,
  wordbook_id       BIGINT UNSIGNED NULL,
  state             ENUM('learning','reviewing','mastered') NOT NULL DEFAULT 'learning',
  ef                DECIMAL(4,2)    NOT NULL DEFAULT 2.50 COMMENT 'SM-2 难度因子',
  repetitions       INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '连续答对次数',
  interval_days     DECIMAL(8,2)    NOT NULL DEFAULT 0 COMMENT '当前复习间隔（天，支持小数）',
  memory_strength   DECIMAL(5,2)    NOT NULL DEFAULT 0 COMMENT '记忆强度 0-100，用于复习优先级排序',
  next_review_at    DATETIME        NULL COMMENT 'SRS 计算出的下次复习时间',
  last_review_at    DATETIME        NULL,
  first_learned_at  DATETIME        NOT NULL,
  times_seen        INT UNSIGNED    NOT NULL DEFAULT 0,
  times_correct     INT UNSIGNED    NOT NULL DEFAULT 0,
  times_wrong       INT UNSIGNED    NOT NULL DEFAULT 0,
  streak_correct    INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '当前连对次数，答错清零',
  last_result       TINYINT(1)      NULL COMMENT '1 正确 / 0 错误',
  last_hesitation_ms INT UNSIGNED   NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_uwp_user_word (user_id, word_id),
  KEY idx_uwp_due (user_id, next_review_at),
  KEY idx_uwp_strength (user_id, memory_strength),
  KEY idx_uwp_learned (user_id, first_learned_at),
  CONSTRAINT fk_uwp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_uwp_word FOREIGN KEY (word_id) REFERENCES words (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户单词学习进度';

-- 学习会话：一次「开始学习」到结束
CREATE TABLE IF NOT EXISTS study_sessions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  kind            ENUM('daily','extra') NOT NULL DEFAULT 'daily' COMMENT 'daily=计划内，extra=再学一组',
  status          ENUM('active','finished','abandoned') NOT NULL DEFAULT 'active',
  planned_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  answered_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  new_count       INT UNSIGNED    NOT NULL DEFAULT 0,
  review_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  correct_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  wrong_count     INT UNSIGNED    NOT NULL DEFAULT 0,
  avg_hesitation_ms INT UNSIGNED  NOT NULL DEFAULT 0,
  started_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME        NULL,
  PRIMARY KEY (id),
  KEY idx_session_user (user_id, started_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习会话';

-- 答题流水：等价于 PRD 中 UserWordProgress.history，独立成表避免 JSON 无限膨胀
CREATE TABLE IF NOT EXISTS answer_logs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  word_id         BIGINT UNSIGNED NOT NULL,
  session_id      BIGINT UNSIGNED NULL,
  result          TINYINT(1)      NOT NULL COMMENT '1 正确 / 0 错误',
  hesitation_ms   INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '展示到首次交互的犹豫时长',
  quality         TINYINT UNSIGNED NOT NULL COMMENT '由对错 + 犹豫时长推导的 SM-2 质量分 0-5',
  is_new_word     TINYINT(1)      NOT NULL DEFAULT 0,
  source          ENUM('study','review','game','reading') NOT NULL DEFAULT 'study',
  wrong_option    VARCHAR(255)    NULL COMMENT '用户选错的中文释义，用于错因归因',
  error_type      ENUM('guess','vague','form_confusion','meaning_confusion','systematic_confusion','spelling_weak')
                  NULL COMMENT '错因标签，答对时为 NULL',
  interval_before DECIMAL(8,2)    NOT NULL DEFAULT 0,
  interval_after  DECIMAL(8,2)    NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_answer_user_time (user_id, created_at),
  KEY idx_answer_user_word (user_id, word_id, created_at),
  KEY idx_answer_error (user_id, error_type, created_at),
  CONSTRAINT fk_answer_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_answer_word FOREIGN KEY (word_id) REFERENCES words (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='答题流水';

-- 错因聚合：按用户+单词+错因累计，支撑「反复在同一组词间答错」判定
CREATE TABLE IF NOT EXISTS user_error_stats (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  word_id    BIGINT UNSIGNED NOT NULL,
  error_type ENUM('guess','vague','form_confusion','meaning_confusion','systematic_confusion','spelling_weak') NOT NULL,
  hit_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  last_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_error_user_word_type (user_id, word_id, error_type),
  KEY idx_error_user_type (user_id, error_type, hit_count),
  CONSTRAINT fk_error_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_error_word FOREIGN KEY (word_id) REFERENCES words (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='错因聚合统计';

-- 每日计划 / Todo：同时充当每日统计快照
CREATE TABLE IF NOT EXISTS daily_plans (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  plan_date       DATE            NOT NULL,
  new_target      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  review_target   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  new_done        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  review_done     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  correct_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  wrong_count     INT UNSIGNED    NOT NULL DEFAULT 0,
  article_optional TINYINT(1)     NOT NULL DEFAULT 1 COMMENT '可选的巩固短文任务',
  game_optional   TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '可选的小游戏任务',
  article_done    TINYINT(1)      NOT NULL DEFAULT 0,
  game_done       TINYINT(1)      NOT NULL DEFAULT 0,
  status          ENUM('pending','partial','done') NOT NULL DEFAULT 'pending',
  adjust_reason   ENUM('too_hard','too_much','no_time','skip') NULL COMMENT '自适应难度调节的选项（PRD 4.6.1）',
  adjust_payload  JSON            NULL,
  adjusted_at     DATETIME        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_plan_user_date (user_id, plan_date),
  KEY idx_plan_user_status (user_id, status, plan_date),
  CONSTRAINT fk_plan_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每日学习计划与统计';
