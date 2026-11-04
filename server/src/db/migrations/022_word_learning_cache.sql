-- Shared cache contains public dictionary material only; user AI material stays in generated_contents.
CREATE TABLE IF NOT EXISTS word_learning_dictionary_cache (
  spelling VARCHAR(190) NOT NULL,
  payload JSON NOT NULL,
  expires_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (spelling)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
