-- Additive only: existing accounts, verification status and learning records are untouched.
CREATE TABLE registration_email_codes (
 email VARCHAR(190) NOT NULL PRIMARY KEY,
 challenge_id CHAR(32) NOT NULL,
 code_hash CHAR(64) NOT NULL,
 expires_at DATETIME NOT NULL,
 delivered_at DATETIME NULL,
 used_at DATETIME NULL,
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 KEY idx_registration_code_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
