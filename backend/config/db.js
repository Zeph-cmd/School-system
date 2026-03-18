require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10),
});

const SQL_DEBUG = process.env.SQL_DEBUG === 'true';
const rawQuery = pool.query.bind(pool);

pool.query = async (text, params) => {
  if (SQL_DEBUG) {
    const sql = typeof text === 'string' ? text : text?.text;
    const values = params || text?.values || [];
    const compact = (sql || '').replace(/\s+/g, ' ').trim();
    console.log(`[SQL] ${compact}`);
    if (values.length) {
      console.log('[SQL params]', values);
    }
  }
  return rawQuery(text, params);
};

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;
