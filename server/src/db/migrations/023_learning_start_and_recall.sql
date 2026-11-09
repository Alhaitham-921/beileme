ALTER TABLE user_profiles
  ADD COLUMN study_start_level ENUM('foundation','standard','challenge') NULL,
  ADD COLUMN study_start_changed_at DATETIME NULL;

CREATE TABLE word_recall_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  state JSON NOT NULL,
  completed_at DATETIME NULL,
  KEY ix_recall_active (user_id, completed_at, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE word_recall_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  word_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  mode ENUM('practice','retest') NOT NULL,
  result ENUM('independent','hinted','needs-practice') NOT NULL,
  prompt_key VARCHAR(512) NOT NULL,
  next_check_on DATE NULL,
  answered_on DATE NOT NULL,
  UNIQUE KEY uk_recall_session_word (session_id, word_id),
  KEY ix_recall_user_word (user_id, word_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES word_recall_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
