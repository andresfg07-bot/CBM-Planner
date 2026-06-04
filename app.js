// Supabase Config
const supabaseUrl = 'https://gvjemehvtrxwsokmyyby.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2amVtZWh2dHJ4d3Nva215eWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NTkxOTMsImV4cCI6MjA4OTQzNTE5M30.TSVtuYnGI2j9JymCJbjKsXlbs1hG2EpaHHuEksJuAqE';
let supabaseClient = null;

try {
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
    }
} catch (e) {
    console.error("Error initializing Supabase", e);
}

let dbClients = [];
let dbAnalysts = [];
let dbEquipment = [];
let currentUser = null;
let currentUserProfile = null; // { id, email, display_name, role, analyst_name }
let clientAnalystPreferences = []; // preferencias del cliente activo en el form [ {name, priority} ]
let draggedTaskId = null; // Declaración global necesaria

// ── Festivos Colombia 2026 (fuente única de verdad) ──────────────────────────
const COLOMBIA_HOLIDAYS_2026 = new Set([
    "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03",
    "2026-05-01", "2026-05-18", "2026-06-08", "2026-06-15", "2026-06-29",
    "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02",
    "2026-11-16", "2026-12-08", "2026-12-25"
]);

// ── Notificación toast no intrusiva ──────────────────────────────────────────
function showToast(message, type = 'error') {
    const existing = document.getElementById('cbm-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'cbm-toast';
    const bg = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#22c55e';
    toast.style.cssText = `position:fixed;bottom:1.5rem;right:1.5rem;background:${bg};color:#fff;padding:0.75rem 1.25rem;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.18);font-size:0.85rem;font-weight:600;z-index:9999;max-width:340px;line-height:1.4;transition:opacity .3s;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ── Overlay de carga inicial ─────────────────────────────────────────────────
function showLoadingOverlay(show) {
    let el = document.getElementById('cbm-loading-overlay');
    if (show) {
        if (el) return;
        el = document.createElement('div');
        el.id = 'cbm-loading-overlay';
        el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.75);display:flex;align-items:center;justify-content:center;z-index:8888;backdrop-filter:blur(2px);';
        el.innerHTML = '<div style="text-align:center;"><div style="width:44px;height:44px;border:4px solid #e2e8f0;border-top-color:var(--clr-blue,#2563eb);border-radius:50%;animation:cbm-spin 0.7s linear infinite;margin:0 auto 0.75rem;"></div><p style="font-size:0.85rem;font-weight:600;color:#64748b;">Cargando datos...</p></div>';
        if (!document.getElementById('cbm-spin-style')) {
            const st = document.createElement('style');
            st.id = 'cbm-spin-style';
            st.textContent = '@keyframes cbm-spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(st);
        }
        document.body.appendChild(el);
    } else {
        if (el) el.remove();
    }
}

let calendarRowHeight = parseInt(localStorage.getItem('cbm_row_height')) || 55;
let calendarColWidth = parseInt(localStorage.getItem('cbm_col_width')) || 140;

// ── Toggle sidebar ───────────────────────────────────────────────────────────
function toggleSidebar() {
    const sidebar  = document.querySelector('.sidebar');
    const btn      = document.getElementById('sidebar-toggle-btn');
    const overlay  = document.getElementById('sidebar-overlay');
    if (!sidebar || !btn) return;

    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // Modo gaveta: desliza como overlay
        const isOpen = sidebar.classList.toggle('mobile-open');
        if (overlay) overlay.classList.toggle('active', isOpen);
        // Ocultar botón cuando sidebar está abierto (overlay permite cerrarlo)
        btn.style.display = isOpen ? 'none' : 'flex';
    } else {
        // Modo desktop: collapse/expand
        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        btn.classList.toggle('collapsed', isCollapsed);
        // Resetear estado móvil por si se redimensionó
        sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
    }
}

// ── Sistema de roles de usuario ──────────────────────────────────────────────

/** Carga el perfil del usuario desde Supabase (role, analyst_name, display_name) */
async function loadUserProfile(userId) {
    if (!supabaseClient || !userId) return null;
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        if (error) {
            console.warn('Perfil no encontrado, usando viewer por defecto:', error.message);
            return { role: 'viewer', analyst_name: null, display_name: currentUser?.email?.split('@')[0] };
        }
        return data;
    } catch (e) {
        console.error('Error cargando perfil:', e);
        return { role: 'viewer', analyst_name: null };
    }
}

/** Aplica la UI según el rol: oculta/muestra nav, actualiza header, navega a vista por defecto */
function applyRoleUI() {
    const role = currentUserProfile?.role || 'viewer';

    // Vistas permitidas por rol
    const allowedViews = {
        admin:     ['dashboard', 'tasks', 'planning', 'finance', 'admin', 'reports'],
        analyst:   ['mywork', 'planning'],
        assistant: ['dashboard', 'tasks', 'planning', 'finance', 'reports'],
        viewer:    ['dashboard'],
    };
    const allowed = allowedViews[role] || allowedViews.viewer;

    // Mostrar/ocultar ítems del nav
    document.querySelectorAll('.nav-item[data-view]').forEach(nav => {
        const view = nav.getAttribute('data-view');
        nav.style.display = allowed.includes(view) ? 'flex' : 'none';
    });

    // Actualizar nombre y rol en el header
    const nameEl  = document.querySelector('.profile-info .name');
    const roleEl  = document.querySelector('.profile-info .role');
    const avatar  = document.querySelector('.avatar');
    const displayName = currentUserProfile?.display_name || currentUser?.email?.split('@')[0] || 'Usuario';
    const roleLabel   = { admin: 'Administrador', analyst: 'Analista', assistant: 'Asistente', viewer: 'Visitante' }[role] || role;
    if (nameEl)  nameEl.textContent  = displayName;
    if (roleEl)  roleEl.textContent  = roleLabel;
    if (avatar)  avatar.textContent  = displayName[0].toUpperCase();

    // Clase en body para CSS condicional por rol
    document.body.className = document.body.className
        .replace(/\brole-\w+\b/g, '').trim();
    document.body.classList.add(`role-${role}`);

    // Navegar a la vista por defecto del rol
    const defaultView = { admin: 'dashboard', analyst: 'mywork', assistant: 'tasks', viewer: 'dashboard' };
    switchView(defaultView[role] || 'dashboard');
}

// ── Cambio de contraseña ─────────────────────────────────────────────────────

function openChangePasswordModal() {
    const form = document.getElementById('changePasswordForm');
    if(form) form.reset();
    const errEl = document.getElementById('changePwdError');
    if(errEl) errEl.style.display = 'none';
    const btn = document.getElementById('changePwdSubmitBtn');
    if(btn) { btn.disabled = false; btn.textContent = 'Actualizar Contraseña'; }
    document.getElementById('changePasswordModal').classList.add('active');
}

async function submitChangePassword(e) {
    e.preventDefault();

    const newPwd     = document.getElementById('newPassword').value;
    const confirmPwd = document.getElementById('confirmPassword').value;
    const errEl      = document.getElementById('changePwdError');
    const btn        = document.getElementById('changePwdSubmitBtn');

    // Validar que coinciden
    if(newPwd !== confirmPwd) {
        errEl.textContent = 'Las contraseñas no coinciden. Verifica e intenta de nuevo.';
        errEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Actualizando...';
    errEl.style.display = 'none';

    try {
        const { error } = await supabaseClient.auth.updateUser({ password: newPwd });
        if(error) {
            errEl.textContent = 'Error: ' + error.message;
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Actualizar Contraseña';
        } else {
            closeModal('changePasswordModal');
            showToast('✓ Contraseña actualizada correctamente.', 'success');
        }
    } catch(err) {
        errEl.textContent = 'Error inesperado. Intenta de nuevo.';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Actualizar Contraseña';
    }
}

// Detectar token de recuperación en la URL (cuando el usuario llega desde el link del correo)
(function detectPasswordRecovery() {
    const hash = window.location.hash;
    if(hash.includes('access_token') && hash.includes('type=recovery')) {
        // Esperar a que Supabase procese el token automáticamente
        setTimeout(() => {
            const desc = document.getElementById('changePwdDesc');
            if(desc) desc.textContent = 'Ingresa tu nueva contraseña para completar la recuperación.';
            openChangePasswordModal();
            // Limpiar el token de la URL sin recargar
            history.replaceState(null, '', window.location.pathname);
        }, 800);
    }
})();

// ── Vista del analista: Mis Gestiones ────────────────────────────────────────

let myWorkTimeFilter = 'month';   // 'month' | 'week'
let myWorkWeekStart  = getStartOfWeekSafe(new Date());

function getStartOfWeekSafe(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=dom, 1=lun...
    const diff = (day === 0) ? -6 : 1 - day; // lunes como inicio
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function changeMyWorkWeek(delta) {
    myWorkWeekStart = new Date(myWorkWeekStart);
    myWorkWeekStart.setDate(myWorkWeekStart.getDate() + delta * 7);
    renderMyWorkView();
}

function setMyWorkFilter(filter) {
    myWorkTimeFilter = filter;
    if (filter === 'week') {
        myWorkWeekStart = getStartOfWeekSafe(new Date());
    }
    renderMyWorkView();
}

function renderMyWorkView() {
    const container = document.getElementById('mywork-tasks-list');
    const summaryEl = document.getElementById('mywork-summary');
    if (!container) return;

    const analystName = currentUserProfile?.analyst_name;

    if (!analystName) {
        container.innerHTML = `
            <div class="mywork-empty">
                <div class="mywork-empty-icon">⚙️</div>
                <p>Tu cuenta no tiene un analista asignado.</p>
                <p class="mywork-empty-sub">Contacta al administrador para configurar tu perfil.</p>
            </div>`;
        if (summaryEl) summaryEl.innerHTML = '';
        return;
    }

    const periodStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    // Filtro por semana: calcular rango lun-dom
    let weekEnd = null;
    if (myWorkTimeFilter === 'week') {
        weekEnd = new Date(myWorkWeekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
    }

    const myTasks = tasks
        .filter(t => {
            if (t.isAbsence) return false;
            if (!t.analysts_assignment?.some(a => a.name === analystName)) return false;
            if (myWorkTimeFilter === 'month') {
                return t.period === periodStr;
            } else {
                // Semana: al menos un día de campo dentro del rango
                const weekStartStr = myWorkWeekStart.toISOString().slice(0, 10);
                const weekEndStr   = weekEnd.toISOString().slice(0, 10);
                return t.scheduledDays?.some(d =>
                    d.date >= weekStartStr && d.date <= weekEndStr
                );
            }
        })
        .sort((a, b) => {
            const da = a.scheduledDays?.find(d => d.type === 'field')?.date || '9999';
            const db = b.scheduledDays?.find(d => d.type === 'field')?.date || '9999';
            return da.localeCompare(db);
        });

    // Barra de resumen
    const total      = myTasks.length;
    const pendientes = myTasks.filter(t => t.status === 'programada' || t.status === 'proyectada').length;
    const ejecutadas = myTasks.filter(t => t.status === 'ejecutada').length;
    const facturadas = myTasks.filter(t => t.status === 'facturada').length;

    // Etiqueta del período actual
    const periodLabel = myWorkTimeFilter === 'month'
        ? `${monthNames[currentMonth - 1]} ${currentYear}`
        : (() => {
            const fmt = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
            return `${fmt(myWorkWeekStart)} – ${fmt(weekEnd)}`;
          })();

    if (summaryEl) {
        summaryEl.innerHTML = `
            <!-- Controles de filtro -->
            <div class="mywork-filter-bar">
                <div class="view-toggle-group">
                    <button class="view-btn ${myWorkTimeFilter === 'month' ? 'active' : ''}"
                        onclick="setMyWorkFilter('month')">Mes</button>
                    <button class="view-btn ${myWorkTimeFilter === 'week' ? 'active' : ''}"
                        onclick="setMyWorkFilter('week')">Semana</button>
                </div>
                ${myWorkTimeFilter === 'week' ? `
                <div class="mywork-week-nav">
                    <button onclick="changeMyWorkWeek(-1)" class="mywork-nav-btn">&#8592;</button>
                    <span class="mywork-period-label">${periodLabel}</span>
                    <button onclick="changeMyWorkWeek(1)"  class="mywork-nav-btn">&#8594;</button>
                </div>` : `<span class="mywork-period-label">${periodLabel}</span>`}
            </div>
            <!-- Estadísticas -->
            <div class="mywork-stats-bar">
                <div class="mywork-stat"><span class="mywork-stat-num">${total}</span><span class="mywork-stat-label">Total</span></div>
                <div class="mywork-stat"><span class="mywork-stat-num" style="color:var(--clr-purple)">${pendientes}</span><span class="mywork-stat-label">Pendientes</span></div>
                <div class="mywork-stat"><span class="mywork-stat-num" style="color:var(--clr-blue)">${ejecutadas}</span><span class="mywork-stat-label">Ejecutadas</span></div>
                <div class="mywork-stat"><span class="mywork-stat-num" style="color:var(--clr-green)">${facturadas}</span><span class="mywork-stat-label">Facturadas</span></div>
            </div>`;
    }

    if (myTasks.length === 0) {
        container.innerHTML = `
            <div class="mywork-empty">
                <div class="mywork-empty-icon">📅</div>
                <p>No tienes gestiones asignadas este período.</p>
            </div>`;
        return;
    }

    // ── Layout Kanban: agrupar por estado ────────────────────────────────────
    const columns = [
        { key: 'proyectada', label: 'Proyectadas',  color: '#7c3aed', bg: '#f5f3ff', icon: '📋' },
        { key: 'programada', label: 'Programadas',  color: '#2563eb', bg: '#eff6ff', icon: '📅' },
        { key: 'ejecutada',  label: 'Ejecutadas',   color: '#d97706', bg: '#fffbeb', icon: '✅' },
        { key: 'facturada',  label: 'Facturadas',   color: '#16a34a', bg: '#f0fdf4', icon: '💰' },
    ];

    const grouped = {};
    columns.forEach(c => { grouped[c.key] = []; });
    myTasks.forEach(t => { if(grouped[t.status]) grouped[t.status].push(t); });

    // Solo mostrar columnas con gestiones
    const activeCols = columns.filter(c => grouped[c.key].length > 0);

    container.innerHTML = `
        <div class="mywork-kanban">
            ${activeCols.map(col => `
                <div class="mywork-column">
                    <div class="mywork-col-header" style="background:${col.color};">
                        <span class="mywork-col-icon">${col.icon}</span>
                        <span class="mywork-col-title">${col.label}</span>
                        <span class="mywork-col-count">${grouped[col.key].length}</span>
                    </div>
                    <div class="mywork-col-body">
                        ${grouped[col.key].map(t => renderMyWorkCard(t)).join('')}
                    </div>
                </div>
            `).join('')}
        </div>`;
}

function renderMyWorkCard(task) {
    const statusLabel = { proyectada: 'Proyectada', programada: 'Programada', ejecutada: 'Ejecutada', facturada: 'Facturada' };

    const fmt = (days) => days.length
        ? days.map(d => { const [,m,dd] = d.date.split('-'); return `${dd}/${m}`; }).join(', ')
        : null;
    const fieldStr = fmt(task.scheduledDays?.filter(d => d.type === 'field') || []);

    // Días de informe: solo los que le corresponden a ESTE analista
    const reportAssignments = getReportDayAssignments(task);
    const myReportDates = reportAssignments.get(currentUserProfile?.analyst_name) || [];
    const reportStr = myReportDates.length
        ? myReportDates.map(date => { const [,m,dd] = date.split('-'); return `${dd}/${m}`; }).join(', ')
        : null;

    const assign       = task.analysts_assignment?.find(a => a.name === currentUserProfile?.analyst_name);
    const isTitular    = assign?.isTitular;
    const makesReport  = assign?.makesReport;

    const canExecute   = task.status === 'programada';
    const canCsat      = task.status === 'ejecutada' && !task.csatScore && !task.clientNoResponse;
    const csatDone     = task.status === 'ejecutada' && (task.csatScore || task.clientNoResponse);

    return `
        <div class="mywork-card status-${task.status}">
            <div class="mywork-card-top" onclick="openTaskInfoModal('${task.id}')" style="cursor:pointer;" title="Ver detalle">
                <div class="mywork-card-info">
                    <h3 class="mywork-card-client">${task.client || task.clientName || '—'}</h3>
                    <p class="mywork-card-service">${task.serviceType || '—'}</p>
                    ${task.equipment || task.equipmentName
                        ? `<p class="mywork-card-equip">${task.equipment || task.equipmentName}</p>` : ''}
                </div>
            </div>

            <div class="mywork-card-dates">
                ${fieldStr  ? `<div class="mywork-date-row">🔧 Campo: <strong>${fieldStr}</strong></div>` : ''}
                ${reportStr ? `<div class="mywork-date-row">📝 Informe: <strong>${reportStr}</strong></div>` : ''}
                ${!fieldStr && !reportStr ? `<div class="mywork-date-row mywork-no-date">Sin días programados aún</div>` : ''}
                <div class="mywork-badges">
                    ${isTitular   ? '<span class="mywork-badge titular">Titular</span>'      : ''}
                    ${makesReport ? '<span class="mywork-badge report">Hace Informe</span>'  : ''}
                </div>
            </div>

            ${canExecute || canCsat || csatDone ? `
            <div class="mywork-card-actions">
                ${canExecute ? `<button class="mywork-btn btn-execute" onclick="analystMarkExecuted('${task.id}')">✓ Marcar como Ejecutada</button>` : ''}
                ${canCsat    ? `<button class="mywork-btn btn-csat"    onclick="analystOpenCsat('${task.id}')">📋 Llenar Encuesta CSAT</button>` : ''}
                ${csatDone && task.clientNoResponse ? `<div class="mywork-csat-done" style="background:#fff7ed;color:#c2410c;border-color:#fed7aa;">⚠️ Sin calificación — Cliente no respondió</div>` : ''}
                ${csatDone && !task.clientNoResponse ? `<div class="mywork-csat-done">⭐ CSAT completada — ${task.csatScore}/5</div>` : ''}
            </div>` : ''}
        </div>`;
}

async function analystMarkExecuted(taskId) {
    try {
        await updateTaskStatus(taskId, 'ejecutada');
        showToast('✓ Gestión marcada como Ejecutada', 'success');
        renderMyWorkView();
    } catch (e) {
        showToast('Error al actualizar el estado.', 'error');
    }
}

function analystOpenCsat(taskId) {
    openClosingMeetingModal(taskId);
}

// ── Gestión de usuarios (admin) ───────────────────────────────────────────────

let dbProfiles = []; // perfiles de todos los usuarios

async function loadAllProfiles() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.from('profiles').select('*').order('email');
    if (!error && data) dbProfiles = data;
}

async function renderUsersAdminSection() {
    const container = document.getElementById('admin-users-list');
    if (!container) return;

    await loadAllProfiles();

    if (dbProfiles.length === 0) {
        container.innerHTML = `<p style="color:var(--text-secondary); font-size:0.85rem; padding:1rem 0;">No se encontraron perfiles. Verifica que el SQL de profiles esté aplicado en Supabase.</p>`;
        return;
    }

    const roleOptions = ['admin','analyst','assistant','viewer'];

    container.innerHTML = `
        <table class="data-table dense-table">
            <thead>
                <tr>
                    <th>Email</th>
                    <th>Nombre</th>
                    <th>Rol</th>
                    <th>Analista vinculado</th>
                    <th style="width:6rem;">Guardar</th>
                </tr>
            </thead>
            <tbody>
                ${dbProfiles.map(p => `
                    <tr data-profile-id="${p.id}">
                        <td style="font-size:0.75rem; color:var(--text-secondary);">${p.email}</td>
                        <td><input class="profile-input" type="text" value="${p.display_name || ''}" placeholder="Nombre visible" data-field="display_name" style="width:100%; padding:0.3rem 0.5rem; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem;"></td>
                        <td>
                            <select class="profile-input" data-field="role" style="width:100%; padding:0.3rem; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem;">
                                ${roleOptions.map(r => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                            </select>
                        </td>
                        <td>
                            <select class="profile-input" data-field="analyst_name" style="width:100%; padding:0.3rem; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem;">
                                <option value="">— Ninguno —</option>
                                ${dbAnalysts.map(a => `<option value="${a.name}" ${p.analyst_name === a.name ? 'selected' : ''}>${a.name}</option>`).join('')}
                            </select>
                        </td>
                        <td>
                            <button class="mywork-btn btn-execute" style="font-size:0.72rem; padding:0.3rem 0.6rem; width:100%;"
                                onclick="saveUserProfile('${p.id}', this.closest('tr'))">
                                Guardar
                            </button>
                        </td>
                    </tr>`).join('')}
            </tbody>
        </table>`;
}

async function saveUserProfile(profileId, row) {
    const inputs = row.querySelectorAll('.profile-input');
    const updates = {};
    inputs.forEach(inp => { updates[inp.getAttribute('data-field')] = inp.value || null; });

    if (!supabaseClient) return;
    const { error } = await supabaseClient.from('profiles').update(updates).eq('id', profileId);
    if (error) {
        showToast('Error guardando perfil: ' + error.message, 'error');
    } else {
        showToast('✓ Perfil actualizado', 'success');
        // Actualizar la lista local
        const idx = dbProfiles.findIndex(p => p.id === profileId);
        if (idx >= 0) dbProfiles[idx] = { ...dbProfiles[idx], ...updates };
    }
}

// Cierra el sidebar en móvil al redimensionar a desktop
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const btn     = document.getElementById('sidebar-toggle-btn');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
        if (btn)     btn.style.display = 'flex';
    }
});

// ── SVG icon helpers ────────────────────────────────────────────────────────
const SVG_ICONS = {
    edit:   `<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    delete: `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    csat:   `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    revert: `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
    pref:   `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
};
function actionIcon(type, onclick, title) {
    return `<span class="action-icon ${type}" onclick="${onclick}" title="${title}">${SVG_ICONS[type] || ''}</span>`;
}

// ── Helper: assign a consistent color per analyst
function getAnalystColor(name) {
    if (!name) return '#9CA3AF'; // neutral for unassigned
    
    const lowerName = name.toLowerCase();
    // Asignaciones específicas solicitadas por el usuario
    if (lowerName.includes('nelson')) return '#EAB308'; // Amarillo
    if (lowerName.includes('sebastián') || lowerName.includes('sebastian')) return '#84CC16'; // Verde Lima

    const colorPalette = [
        '#1E40AF', // indigo-800
        '#7C3AED', // violet-600
        '#10B981', // emerald-600
        '#EF4444', // red-500
        '#F59E0B', // amber-500
        '#14B8A6', // teal-500
        '#6B7280', // gray-500
        '#D946EF', // fuchsia-500
        '#F97316', // orange-500
        '#0EA5E9'  // sky-500
    ];
    const idx = dbAnalysts.findIndex(a => a.name === name);
    return colorPalette[idx === -1 ? 0 : idx % colorPalette.length];
}

/** Convierte un color hex a su versión clara mezclándolo con blanco */
function getAnalystColorLight(name) {
    const hex = getAnalystColor(name);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Mezcla 55% blanco → versión pastel reconocible
    const factor = 0.55;
    const tr = Math.round(r + (255 - r) * factor);
    const tg = Math.round(g + (255 - g) * factor);
    const tb = Math.round(b + (255 - b) * factor);
    return `rgb(${tr}, ${tg}, ${tb})`;
}

function getClientDisplayName(c) {
    if (!c) return '';
    const company = c.company_name || '';
    const plant = c.plant || '';
    if (company === plant || !plant) return company;
    return `${company} - ${plant}`;
}

// Clean up stored client name strings like "Alico - Alico" → "Alico"
function cleanClientName(name) {
    if (!name) return '';
    const parts = name.split(' - ');
    if (parts.length === 2 && parts[0].trim() === parts[1].trim()) {
        return parts[0].trim();
    }
    return name;
}

// Period Management
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;

function formatPeriod() {
    return `${currentYear}-${currentMonth.toString().padStart(2, '0')}`;
}

// NUEVO: Manejo de vista Semanal
let calendarView = 'month'; // 'month' o 'week'
let currentWeekStart = getStartOfWeek(new Date());

function getStartOfWeek(date) {
    const d = new Date(date);
    d.setHours(0,0,0,0);
    const day = d.getDay(); // 0 is Sunday
    const diff = d.getDate() - day; // Domingo es el inicio (0)
    return new Date(d.setDate(diff));
}

// Utility to avoid crashes after Bitácora removal
function logActivity(message, type) {
    console.log(`[Activity Log - ${type}]: ${message.replace(/<[^>]*>/g, '')}`);
}

function getEndOfWeek(startDate) {
    const d = new Date(startDate);
    return new Date(d.setDate(d.getDate() + 6));
}

function isTaskInCurrentPeriod(t) {
    const currentPeriod = formatPeriod();
    if (t.status === 'proyectada') return true; // BACKLOG UNIVERSAL: Proyectadas siempre visibles
    if (!t.scheduledDays || t.scheduledDays.length === 0) return t.period === currentPeriod;
    return t.scheduledDays.some(sd => {
        const sdDate = sd.date ? sd.date.substring(0, 7) : `${t.period}`;
        return sdDate === currentPeriod;
    });
}

let dashboardFilters = {
    analyst: '',
    client: '',
    status: ''
};
let dashboardScope = 'month'; // 'month', 'year', 'all'
let workloadChartInstance = null;
let billingChartInstance = null;

const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function updatePeriodDisplay() {
    const display = document.getElementById('currentPeriodDisplay');
    const title = document.getElementById('calendar-title');
    if(!display) return;

    if (calendarView === 'month') {
        display.textContent = `${monthNames[currentMonth - 1]} ${currentYear}`;
        if(title) title.textContent = "Cronograma Mensual";
    } else {
        const start = currentWeekStart;
        const end = getEndOfWeek(start);
        const startDay = start.getDate();
        const startMonth = monthNames[start.getMonth()].substring(0, 3);
        const endDay = end.getDate();
        const endMonth = monthNames[end.getMonth()].substring(0, 3);
        
        display.textContent = `${startDay} ${startMonth} - ${endDay} ${endMonth} ${end.getFullYear()}`;
        if(title) title.textContent = "Cronograma Semanal";
    }
}

async function goToToday() {
    const today = new Date();
    currentYear = today.getFullYear();
    currentMonth = today.getMonth() + 1;
    currentWeekStart = getStartOfWeek(today);
    
    updatePeriodDisplay();
    if(supabaseClient) await loadTasksFromSupabase();
    renderCalendar();
}

async function changePeriod(delta) {
    if (calendarView === 'month') {
        currentMonth += delta;
        if(currentMonth > 12) {
            currentMonth = 1;
            currentYear++;
        } else if (currentMonth < 1) {
            currentMonth = 12;
            currentYear--;
        }
    } else {
        // Mover una semana
        const newDate = new Date(currentWeekStart);
        newDate.setDate(newDate.getDate() + (delta * 7));
        currentWeekStart = newDate;
        
        // Sincronizar mes/año para que las gestiones se filtren bien
        currentMonth = currentWeekStart.getMonth() + 1;
        currentYear = currentWeekStart.getFullYear();
    }
    updatePeriodDisplay();
    // Reload data from Supabase for the new period
    if(supabaseClient) {
        await loadTasksFromSupabase();
    }
    renderDashboardStats();
    renderCalendar();
    renderPlanningSidebar();
    renderTasksView();
    renderFinanceView();
    // Si el analista está en Mis Gestiones, actualizar también su vista
    if (document.getElementById('view-mywork')?.classList.contains('active-view')) {
        renderMyWorkView();
    }
}

// Initial State & Persistence
let tasks = JSON.parse(localStorage.getItem('cbm_tasks')) || [
    { id: 't1', client: 'Industrias XYZ', analyst: 'A', budget: 1500000, status: 'proyectada' },
    { id: 't2', client: 'Planta Alimentos SUR', analyst: 'B', budget: 2800000, status: 'programada' },
    { id: 't3', client: 'Minería Norte', analyst: 'C', budget: 5400000, status: 'ejecutada' },
];

// Migrate old tasks to have a period
let tasksModified = false;
tasks.forEach(t => {
    if(!t.period) {
        t.period = formatPeriod(); // Assign to current period
        tasksModified = true;
    }
    // Migration for Multi-day
    if(t.daysField === undefined) { t.daysField = 1; tasksModified = true; }
    if(t.daysReport === undefined) { t.daysReport = 0; tasksModified = true; }
    if(!t.scheduledDays) {
        t.scheduledDays = [];
        if(t.date) {
            t.scheduledDays.push({ day: parseInt(t.date), type: 'field' });
        }
        tasksModified = true;
    }
});
if(tasksModified) localStorage.setItem('cbm_tasks', JSON.stringify(tasks));



function saveTasks() {
    try {
        localStorage.setItem('cbm_tasks', JSON.stringify(tasks));
    } catch (e) {
        console.warn('localStorage lleno, no se pudo guardar localmente:', e);
        showToast('Advertencia: no se pudo guardar en caché local (almacenamiento lleno). Los datos siguen en la nube.', 'warning');
    }
}



// Generate unique ID
function generateId() {
    return 't_' + Math.random().toString(36).substr(2, 9);
}

// ── Skeleton loader para tablas ──────────────────────────────────────────────
function renderSkeletonTable(container, cols = 5, rows = 5) {
    const widths = ['60%','40%','30%','50%','25%'];
    const headerCells = Array.from({length: cols}, () => '<th></th>').join('');
    const bodyCells = Array.from({length: cols}, (_, i) =>
        `<td><div class="skeleton-cell" style="width:${widths[i % widths.length]}"></div></td>`
    ).join('');
    const bodyRows = Array.from({length: rows}, () => `<tr class="skeleton-row">${bodyCells}</tr>`).join('');
    container.innerHTML = `
        <table class="data-table">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>`;
}

// Render Board (UI only — data is loaded by init and changePeriod)
function renderBoard() {
    renderDashboardStats();
    renderTasksView();
}

function getGlobalFiltersHTML() {
    return `
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; background: #fff; padding: 0.5rem; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: var(--shadow-sm);">
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <label style="font-size: 0.6rem; font-weight: 700; color: #64748b; padding-left: 0.2rem;">ANALISTA</label>
                <select onchange="updateGlobalFilter('analyst', this.value)" style="padding: 0.25rem; font-size: 0.75rem; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 110px;">
                    <option value="">Todos</option>
                    ${dbAnalysts.map(a => `<option value="${a.name}" ${dashboardFilters.analyst === a.name ? 'selected' : ''}>${a.name}</option>`).join('')}
                </select>
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px;">
                <label style="font-size: 0.6rem; font-weight: 700; color: #64748b; padding-left: 0.2rem;">CLIENTE</label>
                <select onchange="updateGlobalFilter('client', this.value)" style="padding: 0.25rem; font-size: 0.75rem; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 110px;">
                    <option value="">Todos</option>
                    ${dbClients.map(c => getClientDisplayName(c)).map(name => `<option value="${name}" ${dashboardFilters.client === name ? 'selected' : ''}>${name}</option>`).join('')}
                </select>
            </div>
            <button onclick="resetGlobalFilters()" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.5rem; display: flex; align-items: center; gap: 4px;">
                ✕ Limpiar
            </button>
        </div>`;
}

function renderTasksTable(container) {
    const role = currentUserProfile?.role || 'admin';
    let filteredTasks = tasks.slice().filter(t => !t.isAbsence && isTaskInCurrentPeriod(t));

    if(dashboardFilters.analyst) filteredTasks = filteredTasks.filter(t => t.analyst === dashboardFilters.analyst);
    if(dashboardFilters.client) filteredTasks = filteredTasks.filter(t => t.client === dashboardFilters.client);
    if(dashboardFilters.status) filteredTasks = filteredTasks.filter(t => t.status === dashboardFilters.status);

    // Asistente: ve ejecutadas (para facturar) + facturadas (historial + Metro Administrativo)
    if (role === 'assistant') {
        filteredTasks = filteredTasks.filter(t =>
            t.status === 'ejecutada' || t.status === 'facturada'
        );
    }

    container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Gestión / Cliente</th>
                    <th>Tipo</th>
                    <th>Presupuesto</th>
                    <th>Analista</th>
                    <th style="width: 15rem;">Estado</th>
                    <th style="width: 8rem;">Acción</th>
                </tr>
            </thead>
            <tbody>
                ${filteredTasks.length === 0 ? '<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-secondary)">No hay gestiones para este periodo o filtros</td></tr>' : 
                filteredTasks.map(t => {
                    const statusOptions = ['proyectada', 'programada', 'ejecutada', 'facturada'];
                    const isFacturada = t.status === 'facturada';
                    const isEjecutada = t.status === 'ejecutada';
                    
                    return `
                    <tr data-task-id="${t.id}">
                        <td><strong>${t.client}</strong></td>
                        <td><span class="card-analyst" style="font-size:0.75rem">${t.serviceType || '-'}</span></td>
                        <td style="color:var(--clr-green); font-weight:600">$${(t.budget || 0).toLocaleString('es-CO')}</td>
                        <td>${formatAnalystDisplay(t)}</td>
                        <td>
                            <select onchange="updateTaskStatus('${t.id}', this.value)" style="padding: 0.4rem; font-size: 0.85rem; border-radius: 6px; border: 1px solid #cbd5e1; width: 100%; font-weight: 500;" ${isFacturada ? 'disabled' : ''}>
                                ${statusOptions.map(opt => {
                                    let optDisabled = false;
                                    if(isEjecutada && (opt === 'proyectada' || opt === 'programada')) optDisabled = true;
                                    return `<option value="${opt}" ${t.status === opt ? 'selected' : ''} ${optDisabled ? 'disabled' : ''}>${opt.toUpperCase()}</option>`;
                                }).join('')}
                            </select>
                        </td>
                        <td>
                            <div class="action-icons">
                                ${role === 'admin' ? `
                                    ${actionIcon('edit',   `openEditTaskModal('${t.id}')`,       'Editar')}
                                    ${actionIcon('csat',   `openClosingMeetingModal('${t.id}')`, 'Reunión de Cierre')}
                                    ${t.status === 'programada' ? actionIcon('revert', `revertToProjected('${t.id}')`, 'Revertir a Proyectada') : ''}
                                    ${actionIcon('delete', `deleteTask('${t.id}')`,              'Borrar')}
                                ` : role === 'assistant' ? `
                                    ${t.status === 'ejecutada' ? `
                                        <button class="mywork-btn btn-execute" style="font-size:0.72rem;padding:0.3rem 0.75rem;"
                                            onclick="updateTaskStatus('${t.id}','facturada')">
                                            💰 Facturar
                                        </button>` : `
                                        <span style="font-size:0.72rem; color:var(--clr-green); font-weight:600;">✓ Facturada</span>`}
                                ` : ''}
                            </div>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
}

function renderTasksView() {
    const listContainer = document.getElementById('tasks-list-container');
    if (!listContainer) return;
    if (tasks.length === 0) {
        renderSkeletonTable(listContainer, 6, 4);
        return;
    }
    renderTasksTable(listContainer);
}

async function updateTaskStatus(taskId, newStatus) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;

    // Restricción: Lógica estricta de estados
    if(task.status === 'facturada') {
        alert('Una gestión facturada no puede ser modificada.');
        renderBoard();
        return;
    }
    if(task.status === 'ejecutada' && (newStatus === 'programada' || newStatus === 'proyectada')) {
        alert('No se puede volver a programar o proyectar una gestión ya ejecutada. Solo puede pasar a facturada.');
        renderBoard();
        return;
    }
    // Confirmación irreversible: programada → ejecutada
    if(task.status === 'programada' && newStatus === 'ejecutada') {
        const confirmed = confirm(
            '⚠️ ACCIÓN IRREVERSIBLE\n\n' +
            'Estás a punto de marcar esta gestión como EJECUTADA.\n\n' +
            'Una vez ejecutada, no podrá volver a estado Programada o Proyectada.\n\n' +
            '¿Confirmas que el trabajo de campo fue realizado?'
        );
        if(!confirmed) {
            renderBoard();
            return;
        }
    }

    const oldStatus = task.status;
    task.status = newStatus;
    
    // Si se pasa a proyectada, se quita la programación
    if(newStatus === 'proyectada') {
        task.scheduledDays = [];
    }
    if(!Array.isArray(task.scheduledDays)) task.scheduledDays = [];

    if(supabaseClient) {
        await supabaseClient.from('tasks').update({ 
            status: newStatus, 
            scheduled_days: task.scheduledDays || [], 
            analyst: task.analyst,
            analysts_assignment: task.analysts_assignment || [] 
        }).eq('id', taskId);
    }
    
    saveTasks();
    if(typeof postDropSync === 'function') {
        postDropSync();
    } else {
        renderBoard();
        renderCalendar();
        if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
        renderTasksView();
        renderDashboardStats();
    }
}

async function deleteTask(taskId) {
    if(!confirm('¿Estás seguro de que deseas borrar esta gestión?')) return;
    
    const taskToDelete = tasks.find(t => t.id === taskId);
    const clientName = taskToDelete ? taskToDelete.client : 'Gestión';
    
    const index = tasks.findIndex(t => t.id === taskId);
    if(index === -1) return;
    
    tasks.splice(index, 1);
    
    if(supabaseClient) {
        await supabaseClient.from('tasks').delete().eq('id', taskId);
    }
    
    saveTasks();
    renderBoard();
    renderCalendar();
    if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
    renderTasksView();
    renderDashboardStats();

}

async function revertToProjected(taskId) {
    if(!confirm('¿Deseas quitar la programación y volver a estado Proyectada?')) return;
    await updateTaskStatus(taskId, 'proyectada');
}

function renderDashboardStats() {
    const dashboardStats = document.querySelector('#view-dashboard .dashboard-stats');
    if(!dashboardStats) return;
    
    // 1. Filtrado de datos por SCOPE (Mes, Año, Todo)
    let gestionesFiltradas = tasks.filter(t => !t.isAbsence);
    let ausenciasFiltradas = tasks.filter(t => t.isAbsence);

    if (dashboardScope === 'month') {
        const periodKey = formatPeriod();
        gestionesFiltradas = gestionesFiltradas.filter(t => {
            if (t.status === 'proyectada') return t.period === periodKey; 
            if (!t.scheduledDays || t.scheduledDays.length === 0) return t.period === periodKey;
            return t.scheduledDays.some(sd => (sd.date ? sd.date.substring(0, 7) : t.period) === periodKey);
        });
        ausenciasFiltradas = ausenciasFiltradas.filter(t => t.scheduledDays && t.scheduledDays.some(sd => (sd.date ? sd.date.substring(0, 7) : t.period) === periodKey));
    } else if (dashboardScope === 'year') {
        const yearStr = currentYear.toString();
        gestionesFiltradas = gestionesFiltradas.filter(t => {
            if (t.status === 'proyectada') return true;
            if (!t.scheduledDays || t.scheduledDays.length === 0) return t.period.startsWith(yearStr);
            return t.scheduledDays.some(sd => (sd.date ? sd.date.substring(0, 4) : t.period.substring(0,4)) === yearStr);
        });
        ausenciasFiltradas = ausenciasFiltradas.filter(t => t.scheduledDays && t.scheduledDays.some(sd => (sd.date ? sd.date.substring(0, 4) : t.period.substring(0,4)) === yearStr));
    }
    // Si es 'all', no aplicamos filtro de tiempo adicional

    if(dashboardFilters.analyst) {
        gestionesFiltradas = gestionesFiltradas.filter(t => t.analyst === dashboardFilters.analyst);
        ausenciasFiltradas = ausenciasFiltradas.filter(t => t.analyst === dashboardFilters.analyst);
    }

    if(dashboardFilters.client) {
        gestionesFiltradas = gestionesFiltradas.filter(t => t.client === dashboardFilters.client);
    }

    const totalGestiones = gestionesFiltradas.length;
    const informesRealizados = gestionesFiltradas.filter(t => t.status === 'ejecutada' || t.status === 'facturada').length;
    
    // Cálculo por analista
    const analystStats = {};
    gestionesFiltradas.forEach(t => {
        // Metro Administrativo no cuenta en estadísticas por analista
        if(!t.analyst || t.serviceType === 'Metro Administrativo') return;
        if(!analystStats[t.analyst]) analystStats[t.analyst] = { closed: 0, total: 0, csat: 0, csatCount: 0 };
        analystStats[t.analyst].total++;
        if(t.status === 'facturada' || t.status === 'ejecutada') analystStats[t.analyst].closed++;
        if(t.csatScore && !t.clientNoResponse) {
            analystStats[t.analyst].csat += parseFloat(t.csatScore);
            analystStats[t.analyst].csatCount++;
        }
    });

    const absenceByAnalyst = {};
    ausenciasFiltradas.forEach(t => {
        if(!absenceByAnalyst[t.analyst]) absenceByAnalyst[t.analyst] = { count: 0 };
        absenceByAnalyst[t.analyst].count += (t.scheduledDays ? t.scheduledDays.length : 0);
    });

    // Renderizado HTML
    let html = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem; width: 100%;">
            <!-- Fila 1: KPIs Generales -->
            <div class="mini-stats-grid">
                <div class="mini-kpi-card">
                    <h4>Total Gestiones</h4>
                    <div class="value">${totalGestiones}</div>
                    <div style="font-size: 0.7rem; color: var(--text-secondary)">${dashboardFilters.dateFrom ? 'Rango personalizado' : 'Proyectadas en ' + monthNames[currentMonth-1]}</div>
                </div>
                <div class="mini-kpi-card" style="border-bottom-color: var(--clr-purple)">
                    <h4>Informes Realizados</h4>
                    <div class="value">${informesRealizados}</div>
                    <div style="font-size: 0.7rem; color: var(--text-secondary)">Ejecutados / Facturables</div>
                </div>
                <div class="mini-kpi-card" style="border-bottom-color: var(--clr-green)">
                    <h4>Eficiencia Operativa</h4>
                    <div class="value">${totalGestiones > 0 ? Math.round((informesRealizados/totalGestiones)*100) : 0}%</div>
                    <div style="font-size: 0.7rem; color: var(--text-secondary)">Ratio de avance filtrado</div>
                </div>
            </div>

            <!-- Fila 2: Desempeño y Ausencias -->
            <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
                <div class="performance-table-card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                        <h3 style="margin: 0;">Indicadores por Analista</h3>
                        
                        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; background: #f8fafc; padding: 0.5rem; border-radius: 8px; border: 1px solid #e2e8f0;">
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <label style="font-size: 0.6rem; font-weight: 700; color: #64748b; padding-left: 0.2rem;">ANALISTA</label>
                                <select onchange="updateGlobalFilter('analyst', this.value)" style="padding: 0.25rem; font-size: 0.75rem; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 120px;">
                                    <option value="">Todos</option>
                                    ${dbAnalysts.map(a => `<option value="${a.name}" ${dashboardFilters.analyst === a.name ? 'selected' : ''}>${a.name}</option>`).join('')}
                                </select>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <label style="font-size: 0.6rem; font-weight: 700; color: #64748b; padding-left: 0.2rem;">CLIENTE</label>
                                <select onchange="updateGlobalFilter('client', this.value)" style="padding: 0.25rem; font-size: 0.75rem; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 120px;">
                                     <option value="">Todos</option>
                                     ${dbClients.map(c => {
                                         const cName = getClientDisplayName(c);
                                         return `<option value="${cName}" ${dashboardFilters.client === cName ? 'selected' : ''}>${cName}</option>`;
                                     }).join('')}
                                 </select>
                            </div>
                            <button onclick="resetGlobalFilters()" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.5rem; display: flex; align-items: center; gap: 4px; margin-top: 10px;">
                                ✕ Limpiar Filtros
                            </button>
                        </div>
                    </div>

                    <div class="table-container" style="box-shadow: none; border: none;">
                        <table class="data-table" style="font-size: 0.8rem;">
                            <thead>
                                <tr>
                                    <th>Analista</th>
                                    <th>Gestiones</th>
                                    <th>Cerradas</th>
                                    <th>CSAT Promedio</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Object.keys(analystStats).length === 0 ? '<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-secondary)">No se encontraron gestiones con los filtros aplicados</td></tr>' : 
                                  Object.entries(analystStats).map(([name, data]) => `
                                    <tr>
                                        <td><strong>${name}</strong></td>
                                        <td>${data.total}</td>
                                        <td><span style="color:var(--clr-green); font-weight:700;">${data.closed}</span></td>
                                        <td>${data.csatCount > 0 ? '⭐ ' + (data.csat / data.csatCount).toFixed(1) : '-'}</td>
                                    </tr>
                                  `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="stats-card absence-metrics-card" style="flex: 1; min-width: 280px;">
                    <h3>Ausencias</h3>
                    ${Object.keys(absenceByAnalyst).length === 0 ? 
                        '<p style="font-size:0.8rem; color:var(--text-secondary)">Sin novedades registradas.</p>' : 
                        `<div style="display:flex; flex-direction:column; gap:0.5rem;">
                            ${Object.entries(absenceByAnalyst).map(([name, data]) => `
                                <div class="absence-tag" onclick="openAbsenceDetailModal('${name.replace(/'/g, "\\'")}')" style="background:var(--clr-pink-light); padding:0.5rem 1rem; border-radius:var(--radius-md); border-left:3px solid var(--clr-pink); display:flex; justify-content:space-between; align-items:center;">
                                    <span style="font-weight:700; font-size:0.8rem">${name}</span> 
                                    <span style="color:var(--clr-pink); font-weight:800">${data.count} días</span>
                                </div>
                            `).join('')}
                        </div>`
                    }
                </div>
            </div>
        </div>
    `;
    
    dashboardStats.innerHTML = html;
    dashboardStats.style.display = 'flex';
    
    // Solo renderizar gráficos si estamos en la vista de dashboard
    if (document.getElementById('view-dashboard').classList.contains('active-view')) {
        renderDashboardCharts();
        renderAnalystGauges(analystStats);
    }
}

// ── REQ-03: Gauges CSAT por analista ────────────────────────────────────────
let _gaugeInstances = {};

function renderAnalystGauges(analystStats) {
    const section = document.getElementById('analyst-gauges-section');
    if(!section) return;

    // Solo analistas con al menos una gestión calificada
    const entries = Object.entries(analystStats)
        .map(([name, s]) => ({
            name,
            avg:   s.csatCount > 0 ? (s.csat / s.csatCount) : null,
            count: s.csatCount,
            total: s.total
        }))
        .filter(e => e.total > 0);

    if(entries.length === 0) {
        section.innerHTML = '';
        return;
    }

    const gaugeColor = avg => {
        if(avg === null) return '#cbd5e1';
        if(avg >= 4)    return '#16a34a';
        if(avg >= 3)    return '#f59e0b';
        return '#ef4444';
    };

    section.innerHTML = `
        <div class="stats-card" style="padding:1.25rem;">
            <h3 style="margin:0 0 0.25rem; font-size:1rem;">Calificación CSAT por Analista</h3>
            <p style="font-size:0.75rem; color:var(--text-secondary); margin:0 0 1.25rem;">
                Promedio de gestiones calificadas. Excluye casos sin respuesta del cliente.
            </p>
            <div class="gauges-grid">
                ${entries.map(e => `
                    <div class="gauge-card">
                        <canvas id="gauge-${e.name.replace(/\s+/g,'_')}" width="160" height="90"></canvas>
                        <div class="gauge-value" style="color:${gaugeColor(e.avg)}">
                            ${e.avg !== null ? e.avg.toFixed(1) : '—'}
                            <span class="gauge-max">/5</span>
                        </div>
                        <div class="gauge-name">${e.name}</div>
                        <div class="gauge-sub">${e.count} calificación${e.count !== 1 ? 'es' : ''} · ${e.total} gestión${e.total !== 1 ? 'es' : ''}</div>
                    </div>
                `).join('')}
            </div>
        </div>`;

    // Destruir instancias previas
    Object.values(_gaugeInstances).forEach(c => c.destroy());
    _gaugeInstances = {};

    // Crear gauge por analista
    entries.forEach(e => {
        const canvasId = `gauge-${e.name.replace(/\s+/g,'_')}`;
        const ctx = document.getElementById(canvasId);
        if(!ctx) return;

        const score = e.avg !== null ? e.avg : 0;
        const remaining = 5 - score;
        const color = gaugeColor(e.avg);

        _gaugeInstances[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [score, remaining],
                    backgroundColor: [color, '#e2e8f0'],
                    borderWidth: 0,
                    borderRadius: 4
                }]
            },
            options: {
                rotation: -90,
                circumference: 180,
                cutout: '72%',
                responsive: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ctx.dataIndex === 0
                                ? `Promedio: ${score.toFixed(1)} / 5`
                                : ''
                        }
                    }
                }
            }
        });
    });
}

function updateGlobalFilter(type, value) {
    dashboardFilters[type] = value;
    
    // Refresh all relevant views via renderBoard
    renderBoard();
    renderCalendar();
    renderPlanningSidebar();
    populateGlobalFilterDropdowns();
}

function resetGlobalFilters() {
    dashboardFilters = {
        analyst: '',
        client: '',
        status: ''
    };
    
    const filterTasksStatus = document.getElementById('filter-tasks-status');
    if(filterTasksStatus) filterTasksStatus.value = '';
    
    renderBoard();
    renderCalendar();
    renderPlanningSidebar();
    populateGlobalFilterDropdowns();
}

// NUEVAS FUNCIONES PARA DASHBOARD CHARTS
function changeDashboardScope(scope) {
    dashboardScope = scope;
    
    // UI Update
    document.querySelectorAll('#view-dashboard .view-toggle-group button').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`scope-${scope}`);
    if(activeBtn) activeBtn.classList.add('active');
    
    renderDashboardStats();
}

function changeCalendarView(view) {
    calendarView = view;

    // UI Update
    document.querySelectorAll('#view-planning .view-toggle-group button').forEach(btn => {
        btn.classList.remove('active');
    });

    const activeBtn = document.getElementById(`btn-view-${view}`);
    if(activeBtn) activeBtn.classList.add('active');

    // Sincronizar currentWeekStart al cambiar a vista semana
    if (view === 'week') {
        const today = new Date();
        if (today.getMonth() + 1 === currentMonth && today.getFullYear() === currentYear) {
            currentWeekStart = getStartOfWeek(today);
        } else {
            currentWeekStart = getStartOfWeek(new Date(currentYear, currentMonth - 1, 1));
        }
    }

    updatePeriodDisplay();
    renderCalendar();
}


function renderDashboardCharts() {
    // 1. Preparar datos segun el scope actual
    let chartData = tasks.filter(t => !t.isAbsence);

    if (dashboardScope === 'month') {
        const periodKey = formatPeriod();
        chartData = chartData.filter(t => {
            if (t.status === 'proyectada') return true;
            if (!t.scheduledDays || t.scheduledDays.length === 0) return t.period === periodKey;
            return t.scheduledDays.some(sd => (sd.date ? sd.date.substring(0, 7) : t.period) === periodKey);
        });
    } else if (dashboardScope === 'year') {
        const yearStr = currentYear.toString();
        chartData = chartData.filter(t => {
            if (t.status === 'proyectada') return true;
            if (!t.scheduledDays || t.scheduledDays.length === 0) return t.period.startsWith(yearStr);
            return t.scheduledDays.some(sd => (sd.date ? sd.date.substring(0, 4) : t.period.substring(0,4)) === yearStr);
        });
    }

    // 2. Aplicar filtros globales del dashboard a los gráficos
    if (dashboardFilters.analyst) {
        chartData = chartData.filter(t => {
            if (t.analysts_assignment && t.analysts_assignment.length > 0)
                return t.analysts_assignment.some(a => a.name === dashboardFilters.analyst);
            return t.analyst === dashboardFilters.analyst;
        });
    }
    if (dashboardFilters.client) {
        chartData = chartData.filter(t => t.client === dashboardFilters.client);
    }
    if (dashboardFilters.status) {
        chartData = chartData.filter(t => t.status === dashboardFilters.status);
    }

    const workloadMap = {};
    const billingMap = {};

    // 3. Distribuir gestiones compartidas por porcentaje de participación
    chartData.forEach(t => {
        const budget = parseFloat(t.budget) || 0;
        const isAdminContract = (t.serviceType === 'Metro Administrativo');

        if (isAdminContract) {
            // No suma a carga de trabajo; sí suma a facturación bajo "Administrativo"
            if (t.status === 'facturada') {
                billingMap['Administrativo'] = (billingMap['Administrativo'] || 0) + budget;
            }
            return;
        }

        const assignments = t.analysts_assignment && t.analysts_assignment.length > 0
            ? t.analysts_assignment
            : (t.analyst ? [{ name: t.analyst, percentage: 100 }] : []);

        assignments.forEach(a => {
            if (!a.name) return;
            const pct = (parseFloat(a.percentage) || 0) / 100;
            if (!workloadMap[a.name]) workloadMap[a.name] = 0;
            workloadMap[a.name] += pct;

            if (t.status === 'facturada') {
                if (!billingMap[a.name]) billingMap[a.name] = 0;
                billingMap[a.name] += budget * pct;
            }
        });
    });

    const analysts = Object.keys(workloadMap);
    const workloadValues = analysts.map(a => workloadMap[a]);
    const billingValues = analysts.map(a => billingMap[a] || 0);

    const bgColors = [
        'rgba(37, 99, 235, 0.8)',  // clr-blue
        'rgba(147, 51, 234, 0.8)', // clr-purple
        'rgba(16, 185, 129, 0.8)', // clr-green
        'rgba(244, 63, 94, 0.8)',  // clr-pink
        'rgba(245, 158, 11, 0.8)',  // clr-orange
        'rgba(14, 165, 233, 0.8)', // Sky blue
        'rgba(100, 116, 139, 0.8)' // Slate
    ];

    // Destruir instancias previas si existen (moved inside timeouts)

    const ctxWorkload = document.getElementById('workloadChart');
    if (ctxWorkload) {
        if (window._workloadTimeout) clearTimeout(window._workloadTimeout);
        window._workloadTimeout = setTimeout(() => {
            if(workloadChartInstance) workloadChartInstance.destroy();
            workloadChartInstance = new Chart(ctxWorkload, {
                type: 'pie',
                data: {
                    labels: analysts,
                    datasets: [{
                        data: workloadValues,
                        backgroundColor: bgColors,
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = Math.round((context.parsed / total) * 100);
                                    const val = Number.isInteger(context.parsed) ? context.parsed : context.parsed.toFixed(1);
                                    return `${context.label}: ${val} gestiones (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }, 50);
    }

    const ctxBilling = document.getElementById('billingChart');
    if (ctxBilling) {
        if (window._billingTimeout) clearTimeout(window._billingTimeout);
        window._billingTimeout = setTimeout(() => {
            if(billingChartInstance) billingChartInstance.destroy();
            billingChartInstance = new Chart(ctxBilling, {
                type: 'pie',
                data: {
                    labels: analysts,
                    datasets: [{
                        data: billingValues,
                        backgroundColor: bgColors,
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = total > 0 ? Math.round((context.parsed / total) * 100) : 0;
                                    return `${context.label}: $${context.parsed.toLocaleString()} (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }, 60); // Ligeramente diferente para no pisarse con el otro
    }
}

function populateGlobalFilterDropdowns() {
    const analystSelects = ['filter-tasks-analyst', 'filter-planning-analyst'];
    const clientSelects = ['filter-tasks-client', 'filter-planning-client'];

    analystSelects.forEach(id => {
        const el = document.getElementById(id);
        if(!el) return;
        el.innerHTML = '<option value="">Todos los Analistas</option>';
        dbAnalysts.forEach(a => {
            const selected = dashboardFilters.analyst === a.name ? 'selected' : '';
            el.innerHTML += `<option value="${a.name}" ${selected}>${a.name}</option>`;
        });
    });

    clientSelects.forEach(id => {
        const el = document.getElementById(id);
        if(!el) return;
        el.innerHTML = '<option value="">Todos los Clientes</option>';
        dbClients.forEach(c => {
            const clientName = getClientDisplayName(c);
            const selected = dashboardFilters.client === clientName ? 'selected' : '';
            el.innerHTML += `<option value="${clientName}" ${selected}>${clientName}</option>`;
        });
    });
    
    // Sync date inputs
    const dateFromInputs = ['filter-tasks-from'];
    const dateToInputs = ['filter-tasks-to'];
    
    dateFromInputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = dashboardFilters.dateFrom;
    });
    dateToInputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = dashboardFilters.dateTo;
    });

    const financeAnalystFilter = document.getElementById('finance-analyst-filter');
    if(financeAnalystFilter) {
        const currentVal = financeAnalystFilter.value;
        financeAnalystFilter.innerHTML = '<option value="">Todos los analistas</option>';
        dbAnalysts.forEach(a => {
            financeAnalystFilter.innerHTML += `<option value="${a.name}">${a.name}</option>`;
        });
        financeAnalystFilter.value = currentVal;
    }
}

function openAbsenceDetailModal(analystName) {
    const modal = document.getElementById('absenceDetailModal');
    const title = document.getElementById('absenceModalTitle');
    const list = document.getElementById('absenceModalList');
    
    if(!modal || !list) return;
    
    title.textContent = `Ausencias: ${analystName}`;
    list.innerHTML = '';
    
    const currentPeriodTasks = tasks.filter(t => t.period === formatPeriod() && t.isAbsence && t.analyst === analystName);
    
    let allAbsenceDays = [];
    currentPeriodTasks.forEach(t => {
        if(t.scheduledDays) {
            t.scheduledDays.forEach(sd => {
                allAbsenceDays.push({
                    day: sd.day,
                    type: t.serviceType || 'Ausencia'
                });
            });
        }
    });
    
    allAbsenceDays.sort((a, b) => a.day - b.day);
    
    if(allAbsenceDays.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:var(--text-secondary)">No hay días registrados.</p>';
    } else {
        allAbsenceDays.forEach(item => {
            const div = document.createElement('div');
            div.className = 'absence-detail-item';
            div.innerHTML = `
                <span class="date">Día ${item.day}</span>
                <span class="type">${item.type}</span>
            `;
            list.appendChild(div);
        });
    }
    
    modal.classList.add('active');
}

// Render Planning
let isDragging = false;

function handleDragStart(e) {
    // Analistas no pueden arrastrar — planning es solo lectura para ellos
    if (currentUserProfile?.role === 'analyst') {
        e.preventDefault();
        return;
    }
    if(this.getAttribute('draggable') === 'false') {
        e.preventDefault();
        return;
    }
    draggedTaskId = this.id || this.getAttribute('data-task-id');
    this.classList.add('dragging');
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedTaskId);
        // Fallback for some browsers
        e.dataTransfer.setData('task-id', draggedTaskId);
    }
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.calendar-cell').forEach(c => c.classList.remove('drag-over'));
}

function renderPlanningSidebar() {
    const sidebarContainer = document.getElementById('planning-sidebar-items');
    if(!sidebarContainer) return;

    // Para analistas: ocultar el panel de backlog — solo pueden ver el calendario
    const unassignedBar = sidebarContainer.closest('.unassigned-sidebar');
    if (currentUserProfile?.role === 'analyst') {
        if (unassignedBar) unassignedBar.style.display = 'none';
        return;
    }
    if (unassignedBar) unassignedBar.style.display = '';

    sidebarContainer.innerHTML = '';
    
    // Filtrado estricto: Una gestión en 'Por programar' NO DEBE tener días programados.
    // Metro Administrativo se excluye siempre (va directo a facturada, no necesita programarse).
    let filteredTasks = tasks.filter(t =>
        t.status &&
        t.status.toLowerCase() === 'proyectada' &&
        (!t.scheduledDays || t.scheduledDays.length === 0) &&
        t.serviceType !== 'Metro Administrativo' &&
        isTaskInCurrentPeriod(t)
    );

    if(dashboardFilters.analyst) filteredTasks = filteredTasks.filter(t => t.analyst === dashboardFilters.analyst);
    if(dashboardFilters.client) filteredTasks = filteredTasks.filter(t => t.client === dashboardFilters.client);

    if (filteredTasks.length === 0) {
        sidebarContainer.innerHTML = '<div style="text-align:center; padding:1rem; font-size:0.8rem; color:var(--text-secondary)">No hay gestiones proyectadas</div>';
        return;
    }

    filteredTasks.forEach(t => {
        const item = document.createElement('div');
        item.className = 'planning-sidebar-item';
        item.draggable = true;
        item.id = t.id;
        item.setAttribute('data-task-id', t.id);
        item.innerHTML = `
            <div style="font-weight:700; margin-bottom:0.25rem; pointer-events:none;">${t.client}</div>
            <div style="font-size:0.7rem; color:var(--text-secondary); pointer-events:none;">${formatAnalystDisplay(t)}</div>
        `;
        
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('click', () => openTaskInfoModal(t.id));
        
        // Touch support for sidebar items
        setupTouchDraggable(item, (el) => el.id);

        sidebarContainer.appendChild(item);
    });
}



function renderCalendar() {
    const container = document.querySelector('.calendar-container');
    const calendarBody = document.getElementById('calendar-body');
    const table = document.querySelector('.calendar-table');
    if(!calendarBody) return;
    calendarBody.innerHTML = '';

    if(table) {
        table.classList.remove('view-month', 'view-week');
        table.classList.add(`view-${calendarView}`);
    }

    let analystsToRender = dbAnalysts;
    if(dashboardFilters.analyst) {
        analystsToRender = dbAnalysts.filter(a => a.name === dashboardFilters.analyst);
    }

    const year = currentYear;
    const month = currentMonth;
    
    let daysToRender = [];
    if (calendarView === 'month') {
        const daysInMonth = new Date(year, month, 0).getDate();
        for (let i = 1; i <= daysInMonth; i++) {
            const date = new Date(year, month - 1, i);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const isHoliday = checkHoliday(date);
            daysToRender.push({
                day: i,
                dateStr: `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`,
                isWeekend: isWeekend || isHoliday
            });
        }
    } else {
        // Vista Semanal: 7 días desde currentWeekStart
        for (let i = 0; i < 7; i++) {
            const date = new Date(currentWeekStart);
            date.setDate(date.getDate() + i);
            const d = date.getDate();
            const m = date.getMonth() + 1;
            const y = date.getFullYear();
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const isHoliday = checkHoliday(date);
            daysToRender.push({
                day: d,
                dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                isWeekend: isWeekend || isHoliday
            });
        }
    }

    function checkHoliday(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return COLOMBIA_HOLIDAYS_2026.has(`${y}-${m}-${d}`);
    }

    // Actualizar Header
    const headerRow = document.getElementById('calendar-header-row');
    if(headerRow) {
        headerRow.innerHTML = '<th class="sticky-col"><div style="font-size:0.65rem; color:transparent">.</div>Analista<div class="calendar-col-resizer"></div></th>';

        // Vista semana: ajustar ancho de la columna analista al nombre más largo
        if(calendarView === 'week' && analystsToRender.length > 0) {
            const longest = analystsToRender.reduce((a, b) => a.name.length > b.name.length ? a : b).name;
            // Medir en un span temporal fuera del flujo
            const ruler = document.createElement('span');
            ruler.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:0.78rem;font-weight:600;padding:0 0.5rem 0 0.35rem;';
            ruler.textContent = longest;
            document.body.appendChild(ruler);
            const colWidth = ruler.offsetWidth + 16; // +16px margen para el resizer
            document.body.removeChild(ruler);
            // Aplicar a todas las celdas sticky
            requestAnimationFrame(() => {
                document.querySelectorAll('.calendar-table.view-week .sticky-col').forEach(el => {
                    el.style.width    = colWidth + 'px';
                    el.style.minWidth = colWidth + 'px';
                });
            });
        }
        daysToRender.forEach(d => {
            const th = document.createElement('th');
            if(d.isWeekend) th.classList.add('weekend-cell'); // Using our new class
            const dayName = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][new Date(d.dateStr + 'T00:00:00').getDay()];
            th.innerHTML = `<div style="font-size:0.65rem; color:var(--text-secondary)">${dayName}</div>${d.day}`;
            headerRow.appendChild(th);
        });
    }

    analystsToRender.forEach(analyst => {
        const row = document.createElement('tr');
        
        // Sticky name cell with analyst color + resize handle
        const nameCell = document.createElement('td');
        nameCell.className = 'sticky-col analyst-name-cell';
        nameCell.style.position = 'relative'; // anchor for resizer
        const analystColor = getAnalystColor(analyst.name);
        nameCell.style.color = analystColor;
        nameCell.textContent = analyst.name;

        // Resize handle inside the name cell
        const resizer = document.createElement('div');
        resizer.className = 'calendar-row-resizer';
        nameCell.appendChild(resizer);
        row.appendChild(nameCell);
        
        daysToRender.forEach(day => {
            const cell = document.createElement('td');
            cell.className = 'calendar-cell';
            if(day.isWeekend) cell.classList.add('weekend-cell');
            cell.setAttribute('data-analyst', analyst.name);
            cell.setAttribute('data-day', day.day);
            cell.setAttribute('data-date', day.dateStr);
            
            // Find tasks for this analyst and day
            const dayTasks = tasks.filter(t => {
                // ¿El analista está asignado a esta tarea?
                let isAssigned = (t.analyst === analyst.name);
                if (!isAssigned && t.analysts_assignment?.length > 0) {
                    isAssigned = t.analysts_assignment.some(a => a.name === analyst.name);
                }
                if (!isAssigned) return false;

                // ¿La tarea tiene un día programado en esta fecha?
                const dayEntry = t.scheduledDays?.find(sd => sd.date === day.dateStr);
                if (!dayEntry) return false;

                // Días de campo → siempre visibles para todos los analistas asignados
                if (dayEntry.type === 'field') return true;

                // Días de informe → solo para el analista responsable de ese día
                const reportAssignments = getReportDayAssignments(t);
                const myReportDays = reportAssignments.get(analyst.name) || [];
                return myReportDays.includes(day.dateStr);
            });
            
            dayTasks.forEach(t => {
                const pill = document.createElement('div');
                const dayInfo = t.scheduledDays.find(sd => sd.date === day.dateStr);
                const dayIdx = t.scheduledDays.findIndex(sd => sd.date === day.dateStr);
                
                pill.className = `calendar-task-pill ${t.status} ${dayInfo.type}`;
                // Medición → color sólido con texto blanco
                // Informe   → versión clara del mismo color con texto en el color original
                if (analystColor) {
                    if (dayInfo.type === 'field') {
                        pill.style.backgroundColor = analystColor;
                        pill.style.borderColor     = analystColor;
                        pill.style.color           = '#fff';
                    } else {
                        const lightColor = getAnalystColorLight(analyst.name);
                        pill.style.backgroundColor = lightColor;
                        pill.style.border          = `1.5px solid ${analystColor}`;
                        pill.style.color           = analystColor;
                        pill.style.fontWeight      = '700';
                    }
                }
                if(t.isAbsence) pill.classList.add('absence');
                
                pill.id = `pill-${t.id}-${dayIdx}`;
                pill.setAttribute('data-task-id', t.id);
                pill.setAttribute('data-day-index', dayIdx);
                pill.draggable = (t.status !== 'facturada');
                
                let label = t.client;
                if(t.isAbsence) label = t.serviceType || 'Ausencia';
                pill.textContent = label;
                pill.title = `${label} (${dayInfo.type === 'field' ? 'Planta' : 'Informe'})`;
                
                cell.appendChild(pill);
            });
            
            row.appendChild(cell);
        });
        
        calendarBody.appendChild(row);
    });

    // Estado vacío: mostrar hint si no hay ninguna pill en todo el calendario
    const totalPills = calendarBody.querySelectorAll('.calendar-task-pill').length;
    const container2 = document.querySelector('.calendar-container');
    const existingHint = document.querySelector('.calendar-empty-hint');
    if (existingHint) existingHint.remove();
    if (totalPills === 0 && analystsToRender.length > 0 && container2) {
        const hint = document.createElement('div');
        hint.className = 'calendar-empty-hint';
        hint.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span>Sin gestiones programadas — arrastra desde <strong>Por Programar</strong></span>`;
        container2.appendChild(hint);
    }

    setupCalendarListeners();
    setupRowResizer();
    setupColResizer();
    if (calendarRowHeight) applyRowHeight(calendarRowHeight);
    if (calendarColWidth) applyColWidth(calendarColWidth);
}

// ── Global row height functions ──────────────

function applyRowHeight(h) {
    document.querySelectorAll('#calendar-body tr').forEach(r => {
        r.style.height = h + 'px';
        r.querySelectorAll('td').forEach(td => { td.style.height = h + 'px'; });
    });
}

function applyColWidth(w) {
    const selector = '.sticky-col';
    document.querySelectorAll(selector).forEach(el => {
        el.style.width = w + 'px';
        el.style.minWidth = w + 'px';
        el.style.maxWidth = w + 'px';
    });
}

function setupColResizer() {
    document.querySelectorAll('.calendar-col-resizer').forEach(handle => {
        const startResize = (clientX) => {
            const startX = clientX;
            const startWidth = calendarColWidth;
            let rafId = null;

            const onMove = (ev) => {
                const currentX = ev.clientX || (ev.touches && ev.touches[0].clientX);
                if (!currentX) return;
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    const delta = currentX - startX;
                    const newWidth = Math.max(40, startWidth + delta);
                    calendarColWidth = newWidth;
                    applyColWidth(newWidth);
                });
            };

            const onEnd = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onEnd);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);
                localStorage.setItem('cbm_col_width', calendarColWidth);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        };

        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            startResize(e.clientX);
        });
        
        handle.addEventListener('touchstart', e => {
            if (e.cancelable) e.preventDefault(); // Prevenir scroll al hacer resize
            if (e.touches.length > 0) {
                startResize(e.touches[0].clientX);
            }
        }, { passive: false });
    });
}

function setupRowResizer() {
    document.querySelectorAll('.calendar-row-resizer').forEach(handle => {
        const startResize = (clientY) => {
            const startY = clientY;
            const allRows = document.querySelectorAll('#calendar-body tr');
            const firstRow = allRows[0];
            const startHeight = firstRow ? firstRow.getBoundingClientRect().height : 85;
            let rafId = null;

            const onMove = (ev) => {
                const currentY = ev.clientY || (ev.touches && ev.touches[0].clientY);
                if (!currentY) return;
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    const delta = currentY - startY;
                    const newHeight = Math.max(40, startHeight + delta);
                    calendarRowHeight = newHeight;
                    applyRowHeight(newHeight);
                });
            };

            const onEnd = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onEnd);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);
                localStorage.setItem('cbm_row_height', calendarRowHeight);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        };

        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            startResize(e.clientY);
        });

        handle.addEventListener('touchstart', e => {
            if (e.cancelable) e.preventDefault(); // Prevenir scroll al hacer resize
            if (e.touches.length > 0) {
                startResize(e.touches[0].clientY);
            }
        }, { passive: false });
    });
}


function setupCalendarListeners() {
    document.querySelectorAll('.calendar-cell').forEach(cell => {
        cell.addEventListener('dragover', e => {
            e.preventDefault();
            cell.classList.add('drag-over');
        });
        
        cell.addEventListener('dragleave', e => {
            cell.classList.remove('drag-over');
        });
        
        cell.addEventListener('drop', async e => {
            e.preventDefault();
            cell.classList.remove('drag-over');
            const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
            if (taskId) {
                await handleCalendarDrop(cell, taskId);
            }
        });

        // Touch support for calendar cells
        cell.addEventListener('touchend', async e => {
            if (!draggedTaskId) return;
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            // If the touch ended over THIS cell
            if (target === cell || cell.contains(target)) {
                await handleCalendarDrop(cell, draggedTaskId);
            }
        });
    });

    document.querySelectorAll('.calendar-task-pill').forEach(pill => {
        // Para analistas: planning es solo lectura, no se puede arrastrar nada
        if (currentUserProfile?.role === 'analyst') {
            pill.draggable = false;
        }
        pill.addEventListener('dragstart', function(e) {
            if (currentUserProfile?.role === 'analyst') {
                e.preventDefault();
                return;
            }
            if(this.getAttribute('draggable') === 'false') {
                e.preventDefault();
                return;
            }
            draggedTaskId = this.id;
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        pill.addEventListener('dragend', function(e) {
            this.classList.remove('dragging');
        });
        pill.addEventListener('click', function(e) {
            const taskId = this.getAttribute('data-task-id');
            openTaskInfoModal(taskId);
        });

        // Touch support for pills
        setupTouchDraggable(pill, (el) => el.id);
    });
}

// ── Tooltip custom para pills del calendario ─────────────────────────────────
(function initTooltip() {
    let tip = null;
    function getOrCreateTip() {
        if (!tip) {
            tip = document.createElement('div');
            tip.className = 'cbm-tooltip';
            document.body.appendChild(tip);
        }
        return tip;
    }
    function showTip(e, task) {
        const t = getOrCreateTip();
        const statusColors = { proyectada:'#2563eb', programada:'#7c3aed', ejecutada:'#e11d48', facturada:'#16a34a' };
        const col = statusColors[task.status] || '#64748b';
        t.innerHTML = `
            <strong>${task.client}</strong>
            ${task.serviceType ? `<span style="color:#94a3b8;font-size:0.72rem;">${task.serviceType}</span>` : ''}
            <div style="margin-top:4px;font-size:0.75rem;">👤 ${task.analyst || '—'}</div>
            <div style="font-size:0.75rem;">💰 $${(task.budget||0).toLocaleString('es-CO')}</div>
            <span class="tip-status" style="background:${col}22;color:${col};">${task.status}</span>`;
        t.classList.add('visible');
        moveTip(e);
    }
    function moveTip(e) {
        if (!tip) return;
        const x = e.clientX + 14, y = e.clientY - 10;
        tip.style.left = Math.min(x, window.innerWidth - 260) + 'px';
        tip.style.top  = Math.max(y, 8) + 'px';
    }
    function hideTip() { if (tip) tip.classList.remove('visible'); }

    document.addEventListener('mouseover', e => {
        const pill = e.target.closest('.calendar-task-pill');
        if (!pill) { hideTip(); return; }
        const taskId = pill.getAttribute('data-task-id');
        const task = tasks.find(t => t.id === taskId);
        if (task) showTip(e, task);
    });
    document.addEventListener('mousemove', e => {
        if (tip && tip.classList.contains('visible')) moveTip(e);
    });
    document.addEventListener('mouseout', e => {
        if (!e.target.closest('.calendar-task-pill')) hideTip();
    });
})();

// Global touch drag helper
function setupTouchDraggable(el, idGetter) {
    if (!el) return;
    el.style.touchAction = 'pan-y'; // Permitir scroll, manejamos el arrastre con long-press
    
    let clone = null;
    let startX, startY;
    let pressTimer = null;
    let isDragging = false;

    el.addEventListener('touchstart', function(e) {
        if (e.touches.length > 1) return;
        const touch = e.touches[0];
        const id = idGetter(el);
        if (!id) return;

        startX = touch.clientX;
        startY = touch.clientY;

        // Iniciar temporizador para long-press (300ms)
        pressTimer = setTimeout(() => {
            isDragging = true;
            draggedTaskId = id;
            
            // Efecto nativo opcional
            if(navigator.vibrate) navigator.vibrate(50);

            // Crear clon/fantasma
            clone = el.cloneNode(true);
            clone.style.position = 'fixed';
            clone.style.width = el.offsetWidth + 'px';
            clone.style.height = el.offsetHeight + 'px';
            clone.style.left = (touch.clientX - el.offsetWidth / 2) + 'px';
            clone.style.top = (touch.clientY - el.offsetHeight / 2) + 'px';
            clone.style.opacity = '0.9';
            clone.style.zIndex = '9999';
            clone.style.pointerEvents = 'none';
            clone.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
            clone.style.transform = 'scale(1.05)';
            clone.classList.add('dragging-ghost');
            document.body.appendChild(clone);
            
            el.classList.add('dragging');
        }, 300);
    }, { passive: true });

    el.addEventListener('touchmove', function(e) {
        // Si el usuario mueve el dedo antes de que termine el long-press, cancelar
        if (!isDragging) {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            return;
        }

        if (!clone) return;
        if (e.cancelable) e.preventDefault(); // Prevenir scroll mientras arrastra

        const touch = e.touches[0];
        clone.style.left = (touch.clientX - clone.offsetWidth / 2) + 'px';
        clone.style.top = (touch.clientY - clone.offsetHeight / 2) + 'px';
        
        // Feedback visual
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        document.querySelectorAll('.drag-over').forEach(elem => elem.classList.remove('drag-over'));
        const dropTarget = findDropTarget(target);
        if (dropTarget) dropTarget.classList.add('drag-over');
    }, { passive: false });

    el.addEventListener('touchend', async function(e) {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
        if (!isDragging) return; // Si fue solo un tap, no hacer nada

        isDragging = false;
        el.classList.remove('dragging');
        
        if (clone) {
            document.body.removeChild(clone);
            clone = null;
        }
        
        document.querySelectorAll('.drag-over').forEach(elem => elem.classList.remove('drag-over'));

        const touch = e.changedTouches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const dropTarget = findDropTarget(target);
        
        if (dropTarget) {
            await processDrop(dropTarget, draggedTaskId);
        }
        
        draggedTaskId = null;
    });

    el.addEventListener('touchcancel', function(e) {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
        if (isDragging) {
            isDragging = false;
            el.classList.remove('dragging');
            if (clone) {
                document.body.removeChild(clone);
                clone = null;
            }
            document.querySelectorAll('.drag-over').forEach(elem => elem.classList.remove('drag-over'));
            draggedTaskId = null;
        }
    });

    function findDropTarget(el) {
        let curr = el;
        while (curr) {
            if (curr.classList.contains('calendar-cell') || 
                curr.classList.contains('kanban-column') || 
                curr.id === 'planning-sidebar-items') {
                return curr;
            }
            curr = curr.parentElement;
        }
        return null;
    }
}

async function processDrop(target, taskId) {
    if (target.classList.contains('calendar-cell')) {
        await handleCalendarDrop(target, taskId);
    } else if (target.classList.contains('kanban-column')) {
        await handleKanbanDrop(target, taskId);
    } else if (target.id === 'planning-sidebar-items') {
        await handleSidebarDrop(taskId);
    }
}

async function handleCalendarDrop(cell, dragInfo) {
    if (currentUserProfile?.role === 'analyst') return;
    let isPillMove = dragInfo && dragInfo.startsWith('pill-');
    let taskId = dragInfo;
    if (isPillMove) {
        let dragEl = document.getElementById(dragInfo);
        if (dragEl) {
            taskId = dragEl.getAttribute('data-task-id');
        } else {
            // Fallback: extraer de pill-ID-IDX
            const parts = dragInfo.split('-');
            taskId = parts.length >= 2 ? parts[1] : dragInfo;
        }
    }
    
    // Si sigue siendo nulo, intentar con el global como último recurso
    if (!taskId) taskId = draggedTaskId;
    if (!taskId) return;

    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
        console.warn("No se encontró la tarea con ID:", taskId);
        return;
    }

    const targetAnalyst = cell.getAttribute('data-analyst');
    const targetDateStr = cell.getAttribute('data-date'); 
    const targetDay = parseInt(cell.getAttribute('data-day'));
    const task = tasks[taskIndex];

    let isAssignedToTarget = (task.analyst === targetAnalyst);
    if (!isAssignedToTarget && task.analysts_assignment && task.analysts_assignment.length > 0) {
        isAssignedToTarget = task.analysts_assignment.some(a => a.name === targetAnalyst);
    }

    // El usuario pidió que el arrastre desde "Por Programar" funcione siempre.
    // Solo bloqueamos si es un movimiento de Pill (reasignación en calendario) y no es su analista.
    if (!isAssignedToTarget && isPillMove) {
        alert(`Esta gestión está asignada a: ${task.analyst || 'nadie'}. Para moverla, use su propia fila o reasígnela en los detalles.`);
        return;
    }

    if(task.equipmentId) {
        let futureScheduledDays = [...task.scheduledDays];
        if(isPillMove) {
            let dayIdx = 0;
            let dragEl = document.getElementById(dragInfo);
            if (dragEl) {
                dayIdx = parseInt(dragEl.getAttribute('data-day-index'), 10);
            } else {
                dayIdx = parseInt(dragInfo.split('-').pop(), 10);
            }
            futureScheduledDays[dayIdx] = { ...futureScheduledDays[dayIdx], day: targetDay, date: targetDateStr };
        } else if(task.scheduledDays.length === 0) {
            futureScheduledDays = [{ day: targetDay, date: targetDateStr, type: 'field' }];
        }
        
        const available = await validateEquipmentAvailability(task.equipmentId, task.id, futureScheduledDays);
        if(!available) {
            alert("Debe escoger otro equipo para esta fecha, el equipo seleccionado ya se encuentra ocupado.");
            return;
        }
    }

    if (isPillMove) {
        let dayIdx = 0;
        let dragEl = document.getElementById(dragInfo);
        if (dragEl) {
            dayIdx = parseInt(dragEl.getAttribute('data-day-index'), 10);
        } else {
            dayIdx = parseInt(dragInfo.split('-').pop(), 10);
        }
        task.scheduledDays[dayIdx].day = targetDay;
        task.scheduledDays[dayIdx].date = targetDateStr;
        task.analyst = targetAnalyst;
        // Preservar la asignación múltiple si existe
        if (!task.analysts_assignment || task.analysts_assignment.length === 0) {
            task.analysts_assignment = [{ name: targetAnalyst, isTitular: true, makesReport: true, percentage: 100 }];
        } else {
            // Asegurar que el targetAnalyst esté en la lista y sea titular (ya debería estarlo por la validación de arriba en isPillMove)
            task.analysts_assignment.forEach(a => {
                a.isTitular = (a.name === targetAnalyst);
            });
        }
        logActivity(`🚚 Se movió un día de la gestión <strong>${task.client}</strong> al día <strong>${targetDay}</strong>.`, 'assign');
    } else {
        task.analyst = targetAnalyst;
        // Preservar la asignación múltiple si existe
        if (!task.analysts_assignment || task.analysts_assignment.length === 0) {
            task.analysts_assignment = [{ name: targetAnalyst, isTitular: true, makesReport: true, percentage: 100 }];
        } else {
            // Si ya hay analistas, asegurar que el targetAnalyst sea el titular pero NO borrar los demás
            let found = false;
            task.analysts_assignment.forEach(a => {
                if (a.name === targetAnalyst) {
                    a.isTitular = true;
                    found = true;
                } else {
                    a.isTitular = false;
                }
            });
            if (!found) {
                // Si no estaba en la lista, lo agregamos como titular con 0% para no descuadrar porcentajes existentes
                task.analysts_assignment.push({ name: targetAnalyst, isTitular: true, makesReport: true, percentage: 0 });
            }
        }
        if (!task.scheduledDays || task.scheduledDays.length === 0) {
            const [yStr, mStr, dStr] = targetDateStr.split('-');
            let loopDate = new Date(parseInt(yStr), parseInt(mStr) - 1, parseInt(dStr));
            let fieldAsigned = 0;
            const totalFieldNeeded = parseInt(task.daysField) || 1;
            while(fieldAsigned < totalFieldNeeded) {
                const y = loopDate.getFullYear();
                const m = loopDate.getMonth() + 1;
                const d = loopDate.getDate();
                if(!isHolidayOrWeekend(y, m, d)) {
                    task.scheduledDays.push({ day: d, date: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, type: 'field' });
                    fieldAsigned++;
                }
                loopDate.setDate(loopDate.getDate() + 1);
            }
            let reportAsigned = 0;
            const totalReportNeeded = parseInt(task.daysReport) || 0;
            while(reportAsigned < totalReportNeeded) {
                const y = loopDate.getFullYear();
                const m = loopDate.getMonth() + 1;
                const d = loopDate.getDate();
                if(!isHolidayOrWeekend(y, m, d)) {
                    task.scheduledDays.push({ day: d, date: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, type: 'report' });
                    reportAsigned++;
                }
                loopDate.setDate(loopDate.getDate() + 1);
            }
            const totalScheduled = fieldAsigned + reportAsigned;
            logActivity(`📅 Se programaron automáticamente <strong>${totalScheduled} días hábiles</strong> para <strong>${task.client}</strong>.`, 'assign');
        } else {
            logActivity(`📌 Se reasignó la gestión <strong>${task.client}</strong> al <strong>Analista ${targetAnalyst}</strong>.`, 'assign');
        }
    }

    // Unconditional status update - if it's on the calendar, it's programmed
    task.status = 'programada';

    postDropSync();

    // Marcar pills de esta tarea con animación mientras guarda
    document.querySelectorAll(`[data-task-id="${task.id}"]`).forEach(el => {
        if (el.classList.contains('calendar-task-pill')) el.classList.add('pill-saving');
    });

    // Final Database Persistence with ID sync
    try {
        await saveTaskToSupabase(task);
        postDropSync();
        showToast('Gestión programada correctamente.', 'success');
    } catch(err) {
        console.error("Critical error saving task after drop:", err);
        showToast('Error al guardar en la nube. Los cambios están en local.', 'error');
    } finally {
        document.querySelectorAll('.pill-saving').forEach(el => el.classList.remove('pill-saving'));
    }
}

async function handleKanbanDrop(column, taskId) {
    let newStatus = column.getAttribute('data-status');
    if(newStatus === 'proyectado' || newStatus === 'proyectada') newStatus = 'proyectada';
    
    if(taskId && taskId.startsWith('pill-')) {
        let dragEl = document.getElementById(taskId);
        if(dragEl && dragEl.classList.contains('calendar-task-pill')) {
            taskId = dragEl.getAttribute('data-task-id');
        } else {
            taskId = taskId.split('-')[1]; 
        }
    }
    
    const task = tasks.find(t => t.id === taskId);
    if (task && task.status !== newStatus) {
        await updateTaskStatus(taskId, newStatus);
        if(typeof postDropSync === 'function') postDropSync();
    }
}

async function handleSidebarDrop(e) {
    if (currentUserProfile?.role === 'analyst') return;
    if (e && e.preventDefault) e.preventDefault();
    
    // We try to get ID from multiple sources for maximum compatibility
    const rawId = (e && e.dataTransfer) ? e.dataTransfer.getData('text/plain') : draggedTaskId;
    console.log("Sidebar drop rawId:", rawId);
    
    if (!rawId) return;
    
    let taskId = rawId;
    if (rawId.startsWith('pill-')) {
        const parts = rawId.split('-');
        if (parts.length >= 2) taskId = parts[1];
    }
    
    const task = tasks.find(t => t.id === taskId || t.supabaseId === taskId);
    if (task && task.status !== 'proyectada') {
        console.log("Found task for sidebar drop:", task.client);
        logActivity(`🔄 La gestión <strong>${task.client}</strong> se ha devuelto al estado <strong>PROYECTADA</strong>.`, 'status');
        
        task.status = 'proyectada';
        task.scheduledDays = []; // Limpiar programación al volver al backlog
        
        postDropSync();
        
        try {
            await saveTaskToSupabase(task);
            console.log("Task saved to Supabase as proyectada");
        } catch (err) {
            console.error("Error saving task to sidebar:", err);
        }
    } else if (!task) {
        console.warn("Task not found for sidebar drop:", taskId);
    }
}

function isHolidayOrWeekend(year, month, day) {
    const d = new Date(year, month - 1, day);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return true;
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return COLOMBIA_HOLIDAYS_2026.has(dateStr);
}

/**
 * Calcula qué días de informe le corresponden a cada analista.
 * Regla: titular primero, reparto por igual, días extra al titular.
 * Retorna: Map { analystName → [dateStr, ...] }
 */
function getReportDayAssignments(task) {
    const reportDays = (task.scheduledDays || [])
        .filter(d => d.type === 'report')
        .sort((a, b) => a.date.localeCompare(b.date));

    // Analistas que hacen informe, titular al frente
    const reportAnalysts = (task.analysts_assignment || [])
        .filter(a => a.makesReport)
        .sort((a, b) => (b.isTitular ? 1 : 0) - (a.isTitular ? 1 : 0));

    const map = new Map();

    if (reportAnalysts.length === 0) {
        // Sin asignación múltiple: todos los días al analista principal
        if (task.analyst) map.set(task.analyst, reportDays.map(d => d.date));
        return map;
    }

    reportAnalysts.forEach(a => map.set(a.name, []));
    if (reportDays.length === 0) return map;

    const n = reportDays.length;
    const k = reportAnalysts.length;
    const base  = Math.floor(n / k);
    const extra = n % k;

    let idx = 0;
    reportAnalysts.forEach((analyst, i) => {
        const quota = base + (i === 0 ? extra : 0); // titular (i=0) absorbe el resto
        for (let j = 0; j < quota && idx < reportDays.length; j++, idx++) {
            map.get(analyst.name).push(reportDays[idx].date);
        }
    });

    return map;
}

/**
 * Redistribuye porcentajes equitativamente entre los demás analistas
 * cuando el usuario cambia el % de uno.
 */
function autoDistributePercentages(changedInput) {
    const container = document.getElementById('taskAnalystsContainer');
    if (!container) return;
    const allInputs = Array.from(container.querySelectorAll('.analyst-pct'));
    const others = allInputs.filter(inp => inp !== changedInput);
    if (others.length === 0) return;

    const changed  = Math.min(100, Math.max(0, parseFloat(changedInput.value) || 0));
    changedInput.value = changed;
    const remaining = Math.max(0, 100 - changed);
    const base  = Math.floor(remaining / others.length);
    const extra = remaining - base * others.length;

    others.forEach((inp, i) => {
        inp.value = base + (i === 0 ? extra : 0); // el primero absorbe el sobrante del redondeo
    });
}

function addAnalystToTask(existingData = null) {
    const container = document.getElementById('taskAnalystsContainer');

    // Si no hay datos y hay preferencias guardadas en el container,
    // auto-sugerir el siguiente analista según el orden de preferencias:
    // fila 0 = Primary (ya añadido), fila 1 = Secondary, fila 2 = Backup, etc.
    if (!existingData) {
        const storedPrefs = JSON.parse(container.dataset.clientPreferences || '[]');
        if (storedPrefs.length > 0) {
            const currentRowCount = container.querySelectorAll('.analyst-row').length;
            const nextPref = storedPrefs[currentRowCount];
            if (nextPref) {
                existingData = {
                    name: nextPref.name,
                    isTitular: false,
                    makesReport: false,
                    percentage: 0
                };
            }
        }
    }

    const row = document.createElement('div');
    row.className = 'analyst-row';

    const analystName = existingData ? existingData.name : '';
    const isTitularChecked = existingData ? (existingData.isTitular ? 'checked' : '') : (container.children.length === 0 ? 'checked' : '');
    const isReportChecked = existingData ? (existingData.makesReport ? 'checked' : '') : (container.children.length === 0 ? 'checked' : '');
    const pctValue = existingData ? existingData.percentage : (container.children.length === 0 ? 100 : 0);

    row.innerHTML = `
        <select class="analyst-select" style="flex: 2; padding: 0.3rem 0.25rem; font-size: 0.72rem; border: 1px solid #cbd5e1; border-radius: 4px;" required>
            <option value="">Analista...</option>
            ${(dbAnalysts || []).map(a => `<option value="${a.name}" ${analystName === a.name ? 'selected' : ''}>${a.name}</option>`).join('')}
        </select>
        <label style="font-size: 0.7rem; display: flex; align-items: center; gap: 2px;">
            <input type="radio" name="titular" class="analyst-titular" ${isTitularChecked}> Titular
        </label>
        <label style="font-size: 0.7rem; display: flex; align-items: center; gap: 2px;">
            <input type="checkbox" class="analyst-report" ${isReportChecked}> Informe
        </label>
        <div style="display: flex; align-items: center; gap: 2px;">
            <input type="number" class="analyst-pct" value="${pctValue}" min="0" max="100" style="width: 50px; padding: 0.4rem; font-size: 0.8rem; border: 1px solid #cbd5e1; border-radius: 4px;" required>
            <span style="font-size: 0.75rem;">%</span>
        </div>
        <button type="button" onclick="this.parentElement.remove()" style="background: none; border: none; color: #ef4444; font-size: 1rem; cursor: pointer; padding: 0 4px;" title="Eliminar">&times;</button>
    `;

    container.appendChild(row);
}

async function onTaskClientChange() {
    const clientId = document.getElementById('taskClient').value;
    const container = document.getElementById('taskAnalystsContainer');
    clientAnalystPreferences = []; // reset preferencias al cambiar cliente

    // Metro Administrativo no usa analistas — mantener el banner
    const serviceType = document.getElementById('taskServiceType')?.value;
    if(serviceType === 'Metro Administrativo') return;

    if(!clientId) {
        container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); text-align: center;">Seleccione primero un cliente para añadir analistas.</div>';
        return;
    }

    // Siempre limpiar al cambiar de cliente (también el dataset)
    container.dataset.clientPreferences = '[]';
    container.innerHTML = '';

    if(!supabaseClient) {
        addAnalystToTask();
        return;
    }

    try {
        // Misma consulta que loadPreferences() que funciona correctamente
        const { data: preferences, error } = await supabaseClient
            .from('client_analyst_preferences')
            .select('*, analysts(name)')
            .eq('client_id', clientId);

        if (error) console.error("Error cargando prioridades:", error);

        const priorityOrder = { 'Primary': 1, 'Secondary': 2, 'Backup': 3 };

        // Ordenar por prioridad y filtrar los que tienen analista válido
        const sortedPrefs = (preferences || [])
            .filter(p => p.analysts && p.analysts.name)
            .sort((a, b) => (priorityOrder[a.priority_level] || 9) - (priorityOrder[b.priority_level] || 9));

        // Guardar TODAS las preferencias ordenadas: [0]=Primary, [1]=Secondary, [2]=Backup
        clientAnalystPreferences = sortedPrefs.map(p => ({
            name: p.analysts.name,
            priority: p.priority_level
        }));

        // Guardar también en el dataset del container para acceso robusto desde onclick
        container.dataset.clientPreferences = JSON.stringify(clientAnalystPreferences);

        // Pre-llenar SOLO el analista titular (Primary) por defecto
        if(clientAnalystPreferences.length > 0) {
            addAnalystToTask({
                name: clientAnalystPreferences[0].name,
                isTitular: true,
                makesReport: true,
                percentage: 100
            });
        } else {
            // Sin preferencias configuradas: fila vacía
            addAnalystToTask();
        }
    } catch(err) {
        console.error("Error in onTaskClientChange:", err);
        addAnalystToTask();
    }
}

function onTaskServiceTypeChange() {
    const serviceType = document.getElementById('taskServiceType').value;
    const isAbsence       = (serviceType === 'Vacaciones' || serviceType === 'Incapacidad' || serviceType === 'Compensatorio');
    const isAdminContract = (serviceType === 'Metro Administrativo');

    // Campos que se ocultan solo en ausencias
    const fieldsToToggle = ['group-client', 'group-budget', 'group-equipment', 'group-report'];
    fieldsToToggle.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = isAbsence ? 'none' : 'block';
    });

    const container = document.getElementById('taskAnalystsContainer');
    const analystLabel = container?.previousElementSibling; // el <label> de Analistas

    if(isAbsence) {
        if(container.innerHTML.trim() === '' || container.innerHTML.includes('Seleccione primero')) {
            container.innerHTML = '';
            addAnalystToTask();
        }
        document.getElementById('taskClient').required = false;
        document.getElementById('taskBudget').required  = false;
        document.getElementById('taskDaysReport').required = false;

    } else if(isAdminContract) {
        // Metro Administrativo: solo cliente y presupuesto — sin analista, días ni equipo
        document.getElementById('taskClient').required    = true;
        document.getElementById('taskBudget').required    = true;
        document.getElementById('taskDaysField').required = false;
        document.getElementById('taskDaysReport').required = false;

        // Ocultar analistas, días y equipo
        ['group-analysts', 'group-days', 'group-equipment'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = 'none';
        });

        // Mostrar banner en el contenedor de analistas (por si acaso)
        clientAnalystPreferences = [];
        container.dataset.clientPreferences = '[]';
        container.innerHTML = '';

    } else {
        // Servicio normal: restaurar todos los campos
        document.getElementById('taskClient').required    = true;
        document.getElementById('taskBudget').required    = true;
        document.getElementById('taskDaysField').required = true;
        document.getElementById('taskDaysReport').required = true;

        ['group-analysts', 'group-days', 'group-equipment'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = '';
        });

        // Solo recargar preferencias si el container está vacío (gestión nueva).
        // En edición ya están cargados los analistas correctos — no sobreescribir.
        const hasAnalystRows = container.querySelectorAll('.analyst-row').length > 0;
        if (!hasAnalystRows) onTaskClientChange();
    }
}

function openTaskInfoModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;
    
    document.getElementById('infoClient').textContent = task.client;
    document.getElementById('infoAnalyst').textContent = task.analyst ? `Analista ${task.analyst}` : 'Sin Asignar';
    
    const equipEl = document.getElementById('infoEquipment');
    if(task.equipment) {
        equipEl.textContent = task.equipment;
    } else {
        equipEl.textContent = 'Sin equipo asignado';
    }
    
    const scheduledDaysText = task.scheduledDays && task.scheduledDays.length > 0 
        ? task.scheduledDays.map(d => `${d.day}(${d.type === 'field' ? 'P' : 'I'})`).join(', ')
        : 'Aún sin programar';
    document.getElementById('infoDate').textContent = scheduledDaysText;
    document.getElementById('infoBudget').textContent = task.budget.toLocaleString('es-CO');
    
    document.getElementById('infoDaysPlanned').textContent = `${task.daysField} Planta / ${task.daysReport} Informe`;
    document.getElementById('infoDaysScheduledCount').textContent = `${task.scheduledDays.length} de ${task.daysField + task.daysReport} días asignados`;
    
    const statusEl = document.getElementById('infoStatus');
    statusEl.textContent = task.status;
    
    const colors = {
        'proyectada': 'var(--clr-blue)',
        'programada': 'var(--clr-purple)',
        'ejecutada': 'var(--clr-pink)',
        'facturada': 'var(--clr-green)'
    };
    statusEl.style.color = colors[task.status] || 'var(--text-primary)';
    
    const csatContainer = document.getElementById('infoCsat');
    const alertvoxContainer = document.getElementById('infoAlertvox');
    
    if(task.csatScore) {
        csatContainer.style.display = 'block';
        document.getElementById('infoCsatScore').textContent = task.csatScore;
    } else {
        csatContainer.style.display = 'none';
    }
    
    if(task.alertvoxChecked) {
        alertvoxContainer.style.display = 'block';
    } else {
        alertvoxContainer.style.display = 'none';
    }
    
    document.getElementById('taskInfoModal').classList.add('active');

    const editBtn = document.getElementById('btnEditTask');
    const deleteBtn = document.getElementById('btnDeleteTask');
    const isAnalyst = currentUserProfile?.role === 'analyst';
    if(editBtn)   editBtn.style.display   = isAnalyst ? 'none' : '';
    if(deleteBtn) deleteBtn.style.display = isAnalyst ? 'none' : '';

    if(editBtn) {
        if(task.status === 'facturada') {
            editBtn.style.opacity = '0.5';
            editBtn.style.cursor = 'not-allowed';
            editBtn.onclick = () => alert("Las gestiones facturadas están bloqueadas y no pueden ser editadas.");
        } else {
            editBtn.style.opacity = '1';
            editBtn.style.cursor = 'pointer';
            editBtn.onclick = () => openEditTaskModal(taskId);
        }
    }
    if(deleteBtn) {
        if(task.status === 'facturada') {
            deleteBtn.style.opacity = '0.5';
            deleteBtn.style.cursor = 'not-allowed';
            deleteBtn.onclick = () => alert("Las gestiones facturadas están bloqueadas y no pueden ser eliminadas.");
        } else {
            deleteBtn.style.opacity = '1';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.onclick = () => deleteTask(taskId);
        }
    }
}

// Finance View Logic
let financeFilters = {
    type: 'single', 
    selectedMonths: [] 
};

function toggleFinancePeriodInputs() {
    const type = document.getElementById('finance-period-type').value;
    financeFilters.type = type;
    
    const selector = document.getElementById('finance-weeks-selector');
    if(type === 'multiple') {
        selector.style.display = 'block';
        populateFinanceMonths();
    } else {
        selector.style.display = 'none';
    }
}

function populateFinanceMonths() {
    const container = document.getElementById('finance-months-list');
    if(!container) return;
    container.innerHTML = '';
    
    const periods = [...new Set(tasks.map(t => t.mesFacturacion || t.period))].sort();
    
    periods.forEach(p => {
        const [y, m] = p.split('-');
        const label = `${monthNames[parseInt(m)-1]} ${y}`;
        const isChecked = financeFilters.selectedMonths.includes(p);
        
        container.innerHTML += `
            <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" value="${p}" ${isChecked ? 'checked' : ''} onchange="updateFinanceSelectedMonths()">
                ${label}
            </label>
        `;
    });
}

function renderFinanceView() {
    const container = document.getElementById('finance-summary-container');
    if(!container) return;

    const filterEl = document.getElementById('finance-analyst-filter');
    const analystFilter = filterEl ? filterEl.value : '';
    
    const currentPeriod = formatPeriod();
    const currentYearStr = String(currentYear);
    
    let filteredPeriods = [currentPeriod];
    if(financeFilters.type === 'multiple') {
        filteredPeriods = financeFilters.selectedMonths;
    } else if (financeFilters.type === 'year') {
        filteredPeriods = tasks.map(t => t.mesFacturacion || t.period).filter(p => p.startsWith(currentYearStr));
    }

    const financeTasks = tasks.filter(t => {
        if(t.isAbsence) return false;
        const targetPeriod = t.mesFacturacion || t.period;
        if(!filteredPeriods.includes(targetPeriod)) return false;
        
        if(analystFilter) {
            if(t.analysts_assignment && t.analysts_assignment.length > 0) {
                return t.analysts_assignment.some(a => a.name === analystFilter);
            } else {
                return t.analyst === analystFilter;
            }
        }
        return true;
    });
    
    const stats = {
        proyectada: 0,
        programada: 0,
        ejecutada: 0,
        facturada: 0
    };

    const breakdowns = {
        proyectada: {},
        programada: {},
        ejecutada: {},
        facturada: {}
    };
    
    financeTasks.forEach(t => {
        if(stats[t.status] !== undefined) {
            let taskValue = t.budget || 0;
            
            if(analystFilter) {
                if(t.analysts_assignment && t.analysts_assignment.length > 0) {
                    const matchA = t.analysts_assignment.find(a => a.name === analystFilter);
                    if(matchA) {
                        taskValue = taskValue * ((matchA.percentage || 0) / 100);
                    } else {
                        taskValue = 0;
                    }
                } else if(t.analyst !== analystFilter) {
                    taskValue = 0;
                }
            }
            
            if(taskValue > 0) {
                stats[t.status] += taskValue;
                // Clave por ID: cada gestión es siempre una línea independiente
                breakdowns[t.status][t.id] = {
                    client: t.client,
                    amount: taskValue,
                    period: t.period || ''
                };
            }
        }
    });
    
    const cards = [
        { label: 'Proyectada', key: 'proyectada', val: stats.proyectada, clr: '#2563eb', bg: '#eff6ff', icon: '📋' },
        { label: 'Programada', key: 'programada', val: stats.programada, clr: '#7c3aed', bg: '#f5f3ff', icon: '📅' },
        { label: 'Ejecutada',  key: 'ejecutada',  val: stats.ejecutada,  clr: '#ea580c', bg: '#fff7ed', icon: '✅' },
        { label: 'Facturada',  key: 'facturada',  val: stats.facturada,  clr: '#16a34a', bg: '#f0fdf4', icon: '💰' }
    ];
    
    const periodLabel = financeFilters.type === 'single' ? monthNames[currentMonth-1] :
                       financeFilters.type === 'year' ? `Todo ${currentYear}` :
                       `${filteredPeriods.length} meses seleccionados`;

    const grandTotal = stats.proyectada + stats.programada + stats.ejecutada + stats.facturada;

    container.innerHTML = cards.map(c => {
        const bd = breakdowns[c.key];
        const rows = Object.keys(bd).length > 0
            ? Object.values(bd).map(({ client, amount, period }) => {
                const monthAbbr = period
                    ? monthNames[parseInt(period.split('-')[1]) - 1]?.substring(0, 3) || ''
                    : '';
                return `
                <div style="display:flex; justify-content:space-between; align-items:center;
                            padding:0.35rem 0; border-bottom:1px solid ${c.clr}18;
                            font-size:0.78rem; gap:0.5rem;">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; color:#374151;">
                        ${client}
                        ${monthAbbr ? `<span style="font-size:0.62rem; color:#94a3b8; font-weight:400;">(${monthAbbr})</span>` : ''}
                    </span>
                    <span style="font-weight:700; color:${c.clr}; white-space:nowrap;">$${amount.toLocaleString('es-CO')}</span>
                </div>`;
            }).join('')
            : `<div style="color:#94a3b8; text-align:center; font-style:italic; padding:0.75rem 0; font-size:0.78rem;">Sin gestiones</div>`;

        return `
        <div style="
            background:${c.bg};
            border-radius:12px;
            border: 1px solid ${c.clr}30;
            border-top: 5px solid ${c.clr};
            display:flex; flex-direction:column;
            box-shadow: 0 2px 8px ${c.clr}15;
            overflow:hidden;
        ">
            <!-- Pill header -->
            <div style="padding:1rem 1rem 0.75rem;">
                <span style="
                    display:inline-flex; align-items:center; gap:0.35rem;
                    background:${c.clr}; color:#fff;
                    font-size:0.7rem; font-weight:700;
                    padding:0.3rem 0.8rem; border-radius:20px;
                    text-transform:uppercase; letter-spacing:0.04em;
                ">${c.icon} ${c.label}</span>
            </div>

            <!-- Filas de clientes -->
            <div style="flex:1; max-height:180px; overflow-y:auto; padding:0 1rem;">
                ${rows}
            </div>

            <!-- Total destacado -->
            <div style="
                margin:0.75rem 1rem 1rem;
                padding:0.6rem 0.75rem;
                background:${c.clr}12;
                border-radius:8px;
                border-left:3px solid ${c.clr};
            ">
                <div style="font-size:0.62rem; font-weight:700; color:${c.clr}; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.2rem;">
                    Total acumulado · ${periodLabel}
                </div>
                <div style="font-size:1.6rem; font-weight:900; color:${c.clr}; line-height:1.1;">
                    $${c.val.toLocaleString('es-CO')}
                </div>
            </div>
        </div>`;
    }).join('') + `
        <div style="grid-column: 1 / -1; margin-top: 0.5rem;">
            <div class="stats-card" style="
                border-top: 4px solid #0f172a;
                background: #0f172a;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 1rem 1.5rem;
                flex-direction: row;
                gap: 1rem;
            ">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <span style="font-size:1.3rem;">📊</span>
                    <div>
                        <div style="font-size:0.7rem; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em;">
                            Total Gestiones · ${periodLabel}
                        </div>
                        <div style="font-size:0.78rem; color:#64748b; margin-top:2px;">
                            ${financeTasks.length} gestión${financeTasks.length !== 1 ? 'es' : ''} en el período
                        </div>
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.65rem; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px;">
                        Total Facturas
                    </div>
                    <div style="font-size:2rem; font-weight:900; color:#ffffff; line-height:1;">
                        $${grandTotal.toLocaleString('es-CO')}
                    </div>
                </div>
            </div>
        </div>`;
}

// Finance Multiple Selection Handler
function updateFinanceSelectedMonths() {
    const checkboxes = document.querySelectorAll('#finance-months-list input[type="checkbox"]');
    financeFilters.selectedMonths = Array.from(checkboxes)
        .filter(i => i.checked)
        .map(i => i.value);
    renderFinanceView();
}

// Validation Logic
async function validateEquipmentAvailability(equipmentId, taskId, scheduledDays) {
    if(!equipmentId || !scheduledDays || scheduledDays.length === 0) return true;
    
    // Check locally first
    const conflictLocal = tasks.find(t => 
        t.id !== taskId && 
        t.equipmentId === equipmentId && 
        t.scheduledDays.some(sd => scheduledDays.some(nsd => nsd.day === sd.day))
    );
    if(conflictLocal) return false;

    if(!supabaseClient) return true;
    
    try {
        // Only query if taskId is a valid UUID to avoid Cast Errors
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId);
        
        let query = supabaseClient
            .from('tasks')
            .select('id, client, scheduled_days')
            .eq('equipment_id', equipmentId)
            .eq('period', formatPeriod());
            
        if (isUuid) {
            query = query.neq('id', taskId);
        }

        const { data, error } = await query;
            
        if(error) {
            console.error("Error validating availability:", error);
            return true; 
        }
        
        const conflictDb = data.find(t => 
            t.scheduled_days && t.scheduled_days.some(sd => scheduledDays.some(nsd => nsd.day === sd.day))
        );
        
        return !conflictDb;
    } catch(e) {
        console.error("Exception in validateEquipmentAvailability:", e);
        return true;
    }
}

// Supabase Sync Logic
async function saveTaskToSupabase(task) {
    if(!supabaseClient) return;
    try {
        const isTemporaryId = task.id && (typeof task.id === 'string' && (task.id.startsWith('t') || task.id.startsWith('id_')));
        
        const taskData = {
            client: task.client,
            analyst: task.analyst,
            budget: parseFloat(task.budget) || 0,
            days_field: parseInt(task.daysField) || 1,
            days_report: parseInt(task.daysReport) || 0,
            scheduled_days: task.scheduledDays || [],
            status: task.status,
            period: task.period,
            equipment_id: task.equipmentId || null,
            service_type: task.serviceType,
            is_absence: task.isAbsence || false,
            csat_score: task.csatScore || null,
            csat_observations: task.csatObservations || null,
            alertvox_checked: task.alertvoxChecked || false,
            client_no_response: task.clientNoResponse || false,
            evidence_notes: task.evidenceNotes || null,
            evidence_files: task.evidenceFiles || [],
            mes_facturacion: task.mesFacturacion || task.period,
            analysts_assignment: task.analysts_assignment || [] 
        };

        if (!isTemporaryId) {
            taskData.id = task.id;
        }
        
        let result;
        if(task.supabaseId || !isTemporaryId) {
            result = await supabaseClient.from('tasks').upsert({ 
                ...taskData, 
                id: task.supabaseId || task.id 
            });
        } else {
            result = await supabaseClient.from('tasks').insert(taskData).select();
            if(result.data && result.data.length > 0) {
                const newRealId = result.data[0].id;
                // Update BOTH to ensure total synchronization
                task.id = newRealId; 
                task.supabaseId = newRealId;
                console.log("Task inserted and local ID updated to:", newRealId);
            }
        }
        
        if(result.error) console.error("Error saving to Supabase:", result.error);
    } catch(err) {
        console.error("Sync error:", err);
    }
}

async function loadTasksFromSupabase() {
    if(!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false });
        if(error) {
            console.error("Error loading tasks:", error);
            showToast('No se pudieron cargar las gestiones desde la nube. Trabajando con datos locales.', 'warning');
            return;
        }
        if(data) {
            const remoteTasks = data.map(t => ({
                id: t.id,
                supabaseId: t.id,
                client: t.client || '',
                analyst: t.analyst || '',
                analysts_assignment: t.analysts_assignment || [],
                equipmentId: t.equipment_id || '',
                budget: parseFloat(t.budget) || 0,
                daysField: parseInt(t.days_field) || 1,
                daysReport: parseInt(t.days_report) || 0,
                serviceType: t.service_type || '',
                isAbsence: t.is_absence || false,
                scheduledDays: t.scheduled_days || [],
                status: t.status || 'proyectada',
                period: t.period || formatPeriod(),
                mesFacturacion: t.mes_facturacion || t.period || formatPeriod(),
                csatScore: t.csat_score || null,
                csatObservations: t.csat_observations || '',
                alertvoxChecked: t.alertvox_checked || false,
                clientNoResponse: t.client_no_response || false,
                evidenceNotes: t.evidence_notes || '',
                evidenceFiles: t.evidence_files || []
            }));

            // 1. Merge remote into local
            remoteTasks.forEach(remote => {
                const localIdx = tasks.findIndex(l => l.id === remote.id || l.supabaseId === remote.id);
                if (localIdx === -1) {
                    tasks.push(remote);
                } else {
                    const localTask = tasks[localIdx];
                    // HEURISTIC: If local task is 'programada' but remote is 'proyectada', 
                    // it's likely a pending sync. Keep local status.
                    const finalStatus = (localTask.status === 'programada' && remote.status === 'proyectada') 
                                        ? 'programada' : remote.status;
                    const finalDays = (localTask.status === 'programada' && remote.status === 'proyectada')
                                        ? (localTask.scheduledDays.length > 0 ? localTask.scheduledDays : remote.scheduledDays)
                                        : remote.scheduledDays;

                    tasks[localIdx] = { 
                        ...localTask, 
                        ...remote, 
                        status: finalStatus,
                        scheduledDays: finalDays,
                        id: remote.id // Always prefer the real UUID as primary ID
                    };
                }
            });

            // 2. DEDUPLICATION: Remove any t_... tasks that now have a UUID counterpart
            const uuidSet = new Set(tasks.filter(t => !t.id.startsWith('t_')).map(t => t.supabaseId || t.id));
            tasks = tasks.filter(t => {
                if (t.id.startsWith('t_')) {
                    // If this temp task has a supabaseId that is already in the UUID set, remove it
                    return !uuidSet.has(t.supabaseId);
                }
                return true;
            });
            
            saveTasks();
            if(typeof postDropSync === 'function') postDropSync();
        }
    } catch(err) {
        console.error("Error in loadTasksFromSupabase:", err);
        showToast('Error de conexión al cargar datos. Revisa tu red e intenta recargar.', 'error');
    }
}

async function syncAllToSupabase() {
    if(!supabaseClient) {
        alert("No hay conexión con Supabase.");
        return;
    }
    
    const btn = event?.target;
    const originalText = btn ? btn.textContent : '';
    if(btn) {
        btn.textContent = 'Sincronizando...';
        btn.disabled = true;
    }

    try {
        let syncCount = 0;
        for (const task of tasks) {
            if (!task.supabaseId || (typeof task.id === 'string' && task.id.startsWith('t_'))) {
                await saveTaskToSupabase(task);
                syncCount++;
            }
        }
        alert(`Sincronización completada. Se subieron ${syncCount} gestiones nuevas a la nube.`);
        await loadTasksFromSupabase();
        renderBoard();
        renderCalendar();
    } catch (err) {
        console.error("Error en sincronización masiva:", err);
        alert("Hubo un error durante la sincronización.");
    } finally {
        if(btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

function openNewTaskModal() {
    try {
        const form = document.getElementById('taskForm');
        if(form) form.reset();

        // Restaurar visibilidad de campos que pudo haber ocultado Metro Administrativo
        ['group-analysts', 'group-days', 'group-equipment'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = '';
        });
        document.getElementById('taskDaysField').required  = true;
        document.getElementById('taskDaysReport').required = true;
        
        const editIdEl = document.getElementById('editTaskId');
        if (editIdEl) editIdEl.value = '';
        
        const modalTitle = document.getElementById('taskModalTitle');
        if (modalTitle) modalTitle.textContent = 'Nueva Gestión';
        
        const submitBtn = document.getElementById('taskFormSubmit');
        if (submitBtn) submitBtn.textContent = 'Crear Gestión';

        // Población de clientes
        const clientSelect = document.getElementById('taskClient');
        if (clientSelect) {
            clientSelect.innerHTML = '<option value="">Seleccione un cliente...</option>';
            dbClients.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = getClientDisplayName(c);
                clientSelect.appendChild(opt);
            });
        }

        // Población de equipos
        const equipSel = document.getElementById('taskEquipment');
        if (equipSel) {
            equipSel.innerHTML = '<option value="">Sin equipo asignado</option>';
            dbEquipment.forEach(eq => {
                const opt = document.createElement('option');
                opt.value = eq.id;
                opt.textContent = `${eq.name}${eq.serial_number ? ' - S/N: '+eq.serial_number : ''}`;
                equipSel.appendChild(opt);
            });
        }

        // Resetear contenedores de analistas y preferencias del cliente
        clientAnalystPreferences = [];
        const container = document.getElementById('taskAnalystsContainer');
        if (container) {
            container.dataset.clientPreferences = '[]';
            container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); text-align: center;">Seleccione primero un cliente para añadir analistas.</div>';
        }

        populateBillingMonthSelect();
        const billingMonthEl = document.getElementById('taskBillingMonth');
        if (billingMonthEl) billingMonthEl.value = formatPeriod();

        const modal = document.getElementById('taskModal');
        if (modal) modal.classList.add('active');
    } catch (error) {
        console.error("Error al abrir el modal de nueva gestión:", error);
    }
}

function openEditTaskModal(taskId) {
    try {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        closeModal('taskInfoModal');
        
        const modalTitle = document.getElementById('taskModalTitle');
        if (modalTitle) modalTitle.textContent = 'Editar Gestión';
        
        const submitBtn = document.getElementById('taskFormSubmit');
        if (submitBtn) submitBtn.textContent = 'Guardar Cambios';
        
        const editIdEl = document.getElementById('editTaskId');
        if (editIdEl) editIdEl.value = taskId;

        const clientSelect = document.getElementById('taskClient');
        if (clientSelect) {
            clientSelect.innerHTML = '<option value="">Seleccione un cliente...</option>';
            dbClients.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                const clientText = getClientDisplayName(c);
                opt.textContent = clientText;
                if (task.client === clientText || c.id === task.clientId) opt.selected = true;
                clientSelect.appendChild(opt);
            });
        }

        const budgetEl = document.getElementById('taskBudget');
        if (budgetEl) budgetEl.value = task.budget;
        
        const fieldEl = document.getElementById('taskDaysField');
        if (fieldEl) fieldEl.value = task.daysField || 1;
        
        const reportEl = document.getElementById('taskDaysReport');
        if (reportEl) reportEl.value = task.daysReport || 0;

        const dateInputStr = task.scheduledDays && task.scheduledDays.length > 0
            ? task.scheduledDays.map(d => d.date ? d.date : `${task.period}-${String(d.day).padStart(2,'0')}`).join(', ')
            : '';
        const dateInputEl = document.getElementById('taskScheduledDate');
        if(dateInputEl) dateInputEl.value = dateInputStr;

        const equipSel = document.getElementById('taskEquipment');
        if (equipSel) {
            equipSel.innerHTML = '<option value="">Sin equipo asignado</option>';
            dbEquipment.forEach(eq => {
                const opt = document.createElement('option');
                opt.value = eq.id;
                opt.textContent = `${eq.name}${eq.serial_number ? ' - S/N: '+eq.serial_number : ''}`;
                if (task.equipmentId === eq.id) opt.selected = true;
                equipSel.appendChild(opt);
            });
        }

        // Al editar, las preferencias del cliente no aplican (se usan los datos guardados)
        clientAnalystPreferences = [];
        const container = document.getElementById('taskAnalystsContainer');
        if (container) {
            container.dataset.clientPreferences = '[]';
            container.innerHTML = '';
            if (task.analysts_assignment && task.analysts_assignment.length > 0) {
                task.analysts_assignment.forEach(a => addAnalystToTask(a));
            } else {
                addAnalystToTask({
                    name: task.analyst || '',
                    isTitular: true,
                    makesReport: true,
                    percentage: 100
                });
            }
        }

        const serviceTypeSel = document.getElementById('taskServiceType');
        if(serviceTypeSel) {
            serviceTypeSel.value = task.serviceType || '';
            if (typeof onTaskServiceTypeChange === 'function') onTaskServiceTypeChange(); 
        }

        const billingMonthEl = document.getElementById('taskBillingMonth');
        if (billingMonthEl) {
            populateBillingMonthSelect();
            billingMonthEl.value = task.mesFacturacion || formatPeriod();
        }

        const modal = document.getElementById('taskModal');
        if (modal) modal.classList.add('active');
    } catch (error) {
        console.error("Error al abrir el modal de edición:", error);
    }
}

function openCsatModal(taskId, targetStatus) {
    document.getElementById('csatForm').reset();
    document.getElementById('csatTaskId').value = taskId;
    document.getElementById('csatTargetStatus').value = targetStatus;
    document.getElementById('csatModal').classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

function addAnalystToTask(analystData = null) {
    const container = document.getElementById('taskAnalystsContainer');
    if (!container) return;

    if (container.innerHTML.includes('Seleccione primero un cliente')) {
        container.innerHTML = '';
    }

    const row = document.createElement('div');
    row.className = 'analyst-row';
    row.style.display = 'flex';
    row.style.gap = '0.5rem';
    row.style.alignItems = 'center';
    row.style.marginBottom = '0.5rem';

    // Select Analista
    const select = document.createElement('select');
    select.className = 'analyst-select';
    select.required = true;
    select.style.flex = '2';
    select.style.padding = '0.4rem';
    
    select.innerHTML = '<option value="">Seleccione analista...</option>';
    dbAnalysts.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        select.appendChild(opt);
    });

    if (analystData && analystData.name) {
        select.value = analystData.name;
    }

    // Titular Checkbox
    const titularLabel = document.createElement('label');
    titularLabel.style.display = 'flex';
    titularLabel.style.alignItems = 'center';
    titularLabel.style.gap = '0.2rem';
    titularLabel.style.fontSize = '0.75rem';
    const titularCheck = document.createElement('input');
    titularCheck.type = 'checkbox';
    titularCheck.className = 'analyst-titular';
    if (analystData && analystData.isTitular) titularCheck.checked = true;
    if (!analystData && container.children.length === 0) titularCheck.checked = true;
    titularLabel.appendChild(titularCheck);
    titularLabel.appendChild(document.createTextNode('Titular'));

    // Report Checkbox
    const reportLabel = document.createElement('label');
    reportLabel.style.display = 'flex';
    reportLabel.style.alignItems = 'center';
    reportLabel.style.gap = '0.2rem';
    reportLabel.style.fontSize = '0.75rem';
    const reportCheck = document.createElement('input');
    reportCheck.type = 'checkbox';
    reportCheck.className = 'analyst-report';
    if (analystData && analystData.makesReport !== undefined) {
        reportCheck.checked = analystData.makesReport;
    } else {
        reportCheck.checked = true;
    }
    reportLabel.appendChild(reportCheck);
    reportLabel.appendChild(document.createTextNode('Informe'));

    // % Input
    const pctInput = document.createElement('input');
    pctInput.type = 'number';
    pctInput.className = 'analyst-pct';
    pctInput.min = '0';
    pctInput.max = '100';
    pctInput.style.width = '50px';
    pctInput.style.padding = '0.3rem';
    pctInput.value = (analystData && analystData.percentage !== undefined) ? analystData.percentage : 100;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '❌';
    removeBtn.style.background = 'none';
    removeBtn.style.border = 'none';
    removeBtn.style.cursor = 'pointer';
    removeBtn.onclick = () => row.remove();

    row.appendChild(select);
    row.appendChild(titularLabel);
    row.appendChild(reportLabel);
    row.appendChild(pctInput);
    row.appendChild(document.createTextNode('%'));
    row.appendChild(removeBtn);

    container.appendChild(row);
}

document.getElementById('taskForm').addEventListener('submit', async e => {
    e.preventDefault();

    // Evitar doble guardado: deshabilitar botón mientras procesa
    const submitBtn = document.getElementById('taskFormSubmit');
    if(submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Guardando...';
    }

    try {
        const clientSelect = document.getElementById('taskClient');
        let clientName = '';
        if (clientSelect && clientSelect.selectedIndex !== -1) {
            clientName = clientSelect.options[clientSelect.selectedIndex].text;
        }
        
        const equipSelect = document.getElementById('taskEquipment');
        const equipId = equipSelect ? equipSelect.value : '';
        const equipName = (equipSelect && equipSelect.selectedIndex !== -1 && equipId) ? equipSelect.options[equipSelect.selectedIndex].text : '';
        
        const budgetVal = document.getElementById('taskBudget').value;
        const budget = budgetVal ? parseFloat(budgetVal) : 0;
        const dField = parseInt(document.getElementById('taskDaysField').value) || 1;
        const dReport = parseInt(document.getElementById('taskDaysReport').value) || 0;
        const serviceType = document.getElementById('taskServiceType').value;
        const editId = document.getElementById('editTaskId').value;
        const clientId = clientSelect ? clientSelect.value : '';

        const isAbsence       = (serviceType === 'Vacaciones' || serviceType === 'Incapacidad' || serviceType === 'Compensatorio');
        const isAdminContract = (serviceType === 'Metro Administrativo');
        const finalClientName = isAbsence ? `AUSENCIA: ${serviceType}` : clientName;

        const container = document.getElementById('taskAnalystsContainer');
        const rows = container ? container.querySelectorAll('.analyst-row') : [];
        let analystsAssignment = [];
        let totalPercentage = 0;
        
        rows.forEach(row => {
            const aSelect = row.querySelector('.analyst-select');
            const aName = aSelect ? aSelect.value : '';
            const isTitular = row.querySelector('.analyst-titular').checked;
            const makesReport = row.querySelector('.analyst-report').checked;
            const pctVal = row.querySelector('.analyst-pct').value;
            const pct = parseFloat(pctVal) || 0;
            
            if(aName) {
                totalPercentage += pct;
                analystsAssignment.push({
                    name: aName,
                    isTitular: isTitular,
                    makesReport: makesReport,
                    percentage: pct
                });
            }
        });

        if(!isAbsence && !isAdminContract && analystsAssignment.length > 0 && Math.abs(totalPercentage - 100) > 0.01) {
            alert("El porcentaje financiero total debe sumar exactamente 100%. Actualmente suma " + totalPercentage + "%.");
            return;
        }

        const mainAnalyst = analystsAssignment.length > 0
            ? (analystsAssignment.find(a => a.isTitular) || analystsAssignment[0]).name
            : (isAdminContract ? 'Administrativo' : '');
        let displayAnalyst = analystsAssignment.length > 0
            ? analystsAssignment.map(a => `${a.name} (${a.percentage}%)`).join(', ')
            : (isAdminContract ? 'Administrativo' : '');
        if(analystsAssignment.length === 1) displayAnalyst = mainAnalyst;


        if(editId) {
            const idx = tasks.findIndex(t => t.id === editId);
            if(idx !== -1) {
                tasks[idx].client = finalClientName;
                tasks[idx].clientId = clientId;
                tasks[idx].analyst = displayAnalyst || mainAnalyst;
                tasks[idx].analysts_assignment = analystsAssignment;
                tasks[idx].equipment = equipName;
                tasks[idx].equipmentId = equipId;
                tasks[idx].budget = isAbsence ? 0 : budget;
                tasks[idx].daysField = dField;
                tasks[idx].daysReport = dReport;
                tasks[idx].serviceType = serviceType;
                tasks[idx].isAbsence = isAbsence;
                tasks[idx].mesFacturacion = document.getElementById('taskBillingMonth').value;

                
                await saveTaskToSupabase(tasks[idx]);
            }
        } else {
            const newTask = {
                id: generateId(),
                client: finalClientName,
                clientId: clientId,
                analyst: displayAnalyst || mainAnalyst,
                analysts_assignment: analystsAssignment,
                equipment: equipName,
                equipmentId: equipId,
                budget: isAbsence ? 0 : budget,
                daysField: dField,
                daysReport: dReport,
                serviceType: serviceType,
                isAbsence: isAbsence,
                scheduledDays: [],
                status: isAdminContract ? 'facturada' : 'proyectada',
                period: formatPeriod(),
                mesFacturacion: document.getElementById('taskBillingMonth').value
            };
            tasks.push(newTask);

            
            await saveTaskToSupabase(newTask);
        }
        
        saveTasks();
        renderBoard();
        renderCalendar();
        if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
        renderTasksView();
        closeModal('taskModal');
        showToast(editId ? 'Gestión actualizada correctamente.' : 'Gestión creada correctamente.', 'success');
    } catch (error) {
        console.error("Error al procesar el formulario de tarea:", error);
        alert("Hubo un error al guardar la gestión:\n\n" + error.message);
    } finally {
        // Rehabilitar botón siempre, haya éxito o error
        if(submitBtn) {
            submitBtn.disabled = false;
            const isEdit = !!document.getElementById('editTaskId')?.value;
            submitBtn.textContent = isEdit ? 'Guardar Cambios' : 'Crear Gestión';
        }
    }
});

// Archivos de evidencia seleccionados (pendientes de subir)
let _evidencePendingFiles = [];

function toggleNoResponseMode(isChecked) {
    document.getElementById('csatRatingSection').style.display   = isChecked ? 'none' : 'block';
    document.getElementById('csatEvidenceSection').style.display = isChecked ? 'block' : 'none';
    const scoreInput = document.getElementById('csatScore');
    if(scoreInput) scoreInput.required = !isChecked;
}

function onEvidenceFilesSelected(fileList) {
    Array.from(fileList).forEach(f => {
        if(!_evidencePendingFiles.find(x => x.name === f.name && x.size === f.size)) {
            _evidencePendingFiles.push(f);
        }
    });
    renderEvidenceFilesList();
    // Limpiar el input para permitir reseleccionar el mismo archivo
    document.getElementById('evidenceFilesInput').value = '';
}

function removeEvidencePendingFile(index) {
    _evidencePendingFiles.splice(index, 1);
    renderEvidenceFilesList();
}

function renderEvidenceFilesList() {
    const container = document.getElementById('evidenceFilesList');
    if(!container) return;
    if(_evidencePendingFiles.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = _evidencePendingFiles.map((f, i) => `
        <div class="evidence-file-item">
            <span class="evidence-file-icon">${f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
            <span class="evidence-file-name">${f.name}</span>
            <span class="evidence-file-size">${(f.size/1024).toFixed(0)} KB</span>
            <button type="button" onclick="removeEvidencePendingFile(${i})" class="evidence-file-remove">✕</button>
        </div>
    `).join('');
}

function renderSavedEvidenceFiles(files) {
    const container = document.getElementById('evidenceFilesList');
    if(!container || !files.length) return;
    const savedHTML = files.map(f => `
        <div class="evidence-file-item evidence-file-saved">
            <span class="evidence-file-icon">${f.name?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? '🖼️' : '📄'}</span>
            <a href="${f.url}" target="_blank" class="evidence-file-name" style="color:var(--clr-blue);text-decoration:underline;">${f.name}</a>
            <span class="evidence-file-size" style="color:var(--clr-green);">✓ Guardado</span>
        </div>
    `).join('');
    container.innerHTML = savedHTML + container.innerHTML;
}

async function uploadEvidenceFiles(taskId) {
    if(!supabaseClient || _evidencePendingFiles.length === 0) return [];
    const urls = [];
    for(const file of _evidencePendingFiles) {
        const ext  = file.name.split('.').pop();
        const path = `tasks/${taskId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
        const { data, error } = await supabaseClient.storage
            .from('evidence-files')
            .upload(path, file, { upsert: false });
        if(error) {
            console.error('Error subiendo evidencia:', error);
            showToast(`Error subiendo ${file.name}`, 'error');
        } else {
            const { data: urlData } = supabaseClient.storage
                .from('evidence-files')
                .getPublicUrl(path);
            urls.push({ name: file.name, url: urlData.publicUrl });
        }
    }
    return urls;
}

function openClosingMeetingModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;

    openCsatModal(taskId, task.status);

    document.getElementById('csatModalTitle').textContent = 'Reunión de Cierre de Gestión';
    document.getElementById('csatSubmitBtn').textContent = 'Guardar Registro de Cierre';

    const noResponse = task.clientNoResponse || false;
    document.getElementById('checkNoResponse').checked = noResponse;
    document.getElementById('csatScore').value = task.csatScore || 5;
    document.getElementById('csatObservations').value = task.csatObservations || '';
    document.getElementById('checkAlertvox').checked = task.alertvoxChecked || false;
    document.getElementById('csatEvidenceNotes').value = task.evidenceNotes || '';

    // Limpiar archivos pendientes y mostrar los ya guardados
    _evidencePendingFiles = [];
    renderEvidenceFilesList();
    renderSavedEvidenceFiles(task.evidenceFiles || []);
    toggleNoResponseMode(noResponse);
}

document.getElementById('csatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const taskId      = document.getElementById('csatTaskId').value;
    const targetStatus = document.getElementById('csatTargetStatus').value;
    const noResponse  = document.getElementById('checkNoResponse').checked;
    const score       = noResponse ? null : document.getElementById('csatScore').value;
    const evidenceNotes = noResponse ? document.getElementById('csatEvidenceNotes').value.trim() : '';
    const observations = document.getElementById('csatObservations').value;
    const alertvox    = document.getElementById('checkAlertvox').checked;

    if(noResponse && !evidenceNotes && _evidencePendingFiles.length === 0
       && !(tasks.find(t => t.id === taskId)?.evidenceFiles?.length)) {
        showToast('Debes añadir una justificación escrita o al menos un archivo de evidencia.', 'error');
        return;
    }

    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if(taskIndex !== -1) {
        // Subir archivos nuevos si los hay
        const submitBtn = document.getElementById('csatSubmitBtn');
        if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Subiendo archivos...'; }

        const newFileUrls = noResponse ? await uploadEvidenceFiles(taskId) : [];
        const existingFiles = tasks[taskIndex].evidenceFiles || [];
        const allFiles = [...existingFiles, ...newFileUrls];
        _evidencePendingFiles = [];

        if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Guardar Registro de Cierre'; }

        tasks[taskIndex].status           = targetStatus;
        tasks[taskIndex].csatScore        = score;
        tasks[taskIndex].csatObservations = observations;
        tasks[taskIndex].alertvoxChecked  = alertvox;
        tasks[taskIndex].clientNoResponse = noResponse;
        tasks[taskIndex].evidenceNotes    = evidenceNotes;
        tasks[taskIndex].evidenceFiles    = allFiles;

        saveTasks();
        await saveTaskToSupabase(tasks[taskIndex]);

        renderBoard();
        renderCalendar();
        renderPlanningSidebar();
        renderTasksView();
        if(typeof renderMyWorkView === 'function') renderMyWorkView();
        closeModal('csatModal');
        const msg = noResponse
            ? 'Registro guardado — Cliente no respondió.'
            : `Registro de cierre guardado. CSAT: ⭐ ${score}/5`;
        showToast(msg, 'success');
    }
});

function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active-view'));
    const targetView = document.getElementById(`view-${viewName}`);
    if(targetView) {
        targetView.classList.add('active-view');
    }

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const targetNav = document.getElementById(`nav-${viewName}`);
    if(targetNav) {
        targetNav.classList.add('active');
    }

    // En móvil: cerrar sidebar al navegar
    if (window.innerWidth <= 768) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const btn     = document.getElementById('sidebar-toggle-btn');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
        if (btn)     btn.style.display = 'flex';
    }
    
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) {
        const titles = {
            dashboard: 'Dashboard',
            mywork:    'Mis Gestiones',
            planning:  'Cronograma Semanal/Mensual',
            tasks:     'Gestión de Tareas',
            finance:   'Módulo de Finanzas',
            admin:     'Administración de Datos Maestros',
            reports:   'Reportes Históricos'
        };
        headerTitle.textContent = titles[viewName] || 'CBM Maestro';
    }

    if(viewName === 'planning') {
        renderCalendar();
        renderPlanningSidebar();
    } else if(viewName === 'mywork') {
        renderMyWorkView();
    } else if(viewName === 'tasks') {
        renderTasksView();
    } else if(viewName === 'finance') {
        populateFinanceMonths();
        renderFinanceView();
    } else if(viewName === 'admin') {
        renderAdminView();
        renderUsersAdminSection();
    } else if(viewName === 'reports') {
        initReportsView();
    } else {
        renderBoard();
    }

    // Recarga silenciosa desde Supabase al cambiar de vista
    // Actualiza los datos en segundo plano sin bloquear la UI
    if(supabaseClient) {
        loadTasksFromSupabase().then(() => {
            if(viewName === 'planning')   { renderCalendar(); renderPlanningSidebar(); }
            else if(viewName === 'mywork')  { renderMyWorkView(); }
            else if(viewName === 'tasks')   { renderTasksView(); }
            else if(viewName === 'finance') { renderFinanceView(); }
            else if(viewName === 'reports') { renderReportsTable(); }
            else                            { renderBoard(); }
        }).catch(() => {}); // silencioso si hay error de red
    }
}

function postDropSync() {
    saveTasks();
    renderBoard();
    renderCalendar();
    if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
}

async function loadMasterData() {
    if(!supabaseClient) return;
    try {
        const { data: clients, error: errC } = await supabaseClient.from('clients').select('*').order('company_name');
        if(errC) console.error("Error fetching clients:", errC);
        
        const { data: analysts, error: errA } = await supabaseClient.from('analysts').select('*').order('name');
        if(errA) console.error("Error fetching analysts:", errA);

        const { data: equipment, error: errE } = await supabaseClient.from('equipment').select('*').eq('is_active', true).order('name');
        if(errE) console.error("Error fetching equipment:", errE);
        
        if(clients) dbClients = clients;
        if(analysts) dbAnalysts = analysts;
        if(equipment) dbEquipment = equipment;
        
        populateGlobalFilterDropdowns();
    } catch(err) {
        console.error("Critical error in loadMasterData:", err);
    }
}



// ══════════════════════════════════════════
// ADMIN CRUD: Edit & Delete para Clientes, Analistas y Equipos
// ══════════════════════════════════════════

async function deleteClient(clientId) {
    const client = dbClients.find(c => c.id === clientId);
    const name = client ? getClientDisplayName(client) : 'este cliente';
    if(!confirm(`¿Eliminar a "${name}"? Esta acción no se puede deshacer.`)) return;
    if(!supabaseClient) return;
    const { error } = await supabaseClient.from('clients').delete().eq('id', clientId);
    if(error) { alert('Error al eliminar: ' + error.message); return; }

    await loadMasterData();
    renderAdminView();
}

function editClient(clientId) {
    const client = dbClients.find(c => c.id === clientId);
    if(!client) return;
    const modal = document.getElementById('adminDataModal');
    document.getElementById('adminModalTitle').textContent = 'Editar Cliente';
    document.getElementById('adminModalContent').innerHTML = `
        <form onsubmit="updateClient(event, '${clientId}')">
            <div class="form-group">
                <label>Nombre de Planta / Cliente</label>
                <input type="text" id="editC_plant" required value="${client.plant || client.company_name || ''}">
            </div>
            <div class="form-group">
                <label>Nombre de Contacto</label>
                <input type="text" id="editC_contact" value="${client.contact_name || ''}">
            </div>
            <button type="submit" class="btn-primary" style="width:100%; margin-top:1rem;">Guardar Cambios</button>
        </form>
    `;
    modal.classList.add('active');
}

async function updateClient(e, clientId) {
    e.preventDefault();
    if(!supabaseClient) return;
    const plant = document.getElementById('editC_plant').value;
    const contact = document.getElementById('editC_contact').value;
    const { error } = await supabaseClient.from('clients').update({
        company_name: plant, plant, contact_name: contact
    }).eq('id', clientId);
    if(error) { alert('Error al actualizar: ' + error.message); return; }

    closeModal('adminDataModal');
    await loadMasterData();
    renderAdminView();
}

async function deleteAnalyst(analystId) {
    const analyst = dbAnalysts.find(a => a.id === analystId);
    const name = analyst ? analyst.name : 'este analista';
    if(!confirm(`¿Eliminar al analista "${name}"? Esta acción no se puede deshacer.`)) return;
    if(!supabaseClient) return;
    const { error } = await supabaseClient.from('analysts').delete().eq('id', analystId);
    if(error) { alert('Error al eliminar: ' + error.message); return; }

    await loadMasterData();
    renderAdminView();
}

function editAnalyst(analystId) {
    const analyst = dbAnalysts.find(a => a.id === analystId);
    if(!analyst) return;
    const modal = document.getElementById('adminDataModal');
    document.getElementById('adminModalTitle').textContent = 'Editar Analista';
    document.getElementById('adminModalContent').innerHTML = `
        <form onsubmit="updateAnalyst(event, '${analystId}')">
            <div class="form-group">
                <label>Nombre del Analista</label>
                <input type="text" id="editA_name" required value="${analyst.name || ''}">
            </div>
            <div class="form-group">
                <label>Especialidad</label>
                <input type="text" id="editA_spec" value="${analyst.specialty || ''}">
            </div>
            <div class="form-group" style="display:flex; align-items:center; gap:0.5rem;">
                <input type="checkbox" id="editA_active" ${analyst.is_active ? 'checked' : ''}>
                <label for="editA_active">Analista Activo</label>
            </div>
            <button type="submit" class="btn-primary" style="width:100%; margin-top:1rem;">Guardar Cambios</button>
        </form>
    `;
    modal.classList.add('active');
}

async function updateAnalyst(e, analystId) {
    e.preventDefault();
    if(!supabaseClient) return;
    const name = document.getElementById('editA_name').value;
    const specialty = document.getElementById('editA_spec').value;
    const is_active = document.getElementById('editA_active').checked;
    const { error } = await supabaseClient.from('analysts').update({ name, specialty, is_active }).eq('id', analystId);
    if(error) { alert('Error al actualizar: ' + error.message); return; }

    closeModal('adminDataModal');
    await loadMasterData();
    renderAdminView();
}

async function deleteEquipment(equipmentId) {
    const equip = dbEquipment.find(e => e.id === equipmentId);
    const name = equip ? equip.name : 'este equipo';
    if(!confirm(`¿Eliminar el equipo "${name}"? Esta acción no se puede deshacer.`)) return;
    if(!supabaseClient) return;
    const { error } = await supabaseClient.from('equipment').delete().eq('id', equipmentId);
    if(error) { alert('Error al eliminar: ' + error.message); return; }

    await loadMasterData();
    renderAdminView();
}

function editEquipment(equipmentId) {
    const equip = dbEquipment.find(e => e.id === equipmentId);
    if(!equip) return;
    const modal = document.getElementById('adminDataModal');
    document.getElementById('adminModalTitle').textContent = 'Editar Equipo';
    document.getElementById('adminModalContent').innerHTML = `
        <form onsubmit="updateEquipment(event, '${equipmentId}')">
            <div class="form-group">
                <label>Nombre del Equipo</label>
                <input type="text" id="editE_name" required value="${equip.name || ''}">
            </div>
            <div class="form-group">
                <label>Número de Serie</label>
                <input type="text" id="editE_serial" value="${equip.serial_number || ''}">
            </div>
            <button type="submit" class="btn-primary" style="width:100%; margin-top:1rem;">Guardar Cambios</button>
        </form>
    `;
    modal.classList.add('active');
}

async function updateEquipment(e, equipmentId) {
    e.preventDefault();
    if(!supabaseClient) return;
    const name = document.getElementById('editE_name').value;
    const serial_number = document.getElementById('editE_serial').value || null;
    const { error } = await supabaseClient.from('equipment').update({ name, serial_number }).eq('id', equipmentId);
    if(error) { alert('Error al actualizar: ' + error.message); return; }

    closeModal('adminDataModal');
    await loadMasterData();
    renderAdminView();
}

// ══════════════════════════════════════════
// MÓDULO DE REPORTES HISTÓRICOS
// ══════════════════════════════════════════

let reportFilters = { analyst: '', client: '', serviceType: '', dateFrom: '', dateTo: '' };

function initReportsView() {
    const analystSel = document.getElementById('report-filter-analyst');
    const clientSel = document.getElementById('report-filter-client');
    if(analystSel) {
        analystSel.innerHTML = '<option value="">Todos los Analistas</option>';
        dbAnalysts.forEach(a => {
            analystSel.innerHTML += `<option value="${a.name}">${a.name}</option>`;
        });
        analystSel.value = reportFilters.analyst;
    }
    if(clientSel) {
        clientSel.innerHTML = '<option value="">Todas las Plantas</option>';
        dbClients.forEach(c => {
            const n = getClientDisplayName(c);
            clientSel.innerHTML += `<option value="${n}">${n}</option>`;
        });
        clientSel.value = reportFilters.client;
    }
    renderReportsTable();
}

function applyReportFilters() {
    reportFilters.analyst     = document.getElementById('report-filter-analyst').value;
    reportFilters.client      = document.getElementById('report-filter-client').value;
    reportFilters.serviceType = document.getElementById('report-filter-service').value;
    reportFilters.dateFrom    = document.getElementById('report-filter-from').value;
    reportFilters.dateTo      = document.getElementById('report-filter-to').value;
    renderReportsTable();
}

function getReportData() {
    let data = tasks.filter(t => !t.isAbsence);

    if(reportFilters.analyst) {
        data = data.filter(t => {
            if(t.analysts_assignment && t.analysts_assignment.length > 0)
                return t.analysts_assignment.some(a => a.name === reportFilters.analyst);
            return t.analyst === reportFilters.analyst;
        });
    }
    if(reportFilters.client) {
        data = data.filter(t => t.client === reportFilters.client || t.client.includes(reportFilters.client));
    }
    if(reportFilters.serviceType) {
        data = data.filter(t => t.serviceType === reportFilters.serviceType);
    }
    if(reportFilters.dateFrom) {
        data = data.filter(t => {
            const period = t.mesFacturacion || t.period || '';
            return period >= reportFilters.dateFrom.substring(0,7);
        });
    }
    if(reportFilters.dateTo) {
        data = data.filter(t => {
            const period = t.mesFacturacion || t.period || '';
            return period <= reportFilters.dateTo.substring(0,7);
        });
    }

    // Sort by period/date
    data.sort((a,b) => {
        const pa = a.mesFacturacion || a.period || '';
        const pb = b.mesFacturacion || b.period || '';
        return pa.localeCompare(pb);
    });
    return data;
}

function formatReportPeriod(period) {
    if(!period) return '-';
    const [y, m] = period.split('-');
    return `${monthNames[parseInt(m)-1] || m} ${y}`;
}

function formatAnalystDisplay(t) {
    if(t.analysts_assignment && t.analysts_assignment.length > 1) {
        return t.analysts_assignment.map(a => `${a.name} (${a.percentage}%)`).join(', ');
    }
    return t.analyst || '-';
}

function renderReportsTable() {
    const container = document.getElementById('reports-table-container');
    if(!container) return;
    if (tasks.length === 0) { renderSkeletonTable(container, 6, 5); return; }
    const data = getReportData();
    const total = data.reduce((sum, t) => sum + (t.budget || 0), 0);

    if(data.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-secondary); font-size:0.9rem;">No se encontraron gestiones con los filtros aplicados.</div>`;
        return;
    }

    container.innerHTML = `
        <table class="data-table" style="font-size:0.8rem; width:100%;">
            <thead>
                <tr>
                    <th style="min-width:110px">Fecha / Período</th>
                    <th style="min-width:160px">Cliente (Planta)</th>
                    <th style="min-width:110px; text-align:right">Monto ($)</th>
                    <th style="min-width:200px">Analistas</th>
                    <th style="min-width:120px">Servicio Realizado</th>
                    <th style="min-width:90px">Estado</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(t => `
                    <tr>
                        <td>${formatReportPeriod(t.mesFacturacion || t.period)}</td>
                        <td><strong>${t.client}</strong></td>
                        <td style="text-align:right; color:var(--clr-green); font-weight:700;">$${(t.budget||0).toLocaleString('es-CO')}</td>
                        <td style="font-size:0.75rem">${formatAnalystDisplay(t)}</td>
                        <td>${t.serviceType || '-'}</td>
                        <td><span class="status-tag ${t.status}" style="font-size:0.7rem">${t.status.toUpperCase()}</span></td>
                    </tr>
                `).join('')}
            </tbody>
            <tfoot>
                <tr style="background: #f0f9ff; font-weight:800; border-top: 2px solid var(--clr-blue);">
                    <td colspan="2" style="padding: 0.75rem; font-size:0.85rem; color:var(--clr-blue)">TOTAL (${data.length} gestiones)</td>
                    <td style="text-align:right; color:var(--clr-green); font-size:1rem; padding:0.75rem;">$${total.toLocaleString('es-CO')}</td>
                    <td colspan="3"></td>
                </tr>
            </tfoot>
        </table>
    `;
}

function exportReportCSV() {
    const data = getReportData();
    if(data.length === 0) { alert('No hay datos para exportar.'); return; }

    const headers = ['Fecha/Período','Cliente (Planta)','Monto ($)','Analistas','Servicio Realizado','Estado'];
    const rows = data.map(t => [
        formatReportPeriod(t.mesFacturacion || t.period),
        t.client,
        t.budget || 0,
        formatAnalystDisplay(t),
        t.serviceType || '',
        t.status
    ]);
    const total = data.reduce((s, t) => s + (t.budget || 0), 0);
    rows.push(['TOTAL', '', total, '', '', '']);

    const csvContent = [headers, ...rows]
        .map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(','))
        .join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `Reporte_CBM_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
}

async function exportReportPDF() {
    const data = getReportData();
    if(data.length === 0) { alert('No hay datos para exportar.'); return; }
    if(typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
        alert('La librería PDF está cargando. Intenta en unos segundos.'); return;
    }

    // Cargar logo como base64
    let logoDataUrl = null;
    try {
        const resp = await fetch('logo.png');
        const blob = await resp.blob();
        logoDataUrl = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch(e) { /* continúa sin logo */ }

    const { jsPDF: JSPDF } = window.jspdf || {};
    const doc = JSPDF
        ? new JSPDF({ orientation:'landscape', unit:'mm', format:'letter' })
        : new jsPDF({ orientation:'landscape', unit:'mm', format:'letter' });

    const pageW  = 279.4;
    const pageH  = 215.9;
    const mX     = 15;
    const BLUE   = [30, 64, 175];
    const LBLUE  = [96, 165, 250];

    // ── Dibuja encabezado y pie de página (formato A-MAQ) ────────────────────
    function drawPageLayout(pageNum) {
        // Logo superior derecho
        if(logoDataUrl) {
            doc.addImage(logoDataUrl, 'PNG', pageW - 34, 5, 22, 22);
        }
        // Nombre empresa junto al logo
        doc.setTextColor(...BLUE);
        doc.setFontSize(7); doc.setFont('helvetica','bold');
        doc.text('A-MAQ S.A.', pageW - 23, 29, { align:'center' });

        // Línea azul debajo del encabezado
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.8);
        doc.line(mX, 31, pageW - mX, 31);

        // ── PIE DE PÁGINA ──
        // Línea azul sobre el pie
        doc.setLineWidth(0.5);
        doc.line(mX, pageH - 20, pageW - mX, pageH - 20);

        // Círculos decorativos esquinas inferiores (imitan las ondas del membrete)
        doc.setFillColor(...BLUE);
        doc.circle(-4, pageH + 3, 18, 'F');     // esquina inferior izquierda
        doc.setFillColor(...LBLUE);
        doc.circle(pageW + 4, pageH + 3, 18, 'F'); // esquina inferior derecha

        // Datos de contacto
        doc.setTextColor(...BLUE);
        doc.setFontSize(7); doc.setFont('helvetica','normal');
        doc.text(
            '+57 300 8622954   •   info@a-maq.com   •   www.a-maq.com',
            pageW / 2, pageH - 14, { align:'center' }
        );

        // Número de página
        doc.setTextColor(130);
        doc.setFontSize(7);
        doc.text(`Pág. ${pageNum}`, pageW - mX, pageH - 14, { align:'right' });
    }

    // ── Página 1: encabezado + título ────────────────────────────────────────
    drawPageLayout(1);

    doc.setTextColor(...BLUE);
    doc.setFontSize(13); doc.setFont('helvetica','bold');
    doc.text('Reporte Histórico de Gestiones — Departamento CBM', mX, 22);

    doc.setTextColor(90); doc.setFontSize(8); doc.setFont('helvetica','normal');
    const fechaHoy = new Date().toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' });
    doc.text(`Generado el ${fechaHoy}`, mX, 27.5);

    // Filtros aplicados
    const filterParts = [];
    if(reportFilters.analyst)     filterParts.push(`Analista: ${reportFilters.analyst}`);
    if(reportFilters.client)      filterParts.push(`Cliente: ${reportFilters.client}`);
    if(reportFilters.serviceType) filterParts.push(`Servicio: ${reportFilters.serviceType}`);
    if(reportFilters.dateFrom)    filterParts.push(`Desde: ${reportFilters.dateFrom}`);
    if(reportFilters.dateTo)      filterParts.push(`Hasta: ${reportFilters.dateTo}`);

    let startY = 37;
    if(filterParts.length > 0) {
        doc.setTextColor(100); doc.setFontSize(7.5);
        doc.text('Filtros: ' + filterParts.join('  |  '), mX, 35.5);
        startY = 40;
    }

    // ── Tabla de datos ───────────────────────────────────────────────────────
    const total = data.reduce((s,t) => s + (t.budget||0), 0);

    const tableData = data.map(t => [
        formatReportPeriod(t.mesFacturacion || t.period),
        t.client,
        '$' + (t.budget||0).toLocaleString('es-CO'),
        formatAnalystDisplay(t),
        t.serviceType || '-',
        t.status.toUpperCase()
    ]);
    tableData.push([`TOTAL (${data.length} gestiones)`, '', '$' + total.toLocaleString('es-CO'), '', '', '']);

    doc.autoTable({
        startY,
        head: [['Fecha / Período','Cliente (Planta)','Monto ($)','Analistas','Tipo de Servicio','Estado']],
        body: tableData,
        styles: { fontSize: 8, cellPadding: 2.5, font:'helvetica' },
        headStyles: { fillColor: BLUE, textColor: 255, fontStyle:'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 248, 255] },
        columnStyles: {
            0: { cellWidth: 28 },
            1: { cellWidth: 58 },
            2: { cellWidth: 30, halign:'right' },
            3: { cellWidth: 72 },
            4: { cellWidth: 38 },
            5: { cellWidth: 22, halign:'center' }
        },
        margin: { left: mX, right: mX, bottom: 26 },
        didDrawPage: function(d) {
            if(d.pageNumber > 1) drawPageLayout(d.pageNumber);
        },
        didParseCell: function(d) {
            // Fila de total
            if(d.row.index === tableData.length - 1) {
                d.cell.styles.fillColor = [235, 242, 255];
                d.cell.styles.fontStyle = 'bold';
                d.cell.styles.textColor = BLUE;
            }
            // Color por estado
            if(d.column.index === 5 && d.row.section === 'body' && d.row.index < tableData.length - 1) {
                const s = (d.cell.raw || '').toLowerCase();
                if(s === 'facturada')  d.cell.styles.textColor = [22, 163, 74];
                else if(s === 'ejecutada')  d.cell.styles.textColor = [234, 88, 12];
                else if(s === 'programada') d.cell.styles.textColor = [124, 58, 237];
                else if(s === 'proyectada') d.cell.styles.textColor = [37, 99, 235];
            }
        }
    });

    doc.save(`Reporte_CBM_${new Date().toISOString().slice(0,10)}.pdf`);
}

async function renderAdminView() {
    const analystsList = document.getElementById('admin-analysts-list');
    const clientsList = document.getElementById('admin-clients-list');
    if(!analystsList || !clientsList) return;

    let syncBtnContainer = document.getElementById('admin-sync-container');
    if(!syncBtnContainer) {
        syncBtnContainer = document.createElement('div');
        syncBtnContainer.id = 'admin-sync-container';
        syncBtnContainer.style.marginBottom = '1.5rem';
        syncBtnContainer.style.padding = '1rem';
        syncBtnContainer.style.background = 'var(--clr-blue-light)';
        syncBtnContainer.style.borderRadius = 'var(--radius-lg)';
        syncBtnContainer.style.display = 'flex';
        syncBtnContainer.style.justifyContent = 'space-between';
        syncBtnContainer.style.alignItems = 'center';
        syncBtnContainer.innerHTML = `
            <div>
                <h4 style="margin:0; color:var(--clr-blue)">Sincronización de Datos</h4>
                <p style="margin:0; font-size:0.75rem; color:var(--text-secondary)">Sube tus datos locales actuales a la base de datos en la nube.</p>
            </div>
            <button class="btn-primary" onclick="syncAllToSupabase()" style="background:var(--clr-blue)">⬆️ Sincronizar con la Nube</button>
        `;
        document.querySelector('#view-admin').insertBefore(syncBtnContainer, document.querySelector('.admin-grid'));
    }

    analystsList.innerHTML = `
    <div class="table-container">
        <table class="data-table dense-table">
            <thead>
                <tr>
                    <th style="width: 35%;">Nombre</th>
                    <th style="width: 30%;">Especialidad</th>
                    <th style="width: 15%;">Activo</th>
                    <th style="width: 20%;">Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${dbAnalysts.map(a => `
                    <tr>
                        <td><strong>${a.name}</strong></td>
                        <td>${a.specialty || '-'}</td>
                        <td><span class="status-tag ${a.is_active ? 'ejecutada' : 'proyectada'}">${a.is_active ? 'SI' : 'NO'}</span></td>
                        <td>
                            <div class="action-icons">
                                ${actionIcon('edit',   `editAnalyst('${a.id}')`,   'Editar')}
                                ${actionIcon('delete', `deleteAnalyst('${a.id}')`, 'Eliminar')}
                            </div>
                        </td>
                    </tr>
                `).join('')}
                <tr>
                    <td><input type="text" id="qa_analyst_name" placeholder="Nuevo analista..." style="width:100%; padding:0.4rem; font-size:0.8rem"></td>
                    <td><input type="text" id="qa_analyst_spec" placeholder="Esp..." style="width:100%; padding:0.4rem; font-size:0.8rem"></td>
                    <td>-</td>
                    <td><button class="btn-primary" style="padding:0.4rem; font-size:0.8rem; width:100%" onclick="quickAddAnalyst()">Guardar</button></td>
                </tr>
            </tbody>
        </table>
    </div>`;

    clientsList.innerHTML = `
    <div class="table-container">
        <div style="margin-bottom: 0.5rem; display: flex; gap: 0.5rem;">
            <button class="btn-primary" style="font-size:0.7rem; padding:0.25rem 0.5rem; background:var(--clr-green)" onclick="downloadClientTemplate()">📥 Plantilla Excel</button>
            <input type="file" id="importClientsFile" style="display:none" accept=".xlsx, .xls, .csv" onchange="handleClientImport(event)">
            <button class="btn-primary" style="font-size:0.7rem; padding:0.25rem 0.5rem; background:var(--clr-purple)" onclick="document.getElementById('importClientsFile').click()">📤 Importar Excel</button>
        </div>
        <table class="data-table dense-table">
            <thead>
                <tr>
                    <th style="width: 45%;">Planta / Cliente</th>
                    <th style="width: 35%;">Contacto</th>
                    <th style="width: 20%;">Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${dbClients.map(c => `
                    <tr>
                        <td><strong>${getClientDisplayName(c)}</strong></td>
                        <td>${c.contact_name || '-'}</td>
                        <td>
                            <div class="action-icons">
                                ${actionIcon('pref',   `openPreferenceModal('${c.id}')`, 'Asignar Analistas')}
                                ${actionIcon('edit',   `editClient('${c.id}')`,           'Editar')}
                                ${actionIcon('delete', `deleteClient('${c.id}')`,          'Eliminar')}
                            </div>
                        </td>
                    </tr>
                `).join('')}
                <tr>
                    <td><input type="text" id="qa_client_plant" placeholder="Nueva planta..." style="width:100%; padding:0.4rem; font-size:0.8rem"></td>
                    <td><input type="text" id="qa_client_contact" placeholder="Contacto..." style="width:100%; padding:0.4rem; font-size:0.8rem"></td>
                    <td><button class="btn-primary" style="padding:0.4rem; font-size:0.8rem; width:100%" onclick="quickAddClient()">Guardar</button></td>
                </tr>
            </tbody>
        </table>
    </div>`;

    const equipmentList = document.getElementById('admin-equipment-list');
    if(equipmentList) {
        equipmentList.innerHTML = `
        <div class="table-container">
            <table class="data-table dense-table">
                <thead>
                    <tr>
                        <th style="width: 45%;">Equipo</th>
                        <th style="width: 35%;">S/N</th>
                        <th style="width: 20%;">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${dbEquipment.map(e => `
                        <tr>
                            <td><strong>${e.name}</strong></td>
                            <td>${e.serial_number || '-'}</td>
                            <td>
                                <div class="action-icons">
                                    ${actionIcon('edit',   `editEquipment('${e.id}')`,   'Editar')}
                                    ${actionIcon('delete', `deleteEquipment('${e.id}')`, 'Eliminar')}
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                    <tr>
                        <td><input type="text" id="qa_equip_name" placeholder="Nuevo equipo..." style="width:100%; padding:0.4rem; font-size:0.8rem"></td>
                        <td><input type="text" id="qa_equip_serial" placeholder="S/N..." style="width:100%; padding:0.4rem; font-size:0.8rem"></td>
                        <td><button class="btn-primary" style="padding:0.4rem; font-size:0.8rem; width:100%" onclick="quickAddEquipment()">Guardar</button></td>
                    </tr>
                </tbody>
            </table>
        </div>`;
    }
}

function openPreferenceModal(clientId) {
    const client = dbClients.find(c => c.id === clientId);
    if(!client) return;
    
    document.getElementById('adminModalTitle').textContent = `Preferencias: ${getClientDisplayName(client)}`;
    const content = document.getElementById('adminModalContent');
    content.innerHTML = `
        <form onsubmit="submitPreferenceForm(event, '${clientId}')" style="background:#f8fafc; padding:1rem; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:1rem;">
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; margin-bottom:1rem;">
                <select id="prefAnalyst" class="form-control" required>
                    <option value="">Seleccione Analista...</option>
                    ${dbAnalysts.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
                </select>
                <select id="prefLevel" class="form-control" required>
                    <option value="Primary">Titular (Primary)</option>
                    <option value="Secondary">Secundario (Secondary)</option>
                    <option value="Backup">Respaldo (Backup)</option>
                </select>
            </div>
            <button type="submit" class="btn-primary bg-purple" style="width:100%">Vincular Analista</button>
        </form>
        <div id="prefList" style="margin-top: 1.5rem; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
            <div style="text-align:center; font-size:0.8rem;">Cargando prioridades...</div>
        </div>
    `;
    
    document.getElementById('adminDataModal').classList.add('active');
    loadPreferences(clientId);
}

async function loadPreferences(clientId) {
    const prefList = document.getElementById('prefList');
    if (!supabaseClient) return;
    try {
        const { data: prefs, error } = await supabaseClient
            .from('client_analyst_preferences')
            .select('*, analysts(name)')
            .eq('client_id', clientId);
            
        if(error) console.error("Error cargando preferencias:", error);
        
        if(!prefs || prefs.length === 0) {
            prefList.innerHTML = '<div style="text-align:center; font-size:0.8rem; color:var(--text-secondary)">Aún no tiene analistas vinculados.</div>';
            return;
        }
        
        prefList.innerHTML = prefs.map(p => `
            <div style="background:var(--bg-color); padding: 0.5rem; border-radius: 4px; margin-bottom:0.5rem; font-size:0.85rem; display:flex; justify-content:space-between">
                <span><strong>${p.priority_level}:</strong> ${p.analysts.name}</span>
                <span style="color:var(--clr-pink); cursor:pointer" onclick="deletePreference('${p.client_id}', '${p.analyst_id}')">x</span>
            </div>
        `).join('');
    } catch(err) {
        console.error("Error in loadPreferences:", err);
    }
}

async function submitPreferenceForm(event, clientId) {
    event.preventDefault();
    if(!supabaseClient) return;

    const analystId   = document.getElementById('prefAnalyst').value;
    const priorityLevel = document.getElementById('prefLevel').value;

    if(!analystId) {
        showToast('Selecciona un analista.', 'error');
        return;
    }

    try {
        const { error } = await supabaseClient
            .from('client_analyst_preferences')
            .upsert({ client_id: clientId, analyst_id: analystId, priority_level: priorityLevel },
                    { onConflict: 'client_id,analyst_id' });

        if(error) {
            console.error('Error guardando preferencia:', error);
            showToast('Error al guardar la preferencia.', 'error');
            return;
        }

        showToast('Analista vinculado correctamente.', 'success');
        document.getElementById('prefAnalyst').value = '';
        loadPreferences(clientId);
    } catch(err) {
        console.error('Error en submitPreferenceForm:', err);
        showToast('Error inesperado.', 'error');
    }
}

async function deletePreference(clientId, analystId) {
    if(!supabaseClient) return;
    if(!confirm('¿Quitar este analista de las preferencias del cliente?')) return;

    try {
        const { error } = await supabaseClient
            .from('client_analyst_preferences')
            .delete()
            .eq('client_id', clientId)
            .eq('analyst_id', analystId);

        if(error) {
            console.error('Error eliminando preferencia:', error);
            showToast('Error al eliminar la preferencia.', 'error');
            return;
        }

        showToast('Preferencia eliminada.', 'success');
        loadPreferences(clientId);
    } catch(err) {
        console.error('Error en deletePreference:', err);
        showToast('Error inesperado.', 'error');
    }
}

async function submitAdminForm(e, type) {
    e.preventDefault();
    if(!supabaseClient) return;
    
    try {
        let payload = {};
        if(type === 'analyst') {
            payload = {
                name: document.getElementById('addA_name').value,
                specialty: document.getElementById('addA_spec').value,
                is_active: true
            };
            await supabaseClient.from('analysts').insert(payload);
        } else if(type === 'client') {
            payload = {
                company_name: document.getElementById('addC_plant').value,
                plant: document.getElementById('addC_plant').value,
                contact_name: document.getElementById('addC_contact').value
            };
            await supabaseClient.from('clients').insert(payload);
        } else if(type === 'equipment') {
            payload = {
                name: document.getElementById('addE_name').value,
                serial_number: document.getElementById('addE_serial').value || null,
                is_active: true
            };
            await supabaseClient.from('equipment').insert(payload);
        }
        

    } catch(err) {
        console.error("Error inserting data:", err);
        alert("Error al guardar: " + err.message);
    }
    closeModal('adminDataModal');
    await loadMasterData();
    renderAdminView();
    renderCalendar();
}

function openAdminModal(type) {
    const modal = document.getElementById('adminDataModal');
    const title = document.getElementById('adminModalTitle');
    const content = document.getElementById('adminModalContent');
    
    if(!modal || !title || !content) return;
    
    title.textContent = `Nuevo ${type === 'client' ? 'Cliente' : type === 'analyst' ? 'Analista' : 'Equipo'}`;
    
    let formHtml = '';
    if(type === 'client') {
        formHtml = `
            <form onsubmit="submitAdminForm(event, 'client')">
                <div class="form-group">
                    <label>Nombre de Planta / Cliente</label>
                    <input type="text" id="addC_plant" required placeholder="Ej. Planta Modelo">
                </div>
                <div class="form-group">
                    <label>Nombre de Contacto</label>
                    <input type="text" id="addC_contact" placeholder="Ej. Juan Pérez">
                </div>
                <button type="submit" class="btn-primary" style="width:100%; margin-top:1rem;">Guardar Cliente</button>
            </form>
        `;
    } else if(type === 'analyst') {
        formHtml = `
            <form onsubmit="submitAdminForm(event, 'analyst')">
                <div class="form-group">
                    <label>Nombre del Analista</label>
                    <input type="text" id="addA_name" required placeholder="Ej. Carlos Ruiz">
                </div>
                <div class="form-group">
                    <label>Especialidad</label>
                    <input type="text" id="addA_spec" placeholder="Ej. Vibraciones / Alineación">
                </div>
                <button type="submit" class="btn-primary" style="width:100%; margin-top:1rem;">Guardar Analista</button>
            </form>
        `;
    } else if(type === 'equipment') {
        formHtml = `
            <form onsubmit="submitAdminForm(event, 'equipment')">
                <div class="form-group">
                    <label>Nombre del Equipo</label>
                    <input type="text" id="addE_name" required placeholder="Ej. Colector CSI 2140">
                </div>
                <div class="form-group">
                    <label>Número de Serie</label>
                    <input type="text" id="addE_serial" placeholder="S/N 123456">
                </div>
                <button type="submit" class="btn-primary" style="width:100%; margin-top:1rem;">Guardar Equipo</button>
            </form>
        `;
    }
    
    content.innerHTML = formHtml;
    modal.classList.add('active');
}

async function quickAddAnalyst() {
    const name = document.getElementById('qa_analyst_name').value;
    const spec = document.getElementById('qa_analyst_spec').value;
    if(!name) return;
    try {
        await supabaseClient.from('analysts').insert({ name, specialty: spec, is_active: true });
        await loadMasterData();
        renderAdminView();

    } catch(e) { console.error(e); }
}

async function quickAddClient() {
    const plant = document.getElementById('qa_client_plant').value;
    const contact = document.getElementById('qa_client_contact').value;
    if(!plant) return;
    try {
        await supabaseClient.from('clients').insert({ company_name: plant, plant, contact_name: contact });
        await loadMasterData();
        renderAdminView();

    } catch(e) { console.error(e); }
}

async function quickAddEquipment() {
    const name = document.getElementById('qa_equip_name').value;
    const serial = document.getElementById('qa_equip_serial').value;
    if(!name) return;
    try {
        await supabaseClient.from('equipment').insert({ name, serial_number: serial, is_active: true });
        await loadMasterData();
        renderAdminView();

    } catch(e) { console.error(e); }
}

async function checkSession() {
    if(!supabaseClient) return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    await handleAuthChange(session);

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        await handleAuthChange(session);
    });
}

async function handleAuthChange(session) {
    const authContainer = document.getElementById('auth-container');
    const appWrapper = document.getElementById('app-wrapper');
    
    if (session) {
        currentUser = session.user;
        console.log("Sesión iniciada para:", currentUser.email);
        if(authContainer) authContainer.style.display = 'none';
        if(appWrapper) appWrapper.style.display = 'flex';
        try {
            await initializeApp();
        } catch (err) {
            console.error("Error crítico durante la inicialización:", err);
        }
    } else {
        currentUser = null;
        if(authContainer) authContainer.style.display = 'flex';
        if(appWrapper) appWrapper.style.display = 'none';
        window._appInitialized = false; 
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmitBtn');
    
    if(!supabaseClient) {
        alert("Error: No se pudo conectar con el servidor de base de datos. Verifique su conexión.");
        return;
    }
    
    if(errorDiv) errorDiv.style.display = 'none';
    if(submitBtn) {
        submitBtn.textContent = 'Verificando...';
        submitBtn.disabled = true;
    }
    
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
            console.error("Login error:", error.message);
            if(errorDiv) {
                errorDiv.textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message;
                errorDiv.style.display = 'block';
            }
            if(submitBtn) {
                submitBtn.textContent = 'Ingresar al Sistema';
                submitBtn.disabled = false;
            }
        } else {
            console.log("Login exitoso");
        }
    } catch (err) {
        console.error("Excepción en login:", err);
        if(errorDiv) {
            errorDiv.textContent = "Error de conexión inesperado.";
            errorDiv.style.display = 'block';
        }
        if(submitBtn) {
            submitBtn.textContent = 'Ingresar al Sistema';
            submitBtn.disabled = false;
        }
    }
}

async function handleLogout() {
    if(!supabaseClient) return;
    try {
        await supabaseClient.auth.signOut();
        location.reload(); // Recargar para limpiar todo el estado
    } catch (err) {
        console.error("Error al cerrar sesión:", err);
    }
}

async function initializeApp() {
    if(window._appInitialized) return;
    window._appInitialized = true;

    // Cerrar cualquier modal activo con Escape
    if (!window._escapeListenerAttached) {
        window._escapeListenerAttached = true;
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
            }
        });

        // Delegación de eventos: auto-distribuir porcentajes de analistas
        document.addEventListener('input', e => {
            if (e.target.classList.contains('analyst-pct')) {
                autoDistributePercentages(e.target);
            }
        });
    }

    window.postDropSync = postDropSync;
    updatePeriodDisplay();
    
    showLoadingOverlay(true);
    try {
        await loadMasterData();
        if(supabaseClient) {
            // Cargar perfil y tareas en paralelo
            const [, profileData] = await Promise.all([
                loadTasksFromSupabase(),
                loadUserProfile(currentUser?.id)
            ]);
            currentUserProfile = profileData;
        }
    } catch (err) {
        console.error("Error cargando datos iniciales:", err);
        showToast('Error al cargar datos iniciales. Verifica tu conexión.', 'error');
    } finally {
        showLoadingOverlay(false);
    }

    // Aplicar UI según rol (también navega a la vista por defecto)
    applyRoleUI();

    // Renderizar vistas base
    renderBoard();
    renderCalendar();
    if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
    if(typeof renderAdminView === 'function') renderAdminView();
    renderMyWorkView();

    const sidebarContainer = document.getElementById('planning-sidebar-items');
    if (sidebarContainer && !window._sidebarListenerAttached) {
        window._sidebarListenerAttached = true;
        sidebarContainer.addEventListener('dragover', e => {
            e.preventDefault();
            sidebarContainer.parentElement.classList.add('drag-over');
        });
        sidebarContainer.addEventListener('dragleave', e => {
            sidebarContainer.parentElement.classList.remove('drag-over');
        });
        sidebarContainer.addEventListener('drop', async e => {
            e.preventDefault();
            sidebarContainer.parentElement.classList.remove('drag-over');
            
            let dragInfo = draggedTaskId;
            let taskId = dragInfo;
            if (dragInfo && dragInfo.startsWith('pill-')) {
                const dragEl = document.getElementById(dragInfo);
                taskId = dragEl ? dragEl.getAttribute('data-task-id') : dragInfo.split('-')[1];
            }

            const task = tasks.find(t => t.id === taskId);
            if (task && task.status !== 'proyectada') {

                await updateTaskStatus(task.id, 'proyectada');
            }
        });
    }

    // Touch support for Kanban view
    document.querySelectorAll('.kanban-column').forEach(column => {
        column.addEventListener('touchend', async e => {
            if (!draggedTaskId) return;
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            if (target === column || column.contains(target)) {
                await handleKanbanDrop(column, draggedTaskId);
            }
        });
    });

    // Sidebar touch drop
    if (sidebarContainer) {
        sidebarContainer.addEventListener('touchend', async e => {
            if (!draggedTaskId) return;
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            if (target === sidebarContainer || sidebarContainer.contains(target)) {
                await handleSidebarDrop(draggedTaskId);
            }
        });
    }


}

function populateBillingMonthSelect() {
    const select = document.getElementById('taskBillingMonth');
    if(!select) return;
    select.innerHTML = '';
    const now = new Date();
    for(let i = -3; i <= 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const val = `${y}-${String(m).padStart(2, '0')}`;
        const label = `${monthNames[m-1]} ${y}`;
        select.innerHTML += `<option value="${val}">${label}</option>`;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await checkSession();
});

// Helper Function

