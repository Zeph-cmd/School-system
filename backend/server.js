require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { auditMiddleware } = require('./middleware/audit');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const teacherRoutes = require('./routes/teacher');
const parentRoutes = require('./routes/parent');

const app = express();
app.set('trust proxy', true);

// Middleware
app.use(cors());
app.use(express.json());
app.use(auditMiddleware);

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/parent', parentRoutes);

// Frontend route shortcuts
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'admin', 'index.html'));
});
app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'teacher', 'index.html'));
});
app.get('/parent', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'parent', 'index.html'));
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const pool = require('./config/db');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
  console.log(`Teacher dashboard: http://localhost:${PORT}/teacher`);
  console.log(`Parent dashboard: http://localhost:${PORT}/parent`);
});
