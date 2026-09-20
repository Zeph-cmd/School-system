-- Term scoping for students and enrollments
-- 1) students.starting_term: the term in which a student was admitted
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS starting_term VARCHAR(20);

-- 2) enrollments.term: the term of the enrollment (class membership is per year AND term)
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS term VARCHAR(20);

-- Backfill legacy rows to 'Term 1' so filters always have a value
UPDATE students SET starting_term = 'Term 1' WHERE starting_term IS NULL;
UPDATE enrollments SET term = 'Term 1' WHERE term IS NULL;

-- Keep values constrained to the 3 school terms
ALTER TABLE students
  ADD CONSTRAINT students_starting_term_check
  CHECK (starting_term IN ('Term 1', 'Term 2', 'Term 3'));

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_term_check
  CHECK (term IN ('Term 1', 'Term 2', 'Term 3'));
