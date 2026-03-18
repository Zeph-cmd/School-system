-- Create email_logs table for admin private outbound emails

BEGIN;

CREATE TABLE IF NOT EXISTS email_logs (
  email_log_id SERIAL PRIMARY KEY,
  message_id INT REFERENCES messages(message_id),
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255),
  message TEXT NOT NULL,
  sent_by_admin INT NOT NULL REFERENCES users(user_id),
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_logs_sent_by_admin ON email_logs(sent_by_admin);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient_email ON email_logs(recipient_email);

COMMIT;
