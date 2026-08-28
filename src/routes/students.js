const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const students = db
    .prepare('SELECT * FROM students WHERE org_id = ? ORDER BY name')
    .all(req.user.org_id);
  res.json(students);
});

router.post('/', (req, res) => {
  const { name, grade, iep_notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare('INSERT INTO students (org_id, name, grade, iep_notes) VALUES (?, ?, ?, ?)')
    .run(req.user.org_id, name, grade || null, iep_notes || null);
  res.json(db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const { name, grade, iep_notes, active } = req.body;
  db.prepare('UPDATE students SET name = ?, grade = ?, iep_notes = ?, active = ? WHERE id = ?').run(
    name ?? student.name,
    grade ?? student.grade,
    iep_notes ?? student.iep_notes,
    active === undefined ? student.active : active ? 1 : 0,
    student.id
  );
  res.json(db.prepare('SELECT * FROM students WHERE id = ?').get(student.id));
});

router.delete('/:id', (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  db.prepare('DELETE FROM students WHERE id = ?').run(student.id);
  res.json({ ok: true });
});

module.exports = router;
