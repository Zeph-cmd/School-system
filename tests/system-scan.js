/*
  System scan for current role workflows and constraints.
  Run with server active on localhost:3000
*/

const BASE = process.env.BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;
const failures = [];

async function api(path, method = 'GET', body = null, token = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

async function step(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, error: err.message });
    console.log(`FAIL  ${name} -> ${err.message}`);
  }
}

async function run() {
  console.log('=== SYSTEM SCAN START ===');

  let adminToken = null;
  let teacherToken = null;
  let parentToken = null;

  let adminUserId = null;
  let teacherUserId = null;
  let teacherLoginEmail = null;
  let parentLoginEmail = null;

  let teacherAssignments = [];
  let selectedClassId = null;
  let selectedSubjectId = null;
  let selectedEnrollmentId = null;
  let selectedStudentId = null;
  let selectedParentRecipient = null;

  await step('Health check', async () => {
    const r = await api('/api/health');
    ok(r.status === 200, `Expected 200, got ${r.status}`);
    ok(r.data && r.data.status === 'ok', 'Health payload invalid');
  });

  await step('Admin login works (password)', async () => {
    const r = await api('/api/auth/login', 'POST', {
      username: 'admin',
      role: 'admin',
      password: 'admin123',
    });
    ok(r.status === 200, `Expected 200, got ${r.status}`);
    ok(r.data && r.data.token, 'Missing admin token');
    adminToken = r.data.token;
    adminUserId = r.data.user.user_id;
  });

  await step('Discover current teacher/parent emails', async () => {
    const users = await api('/api/admin/users', 'GET', null, adminToken);
    ok(users.status === 200, `Expected 200, got ${users.status}`);
    const teacher = users.data.find((u) => u.username === 'teacher1');
    const parent = users.data.find((u) => u.username === 'parent1');
    ok(teacher && teacher.email, 'teacher1 or teacher1 email missing');
    ok(parent && parent.email, 'parent1 or parent1 email missing');
    teacherLoginEmail = teacher.email;
    parentLoginEmail = parent.email;
  });

  await step('Teacher login works (email only)', async () => {
    const r = await api('/api/auth/login', 'POST', {
      username: 'teacher1',
      role: 'teacher',
      email: teacherLoginEmail,
    });
    ok(r.status === 200, `Expected 200, got ${r.status}`);
    teacherToken = r.data.token;
    teacherUserId = r.data.user.user_id;
  });

  await step('Parent login works (email only)', async () => {
    const r = await api('/api/auth/login', 'POST', {
      username: 'parent1',
      role: 'parent',
      email: parentLoginEmail,
    });
    ok(r.status === 200, `Expected 200, got ${r.status}`);
    parentToken = r.data.token;
  });

  await step('Teacher wrong email login is rejected', async () => {
    const r = await api('/api/auth/login', 'POST', {
      username: 'teacher1',
      role: 'teacher',
      email: 'wrong@school.com',
    });
    ok(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await step('RBAC: teacher cannot access admin dashboard', async () => {
    const r = await api('/api/admin/dashboard', 'GET', null, teacherToken);
    ok(r.status === 403, `Expected 403, got ${r.status}`);
  });

  await step('RBAC: parent cannot access teacher assignments', async () => {
    const r = await api('/api/teacher/assignments', 'GET', null, parentToken);
    ok(r.status === 403, `Expected 403, got ${r.status}`);
  });

  // Admin panel tables (read)
  const adminReadEndpoints = [
    '/api/admin/dashboard',
    '/api/admin/students',
    '/api/admin/teachers',
    '/api/admin/parents',
    '/api/admin/classes',
    '/api/admin/subjects',
    '/api/admin/enrollments',
    '/api/admin/fees',
    '/api/admin/assignments',
    '/api/admin/users',
    '/api/admin/roles',
    '/api/admin/parent-student',
    '/api/admin/homework',
    '/api/admin/pending-registrations',
    '/api/admin/pending-grade-changes',
    '/api/admin/notifications',
    '/api/admin/messages',
    '/api/admin/parent-users',
  ];

  for (const ep of adminReadEndpoints) {
    await step(`Admin table endpoint ${ep}`, async () => {
      const r = await api(ep, 'GET', null, adminToken);
      ok(r.status === 200, `Expected 200, got ${r.status}`);
    });
  }

  await step('Admin student record endpoint works', async () => {
    const r = await api('/api/admin/students', 'GET', null, adminToken);
    ok(Array.isArray(r.data) && r.data.length > 0, 'No students found for record test');
    const s = r.data[0];
    const rec = await api(`/api/admin/student-record?student_id=${s.student_id}`, 'GET', null, adminToken);
    ok(rec.status === 200, `Expected 200, got ${rec.status}`);
    ok(rec.data.started_class !== undefined, 'started_class missing');
    ok(rec.data.started_academic_year !== undefined, 'started_academic_year missing');
  });

  await step('Admin recovery email update enforces current password', async () => {
    const noPw = await api('/api/admin/recovery-email', 'PUT', { email: 'admin@school.com' }, adminToken);
    ok(noPw.status === 400, `Expected 400, got ${noPw.status}`);

    const badPw = await api('/api/admin/recovery-email', 'PUT', {
      email: 'admin@school.com',
      current_password: 'wrong',
    }, adminToken);
    ok(badPw.status === 401, `Expected 401, got ${badPw.status}`);
  });

  await step('Teacher assignments and class selection', async () => {
    const r = await api('/api/teacher/assignments', 'GET', null, teacherToken);
    ok(r.status === 200, `Expected 200, got ${r.status}`);
    ok(Array.isArray(r.data) && r.data.length > 0, 'Teacher has no assignments');
    teacherAssignments = r.data;
    selectedClassId = r.data[0].class_id;
    selectedSubjectId = r.data[0].subject_id;
  });

  await step('Teacher students endpoint returns parent contacts', async () => {
    const r = await api(`/api/teacher/students?class_id=${selectedClassId}`, 'GET', null, teacherToken);
    ok(r.status === 200, `Expected 200, got ${r.status}`);
    ok(Array.isArray(r.data), 'Students payload not array');
    if (r.data.length > 0) {
      selectedEnrollmentId = r.data[0].enrollment_id;
      selectedStudentId = r.data[0].student_id;
      ok(Object.prototype.hasOwnProperty.call(r.data[0], 'parent_contacts'), 'parent_contacts not present');
    }
  });

  await step('Teacher can only list allowed parent recipients', async () => {
    const r = await api('/api/teacher/messages/parents', 'GET', null, teacherToken);
    ok(r.status === 200, `Expected 200, got ${r.status}`);
    ok(Array.isArray(r.data), 'Recipients payload not array');
    ok(r.data.length > 0, 'No parent recipients available for teacher');

    selectedParentRecipient = r.data.find((x) => x.username === 'parent1') || r.data[0];
  });

  await step('Teacher cannot message admin user', async () => {
    const users = await api('/api/admin/users', 'GET', null, adminToken);
    const adminUser = users.data.find((u) => u.username === 'admin');
    ok(adminUser, 'Admin user not found');
    const r = await api('/api/teacher/messages/private', 'POST', {
      recipient_id: adminUser.user_id,
      subject: 'Should fail',
      body: 'Teacher to admin should be forbidden',
    }, teacherToken);
    ok(r.status === 403, `Expected 403, got ${r.status}`);
  });

  let sentMessageId = null;
  await step('Teacher can send message to allowed parent', async () => {
    const r = await api('/api/teacher/messages/private', 'POST', {
      recipient_id: selectedParentRecipient.user_id,
      subject: 'Class Progress',
      body: 'This is a secure teacher-to-parent message.',
    }, teacherToken);
    ok(r.status === 201, `Expected 201, got ${r.status}`);
    sentMessageId = r.data.message_id;
  });

  await step('Teacher messages list includes sent message', async () => {
    const r = await api('/api/teacher/messages', 'GET', null, teacherToken);
    ok(r.status === 200, `Expected 200, got ${r.status}`);
    ok(Array.isArray(r.data), 'Messages payload not array');
    ok(r.data.some((m) => m.message_id === sentMessageId), 'Sent message missing from teacher list');
  });

  await step('Parent receives teacher private message', async () => {
    const parentLogin = await api('/api/auth/login', 'POST', {
      username: selectedParentRecipient.username,
      role: 'parent',
      email: selectedParentRecipient.email,
    });
    ok(parentLogin.status === 200, `Recipient parent login failed: ${parentLogin.status}`);
    const recipientToken = parentLogin.data.token;

    const inbox = await api('/api/parent/messages', 'GET', null, recipientToken);
    ok(inbox.status === 200, `Expected 200, got ${inbox.status}`);
    ok(Array.isArray(inbox.data), 'Parent inbox not array');
    ok(inbox.data.some((m) => m.message_id === sentMessageId), 'Parent inbox missing teacher message');
  });

  await step('Parent can reply and teacher can read conversation', async () => {
    const parentLogin = await api('/api/auth/login', 'POST', {
      username: selectedParentRecipient.username,
      role: 'parent',
      email: selectedParentRecipient.email,
    });
    const recipientToken = parentLogin.data.token;

    const reply = await api(`/api/parent/messages/${sentMessageId}/reply`, 'POST', {
      body: 'Thanks teacher, noted.',
    }, recipientToken);
    ok(reply.status === 201, `Expected 201, got ${reply.status}`);

    const conv = await api(`/api/teacher/messages/${sentMessageId}/conversation`, 'GET', null, teacherToken);
    ok(conv.status === 200, `Expected 200, got ${conv.status}`);
    ok(Array.isArray(conv.data) && conv.data.length >= 2, 'Conversation should include reply');
  });

  await step('Parent panel data endpoints work', async () => {
    const children = await api('/api/parent/children', 'GET', null, parentToken);
    ok(children.status === 200, `children status ${children.status}`);
    const firstChild = children.data[0];
    ok(firstChild, 'No child for parent1');

    const grades = await api(`/api/parent/grades?student_id=${firstChild.student_id}`, 'GET', null, parentToken);
    const fees = await api(`/api/parent/fees?student_id=${firstChild.student_id}`, 'GET', null, parentToken);
    const attendance = await api(`/api/parent/attendance?student_id=${firstChild.student_id}`, 'GET', null, parentToken);
    const hw = await api(`/api/parent/homework?student_id=${firstChild.student_id}`, 'GET', null, parentToken);
    const contacts = await api('/api/parent/contact-teachers', 'GET', null, parentToken);

    ok(grades.status === 200, `grades status ${grades.status}`);
    ok(fees.status === 200, `fees status ${fees.status}`);
    ok(attendance.status === 200, `attendance status ${attendance.status}`);
    ok(hw.status === 200, `homework status ${hw.status}`);
    ok(contacts.status === 200, `contacts status ${contacts.status}`);

    if (contacts.data.length > 0) {
      ok(Object.prototype.hasOwnProperty.call(contacts.data[0], 'phone'), 'teacher phone missing in contacts');
    }
  });

  await step('Admin edit reflects in parent contact teacher phone', async () => {
    const teachers = await api('/api/admin/teachers', 'GET', null, adminToken);
    const t1 = teachers.data.find((t) => String(t.email || '').toLowerCase() === String(teacherLoginEmail || '').toLowerCase());
    ok(t1, 'teacher1 profile not found');

    const newPhone = '0790011223';
    const upd = await api(`/api/admin/teachers/${t1.teacher_id}`, 'PUT', {
      employee_number: t1.employee_number,
      first_name: t1.first_name,
      last_name: t1.last_name,
      other_name: t1.other_name || null,
      gender: t1.gender || null,
      phone: newPhone,
      email: t1.email,
      status: t1.status || 'active',
    }, adminToken);
    ok(upd.status === 200, `Update teacher status ${upd.status}`);

    const contacts = await api('/api/parent/contact-teachers', 'GET', null, parentToken);
    ok(contacts.status === 200, `contacts status ${contacts.status}`);
    const c = contacts.data.find((x) => String(x.email || '').toLowerCase() === String(teacherLoginEmail || '').toLowerCase());
    ok(c, 'teacher1 not found in parent contacts');
    ok(String(c.phone || '') === newPhone, `Expected ${newPhone}, got ${c.phone}`);
  });

  await step('Constraint: duplicate parent-student link blocked', async () => {
    const links = await api('/api/admin/parent-student', 'GET', null, adminToken);
    ok(Array.isArray(links.data) && links.data.length > 0, 'No parent-student links to test');
    const one = links.data[0];
    const dup = await api('/api/admin/parent-student', 'POST', {
      parent_id: one.parent_id,
      student_id: one.student_id,
      relationship: one.relationship || 'Guardian',
    }, adminToken);
    ok(dup.status === 409, `Expected 409, got ${dup.status}`);
  });

  await step('Grade approval gate: parent does not see grade before admin approves', async () => {
    ok(selectedEnrollmentId && selectedSubjectId && selectedStudentId, 'Missing class/student/subject context');

    const unlock = await api('/api/admin/grade-edit-status', 'PUT', { enabled: true }, adminToken);
    ok(unlock.status === 200, `Unlock grade edit failed: ${unlock.status}`);

    const term = `T${String(Date.now()).slice(-8)}`;
    const before = await api(`/api/parent/grades?student_id=${selectedStudentId}`, 'GET', null, parentToken);
    ok(before.status === 200, `before grades status ${before.status}`);
    const beforeCount = before.data.length;

    const submit = await api('/api/teacher/grades', 'POST', {
      enrollment_id: selectedEnrollmentId,
      subject_id: selectedSubjectId,
      term,
      marks: 77,
      grade_letter: 'B+',
      remarks: 'scan approval flow',
    }, teacherToken);
    ok(submit.status === 201, `submit grade status ${submit.status}`);

    const pending = await api('/api/admin/pending-grade-changes', 'GET', null, adminToken);
    ok(pending.status === 200, `pending grade status ${pending.status}`);
    const reqItem = pending.data.find((x) => x.term === term && x.enrollment_id === selectedEnrollmentId);
    ok(reqItem, 'Pending grade request not found');

    const middle = await api(`/api/parent/grades?student_id=${selectedStudentId}`, 'GET', null, parentToken);
    ok(middle.status === 200, `middle grades status ${middle.status}`);
    ok(middle.data.length === beforeCount, 'Parent grade count changed before approval');

    const appr = await api(`/api/admin/pending-grade-changes/${reqItem.request_id}/approve`, 'PUT', {}, adminToken);
    ok(appr.status === 200, `approve status ${appr.status}`);

    const after = await api(`/api/parent/grades?student_id=${selectedStudentId}`, 'GET', null, parentToken);
    ok(after.status === 200, `after grades status ${after.status}`);
    ok(after.data.length >= beforeCount + 1, 'Approved grade not visible to parent');

    const relock = await api('/api/admin/grade-edit-status', 'PUT', { enabled: false }, adminToken);
    ok(relock.status === 200, `Relock grade edit failed: ${relock.status}`);
  });

  await step('Forgot credentials attempts are logged in audit', async () => {
    const teachers = await api('/api/admin/teachers', 'GET', null, adminToken);
    ok(teachers.status === 200 && teachers.data.length > 0, 'No teachers found for forgot-credentials test');
    const t = teachers.data[0];
    const fc = await api('/api/auth/forgot-credentials', 'POST', {
      role: 'teacher',
      first_name: t.first_name,
      last_name: t.last_name,
      employee_number: t.employee_number,
    });
    ok(fc.status === 200 || fc.status === 404, `Unexpected forgot-credentials status ${fc.status}`);

    const logs = await api('/api/admin/audit-logs?limit=50', 'GET', null, adminToken);
    ok(logs.status === 200, `audit logs status ${logs.status}`);
    ok(Array.isArray(logs.data), 'audit logs payload invalid');
    const found = logs.data.some((l) => String(l.action || '').toUpperCase() === 'FORGOT_CREDENTIALS_ATTEMPT');
    ok(found, 'FORGOT_CREDENTIALS_ATTEMPT not found in audit logs');
  });

  console.log('\n=== SYSTEM SCAN COMPLETE ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f, i) => console.log(`${i + 1}. ${f.name} -> ${f.error}`));
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
