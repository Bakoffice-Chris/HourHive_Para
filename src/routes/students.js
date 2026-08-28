const express = require('express');
const multer = require('multer');
const db = require('../db');
const { parseCSV } = require('../csv');
const { SPECIALTIES } = require('../specialties');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB is plenty for a student roster CSV
});

const NAME_HEADERS = ['name', 'student name', 'student', 'full name'];
const GRADE_HEADERS = ['grade', 'grade level'];
const NOTES_HEADERS = ['notes', 'iep_notes', 'iep notes', 'service notes'];
const SPECIALTY_HEADERS = ['specialty', 'iep specialty'];
const MINUTES_HEADERS = ['weekly minutes', 'minutes', 'weekly_minutes', 'required minutes', 'iep minutes'];
const PARA_HEADERS = ['para', 'para instructor', 'assigned para', 'provider'];
const SESSION_LEN_HEADERS = ['session length', 'session_length'];
const MIN_SESSION_LEN_HEADERS = ['min session length', 'minimum session length', 'min_session_length'];
const SERVICE_TYPE_HEADERS = ['service type', 'type'];
const GROUP_TAG_HEADERS = ['group tag', 'group_tag'];
const PRIORITY_HEADERS = ['priority'];

const SPECIALTY_LOOKUP = new Map(SPECIALTIES.map((s) => [s.toLowerCase(), s]));

router.get('/', (req, res) => {
  const students = db
    .prepare('SELECT * FROM students WHERE org_id = ? ORDER BY name')
    .all(req.user.org_id);
  const availStmt = db.prepare('SELECT * FROM student_availability WHERE student_id = ? ORDER BY day_of_week, start_time');
  const withAvail = students.map((s) => ({ ...s, availability: availStmt.all(s.id) }));
  res.json(withAvail);
});

router.post('/', (req, res) => {
  const { name, grade, iep_notes, target_weekly_minutes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare('INSERT INTO students (org_id, name, grade, iep_notes, target_weekly_minutes) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.org_id, name, grade || null, iep_notes || null, target_weekly_minutes || null);
  res.json(db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const { name, grade, iep_notes, active, target_weekly_minutes } = req.body;
  db.prepare(
    'UPDATE students SET name = ?, grade = ?, iep_notes = ?, active = ?, target_weekly_minutes = ? WHERE id = ?'
  ).run(
    name ?? student.name,
    grade ?? student.grade,
    iep_notes ?? student.iep_notes,
    active === undefined ? student.active : active ? 1 : 0,
    target_weekly_minutes === undefined ? student.target_weekly_minutes : target_weekly_minutes || null,
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

// Replace the full set of weekly availability windows for a student in one call.
// Unlike Para availability, multiple windows per day are allowed (e.g. two separate
// free periods). A student with zero rows total is treated as unconstrained everywhere.
// body: { days: [{ day_of_week, start_time, end_time }] }
router.put('/:id/availability', (req, res) => {
  const student = db
    .prepare('SELECT * FROM students WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const { days } = req.body;
  if (!Array.isArray(days)) return res.status(400).json({ error: 'days array is required' });

  const del = db.prepare('DELETE FROM student_availability WHERE student_id = ?');
  const ins = db.prepare(
    'INSERT INTO student_availability (student_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)'
  );
  const tx = db.transaction((list) => {
    del.run(student.id);
    for (const d of list) {
      if (!d.start_time || !d.end_time) continue;
      ins.run(student.id, d.day_of_week, d.start_time, d.end_time);
    }
  });
  tx(days);

  const availability = db
    .prepare('SELECT * FROM student_availability WHERE student_id = ? ORDER BY day_of_week, start_time')
    .all(student.id);
  res.json({ ...student, availability });
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

// Downloadable starter CSV so it's obvious which columns are recognized. Shows the "long
// format": one row per specialty need, so a student needing two specialties (or two
// different Paras) just appears on two rows with the same name.
router.get('/import/template', (req, res) => {
  const csv =
    'Name,Grade,Notes,Specialty,Weekly Minutes,Para,Session Length,Min Session Length,Service Type,Group Tag,Priority\n' +
    'Ethan Brooks,3rd,"Speech/language support, works well 1:1",Speech,150,James Whitfield,30,15,1:1,,1\n' +
    'Ethan Brooks,3rd,,OT,60,Maria Gonzalez,20,15,1:1,,2\n' +
    'Ava Nguyen,4th,Reading fluency support,Reading,120,Maria Gonzalez,30,20,1:1,,2\n' +
    'Sofia Ramirez,5th,Reading intervention,Reading,90,Maria Gonzalez,30,15,group,reading-grp-1,3\n' +
    'Noah Patel,3rd,Reading intervention,Reading,90,Maria Gonzalez,30,15,group,reading-grp-1,3\n' +
    'Isabella Kim,1st,,,,,,,,,\n';
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
  const col = (headers) => header.findIndex((h) => headers.includes(h));
  const nameIdx = col(NAME_HEADERS);
  const gradeIdx = col(GRADE_HEADERS);
  const notesIdx = col(NOTES_HEADERS);
  const specialtyIdx = col(SPECIALTY_HEADERS);
  const minutesIdx = col(MINUTES_HEADERS);
  const paraIdx = col(PARA_HEADERS);
  const sessionLenIdx = col(SESSION_LEN_HEADERS);
  const minSessionLenIdx = col(MIN_SESSION_LEN_HEADERS);
  const serviceTypeIdx = col(SERVICE_TYPE_HEADERS);
  const groupTagIdx = col(GROUP_TAG_HEADERS);
  const priorityIdx = col(PRIORITY_HEADERS);

  if (nameIdx === -1) {
    return res.status(400).json({
      error: 'Couldn\u2019t find a "Name" column. The first row must be a header with at least a Name column.',
    });
  }

  const cell = (r, idx) => (idx > -1 ? (r[idx] || '').trim() : '');

  const existingStudentsByName = new Map(
    db
      .prepare('SELECT id, name FROM students WHERE org_id = ?')
      .all(req.user.org_id)
      .map((s) => [s.name.toLowerCase(), s.id])
  );
  const existingParasByName = new Map(
    db
      .prepare('SELECT id, name FROM paras WHERE org_id = ?')
      .all(req.user.org_id)
      .map((p) => [p.name.toLowerCase(), p.id])
  );
  const paraSpecialtiesById = new Map();
  function paraHasSpecialty(paraId, specialty) {
    if (!paraSpecialtiesById.has(paraId)) {
      const rows2 = db.prepare('SELECT specialty FROM para_specialties WHERE para_id = ?').all(paraId);
      paraSpecialtiesById.set(paraId, new Set(rows2.map((r) => r.specialty)));
    }
    return paraSpecialtiesById.get(paraId).has(specialty);
  }
  const existingAssignmentKeys = new Set(
    db
      .prepare('SELECT para_id, student_id, specialty FROM assignments WHERE org_id = ?')
      .all(req.user.org_id)
      .map((a) => `${a.para_id}:${a.student_id}:${a.specialty || ''}`)
  );

  const insertStudent = db.prepare('INSERT INTO students (org_id, name, grade, iep_notes) VALUES (?, ?, ?, ?)');
  const insertAssignment = db.prepare(`
    INSERT INTO assignments
      (org_id, para_id, student_id, specialty, weekly_minutes, session_length, min_session_length, service_type, group_tag, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let studentsImported = 0;
  let studentsSkippedBlank = 0;
  let assignmentsCreated = 0;
  let assignmentsSkippedDuplicate = 0;
  const rowErrors = [];

  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = cell(r, nameIdx);
      if (!name) {
        studentsSkippedBlank++;
        continue;
      }

      const nameKey = name.toLowerCase();
      let studentId = existingStudentsByName.get(nameKey);
      if (studentId === undefined) {
        const grade = cell(r, gradeIdx) || null;
        const notes = cell(r, notesIdx) || null;
        const info = insertStudent.run(req.user.org_id, name, grade, notes);
        studentId = info.lastInsertRowid;
        existingStudentsByName.set(nameKey, studentId);
        studentsImported++;
      }
      // else: this row is a second (or later) specialty line for a student already seen
      // in this import (or already on the roster) — expected in the long format, not an error.

      const specialtyRaw = cell(r, specialtyIdx);
      if (!specialtyRaw) continue; // roster-only row, no specialty need on this line

      const specialty = SPECIALTY_LOOKUP.get(specialtyRaw.toLowerCase());
      if (!specialty) {
        rowErrors.push({ row: i + 1, error: `Unknown specialty "${specialtyRaw}". Must be one of: ${SPECIALTIES.join(', ')}` });
        continue;
      }

      const paraName = cell(r, paraIdx);
      if (!paraName) {
        rowErrors.push({ row: i + 1, error: `Specialty "${specialty}" given but no Para name in the Para column` });
        continue;
      }
      const paraId = existingParasByName.get(paraName.toLowerCase());
      if (paraId === undefined) {
        rowErrors.push({ row: i + 1, error: `No Para named "${paraName}" found. Add them under Para Instructors first.` });
        continue;
      }
      if (!paraHasSpecialty(paraId, specialty)) {
        rowErrors.push({ row: i + 1, error: `${paraName} isn't assigned to the ${specialty} specialty (Para Instructors \u2192 Specialties).` });
        continue;
      }

      const minutesRaw = cell(r, minutesIdx);
      const weeklyMinutes = Number(minutesRaw);
      if (!minutesRaw || !Number.isFinite(weeklyMinutes) || weeklyMinutes <= 0) {
        rowErrors.push({ row: i + 1, error: `Missing or invalid Weekly Minutes ("${minutesRaw}") for ${name}'s ${specialty} assignment` });
        continue;
      }

      const assignmentKey = `${paraId}:${studentId}:${specialty}`;
      if (existingAssignmentKeys.has(assignmentKey)) {
        assignmentsSkippedDuplicate++;
        continue;
      }

      const serviceTypeRaw = cell(r, serviceTypeIdx).toLowerCase();
      const serviceType = serviceTypeRaw === 'group' ? 'group' : '1:1';
      const groupTag = cell(r, groupTagIdx) || null;
      if (serviceType === 'group' && !groupTag) {
        rowErrors.push({ row: i + 1, error: `Service Type is "group" but Group Tag is blank for ${name}'s ${specialty} assignment` });
        continue;
      }

      const sessionLength = Number(cell(r, sessionLenIdx)) || 30;
      const minSessionLength = Number(cell(r, minSessionLenIdx)) || 15;
      const priority = Number(cell(r, priorityIdx)) || 3;

      insertAssignment.run(
        req.user.org_id,
        paraId,
        studentId,
        specialty,
        weeklyMinutes,
        sessionLength,
        minSessionLength,
        serviceType,
        groupTag,
        priority
      );
      existingAssignmentKeys.add(assignmentKey);
      assignmentsCreated++;
    }
  });
  tx();

  res.json({
    students_imported: studentsImported,
    students_skipped_blank: studentsSkippedBlank,
    assignments_created: assignmentsCreated,
    assignments_skipped_duplicate: assignmentsSkippedDuplicate,
    row_errors: rowErrors.slice(0, 15),
    row_error_count: rowErrors.length,
    total_rows: rows.length - 1,
  });
});

module.exports = router;
