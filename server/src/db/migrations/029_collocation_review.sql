CREATE TABLE collocation_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  word_id BIGINT UNSIGNED NULL,
  state JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  KEY ix_collocation_session (user_id, word_id, completed_at, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE collocation_progress (
  user_id BIGINT UNSIGNED NOT NULL,
  word_id BIGINT UNSIGNED NOT NULL,
  phrase_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  question JSON NOT NULL,
  times_seen INT UNSIGNED NOT NULL DEFAULT 0,
  times_correct INT UNSIGNED NOT NULL DEFAULT 0,
  times_wrong INT UNSIGNED NOT NULL DEFAULT 0,
  last_result ENUM('correct','incorrect','unknown') NOT NULL,
  repetitions INT UNSIGNED NOT NULL DEFAULT 0,
  ef DECIMAL(4,2) NOT NULL DEFAULT 2.5,
  interval_days DECIMAL(6,2) NOT NULL DEFAULT 1,
  next_review_at DATETIME(3) NOT NULL,
  last_review_at DATETIME(3) NOT NULL,
  last_wrong_at DATETIME(3) NULL,
  PRIMARY KEY (user_id, word_id, phrase_key),
  KEY ix_collocation_due (user_id, next_review_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE collocation_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  word_id BIGINT UNSIGNED NOT NULL,
  phrase_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  question_index SMALLINT UNSIGNED NOT NULL,
  answer VARCHAR(320) NOT NULL,
  result ENUM('correct','incorrect','unknown') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_collocation_answer (session_id, question_index),
  KEY ix_collocation_history (user_id, word_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES collocation_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
