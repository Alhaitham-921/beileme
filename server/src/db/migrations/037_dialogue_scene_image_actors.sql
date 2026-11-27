ALTER TABLE dialogue_scene_images
  ADD COLUMN actor_id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL DEFAULT '' AFTER session_id,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (session_id, actor_id);
