CREATE TABLE IF NOT EXISTS ielts_audio_plays (
  attempt_id BIGINT UNSIGNED NOT NULL,
  section_id VARCHAR(100) NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(attempt_id, section_id),
  FOREIGN KEY (attempt_id) REFERENCES ielts_attempts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
