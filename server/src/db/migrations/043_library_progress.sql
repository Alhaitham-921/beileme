CREATE TABLE library_progress (
  user_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('reading','listening') NOT NULL,
  content_id VARCHAR(64) NOT NULL,
  position JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(user_id,kind,content_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE library_listening_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  content_id VARCHAR(64) NOT NULL,
  answers JSON NOT NULL,
  transcript_shown TINYINT(1) NOT NULL,
  correct_count SMALLINT UNSIGNED NOT NULL,
  total SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_library_listening_history(user_id,content_id,created_at,id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
