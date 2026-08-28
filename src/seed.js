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
const insertSpecialty = db.prepare('INSERT INTO para_specialties (para_id, specialty) VALUES (?, ?)');
const insertStudent = db.prepare('INSERT INTO students (org_id, name, grade, iep_notes) VALUES (?, ?, ?, ?)');
const insertAssignment = db.prepare(`
  INSERT INTO assignments (org_id, para_id, student_id, specialty, weekly_minutes, session_length, min_session_length, service_type, group_tag, priority)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function seedParaWeek(paraId, { start = '08:00', end = '15:00', breakStart = '10:00', breakMin = 15, lunchStart = '12:00', lunchMin = 30 } = {}) {
  for (let day = 1; day <= 5; day++) {
    insertAvail.run(paraId, day, start, end, breakStart, breakMin, lunchStart, lunchMin);
  }
}

// Maria: OT + Reading
const maria = insertPara.run(orgId, 'Maria Gonzalez', 'mgonzalez@demo-school.org', 'Para Instructor', '#E3A008')
  .lastInsertRowid;
seedParaWeek(maria);
insertSpecialty.run(maria, 'OT');
insertSpecialty.run(maria, 'Reading');

// James: Speech + Sped + PT
const james = insertPara.run(orgId, 'James Whitfield', 'jwhitfield@demo-school.org', 'Para Instructor', '#2E6F6E')
  .lastInsertRowid;
seedParaWeek(james, { start: '07:30', end: '14:30', breakStart: '09:30', breakMin: 15, lunchStart: '11:30', lunchMin: 30 });
insertSpecialty.run(james, 'Speech');
insertSpecialty.run(james, 'Sped');
insertSpecialty.run(james, 'PT');

// David: EL
const david = insertPara.run(orgId, 'David Chen', 'dchen@demo-school.org', 'Para Instructor', '#8A4FBF')
  .lastInsertRowid;
seedParaWeek(david, { start: '08:00', end: '14:00', breakStart: '10:30', breakMin: 15, lunchStart: '12:30', lunchMin: 30 });
insertSpecialty.run(david, 'EL');

const students = [
  ['Ethan Brooks', '3rd', 'Speech/language support, also receives OT \u2014 good cross-Para scheduling test case'],
  ['Ava Nguyen', '4th', 'Reading fluency support'],
  ['Liam Carter', '2nd', 'Sped support plus PT, both with James'],
  ['Sofia Ramirez', '5th', 'Reading intervention, small group friendly'],
  ['Noah Patel', '3rd', 'Reading intervention, small group friendly'],
  ['Isabella Kim', '1st', 'OT support, fine motor'],
  ['Mason Lee', '4th', 'Sped small group'],
  ['Chloe Adams', '2nd', 'Sped small group'],
  ['Maya Torres', '2nd', 'English Learner support'],
];
const studentIds = students.map(([name, grade, notes]) => insertStudent.run(orgId, name, grade, notes).lastInsertRowid);

// Ethan: Speech with James AND OT with Maria \u2014 the scheduler must never place these
// two specialties at overlapping times since they're two different Paras.
insertAssignment.run(orgId, james, studentIds[0], 'Speech', 150, 30, 15, '1:1', null, 1);
insertAssignment.run(orgId, maria, studentIds[0], 'OT', 60, 20, 15, '1:1', null, 2);

// Ava: Reading with Maria
insertAssignment.run(orgId, maria, studentIds[1], 'Reading', 120, 30, 20, '1:1', null, 2);

// Liam: Sped + PT, both with James
insertAssignment.run(orgId, james, studentIds[2], 'Sped', 200, 30, 20, '1:1', null, 1);
insertAssignment.run(orgId, james, studentIds[2], 'PT', 60, 30, 15, '1:1', null, 2);

// Sofia + Noah: Reading group with Maria
insertAssignment.run(orgId, maria, studentIds[3], 'Reading', 90, 30, 15, 'group', 'reading-grp-1', 3);
insertAssignment.run(orgId, maria, studentIds[4], 'Reading', 90, 30, 15, 'group', 'reading-grp-1', 3);

// Isabella: OT with Maria
insertAssignment.run(orgId, maria, studentIds[5], 'OT', 100, 20, 15, '1:1', null, 2);

// Mason + Chloe: Sped group with James
insertAssignment.run(orgId, james, studentIds[6], 'Sped', 60, 20, 15, 'group', 'sped-grp-1', 3);
insertAssignment.run(orgId, james, studentIds[7], 'Sped', 60, 20, 15, 'group', 'sped-grp-1', 3);

// Maya: EL with David
insertAssignment.run(orgId, david, studentIds[8], 'EL', 90, 30, 15, '1:1', null, 2);

console.log('Seeded demo org "Demo Unified School District".');
console.log('Login: ', email, ' / password: demo1234');
