/**
 * Seed script - populates the database with:
 * 1. Roles (admin, teacher, parent, student)
 * 2. Test users for each role
 * 3. Sample students, teachers, parents, classes, subjects
 * 4. Sample enrollments, teaching assignments, parent-student links
 * 
 * Run: npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../backend/config/db');

const SALT_ROUNDS = 10;
const FRESH_CREDENTIALS = {
  adminPassword: 'Admin@2026!',
  teacherEmail: 'teacher1@school.com',
  teacherPassword: 'Teacher@2026!',
  parentEmail: 'parent1@school.com',
  parentPassword: 'Parent@2026!',
};

async function clearAllData(client) {
  await client.query(`
    TRUNCATE TABLE
      audit_logs,
      email_logs,
      messages,
      deleted_homework,
      homework,
      teaching_assignments,
      parent_student,
      results,
      grade_change_requests,
      grades,
      class_tuition_templates,
      fees,
      attendance,
      enrollments,
      students,
      parents,
      teachers,
      subjects,
      classes,
      registration_requests,
      user_roles,
      users,
      system_settings,
      roles
    RESTART IDENTITY CASCADE
  `);
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Clearing existing data...');
    await clearAllData(client);

    // ── 1. Roles ──────────────────────────────────
    console.log('Seeding roles...');
    await client.query(`
      INSERT INTO roles (role_name, description) VALUES 
        ('admin', 'Full system access'),
        ('teacher', 'Teaching and grading access'),
        ('parent', 'Read-only access to children data'),
        ('student', 'Student account (pending/approved workflow)')
      ON CONFLICT (role_name) DO NOTHING
    `);

    // ── 2. Users ──────────────────────────────────
    console.log('Seeding users...');
    const adminHash = await bcrypt.hash(FRESH_CREDENTIALS.adminPassword, SALT_ROUNDS);
    const teacherHash = await bcrypt.hash(FRESH_CREDENTIALS.teacherPassword, SALT_ROUNDS);
    const parentHash = await bcrypt.hash(FRESH_CREDENTIALS.parentPassword, SALT_ROUNDS);

    // Admin user
    const adminRes = await client.query(`
      INSERT INTO users (username, password_hash, email, phone)
      VALUES ('admin', $1, 'admin@school.com', '0700000001')
      ON CONFLICT (username) DO UPDATE SET password_hash = $1
      RETURNING user_id
    `, [adminHash]);

    // Teacher user
    const teacherRes = await client.query(`
      INSERT INTO users (username, password_hash, email, phone)
      VALUES ('teacher1', $1, $2, '0700000002')
      ON CONFLICT (username) DO UPDATE SET password_hash = $1, status = 'approved', email = EXCLUDED.email, phone = EXCLUDED.phone
      RETURNING user_id
    `, [teacherHash, FRESH_CREDENTIALS.teacherEmail]);

    // Parent user
    const parentRes = await client.query(`
      INSERT INTO users (username, password_hash, email, phone)
      VALUES ('parent1', $1, $2, '0700000003')
      ON CONFLICT (username) DO UPDATE SET password_hash = $1, status = 'approved', email = EXCLUDED.email, phone = EXCLUDED.phone
      RETURNING user_id
    `, [parentHash, FRESH_CREDENTIALS.parentEmail]);

    await client.query(`UPDATE users SET status = 'approved' WHERE username IN ('admin', 'teacher1', 'parent1')`);

    const adminId = adminRes.rows[0].user_id;
    const teacherId = teacherRes.rows[0].user_id;
    const parentId = parentRes.rows[0].user_id;

    // ── 3. User Roles ─────────────────────────────
    console.log('Assigning roles...');
    const roles = await client.query('SELECT role_id, role_name FROM roles');
    const roleMap = {};
    roles.rows.forEach(r => roleMap[r.role_name] = r.role_id);

    await client.query(`
      INSERT INTO user_roles (user_id, role_id) VALUES
        ($1, $4), ($2, $5), ($3, $6)
    `, [adminId, teacherId, parentId, roleMap.admin, roleMap.teacher, roleMap.parent]);

    await client.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('admin_recovery_email', 'admin@school.com')
      ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()
    `);

    await client.query('COMMIT');
    console.log('\n=== Seed completed successfully! ===');
    console.log('\nTest accounts:');
    console.log(`  Admin:   username=admin     password=${FRESH_CREDENTIALS.adminPassword}`);
    console.log(`  Teacher: username=teacher1  email=${FRESH_CREDENTIALS.teacherEmail}`);
    console.log(`  Parent:  username=parent1   email=${FRESH_CREDENTIALS.parentEmail}`);
    console.log('\nStart server: npm start');
    console.log('Open: http://localhost:3000/login');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seed();
}

module.exports = { seed, FRESH_CREDENTIALS };
