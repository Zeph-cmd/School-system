-- Add system-wide academic year setting and deleted homework archive table

CREATE TABLE IF NOT EXISTS deleted_homework (
  deleted_homework_id SERIAL PRIMARY KEY,
  original_homework_id INT,
  teacher_id INT NOT NULL REFERENCES teachers(teacher_id),
  class_id INT NOT NULL REFERENCES classes(class_id),
  subject_id INT NOT NULL REFERENCES subjects(subject_id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  due_date DATE,
  original_created_at TIMESTAMP,
  deleted_by_user_id INT REFERENCES users(user_id),
  deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (setting_key, setting_value)
VALUES ('current_academic_year', CONCAT(EXTRACT(YEAR FROM CURRENT_DATE)::int, '/', EXTRACT(YEAR FROM CURRENT_DATE)::int + 1))
ON CONFLICT (setting_key) DO NOTHING;
