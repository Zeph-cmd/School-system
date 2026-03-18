require('dotenv').config();
const pool = require('../backend/config/db');

async function verify() {
  const users = await pool.query('SELECT username, email, status FROM users ORDER BY username');
  const teacherAssignments = await pool.query(
    `SELECT COUNT(*)::int AS cnt
     FROM teaching_assignments ta
     JOIN teachers te ON ta.teacher_id = te.teacher_id
     WHERE LOWER(te.email) = LOWER('jdoe@school.com')`
  );
  const parentChildren = await pool.query(
    `SELECT COUNT(*)::int AS cnt
     FROM parent_student ps
     JOIN parents pa ON ps.parent_id = pa.parent_id
     WHERE LOWER(pa.email) = LOWER('mwangi@gmail.com')`
  );
  const pendingRequests = await pool.query("SELECT COUNT(*)::int AS cnt FROM registration_requests WHERE status = 'pending'");
  const recoveryEmail = await pool.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'admin_recovery_email'"
  );

  console.log('USERS', users.rows);
  console.log('teacher1_assignments', teacherAssignments.rows[0].cnt);
  console.log('parent1_children', parentChildren.rows[0].cnt);
  console.log('pending_requests', pendingRequests.rows[0].cnt);
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
