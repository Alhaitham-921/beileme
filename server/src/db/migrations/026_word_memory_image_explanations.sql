ALTER TABLE word_memory_images
  ADD COLUMN explanation VARCHAR(300) NULL,
  ADD COLUMN generation_error ENUM('scene', 'image') NULL;
