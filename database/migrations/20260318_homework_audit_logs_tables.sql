BEGIN;

CREATE TABLE IF NOT EXISTS homework (
  homework_id SERIAL PRIMARY KEY,
  teacher_id INT NOT NULL REFERENCES teachers(teacher_id),
  class_id INT NOT NULL REFERENCES classes(class_id),
  subject_id INT NOT NULL REFERENCES subjects(subject_id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  due_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(user_id),
  username VARCHAR(100),
  action VARCHAR(50) NOT NULL,
  table_name VARCHAR(100),
  record_id INT,
  old_data JSONB,
  new_data JSONB,
  ip_address VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON audit_logs(table_name);

COMMIT;
