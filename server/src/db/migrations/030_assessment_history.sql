-- Keep question snapshots independent of the current wordbook and trial form.
CREATE TABLE assessment_answers (
  session_id BIGINT UNSIGNED NOT NULL,
  question_id INT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  word_id BIGINT UNSIGNED NULL,
  question JSON NOT NULL,
  selected_index SMALLINT NOT NULL,
  correct TINYINT(1) NOT NULL,
  rt_ms INT UNSIGNED NOT NULL,
  purpose ENUM('core','history') NOT NULL DEFAULT 'core',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id, question_id),
  KEY ix_assessment_word (user_id, word_id, correct),
  FOREIGN KEY (session_id) REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE assessment_reports (
  session_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  baseline JSON NOT NULL,
  ai_explanation JSON NULL,
  generation_token CHAR(36) NULL,
  generation_started_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_assessment_reports_user (user_id, session_id),
  FOREIGN KEY (session_id) REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE ai_usage MODIFY COLUMN type
  ENUM('article','quiz','error_card','weak_summary','assessment_analysis') NOT NULL;
