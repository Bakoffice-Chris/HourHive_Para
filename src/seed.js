const db = require('./db');
const { hashPassword } = require('./auth');

const email = 'admin@demo-school.org';
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.log('Demo data already seeded. Login with:', email, '/ password: demo1234');
  process.exit(0);
}

const orgId = db.prepare('INSERT INTO organizations (name) VALUES (?)').run('Demo Unified School District')
  .lastInsertRowid;
db.prepare('INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(
  orgId,
  email,
  hashPassword('demo1234'),
  'Alex Rivera',
  'admin'
);

const insertPara = db.prepare(
  'INSERT INTO paras (org_id, name, email, title, color) VALUES (?, ?, ?, ?, ?)'
);
const insertAvail = db.prepare(`
  INSERT INTO para_availability (para_id, day_of_week, work_start, work_end, break_start, break_minutes, lunch_start, lunch_minutes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertStudent = db.prepare('INSERT INTO students (org_id, name, grade, iep_notes) VALUES (?, ?, ?, ?)');
const insertAssignment = db.prepare(`
  INSERT INTO assignments (org_id, para_id, student_id, weekly_minutes, session_length, min_session_length, service_type, group_tag, priority)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function seedParaWeek(paraId, { start = '08:00', end = '15:00', breakStart = '10:00', breakMin = 15, lunchStart = '12:00', lunchMin = 30 } = {}) {
  for (let day = 1; day <= 5; day++) {
    insertAvail.run(paraId, day, start, end, breakStart, breakMin, lunchStart, lunchMin);
  }
}

const maria = insertPara.run(orgId, 'Maria Gonzalez', 'mgonzalez@demo-school.org', 'Para Instructor', '#E3A008')
  .lastInsertRowid;
seedParaWeek(maria);

const james = insertPara.run(orgId, 'James Whitfield', 'jwhitfield@demo-school.org', 'Para Instructor', '#2E6F6E')
  .lastInsertRowid;
seedParaWeek(james, { start: '07:30', end: '14:30', breakStart: '09:30', breakMin: 15, lunchStart: '11:30', lunchMin: 30 });

const students = [
  ['Ethan Brooks', '3rd', 'Speech/language support, works well 1:1'],
  ['Ava Nguyen', '4th', 'Reading fluency support'],
  ['Liam Carter', '2nd', 'Behavioral support, needs redirection cues'],
  ['Sofia Ramirez', '5th', 'Math intervention, small group friendly'],
  ['Noah Patel', '3rd', 'Math intervention, small group friendly'],
  ['Isabella Kim', '1st', 'OT support, fine motor'],
  ['Mason Lee', '4th', 'Social skills group'],
  ['Chloe Adams', '2nd', 'Social skills group'],
];
const studentIds = students.map(([name, grade, notes]) => insertStudent.run(orgId, name, grade, notes).lastInsertRowid);

// Maria's caseload: mostly 1:1, one small math group
insertAssignment.run(orgId, maria, studentIds[0], 150, 30, 15, '1:1', null, 1); // Ethan - 150 min/wk
insertAssignment.run(orgId, maria, studentIds[1], 120, 30, 20, '1:1', null, 2); // Ava
insertAssignment.run(orgId, maria, studentIds[3], 90, 30, 15, 'group', 'math-grp-1', 3); // Sofia (group)
insertAssignment.run(orgId, maria, studentIds[4], 90, 30, 15, 'group', 'math-grp-1', 3); // Noah (same group)
insertAssignment.run(orgId, maria, studentIds[5], 100, 20, 15, '1:1', null, 2); // Isabella OT

// James's caseload: behavioral 1:1 + social skills group
insertAssignment.run(orgId, james, studentIds[2], 200, 30, 20, '1:1', null, 1); // Liam
insertAssignment.run(orgId, james, studentIds[6], 60, 20, 15, 'group', 'social-grp-1', 3); // Mason
insertAssignment.run(orgId, james, studentIds[7], 60, 20, 15, 'group', 'social-grp-1', 3); // Chloe

console.log('Seeded demo org "Demo Unified School District".');
console.log('Login: ', email, ' / password: demo1234');
