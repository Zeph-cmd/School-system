require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../backend/config/db');

const SALT_ROUNDS = 10;

async function upsertUser(client, { username, password, email, phone, status, role }) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const userRes = await client.query(
    `INSERT INTO users (username, password_hash, email, phone, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (username)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email, phone = EXCLUDED.phone, status = EXCLUDED.status
     RETURNING user_id`,
    [username, hash, email, phone || null, status || 'approved']
  );
  const userId = userRes.rows[0].user_id;

  const roleRes = await client.query('SELECT role_id FROM roles WHERE role_name = $1 LIMIT 1', [role]);
  if (roleRes.rows.length === 0) throw new Error(`Missing role: ${role}`);
  const roleId = roleRes.rows[0].role_id;

  await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, roleId]);
  return userId;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Keep only allowed accounts.
    await client.query(
      `DELETE FROM user_roles
       WHERE user_id IN (
         SELECT user_id FROM users
         WHERE username NOT IN ('admin', 'teacher1', 'parent1', 'teachparent_t', 'teachparent_p')
       )`
    );
    await client.query(
      `DELETE FROM users
       WHERE username NOT IN ('admin', 'teacher1', 'parent1', 'teachparent_t', 'teachparent_p')`
    );

    await upsertUser(client, {
      username: 'teachparent_t',
      password: 'teacher123',
      email: 'shared@school.com',
      phone: '0799999001',
      status: 'approved',
      role: 'teacher',
    });

    await upsertUser(client, {
      username: 'teachparent_p',
      password: 'parent123',
      email: 'shared@school.com',
      phone: '0799999002',
      status: 'approved',
      role: 'parent',
    });

    // Ensure profile rows for shared accounts exist.
    await client.query(
      `INSERT INTO teachers (employee_number, first_name, last_name, gender, phone, email)
       VALUES ('EMP003', 'Shared', 'Teacher', 'Male', '0799999001', 'shared@school.com')
       ON CONFLICT (employee_number) DO NOTHING`
    );

    await client.query(
      `INSERT INTO parents (first_name, last_name, phone, email, relationship)
       VALUES ('Shared', 'Parent', '0799999002', 'shared@school.com', 'Guardian')
       ON CONFLICT DO NOTHING`
    );

    // Ensure admin recovery email exists and is non-empty.
    await client.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ('admin_recovery_email', 'admin@school.com')
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`
    );
    await client.query(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ('grade_edit_enabled', 'false')
       ON CONFLICT (setting_key) DO NOTHING`
    );

    // Ensure teacher1 has at least one assignment.
    await client.query(
      `INSERT INTO teaching_assignments (teacher_id, subject_id, class_id, academic_year, term)
       SELECT t.teacher_id, s.subject_id, c.class_id, '2025/2026', 'Term 1'
       FROM teachers t
       JOIN subjects s ON s.subject_code = 'MATH'
       JOIN classes c ON c.class_code = 'G1A'
       WHERE LOWER(t.email) = LOWER('jdoe@school.com')
       LIMIT 1
       ON CONFLICT DO NOTHING`
    );

    // Ensure parent1 is linked to at least one student.
    await client.query(
      `INSERT INTO parent_student (parent_id, student_id, relationship)
       SELECT p.parent_id, s.student_id, 'Father'
       FROM parents p
       JOIN students s ON s.admission_number = 'ADM001'
       WHERE LOWER(p.email) = LOWER('mwangi@gmail.com')
       LIMIT 1
       ON CONFLICT DO NOTHING`
    );

    await client.query('COMMIT');
    console.log('Post-reset setup complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Post-reset setup failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
