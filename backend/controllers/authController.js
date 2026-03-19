const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { logAction } = require('../middleware/audit');

const SALT_ROUNDS = 10;

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
    [`${new Date().getFullYear()}/${new Date().getFullYear() + 1}`]
  );
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

async function findStudentForParentRequest(firstName, lastName, admissionNo, guardianName) {
  return pool.query(
    `SELECT s.student_id
     FROM students s
     WHERE LOWER(TRIM(s.first_name)) = LOWER($1)
       AND LOWER(TRIM(s.last_name)) = LOWER($2)
       AND ($3::text IS NULL OR LOWER(TRIM(s.admission_number)) = LOWER(TRIM($3)))
       AND (
         EXISTS (
           SELECT 1
           FROM parent_student ps
           JOIN parents p ON p.parent_id = ps.parent_id
           WHERE ps.student_id = s.student_id
             AND LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM($4))
         )
         OR EXISTS (
           SELECT 1
           FROM parents p
           WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM($4))
         )
       )
     LIMIT 1`,
    [firstName, lastName, admissionNo || null, guardianName]
  );
}

// POST /api/auth/register
// New users register and go into pending state.
async function register(req, res) {
  try {
    await ensureRegistrationRequestsTable();

    const {
      username,
      password,
      email,
      phone,
      role,
      first_name,
      last_name,
      employee_number,
      student_first_name,
      student_last_name,
      student_admission_number,
      guardian_name,
      parent_relationship,
    } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (!role) {
      return res.status(400).json({ error: 'Role is required (student, parent, or teacher)' });
    }

    const validRoles = ['student', 'teacher', 'parent'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role: ${role}` });
    }

    const cleanUsername = String(username || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = String(phone || '').trim();
    const cleanFirstName = String(first_name || '').trim();
    const cleanLastName = String(last_name || '').trim();
    const cleanEmployeeNumber = String(employee_number || '').trim();
    const existingUserByUsername = await pool.query(
      'SELECT user_id, username, email, status FROM users WHERE username = $1',
      [cleanUsername]
    );

    const cleanStudentFirst = (student_first_name || '').trim();
    const cleanStudentLast = (student_last_name || '').trim();
    const cleanAdmissionNumber = (student_admission_number || '').trim();
    const cleanGuardianName = (guardian_name || '').trim();
    const cleanParentRelationship = (parent_relationship || '').trim();

    if ((role === 'teacher' || role === 'parent') && (!cleanEmail || !cleanPhone || !cleanFirstName || !cleanLastName)) {
      return res.status(400).json({ error: `First name, last name, email, and phone are required for ${role} registration.` });
    }

    if (role === 'teacher' && !cleanEmployeeNumber) {
      return res.status(400).json({ error: 'Employee number is required for teacher registration.' });
    }

    if (role === 'parent') {
      if (!cleanStudentFirst || !cleanStudentLast || !cleanAdmissionNumber) {
        return res.status(400).json({ error: 'Student first name, last name, and admission number are required for parent registration.' });
      }
      if (!cleanGuardianName) {
        return res.status(400).json({ error: 'Guardian name is required and must match school records.' });
      }
      if (!cleanParentRelationship) {
        return res.status(400).json({ error: 'Parent relationship is required and must match school records.' });
      }
    }

    if (existingUserByUsername.rows.length > 0) {
      const existing = existingUserByUsername.rows[0];

      // Parent can submit additional child-link requests with same credentials.
      if (role === 'parent') {
        if (String(existing.status) !== 'approved') {
          return res.status(409).json({ error: `Account is ${existing.status}. Wait for approval before adding another child.` });
        }
        if (!cleanEmail || String(existing.email || '').trim().toLowerCase() !== cleanEmail) {
          return res.status(409).json({ error: 'Email must match the existing parent account email for additional child requests.' });
        }

        const hasParentRole = await pool.query(
          `SELECT 1
           FROM user_roles ur
           JOIN roles r ON r.role_id = ur.role_id
           WHERE ur.user_id = $1 AND r.role_name = 'parent'
           LIMIT 1`,
          [existing.user_id]
        );
        if (hasParentRole.rows.length === 0) {
          return res.status(409).json({ error: 'This username exists but is not a parent account.' });
        }

        const parentProfile = await pool.query(
          `SELECT parent_id
           FROM parents
           WHERE LOWER(email) = LOWER($1)
             AND LOWER(TRIM(first_name)) = LOWER($2)
             AND LOWER(TRIM(last_name)) = LOWER($3)
             AND TRIM(phone) = $4
             AND LOWER(TRIM(relationship)) = LOWER($5)
           LIMIT 1`,
          [cleanEmail, cleanFirstName, cleanLastName, cleanPhone, cleanParentRelationship]
        );
        if (parentProfile.rows.length === 0) {
          return res.status(400).json({
            error: 'Parent profile not found with exact matching details. Ensure all registration fields match admin records.'
          });
        }

        const studentCheck = await findStudentForParentRequest(
          cleanStudentFirst,
          cleanStudentLast,
          cleanAdmissionNumber,
          cleanGuardianName
        );
        if (studentCheck.rows.length === 0) {
          return res.status(400).json({
            error: 'No matching school record found for that student/guardian combination. Confirm names (and admission number if provided) with admin.'
          });
        }

        const existingLink = await pool.query(
          'SELECT 1 FROM parent_student WHERE parent_id = $1 AND student_id = $2 LIMIT 1',
          [parentProfile.rows[0].parent_id, studentCheck.rows[0].student_id]
        );
        if (existingLink.rows.length > 0) {
          return res.status(409).json({ error: 'This child is already linked to your account.' });
        }

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const reqInsert = await pool.query(
          `INSERT INTO registration_requests
           (username, password_hash, email, phone, role, student_first_name, student_last_name, student_admission_number, parent_relationship, status)
           VALUES ($1,$2,$3,$4,'parent',$5,$6,$7,$8,'pending')
           RETURNING request_id, status`,
          [
            cleanUsername,
            passwordHash,
            cleanEmail,
            cleanPhone,
            cleanStudentFirst,
            cleanStudentLast,
            cleanAdmissionNumber,
            cleanParentRelationship,
          ]
        );

        return res.status(201).json({
          message: 'Child addition request submitted. Wait for admin approval before it appears in your parent panel.',
          request_id: reqInsert.rows[0].request_id,
          status: reqInsert.rows[0].status,
          child_link_request: true,
        });
      }

      if (existing.status === 'pending') {
        return res.status(409).json({ error: 'An account with this username is already pending approval' });
      }
      return res.status(409).json({ error: 'Username already exists' });
    }

    if (role === 'teacher') {
      const teacherProfile = await pool.query(
        `SELECT teacher_id
         FROM teachers
         WHERE LOWER(email) = LOWER($1)
           AND LOWER(TRIM(first_name)) = LOWER($2)
           AND LOWER(TRIM(last_name)) = LOWER($3)
           AND LOWER(TRIM(employee_number)) = LOWER($4)
           AND TRIM(phone) = $5
         LIMIT 1`,
        [cleanEmail, cleanFirstName, cleanLastName, cleanEmployeeNumber, cleanPhone]
      );
      if (teacherProfile.rows.length === 0) {
        return res.status(400).json({
          error: 'Teacher profile not found with exact matching details. Ensure all registration fields match admin records.'
        });
      }
    }

    if (role === 'parent') {
      const parentProfile = await pool.query(
        `SELECT parent_id
         FROM parents
         WHERE LOWER(email) = LOWER($1)
           AND LOWER(TRIM(first_name)) = LOWER($2)
           AND LOWER(TRIM(last_name)) = LOWER($3)
           AND TRIM(phone) = $4
           AND LOWER(TRIM(relationship)) = LOWER($5)
         LIMIT 1`,
        [cleanEmail, cleanFirstName, cleanLastName, cleanPhone, cleanParentRelationship]
      );
      if (parentProfile.rows.length === 0) {
        return res.status(400).json({
          error: 'Parent profile not found with exact matching details. Ensure all registration fields match admin records.'
        });
      }

      const studentCheck = await findStudentForParentRequest(
        cleanStudentFirst,
        cleanStudentLast,
        cleanAdmissionNumber,
        cleanGuardianName
      );

      if (studentCheck.rows.length === 0) {
        return res.status(400).json({
          error: 'No matching school record found for that student/guardian combination. Confirm names (and admission number if provided) with admin.'
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const client = await pool.connect();
    let userId;
    let result;
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `INSERT INTO users (username, password_hash, email, phone, status)
         VALUES ($1,$2,$3,$4,'pending') RETURNING user_id`,
        [cleanUsername, passwordHash, cleanEmail || null, cleanPhone || null]
      );
      userId = userResult.rows[0].user_id;

      const roleRes = await client.query('SELECT role_id FROM roles WHERE role_name = $1', [role]);
      if (roleRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Role not configured: ${role}` });
      }

      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [userId, roleRes.rows[0].role_id]);

      result = await client.query(
        `INSERT INTO registration_requests
         (username, password_hash, email, phone, role, student_first_name, student_last_name, student_admission_number, parent_relationship)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING request_id, status`,
        [
          cleanUsername,
          passwordHash,
          cleanEmail || null,
          cleanPhone || null,
          role,
          cleanStudentFirst || null,
          cleanStudentLast || null,
          cleanAdmissionNumber || null,
          cleanParentRelationship || null,
        ]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.status(201).json({
      message: 'Registration request submitted. Please wait for admin approval.',
      user_id: userId,
      request_id: result.rows[0].request_id,
      status: 'pending',
    });
  } catch (err) {
    console.error('Register error:', err);
    if (err.code === '23505') {
      if (err.constraint === 'users_username_key') {
        return res.status(409).json({ error: 'Username already exists' });
      }
      return res.status(409).json({ error: 'Registration conflicts with an existing account' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    await ensureRegistrationRequestsTable();

    const { username, email, password, role } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!role) {
      return res.status(400).json({ error: 'Role is required' });
    }

    const userResult = await pool.query(
      'SELECT user_id, username, email, password_hash, status FROM users WHERE username = $1',
      [String(username).trim()]
    );

    if (userResult.rows.length === 0) {
      // Check if there's a pending registration
      const pendingCheck = await pool.query(
        "SELECT status FROM registration_requests WHERE username = $1 ORDER BY created_at DESC LIMIT 1",
        [username]
      );
      if (pendingCheck.rows.length > 0 && pendingCheck.rows[0].status === 'pending') {
        return res.status(403).json({ error: 'Your account is pending admin approval. Please wait.' });
      }
      if (pendingCheck.rows.length > 0 && pendingCheck.rows[0].status === 'rejected') {
        return res.status(403).json({ error: 'Your registration was rejected. Contact the school admin.' });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending admin approval. Please wait.' });
    }
    if (user.status === 'declined') {
      return res.status(403).json({ error: 'Your account was declined. Contact the school admin.' });
    }
    if (user.status !== 'approved') {
      return res.status(403).json({ error: `Account is not approved (${user.status})` });
    }

    if (role === 'admin') {
      if (!password) {
        return res.status(400).json({ error: 'Password is required for admin login' });
      }
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } else {
      if (!email) {
        return res.status(400).json({ error: 'Email is required for teacher/parent login' });
      }
      if (!user.email) {
        return res.status(403).json({ error: 'This account has no email set. Contact admin to update your email before login.' });
      }
      if (String(user.email).trim().toLowerCase() !== String(email).trim().toLowerCase()) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    // Get user roles
    const rolesResult = await pool.query(
      `SELECT r.role_name FROM roles r
       JOIN user_roles ur ON r.role_id = ur.role_id
       WHERE ur.user_id = $1`,
      [user.user_id]
    );
    const roles = rolesResult.rows.map((r) => r.role_name);

    // If a specific role was requested, verify user has it
    if (role && !roles.includes(role)) {
      return res.status(403).json({ error: `You do not have the '${role}' role` });
    }

    const token = jwt.sign(
      { user_id: user.user_id, username: user.username, roles },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({ token, user: { user_id: user.user_id, username: user.username, roles } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
}

// POST /api/auth/admin/forgot-password
async function adminForgotPassword(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const newPassword = String(req.body.new_password || '').trim();

    if (!email) {
      return res.status(400).json({ error: 'Recovery email is required' });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    await ensureSystemSettingsTable();
    const settingRes = await pool.query(
      `SELECT setting_value
       FROM system_settings
       WHERE setting_key = 'admin_recovery_email'
       LIMIT 1`
    );
    const configured = String(settingRes.rows[0]?.setting_value || '').trim().toLowerCase();
    if (!configured || configured !== email) {
      return res.status(403).json({ error: 'Recovery email does not match admin recovery email' });
    }

    const adminUser = await pool.query(
      `SELECT user_id FROM users WHERE LOWER(username) = 'admin' LIMIT 1`
    );
    if (adminUser.rows.length === 0) {
      return res.status(404).json({ error: 'Admin account not found' });
    }

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [hash, adminUser.rows[0].user_id]);
    return res.json({ message: 'Admin password reset successful. You can now sign in with the new password.' });
  } catch (err) {
    console.error('Admin forgot password error:', err);
    res.status(500).json({ error: 'Failed to reset admin password' });
  }
}

// POST /api/auth/forgot-credentials
async function forgotCredentials(req, res) {
  try {
    const role = String(req.body.role || '').trim().toLowerCase();
    if (!role || !['parent', 'teacher'].includes(role)) {
      await logAction({
        action: 'FORGOT_CREDENTIALS_ATTEMPT',
        tableName: 'auth',
        newData: { role, result: 'invalid-role' },
        ip: req.ip,
      });
      return res.status(400).json({ error: 'Role must be parent or teacher' });
    }

    if (role === 'parent') {
      const childFirst = String(req.body.child_first_name || '').trim();
      const childLast = String(req.body.child_last_name || '').trim();
      const childAdm = String(req.body.child_admission_number || '').trim();
      if (!childFirst || !childLast || !childAdm) {
        await logAction({
          action: 'FORGOT_CREDENTIALS_ATTEMPT',
          tableName: 'auth',
          newData: { role, result: 'missing-fields' },
          ip: req.ip,
        });
        return res.status(400).json({ error: 'Child first name, last name, and admission number are required' });
      }

      const result = await pool.query(
        `SELECT DISTINCT u.username, u.email, u.phone, u.status
         FROM students s
         JOIN parent_student ps ON ps.student_id = s.student_id
         JOIN parents p ON p.parent_id = ps.parent_id
         JOIN users u ON LOWER(COALESCE(u.email, '')) = LOWER(COALESCE(p.email, ''))
         JOIN user_roles ur ON ur.user_id = u.user_id
         JOIN roles r ON r.role_id = ur.role_id
         WHERE r.role_name = 'parent'
           AND LOWER(TRIM(s.first_name)) = LOWER(TRIM($1))
           AND LOWER(TRIM(s.last_name)) = LOWER(TRIM($2))
           AND LOWER(TRIM(COALESCE(s.admission_number, ''))) = LOWER(TRIM($3))
         ORDER BY u.username`,
        [childFirst, childLast, childAdm]
      );

      await logAction({
        action: 'FORGOT_CREDENTIALS_ATTEMPT',
        tableName: 'auth',
        newData: {
          role,
          child_first_name: childFirst,
          child_last_name: childLast,
          child_admission_number: childAdm,
          result: result.rows.length > 0 ? 'found' : 'not-found',
          matches: result.rows.length,
        },
        ip: req.ip,
      });

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'No parent account found with those child details.' });
      }
      return res.json({
        message: 'Matching parent account details found.',
        accounts: result.rows.map((r) => ({
          username: r.username,
          email: r.email,
          phone: r.phone,
          status: r.status,
          role: 'parent',
        })),
      });
    }

    const teacherFirst = String(req.body.first_name || '').trim();
    const teacherLast = String(req.body.last_name || '').trim();
    const employeeNo = String(req.body.employee_number || '').trim();
    if (!teacherFirst || !teacherLast || !employeeNo) {
      await logAction({
        action: 'FORGOT_CREDENTIALS_ATTEMPT',
        tableName: 'auth',
        newData: { role, result: 'missing-fields' },
        ip: req.ip,
      });
      return res.status(400).json({ error: 'First name, last name, and employee number are required' });
    }

    const result = await pool.query(
      `SELECT DISTINCT u.username, u.email, u.phone, u.status,
              t.employee_number, t.first_name, t.last_name
       FROM teachers t
       JOIN users u ON LOWER(COALESCE(u.email, '')) = LOWER(COALESCE(t.email, ''))
       JOIN user_roles ur ON ur.user_id = u.user_id
       JOIN roles r ON r.role_id = ur.role_id
       WHERE r.role_name = 'teacher'
         AND LOWER(TRIM(t.first_name)) = LOWER(TRIM($1))
         AND LOWER(TRIM(t.last_name)) = LOWER(TRIM($2))
         AND LOWER(TRIM(COALESCE(t.employee_number, ''))) = LOWER(TRIM($3))
       ORDER BY u.username`,
      [teacherFirst, teacherLast, employeeNo]
    );

    await logAction({
      action: 'FORGOT_CREDENTIALS_ATTEMPT',
      tableName: 'auth',
      newData: {
        role,
        first_name: teacherFirst,
        last_name: teacherLast,
        employee_number: employeeNo,
        result: result.rows.length > 0 ? 'found' : 'not-found',
        matches: result.rows.length,
      },
      ip: req.ip,
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No teacher account found with those details.' });
    }
    return res.json({
      message: 'Matching teacher account details found.',
      accounts: result.rows.map((r) => ({
        username: r.username,
        email: r.email,
        phone: r.phone,
        status: r.status,
        role: 'teacher',
      })),
    });
  } catch (err) {
    console.error('Forgot credentials error:', err);
    res.status(500).json({ error: 'Failed to process forgot credentials request' });
  }
}

// GET /api/auth/me
async function me(req, res) {
  try {
    const userResult = await pool.query(
      'SELECT user_id, username, email, phone, status, created_at FROM users WHERE user_id = $1',
      [req.user.user_id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ ...userResult.rows[0], roles: req.user.roles });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
}

module.exports = { register, login, me, adminForgotPassword, forgotCredentials };
