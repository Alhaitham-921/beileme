ALTER TABLE practice_followups
  ADD COLUMN schedule_mode ENUM('next', 'time') NULL,
  ADD COLUMN scheduled_at DATETIME(3) NULL,
  ADD INDEX ix_followup_study_schedule (user_id, status, scheduled_at, word_id);
