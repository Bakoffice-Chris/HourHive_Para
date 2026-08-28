const API = '/api';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WORK_DAYS = [1, 2, 3, 4, 5];

let state = {
  token: localStorage.getItem('hh_token') || null,
  user: JSON.parse(localStorage.getItem('hh_user') || 'null'),
  view: 'dashboard',
  paras: [],
  students: [],
  assignments: [],
  scheduleWeek: null,
  runningTimers: {}, // key `${para_id}:${student_id}` -> log row
  weeklyActual: {}, // key `${para_id}:${student_id}` -> minutes
  timerTickHandle: null,
};

function timerKey(paraId, studentId) { return `${paraId}:${studentId}`; }

// ---------- API helper ----------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(API + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  setTimeout(() => (t.className = 'toast hidden'), 3200);
}

// ---------- Auth ----------
document.getElementById('showRegister').onclick = (e) => {
  e.preventDefault();
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('registerForm').classList.remove('hidden');
};
document.getElementById('showLogin').onclick = (e) => {
  e.preventDefault();
  document.getElementById('registerForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
};

document.getElementById('loginBtn').onclick = async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    onAuthed(data);
  } catch (e) {
    errEl.textContent = e.message;
  }
};

document.getElementById('registerBtn').onclick = async () => {
  const orgName = document.getElementById('regOrg').value.trim();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const errEl = document.getElementById('registerError');
  errEl.textContent = '';
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ orgName, name, email, password }),
    });
    onAuthed(data);
  } catch (e) {
    errEl.textContent = e.message;
  }
};

document.getElementById('logoutBtn').onclick = () => {
  localStorage.removeItem('hh_token');
  localStorage.removeItem('hh_user');
  state.token = null;
  state.user = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
};

function onAuthed(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('hh_token', data.token);
  localStorage.setItem('hh_user', JSON.stringify(data.user));
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('orgUserLabel').textContent = data.user.name;
  loadAll();
}

// ---------- Nav ----------
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.onclick = () => setView(btn.dataset.view);
});

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  const titles = {
    dashboard: 'Overview',
    paras: 'Para Instructors',
    students: 'Students',
    caseloads: 'Caseloads',
    schedule: 'Schedule',
    admin: 'Admin Report',
  };
  document.getElementById('viewTitle').textContent = titles[view];
  render();
}

async function loadAll() {
  try {
    const [paras, students, assignments, running, weekly] = await Promise.all([
      api('/paras'),
      api('/students'),
      api('/assignments'),
      api('/time-logs/running'),
      api('/time-logs/weekly-summary'),
    ]);
    state.paras = paras;
    state.students = students;
    state.assignments = assignments;
    state.runningTimers = {};
    running.forEach((r) => (state.runningTimers[timerKey(r.para_id, r.student_id)] = r));
    state.weeklyActual = {};
    weekly.summary.forEach((s) => (state.weeklyActual[timerKey(s.para_id, s.student_id)] = s.actual_minutes));
    startTimerTicker();
    render();
  } catch (e) {
    toast(e.message, true);
  }
}

function startTimerTicker() {
  if (state.timerTickHandle) return;
  state.timerTickHandle = setInterval(() => {
    document.querySelectorAll('.timer-elapsed[data-start]').forEach((el) => {
      const startedAt = new Date(el.dataset.start).getTime();
      const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const h = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
      const m = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
      const s = String(elapsedSec % 60).padStart(2, '0');
      el.textContent = `${h}:${m}:${s}`;
    });
  }, 1000);
}

function render() {
  const actions = document.getElementById('topbarActions');
  actions.innerHTML = '';
  const content = document.getElementById('content');
  content.innerHTML = '';

  if (state.view === 'dashboard') renderDashboard(content, actions);
  if (state.view === 'paras') renderParas(content, actions);
  if (state.view === 'students') renderStudents(content, actions);
  if (state.view === 'caseloads') renderCaseloads(content, actions);
  if (state.view === 'schedule') renderSchedule(content, actions);
  if (state.view === 'admin') renderAdmin(content, actions);
}

// ---------- Dashboard ----------
function renderDashboard(content, actions) {
  const totalMinutesRequired = state.assignments.reduce((s, a) => s + a.weekly_minutes, 0);
  content.innerHTML = `
    <p class="section-intro">A quick read on caseload coverage across your Para Instructor team. Generate a weekly schedule from the Schedule tab to see compliance below.</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${state.paras.length}</div><div class="stat-label">Para Instructors</div></div>
      <div class="stat-card"><div class="stat-value">${state.students.length}</div><div class="stat-label">Students</div></div>
      <div class="stat-card"><div class="stat-value">${state.assignments.length}</div><div class="stat-label">Caseload Assignments</div></div>
      <div class="stat-card"><div class="stat-value">${totalMinutesRequired.toLocaleString()}</div><div class="stat-label">Required Minutes / Week</div></div>
    </div>
    <div class="card">
      <h3>Getting started</h3>
      <ol style="margin:0;padding-left:20px;font-size:13.5px;line-height:2;color:var(--ink);">
        <li>Add your <strong>Para Instructors</strong> and set each one's weekly work hours, break, and lunch.</li>
        <li>Add <strong>Students</strong> and build each Para's <strong>Caseload</strong> — assign students with their required weekly service minutes.</li>
        <li>Go to <strong>Schedule</strong> and generate the week. The engine fills each Para's open time with student sessions until minute targets are met.</li>
      </ol>
    </div>
  `;
}

// ---------- Paras ----------
function renderParas(content, actions) {
  actions.innerHTML = `<button class="btn btn-amber" id="addParaBtn">+ Add Para Instructor</button>`;
  document.getElementById('addParaBtn').onclick = () => openParaModal();

  if (state.paras.length === 0) {
    content.innerHTML = emptyState('No Para Instructors yet', 'Add your first Para Instructor to start building caseloads.');
    return;
  }

  content.innerHTML = `
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Weekly Availability</th><th></th></tr></thead>
        <tbody>
          ${state.paras
            .map(
              (p) => `
            <tr>
              <td><span class="color-dot" style="background:${p.color}"></span>${p.name}</td>
              <td>${p.title || ''}</td>
              <td>${p.email || '—'}</td>
              <td>${summarizeAvailability(p.availability)}</td>
              <td class="table-actions">
                <button class="btn btn-outline btn-sm" data-avail="${p.id}">Set Hours</button>
                <button class="btn btn-outline btn-sm" data-edit="${p.id}">Edit</button>
                <button class="btn-danger-text" data-del="${p.id}">Remove</button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
  content.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openParaModal(findPara(b.dataset.edit))));
  content.querySelectorAll('[data-avail]').forEach((b) => (b.onclick = () => openAvailabilityModal(findPara(b.dataset.avail))));
  content.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => deletePara(b.dataset.del)));
}

function findPara(id) { return state.paras.find((p) => String(p.id) === String(id)); }
function findStudent(id) { return state.students.find((s) => String(s.id) === String(id)); }

function summarizeAvailability(avail) {
  if (!avail || avail.length === 0) return '<span style="color:var(--danger)">Not set</span>';
  const days = avail.map((a) => DAYS[a.day_of_week]).join('/');
  const sample = avail[0];
  return `${days} · ${sample.work_start}–${sample.work_end}`;
}

async function deletePara(id) {
  if (!confirm('Remove this Para Instructor? This also removes their caseload assignments.')) return;
  try {
    await api(`/paras/${id}`, { method: 'DELETE' });
    toast('Para Instructor removed');
    await loadAll();
    setView('paras');
  } catch (e) {
    toast(e.message, true);
  }
}

function openParaModal(para) {
  const isEdit = !!para;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Edit Para Instructor' : 'Add Para Instructor'}</h3>
      <div class="form-row"><label>Full name</label><input id="mName" value="${para?.name || ''}" placeholder="Maria Gonzalez" /></div>
      <div class="form-row"><label>Title</label><input id="mTitle" value="${para?.title || 'Para Instructor'}" /></div>
      <div class="form-row"><label>Email</label><input id="mEmail" value="${para?.email || ''}" placeholder="optional" /></div>
      <div class="form-row"><label>Calendar color</label><input id="mColor" type="color" value="${para?.color || '#E3A008'}" style="height:38px;padding:4px;" /></div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
        <button class="btn btn-amber" id="saveBtn">${isEdit ? 'Save changes' : 'Add Para Instructor'}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const payload = {
      name: backdrop.querySelector('#mName').value.trim(),
      title: backdrop.querySelector('#mTitle').value.trim(),
      email: backdrop.querySelector('#mEmail').value.trim(),
      color: backdrop.querySelector('#mColor').value,
    };
    if (!payload.name) return toast('Name is required', true);
    try {
      if (isEdit) await api(`/paras/${para.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/paras', { method: 'POST', body: JSON.stringify(payload) });
      backdrop.remove();
      toast(isEdit ? 'Para Instructor updated' : 'Para Instructor added');
      await loadAll();
      setView('paras');
    } catch (e) {
      toast(e.message, true);
    }
  };
}

function openAvailabilityModal(para) {
  const existing = {};
  (para.availability || []).forEach((a) => (existing[a.day_of_week] = a));

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="width:640px;">
      <h3>${para.name} — Weekly Hours</h3>
      <p class="field-hint" style="margin-bottom:14px;">Set work hours plus break and lunch for each day. The scheduler only places student sessions inside open time — never during breaks or lunch.</p>
      <div id="availDays"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
        <button class="btn btn-amber" id="saveBtn">Save hours</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const daysEl = backdrop.querySelector('#availDays');
  WORK_DAYS.forEach((d) => {
    const e = existing[d];
    const enabled = !!e;
    const row = document.createElement('div');
    row.className = 'avail-day' + (enabled ? '' : ' disabled');
    row.dataset.day = d;
    row.innerHTML = `
      <div class="avail-toggle">
        <input type="checkbox" class="day-enable" ${enabled ? 'checked' : ''} />
        <span class="day-label">${DAYS[d]}</span>
      </div>
      <div>
        <span class="time-pair-label">Work hours</span>
        <div class="time-pair">
          <input type="time" class="f-start" value="${e?.work_start || '08:00'}" />
          <span>–</span>
          <input type="time" class="f-end" value="${e?.work_end || '15:00'}" />
        </div>
      </div>
      <div>
        <span class="time-pair-label">Break (min)</span>
        <div class="time-pair">
          <input type="time" class="f-break-start" value="${e?.break_start || '10:00'}" />
          <input type="number" class="f-break-min" value="${e?.break_minutes ?? 15}" min="0" style="width:60px;" />
        </div>
      </div>
      <div>
        <span class="time-pair-label">Lunch (min)</span>
        <div class="time-pair">
          <input type="time" class="f-lunch-start" value="${e?.lunch_start || '12:00'}" />
          <input type="number" class="f-lunch-min" value="${e?.lunch_minutes ?? 30}" min="0" style="width:60px;" />
        </div>
      </div>
    `;
    row.querySelector('.day-enable').onchange = (ev) => row.classList.toggle('disabled', !ev.target.checked);
    daysEl.appendChild(row);
  });

  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const days = [];
    daysEl.querySelectorAll('.avail-day').forEach((row) => {
      if (!row.querySelector('.day-enable').checked) return;
      days.push({
        day_of_week: Number(row.dataset.day),
        work_start: row.querySelector('.f-start').value,
        work_end: row.querySelector('.f-end').value,
        break_start: row.querySelector('.f-break-start').value,
        break_minutes: Number(row.querySelector('.f-break-min').value) || 0,
        lunch_start: row.querySelector('.f-lunch-start').value,
        lunch_minutes: Number(row.querySelector('.f-lunch-min').value) || 0,
      });
    });
    try {
      await api(`/paras/${para.id}/availability`, { method: 'PUT', body: JSON.stringify({ days }) });
      backdrop.remove();
      toast('Weekly hours saved');
      await loadAll();
      setView('paras');
    } catch (e) {
      toast(e.message, true);
    }
  };
}

// ---------- Students ----------
function renderStudents(content, actions) {
  actions.innerHTML = `
    <button class="btn btn-outline" id="importStudentsBtn">Import CSV</button>
    <button class="btn btn-amber" id="addStudentBtn">+ Add Student</button>
  `;
  document.getElementById('addStudentBtn').onclick = () => openStudentModal();
  document.getElementById('importStudentsBtn').onclick = () => openImportModal();

  if (state.students.length === 0) {
    content.innerHTML = emptyState('No students yet', 'Add students to begin assigning caseloads.');
    return;
  }

  content.innerHTML = `
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Grade</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          ${state.students
            .map(
              (s) => `
            <tr>
              <td>${s.name}</td>
              <td>${s.grade || '—'}</td>
              <td style="color:var(--ink-soft)">${s.iep_notes || ''}</td>
              <td class="table-actions">
                <button class="btn btn-outline btn-sm" data-notes="${s.id}">Case Notes</button>
                <button class="btn btn-outline btn-sm" data-edit="${s.id}">Edit</button>
                <button class="btn-danger-text" data-del="${s.id}">Remove</button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
  content.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openStudentModal(findStudent(b.dataset.edit))));
  content.querySelectorAll('[data-notes]').forEach((b) => (b.onclick = () => openNotesModal(findStudent(b.dataset.notes))));
  content.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => deleteStudent(b.dataset.del)));
}

async function deleteStudent(id) {
  if (!confirm('Remove this student? This also removes their caseload assignments.')) return;
  try {
    await api(`/students/${id}`, { method: 'DELETE' });
    toast('Student removed');
    await loadAll();
    setView('students');
  } catch (e) {
    toast(e.message, true);
  }
}

function openStudentModal(student) {
  const isEdit = !!student;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Edit Student' : 'Add Student'}</h3>
      <div class="form-row"><label>Full name</label><input id="mName" value="${student?.name || ''}" placeholder="Ethan Brooks" /></div>
      <div class="form-row"><label>Grade</label><input id="mGrade" value="${student?.grade || ''}" placeholder="3rd" /></div>
      <div class="form-row"><label>Notes (optional)</label><textarea id="mNotes" rows="3" placeholder="Service notes, e.g. speech/language support">${student?.iep_notes || ''}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
        <button class="btn btn-amber" id="saveBtn">${isEdit ? 'Save changes' : 'Add Student'}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const payload = {
      name: backdrop.querySelector('#mName').value.trim(),
      grade: backdrop.querySelector('#mGrade').value.trim(),
      iep_notes: backdrop.querySelector('#mNotes').value.trim(),
    };
    if (!payload.name) return toast('Name is required', true);
    try {
      if (isEdit) await api(`/students/${student.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/students', { method: 'POST', body: JSON.stringify(payload) });
      backdrop.remove();
      toast(isEdit ? 'Student updated' : 'Student added');
      await loadAll();
      setView('students');
    } catch (e) {
      toast(e.message, true);
    }
  };
}

function openImportModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Import Students from CSV</h3>
      <p class="field-hint" style="margin-bottom:14px;">
        First row must be a header with at least a <strong>Name</strong> column. <strong>Grade</strong> and
        <strong>Notes</strong> columns are optional and picked up automatically if present.
        Students already on your roster (matched by name) are skipped, not duplicated.
      </p>
      <p class="field-hint" style="margin-bottom:16px;">
        <a href="/api/students/import/template" id="templateLink" style="color:var(--amber-deep);font-weight:700;">Download a template CSV</a>
      </p>
      <div class="form-row">
        <label>CSV file</label>
        <input type="file" id="csvFile" accept=".csv,text/csv" />
      </div>
      <div id="importResult"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
        <button class="btn btn-amber" id="importBtn">Import</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  // The template download needs the auth token, so fetch it as a blob rather than a plain link nav.
  backdrop.querySelector('#templateLink').onclick = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(API + '/students/import/template', {
        headers: { Authorization: 'Bearer ' + state.token },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'students-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast('Could not download template', true);
    }
  };

  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#importBtn').onclick = async () => {
    const fileInput = backdrop.querySelector('#csvFile');
    const resultEl = backdrop.querySelector('#importResult');
    const file = fileInput.files[0];
    if (!file) return toast('Choose a CSV file first', true);

    const importBtn = backdrop.querySelector('#importBtn');
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';
    resultEl.innerHTML = '';

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(API + '/students/import', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.token },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      resultEl.innerHTML = `
        <div class="card" style="background:var(--paper-2);box-shadow:none;margin-top:4px;margin-bottom:0;">
          <div style="font-weight:700;color:var(--navy);margin-bottom:6px;">
            Imported ${data.imported} of ${data.total_rows} row${data.total_rows === 1 ? '' : 's'}
          </div>
          <div style="font-size:12.5px;color:var(--ink-soft);">
            ${data.skipped_duplicates ? `${data.skipped_duplicates} skipped (already on roster). ` : ''}
            ${data.skipped_blank ? `${data.skipped_blank} skipped (blank name). ` : ''}
            ${!data.skipped_duplicates && !data.skipped_blank ? 'No rows were skipped.' : ''}
          </div>
        </div>
      `;
      toast(`${data.imported} student${data.imported === 1 ? '' : 's'} imported`);
      await loadAll();
      setView('students');
      // Leave the result summary visible for a moment rather than closing immediately.
      setTimeout(() => backdrop.remove(), 1800);
    } catch (e) {
      toast(e.message, true);
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = 'Import';
    }
  };
}

function openNotesModal(student) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="width:520px;">
      <h3>${student.name} — Case Notes</h3>
      <div class="form-row">
        <textarea id="newNote" rows="3" placeholder="Add a dated note — progress, incidents, parent contact, anything worth logging..."></textarea>
      </div>
      <div class="modal-actions" style="margin-top:0;margin-bottom:18px;">
        <button class="btn btn-amber" id="addNoteBtn">Add note</button>
      </div>
      <div id="notesList" style="max-height:320px;overflow-y:auto;"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="closeBtn">Close</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#closeBtn').onclick = () => backdrop.remove();

  async function loadNotes() {
    const listEl = backdrop.querySelector('#notesList');
    listEl.innerHTML = '<p style="color:var(--ink-soft);font-size:13px;">Loading…</p>';
    try {
      const notes = await api(`/students/${student.id}/notes`);
      if (notes.length === 0) {
        listEl.innerHTML = '<p style="color:var(--ink-soft);font-size:13px;">No case notes yet.</p>';
        return;
      }
      listEl.innerHTML = notes
        .map(
          (n) => `
        <div style="border-bottom:1px solid var(--paper-2);padding:10px 0;">
          <div style="font-size:11.5px;color:var(--ink-soft);margin-bottom:4px;display:flex;justify-content:space-between;">
            <span>${n.author ? n.author + ' · ' : ''}${new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</span>
            <button class="btn-danger-text" data-del-note="${n.id}" style="font-size:11px;">Delete</button>
          </div>
          <div style="font-size:13.5px;color:var(--ink);white-space:pre-wrap;">${n.note}</div>
        </div>`
        )
        .join('');
      listEl.querySelectorAll('[data-del-note]').forEach(
        (b) =>
          (b.onclick = async () => {
            if (!confirm('Delete this note?')) return;
            try {
              await api(`/students/${student.id}/notes/${b.dataset.delNote}`, { method: 'DELETE' });
              loadNotes();
            } catch (e) {
              toast(e.message, true);
            }
          })
      );
    } catch (e) {
      listEl.innerHTML = `<p style="color:var(--danger);font-size:13px;">${e.message}</p>`;
    }
  }

  backdrop.querySelector('#addNoteBtn').onclick = async () => {
    const textEl = backdrop.querySelector('#newNote');
    const note = textEl.value.trim();
    if (!note) return toast('Write something first', true);
    try {
      await api(`/students/${student.id}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
      textEl.value = '';
      toast('Note added');
      loadNotes();
    } catch (e) {
      toast(e.message, true);
    }
  };

  loadNotes();
}

// ---------- Caseloads ----------
function renderCaseloads(content, actions) {
  actions.innerHTML = `<button class="btn btn-amber" id="addAssignBtn">+ Assign Student</button>`;
  document.getElementById('addAssignBtn').onclick = () => openAssignmentModal();

  if (state.paras.length === 0 || state.students.length === 0) {
    content.innerHTML = emptyState('Add Para Instructors and Students first', 'Once you have both, you can build caseloads by assigning students to a Para with their required weekly minutes.');
    return;
  }

  if (state.assignments.length === 0) {
    content.innerHTML = emptyState('No caseload assignments yet', 'Assign students to a Para Instructor with their weekly service-minute requirement.');
    return;
  }

  const byPara = {};
  state.assignments.forEach((a) => {
    byPara[a.para_id] = byPara[a.para_id] || [];
    byPara[a.para_id].push(a);
  });

  content.innerHTML = Object.entries(byPara)
    .map(([paraId, list]) => {
      const total = list.reduce((s, a) => s + a.weekly_minutes, 0);
      return `
      <div class="card">
        <h3>${list[0].para_name} <span style="color:var(--ink-soft);font-weight:500;font-size:13px;">— ${total} min/week caseload total</span></h3>
        <table>
          <thead><tr><th>Student</th><th>Weekly Minutes</th><th>Session Length</th><th>Type</th><th>Live Clock</th><th></th></tr></thead>
          <tbody>
            ${list
              .map((a) => {
                const key = timerKey(a.para_id, a.student_id);
                const running = state.runningTimers[key];
                const actual = state.weeklyActual[key] || 0;
                const pct = Math.min(100, Math.round((actual / a.weekly_minutes) * 100));
                const timerCell = running
                  ? `<div style="display:flex;align-items:center;gap:8px;">
                       <span class="timer-elapsed mono" data-start="${running.start_at}" style="font-weight:700;color:var(--success);">00:00:00</span>
                       <button class="btn btn-sm" style="background:var(--danger-bg);color:var(--danger);border-color:transparent;" data-stop="${running.id}">Stop</button>
                     </div>`
                  : `<button class="btn btn-outline btn-sm" data-start-para="${a.para_id}" data-start-student="${a.student_id}">▶ Start</button>`;
                return `
              <tr>
                <td>${a.student_name}</td>
                <td class="mono">${a.weekly_minutes} min</td>
                <td class="mono">${a.session_length} min (min ${a.min_session_length})</td>
                <td>${a.service_type === 'group' ? `<span class="badge badge-group">Group · ${a.group_tag}</span>` : '<span class="badge badge-11">1:1</span>'}</td>
                <td>
                  ${timerCell}
                  <div style="font-size:11px;color:var(--ink-soft);margin-top:5px;">
                    <span class="mono" style="color:${pct >= 100 ? 'var(--success)' : 'var(--ink-soft)'};font-weight:700;">${actual}</span> / ${a.weekly_minutes} min this week
                  </div>
                </td>
                <td class="table-actions">
                  <button class="btn btn-outline btn-sm" data-edit="${a.id}">Edit</button>
                  <button class="btn-danger-text" data-del="${a.id}">Remove</button>
                </td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>`;
    })
    .join('');

  content.querySelectorAll('[data-edit]').forEach(
    (b) => (b.onclick = () => openAssignmentModal(state.assignments.find((a) => String(a.id) === b.dataset.edit)))
  );
  content.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => deleteAssignment(b.dataset.del)));
  content.querySelectorAll('[data-start-para]').forEach(
    (b) => (b.onclick = () => startClock(Number(b.dataset.startPara), Number(b.dataset.startStudent)))
  );
  content.querySelectorAll('[data-stop]').forEach((b) => (b.onclick = () => stopClock(b.dataset.stop)));
}

async function startClock(paraId, studentId) {
  try {
    await api('/time-logs/start', { method: 'POST', body: JSON.stringify({ para_id: paraId, student_id: studentId }) });
    toast('Clock started');
    await loadAll();
    setView('caseloads');
  } catch (e) {
    toast(e.message, true);
    // A 409 (already running elsewhere/stale state) still warrants a refresh to resync.
    await loadAll();
    setView('caseloads');
  }
}

async function stopClock(logId) {
  try {
    const result = await api(`/time-logs/${logId}/stop`, { method: 'POST' });
    toast(`Clock stopped — ${result.log.minutes} min logged`);
    await loadAll();
    setView('caseloads');
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteAssignment(id) {
  if (!confirm('Remove this student from the caseload?')) return;
  try {
    await api(`/assignments/${id}`, { method: 'DELETE' });
    toast('Assignment removed');
    await loadAll();
    setView('caseloads');
  } catch (e) {
    toast(e.message, true);
  }
}

function openAssignmentModal(assignment) {
  const isEdit = !!assignment;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Edit Caseload Assignment' : 'Assign Student to a Para'}</h3>
      <div class="form-row">
        <label>Para Instructor</label>
        <select id="mPara" ${isEdit ? 'disabled' : ''}>
          ${state.paras.map((p) => `<option value="${p.id}" ${assignment?.para_id === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Student</label>
        <select id="mStudent" ${isEdit ? 'disabled' : ''}>
          ${state.students.map((s) => `<option value="${s.id}" ${assignment?.student_id === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-row"><label>Required minutes per week</label><input id="mMinutes" type="number" min="1" value="${assignment?.weekly_minutes || 60}" /></div>
      <div class="form-grid-2">
        <div class="form-row"><label>Preferred session length (min)</label><input id="mSessLen" type="number" min="5" value="${assignment?.session_length || 30}" /></div>
        <div class="form-row"><label>Minimum session length (min)</label><input id="mMinLen" type="number" min="5" value="${assignment?.min_session_length || 15}" /></div>
      </div>
      <div class="form-row">
        <label>Service type</label>
        <select id="mType">
          <option value="1:1" ${assignment?.service_type === '1:1' ? 'selected' : ''}>1:1 (individual)</option>
          <option value="group" ${assignment?.service_type === 'group' ? 'selected' : ''}>Small group</option>
        </select>
      </div>
      <div class="form-row hidden" id="groupTagRow">
        <label>Group tag</label>
        <input id="mGroupTag" value="${assignment?.group_tag || ''}" placeholder="e.g. math-grp-1" />
        <div class="field-hint">Students with the same Para and the same group tag are scheduled together in one time block.</div>
      </div>
      <div class="form-row">
        <label>Priority</label>
        <select id="mPriority">
          <option value="1" ${assignment?.priority === 1 ? 'selected' : ''}>1 — Highest (schedule first)</option>
          <option value="2" ${assignment?.priority === 2 ? 'selected' : ''}>2</option>
          <option value="3" ${!assignment || assignment?.priority === 3 ? 'selected' : ''}>3 — Standard</option>
          <option value="4" ${assignment?.priority === 4 ? 'selected' : ''}>4</option>
          <option value="5" ${assignment?.priority === 5 ? 'selected' : ''}>5 — Lowest</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
        <button class="btn btn-amber" id="saveBtn">${isEdit ? 'Save changes' : 'Add to caseload'}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const typeSel = backdrop.querySelector('#mType');
  const groupRow = backdrop.querySelector('#groupTagRow');
  const syncGroupRow = () => groupRow.classList.toggle('hidden', typeSel.value !== 'group');
  typeSel.onchange = syncGroupRow;
  syncGroupRow();

  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const payload = {
      para_id: Number(backdrop.querySelector('#mPara').value),
      student_id: Number(backdrop.querySelector('#mStudent').value),
      weekly_minutes: Number(backdrop.querySelector('#mMinutes').value),
      session_length: Number(backdrop.querySelector('#mSessLen').value),
      min_session_length: Number(backdrop.querySelector('#mMinLen').value),
      service_type: typeSel.value,
      group_tag: typeSel.value === 'group' ? backdrop.querySelector('#mGroupTag').value.trim() : null,
      priority: Number(backdrop.querySelector('#mPriority').value),
    };
    if (payload.service_type === 'group' && !payload.group_tag) return toast('Group tag is required for group sessions', true);
    try {
      if (isEdit) await api(`/assignments/${assignment.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/assignments', { method: 'POST', body: JSON.stringify(payload) });
      backdrop.remove();
      toast(isEdit ? 'Assignment updated' : 'Student added to caseload');
      await loadAll();
      setView('caseloads');
    } catch (e) {
      toast(e.message, true);
    }
  };
}

// ---------- Schedule ----------
function nextMonday(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function renderSchedule(content, actions) {
  actions.innerHTML = '';
  const weekStart = state.scheduleWeek || nextMonday();
  content.innerHTML = `
    <div class="schedule-toolbar">
      <label style="font-size:13px;font-weight:700;color:var(--ink-soft);">Week of
        <input type="date" id="weekPicker" value="${weekStart}" style="margin-left:8px;" />
      </label>
      <button class="btn btn-amber" id="genBtn">Generate schedule</button>
      <span style="color:var(--ink-soft);font-size:12.5px;">Fills open Para time with student sessions until weekly minute targets are met.</span>
    </div>
    <div id="scheduleBody"></div>
  `;
  document.getElementById('weekPicker').onchange = (e) => {
    state.scheduleWeek = nextMonday(e.target.value);
    renderSchedule(content, actions);
  };
  document.getElementById('genBtn').onclick = async () => {
    const btn = document.getElementById('genBtn');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      await api('/schedule/generate', { method: 'POST', body: JSON.stringify({ week_start_date: weekStart }) });
      toast('Schedule generated');
      await loadSchedule(weekStart);
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate schedule';
    }
  };
  await loadSchedule(weekStart);
}

async function loadSchedule(weekStart) {
  const body = document.getElementById('scheduleBody');
  try {
    const data = await api(`/schedule?week_start_date=${weekStart}`);
    renderScheduleBody(body, data);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderScheduleBody(body, data) {
  if (!data.sessions || data.sessions.length === 0) {
    body.innerHTML = emptyState('No schedule generated for this week', 'Click "Generate schedule" once your Paras have hours set and caseloads assigned.');
    return;
  }

  const compliance = data.compliance || [];
  const met = compliance.filter((c) => c.status === 'met').length;
  const partial = compliance.filter((c) => c.status === 'partial').length;
  const unmet = compliance.filter((c) => c.status === 'unmet').length;

  const paraIds = [...new Set(data.sessions.map((s) => s.para_id))];

  let html = `
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:22px;">
      <div class="stat-card"><div class="stat-value">${met}</div><div class="stat-label">Students fully served</div></div>
      <div class="stat-card ${partial ? 'warn' : ''}"><div class="stat-value">${partial}</div><div class="stat-label">Partially served</div></div>
      <div class="stat-card ${unmet ? 'danger' : ''}"><div class="stat-value">${unmet}</div><div class="stat-label">Unscheduled</div></div>
    </div>
  `;

  if (partial || unmet) {
    html += `<div class="card">
      <h3>Compliance flags</h3>
      <table>
        <thead><tr><th>Student</th><th>Para</th><th>Scheduled / Required</th><th>Status</th></tr></thead>
        <tbody>
          ${compliance
            .filter((c) => c.status !== 'met')
            .map(
              (c) => `<tr>
                <td>${c.student_name}</td>
                <td>${c.para_name}</td>
                <td class="mono">${c.scheduled_minutes} / ${c.target_minutes} min</td>
                <td><span class="badge badge-${c.status}">${c.status === 'partial' ? 'Partial' : 'Unmet'}</span></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="field-hint" style="margin-top:12px;">Unmet minutes usually mean the Para doesn't have enough open weekly hours for this caseload. Add hours, rebalance the caseload, or allow shorter minimum session lengths.</p>
    </div>`;
  }

  html += `<div class="week-grid">
    <div class="week-grid-head">Para Instructor</div>
    ${WORK_DAYS.map((d) => `<div class="week-grid-head">${DAYS[d]}</div>`).join('')}
    ${paraIds
      .map((pid) => {
        const sessionsForPara = data.sessions.filter((s) => s.para_id === pid);
        const paraName = sessionsForPara[0].para_name;
        return `
        <div class="para-row-label">${paraName}</div>
        ${WORK_DAYS.map((d) => {
          const daySessions = sessionsForPara
            .filter((s) => s.day_of_week === d)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));
          return `<div class="para-day-cell">
            ${daySessions
              .map(
                (s) => `<div class="session-chip ${s.service_type === 'group' ? 'group-chip' : ''}">
                  <div class="chip-time">${s.start_time}–${s.end_time}</div>
                  <div class="chip-name">${s.student_name}</div>
                </div>`
              )
              .join('') || '<span style="color:var(--line);font-size:11px;">—</span>'}
          </div>`;
        }).join('')}
        `;
      })
      .join('')}
  </div>`;

  body.innerHTML = html;
}

// ---------- Admin Report ----------
function addDaysISO(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(mondayStr) {
  const start = new Date(mondayStr + 'T00:00:00Z');
  const end = new Date(addDaysISO(mondayStr, 4) + 'T00:00:00Z');
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return `${start.toLocaleDateString('en-US', opts)} \u2013 ${end.toLocaleDateString('en-US', opts)}`;
}

async function renderAdmin(content, actions) {
  actions.innerHTML = '';
  content.innerHTML = `<p class="section-intro">Actual clocked minutes vs. weekly targets, for this week and last week, pulled from the Caseloads live clock.</p>
    <div id="adminCurrentWeek"></div>
    <div id="adminPriorWeek"></div>`;

  const currentMonday = nextMonday();
  const priorMonday = addDaysISO(currentMonday, -7);

  try {
    const [current, prior] = await Promise.all([
      api(`/time-logs/admin-summary?week_start_date=${currentMonday}`),
      api(`/time-logs/admin-summary?week_start_date=${priorMonday}`),
    ]);
    document.getElementById('adminCurrentWeek').innerHTML = renderAdminTable(
      `This Week \u2014 ${formatWeekLabel(current.week_start_date)}`,
      current.rows
    );
    document.getElementById('adminPriorWeek').innerHTML = renderAdminTable(
      `Last Week \u2014 ${formatWeekLabel(prior.week_start_date)}`,
      prior.rows
    );
  } catch (e) {
    toast(e.message, true);
  }
}

function renderAdminTable(title, rows) {
  if (!rows || rows.length === 0) {
    return `<div class="card"><h3>${title}</h3><p style="color:var(--ink-soft);font-size:13px;">No caseload assignments yet.</p></div>`;
  }
  const sorted = [...rows].sort((a, b) => a.student_name.localeCompare(b.student_name));
  return `
    <div class="card">
      <h3>${title}</h3>
      <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Grade</th><th>% of Weekly Goal</th><th>Total Weekly Minutes</th><th>Target Weekly Minutes</th>
            <th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th>
          </tr>
        </thead>
        <tbody>
          ${sorted
            .map((r) => {
              const pctClass = r.pct_of_goal >= 100 ? 'badge-met' : r.pct_of_goal > 0 ? 'badge-partial' : 'badge-unmet';
              return `
              <tr>
                <td><strong>${r.student_name}</strong><div style="font-size:11px;color:var(--ink-soft);">${r.para_name}</div></td>
                <td>${r.grade || '\u2014'}</td>
                <td><span class="badge ${pctClass}">${r.pct_of_goal}%</span></td>
                <td class="mono">${r.actual_minutes} min</td>
                <td class="mono">${r.target_minutes} min</td>
                <td style="font-size:11.5px;color:var(--ink-soft);white-space:nowrap;">${r.days.mon || '\u2014'}</td>
                <td style="font-size:11.5px;color:var(--ink-soft);white-space:nowrap;">${r.days.tue || '\u2014'}</td>
                <td style="font-size:11.5px;color:var(--ink-soft);white-space:nowrap;">${r.days.wed || '\u2014'}</td>
                <td style="font-size:11.5px;color:var(--ink-soft);white-space:nowrap;">${r.days.thu || '\u2014'}</td>
                <td style="font-size:11.5px;color:var(--ink-soft);white-space:nowrap;">${r.days.fri || '\u2014'}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      </div>
    </div>`;
}

function emptyState(title, sub) {
  return `<div class="empty-state">
    <svg class="hive-mark" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 2 L44 13 V35 L24 46 L4 35 V13 Z" stroke="var(--navy)" stroke-width="2.5"/>
      <path d="M24 12 L34 18 V30 L24 36 L14 30 V18 Z" fill="var(--navy)"/>
    </svg>
    <div style="font-weight:700;color:var(--navy);margin-bottom:4px;">${title}</div>
    <div style="font-size:13px;max-width:420px;margin:0 auto;">${sub}</div>
  </div>`;
}

// ---------- Boot ----------
if (state.token && state.user) {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('orgUserLabel').textContent = state.user.name;
  loadAll();
}
