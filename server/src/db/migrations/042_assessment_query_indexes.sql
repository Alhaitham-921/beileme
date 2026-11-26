-- Additive migration: historical JSON and report snapshots remain unchanged.
ALTER TABLE assessment_sessions
  ADD COLUMN report_book_id BIGINT UNSIGNED GENERATED ALWAYS AS
    (CAST(JSON_UNQUOTE(JSON_EXTRACT(state,'$.bookId')) AS UNSIGNED)) STORED,
  ADD COLUMN report_method_version VARCHAR(80) GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(state,'$.methodVersion'))) STORED,
  ADD COLUMN report_question_version VARCHAR(80) GENERATED ALWAYS AS
    (JSON_UNQUOTE(JSON_EXTRACT(state,'$.questionSetVersion'))) STORED,
  ADD KEY ix_assessment_comparable (user_id,report_book_id,report_method_version,completed_at,id),
  ADD KEY ix_assessment_completion (user_id,completed_at,id);
