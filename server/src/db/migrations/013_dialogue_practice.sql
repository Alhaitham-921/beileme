CREATE TABLE dialogue_sessions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 scene VARCHAR(32) NOT NULL,
 status ENUM('active','analyzing','finished','report_failed') NOT NULL DEFAULT 'active',
 state JSON NOT NULL,
 operation_token CHAR(36) NULL,
 lease_until DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX ix_dialogue_user (user_id, id),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Keep scenario words reviewable even when an advanced user's chosen book omits them.
INSERT INTO wordbooks (code,name,scope,is_builtin,word_count,description)
 VALUES ('dialogue-core','情境表达基础词','自定义',0,10,'情境练习回流使用，不改变正在学习的词书');
INSERT INTO words (wordbook_id,spelling,spelling_norm,definitions,examples)
 SELECT b.id,v.spelling,v.spelling,v.definitions,v.examples FROM wordbooks b JOIN (
 SELECT 'menu' spelling, JSON_ARRAY('菜单') definitions, JSON_ARRAY('Could I see the menu, please?') examples
 UNION ALL SELECT 'recommend',JSON_ARRAY('推荐；建议'),JSON_ARRAY('What would you recommend?')
 UNION ALL SELECT 'order',JSON_ARRAY('点餐；订购','顺序；命令'),JSON_ARRAY('I would like to order the chicken.')
 UNION ALL SELECT 'nearby',JSON_ARRAY('在附近；附近的'),JSON_ARRAY('Is there a museum nearby?')
 UNION ALL SELECT 'turn',JSON_ARRAY('转弯；转动'),JSON_ARRAY('Where should I turn left?')
 UNION ALL SELECT 'across',JSON_ARRAY('穿过；到另一边'),JSON_ARRAY('Should I go across the street?')
 UNION ALL SELECT 'bank',JSON_ARRAY('河岸','银行'),JSON_ARRAY('There is a path along the river bank.','I would like to open a bank account.')
 UNION ALL SELECT 'sit',JSON_ARRAY('坐'),JSON_ARRAY('May I sit here?')
 UNION ALL SELECT 'account',JSON_ARRAY('账户；说明'),JSON_ARRAY('I would like to open a bank account.')
 UNION ALL SELECT 'open',JSON_ARRAY('开设；打开','开放的'),JSON_ARRAY('What do I need to open an account?')
) v WHERE b.code='dialogue-core';

CREATE TABLE dialogue_daily_usage (
 user_id BIGINT UNSIGNED NOT NULL,
 usage_date DATE NOT NULL,
 calls INT UNSIGNED NOT NULL DEFAULT 0,
 prompt_tokens INT UNSIGNED NOT NULL DEFAULT 0,
 completion_tokens INT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY (user_id, usage_date),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE dialogue_word_evidence (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 session_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 word_id BIGINT UNSIGNED NULL,
 spelling VARCHAR(64) NOT NULL,
 sense VARCHAR(190) NOT NULL DEFAULT '',
 result ENUM('independent','assisted','weak') NOT NULL,
 help_level TINYINT UNSIGNED NOT NULL DEFAULT 0,
 weight DECIMAL(5,2) UNSIGNED NOT NULL DEFAULT 1,
 tags JSON NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uk_dialogue_word (session_id, spelling, sense),
 INDEX ix_dialogue_evidence_user (user_id, created_at),
 FOREIGN KEY (session_id) REFERENCES dialogue_sessions(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
