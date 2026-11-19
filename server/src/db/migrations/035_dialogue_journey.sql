-- Additive feature data only. Existing accounts, dialogues and learning records are retained.
CREATE TABLE dialogue_challenge_results (
 session_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 challenge_key VARCHAR(190) NOT NULL,
 family VARCHAR(64) NOT NULL,
 context_key CHAR(64) NOT NULL,
 target_keys JSON NOT NULL,
 completed TINYINT(1) NOT NULL DEFAULT 0,
 independent TINYINT(1) NOT NULL DEFAULT 0,
 transfer TINYINT(1) NOT NULL DEFAULT 0,
 earned_at DATETIME(3) NOT NULL,
 INDEX ix_challenge_user (user_id,family,earned_at),
 FOREIGN KEY (session_id) REFERENCES dialogue_sessions(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE dialogue_consolidation_attempts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 session_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 run_number INT UNSIGNED NOT NULL,
 question_id VARCHAR(40) NOT NULL,
 word_id BIGINT UNSIGNED NULL,
 spelling VARCHAR(64) NOT NULL,
 sense VARCHAR(190) NOT NULL,
 question_type VARCHAR(20) NOT NULL,
 result VARCHAR(20) NOT NULL,
 answer VARCHAR(200) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 UNIQUE KEY uk_consolidation_question (session_id,run_number,question_id),
 INDEX ix_consolidation_user (user_id,created_at),
 FOREIGN KEY (session_id) REFERENCES dialogue_sessions(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
