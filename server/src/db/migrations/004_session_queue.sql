-- ─────────────────────────────────────────────────────────────
-- 004_session_queue.sql  持久化学习会话的题目队列
--
-- 目的有两个：
--  1. 客户端刷新/中断后可以恢复同一组题，而不是重新抽题
--  2. 正确选项保存在服务端，提交时只上报选项下标，由服务端判定对错，
--     避免客户端直接上报 isCorrect 被伪造
-- ─────────────────────────────────────────────────────────────

ALTER TABLE study_sessions
  ADD COLUMN queue JSON NULL
    COMMENT '会话题目快照：[{wordId, kind, options:[{text, correct, wordId}], answered, correct}]'
    AFTER planned_count;
