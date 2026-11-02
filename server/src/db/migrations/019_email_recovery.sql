ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL;
CREATE TABLE email_challenges (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 purpose ENUM('verify','reset') NOT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE,
 token_version INT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 used_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_email_challenge_user(user_id,purpose),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE email_recovery_limits (
 key_hash CHAR(64) NOT NULL,
 bucket BIGINT NOT NULL,
 attempts INT NOT NULL DEFAULT 1,
 PRIMARY KEY(key_hash,bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
