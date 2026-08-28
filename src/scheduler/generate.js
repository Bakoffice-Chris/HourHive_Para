// HourHive Caseload — scheduling engine
// Fills each Para Instructor's available work windows (work hours minus break/lunch)
// with student sessions until each specialty assignment's weekly service-minute
// requirement is met, respecting 1:1 vs. group service types, each student's own
// available windows (e.g. free periods), AND a hard rule that no student is ever
// placed into two sessions with two different Paras at the same time — Paras are
// processed one at a time and each one's placements immediately become "busy" time
// blocking every subsequently-processed Para from double-booking that student.

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

const FULL_DAY = [[0, 24 * 60]];

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

// Intersect two lists of [start, end) intervals.
function intersectIntervalLists(a, b) {
  const result = [];
  for (const [as, ae] of a) {
    for (const [bs, be] of b) {
      const s = Math.max(as, bs);
      const e = Math.min(ae, be);
      if (e > s) result.push([s, e]);
    }
  }
  return result;
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

// Build a lookup of each student's available windows per weekday.
// { [studentId]: { hasData: boolean, byDay: { [day]: [[start,end], ...] } } }
// hasData=false means the student has never had availability configured, so they're
// treated as unconstrained (available whenever their Para is) for backward compatibility.
function buildStudentAvailabilityIndex(rows) {
  const index = {};
  for (const r of rows) {
    if (!index[r.student_id]) index[r.student_id] = { hasData: true, byDay: {} };
    const entry = index[r.student_id];
    entry.hasData = true;
    if (!entry.byDay[r.day_of_week]) entry.byDay[r.day_of_week] = [];
    entry.byDay[r.day_of_week].push([parseTime(r.start_time), parseTime(r.end_time)]);
  }
  return index;
}

function studentWindowsForDay(studentId, day, availabilityIndex) {
  const entry = availabilityIndex[studentId];
  if (!entry || !entry.hasData) return null; // unconstrained
  return entry.byDay[day] || []; // empty array = defined-but-unavailable that day
}

// Compute the windows during which an entire demand unit (one student, or every member
// of a group) is simultaneously available on a given day, from *availability data only*.
// Returns null for "unconstrained" (no member has any availability data at all), or an
// array of [start,end] intervals (possibly empty, meaning nobody in the unit is available
// that day).
function unitWindowsForDay(unit, day, availabilityIndex) {
  let constrained = false;
  let intersection = null; // null = not yet constrained by anyone

  for (const sid of unit.studentIds) {
    const windows = studentWindowsForDay(sid, day, availabilityIndex);
    if (windows === null) continue; // this member is unconstrained, doesn't narrow anything
    constrained = true;
    if (intersection === null) {
      intersection = windows;
    } else {
      intersection = intersectIntervalLists(intersection, windows);
    }
    if (intersection.length === 0) return []; // short-circuit: nobody available together
  }

  return constrained ? intersection : null;
}

// Cross-Para "busy" tracking: intervals already claimed by a student's OTHER sessions
// this week (with any Para), so a student is never double-booked into two sessions at
// once regardless of which Para or specialty each one belongs to.
// busyMap: { [studentId]: { [day]: [[start,end], ...] } }
function busyIntervalsForDay(studentId, day, busyMap) {
  return (busyMap[studentId] && busyMap[studentId][day]) || [];
}

function markBusy(busyMap, studentId, day, start, end) {
  if (!busyMap[studentId]) busyMap[studentId] = {};
  if (!busyMap[studentId][day]) busyMap[studentId][day] = [];
  busyMap[studentId][day].push([start, end]);
}

// Combine a demand unit's personal-availability windows with the cross-Para busy map to
// get the concrete windows it can actually be scheduled into on a given day. Always
// returns a concrete array (never null) so the packing loop doesn't need special-casing.
function effectiveUnitWindowsForDay(unit, day, availabilityIndex, busyMap) {
  const base = unitWindowsForDay(unit, day, availabilityIndex);
  let windows = base === null ? FULL_DAY : base;

  // Busy time from ANY member blocks the whole unit (a group can't meet if one member
  // is already elsewhere), so union each member's busy intervals and subtract them all.
  for (const sid of unit.studentIds) {
    for (const [bs, be] of busyIntervalsForDay(sid, day, busyMap)) {
      windows = subtractInterval(windows, bs, be);
    }
  }
  return windows;
}

// Build demand units (individual or grouped-by-group_tag) for one Para's caseload.
// Each unit tracks which specialty each student's need belongs to, so generated
// sessions and compliance can be attributed to the right assignment.
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
          specialtyByStudent: {},
        });
      }
      const g = groups.get(key);
      g.studentIds.push(a.student_id);
      g.sessionLength = Math.max(g.sessionLength, a.session_length);
      g.minSessionLength = Math.min(g.minSessionLength, a.min_session_length);
      g.priority = Math.min(g.priority, a.priority);
      g.remaining[a.student_id] = a.weekly_minutes;
      g.target[a.student_id] = a.weekly_minutes;
      g.specialtyByStudent[a.student_id] = a.specialty;
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
        specialtyByStudent: { [a.student_id]: a.specialty },
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

// Pack demand units into a single Para's free windows across the week, respecting each
// unit's own/group availability AND cross-Para busy time (already-booked slots for any
// of its students, from Paras processed earlier in this same generation run).
function schedulePara(freeWindows, units, availabilityIndex, busyMap) {
  const placements = []; // { day, start, end, minutes, unit }
  const scheduledToday = {}; // key -> day last scheduled
  const dayWindowCache = {}; // `${unit.key}:${day}` -> effective windows (computed once; busyMap is stable for the duration of this para's run)

  function getUnitWindows(unit, day) {
    const cacheKey = `${unit.key}:${day}`;
    if (!(cacheKey in dayWindowCache)) {
      dayWindowCache[cacheKey] = effectiveUnitWindowsForDay(unit, day, availabilityIndex, busyMap);
    }
    return dayWindowCache[cacheKey];
  }

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

      // Narrow to units that are actually available (availability + not already busy
      // elsewhere) at `cursor`.
      const eligible = [];
      for (const u of active) {
        const dayWindows = getUnitWindows(u, win.day);
        const interval = dayWindows.find((iv) => iv[0] <= cursor && cursor < iv[1]);
        if (interval) eligible.push({ u, maxDur: Math.min(capacity, interval[1] - cursor) });
      }

      if (eligible.length === 0) {
        // Nobody is available right at `cursor` — jump forward to the next moment someone
        // with remaining minutes becomes available, rather than abandoning the whole window.
        let nextStart = Infinity;
        for (const u of active) {
          const dayWindows = getUnitWindows(u, win.day);
          for (const iv of dayWindows) {
            if (iv[0] > cursor && iv[0] < nextStart) nextStart = iv[0];
          }
        }
        if (nextStart === Infinity || nextStart >= win.end) break;
        cursor = nextStart;
        continue;
      }

      eligible.sort((a, b) => {
        const aToday = scheduledToday[a.u.key] === win.day ? 1 : 0;
        const bToday = scheduledToday[b.u.key] === win.day ? 1 : 0;
        if (aToday !== bToday) return aToday - bToday; // prefer not-yet-scheduled-today
        if (a.u.priority !== b.u.priority) return a.u.priority - b.u.priority; // lower number = higher priority
        return unitRemainingMax(b.u) - unitRemainingMax(a.u); // more remaining need first
      });

      const chosen = eligible.find((e) => e.u.minSessionLength <= e.maxDur);
      if (!chosen) break; // best available slot is too short for anyone's minimum — move on

      let duration = Math.min(chosen.u.sessionLength, chosen.maxDur);
      const maxRemaining = unitRemainingMax(chosen.u);
      if (maxRemaining < duration) duration = maxRemaining;
      if (duration <= 0) break;

      placements.push({
        day: win.day,
        start: cursor,
        end: cursor + duration,
        minutes: duration,
        unit: chosen.u,
      });

      for (const sid of chosen.u.studentIds) {
        chosen.u.remaining[sid] = Math.max(0, (chosen.u.remaining[sid] || 0) - duration);
      }
      scheduledToday[chosen.u.key] = win.day;
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
      (org_id, week_start_date, para_id, student_id, specialty, day_of_week, start_time, end_time, minutes, service_type, session_group_id)
    VALUES (@org_id, @week_start_date, @para_id, @student_id, @specialty, @day_of_week, @start_time, @end_time, @minutes, @service_type, @session_group_id)
  `);

  const studentStmt = db.prepare('SELECT * FROM students WHERE id = ?');

  const insertMany = db.transaction((rows) => {
    for (const r of rows) insertSession.run(r);
  });

  // Student availability is org-wide but keyed by student_id, so build the index once.
  const studentIds = db.prepare('SELECT id FROM students WHERE org_id = ?').all(orgId).map((s) => s.id);
  const studentAvailRows =
    studentIds.length === 0
      ? []
      : db
          .prepare(
            `SELECT * FROM student_availability WHERE student_id IN (${studentIds.map(() => '?').join(',')})`
          )
          .all(...studentIds);
  const availabilityIndex = buildStudentAvailabilityIndex(studentAvailRows);

  // Shared across all Paras in this run — updated after each Para is scheduled, so the
  // next Para processed can never double-book a student who's already been placed.
  const busyMap = {};

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
    const placements = scheduleParaSafe(freeWindows, units, availabilityIndex, busyMap);

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
          specialty: p.unit.specialtyByStudent[sid] || null,
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
      // Claim this time for every student involved so later Paras in this run see it.
      for (const sid of p.unit.studentIds) {
        markBusy(busyMap, sid, p.day, p.start, p.end);
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
        specialty: a.specialty,
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
function scheduleParaSafe(freeWindows, units, availabilityIndex, busyMap) {
  try {
    return schedulePara(freeWindows, units, availabilityIndex, busyMap);
  } catch (e) {
    return [];
  }
}

module.exports = {
  generateSchedule,
  parseTime,
  formatTime,
  buildFreeWindows,
  buildDemandUnits,
  buildStudentAvailabilityIndex,
  unitWindowsForDay,
  effectiveUnitWindowsForDay,
};
