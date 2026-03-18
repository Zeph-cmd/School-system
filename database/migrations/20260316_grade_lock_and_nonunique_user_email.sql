BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
DROP INDEX IF EXISTS users_email_key;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by INT REFERENCES users(user_id)
);

INSERT INTO system_settings (setting_key, setting_value)
VALUES ('grade_edit_enabled', 'false')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
