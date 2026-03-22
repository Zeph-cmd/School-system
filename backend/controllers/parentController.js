const pool = require('../config/db');

// Parent sees: their children, fees, results, attendance
// Parent cannot edit anything (read-only)

function parseAcademicYearRange(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})\/(\d{4})$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== start + 1) return null;
  return raw;
}

async function getParentMessagingState(userId) {
  const parentRes = await pool.query(
    `SELECT p.parent_id, p.status
     FROM parents p
     JOIN users u ON (
       (u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email))
       OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username)
     )
     WHERE u.user_id = $1
     LIMIT 1`,
    [userId]
  );

  if (parentRes.rows.length === 0) {
    return {
      can_message: false,
      reason: 'Parent profile not found. Contact admin.',
      active_children: 0,
    };
  }

  const parent = parentRes.rows[0];
  if (String(parent.status || 'active').toLowerCase() !== 'active') {
    return {
      can_message: false,
      reason: 'Parent account is not active for messaging.',
      active_children: 0,
    };
  }

  const activeChildrenRes = await pool.query(
    `SELECT COUNT(DISTINCT s.student_id) AS cnt
     FROM parent_student ps
     JOIN students s ON s.student_id = ps.student_id
     JOIN enrollments e ON e.student_id = s.student_id AND e.status = 'active'
     WHERE ps.parent_id = $1
       AND COALESCE(LOWER(s.status), 'active') <> 'suspended'`,
    [parent.parent_id]
  );
  const activeChildren = parseInt(activeChildrenRes.rows[0]?.cnt || '0', 10);

  if (activeChildren <= 0) {
    return {
      can_message: false,
      reason: 'Messaging is disabled because your child has completed/left school or is suspended.',
      active_children: 0,
    };
  }

  return {
    can_message: true,
    reason: null,
    active_children: activeChildren,
  };
}

async function requireParentMessagingAllowed(userId, res) {
  const state = await getParentMessagingState(userId);
  if (!state.can_message) {
    res.status(403).json({ error: state.reason, can_message: false, active_children: state.active_children });
    return null;
  }
  return state;
}

async function getMessagingStatus(req, res) {
  try {
    const state = await getParentMessagingState(req.user.user_id);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messaging status' });
  }
}

// GET /api/parent/children - get linked students
async function getMyChildren(req, res) {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (LOWER(TRIM(COALESCE(s.admission_number, ''))))
        s.*, ps.relationship,
        ce.class_name AS current_class_name,
        ce.academic_year AS current_academic_year,
        CASE WHEN ce.enrollment_status = 'active' THEN 0 ELSE 1 END AS enrollment_priority,
        CASE
          WHEN COALESCE(s.tuition_amount_due, 0) <= 0 THEN 'null'
          WHEN COALESCE(s.tuition_amount_paid, 0) >= COALESCE(s.tuition_amount_due, 0) THEN 'fully_paid'
          ELSE 'partial'
        END AS tuition_status
      FROM students s
      JOIN parent_student ps ON s.student_id = ps.student_id
      JOIN parents p ON ps.parent_id = p.parent_id
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      LEFT JOIN LATERAL (
        SELECT c.class_name, e.academic_year, e.status AS enrollment_status, e.date_enrolled, e.enrollment_id
        FROM enrollments e
        JOIN classes c ON c.class_id = e.class_id
        WHERE e.student_id = s.student_id
        ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.date_enrolled DESC, e.enrollment_id DESC
        LIMIT 1
      ) ce ON TRUE
      WHERE u.user_id = $1
        AND COALESCE(LOWER(s.status), 'active') <> 'suspended'
      ORDER BY LOWER(TRIM(COALESCE(s.admission_number, ''))),
               CASE WHEN ce.enrollment_status = 'active' THEN 0 ELSE 1 END,
               s.student_id DESC
    `, [req.user.user_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch children' });
  }
}

// GET /api/parent/fees?student_id=X - fees for a child
async function getChildFees(req, res) {
  try {
    const { student_id } = req.query;
    const academicYear = parseAcademicYearRange(req.query.academic_year);
    if (!student_id) {
      return res.status(400).json({ error: 'student_id required' });
    }

    // Verify this student belongs to the parent
    const check = await pool.query(`
      SELECT 1 FROM parent_student ps
      JOIN parents p ON ps.parent_id = p.parent_id
      JOIN students s ON ps.student_id = s.student_id
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      WHERE u.user_id = $1 AND ps.student_id = $2
        AND COALESCE(LOWER(s.status), 'active') <> 'suspended'
    `, [req.user.user_id, student_id]);

    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to view this student' });
    }

    const result = await pool.query(`
      SELECT f.*, c.class_name, e.academic_year
      FROM fees f
      JOIN enrollments e ON f.enrollment_id = e.enrollment_id
      JOIN classes c ON e.class_id = c.class_id
      WHERE e.student_id = $1
        AND ($2::text IS NULL OR e.academic_year = $2)
      ORDER BY f.created_at DESC
    `, [student_id, academicYear]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fees' });
  }
}

// GET /api/parent/results?student_id=X
async function getChildResults(req, res) {
  try {
    const { student_id } = req.query;
    const academicYear = parseAcademicYearRange(req.query.academic_year);
    if (!student_id) {
      return res.status(400).json({ error: 'student_id required' });
    }

    const check = await pool.query(`
      SELECT 1 FROM parent_student ps
      JOIN parents p ON ps.parent_id = p.parent_id
      JOIN students s ON ps.student_id = s.student_id
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      WHERE u.user_id = $1 AND ps.student_id = $2
        AND COALESCE(LOWER(s.status), 'active') <> 'suspended'
    `, [req.user.user_id, student_id]);

    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to view this student' });
    }

    const result = await pool.query(`
      SELECT r.*, c.class_name, e.academic_year
      FROM results r
      JOIN enrollments e ON r.enrollment_id = e.enrollment_id
      JOIN classes c ON e.class_id = c.class_id
      WHERE e.student_id = $1
        AND ($2::text IS NULL OR e.academic_year = $2)
      ORDER BY r.term, r.created_at DESC
    `, [student_id, academicYear]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch results' });
  }
}

// GET /api/parent/grades?student_id=X
async function getChildGrades(req, res) {
  try {
    const { student_id } = req.query;
    const academicYear = parseAcademicYearRange(req.query.academic_year);
    if (!student_id) {
      return res.status(400).json({ error: 'student_id required' });
    }

    const check = await pool.query(`
      SELECT 1 FROM parent_student ps
      JOIN parents p ON ps.parent_id = p.parent_id
      JOIN students s ON ps.student_id = s.student_id
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      WHERE u.user_id = $1 AND ps.student_id = $2
        AND COALESCE(LOWER(s.status), 'active') <> 'suspended'
    `, [req.user.user_id, student_id]);

    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to view this student' });
    }

    const result = await pool.query(`
      SELECT g.*, sub.subject_name, c.class_name, e.academic_year
      FROM grades g
      JOIN enrollments e ON g.enrollment_id = e.enrollment_id
      JOIN subjects sub ON g.subject_id = sub.subject_id
      JOIN classes c ON e.class_id = c.class_id
      WHERE e.student_id = $1
        AND ($2::text IS NULL OR e.academic_year = $2)
      ORDER BY g.term, sub.subject_name
    `, [student_id, academicYear]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch grades' });
  }
}

// GET /api/parent/attendance?student_id=X
async function getChildAttendance(req, res) {
  try {
    const { student_id } = req.query;
    const academicYear = parseAcademicYearRange(req.query.academic_year);
    if (!student_id) {
      return res.status(400).json({ error: 'student_id required' });
    }

    const check = await pool.query(`
      SELECT 1 FROM parent_student ps
      JOIN parents p ON ps.parent_id = p.parent_id
      JOIN students s ON ps.student_id = s.student_id
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      WHERE u.user_id = $1 AND ps.student_id = $2
        AND COALESCE(LOWER(s.status), 'active') <> 'suspended'
    `, [req.user.user_id, student_id]);

    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to view this student' });
    }

    const result = await pool.query(`
      SELECT a.*, c.class_name
      FROM attendance a
      JOIN enrollments e ON a.enrollment_id = e.enrollment_id
      JOIN classes c ON e.class_id = c.class_id
      WHERE e.student_id = $1
        AND ($2::text IS NULL OR e.academic_year = $2)
      ORDER BY a.date_attended DESC
    `, [student_id, academicYear]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
}

// GET /api/parent/homework?student_id=X - homework for child's classes
async function getChildHomework(req, res) {
  try {
    const { student_id } = req.query;
    const academicYear = parseAcademicYearRange(req.query.academic_year);
    if (!student_id) {
      return res.status(400).json({ error: 'student_id required' });
    }

    const check = await pool.query(`
      SELECT 1 FROM parent_student ps
      JOIN parents p ON ps.parent_id = p.parent_id
      JOIN students s ON ps.student_id = s.student_id
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      WHERE u.user_id = $1 AND ps.student_id = $2
        AND COALESCE(LOWER(s.status), 'active') <> 'suspended'
    `, [req.user.user_id, student_id]);

    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to view this student' });
    }

    const result = await pool.query(`
      SELECT h.*, sub.subject_name, c.class_name,
             t.first_name || ' ' || t.last_name AS teacher_name
      FROM homework h
      JOIN subjects sub ON h.subject_id = sub.subject_id
      JOIN classes c ON h.class_id = c.class_id
      JOIN teachers t ON h.teacher_id = t.teacher_id
      WHERE EXISTS (
        SELECT 1
        FROM enrollments e
        WHERE e.class_id = h.class_id
          AND e.student_id = $1
          AND (
            ($2::text IS NULL AND e.status = 'active')
            OR ($2::text IS NOT NULL AND e.academic_year = $2)
          )
      )
      ORDER BY h.created_at DESC
    `, [student_id, academicYear]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch homework' });
  }
}

// ─── MESSAGES ─────────────────────────────────────────────────────

// GET /api/parent/messages - get broadcast + private messages for this parent
async function getMyMessages(req, res) {
  try {
    // Get classes the parent's children are in
    const classIds = await pool.query(`
      SELECT DISTINCT e.class_id FROM enrollments e
      JOIN parent_student ps ON e.student_id = ps.student_id
      JOIN parents p ON ps.parent_id = p.parent_id
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      WHERE u.user_id = $1 AND e.status = 'active'
    `, [req.user.user_id]);

    const cids = classIds.rows.map(r => r.class_id);

    let query, params;
    if (cids.length > 0) {
      query = `
        SELECT m.*, u.username AS sender_name, c.class_name
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.user_id
        LEFT JOIN classes c ON m.class_id = c.class_id
        WHERE m.parent_message_id IS NULL
          AND (
            (m.message_type = 'broadcast' AND m.class_id = ANY($1))
            OR (m.message_type = 'private' AND (m.recipient_id = $2 OR m.sender_id = $2))
          )
        ORDER BY m.created_at DESC
      `;
      params = [cids, req.user.user_id];
    } else {
      query = `
        SELECT m.*, u.username AS sender_name, c.class_name
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.user_id
        LEFT JOIN classes c ON m.class_id = c.class_id
        WHERE m.parent_message_id IS NULL
          AND m.message_type = 'private'
          AND (m.recipient_id = $1 OR m.sender_id = $1)
        ORDER BY m.created_at DESC
      `;
      params = [req.user.user_id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
}

// GET /api/parent/messages/:id/conversation
async function getConversation(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT m.*, u.username AS sender_name
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.user_id
      WHERE m.message_id = $1 OR m.parent_message_id = $1
      ORDER BY m.created_at ASC
    `, [id]);

    // Mark as read for this user
    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE (message_id = $1 OR parent_message_id = $1) AND recipient_id = $2',
      [id, req.user.user_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
}

// POST /api/parent/messages/:id/reply - reply to a private message
async function replyToMessage(req, res) {
  try {
    const allowed = await requireParentMessagingAllowed(req.user.user_id, res);
    if (!allowed) return;

    const { id } = req.params;
    const { body } = req.body;
    if (!body) return res.status(400).json({ error: 'Message body required' });

    const orig = await pool.query('SELECT * FROM messages WHERE message_id = $1', [id]);
    if (orig.rows.length === 0) return res.status(404).json({ error: 'Message not found' });

    const origMsg = orig.rows[0];
    // Only reply to private messages that involve this user
    if (origMsg.message_type !== 'private') {
      return res.status(403).json({ error: 'Can only reply to private messages' });
    }

    const recipientId = origMsg.sender_id === req.user.user_id ? origMsg.recipient_id : origMsg.sender_id;
    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, message_type, subject, body, parent_message_id)
       VALUES ($1,$2,'private',$3,$4,$5) RETURNING *`,
      [req.user.user_id, recipientId, origMsg.subject ? 'Re: ' + origMsg.subject : null, body, origMsg.parent_message_id || origMsg.message_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reply' });
  }
}

// GET /api/parent/messages/unread-count
async function getUnreadCount(req, res) {
  try {
    // Count unread private messages
    const result = await pool.query(
      "SELECT COUNT(*) AS cnt FROM messages WHERE recipient_id = $1 AND is_read = FALSE",
      [req.user.user_id]
    );

    // Also count unread broadcasts for parent's classes
    const classIds = await pool.query(`
      SELECT DISTINCT e.class_id FROM enrollments e
      JOIN parent_student ps ON e.student_id = ps.student_id
      JOIN parents p ON ps.parent_id = p.parent_id
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      WHERE u.user_id = $1 AND e.status = 'active'
    `, [req.user.user_id]);

    let broadcastCount = 0;
    if (classIds.rows.length > 0) {
      const cids = classIds.rows.map(r => r.class_id);
      const bc = await pool.query(
        "SELECT COUNT(*) AS cnt FROM messages WHERE message_type = 'broadcast' AND class_id = ANY($1) AND is_read = FALSE",
        [cids]
      );
      broadcastCount = parseInt(bc.rows[0].cnt);
    }

    res.json({ unread: parseInt(result.rows[0].cnt) + broadcastCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
}

// GET /api/parent/contact-teachers - teachers for parent's children
async function getContactTeachers(req, res) {
  try {
    const state = await getParentMessagingState(req.user.user_id);
    if (!state.can_message) {
      return res.json([]);
    }

    const result = await pool.query(`
      SELECT DISTINCT t.teacher_id,
        t.first_name || ' ' || t.last_name AS teacher_name,
        t.email,
        t.phone,
        sub.subject_id,
        sub.subject_name,
        c.class_id,
        c.class_name
      FROM parents p
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      JOIN parent_student ps ON p.parent_id = ps.parent_id
      JOIN enrollments e ON ps.student_id = e.student_id AND e.status = 'active'
      JOIN teaching_assignments ta ON e.class_id = ta.class_id
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      JOIN subjects sub ON ta.subject_id = sub.subject_id
      JOIN classes c ON ta.class_id = c.class_id
      WHERE u.user_id = $1
        AND t.status = 'active'
        AND t.email IS NOT NULL
        AND t.email <> ''
      ORDER BY teacher_name, sub.subject_name
    `, [req.user.user_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teacher contacts' });
  }
}

// POST /api/parent/contact-admin - parent sends in-app private message to admin
async function contactAdmin(req, res) {
  try {
    const allowed = await requireParentMessagingAllowed(req.user.user_id, res);
    if (!allowed) return;

    const { subject, body } = req.body;
    if (!subject || !body) {
      return res.status(400).json({ error: 'subject and body are required' });
    }

    const userRes = await pool.query(
      `SELECT u.username, u.email,
              p.first_name AS parent_first_name,
              p.last_name AS parent_last_name,
              STRING_AGG(DISTINCT c.class_name, ', ') AS class_names,
              STRING_AGG(DISTINCT s.first_name || ' ' || s.last_name, ', ') AS children_names
       FROM users u
       LEFT JOIN parents p ON (
         (u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email))
         OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username)
       )
       LEFT JOIN parent_student ps ON ps.parent_id = p.parent_id
       LEFT JOIN students s ON s.student_id = ps.student_id
       LEFT JOIN enrollments e ON e.student_id = s.student_id AND e.status = 'active'
       LEFT JOIN classes c ON c.class_id = e.class_id
       WHERE u.user_id = $1
       GROUP BY u.username, u.email, p.first_name, p.last_name`,
      [req.user.user_id]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const sender = userRes.rows[0];

    const adminRes = await pool.query(
      `SELECT u.user_id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.user_id
       JOIN roles r ON r.role_id = ur.role_id
       WHERE r.role_name = 'admin' AND u.status = 'approved'
       ORDER BY CASE WHEN LOWER(u.username) = 'admin' THEN 0 ELSE 1 END, u.user_id
       LIMIT 1`
    );
    if (adminRes.rows.length === 0) {
      return res.status(404).json({ error: 'No active admin account found' });
    }

    const senderName = `${sender.parent_first_name || ''} ${sender.parent_last_name || ''}`.trim() || sender.username;
    const classNames = sender.class_names || 'N/A';
    const childNames = sender.children_names || 'N/A';
    const decoratedBody =
      `Parent Name: ${senderName}\n` +
      `Parent First Name: ${sender.parent_first_name || 'N/A'}\n` +
      `Class(es): ${classNames}\n` +
      `Child(ren): ${childNames}\n` +
      `Username: ${sender.username}\n` +
      `Email: ${sender.email || 'N/A'}\n\n` +
      body;

    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, message_type, subject, body)
       VALUES ($1,$2,'private',$3,$4)
       RETURNING *`,
      [req.user.user_id, adminRes.rows[0].user_id, `[Parent Contact] ${subject}`, decoratedBody]
    );

    res.status(201).json({ message: 'Message sent to admin', message_id: result.rows[0].message_id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message to admin' });
  }
}

// POST /api/parent/contact-teacher - parent sends in-app private message to teacher
async function contactTeacher(req, res) {
  try {
    const allowed = await requireParentMessagingAllowed(req.user.user_id, res);
    if (!allowed) return;

    const { teacher_id, subject, body } = req.body;
    if (!teacher_id || !subject || !body) {
      return res.status(400).json({ error: 'teacher_id, subject and body are required' });
    }

    const access = await pool.query(`
      SELECT DISTINCT t.teacher_id, t.email, tu.user_id AS teacher_user_id,
        t.first_name || ' ' || t.last_name AS teacher_name
      FROM parents p
      JOIN users u ON ((u.email IS NOT NULL AND p.email IS NOT NULL AND LOWER(p.email) = LOWER(u.email)) OR LOWER(SPLIT_PART(COALESCE(p.email, ''), '@', 1)) = LOWER(u.username))
      JOIN parent_student ps ON p.parent_id = ps.parent_id
      JOIN enrollments e ON ps.student_id = e.student_id AND e.status = 'active'
      JOIN teaching_assignments ta ON e.class_id = ta.class_id
      JOIN teachers t ON ta.teacher_id = t.teacher_id
      JOIN users tu ON (
        (tu.email IS NOT NULL AND t.email IS NOT NULL AND LOWER(t.email) = LOWER(tu.email))
        OR LOWER(SPLIT_PART(COALESCE(t.email, ''), '@', 1)) = LOWER(tu.username)
        OR LOWER(COALESCE(t.employee_number, '')) = LOWER(tu.username)
      )
      JOIN user_roles tur ON tur.user_id = tu.user_id
      JOIN roles tr ON tr.role_id = tur.role_id
      WHERE u.user_id = $1 AND t.teacher_id = $2
        AND tr.role_name = 'teacher'
        AND tu.status = 'approved'
    `, [req.user.user_id, teacher_id]);

    if (access.rows.length === 0) {
      return res.status(403).json({ error: 'You can only contact teachers assigned to your child\'s class' });
    }

    const teacher = access.rows[0];
    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, message_type, subject, body)
       VALUES ($1,$2,'private',$3,$4)
       RETURNING *`,
      [req.user.user_id, teacher.teacher_user_id, `[Parent Contact] ${subject}`, body]
    );

    res.status(201).json({ message: `Message sent to ${teacher.teacher_name}`, message_id: result.rows[0].message_id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message to teacher' });
  }
}

module.exports = {
  getMyChildren, getChildFees, getChildResults, getChildGrades, getChildAttendance, getChildHomework,
  getMessagingStatus,
  getMyMessages, getConversation, replyToMessage, getUnreadCount,
  getContactTeachers, contactAdmin, contactTeacher,
};

