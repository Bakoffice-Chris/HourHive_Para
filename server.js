const path = require('path');
const express = require('express');
const cors = require('cors');
require('./src/db'); // ensures schema is created on boot

const { requireAuth } = require('./src/auth');
const { SPECIALTIES } = require('./src/specialties');
const authRoutes = require('./src/routes/auth');
const paraRoutes = require('./src/routes/paras');
const studentRoutes = require('./src/routes/students');
const assignmentRoutes = require('./src/routes/assignments');
const scheduleRoutes = require('./src/routes/schedule');
const timeLogRoutes = require('./src/routes/timeLogs');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/paras', requireAuth, paraRoutes);
app.use('/api/students', requireAuth, studentRoutes);
app.use('/api/assignments', requireAuth, assignmentRoutes);
app.use('/api/schedule', requireAuth, scheduleRoutes);
app.use('/api/time-logs', requireAuth, timeLogRoutes);

app.get('/api/specialties', requireAuth, (req, res) => res.json({ specialties: SPECIALTIES }));
app.get('/api/health', (req, res) => res.json({ ok: true, product: 'HourHive Caseload' }));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`HourHive Caseload running on http://localhost:${PORT}`);
});
