const express = require('express');
const db = require('../db');
const { generateSchedule } = require('../scheduler/generate');
const { mondayOf } = require('../dateUtils');
const router = express.Router();

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

router.post('/generate', (req, res) => {
  const weekStartDate = mondayOf(req.body.week_start_date);
  try {
    const result = generateSchedule(db, req.user.org_id, weekStartDate);
    res.json({ week_start_date: weekStartDate, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Compliance is always computed live from whatever is currently in schedule_sessions,
// so manual additions/removals (below) are reflected immediately without re-running
// the auto-generator. Matched by (para_id, student_id, specialty) so a student who
// gets two different specialties from the same Para doesn't have their minutes conflated.
function computeCompliance(orgId, weekStartDate) {
  const assignments = db
    .prepare(
      `SELECT a.*, p.name AS para_name, s.name AS student_name
       FROM assignments a
       JOIN paras p ON p.id = a.para_id
       JOIN students s ON s.id = a.student_id
       WHERE a.org_id = ?`
    )
    .all(orgId);

  const sumStmt = db.prepare(
    `SELECT COALESCE(SUM(minutes), 0) AS total FROM schedule_sessions
     WHERE org_id = ? AND week_start_date = ? AND para_id = ? AND student_id = ?
       AND specialty IS ?`
  );

  return assignments.map((a) => {
    const scheduled = sumStmt.get(orgId, weekStartDate, a.para_id, a.student_id, a.specialty).total;
    const target = a.weekly_minutes;
    let status = 'unmet';
    if (scheduled >= target) status = 'met';
    else if (scheduled > 0) status = 'partial';
    return {
      para_id: a.para_id,
      para_name: a.para_name,
      student_id: a.student_id,
      student_name: a.student_name,
      specialty: a.specialty,
      target_minutes: target,
      scheduled_minutes: scheduled,
      status,
      service_type: a.service_type,
    };
  });
}

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

  res.json({
    week_start_date: weekStartDate,
    sessions,
    compliance: computeCompliance(req.user.org_id, weekStartDate),
  });
});

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Any existing session for this student on this day/week that overlaps [start,end),
// regardless of which Para it's with — used to enforce "never 2 Paras at once."
function findConflict(orgId, weekStartDate, studentId, dayOfWeek, startTime, endTime, excludeSessionId) {
  const existing = db
    .prepare(
      `SELECT * FROM schedule_sessions
       WHERE org_id = ? AND week_start_date = ? AND student_id = ? AND day_of_week = ?`
    )
    .all(orgId, weekStartDate, studentId, dayOfWeek);

  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime);

  return existing.find((s) => {
    if (excludeSessionId && s.id === excludeSessionId) return false;
    const s1 = timeToMinutes(s.start_time);
    const e1 = timeToMinutes(s.end_time);
    return newStart < e1 && s1 < newEnd; // overlap
  });
}

// Manually add a session on top of (or instead of) the auto-generated schedule.
// Supports scheduling 2+ students into the same time block even if they aren't
// configured as a formal caseload "group" — e.g. an ad-hoc combined session.
// Each entry ties to a specific caseload assignment (student_id + specialty) so the
// minutes count toward the right target, and are only placed under the Para that's
// actually assigned to that specialty for that student.
// body: { week_start_date, para_id, day_of_week, start_time, end_time, entries: [{ student_id, specialty }] }
router.post('/manual', (req, res) => {
  const { week_start_date, para_id, day_of_week, start_time, end_time, entries } = req.body;
  const weekStartDate = mondayOf(week_start_date);

  if (!para_id || day_of_week === undefined || !start_time || !end_time || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({
      error: 'para_id, day_of_week, start_time, end_time, and at least one entry ({student_id, specialty}) are required',
    });
  }
  if (end_time <= start_time) {
    return res.status(400).json({ error: 'end_time must be after start_time' });
  }

  const para = db.prepare('SELECT * FROM paras WHERE id = ? AND org_id = ?').get(para_id, req.user.org_id);
  if (!para) return res.status(404).json({ error: 'Para not found' });

  // Validate every entry corresponds to a real caseload assignment for this Para, and
  // check for double-booking (this student already has an overlapping session, with
  // this Para or any other) before writing anything.
  for (const entry of entries) {
    const assignment = db
      .prepare('SELECT * FROM assignments WHERE org_id = ? AND para_id = ? AND student_id = ? AND specialty IS ?')
      .get(req.user.org_id, para_id, entry.student_id, entry.specialty || null);
    if (!assignment) {
      return res.status(400).json({
        error: `No caseload assignment found for this student with this Para under the ${entry.specialty || '(no specialty)'} specialty.`,
      });
    }
    const conflict = findConflict(req.user.org_id, weekStartDate, entry.student_id, day_of_week, start_time, end_time, null);
    if (conflict) {
      const student = db.prepare('SELECT name FROM students WHERE id = ?').get(entry.student_id);
      return res.status(409).json({
        error: `${student ? student.name : 'This student'} already has a session from ${conflict.start_time}\u2013${conflict.end_time} on ${DAY_LABELS[day_of_week]} \u2014 a student can't be scheduled with two Paras at once.`,
      });
    }
  }

  const [sh, sm] = start_time.split(':').map(Number);
  const [eh, em] = end_time.split(':').map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);

  const groupId = entries.length > 1 ? `manual-${para_id}-${day_of_week}-${start_time}-${Date.now()}` : null;
  const serviceType = entries.length > 1 ? 'group' : '1:1';

  const insert = db.prepare(`
    INSERT INTO schedule_sessions
      (org_id, week_start_date, para_id, student_id, specialty, day_of_week, start_time, end_time, minutes, service_type, session_group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const entry of entries) {
      insert.run(
        req.user.org_id,
        weekStartDate,
        para_id,
        entry.student_id,
        entry.specialty || null,
        day_of_week,
        start_time,
        end_time,
        minutes,
        serviceType,
        groupId
      );
    }
  });
  tx();

  res.json({
    ok: true,
    week_start_date: weekStartDate,
    day_label: DAY_LABELS[day_of_week],
    compliance: computeCompliance(req.user.org_id, weekStartDate),
  });
});

router.delete('/session/:id', (req, res) => {
  const session = db
    .prepare('SELECT * FROM schedule_sessions WHERE id = ? AND org_id = ?')
    .get(req.params.id, req.user.org_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // If this was part of a group placement, remove every student's row for that same block
  // so the whole group session disappears together rather than leaving a lopsided group.
  if (session.session_group_id) {
    db.prepare('DELETE FROM schedule_sessions WHERE org_id = ? AND session_group_id = ?').run(
      req.user.org_id,
      session.session_group_id
    );
  } else {
    db.prepare('DELETE FROM schedule_sessions WHERE id = ?').run(session.id);
  }

  res.json({
    ok: true,
    compliance: computeCompliance(req.user.org_id, session.week_start_date),
  });
});

module.exports = router;
