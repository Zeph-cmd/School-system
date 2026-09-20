const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/role');
const assistant = require('../controllers/assistantController');

// All assistant routes require authentication + any panel role.
// The role used by the assistant is taken from the verified JWT, never the body.
router.use(authenticate, authorize('admin', 'teacher', 'parent'));

router.post('/', assistant.ask);

module.exports = router;
