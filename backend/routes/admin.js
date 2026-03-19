const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/role');
const admin = require('../controllers/adminController');

// All admin routes require authentication + admin role
router.use(authenticate, authorize('admin'));

// Dashboard
router.get('/dashboard', admin.getDashboard);
router.get('/grade-edit-status', admin.getGradeEditStatus);
router.put('/grade-edit-status', admin.setGradeEditStatus);
router.get('/recovery-email', admin.getAdminRecoveryEmail);
router.put('/recovery-email', admin.setAdminRecoveryEmail);
router.get('/academic-year-settings', admin.getAcademicYearSettings);
router.put('/academic-year-settings', admin.setAcademicYearSettings);

// Students CRUD
router.get('/students', admin.getStudents);
router.post('/students', admin.createStudent);
router.put('/students/:id', admin.updateStudent);
router.delete('/students/:id', admin.deleteStudent);
router.post('/students/:id/promote', admin.promoteStudent);
router.post('/students/:id/reclassify', admin.reclassifyStudent);

// Teachers CRUD
router.get('/teachers', admin.getTeachers);
router.post('/teachers', admin.createTeacher);
router.put('/teachers/:id', admin.updateTeacher);
router.delete('/teachers/:id', admin.deleteTeacher);

// Parents CRUD
router.get('/parents', admin.getParents);
router.post('/parents', admin.createParent);
router.put('/parents/:id', admin.updateParent);
router.delete('/parents/:id', admin.deleteParent);

// Classes CRUD
router.get('/classes', admin.getClasses);
router.get('/classes/student-lookup', admin.lookupStudentClass);
router.post('/classes', admin.createClass);
router.put('/classes/:id', admin.updateClass);
router.delete('/classes/:id', admin.deleteClass);

// Subjects CRUD
router.get('/subjects', admin.getSubjects);
router.post('/subjects', admin.createSubject);
router.put('/subjects/:id', admin.updateSubject);
router.delete('/subjects/:id', admin.deleteSubject);

// Enrollments
router.get('/enrollments', admin.getEnrollments);
router.post('/enrollments', admin.createEnrollment);
router.put('/enrollments/:id', admin.updateEnrollment);
router.delete('/enrollments/:id', admin.deleteEnrollment);

// Fees
router.get('/fees', admin.getFees);
router.post('/fees', admin.createFee);
router.put('/fees/:id', admin.updateFee);

// Teaching Assignments
router.get('/assignments', admin.getAssignments);
router.post('/assignments', admin.createAssignment);
router.put('/assignments/:id', admin.updateAssignment);
router.delete('/assignments/:id', admin.deleteAssignment);

// Users & Roles
router.get('/users', admin.getUsers);
router.get('/roles', admin.getRoles);

// Parent-Student Links
router.get('/parent-student', admin.getParentStudentLinks);
router.post('/parent-student', admin.createParentStudentLink);

// Activity Dashboard & Audit Logs
router.get('/activity', admin.getActivityDashboard);
router.get('/audit-logs', admin.getAuditLogs);

// Homework
router.get('/homework', admin.getHomework);

// Pending Registrations
router.get('/pending-registrations', admin.getPendingRegistrations);
router.put('/pending-registrations/:id/approve', admin.approveRegistration);
router.put('/pending-registrations/:id/reject', admin.rejectRegistration);
router.put('/pending-registrations/:id/reopen', admin.reopenRegistration);
router.get('/pending-grade-changes', admin.getPendingGradeChanges);
router.put('/pending-grade-changes/:id/approve', admin.approveGradeChange);
router.put('/pending-grade-changes/:id/reject', admin.rejectGradeChange);

// Notifications
router.get('/notifications', admin.getNotifications);

// Student Record Lookup
router.get('/student-record', admin.getStudentRecord);

// Messaging
router.get('/messages', admin.getAdminMessages);
router.post('/messages/broadcast', admin.sendBroadcast);
router.post('/messages/private', admin.sendPrivateMessage);
router.get('/messages/:id/conversation', admin.getConversation);
router.post('/messages/:id/reply', admin.replyMessage);
router.get('/parent-users', admin.getParentUsers);

module.exports = router;
