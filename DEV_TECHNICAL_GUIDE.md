# Developer and Technical Team Guide

## 1. Architecture Overview

This project is a monorepo with:

- Node.js + Express backend in backend
- Static frontend pages in frontend
- PostgreSQL schema and seeds in database
- API/system tests in tests

Core runtime:

- Entry point: backend/server.js
- NPM start command: npm start
- Server default port: 3000

## 2. Backend Technical Notes

### 2.1 Auth model

- Admin login: username + password
- Teacher login: username + email
- Parent login: username + email
- JWT is used for protected APIs

### 2.2 Role authorization

Role guards are enforced on route groups:

- /api/admin for admin
- /api/teacher for teacher
- /api/parent for parent

### 2.3 Approval workflows

- Registration requests are queued for admin approve/reject
- Parent child-link requests are admin-approved
- Grade changes are queued for admin approve/reject before parent visibility

### 2.4 Messaging boundaries

- Teacher private messaging is parent-scoped to assigned classes
- Parent can reply in message conversations
- Admin has admin messaging endpoints for private/broadcast workflows

## 3. Data and Environment

Required environment variables:

- PORT
- JWT_SECRET
- DB_HOST
- DB_PORT
- DB_USER
- DB_PASSWORD
- DB_NAME

Email-related (if SMTP features are used):

- SMTP_HOST
- SMTP_PORT
- SMTP_SECURE
- SMTP_USER
- SMTP_PASS
- MAIL_FROM
- ADMIN_CONTACT_EMAIL

Database driver config is in backend/config/db.js and uses the DB_* variables above.

## 4. Local Developer Workflow

### 4.1 Install and run

```bash
npm install
npm run seed
npm start
```

### 4.2 Test commands

Quick tests:

```bash
npm test
```

Full regression scan:

```bash
node tests/system-scan.js
```

## 5. Deployment Plan (Next)

This section captures the requested rollout plan:

- Frontend -> Vercel
- Backend -> Render
- Database -> Supabase

## 6. Frontend Deployment on Vercel

### Why

- Good for static frontend hosting
- Free tier available
- Fast preview and production URLs

Expected URL pattern:

- https://your-app.vercel.app

### Steps

1. Push repository to GitHub.
2. Open Vercel and click New Project.
3. Import the GitHub repository.
4. Configure project as static frontend deployment.
5. Deploy.

### Important integration note

Current frontend calls relative API paths like /api/auth and /api/admin. If frontend and backend are deployed on different domains, configure one of the following:

- Vercel rewrites/proxy rules to your Render backend domain, or
- Frontend base API URL configuration and update fetch calls accordingly.

Without this, browser requests will target Vercel domain APIs and fail.

## 7. Backend Deployment on Render

### Why

- Simple Node service hosting
- Free tier available
- Easy environment variable management

Expected URL pattern:

- https://your-api.onrender.com

### Steps

1. Open Render and create a Web Service.
2. Connect the GitHub repository.
3. Set build command (if needed): npm install
4. Set start command: npm start
5. Add environment variables (JWT_SECRET, DB_*, SMTP_* as needed).
6. Deploy.

Health check endpoint:

- GET /api/health

## 8. Database Deployment on Supabase

### Why

- Managed PostgreSQL
- Good free tier
- Built-in SQL and table management UI

### Steps

1. Create a Supabase project.
2. Get the PostgreSQL connection details.
3. Set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME in Render service env to Supabase values.
4. Run schema and migrations from database/init.sql and database/migrations.
5. Seed only if needed for non-production environments.

Connection string example:

postgresql://user:password@host:port/db

## 9. Suggested Production Cutover Sequence

1. Provision Supabase and validate DB connectivity from local.
2. Deploy backend to Render and verify /api/health.
3. Point backend env vars to Supabase and re-verify.
4. Deploy frontend on Vercel.
5. Configure frontend-to-backend routing (rewrites or base API URL).
6. Run smoke tests for login, role dashboards, grade approval flow, and messaging.

## 10. Operational Checklist

Before go-live:

- Rotate default credentials from seed data.
- Set strong JWT_SECRET.
- Configure SMTP for production sender.
- Verify CORS policy in backend for frontend domain.
- Run node tests/system-scan.js against deployed environment where possible.
- Confirm backup/restore plan for Supabase database.
