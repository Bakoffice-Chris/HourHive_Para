const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hourhive-caseload.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Para Instructors (formerly "employees" in HourHive core, no employee PWA needed here)
CREATE TABLE IF NOT EXISTS paras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  email TEXT,
  title TEXT DEFAULT 'Para Instructor',
  color TEXT DEFAULT '#E3A008',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- One row per weekday of availability for a Para (work window + break + lunch)
CREATE TABLE IF NOT EXISTS para_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  para_id INTEGER NOT NULL REFERENCES paras(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL, -- 0=Sun .. 6=Sat
  work_start TEXT NOT NULL,     -- 'HH:MM' 24h
  work_end TEXT NOT NULL,
  break_start TEXT,             -- optional short break
  break_minutes INTEGER DEFAULT 0,
  lunch_start TEXT,             -- optional lunch
  lunch_minutes INTEGER DEFAULT 0,
  UNIQUE(para_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  grade TEXT,
  iep_notes TEXT,
  target_weekly_minutes INTEGER, -- the student's own required weekly service minutes (IEP minimum)
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Caseload assignment: a student's required weekly service minutes with a given para,
-- for one specific IEP specialty. A student can have multiple assignments across
-- different specialties (and even the same para covering 2 specialties for one student).
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  para_id INTEGER NOT NULL REFERENCES paras(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  specialty TEXT,                        -- OT / PT / Speech / EL / Sped / Reading
  weekly_minutes INTEGER NOT NULL,       -- total required service minutes per week
  session_length INTEGER NOT NULL DEFAULT 30, -- preferred minutes per session
  min_session_length INTEGER NOT NULL DEFAULT 15,
  service_type TEXT NOT NULL DEFAULT '1:1', -- '1:1' or 'group'
  group_tag TEXT,                        -- students sharing a group_tag with the same para can be co-scheduled
  priority INTEGER NOT NULL DEFAULT 3,   -- 1 highest .. 5 lowest, tie-break in scheduler
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(para_id, student_id, specialty)
);

-- Which IEP specialties a Para Instructor is qualified/assigned to deliver.
-- The scheduler and the caseload UI only let a specialty's assignments go to a Para
-- who has that specialty here.
CREATE TABLE IF NOT EXISTS para_specialties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  para_id INTEGER NOT NULL REFERENCES paras(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL,
  UNIQUE(para_id, specialty)
);

-- Generated schedule output. One row per placed session block.
-- Group sessions produce multiple rows (one per student) sharing session_group_id.
CREATE TABLE IF NOT EXISTS schedule_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  week_start_date TEXT NOT NULL, -- ISO date, Monday of the scheduled week
  para_id INTEGER NOT NULL REFERENCES paras(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  specialty TEXT,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  service_type TEXT NOT NULL DEFAULT '1:1',
  session_group_id TEXT, -- shared id for co-scheduled group sessions
  created_at TEXT DEFAULT (datetime('now'))
);

-- One or more available windows per weekday for a Student (e.g. free periods, non-instructional
-- time). Unlike para_availability, multiple rows per day are allowed (a student can have more
-- than one pull-out-eligible window in a day). If a student has zero rows at all, they're treated
-- as unconstrained (available whenever their Para is) for backward compatibility.
CREATE TABLE IF NOT EXISTS student_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL, -- 0=Sun .. 6=Sat
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  week_start_date TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now')),
  compliance_summary TEXT -- JSON blob: per-student minutes met/scheduled/target
);

-- Freeform, timestamped case notes on a student's record (separate from the short
-- descriptive "notes" field on the student itself).
CREATE TABLE IF NOT EXISTS student_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  author TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Actual delivered service time from a live start/stop clock, as distinct from the
-- projected auto-generated schedule_sessions. One row per timed session; end_at/minutes
-- are NULL while the clock is running.
CREATE TABLE IF NOT EXISTS time_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  para_id INTEGER NOT NULL REFERENCES paras(id) ON DELETE CASCADE,
  specialty TEXT,
  week_start_date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  minutes INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Lightweight migrations: add columns/tables introduced after initial release to existing
// DB files (SQLite has no "ADD COLUMN IF NOT EXISTS" or "ALTER ... UNIQUE", so check first).
const studentCols = db.prepare("PRAGMA table_info(students)").all().map((c) => c.name);
if (!studentCols.includes('target_weekly_minutes')) {
  db.exec('ALTER TABLE students ADD COLUMN target_weekly_minutes INTEGER');
}

// assignments needed both a new column (specialty) AND a widened UNIQUE constraint
// (para_id, student_id, specialty instead of just para_id, student_id) so the same
// para can cover more than one specialty for the same student. SQLite can't ALTER a
// UNIQUE constraint in place, so rebuild the table if the old schema is detected.
const assignmentCols = db.prepare("PRAGMA table_info(assignments)").all().map((c) => c.name);
if (!assignmentCols.includes('specialty')) {
  db.exec(`
    ALTER TABLE assignments RENAME TO assignments_old;
    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      para_id INTEGER NOT NULL REFERENCES paras(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      specialty TEXT,
      weekly_minutes INTEGER NOT NULL,
      session_length INTEGER NOT NULL DEFAULT 30,
      min_session_length INTEGER NOT NULL DEFAULT 15,
      service_type TEXT NOT NULL DEFAULT '1:1',
      group_tag TEXT,
      priority INTEGER NOT NULL DEFAULT 3,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(para_id, student_id, specialty)
    );
    INSERT INTO assignments (id, org_id, para_id, student_id, weekly_minutes, session_length, min_session_length, service_type, group_tag, priority, created_at)
      SELECT id, org_id, para_id, student_id, weekly_minutes, session_length, min_session_length, service_type, group_tag, priority, created_at FROM assignments_old;
    DROP TABLE assignments_old;
  `);
}

const scheduleSessionCols = db.prepare("PRAGMA table_info(schedule_sessions)").all().map((c) => c.name);
if (!scheduleSessionCols.includes('specialty')) {
  db.exec('ALTER TABLE schedule_sessions ADD COLUMN specialty TEXT');
}

const timeLogCols = db.prepare("PRAGMA table_info(time_logs)").all().map((c) => c.name);
if (!timeLogCols.includes('specialty')) {
  db.exec('ALTER TABLE time_logs ADD COLUMN specialty TEXT');
}

module.exports = db;
