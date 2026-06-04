const API = 'api.php';
let csrfToken = '';
let editMode  = false;
// ── Boot ──
document.addEventListener('DOMContentLoaded', async () => {
    await fetchCsrf();
    await loadDoctors();
    await loadAppointments();
    setupForm();
    setMinDate();
});

async function fetchCsrf() {
    try {
        const { success, token } = await getJson(`${API}?action=csrf_token`);
        if (success) csrfToken = token;
    } catch { /* silently fail; CSRF error will surface on form submit */ }
}

function setMinDate() {
    document.getElementById('appointment_date').min = today();
}
// ── Data Loaders ──
async function loadDoctors() {
    try {
        const { success, data } = await getJson(`${API}?action=doctors`);
        if (!success) return;
        const select = document.getElementById('doctor_id');
        select.innerHTML = '<option value="">— Select Doctor —</option>';
        data.forEach(({ id, name, specialization }) => {
            select.insertAdjacentHTML('beforeend',
                `<option value="${id}">${name} (${specialization})</option>`);
        });
    } catch { showToast('Failed to load doctors.', 'error'); }
}

async function loadAppointments() {
    const tbody = document.getElementById('appointmentTableBody');
    tbody.innerHTML = loadingRow();
    try {
        const { success, data } = await getJson(API);
        renderTable(success ? data : []);
    } catch {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-row error-text">Failed to load appointments. API error.</td></tr>`;
    }
}
// ── Render ──
function renderTable(list) {
    const tbody = document.getElementById('appointmentTableBody');
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-row">📋 No appointments yet. Book one above!</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(appt => `
        <tr id="row-${appt.id}" class="appt-row">
            <td>#${appt.id}</td>
            <td>
                <div class="patient-name">${esc(appt.patient_name)}</div>
                <div class="patient-email">${esc(appt.email)}</div>
            </td>
            <td>${esc(appt.mobile)}</td>
            <td>
                <div class="doctor-name">${esc(appt.doctor_name || 'N/A')}</div>
                <div class="doctor-spec">${esc(appt.specialization || '')}</div>
            </td>
            <td>${fmtDate(appt.appointment_date)}</td>
            <td>${fmtTime(appt.appointment_time)}</td>
            <td>
                <select class="status-select status-${appt.status.toLowerCase()}"
                        onchange="updateStatus(${appt.id}, this.value, this)">
                    ${['Pending','Confirmed','Cancelled'].map(s =>
                        `<option value="${s}" ${appt.status === s ? 'selected' : ''}>${statusEmoji(s)} ${s}</option>`
                    ).join('')}
                </select>
            </td>
            <td>
                <button class="btn-edit"   onclick="editAppointment(${appt.id})">✏️ Edit</button>
                <button class="btn-delete" onclick="deleteAppointment(${appt.id}, '${esc(appt.patient_name)}')">🗑️ Delete</button>
            </td>
        </tr>`).join('');
}
// ── Form Setup ──
function setupForm() {
    document.getElementById('appointmentForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!validateForm()) return;

        const id   = document.getElementById('appt_id').value;
        const body = collectFormData();

        if (id && id !== '0') {
            body.id = parseInt(id);
            await saveAppointment('PUT', body, 'Appointment updated successfully!');
        } else {
            await saveAppointment('POST', body, 'Appointment booked successfully!');
        }
    });

    // Slot check when doctor or date changes
    ['doctor_id', 'appointment_date'].forEach(id =>
        document.getElementById(id).addEventListener('change', checkSlots)
    );
}

function collectFormData() {
    return {
        patient_name:     field('patient_name'),
        email:            field('email'),
        mobile:           field('mobile'),
        doctor_id:        field('doctor_id'),
        appointment_date: field('appointment_date'),
        appointment_time: field('appointment_time'),
        csrf_token:       csrfToken
    };
}
// ── CRUD ──
async function saveAppointment(method, body, successMsg) {
    setBtnLoading(true, method === 'PUT' ? 'Updating...' : 'Booking...');
    clearError();
    try {
        const data = await sendJson(method, body);
        if (data.success) {
            showToast(`✅ ${data.message}`, 'success');
            resetForm();
            await loadAppointments();
            if (data.id || body.id) setTimeout(() => highlightRow(data.id || body.id), 300);
        } else {
            showError(data.message);
        }
    } catch { showError('API failure. Please check your connection.'); }
    finally  { setBtnLoading(false); }
}

async function editAppointment(id) {
    try {
        // fetch only the one record instead of the full list
        const { success, data } = await getJson(`${API}?action=get&id=${id}`);
        if (!success) { showToast('Appointment not found.', 'error'); return; }

        const a = data;
        document.getElementById('appt_id').value          = a.id;
        document.getElementById('patient_name').value     = a.patient_name;
        document.getElementById('email').value            = a.email;
        document.getElementById('mobile').value           = a.mobile;
        document.getElementById('doctor_id').value        = a.doctor_id;
        document.getElementById('appointment_date').value = a.appointment_date;
        document.getElementById('appointment_time').value = a.appointment_time;

        setEditMode(true);
        document.querySelectorAll('.appt-row').forEach(r => r.classList.remove('editing'));
        document.getElementById(`row-${id}`)?.classList.add('editing');
        document.getElementById('appointmentForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
        await checkSlots();
    } catch { showToast('Failed to load appointment.', 'error'); }
}

async function deleteAppointment(id, name) {
    if (!confirm(`Delete appointment for "${name}"?`)) return;
    try {
        const data = await sendJson('DELETE', { id, csrf_token: csrfToken });
        if (data.success) {
            const row = document.getElementById(`row-${id}`);
            if (row) {
                Object.assign(row.style, { transition: 'opacity .4s, transform .4s', opacity: '0', transform: 'translateX(30px)' });
                setTimeout(() => loadAppointments(), 450);
            }
            showToast(`🗑️ ${data.message}`, 'success');
        } else { showToast(data.message, 'error'); }
    } catch { showToast('API failure. Could not delete.', 'error'); }
}

async function updateStatus(id, status, selectEl) {
    try {
        const data = await sendJson('PUT', { id, status, csrf_token: csrfToken }, '?action=status');
        if (data.success) {
            selectEl.className = `status-select status-${status.toLowerCase()}`;
            showToast(`✅ Status → ${status}`, 'success');
            highlightRow(id);
        } else {
            showToast(data.message, 'error');
            await loadAppointments();
        }
    } catch { await loadAppointments(); }
}
// ── Slot Check ──
async function checkSlots() {
    const docId = field('doctor_id');
    const date  = field('appointment_date');
    const info  = document.getElementById('slotInfo');
    if (!docId || !date) { info.style.display = 'none'; return; }

    try {
        const { success, available_slots, booked, max_per_day } =
            await getJson(`${API}?action=check_slots&doctor_id=${docId}&date=${date}`);
        if (!success) { info.style.display = 'none'; return; }
        info.style.display = 'block';
        if (available_slots <= 0) {
            info.className = 'slot-info slot-full';
            info.textContent = `⚠️ No slots available (${booked}/${max_per_day} booked)`;
        } else {
            info.className = 'slot-info slot-available';
            info.textContent = `✅ ${available_slots} slot(s) available (${booked}/${max_per_day} booked)`;
        }
    } catch { info.style.display = 'none'; }
}
// ── Validation ──
function validateForm() {
    clearError();
    const errors = [];

    const checks = [
        { id: 'patient_name',     msg: 'Patient name is required' },
        { id: 'email',            msg: 'Email is required' },
        { id: 'mobile',           msg: 'Mobile number is required' },
        { id: 'doctor_id',        msg: 'Please select a doctor' },
        { id: 'appointment_date', msg: 'Appointment date is required' },
        { id: 'appointment_time', msg: 'Appointment time is required' },
    ];

    // Reset field highlights
    checks.forEach(({ id }) => document.getElementById(id).classList.remove('field-error'));

    checks.forEach(({ id, msg }) => {
        if (!field(id)) {
            errors.push(msg);
            document.getElementById(id).classList.add('field-error'); // highlight field
        }
    });

    const email  = field('email');
    const mobile = field('mobile');
    const date   = field('appointment_date');
    const time   = field('appointment_time');

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('Invalid email format');
        document.getElementById('email').classList.add('field-error');
    }

    const digits = mobile.replace(/\D/g, '');
    if (mobile && digits.length !== 10) {
        errors.push('Mobile must be 10 digits');
        document.getElementById('mobile').classList.add('field-error');
    }

    if (date && date < today()) {
        errors.push('Date cannot be in the past');
        document.getElementById('appointment_date').classList.add('field-error');
    }

    if (time) {
        const hour = parseInt(time.split(':')[0]);
        if (hour < 8 || hour >= 20) {
            errors.push('Time must be between 08:00 AM and 08:00 PM');
            document.getElementById('appointment_time').classList.add('field-error');
        }
    }

    if (errors.length) { showError(errors.join('<br>')); return false; }
    return true;
}
// ── Form State ──
function cancelEdit() { resetForm(); document.querySelectorAll('.appt-row').forEach(r => r.classList.remove('editing')); }

function resetForm() {
    document.getElementById('appointmentForm').reset();
    document.getElementById('appt_id').value = '0';
    document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
    setEditMode(false);
    document.getElementById('slotInfo').style.display = 'none';
    clearError();
}

function setEditMode(on) {
    editMode = on;
    document.getElementById('formTitle').textContent     = on ? '✏️ Edit Appointment' : '📅 Book Appointment';
    document.getElementById('submitBtn').textContent     = on ? '💾 Update Appointment' : '📅 Book Appointment';
    document.getElementById('cancelEditBtn').style.display = on ? 'inline-flex' : 'none';
}

function setBtnLoading(loading, text = '') {
    const btn = document.getElementById('submitBtn');
    btn.disabled = loading;
    if (loading) { btn.dataset.orig = btn.textContent; btn.textContent = text; }
    else         { btn.textContent = editMode ? '💾 Update Appointment' : '📅 Book Appointment'; }
}
// ── UI Helpers ──
function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast toast-${type} show`;
    setTimeout(() => t.classList.remove('show'), 4000);
}

function showError(msg) {
    const el = document.getElementById('formError');
    el.innerHTML = `⚠️ ${msg}`;
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearError() {
    const el = document.getElementById('formError');
    el.style.display = 'none';
    el.innerHTML = '';
}

function highlightRow(id) {
    const row = document.getElementById(`row-${id}`);
    if (!row) return;
    row.classList.add('highlight');
    setTimeout(() => row.classList.remove('highlight'), 2500);
}

function loadingRow() {
    return `<tr><td colspan="8" class="loading-row"><div class="spinner"></div> Loading...</td></tr>`;
}

function statusEmoji(s) { return { Pending: '⏳', Confirmed: '✅', Cancelled: '❌' }[s] || ''; }
// ── Fetch Wrappers ──
async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`HTTP Error: ${res.status}`);
    }
    return await res.json();
}

async function sendJson(method, body, queryStr = '') {
    const res = await fetch(API + queryStr, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'API Error');   }
    return res.json(); }
    
// ── Utility ──
const field = id => document.getElementById(id).value.trim();
const today = ()  => new Date().toISOString().split('T')[0];

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') .replace(/'/g,'&#39;');
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtTime(t) {
    if (!t) return '—';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}