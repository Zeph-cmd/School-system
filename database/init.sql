-- ============================================
-- School Management System - Database Schema
-- Database: "Serious sch.db" (PostgreSQL)
-- ============================================

-- Roles
CREATE TABLE IF NOT EXISTS roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    CREATE TYPE user_account_status AS ENUM ('pending', 'approved', 'declined');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Users (login accounts)
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email VARCHAR(150),
    phone VARCHAR(20),
    status user_account_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User-Role junction
CREATE TABLE IF NOT EXISTS user_roles (
    user_role_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(user_id),
    role_id INT NOT NULL REFERENCES roles(role_id),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Registration requests (approval queue)
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

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INT REFERENCES users(user_id)
);

-- Students
CREATE TABLE IF NOT EXISTS students (
    student_id SERIAL PRIMARY KEY,
    admission_number VARCHAR(50) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    other_name VARCHAR(100),
    gender VARCHAR(10) NOT NULL,
    date_of_birth DATE NOT NULL,
    admission_date DATE NOT NULL DEFAULT CURRENT_DATE,
    email VARCHAR(150),
    phone VARCHAR(20),
    tuition_amount_due NUMERIC NOT NULL DEFAULT 0,
    tuition_amount_paid NUMERIC NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teachers
CREATE TABLE IF NOT EXISTS teachers (
    teacher_id SERIAL PRIMARY KEY,
    employee_number VARCHAR(50) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    other_name VARCHAR(100),
    gender VARCHAR(10),
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(150),
    hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Parents
CREATE TABLE IF NOT EXISTS parents (
    parent_id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    gender VARCHAR(10),
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(150),
    address TEXT,
    relationship VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Classes
CREATE TABLE IF NOT EXISTS classes (
    class_id SERIAL PRIMARY KEY,
    class_name VARCHAR(100) NOT NULL,
    class_code VARCHAR(20) NOT NULL UNIQUE,
    level VARCHAR(50) NOT NULL,
    capacity INT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subjects
CREATE TABLE IF NOT EXISTS subjects (
    subject_id SERIAL PRIMARY KEY,
    subject_code VARCHAR(20) NOT NULL UNIQUE,
    subject_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enrollments
CREATE TABLE IF NOT EXISTS enrollments (
    enrollment_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id),
    class_id INT NOT NULL REFERENCES classes(class_id),
    academic_year VARCHAR(20) NOT NULL,
    date_enrolled DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
    attendance_id SERIAL PRIMARY KEY,
    enrollment_id INT NOT NULL REFERENCES enrollments(enrollment_id),
    date_attended DATE NOT NULL,
    status VARCHAR(20) NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fees
CREATE TABLE IF NOT EXISTS fees (
    fee_id SERIAL PRIMARY KEY,
    enrollment_id INT NOT NULL REFERENCES enrollments(enrollment_id),
    description VARCHAR(200),
    amount_due NUMERIC NOT NULL DEFAULT 0,
    amount_paid NUMERIC DEFAULT 0,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'unpaid',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Grades
CREATE TABLE IF NOT EXISTS grades (
    grade_id SERIAL PRIMARY KEY,
    enrollment_id INT NOT NULL REFERENCES enrollments(enrollment_id),
    subject_id INT NOT NULL REFERENCES subjects(subject_id),
    term VARCHAR(20) NOT NULL,
    marks NUMERIC,
    grade_letter VARCHAR(5),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Grade change requests (teacher-submitted, admin-approved)
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

-- Results (term summaries)
CREATE TABLE IF NOT EXISTS results (
    result_id SERIAL PRIMARY KEY,
    enrollment_id INT NOT NULL REFERENCES enrollments(enrollment_id),
    term VARCHAR(20) NOT NULL,
    average_score NUMERIC,
    grade_letter VARCHAR(5),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Parent-Student link
CREATE TABLE IF NOT EXISTS parent_student (
    parent_student_id SERIAL PRIMARY KEY,
    parent_id INT NOT NULL REFERENCES parents(parent_id),
    student_id INT NOT NULL REFERENCES students(student_id),
    relationship VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teaching Assignments
CREATE TABLE IF NOT EXISTS teaching_assignments (
    assignment_id SERIAL PRIMARY KEY,
    teacher_id INT NOT NULL REFERENCES teachers(teacher_id),
    subject_id INT NOT NULL REFERENCES subjects(subject_id),
    class_id INT NOT NULL REFERENCES classes(class_id),
    academic_year VARCHAR(20) NOT NULL,
    term VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages (private/broadcast threads)
CREATE TABLE IF NOT EXISTS messages (
    message_id SERIAL PRIMARY KEY,
    sender_id INT REFERENCES users(user_id),
    recipient_id INT REFERENCES users(user_id),
    class_id INT REFERENCES classes(class_id),
    message_type VARCHAR(20) NOT NULL DEFAULT 'private',
    subject TEXT,
    body TEXT NOT NULL,
    parent_message_id INT REFERENCES messages(message_id),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Homework
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

-- Deleted homework archive (teacher recovery bin)
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

-- Admin panel IP access registry (maps each distinct admin IP to a stable number)
CREATE TABLE IF NOT EXISTS admin_ip_registry (
    admin_ip_id SERIAL PRIMARY KEY,
    ip_address VARCHAR(100) NOT NULL UNIQUE,
    access_number INT NOT NULL UNIQUE,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by_user_id INT REFERENCES users(user_id)
);

-- Audit logs
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

-- Email logs (admin outbound private emails)
CREATE TABLE IF NOT EXISTS email_logs (
    email_log_id SERIAL PRIMARY KEY,
    message_id INT REFERENCES messages(message_id),
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    message TEXT NOT NULL,
    sent_by_admin INT NOT NULL REFERENCES users(user_id),
    sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (setting_key, setting_value)
VALUES ('current_academic_year', CONCAT(EXTRACT(YEAR FROM CURRENT_DATE)::int, '/', EXTRACT(YEAR FROM CURRENT_DATE)::int + 1))
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO system_settings (setting_key, setting_value)
VALUES ('grade_edit_enabled', 'false')
ON CONFLICT (setting_key) DO NOTHING;
