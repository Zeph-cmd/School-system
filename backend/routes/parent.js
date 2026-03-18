const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/role');
const parent = require('../controllers/parentController');

// All parent routes require authentication + parent role
router.use(authenticate, authorize('parent'));

router.get('/children', parent.getMyChildren);
router.get('/fees', parent.getChildFees);
router.get('/results', parent.getChildResults);
router.get('/grades', parent.getChildGrades);
router.get('/attendance', parent.getChildAttendance);
router.get('/homework', parent.getChildHomework);

// Messages
router.get('/messages', parent.getMyMessages);
router.get('/messages/unread-count', parent.getUnreadCount);
router.get('/messages/:id/conversation', parent.getConversation);
router.post('/messages/:id/reply', parent.replyToMessage);

// Email contact
router.get('/contact-teachers', parent.getContactTeachers);
router.post('/contact-admin', parent.contactAdmin);
router.post('/contact-teacher', parent.contactTeacher);

module.exports = router;
