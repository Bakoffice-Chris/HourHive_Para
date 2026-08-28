const API = '/api';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WORK_DAYS = [1, 2, 3, 4, 5];
const SPECIALTIES = ['OT', 'PT', 'Speech', 'EL', 'Sped', 'Reading'];

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

function timerKey(paraId, studentId, specialty) { return `${paraId}:${studentId}:${specialty || ''}`; }

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
    running.forEach((r) => (state.runningTimers[timerKey(r.para_id, r.student_id, r.specialty)] = r));
    state.weeklyActual = {};
    weekly.summary.forEach((s) => (state.weeklyActual[timerKey(s.para_id, s.student_id, s.specialty)] = s.actual_minutes));
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
        <thead><tr><th>Name</th><th>Title</th><th>Specialties</th><th>Email</th><th>Weekly Availability</th><th></th></tr></thead>
        <tbody>
          ${state.paras
            .map(
              (p) => `
            <tr>
              <td><span class="color-dot" style="background:${p.color}"></span>${p.name}</td>
              <td>${p.title || ''}</td>
              <td>${summarizeSpecialties(p.specialties)}</td>
              <td>${p.email || '—'}</td>
              <td>${summarizeAvailability(p.availability)}</td>
              <td class="table-actions">
                <button class="btn btn-outline btn-sm" data-specialties="${p.id}">Specialties</button>
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
  content.querySelectorAll('[data-specialties]').forEach((b) => (b.onclick = () => openParaSpecialtiesModal(findPara(b.dataset.specialties))));
  content.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => deletePara(b.dataset.del)));
}

function findPara(id) { return state.paras.find((p) => String(p.id) === String(id)); }
function findStudent(id) { return state.students.find((s) => String(s.id) === String(id)); }

function summarizeSpecialties(specialties) {
  if (!specialties || specialties.length === 0) return '<span style="color:var(--danger);font-size:12px;">None assigned</span>';
  return specialties.map((s) => `<span class="badge badge-group" style="margin-right:4px;">${s}</span>`).join('');
}

function summarizeAvailability(avail) {
  if (!avail || avail.length === 0) return '<span style="color:var(--danger)">Not set</span>';
  const days = avail.map((a) => DAYS[a.day_of_week]).join('/');
  const sample = avail[0];
  return `${days} · ${sample.work_start}–${sample.work_end}`;
}

function openParaSpecialtiesModal(para) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${para.name} — Specialties</h3>
      <p class="field-hint" style="margin-bottom:14px;">
        Which IEP specialties is this Para qualified/assigned to deliver? Caseload assignments and the
        auto-scheduler only match students to this Para for the specialties checked here.
      </p>
      <div id="specialtyChecks" style="margin-bottom:8px;">
        ${SPECIALTIES.map(
          (s) => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px;font-weight:600;color:var(--ink);">
            <input type="checkbox" value="${s}" ${(para.specialties || []).includes(s) ? 'checked' : ''} /> ${s}
          </label>`
        ).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
        <button class="btn btn-amber" id="saveBtn">Save specialties</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const specialties = [...backdrop.querySelectorAll('#specialtyChecks input:checked')].map((c) => c.value);
    try {
      await api(`/paras/${para.id}/specialties`, { method: 'PUT', body: JSON.stringify({ specialties }) });
      backdrop.remove();
      toast('Specialties saved');
      await loadAll();
      setView('paras');
    } catch (e) {
      toast(e.message, true);
    }
  };
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
        <thead><tr><th>Name</th><th>Grade</th><th>Specialty / Para</th><th>Weekly Target</th><th>Availability</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          ${state.students
            .map(
              (s) => `
            <tr>
              <td>${s.name}</td>
              <td>${s.grade || '—'}</td>
              <td>${summarizeStudentAssignments(s.id)}</td>
              <td class="mono">${s.target_weekly_minutes ? s.target_weekly_minutes + ' min' : '—'}</td>
              <td>${summarizeStudentAvailability(s.availability)}</td>
              <td style="color:var(--ink-soft)">${s.iep_notes || ''}</td>
              <td class="table-actions">
                <button class="btn btn-outline btn-sm" data-avail="${s.id}">Availability</button>
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
  content.querySelectorAll('[data-avail]').forEach((b) => (b.onclick = () => openStudentAvailabilityModal(findStudent(b.dataset.avail))));
  content.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => deleteStudent(b.dataset.del)));
}

function summarizeStudentAssignments(studentId) {
  const list = state.assignments.filter((a) => a.student_id === studentId);
  if (list.length === 0) {
    return '<span style="color:var(--danger);font-size:12px;font-weight:700;">Not assigned</span>';
  }
  return list
    .map((a) => `<span class="badge badge-group" style="margin:0 4px 3px 0;">${a.specialty || '?'} \u00b7 ${a.para_name}</span>`)
    .join('');
}

function summarizeStudentAvailability(avail) {
  if (!avail || avail.length === 0) return '<span style="color:var(--ink-soft);font-size:12px;">Unrestricted</span>';
  const days = [...new Set(avail.map((a) => DAYS[a.day_of_week]))].join('/');
  return `<span style="font-size:12px;">${days} \u00b7 ${avail.length} window${avail.length === 1 ? '' : 's'}</span>`;
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
    <div class="modal" style="width:520px;">
      <h3>${isEdit ? 'Edit Student' : 'Add Student'}</h3>
      <div class="form-row"><label>Full name</label><input id="mName" value="${student?.name || ''}" placeholder="Ethan Brooks" /></div>
      <div class="form-row"><label>Grade</label><input id="mGrade" value="${student?.grade || ''}" placeholder="3rd" /></div>
      <div class="form-row">
        <label>Required weekly minutes (IEP minimum)</label>
        <input id="mTargetMinutes" type="number" min="1" value="${student?.target_weekly_minutes || ''}" placeholder="e.g. 150" />
        <div class="field-hint">Used as the default when you assign this student to a Para's caseload \u2014 the actual scheduling target still lives on that caseload assignment (a student can have more than one).</div>
      </div>
      <div class="form-row"><label>Notes (optional)</label><textarea id="mNotes" rows="3" placeholder="Service notes, e.g. speech/language support">${student?.iep_notes || ''}</textarea></div>
      ${
        isEdit
          ? `<div class="form-row" style="border-top:1px solid var(--line);padding-top:14px;">
               <label style="display:flex;align-items:center;justify-content:space-between;">
                 Specialty Assignments
                 <button class="btn btn-outline btn-sm" id="addSpecialtyBtn" type="button">+ Add Specialty</button>
               </label>
               <div id="studentAssignmentsList" style="margin-top:8px;"></div>
             </div>`
          : `<p class="field-hint">You'll be able to assign a specialty and Para once this student is saved.</p>`
      }
      <div class="modal-actions">
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
        <button class="btn btn-amber" id="saveBtn">${isEdit ? 'Save changes' : 'Add Student'}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  if (isEdit) {
    const listEl = backdrop.querySelector('#studentAssignmentsList');
    renderStudentAssignmentsList(listEl, student.id);
    backdrop.querySelector('#addSpecialtyBtn').onclick = () => {
      openAssignmentModal(null, {
        presetStudentId: student.id,
        onSaved: () => renderStudentAssignmentsList(listEl, student.id),
      });
    };
  }

  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const payload = {
      name: backdrop.querySelector('#mName').value.trim(),
      grade: backdrop.querySelector('#mGrade').value.trim(),
      iep_notes: backdrop.querySelector('#mNotes').value.trim(),
      target_weekly_minutes: Number(backdrop.querySelector('#mTargetMinutes').value) || null,
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

function renderStudentAssignmentsList(container, studentId) {
  const list = state.assignments.filter((a) => a.student_id === studentId);
  if (list.length === 0) {
    container.innerHTML = `<p style="color:var(--danger);font-size:12.5px;margin:0;">No specialty assigned yet \u2014 this student won't appear in generated schedules until you add one.</p>`;
    return;
  }
  container.innerHTML = list
    .map(
      (a) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--paper-2);border-radius:7px;margin-bottom:6px;">
        <div style="font-size:12.5px;">
          <span class="badge badge-group">${a.specialty || '\u2014'}</span>
          <strong style="margin-left:6px;">${a.para_name}</strong>
          <span class="mono" style="color:var(--ink-soft);margin-left:6px;">${a.weekly_minutes} min/wk</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-outline btn-sm" data-edit-assign="${a.id}" type="button">Edit</button>
          <button class="btn-danger-text" data-del-assign="${a.id}" type="button">Remove</button>
        </div>
      </div>`
    )
    .join('');

  container.querySelectorAll('[data-edit-assign]').forEach((b) => {
    b.onclick = () => {
      const assignment = state.assignments.find((a) => String(a.id) === b.dataset.editAssign);
      openAssignmentModal(assignment, { onSaved: () => renderStudentAssignmentsList(container, studentId) });
    };
  });
  container.querySelectorAll('[data-del-assign]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Remove this specialty assignment?')) return;
      try {
        await api(`/assignments/${b.dataset.delAssign}`, { method: 'DELETE' });
        toast('Assignment removed');
        await loadAll();
        renderStudentAssignmentsList(container, studentId);
      } catch (e) {
        toast(e.message, true);
      }
    };
  });
}

function openStudentAvailabilityModal(student) {
  const existingByDay = {};
  (student.availability || []).forEach((a) => {
    existingByDay[a.day_of_week] = existingByDay[a.day_of_week] || [];
    existingByDay[a.day_of_week].push(a);
  });

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="width:600px;">
      <h3>${student.name} — Available Times</h3>
      <p class="field-hint" style="margin-bottom:14px;">
        Add one or more windows per day when this student can be pulled for services (e.g. free periods).
        The scheduler only places sessions where the Para is free <strong>and</strong> the student is free.
        <strong>Leave every day empty to leave this student unrestricted</strong> \u2014 the moment you add any
        window, days with no windows are treated as fully unavailable, so add a window for every day that applies.
      </p>
      <div id="studentAvailDays"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
        <button class="btn btn-amber" id="saveBtn">Save availability</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const daysEl = backdrop.querySelector('#studentAvailDays');

  function renderDayRow(day) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding:12px 0;border-bottom:1px solid var(--paper-2);';
    wrapper.dataset.day = day;
    wrapper.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span class="day-label">${DAYS[day]}</span>
        <button class="btn btn-outline btn-sm" data-add-window="${day}">+ Add window</button>
      </div>
      <div class="windows-list" data-windows-for="${day}"></div>
    `;
    daysEl.appendChild(wrapper);

    const windowsList = wrapper.querySelector('.windows-list');
    function addWindowRow(start = '09:00', end = '09:30') {
      const row = document.createElement('div');
      row.className = 'time-pair';
      row.style.cssText = 'margin-bottom:6px;';
      row.innerHTML = `
        <input type="time" class="w-start" value="${start}" />
        <span>\u2013</span>
        <input type="time" class="w-end" value="${end}" />
        <button class="btn-danger-text" style="margin-left:6px;">Remove</button>
      `;
      row.querySelector('.btn-danger-text').onclick = () => row.remove();
      windowsList.appendChild(row);
    }

    (existingByDay[day] || []).forEach((w) => addWindowRow(w.start_time, w.end_time));
    wrapper.querySelector('[data-add-window]').onclick = () => addWindowRow();
  }

  WORK_DAYS.forEach(renderDayRow);

  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const days = [];
    daysEl.querySelectorAll('[data-windows-for]').forEach((list) => {
      const day = Number(list.dataset.windowsFor);
      list.querySelectorAll('.time-pair').forEach((row) => {
        const start = row.querySelector('.w-start').value;
        const end = row.querySelector('.w-end').value;
        if (start && end) days.push({ day_of_week: day, start_time: start, end_time: end });
      });
    });
    try {
      await api(`/students/${student.id}/availability`, { method: 'PUT', body: JSON.stringify({ days }) });
      backdrop.remove();
      toast('Availability saved');
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
    <div class="modal" style="width:560px;">
      <h3>Import Students from CSV</h3>
      <p class="field-hint" style="margin-bottom:10px;">
        First row must be a header with at least a <strong>Name</strong> column. <strong>Grade</strong> and
        <strong>Notes</strong> are optional. Students already on your roster (matched by name) are reused, not duplicated.
      </p>
      <p class="field-hint" style="margin-bottom:10px;">
        To also create caseload assignments, add <strong>Specialty</strong>, <strong>Weekly Minutes</strong>, and
        <strong>Para</strong> columns (Para must already exist and be assigned that specialty). A student needing more
        than one specialty \u2014 or the same specialty from two different Paras \u2014 just gets two rows with the same name.
        Optional columns: Session Length, Min Session Length, Service Type (<code>1:1</code> or <code>group</code>),
        Group Tag, Priority.
      </p>
      <p class="field-hint" style="margin-bottom:10px;">
        To also set a student's <strong>available times</strong>, add <strong>Available Day</strong>, <strong>Available Start</strong>,
        and <strong>Available End</strong> columns (day as a name like "Monday" or a number 0\u20136; times as 24-hour HH:MM).
        A student with several free periods just gets one row per window, same name each time \u2014 these can be on their
        own rows or combined with a specialty row. Once a student has any availability rows, days with none become
        fully unavailable for them, so list every day that applies.
      </p>
      <p class="field-hint" style="margin-bottom:16px;">
        <a href="/api/students/import/template" id="templateLink" style="color:var(--amber-deep);font-weight:700;">Download a template CSV</a>
        \u2014 shows a student with two specialties and a group pair.
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
        <div class="card" style="background:var(--paper-2);box-shadow:none;margin-top:4px;margin-bottom:0;max-height:260px;overflow-y:auto;">
          <div style="font-weight:700;color:var(--navy);margin-bottom:6px;">
            ${data.students_imported} new student${data.students_imported === 1 ? '' : 's'} \u00b7 ${data.assignments_created} assignment${data.assignments_created === 1 ? '' : 's'} \u00b7 ${data.availability_windows_added} availability window${data.availability_windows_added === 1 ? '' : 's'}
          </div>
          <div style="font-size:12.5px;color:var(--ink-soft);margin-bottom:8px;">
            ${data.students_skipped_blank ? `${data.students_skipped_blank} row(s) skipped (blank name). ` : ''}
            ${data.assignments_skipped_duplicate ? `${data.assignments_skipped_duplicate} assignment(s) skipped (already existed). ` : ''}
            ${data.availability_windows_skipped_duplicate ? `${data.availability_windows_skipped_duplicate} availability window(s) skipped (already existed). ` : ''}
            Processed ${data.total_rows} row${data.total_rows === 1 ? '' : 's'} total.
          </div>
          ${
            data.row_error_count
              ? `<div style="font-size:12px;color:var(--danger);font-weight:700;margin-bottom:4px;">${data.row_error_count} row${data.row_error_count === 1 ? '' : 's'} had a problem:</div>
                 <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--danger);">
                   ${data.row_errors.map((e) => `<li>Row ${e.row}: ${e.error}</li>`).join('')}
                   ${data.row_error_count > data.row_errors.length ? `<li>...and ${data.row_error_count - data.row_errors.length} more</li>` : ''}
                 </ul>`
              : '<div style="font-size:12px;color:var(--success);font-weight:700;">No row errors.</div>'
          }
        </div>
      `;
      toast(`${data.students_imported} student${data.students_imported === 1 ? '' : 's'}, ${data.assignments_created} assignment${data.assignments_created === 1 ? '' : 's'} imported`);
      await loadAll();
      setView('students');
      // If there were row errors worth reading, leave the modal open so the admin can
      // review them; otherwise close it after a moment.
      if (!data.row_error_count) {
        setTimeout(() => backdrop.remove(), 1800);
      } else {
        importBtn.style.display = 'none';
        backdrop.querySelector('#cancelBtn').textContent = 'Close';
      }
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
          <thead><tr><th>Student</th><th>Specialty</th><th>Weekly Minutes</th><th>Session Length</th><th>Type</th><th>Live Clock</th><th></th></tr></thead>
          <tbody>
            ${list
              .map((a) => {
                const key = timerKey(a.para_id, a.student_id, a.specialty);
                const running = state.runningTimers[key];
                const actual = state.weeklyActual[key] || 0;
                const pct = Math.min(100, Math.round((actual / a.weekly_minutes) * 100));
                const timerCell = running
                  ? `<div style="display:flex;align-items:center;gap:8px;">
                       <span class="timer-elapsed mono" data-start="${running.start_at}" style="font-weight:700;color:var(--success);">00:00:00</span>
                       <button class="btn btn-sm" style="background:var(--danger-bg);color:var(--danger);border-color:transparent;" data-stop="${running.id}">Stop</button>
                     </div>`
                  : `<button class="btn btn-outline btn-sm" data-start-para="${a.para_id}" data-start-student="${a.student_id}" data-start-specialty="${a.specialty || ''}">▶ Start</button>`;
                return `
              <tr>
                <td>${a.student_name}</td>
                <td>${a.specialty ? `<span class="badge badge-group">${a.specialty}</span>` : '<span style="color:var(--ink-soft);font-size:12px;">—</span>'}</td>
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
    (b) => (b.onclick = () => startClock(Number(b.dataset.startPara), Number(b.dataset.startStudent), b.dataset.startSpecialty || null))
  );
  content.querySelectorAll('[data-stop]').forEach((b) => (b.onclick = () => stopClock(b.dataset.stop)));
}

async function startClock(paraId, studentId, specialty) {
  try {
    await api('/time-logs/start', { method: 'POST', body: JSON.stringify({ para_id: paraId, student_id: studentId, specialty }) });
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

function defaultWeeklyMinutes(assignment) {
  if (assignment) return assignment.weekly_minutes;
  return 60;
}

function openAssignmentModal(assignment, opts = {}) {
  const { presetStudentId, onSaved } = opts;
  const isEdit = !!assignment;
  const lockStudent = isEdit || !!presetStudentId;
  const defaultStudentId = presetStudentId || assignment?.student_id;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Edit Caseload Assignment' : 'Assign Student to a Para'}</h3>
      <div class="form-row">
        <label>IEP Specialty</label>
        <select id="mSpecialty" ${isEdit ? 'disabled' : ''}>
          <option value="">Select a specialty\u2026</option>
          ${SPECIALTIES.map((s) => `<option value="${s}" ${assignment?.specialty === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Para Instructor</label>
        <select id="mPara" ${isEdit ? 'disabled' : ''}>
          <option value="">Choose a specialty first\u2026</option>
        </select>
        <div class="field-hint" id="paraFilterHint">Only Paras assigned to the chosen specialty are shown.</div>
      </div>
      <div class="form-row">
        <label>Student</label>
        <select id="mStudent" ${lockStudent ? 'disabled' : ''}>
          ${state.students.map((s) => `<option value="${s.id}" ${defaultStudentId === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Required minutes per week</label>
        <input id="mMinutes" type="number" min="1" value="${assignment?.weekly_minutes || defaultWeeklyMinutes(assignment)}" />
        <div class="field-hint" id="minutesPrefillHint"></div>
      </div>
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
        <input id="mGroupTag" value="${assignment?.group_tag || ''}" placeholder="e.g. reading-grp-1" />
        <div class="field-hint">Students with the same Para, same specialty, and the same group tag are scheduled together in one time block.</div>
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

  const specialtySel = backdrop.querySelector('#mSpecialty');
  const paraSel = backdrop.querySelector('#mPara');
  const paraFilterHint = backdrop.querySelector('#paraFilterHint');

  function refreshParaOptions() {
    const specialty = specialtySel.value;
    if (!specialty) {
      paraSel.innerHTML = '<option value="">Choose a specialty first\u2026</option>';
      paraFilterHint.textContent = 'Only Paras assigned to the chosen specialty are shown.';
      return;
    }
    const qualified = state.paras.filter((p) => (p.specialties || []).includes(specialty));
    if (qualified.length === 0) {
      paraSel.innerHTML = '<option value="">No Para assigned to this specialty</option>';
      paraFilterHint.innerHTML = `No Para is set up for <strong>${specialty}</strong> yet. Add it under Para Instructors \u2192 Specialties first.`;
      return;
    }
    paraSel.innerHTML = qualified
      .map((p) => `<option value="${p.id}" ${assignment?.para_id === p.id ? 'selected' : ''}>${p.name}</option>`)
      .join('');
    paraFilterHint.textContent = `Showing only Paras assigned to ${specialty}.`;
  }
  specialtySel.onchange = refreshParaOptions;
  if (isEdit) {
    // Editing: specialty/para are locked, just show the current para as the only option.
    paraSel.innerHTML = `<option value="${assignment.para_id}" selected>${assignment.para_name}</option>`;
    paraFilterHint.textContent = '';
  } else {
    refreshParaOptions();
  }

  if (!isEdit) {
    const studentSel = backdrop.querySelector('#mStudent');
    const minutesInput = backdrop.querySelector('#mMinutes');
    const hintEl = backdrop.querySelector('#minutesPrefillHint');
    const applyPrefill = () => {
      const student = findStudent(studentSel.value);
      if (student && student.target_weekly_minutes) {
        minutesInput.value = student.target_weekly_minutes;
        hintEl.textContent = `Prefilled from ${student.name}'s profile target. Adjust if this Para is only covering part of it.`;
      } else {
        hintEl.textContent = '';
      }
    };
    studentSel.onchange = applyPrefill;
    applyPrefill();
  }

  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const specialty = isEdit ? assignment.specialty : specialtySel.value;
    if (!isEdit && !specialty) return toast('Choose an IEP specialty', true);
    if (!isEdit && !paraSel.value) return toast('No qualified Para selected', true);

    const payload = {
      para_id: Number(paraSel.value || assignment.para_id),
      student_id: Number(backdrop.querySelector('#mStudent').value),
      specialty,
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
      if (onSaved) onSaved();
      else setView('caseloads');
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
      <button class="btn btn-outline" id="manualBtn">+ Add manual session</button>
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
  document.getElementById('manualBtn').onclick = () => openManualSessionModal(weekStart);
  await loadSchedule(weekStart);
}

function openManualSessionModal(weekStart) {
  if (state.paras.length === 0) return toast('Add a Para Instructor first', true);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Add Manual Session</h3>
      <p class="field-hint" style="margin-bottom:14px;">
        Place a session on top of the generated schedule \u2014 useful for combining two students into one slot,
        or covering a session the auto-generator couldn't fit. Pick 2 or more students to co-schedule them together.
      </p>
      <div class="form-row">
        <label>Para Instructor</label>
        <select id="mPara">
          ${state.paras.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Caseload entries (student \u2014 specialty)</label>
        <div id="studentChecks" style="max-height:160px;overflow-y:auto;border:1.5px solid var(--line);border-radius:7px;padding:8px 10px;"></div>
        <div class="field-hint">Only this Para's actual caseload assignments are shown, so minutes count toward the right specialty target and a double-booked student is blocked automatically.</div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Day</label>
          <select id="mDay">
            ${WORK_DAYS.map((d) => `<option value="${d}">${DAYS[d]}</option>`).join('')}
          </select>
        </div>
        <div class="form-row"></div>
      </div>
      <div class="form-grid-2">
        <div class="form-row"><label>Start time</label><input type="time" id="mStart" value="09:00" /></div>
        <div class="form-row"><label>End time</label><input type="time" id="mEnd" value="09:30" /></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="cancelBtn">Cancel</button>
        <button class="btn btn-amber" id="saveBtn">Add session</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const paraSel = backdrop.querySelector('#mPara');
  const checksEl = backdrop.querySelector('#studentChecks');

  function refreshStudentChecks() {
    const paraId = Number(paraSel.value);
    const caseload = state.assignments.filter((a) => a.para_id === paraId);
    if (caseload.length === 0) {
      checksEl.innerHTML = '<p style="color:var(--ink-soft);font-size:12.5px;margin:0;">This Para has no caseload assignments yet.</p>';
      return;
    }
    checksEl.innerHTML = caseload
      .map(
        (a) => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;font-weight:500;color:var(--ink);">
          <input type="checkbox" data-student="${a.student_id}" data-specialty="${a.specialty || ''}" />
          ${a.student_name} ${a.specialty ? `<span class="badge badge-group" style="font-size:10px;">${a.specialty}</span>` : ''}
        </label>`
      )
      .join('');
  }
  paraSel.onchange = refreshStudentChecks;
  refreshStudentChecks();

  backdrop.querySelector('#cancelBtn').onclick = () => backdrop.remove();
  backdrop.querySelector('#saveBtn').onclick = async () => {
    const entries = [...checksEl.querySelectorAll('input[type=checkbox]:checked')].map((c) => ({
      student_id: Number(c.dataset.student),
      specialty: c.dataset.specialty || null,
    }));
    if (entries.length === 0) return toast('Select at least one student', true);
    const startTime = backdrop.querySelector('#mStart').value;
    const endTime = backdrop.querySelector('#mEnd').value;
    if (!startTime || !endTime || endTime <= startTime) return toast('End time must be after start time', true);

    try {
      await api('/schedule/manual', {
        method: 'POST',
        body: JSON.stringify({
          week_start_date: weekStart,
          para_id: Number(paraSel.value),
          day_of_week: Number(backdrop.querySelector('#mDay').value),
          start_time: startTime,
          end_time: endTime,
          entries,
        }),
      });
      backdrop.remove();
      toast(`Session added for ${entries.length} student${entries.length === 1 ? '' : 's'}`);
      await loadSchedule(weekStart);
    } catch (e) {
      toast(e.message, true);
    }
  };
}

async function deleteSession(sessionId, weekStart) {
  if (!confirm('Remove this session from the schedule?')) return;
  try {
    await api(`/schedule/session/${sessionId}`, { method: 'DELETE' });
    toast('Session removed');
    await loadSchedule(weekStart);
  } catch (e) {
    toast(e.message, true);
  }
}

async function loadSchedule(weekStart) {
  const body = document.getElementById('scheduleBody');
  try {
    const data = await api(`/schedule?week_start_date=${weekStart}`);
    renderScheduleBody(body, data, weekStart);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderScheduleBody(body, data, weekStart) {
  if (!data.sessions || data.sessions.length === 0) {
    body.innerHTML = emptyState('No schedule generated for this week', 'Click "Generate schedule" once your Paras have hours set and caseloads assigned, or add a manual session above.');
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
        <thead><tr><th>Student</th><th>Specialty</th><th>Para</th><th>Scheduled / Required</th><th>Status</th></tr></thead>
        <tbody>
          ${compliance
            .filter((c) => c.status !== 'met')
            .map(
              (c) => `<tr>
                <td>${c.student_name}</td>
                <td>${c.specialty ? `<span class="badge badge-group">${c.specialty}</span>` : '\u2014'}</td>
                <td>${c.para_name}</td>
                <td class="mono">${c.scheduled_minutes} / ${c.target_minutes} min</td>
                <td><span class="badge badge-${c.status}">${c.status === 'partial' ? 'Partial' : 'Unmet'}</span></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="field-hint" style="margin-top:12px;">Unmet minutes usually mean the Para doesn't have enough open weekly hours for this caseload \u2014 or the student's own available windows don't leave enough room. Add hours, rebalance the caseload, adjust the student's available times, allow shorter minimum session lengths, or add a manual session above.</p>
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
                (s) => `<div class="session-chip ${s.service_type === 'group' ? 'group-chip' : ''}" style="position:relative;">
                  <button data-del-session="${s.id}" title="Remove" style="position:absolute;top:3px;right:4px;background:none;border:none;color:var(--ink-soft);cursor:pointer;font-size:12px;line-height:1;padding:2px;">\u00d7</button>
                  <div class="chip-time">${s.start_time}–${s.end_time}</div>
                  <div class="chip-name">${s.student_name}</div>
                  ${s.specialty ? `<div style="font-size:10px;color:var(--ink-soft);font-weight:700;">${s.specialty}</div>` : ''}
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
  body.querySelectorAll('[data-del-session]').forEach(
    (b) => (b.onclick = () => deleteSession(b.dataset.delSession, weekStart))
  );
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
  const sorted = [...rows].sort((a, b) => a.student_name.localeCompare(b.student_name) || (a.specialty || '').localeCompare(b.specialty || ''));
  return `
    <div class="card">
      <h3>${title}</h3>
      <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Specialty</th><th>Grade</th><th>% of Weekly Goal</th><th>Total Weekly Minutes</th><th>Target Weekly Minutes</th>
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
                <td>${r.specialty ? `<span class="badge badge-group">${r.specialty}</span>` : '\u2014'}</td>
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
