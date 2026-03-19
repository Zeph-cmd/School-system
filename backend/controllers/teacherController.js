const pool = require('../config/db');

// Teacher sees: their assignments, their students, attendance, grades
// Teacher can edit: attendance, grades for their classes

function defaultAcademicYear() {
  const y = new Date().getFullYear();
  return `${y}/${y + 1}`;
}

function parseAcademicYearRange(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})\/(\d{4})$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== start + 1) return null;
  return { start, end };
}

function normalizeTerm(value) {
  const term = String(value || '').trim().toLowerCase();
  if (term === 'term 1' || term === '1' || term === 't1' || term === 'first') return 'Term 1';
  if (term === 'term 2' || term === '2' || term === 't2' || term === 'second') return 'Term 2';
  if (term === 'term 3' || term === '3' || term === 't3' || term === 'third') return 'Term 3';
  return null;
}

async function getCurrentAcademicYearSetting() {
  await ensureSystemSettingsTable();
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value)
     VALUES ('current_academic_year', $1)
     ON CONFLICT (setting_key) DO NOTHING`,
    [defaultAcademicYear()]
  );
  const result = await pool.query(
    `SELECT setting_value
     FROM system_settings
     WHERE setting_key = 'current_academic_year'
     LIMIT 1`
  );
  const year = String(result.rows[0]?.setting_value || '').trim();
  return parseAcademicYearRange(year) ? year : defaultAcademicYear();
}

async function ensureSystemSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_by INT REFERENCES users(user_id)
    )
  `);
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value)
     VALUES ('grade_edit_enabled', 'false')
     ON CONFLICT (setting_key) DO NOTHING`
  );
}

async function ensureMessagesTable() {
  await pool.query(`
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
    )
  `);
}

async function ensureDeletedHomeworkTable() {
  await pool.query(`
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
    )
  `);
}

async function getAllowedParentUsers(userId) {
  const result = await pool.query(
    `WITH teacher_classes AS (
       SELECT DISTINCT ta.class_id
       FROM teaching_assignments ta
       JOIN teachers t ON ta.teacher_id = t.teacher_id
       JOIN users u ON (
         (u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email))
         OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username)
         OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username)
         OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username)
       )
       WHERE u.user_id = $1
     )
     SELECT
       pu.user_id,
       pu.username,
       pu.email,
       pu.phone,
       p.first_name || ' ' || p.last_name AS parent_name,
       STRING_AGG(DISTINCT (s.first_name || ' ' || s.last_name || ' (' || c.class_name || ')'), ', ') AS children
     FROM teacher_classes tc
     JOIN enrollments e ON e.class_id = tc.class_id AND e.status = 'active'
     JOIN classes c ON c.class_id = e.class_id
     JOIN students s ON s.student_id = e.student_id
     JOIN parent_student ps ON ps.student_id = s.student_id
     JOIN parents p ON p.parent_id = ps.parent_id
     JOIN users pu ON LOWER(COALESCE(pu.email, '')) = LOWER(COALESCE(p.email, ''))
     JOIN user_roles pur ON pur.user_id = pu.user_id
     JOIN roles pr ON pr.role_id = pur.role_id
     WHERE pr.role_name = 'parent'
     GROUP BY pu.user_id, pu.username, pu.email, pu.phone, p.first_name, p.last_name
     ORDER BY parent_name, pu.username`,
    [userId]
  );
  return result.rows;
}

async function isGradeEditEnabled() {
  await ensureSystemSettingsTable();
  const result = await pool.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'grade_edit_enabled' LIMIT 1`
  );
  const raw = String(result.rows[0]?.setting_value || 'false').toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

async function getGradeEditStatus(req, res) {
  try {
    const enabled = await isGradeEditEnabled();
    res.json({ grade_edit_enabled: enabled });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch grade edit status' });
  }
}

// GET /api/teacher/profile - get teacher profile linked to user
async function getProfile(req, res) {
  try {
    // Find teacher by matching email or by a link (we'll match by email for now)
    const result = await pool.query(
      `SELECT t.* FROM teachers t
       JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
       WHERE u.user_id = $1`,
      [req.user.user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher profile not found. Make sure teacher email matches user email.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

// GET /api/teacher/assignments - classes and subjects assigned to this teacher
async function getMyAssignments(req, res) {
  try {
    const requestedYear = String(req.query.academic_year || '').trim();
    const academicYear = parseAcademicYearRange(requestedYear)
      ? requestedYear
      : await getCurrentAcademicYearSetting();
    const result = await pool.query(`
      SELECT ta.*, s.subject_name, s.subject_code, c.class_name, c.class_code, c.level
      FROM teaching_assignments ta
      JOIN subjects s ON ta.subject_id = s.subject_id
      JOIN classes c ON ta.class_id = c.class_id
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE u.user_id = $1 AND ta.academic_year = $2
      ORDER BY ta.academic_year DESC, c.class_name
    `, [req.user.user_id, academicYear]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
}

// GET /api/teacher/students?class_id=X - students in a class teacher is assigned to
async function getMyStudents(req, res) {
  try {
    const { class_id } = req.query;
    const requestedYear = String(req.query.academic_year || '').trim();
    const academicYear = parseAcademicYearRange(requestedYear)
      ? requestedYear
      : await getCurrentAcademicYearSetting();
    if (!class_id) {
      return res.status(400).json({ error: 'class_id query parameter required' });
    }

    // Verify teacher is assigned to this class
    const check = await pool.query(`
      SELECT 1 FROM teaching_assignments ta
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE u.user_id = $1 AND ta.class_id = $2 AND ta.academic_year = $3
    `, [req.user.user_id, class_id, academicYear]);

    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    const result = await pool.query(`
      SELECT s.*, e.enrollment_id, e.academic_year, e.status AS enrollment_status,
        (
          SELECT STRING_AGG(
            DISTINCT (
              p.first_name || ' ' || p.last_name ||
              ' | ' || COALESCE(p.phone, 'No phone') ||
              ' | ' || COALESCE(p.email, 'No email')
            ),
            '; '
          )
          FROM parent_student ps
          JOIN parents p ON p.parent_id = ps.parent_id
          WHERE ps.student_id = s.student_id
        ) AS parent_contacts
      FROM students s
      JOIN enrollments e ON s.student_id = e.student_id
      WHERE e.class_id = $1 AND e.status = 'active' AND e.academic_year = $2
      ORDER BY s.last_name, s.first_name
    `, [class_id, academicYear]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
}

// GET /api/teacher/attendance?class_id=X&date=YYYY-MM-DD
async function getAttendance(req, res) {
  try {
    const { class_id, date } = req.query;
    if (!class_id) {
      return res.status(400).json({ error: 'class_id required' });
    }

    // Verify teacher is assigned to this class
    const check = await pool.query(`
      SELECT 1 FROM teaching_assignments ta
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE u.user_id = $1 AND ta.class_id = $2
    `, [req.user.user_id, class_id]);
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    let query = `
      SELECT a.*, s.first_name || ' ' || s.last_name AS student_name
      FROM attendance a
      JOIN enrollments e ON a.enrollment_id = e.enrollment_id
      JOIN students s ON e.student_id = s.student_id
      WHERE e.class_id = $1
    `;
    const params = [class_id];

    if (date) {
      query += ' AND a.date_attended = $2';
      params.push(date);
    }
    query += ' ORDER BY a.date_attended DESC, s.last_name';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
}

// POST /api/teacher/attendance - mark attendance
async function markAttendance(req, res) {
  try {
    const { enrollment_id, date_attended, status, remarks } = req.body;
    if (!enrollment_id || !date_attended || !status) {
      return res.status(400).json({ error: 'enrollment_id, date_attended, and status are required' });
    }

    // Verify teacher is assigned to the class this enrollment belongs to
    const ownerCheck = await pool.query(`
      SELECT 1 FROM enrollments e
      JOIN teaching_assignments ta ON e.class_id = ta.class_id
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE e.enrollment_id = $1 AND u.user_id = $2
    `, [enrollment_id, req.user.user_id]);
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to this student\'s class' });
    }

    // Check if attendance already exists for this enrollment and date
    const existing = await pool.query(
      'SELECT attendance_id FROM attendance WHERE enrollment_id = $1 AND date_attended = $2',
      [enrollment_id, date_attended]
    );

    let result;
    if (existing.rows.length > 0) {
      // Update existing
      result = await pool.query(
        'UPDATE attendance SET status = $1, remarks = $2 WHERE enrollment_id = $3 AND date_attended = $4 RETURNING *',
        [status, remarks || null, enrollment_id, date_attended]
      );
      await req.audit('UPDATE', 'attendance', result.rows[0].attendance_id, null, result.rows[0]);
    } else {
      // Insert new
      result = await pool.query(
        'INSERT INTO attendance (enrollment_id, date_attended, status, remarks) VALUES ($1,$2,$3,$4) RETURNING *',
        [enrollment_id, date_attended, status, remarks || null]
      );
      await req.audit('CREATE', 'attendance', result.rows[0].attendance_id, null, result.rows[0]);
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
}

// GET /api/teacher/grades?class_id=X&subject_id=Y
async function getGrades(req, res) {
  try {
    const { class_id, subject_id } = req.query;
    const requestedYear = String(req.query.academic_year || '').trim();
    const academicYear = parseAcademicYearRange(requestedYear)
      ? requestedYear
      : await getCurrentAcademicYearSetting();
    if (!class_id) {
      return res.status(400).json({ error: 'class_id required' });
    }

    // Verify teacher is assigned to this class
    const check = await pool.query(`
      SELECT 1 FROM teaching_assignments ta
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE u.user_id = $1 AND ta.class_id = $2 AND ta.academic_year = $3
    `, [req.user.user_id, class_id, academicYear]);
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    let query = `
      SELECT g.*, s.first_name || ' ' || s.last_name AS student_name, sub.subject_name
      FROM grades g
      JOIN enrollments e ON g.enrollment_id = e.enrollment_id
      JOIN students s ON e.student_id = s.student_id
      JOIN subjects sub ON g.subject_id = sub.subject_id
      WHERE e.class_id = $1 AND e.academic_year = $2
    `;
    const params = [class_id, academicYear];

    if (subject_id) {
      query += ' AND g.subject_id = $3';
      params.push(subject_id);
    }
    query += ' ORDER BY s.last_name, sub.subject_name';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch grades' });
  }
}

// POST /api/teacher/grades - enter/update a grade
async function enterGrade(req, res) {
  try {
    const gradeEditEnabled = await isGradeEditEnabled();
    if (!gradeEditEnabled) {
      return res.status(403).json({
        error: 'Grade entry is currently locked by admin. You can view grades but cannot edit now.'
      });
    }

    const { enrollment_id, subject_id, term, marks, grade_letter, remarks } = req.body;
    const normalizedTerm = normalizeTerm(term);
    if (!enrollment_id || !subject_id || !normalizedTerm) {
      return res.status(400).json({ error: 'enrollment_id, subject_id, and term are required' });
    }

    // Verify teacher is assigned to the class this enrollment belongs to
    const ownerCheck = await pool.query(`
      SELECT 1 FROM enrollments e
      JOIN teaching_assignments ta ON e.class_id = ta.class_id
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE e.enrollment_id = $1 AND u.user_id = $2
    `, [enrollment_id, req.user.user_id]);
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to this student\'s class' });
    }

    // Queue grade change for admin approval. Parent views only reflect approved values in grades.
    await pool.query(`
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
      )
    `);

    const pendingReq = await pool.query(
      `SELECT request_id
       FROM grade_change_requests
       WHERE enrollment_id = $1 AND subject_id = $2 AND term = $3 AND status = 'pending'
       LIMIT 1`,
      [enrollment_id, subject_id, normalizedTerm]
    );

    let result;
    if (pendingReq.rows.length > 0) {
      result = await pool.query(
        `UPDATE grade_change_requests
         SET proposed_marks = $1,
             proposed_grade_letter = $2,
             proposed_remarks = $3,
             requested_by = $4,
             created_at = NOW(),
             rejection_reason = NULL
         WHERE request_id = $5
         RETURNING *`,
        [marks || null, grade_letter || null, remarks || null, req.user.user_id, pendingReq.rows[0].request_id]
      );
      await req.audit('UPDATE', 'grade_change_requests', result.rows[0].request_id, null, result.rows[0]);
    } else {
      result = await pool.query(
        `INSERT INTO grade_change_requests
         (enrollment_id, subject_id, term, proposed_marks, proposed_grade_letter, proposed_remarks, requested_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
         RETURNING *`,
        [enrollment_id, subject_id, normalizedTerm, marks || null, grade_letter || null, remarks || null, req.user.user_id]
      );
      await req.audit('CREATE', 'grade_change_requests', result.rows[0].request_id, null, result.rows[0]);
    }

    res.status(201).json({
      message: 'Grade change submitted for admin approval. It will appear on parent panel only after approval.',
      request_id: result.rows[0].request_id,
      status: result.rows[0].status,
    });
  } catch (err) {
    console.error('enterGrade error:', err);
    res.status(500).json({ error: 'Failed to enter grade' });
  }
}

// ── HOMEWORK ────────────────────────────────────────────

// GET /api/teacher/homework - get homework assigned by this teacher
async function getHomework(req, res) {
  try {
    const requestedYear = String(req.query.academic_year || '').trim();
    const academicYear = parseAcademicYearRange(requestedYear)
      ? requestedYear
      : await getCurrentAcademicYearSetting();
    const result = await pool.query(`
      SELECT h.*, s.subject_name, c.class_name
      FROM homework h
      JOIN subjects s ON h.subject_id = s.subject_id
      JOIN classes c ON h.class_id = c.class_id
      JOIN teachers t ON h.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE u.user_id = $1
        AND EXISTS (
          SELECT 1 FROM teaching_assignments ta
          WHERE ta.teacher_id = h.teacher_id
            AND ta.class_id = h.class_id
            AND ta.subject_id = h.subject_id
            AND ta.academic_year = $2
        )
      ORDER BY h.created_at DESC
    `, [req.user.user_id, academicYear]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch homework' });
  }
}

// POST /api/teacher/homework - create homework
async function createHomework(req, res) {
  try {
    const { class_id, subject_id, title, description, due_date } = req.body;
    if (!class_id || !subject_id || !title) {
      return res.status(400).json({ error: 'class_id, subject_id, and title are required' });
    }

    // Get teacher_id from user
    const teacherRes = await pool.query(`
      SELECT t.teacher_id FROM teachers t
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE u.user_id = $1
    `, [req.user.user_id]);

    if (teacherRes.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher profile not found' });
    }
    const teacher_id = teacherRes.rows[0].teacher_id;

    // Verify teacher is assigned to this class and subject
    const check = await pool.query(`
      SELECT 1 FROM teaching_assignments
      WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3
    `, [teacher_id, class_id, subject_id]);

    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'You are not assigned to this class/subject combination' });
    }

    const result = await pool.query(
      `INSERT INTO homework (teacher_id, class_id, subject_id, title, description, due_date)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [teacher_id, class_id, subject_id, title, description || null, due_date || null]
    );
    await req.audit('CREATE', 'homework', result.rows[0].homework_id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create homework' });
  }
}

// PUT /api/teacher/homework/:id - update homework (only own)
async function updateHomework(req, res) {
  try {
    const { id } = req.params;
    const { title, description, due_date } = req.body;

    const existing = await pool.query(`
      SELECT h.* FROM homework h
      JOIN teachers t ON h.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE h.homework_id = $1 AND u.user_id = $2
    `, [id, req.user.user_id]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Homework not found or not yours' });
    }

    const old = existing.rows[0];
    const result = await pool.query(
      `UPDATE homework
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           due_date = COALESCE($3::date, due_date)
       WHERE homework_id = $4
       RETURNING *`,
      [title || null, description || null, due_date || null, id]
    );
    await req.audit('UPDATE', 'homework', parseInt(id, 10), old, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update homework' });
  }
}

// DELETE /api/teacher/homework/:id - delete homework (only own)
async function deleteHomework(req, res) {
  try {
    await ensureDeletedHomeworkTable();
    const { id } = req.params;

    // Verify ownership
    const existing = await pool.query(`
      SELECT h.* FROM homework h
      JOIN teachers t ON h.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE h.homework_id = $1 AND u.user_id = $2
    `, [id, req.user.user_id]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Homework not found or not yours' });
    }

    await pool.query(
      `INSERT INTO deleted_homework
       (original_homework_id, teacher_id, class_id, subject_id, title, description, due_date, original_created_at, deleted_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        existing.rows[0].homework_id,
        existing.rows[0].teacher_id,
        existing.rows[0].class_id,
        existing.rows[0].subject_id,
        existing.rows[0].title,
        existing.rows[0].description,
        existing.rows[0].due_date,
        existing.rows[0].created_at,
        req.user.user_id,
      ]
    );

    await pool.query('DELETE FROM homework WHERE homework_id = $1', [id]);
    await req.audit('DELETE', 'homework', parseInt(id), existing.rows[0], null);
    res.json({ message: 'Homework deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete homework' });
  }
}

async function getDeletedHomework(req, res) {
  try {
    await ensureDeletedHomeworkTable();
    const requestedYear = String(req.query.academic_year || '').trim();
    const academicYear = parseAcademicYearRange(requestedYear)
      ? requestedYear
      : await getCurrentAcademicYearSetting();

    const result = await pool.query(`
      SELECT dh.*, s.subject_name, c.class_name
      FROM deleted_homework dh
      JOIN subjects s ON dh.subject_id = s.subject_id
      JOIN classes c ON dh.class_id = c.class_id
      JOIN teachers t ON dh.teacher_id = t.teacher_id
      JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
      WHERE u.user_id = $1
        AND EXISTS (
          SELECT 1 FROM teaching_assignments ta
          WHERE ta.teacher_id = dh.teacher_id
            AND ta.class_id = dh.class_id
            AND ta.subject_id = dh.subject_id
            AND ta.academic_year = $2
        )
      ORDER BY dh.deleted_at DESC
    `, [req.user.user_id, academicYear]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deleted homework' });
  }
}

async function restoreDeletedHomework(req, res) {
  try {
    await ensureDeletedHomeworkTable();
    const { id } = req.params;

    const deletedRes = await pool.query(
      `SELECT dh.*
       FROM deleted_homework dh
       JOIN teachers t ON dh.teacher_id = t.teacher_id
       JOIN users u ON ((u.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(u.username) OR LOWER(COALESCE(t.employee_number, '')) = LOWER(u.username) OR LOWER(COALESCE(t.first_name, '')) = LOWER(u.username))
       WHERE dh.deleted_homework_id = $1 AND u.user_id = $2
       LIMIT 1`,
      [id, req.user.user_id]
    );
    if (deletedRes.rows.length === 0) {
      return res.status(404).json({ error: 'Deleted homework not found or not yours' });
    }

    const row = deletedRes.rows[0];
    const restored = await pool.query(
      `INSERT INTO homework (teacher_id, class_id, subject_id, title, description, due_date)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [row.teacher_id, row.class_id, row.subject_id, row.title, row.description, row.due_date]
    );

    await pool.query('DELETE FROM deleted_homework WHERE deleted_homework_id = $1', [id]);
    await req.audit('CREATE', 'homework', restored.rows[0].homework_id, null, {
      restored_from_deleted_homework_id: Number(id),
      title: row.title,
    });

    res.status(201).json({ message: 'Homework restored', homework: restored.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore deleted homework' });
  }
}

// ── MESSAGES ────────────────────────────────────────────

async function getMessageParents(req, res) {
  try {
    const parents = await getAllowedParentUsers(req.user.user_id);
    res.json(parents);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load parent contacts' });
  }
}

async function getMyMessages(req, res) {
  try {
    await ensureMessagesTable();
    const allowedParents = await getAllowedParentUsers(req.user.user_id);
    const allowedIds = allowedParents.map((p) => p.user_id);
    if (allowedIds.length === 0) return res.json([]);

    const result = await pool.query(
      `SELECT m.*, su.username AS sender_name, ru.username AS recipient_name
       FROM messages m
       LEFT JOIN users su ON su.user_id = m.sender_id
       LEFT JOIN users ru ON ru.user_id = m.recipient_id
       WHERE m.message_type = 'private'
         AND m.parent_message_id IS NULL
         AND (
           (m.sender_id = $1 AND m.recipient_id = ANY($2))
           OR (m.recipient_id = $1 AND m.sender_id = ANY($2))
         )
       ORDER BY m.created_at DESC`,
      [req.user.user_id, allowedIds]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
}

async function sendParentMessage(req, res) {
  try {
    await ensureMessagesTable();
    const recipientId = parseInt(req.body.recipient_id, 10);
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || req.body.message || '').trim();
    if (!recipientId || !body) {
      return res.status(400).json({ error: 'recipient_id and body are required' });
    }

    const allowedParents = await getAllowedParentUsers(req.user.user_id);
    const allowedSet = new Set(allowedParents.map((p) => p.user_id));
    if (!allowedSet.has(recipientId)) {
      return res.status(403).json({ error: 'You can only message parents of students in your assigned class(es).' });
    }

    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, message_type, subject, body)
       VALUES ($1,$2,'private',$3,$4)
       RETURNING *`,
      [req.user.user_id, recipientId, subject || null, body]
    );
    await req.audit('CREATE', 'messages', result.rows[0].message_id, null, {
      type: 'private',
      recipient_id: recipientId,
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' });
  }
}

async function getMessageConversation(req, res) {
  try {
    await ensureMessagesTable();
    const messageId = parseInt(req.params.id, 10);
    if (!messageId) return res.status(400).json({ error: 'Invalid message id' });

    const rootRes = await pool.query('SELECT * FROM messages WHERE message_id = $1 LIMIT 1', [messageId]);
    if (rootRes.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    const root = rootRes.rows[0];

    const otherParty = root.sender_id === req.user.user_id ? root.recipient_id : root.sender_id;
    const allowedParents = await getAllowedParentUsers(req.user.user_id);
    const allowedSet = new Set(allowedParents.map((p) => p.user_id));
    if (!allowedSet.has(otherParty)) {
      return res.status(403).json({ error: 'Not allowed to access this conversation' });
    }

    const result = await pool.query(
      `SELECT m.*, u.username AS sender_name
       FROM messages m
       LEFT JOIN users u ON u.user_id = m.sender_id
       WHERE m.message_id = $1 OR m.parent_message_id = $1
       ORDER BY m.created_at ASC`,
      [messageId]
    );

    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE (message_id = $1 OR parent_message_id = $1) AND recipient_id = $2',
      [messageId, req.user.user_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
}

async function replyMessage(req, res) {
  try {
    await ensureMessagesTable();
    const messageId = parseInt(req.params.id, 10);
    const body = String(req.body.body || '').trim();
    if (!messageId || !body) {
      return res.status(400).json({ error: 'Message id and body are required' });
    }

    const orig = await pool.query('SELECT * FROM messages WHERE message_id = $1 LIMIT 1', [messageId]);
    if (orig.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    const origMsg = orig.rows[0];
    if (origMsg.message_type !== 'private') {
      return res.status(403).json({ error: 'Can only reply to private messages' });
    }

    const recipientId = origMsg.sender_id === req.user.user_id ? origMsg.recipient_id : origMsg.sender_id;
    const allowedParents = await getAllowedParentUsers(req.user.user_id);
    const allowedSet = new Set(allowedParents.map((p) => p.user_id));
    if (!allowedSet.has(recipientId)) {
      return res.status(403).json({ error: 'Not allowed to reply to this recipient' });
    }

    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, message_type, subject, body, parent_message_id)
       VALUES ($1,$2,'private',$3,$4,$5)
       RETURNING *`,
      [req.user.user_id, recipientId, origMsg.subject ? `Re: ${origMsg.subject}` : null, body, origMsg.parent_message_id || origMsg.message_id]
    );

    await req.audit('CREATE', 'messages', result.rows[0].message_id, null, {
      type: 'private-reply',
      parent_message_id: origMsg.parent_message_id || origMsg.message_id,
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reply to message' });
  }
}

module.exports = {
  getProfile, getMyAssignments, getMyStudents,
  getAttendance, markAttendance,
  getGrades, getGradeEditStatus, enterGrade,
  getHomework, createHomework, updateHomework, deleteHomework,
  getDeletedHomework, restoreDeletedHomework,
  getMessageParents, getMyMessages, sendParentMessage, getMessageConversation, replyMessage,
};



