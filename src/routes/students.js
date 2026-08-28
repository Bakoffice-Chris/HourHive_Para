const express = require('express');
const multer = require('multer');
const db = require('../db');
const { parseCSV } = require('../csv');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB is plenty for a student roster CSV
});

const NAME_HEADERS = ['name', 'student name', 'student', 'full name'];
const GRADE_HEADERS = ['grade', 'grade level'];
const NOTES_HEADERS = ['notes', 'iep_notes', 'iep notes', 'service notes'];

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

// ---------- Case notes (timestamped log, separate from the short student.iep_notes field) ----------

router.get('/:id/notes', (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const notes = db
    .prepare('SELECT * FROM student_notes WHERE student_id = ? AND org_id = ? ORDER BY created_at DESC')
    .all(student.id, req.user.org_id);
  res.json(notes);
});

router.post('/:id/notes', (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const { note } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: 'note text is required' });
  const info = db
    .prepare('INSERT INTO student_notes (org_id, student_id, note, author) VALUES (?, ?, ?, ?)')
    .run(req.user.org_id, student.id, note.trim(), req.user.name || null);
  res.json(db.prepare('SELECT * FROM student_notes WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id/notes/:noteId', (req, res) => {
  const note = db
    .prepare('SELECT * FROM student_notes WHERE id = ? AND student_id = ? AND org_id = ?')
    .get(req.params.noteId, req.params.id, req.user.org_id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  db.prepare('DELETE FROM student_notes WHERE id = ?').run(note.id);
  res.json({ ok: true });
});

// Downloadable starter CSV so it's obvious which columns are recognized.
router.get('/import/template', (req, res) => {
  const csv =
    'Name,Grade,Notes\n' +
    'Ethan Brooks,3rd,"Speech/language support, works well 1:1"\n' +
    'Ava Nguyen,4th,Reading fluency support\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="students-template.csv"');
  res.send(csv);
});

router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file was uploaded' });

  const text = req.file.buffer.toString('utf-8');
  const rows = parseCSV(text);
  if (rows.length === 0) return res.status(400).json({ error: 'The CSV file appears to be empty' });

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.findIndex((h) => NAME_HEADERS.includes(h));
  const gradeIdx = header.findIndex((h) => GRADE_HEADERS.includes(h));
  const notesIdx = header.findIndex((h) => NOTES_HEADERS.includes(h));

  if (nameIdx === -1) {
    return res.status(400).json({
      error: 'Couldn\u2019t find a "Name" column. The first row must be a header with at least a Name column.',
    });
  }

  const existingNames = new Set(
    db.prepare('SELECT name FROM students WHERE org_id = ?').all(req.user.org_id).map((s) => s.name.toLowerCase().trim())
  );
  const insert = db.prepare('INSERT INTO students (org_id, name, grade, iep_notes) VALUES (?, ?, ?, ?)');

  let imported = 0;
  let skippedDuplicates = 0;
  let skippedBlank = 0;
  const importedNames = [];

  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = (r[nameIdx] || '').trim();
      if (!name) {
        skippedBlank++;
        continue;
      }
      if (existingNames.has(name.toLowerCase())) {
        skippedDuplicates++;
        continue;
      }
      const grade = gradeIdx > -1 ? (r[gradeIdx] || '').trim() || null : null;
      const notes = notesIdx > -1 ? (r[notesIdx] || '').trim() || null : null;
      insert.run(req.user.org_id, name, grade, notes);
      existingNames.add(name.toLowerCase());
      importedNames.push(name);
      imported++;
    }
  });
  tx();

  res.json({
    imported,
    skipped_duplicates: skippedDuplicates,
    skipped_blank: skippedBlank,
    total_rows: rows.length - 1,
    imported_names: importedNames,
  });
});

module.exports = router;
