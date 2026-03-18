/**
 * Role-based access control middleware.
 * Usage: router.get('/admin-only', authorize('admin'), handler)
 *        router.get('/staff', authorize('admin', 'teacher'), handler)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

module.exports = authorize;
