const express = require('express');
const db = require('../db');
const { addDaysISO, dowOfISO } = require('../dateUtils');
const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_TYPES = ['half_day', 'early_release'];

// Special days + absences in a date range (defaults to a window around today)
router.get('/', (req, res) => {
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : addDaysISO(new Date().toISOString().slice(0, 10), -7);
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : addDaysISO(from, 120);
  const special_days = db
    .prepare('SELECT * FROM special_days WHERE org_id = ? AND date BETWEEN ? AND ? ORDER BY date')
    .all(req.user.org_id, from, to);
  const absences = db
    .prepare(
      `SELECT a.*, p.name AS para_name, p.color AS para_color FROM para_absences a
       JOIN paras p ON p.id = a.para_id
       WHERE a.org_id = ? AND a.date BETWEEN ? AND ? ORDER BY a.date, p.name`
    )
    .all(req.user.org_id, from, to);
  res.json({ from, to, special_days, absences });
});

// Create/replace a half day or early release day. body: { date, day_type, label, dismissal_time }
router.post('/special-days', (req, res) => {
  const { date, day_type, label, dismissal_time } = req.body;
  if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'A valid date is required' });
  if (!TIME_RE.test(dismissal_time || '')) return res.status(400).json({ error: 'Dismissal time must be HH:MM (24-hour)' });
  const type = DAY_TYPES.includes(day_type) ? day_type : 'half_day';
  db.prepare(
    `INSERT INTO special_days (org_id, date, day_type, label, dismissal_time) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(org_id, date) DO UPDATE SET day_type = excluded.day_type, label = excluded.label, dismissal_time = excluded.dismissal_time`
  ).run(req.user.org_id, date, type, label || null, dismissal_time);
  res.json(db.prepare('SELECT * FROM special_days WHERE org_id = ? AND date = ?').get(req.user.org_id, date));
});

router.delete('/special-days/:id', (req, res) => {
  const info = db.prepare('DELETE FROM special_days WHERE id = ? AND org_id = ?').run(req.params.id, req.user.org_id);
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Mark a Para out. Accepts a single date or a start_date..end_date range (weekends skipped).
// body: { para_id, start_date, end_date?, reason, notes }
router.post('/absences', (req, res) => {
  const { para_id, start_date, end_date, reason, notes } = req.body;
  const para = db.prepare('SELECT * FROM paras WHERE id = ? AND org_id = ?').get(para_id, req.user.org_id);
  if (!para) return res.status(404).json({ error: 'Para not found' });
  if (!DATE_RE.test(start_date || '')) return res.status(400).json({ error: 'A valid start date is required' });
  const end = end_date && DATE_RE.test(end_date) ? end_date : start_date;
  if (end < start_date) return res.status(400).json({ error: 'End date is before start date' });

  const ins = db.prepare(
    `INSERT INTO para_absences (org_id, para_id, date, reason, notes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(para_id, date) DO UPDATE SET reason = excluded.reason, notes = excluded.notes`
  );
  let added = 0;
  db.transaction(() => {
    for (let d = start_date, guard = 0; d <= end && guard < 120; d = addDaysISO(d, 1), guard++) {
      const dow = dowOfISO(d);
      if (dow === 0 || dow === 6) continue;
      ins.run(req.user.org_id, para.id, d, reason || null, notes || null);
      added++;
    }
  })();
  res.json({ ok: true, days_added: added });
});

router.delete('/absences/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM para_absences WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    // Coverage planned for that day is meaningless once the Para is back.
    db.prepare('DELETE FROM coverage_assignments WHERE org_id = ? AND date = ? AND absent_para_id = ?').run(row.org_id, row.date, row.para_id);
    db.prepare('DELETE FROM para_absences WHERE id = ?').run(row.id);
  })();
  res.json({ ok: true });
});

module.exports = router;
