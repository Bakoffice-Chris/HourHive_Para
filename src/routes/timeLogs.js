const express = require('express');
const db = require('../db');
const { mondayOf } = require('../dateUtils');
const router = express.Router();

function weeklyTotal(orgId, studentId, paraId, weekStartDate) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(minutes), 0) AS total
       FROM time_logs
       WHERE org_id = ? AND student_id = ? AND para_id = ? AND week_start_date = ? AND end_at IS NOT NULL`
    )
    .get(orgId, studentId, paraId, weekStartDate);
  return row.total;
}

// All currently-running clocks for this org, so the UI can restore state after a page reload.
router.get('/running', (req, res) => {
  const rows = db
    .prepare(
      `SELECT tl.*, s.name AS student_name, p.name AS para_name
       FROM time_logs tl
       JOIN students s ON s.id = tl.student_id
       JOIN paras p ON p.id = tl.para_id
       WHERE tl.org_id = ? AND tl.end_at IS NULL`
    )
    .all(req.user.org_id);
  res.json(rows);
});

// Actual logged minutes per para/student pair for a given week, for comparison against
// the assignment's weekly_minutes target.
router.get('/weekly-summary', (req, res) => {
  const weekStartDate = mondayOf(req.query.week_start_date);
  const assignments = db
    .prepare(
      `SELECT a.*, p.name AS para_name, s.name AS student_name
       FROM assignments a
       JOIN paras p ON p.id = a.para_id
       JOIN students s ON s.id = a.student_id
       WHERE a.org_id = ?`
    )
    .all(req.user.org_id);

  const summary = assignments.map((a) => ({
    assignment_id: a.id,
    para_id: a.para_id,
    para_name: a.para_name,
    student_id: a.student_id,
    student_name: a.student_name,
    target_minutes: a.weekly_minutes,
    actual_minutes: weeklyTotal(req.user.org_id, a.student_id, a.para_id, weekStartDate),
  }));

  res.json({ week_start_date: weekStartDate, summary });
});

router.post('/start', (req, res) => {
  const { student_id, para_id } = req.body;
  if (!student_id || !para_id) return res.status(400).json({ error: 'student_id and para_id are required' });

  const student = db.prepare('SELECT id FROM students WHERE id = ? AND org_id = ?').get(student_id, req.user.org_id);
  const para = db.prepare('SELECT id FROM paras WHERE id = ? AND org_id = ?').get(para_id, req.user.org_id);
  if (!student || !para) return res.status(404).json({ error: 'Student or Para not found' });

  const alreadyRunning = db
    .prepare('SELECT * FROM time_logs WHERE org_id = ? AND student_id = ? AND para_id = ? AND end_at IS NULL')
    .get(req.user.org_id, student_id, para_id);
  if (alreadyRunning) return res.status(409).json({ error: 'A clock is already running for this student', log: alreadyRunning });

  const now = new Date();
  const startAt = now.toISOString();
  const weekStartDate = mondayOf(startAt.slice(0, 10));

  const info = db
    .prepare(
      `INSERT INTO time_logs (org_id, student_id, para_id, week_start_date, start_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(req.user.org_id, student_id, para_id, weekStartDate, startAt);

  res.json(db.prepare('SELECT * FROM time_logs WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/:id/stop', (req, res) => {
  const log = db
    .prepare('SELECT * FROM time_logs WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!log) return res.status(404).json({ error: 'Time log not found' });
  if (log.end_at) return res.status(400).json({ error: 'This clock is already stopped' });

  const now = new Date();
  const endAt = now.toISOString();
  const minutes = Math.max(1, Math.round((now - new Date(log.start_at)) / 60000));

  db.prepare('UPDATE time_logs SET end_at = ?, minutes = ? WHERE id = ?').run(endAt, minutes, log.id);
  const updated = db.prepare('SELECT * FROM time_logs WHERE id = ?').get(log.id);

  res.json({
    log: updated,
    week_total_minutes: weeklyTotal(req.user.org_id, log.student_id, log.para_id, log.week_start_date),
  });
});

// Manual correction/entry, e.g. logging a session that wasn't clocked live.
router.post('/manual', (req, res) => {
  const { student_id, para_id, minutes, date } = req.body;
  if (!student_id || !para_id || !minutes) {
    return res.status(400).json({ error: 'student_id, para_id, and minutes are required' });
  }
  const student = db.prepare('SELECT id FROM students WHERE id = ? AND org_id = ?').get(student_id, req.user.org_id);
  const para = db.prepare('SELECT id FROM paras WHERE id = ? AND org_id = ?').get(para_id, req.user.org_id);
  if (!student || !para) return res.status(404).json({ error: 'Student or Para not found' });

  const day = date || new Date().toISOString().slice(0, 10);
  const weekStartDate = mondayOf(day);
  const startAt = new Date(`${day}T00:00:00.000Z`);
  const endAt = new Date(startAt.getTime() + Number(minutes) * 60000);

  const info = db
    .prepare(
      `INSERT INTO time_logs (org_id, student_id, para_id, week_start_date, start_at, end_at, minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.org_id, student_id, para_id, weekStartDate, startAt.toISOString(), endAt.toISOString(), Number(minutes));

  res.json(db.prepare('SELECT * FROM time_logs WHERE id = ?').get(info.lastInsertRowid));
});

// Full weekly report for the Admin tab: one row per caseload assignment, with actual vs.
// target minutes and a Mon–Fri breakdown of the actual session times logged that week.
// Times are derived from the UTC portion of start_at/end_at (the app doesn't currently
// store a per-org timezone), so they read as clock time on the server, not the browser.
function hm(iso) {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

router.get('/admin-summary', (req, res) => {
  const weekStartDate = mondayOf(req.query.week_start_date);

  const assignments = db
    .prepare(
      `SELECT a.*, p.name AS para_name, s.name AS student_name, s.grade AS grade
       FROM assignments a
       JOIN paras p ON p.id = a.para_id
       JOIN students s ON s.id = a.student_id
       WHERE a.org_id = ?
       ORDER BY s.name`
    )
    .all(req.user.org_id);

  const rows = assignments.map((a) => {
    const logs = db
      .prepare(
        `SELECT start_at, end_at, minutes FROM time_logs
         WHERE org_id = ? AND student_id = ? AND para_id = ? AND week_start_date = ? AND end_at IS NOT NULL
         ORDER BY start_at`
      )
      .all(req.user.org_id, a.student_id, a.para_id, weekStartDate);

    const days = { mon: [], tue: [], wed: [], thu: [], fri: [] };
    let actualMinutes = 0;
    for (const log of logs) {
      actualMinutes += log.minutes;
      const dateStr = log.start_at.slice(0, 10);
      const diffDays = Math.round((Date.parse(dateStr) - Date.parse(weekStartDate)) / 86400000);
      if (diffDays >= 0 && diffDays <= 4) {
        days[DAY_KEYS[diffDays]].push(`${hm(log.start_at)}\u2013${hm(log.end_at)}`);
      }
    }

    const pct = a.weekly_minutes > 0 ? Math.round((actualMinutes / a.weekly_minutes) * 100) : 0;

    return {
      assignment_id: a.id,
      para_id: a.para_id,
      para_name: a.para_name,
      student_id: a.student_id,
      student_name: a.student_name,
      grade: a.grade,
      target_minutes: a.weekly_minutes,
      actual_minutes: actualMinutes,
      pct_of_goal: pct,
      days: {
        mon: days.mon.join(', '),
        tue: days.tue.join(', '),
        wed: days.wed.join(', '),
        thu: days.thu.join(', '),
        fri: days.fri.join(', '),
      },
    };
  });

  res.json({ week_start_date: weekStartDate, rows });
});

module.exports = router;
