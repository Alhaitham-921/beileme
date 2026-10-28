-- Each saved scene belongs to one account. Sessions retain their own snapshots,
-- so repeating a scene never overwrites an earlier conversation or its evidence.
CREATE TABLE dialogue_scenes (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 source ENUM('custom','classic') NOT NULL,
 source_scene_id VARCHAR(32) NULL,
 variant VARCHAR(32) NOT NULL DEFAULT '',
 difficulty ENUM('beginner','intermediate','advanced') NOT NULL DEFAULT 'beginner',
 scene JSON NOT NULL,
 generation_usage JSON NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uk_dialogue_saved_classic (user_id,source_scene_id,variant,difficulty),
 INDEX ix_dialogue_scenes_user (user_id,id),
 CONSTRAINT ck_dialogue_scene_source CHECK ((source='custom' AND source_scene_id IS NULL) OR (source='classic' AND source_scene_id IS NOT NULL)),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
