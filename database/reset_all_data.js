require('dotenv').config();
const pool = require('../backend/config/db');

// Explicit School-OS table allowlist (mirror of database/init.sql).
// ONLY these tables are ever truncated. This project shares the Supabase
// database with another app (Smart Jotter) whose tables live in the same
// 'public' schema -- dynamic discovery ("SELECT * FROM pg_tables") is what
// wiped them once. Never replace this allowlist with dynamic discovery.
// If init.sql gains a new table, add it here too.
const SCHOOL_OS_TABLES = [
  'roles',
  'users',
  'user_roles',
  'registration_requests',
  'system_settings',
  'students',
  'teachers',
  'parents',
  'classes',
  'subjects',
  'enrollments',
  'attendance',
  'fees',
  'class_tuition_templates',
  'grades',
  'grade_change_requests',
  'results',
  'parent_student',
  'teaching_assignments',
  'messages',
  'homework',
  'deleted_homework',
  'admin_ip_registry',
  'admin_device_registry',
  'ai_usage',
  'audit_logs',
  'email_logs',
];

async function resetAll() {
  const client = await pool.connect();
  try {
    const existingRes = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const existing = new Set(existingRes.rows.map((r) => r.tablename));

    // Truncate only School-OS tables that actually exist
    const toTruncate = SCHOOL_OS_TABLES.filter((t) => existing.has(t));
    for (const table of toTruncate) {
      await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
    }
    console.log(`School-OS tables truncated: ${toTruncate.length}/${SCHOOL_OS_TABLES.length}`);

    // Visibility (never destructive): report foreign tables so drift is obvious
    const foreign = [...existing].filter((t) => !SCHOOL_OS_TABLES.includes(t));
    if (foreign.length > 0) {
      console.log(`Foreign tables left untouched (not School-OS): ${foreign.join(', ')}`);
    }

    // Visibility: allowlist entries missing from the database
    const missing = SCHOOL_OS_TABLES.filter((t) => !existing.has(t));
    if (missing.length > 0) {
      console.log(`Allowlist entries not present in database: ${missing.join(', ')}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

resetAll().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
