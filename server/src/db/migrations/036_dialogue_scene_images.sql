CREATE TABLE dialogue_scene_images (
 session_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 image MEDIUMBLOB NULL,
 revision CHAR(32) NULL,
 plan JSON NULL,
 generation_token CHAR(36) NULL,
 lease_until DATETIME(3) NULL,
 generation_error VARCHAR(30) NULL,
 attempt_day DATE NOT NULL,
 daily_attempts INT UNSIGNED NOT NULL DEFAULT 1,
 INDEX ix_scene_image_user (user_id,attempt_day),
 FOREIGN KEY (session_id) REFERENCES dialogue_sessions(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
