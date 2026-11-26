CREATE TABLE library_user_books (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  author VARCHAR(120) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  source_format ENUM('txt','epub') NOT NULL,
  chapter_count SMALLINT UNSIGNED NOT NULL,
  text_bytes INT UNSIGNED NOT NULL,
  document JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_user_book_content(user_id,source_sha256),
  KEY ix_user_reading_books(user_id,created_at,id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
