/**
 * Runtime verification of:
 *  1. Admin tuition edit (PUT /api/admin/fees/:id) + per-student tuition breakdown
 *  2. Notification badges endpoints for admin, teacher, parent
 */
const BASE = 'http://localhost:3000';
const UA = 'FreeSchoolManagementApp/1.0';

async function login(payload) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(`Login failed: ${JSON.stringify(data)}`);
  return { token: data.token, user: data.user };
}

async function api(path, token, method = 'GET', body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

(async () => {
  let allPassed = true;

  function check(name, cond, detail) {
    if (!cond) allPassed = false;
    console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${detail ? ' :: ' + detail : ''}`);
  }

  try {
    // ---------- ADMIN ----------
    console.log('\n=== ADMIN PANEL ===');
    const admin = await login({ username: 'admin', password: 'Admin@2026!', role: 'admin' });
    check('Admin login', admin.token);

    const notif = await api('/api/admin/notifications', admin.token);
    check('GET /api/admin/notifications returns pending_total', notif.status === 200 && typeof notif.data?.pending_total === 'number', JSON.stringify(notif.data));
    check('GET /api/admin/notifications returns unread_private_messages', typeof notif.data?.unread_private_messages === 'number', JSON.stringify(notif.data));

    const students = await api('/api/admin/students', admin.token);
    check('GET /api/admin/students', students.status === 200 && Array.isArray(students.data));
    const student = students.data?.[0];
    const studentId = student?.student_id;
    check('At least one student exists', !!studentId, String(studentId));

    if (studentId) {
      const breakdown = await api(`/api/admin/students/${studentId}/tuition`, admin.token);
      check(`GET /api/admin/students/${studentId}/tuition`, breakdown.status === 200 && Array.isArray(breakdown.data?.rows), `rows=${breakdown.data?.rows?.length || 0}`);

      // Create a fee if none exist to test editing
      let feeRow = breakdown.data?.rows?.[0];
      if (!feeRow) {
        console.log('  No fee rows found - creating one to test edit...');
        const createPayload = {
          description: 'Verification test fee',
          amount_due: 100.00,
          term: 'Term 1',
          fee_type: 'general',
          due_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        };
        // Prefer admission_number if present
        if (student.admission_number) createPayload.admission_number = student.admission_number;
        else createPayload.enrollment_id = student.enrollment_id || studentId;

        const createRes = await api('/api/admin/fees', admin.token, 'POST', createPayload);
        check('Create test fee for edit verification', createRes.status === 200 && !createRes.data?.error, JSON.stringify(createRes.data));
        const rebreakdown = await api(`/api/admin/students/${studentId}/tuition`, admin.token);
        feeRow = rebreakdown.data?.rows?.[0];
      }

      if (feeRow) {
        const feeId = feeRow.fee_id;
        const originalPaid = parseFloat(feeRow.amount_paid || 0);
        const testPaid = (originalPaid === 1.23) ? 4.56 : 1.23;

        const upd = await api(`/api/admin/fees/${feeId}`, admin.token, 'PUT', {
          description: feeRow.description || 'Test tuition',
          amount_due: feeRow.amount_due,
          amount_paid: String(testPaid),
          due_date: feeRow.due_date ? String(feeRow.due_date).split('T')[0] : '',
          status: '',
        });
        check(`PUT /api/admin/fees/${feeId} (update amount_paid -> ${testPaid})`, upd.status === 200 && !upd.data?.error, JSON.stringify(upd.data));

        const recheck = await api(`/api/admin/students/${studentId}/tuition`, admin.token);
        const updatedRow = recheck.data?.rows?.find(r => Number(r.fee_id) === Number(feeId));
        check(`Tuition edit persisted (amount_paid = ${testPaid})`, updatedRow && Math.abs(parseFloat(updatedRow.amount_paid) - testPaid) < 0.001, `got ${updatedRow?.amount_paid}`);

        const expectedStatus = testPaid <= 0 ? 'unpaid' : (testPaid < parseFloat(feeRow.amount_due) ? 'partial' : 'paid');
        check(`Status auto-calculated correctly (${expectedStatus})`, updatedRow && updatedRow.status === expectedStatus, `got ${updatedRow?.status}`);

        await api(`/api/admin/fees/${feeId}`, admin.token, 'PUT', {
          description: feeRow.description || 'Test tuition',
          amount_due: feeRow.amount_due,
          amount_paid: String(originalPaid),
          due_date: feeRow.due_date ? String(feeRow.due_date).split('T')[0] : '',
          status: feeRow.status || '',
        });
        console.log(`  (reverted fee ${feeId} to original)`);
      }
    }

    // ---------- TEACHER ----------
    console.log('\n=== TEACHER PANEL ===');
    const teacher = await login({ username: 'teacher1', email: 'teacher1@school.com', role: 'teacher' });
    check('Teacher login', teacher.token);

    const teacherUnread = await api('/api/teacher/messages/unread-count', teacher.token);
    check('GET /api/teacher/messages/unread-count returns { unread }', teacherUnread.status === 200 && typeof teacherUnread.data?.unread === 'number', JSON.stringify(teacherUnread.data));

    // ---------- PARENT ----------
    console.log('\n=== PARENT PANEL ===');
    const parent = await login({ username: 'parent1', email: 'parent1@school.com', role: 'parent' });
    check('Parent login', parent.token);

    const parentUnread = await api('/api/parent/messages/unread-count', parent.token);
    check('GET /api/parent/messages/unread-count returns { unread }', parentUnread.status === 200 && typeof parentUnread.data?.unread === 'number', JSON.stringify(parentUnread.data));

  } catch (e) {
    allPassed = false;
    console.error('ERROR:', e.message);
  }

  console.log('\n=========================');
  console.log(allPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  console.log('=========================');
  process.exit(allPassed ? 0 : 1);
})();