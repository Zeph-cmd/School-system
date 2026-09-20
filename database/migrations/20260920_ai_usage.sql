-- AI assistant per-user usage tracking (daily limit of 20 messages per user)
CREATE TABLE IF NOT EXISTS ai_usage (
  ai_usage_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id),
  role VARCHAR(20) NOT NULL,
  tokens INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_day ON ai_usage (user_id, created_at);
