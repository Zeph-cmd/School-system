const pool = require('../config/db');

const crypto = require('crypto');

function normalizeIp(rawIp) {
  const ip = String(rawIp || '').trim();
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    const first = String(xForwardedFor).split(',')[0];
    return normalizeIp(first);
  }

  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) {
    return normalizeIp(cfIp);
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return normalizeIp(realIp);
  }

  return normalizeIp(req.ip || req.socket?.remoteAddress);
}

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
    const accessNumber = await getOrCreateAdminIpAccessNumber(getClientIp(req), req.user?.user_id || null);
    req.adminAccessNumber = accessNumber;
    return next();
  } catch (err) {
    // Do not block admin workflow because of tracking issues.
    return next();
  }
}

// ── Device-based tracking (stable across dynamic IP changes) ──

// Lightweight device-model label from User-Agent (no external dependency).
function parseDeviceLabel(userAgent) {
  const ua = String(userAgent || '').trim();
  if (!ua) return 'Unknown device';

  // Android device model, e.g. "SM-G990B", "Pixel 7", "Redmi Note 12"
  const android = ua.match(/Android[^;)]*;\s*([^;)]+?)\s*(?:Build\/|\))/i);
  if (android) {
    let model = android[1].trim();
    // Strip carrier/provider prefixes common in Android UA strings
    model = model.replace(/^[wv]\s+/i, '').trim();
    return `Android ${model}`.slice(0, 200);
  }

  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh|Mac OS X/i.test(ua)) {
    if (/Edg\//i.test(ua)) return 'Mac (Edge)';
    if (/Chrome\//i.test(ua)) return 'Mac (Chrome)';
    if (/Firefox\//i.test(ua)) return 'Mac (Firefox)';
    if (/Safari\//i.test(ua)) return 'Mac (Safari)';
    return 'Mac';
  }
  if (/Windows/i.test(ua)) {
    if (/Edg\//i.test(ua)) return 'Windows PC (Edge)';
    if (/Chrome\//i.test(ua)) return 'Windows PC (Chrome)';
    if (/Firefox\//i.test(ua)) return 'Windows PC (Firefox)';
    return 'Windows PC';
  }
  if (/Linux/i.test(ua)) {
    if (/Chrome\//i.test(ua)) return 'Linux PC (Chrome)';
    if (/Firefox\//i.test(ua)) return 'Linux PC (Firefox)';
    return 'Linux PC';
  }
  return 'Unknown device';
}

// Stable hash of a device identity string.
function hashDeviceId(identity) {
  return crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0, 64);
}

async function ensureAdminDeviceRegistryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_device_registry (
      admin_device_id SERIAL PRIMARY KEY,
      device_hash VARCHAR(128) NOT NULL UNIQUE,
      device_label VARCHAR(200),
      access_number INT NOT NULL UNIQUE,
      first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id INT REFERENCES users(user_id)
    )
  `);
}

async function getOrCreateAdminDeviceAccessNumber(deviceHash, deviceLabel, userId) {
  await ensureAdminDeviceRegistryTable();

  const normalizedHash = String(deviceHash || '').trim() || 'unknown-device';
  const existing = await pool.query(
    'SELECT admin_device_id, access_number FROM admin_device_registry WHERE device_hash = $1 LIMIT 1',
    [normalizedHash]
  );
  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE admin_device_registry SET last_seen = NOW(), device_label = COALESCE($1, device_label) WHERE admin_device_id = $2',
      [deviceLabel || null, existing.rows[0].admin_device_id]
    );
    return existing.rows[0].access_number;
  }

  const nextRes = await pool.query('SELECT COALESCE(MAX(access_number), 0) + 1 AS next_number FROM admin_device_registry');
  const nextNumber = Number(nextRes.rows[0].next_number || 1);

  const inserted = await pool.query(
    `INSERT INTO admin_device_registry (device_hash, device_label, access_number, created_by_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (device_hash)
     DO UPDATE SET last_seen = NOW()
     RETURNING access_number`,
    [normalizedHash, deviceLabel || null, nextNumber, userId || null]
  );

  return inserted.rows[0].access_number;
}

async function trackAdminDeviceAccess(req, res, next) {
  try {
    const headerId = String(req.headers['x-device-id'] || '').trim();
    const userAgent = req.headers['user-agent'] || '';
    const deviceLabel = parseDeviceLabel(userAgent);

    // Prefer the explicit client fingerprint; fall back to a User-Agent hash
    // so requests from clients not yet sending the header still get a
    // stable-ish identity.
    const deviceHash = headerId ? hashDeviceId(headerId) : hashDeviceId(`ua:${userAgent}`);

    const accessNumber = await getOrCreateAdminDeviceAccessNumber(deviceHash, deviceLabel, req.user?.user_id || null);
    req.adminDevice = {
      accessNumber,
      deviceLabel,
      deviceHash,
    };
    return next();
  } catch (err) {
    // Do not block admin workflow because of tracking issues.
    return next();
  }
}

module.exports = {
  trackAdminIpAccess,
  trackAdminDeviceAccess,
};
