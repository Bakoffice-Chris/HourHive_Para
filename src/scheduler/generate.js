// HourHive Caseload — scheduling engine
// Fills each Para Instructor's available work windows (work hours minus break/lunch)
// with student sessions until each student's weekly service-minute requirement is met,
// respecting 1:1 vs. group service types.

function parseTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Subtract a [cutStart, cutEnd) interval from a list of [start, end) intervals.
function subtractInterval(intervals, cutStart, cutEnd) {
  if (cutStart == null || cutEnd == null || cutEnd <= cutStart) return intervals;
  const result = [];
  for (const [s, e] of intervals) {
    if (cutEnd <= s || cutStart >= e) {
      result.push([s, e]);
      continue;
    }
    if (cutStart > s) result.push([s, Math.min(cutStart, e)]);
    if (cutEnd < e) result.push([Math.max(cutEnd, s), e]);
  }
  return result.filter(([s, e]) => e - s > 0);
}

function buildFreeWindows(avail) {
  // avail: { day_of_week, work_start, work_end, break_start, break_minutes, lunch_start, lunch_minutes }
  let intervals = [[parseTime(avail.work_start), parseTime(avail.work_end)]];
  if (avail.break_start && avail.break_minutes > 0) {
    const bs = parseTime(avail.break_start);
    intervals = subtractInterval(intervals, bs, bs + avail.break_minutes);
  }
  if (avail.lunch_start && avail.lunch_minutes > 0) {
    const ls = parseTime(avail.lunch_start);
    intervals = subtractInterval(intervals, ls, ls + avail.lunch_minutes);
  }
  return intervals.map(([s, e]) => ({ day: avail.day_of_week, start: s, end: e }));
}

// Build demand units (individual or grouped-by-group_tag) for one Para's caseload.
function buildDemandUnits(assignments) {
  const units = [];
  const groups = new Map();

  for (const a of assignments) {
    if (a.service_type === 'group' && a.group_tag) {
      const key = 'group:' + a.group_tag;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          type: 'group',
          studentIds: [],
          sessionLength: 0,
          minSessionLength: Infinity,
          priority: 5,
          remaining: {},
          target: {},
        });
      }
      const g = groups.get(key);
      g.studentIds.push(a.student_id);
      g.sessionLength = Math.max(g.sessionLength, a.session_length);
      g.minSessionLength = Math.min(g.minSessionLength, a.min_session_length);
      g.priority = Math.min(g.priority, a.priority);
      g.remaining[a.student_id] = a.weekly_minutes;
      g.target[a.student_id] = a.weekly_minutes;
    } else {
      units.push({
        key: 'ind:' + a.id,
        type: 'individual',
        studentIds: [a.student_id],
        sessionLength: a.session_length,
        minSessionLength: a.min_session_length,
        priority: a.priority,
        remaining: { [a.student_id]: a.weekly_minutes },
        target: { [a.student_id]: a.weekly_minutes },
      });
    }
  }
  for (const g of groups.values()) units.push(g);
  return units;
}

function unitRemainingMax(unit) {
  return Math.max(0, ...Object.values(unit.remaining));
}

function unitHasRemaining(unit) {
  return Object.values(unit.remaining).some((m) => m > 0);
}

// Pack demand units into a single Para's free windows across the week.
function schedulePara(freeWindows, units) {
  const placements = []; // { day, start, end, minutes, unit }
  const scheduledToday = {}; // key -> day last scheduled

  // Sort windows chronologically (day, then start time)
  const windows = [...freeWindows].sort((a, b) => a.day - b.day || a.start - b.start);

  for (const win of windows) {
    let cursor = win.start;
    // Small safety cap on iterations per window
    for (let guard = 0; guard < 500; guard++) {
      const capacity = win.end - cursor;
      const active = units.filter(unitHasRemaining);
      if (active.length === 0) break;

      const smallestMin = Math.min(...active.map((u) => u.minSessionLength));
      if (capacity < smallestMin) break;

      active.sort((a, b) => {
        const aToday = scheduledToday[a.key] === win.day ? 1 : 0;
        const bToday = scheduledToday[b.key] === win.day ? 1 : 0;
        if (aToday !== bToday) return aToday - bToday; // prefer not-yet-scheduled-today
        if (a.priority !== b.priority) return a.priority - b.priority; // lower number = higher priority
        return unitRemainingMax(b) - unitRemainingMax(a); // more remaining need first
      });

      const candidate = active.find((u) => u.minSessionLength <= capacity);
      if (!candidate) break;

      let duration = Math.min(candidate.sessionLength, capacity);
      const maxRemaining = unitRemainingMax(candidate);
      if (maxRemaining < duration) duration = maxRemaining;
      if (duration <= 0) break;

      placements.push({
        day: win.day,
        start: cursor,
        end: cursor + duration,
        minutes: duration,
        unit: candidate,
      });

      for (const sid of candidate.studentIds) {
        candidate.remaining[sid] = Math.max(0, (candidate.remaining[sid] || 0) - duration);
      }
      scheduledToday[candidate.key] = win.day;
      cursor += duration;
    }
  }

  return placements;
}

/**
 * Generate a full-org weekly schedule.
 * @param {object} db better-sqlite3 instance
 * @param {number} orgId
 * @param {string} weekStartDate ISO date string (Monday of the target week)
 * @returns {{sessions: Array, compliance: Array, runId: number}}
 */
function generateSchedule(db, orgId, weekStartDate) {
  const paras = db.prepare('SELECT * FROM paras WHERE org_id = ? AND active = 1').all(orgId);
  const allSessions = [];
  const compliance = [];

  const clearStmt = db.prepare(
    'DELETE FROM schedule_sessions WHERE org_id = ? AND week_start_date = ?'
  );
  clearStmt.run(orgId, weekStartDate);

  const insertSession = db.prepare(`
    INSERT INTO schedule_sessions
      (org_id, week_start_date, para_id, student_id, day_of_week, start_time, end_time, minutes, service_type, session_group_id)
    VALUES (@org_id, @week_start_date, @para_id, @student_id, @day_of_week, @start_time, @end_time, @minutes, @service_type, @session_group_id)
  `);

  const studentStmt = db.prepare('SELECT * FROM students WHERE id = ?');

  const insertMany = db.transaction((rows) => {
    for (const r of rows) insertSession.run(r);
  });

  for (const para of paras) {
    const availRows = db
      .prepare('SELECT * FROM para_availability WHERE para_id = ?')
      .all(para.id);
    const freeWindows = availRows.flatMap(buildFreeWindows);

    const assignments = db
      .prepare('SELECT * FROM assignments WHERE para_id = ?')
      .all(para.id);

    if (assignments.length === 0) continue;

    const units = buildDemandUnits(assignments);
    const placements = scheduleParaSafe(freeWindows, units);

    const rowsToInsert = [];
    for (const p of placements) {
      const groupId =
        p.unit.type === 'group' ? `${para.id}-${p.day}-${p.start}-${p.unit.key}` : null;
      for (const sid of p.unit.studentIds) {
        const row = {
          org_id: orgId,
          week_start_date: weekStartDate,
          para_id: para.id,
          student_id: sid,
          day_of_week: p.day,
          start_time: formatTime(p.start),
          end_time: formatTime(p.end),
          minutes: p.minutes,
          service_type: p.unit.type === 'group' ? 'group' : '1:1',
          session_group_id: groupId,
        };
        rowsToInsert.push(row);
        allSessions.push(row);
      }
    }
    insertMany(rowsToInsert);

    // Compliance: recompute scheduled minutes per assignment from placements
    for (const a of assignments) {
      const unit = units.find(
        (u) =>
          (u.type === 'individual' && u.key === 'ind:' + a.id) ||
          (u.type === 'group' && u.studentIds.includes(a.student_id) && u.key === 'group:' + a.group_tag)
      );
      const target = a.weekly_minutes;
      const remaining = unit ? unit.remaining[a.student_id] : target;
      const scheduled = target - remaining;
      const student = studentStmt.get(a.student_id);
      let status = 'unmet';
      if (scheduled >= target) status = 'met';
      else if (scheduled > 0) status = 'partial';
      compliance.push({
        para_id: para.id,
        para_name: para.name,
        student_id: a.student_id,
        student_name: student ? student.name : `#${a.student_id}`,
        target_minutes: target,
        scheduled_minutes: scheduled,
        status,
        service_type: a.service_type,
      });
    }
  }

  const runStmt = db.prepare(`
    INSERT INTO schedule_runs (org_id, week_start_date, compliance_summary)
    VALUES (?, ?, ?)
  `);
  const info = runStmt.run(orgId, weekStartDate, JSON.stringify(compliance));

  return { sessions: allSessions, compliance, runId: info.lastInsertRowid };
}

// Wrap scheduling in try/catch per para so one bad availability row doesn't kill the whole run.
function scheduleParaSafe(freeWindows, units) {
  try {
    return schedulePara(freeWindows, units);
  } catch (e) {
    return [];
  }
}

module.exports = { generateSchedule, parseTime, formatTime, buildFreeWindows, buildDemandUnits };
