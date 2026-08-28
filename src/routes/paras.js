const express = require('express');
const db = require('../db');
const { SPECIALTIES } = require('../specialties');
const router = express.Router();

router.get('/', (req, res) => {
  const paras = db
    .prepare('SELECT * FROM paras WHERE org_id = ? ORDER BY name')
    .all(req.user.org_id);
  const availStmt = db.prepare('SELECT * FROM para_availability WHERE para_id = ? ORDER BY day_of_week');
  const specStmt = db.prepare('SELECT specialty FROM para_specialties WHERE para_id = ? ORDER BY specialty');
  const withAvail = paras.map((p) => ({
    ...p,
    availability: availStmt.all(p.id),
    specialties: specStmt.all(p.id).map((s) => s.specialty),
  }));
  res.json(withAvail);
});

router.post('/', (req, res) => {
  const { name, email, title, color, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare('INSERT INTO paras (org_id, name, email, title, color, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.org_id, name, email || null, title || 'Para Instructor', color || '#E3A008', notes || null);
  res.json(db.prepare('SELECT * FROM paras WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, email, title, color, notes, active } = req.body;
  const para = db
    .prepare('SELECT * FROM paras WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!para) return res.status(404).json({ error: 'Para not found' });
  db.prepare(
    'UPDATE paras SET name = ?, email = ?, title = ?, color = ?, notes = ?, active = ? WHERE id = ?'
  ).run(
    name ?? para.name,
    email ?? para.email,
    title ?? para.title,
    color ?? para.color,
    notes ?? para.notes,
    active === undefined ? para.active : active ? 1 : 0,
    para.id
  );
  res.json(db.prepare('SELECT * FROM paras WHERE id = ?').get(para.id));
});

router.delete('/:id', (req, res) => {
  const para = db
    .prepare('SELECT * FROM paras WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!para) return res.status(404).json({ error: 'Para not found' });
  db.prepare('DELETE FROM paras WHERE id = ?').run(para.id);
  res.json({ ok: true });
});

// Replace the full weekly availability set for a Para in one call.
// body: { days: [{ day_of_week, work_start, work_end, break_start, break_minutes, lunch_start, lunch_minutes }] }
router.put('/:id/availability', (req, res) => {
  const para = db
    .prepare('SELECT * FROM paras WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!para) return res.status(404).json({ error: 'Para not found' });

  const { days } = req.body;
  if (!Array.isArray(days)) return res.status(400).json({ error: 'days array is required' });

  const del = db.prepare('DELETE FROM para_availability WHERE para_id = ?');
  const ins = db.prepare(`
    INSERT INTO para_availability
      (para_id, day_of_week, work_start, work_end, break_start, break_minutes, lunch_start, lunch_minutes)
    VALUES (@para_id, @day_of_week, @work_start, @work_end, @break_start, @break_minutes, @lunch_start, @lunch_minutes)
  `);
  const tx = db.transaction((list) => {
    del.run(para.id);
    for (const d of list) {
      ins.run({
        para_id: para.id,
        day_of_week: d.day_of_week,
        work_start: d.work_start,
        work_end: d.work_end,
        break_start: d.break_start || null,
        break_minutes: d.break_minutes || 0,
        lunch_start: d.lunch_start || null,
        lunch_minutes: d.lunch_minutes || 0,
      });
    }
  });
  tx(days);

  const availability = db
    .prepare('SELECT * FROM para_availability WHERE para_id = ? ORDER BY day_of_week')
    .all(para.id);
  res.json({ ...para, availability });
});

// Replace the full set of specialties a Para is qualified/assigned to deliver.
// body: { specialties: ['OT', 'Speech'] }
router.put('/:id/specialties', (req, res) => {
  const para = db
    .prepare('SELECT * FROM paras WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!para) return res.status(404).json({ error: 'Para not found' });

  const { specialties } = req.body;
  if (!Array.isArray(specialties)) return res.status(400).json({ error: 'specialties array is required' });

  const invalid = specialties.filter((s) => !SPECIALTIES.includes(s));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Unknown specialty: ${invalid.join(', ')}. Valid values: ${SPECIALTIES.join(', ')}` });
  }

  const del = db.prepare('DELETE FROM para_specialties WHERE para_id = ?');
  const ins = db.prepare('INSERT INTO para_specialties (para_id, specialty) VALUES (?, ?)');
  const tx = db.transaction((list) => {
    del.run(para.id);
    for (const s of [...new Set(list)]) ins.run(para.id, s);
  });
  tx(specialties);

  const result = db.prepare('SELECT specialty FROM para_specialties WHERE para_id = ? ORDER BY specialty').all(para.id);
  res.json({ ...para, specialties: result.map((r) => r.specialty) });
});

module.exports = router;
