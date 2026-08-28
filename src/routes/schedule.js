const express = require('express');
const db = require('../db');
const { generateSchedule } = require('../scheduler/generate');
const router = express.Router();

function mondayOf(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

router.post('/generate', (req, res) => {
  const weekStartDate = mondayOf(req.body.week_start_date);
  try {
    const result = generateSchedule(db, req.user.org_id, weekStartDate);
    res.json({ week_start_date: weekStartDate, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', (req, res) => {
  const weekStartDate = mondayOf(req.query.week_start_date);
  const sessions = db
    .prepare(
      `SELECT ss.*, p.name AS para_name, p.color AS para_color, s.name AS student_name
       FROM schedule_sessions ss
       JOIN paras p ON p.id = ss.para_id
       JOIN students s ON s.id = ss.student_id
       WHERE ss.org_id = ? AND ss.week_start_date = ?
       ORDER BY ss.day_of_week, ss.start_time`
    )
    .all(req.user.org_id, weekStartDate);

  const run = db
    .prepare(
      'SELECT * FROM schedule_runs WHERE org_id = ? AND week_start_date = ? ORDER BY id DESC LIMIT 1'
    )
    .get(req.user.org_id, weekStartDate);

  res.json({
    week_start_date: weekStartDate,
    sessions,
    compliance: run ? JSON.parse(run.compliance_summary) : [],
  });
});

module.exports = router;
