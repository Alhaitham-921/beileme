-- ─────────────────────────────────────────────────────────────
-- 005_wordbook_selection.sql  记录用户选定的词书
--
-- 背景：词库从内置的 80 词扩展为 8 本开源词书之后，「用哪本书」不再唯一。
-- 之前是取内置的第一本，现在改为按 Onboarding 的学习目标映射（四级→CET4 等），
-- 并把结果固化到画像上，好处有两个：
--   1. 用户后续改目标时，不会在不知不觉中换掉正在背的书
--   2. 为 PRD 里的「自定义词书」留出字段：届时直接写这个 id 即可
-- ─────────────────────────────────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN wordbook_id BIGINT UNSIGNED NULL
    COMMENT '用户当前使用的词书；为空时按 goal 映射到默认词书'
    AFTER review_per_day,
  ADD CONSTRAINT fk_profile_wordbook
    FOREIGN KEY (wordbook_id) REFERENCES wordbooks (id) ON DELETE SET NULL;
