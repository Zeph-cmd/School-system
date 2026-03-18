require('dotenv').config();
const pool = require('../backend/config/db');

(async () => {
  try {
    const cols = await pool.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('messages','email_logs') ORDER BY table_name, ordinal_position"
    );
    console.log(cols.rows);
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
