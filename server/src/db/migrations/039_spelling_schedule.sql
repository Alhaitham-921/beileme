CREATE TABLE IF NOT EXISTS word_spelling_schedule (
  user_id BIGINT UNSIGNED NOT NULL,
  word_id BIGINT UNSIGNED NOT NULL,
  status ENUM('review','focus','mastered') NOT NULL DEFAULT 'review',
  due_on DATE NULL,
  stage TINYINT UNSIGNED NOT NULL DEFAULT 0,
  failure_days TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_check_on DATE NULL,
  mastered_at DATETIME(3) NULL,
  PRIMARY KEY (user_id,word_id),
  KEY ix_spelling_schedule_due (user_id,due_on,status,word_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS word_recall_daily (
  user_id BIGINT UNSIGNED NOT NULL,
  practice_on DATE NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  admitted TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id,practice_on),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
