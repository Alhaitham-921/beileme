-- Additive only. No changes to existing users, passwords or learning records.
CREATE TABLE word_learning_evidence (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 word_id BIGINT UNSIGNED NOT NULL,
 wordbook_id BIGINT UNSIGNED NOT NULL,
 spelling VARCHAR(190) NOT NULL,
 sense VARCHAR(1000) NULL,
 source VARCHAR(24) NOT NULL,
 source_key VARCHAR(120) NOT NULL,
 result VARCHAR(24) NOT NULL,
 details JSON NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 UNIQUE KEY uk_word_evidence(user_id,source,source_key),
 KEY ix_word_evidence(user_id,wordbook_id,word_id,occurred_at),
 KEY ix_word_evidence_source(user_id,word_id,source,result),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(word_id) REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE image_recall_sessions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 source VARCHAR(16) NOT NULL,
 state JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 completed_at DATETIME(3) NULL,
 KEY ix_image_session(user_id,source,completed_at,id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE image_recall_progress (
 user_id BIGINT UNSIGNED NOT NULL,
 target_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 target JSON NOT NULL,
 last_result VARCHAR(16) NOT NULL,
 times_seen INT UNSIGNED NOT NULL DEFAULT 0,
 times_correct INT UNSIGNED NOT NULL DEFAULT 0,
 repetitions INT UNSIGNED NOT NULL DEFAULT 0,
 ef DECIMAL(4,2) NOT NULL DEFAULT 2.5,
 interval_days DECIMAL(6,2) NOT NULL DEFAULT 1,
 next_review_at DATETIME(3) NOT NULL,
 last_review_at DATETIME(3) NOT NULL,
 PRIMARY KEY(user_id,target_key),
 KEY ix_image_due(user_id,next_review_at),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE image_recall_attempts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 session_id BIGINT UNSIGNED NOT NULL,
 question_index SMALLINT UNSIGNED NOT NULL,
 result VARCHAR(16) NOT NULL,
 details JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_image_answer(session_id,question_index),
 KEY ix_image_history(user_id,created_at),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(session_id) REFERENCES image_recall_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
