// HourHive Caseload — operations views: dashboard workload, master schedule,
// calendar (half days / early release / Para absences), coverage plan, sped-time editor.
// Loaded after app.js; relies on its globals (state, api, toast, DAYS, WORK_DAYS, emptyState, ...).

const NEED_LABEL = { high: 'High needs', middle: 'Middle needs', low: 'Low needs' };
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function needBadge(s) {
  const lvl = s.needs_level || 'middle';
  return `<span class="need-badge need-${lvl}">${s.medical_risk ? '✚ ' : ''}${NEED_LABEL[lvl]}</span>`;
}
function needLegend() {
  return `<div class="need-legend">
    <span class="need-badge need-high">High needs</span>
    <span class="need-badge need-middle">Middle needs</span>
    <span class="need-badge need-low">Low needs</span>
    <span class="need-badge need-medical">✚ Medical high risk</span>
    <span class="legend-note">Cover red and ✚ first when a Para is out.</span>
  </div>`;
}
const tmin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmt12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h >= 12 ? 'p' : 'a'}`; };
const mondayOfISO = (d) => nextMonday(d);
function dateOfDow(weekStart, dow) { return addDaysISO(weekStart, (dow + 6) % 7); }
function fmtDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nearestWeekday(iso) {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  if (dow === 6) return addDaysISO(iso, 2);
  if (dow === 0) return addDaysISO(iso, 1);
  return iso;
}

// Weekly capacity (open minutes after break/lunch) for a Para from their availability rows.
function paraCapacity(p) {
  return (p.availability || []).reduce((sum, a) => {
    let m = tmin(a.work_end) - tmin(a.work_start);
    if (a.break_start && a.break_minutes) m -= a.break_minutes;
    if (a.lunch_start && a.lunch_minutes) m -= a.lunch_minutes;
    return sum + Math.max(0, m);
  }, 0);
}
// Time a Para needs: individual minutes + each group's minutes counted once (the group meets together).
function paraNeed(paraId) {
  const list = state.assignments.filter((a) => a.para_id === paraId);
  let total = 0;
  const groups = {};
  for (const a of list) {
    if (a.service_type === 'group' && a.group_tag) groups[a.group_tag] = Math.max(groups[a.group_tag] || 0, a.weekly_minutes);
    else total += a.weekly_minutes;
  }
  return total + Object.values(groups).reduce((x, y) => x + y, 0);
}

// ---------- Dashboard ----------
function renderDashboardOps(content) {
  const active = state.paras.filter((p) => p.active);
  const studs = state.students.filter((s) => s.active !== 0);
  const count = (lvl) => studs.filter((s) => (s.needs_level || 'middle') === lvl).length;
  const medical = studs.filter((s) => s.medical_risk).length;
  const totalReq = state.assignments.reduce((s, a) => s + a.weekly_minutes, 0);

  const rows = active.map((p) => {
    const cap = paraCapacity(p);
    const need = paraNeed(p.id);
    const pct = cap ? Math.round((need / cap) * 100) : (need ? 999 : 0);
    const cls = pct > 100 ? 'danger' : pct > 85 ? 'warn' : 'ok';
    return `<tr>
      <td><span class="color-dot" style="background:${p.color}"></span>${esc(p.name)}</td>
      <td class="mono">${cap} min</td>
      <td class="mono">${need} min</td>
      <td><div class="load-bar"><div class="load-fill ${cls}" style="width:${Math.min(100, pct)}%"></div></div><span class="mono load-pct ${cls}">${cap ? pct + '%' : 'No hours set'}</span></td>
      <td class="mono">${new Set(state.assignments.filter((a) => a.para_id === p.id).map((a) => a.student_id)).size}</td>
    </tr>`;
  }).join('');

  const byStudent = studs.map((s) => {
    const list = state.assignments.filter((a) => a.student_id === s.id);
    const total = list.reduce((x, a) => x + a.weekly_minutes, 0);
    return `<tr>
      <td>${esc(s.name)}</td><td>${needBadge(s)}</td>
      <td>${list.length ? list.map((a) => `<span class="badge badge-group">${esc(a.specialty || '?')}</span> <span class="mono">${a.weekly_minutes}m</span> <span style="color:var(--ink-soft)">${esc(a.para_name)}</span>`).join('<br>') : '<span style="color:var(--danger)">No Para assigned</span>'}</td>
      <td class="mono">${total} min</td></tr>`;
  }).join('');

  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${active.length}</div><div class="stat-label">Paras employed</div></div>
      <div class="stat-card"><div class="stat-value">${studs.length}</div><div class="stat-label">Students</div></div>
      <div class="stat-card"><div class="stat-value">${totalReq.toLocaleString()}</div><div class="stat-label">Service minutes / week</div></div>
      <div class="stat-card ${medical ? 'danger' : ''}"><div class="stat-value">${medical}</div><div class="stat-label">Medical high risk</div></div>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);">
      <div class="stat-card need-tile need-high"><div class="stat-value">${count('high')}</div><div class="stat-label">High needs students</div></div>
      <div class="stat-card need-tile need-middle"><div class="stat-value">${count('middle')}</div><div class="stat-label">Middle needs students</div></div>
      <div class="stat-card need-tile need-low"><div class="stat-value">${count('low')}</div><div class="stat-label">Low needs students</div></div>
    </div>
    <div class="card">
      <h3>Para workload: capacity vs. minutes needed</h3>
      ${active.length ? `<table><thead><tr><th>Para</th><th>Open minutes / week</th><th>Minutes needed</th><th>Load</th><th>Students</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="field-hint" style="margin-top:10px;">Open minutes are work hours minus break and lunch. Group sessions count once because the group meets together. Over 100% means the caseload can't fit.</p>` : '<p style="color:var(--ink-soft)">Add Para Instructors to see workload.</p>'}
    </div>
    <div class="card">
      <h3>Minutes allocated per student</h3>
      ${studs.length ? `<table><thead><tr><th>Student</th><th>Type</th><th>Specialty, minutes, Para</th><th>Total / week</th></tr></thead><tbody>${byStudent}</tbody></table>` : '<p style="color:var(--ink-soft)">Add students to see allocations.</p>'}
    </div>`;
}

// ---------- Master schedule ----------
const PX_PER_MIN = 1.5;

async function renderMaster(content, actions) {
  const weekStart = state.masterWeek || nextMonday();
  const todayDow = new Date().getDay();
  const day = state.masterDay || (todayDow >= 1 && todayDow <= 5 ? todayDow : 1);
  actions.innerHTML = '';
  content.innerHTML = `<div class="schedule-toolbar">
      <label style="font-size:13px;font-weight:700;color:var(--ink-soft);">Week of <input type="date" id="mWeek" value="${weekStart}" style="margin-left:8px;" /></label>
      <div class="day-tabs">${WORK_DAYS.map((d) => `<button class="day-tab ${d === day ? 'active' : ''}" data-day="${d}">${DAYS[d]}</button>`).join('')}</div>
    </div><div id="masterBody"></div>`;
  document.getElementById('mWeek').onchange = (e) => { state.masterWeek = nextMonday(e.target.value); renderMaster(content, actions); };
  content.querySelectorAll('.day-tab').forEach((b) => (b.onclick = () => { state.masterDay = Number(b.dataset.day); renderMaster(content, actions); }));

  const body = document.getElementById('masterBody');
  let data;
  try { data = await api(`/schedule?week_start_date=${weekStart}`); } catch (e) { return toast(e.message, true); }
  const date = dateOfDow(weekStart, day);
  const special = (data.special_days || []).find((x) => x.date === date);
  const absentIds = new Set((data.absences || []).filter((a) => a.date === date).map((a) => a.para_id));
  const coverage = (data.coverage || []).filter((c) => c.date === date);
  const paras = state.paras.filter((p) => p.active);
  const sessions = data.sessions.filter((s) => s.day_of_week === day);
  const dismissal = special ? tmin(special.dismissal_time) : null;

  const availOf = (p) => (p.availability || []).find((a) => a.day_of_week === day);
  const spedBlocks = [];
  for (const st of state.students) for (const b of st.sped_blocks || []) if (b.day_of_week === day) spedBlocks.push({ ...b, name: st.name, st });

  let lo = 8 * 60, hi = 15 * 60;
  const touch = (a, b) => { lo = Math.min(lo, a); hi = Math.max(hi, b); };
  paras.forEach((p) => { const a = availOf(p); if (a) touch(tmin(a.work_start), tmin(a.work_end)); });
  sessions.forEach((s) => touch(tmin(s.start_time), tmin(s.end_time)));
  spedBlocks.forEach((b) => touch(tmin(b.start_time), tmin(b.end_time)));
  lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
  const H = (hi - lo) * PX_PER_MIN;
  const y = (m) => (m - lo) * PX_PER_MIN;
  const hourLabels = []; for (let m = lo; m <= hi; m += 60) hourLabels.push(m);

  const block = (cls, s, e, inner, style = '') => `<div title="${esc(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())}" class="mblock ${cls} ${e - s <= 20 ? 'short' : ''}" style="top:${y(s)}px;height:${Math.max(14, (e - s) * PX_PER_MIN)}px;${style}">${inner}</div>`;

  function paraColumn(p) {
    const a = availOf(p);
    const out = absentIds.has(p.id);
    let inner = '';
    if (!a) inner += `<div class="moff-all">Not working</div>`;
    else {
      const ws = tmin(a.work_start), we = dismissal != null ? Math.min(tmin(a.work_end), dismissal) : tmin(a.work_end);
      if (ws > lo) inner += block('moff', lo, ws, '');
      if (we < hi) inner += block('moff', we, hi, dismissal != null && we === dismissal ? '<span class="mlabel">Dismissed</span>' : '');
      if (a.break_start && a.break_minutes) inner += block('mbreak', tmin(a.break_start), tmin(a.break_start) + a.break_minutes, '<span class="mlabel">Break</span>');
      if (a.lunch_start && a.lunch_minutes) inner += block('mlunch', tmin(a.lunch_start), tmin(a.lunch_start) + a.lunch_minutes, '<span class="mlabel">Lunch</span>');
    }
    // Merge group sessions (same Para, same time) into one block listing everyone in the group.
    const mine = sessions.filter((x) => x.para_id === p.id);
    const merged = new Map();
    for (const s of mine) {
      const k = s.service_type === 'group' ? `g|${s.start_time}|${s.end_time}` : `i|${s.id}`;
      if (!merged.has(k)) merged.set(k, []);
      merged.get(k).push(s);
    }
    const rankOf = (x) => (x.medical_risk ? 0 : { high: 1, middle: 2, low: 3 }[x.needs_level] ?? 2);
    for (const grp of merged.values()) {
      const s = grp.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]; // block takes the highest-need color
      const covs = grp.map((g) => coverage.find((c) => c.student_id === g.student_id && c.start_time === g.start_time && c.absent_para_id === p.id));
      const allCov = covs.every(Boolean);
      const covName = allCov ? (state.paras.find((q) => q.id === covs[0].cover_para_id) || {}).name : null;
      const names = grp.map((g) => `${g.medical_risk ? '\u271a ' : ''}${esc(g.student_name)}`).join(', ');
      inner += block(`msession need-${s.needs_level || 'middle'} ${grp.length > 1 ? 'is-group' : ''} ${out ? (allCov ? 'is-covered' : 'is-uncovered') : ''}`, tmin(s.start_time), tmin(s.end_time),
        `<b>${names}</b><span>${fmt12(s.start_time)}\u2013${fmt12(s.end_time)}${s.specialty ? ' \u00b7 ' + esc(s.specialty) : ''}${grp.length > 1 ? ' \u00b7 group' : ''}</span>${out ? `<em>${covName ? 'Covered by ' + esc(covName) : 'NEEDS COVER'}</em>` : ''}`);
    }
    // Sessions this Para is covering for someone who is out (grouped the same way)
    const covIn = new Map();
    for (const c of coverage.filter((c) => c.cover_para_id === p.id)) {
      const k = `${c.absent_para_id}|${c.start_time}|${c.end_time}`;
      if (!covIn.has(k)) covIn.set(k, []);
      covIn.get(k).push(c);
    }
    for (const list of covIn.values()) {
      const studs = list.map((c) => state.students.find((x) => x.id === c.student_id) || {});
      const top = studs.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
      const c = list[0];
      inner += block(`msession cover-in need-${top.needs_level || 'middle'}`, tmin(c.start_time), tmin(c.end_time),
        `<b>${studs.map((x) => `${x.medical_risk ? '\u271a ' : ''}${esc(x.name)}`).join(', ')}</b><span>Covering for ${esc((state.paras.find((q) => q.id === c.absent_para_id) || {}).name)}</span>`);
    }
    return `<div class="mcol"><div class="mcol-head" style="border-top:3px solid ${p.color}">${esc(p.name)}${out ? '<span class="out-badge">OUT</span>' : ''}</div><div class="mcol-body ${out ? 'is-out' : ''}" style="height:${H}px">${inner}</div></div>`;
  }

  const spedCol = `<div class="mcol"><div class="mcol-head sped-head">Sped / Para not needed</div><div class="mcol-body" style="height:${H}px">${
    spedBlocks.map((b) => block(`msession sped-block need-${b.st.needs_level || 'middle'}`, tmin(b.start_time), tmin(b.end_time), `<b>${esc(b.name)}</b><span>${fmt12(b.start_time)}–${fmt12(b.end_time)}${b.label ? ' · ' + esc(b.label) : ''}</span>`)).join('') || '<div class="moff-all">None today</div>'
  }</div></div>`;

  body.innerHTML = `
    ${needLegend()}
    <div class="master-meta">
      <strong>${fmtDate(date)}</strong>
      ${special ? `<span class="badge badge-partial">${special.day_type === 'half_day' ? 'Half day' : 'Early release'}${special.label ? ' · ' + esc(special.label) : ''}: dismissal ${fmt12(special.dismissal_time)}</span>` : ''}
      ${absentIds.size ? `<span class="badge badge-unmet">${absentIds.size} Para${absentIds.size > 1 ? 's' : ''} out</span> <a href="#" id="goCover">Open coverage plan →</a>` : ''}
    </div>
    ${data.sessions.length === 0 ? emptyState('No schedule for this week', 'Generate the week from the Schedule tab first.') : `
    <div class="master-wrap"><div class="master-grid">
      <div class="mtime" style="height:${H + 38}px"><div class="mcol-head">&nbsp;</div>${hourLabels.map((m) => `<div class="mtime-label" style="top:${y(m) + 38}px">${fmt12(`${Math.floor(m / 60)}:00`)}</div>`).join('')}</div>
      ${paras.map(paraColumn).join('')}${spedCol}
    </div></div>
    <p class="field-hint">Shaded = outside work hours. Hatched = break / lunch. Dashed red = session whose Para is out. Half days and early releases apply when the week is generated, so re-run <strong>Generate schedule</strong> after adding one.</p>`}`;
  const go = document.getElementById('goCover');
  if (go) go.onclick = (e) => { e.preventDefault(); state.coverageDate = date; setView('coverage'); };
}

// ---------- Calendar ----------
async function renderCalendar(content, actions) {
  actions.innerHTML = '';
  const from = addDaysISO(todayISO(), -14);
  let cal;
  try { cal = await api(`/calendar?from=${from}`); } catch (e) { return toast(e.message, true); }
  const activeParas = state.paras.filter((p) => p.active);
  content.innerHTML = `
    <div class="two-col">
      <div class="card">
        <h3>Half days & early release days</h3>
        <p class="field-hint" style="margin-top:-6px;">Paras stop service at dismissal. Regenerate the week after adding one.</p>
        <div class="form-row"><label>Date</label><input type="date" id="sdDate" value="${nearestWeekday(todayISO())}" /></div>
        <div class="form-row"><label>Type</label><select id="sdType"><option value="half_day">Half day</option><option value="early_release">Early release</option></select></div>
        <div class="form-row"><label>Dismissal time</label><input type="time" id="sdTime" value="12:00" /></div>
        <div class="form-row"><label>Label (optional)</label><input id="sdLabel" placeholder="Teacher PD, conferences..." /></div>
        <button class="btn btn-amber" id="sdAdd">Add day</button>
        <table style="margin-top:16px;"><tbody>${cal.special_days.map((d) => `<tr><td>${fmtDate(d.date)}</td><td>${d.day_type === 'half_day' ? 'Half day' : 'Early release'}${d.label ? ' · ' + esc(d.label) : ''}</td><td class="mono">out ${fmt12(d.dismissal_time)}</td><td><button class="btn-danger-text" data-del-sd="${d.id}">Remove</button></td></tr>`).join('') || '<tr><td style="color:var(--ink-soft)">None scheduled</td></tr>'}</tbody></table>
      </div>
      <div class="card">
        <h3>Para absences</h3>
        <p class="field-hint" style="margin-top:-6px;">Weekends are skipped. Then open Coverage to assign who covers.</p>
        <div class="form-row"><label>Para</label><select id="abPara">${activeParas.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="form-row"><label>First day out</label><input type="date" id="abStart" value="${nearestWeekday(todayISO())}" /></div>
        <div class="form-row"><label>Last day out (blank = one day)</label><input type="date" id="abEnd" /></div>
        <div class="form-row"><label>Reason (optional)</label><input id="abReason" placeholder="Sick, PD, personal..." /></div>
        <button class="btn btn-amber" id="abAdd">Mark Para out</button>
        <table style="margin-top:16px;"><tbody>${cal.absences.map((a) => `<tr><td>${fmtDate(a.date)}</td><td><span class="color-dot" style="background:${a.para_color}"></span>${esc(a.para_name)}</td><td style="color:var(--ink-soft)">${esc(a.reason || '')}</td><td><button class="btn btn-outline btn-sm" data-cover="${a.date}">Coverage</button> <button class="btn-danger-text" data-del-ab="${a.id}">Remove</button></td></tr>`).join('') || '<tr><td style="color:var(--ink-soft)">No absences logged</td></tr>'}</tbody></table>
      </div>
    </div>`;
  const run = async (fn, msg) => { try { await fn(); toast(msg); renderCalendar(content, actions); } catch (e) { toast(e.message, true); } };
  document.getElementById('sdAdd').onclick = () => run(() => api('/calendar/special-days', { method: 'POST', body: JSON.stringify({
    date: document.getElementById('sdDate').value, day_type: document.getElementById('sdType').value,
    dismissal_time: document.getElementById('sdTime').value, label: document.getElementById('sdLabel').value.trim() }) }), 'Day saved. Regenerate that week to apply it.');
  document.getElementById('abAdd').onclick = () => run(() => api('/calendar/absences', { method: 'POST', body: JSON.stringify({
    para_id: Number(document.getElementById('abPara').value), start_date: document.getElementById('abStart').value,
    end_date: document.getElementById('abEnd').value || null, reason: document.getElementById('abReason').value.trim() }) }), 'Absence logged');
  content.querySelectorAll('[data-del-sd]').forEach((b) => (b.onclick = () => run(() => api(`/calendar/special-days/${b.dataset.delSd}`, { method: 'DELETE' }), 'Removed')));
  content.querySelectorAll('[data-del-ab]').forEach((b) => (b.onclick = () => run(() => api(`/calendar/absences/${b.dataset.delAb}`, { method: 'DELETE' }), 'Removed')));
  content.querySelectorAll('[data-cover]').forEach((b) => (b.onclick = () => { state.coverageDate = b.dataset.cover; setView('coverage'); }));
}

// ---------- Coverage ----------
async function renderCoverage(content, actions) {
  actions.innerHTML = '';
  const date = nearestWeekday(state.coverageDate || todayISO());
  state.coverageDate = date;
  let d;
  try { d = await api(`/coverage?date=${date}`); } catch (e) { return toast(e.message, true); }

  const paraName = (id) => (state.paras.find((p) => p.id === id) || {}).name || '?';
  const needsHtml = d.needs.map((n) => {
    const key = `${n.student_id}|${n.start_time}`;
    const control = n.cover_para_id
      ? `<span class="badge badge-met">Covered by ${esc(n.cover_para_name)}</span> <button class="btn-danger-text" data-clear="${n.cover_assignment_id}">Clear</button>`
      : n.candidates.length
        ? `<select data-pick="${key}"><option value="">Choose cover...</option>${n.candidates.map((c) => `<option value="${c.para_id}">${esc(c.name)}${c.is_backup ? ' (backup)' : ''}${c.qualified ? '' : ' (not ' + esc(n.specialty || 'specialty') + ' qualified)'}</option>`).join('')}</select> <button class="btn btn-amber btn-sm" data-assign="${key}">Assign</button>`
        : `<span class="badge badge-unmet">No Para free</span>`;
    return `<tr class="cov-row need-${n.needs_level}">
      <td class="mono">${fmt12(n.start_time)}–${fmt12(n.end_time)}</td>
      <td><b>${esc(n.student_name)}</b> ${needBadge(n)}${n.coverage_notes ? `<div class="field-hint">${esc(n.coverage_notes)}</div>` : ''}</td>
      <td>${n.specialty ? `<span class="badge badge-group">${esc(n.specialty)}</span>` : ''} ${n.service_type === 'group' ? '<span class="badge badge-11">group</span>' : ''}</td>
      <td>${esc(n.absent_para_name)}</td><td>${control}</td></tr>`;
  }).join('');

  const riskHtml = d.at_risk.map((r) => `<tr class="need-${r.needs_level}">
      <td><b>${esc(r.student_name)}</b></td><td>${needBadge(r)}</td><td>${esc(r.absent_para_name)}</td>
      <td>${r.backup_para_id ? `${esc(r.backup_para_name || paraName(r.backup_para_id))} ${r.backup_available ? '<span class="badge badge-met">available</span>' : '<span class="badge badge-unmet">also out</span>'}` : '<span class="badge badge-unmet">No backup set</span>'}</td>
      <td class="mono">${r.sessions_covered}/${r.sessions_total} covered</td>
      <td style="color:var(--ink-soft)">${esc(r.coverage_notes || '')}</td></tr>`).join('');

  content.innerHTML = `
    <div class="schedule-toolbar">
      <label style="font-size:13px;font-weight:700;color:var(--ink-soft);">Date <input type="date" id="covDate" value="${date}" style="margin-left:8px;" /></label>
      ${d.special_day ? `<span class="badge badge-partial">${d.special_day.day_type === 'half_day' ? 'Half day' : 'Early release'}: dismissal ${fmt12(d.special_day.dismissal_time)}</span>` : ''}
    </div>
    ${needLegend()}
    ${d.absences.length === 0 ? `<div class="card"><h3>Nobody is marked out on ${fmtDate(date)}</h3><p style="color:var(--ink-soft);margin:0;">Mark a Para out from the Calendar tab and their students' sessions will appear here, high needs and medical first.</p></div>` : `
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);">
      <div class="stat-card danger"><div class="stat-value">${d.absences.length}</div><div class="stat-label">Paras out: ${d.absences.map((a) => esc(a.para_name)).join(', ')}</div></div>
      <div class="stat-card"><div class="stat-value">${d.summary.sessions_needing_cover}</div><div class="stat-label">Sessions needing cover</div></div>
      <div class="stat-card"><div class="stat-value">${d.summary.covered}</div><div class="stat-label">Covered</div></div>
      <div class="stat-card ${d.summary.uncovered_high_or_medical ? 'danger' : ''}"><div class="stat-value">${d.summary.uncovered_high_or_medical}</div><div class="stat-label">High-needs / medical uncovered</div></div>
    </div>
    <div class="card"><h3>Highest-needs students affected</h3>
      ${d.at_risk.length ? `<table><thead><tr><th>Student</th><th>Type</th><th>Para out</th><th>Designated backup</th><th>Status</th><th>Coverage notes</th></tr></thead><tbody>${riskHtml}</tbody></table>` : '<p style="color:var(--ink-soft);margin:0;">No high-needs or medical students are on an absent Para\'s caseload.</p>'}
    </div>
    <div class="card"><h3>Sessions to cover (medical and high needs first)</h3>
      ${d.needs.length ? `<table><thead><tr><th>Time</th><th>Student</th><th>Service</th><th>Para out</th><th>Cover</th></tr></thead><tbody>${needsHtml}</tbody></table>
      <p class="field-hint" style="margin-top:10px;">Only Paras who are working, off break/lunch and not already booked at that time are offered. Group sessions are covered together.</p>` : `<p style="color:var(--ink-soft);margin:0;">No sessions are scheduled for the absent Para${d.absences.length > 1 ? 's' : ''} that day. Generate the week from the Schedule tab if you haven't.</p>`}
    </div>`}`;
  document.getElementById('covDate').onchange = (e) => { state.coverageDate = e.target.value; renderCoverage(content, actions); };
  content.querySelectorAll('[data-assign]').forEach((b) => (b.onclick = async () => {
    const [sid, start] = b.dataset.assign.split('|');
    const sel = content.querySelector(`select[data-pick="${b.dataset.assign}"]`);
    if (!sel.value) return toast('Choose a Para first', true);
    try { await api('/coverage', { method: 'POST', body: JSON.stringify({ date, student_id: Number(sid), start_time: start, cover_para_id: Number(sel.value) }) }); toast('Coverage assigned'); renderCoverage(content, actions); }
    catch (e) { toast(e.message, true); }
  }));
  content.querySelectorAll('[data-clear]').forEach((b) => (b.onclick = async () => {
    try { await api(`/coverage/${b.dataset.clear}`, { method: 'DELETE' }); renderCoverage(content, actions); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Sped (Para not needed) times ----------
function openSpedBlocksModal(student) {
  let blocks = (student.sped_blocks || []).map((b) => ({ ...b }));
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  document.body.appendChild(backdrop);
  const draw = () => {
    backdrop.innerHTML = `<div class="modal" style="width:560px;">
      <h3>Sped times: ${esc(student.name)}</h3>
      <p class="field-hint">When this student is in their Sped classroom and no Para is needed. The scheduler won't place sessions in these times, and they show in the Master Schedule's Sped column.</p>
      <div id="spedRows">${blocks.map((b, i) => `<div class="sped-row">
          <select data-i="${i}" data-f="day_of_week">${WORK_DAYS.map((d) => `<option value="${d}" ${b.day_of_week === d ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select>
          <input type="time" data-i="${i}" data-f="start_time" value="${b.start_time}" />
          <input type="time" data-i="${i}" data-f="end_time" value="${b.end_time}" />
          <input data-i="${i}" data-f="label" value="${esc(b.label || '')}" placeholder="Label" />
          <button class="btn-danger-text" data-rm="${i}">×</button></div>`).join('') || '<p style="color:var(--ink-soft)">No Sped times yet.</p>'}</div>
      <div style="display:flex;gap:8px;margin-top:10px;"><button class="btn btn-outline btn-sm" id="spAdd">+ Add time</button><button class="btn btn-outline btn-sm" id="spWeek">+ Same time Mon–Fri</button></div>
      <div class="modal-actions"><button class="btn btn-outline" id="spCancel">Cancel</button><button class="btn btn-amber" id="spSave">Save</button></div></div>`;
    backdrop.querySelectorAll('[data-f]').forEach((el) => (el.onchange = () => { const b = blocks[el.dataset.i]; b[el.dataset.f] = el.dataset.f === 'day_of_week' ? Number(el.value) : el.value; }));
    backdrop.querySelectorAll('[data-rm]').forEach((el) => (el.onclick = () => { blocks.splice(Number(el.dataset.rm), 1); draw(); }));
    backdrop.querySelector('#spAdd').onclick = () => { blocks.push({ day_of_week: 1, start_time: '08:00', end_time: '09:00', label: 'Sped classroom' }); draw(); };
    backdrop.querySelector('#spWeek').onclick = () => { WORK_DAYS.forEach((d) => blocks.push({ day_of_week: d, start_time: '08:00', end_time: '09:00', label: 'Sped classroom' })); draw(); };
    backdrop.querySelector('#spCancel').onclick = () => backdrop.remove();
    backdrop.querySelector('#spSave').onclick = async () => {
      try {
        await api(`/students/${student.id}/sped-blocks`, { method: 'PUT', body: JSON.stringify({ blocks }) });
        backdrop.remove(); toast('Sped times saved. Regenerate the week to apply.'); await loadAll(); setView('students');
      } catch (e) { toast(e.message, true); }
    };
  };
  draw();
}
