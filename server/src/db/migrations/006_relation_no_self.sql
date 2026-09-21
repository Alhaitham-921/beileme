-- ─────────────────────────────────────────────────────────────
-- 006_relation_no_self.sql  禁止「自己与自己」的易混词关系
--
-- 背景：大批量关系计算用释义 bigram 倒排索引做候选筛选，同一个词会因为多个释义
-- 共享 bigram 而在同一个桶里出现多次，若不去重就会生成 word_id = related_word_id
-- 的关系，渲染出来是 `play vs play` 这种空差异的对比卡片。
--
-- 算法侧已经修掉，这里再加一道数据库约束，防止以后换实现时又漏掉。
-- ─────────────────────────────────────────────────────────────

DELETE FROM word_relations WHERE word_id = related_word_id;

ALTER TABLE word_relations
  ADD CONSTRAINT ck_relation_not_self CHECK (word_id <> related_word_id);
