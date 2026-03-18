const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/role');
const teacher = require('../controllers/teacherController');

// All teacher routes require authentication + teacher role
router.use(authenticate, authorize('teacher'));

router.get('/profile', teacher.getProfile);
router.get('/assignments', teacher.getMyAssignments);
router.get('/students', teacher.getMyStudents);

// Attendance
router.get('/attendance', teacher.getAttendance);
router.post('/attendance', teacher.markAttendance);

// Grades
router.get('/grades', teacher.getGrades);
router.get('/grades/edit-status', teacher.getGradeEditStatus);
router.post('/grades', teacher.enterGrade);

// Homework
router.get('/homework', teacher.getHomework);
router.post('/homework', teacher.createHomework);
router.put('/homework/:id', teacher.updateHomework);
router.delete('/homework/:id', teacher.deleteHomework);

// Messages (teacher <-> parents in assigned classes only)
router.get('/messages/parents', teacher.getMessageParents);
router.get('/messages', teacher.getMyMessages);
router.post('/messages/private', teacher.sendParentMessage);
router.get('/messages/:id/conversation', teacher.getMessageConversation);
router.post('/messages/:id/reply', teacher.replyMessage);

module.exports = router;
