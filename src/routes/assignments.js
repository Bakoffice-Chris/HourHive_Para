const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, p.name AS para_name, s.name AS student_name
       FROM assignments a
       JOIN paras p ON p.id = a.para_id
       JOIN students s ON s.id = a.student_id
       WHERE a.org_id = ?
       ORDER BY p.name, s.name`
    )
    .all(req.user.org_id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const {
    para_id,
    student_id,
    weekly_minutes,
    session_length,
    min_session_length,
    service_type,
    group_tag,
    priority,
  } = req.body;

  if (!para_id || !student_id || !weekly_minutes) {
    return res.status(400).json({ error: 'para_id, student_id, and weekly_minutes are required' });
  }
  if (service_type === 'group' && !group_tag) {
    return res.status(400).json({ error: 'group_tag is required when service_type is "group"' });
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO assignments
          (org_id, para_id, student_id, weekly_minutes, session_length, min_session_length, service_type, group_tag, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.org_id,
        para_id,
        student_id,
        weekly_minutes,
        session_length || 30,
        min_session_length || 15,
        service_type || '1:1',
        group_tag || null,
        priority || 3
      );
    const row = db
      .prepare(
        `SELECT a.*, p.name AS para_name, s.name AS student_name
         FROM assignments a JOIN paras p ON p.id = a.para_id JOIN students s ON s.id = a.student_id
         WHERE a.id = ?`
      )
      .get(info.lastInsertRowid);
    res.json(row);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'This student is already on this Para\u2019s caseload' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', (req, res) => {
  const a = db
    .prepare('SELECT * FROM assignments WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const {
    weekly_minutes,
    session_length,
    min_session_length,
    service_type,
    group_tag,
    priority,
  } = req.body;
  db.prepare(
    `UPDATE assignments SET weekly_minutes = ?, session_length = ?, min_session_length = ?,
       service_type = ?, group_tag = ?, priority = ? WHERE id = ?`
  ).run(
    weekly_minutes ?? a.weekly_minutes,
    session_length ?? a.session_length,
    min_session_length ?? a.min_session_length,
    service_type ?? a.service_type,
    group_tag ?? a.group_tag,
    priority ?? a.priority,
    a.id
  );
  res.json(db.prepare('SELECT * FROM assignments WHERE id = ?').get(a.id));
});

router.delete('/:id', (req, res) => {
  const a = db
    .prepare('SELECT * FROM assignments WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  db.prepare('DELETE FROM assignments WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

module.exports = router;
