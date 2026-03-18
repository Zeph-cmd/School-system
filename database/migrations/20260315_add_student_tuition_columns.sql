-- Add student tuition tracking columns

BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS tuition_amount_due NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS tuition_amount_paid NUMERIC NOT NULL DEFAULT 0;

COMMIT;
