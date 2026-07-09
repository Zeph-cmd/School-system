require('dotenv').config();
const pool = require('../backend/config/db');

async function verify() {
  const users = await pool.query('SELECT username, email, status FROM users ORDER BY username');
  const tableCounts = await pool.query(`
    SELECT table_name, row_count
    FROM (
      SELECT 'students' AS table_name, COUNT(*)::int AS row_count FROM students
      UNION ALL SELECT 'teachers', COUNT(*)::int FROM teachers
      UNION ALL SELECT 'parents', COUNT(*)::int FROM parents
      UNION ALL SELECT 'classes', COUNT(*)::int FROM classes
      UNION ALL SELECT 'subjects', COUNT(*)::int FROM subjects
      UNION ALL SELECT 'fees', COUNT(*)::int FROM fees
      UNION ALL SELECT 'teaching_assignments', COUNT(*)::int FROM teaching_assignments
      UNION ALL SELECT 'registration_requests', COUNT(*)::int FROM registration_requests
    ) counts
    ORDER BY table_name
  `);
  const recoveryEmail = await pool.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'admin_recovery_email'"
  );

  console.log('USERS', users.rows);
  console.log('ADMIN_DATA_COUNTS', tableCounts.rows);
  console.log('admin_recovery_email', recoveryEmail.rows[0] ? recoveryEmail.rows[0].setting_value : null);
}

verify()
  .catch((err) => {
    console.error('Verification failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
