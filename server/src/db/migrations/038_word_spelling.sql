CREATE TABLE IF NOT EXISTS word_spelling_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  request_key CHAR(36) NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  state JSON NOT NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_spelling_request (user_id, request_key),
  KEY ix_spelling_active (user_id, completed_at, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS word_spelling_results (
  session_id BIGINT UNSIGNED NOT NULL,
  word_id BIGINT UNSIGNED NOT NULL,
  first_result VARCHAR(16) NOT NULL,
  first_errors INT UNSIGNED NOT NULL DEFAULT 0,
  retry_result VARCHAR(16) NULL,
  retry_errors INT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, word_id),
  FOREIGN KEY (session_id) REFERENCES word_spelling_sessions(id),
  FOREIGN KEY (word_id) REFERENCES words(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
