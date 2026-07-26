const pg = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

(async () => {
  try {
    // 1. Show all constraints on teaching_assignments
    const constraints = await pool.query(`
      SELECT con.conname, con.contype, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'teaching_assignments'
      ORDER BY con.contype;
    `);
    console.log('\n=== teaching_assignments constraints ===');
    constraints.rows.forEach(r => console.log(`  ${r.conname} (${r.contype}): ${r.def}`));

    // 2. Show columns
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'teaching_assignments'
      ORDER BY ordinal_position;
    `);
    console.log('\n=== teaching_assignments columns ===');
    cols.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} nullable=${r.is_nullable}`));

    // 3. Show indexes
    const idx = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'teaching_assignments';
    `);
    console.log('\n=== teaching_assignments indexes ===');
    idx.rows.forEach(r => console.log(`  ${r.indexname}: ${r.indexdef}`));

    // 4. Count existing assignments
    const cnt = await pool.query('SELECT COUNT(*) AS cnt FROM teaching_assignments');
    console.log(`\nTotal assignments: ${cnt.rows[0].cnt}`);

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
})();