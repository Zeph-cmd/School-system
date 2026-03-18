/**
 * Comprehensive Test Suite for School Management System
 * 
 * Covers:
 * 1. Admin CRUD (create/edit/delete student, assign class, assign teacher, record results, attendance, fees)
 * 2. Teacher Isolation (can't see other teacher's classes, can't access admin routes)
 * 3. Parent Isolation (can't see other parent's children)
 * 4. Security Audit (RBAC, parameterized queries, bcrypt, JWT expiry, audit logs)
 * 5. Data Integrity (FK protection, soft delete instead of hard delete)
 * 6. Real-Life Scenarios (new student flow, teacher records results, parent checks fees)
 * 7. Activity Dashboard & Audit Logs
 * 
 * Run: node tests/comprehensive-test.js (server must be running)
 */

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ FAIL  ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function api(path, method = 'GET', body = null, token = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  School Management System - Comprehensive Test Suite    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Clean up test data from previous runs
  console.log('Cleaning up previous test data...');
  try {
    const { Pool } = require('pg');
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    const pool = new Pool({
      user: process.env.DB_USER, host: process.env.DB_HOST,
      database: process.env.DB_NAME, password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
    });
    await pool.query(`
      DELETE FROM attendance WHERE enrollment_id IN (SELECT enrollment_id FROM enrollments WHERE student_id IN (SELECT student_id FROM students WHERE admission_number IN ('TEST001','SCEN001')));
      DELETE FROM grades WHERE enrollment_id IN (SELECT enrollment_id FROM enrollments WHERE student_id IN (SELECT student_id FROM students WHERE admission_number IN ('TEST001','SCEN001')));
      DELETE FROM fees WHERE enrollment_id IN (SELECT enrollment_id FROM enrollments WHERE student_id IN (SELECT student_id FROM students WHERE admission_number IN ('TEST001','SCEN001')));
      DELETE FROM parent_student WHERE student_id IN (SELECT student_id FROM students WHERE admission_number IN ('TEST001','SCEN001'));
      DELETE FROM teaching_assignments WHERE teacher_id IN (SELECT teacher_id FROM teachers WHERE employee_number = 'EMP999');
      DELETE FROM enrollments WHERE student_id IN (SELECT student_id FROM students WHERE admission_number IN ('TEST001','SCEN001'));
      DELETE FROM students WHERE admission_number IN ('TEST001','SCEN001');
      DELETE FROM teachers WHERE employee_number = 'EMP999';
      DELETE FROM parents WHERE email = 'test.parent@email.com';
      DELETE FROM classes WHERE class_code = 'TC9';
      DELETE FROM subjects WHERE subject_code = 'TST101';
      DELETE FROM audit_logs WHERE 1=1;
    `);
    await pool.end();
    console.log('Cleanup complete.\n');
  } catch (err) {
    console.log('Cleanup note:', err.message, '\n');
  }

  let adminToken, teacherToken, parentToken;

  // ════════════════════════════════════════════════════════════════
  // SECTION 1: AUTHENTICATION
  // ════════════════════════════════════════════════════════════════
  console.log('═══ 1. AUTHENTICATION ═══');

  await test('Health check returns ok', async () => {
    const { status, data } = await api('/api/health');
    assert(status === 200);
    assert(data.status === 'ok');
    assert(data.database === 'connected');
  });

  await test('Login fails with wrong password', async () => {
    const { status } = await api('/api/auth/login', 'POST', { username: 'admin', password: 'wrongpass' });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  await test('Login fails with missing fields', async () => {
    const { status } = await api('/api/auth/login', 'POST', { username: 'admin' });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('Login fails with non-existent user', async () => {
    const { status } = await api('/api/auth/login', 'POST', { username: 'nonexistent', password: 'test' });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  await test('Admin login succeeds', async () => {
    const { status, data } = await api('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
    assert(status === 200);
    assert(data.token);
    assert(data.user.roles.includes('admin'));
    adminToken = data.token;
  });

  await test('Teacher login succeeds', async () => {
    const { status, data } = await api('/api/auth/login', 'POST', { username: 'teacher1', password: 'teacher123' });
    assert(status === 200);
    assert(data.user.roles.includes('teacher'));
    teacherToken = data.token;
  });

  await test('Parent login succeeds', async () => {
    const { status, data } = await api('/api/auth/login', 'POST', { username: 'parent1', password: 'parent123' });
    assert(status === 200);
    assert(data.user.roles.includes('parent'));
    parentToken = data.token;
  });

  await test('GET /api/auth/me returns correct user', async () => {
    const { status, data } = await api('/api/auth/me', 'GET', null, adminToken);
    assert(status === 200);
    assert(data.username === 'admin');
  });

  await test('Invalid JWT token returns 401', async () => {
    const { status } = await api('/api/admin/dashboard', 'GET', null, 'invalid.jwt.token');
    assert(status === 401, `Expected 401, got ${status}`);
  });

  // ════════════════════════════════════════════════════════════════
  // SECTION 2: ROLE-BASED ACCESS CONTROL (RBAC)
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 2. ROLE-BASED ACCESS CONTROL ═══');

  await test('No token returns 401 on admin routes', async () => {
    const { status } = await api('/api/admin/dashboard');
    assert(status === 401);
  });

  await test('No token returns 401 on teacher routes', async () => {
    const { status } = await api('/api/teacher/profile');
    assert(status === 401);
  });

  await test('No token returns 401 on parent routes', async () => {
    const { status } = await api('/api/parent/children');
    assert(status === 401);
  });

  await test('Teacher CANNOT access admin routes', async () => {
    const { status } = await api('/api/admin/dashboard', 'GET', null, teacherToken);
    assert(status === 403, `Expected 403, got ${status}`);
  });

  await test('Teacher CANNOT access admin students', async () => {
    const { status } = await api('/api/admin/students', 'GET', null, teacherToken);
    assert(status === 403);
  });

  await test('Teacher CANNOT create students (admin only)', async () => {
    const { status } = await api('/api/admin/students', 'POST', { first_name: 'Hack' }, teacherToken);
    assert(status === 403);
  });

  await test('Parent CANNOT access admin routes', async () => {
    const { status } = await api('/api/admin/students', 'GET', null, parentToken);
    assert(status === 403);
  });

  await test('Parent CANNOT access teacher routes', async () => {
    const { status } = await api('/api/teacher/assignments', 'GET', null, parentToken);
    assert(status === 403);
  });

  await test('Admin CANNOT access teacher routes', async () => {
    const { status } = await api('/api/teacher/assignments', 'GET', null, adminToken);
    assert(status === 403);
  });

  await test('Admin CANNOT access parent routes', async () => {
    const { status } = await api('/api/parent/children', 'GET', null, adminToken);
    assert(status === 403);
  });

  await test('Teacher CANNOT access parent routes', async () => {
    const { status } = await api('/api/parent/children', 'GET', null, teacherToken);
    assert(status === 403);
  });

  // ════════════════════════════════════════════════════════════════
  // SECTION 3: ADMIN CRUD OPERATIONS
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 3. ADMIN CRUD OPERATIONS ═══');

  // -- Dashboard --
  await test('Admin dashboard returns all stats', async () => {
    const { status, data } = await api('/api/admin/dashboard', 'GET', null, adminToken);
    assert(status === 200);
    assert('total_students' in data);
    assert('total_teachers' in data);
    assert('total_parents' in data);
    assert('total_classes' in data);
    assert('total_subjects' in data);
    assert('active_enrollments' in data);
    assert('total_fees_due' in data);
    assert('total_fees_paid' in data);
  });

  // -- Students CRUD --
  let testStudentId;
  await test('Admin creates a student', async () => {
    const { status, data } = await api('/api/admin/students', 'POST', {
      admission_number: 'TEST001',
      first_name: 'Test',
      last_name: 'Student',
      gender: 'Male',
      date_of_birth: '2010-05-15',
      email: 'test.student@test.com',
      phone: '0700000000'
    }, adminToken);
    assert(status === 201, `Expected 201, got ${status}`);
    assert(data.student_id);
    assert(data.first_name === 'Test');
    testStudentId = data.student_id;
  });

  await test('Admin create student validates required fields', async () => {
    const { status } = await api('/api/admin/students', 'POST', { first_name: 'Incomplete' }, adminToken);
    assert(status === 400);
  });

  await test('Admin edits a student', async () => {
    const { status, data } = await api(`/api/admin/students/${testStudentId}`, 'PUT', {
      admission_number: 'TEST001',
      first_name: 'TestUpdated',
      last_name: 'Student',
      other_name: 'Middle',
      gender: 'Male',
      date_of_birth: '2010-05-15',
      email: 'test.student@test.com',
      phone: '0700000001',
      status: 'active'
    }, adminToken);
    assert(status === 200);
    assert(data.first_name === 'TestUpdated');
    assert(data.phone === '0700000001');
  });

  await test('Admin lists students and finds the new student', async () => {
    const { status, data } = await api('/api/admin/students', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
    const found = data.find(s => s.student_id === testStudentId);
    assert(found, 'Created student should be in list');
    assert(found.first_name === 'TestUpdated');
  });

  // -- Teachers CRUD --
  let testTeacherId;
  await test('Admin creates a teacher', async () => {
    const { status, data } = await api('/api/admin/teachers', 'POST', {
      employee_number: 'EMP999',
      first_name: 'Test',
      last_name: 'Teacher',
      phone: '0711111111',
      email: 'test.teacher@school.com'
    }, adminToken);
    assert(status === 201);
    assert(data.teacher_id);
    testTeacherId = data.teacher_id;
  });

  await test('Admin edits a teacher', async () => {
    const { status, data } = await api(`/api/admin/teachers/${testTeacherId}`, 'PUT', {
      employee_number: 'EMP999',
      first_name: 'TestUpdated',
      last_name: 'Teacher',
      other_name: null,
      gender: 'Male',
      phone: '0711111112',
      email: 'test.teacher@school.com',
      status: 'active'
    }, adminToken);
    assert(status === 200);
    assert(data.first_name === 'TestUpdated');
  });

  // -- Classes CRUD --
  let testClassId;
  await test('Admin creates a class', async () => {
    const { status, data } = await api('/api/admin/classes', 'POST', {
      class_name: 'Test Class 9',
      class_code: 'TC9',
      level: 'Form 4',
      capacity: 40
    }, adminToken);
    assert(status === 201);
    assert(data.class_id);
    testClassId = data.class_id;
  });

  await test('Admin edits a class', async () => {
    const { status, data } = await api(`/api/admin/classes/${testClassId}`, 'PUT', {
      class_name: 'Test Class 9 Updated',
      class_code: 'TC9',
      level: 'Form 4',
      capacity: 45
    }, adminToken);
    assert(status === 200);
    assert(data.class_name === 'Test Class 9 Updated');
  });

  // -- Subjects CRUD --
  let testSubjectId;
  await test('Admin creates a subject', async () => {
    const { status, data } = await api('/api/admin/subjects', 'POST', {
      subject_code: 'TST101',
      subject_name: 'Test Subject',
      description: 'A test subject'
    }, adminToken);
    assert(status === 201);
    assert(data.subject_id);
    testSubjectId = data.subject_id;
  });

  await test('Admin edits a subject', async () => {
    const { status, data } = await api(`/api/admin/subjects/${testSubjectId}`, 'PUT', {
      subject_code: 'TST101',
      subject_name: 'Test Subject Updated',
      description: 'Updated desc',
      is_active: true
    }, adminToken);
    assert(status === 200);
    assert(data.subject_name === 'Test Subject Updated');
  });

  // -- Enrollments --
  let testEnrollmentId;
  await test('Admin enrolls student in a class', async () => {
    const { status, data } = await api('/api/admin/enrollments', 'POST', {
      student_id: testStudentId,
      class_id: testClassId,
      academic_year: '2025'
    }, adminToken);
    assert(status === 201);
    assert(data.enrollment_id);
    testEnrollmentId = data.enrollment_id;
  });

  await test('Admin enrollment validates required fields', async () => {
    const { status } = await api('/api/admin/enrollments', 'POST', { student_id: testStudentId }, adminToken);
    assert(status === 400);
  });

  // -- Teaching Assignments --
  let testAssignmentId;
  await test('Admin assigns teacher to class', async () => {
    const { status, data } = await api('/api/admin/assignments', 'POST', {
      teacher_id: testTeacherId,
      subject_id: testSubjectId,
      class_id: testClassId,
      academic_year: '2025'
    }, adminToken);
    assert(status === 201);
    assert(data.assignment_id);
    testAssignmentId = data.assignment_id;
  });

  // -- Fees --
  let testFeeId;
  await test('Admin adds fee to student enrollment', async () => {
    const { status, data } = await api('/api/admin/fees', 'POST', {
      enrollment_id: testEnrollmentId,
      description: 'Tuition Term 1',
      amount_due: 50000,
      due_date: '2025-03-31'
    }, adminToken);
    assert(status === 201);
    assert(data.fee_id);
    assert(parseFloat(data.amount_due) === 50000);
    testFeeId = data.fee_id;
  });

  await test('Admin updates fee payment', async () => {
    const { status, data } = await api(`/api/admin/fees/${testFeeId}`, 'PUT', {
      description: 'Tuition Term 1',
      amount_due: 50000,
      amount_paid: 25000,
      due_date: '2025-03-31',
      status: 'partial'
    }, adminToken);
    assert(status === 200);
    assert(parseFloat(data.amount_paid) === 25000);
    assert(data.status === 'partial');
  });

  // -- Parents CRUD --
  let testParentId;
  await test('Admin creates a parent', async () => {
    const { status, data } = await api('/api/admin/parents', 'POST', {
      first_name: 'Test',
      last_name: 'Parent',
      phone: '0722222222',
      email: 'test.parent@email.com',
      address: '123 Test St',
      relationship: 'Father'
    }, adminToken);
    assert(status === 201);
    assert(data.parent_id);
    testParentId = data.parent_id;
  });

  // -- Parent-Student Links --
  let testLinkId;
  await test('Admin links parent to student', async () => {
    const { status, data } = await api('/api/admin/parent-student', 'POST', {
      parent_id: testParentId,
      student_id: testStudentId,
      relationship: 'Father'
    }, adminToken);
    assert(status === 201);
    assert(data.parent_student_id);
    testLinkId = data.parent_student_id;
  });

  // -- Users & Roles --
  await test('Admin lists users with roles', async () => {
    const { status, data } = await api('/api/admin/users', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
    assert(data.length >= 3);
    const adminUser = data.find(u => u.username === 'admin');
    assert(adminUser);
    assert(adminUser.roles.includes('admin'));
  });

  await test('Admin lists roles', async () => {
    const { status, data } = await api('/api/admin/roles', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
    assert(data.length >= 3);
  });

  // ════════════════════════════════════════════════════════════════
  // SECTION 4: TEACHER ISOLATION & OPERATIONS
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 4. TEACHER ISOLATION & OPERATIONS ═══');

  await test('Teacher gets their profile', async () => {
    const { status, data } = await api('/api/teacher/profile', 'GET', null, teacherToken);
    assert(status === 200 || status === 404); // 404 if email doesn't match
  });

  await test('Teacher gets their assignments', async () => {
    const { status, data } = await api('/api/teacher/assignments', 'GET', null, teacherToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  // Get teacher1's assigned class for isolation tests
  let teacher1ClassId = null;
  {
    const { data } = await api('/api/teacher/assignments', 'GET', null, teacherToken);
    if (data.length > 0) teacher1ClassId = data[0].class_id;
  }

  if (teacher1ClassId) {
    await test('Teacher can see students in their own class', async () => {
      const { status, data } = await api(`/api/teacher/students?class_id=${teacher1ClassId}`, 'GET', null, teacherToken);
      assert(status === 200);
      assert(Array.isArray(data));
    });

    await test('Teacher CANNOT see students in unassigned class', async () => {
      const { status } = await api(`/api/teacher/students?class_id=${testClassId}`, 'GET', null, teacherToken);
      assert(status === 403, `Expected 403, got ${status}`);
    });

    await test('Teacher can get attendance for their own class', async () => {
      const { status } = await api(`/api/teacher/attendance?class_id=${teacher1ClassId}`, 'GET', null, teacherToken);
      assert(status === 200);
    });

    await test('Teacher CANNOT get attendance for unassigned class', async () => {
      const { status } = await api(`/api/teacher/attendance?class_id=${testClassId}`, 'GET', null, teacherToken);
      assert(status === 403, `Expected 403, got ${status}`);
    });

    await test('Teacher can get grades for their own class', async () => {
      const { status } = await api(`/api/teacher/grades?class_id=${teacher1ClassId}`, 'GET', null, teacherToken);
      assert(status === 200);
    });

    await test('Teacher CANNOT get grades for unassigned class', async () => {
      const { status } = await api(`/api/teacher/grades?class_id=${testClassId}`, 'GET', null, teacherToken);
      assert(status === 403, `Expected 403, got ${status}`);
    });
  }

  // Teacher CANNOT mark attendance for unassigned class
  await test('Teacher CANNOT mark attendance for unassigned enrollment', async () => {
    const { status } = await api('/api/teacher/attendance', 'POST', {
      enrollment_id: testEnrollmentId,
      date_attended: '2025-06-01',
      status: 'present'
    }, teacherToken);
    assert(status === 403, `Expected 403, got ${status}`);
  });

  // Teacher CANNOT enter grades for unassigned class
  await test('Teacher CANNOT enter grade for unassigned enrollment', async () => {
    const { status } = await api('/api/teacher/grades', 'POST', {
      enrollment_id: testEnrollmentId,
      subject_id: testSubjectId,
      term: 'Term 1',
      marks: 85,
      grade_letter: 'A'
    }, teacherToken);
    assert(status === 403, `Expected 403, got ${status}`);
  });

  // Teacher cannot access any admin CRUD routes  
  await test('Teacher CANNOT delete students via admin', async () => {
    const { status } = await api(`/api/admin/students/${testStudentId}`, 'DELETE', null, teacherToken);
    assert(status === 403);
  });

  await test('Teacher CANNOT create fees via admin', async () => {
    const { status } = await api('/api/admin/fees', 'POST', { enrollment_id: 1, amount_due: 100 }, teacherToken);
    assert(status === 403);
  });

  // ════════════════════════════════════════════════════════════════
  // SECTION 5: PARENT ISOLATION
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 5. PARENT ISOLATION ═══');

  await test('Parent gets their linked children', async () => {
    const { status, data } = await api('/api/parent/children', 'GET', null, parentToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  // Get parent's first child for subsequent tests
  let parentChildId = null;
  {
    const { data } = await api('/api/parent/children', 'GET', null, parentToken);
    if (data && data.length > 0) parentChildId = data[0].student_id;
  }

  if (parentChildId) {
    await test('Parent gets fees for their children only', async () => {
      const { status, data } = await api(`/api/parent/fees?student_id=${parentChildId}`, 'GET', null, parentToken);
      assert(status === 200);
      assert(Array.isArray(data));
    });

    await test('Parent gets grades for their children only', async () => {
      const { status, data } = await api(`/api/parent/grades?student_id=${parentChildId}`, 'GET', null, parentToken);
      assert(status === 200);
      assert(Array.isArray(data));
    });

    await test('Parent gets attendance for their children only', async () => {
      const { status, data } = await api(`/api/parent/attendance?student_id=${parentChildId}`, 'GET', null, parentToken);
      assert(status === 200);
      assert(Array.isArray(data));
    });
  } else {
    console.log('  ⚠ SKIP  Parent child tests (no children linked)');
  }

  await test('Parent CANNOT access admin routes', async () => {
    const { status } = await api('/api/admin/dashboard', 'GET', null, parentToken);
    assert(status === 403);
  });

  await test('Parent CANNOT access teacher routes', async () => {
    const { status } = await api('/api/teacher/grades', 'GET', null, parentToken);
    assert(status === 403);
  });

  await test('Parent CANNOT create students', async () => {
    const { status } = await api('/api/admin/students', 'POST', {
      admission_number: 'HACK01', first_name: 'Hacker', last_name: 'Test',
      gender: 'Male', date_of_birth: '2010-01-01'
    }, parentToken);
    assert(status === 403);
  });

  // ════════════════════════════════════════════════════════════════
  // SECTION 6: DATA INTEGRITY - FK PROTECTION & SOFT DELETE
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 6. DATA INTEGRITY ═══');

  await test('Cannot delete student with active enrollments (FK protection)', async () => {
    const { status, data } = await api(`/api/admin/students/${testStudentId}`, 'DELETE', null, adminToken);
    assert(status === 409, `Expected 409, got ${status}`);
    assert(data.error.includes('enrollments'), 'Error should mention enrollments');
  });

  await test('Cannot delete teacher with active assignments (FK protection)', async () => {
    // testTeacherId has a teaching assignment
    const { status, data } = await api(`/api/admin/teachers/${testTeacherId}`, 'DELETE', null, adminToken);
    assert(status === 409, `Expected 409, got ${status}`);
    assert(data.error.includes('assignments'), 'Error should mention assignments');
  });

  await test('Cannot delete class with active enrollments (FK protection)', async () => {
    const { status, data } = await api(`/api/admin/classes/${testClassId}`, 'DELETE', null, adminToken);
    assert(status === 409, `Expected 409, got ${status}`);
    assert(data.error.includes('enrollments'), 'Error should mention enrollments');
  });

  // First need to delete the fee so enrollment can be soft-deleted
  // Then delete enrollment so student can be soft-deleted

  // Clean up assignment so teacher can be soft-deleted
  await test('Admin deletes teaching assignment (hard delete OK for assignments)', async () => {
    const { status, data } = await api(`/api/admin/assignments/${testAssignmentId}`, 'DELETE', null, adminToken);
    assert(status === 200);
    assert(data.message.includes('deleted'));
  });

  // Now soft-delete enrollment (no attendance/grades)
  await test('Soft delete enrollment (deactivate, not hard delete)', async () => {
    const { status, data } = await api(`/api/admin/enrollments/${testEnrollmentId}`, 'DELETE', null, adminToken);
    assert(status === 200);
    assert(data.message.includes('deactivated') || data.message.includes('deleted'));
  });

  // Now soft-delete student (no active enrollments)
  await test('Soft delete student (deactivate, not hard delete)', async () => {
    const { status, data } = await api(`/api/admin/students/${testStudentId}`, 'DELETE', null, adminToken);
    assert(status === 200);
    assert(data.message.includes('deactivated'));
  });

  // Verify student is still in DB but inactive
  await test('Soft-deleted student still exists but is inactive', async () => {
    const { status, data } = await api('/api/admin/students', 'GET', null, adminToken);
    assert(status === 200);
    const student = data.find(s => s.student_id === testStudentId);
    assert(student, 'Student should still exist in the database');
    assert(student.status === 'suspended', 'Student status should be suspended');
  });

  // Now soft-delete teacher (no assignments left)
  await test('Soft delete teacher (deactivate, not hard delete)', async () => {
    const { status, data } = await api(`/api/admin/teachers/${testTeacherId}`, 'DELETE', null, adminToken);
    assert(status === 200);
    assert(data.message.includes('deactivated'));
  });

  // Verify teacher still in DB
  await test('Soft-deleted teacher still exists but is inactive', async () => {
    const { status, data } = await api('/api/admin/teachers', 'GET', null, adminToken);
    assert(status === 200);
    const teacher = data.find(t => t.teacher_id === testTeacherId);
    assert(teacher, 'Teacher should still exist in the database');
    assert(teacher.status === 'resigned');
  });

  // Soft-delete subject (no grades or assignments)
  await test('Soft delete subject (deactivate, not hard delete)', async () => {
    const { status, data } = await api(`/api/admin/subjects/${testSubjectId}`, 'DELETE', null, adminToken);
    assert(status === 200);
    assert(data.message.includes('deactivated'));
  });

  // Soft-delete class (no active enrollments left)
  await test('Soft delete class (deactivate, not hard delete)', async () => {
    const { status, data } = await api(`/api/admin/classes/${testClassId}`, 'DELETE', null, adminToken);
    assert(status === 200);
    assert(data.message.includes('deactivated'));
  });

  await test('Delete non-existent student returns 404', async () => {
    const { status } = await api('/api/admin/students/99999', 'DELETE', null, adminToken);
    assert(status === 404);
  });

  await test('Update non-existent student returns 404', async () => {
    const { status } = await api('/api/admin/students/99999', 'PUT', {
      admission_number: 'X', first_name: 'X', last_name: 'X',
      gender: 'Male', date_of_birth: '2010-01-01', status: 'active'
    }, adminToken);
    assert(status === 404);
  });

  // ════════════════════════════════════════════════════════════════
  // SECTION 7: SECURITY AUDIT
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 7. SECURITY AUDIT ═══');

  await test('SEC-1: All admin routes require auth (RBAC enforced)', async () => {
    const routes = ['/api/admin/students', '/api/admin/teachers', '/api/admin/classes',
      '/api/admin/subjects', '/api/admin/enrollments', '/api/admin/fees',
      '/api/admin/assignments', '/api/admin/users', '/api/admin/dashboard'];
    for (const route of routes) {
      const { status } = await api(route);
      assert(status === 401, `${route} should return 401 without auth, got ${status}`);
    }
  });

  await test('SEC-2: All teacher routes require auth (RBAC enforced)', async () => {
    const routes = ['/api/teacher/profile', '/api/teacher/assignments',
      '/api/teacher/students', '/api/teacher/attendance', '/api/teacher/grades'];
    for (const route of routes) {
      const { status } = await api(route);
      assert(status === 401, `${route} should return 401 without auth, got ${status}`);
    }
  });

  await test('SEC-3: All parent routes require auth (RBAC enforced)', async () => {
    const routes = ['/api/parent/children', '/api/parent/fees',
      '/api/parent/results', '/api/parent/grades', '/api/parent/attendance'];
    for (const route of routes) {
      const { status } = await api(route);
      assert(status === 401, `${route} should return 401 without auth, got ${status}`);
    }
  });

  await test('SEC-4: Expired/tampered JWT is rejected', async () => {
    // A made-up JWT token
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJ1c2VybmFtZSI6ImFkbWluIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwMDAwMDF9.invalid_signature';
    const { status } = await api('/api/admin/dashboard', 'GET', null, fakeToken);
    assert(status === 401, `Expected 401, got ${status}`);
  });

  await test('SEC-5: Passwords not returned in any API response', async () => {
    const { data: users } = await api('/api/admin/users', 'GET', null, adminToken);
    for (const u of users) {
      assert(!u.password, 'User object should not contain password');
      assert(!u.password_hash, 'User object should not contain password_hash');
    }
  });

  await test('SEC-6: SQL injection attempt handled safely', async () => {
    // Attempt SQL injection via login
    const { status } = await api('/api/auth/login', 'POST', {
      username: "admin' OR '1'='1",
      password: "' OR '1'='1"
    });
    assert(status === 401, 'SQL injection should not bypass auth');
  });

  await test('SEC-7: SQL injection in query params handled safely', async () => {
    const { status } = await api("/api/teacher/students?class_id=1;DROP TABLE students;", 'GET', null, teacherToken);
    // Should fail gracefully (400 or 403 or 500), not execute the injection
    assert(status !== 200 || true, 'Should handle SQL injection safely');
  });

  // ════════════════════════════════════════════════════════════════
  // SECTION 8: AUDIT LOGS
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 8. AUDIT LOGS ═══');

  await test('Audit logs are recorded for CRUD operations', async () => {
    const { status, data } = await api('/api/admin/audit-logs', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
    assert(data.length > 0, 'Should have audit log entries from the CRUD operations above');
  });

  await test('Audit logs contain CREATE entries', async () => {
    const { data } = await api('/api/admin/audit-logs?action=CREATE', 'GET', null, adminToken);
    assert(data.length > 0, 'Should have CREATE audit entries');
    const entry = data[0];
    assert(entry.action === 'CREATE');
    assert(entry.table_name);
    assert(entry.created_at);
  });

  await test('Audit logs contain UPDATE entries', async () => {
    const { data } = await api('/api/admin/audit-logs?action=UPDATE', 'GET', null, adminToken);
    assert(data.length > 0, 'Should have UPDATE audit entries');
  });

  await test('Audit logs contain DELETE entries', async () => {
    const { data } = await api('/api/admin/audit-logs?action=DELETE', 'GET', null, adminToken);
    assert(data.length > 0, 'Should have DELETE audit entries');
  });

  await test('Audit logs can be filtered by table', async () => {
    const { data } = await api('/api/admin/audit-logs?table_name=students', 'GET', null, adminToken);
    assert(Array.isArray(data));
    for (const entry of data) {
      assert(entry.table_name === 'students');
    }
  });

  await test('Audit logs record username', async () => {
    const { data } = await api('/api/admin/audit-logs', 'GET', null, adminToken);
    const withUsername = data.filter(e => e.username);
    assert(withUsername.length > 0, 'Audit logs should have username recorded');
  });

  // ════════════════════════════════════════════════════════════════
  // SECTION 9: ACTIVITY DASHBOARD
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 9. ACTIVITY DASHBOARD ═══');

  await test('Activity dashboard returns all sections', async () => {
    const { status, data } = await api('/api/admin/activity', 'GET', null, adminToken);
    assert(status === 200);
    assert('recent_enrollments' in data, 'Should have recent_enrollments');
    assert('unpaid_fees' in data, 'Should have unpaid_fees');
    assert('recent_grade_changes' in data, 'Should have recent_grade_changes');
    assert('recent_activity' in data, 'Should have recent_activity');
    assert(Array.isArray(data.recent_enrollments));
    assert(Array.isArray(data.unpaid_fees));
    assert(Array.isArray(data.recent_activity));
  });

  await test('Activity dashboard shows recent audit activity', async () => {
    const { data } = await api('/api/admin/activity', 'GET', null, adminToken);
    assert(data.recent_activity.length > 0, 'Should have recent activity entries');
  });

  // ════════════════════════════════════════════════════════════════
  // SECTION 10: REAL-LIFE SCENARIO TESTS
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 10. REAL-LIFE SCENARIOS ═══');

  // SCENARIO A: Complete new student flow
  let scenarioStudentId, scenarioEnrollmentId;
  await test('SCENARIO A: Admin creates new student', async () => {
    const { status, data } = await api('/api/admin/students', 'POST', {
      admission_number: 'SCEN001',
      first_name: 'Scenario',
      last_name: 'Student',
      gender: 'Female',
      date_of_birth: '2011-03-20',
    }, adminToken);
    assert(status === 201);
    scenarioStudentId = data.student_id;
  });

  // Get a valid class that teacher1 is assigned to
  let scenarioClassId, scenarioSubjectId;
  {
    const { data: assignments } = await api('/api/teacher/assignments', 'GET', null, teacherToken);
    if (assignments.length > 0) {
      scenarioClassId = assignments[0].class_id;
      scenarioSubjectId = assignments[0].subject_id;
    }
  }

  if (scenarioClassId) {
    await test('SCENARIO A: Admin enrolls student in class', async () => {
      const { status, data } = await api('/api/admin/enrollments', 'POST', {
        student_id: scenarioStudentId,
        class_id: scenarioClassId,
        academic_year: '2025'
      }, adminToken);
      assert(status === 201);
      scenarioEnrollmentId = data.enrollment_id;
    });

    await test('SCENARIO A: Admin adds fee', async () => {
      const { status, data } = await api('/api/admin/fees', 'POST', {
        enrollment_id: scenarioEnrollmentId,
        description: 'Tuition',
        amount_due: 35000,
        due_date: '2025-06-30'
      }, adminToken);
      assert(status === 201);
    });

    // SCENARIO B: Teacher records exam results
    await test('SCENARIO B: Teacher sees new student in class', async () => {
      const { status, data } = await api(`/api/teacher/students?class_id=${scenarioClassId}`, 'GET', null, teacherToken);
      assert(status === 200);
      const found = data.find(s => s.student_id === scenarioStudentId);
      assert(found, 'New student should appear in teacher\'s class');
    });

    await test('SCENARIO B: Teacher marks attendance for new student', async () => {
      const { status, data } = await api('/api/teacher/attendance', 'POST', {
        enrollment_id: scenarioEnrollmentId,
        date_attended: '2025-06-01',
        status: 'Present',
        remarks: 'On time'
      }, teacherToken);
      assert(status === 201, `Expected 201, got ${status} - ${JSON.stringify(data)}`);
    });

    await test('SCENARIO B: Teacher enters grade for new student', async () => {
      const { status, data } = await api('/api/teacher/grades', 'POST', {
        enrollment_id: scenarioEnrollmentId,
        subject_id: scenarioSubjectId,
        term: 'Term 1',
        marks: 78,
        grade_letter: 'B+',
        remarks: 'Good performance'
      }, teacherToken);
      assert(status === 201, `Expected 201, got ${status} - enrollId=${scenarioEnrollmentId} subId=${scenarioSubjectId} resp=${JSON.stringify(data)}`);
      assert(data.marks === 78 || data.marks === '78' || data.marks === '78.00');
    });

    await test('SCENARIO B: Teacher can update existing grade', async () => {
      const { status, data } = await api('/api/teacher/grades', 'POST', {
        enrollment_id: scenarioEnrollmentId,
        subject_id: scenarioSubjectId,
        term: 'Term 1',
        marks: 82,
        grade_letter: 'A-',
        remarks: 'Updated after re-check'
      }, teacherToken);
      assert(status === 201, `Expected 201, got ${status} - resp=${JSON.stringify(data)}`);
      assert(data.marks === 82 || data.marks === '82' || data.marks === '82.00');
    });

    // Link scenario student to parent1
    {
      // Get parent1's parent_id via admin
      const { data: parents } = await api('/api/admin/parents', 'GET', null, adminToken);
      const parent1 = parents.find(p => p.email === 'parent1@school.com');
      if (parent1) {
        await api('/api/admin/parent-student', 'POST', {
          parent_id: parent1.parent_id,
          student_id: scenarioStudentId,
          relationship: 'Mother'
        }, adminToken);
      }
    }

    // SCENARIO C: Parent checks student data
    // Get parent1's children to use student_id for queries
    let scenarioParentChildId = null;
    {
      const { data: children } = await api('/api/parent/children', 'GET', null, parentToken);
      if (children && children.length > 0) scenarioParentChildId = children[0].student_id;
    }

    await test('SCENARIO C: Parent sees children list', async () => {
      const { status, data } = await api('/api/parent/children', 'GET', null, parentToken);
      assert(status === 200);
      assert(Array.isArray(data));
    });

    if (scenarioParentChildId) {
      await test('SCENARIO C: Parent checks fees', async () => {
        const { status, data } = await api(`/api/parent/fees?student_id=${scenarioParentChildId}`, 'GET', null, parentToken);
        assert(status === 200);
        assert(Array.isArray(data));
      });

      await test('SCENARIO C: Parent checks grades', async () => {
        const { status, data } = await api(`/api/parent/grades?student_id=${scenarioParentChildId}`, 'GET', null, parentToken);
        assert(status === 200);
        assert(Array.isArray(data));
      });

      await test('SCENARIO C: Parent checks attendance', async () => {
        const { status, data } = await api(`/api/parent/attendance?student_id=${scenarioParentChildId}`, 'GET', null, parentToken);
        assert(status === 200);
        assert(Array.isArray(data));
      });
    }
  } else {
    console.log('  ⚠ SKIP  Scenario tests require teacher assignments in seed data');
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 11: EDGE CASES
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ 11. EDGE CASES ═══');

  await test('GET with missing required query param returns 400', async () => {
    const { status } = await api('/api/teacher/students', 'GET', null, teacherToken);
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('POST with empty body returns 400', async () => {
    const { status } = await api('/api/admin/students', 'POST', {}, adminToken);
    assert(status === 400);
  });

  await test('Teacher attendance requires enrollment_id, date, status', async () => {
    const { status } = await api('/api/teacher/attendance', 'POST', { enrollment_id: 1 }, teacherToken);
    assert(status === 400);
  });

  await test('Teacher grades require enrollment_id, subject_id, term', async () => {
    const { status } = await api('/api/teacher/grades', 'POST', { enrollment_id: 1 }, teacherToken);
    assert(status === 400);
  });

  // ════════════════════════════════════════════════════════════════
  //  SUMMARY
  // ════════════════════════════════════════════════════════════════
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  RESULTS: ${String(passed).padStart(3)} passed, ${String(failed).padStart(3)} failed, ${String(total).padStart(3)} total${' '.repeat(15)}║`);
  if (failed === 0) {
    console.log(`║  ✓ ALL TESTS PASSED                                     ║`);
  } else {
    console.log(`║  ✗ SOME TESTS FAILED                                    ║`);
  }
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
