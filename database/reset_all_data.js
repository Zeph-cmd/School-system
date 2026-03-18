require('dotenv').config();
const pool = require('../backend/config/db');

async function resetAll() {
  const client = await pool.connect();
  try {
    const tablesRes = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    for (const row of tablesRes.rows) {
      const table = row.tablename;
      await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
    }
    console.log(`All public tables truncated: ${tablesRes.rows.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

resetAll().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
