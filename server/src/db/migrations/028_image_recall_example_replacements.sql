CREATE TABLE IF NOT EXISTS image_recall_example_replacements (
  user_id BIGINT UNSIGNED NOT NULL,
  example_key VARCHAR(32) NOT NULL,
  image MEDIUMBLOB NULL,
  image_revision BINARY(32) NULL,
  explanation VARCHAR(300) NULL,
  generation_error ENUM('scene', 'image') NULL,
  generation_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  attempt_day DATE NOT NULL,
  daily_attempts INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, example_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
