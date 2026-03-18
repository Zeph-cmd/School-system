require('dotenv').config();
const pool = require('../backend/config/db');

async function run() {
  await pool.query(
    "UPDATE users SET status = 'approved' WHERE username IN ('admin','teacher1','parent1','teachparent_t','teachparent_p')"
  );
  const users = await pool.query('SELECT username, status FROM users ORDER BY username');
  console.log(users.rows);
}

run()
  .catch((err) => {
    console.error('Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
