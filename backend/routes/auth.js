const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const {
	register,
	login,
	me,
	adminForgotPassword,
	forgotCredentials,
	parentForgotPassword,
	getAcademicYear,
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticate, me);
router.get('/academic-year', authenticate, getAcademicYear);
router.post('/admin/forgot-password', adminForgotPassword);
router.post('/forgot-credentials', forgotCredentials);
router.post('/parent/forgot-password', parentForgotPassword);

module.exports = router;
