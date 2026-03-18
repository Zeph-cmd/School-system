/**
 * Quick tests for the School Management System
 * Tests: DB connection, auth, role-based access, CRUD operations
 * 
 * Run: npm test  (make sure server is running first: npm start)
 */

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err.message}`);
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
  const data = await res.json();
  return { status: res.status, data };
}

async function run() {
  console.log('\n=== School Management System - Quick Tests ===\n');

  let adminToken, teacherToken, parentToken;

  // ── Health Check ──────────────────────────────
  console.log('1. Health & Database');
  await test('Health check returns ok', async () => {
    const { status, data } = await api('/api/health');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'ok', 'Status should be ok');
    assert(data.database === 'connected', 'DB should be connected');
  });

  // ── Authentication ────────────────────────────
  console.log('\n2. Authentication');
  await test('Login fails with wrong password', async () => {
    const { status } = await api('/api/auth/login', 'POST', { username: 'admin', password: 'wrong' });
    assert(status === 401, `Expected 401, got ${status}`);
  });

  await test('Login fails with missing fields', async () => {
    const { status } = await api('/api/auth/login', 'POST', { username: 'admin' });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('Admin login succeeds', async () => {
    const { status, data } = await api('/api/auth/login', 'POST', { username: 'admin', password: 'admin123' });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.token, 'Should return token');
    assert(data.user.roles.includes('admin'), 'Should have admin role');
    adminToken = data.token;
  });

  await test('Teacher login succeeds', async () => {
    const { status, data } = await api('/api/auth/login', 'POST', { username: 'teacher1', password: 'teacher123' });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.user.roles.includes('teacher'), 'Should have teacher role');
    teacherToken = data.token;
  });

  await test('Parent login succeeds', async () => {
    const { status, data } = await api('/api/auth/login', 'POST', { username: 'parent1', password: 'parent123' });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.user.roles.includes('parent'), 'Should have parent role');
    parentToken = data.token;
  });

  await test('GET /api/auth/me returns user info', async () => {
    const { status, data } = await api('/api/auth/me', 'GET', null, adminToken);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.username === 'admin', 'Should return admin user');
  });

  // ── Role-Based Access Control ─────────────────
  console.log('\n3. Role-Based Access Control');
  await test('No token returns 401', async () => {
    const { status } = await api('/api/admin/dashboard');
    assert(status === 401, `Expected 401, got ${status}`);
  });

  await test('Teacher cannot access admin routes', async () => {
    const { status } = await api('/api/admin/dashboard', 'GET', null, teacherToken);
    assert(status === 403, `Expected 403, got ${status}`);
  });

  await test('Parent cannot access admin routes', async () => {
    const { status } = await api('/api/admin/students', 'GET', null, parentToken);
    assert(status === 403, `Expected 403, got ${status}`);
  });

  await test('Parent cannot access teacher routes', async () => {
    const { status } = await api('/api/teacher/assignments', 'GET', null, parentToken);
    assert(status === 403, `Expected 403, got ${status}`);
  });

  await test('Admin cannot access teacher routes', async () => {
    const { status } = await api('/api/teacher/assignments', 'GET', null, adminToken);
    assert(status === 403, `Expected 403, got ${status}`);
  });

  // ── Admin CRUD ────────────────────────────────
  console.log('\n4. Admin CRUD Operations');
  await test('Admin gets dashboard stats', async () => {
    const { status, data } = await api('/api/admin/dashboard', 'GET', null, adminToken);
    assert(status === 200, `Expected 200, got ${status}`);
    assert('total_students' in data, 'Should have total_students');
    assert('total_teachers' in data, 'Should have total_teachers');
  });

  await test('Admin lists students', async () => {
    const { status, data } = await api('/api/admin/students', 'GET', null, adminToken);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data), 'Should return array');
  });

  await test('Admin lists teachers', async () => {
    const { status, data } = await api('/api/admin/teachers', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  await test('Admin lists classes', async () => {
    const { status, data } = await api('/api/admin/classes', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  await test('Admin lists subjects', async () => {
    const { status, data } = await api('/api/admin/subjects', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  await test('Admin lists enrollments', async () => {
    const { status, data } = await api('/api/admin/enrollments', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  await test('Admin lists fees', async () => {
    const { status, data } = await api('/api/admin/fees', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  await test('Admin lists assignments', async () => {
    const { status, data } = await api('/api/admin/assignments', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  await test('Admin lists users', async () => {
    const { status, data } = await api('/api/admin/users', 'GET', null, adminToken);
    assert(status === 200);
    assert(Array.isArray(data));
    assert(data.length >= 3, 'Should have at least 3 users');
  });

  await test('Admin create student validates required fields', async () => {
    const { status } = await api('/api/admin/students', 'POST', { first_name: 'Test' }, adminToken);
    assert(status === 400, `Expected 400, got ${status}`);
  });

  // ── Teacher Access ────────────────────────────
  console.log('\n5. Teacher Operations');
  await test('Teacher gets assignments', async () => {
    const { status, data } = await api('/api/teacher/assignments', 'GET', null, teacherToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  // ── Parent Access ─────────────────────────────
  console.log('\n6. Parent Operations');
  await test('Parent gets children', async () => {
    const { status, data } = await api('/api/parent/children', 'GET', null, parentToken);
    assert(status === 200);
    assert(Array.isArray(data));
  });

  // ── Summary ───────────────────────────────────
  console.log(`\n${'='.repeat(45)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(45)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
