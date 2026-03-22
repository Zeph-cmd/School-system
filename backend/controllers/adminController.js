const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

function defaultAcademicYear() {
  const y = new Date().getFullYear();
  return `${y}/${y + 1}`;
}

const ALLOWED_TERMS = ['Term 1', 'Term 2', 'Term 3'];

function parseAcademicYearRange(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})\/(\d{4})$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== start + 1) return null;
  return { start, end };
}

function nextAcademicYear(value) {
  const parsed = parseAcademicYearRange(value);
  if (!parsed) return defaultAcademicYear();
  return `${parsed.start + 1}/${parsed.end + 1}`;
}

function normalizeTerm(value) {
  const term = String(value || '').trim().toLowerCase();
  if (term === 'term 1' || term === '1' || term === 't1' || term === 'first') return 'Term 1';
  if (term === 'term 2' || term === '2' || term === 't2' || term === 'second') return 'Term 2';
  if (term === 'term 3' || term === '3' || term === 't3' || term === 'third') return 'Term 3';
  return null;
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
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value)
     VALUES (
       'admin_recovery_email',
       COALESCE((SELECT email FROM users WHERE LOWER(username) = 'admin' LIMIT 1), 'admin@school.com')
     )
     ON CONFLICT (setting_key) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value)
     VALUES ('current_academic_year', $1)
     ON CONFLICT (setting_key) DO NOTHING`,
    [defaultAcademicYear()]
  );
}

async function getCurrentAcademicYearSetting() {
  await ensureSystemSettingsTable();
  const result = await pool.query(
    `SELECT setting_value
     FROM system_settings
     WHERE setting_key = 'current_academic_year'
     LIMIT 1`
  );
  const stored = String(result.rows[0]?.setting_value || '').trim();
  return parseAcademicYearRange(stored) ? stored : defaultAcademicYear();
}

async function getAcademicYearSettings(req, res) {
  try {
    const currentAcademicYear = await getCurrentAcademicYearSetting();
    res.json({
      current_academic_year: currentAcademicYear,
      next_academic_year: nextAcademicYear(currentAcademicYear),
      terms: ALLOWED_TERMS,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch academic year settings' });
  }
}

async function setAcademicYearSettings(req, res) {
  try {
    const currentAcademicYear = String(req.body.current_academic_year || '').trim();
    if (!parseAcademicYearRange(currentAcademicYear)) {
      return res.status(400).json({ error: 'current_academic_year must be in format YYYY/YYYY (for example 2026/2027)' });
    }

    await ensureSystemSettingsTable();
    await pool.query(
      `UPDATE system_settings
       SET setting_value = $1, updated_at = NOW(), updated_by = $2
       WHERE setting_key = 'current_academic_year'`,
      [currentAcademicYear, req.user.user_id]
    );

    await req.audit('UPDATE', 'system_settings', null, null, {
      setting_key: 'current_academic_year',
      setting_value: currentAcademicYear,
    });

    res.json({
      message: 'Academic year updated successfully.',
      current_academic_year: currentAcademicYear,
      next_academic_year: nextAcademicYear(currentAcademicYear),
      terms: ALLOWED_TERMS,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update academic year settings' });
  }
}

async function ensureGradeChangeRequestsTable() {
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
}

async function ensureEmailLogsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_logs (
      email_log_id SERIAL PRIMARY KEY,
      message_id INT REFERENCES messages(message_id),
      recipient_email VARCHAR(255) NOT NULL,
      subject TEXT,
      message TEXT,
      sent_by_admin INT REFERENCES users(user_id),
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureRegistrationRequestsTable() {
  await pool.query(`
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
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_registration_requests_status_created ON registration_requests (status, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_registration_requests_username ON registration_requests (username)');
}

async function ensureParentsGenderColumn() {
  await pool.query('ALTER TABLE parents ADD COLUMN IF NOT EXISTS gender VARCHAR(10)');
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

async function generateUniqueCode({ prefix, table, column, suffixPrefix = '', digits = 6, maxAttempts = 30 }) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const randomPart = String(crypto.randomInt(10 ** (digits - 1), 10 ** digits));
    const code = suffixPrefix ? `${prefix}-${suffixPrefix}-${randomPart}` : `${prefix}-${randomPart}`;
    const exists = await pool.query(
      `SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`,
      [code]
    );
    if (exists.rows.length === 0) return code;
  }
  throw new Error(`Failed to generate unique ${column}`);
}

// ─── Dashboard Stats ────────────────────────────────────────────
async function getDashboard(req, res) {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM students) AS total_students,
        (SELECT COUNT(*) FROM teachers) AS total_teachers,
        (SELECT COUNT(*) FROM parents) AS total_parents,
        (SELECT COUNT(*) FROM classes) AS total_classes,
        (SELECT COUNT(*) FROM subjects) AS total_subjects,
        (SELECT COUNT(*) FROM enrollments WHERE status = 'active') AS active_enrollments,
        (SELECT COALESCE(SUM(amount_due), 0) FROM fees) AS total_fees_due,
        (SELECT COALESCE(SUM(amount_paid), 0) FROM fees) AS total_fees_paid,
        (SELECT COALESCE(SUM(tuition_amount_due), 0) FROM students) AS total_tuition_due,
        (SELECT COALESCE(SUM(tuition_amount_paid), 0) FROM students) AS total_tuition_paid
    `);
    res.json(stats.rows[0]);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
}

async function getGradeEditStatus(req, res) {
  try {
    await ensureSystemSettingsTable();
    const result = await pool.query(
      `SELECT setting_value, updated_at FROM system_settings
       WHERE setting_key = 'grade_edit_enabled' LIMIT 1`
    );
    const enabled = parseBoolean(result.rows[0]?.setting_value || 'false');
    res.json({ grade_edit_enabled: enabled, updated_at: result.rows[0]?.updated_at || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch grade edit status' });
  }
}

async function setGradeEditStatus(req, res) {
  try {
    await ensureSystemSettingsTable();
    const enabled = parseBoolean(req.body.enabled);
    await pool.query(
      `UPDATE system_settings
       SET setting_value = $1, updated_at = NOW(), updated_by = $2
       WHERE setting_key = 'grade_edit_enabled'`,
      [enabled ? 'true' : 'false', req.user.user_id]
    );
    await req.audit('UPDATE', 'system_settings', null, null, {
      setting_key: 'grade_edit_enabled',
      setting_value: enabled ? 'true' : 'false',
    });
    res.json({ message: `Grade editing ${enabled ? 'enabled' : 'locked'} successfully.`, grade_edit_enabled: enabled });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update grade edit status' });
  }
}

function maskEmail(email) {
  const clean = String(email || '').trim();
  const [local, domain] = clean.split('@');
  if (!local || !domain) return '';
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

async function getAdminRecoveryEmail(req, res) {
  try {
    await ensureSystemSettingsTable();
    const result = await pool.query(
      `SELECT setting_value, updated_at FROM system_settings
       WHERE setting_key = 'admin_recovery_email' LIMIT 1`
    );
    const email = String(result.rows[0]?.setting_value || '').trim();
    res.json({
      recovery_email_masked: maskEmail(email),
      updated_at: result.rows[0]?.updated_at || null,
      is_set: Boolean(email),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin recovery email' });
  }
}

async function setAdminRecoveryEmail(req, res) {
  try {
    await ensureSystemSettingsTable();
    const email = String(req.body.email || '').trim().toLowerCase();
    const currentPassword = String(req.body.current_password || '').trim();
    if (!email) {
      return res.status(400).json({ error: 'Recovery email cannot be empty' });
    }
    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required to change recovery email' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid recovery email' });
    }

    const adminUser = await pool.query('SELECT password_hash FROM users WHERE user_id = $1 LIMIT 1', [req.user.user_id]);
    if (adminUser.rows.length === 0) {
      return res.status(404).json({ error: 'Admin account not found' });
    }
    const ok = await bcrypt.compare(currentPassword, adminUser.rows[0].password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    await pool.query(
      `UPDATE system_settings
       SET setting_value = $1, updated_at = NOW(), updated_by = $2
       WHERE setting_key = 'admin_recovery_email'`,
      [email, req.user.user_id]
    );
    await req.audit('UPDATE', 'system_settings', null, null, {
      setting_key: 'admin_recovery_email',
      setting_value: '[hidden]'
    });

    res.json({ message: 'Admin recovery email updated.', recovery_email_masked: maskEmail(email) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update admin recovery email' });
  }
}

// ─── STUDENTS ────────────────────────────────────────────────────
async function getStudents(req, res) {
  try {
    const result = await pool.query(`
      SELECT s.*,
        CASE
          WHEN COALESCE(s.tuition_amount_due, 0) <= 0 THEN 'null'
          WHEN COALESCE(s.tuition_amount_paid, 0) >= COALESCE(s.tuition_amount_due, 0) THEN 'fully_paid'
          ELSE 'partial'
        END AS tuition_status,
        (
          SELECT STRING_AGG(DISTINCT p.first_name || ' ' || p.last_name, ', ')
          FROM parent_student ps
          JOIN parents p ON ps.parent_id = p.parent_id
          WHERE ps.student_id = s.student_id
        ) AS guardian_name,
        (
          SELECT c.class_id
          FROM enrollments e
          JOIN classes c ON e.class_id = c.class_id
          WHERE e.student_id = s.student_id
          ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.date_enrolled DESC, e.enrollment_id DESC
          LIMIT 1
        ) AS current_class_id,
        (
          SELECT c.class_name
          FROM enrollments e
          JOIN classes c ON e.class_id = c.class_id
          WHERE e.student_id = s.student_id
          ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.date_enrolled DESC, e.enrollment_id DESC
          LIMIT 1
        ) AS current_class_name
      FROM students s
      ORDER BY s.student_id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
}

async function createStudent(req, res) {
  try {
    const {
      first_name,
      last_name,
      other_name,
      gender,
      date_of_birth,
      guardian_name,
      tuition_amount_due,
      tuition_amount_paid,
      starting_class_id,
    } = req.body;
    if (!first_name || !last_name || !gender || !date_of_birth || !guardian_name || !starting_class_id || tuition_amount_due === undefined || tuition_amount_due === '' || tuition_amount_paid === undefined || tuition_amount_paid === '') {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const tuitionDue = tuition_amount_due === undefined || tuition_amount_due === '' ? 0 : Number(tuition_amount_due);
    const tuitionPaid = tuition_amount_paid === undefined || tuition_amount_paid === '' ? 0 : Number(tuition_amount_paid);
    if (Number.isNaN(tuitionDue) || Number.isNaN(tuitionPaid) || tuitionDue < 0 || tuitionPaid < 0) {
      return res.status(400).json({ error: 'Tuition values must be valid non-negative numbers' });
    }

    let startClassId = null;
    if (starting_class_id) {
      const cls = await pool.query('SELECT class_id FROM classes WHERE class_id = $1', [starting_class_id]);
      if (cls.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid starting class selected' });
      }
      startClassId = cls.rows[0].class_id;
    }

    const admNo = await generateUniqueCode({
      prefix: 'ADM',
      suffixPrefix: String(new Date().getFullYear()),
      table: 'students',
      column: 'admission_number',
      digits: 6,
    });

    const result = await pool.query(
      `INSERT INTO students (
        admission_number, first_name, last_name, other_name, gender, date_of_birth,
        email, phone, tuition_amount_due, tuition_amount_paid
      )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        admNo,
        first_name,
        last_name,
        other_name || null,
        gender,
        date_of_birth,
        null,
        null,
        tuitionDue,
        tuitionPaid,
      ]
    );
    await req.audit('CREATE', 'students', result.rows[0].student_id, null, result.rows[0]);

    if (startClassId) {
      const acadYear = await getCurrentAcademicYearSetting();
      await pool.query(
        `INSERT INTO enrollments (student_id, class_id, academic_year, status)
         VALUES ($1,$2,$3,'active')`,
        [result.rows[0].student_id, startClassId, acadYear]
      );
    }

    // If guardian_name provided, link to existing parent or create a guardian profile.
    if (guardian_name && guardian_name.trim()) {
      const parts = guardian_name.trim().split(/\s+/);
      const gFirst = parts[0];
      const gLast = parts.slice(1).join(' ') || '';
      if (gFirst) {
        const parentMatch = await pool.query(
          'SELECT parent_id FROM parents WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) LIMIT 1',
          [gFirst, gLast]
        );
        let parentId = parentMatch.rows[0]?.parent_id;
        if (!parentId) {
          const parentCreate = await pool.query(
            `INSERT INTO parents (first_name, last_name, phone, email, relationship)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING parent_id`,
            [
              gFirst,
              gLast || '',
              'N/A',
              null,
              'Guardian',
            ]
          );
          parentId = parentCreate.rows[0].parent_id;
        }
        await pool.query(
          'INSERT INTO parent_student (parent_id, student_id, relationship) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [parentId, result.rows[0].student_id, 'Guardian']
        );
      }
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create student' });
  }
}

async function updateStudent(req, res) {
  try {
    const { id } = req.params;
    const {
      admission_number,
      first_name,
      last_name,
      other_name,
      gender,
      date_of_birth,
      email,
      phone,
      status,
      tuition_amount_due,
      tuition_amount_paid,
    } = req.body;
    const old = await pool.query('SELECT * FROM students WHERE student_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    const prev = old.rows[0];

    const tuitionDue = tuition_amount_due === undefined || tuition_amount_due === ''
      ? prev.tuition_amount_due
      : Number(tuition_amount_due);
    const tuitionPaid = tuition_amount_paid === undefined || tuition_amount_paid === ''
      ? prev.tuition_amount_paid
      : Number(tuition_amount_paid);
    if (Number.isNaN(tuitionDue) || Number.isNaN(tuitionPaid) || tuitionDue < 0 || tuitionPaid < 0) {
      return res.status(400).json({ error: 'Tuition values must be valid non-negative numbers' });
    }

    const result = await pool.query(
      `UPDATE students SET admission_number=$1, first_name=$2, last_name=$3, other_name=$4,
       gender=$5, date_of_birth=$6, email=$7, phone=$8, status=$9,
       tuition_amount_due=$10, tuition_amount_paid=$11
       WHERE student_id=$12 RETURNING *`,
      [
        admission_number ?? prev.admission_number,
        first_name ?? prev.first_name,
        last_name ?? prev.last_name,
        other_name ?? prev.other_name,
        gender ?? prev.gender,
        date_of_birth ?? prev.date_of_birth,
        email ?? prev.email,
        phone ?? prev.phone,
        status ?? prev.status,
        tuitionDue,
        tuitionPaid,
        id,
      ]
    );
    await req.audit('UPDATE', 'students', parseInt(id), prev, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update student' });
  }
}

async function deleteStudent(req, res) {
  try {
    const { id } = req.params;
    const old = await pool.query('SELECT * FROM students WHERE student_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    const linkedParentUsers = await pool.query(
      `SELECT DISTINCT u.user_id
       FROM parent_student ps
       JOIN parents p ON p.parent_id = ps.parent_id
       JOIN users u ON (
         (u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email))
         OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username)
       )
       JOIN user_roles ur ON ur.user_id = u.user_id
       JOIN roles r ON r.role_id = ur.role_id
       WHERE ps.student_id = $1 AND r.role_name = 'parent'`,
      [id]
    );

    const closed = await pool.query(
      "UPDATE enrollments SET status = 'left' WHERE student_id = $1 AND status = 'active' RETURNING enrollment_id",
      [id]
    );

    // Soft delete
    await pool.query("UPDATE students SET status = 'suspended' WHERE student_id = $1", [id]);

    let suspendedParentAccounts = 0;
    for (const row of linkedParentUsers.rows) {
      const uid = row.user_id;
      const visibleChildren = await pool.query(
        `SELECT COUNT(DISTINCT s.student_id) AS cnt
         FROM parent_student ps
         JOIN parents p ON p.parent_id = ps.parent_id
         JOIN students s ON s.student_id = ps.student_id
         JOIN users u ON (
           (u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email))
           OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username)
         )
         WHERE u.user_id = $1
           AND COALESCE(LOWER(s.status), 'active') <> 'suspended'`,
        [uid]
      );

      if (parseInt(visibleChildren.rows[0]?.cnt || '0', 10) === 0) {
        const updated = await pool.query(
          "UPDATE users SET status = 'suspended' WHERE user_id = $1 AND status = 'approved' RETURNING user_id",
          [uid]
        );
        suspendedParentAccounts += updated.rowCount;
      }
    }

    await req.audit('DELETE', 'students', parseInt(id), old.rows[0], {
      status: 'suspended',
      closed_enrollments: closed.rowCount,
      suspended_parent_accounts: suspendedParentAccounts,
    });
    res.json({ message: `Student deactivated. ${closed.rowCount} active enrollment(s) closed automatically. ${suspendedParentAccounts} linked parent account(s) suspended.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete student' });
  }
}

// ─── TEACHERS ────────────────────────────────────────────────────
async function getTeachers(req, res) {
  try {
    const result = await pool.query('SELECT * FROM teachers ORDER BY teacher_id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
}

async function createTeacher(req, res) {
  try {
    const { employee_number, first_name, last_name, other_name, gender, phone, email } = req.body;
    if (!first_name || !last_name || !gender || !phone || !email) {
      return res.status(400).json({ error: 'Missing required fields. Only other name is optional.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = String(phone).trim();

    const existingEmail = await pool.query('SELECT teacher_id FROM teachers WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
    if (existingEmail.rows.length > 0) {
      return res.status(409).json({ error: 'A teacher with this email already exists' });
    }

    const empNo = await generateUniqueCode({
      prefix: 'EMP',
      table: 'teachers',
      column: 'employee_number',
      digits: 6,
    });

    const result = await pool.query(
      `INSERT INTO teachers (employee_number, first_name, last_name, other_name, gender, phone, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [empNo, first_name, last_name, other_name || null, gender, cleanPhone, cleanEmail]
    );
    await req.audit('CREATE', 'teachers', result.rows[0].teacher_id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Teacher number or email already exists' });
    }
    res.status(500).json({ error: `Failed to create teacher: ${err.message}` });
  }
}

async function promoteStudent(req, res) {
  try {
    const { id } = req.params;
    const { to_class_id } = req.body;
    if (!to_class_id) {
      return res.status(400).json({ error: 'to_class_id is required' });
    }

    const [studentRes, classRes] = await Promise.all([
      pool.query('SELECT * FROM students WHERE student_id = $1', [id]),
      pool.query('SELECT class_id, class_name FROM classes WHERE class_id = $1', [to_class_id]),
    ]);
    if (studentRes.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    if (classRes.rows.length === 0) return res.status(400).json({ error: 'Target class not found' });

    const active = await pool.query(
      `SELECT enrollment_id, class_id FROM enrollments
       WHERE student_id = $1 AND status = 'active'
       ORDER BY date_enrolled DESC, enrollment_id DESC
       LIMIT 1`,
      [id]
    );

    if (active.rows[0]?.class_id === Number(to_class_id)) {
      return res.status(400).json({ error: 'Student is already in the selected class' });
    }

    if (active.rows.length > 0) {
      await pool.query("UPDATE enrollments SET status = 'completed' WHERE enrollment_id = $1", [active.rows[0].enrollment_id]);
    }

    const acadYear = nextAcademicYear(await getCurrentAcademicYearSetting());
    const result = await pool.query(
      `INSERT INTO enrollments (student_id, class_id, academic_year, status)
       VALUES ($1,$2,$3,'active') RETURNING *`,
      [id, to_class_id, acadYear]
    );

    await req.audit('CREATE', 'enrollments', result.rows[0].enrollment_id, null, {
      promoted_student_id: Number(id),
      to_class_id: Number(to_class_id),
      from_enrollment_id: active.rows[0]?.enrollment_id || null,
      academic_year: acadYear,
    });

    res.status(201).json({
      message: `Student promoted to ${classRes.rows[0].class_name}`,
      enrollment: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to promote student' });
  }
}

async function reclassifyStudent(req, res) {
  try {
    const { id } = req.params;
    const action = String(req.body.action || '').trim().toLowerCase();
    const academicYear = nextAcademicYear(await getCurrentAcademicYearSetting());

    if (!['promote', 'demote', 'keep'].includes(action)) {
      return res.status(400).json({ error: 'action must be one of: promote, demote, keep' });
    }

    const studentRes = await pool.query('SELECT student_id, first_name, last_name FROM students WHERE student_id = $1', [id]);
    if (studentRes.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    const currentRes = await pool.query(`
      SELECT e.enrollment_id, e.class_id, e.status, e.academic_year, c.class_name, c.level
      FROM enrollments e
      JOIN classes c ON e.class_id = c.class_id
      WHERE e.student_id = $1
      ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.date_enrolled DESC, e.enrollment_id DESC
      LIMIT 1
    `, [id]);

    if (currentRes.rows.length === 0) {
      return res.status(400).json({ error: 'Student has no class enrollment to reclassify' });
    }

    const current = currentRes.rows[0];

    if (action === 'keep') {
      if (current.status === 'active') {
        return res.status(200).json({ message: `Student remains in ${current.class_name}` });
      }

      const kept = await pool.query(
        `INSERT INTO enrollments (student_id, class_id, academic_year, status)
         VALUES ($1,$2,$3,'active') RETURNING *`,
        [id, current.class_id, academicYear]
      );
      await req.audit('CREATE', 'enrollments', kept.rows[0].enrollment_id, null, {
        reclassify_action: 'keep',
        student_id: Number(id),
        class_id: current.class_id,
        academic_year: academicYear,
      });
      return res.status(201).json({
        message: `Student kept in ${current.class_name}`,
        enrollment: kept.rows[0],
      });
    }

    const classesRes = await pool.query(`
      SELECT class_id, class_name, level, COALESCE(status, 'active') AS status
      FROM classes
      ORDER BY LOWER(COALESCE(level, '')), LOWER(class_name), class_id
    `);

    const activeClasses = classesRes.rows.filter(
      (c) => String(c.status || 'active').toLowerCase() !== 'inactive'
    );
    if (activeClasses.length === 0) {
      return res.status(400).json({ error: 'No active classes are available for reclassification.' });
    }

    const normalizeLevel = (value) => String(value || '').trim().toLowerCase();
    const parseLevelRank = (value) => {
      const lvl = String(value || '').trim();
      const digits = lvl.replace(/[^0-9]/g, '');
      return digits ? Number(digits) : Number.MAX_SAFE_INTEGER;
    };

    const levelMap = new Map();
    for (const cls of activeClasses) {
      const key = normalizeLevel(cls.level);
      if (!levelMap.has(key)) {
        levelMap.set(key, {
          key,
          levelLabel: cls.level,
          rank: parseLevelRank(cls.level),
          classes: [],
        });
      }
      levelMap.get(key).classes.push(cls);
    }

    const levelGroups = Array.from(levelMap.values()).sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return String(a.levelLabel || '').localeCompare(String(b.levelLabel || ''), undefined, { sensitivity: 'base' });
    });

    const currentLevelKey = normalizeLevel(current.level);
    let currentLevelIndex = levelGroups.findIndex(
      (g) => g.key === currentLevelKey && g.classes.some((c) => Number(c.class_id) === Number(current.class_id))
    );
    if (currentLevelIndex < 0) {
      currentLevelIndex = levelGroups.findIndex((g) => g.key === currentLevelKey);
    }
    if (currentLevelIndex < 0) {
      return res.status(400).json({ error: 'Current class is not available for reclassification' });
    }

    const direction = action === 'promote' ? 1 : -1;
    const targetLevelIndex = currentLevelIndex + direction;

    if (targetLevelIndex < 0 || targetLevelIndex >= levelGroups.length) {
      return res.status(400).json({ error: `Cannot ${action}. Student is already at the ${action === 'promote' ? 'highest' : 'lowest'} available class.` });
    }

    const targetClasses = [...levelGroups[targetLevelIndex].classes].sort((a, b) => {
      const nameCmp = String(a.class_name || '').localeCompare(String(b.class_name || ''), undefined, { sensitivity: 'base' });
      if (nameCmp !== 0) return nameCmp;
      return Number(a.class_id) - Number(b.class_id);
    });

    const currentStream = (String(current.class_name || '').match(/[A-Za-z]+$/) || [])[0]?.toLowerCase() || '';
    let target = targetClasses[0];
    if (currentStream) {
      const streamMatch = targetClasses.find((c) => {
        const suffix = (String(c.class_name || '').match(/[A-Za-z]+$/) || [])[0]?.toLowerCase() || '';
        return suffix === currentStream;
      });
      if (streamMatch) target = streamMatch;
    }

    if (current.status === 'active') {
      await pool.query("UPDATE enrollments SET status = 'completed' WHERE enrollment_id = $1", [current.enrollment_id]);
    }

    const moved = await pool.query(
      `INSERT INTO enrollments (student_id, class_id, academic_year, status)
       VALUES ($1,$2,$3,'active') RETURNING *`,
      [id, target.class_id, academicYear]
    );

    await req.audit('CREATE', 'enrollments', moved.rows[0].enrollment_id, null, {
      reclassify_action: action,
      student_id: Number(id),
      from_class_id: current.class_id,
      to_class_id: target.class_id,
      academic_year: academicYear,
    });

    const verb = action === 'promote' ? 'promoted' : 'demoted';
    res.status(201).json({
      message: `Student ${verb} from ${current.class_name} to ${target.class_name}`,
      enrollment: moved.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reclassify student' });
  }
}

async function updateTeacher(req, res) {
  try {
    const { id } = req.params;
    const { employee_number, first_name, last_name, other_name, gender, phone, email, status } = req.body;
    const old = await pool.query('SELECT * FROM teachers WHERE teacher_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Teacher not found' });
    const prev = old.rows[0];

    const nextEmail = email ?? prev.email;
    if (!nextEmail) {
      return res.status(400).json({ error: 'Teacher email is required' });
    }

    const result = await pool.query(
      `UPDATE teachers SET employee_number=$1, first_name=$2, last_name=$3, other_name=$4,
       gender=$5, phone=$6, email=$7, status=$8 WHERE teacher_id=$9 RETURNING *`,
      [
        employee_number ?? prev.employee_number,
        first_name ?? prev.first_name,
        last_name ?? prev.last_name,
        other_name ?? prev.other_name,
        gender ?? prev.gender,
        phone ?? prev.phone,
        nextEmail,
        status ?? prev.status,
        id,
      ]
    );
    await req.audit('UPDATE', 'teachers', parseInt(id), prev, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update teacher' });
  }
}

async function deleteTeacher(req, res) {
  try {
    const { id } = req.params;
    // FK protection: check for teaching assignments
    const deps = await pool.query(
      'SELECT COUNT(*) AS cnt FROM teaching_assignments WHERE teacher_id = $1', [id]
    );
    if (parseInt(deps.rows[0].cnt) > 0) {
      return res.status(409).json({ error: 'Cannot delete teacher with active assignments. Remove assignments first.' });
    }
    const old = await pool.query('SELECT * FROM teachers WHERE teacher_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Teacher not found' });
    // Soft delete
    await pool.query("UPDATE teachers SET status = 'resigned' WHERE teacher_id = $1", [id]);
    const terminatedTeacherUser = await pool.query(
      `UPDATE users
       SET status = 'terminated'
       WHERE user_id IN (
         SELECT u.user_id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.user_id
         JOIN roles r ON r.role_id = ur.role_id
         WHERE r.role_name = 'teacher'
           AND (
             (u.email IS NOT NULL AND $1 IS NOT NULL AND LOWER(u.email) = LOWER($1))
             OR LOWER(u.username) = LOWER(COALESCE($2, ''))
             OR LOWER(u.username) = LOWER(COALESCE($3, ''))
           )
       )
       AND status = 'approved'
       RETURNING user_id`,
      [old.rows[0].email || null, old.rows[0].employee_number || null, old.rows[0].first_name || null]
    );
    await req.audit('DELETE', 'teachers', parseInt(id), old.rows[0], {
      status: 'resigned',
      terminated_user_accounts: terminatedTeacherUser.rowCount,
    });
    res.json({ message: `Teacher deactivated. ${terminatedTeacherUser.rowCount} linked user account(s) terminated.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete teacher' });
  }
}

// ─── PARENTS ─────────────────────────────────────────────────────
async function getParents(req, res) {
  try {
    const result = await pool.query(`
      SELECT p.*,
        STRING_AGG(DISTINCT s.first_name || ' ' || s.last_name, ', ') AS children_names
      FROM parents p
      LEFT JOIN parent_student ps ON p.parent_id = ps.parent_id
      LEFT JOIN students s ON ps.student_id = s.student_id
      GROUP BY p.parent_id
      ORDER BY p.parent_id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch parents' });
  }
}

async function createParent(req, res) {
  try {
    await ensureParentsGenderColumn();
    const { first_name, last_name, phone, email, address, relationship, gender } = req.body;
    if (!first_name || !last_name || !phone || !email || !gender || !relationship) {
      return res.status(400).json({ error: 'Missing required fields. Only address is optional.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const exists = await pool.query('SELECT parent_id FROM parents WHERE LOWER(email) = LOWER($1) LIMIT 1', [cleanEmail]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'A parent with this email already exists' });
    }
    const result = await pool.query(
      `INSERT INTO parents (first_name, last_name, phone, email, address, relationship, gender)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [first_name, last_name, phone, cleanEmail, address || null, relationship, gender]
    );
    await req.audit('CREATE', 'parents', result.rows[0].parent_id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create parent' });
  }
}

async function updateParent(req, res) {
  try {
    await ensureParentsGenderColumn();
    const { id } = req.params;
    const { first_name, last_name, phone, email, address, relationship, gender } = req.body;
    const old = await pool.query('SELECT * FROM parents WHERE parent_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Parent not found' });
    if (!email) {
      return res.status(400).json({ error: 'Parent email is required' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const exists = await pool.query('SELECT parent_id FROM parents WHERE LOWER(email) = LOWER($1) AND parent_id <> $2 LIMIT 1', [cleanEmail, id]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'A parent with this email already exists' });
    }
    const result = await pool.query(
      `UPDATE parents SET first_name=$1, last_name=$2, phone=$3, email=$4, address=$5, relationship=$6, gender=$7
       WHERE parent_id=$8 RETURNING *`,
      [first_name, last_name, phone, cleanEmail, address, relationship, gender || null, id]
    );
    await req.audit('UPDATE', 'parents', parseInt(id), old.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update parent' });
  }
}

async function deleteParent(req, res) {
  try {
    const { id } = req.params;
    const old = await pool.query('SELECT * FROM parents WHERE parent_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Parent not found' });

    const suspendedParentUsers = await pool.query(
      `UPDATE users
       SET status = 'suspended'
       WHERE user_id IN (
         SELECT u.user_id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.user_id
         JOIN roles r ON r.role_id = ur.role_id
         WHERE r.role_name = 'parent'
           AND (
             (u.email IS NOT NULL AND $1 IS NOT NULL AND LOWER(u.email) = LOWER($1))
             OR LOWER(SPLIT_PART(COALESCE($1, ''), '@', 1)) = LOWER(u.username)
           )
       )
       AND status = 'approved'
       RETURNING user_id`,
      [old.rows[0].email || null]
    );

    const unlinked = await pool.query('DELETE FROM parent_student WHERE parent_id = $1 RETURNING parent_student_id', [id]);
    await pool.query('DELETE FROM parents WHERE parent_id = $1', [id]);

    await req.audit('DELETE', 'parents', parseInt(id), old.rows[0], {
      deleted: true,
      removed_links: unlinked.rowCount,
      suspended_user_accounts: suspendedParentUsers.rowCount,
    });
    res.json({ message: `Parent deleted. ${unlinked.rowCount} parent-student link(s) removed automatically. ${suspendedParentUsers.rowCount} linked user account(s) suspended.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete parent' });
  }
}

// ─── CLASSES ──────────────────────────────────────────────────────
async function getClasses(req, res) {
  try {
    const result = await pool.query('SELECT * FROM classes ORDER BY class_id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
}

async function createClass(req, res) {
  try {
    const { class_name, class_code, level, capacity } = req.body;
    if (!class_name || !class_code || !level) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = await pool.query(
      'INSERT INTO classes (class_name, class_code, level, capacity) VALUES ($1,$2,$3,$4) RETURNING *',
      [class_name, class_code, level, capacity || null]
    );
    await req.audit('CREATE', 'classes', result.rows[0].class_id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create class' });
  }
}

async function updateClass(req, res) {
  try {
    const { id } = req.params;
    const { class_name, class_code, level, capacity } = req.body;
    const old = await pool.query('SELECT * FROM classes WHERE class_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Class not found' });
    const result = await pool.query(
      'UPDATE classes SET class_name=$1, class_code=$2, level=$3, capacity=$4 WHERE class_id=$5 RETURNING *',
      [class_name, class_code, level, capacity, id]
    );
    await req.audit('UPDATE', 'classes', parseInt(id), old.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update class' });
  }
}

async function deleteClass(req, res) {
  try {
    const { id } = req.params;
    const old = await pool.query('SELECT * FROM classes WHERE class_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Class not found' });

    const closed = await pool.query(
      "UPDATE enrollments SET status = 'completed' WHERE class_id = $1 AND status = 'active' RETURNING enrollment_id",
      [id]
    );
    await pool.query('DELETE FROM teaching_assignments WHERE class_id = $1', [id]);

    // Soft delete
    await pool.query("UPDATE classes SET status = 'inactive' WHERE class_id = $1", [id]);
    await req.audit('DELETE', 'classes', parseInt(id), old.rows[0], {
      status: 'inactive',
      closed_enrollments: closed.rowCount,
    });
    res.json({ message: `Class deactivated. ${closed.rowCount} active enrollment(s) closed automatically.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete class' });
  }
}

async function lookupStudentClass(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const like = `%${q}%`;
    const idNum = Number.isInteger(Number(q)) ? Number(q) : null;
    const result = await pool.query(
      `SELECT
         s.student_id,
         s.admission_number,
         s.first_name,
         s.last_name,
         c.class_id,
         c.class_name,
         c.class_code,
         c.level,
         e.status AS enrollment_status,
         e.academic_year
       FROM students s
       LEFT JOIN LATERAL (
         SELECT e.class_id, e.status, e.academic_year, e.enrollment_id
         FROM enrollments e
         WHERE e.student_id = s.student_id
         ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.date_enrolled DESC, e.enrollment_id DESC
         LIMIT 1
       ) e ON TRUE
       LEFT JOIN classes c ON c.class_id = e.class_id
       WHERE (
         s.first_name ILIKE $1
         OR s.last_name ILIKE $1
         OR (s.first_name || ' ' || s.last_name) ILIKE $1
         OR COALESCE(s.admission_number, '') ILIKE $1
         OR ($2::int IS NOT NULL AND s.student_id = $2)
       )
       ORDER BY s.first_name, s.last_name, s.student_id`,
      [like, idNum]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to search student class lookup' });
  }
}

// ─── SUBJECTS ─────────────────────────────────────────────────────
async function getSubjects(req, res) {
  try {
    const result = await pool.query('SELECT * FROM subjects ORDER BY subject_id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
}

async function createSubject(req, res) {
  try {
    const { subject_code, subject_name, description } = req.body;
    if (!subject_code || !subject_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = await pool.query(
      'INSERT INTO subjects (subject_code, subject_name, description) VALUES ($1,$2,$3) RETURNING *',
      [subject_code, subject_name, description || null]
    );
    await req.audit('CREATE', 'subjects', result.rows[0].subject_id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create subject' });
  }
}

async function updateSubject(req, res) {
  try {
    const { id } = req.params;
    const { subject_code, subject_name, description, is_active } = req.body;
    const old = await pool.query('SELECT * FROM subjects WHERE subject_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Subject not found' });
    const result = await pool.query(
      'UPDATE subjects SET subject_code=$1, subject_name=$2, description=$3, is_active=$4 WHERE subject_id=$5 RETURNING *',
      [subject_code, subject_name, description, is_active, id]
    );
    await req.audit('UPDATE', 'subjects', parseInt(id), old.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update subject' });
  }
}

async function deleteSubject(req, res) {
  try {
    const { id } = req.params;
    // FK protection: check for grades or teaching assignments
    const deps = await pool.query(
      'SELECT (SELECT COUNT(*) FROM grades WHERE subject_id = $1) + (SELECT COUNT(*) FROM teaching_assignments WHERE subject_id = $1) AS cnt', [id]
    );
    if (parseInt(deps.rows[0].cnt) > 0) {
      return res.status(409).json({ error: 'Cannot delete subject with existing grades or assignments. Remove them first.' });
    }
    const old = await pool.query('SELECT * FROM subjects WHERE subject_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Subject not found' });
    await pool.query('UPDATE subjects SET is_active = false WHERE subject_id = $1', [id]);
    await req.audit('DELETE', 'subjects', parseInt(id), old.rows[0], { is_active: false });
    res.json({ message: 'Subject deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete subject' });
  }
}

// ─── ENROLLMENTS ──────────────────────────────────────────────────
async function getEnrollments(req, res) {
  try {
    const { class_id, academic_year } = req.query;
    const params = [];
    let where = 'WHERE 1=1';
    if (class_id) {
      params.push(class_id);
      where += ` AND e.class_id = $${params.length}`;
    }
    if (academic_year) {
      params.push(academic_year);
      where += ` AND e.academic_year = $${params.length}`;
    }
    const result = await pool.query(`
      SELECT e.*, s.first_name || ' ' || s.last_name AS student_name, c.class_name
      FROM enrollments e
      JOIN students s ON e.student_id = s.student_id
      JOIN classes c ON e.class_id = c.class_id
      ${where}
      ORDER BY e.enrollment_id
    `, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
}

async function createEnrollment(req, res) {
  try {
    const { student_id, class_id, academic_year } = req.body;
    if (!student_id || !class_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const yearToUse = String(academic_year || '').trim() || await getCurrentAcademicYearSetting();
    const result = await pool.query(
      'INSERT INTO enrollments (student_id, class_id, academic_year) VALUES ($1,$2,$3) RETURNING *',
      [student_id, class_id, yearToUse]
    );
    await req.audit('CREATE', 'enrollments', result.rows[0].enrollment_id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create enrollment' });
  }
}

async function deleteEnrollment(req, res) {
  try {
    const { id } = req.params;
    // FK protection: check for attendance or grades
    const deps = await pool.query(
      'SELECT (SELECT COUNT(*) FROM attendance WHERE enrollment_id = $1) + (SELECT COUNT(*) FROM grades WHERE enrollment_id = $1) AS cnt', [id]
    );
    if (parseInt(deps.rows[0].cnt) > 0) {
      return res.status(409).json({ error: 'Cannot delete enrollment with attendance or grade records. Remove them first.' });
    }
    const old = await pool.query('SELECT * FROM enrollments WHERE enrollment_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Enrollment not found' });
    await pool.query("UPDATE enrollments SET status = 'left' WHERE enrollment_id = $1", [id]);
    await req.audit('DELETE', 'enrollments', parseInt(id), old.rows[0], { status: 'left' });
    res.json({ message: 'Enrollment deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete enrollment' });
  }
}

async function updateEnrollment(req, res) {
  try {
    const { id } = req.params;
    const { academic_year, status } = req.body;
    const old = await pool.query('SELECT * FROM enrollments WHERE enrollment_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Enrollment not found' });
    const result = await pool.query(
      'UPDATE enrollments SET academic_year = COALESCE($1, academic_year), status = COALESCE($2, status) WHERE enrollment_id = $3 RETURNING *',
      [academic_year || null, status || null, id]
    );
    await req.audit('UPDATE', 'enrollments', parseInt(id), old.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update enrollment' });
  }
}

// ─── FEES ─────────────────────────────────────────────────────────
async function getFees(req, res) {
  try {
    const result = await pool.query(`
      SELECT f.*, s.first_name || ' ' || s.last_name AS student_name, c.class_name
      FROM fees f
      JOIN enrollments e ON f.enrollment_id = e.enrollment_id
      JOIN students s ON e.student_id = s.student_id
      JOIN classes c ON e.class_id = c.class_id
      ORDER BY f.fee_id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fees' });
  }
}

async function createFee(req, res) {
  try {
    const { enrollment_id, admission_number, description, amount_due, due_date } = req.body;
    if ((!enrollment_id && !admission_number) || !amount_due) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let targetEnrollmentId = enrollment_id;
    if (!targetEnrollmentId) {
      const adm = String(admission_number || '').trim();
      if (!adm) {
        return res.status(400).json({ error: 'Admission number is required' });
      }
      const enrollment = await pool.query(
        `SELECT e.enrollment_id
         FROM enrollments e
         JOIN students s ON s.student_id = e.student_id
         WHERE LOWER(TRIM(s.admission_number)) = LOWER(TRIM($1))
         ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.date_enrolled DESC, e.enrollment_id DESC
         LIMIT 1`,
        [adm]
      );
      if (enrollment.rows.length === 0) {
        return res.status(404).json({ error: 'No enrollment found for the provided ADM number' });
      }
      targetEnrollmentId = enrollment.rows[0].enrollment_id;
    }

    const result = await pool.query(
      'INSERT INTO fees (enrollment_id, description, amount_due, due_date) VALUES ($1,$2,$3,$4) RETURNING *',
      [targetEnrollmentId, description || null, amount_due, due_date || null]
    );
    await req.audit('CREATE', 'fees', result.rows[0].fee_id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create fee' });
  }
}

async function updateFee(req, res) {
  try {
    const { id } = req.params;
    const { description, amount_due, amount_paid, due_date, status } = req.body;
    const old = await pool.query('SELECT * FROM fees WHERE fee_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Fee not found' });

    const allowedStatuses = ['unpaid', 'partial', 'paid'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` });
    }

    const result = await pool.query(
      `UPDATE fees SET
         description = COALESCE(NULLIF($1, ''), description),
         amount_due = COALESCE(NULLIF($2, '')::numeric, amount_due),
         amount_paid = COALESCE(NULLIF($3, '')::numeric, amount_paid),
         due_date = COALESCE(NULLIF($4, '')::date, due_date),
         status = COALESCE(NULLIF($5, ''), status)
       WHERE fee_id=$6 RETURNING *`,
      [description ?? '', amount_due ?? '', amount_paid ?? '', due_date ?? '', status ?? '', id]
    );
    await req.audit('UPDATE', 'fees', parseInt(id), old.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Fee update error:', {
      message: err.message,
      code: err.code,
      detail: err.detail,
      hint: err.hint,
      body: req.body,
      feeId: req.params.id,
    });

    if (err.code === '22P02') {
      return res.status(400).json({ error: 'Invalid number/date format in fee update fields' });
    }
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Invalid status value for fee' });
    }

    res.status(500).json({ error: `Failed to update fee: ${err.message}` });
  }
}

// ─── TEACHING ASSIGNMENTS ─────────────────────────────────────────
async function getAssignments(req, res) {
  try {
    const result = await pool.query(`
      SELECT ta.*, t.first_name || ' ' || t.last_name AS teacher_name,
             t.employee_number,
             s.subject_name, c.class_name
      FROM teaching_assignments ta
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      JOIN subjects s ON ta.subject_id = s.subject_id
      JOIN classes c ON ta.class_id = c.class_id
      ORDER BY ta.assignment_id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
}

async function createAssignment(req, res) {
  try {
    const { teacher_id, subject_id, class_id, academic_year, term } = req.body;
    if (!teacher_id || !subject_id || !class_id || !term) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const normTerm = normalizeTerm(term);
    if (!normTerm) {
      return res.status(400).json({ error: 'term must be one of: Term 1, Term 2, Term 3' });
    }
    const yearToUse = String(academic_year || '').trim() || await getCurrentAcademicYearSetting();

    const [teacherRes, subjectRes, classRes] = await Promise.all([
      pool.query('SELECT first_name, last_name FROM teachers WHERE teacher_id = $1', [teacher_id]),
      pool.query('SELECT subject_name FROM subjects WHERE subject_id = $1', [subject_id]),
      pool.query('SELECT class_name FROM classes WHERE class_id = $1', [class_id]),
    ]);
    if (teacherRes.rows.length === 0) return res.status(400).json({ error: 'Invalid teacher_id' });
    if (subjectRes.rows.length === 0) return res.status(400).json({ error: 'Invalid subject_id' });
    if (classRes.rows.length === 0) return res.status(400).json({ error: 'Invalid class_id' });

    const overlap = await pool.query(`
      SELECT t.first_name || ' ' || t.last_name AS teacher_name
      FROM teaching_assignments ta
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      WHERE ta.subject_id = $1
        AND ta.class_id = $2
        AND ta.teacher_id <> $3
        AND ta.academic_year = $4
    `, [subject_id, class_id, teacher_id, yearToUse]);

    const result = await pool.query(
      `INSERT INTO teaching_assignments (teacher_id, subject_id, class_id, academic_year, term)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [teacher_id, subject_id, class_id, yearToUse, normTerm]
    );
    await req.audit('CREATE', 'teaching_assignments', result.rows[0].assignment_id, null, result.rows[0]);
    if (overlap.rows.length > 0) {
      const existing = overlap.rows.map(r => r.teacher_name).join(', ');
      return res.status(201).json({
        ...result.rows[0],
        warning: `Notice: ${subjectRes.rows[0].subject_name} already has assignment(s) in ${classRes.rows[0].class_name} for ${yearToUse} by ${existing}. New assignment was still created.`,
      });
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This exact assignment already exists' });
    }
    res.status(500).json({ error: `Failed to create assignment: ${err.message}` });
  }
}

async function deleteAssignment(req, res) {
  try {
    const { id } = req.params;
    const old = await pool.query('SELECT * FROM teaching_assignments WHERE assignment_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    const result = await pool.query('DELETE FROM teaching_assignments WHERE assignment_id = $1 RETURNING assignment_id', [id]);
    await req.audit('DELETE', 'teaching_assignments', parseInt(id), old.rows[0], null);
    res.json({ message: 'Assignment deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
}

async function updateAssignment(req, res) {
  try {
    const { id } = req.params;
    const { academic_year, term } = req.body;
    const normTerm = normalizeTerm(term);
    if (!normTerm) {
      return res.status(400).json({ error: 'term must be one of: Term 1, Term 2, Term 3' });
    }
    const yearToUse = String(academic_year || '').trim() || await getCurrentAcademicYearSetting();
    const old = await pool.query('SELECT * FROM teaching_assignments WHERE assignment_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    const result = await pool.query(
      'UPDATE teaching_assignments SET academic_year = COALESCE($1, academic_year), term = COALESCE($2, term) WHERE assignment_id = $3 RETURNING *',
      [yearToUse, normTerm, id]
    );
    await req.audit('UPDATE', 'teaching_assignments', parseInt(id), old.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update assignment' });
  }
}

// ─── USERS & ROLES (Admin only) ──────────────────────────────────
async function getUsers(req, res) {
  try {
    const result = await pool.query(`
      SELECT u.user_id, u.username, u.email, u.phone, u.status, u.created_at,
             ARRAY_AGG(r.role_name) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.user_id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.role_id
      GROUP BY u.user_id ORDER BY u.user_id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}

async function getRoles(req, res) {
  try {
    const result = await pool.query('SELECT * FROM roles ORDER BY role_id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
}

// ─── PARENT-STUDENT LINKS ─────────────────────────────────────────
async function getParentStudentLinks(req, res) {
  try {
    const result = await pool.query(`
      SELECT ps.*, p.first_name || ' ' || p.last_name AS parent_name,
             s.first_name || ' ' || s.last_name AS student_name
      FROM parent_student ps
      JOIN parents p ON ps.parent_id = p.parent_id
      JOIN students s ON ps.student_id = s.student_id
      ORDER BY ps.parent_student_id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch parent-student links' });
  }
}

async function createParentStudentLink(req, res) {
  try {
    const { parent_id, student_id, relationship } = req.body;
    if (!parent_id || !student_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const parentExists = await pool.query('SELECT parent_id FROM parents WHERE parent_id = $1 LIMIT 1', [parent_id]);
    if (parentExists.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid parent_id' });
    }
    const studentExists = await pool.query('SELECT student_id FROM students WHERE student_id = $1 LIMIT 1', [student_id]);
    if (studentExists.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid student_id' });
    }

    const existingLink = await pool.query(
      'SELECT parent_student_id FROM parent_student WHERE parent_id = $1 AND student_id = $2 LIMIT 1',
      [parent_id, student_id]
    );
    if (existingLink.rows.length > 0) {
      return res.status(409).json({ error: 'This parent is already linked to this student.' });
    }

    const result = await pool.query(
      'INSERT INTO parent_student (parent_id, student_id, relationship) VALUES ($1,$2,$3) RETURNING *',
      [parent_id, student_id, relationship || null]
    );
    await req.audit('CREATE', 'parent_student', result.rows[0].parent_student_id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create link' });
  }
}

// ─── ACTIVITY DASHBOARD ─────────────────────────────────────────
async function getActivityDashboard(req, res) {
  try {
    const [recentEnrollments, unpaidFees, recentGradeChanges, recentLogs] = await Promise.all([
      pool.query(`
        SELECT e.*, s.first_name || ' ' || s.last_name AS student_name, c.class_name
        FROM enrollments e
        JOIN students s ON e.student_id = s.student_id
        JOIN classes c ON e.class_id = c.class_id
        ORDER BY e.enrollment_id DESC LIMIT 10
      `),
      pool.query(`
        SELECT f.*, s.first_name || ' ' || s.last_name AS student_name
        FROM fees f
        JOIN enrollments e ON f.enrollment_id = e.enrollment_id
        JOIN students s ON e.student_id = s.student_id
        WHERE f.status = 'unpaid' OR f.amount_paid < f.amount_due
        ORDER BY f.due_date ASC LIMIT 20
      `),
      pool.query(`
        SELECT al.* FROM audit_logs al
        WHERE al.table_name = 'grades'
        ORDER BY al.created_at DESC LIMIT 10
      `),
      pool.query(`
        SELECT al.* FROM audit_logs al
        ORDER BY al.created_at DESC LIMIT 20
      `),
    ]);
    res.json({
      recent_enrollments: recentEnrollments.rows,
      unpaid_fees: unpaidFees.rows,
      recent_grade_changes: recentGradeChanges.rows,
      recent_activity: recentLogs.rows,
    });
  } catch (err) {
    console.error('Activity dashboard error:', err);
    res.status(500).json({ error: 'Failed to load activity dashboard' });
  }
}

// ─── HOMEWORK (View/Delete) ──────────────────────────────────────
async function getHomework(req, res) {
  try {
    const result = await pool.query(`
      SELECT h.*, sub.subject_name, c.class_name,
             t.first_name || ' ' || t.last_name AS teacher_name
      FROM homework h
      JOIN subjects sub ON h.subject_id = sub.subject_id
      JOIN classes c ON h.class_id = c.class_id
      JOIN teachers t ON h.teacher_id = t.teacher_id
      ORDER BY h.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch homework' });
  }
}

async function deleteHomework(req, res) {
  try {
    const { id } = req.params;
    const old = await pool.query('SELECT * FROM homework WHERE homework_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Homework not found' });
    await pool.query('DELETE FROM homework WHERE homework_id = $1', [id]);
    await req.audit('DELETE', 'homework', parseInt(id), old.rows[0], null);
    res.json({ message: 'Homework deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete homework' });
  }
}

async function updateHomework(req, res) {
  try {
    const { id } = req.params;
    const { title, description, due_date } = req.body;
    const old = await pool.query('SELECT * FROM homework WHERE homework_id = $1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Homework not found' });
    const result = await pool.query(
      'UPDATE homework SET title = COALESCE($1, title), description = COALESCE($2, description), due_date = COALESCE($3, due_date) WHERE homework_id = $4 RETURNING *',
      [title || null, description || null, due_date || null, id]
    );
    await req.audit('UPDATE', 'homework', parseInt(id), old.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update homework' });
  }
}

// ─── AUDIT LOGS ──────────────────────────────────────────────────
async function getAuditLogs(req, res) {
  try {
    const { table_name, action, limit: lim } = req.query;
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];
    if (table_name) {
      params.push(table_name);
      query += ` AND table_name = $${params.length}`;
    }
    if (action) {
      params.push(action);
      query += ` AND action = $${params.length}`;
    }
    const maxRows = Math.min(parseInt(lim) || 100, 500);
    params.push(maxRows);
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}

// ─── PENDING REGISTRATIONS ──────────────────────────────────────
async function getPendingRegistrations(req, res) {
  try {
    await ensureRegistrationRequestsTable();
    const { role, q, status } = req.query;

    const params = [];
    let query = `SELECT
          rr.request_id,
          rr.username,
          COALESCE(rr.email, u.email) AS email,
          COALESCE(rr.phone, u.phone) AS phone,
          rr.role,
          rr.status,
          rr.student_first_name,
          rr.student_last_name,
          rr.student_admission_number,
          rr.parent_relationship,
          rr.created_at,
          rr.reviewed_at,
          COALESCE(u.status, 'pending') AS account_status,
          CASE
            WHEN u.user_id IS NOT NULL AND u.status = 'approved' AND rr.role = 'parent' THEN 'child_link'
            ELSE 'account_registration'
          END AS request_type
       FROM registration_requests rr
       LEFT JOIN users u ON u.username = rr.username
       WHERE 1=1
         AND rr.role IN ('student', 'parent', 'teacher')`;

    const cleanStatus = String(status || '').trim().toLowerCase();
    if (!cleanStatus || cleanStatus === 'pending') {
      query += " AND rr.status = 'pending'";
    } else if (cleanStatus === 'all') {
      // no status filter
    } else if (['approved', 'rejected'].includes(cleanStatus)) {
      params.push(cleanStatus);
      query += ` AND rr.status = $${params.length}`;
    } else {
      return res.status(400).json({ error: 'Invalid status filter. Use pending, approved, rejected, or all.' });
    }

    if (role) {
      params.push(role);
      query += ` AND rr.role = $${params.length}`;
    }

    if (q) {
      params.push(`%${q}%`);
      query += ` AND (rr.username ILIKE $${params.length} OR COALESCE(rr.email, '') ILIKE $${params.length})`;
    }

    query += ' ORDER BY rr.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
}

async function approveRegistration(req, res) {
  try {
    await ensureRegistrationRequestsTable();
    const { id } = req.params;

    const reqRes = await pool.query(
      `SELECT * FROM registration_requests WHERE request_id = $1`,
      [id]
    );
    if (reqRes.rows.length === 0) {
      return res.status(404).json({ error: 'Registration request not found' });
    }
    const regReq = reqRes.rows[0];
    if (regReq.status !== 'pending') {
      return res.status(400).json({ error: `Request already ${regReq.status}` });
    }

    const userRes = await pool.query(
      `SELECT u.user_id, u.username, u.email, u.phone, u.status
       FROM users u
       WHERE u.username = $1
       LIMIT 1`,
      [regReq.username]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Linked user account not found' });
    }
    const account = userRes.rows[0];

    // If parent, auto-link to student and create parent record if needed
    if (regReq.role === 'parent' && regReq?.student_first_name && regReq?.student_last_name) {
      let studentRes;
      const admissionNo = (regReq.student_admission_number || '').trim();
      if (admissionNo) {
        studentRes = await pool.query(
          'SELECT student_id FROM students WHERE LOWER(TRIM(admission_number)) = LOWER(TRIM($1)) LIMIT 1',
          [admissionNo]
        );
      } else {
        studentRes = await pool.query(
          'SELECT student_id FROM students WHERE LOWER(TRIM(first_name)) = LOWER($1) AND LOWER(TRIM(last_name)) = LOWER($2)',
          [regReq.student_first_name.trim(), regReq.student_last_name.trim()]
        );
      }

      if (studentRes.rows.length > 1) {
        return res.status(400).json({
          error: 'Multiple students matched this parent registration. Please add admission number to registration data before approval.'
        });
      }

      if (studentRes.rows.length > 0) {
        // Ensure parent profile exists once
        let parentId;
        const profileEmail = String(regReq.email || account.email || '').trim();
        if (profileEmail) {
          const existingParent = await pool.query('SELECT parent_id FROM parents WHERE LOWER(email) = LOWER($1) LIMIT 1', [profileEmail]);
          if (existingParent.rows.length > 0) {
            parentId = existingParent.rows[0].parent_id;
          }
        }
        if (!parentId) {
          const nameParts = account.username.split(/[._-]/);
          const parentRes = await pool.query(
            `INSERT INTO parents (first_name, last_name, phone, email, relationship)
             VALUES ($1, $2, $3, $4, $5) RETURNING parent_id`,
            [
              nameParts[0] || account.username,
              nameParts[1] || '',
              regReq.phone || account.phone || '',
              profileEmail || null,
              regReq.parent_relationship || null,
            ]
          );
          parentId = parentRes.rows[0].parent_id;
        }

        // Link parent to student(s)
        for (const student of studentRes.rows) {
          await pool.query(
            'INSERT INTO parent_student (parent_id, student_id, relationship) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [parentId, student.student_id, regReq.parent_relationship || null]
          );
        }
      } else {
        return res.status(400).json({ error: 'No matching student found for this parent request.' });
      }
    }

    if (account.status === 'pending') {
      await pool.query("UPDATE users SET status = 'approved' WHERE user_id = $1", [account.user_id]);
    }
    await pool.query(
      `UPDATE registration_requests
       SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1
       WHERE request_id = $2`,
      [req.user.user_id, regReq.request_id]
    );

    await req.audit('UPDATE', 'registration_requests', parseInt(id), { status: 'pending' }, { status: 'approved' });
    res.json({ message: `Request approved for ${account.username}`, request_id: parseInt(id) });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Failed to approve registration' });
  }
}

async function rejectRegistration(req, res) {
  try {
    await ensureRegistrationRequestsTable();
    const { id } = req.params;
    const { reason } = req.body;

    const reqRes = await pool.query('SELECT * FROM registration_requests WHERE request_id = $1', [id]);
    if (reqRes.rows.length === 0) {
      return res.status(404).json({ error: 'Registration request not found' });
    }
    const regReq = reqRes.rows[0];
    if (regReq.status !== 'pending') {
      return res.status(400).json({ error: `Request already ${regReq.status}` });
    }

    const userRes = await pool.query('SELECT user_id, username, status FROM users WHERE username = $1 LIMIT 1', [regReq.username]);
    const account = userRes.rows[0] || null;

    if (account && account.status === 'pending') {
      await pool.query("UPDATE users SET status = 'declined' WHERE user_id = $1", [account.user_id]);
    }
    await pool.query(
      `UPDATE registration_requests
       SET status = 'rejected', rejection_reason = $1, reviewed_at = NOW(), reviewed_by = $2
       WHERE request_id = $3`,
      [reason || null, req.user.user_id, regReq.request_id]
    );

    await req.audit('UPDATE', 'registration_requests', parseInt(id), { status: 'pending' }, { status: 'rejected', reason: reason || null });
    res.json({ message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to decline account' });
  }
}

async function reopenRegistration(req, res) {
  try {
    await ensureRegistrationRequestsTable();
    const { id } = req.params;

    const reqRes = await pool.query('SELECT * FROM registration_requests WHERE request_id = $1', [id]);
    if (reqRes.rows.length === 0) {
      return res.status(404).json({ error: 'Registration request not found' });
    }
    const regReq = reqRes.rows[0];
    if (regReq.status !== 'rejected') {
      return res.status(400).json({ error: `Only rejected requests can be reopened. Current status: ${regReq.status}` });
    }

    const userRes = await pool.query('SELECT user_id, status FROM users WHERE username = $1 LIMIT 1', [regReq.username]);
    const account = userRes.rows[0] || null;

    if (account && account.status === 'declined') {
      await pool.query("UPDATE users SET status = 'pending' WHERE user_id = $1", [account.user_id]);
    }

    await pool.query(
      `UPDATE registration_requests
       SET status = 'pending', rejection_reason = NULL, reviewed_at = NULL, reviewed_by = NULL
       WHERE request_id = $1`,
      [regReq.request_id]
    );

    await req.audit(
      'UPDATE',
      'registration_requests',
      parseInt(id, 10),
      { status: 'rejected', rejection_reason: regReq.rejection_reason || null },
      { status: 'pending', reopened: true }
    );

    res.json({ message: 'Request reopened and moved back to pending review.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reopen registration request' });
  }
}

async function getPendingGradeChanges(req, res) {
  try {
    await ensureGradeChangeRequestsTable();
    const q = String(req.query.q || '').trim();
    const params = [];
    let query = `
      SELECT
        gcr.request_id,
        gcr.enrollment_id,
        gcr.subject_id,
        gcr.term,
        gcr.proposed_marks,
        gcr.proposed_grade_letter,
        gcr.proposed_remarks,
        gcr.status,
        gcr.created_at,
        u.username AS requested_by_username,
        s.student_id,
        s.admission_number,
        s.first_name || ' ' || s.last_name AS student_name,
        c.class_name,
        sub.subject_name
      FROM grade_change_requests gcr
      JOIN users u ON gcr.requested_by = u.user_id
      JOIN enrollments e ON gcr.enrollment_id = e.enrollment_id
      JOIN students s ON e.student_id = s.student_id
      JOIN classes c ON e.class_id = c.class_id
      JOIN subjects sub ON gcr.subject_id = sub.subject_id
      WHERE gcr.status = 'pending'
    `;
    if (q) {
      params.push(`%${q}%`);
      query += `
        AND (
          s.first_name ILIKE $${params.length}
          OR s.last_name ILIKE $${params.length}
          OR COALESCE(s.admission_number, '') ILIKE $${params.length}
          OR u.username ILIKE $${params.length}
          OR sub.subject_name ILIKE $${params.length}
        )
      `;
    }
    query += ' ORDER BY gcr.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending grade changes' });
  }
}

async function approveGradeChange(req, res) {
  try {
    await ensureGradeChangeRequestsTable();
    const { id } = req.params;
    const requestRes = await pool.query('SELECT * FROM grade_change_requests WHERE request_id = $1 LIMIT 1', [id]);
    if (requestRes.rows.length === 0) {
      return res.status(404).json({ error: 'Grade change request not found' });
    }
    const item = requestRes.rows[0];
    if (item.status !== 'pending') {
      return res.status(400).json({ error: `Request already ${item.status}` });
    }

    const existing = await pool.query(
      `SELECT grade_id FROM grades
       WHERE enrollment_id = $1 AND subject_id = $2 AND term = $3
       LIMIT 1`,
      [item.enrollment_id, item.subject_id, item.term]
    );

    let gradeRow;
    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE grades
         SET marks = $1, grade_letter = $2, remarks = $3
         WHERE grade_id = $4
         RETURNING *`,
        [item.proposed_marks, item.proposed_grade_letter, item.proposed_remarks, existing.rows[0].grade_id]
      );
      gradeRow = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `INSERT INTO grades (enrollment_id, subject_id, term, marks, grade_letter, remarks)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [item.enrollment_id, item.subject_id, item.term, item.proposed_marks, item.proposed_grade_letter, item.proposed_remarks]
      );
      gradeRow = inserted.rows[0];
    }

    await pool.query(
      `UPDATE grade_change_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = NULL
       WHERE request_id = $2`,
      [req.user.user_id, id]
    );

    await req.audit('UPDATE', 'grade_change_requests', parseInt(id, 10), { status: 'pending' }, { status: 'approved' });
    await req.audit('UPDATE', 'grades', gradeRow.grade_id, null, gradeRow);
    res.json({ message: 'Grade change approved and applied.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve grade change' });
  }
}

async function rejectGradeChange(req, res) {
  try {
    await ensureGradeChangeRequestsTable();
    const { id } = req.params;
    const { reason } = req.body;
    const requestRes = await pool.query('SELECT request_id, status FROM grade_change_requests WHERE request_id = $1 LIMIT 1', [id]);
    if (requestRes.rows.length === 0) {
      return res.status(404).json({ error: 'Grade change request not found' });
    }
    if (requestRes.rows[0].status !== 'pending') {
      return res.status(400).json({ error: `Request already ${requestRes.rows[0].status}` });
    }

    await pool.query(
      `UPDATE grade_change_requests
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE request_id = $3`,
      [req.user.user_id, reason || null, id]
    );
    await req.audit('UPDATE', 'grade_change_requests', parseInt(id, 10), { status: 'pending' }, { status: 'rejected', reason: reason || null });
    res.json({ message: 'Grade change request rejected.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject grade change' });
  }
}

// ─── NOTIFICATIONS ──────────────────────────────────────────────
async function getNotifications(req, res) {
  try {
    await ensureGradeChangeRequestsTable();
    await ensureRegistrationRequestsTable();
    const [pending, pendingGradeChanges, recentAudit, unreadMessages] = await Promise.all([
      pool.query("SELECT COUNT(*) AS cnt FROM registration_requests WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) AS cnt FROM grade_change_requests WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) AS cnt FROM audit_logs WHERE created_at > NOW() - INTERVAL '24 hours'"),
      pool.query(
        "SELECT COUNT(*) AS cnt FROM messages WHERE message_type = 'private' AND recipient_id = $1 AND is_read = FALSE",
        [req.user.user_id]
      ),
    ]);
    const pendingRegistrations = parseInt(pending.rows[0].cnt);
    const pendingGrades = parseInt(pendingGradeChanges.rows[0].cnt);
    const unreadPrivateMessages = parseInt(unreadMessages.rows[0].cnt);
    res.json({
      pending_registrations: pendingRegistrations,
      pending_grade_changes: pendingGrades,
      pending_total: pendingRegistrations + pendingGrades,
      unread_private_messages: unreadPrivateMessages,
      recent_activity_24h: parseInt(recentAudit.rows[0].cnt),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
}

// ─── STUDENT RECORD LOOKUP ──────────────────────────────────────
async function getStudentRecord(req, res) {
  try {
    const { student_id, first_name, last_name } = req.query;
    let studentQuery = 'SELECT * FROM students WHERE 1=1';
    const params = [];
    if (student_id) { params.push(student_id); studentQuery += ` AND student_id = $${params.length}`; }
    if (first_name) { params.push(first_name); studentQuery += ` AND LOWER(first_name) = LOWER($${params.length})`; }
    if (last_name) { params.push(last_name); studentQuery += ` AND LOWER(last_name) = LOWER($${params.length})`; }
    studentQuery += ' LIMIT 1';

    const studentRes = await pool.query(studentQuery, params);
    if (studentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const student = studentRes.rows[0];

    // Get parent info
    const parentRes = await pool.query(`
      SELECT p.parent_id, p.first_name, p.last_name, p.phone, p.email,
             p.gender, p.relationship, ps.relationship AS link_relationship
      FROM parents p
      JOIN parent_student ps ON p.parent_id = ps.parent_id
      WHERE ps.student_id = $1
    `, [student.student_id]);

    // Get enrollment timeline and class context
    const enrollRes = await pool.query(`
      SELECT e.enrollment_id, e.academic_year, e.status,
             e.date_enrolled AS enrollment_date,
             c.class_name, c.level
      FROM enrollments e
      JOIN classes c ON e.class_id = c.class_id
      WHERE e.student_id = $1
      ORDER BY e.date_enrolled, e.enrollment_id
    `, [student.student_id]);

    const enrollments = enrollRes.rows;
    const firstEnrollment = enrollments.length > 0 ? enrollments[0].enrollment_date : null;
    const startedClass = enrollments.length > 0 ? enrollments[0].class_name : null;
    const startedAcademicYear = enrollments.length > 0 ? enrollments[0].academic_year : null;
    const activeEnrollment = enrollments.find(e => e.status === 'active');
    const latestEnrollment = enrollments.length > 0 ? enrollments[enrollments.length - 1] : null;
    const leftEnrollment = [...enrollments].reverse().find(e => e.status !== 'active');

    const currentClass = student.status === 'active'
      ? (activeEnrollment?.class_name || latestEnrollment?.class_name || null)
      : null;
    const classLeft = student.status !== 'active'
      ? (leftEnrollment?.class_name || latestEnrollment?.class_name || null)
      : null;
    const departure = student.status !== 'active'
      ? (leftEnrollment?.enrollment_date || latestEnrollment?.enrollment_date || null)
      : null;

    res.json({
      student,
      parents: parentRes.rows,
      enrollments,
      started_class: startedClass,
      started_academic_year: startedAcademicYear,
      date_of_enrollment: firstEnrollment,
      date_of_departure: departure,
      current_class: currentClass,
      class_left: classLeft,
    });
  } catch (err) {
    console.error('Record lookup error:', err);
    res.status(500).json({ error: 'Failed to fetch student record' });
  }
}

async function getTeacherRecord(req, res) {
  try {
    const { employee_number, first_name, last_name } = req.query;
    if (!employee_number && !first_name && !last_name) {
      return res.status(400).json({ error: 'Please provide EMP number, first name, or last name' });
    }

    let teacherQuery = 'SELECT * FROM teachers WHERE 1=1';
    const params = [];
    if (employee_number) {
      params.push(String(employee_number).trim());
      teacherQuery += ` AND LOWER(employee_number) = LOWER($${params.length})`;
    }
    if (first_name) {
      params.push(String(first_name).trim());
      teacherQuery += ` AND LOWER(first_name) = LOWER($${params.length})`;
    }
    if (last_name) {
      params.push(String(last_name).trim());
      teacherQuery += ` AND LOWER(last_name) = LOWER($${params.length})`;
    }
    teacherQuery += ' ORDER BY teacher_id DESC LIMIT 1';

    const teacherRes = await pool.query(teacherQuery, params);
    if (teacherRes.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const teacher = teacherRes.rows[0];

    const assignmentRes = await pool.query(
      `SELECT ta.assignment_id, ta.academic_year, ta.term,
              c.class_id, c.class_name,
              s.subject_id, s.subject_name
       FROM teaching_assignments ta
       JOIN classes c ON ta.class_id = c.class_id
       JOIN subjects s ON ta.subject_id = s.subject_id
       WHERE ta.teacher_id = $1
       ORDER BY ta.academic_year DESC, ta.term, ta.assignment_id DESC`,
      [teacher.teacher_id]
    );

    let account = null;
    if (teacher.email) {
      const accountRes = await pool.query(
        `SELECT u.user_id, u.username, u.email, u.phone, u.status
         FROM users u
         JOIN user_roles ur ON u.user_id = ur.user_id
         JOIN roles r ON ur.role_id = r.role_id
         WHERE r.role_name = 'teacher' AND LOWER(u.email) = LOWER($1)
         LIMIT 1`,
        [teacher.email]
      );
      account = accountRes.rows[0] || null;
    }

    res.json({
      teacher,
      account,
      assignments: assignmentRes.rows,
    });
  } catch (err) {
    console.error('Teacher record lookup error:', err);
    res.status(500).json({ error: 'Failed to fetch teacher record' });
  }
}

// ─── MESSAGING ──────────────────────────────────────────────────
async function sendBroadcast(req, res) {
  try {
    const { class_id, subject: subj, body } = req.body;
    if (!class_id || !body) {
      return res.status(400).json({ error: 'class_id and message body are required' });
    }
    const result = await pool.query(
      `INSERT INTO messages (sender_id, class_id, message_type, subject, body)
       VALUES ($1,$2,'broadcast',$3,$4) RETURNING *`,
      [req.user.user_id, class_id, subj || null, body]
    );

    await req.audit('CREATE', 'messages', result.rows[0].message_id, null, { type: 'broadcast', class_id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send broadcast' });
  }
}

async function sendPrivateMessage(req, res) {
  try {
    const recipientRaw = String(req.body.recipient || req.body.recipient_email || '').trim();
    const subj = (req.body.subject || '').trim();
    const message = (req.body.message || req.body.body || '').trim();

    if (!recipientRaw || !message) {
      return res.status(400).json({ error: 'recipient and message are required' });
    }

    const rcptUser = await pool.query(
      `SELECT u.user_id, u.username, u.email
       FROM users u
       WHERE LOWER(COALESCE(u.email, '')) = LOWER($1)
          OR LOWER(u.username) = LOWER($1)
       LIMIT 1`,
      [recipientRaw]
    );
    if (rcptUser.rows.length === 0) {
      return res.status(404).json({ error: 'Recipient user not found in app. Use a valid username or email.' });
    }
    const recipient = rcptUser.rows[0];

    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, message_type, subject, body)
       VALUES ($1,$2,'private',$3,$4) RETURNING *`,
      [req.user.user_id, recipient.user_id, subj || null, message]
    );

    await req.audit('CREATE', 'messages', result.rows[0].message_id, null, {
      type: 'private',
      recipient_id: recipient.user_id,
      recipient_username: recipient.username,
      recipient_email: recipient.email,
    });

    res.status(201).json({ ...result.rows[0], recipient_username: recipient.username, recipient_email: recipient.email });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send private message' });
  }
}

async function getAdminMessages(req, res) {
  try {
    const { type } = req.query;
    let query = `
      SELECT m.*, u.username AS sender_name,
        ru.username AS recipient_name,
        ru.email AS recipient_email,
        c.class_name
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.user_id
      LEFT JOIN users ru ON m.recipient_id = ru.user_id
      LEFT JOIN classes c ON m.class_id = c.class_id
      WHERE m.parent_message_id IS NULL
    `;
    const params = [];
    if (type === 'broadcast') {
      query += " AND m.message_type = 'broadcast'";
    } else if (type === 'private') {
      query += " AND m.message_type = 'private'";
    }
    query += ' ORDER BY m.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
}

async function getConversation(req, res) {
  try {
    const { id } = req.params;
    // Get original message + all replies
    const result = await pool.query(`
      SELECT m.*, u.username AS sender_name
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.user_id
      WHERE m.message_id = $1 OR m.parent_message_id = $1
      ORDER BY m.created_at ASC
    `, [id]);

    await pool.query(
      `UPDATE messages
       SET is_read = TRUE
       WHERE (message_id = $1 OR parent_message_id = $1)
         AND recipient_id = $2`,
      [id, req.user.user_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
}

async function replyMessage(req, res) {
  try {
    const { id } = req.params;
    const { body } = req.body;
    if (!body) return res.status(400).json({ error: 'Message body required' });

    // Get original message to determine recipient
    const orig = await pool.query('SELECT * FROM messages WHERE message_id = $1', [id]);
    if (orig.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    const origMsg = orig.rows[0];

    // Reply to the sender of the original
    const recipientId = origMsg.sender_id === req.user.user_id ? origMsg.recipient_id : origMsg.sender_id;
    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, message_type, subject, body, parent_message_id)
       VALUES ($1,$2,'private',$3,$4,$5) RETURNING *`,
      [req.user.user_id, recipientId, origMsg.subject ? 'Re: ' + origMsg.subject : null, body, origMsg.parent_message_id || origMsg.message_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reply' });
  }
}

async function getParentUsers(req, res) {
  try {
    const result = await pool.query(`
      SELECT u.user_id, u.username, p.first_name, p.last_name, p.phone,
        STRING_AGG(DISTINCT s.first_name || ' ' || s.last_name, ', ') AS children
      FROM users u
      JOIN user_roles ur ON u.user_id = ur.user_id
      JOIN roles r ON ur.role_id = r.role_id
      LEFT JOIN parents p ON LOWER(p.email) = LOWER(u.email)
      LEFT JOIN parent_student ps ON p.parent_id = ps.parent_id
      LEFT JOIN students s ON ps.student_id = s.student_id
      WHERE r.role_name = 'parent' AND u.status = 'approved'
      GROUP BY u.user_id, u.username, p.first_name, p.last_name, p.phone
      ORDER BY u.username
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch parent users' });
  }
}

module.exports = {
  getDashboard, getGradeEditStatus, setGradeEditStatus, getAdminRecoveryEmail, setAdminRecoveryEmail,
  getAcademicYearSettings, setAcademicYearSettings,
  getStudents, createStudent, updateStudent, deleteStudent, promoteStudent, reclassifyStudent,
  getTeachers, createTeacher, updateTeacher, deleteTeacher,
  getParents, createParent, updateParent, deleteParent,
  getClasses, createClass, updateClass, deleteClass, lookupStudentClass,
  getSubjects, createSubject, updateSubject, deleteSubject,
  getEnrollments, createEnrollment, updateEnrollment, deleteEnrollment,
  getFees, createFee, updateFee,
  getAssignments, createAssignment, updateAssignment, deleteAssignment,
  getUsers, getRoles,
  getParentStudentLinks, createParentStudentLink,
  getActivityDashboard, getAuditLogs,
  getHomework, updateHomework, deleteHomework,
  getPendingRegistrations, approveRegistration, rejectRegistration, reopenRegistration,
  getPendingGradeChanges, approveGradeChange, rejectGradeChange,
  getNotifications,
  getStudentRecord,
  getTeacherRecord,
  sendBroadcast, sendPrivateMessage, getAdminMessages, getConversation, replyMessage, getParentUsers,
};
