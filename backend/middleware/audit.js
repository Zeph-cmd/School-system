const pool = require('../config/db');

/**
 * Log an action to the audit_logs table.
 * Call this from controllers after any CREATE, UPDATE, or DELETE.
 */
async function logAction({ userId, username, action, tableName, recordId, oldData, newData, ip }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, username, action, table_name, record_id, old_data, new_data, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId || null,
        username || null,
        action,
        tableName,
        recordId || null,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        ip || null,
      ]
    );
  } catch (err) {
    // Don't let audit logging failures break the app
    console.error('Audit log error:', err.message);
  }
}

/**
 * Express middleware that attaches an audit helper to req.
 * Usage in controller: await req.audit('CREATE', 'students', newStudent.student_id, null, newStudent);
 */
function auditMiddleware(req, res, next) {
  req.audit = (action, tableName, recordId, oldData, newData) => {
    const meta = req.adminAccessNumber
      ? {
          admin_access: {
            access_number: req.adminAccessNumber,
            tag: `Admin ${req.adminAccessNumber}`,
            route: req.originalUrl || req.path,
            method: req.method,
          },
        }
      : null;

    const mergedNewData = meta
      ? {
          ...(newData || {}),
          _meta: {
            ...((newData && typeof newData === 'object' && newData._meta) ? newData._meta : {}),
            ...meta,
          },
        }
      : newData;

    return logAction({
      userId: req.user?.user_id,
      username: req.user?.username,
      action,
      tableName,
      recordId,
      oldData,
      newData: mergedNewData,
      ip: req.ip,
    });
  };
  next();
}

module.exports = { logAction, auditMiddleware };
