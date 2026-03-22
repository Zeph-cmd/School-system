# Panel Guide (Brief but Detailed)

## Admin Panel

What admin controls:
- Full CRUD for students, teachers, parents, classes, subjects, fees, assignments.
- Approval workflows (registration + grade changes).
- Academic year and grade edit policy.
- Audit logs and admin IP trace tags.

Important logic:
- Deleting a student does not hard-delete profile; student is suspended.
- Deleting a teacher marks teacher as resigned and terminates linked teacher login account.
- Deleting a parent removes parent profile/links and suspends linked parent login account.
- Parent/teacher capabilities immediately depend on these status updates.

Cross-panel reflection examples:
- Student suspended in Admin:
  - Parent panel hides that child and blocks child-specific endpoints.
  - If no active child remains, parent messaging is blocked.
- Teacher deleted in Admin:
  - Teacher account becomes terminated; teacher cannot log in/send/reply.
  - Parent contact-teacher options reduce accordingly.
- Academic year changed in Admin:
  - Teacher and parent views shift to relevant year filters and active records.

## Teacher Panel

What teacher can do:
- View own profile, assignments, class students.
- Manage attendance and grades for assigned classes only.
- Manage homework.
- Message only allowed parents (class-linked) while teacher is active.

Important logic:
- Assignment ownership checks are enforced server-side for attendance/grades/homework.
- Messaging is blocked when teacher profile is not active.

## Parent Panel

What parent can do:
- View children, grades, fees, attendance, homework.
- Read broadcasts and private messages.
- Contact admin/teachers only when messaging is allowed.

Important logic:
- Suspended children are hidden from parent list and blocked by API authorization checks.
- Completed/left child records remain viewable historically.
- Messaging is disabled if:
  - parent profile/account is not active, or
  - no active non-suspended child remains.

## Authentication + Account Behavior

- Only `users.status = approved` can sign in.
- `declined`, `suspended`, and `terminated` are blocked at login.
- Role checks are enforced per panel route.

## Messaging vs Recovery Email

- In-app messaging is database-only (`messages` table).
- No SMTP is required for app-to-app messages:
  - admin -> parent
  - teacher <-> parent
  - broadcasts
- Admin recovery email is a separate auth safety control and does not control in-app messaging delivery.

## Audit + Traceability

- Admin actions are written to `audit_logs`.
- Admin access includes a friendly tag (`Admin N`) from IP registry metadata.
- UI shows tag + details popup for deeper trace context.
