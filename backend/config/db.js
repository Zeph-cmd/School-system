require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT, 10),
  ssl: {
    rejectUnauthorized: false,
  },
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
