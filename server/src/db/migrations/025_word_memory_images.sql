CREATE TABLE IF NOT EXISTS word_memory_images (
  user_id BIGINT UNSIGNED NOT NULL,
  word_id BIGINT UNSIGNED NOT NULL,
  sense_hash BINARY(32) NOT NULL,
  image MEDIUMBLOB NULL,
  generation_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  attempt_day DATE NOT NULL,
  daily_attempts INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, word_id, sense_hash),
  KEY idx_word_memory_image_attempts (user_id, attempt_day),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
