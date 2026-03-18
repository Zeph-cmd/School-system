-- Queue teacher grade edits for admin approval before applying to grades table.

CREATE TABLE IF NOT EXISTS grade_change_requests (
  request_id SERIAL PRIMARY KEY,
  enrollment_id INT NOT NULL REFERENCES enrollments(enrollment_id),
  subject_id INT NOT NULL REFERENCES subjects(subject_id),
  term VARCHAR(20) NOT NULL,
  proposed_marks NUMERIC,
  proposed_grade_letter VARCHAR(5),
  proposed_remarks TEXT,
  requested_by INT REFERENCES users(user_id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  reviewed_by INT REFERENCES users(user_id),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gcr_status_created
  ON grade_change_requests (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gcr_single_pending
  ON grade_change_requests (enrollment_id, subject_id, term)
  WHERE status = 'pending';
