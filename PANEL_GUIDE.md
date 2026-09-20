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
- Adding a student no longer auto-creates a parent/guardian profile. Real parents are created in the Parents tab (email required) and linked to students afterwards via Parent-Student Links; one parent can have many linked children.
- `POST /api/admin/parents/cleanup-partial` (also a button in the Parents tab): merges email-less partial parent profiles into real parents with the same name (moving their student links) and deletes them; partials with no real-name match are kept and flagged `(incomplete)` in the Relationship column for manual completion.

Cross-panel reflection examples:
- Student suspended in Admin:
  - Parent panel hides that child and blocks child-specific endpoints.
  - If no active child remains, parent messaging is blocked.
  - If the suspended child was the parent's last non-suspended child, the parent login account is suspended too.
- Student reactivated in Admin (Update Student, status != suspended):
  - The child reappears in the parent panel.
  - A parent account that was auto-suspended by the child's suspension is restored to approved and can log in again.
  - Enrollments closed during suspension are not re-opened automatically.
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
- Identity tracking is device-based: the admin panel sends a stable `X-Device-Id` fingerprint with every request; each distinct device is registered in `admin_device_registry` and tagged (`Device N`). The tag stays stable even when the device's dynamic IP changes.
- Each log's details include the parsed device model (e.g. `Android SM-G990B`, `Windows PC (Chrome)`) plus the IP address as secondary info (still recorded in `admin_ip_registry`).
- Older log rows keep their historical `Admin N` (IP-based) tags.
- UI shows device tag + details popup for deeper trace context.
