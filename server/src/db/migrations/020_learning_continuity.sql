ALTER TABLE study_sessions ADD COLUMN study_options JSON NULL, ADD COLUMN paused_at DATETIME NULL;
CREATE TABLE practice_followups (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 source_session_id BIGINT UNSIGNED NOT NULL,
 spelling VARCHAR(80) NOT NULL,
 word_id BIGINT UNSIGNED NULL,
 details JSON NOT NULL,
 status ENUM('pending','independent') NOT NULL DEFAULT 'pending',
 next_check_at DATETIME NOT NULL,
 completed_session_id BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uk_followup_source(user_id,source_session_id,spelling),
 KEY ix_followup_due(user_id,status,next_check_at),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(source_session_id) REFERENCES dialogue_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
