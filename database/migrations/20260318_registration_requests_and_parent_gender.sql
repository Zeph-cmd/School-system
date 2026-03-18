BEGIN;

CREATE TABLE IF NOT EXISTS registration_requests (
  request_id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  password_hash TEXT NOT NULL,
  email VARCHAR(150),
  phone VARCHAR(20),
  role VARCHAR(50) NOT NULL,
  student_first_name VARCHAR(100),
  student_last_name VARCHAR(100),
  student_admission_number VARCHAR(50),
  parent_relationship VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  reviewed_by INT REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_registration_requests_status_created
  ON registration_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registration_requests_username
  ON registration_requests (username);

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10);

COMMIT;
