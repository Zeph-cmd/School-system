const pool = require('../config/db');

async function ensureAdminIpRegistryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ip_registry (
      admin_ip_id SERIAL PRIMARY KEY,
      ip_address VARCHAR(100) NOT NULL UNIQUE,
      access_number INT NOT NULL UNIQUE,
      first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id INT REFERENCES users(user_id)
    )
  `);
}

async function getOrCreateAdminIpAccessNumber(ipAddress, userId) {
  await ensureAdminIpRegistryTable();

  const normalizedIp = String(ipAddress || '').trim() || 'unknown';
  const existing = await pool.query(
    'SELECT admin_ip_id, access_number FROM admin_ip_registry WHERE ip_address = $1 LIMIT 1',
    [normalizedIp]
  );
  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE admin_ip_registry SET last_seen = NOW() WHERE admin_ip_id = $1',
      [existing.rows[0].admin_ip_id]
    );
    return existing.rows[0].access_number;
  }

  const nextRes = await pool.query('SELECT COALESCE(MAX(access_number), 0) + 1 AS next_number FROM admin_ip_registry');
  const nextNumber = Number(nextRes.rows[0].next_number || 1);

  const inserted = await pool.query(
    `INSERT INTO admin_ip_registry (ip_address, access_number, created_by_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (ip_address)
     DO UPDATE SET last_seen = NOW()
     RETURNING access_number`,
    [normalizedIp, nextNumber, userId || null]
  );

  return inserted.rows[0].access_number;
}

async function trackAdminIpAccess(req, res, next) {
  try {
    const accessNumber = await getOrCreateAdminIpAccessNumber(req.ip, req.user?.user_id || null);
    req.adminAccessNumber = accessNumber;
    return next();
  } catch (err) {
    // Do not block admin workflow because of tracking issues.
    return next();
  }
}

module.exports = {
  trackAdminIpAccess,
};
