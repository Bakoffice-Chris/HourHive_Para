const express = require('express');
const db = require('../db');
const { mondayOf, dowOfISO } = require('../dateUtils');
const { buildFreeWindows, parseTime } = require('../scheduler/generate');
const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function overlaps(aS, aE, bS, bE) {
  return aS < bE && bS < aE;
}

// Build the coverage picture for one date: every session belonging to an absent Para,
// with who (if anyone) is covering and which remaining Paras are actually free to cover.
function buildCoverage(orgId, date) {
  const dow = dowOfISO(date);
  const weekStart = mondayOf(date);
  const special = db.prepare('SELECT * FROM special_days WHERE org_id = ? AND date = ?').get(orgId, date) || null;
  const dismissal = special ? parseTime(special.dismissal_time) : null;

  const absences = db
    .prepare(
      `SELECT a.*, p.name AS para_name, p.color AS para_color FROM para_absences a
       JOIN paras p ON p.id = a.para_id WHERE a.org_id = ? AND a.date = ?`
    )
    .all(orgId, date);
  const absentIds = new Set(absences.map((a) => a.para_id));

  const paras = db.prepare('SELECT * FROM paras WHERE org_id = ? AND active = 1').all(orgId);
  const paraById = new Map(paras.map((p) => [p.id, p]));
  const specialtiesByPara = new Map();
  for (const r of db.prepare('SELECT ps.* FROM para_specialties ps JOIN paras p ON p.id = ps.para_id WHERE p.org_id = ?').all(orgId)) {
    if (!specialtiesByPara.has(r.para_id)) specialtiesByPara.set(r.para_id, new Set());
    specialtiesByPara.get(r.para_id).add(r.specialty);
  }

  // Work windows (minus break/lunch, clipped to dismissal) per present Para today.
  const windowsByPara = new Map();
  for (const p of paras) {
    const row = db.prepare('SELECT * FROM para_availability WHERE para_id = ? AND day_of_week = ?').get(p.id, dow);
    if (!row) continue;
    let wins = buildFreeWindows(row).map((w) => ({ start: w.start, end: dismissal == null ? w.end : Math.min(w.end, dismissal) }));
    windowsByPara.set(p.id, wins.filter((w) => w.end > w.start));
  }

  const daySessions = db
    .prepare(
      `SELECT ss.*, s.name AS student_name, s.needs_level, s.medical_risk, s.backup_para_id, s.coverage_notes
       FROM schedule_sessions ss JOIN students s ON s.id = ss.student_id
       WHERE ss.org_id = ? AND ss.week_start_date = ? AND ss.day_of_week = ?
       ORDER BY ss.start_time`
    )
    .all(orgId, weekStart, dow)
    .filter((x) => dismissal == null || parseTime(x.start_time) < dismissal);

  const coverageRows = db.prepare('SELECT * FROM coverage_assignments WHERE org_id = ? AND date = ?').all(orgId, date);

  // Time each present Para is already committed today: own sessions + coverage they've taken on.
  function busyFor(paraId) {
    const own = daySessions.filter((x) => x.para_id === paraId).map((x) => [parseTime(x.start_time), parseTime(x.end_time)]);
    const cov = coverageRows.filter((c) => c.cover_para_id === paraId).map((c) => [parseTime(c.start_time), parseTime(c.end_time)]);
    return own.concat(cov);
  }

  const needs = daySessions
    .filter((x) => absentIds.has(x.para_id))
    .map((x) => {
      const s = parseTime(x.start_time);
      const e = parseTime(x.end_time);
      const cov = coverageRows.find((c) => c.student_id === x.student_id && c.start_time === x.start_time) || null;
      const candidates = [];
      for (const p of paras) {
        if (absentIds.has(p.id)) continue;
        const wins = windowsByPara.get(p.id) || [];
        if (!wins.some((w) => w.start <= s && e <= w.end)) continue;
        const busy = busyFor(p.id).filter(([bs, be]) => overlaps(s, e, bs, be));
        // Sibling coverage rows for this same group session don't count against the cover Para.
        const conflicting = busy.filter(([bs, be]) => !(bs === s && be === e && coverageRows.some((c) => c.cover_para_id === p.id && c.start_time === x.start_time && c.end_time === x.end_time && c.absent_para_id === x.para_id)));
        if (conflicting.length) continue;
        candidates.push({
          para_id: p.id,
          name: p.name,
          color: p.color,
          qualified: !!(x.specialty && specialtiesByPara.get(p.id) && specialtiesByPara.get(p.id).has(x.specialty)),
          is_backup: x.backup_para_id === p.id,
        });
      }
      candidates.sort((a, b) => (b.is_backup - a.is_backup) || (b.qualified - a.qualified) || a.name.localeCompare(b.name));
      return {
        student_id: x.student_id,
        student_name: x.student_name,
        needs_level: x.needs_level || 'middle',
        medical_risk: x.medical_risk ? 1 : 0,
        coverage_notes: x.coverage_notes,
        backup_para_id: x.backup_para_id,
        backup_available: x.backup_para_id ? !absentIds.has(x.backup_para_id) : null,
        specialty: x.specialty,
        start_time: x.start_time,
        end_time: x.end_time,
        minutes: x.minutes,
        service_type: x.service_type,
        absent_para_id: x.para_id,
        absent_para_name: paraById.get(x.para_id)?.name,
        cover_assignment_id: cov ? cov.id : null,
        cover_para_id: cov ? cov.cover_para_id : null,
        cover_para_name: cov ? paraById.get(cov.cover_para_id)?.name : null,
        candidates,
      };
    });

  const rank = (n) => (n.medical_risk ? 0 : { high: 1, middle: 2, low: 3 }[n.needs_level] ?? 2);
  needs.sort((a, b) => rank(a) - rank(b) || a.start_time.localeCompare(b.start_time));

  // Coverage plan: every high-needs / medical student whose assigned Para is out today,
  // whether or not they happen to have a session scheduled.
  const atRiskRows = absentIds.size === 0 ? [] : db
    .prepare(
      `SELECT DISTINCT s.id, s.name, s.needs_level, s.medical_risk, s.backup_para_id, s.coverage_notes, a.para_id AS absent_para_id
       FROM assignments a JOIN students s ON s.id = a.student_id
       WHERE a.org_id = ? AND s.active = 1 AND (s.medical_risk = 1 OR s.needs_level = 'high')
         AND a.para_id IN (${[...absentIds].map(() => '?').join(',')})`
    )
    .all(orgId, ...absentIds);
  const at_risk = atRiskRows
    .map((r) => ({
      student_id: r.id,
      student_name: r.name,
      needs_level: r.needs_level || 'middle',
      medical_risk: r.medical_risk ? 1 : 0,
      coverage_notes: r.coverage_notes,
      absent_para_id: r.absent_para_id,
      absent_para_name: paraById.get(r.absent_para_id)?.name,
      backup_para_id: r.backup_para_id,
      backup_para_name: r.backup_para_id ? paraById.get(r.backup_para_id)?.name || null : null,
      backup_available: r.backup_para_id ? !absentIds.has(r.backup_para_id) : null,
      sessions_total: needs.filter((n) => n.student_id === r.id).length,
      sessions_covered: needs.filter((n) => n.student_id === r.id && n.cover_para_id).length,
    }))
    .sort((a, b) => b.medical_risk - a.medical_risk || a.student_name.localeCompare(b.student_name));

  return {
    date,
    day_of_week: dow,
    week_start_date: weekStart,
    special_day: special,
    absences,
    needs,
    at_risk,
    summary: {
      sessions_needing_cover: needs.length,
      covered: needs.filter((n) => n.cover_para_id).length,
      uncovered_high_or_medical: needs.filter((n) => !n.cover_para_id && (n.medical_risk || n.needs_level === 'high')).length,
    },
  };
}

router.get('/', (req, res) => {
  const date = DATE_RE.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10);
  res.json(buildCoverage(req.user.org_id, date));
});

// Assign a covering Para to a student's session on a date. Group sessions: the whole
// group (same absent Para, same time) is covered together.
// body: { date, student_id, start_time, cover_para_id }
router.post('/', (req, res) => {
  const { date, student_id, start_time, cover_para_id } = req.body;
  if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'A valid date is required' });
  const cov = buildCoverage(req.user.org_id, date);
  const need = cov.needs.find((n) => n.student_id === Number(student_id) && n.start_time === start_time);
  if (!need) return res.status(404).json({ error: 'That session does not need coverage on this date' });
  const cand = need.candidates.find((c) => c.para_id === Number(cover_para_id));
  if (!cand) return res.status(400).json({ error: 'That Para is not free to cover this session (absent, off, on break/lunch, or already booked).' });

  const siblings = cov.needs.filter(
    (n) => n.absent_para_id === need.absent_para_id && n.start_time === need.start_time && n.end_time === need.end_time && n.service_type === need.service_type &&
      (need.service_type === 'group' || n.student_id === need.student_id)
  );
  const ins = db.prepare(
    `INSERT INTO coverage_assignments (org_id, date, student_id, specialty, start_time, end_time, absent_para_id, cover_para_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, date, student_id, start_time) DO UPDATE SET cover_para_id = excluded.cover_para_id`
  );
  db.transaction(() => {
    for (const n of siblings) ins.run(req.user.org_id, date, n.student_id, n.specialty, n.start_time, n.end_time, n.absent_para_id, cand.para_id);
  })();
  res.json(buildCoverage(req.user.org_id, date));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM coverage_assignments WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    'DELETE FROM coverage_assignments WHERE org_id = ? AND date = ? AND absent_para_id = ? AND start_time = ? AND end_time = ? AND cover_para_id = ?'
  ).run(row.org_id, row.date, row.absent_para_id, row.start_time, row.end_time, row.cover_para_id);
  res.json(buildCoverage(req.user.org_id, row.date));
});

module.exports = router;
