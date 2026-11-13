ALTER TABLE word_memory_images ADD COLUMN image_revision BINARY(32) NULL;
UPDATE word_memory_images SET image_revision = UNHEX(SHA2(image, 256)) WHERE image IS NOT NULL;
