# School Management System — Roles & Features Guide

## How to Access

1. Open your browser and go to `http://localhost:3000`
2. You will see the **login page** with a role picker
3. Select your role (Admin / Teacher / Parent), then enter your credentials

---

## Registration & Account Approval

| Step | Description |
|------|-------------|
| 1. Choose role | On the login page, click **"Create an account"** and select Teacher or Parent |
| 2. Fill registration form | Enter username, password, first name, last name, email, and phone (all required for teacher/parent) |
| 3. Exact record matching | Teacher and Parent registration data must exactly match admin-maintained records. |
| 4. Parent verification | Parents must also provide exact child details (student first name, last name, admission number, guardian name, relationship). |
| 4. Pending approval | After submitting, the account goes into **pending** status |
| 5. Admin approval | The admin sees a notification badge on the **Approvals** sidebar item and can approve or reject the request |
| 6. Login | Once approved, the user can log in. Rejected users see a rejection message. |

> **Note:** Admin accounts cannot be self-registered. They are created by existing admins.

---

## Admin — What They Can Do

The admin has full control of the school system. Accessible from the **Admin Panel** after logging in as admin.

### Dashboard
- View summary statistics: total students, teachers, parents, classes, subjects, active enrollments, fees collected, and outstanding fees

### Students
- **Add** a new student with strict entry rules:
	- Admission number is random-generated and non-editable in add form
	- Only `other_name` is optional
	- Student email/phone are not entered in add form
- **View** all students with their admission number, name, gender, DOB, and status
- **Delete** a student (soft-delete with foreign key protection)

### Teachers
- **Add** a new teacher with strict entry rules:
	- Employee number is random-generated and non-editable in add form
	- Only `other_name` is optional
	- All other core fields are required
- **View** all teachers with employee number, name, gender, phone, and status
- **Delete** a teacher

### Parents
- **Add** a parent manually with strict entry rules:
	- Only address is optional
	- All other fields are required
- **View** all parents
- **Delete** a parent

### Classes
- **Add** a class with name, code, level, and capacity
- **View** and **delete** classes

### Subjects
- **Add** a subject with code, name, and description
- **View** and **delete** subjects

### Enrollments
- **Enroll** a student into a class for an academic year
- **View** all enrollments with student name, class, year, and status
- **Delete** an enrollment

### Fees
- **Add** a fee record using student ADM number in the admin form (resolved to enrollment automatically)
- **View** all fees with due/paid amounts and status (unpaid/partial/paid)
- **Update** fee details and payment amounts

### Teaching Assignments
- **Assign** a teacher to a subject and class for an academic year/term (term is required)
- **View** all assignments
- **Delete** an assignment

### Homework
- **View** all homework posted by teachers
- **Delete** inappropriate or incorrect homework entries

### Pending Approvals (NEW)
- **View** all registration requests (pending, approved, rejected)
- **Approve** a pending registration — this creates the user account, assigns the role, and for parents: auto-creates a parent record and links to the verified student
- **Reject** a registration with an optional reason
- A **notification badge** appears on the sidebar showing the count of pending requests

### Grade Change Approvals (NEW)
- Teachers submit grade changes
- Admin reviews pending grade-change requests
- Admin approves/rejects requests before parents can see updated grades

### Audit Logs (NEW)
- **View** a full log of every action in the system: who did what, when, on which table, and what data changed
- **Filter** logs by action type (CREATE, UPDATE, DELETE, LOGIN) and/or table name
- Tracks all admin, teacher, and system actions

---

## Teacher — What They Can Do

Teachers access the **Teacher Panel** after logging in. They can only see and manage data related to **their assigned classes and subjects**.

### My Classes
- View all classes assigned to the teacher for the current configuration
- See class name, subject, academic year, and term

### Students
- View students enrolled in the teacher's assigned classes
- See student name, admission number, gender, class, and status
- View linked parent contact details in student list

### Attendance
- **Mark attendance** for students in their assigned classes
- Select a class, pick a date, and mark each student as Present or Absent
- View attendance history

### Grades
- **Submit grades/grade edits** for students in assigned subjects/classes
- Fill in marks, grades, and optional remarks
- Final visibility to parents depends on admin grade approval workflow

### Homework (NEW)
- **Add homework** for their assigned classes: title, description, subject, class, due date
- **View** all homework they've posted
- **Edit** or **delete** their own homework entries

### Messages (NEW)
- Teachers can privately message only parents related to their assigned classes
- Teachers cannot message admin through teacher messaging flow

---

## Parent — What They Can Do

Parents access the **Parent Panel** after logging in. They can only see data related to **their linked children**.

### My Children
- View all children linked to their account
- See child name, admission number, class, and enrollment year

### Attendance
- View their children's attendance records
- See date, status (Present/Absent), and any remarks

### Grades
- View their children's grades
- See subject, marks, grade letter, and teacher remarks
- Parents only see grades after admin approval where applicable

### Fees
- View fee records for their children
- See description, amount due, amount paid, due date, and payment status

### Homework (NEW)
- View homework assigned to their children's classes
- See title, description, subject, class, teacher, and due date

### Add Child Request (NEW)
- Parent can submit additional child-link request from parent panel
- Request is queued for admin approval
- Duplicate parent-student links are blocked

---

## Security Features

- **JWT Authentication** — All API requests require a valid token
- **Role-based access control** — Each role can only access their own endpoints
- **Password hashing** — All passwords are hashed with bcrypt (10 salt rounds)
- **Audit logging** — Every create, update, and delete action is logged with user, timestamp, and data changes
- **Soft delete** — Records are deactivated rather than permanently removed, with foreign key protection
- **Class ownership checks** — Teachers can only access students/data in their assigned classes
- **Account approval** — New accounts require admin approval before they can log in
- **Student verification** — Parent registration requires confirming the student's name exists in the system
- **Strict profile matching** — Teacher/parent registration fields must exactly match admin records
- **Admin-first grade publication** — Grade changes are approval-gated before parent visibility
