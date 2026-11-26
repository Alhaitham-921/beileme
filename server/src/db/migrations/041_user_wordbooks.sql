ALTER TABLE wordbooks
  ADD COLUMN owner_user_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_wordbooks_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE;
