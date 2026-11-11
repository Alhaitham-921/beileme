-- Additive rollout: existing wordbooks, sessions and migrations remain intact.
CREATE TABLE IF NOT EXISTS ielts_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  target_band DECIMAL(2,1) NOT NULL DEFAULT 6.5,
  skill_targets JSON NOT NULL,
  exam_date DATE NULL,
  daily_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ielts_papers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(100) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  skill VARCHAR(16) NOT NULL,
  title VARCHAR(190) NOT NULL,
  status ENUM('draft','review','published') NOT NULL DEFAULT 'draft',
  body JSON NOT NULL,
  source_info JSON NOT NULL,
  review_note TEXT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_paper_version(code, version),
  KEY ix_catalog(status, skill)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ielts_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  paper_id BIGINT UNSIGNED NOT NULL,
  request_key VARCHAR(100) NOT NULL,
  mode ENUM('practice','mock') NOT NULL,
  state ENUM('active','paused','submitted') NOT NULL DEFAULT 'active',
  answers JSON NOT NULL,
  report JSON NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME(3) NOT NULL,
  deadline_at DATETIME(3) NULL,
  paused_at DATETIME(3) NULL,
  submitted_at DATETIME(3) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attempt_request(user_id, request_key),
  KEY ix_attempt_user(user_id, updated_at),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (paper_id) REFERENCES ielts_papers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ielts_answer_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempt_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  answers JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_answer_revision(attempt_id, revision),
  FOREIGN KEY (attempt_id) REFERENCES ielts_attempts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_evidence (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(140) NOT NULL,
  skill VARCHAR(20) NOT NULL,
  ability VARCHAR(32) NOT NULL,
  word_id BIGINT UNSIGNED NULL,
  correct TINYINT NULL,
  evidence JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_evidence(user_id, source_key, ability),
  KEY ix_evidence_user(user_id, skill, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_suggestions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  source_key VARCHAR(140) NOT NULL,
  spelling VARCHAR(100) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  state ENUM('pending','accepted','dismissed') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_suggestion(user_id, source_key, spelling),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ielts_materials (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(190) NOT NULL,
  topic VARCHAR(100) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_access_preferences (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  text_mode ENUM('platform','byok') NOT NULL,
  speech_mode ENUM('platform','byok') NOT NULL DEFAULT 'platform',
  speech_cipher TEXT NULL,
  speech_base_url VARCHAR(255) NULL,
  speech_model VARCHAR(100) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS platform_wallets (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  balance INT UNSIGNED NOT NULL DEFAULT 0,
  reserved INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS platform_usage (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_key VARCHAR(140) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(40) NOT NULL,
  source VARCHAR(16) NOT NULL,
  units INT UNSIGNED NOT NULL DEFAULT 1,
  state ENUM('reserved','settled','released','grant') NOT NULL,
  usage_detail JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_platform_day(source, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  attempt_id BIGINT UNSIGNED NOT NULL,
  request_key VARCHAR(100) NOT NULL,
  state ENUM('queued','running','succeeded','failed','interrupted','cancelled') NOT NULL DEFAULT 'queued',
  source VARCHAR(16) NOT NULL,
  provider_cipher TEXT NOT NULL,
  result JSON NULL,
  error_code VARCHAR(50) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_job_request(user_id, request_key),
  KEY ix_job_queue(state, id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (attempt_id) REFERENCES ielts_attempts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shared_rate_windows (
  bucket CHAR(64) NOT NULL,
  window_start BIGINT UNSIGNED NOT NULL,
  used INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY(bucket, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ielts_recordings (
  id CHAR(36) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  attempt_id BIGINT UNSIGNED NOT NULL,
  question_id VARCHAR(100) NOT NULL,
  file_name VARCHAR(100) NOT NULL,
  mime_type VARCHAR(60) NOT NULL,
  duration_ms INT UNSIGNED NOT NULL,
  bytes INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (attempt_id) REFERENCES ielts_attempts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
