CREATE TABLE dialogue_image_preferences (
 user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 auto_images BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE dialogue_illustrations (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 scene_id VARCHAR(32) NOT NULL,
 session_id BIGINT UNSIGNED NULL,
 turn_number SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 context_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 topic_key VARCHAR(80) NOT NULL,
 caption VARCHAR(300) NOT NULL,
 description TEXT NOT NULL,
 cast_description TEXT NOT NULL,
 image MEDIUMBLOB NULL,
 image_revision BINARY(32) NULL,
 generation_token CHAR(36) NULL,
 lease_until DATETIME(3) NULL,
 generation_error VARCHAR(32) NULL,
 attempt_day DATE NOT NULL,
 daily_attempts INT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_dialogue_image_context(user_id,context_key),
 KEY ix_dialogue_images(user_id,scene_id,session_id,turn_number),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(session_id) REFERENCES dialogue_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
