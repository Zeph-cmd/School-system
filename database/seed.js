/**
 * Seed script - populates the database with:
 * 1. Roles (admin, teacher, parent, student)
 * 2. Test users for each role
 * 3. Sample students, teachers, parents, classes, subjects
 * 4. Sample enrollments, teaching assignments, parent-student links
 * 
 * Run: npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../backend/config/db');

const SALT_ROUNDS = 10;

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Roles ──────────────────────────────────
    console.log('Seeding roles...');
    await client.query(`
      INSERT INTO roles (role_name, description) VALUES 
        ('admin', 'Full system access'),
        ('teacher', 'Teaching and grading access'),
        ('parent', 'Read-only access to children data'),
        ('student', 'Student account (pending/approved workflow)')
      ON CONFLICT (role_name) DO NOTHING
    `);

    // ── 2. Users ──────────────────────────────────
    console.log('Seeding users...');
    const adminHash = await bcrypt.hash('admin123', SALT_ROUNDS);
    const teacherHash = await bcrypt.hash('teacher123', SALT_ROUNDS);
    const parentHash = await bcrypt.hash('parent123', SALT_ROUNDS);

    // Admin user
    const adminRes = await client.query(`
      INSERT INTO users (username, password_hash, email, phone)
      VALUES ('admin', $1, 'admin@school.com', '0700000001')
      ON CONFLICT (username) DO UPDATE SET password_hash = $1
      RETURNING user_id
    `, [adminHash]);

    // Teacher user
    const teacherRes = await client.query(`
      INSERT INTO users (username, password_hash, email, phone)
      VALUES ('teacher1', $1, 'jdoe@school.com', '0700000002')
      ON CONFLICT (username) DO UPDATE SET password_hash = $1
      RETURNING user_id
    `, [teacherHash]);

    // Parent user
    const parentRes = await client.query(`
      INSERT INTO users (username, password_hash, email, phone)
      VALUES ('parent1', $1, 'mwangi@gmail.com', '0700000003')
      ON CONFLICT (username) DO UPDATE SET password_hash = $1
      RETURNING user_id
    `, [parentHash]);

    const adminId = adminRes.rows[0].user_id;
    const teacherId = teacherRes.rows[0].user_id;
    const parentId = parentRes.rows[0].user_id;

    // ── 3. User Roles ─────────────────────────────
    console.log('Assigning roles...');
    const roles = await client.query('SELECT role_id, role_name FROM roles');
    const roleMap = {};
    roles.rows.forEach(r => roleMap[r.role_name] = r.role_id);

    // Clear existing assignments for these users and re-assign
    await client.query('DELETE FROM user_roles WHERE user_id IN ($1,$2,$3)', [adminId, teacherId, parentId]);

    await client.query(`
      INSERT INTO user_roles (user_id, role_id) VALUES
        ($1, $4), ($2, $5), ($3, $6)
    `, [adminId, teacherId, parentId, roleMap.admin, roleMap.teacher, roleMap.parent]);

    // ── 4. Subjects ───────────────────────────────
    console.log('Seeding subjects...');
    await client.query(`
      INSERT INTO subjects (subject_code, subject_name, description) VALUES
        ('MATH', 'Mathematics', 'Core mathematics'),
        ('ENG', 'English', 'English language and literature'),
        ('SCI', 'Science', 'General science'),
        ('SST', 'Social Studies', 'History and geography'),
        ('KIS', 'Kiswahili', 'Kiswahili language')
      ON CONFLICT (subject_code) DO NOTHING
    `);

    // ── 5. Classes ────────────────────────────────
    console.log('Seeding classes...');
    await client.query(`
      INSERT INTO classes (class_name, class_code, level, capacity) VALUES
        ('Grade 1A', 'G1A', 'Grade 1', 40),
        ('Grade 1B', 'G1B', 'Grade 1', 40),
        ('Grade 2A', 'G2A', 'Grade 2', 35),
        ('Grade 3A', 'G3A', 'Grade 3', 35)
      ON CONFLICT (class_code) DO NOTHING
    `);

    // ── 6. Teachers ───────────────────────────────
    console.log('Seeding teachers...');
    await client.query(`
      INSERT INTO teachers (employee_number, first_name, last_name, gender, phone, email) VALUES
        ('EMP001', 'John', 'Doe', 'Male', '0711111111', 'jdoe@school.com'),
        ('EMP002', 'Jane', 'Smith', 'Female', '0722222222', 'jsmith@school.com')
      ON CONFLICT (employee_number) DO NOTHING
    `);

    // ── 7. Students ───────────────────────────────
    console.log('Seeding students...');
    await client.query(`
      INSERT INTO students (admission_number, first_name, last_name, gender, date_of_birth) VALUES
        ('ADM001', 'Kevin', 'Mwangi', 'Male', '2016-03-15'),
        ('ADM002', 'Faith', 'Mwangi', 'Female', '2017-08-22'),
        ('ADM003', 'Brian', 'Ochieng', 'Male', '2016-11-03'),
        ('ADM004', 'Grace', 'Wanjiku', 'Female', '2016-06-10'),
        ('ADM005', 'Peter', 'Kamau', 'Male', '2017-01-25')
      ON CONFLICT (admission_number) DO NOTHING
    `);

    // ── 8. Parents ────────────────────────────────
    console.log('Seeding parents...');
    await client.query(`
      INSERT INTO parents (first_name, last_name, phone, email, relationship) VALUES
        ('James', 'Mwangi', '0700000003', 'mwangi@gmail.com', 'Father'),
        ('Mary', 'Ochieng', '0700000004', 'ochieng@gmail.com', 'Mother')
      ON CONFLICT DO NOTHING
    `);

    // ── 9. Parent-Student Links ───────────────────
    console.log('Linking parents to students...');
    const students = await client.query('SELECT student_id, admission_number FROM students ORDER BY student_id');
    const parents = await client.query('SELECT parent_id, last_name FROM parents ORDER BY parent_id');

    if (students.rows.length >= 3 && parents.rows.length >= 2) {
      // Mwangi parent -> Kevin & Faith Mwangi
      await client.query(`
        INSERT INTO parent_student (parent_id, student_id, relationship) VALUES
          ($1, $2, 'Father'), ($1, $3, 'Father')
        ON CONFLICT DO NOTHING
      `, [parents.rows[0].parent_id, students.rows[0].student_id, students.rows[1].student_id]);

      // Ochieng parent -> Brian Ochieng
      await client.query(`
        INSERT INTO parent_student (parent_id, student_id, relationship) VALUES
          ($1, $2, 'Mother')
        ON CONFLICT DO NOTHING
      `, [parents.rows[1].parent_id, students.rows[2].student_id]);
    }

    // ── 10. Enrollments ───────────────────────────
    console.log('Enrolling students...');
    const classes = await client.query('SELECT class_id, class_code FROM classes ORDER BY class_id');

    if (students.rows.length >= 5 && classes.rows.length >= 2) {
      const cls1 = classes.rows[0].class_id; // G1A
      const cls2 = classes.rows[1].class_id; // G1B

      for (let i = 0; i < Math.min(3, students.rows.length); i++) {
        await client.query(`
          INSERT INTO enrollments (student_id, class_id, academic_year)
          VALUES ($1, $2, '2025/2026')
          ON CONFLICT DO NOTHING
        `, [students.rows[i].student_id, cls1]);
      }
      for (let i = 3; i < Math.min(5, students.rows.length); i++) {
        await client.query(`
          INSERT INTO enrollments (student_id, class_id, academic_year)
          VALUES ($1, $2, '2025/2026')
          ON CONFLICT DO NOTHING
        `, [students.rows[i].student_id, cls2]);
      }
    }

    // ── 11. Teaching Assignments ──────────────────
    console.log('Assigning teachers...');
    const teachers = await client.query('SELECT teacher_id FROM teachers ORDER BY teacher_id');
    const subjects = await client.query('SELECT subject_id FROM subjects ORDER BY subject_id');

    if (teachers.rows.length >= 1 && subjects.rows.length >= 2 && classes.rows.length >= 2) {
      // Teacher 1 (John Doe) teaches Math and English in G1A
      await client.query(`
        INSERT INTO teaching_assignments (teacher_id, subject_id, class_id, academic_year, term) VALUES
          ($1, $2, $4, '2025/2026', 'Term 1'),
          ($1, $3, $4, '2025/2026', 'Term 1')
        ON CONFLICT DO NOTHING
      `, [teachers.rows[0].teacher_id, subjects.rows[0].subject_id, subjects.rows[1].subject_id, classes.rows[0].class_id]);
    }

    // ── 12. Sample Fees ──────────────────────────
    console.log('Adding sample fees...');
    const enrollments = await client.query('SELECT enrollment_id FROM enrollments ORDER BY enrollment_id');
    for (const enr of enrollments.rows) {
      await client.query(`
        INSERT INTO fees (enrollment_id, description, amount_due, amount_paid, due_date, status) VALUES
          ($1, 'Tuition Fee - Term 1', 15000, 10000, '2026-04-01', 'partial')
        ON CONFLICT DO NOTHING
      `, [enr.enrollment_id]);
    }

    await client.query('COMMIT');
    console.log('\n=== Seed completed successfully! ===');
    console.log('\nTest accounts:');
    console.log('  Admin:   username=admin     password=admin123');
    console.log('  Teacher: username=teacher1  password=teacher123');
    console.log('  Parent:  username=parent1   password=parent123');
    console.log('\nStart server: npm start');
    console.log('Open: http://localhost:3000/login');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
