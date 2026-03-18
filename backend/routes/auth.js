const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const { register, login, me, adminForgotPassword, forgotCredentials } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticate, me);
router.post('/admin/forgot-password', adminForgotPassword);
router.post('/forgot-credentials', forgotCredentials);

module.exports = router;
