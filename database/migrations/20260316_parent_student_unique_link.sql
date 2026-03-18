BEGIN;

DELETE FROM parent_student a
USING parent_student b
WHERE a.parent_student_id > b.parent_student_id
	AND a.parent_id = b.parent_id
	AND a.student_id = b.student_id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_parent_student_parent_child
ON parent_student(parent_id, student_id);

COMMIT;
