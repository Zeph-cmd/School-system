# Dev Notes

## Tricky Parts

- User account lifecycle is enum-based: `pending`, `approved`, `declined`, `suspended`, `terminated`.
- Parent identity linking uses email/username fallback joins, not a strict FK from `users` to `parents`.
- Teacher identity linking also uses email/username/employee number fallback joins.
- Student deletion is soft (`students.status = 'suspended'`), and enrollments are closed (`active -> left`).
- Parent-child visibility is status-sensitive: suspended children are hidden from parent endpoints and UI.
- Parent messaging permission is dynamic: blocked when parent profile/account is inactive OR no active child remains.
- Teacher messaging permission is dynamic: blocked when teacher status is not active.
- Audit logs store metadata in JSON (`new_data._meta`), including admin IP access tags.

## DB Structure (Core)

- `users`: login accounts + global account status.
- `roles`, `user_roles`: role mapping (`admin`, `teacher`, `parent`, `student`).
- `students`, `teachers`, `parents`: domain profiles.
- `parent_student`: parent-child links.
- `classes`, `subjects`, `teaching_assignments`: teaching topology.
- `enrollments`: student-class-year membership and lifecycle status.
- `attendance`, `grades`, `results`, `fees`, `homework`: academic/operations records.
- `messages`: private + broadcast communication threads.
- `audit_logs`: action trail with old/new snapshots and request metadata.
- `admin_ip_registry`: maps admin access IP to stable access numbers used in logs.

## Status Conventions

- User account (`users.status`):
  - `pending`: not approved yet
  - `approved`: allowed login
  - `declined`: denied login
  - `suspended`: temporarily blocked
  - `terminated`: account permanently closed by admin workflow
- Teacher profile (`teachers.status`): `active`/`resigned`.
- Student profile (`students.status`): typically `active`/`suspended`.
- Enrollment (`enrollments.status`): `active`/`completed`/`left`.

## High-Risk Query Patterns

- Any parent-facing query must validate both:
  - user owns the child (`parent_student` chain)
  - child is not suspended
- Any messaging write path must re-check permission server-side (never UI-only).
- Any delete/deactivate flow should update both domain profile status and linked `users.status` where applicable.
