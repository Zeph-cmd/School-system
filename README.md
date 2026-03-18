# School Management System

Node.js + Express + PostgreSQL school management platform with role-based dashboards for Admin, Teacher, and Parent.

## Current Capabilities

- Strict role-based authentication and authorization.
- Admin-managed account approval workflow (teacher/parent registration requests).
- Parent child-link request workflow with admin approval.
- Grade change approval flow: teacher submits, admin approves/rejects, parent sees only approved data.
- Teacher-parent private messaging scoped to assigned class relationships.
- Full admin operations for students, teachers, parents, classes, subjects, enrollments, fees, assignments, and audit visibility.

See full role-by-role feature detail in [ROLES_AND_FEATURES.md](ROLES_AND_FEATURES.md).

## Project Structure

```text
backend/
	config/db.js
	controllers/
	middleware/
	routes/
	server.js
frontend/
	login.html
	admin/index.html
	teacher/index.html
	parent/index.html
	styles/main.css
database/
	init.sql
	migrations/
	seed.js
tests/
	quick-test.js
	system-scan.js
README.md
ROLES_AND_FEATURES.md
```

## Local Setup

1. Install dependencies.

```bash
npm install
```

2. Configure environment variables in `.env`.

```env
PORT=3000
JWT_SECRET=change-me

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=school_management

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
MAIL_FROM=your-email@gmail.com
ADMIN_CONTACT_EMAIL=admin@school.com
```

3. Initialize/seed database.

```bash
npm run seed
```

4. Start server.

```bash
npm start
```

5. Open [http://localhost:3000/login](http://localhost:3000/login).

## Login and Registration Behavior

- Admin login requires username + password.
- Teacher/parent login requires username + email.
- Teacher/parent registration is strict: required fields must exactly match admin-maintained records.
- New teacher/parent registrations are pending until admin approval.

## Testing

Quick suite:

```bash
npm test
```

Full system regression scan:

```bash
node tests/system-scan.js
```

## Key API Groups

- Auth: `/api/auth`
- Admin: `/api/admin`
- Teacher: `/api/teacher`
- Parent: `/api/parent`

For detailed technical operations, data flow, and deployment instructions (Vercel + Render + Supabase), see [DEV_TECHNICAL_GUIDE.md](DEV_TECHNICAL_GUIDE.md).
