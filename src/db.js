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
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Caseload assignment: a student's required weekly service minutes with a given para
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  para_id INTEGER NOT NULL REFERENCES paras(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  weekly_minutes INTEGER NOT NULL,       -- total required service minutes per week
  session_length INTEGER NOT NULL DEFAULT 30, -- preferred minutes per session
  min_session_length INTEGER NOT NULL DEFAULT 15,
  service_type TEXT NOT NULL DEFAULT '1:1', -- '1:1' or 'group'
  group_tag TEXT,                        -- students sharing a group_tag with the same para can be co-scheduled
  priority INTEGER NOT NULL DEFAULT 3,   -- 1 highest .. 5 lowest, tie-break in scheduler
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(para_id, student_id)
);

-- Generated schedule output. One row per placed session block.
-- Group sessions produce multiple rows (one per student) sharing session_group_id.
CREATE TABLE IF NOT EXISTS schedule_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  week_start_date TEXT NOT NULL, -- ISO date, Monday of the scheduled week
  para_id INTEGER NOT NULL REFERENCES paras(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  service_type TEXT NOT NULL DEFAULT '1:1',
  session_group_id TEXT, -- shared id for co-scheduled group sessions
  created_at TEXT DEFAULT (datetime('now'))
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
  week_start_date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  minutes INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

module.exports = db;
