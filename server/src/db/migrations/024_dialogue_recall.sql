CREATE TABLE dialogue_recall_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  word_id BIGINT UNSIGNED NOT NULL,
  sense_key BINARY(32) NOT NULL,
  details JSON NOT NULL,
  due_on DATE NULL,
  last_result ENUM('independent','hinted','needs-practice') NULL,
  prompt_key VARCHAR(512) NULL,
  KEY ix_dialogue_recall_due (user_id, due_on, id),
  KEY ix_dialogue_recall_sense (user_id, sense_key, due_on),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE practice_followups
  ADD COLUMN recall_task_id BIGINT UNSIGNED NULL,
  ADD FOREIGN KEY (recall_task_id) REFERENCES dialogue_recall_tasks(id) ON DELETE SET NULL;

ALTER TABLE word_recall_attempts
  ADD COLUMN dialogue_task_id BIGINT UNSIGNED NULL,
  ADD FOREIGN KEY (dialogue_task_id) REFERENCES dialogue_recall_tasks(id) ON DELETE CASCADE;
