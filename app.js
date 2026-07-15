// Supabase Config
// Si env.staging.js se cargó antes, window._stagingConfig sobreescribe las credenciales.
const supabaseUrl = (window._stagingConfig && window._stagingConfig.url) || 'https://gvjemehvtrxwsokmyyby.supabase.co';
const supabaseKey = (window._stagingConfig && window._stagingConfig.key) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2amVtZWh2dHJ4d3Nva215eWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NTkxOTMsImV4cCI6MjA4OTQzNTE5M30.TSVtuYnGI2j9JymCJbjKsXlbs1hG2EpaHHuEksJuAqE';
let supabaseClient = null;

try {
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
    }
} catch (e) {
    console.error("Error initializing Supabase", e);
}

// Banner de ambiente de pruebas
if (window.IS_STAGING) {
    document.addEventListener('DOMContentLoaded', () => {
        const banner = document.createElement('div');
        banner.id = 'staging-banner';
        banner.textContent = '⚠️  AMBIENTE DE PRUEBAS — Los datos aquí NO son los de producción  ⚠️';
        Object.assign(banner.style, {
            position: 'fixed', top: '0', left: '0', right: '0', zIndex: '99999',
            background: '#f59e0b', color: '#1c1917', textAlign: 'center',
            fontWeight: '700', fontSize: '0.8rem', padding: '6px 0',
            letterSpacing: '0.05em', pointerEvents: 'none',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
        });
        document.body.prepend(banner);
        // Empujar el contenido hacia abajo para que el banner no tape la nav
        document.body.style.paddingTop = '30px';
    });
}

let dbClients = [];
let dbAnalysts = [];
let dbEquipment = [];
let dbPlants = []; // { id, client_id, name } — plantas/sedes por cliente
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
        admin:      ['dashboard', 'tasks', 'planning', 'finance', 'admin', 'reports', 'inventory'],
        analyst:    ['mywork', 'planning', 'inventory'],
        assistant:  ['dashboard', 'tasks', 'planning', 'finance', 'reports'],
        commercial: ['dashboard', 'tasks', 'planning', 'finance', 'reports'],
        viewer:     ['dashboard'],
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
    const roleLabel   = { admin: 'Administrador', analyst: 'Analista', assistant: 'Asistente', commercial: 'Comercial', viewer: 'Visitante' }[role] || role;
    if (nameEl)  nameEl.textContent  = displayName;
    if (roleEl)  roleEl.textContent  = roleLabel;
    if (avatar)  avatar.textContent  = displayName[0].toUpperCase();

    // Clase en body para CSS condicional por rol
    document.body.className = document.body.className
        .replace(/\brole-\w+\b/g, '').trim();
    document.body.classList.add(`role-${role}`);

    // Navegar a la vista por defecto del rol
    const defaultView = { admin: 'dashboard', analyst: 'mywork', assistant: 'tasks', commercial: 'dashboard', viewer: 'dashboard' };
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

/** Devuelve gestiones con CSAT vencido (>7 días desde último día de informe) */
function getCsatOverdueTasks(analystName) {
    const today = Date.now();
    return tasks.filter(t => {
        if(t.isAbsence || t.serviceType === 'Metro Administrativo' || t.serviceType === 'Metro Terceros') return false;
        if(t.status !== 'ejecutada') return false;
        if(t.csatScore || t.clientNoResponse) return false;
        if(analystName && !t.analysts_assignment?.some(a => a.name === analystName)) return false;
        const lastReport = (t.scheduledDays||[])
            .filter(d => d.type === 'report')
            .map(d => d.date)
            .sort().pop();
        if(!lastReport) return false;
        const diff = Math.floor((today - new Date(lastReport).getTime()) / 86400000);
        return diff >= 7;
    });
}

/** Actualiza el badge rojo en el menú de Mis Gestiones */
// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA DE NOTIFICACIONES IN-APP (Fase 1: infraestructura)
// ══════════════════════════════════════════════════════════════════════════════

let myNotifications = []; // cache local de notificaciones del usuario actual

/** Trae las últimas 100 notificaciones del usuario logueado (para el panel). */
async function loadMyNotifications() {
    if(!supabaseClient || !currentUser?.id) return;
    try {
        const { data, error } = await supabaseClient
            .from('notifications')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(100);
        if(error) { console.error('Error cargando notificaciones:', error); return; }
        myNotifications = data || [];
        updateNotificationBadge();
        renderNotificationsPanel();
    } catch(e) {
        console.error('Excepción cargando notificaciones:', e);
    }
}

/** Crea una notificación dirigida a un usuario (por su user_id).
 *  Uso: createNotification({ user_id, type, title, body, data, is_urgent }) */
async function createNotification({ user_id, type, title, body = '', data = {}, is_urgent = false }) {
    if(!supabaseClient || !user_id) return;
    try {
        const { error } = await supabaseClient
            .from('notifications')
            .insert({ user_id, type, title, body, data, is_urgent });
        if(error) console.error('Error creando notificación:', error);
    } catch(e) {
        console.error('Excepción creando notificación:', e);
    }
}

/** Marca una notificación como leída. */
async function markNotificationAsRead(notifId) {
    if(!supabaseClient) return;
    const local = myNotifications.find(n => n.id === notifId);
    if(local && local.read_at) return; // ya leída, no repetir
    try {
        const nowIso = new Date().toISOString();
        const { error } = await supabaseClient
            .from('notifications')
            .update({ read_at: nowIso })
            .eq('id', notifId);
        if(error) { console.error('Error marcando como leída:', error); return; }
        if(local) local.read_at = nowIso;
        updateNotificationBadge();
        renderNotificationsPanel();
    } catch(e) {
        console.error('Excepción marcando leída:', e);
    }
}

/** Marca todas las no leídas del usuario como leídas. */
async function markAllNotificationsAsRead() {
    if(!supabaseClient || !currentUser?.id) return;
    try {
        const nowIso = new Date().toISOString();
        const { error } = await supabaseClient
            .from('notifications')
            .update({ read_at: nowIso })
            .eq('user_id', currentUser.id)
            .is('read_at', null);
        if(error) { console.error('Error marcando todas leídas:', error); return; }
        myNotifications.forEach(n => { if(!n.read_at) n.read_at = nowIso; });
        updateNotificationBadge();
        renderNotificationsPanel();
    } catch(e) {
        console.error('Excepción marcando todas leídas:', e);
    }
}

/** Actualiza el número del badge rojo en la campanita. */
function updateNotificationBadge() {
    const badge = document.getElementById('notifBadge');
    if(!badge) return;
    const unread = myNotifications.filter(n => !n.read_at && !n.resolved_at).length;
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'inline-block' : 'none';
}

/** Grupos expandidos por tipo (agrupación en el panel principal). */
const _notifGroupExpanded = new Set();

function _toggleNotifGroup(type) {
    if(_notifGroupExpanded.has(type)) _notifGroupExpanded.delete(type);
    else _notifGroupExpanded.add(type);
    renderNotificationsPanel();
}

/** Renderiza el panel desplegable con agrupación por tipo y retenciones. */
function renderNotificationsPanel() {
    const list = document.getElementById('notifList');
    if(!list) return;

    // Aplicar retenciones (leídas <30d, resueltas <15d, no leídas siempre)
    const visible = myNotifications.filter(_shouldShowInPanel);

    if(visible.length === 0) {
        list.innerHTML = `<div style="padding:2rem 1rem; text-align:center; color:#94a3b8; font-size:0.85rem;">Sin notificaciones por ahora.</div>`;
        return;
    }

    const timeAgo = (iso) => {
        const diffMs = Date.now() - new Date(iso).getTime();
        const min = Math.round(diffMs / 60000);
        if(min < 1)    return 'ahora';
        if(min < 60)   return `hace ${min} min`;
        const h = Math.round(min / 60);
        if(h < 24)     return `hace ${h} h`;
        const d = Math.round(h / 24);
        if(d < 30)     return `hace ${d} d`;
        return new Date(iso).toLocaleDateString('es-CO', { day:'numeric', month:'short' });
    };

    const renderItem = (n, indented = false) => {
        const isRead    = !!n.read_at;
        const resolved  = !!n.resolved_at;
        const leftColor = resolved ? '#16a34a' : (n.is_urgent ? '#ef4444' : '#3b82f6');
        const bg        = isRead ? '#ffffff' : '#eff6ff';
        const icon      = resolved ? '✅' : (n.is_urgent ? '🔴' : '🔵');
        const marginLeft = indented ? '1.5rem' : '0';
        return `
        <div onclick="markNotificationAsRead('${n.id}')" style="display:flex; gap:0.6rem; padding:0.55rem 0.7rem; border-left:3px solid ${leftColor}; background:${bg}; border-radius:6px; margin:0 0 4px ${marginLeft}; cursor:pointer;">
            <div style="font-size:0.82rem;">${icon}</div>
            <div style="flex:1; min-width:0;">
                <div style="font-size:0.8rem; font-weight:${isRead ? 500 : 700}; color:#0f172a; line-height:1.3;">${n.title || ''}</div>
                ${n.body ? `<div style="font-size:0.7rem; color:#64748b; margin-top:2px; line-height:1.35;">${n.body}</div>` : ''}
                <div style="font-size:0.63rem; color:#94a3b8; margin-top:3px;">${timeAgo(n.created_at)}</div>
            </div>
        </div>`;
    };

    // Agrupar por tipo entre las ACTIVAS no resueltas y no leídas.
    // Solo agrupamos si hay >=2 del mismo tipo activas.
    const activesByType = {};
    const others = [];
    visible.forEach(n => {
        if(!n.read_at && !n.resolved_at) {
            (activesByType[n.type] = activesByType[n.type] || []).push(n);
        } else {
            others.push(n);
        }
    });

    const groupLabels = {
        'nueva_gestion':       { s:'Nueva gestión asignada',      p:'gestiones asignadas' },
        'csat_vencido':        { s:'CSAT te está esperando',      p:'CSAT te están esperando' },
        'lista_facturar':      { s:'Gestión lista para facturar', p:'gestiones listas para facturar' },
        'gestion_ejecutada':   { s:'Gestión ejecutada',           p:'gestiones ejecutadas' },
        'nuevos_detalles':     { s:'Nuevos detalles del servicio', p:'nuevos detalles del servicio' },
        'csat_admin_vencidos': { s:'Lista de CSAT vencidos',      p:'listas de CSAT vencidos' },
        'resumen_mensual':     { s:'Resumen mensual',             p:'resúmenes mensuales' }
    };

    let html = '';
    // Renderiza grupos + individuales activos
    Object.entries(activesByType).forEach(([type, items]) => {
        if(items.length === 1) {
            html += renderItem(items[0]);
            return;
        }
        const isUrgent = items[0].is_urgent;
        const leftColor = isUrgent ? '#ef4444' : '#3b82f6';
        const icon = isUrgent ? '🔴' : '🔵';
        const labels = groupLabels[type] || { s:type, p:type };
        const expanded = _notifGroupExpanded.has(type);
        html += `
            <div onclick="_toggleNotifGroup('${type}')" style="display:flex; align-items:center; gap:0.6rem; padding:0.55rem 0.7rem; border-left:3px solid ${leftColor}; background:#eff6ff; border-radius:6px; margin-bottom:4px; cursor:pointer; font-weight:700;">
                <div style="font-size:0.82rem;">${icon}</div>
                <div style="flex:1; min-width:0; font-size:0.8rem; color:#0f172a;">
                    <span style="background:${leftColor}; color:#fff; padding:1px 8px; border-radius:99px; font-size:0.7rem; margin-right:6px;">${items.length}</span>
                    ${labels.p}
                </div>
                <div style="font-size:0.85rem; color:#64748b;">${expanded ? '▲' : '▼'}</div>
            </div>`;
        if(expanded) {
            items.forEach(n => { html += renderItem(n, true); });
        }
    });

    // Renderiza leídas/resueltas (no agrupadas)
    if(others.length > 0) {
        if(html) html += `<div style="margin-top:0.5rem; padding:0.25rem 0.5rem; font-size:0.62rem; text-transform:uppercase; font-weight:700; color:#94a3b8;">Recientes</div>`;
        others.forEach(n => { html += renderItem(n); });
    }

    list.innerHTML = html;
}

/** Abre o cierra el panel de notificaciones. */
function toggleNotificationsPanel() {
    const panel = document.getElementById('notifPanel');
    if(!panel) return;
    const isOpen = panel.style.display === 'block';
    panel.style.display = isOpen ? 'none' : 'block';
    if(!isOpen) loadMyNotifications(); // refresh al abrir
}

// Cerrar el panel al hacer clic fuera
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notifPanel');
    const wrap  = document.querySelector('.notif-bell-wrap');
    if(!panel || !wrap || panel.style.display !== 'block') return;
    if(!wrap.contains(e.target)) panel.style.display = 'none';
});

// ══════════════════════════════════════════════════════════════════════════════
// FASE 2: Generadores de notificaciones específicas
// ══════════════════════════════════════════════════════════════════════════════

/** Devuelve los user_id (auth.users.id) cuyo profile.analyst_name coincide. */
function getUserIdsByAnalystName(analystName) {
    if(!analystName || !Array.isArray(dbProfiles)) return [];
    const target = analystName.trim().toLowerCase();
    return dbProfiles
        .filter(p => (p.analyst_name || '').trim().toLowerCase() === target)
        .map(p => p.id);
}

/** Devuelve los user_id de todos los usuarios con un rol dado. */
function getUserIdsByRole(role) {
    if(!role || !Array.isArray(dbProfiles)) return [];
    return dbProfiles.filter(p => p.role === role).map(p => p.id);
}

/** Crea una notificación solo si no existe otra activa del mismo tipo y task_id
 *  para ese usuario. Evita duplicados por re-ejecución del mismo evento. */
async function notifyOncePerTaskAndType({ user_id, task_id, type, title, body = '', is_urgent = false, extraData = {} }) {
    if(!supabaseClient || !user_id) return;
    try {
        const filter = task_id ? { task_id } : extraData;
        const { data, error } = await supabaseClient
            .from('notifications')
            .select('id')
            .eq('user_id', user_id)
            .eq('type', type)
            .contains('data', filter)
            .is('resolved_at', null)
            .limit(1);
        if(error) { console.error('Error verificando duplicado:', error); return; }
        if(data && data.length > 0) return; // ya existe una activa
        await createNotification({
            user_id, type, title, body, is_urgent,
            data: task_id ? { task_id, ...extraData } : extraData
        });
    } catch(e) {
        console.error('Excepción en notifyOncePerTaskAndType:', e);
    }
}

const _clientLabelForNotif = (t) => t?.plantName ? `${t.client} · ${t.plantName}` : (t?.client || '—');

/** Notifica a cada analista asignado sobre una nueva gestión. */
async function notifyNewTaskToAnalysts(task) {
    if(!task) return;
    const assignments = task.analysts_assignment || [];
    if(assignments.length === 0) return;
    const label = _clientLabelForNotif(task);
    for(const a of assignments) {
        for(const uid of getUserIdsByAnalystName(a.name)) {
            await notifyOncePerTaskAndType({
                user_id: uid, task_id: task.id, type: 'nueva_gestion',
                title: `Nueva gestión asignada: ${label}`,
                body: `Servicio: ${task.serviceType || '—'} · Mes de gestión: ${task.period || '—'}.`,
                is_urgent: false
            });
        }
    }
}

/** Al pasar a ejecutada: notifica al asistente ("lista para facturar") y a comerciales. */
async function notifyTaskExecuted(task) {
    if(!task) return;
    const label = _clientLabelForNotif(task);
    for(const uid of getUserIdsByRole('assistant')) {
        await notifyOncePerTaskAndType({
            user_id: uid, task_id: task.id, type: 'lista_facturar',
            title: `Lista para facturar: ${label}`,
            body: `Servicio: ${task.serviceType || '—'} · Valor: $${(task.budget || 0).toLocaleString('es-CO')}.`,
            is_urgent: false
        });
    }
    for(const uid of getUserIdsByRole('commercial')) {
        await notifyOncePerTaskAndType({
            user_id: uid, task_id: task.id, type: 'gestion_ejecutada',
            title: `Gestión ejecutada: ${label}`,
            body: `Servicio: ${task.serviceType || '—'}.`,
            is_urgent: false
        });
    }
}

/** Al guardar detalles del servicio: notifica a los comerciales. */
async function notifyServiceDetailsUpdated(task) {
    if(!task || !task.serviceDetails) return;
    const label = _clientLabelForNotif(task);
    const preview = task.serviceDetails.length > 120 ? task.serviceDetails.substring(0, 120) + '…' : task.serviceDetails;
    for(const uid of getUserIdsByRole('commercial')) {
        await notifyOncePerTaskAndType({
            user_id: uid, task_id: task.id, type: 'nuevos_detalles',
            title: `Nuevos detalles: ${label}`,
            body: preview,
            is_urgent: false
        });
    }
}

/** Calcula el resumen del mes indicado (formato YYYY-MM) para el admin. */
function computeMonthlySummary(period) {
    const monthTasks   = tasks.filter(t => (t.mesFacturacion || t.period) === period && !t.isAbsence);
    const absenceTasks = tasks.filter(t => t.isAbsence && (t.scheduledDays || []).some(sd => (sd.date || '').startsWith(period)));
    const executed     = monthTasks.filter(t => t.status === 'ejecutada' || t.status === 'facturada').length;
    const totalBilled  = monthTasks.filter(t => t.status === 'facturada').reduce((s, t) => s + (parseFloat(t.budget) || 0), 0);
    const csatScores   = monthTasks.filter(t => t.csatScore && !t.clientNoResponse).map(t => parseFloat(t.csatScore));
    const avgCsat      = csatScores.length > 0 ? (csatScores.reduce((s, v) => s + v, 0) / csatScores.length).toFixed(2) : '—';
    const absences     = absenceTasks.reduce((s, t) => s + (t.scheduledDays?.length || 0), 0);
    const [y, m]       = period.split('-');
    const monthLabel   = `${monthNames[parseInt(m) - 1] || m} ${y}`;
    return { totalBilled, avgCsat, executed, absences, monthLabel };
}

/** Chequeo al abrir la app: CSAT vencidos (analista), CSAT >15d (admin), resumen mensual. */
async function runNotificationsCheck() {
    if(!supabaseClient || !currentUserProfile || !currentUser?.id) return;
    const role = currentUserProfile.role;

    // Analista → CSAT vencidos suyos (>=7 días)
    if(role === 'analyst' && currentUserProfile.analyst_name) {
        const overdue = typeof getCsatOverdueTasks === 'function'
            ? getCsatOverdueTasks(currentUserProfile.analyst_name) : [];
        for(const t of overdue) {
            await notifyOncePerTaskAndType({
                user_id: currentUser.id, task_id: t.id, type: 'csat_vencido',
                title: `CSAT vencido: ${_clientLabelForNotif(t)}`,
                body: 'Recuerda registrar la encuesta o marcar "cliente no respondió".',
                is_urgent: true
            });
        }
    }

    // Admin → lista de CSAT vencidos hace >=15 días (agrupada por día)
    if(role === 'admin') {
        const today = Date.now();
        const veryOverdue = tasks.filter(t => {
            if(t.isAbsence || t.serviceType === 'Metro Administrativo' || t.serviceType === 'Metro Terceros') return false;
            if(t.status !== 'ejecutada') return false;
            if(t.csatScore || t.clientNoResponse) return false;
            const lastReport = (t.scheduledDays || []).filter(d => d.type === 'report').map(d => d.date).sort().pop();
            if(!lastReport) return false;
            const diff = Math.floor((today - new Date(lastReport).getTime()) / 86400000);
            return diff >= 15;
        });
        if(veryOverdue.length > 0) {
            const todayIso = new Date().toISOString().substring(0, 10);
            const list = veryOverdue.slice(0, 5).map(t => _clientLabelForNotif(t)).join(', ');
            const suffix = veryOverdue.length > 5 ? `, y ${veryOverdue.length - 5} más.` : '.';
            await notifyOncePerTaskAndType({
                user_id: currentUser.id, task_id: null, type: 'csat_admin_vencidos',
                title: `${veryOverdue.length} CSAT vencidos hace más de 15 días`,
                body: list + suffix,
                is_urgent: true,
                extraData: { day: todayIso, count: veryOverdue.length }
            });
        }

        // Resumen mensual: solo el día 1 de cada mes
        const now = new Date();
        if(now.getDate() === 1) {
            const prevMonth  = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
            const prevYear   = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
            const prevPeriod = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}`;
            const summary    = computeMonthlySummary(prevPeriod);
            await notifyOncePerTaskAndType({
                user_id: currentUser.id, task_id: null, type: 'resumen_mensual',
                title: `Resumen de ${summary.monthLabel}`,
                body: `Facturado: $${summary.totalBilled.toLocaleString('es-CO')} · CSAT promedio: ${summary.avgCsat} · ${summary.executed} gestiones ejecutadas · ${summary.absences} días de ausencia.`,
                is_urgent: false,
                extraData: { period: prevPeriod }
            });
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// FASE 3 + 4: Historial, agrupación, auto-cierre y retenciones
// ══════════════════════════════════════════════════════════════════════════════

let notifHistoryCache = [];

/** Borra por completo las notificaciones de un tipo asociadas a un task_id
 *  (para todos los usuarios). Se usa cuando la notif deja de ser relevante y
 *  no aporta valor histórico (ej. gestión que se devuelve a proyectada). */
async function deleteNotifsForTask({ task_id, type }) {
    if(!supabaseClient || !task_id || !type) return;
    try {
        const { error } = await supabaseClient
            .from('notifications')
            .delete()
            .eq('type', type)
            .contains('data', { task_id });
        if(error) { console.error('Error borrando notifs:', error); return; }
        // Reflejar en cache local
        myNotifications = myNotifications.filter(n => !(n.type === type && n.data?.task_id === task_id));
        updateNotificationBadge();
        renderNotificationsPanel();
    } catch(e) {
        console.error('Excepción borrando notifs:', e);
    }
}

/** Marca como resueltas todas las notificaciones activas de un tipo asociadas a
 *  un task_id (para cualquier usuario). Útil para auto-cierre. */
async function resolveNotifsForTask({ task_id, type }) {
    if(!supabaseClient || !task_id || !type) return;
    try {
        const nowIso = new Date().toISOString();
        const { error } = await supabaseClient
            .from('notifications')
            .update({ resolved_at: nowIso, read_at: nowIso })
            .eq('type', type)
            .contains('data', { task_id })
            .is('resolved_at', null);
        if(error) { console.error('Error resolviendo notifs:', error); return; }
        // Reflejar en cache local
        myNotifications.forEach(n => {
            if(n.type === type && n.data?.task_id === task_id && !n.resolved_at) {
                n.resolved_at = nowIso;
                n.read_at = nowIso;
            }
        });
        updateNotificationBadge();
        renderNotificationsPanel();
    } catch(e) {
        console.error('Excepción resolviendo notifs:', e);
    }
}

/** Reglas de retención para el panel principal (las viejas no aparecen ahí). */
function _shouldShowInPanel(n) {
    const now = Date.now();
    if(!n.read_at && !n.resolved_at) return true; // no leídas siempre
    if(n.resolved_at) {
        const d = Math.floor((now - new Date(n.resolved_at).getTime()) / 86400000);
        return d < 15;
    }
    if(n.read_at) {
        const d = Math.floor((now - new Date(n.read_at).getTime()) / 86400000);
        return d < 30;
    }
    return true;
}

/** Abre el modal del historial completo. Carga hasta 500 notifs históricas. */
async function openNotificationsHistory() {
    document.getElementById('notifPanel').style.display = 'none';
    const modal = document.getElementById('notifHistoryModal');
    if(!modal) return;
    modal.classList.add('active');
    document.getElementById('notifHistoryList').innerHTML = '<div style="text-align:center; padding:2rem; color:#94a3b8;">Cargando…</div>';
    if(!supabaseClient || !currentUser?.id) return;
    try {
        const { data, error } = await supabaseClient
            .from('notifications')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(500);
        if(error) { console.error('Error cargando historial:', error); return; }
        notifHistoryCache = data || [];
        renderNotificationsHistory();
    } catch(e) {
        console.error('Excepción cargando historial:', e);
    }
}

function clearNotifHistoryFilters() {
    ['notifHistFilterType','notifHistFilterState','notifHistFilterFrom','notifHistFilterTo','notifHistFilterQ']
        .forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    renderNotificationsHistory();
}

function renderNotificationsHistory() {
    const list = document.getElementById('notifHistoryList');
    const countEl = document.getElementById('notifHistoryCount');
    if(!list) return;

    const type  = document.getElementById('notifHistFilterType')?.value  || '';
    const state = document.getElementById('notifHistFilterState')?.value || '';
    const from  = document.getElementById('notifHistFilterFrom')?.value  || '';
    const to    = document.getElementById('notifHistFilterTo')?.value    || '';
    const q     = (document.getElementById('notifHistFilterQ')?.value || '').trim().toLowerCase();

    let data = notifHistoryCache.slice();
    if(type)  data = data.filter(n => n.type === type);
    if(state === 'unread')   data = data.filter(n => !n.read_at && !n.resolved_at);
    if(state === 'read')     data = data.filter(n => n.read_at && !n.resolved_at);
    if(state === 'resolved') data = data.filter(n => n.resolved_at);
    if(from) data = data.filter(n => (n.created_at || '') >= from);
    if(to)   data = data.filter(n => (n.created_at || '').substring(0,10) <= to);
    if(q)    data = data.filter(n => `${n.title||''} ${n.body||''}`.toLowerCase().includes(q));

    if(countEl) countEl.textContent = `${data.length} ${data.length === 1 ? 'notificación' : 'notificaciones'}`;

    if(data.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:2rem; color:#94a3b8; font-size:0.85rem;">Sin resultados con los filtros aplicados.</div>';
        return;
    }

    list.innerHTML = `
        <table class="data-table" style="font-size:0.78rem; width:100%;">
            <thead>
                <tr>
                    <th style="width:22px;"></th>
                    <th>Título</th>
                    <th style="min-width:110px;">Tipo</th>
                    <th style="min-width:80px;">Estado</th>
                    <th style="min-width:130px;">Fecha</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(n => {
                    const resolved = !!n.resolved_at;
                    const read     = !!n.read_at;
                    const stateLbl = resolved ? '✅ Resuelta' : (read ? 'Leída' : (n.is_urgent ? '🔴 Urgente' : '🔵 Nueva'));
                    const created  = new Date(n.created_at).toLocaleString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
                    const bg       = read || resolved ? '#fff' : '#eff6ff';
                    return `<tr style="background:${bg};">
                        <td>${resolved ? '✅' : (n.is_urgent ? '🔴' : '🔵')}</td>
                        <td>
                            <div style="font-weight:${read || resolved ? 500 : 700}; color:#0f172a;">${n.title || ''}</div>
                            ${n.body ? `<div style="font-size:0.7rem; color:#64748b; margin-top:2px; line-height:1.35;">${n.body}</div>` : ''}
                        </td>
                        <td style="color:#64748b;">${n.type}</td>
                        <td>${stateLbl}</td>
                        <td style="color:#64748b;">${created}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
}

function updateCsatBadge() {
    const badge = document.getElementById('csat-badge');
    if(!badge) return;
    const analystName = currentUserProfile?.analyst_name;
    const overdue = getCsatOverdueTasks(analystName);
    if(overdue.length > 0) {
        badge.textContent = overdue.length;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
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

    // ── Banner de CSAT vencido ───────────────────────────────────────────────
    const overdueCsat = getCsatOverdueTasks(analystName);
    let csatBannerHtml = '';
    if(overdueCsat.length > 0) {
        const items = overdueCsat.map(t => {
            const lbl = t.plantName ? `${t.client} · ${t.plantName}` : t.client;
            const lastReport = (t.scheduledDays||[]).filter(d=>d.type==='report').map(d=>d.date).sort().pop();
            const diff = lastReport ? Math.floor((Date.now()-new Date(lastReport).getTime())/86400000) : '?';
            return `<span onclick="analystOpenCsat('${t.id}')" style="cursor:pointer;text-decoration:underline;font-weight:700;">${lbl}</span> <span style="font-size:0.72rem;opacity:.8;">(${diff} días)</span>`;
        }).join(' &nbsp;·&nbsp; ');
        csatBannerHtml = `
            <div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;
                        border-radius:10px;padding:0.75rem 1rem;margin-bottom:1.25rem;
                        display:flex;align-items:flex-start;gap:0.75rem;">
                <span style="font-size:1.2rem;flex-shrink:0;">⚠️</span>
                <div>
                    <div style="font-weight:700;font-size:0.85rem;color:#92400e;margin-bottom:0.25rem;">
                        Encuesta CSAT pendiente — ${overdueCsat.length} gestión(es) llevan más de 7 días sin cierre
                    </div>
                    <div style="font-size:0.8rem;color:#78350f;">${items}</div>
                </div>
            </div>`;
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

    container.innerHTML = csatBannerHtml + `
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
    // El cierre CSAT puede hacerse antes o después de facturar
    const closable     = task.status === 'ejecutada' || task.status === 'facturada';
    const canCsat      = closable && !task.csatScore && !task.clientNoResponse;
    const csatDone     = closable && (task.csatScore || task.clientNoResponse);

    return `
        <div class="mywork-card status-${task.status}">
            <div class="mywork-card-top">
                <div class="mywork-card-info" onclick="openTaskInfoModal('${task.id}')" style="cursor:pointer;" title="Ver detalle">
                    <h3 class="mywork-card-client">${task.client || task.clientName || '—'}</h3>
                    ${task.plantName ? `<p class="mywork-card-plant">📍 ${task.plantName}</p>` : ''}
                    <p class="mywork-card-service">${task.serviceType || '—'}</p>
                    ${task.equipment || task.equipmentName
                        ? `<p class="mywork-card-equip">${task.equipment || task.equipmentName}</p>` : ''}
                </div>
                <button class="mywork-eye-btn ${task.serviceDetails ? 'has-details' : ''}"
                        onclick="event.stopPropagation(); openServiceDetailsModal('${task.id}')"
                        title="${task.serviceDetails ? 'Editar detalles para el comercial' : 'Agregar detalles del servicio para el comercial'}">
                    👁️
                </button>
            </div>

            <div class="mywork-card-dates">
                ${fieldStr  ? `<div class="mywork-date-row">🔧 Campo: <strong>${fieldStr}</strong></div>` : ''}
                ${reportStr ? `<div class="mywork-date-row">📝 Informe: <strong>${reportStr}</strong></div>` : ''}
                ${!fieldStr && !reportStr ? `<div class="mywork-date-row mywork-no-date">Sin días programados aún</div>` : ''}
                <div class="mywork-badges">
                    ${isTitular   ? '<span class="mywork-badge titular">Campo</span>'        : ''}
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

/** Admin: reabre el CSAT de una gestión para que el analista pueda volver a llenarlo. */
async function reopenCsat(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;
    const ok = confirm(
        '¿Reabrir el CSAT de esta gestión?\n\n' +
        'Se borrará la calificación y la marca de "cliente no respondió" para que el analista pueda registrarlo de nuevo.\n' +
        'Las observaciones y archivos de evidencia se conservan.'
    );
    if(!ok) return;

    task.csatScore        = null;
    task.clientNoResponse = false;

    saveTasks();
    await saveTaskToSupabase(task);

    renderTasksView();
    if(typeof renderMyWorkView === 'function') renderMyWorkView();
    renderDashboardStats();
    showToast('CSAT reabierto. El analista ya puede registrarlo de nuevo.', 'success');
}

// ── Detalles del servicio para el comercial ──────────────────────────────────
let _serviceDetailsTaskId = null;
let _serviceDictation = null; // instancia de SpeechRecognition

function openServiceDetailsModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;
    _serviceDetailsTaskId = taskId;

    const role = currentUserProfile?.role || 'viewer';
    const editable = (role === 'analyst' || role === 'admin');

    const input   = document.getElementById('serviceDetailsInput');
    const actions = document.getElementById('serviceDetailsActions');
    const micBtn  = document.getElementById('serviceDetailsMicBtn');
    const title   = document.getElementById('serviceDetailsTitle');

    input.value = task.serviceDetails || '';
    input.readOnly = !editable;
    title.textContent = editable ? '📝 Detalles del Servicio' : '📝 Detalles del Servicio (solo lectura)';

    // Botones de guardar/cancelar solo si puede editar
    actions.style.display = editable ? 'flex' : 'none';

    // Micrófono: solo si puede editar y el navegador soporta reconocimiento de voz
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    micBtn.style.display = (editable && SpeechRec) ? 'block' : 'none';
    _stopServiceDictation();

    document.getElementById('serviceDetailsModal').classList.add('active');
}

async function saveServiceDetails() {
    const task = tasks.find(t => t.id === _serviceDetailsTaskId);
    if(!task) return;
    _stopServiceDictation();
    task.serviceDetails = document.getElementById('serviceDetailsInput').value.trim();

    saveTasks();
    closeModal('serviceDetailsModal');
    if(typeof renderMyWorkView === 'function') renderMyWorkView();
    renderTasksView();
    await saveTaskToSupabase(task);
    // Notif: nuevos detalles del servicio → a los comerciales
    notifyServiceDetailsUpdated(task).catch(() => {});
    showToast('Detalles del servicio guardados.', 'success');
}

function toggleServiceDetailsDictation() {
    if(_serviceDictation) { _stopServiceDictation(); return; }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SpeechRec) return;

    const rec = new SpeechRec();
    rec.lang = 'es-CO';
    rec.continuous = true;
    rec.interimResults = false;

    const input = document.getElementById('serviceDetailsInput');
    const micBtn = document.getElementById('serviceDetailsMicBtn');
    const hint = document.getElementById('serviceDetailsMicHint');

    rec.onresult = (e) => {
        let nuevo = '';
        for(let i = e.resultIndex; i < e.results.length; i++) {
            if(e.results[i].isFinal) nuevo += e.results[i][0].transcript;
        }
        if(nuevo) {
            const sep = input.value && !input.value.endsWith(' ') ? ' ' : '';
            input.value += sep + nuevo.trim();
        }
    };
    rec.onerror = () => _stopServiceDictation();
    rec.onend = () => { if(_serviceDictation) { try { rec.start(); } catch(_) {} } };

    _serviceDictation = rec;
    try { rec.start(); } catch(_) {}
    if(micBtn) { micBtn.style.background = '#fee2e2'; micBtn.style.borderColor = '#fca5a5'; micBtn.style.color = '#dc2626'; micBtn.textContent = '⏹'; }
    if(hint) hint.style.display = 'block';
}

function _stopServiceDictation() {
    const micBtn = document.getElementById('serviceDetailsMicBtn');
    const hint = document.getElementById('serviceDetailsMicHint');
    if(_serviceDictation) {
        const rec = _serviceDictation;
        _serviceDictation = null; // evita reinicio en onend
        try { rec.stop(); } catch(_) {}
    }
    if(micBtn) { micBtn.style.background = '#eff6ff'; micBtn.style.borderColor = '#bae6fd'; micBtn.style.color = '#0369a1'; micBtn.textContent = '🎤'; }
    if(hint) hint.style.display = 'none';
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

    const roleOptions = ['admin','analyst','assistant','commercial','viewer'];

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
    plant:  `<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    reopen: `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
    note:   `<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
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

/** Nombre base de la empresa a partir de "Empresa - Planta" (o solo "Empresa").
 *  Sirve para comparar clientes en filtros sin que la planta arruine el match. */
function getClientCompanyBase(str) {
    if (!str) return '';
    return String(str).split(' - ')[0].trim().toLowerCase();
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
    // Una gestión (incluidas las proyectadas) pertenece al mes que el usuario eligió en
    // "Mes de Gestión" (t.period), independiente de en qué meses caigan los días del
    // cronograma. Esto permite planear gestiones para meses futuros sin que aparezcan
    // contaminando el backlog del mes actual.
    return (t.period || currentPeriod) === currentPeriod;
}

/** Período de facturación de una gestión (mes en que se factura, no en que se ejecuta). */
function getTaskBillingPeriod(t) {
    return t.mesFacturacion || t.period || '';
}

let dashboardFilters = {
    analyst: '',
    client: '',
    status: ''
};
let dashboardScope = 'month'; // 'month', 'year', 'all'
let workloadChartInstance = null;
let billingChartInstance = null;
let serviceChartInstance = null;

/** Paleta sobria para tipos de servicio (consistente entre renders). */
const SERVICE_TYPE_COLORS = {
    'Vibraciones':           '#5B8DEF',
    'Balanceo':              '#7C66C9',
    'Alineación':            '#3FA68A',
    'Termografía':           '#E78A47',
    'Ultrasonido':           '#5BB0C9',
    'Rotodinámico':          '#6B7280',
    'Capacitación':          '#D4A24C',
    'Metro Administrativo':  '#9CA3AF',
    'Metro Terceros':        '#8B7BA8'
};
function getServiceColor(name) {
    return SERVICE_TYPE_COLORS[name] || '#94A3B8';
}

/** Opciones base para los doughnut del dashboard (estilo moderno con bordes). */
function _doughnutBaseOptions(tooltipFormatter) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        layout: { padding: 4 },
        plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 12, usePointStyle: true, pointStyle: 'circle' } },
            tooltip: {
                backgroundColor: '#0f172a',
                titleFont: { size: 12, weight: 'bold' },
                bodyFont:  { size: 12 },
                padding: 10,
                cornerRadius: 8,
                displayColors: true,
                callbacks: { label: tooltipFormatter }
            }
        }
    };
}

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
let tasks = JSON.parse(localStorage.getItem('cbm_tasks')) || [];

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

let tasksSortState = { column: null, dir: 'asc' };

function sortTasksBy(column) {
    if (tasksSortState.column === column) {
        tasksSortState.dir = tasksSortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        tasksSortState.column = column;
        tasksSortState.dir = 'asc';
    }
    renderTasksView();
}

function renderTasksTable(container) {
    const role = currentUserProfile?.role || 'admin';
    let filteredTasks = tasks.slice().filter(t => !t.isAbsence && isTaskInCurrentPeriod(t));

    if(dashboardFilters.analyst) filteredTasks = filteredTasks.filter(t => t.analyst === dashboardFilters.analyst);
    if(dashboardFilters.client) { const _base = getClientCompanyBase(dashboardFilters.client); filteredTasks = filteredTasks.filter(t => getClientCompanyBase(t.client) === _base); }
    if(dashboardFilters.status) filteredTasks = filteredTasks.filter(t => t.status === dashboardFilters.status);

    // Asistente: ve ejecutadas (para facturar) + facturadas (historial + Metro Administrativo)
    if (role === 'assistant') {
        filteredTasks = filteredTasks.filter(t =>
            t.status === 'ejecutada' || t.status === 'facturada'
        );
    }

    // Ordenamiento por columna
    if (tasksSortState.column) {
        const statusOrder = { proyectada: 0, programada: 1, ejecutada: 2, facturada: 3 };
        const getVal = (t) => {
            switch (tasksSortState.column) {
                case 'client':  return (t.client || '').toLowerCase();
                case 'type':    return (t.serviceType || '').toLowerCase();
                case 'budget':  return t.budget || 0;
                case 'analyst': return (formatAnalystDisplay(t) || '').toLowerCase();
                case 'status':  return statusOrder[t.status] ?? 99;
                default:        return '';
            }
        };
        const dir = tasksSortState.dir === 'asc' ? 1 : -1;
        filteredTasks.sort((a, b) => {
            const va = getVal(a), vb = getVal(b);
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va).localeCompare(String(vb), 'es') * dir;
        });
    }

    const sortArrow = (col) => {
        if (tasksSortState.column !== col) return '<span style="opacity:0.3;">↕</span>';
        return tasksSortState.dir === 'asc' ? '↑' : '↓';
    };
    const thSort = (col, label, extraStyle = '') =>
        `<th onclick="sortTasksBy('${col}')" style="cursor:pointer; user-select:none; ${extraStyle}">${label} <span style="font-size:0.75em;">${sortArrow(col)}</span></th>`;

    container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    ${thSort('client',  'Gestión / Cliente')}
                    ${thSort('type',    'Tipo')}
                    ${thSort('budget',  'Presupuesto')}
                    ${thSort('analyst', 'Analista')}
                    ${thSort('status',  'Estado', 'width: 15rem;')}
                    <th style="width: 8rem;">Acción</th>
                </tr>
            </thead>
            <tbody>
                ${filteredTasks.length === 0 ? '<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-secondary)">No hay gestiones para este periodo o filtros</td></tr>' : 
                filteredTasks.map(t => {
                    const statusOptions = ['proyectada', 'programada', 'ejecutada', 'facturada'];
                    const isFacturada = t.status === 'facturada';
                    const isEjecutada = t.status === 'ejecutada';

                    // Abreviación del mes de facturación + color según relación con period
                    const billPeriod = t.mesFacturacion || t.period || '';
                    let billBadge = '';
                    if (billPeriod) {
                        const m = parseInt(billPeriod.split('-')[1]);
                        const abbr = monthNames[m-1]?.substring(0,3) || '';
                        let color = '#94a3b8'; // gris: mismo mes que la gestión
                        if (billPeriod > (t.period || '')) color = '#ea580c';     // naranja: futuro
                        else if (billPeriod < (t.period || '')) color = '#dc2626'; // rojo: anterior (raro)
                        billBadge = ` <span style="font-size:0.65rem; font-weight:600; color:${color};">(${abbr})</span>`;
                    }

                    return `
                    <tr data-task-id="${t.id}">
                        <td>
                            <strong>${t.client}</strong>${billBadge}
                            ${t.plantName ? `<div style="font-size:0.7rem; color:var(--clr-blue); font-weight:600; margin-top:2px;">📍 ${t.plantName}</div>` : ''}
                        </td>
                        <td><span class="card-analyst" style="font-size:0.75rem">${t.serviceType || '-'}</span></td>
                        <td style="color:var(--clr-green); font-weight:600">$${(t.budget || 0).toLocaleString('es-CO')}</td>
                        <td>${formatAnalystDisplay(t)}</td>
                        <td>
                            ${role === 'commercial' ? `
                                <span style="padding: 0.4rem 0.6rem; font-size: 0.85rem; border-radius: 6px; background:#f1f5f9; font-weight: 600; display:inline-block;">${t.status.toUpperCase()}</span>
                            ` : `
                            <select onchange="updateTaskStatus('${t.id}', this.value)" style="padding: 0.4rem; font-size: 0.85rem; border-radius: 6px; border: 1px solid #cbd5e1; width: 100%; font-weight: 500;" ${isFacturada ? 'disabled' : ''}>
                                ${statusOptions.map(opt => {
                                    let optDisabled = false;
                                    if(isEjecutada && (opt === 'proyectada' || opt === 'programada')) optDisabled = true;
                                    if(t.status === 'proyectada' && opt === 'programada') optDisabled = true;
                                    return `<option value="${opt}" ${t.status === opt ? 'selected' : ''} ${optDisabled ? 'disabled' : ''}>${opt.toUpperCase()}</option>`;
                                }).join('')}
                            </select>
                            `}
                        </td>
                        <td>
                            <div class="action-icons">
                                ${role === 'admin' ? `
                                    ${actionIcon('edit',   `openEditTaskModal('${t.id}')`,       'Editar')}
                                    ${actionIcon('csat',   `openClosingMeetingModal('${t.id}')`, 'Reunión de Cierre')}
                                    ${actionIcon('note',   `openServiceDetailsModal('${t.id}')`, t.serviceDetails ? 'Ver detalles del servicio (comercial)' : 'Agregar detalles del servicio (comercial)')}
                                    ${(t.csatScore || t.clientNoResponse) ? actionIcon('reopen', `reopenCsat('${t.id}')`, 'Reabrir CSAT (para que el analista lo llene de nuevo)') : ''}
                                    ${t.status === 'programada' ? actionIcon('revert', `revertToProjected('${t.id}')`, 'Revertir a Proyectada') : ''}
                                    ${actionIcon('delete', `deleteTask('${t.id}')`,              'Borrar')}
                                ` : role === 'commercial' ? `
                                    ${t.serviceDetails
                                        ? actionIcon('note', `openServiceDetailsModal('${t.id}')`, 'Ver detalles del servicio')
                                        : '<span style="font-size:0.72rem; color:var(--text-secondary);">Sin detalles</span>'}
                                ` : role === 'assistant' ? `
                                    <div style="display:flex;gap:0.3rem;align-items:center;">
                                        ${t.status === 'ejecutada' ? `
                                            <button class="mywork-btn btn-execute" style="font-size:0.68rem;padding:0.25rem 0.5rem;white-space:nowrap;"
                                                onclick="updateTaskStatus('${t.id}','facturada')">
                                                💰 Facturar
                                            </button>` : `
                                            <span style="font-size:0.68rem;color:var(--clr-green);font-weight:600;white-space:nowrap;">✓ Facturada</span>`}
                                        <button class="mywork-btn" style="font-size:0.68rem;padding:0.25rem 0.5rem;background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;border-radius:6px;cursor:pointer;white-space:nowrap;"
                                            onclick="openEditBudgetModal('${t.id}')">
                                            ✏️ Editar valor
                                        </button>
                                    </div>
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
    // Notif: al pasar a programada por primera vez → notificar a los analistas
    if(oldStatus !== 'programada' && newStatus === 'programada') {
        notifyNewTaskToAnalysts(task).catch(() => {});
    }
    // Auto-borrado: si se devuelve a proyectada, la notif de "Nueva gestión" ya no aplica
    if(oldStatus === 'programada' && newStatus === 'proyectada') {
        deleteNotifsForTask({ task_id: taskId, type: 'nueva_gestion' }).catch(() => {});
    }
    // Notif: al pasar a ejecutada por primera vez
    if(oldStatus !== 'ejecutada' && newStatus === 'ejecutada') {
        notifyTaskExecuted(task).catch(() => {});
    }
    // Auto-cierre: al facturar, cierra "lista para facturar" y "gestión ejecutada"
    if(newStatus === 'facturada' && oldStatus !== 'facturada') {
        resolveNotifsForTask({ task_id: taskId, type: 'lista_facturar' }).catch(() => {});
        resolveNotifsForTask({ task_id: taskId, type: 'gestion_ejecutada' }).catch(() => {});
    }
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

// ── Editar valor real de facturación (rol asistente) ──────────────────────────
let _editBudgetTaskId = null;

function openEditBudgetModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    _editBudgetTaskId = taskId;
    const input = document.getElementById('editBudgetInput');
    input.value = task.budget || '';
    updateBudgetPreview();
    document.getElementById('editBudgetModal').classList.add('active');
}

function updateBudgetPreview() {
    const val = parseFloat(document.getElementById('editBudgetInput').value);
    const preview = document.getElementById('editBudgetPreview');
    preview.textContent = isNaN(val) || val === 0 ? '' : `$ ${val.toLocaleString('es-CO')}`;
}

async function saveEditedBudget() {
    const task = tasks.find(t => t.id === _editBudgetTaskId);
    if (!task) return;
    const val = parseFloat(document.getElementById('editBudgetInput').value);
    if (isNaN(val) || val < 0) { alert('Ingresa un valor válido.'); return; }
    task.budget = val;
    saveTasks();
    closeModal('editBudgetModal');
    renderBoard();
    renderDashboardStats();
    if (typeof renderFinanceView === 'function') renderFinanceView();
    await saveTaskToSupabase(task);
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
        // Gestiones: se imputan al mes de FACTURACIÓN (no al de ejecución).
        gestionesFiltradas = gestionesFiltradas.filter(t => {
            if (t.status === 'proyectada') return t.period === periodKey;
            return getTaskBillingPeriod(t) === periodKey;
        });
        ausenciasFiltradas = ausenciasFiltradas.filter(t => t.scheduledDays && t.scheduledDays.some(sd => (sd.date ? sd.date.substring(0, 7) : t.period) === periodKey));
    } else if (dashboardScope === 'year') {
        const yearStr = currentYear.toString();
        gestionesFiltradas = gestionesFiltradas.filter(t => {
            if (t.status === 'proyectada') return true;
            return getTaskBillingPeriod(t).startsWith(yearStr);
        });
        ausenciasFiltradas = ausenciasFiltradas.filter(t => t.scheduledDays && t.scheduledDays.some(sd => (sd.date ? sd.date.substring(0, 4) : t.period.substring(0,4)) === yearStr));
    }
    // Si es 'all', no aplicamos filtro de tiempo adicional

    if(dashboardFilters.analyst) {
        gestionesFiltradas = gestionesFiltradas.filter(t => {
            if(t.analysts_assignment && t.analysts_assignment.length > 0)
                return t.analysts_assignment.some(a => a.name === dashboardFilters.analyst);
            return t.analyst === dashboardFilters.analyst;
        });
        ausenciasFiltradas = ausenciasFiltradas.filter(t => t.analyst === dashboardFilters.analyst);
    }

    if(dashboardFilters.client) {
        const _base = getClientCompanyBase(dashboardFilters.client);
        gestionesFiltradas = gestionesFiltradas.filter(t => getClientCompanyBase(t.client) === _base);
    }

    const totalGestiones = gestionesFiltradas.length;
    const informesRealizados = gestionesFiltradas.filter(t => t.status === 'ejecutada' || t.status === 'facturada').length;
    
    // Cálculo por analista — itera analysts_assignment para distribuir correctamente
    const analystStats = {};
    gestionesFiltradas.forEach(t => {
        if(t.serviceType === 'Metro Administrativo' || t.serviceType === 'Metro Terceros') return;

        const assignments = t.analysts_assignment && t.analysts_assignment.length > 0
            ? t.analysts_assignment
            : (t.analyst ? [{ name: t.analyst }] : []);

        assignments.forEach(a => {
            if(!a.name) return;
            if(!analystStats[a.name]) analystStats[a.name] = { closed: 0, total: 0, csat: 0, csatCount: 0 };
            analystStats[a.name].total++;
            if(t.status === 'facturada' || t.status === 'ejecutada') analystStats[a.name].closed++;
            if(t.csatScore && !t.clientNoResponse) {
                analystStats[a.name].csat += parseFloat(t.csatScore);
                analystStats[a.name].csatCount++;
            }
        });
    });

    const absenceByAnalyst = {};
    ausenciasFiltradas.forEach(t => {
        if(!absenceByAnalyst[t.analyst]) absenceByAnalyst[t.analyst] = { count: 0, byType: {} };
        const days = t.scheduledDays ? t.scheduledDays.length : 0;
        absenceByAnalyst[t.analyst].count += days;
        const type = t.serviceType || 'Otra';
        absenceByAnalyst[t.analyst].byType[type] = (absenceByAnalyst[t.analyst].byType[type] || 0) + days;
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
                            ${Object.entries(absenceByAnalyst).map(([name, data]) => {
                                const typeIcons = { 'Vacaciones':'🌴', 'Incapacidad':'💊', 'Compensatorio':'🔄', 'Entrenamiento o Curso':'🎓', 'Otra':'•' };
                                const typeChips = Object.entries(data.byType)
                                    .sort((a,b) => b[1]-a[1])
                                    .map(([type, days]) => `<span style="font-size:0.7rem; color:var(--text-secondary); background:#ffffffcc; padding:0.1rem 0.45rem; border-radius:999px; white-space:nowrap;">${typeIcons[type] || '•'} ${type.replace('Entrenamiento o Curso','Entrenamiento')}: <strong>${days}</strong></span>`)
                                    .join('');
                                return `
                                <div class="absence-tag" onclick="openAbsenceDetailModal('${name.replace(/'/g, "\\'")}')" style="background:var(--clr-pink-light); padding:0.5rem 1rem; border-radius:var(--radius-md); border-left:3px solid var(--clr-pink);">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                        <span style="font-weight:700; font-size:0.8rem">${name}</span>
                                        <span style="color:var(--clr-pink); font-weight:800">${data.count} días</span>
                                    </div>
                                    <div style="display:flex; flex-wrap:wrap; gap:0.3rem; margin-top:0.4rem;">${typeChips}</div>
                                </div>`;
                            }).join('')}
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

    // Badge de calidad (semáforo): da la señal de alerta sin perder la identidad de color del analista
    const qualityBadge = avg => {
        if(avg === null) return { label: 'Sin calificar', bg: '#f1f5f9', color: '#64748b' };
        if(avg >= 4.5)   return { label: 'Excelente',     bg: '#dcfce7', color: '#15803d' };
        if(avg >= 4)     return { label: 'Muy bueno',     bg: '#dbeafe', color: '#1d4ed8' };
        if(avg >= 3)     return { label: 'Aceptable',     bg: '#fef3c7', color: '#a16207' };
        return                 { label: 'Bajo',           bg: '#fee2e2', color: '#b91c1c' };
    };

    // Estrellitas (5 niveles): rellenas hasta el score (medias incluidas)
    const starsHTML = (avg, color) => {
        const filled = avg !== null ? Math.round(avg) : 0;
        let out = '';
        for(let i = 1; i <= 5; i++) {
            const c = i <= filled ? color : '#e2e8f0';
            out += `<span style="color:${c}; font-size:0.7rem; line-height:1;">★</span>`;
        }
        return out;
    };

    section.innerHTML = `
        <div class="stats-card" style="padding:1.25rem;">
            <h3 style="margin:0 0 0.25rem; font-size:1rem;">Calificación CSAT por Analista</h3>
            <p style="font-size:0.75rem; color:var(--text-secondary); margin:0 0 1.25rem;">
                Promedio de gestiones calificadas. Excluye casos sin respuesta del cliente.
            </p>
            <div class="gauges-grid">
                ${entries.map(e => {
                    const color = getAnalystColor(e.name);
                    const badge = qualityBadge(e.avg);
                    const initial = (e.name[0] || '?').toUpperCase();
                    return `
                    <div class="gauge-card" style="border-top:3px solid ${color}; background:#fff; border-radius:12px; padding:0.55rem 0.5rem 0.65rem; box-shadow:0 1px 3px rgba(0,0,0,0.04); position:relative;">
                        <div class="gauge-avatar" style="position:absolute; top:-14px; left:50%; transform:translateX(-50%); width:28px; height:28px; border-radius:50%; background:${color}; color:#fff; font-weight:800; font-size:0.8rem; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,0.15);">${initial}</div>
                        <div class="gauge-card-canvas-wrap"><canvas id="gauge-${e.name.replace(/\s+/g,'_')}"></canvas></div>
                        <div class="gauge-value" style="color:${color};">
                            ${e.avg !== null ? e.avg.toFixed(1) : '—'}
                            <span class="gauge-max">/5</span>
                        </div>
                        <div class="gauge-stars" style="display:flex; justify-content:center; gap:1px; margin:2px 0 4px;">${starsHTML(e.avg, color)}</div>
                        <div class="gauge-name">${e.name}</div>
                        <div class="gauge-sub">${e.count} calificación${e.count !== 1 ? 'es' : ''} · ${e.total} gestión${e.total !== 1 ? 'es' : ''}</div>
                        <div style="margin-top:6px; display:flex; justify-content:center;">
                            <span style="background:${badge.bg}; color:${badge.color}; font-size:0.62rem; font-weight:700; padding:2px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:0.03em;">${badge.label}</span>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;

    // Destruir instancias previas
    Object.values(_gaugeInstances).forEach(c => c.destroy());
    _gaugeInstances = {};

    // Crear gauge por analista — arco del color del analista, track gris suave, bordes redondeados
    entries.forEach(e => {
        const canvasId = `gauge-${e.name.replace(/\s+/g,'_')}`;
        const ctx = document.getElementById(canvasId);
        if(!ctx) return;

        const score = e.avg !== null ? e.avg : 0;
        const remaining = 5 - score;
        const arcColor  = e.avg !== null ? getAnalystColor(e.name) : '#cbd5e1';

        _gaugeInstances[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [score, remaining],
                    backgroundColor: [arcColor, '#eef2f7'],
                    borderWidth: 0,
                    borderRadius: 6,
                    spacing: 1
                }]
            },
            options: {
                rotation: -90,
                circumference: 180,
                cutout: '68%',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        padding: 8,
                        cornerRadius: 6,
                        displayColors: false,
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
            return getTaskBillingPeriod(t) === periodKey;
        });
    } else if (dashboardScope === 'year') {
        const yearStr = currentYear.toString();
        chartData = chartData.filter(t => {
            if (t.status === 'proyectada') return true;
            return getTaskBillingPeriod(t).startsWith(yearStr);
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
        const _base = getClientCompanyBase(dashboardFilters.client);
        chartData = chartData.filter(t => getClientCompanyBase(t.client) === _base);
    }
    if (dashboardFilters.status) {
        chartData = chartData.filter(t => t.status === dashboardFilters.status);
    }

    const workloadMap = {};
    const billingMap = {};
    const serviceMap = {};

    // 3. Distribuir gestiones compartidas por porcentaje de participación
    chartData.forEach(t => {
        const budget = parseFloat(t.budget) || 0;
        const isAdminContract = (t.serviceType === 'Metro Administrativo');

        if (isAdminContract) {
            // No suma a carga de trabajo; sí suma a facturación bajo "Administrativo"
            if (t.status === 'facturada') {
                billingMap['Administrativo'] = (billingMap['Administrativo'] || 0) + budget;
            }
            // Tampoco se cuenta en distribución por servicio (es contrato, no gestión CBM)
            return;
        }

        // Distribución por servicio: pondera por monto facturable + cuenta gestiones
        const svc = t.serviceType || 'Sin tipo';
        if(!serviceMap[svc]) serviceMap[svc] = { amount: 0, count: 0 };
        serviceMap[svc].amount += budget;
        serviceMap[svc].count  += 1;

        // Metro Terceros aparece en distribución por servicio, pero NO en cargas por analista
        // (no lo ejecuta ningún analista de A-MAQ).
        if (t.serviceType === 'Metro Terceros') return;

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
    const billingAnalysts = Object.keys(billingMap);
    const billingValues   = billingAnalysts.map(a => billingMap[a] || 0);
    const services        = Object.keys(serviceMap);
    const serviceValues   = services.map(s => serviceMap[s].amount);

    // Colores consistentes por analista (mismo color en ambas tortas) y por servicio
    const analystColors        = analysts.map(getAnalystColor);
    const billingAnalystColors = billingAnalysts.map(getAnalystColor);
    const serviceColors        = services.map(getServiceColor);

    // Estilo común para los anillos: separación blanca y bordes redondeados
    const ringStyle = {
        borderWidth: 4,
        borderColor: '#ffffff',
        borderRadius: 8,
        spacing: 2,
        hoverOffset: 6
    };

    const ctxWorkload = document.getElementById('workloadChart');
    if (ctxWorkload) {
        if (window._workloadTimeout) clearTimeout(window._workloadTimeout);
        window._workloadTimeout = setTimeout(() => {
            if(workloadChartInstance) workloadChartInstance.destroy();
            workloadChartInstance = new Chart(ctxWorkload, {
                type: 'doughnut',
                data: {
                    labels: analysts,
                    datasets: [{ data: workloadValues, backgroundColor: analystColors, ...ringStyle }]
                },
                options: _doughnutBaseOptions((ctx) => {
                    const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                    const percentage = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                    const val = Number.isInteger(ctx.parsed) ? ctx.parsed : ctx.parsed.toFixed(1);
                    return ` ${ctx.label}: ${val} gestiones (${percentage}%)`;
                })
            });
        }, 50);
    }

    const ctxBilling = document.getElementById('billingChart');
    if (ctxBilling) {
        if (window._billingTimeout) clearTimeout(window._billingTimeout);
        window._billingTimeout = setTimeout(() => {
            if(billingChartInstance) billingChartInstance.destroy();
            billingChartInstance = new Chart(ctxBilling, {
                type: 'doughnut',
                data: {
                    labels: billingAnalysts,
                    datasets: [{ data: billingValues, backgroundColor: billingAnalystColors, ...ringStyle }]
                },
                options: _doughnutBaseOptions((ctx) => {
                    const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                    const percentage = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                    return ` ${ctx.label}: $${ctx.parsed.toLocaleString('es-CO')} (${percentage}%)`;
                })
            });
        }, 60);
    }

    const ctxService = document.getElementById('serviceChart');
    if (ctxService) {
        if (window._serviceTimeout) clearTimeout(window._serviceTimeout);
        window._serviceTimeout = setTimeout(() => {
            if(serviceChartInstance) serviceChartInstance.destroy();
            serviceChartInstance = new Chart(ctxService, {
                type: 'doughnut',
                data: {
                    labels: services,
                    datasets: [{ data: serviceValues, backgroundColor: serviceColors, ...ringStyle }]
                },
                options: _doughnutBaseOptions((ctx) => {
                    const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                    const percentage = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                    const count = serviceMap[ctx.label]?.count ?? 0;
                    const word  = count === 1 ? 'gestión' : 'gestiones';
                    return ` ${ctx.label}: $${ctx.parsed.toLocaleString('es-CO')} · ${count} ${word} (${percentage}%)`;
                })
            });
        }, 70);
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

/** Roles que solo pueden visualizar el calendario, sin arrastrar ni modificar nada */
function isPlanningReadOnly() {
    const r = currentUserProfile?.role;
    return r === 'analyst' || r === 'commercial' || r === 'assistant';
}

function handleDragStart(e) {
    // Analistas/Comerciales no pueden arrastrar — planning es solo lectura para ellos
    if (isPlanningReadOnly()) {
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

    // Para analistas/comerciales: ocultar el panel de backlog — solo pueden ver el calendario
    const unassignedBar = sidebarContainer.closest('.unassigned-sidebar');
    if (isPlanningReadOnly()) {
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
        t.serviceType !== 'Metro Terceros' &&
        isTaskInCurrentPeriod(t)
    );

    if(dashboardFilters.analyst) filteredTasks = filteredTasks.filter(t => t.analyst === dashboardFilters.analyst);
    if(dashboardFilters.client) { const _base = getClientCompanyBase(dashboardFilters.client); filteredTasks = filteredTasks.filter(t => getClientCompanyBase(t.client) === _base); }

    // Buscador rápido: filtra por cliente + tipo de servicio + sede
    const searchInput = document.getElementById('unassignedSearch');
    const searchTerm  = (searchInput?.value || '').trim().toLowerCase();
    if(searchTerm) {
        filteredTasks = filteredTasks.filter(t => {
            const haystack = `${t.client || ''} ${t.serviceType || ''} ${t.plantName || ''}`.toLowerCase();
            return haystack.includes(searchTerm);
        });
    }

    // Contador visible en el header
    const countEl = document.getElementById('unassignedCount');
    if(countEl) countEl.textContent = String(filteredTasks.length);

    // Aplicar el layout correcto según la altura actual de la barra
    if(typeof _updateUnassignedLayoutForHeight === 'function') _updateUnassignedLayoutForHeight();

    if (filteredTasks.length === 0) {
        const msg = searchTerm ? 'Sin coincidencias para tu búsqueda' : 'No hay gestiones proyectadas';
        sidebarContainer.innerHTML = `<div style="text-align:center; padding:1rem; font-size:0.8rem; color:var(--text-secondary)">${msg}</div>`;
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

                // Días de campo → solo para analistas titulares (fueron a campo)
                if (dayEntry.type === 'field') {
                    const assign = t.analysts_assignment?.find(a => a.name === analyst.name);
                    return assign ? assign.isTitular : (t.analyst === analyst.name);
                }

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
                
                let label = t.isAbsence
                    ? (t.serviceType || 'Ausencia')
                    : (t.plantName || t.client);
                const tooltipClient = t.isAbsence ? label : (t.plantName ? `${t.client} – ${t.plantName}` : t.client);
                pill.textContent = label;
                pill.title = `${tooltipClient} (${dayInfo.type === 'field' ? 'Campo' : 'Informe'})`;
                
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
        // Para analistas/comerciales: planning es solo lectura, no se puede arrastrar nada
        if (isPlanningReadOnly()) {
            pill.draggable = false;
        }
        pill.addEventListener('dragstart', function(e) {
            if (isPlanningReadOnly()) {
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
            e.stopPropagation();
            const taskId  = this.getAttribute('data-task-id');
            const dayIdx  = parseInt(this.getAttribute('data-day-index'));
            const canMove = !this.classList.contains('absence') &&
                            !tasks.find(t => t.id === taskId)?.status?.match(/facturada/);
            if(canMove) {
                showMoveDayPopover(taskId, dayIdx, e);
            } else {
                openTaskInfoModal(taskId);
            }
        });

        // Touch support for pills
        setupTouchDraggable(pill, (el) => el.id);
    });
}

// ── Popover "Mover este día" ─────────────────────────────────────────────────

function showMoveDayPopover(taskId, dayIndex, mouseEvent) {
    // Cerrar cualquier popover abierto
    const existing = document.getElementById('move-day-popover');
    if(existing) existing.remove();

    const task = tasks.find(t => t.id === taskId);
    if(!task || !task.scheduledDays || !task.scheduledDays[dayIndex]) {
        openTaskInfoModal(taskId);
        return;
    }

    const dayInfo   = task.scheduledDays[dayIndex];
    const currentDate = dayInfo.date || '';
    const typeLabel = dayInfo.type === 'field' ? '🔧 Campo' : '📝 Informe';
    const clientLabel = task.plantName ? `${task.client} · ${task.plantName}` : task.client;

    const pop = document.createElement('div');
    pop.id = 'move-day-popover';
    pop.style.cssText = `
        position:fixed; z-index:9000;
        background:#fff; border:1px solid #e2e8f0;
        border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,0.18);
        padding:1rem 1.1rem 0.85rem; min-width:240px; max-width:280px;
        font-family:inherit; font-size:0.85rem;
    `;

    pop.innerHTML = `
        <div style="font-weight:700; color:#1e293b; margin-bottom:0.15rem; font-size:0.9rem;
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${clientLabel}">
            ${clientLabel}
        </div>
        <div style="font-size:0.75rem; color:#64748b; margin-bottom:0.75rem;">
            ${typeLabel} &nbsp;·&nbsp; ${currentDate || 'sin fecha'}
        </div>
        <label style="font-size:0.75rem; color:#475569; font-weight:600; display:block; margin-bottom:0.3rem;">
            📅 Mover a nueva fecha:
        </label>
        <input type="date" id="moveDayInput" value="${currentDate}"
               style="width:100%; padding:0.4rem 0.5rem; border:1px solid #cbd5e1;
                      border-radius:6px; font-size:0.85rem; margin-bottom:0.65rem; box-sizing:border-box;">
        <div style="display:flex; gap:0.5rem;">
            <button onclick="confirmMoveDay('${taskId}', ${dayIndex})"
                    style="flex:1; padding:0.45rem; background:#2563eb; color:#fff; border:none;
                           border-radius:7px; font-size:0.8rem; font-weight:600; cursor:pointer;">
                Mover
            </button>
            <button onclick="openTaskInfoModal('${taskId}'); document.getElementById('move-day-popover')?.remove();"
                    style="flex:1; padding:0.45rem; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0;
                           border-radius:7px; font-size:0.8rem; font-weight:600; cursor:pointer;">
                Ver gestión
            </button>
        </div>
        <button onclick="document.getElementById('move-day-popover').remove();"
                style="position:absolute; top:0.5rem; right:0.65rem; background:none; border:none;
                       font-size:1.1rem; color:#94a3b8; cursor:pointer; line-height:1;">×</button>
    `;
    pop.style.position = 'fixed';
    document.body.appendChild(pop);

    // Posicionar cerca del clic, ajustando para no salirse de la pantalla
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = 280, ph = 160;
    let left = mouseEvent.clientX + 10;
    let top  = mouseEvent.clientY + 10;
    if(left + pw > vw - 8) left = mouseEvent.clientX - pw - 10;
    if(top  + ph > vh - 8) top  = mouseEvent.clientY - ph - 10;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top  = Math.max(8, top)  + 'px';

    // Cerrar al hacer clic fuera
    setTimeout(() => {
        document.addEventListener('click', function _dismiss(ev) {
            if(!pop.contains(ev.target)) {
                pop.remove();
                document.removeEventListener('click', _dismiss);
            }
        });
    }, 50);
}

async function confirmMoveDay(taskId, dayIndex) {
    const newDate = document.getElementById('moveDayInput')?.value;
    if(!newDate) { showToast('Selecciona una fecha válida.'); return; }

    const pop = document.getElementById('move-day-popover');

    const task = tasks.find(t => t.id === taskId);
    if(!task || !task.scheduledDays || !task.scheduledDays[dayIndex]) return;

    const oldDate = task.scheduledDays[dayIndex].date;
    if(newDate === oldDate) { pop?.remove(); return; }

    // Actualizar el día
    const [, , dd] = newDate.split('-');
    task.scheduledDays[dayIndex].date = newDate;
    task.scheduledDays[dayIndex].day  = parseInt(dd, 10);

    pop?.remove();

    // Guardar y re-renderizar
    saveTasks();
    renderCalendar();
    if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
    try {
        await saveTaskToSupabase(task);
        showToast('Día movido correctamente.', 'success');
    } catch(err) {
        showToast('Error al guardar el cambio en la nube.');
        console.error(err);
    }
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
            ${task.plantName ? `<div style="font-size:0.75rem;color:#2563eb;font-weight:600;margin-top:1px;">📍 ${task.plantName}</div>` : ''}
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
    if (isPlanningReadOnly()) return;
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

    // Solo bloqueamos pill move a otro analista, excepto días de informe (reasignables)
    if (!isAssignedToTarget && isPillMove) {
        const _dragEl = document.getElementById(dragInfo);
        const _dayIdx = _dragEl ? parseInt(_dragEl.getAttribute('data-day-index'), 10) : parseInt(dragInfo.split('-').pop(), 10);
        if (task.scheduledDays?.[_dayIdx]?.type !== 'report') {
            alert(`Esta gestión está asignada a: ${task.analyst || 'nadie'}. Para moverla, use su propia fila o reasígnela en los detalles.`);
            return;
        }
        // Es un día de informe → se permite reasignar, continúa al bloque isPillMove
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

        const movedDay = task.scheduledDays[dayIdx];

        // Reasignación de día de informe a otro analista
        if (movedDay?.type === 'report') {
            const reportMap = getReportDayAssignments(task);
            let currentOwner = movedDay.analyst;
            if (!currentOwner) {
                for (const [name, dates] of reportMap.entries()) {
                    if (dates.includes(movedDay.date)) { currentOwner = name; break; }
                }
            }
            if (currentOwner !== targetAnalyst) {
                if (task.status === 'facturada') { alert('Una gestión facturada no puede ser modificada.'); return; }
                await reassignReportDay(task, dayIdx, targetAnalyst, targetDay, targetDateStr);
                saveTasks();
                postDropSync();
                await saveTaskToSupabase(task);
                return;
            }
        }

        // Movimiento normal de fecha (mismo analista)
        task.scheduledDays[dayIdx].day = targetDay;
        task.scheduledDays[dayIdx].date = targetDateStr;
        task.analyst = targetAnalyst;
        // Preservar la asignación múltiple si existe
        if (!task.analysts_assignment || task.analysts_assignment.length === 0) {
            task.analysts_assignment = [{ name: targetAnalyst, isTitular: true, makesReport: true, percentage: 100 }];
        } else {
            // Asegurar que el targetAnalyst sea titular; no tocar isTitular de los demás (tarea multi-analista)
            const found = task.analysts_assignment.find(a => a.name === targetAnalyst);
            if (found) { found.isTitular = true; }
        }
        logActivity(`🚚 Se movió un día de la gestión <strong>${task.client}</strong> al día <strong>${targetDay}</strong>.`, 'assign');
    } else {
        task.analyst = targetAnalyst;
        // Preservar la asignación múltiple si existe
        if (!task.analysts_assignment || task.analysts_assignment.length === 0) {
            task.analysts_assignment = [{ name: targetAnalyst, isTitular: true, makesReport: true, percentage: 100 }];
        } else {
            // Asegurar que el targetAnalyst sea titular; no tocar isTitular de los demás (tarea multi-analista)
            let found = task.analysts_assignment.find(a => a.name === targetAnalyst);
            if (found) {
                found.isTitular = true;
            } else {
                // El analista de la fila destino NO estaba asignado: era un prospecto.
                // Al programar desde el backlog, el analista real REEMPLAZA la asignación
                // previa (evita la división accidental entre prospecto y analista final).
                task.analysts_assignment = [{ name: targetAnalyst, isTitular: true, makesReport: true, percentage: 100 }];
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
    const _prevStatus = task.status;
    task.status = 'programada';

    // Notif: al pasar a programada por primera vez → notificar a los analistas
    if(_prevStatus !== 'programada') {
        notifyNewTaskToAnalysts(task).catch(() => {});
    }

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
    if (isPlanningReadOnly()) return;
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

        const _prevStatus = task.status;
        task.status = 'proyectada';
        task.scheduledDays = []; // Limpiar programación al volver al backlog

        postDropSync();

        // Auto-borrado: si venía de 'programada', la notif de "Nueva gestión" ya no aplica
        if(_prevStatus === 'programada') {
            deleteNotifsForTask({ task_id: task.id, type: 'nueva_gestion' }).catch(() => {});
        }

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
        if (task.analyst) map.set(task.analyst, reportDays.map(d => d.date));
        return map;
    }

    reportAnalysts.forEach(a => map.set(a.name, []));
    if (reportDays.length === 0) return map;

    // Días con analista explícito (reasignados manualmente)
    const explicitDays = reportDays.filter(d => d.analyst);
    const implicitDays = reportDays.filter(d => !d.analyst);

    explicitDays.forEach(d => {
        if (!map.has(d.analyst)) map.set(d.analyst, []);
        map.get(d.analyst).push(d.date);
    });

    // Días sin asignación explícita: distribución algorítmica entre makesReport
    if (implicitDays.length > 0) {
        const n = implicitDays.length;
        const k = reportAnalysts.length;
        const base  = Math.floor(n / k);
        const extra = n % k;
        let idx = 0;
        reportAnalysts.forEach((analyst, i) => {
            const quota = base + (i === 0 ? extra : 0);
            for (let j = 0; j < quota && idx < implicitDays.length; j++, idx++) {
                if (!map.has(analyst.name)) map.set(analyst.name, []);
                map.get(analyst.name).push(implicitDays[idx].date);
            }
        });
    }

    return map;
}

function recalculateAssignmentPercentages(task) {
    const assignments = task.analysts_assignment || [];
    if (assignments.length === 0) return;

    const fieldAnalysts  = assignments.filter(a => a.isTitular);
    const reportAnalysts = assignments.filter(a => a.makesReport);
    const hasBoth = fieldAnalysts.length > 0 && reportAnalysts.length > 0;

    const fieldPool  = hasBoth ? 50 : (fieldAnalysts.length  > 0 ? 100 : 0);
    const reportPool = hasBoth ? 50 : (reportAnalysts.length > 0 ? 100 : 0);

    const fieldShare  = fieldAnalysts.length  > 0 ? fieldPool  / fieldAnalysts.length  : 0;
    const reportShare = reportAnalysts.length > 0 ? reportPool / reportAnalysts.length : 0;

    assignments.forEach(a => {
        a.percentage = Math.round((a.isTitular ? fieldShare : 0) + (a.makesReport ? reportShare : 0));
    });
}

async function reassignReportDay(task, dayIdx, newAnalyst, newDay, newDateStr) {
    // Paso 1: congelar todos los días implícitos ANTES de mover cualquier cosa.
    // Así los días sin analista explícito quedan fijos y no se redistribuyen al nuevo analista.
    const currentMap = getReportDayAssignments(task);
    task.scheduledDays.forEach(d => {
        if (d.type === 'report' && !d.analyst) {
            for (const [name, dates] of currentMap.entries()) {
                if (dates.includes(d.date)) { d.analyst = name; break; }
            }
        }
    });

    const day = task.scheduledDays[dayIdx];
    const currentOwner = day.analyst;

    // Paso 2: mover el día al nuevo analista
    day.analyst  = newAnalyst;
    if (newDay)     day.day  = newDay;
    if (newDateStr) day.date = newDateStr;

    const assignments = task.analysts_assignment || [];

    // Asegurar que el nuevo analista esté en la lista con makesReport
    let newEntry = assignments.find(a => a.name === newAnalyst);
    if (!newEntry) {
        newEntry = { name: newAnalyst, isTitular: false, makesReport: true, percentage: 0 };
        assignments.push(newEntry);
        task.analysts_assignment = assignments;
    } else {
        newEntry.makesReport = true;
    }

    // Si el dueño anterior ya no tiene ningún día de informe, quitar makesReport
    if (currentOwner && currentOwner !== newAnalyst) {
        const stillHasReport = task.scheduledDays.some(
            d => d.type === 'report' && d.analyst === currentOwner
        );
        if (!stillHasReport) {
            const oldEntry = assignments.find(a => a.name === currentOwner);
            if (oldEntry) oldEntry.makesReport = false;
        }
    }

    recalculateAssignmentPercentages(task);
    logActivity(`📝 Día de informe de <strong>${task.client}</strong> reasignado a <strong>${newAnalyst}</strong>.`, 'assign');
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
    const isTitularChecked = existingData ? (existingData.isTitular ? 'checked' : '') : 'checked';
    const isReportChecked  = existingData ? (existingData.makesReport ? 'checked' : '') : (container.children.length === 0 ? 'checked' : '');
    const pctValue = existingData ? existingData.percentage : (container.children.length === 0 ? 100 : 0);

    row.innerHTML = `
        <select class="analyst-select" style="flex: 2; padding: 0.3rem 0.25rem; font-size: 0.72rem; border: 1px solid #cbd5e1; border-radius: 4px;">
            <option value="">Analista...</option>
            ${(dbAnalysts || []).map(a => `<option value="${a.name}" ${analystName === a.name ? 'selected' : ''}>${a.name}</option>`).join('')}
        </select>
        <label style="font-size: 0.7rem; display: flex; align-items: center; gap: 2px;">
            <input type="checkbox" class="analyst-titular" ${isTitularChecked}> Campo
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

/** Muestra el campo Planta/Sede apropiado según si el cliente tiene plantas registradas o no.
 *  @param {string} clientId  — ID del cliente seleccionado (vacío = ocultar campo)
 *  @param {string} [selectedPlantId]   — UUID de la planta a preseleccionar (edición)
 *  @param {string} [selectedPlantFree] — Texto libre a poner (edición sin plantas registradas)
 */
function _populatePlantField(clientId, selectedPlantId = '', selectedPlantFree = '') {
    const groupPlant = document.getElementById('group-plant');
    const plantSel   = document.getElementById('taskPlant');
    const plantFree  = document.getElementById('taskPlantFree');
    if(!groupPlant || !plantSel || !plantFree) return;

    if(!clientId) {
        groupPlant.style.display = 'none';
        plantSel.style.display   = 'none';
        plantFree.style.display  = 'none';
        return;
    }

    const clientPlants = dbPlants.filter(p => p.client_id === clientId);
    groupPlant.style.display = '';

    if(clientPlants.length > 0) {
        // Hay plantas registradas → usar dropdown
        plantSel.innerHTML = '<option value="">Sin planta específica</option>';
        clientPlants.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if(selectedPlantId && p.id === selectedPlantId) opt.selected = true;
            plantSel.appendChild(opt);
        });
        plantSel.style.display  = '';
        plantFree.style.display = 'none';
        plantFree.value = '';
    } else {
        // Sin plantas registradas → texto libre
        plantSel.style.display  = 'none';
        plantFree.style.display = '';
        plantFree.value = selectedPlantFree || '';
    }
}

async function onTaskClientChange() {
    const clientId = document.getElementById('taskClient').value;
    const container = document.getElementById('taskAnalystsContainer');
    clientAnalystPreferences = []; // reset preferencias al cambiar cliente

    // Metro Administrativo y Metro Terceros no usan analistas — mantener el banner
    const serviceType = document.getElementById('taskServiceType')?.value;
    if(serviceType === 'Metro Administrativo' || serviceType === 'Metro Terceros') return;

    // Poblar dropdown de plantas para este cliente
    _populatePlantField(clientId);

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
    const isAbsence       = (serviceType === 'Vacaciones' || serviceType === 'Incapacidad' || serviceType === 'Compensatorio' || serviceType === 'Entrenamiento o Curso');
    const isAdminContract = (serviceType === 'Metro Administrativo');
    const isThirdParty    = (serviceType === 'Metro Terceros');

    // Campos que se ocultan solo en ausencias
    const fieldsToToggle = ['group-client', 'group-budget', 'group-equipment', 'group-report'];
    fieldsToToggle.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = isAbsence ? 'none' : 'block';
    });

    const container = document.getElementById('taskAnalystsContainer');
    const clientSel = document.getElementById('taskClient');

    // Rehabilitar el selector de cliente por defecto (para revertir el lock de Metro Terceros)
    if (clientSel) clientSel.disabled = false;

    if(isAbsence) {
        if(container.innerHTML.trim() === '' || container.innerHTML.includes('Seleccione primero')) {
            container.innerHTML = '';
            addAnalystToTask();
        }
        clientSel.required = false;
        document.getElementById('taskBudget').required  = false;
        document.getElementById('taskDaysReport').required = false;
        // Ocultar campo planta en ausencias
        const gp = document.getElementById('group-plant');
        if(gp) gp.style.display = 'none';

    } else if(isAdminContract) {
        // Metro Administrativo: solo cliente y presupuesto — sin analista, días ni equipo
        clientSel.required = true;
        document.getElementById('taskBudget').required    = true;
        document.getElementById('taskDaysField').required = false;
        document.getElementById('taskDaysReport').required = false;

        // Auto-seleccionar cliente "Metro Administrativo" (o "Metro Admin") y bloquear
        const metroAdminClient = dbClients.find(c => {
            const n = (c.company_name || '').trim().toLowerCase();
            return n === 'metro administrativo' || n === 'metro admin';
        });
        if(metroAdminClient) {
            clientSel.value = metroAdminClient.id;
            clientSel.disabled = true;
        } else {
            alert('No existe un cliente llamado "Metro Administrativo" (o "Metro Admin"). Créalo primero en Admin de Datos.');
        }

        // Ocultar analistas, días, equipo y planta
        ['group-analysts', 'group-days', 'group-equipment', 'group-plant'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = 'none';
        });

        // Mostrar banner en el contenedor de analistas (por si acaso)
        clientAnalystPreferences = [];
        container.dataset.clientPreferences = '[]';
        container.innerHTML = '';

    } else if(isThirdParty) {
        // Metro Terceros: cliente auto-fijado en "Metro Terceros", sin analista, sin días
        // El campo planta funciona como "detalle del servicio" (certificación, filtros, etc.)
        clientSel.required = true;
        document.getElementById('taskBudget').required    = true;
        document.getElementById('taskDaysField').required = false;
        document.getElementById('taskDaysReport').required = false;

        // Auto-seleccionar cliente "Metro Terceros" y bloquear
        const metroTercerosClient = dbClients.find(c =>
            (c.company_name || '').trim().toLowerCase() === 'metro terceros'
        );
        if(metroTercerosClient) {
            clientSel.value = metroTercerosClient.id;
            clientSel.disabled = true;
            // Poblar plantas del cliente Metro Terceros y mostrar el campo.
            // Preservar la planta ya seleccionada si estamos editando una gestión.
            const gp = document.getElementById('group-plant');
            if(gp) gp.style.display = 'block';
            const existingPlantSel  = document.getElementById('taskPlant');
            const existingPlantFree = document.getElementById('taskPlantFree');
            const preservePlantId   = existingPlantSel?.value || '';
            const preservePlantFree = existingPlantFree?.value || '';
            _populatePlantField(metroTercerosClient.id, preservePlantId, preservePlantFree);
        } else {
            alert('No existe un cliente llamado "Metro Terceros". Créalo primero en Admin de Datos.');
        }

        // Ocultar analistas, días y equipo (el campo planta SÍ se mantiene visible como detalle)
        ['group-analysts', 'group-days', 'group-equipment'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = 'none';
        });

        clientAnalystPreferences = [];
        container.dataset.clientPreferences = '[]';
        container.innerHTML = '';

    } else {
        // Servicio normal: restaurar todos los campos
        clientSel.required = true;
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
    
    const infoClientEl = document.getElementById('infoClient');
    infoClientEl.textContent = task.client;
    // Planta/Sede debajo del nombre del cliente
    let infoPlantEl = document.getElementById('infoPlant');
    if(!infoPlantEl) {
        infoPlantEl = document.createElement('p');
        infoPlantEl.id = 'infoPlant';
        infoPlantEl.style.cssText = 'font-size:0.85rem; color:var(--clr-blue); font-weight:600; margin:0 0 0.25rem;';
        infoClientEl.insertAdjacentElement('afterend', infoPlantEl);
    }
    infoPlantEl.textContent = task.plantName ? `📍 ${task.plantName}` : '';
    infoPlantEl.style.display = task.plantName ? '' : 'none';
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
    const isReadOnlyViewer = currentUserProfile?.role === 'analyst' || currentUserProfile?.role === 'commercial';
    if(editBtn)   editBtn.style.display   = isReadOnlyViewer ? 'none' : '';
    if(deleteBtn) deleteBtn.style.display = isReadOnlyViewer ? 'none' : '';

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
    renderFinanceView();
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

/** Estado de expansión por tarjeta en la vista de Finanzas (per-sesión). */
const financeExpandedCards = new Set();

function toggleFinanceCardExpand(key) {
    if(financeExpandedCards.has(key)) financeExpandedCards.delete(key);
    else financeExpandedCards.add(key);
    renderFinanceView();
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
                    client:      t.client,
                    plantName:   t.plantName || '',
                    serviceType: t.serviceType || '',
                    analyst:     formatAnalystDisplay(t),
                    amount:      taskValue,
                    period:      t.period || ''
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
        const expanded = financeExpandedCards.has(c.key);
        const wrap = expanded ? 'normal' : 'nowrap';
        const overflowText = expanded ? 'visible' : 'hidden';
        const ellipsis = expanded ? 'clip' : 'ellipsis';

        const rows = Object.keys(bd).length > 0
            ? Object.values(bd).map(({ client, plantName, serviceType, analyst, amount, period }) => {
                const monthAbbr = period
                    ? monthNames[parseInt(period.split('-')[1]) - 1]?.substring(0, 3) || ''
                    : '';
                return `
                <div style="display:flex; justify-content:space-between; align-items:${expanded ? 'flex-start' : 'center'};
                            padding:0.35rem 0; border-bottom:1px solid ${c.clr}18;
                            font-size:0.78rem; gap:0.5rem;">
                    <div style="overflow:hidden; flex:1; min-width:0;">
                        <div style="overflow:${overflowText}; text-overflow:${ellipsis}; white-space:${wrap}; color:#374151; word-break:break-word;">
                            ${client}
                            ${monthAbbr ? `<span style="font-size:0.62rem; color:#94a3b8; font-weight:400;">(${monthAbbr})</span>` : ''}
                        </div>
                        ${plantName ? `<div style="font-size:0.68rem; color:${c.clr}; font-weight:600; white-space:${wrap}; overflow:${overflowText}; text-overflow:${ellipsis}; word-break:break-word;">📍 ${plantName}</div>` : ''}
                        ${expanded && serviceType ? `<div style="font-size:0.68rem; color:#64748b; font-weight:500; margin-top:0.15rem;">🔧 ${serviceType}</div>` : ''}
                        ${expanded && analyst && analyst !== '-' ? `<div style="font-size:0.68rem; color:#64748b; font-weight:500; margin-top:0.15rem;">👤 ${analyst}</div>` : ''}
                    </div>
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
            <!-- Pill header con botón expandir -->
            <div style="padding:1rem 1rem 0.75rem; display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                <span style="
                    display:inline-flex; align-items:center; gap:0.35rem;
                    background:${c.clr}; color:#fff;
                    font-size:0.7rem; font-weight:700;
                    padding:0.3rem 0.8rem; border-radius:20px;
                    text-transform:uppercase; letter-spacing:0.04em;
                ">${c.icon} ${c.label}</span>
                ${Object.keys(bd).length > 0 ? `
                <button onclick="toggleFinanceCardExpand('${c.key}')"
                        title="${expanded ? 'Contraer' : 'Expandir para ver todo'}"
                        style="background:transparent; border:1px solid ${c.clr}40; color:${c.clr}; cursor:pointer; padding:0.2rem 0.55rem; border-radius:6px; font-size:0.68rem; font-weight:700; line-height:1;">
                    ${expanded ? '▲ Contraer' : '▼ Expandir'}
                </button>` : ''}
            </div>

            <!-- Filas de clientes (siempre con scroll interno para no romper el layout) -->
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
            service_details: task.serviceDetails || null,
            mes_facturacion: task.mesFacturacion || task.period,
            analysts_assignment: task.analysts_assignment || [],
            plant_id:   task.plantId   || null,
            plant_name: task.plantName || null
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
                evidenceFiles: t.evidence_files || [],
                serviceDetails: t.service_details || '',
                plantId:   t.plant_id   || null,
                plantName: t.plant_name || ''
            }));

            // 1. Merge remote into local
            // La nube es la fuente de verdad. Como saveTaskToSupabase se ejecuta con
            // await y muestra toast rojo si falla, el estado remoto es autoritativo
            // en todos los campos. Esto evita el bug asimétrico donde un revert a
            // proyectada en otro dispositivo no se propagaba (la heurística previa
            // preservaba localmente el estado "programada").
            remoteTasks.forEach(remote => {
                const localIdx = tasks.findIndex(l => l.id === remote.id || l.supabaseId === remote.id);
                if (localIdx === -1) {
                    tasks.push(remote);
                } else {
                    tasks[localIdx] = {
                        ...tasks[localIdx],
                        ...remote,
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

        populatePeriodMonthSelect();
        const periodMonthEl = document.getElementById('taskPeriodMonth');
        if (periodMonthEl) periodMonthEl.value = formatPeriod();

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

        // Poblar campo de planta para edición
        const clientIdForPlant = dbClients.find(c =>
            getClientDisplayName(c) === task.client || c.id === task.clientId
        )?.id || task.clientId || '';
        _populatePlantField(clientIdForPlant, task.plantId || '', task.plantName || '');

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

        const periodMonthEl = document.getElementById('taskPeriodMonth');
        if (periodMonthEl) {
            populatePeriodMonthSelect();
            periodMonthEl.value = task.period || formatPeriod();
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
    if (modalId === 'serviceDetailsModal' && typeof _stopServiceDictation === 'function') _stopServiceDictation();
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
    if (analystData) { titularCheck.checked = !!analystData.isTitular; }
    else { titularCheck.checked = true; }
    titularLabel.appendChild(titularCheck);
    titularLabel.appendChild(document.createTextNode('Campo'));

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

        const isAbsence       = (serviceType === 'Vacaciones' || serviceType === 'Incapacidad' || serviceType === 'Compensatorio' || serviceType === 'Entrenamiento o Curso');
        const isAdminContract = (serviceType === 'Metro Administrativo');
        const isThirdParty    = (serviceType === 'Metro Terceros');
        const finalClientName = isAbsence ? `AUSENCIA: ${serviceType}` : clientName;

        // Planta / Sede: dropdown (con ID) o texto libre
        const plantSelEl  = document.getElementById('taskPlant');
        const plantFreeEl = document.getElementById('taskPlantFree');
        const plantId   = (plantSelEl && plantSelEl.style.display !== 'none') ? (plantSelEl.value || '') : '';
        const plantName = plantId
            ? (plantSelEl.options[plantSelEl.selectedIndex]?.text || '')
            : (plantFreeEl && plantFreeEl.style.display !== 'none' ? (plantFreeEl.value.trim() || '') : '');

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

        if(!isAbsence && !isAdminContract && !isThirdParty && analystsAssignment.length > 0 && Math.abs(totalPercentage - 100) > 0.01) {
            alert("El porcentaje financiero total debe sumar exactamente 100%. Actualmente suma " + totalPercentage + "%.");
            return;
        }

        const mainAnalyst = analystsAssignment.length > 0
            ? (analystsAssignment.find(a => a.isTitular) || analystsAssignment[0]).name
            : (isAdminContract ? 'Administrativo' : (isThirdParty ? 'Terceros' : ''));
        let displayAnalyst = analystsAssignment.length > 0
            ? analystsAssignment.map(a => `${a.name} (${a.percentage}%)`).join(', ')
            : (isAdminContract ? 'Administrativo' : (isThirdParty ? 'Terceros' : ''));
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
                tasks[idx].plantId   = plantId   || null;
                tasks[idx].plantName = plantName || '';
                tasks[idx].mesFacturacion = document.getElementById('taskBillingMonth').value;
                tasks[idx].period = document.getElementById('taskPeriodMonth')?.value || tasks[idx].period;


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
                plantId:   plantId   || null,
                plantName: plantName || '',
                scheduledDays: [],
                status: isAdminContract ? 'facturada' : (isThirdParty ? 'programada' : 'proyectada'),
                period: document.getElementById('taskPeriodMonth')?.value || formatPeriod(),
                mesFacturacion: document.getElementById('taskBillingMonth').value
            };
            tasks.push(newTask);


            await saveTaskToSupabase(newTask);
            // Notif de "Nueva gestión asignada" NO se dispara aquí. Solo se emite
            // cuando la gestión pasa efectivamente a estado 'programada', porque
            // en 'proyectada' el analista aún puede cambiar.
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

/**
 * Comprime una imagen si supera el umbral. Para no-imágenes o imágenes pequeñas
 * devuelve el archivo original. Redimensiona a max 1600px del lado mayor y
 * recodifica como JPEG calidad 0.8. Si algo falla, devuelve el original.
 */
async function compressImageIfNeeded(file) {
    const isImage = /^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
    if(!isImage) return file;
    if(file.size < 250 * 1024) return file; // < 250 KB no vale la pena

    try {
        const img = await new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const im = new Image();
            im.onload  = () => { URL.revokeObjectURL(url); resolve(im); };
            im.onerror = () => { URL.revokeObjectURL(url); reject(); };
            im.src = url;
        });

        const MAX_SIDE = 1600;
        let { width, height } = img;
        const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
        width  = Math.round(width  * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
        if(!blob || blob.size >= file.size) return file; // si no mejora, original

        // Renombrar a .jpg para reflejar el tipo real
        const baseName = file.name.replace(/\.(png|webp|jpeg|jpg)$/i, '');
        return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } catch(e) {
        console.warn('Compresión saltada para', file.name, e);
        return file;
    }
}

async function uploadEvidenceFiles(taskId) {
    if(!supabaseClient || _evidencePendingFiles.length === 0) return [];
    const urls = [];
    let savedBytes = 0;
    for(const original of _evidencePendingFiles) {
        const file = await compressImageIfNeeded(original);
        savedBytes += Math.max(0, original.size - file.size);
        const path = `tasks/${taskId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
        const { error } = await supabaseClient.storage
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
    if(savedBytes > 100 * 1024) {
        const savedKb = Math.round(savedBytes / 1024);
        const niceSize = savedKb >= 1024 ? `${(savedKb/1024).toFixed(1)} MB` : `${savedKb} KB`;
        showToast(`Imágenes comprimidas — se ahorraron ${niceSize}`, 'success');
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

        const prevStatus = tasks[taskIndex].status;
        tasks[taskIndex].status           = targetStatus;
        tasks[taskIndex].csatScore        = score;
        tasks[taskIndex].csatObservations = observations;
        tasks[taskIndex].alertvoxChecked  = alertvox;
        tasks[taskIndex].clientNoResponse = noResponse;
        tasks[taskIndex].evidenceNotes    = evidenceNotes;
        tasks[taskIndex].evidenceFiles    = allFiles;

        saveTasks();
        // Notif: al pasar a ejecutada por primera vez desde el CSAT modal
        if(prevStatus !== 'ejecutada' && targetStatus === 'ejecutada') {
            notifyTaskExecuted(tasks[taskIndex]).catch(() => {});
        }
        // Auto-cierre: si se registró CSAT o "no respondió", cerrar la notif de CSAT vencido
        if(score || noResponse) {
            resolveNotifsForTask({ task_id: taskId, type: 'csat_vencido' }).catch(() => {});
        }
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

    // Evita que el scroll heredado de la vista anterior deje el contenido nuevo fuera de pantalla.
    // Hay dos contenedores con scroll independiente (.main-content Y el documento/html), hay que resetear ambos.
    const mainContent = document.getElementById('main-content');
    if(mainContent) mainContent.scrollTop = 0;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

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
            reports:   'Reportes Históricos',
            inventory: 'Control de Inventario CBM'
        };
        headerTitle.textContent = titles[viewName] || 'CBM Maestro';
    }

    if(viewName === 'planning') {
        renderCalendar();
        renderPlanningSidebar();
    } else if(viewName === 'mywork') {
        renderMyWorkView();
        updateCsatBadge();
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
    } else if(viewName === 'inventory') {
        initInventoryView();
    } else {
        renderBoard();
    }

    updateCsatBadge();

    // Recarga silenciosa desde Supabase al cambiar de vista
    if(supabaseClient) {
        loadTasksFromSupabase().then(() => {
            if(viewName === 'planning')   { renderCalendar(); renderPlanningSidebar(); }
            else if(viewName === 'mywork')  { renderMyWorkView(); updateCsatBadge(); }
            else if(viewName === 'tasks')   { renderTasksView(); }
            else if(viewName === 'finance') { renderFinanceView(); }
            else if(viewName === 'reports') {
                if(reportActiveTab === 'csat') renderCsatTable();
                else renderReportsTable();
            }
            else { renderBoard(); }
            updateCsatBadge();
        }).catch(() => {});
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

        const { data: plants, error: errP } = await supabaseClient.from('client_plants').select('*').order('name');
        if(errP) console.error("Error fetching client_plants:", errP);

        if(clients)   dbClients   = clients;
        if(analysts)  dbAnalysts  = analysts;
        if(equipment) dbEquipment = equipment;
        if(plants)    dbPlants    = plants;
        
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

let reportFilters    = { analyst: '', client: '', serviceType: '', dateFrom: '', dateTo: '', csatStatus: '' };
let reportActiveTab  = 'gestiones'; // 'gestiones' | 'csat'

let reportsDefaultApplied = false;

function initReportsView() {
    // Por defecto, filtrar al mes ACTUAL real (de hoy), independiente de la
    // navegación de mes del calendario/dashboard. Solo se aplica la primera vez;
    // luego respeta lo que el usuario haya escogido (o limpiado).
    if(!reportsDefaultApplied) {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        reportFilters.dateFrom = ym;
        reportFilters.dateTo   = ym;
        reportsDefaultApplied  = true;
    }
    const fromEl = document.getElementById('report-filter-from');
    const toEl   = document.getElementById('report-filter-to');
    if(fromEl) fromEl.value = reportFilters.dateFrom || '';
    if(toEl)   toEl.value   = reportFilters.dateTo   || '';

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
    // Restaurar estado del tab activo
    switchReportTab(reportActiveTab);
}

function applyReportFilters() {
    reportFilters.analyst     = document.getElementById('report-filter-analyst').value;
    reportFilters.client      = document.getElementById('report-filter-client').value;
    reportFilters.serviceType = document.getElementById('report-filter-service')?.value || '';
    reportFilters.dateFrom    = document.getElementById('report-filter-from').value;
    reportFilters.dateTo      = document.getElementById('report-filter-to').value;
    reportFilters.csatStatus  = document.getElementById('report-filter-csat-status')?.value || '';
    if(reportActiveTab === 'csat') renderCsatTable();
    else renderReportsTable();
}

function clearReportFilters() {
    reportFilters = { analyst:'', client:'', serviceType:'', dateFrom:'', dateTo:'', csatStatus:'' };
    ['report-filter-analyst','report-filter-client','report-filter-service',
     'report-filter-from','report-filter-to','report-filter-csat-status'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '';
    });
    if(reportActiveTab === 'csat') renderCsatTable();
    else renderReportsTable();
}

function switchReportTab(tab) {
    reportActiveTab = tab;
    // Actualizar botones
    document.getElementById('tab-btn-gestiones')?.classList.toggle('active', tab === 'gestiones');
    document.getElementById('tab-btn-csat')?.classList.toggle('active', tab === 'csat');
    // Mostrar/ocultar filtros específicos
    document.getElementById('filter-service-wrap')?.style.setProperty('display', tab === 'gestiones' ? '' : 'none');
    document.getElementById('filter-csat-status-wrap')?.style.setProperty('display', tab === 'csat' ? '' : 'none');
    // Actualizar títulos
    const title = document.getElementById('reports-view-title');
    const sub   = document.getElementById('reports-view-subtitle');
    if(tab === 'csat') {
        if(title) title.textContent = 'Cierres CSAT';
        if(sub)   sub.textContent  = 'Resultados de encuestas de satisfacción y evidencias de no-respuesta.';
    } else {
        if(title) title.textContent = 'Reportes Históricos';
        if(sub)   sub.textContent  = 'Busca, filtra y exporta gestiones de cualquier período.';
    }
    if(tab === 'csat') renderCsatTable();
    else renderReportsTable();
}

// ── Exportación según pestaña activa ────────────────────────────────────────
function exportActiveReportPDF() {
    if(reportActiveTab === 'csat') exportCsatPDF();
    else exportReportPDF();
}
function exportActiveReportCSV() {
    if(reportActiveTab === 'csat') exportCsatCSV();
    else exportReportCSV();
}

// ── Datos para tabla CSAT ────────────────────────────────────────────────────
function getCsatTableData() {
    let data = tasks.filter(t =>
        !t.isAbsence &&
        t.serviceType !== 'Metro Administrativo' &&
        t.serviceType !== 'Metro Terceros' &&
        (t.status === 'ejecutada' || t.status === 'facturada')
    );
    if(reportFilters.analyst) {
        data = data.filter(t => {
            if(t.analysts_assignment?.length > 0)
                return t.analysts_assignment.some(a => a.name === reportFilters.analyst);
            return t.analyst === reportFilters.analyst;
        });
    }
    if(reportFilters.client) {
        data = data.filter(t => t.client === reportFilters.client || t.client.includes(reportFilters.client));
    }
    if(reportFilters.dateFrom) {
        data = data.filter(t => (t.mesFacturacion || t.period || '') >= reportFilters.dateFrom.substring(0,7));
    }
    if(reportFilters.dateTo) {
        data = data.filter(t => (t.mesFacturacion || t.period || '') <= reportFilters.dateTo.substring(0,7));
    }
    if(reportFilters.csatStatus) {
        data = data.filter(t => {
            if(reportFilters.csatStatus === 'con-csat')      return t.csatScore && !t.clientNoResponse;
            if(reportFilters.csatStatus === 'sin-respuesta') return t.clientNoResponse;
            if(reportFilters.csatStatus === 'pendiente')     return !t.csatScore && !t.clientNoResponse;
            return true;
        });
    }
    return data.sort((a,b) => (b.mesFacturacion||b.period||'').localeCompare(a.mesFacturacion||a.period||''));
}

function _csatEstadoCierre(t) {
    if(t.csatScore && !t.clientNoResponse)
        return { label: `⭐ ${t.csatScore}/5`, color: '#16a34a', bg: '#f0fdf4' };
    if(t.clientNoResponse)
        return { label: '⚠️ Sin respuesta', color: '#b45309', bg: '#fffbeb' };
    // Calcular días pendientes
    const lastReport = (t.scheduledDays||[]).filter(d=>d.type==='report').map(d=>d.date).sort().pop();
    if(lastReport) {
        const diff = Math.floor((Date.now() - new Date(lastReport).getTime()) / 86400000);
        if(diff >= 7) return { label: `🕐 Pendiente (${diff}d)`, color: '#dc2626', bg: '#fff1f2' };
    }
    return { label: '🕐 Pendiente', color: '#6b7280', bg: '#f8fafc' };
}

/** Celda de evidencia: justificación escrita (tooltip) + enlaces a archivos adjuntos. */
function _csatEvidenceCell(t) {
    const files = t.evidenceFiles || [];
    const hasNotes = !!(t.evidenceNotes && t.evidenceNotes.trim());
    if(files.length === 0 && !hasNotes) return '<span style="color:#cbd5e1;">—</span>';

    const noteHTML = hasNotes
        ? `<div onclick="openEvidenceNote('${t.id}')" title="Clic para ver completo" style="font-size:0.7rem;color:var(--clr-blue);margin-bottom:0.25rem;cursor:pointer;text-decoration:underline;">📝 ${t.evidenceNotes.length > 40 ? t.evidenceNotes.substring(0,40)+'…' : t.evidenceNotes}</div>`
        : '';

    const linksHTML = files.map(f => {
        const url  = typeof f === 'string' ? f : f.url;
        const name = typeof f === 'string' ? (f.split('/').pop() || 'archivo') : f.name;
        const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
        const safeUrl = url.replace(/'/g, "\\'");
        return `<a href="${url}" target="_blank" rel="noopener" onclick="event.preventDefault(); openEvidence('${safeUrl}');" style="display:block;font-size:0.72rem;color:var(--clr-blue);text-decoration:underline;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;cursor:pointer;">${isImg ? '🖼️' : '📄'} ${name}</a>`;
    }).join('');

    return noteHTML + linksHTML;
}

/** Muestra el texto completo de la justificación del analista en un modal. */
function openEvidenceNote(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task || !task.evidenceNotes) return;
    document.getElementById('textViewerTitle').textContent = '📝 Justificación del analista';
    document.getElementById('textViewerBody').textContent = task.evidenceNotes;
    document.getElementById('textViewerModal').classList.add('active');
}

/**
 * Abre un archivo de evidencia. Genera una URL firmada temporal (funciona con bucket
 * privado); si falla, intenta abrir la URL pública directamente.
 */
async function openEvidence(fileUrl) {
    try {
        const marker = '/evidence-files/';
        const idx = fileUrl.indexOf(marker);
        if(idx !== -1 && supabaseClient) {
            const path = decodeURIComponent(fileUrl.substring(idx + marker.length));
            const { data, error } = await supabaseClient.storage
                .from('evidence-files')
                .createSignedUrl(path, 3600); // válido 1 hora
            if(!error && data && data.signedUrl) {
                window.open(data.signedUrl, '_blank', 'noopener');
                return;
            }
            console.error('No se pudo firmar la URL de evidencia:', error);
        }
    } catch(e) {
        console.error('Error abriendo evidencia:', e);
    }
    // Fallback: intentar la URL pública directamente
    window.open(fileUrl, '_blank', 'noopener');
}

let csatSortState = { column: null, dir: 'asc' };

function sortCsatBy(column) {
    if (csatSortState.column === column) {
        csatSortState.dir = csatSortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        csatSortState.column = column;
        csatSortState.dir = 'asc';
    }
    renderCsatTable();
}

function renderCsatTable() {
    const container = document.getElementById('reports-table-container');
    if(!container) return;
    let data = getCsatTableData();

    if(data.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-secondary);font-size:0.9rem;">No se encontraron cierres con los filtros aplicados.</div>`;
        return;
    }

    // Ordenamiento por columna. Para "Estado Cierre" usamos orden lógico
    // (calificado → sin respuesta → pendiente).
    if (csatSortState.column) {
        const cierreOrder = t => {
            if (t.csatScore && !t.clientNoResponse) return 0; // calificado (mejor primero)
            if (t.clientNoResponse) return 1;
            return 2; // pendiente
        };
        const getVal = (t) => {
            switch (csatSortState.column) {
                case 'period':   return t.mesFacturacion || t.period || '';
                case 'client':   return (t.client || '').toLowerCase() + (t.plantName ? ' ' + t.plantName.toLowerCase() : '');
                case 'analyst':  return (formatAnalystDisplay(t) || '').toLowerCase();
                case 'service':  return (t.serviceType || '').toLowerCase();
                case 'cierre':   return cierreOrder(t);
                case 'obs':      return (t.csatObservations || '').toLowerCase();
                case 'evidence': return ((t.evidenceFiles || []).length ? 1 : 0) + ((t.evidenceNotes || '').trim() ? 1 : 0);
                default:         return '';
            }
        };
        const dir = csatSortState.dir === 'asc' ? 1 : -1;
        data = data.slice().sort((a, b) => {
            const va = getVal(a), vb = getVal(b);
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va).localeCompare(String(vb), 'es') * dir;
        });
    }

    const sortArrow = (col) => {
        if (csatSortState.column !== col) return '<span style="opacity:0.3;">↕</span>';
        return csatSortState.dir === 'asc' ? '↑' : '↓';
    };
    const thSort = (col, label, extraStyle = '') =>
        `<th onclick="sortCsatBy('${col}')" style="cursor:pointer; user-select:none; ${extraStyle}">${label} <span style="font-size:0.75em;">${sortArrow(col)}</span></th>`;

    const scores = data.filter(t => t.csatScore && !t.clientNoResponse).map(t => parseFloat(t.csatScore));
    const avgCsat = scores.length ? (scores.reduce((s,v)=>s+v,0)/scores.length).toFixed(2) : '—';
    const sinRespuesta = data.filter(t => t.clientNoResponse).length;
    const pendientes   = data.filter(t => !t.csatScore && !t.clientNoResponse).length;

    container.innerHTML = `
        <!-- Resumen rápido -->
        <div style="display:flex; gap:1rem; flex-wrap:wrap; padding:1rem 1.25rem; border-bottom:1px solid #e2e8f0; background:#f8fafc;">
            <div style="text-align:center; flex:1; min-width:100px;">
                <div style="font-size:1.4rem; font-weight:800; color:var(--clr-blue)">${data.length}</div>
                <div style="font-size:0.7rem; color:#64748b; font-weight:600;">TOTAL</div>
            </div>
            <div style="text-align:center; flex:1; min-width:100px;">
                <div style="font-size:1.4rem; font-weight:800; color:#16a34a">${scores.length}</div>
                <div style="font-size:0.7rem; color:#64748b; font-weight:600;">CON CSAT</div>
            </div>
            <div style="text-align:center; flex:1; min-width:100px;">
                <div style="font-size:1.4rem; font-weight:800; color:#2563eb">${avgCsat !== '—' ? '⭐ '+avgCsat : '—'}</div>
                <div style="font-size:0.7rem; color:#64748b; font-weight:600;">PROMEDIO</div>
            </div>
            <div style="text-align:center; flex:1; min-width:100px;">
                <div style="font-size:1.4rem; font-weight:800; color:#b45309">${sinRespuesta}</div>
                <div style="font-size:0.7rem; color:#64748b; font-weight:600;">SIN RESPUESTA</div>
            </div>
            <div style="text-align:center; flex:1; min-width:100px;">
                <div style="font-size:1.4rem; font-weight:800; color:#dc2626">${pendientes}</div>
                <div style="font-size:0.7rem; color:#64748b; font-weight:600;">PENDIENTES</div>
            </div>
        </div>
        <!-- Tabla -->
        <div style="overflow-x:auto;">
        <table class="data-table" style="font-size:0.8rem; width:100%;">
            <thead>
                <tr>
                    ${thSort('period',   'Período',        'min-width:100px;')}
                    ${thSort('client',   'Cliente / Planta','min-width:160px;')}
                    ${thSort('analyst',  'Analista(s)',    'min-width:140px;')}
                    ${thSort('service',  'Servicio',       'min-width:110px;')}
                    ${thSort('cierre',   'Estado Cierre',  'min-width:130px;')}
                    ${thSort('obs',      'Observaciones',  'min-width:180px;')}
                    ${thSort('evidence', 'Evidencia',      'min-width:150px;')}
                </tr>
            </thead>
            <tbody>
                ${data.map(t => {
                    const cierre = _csatEstadoCierre(t);
                    const client = t.client + (t.plantName ? `<br><span style="font-size:0.7rem;color:var(--clr-blue);font-weight:600;">📍 ${t.plantName}</span>` : '');
                    const analysts = formatAnalystDisplay(t);
                    return `<tr>
                        <td>${formatReportPeriod(t.mesFacturacion||t.period)}</td>
                        <td>${client}</td>
                        <td style="font-size:0.75rem;">${analysts}</td>
                        <td>${t.serviceType||'-'}</td>
                        <td><span style="background:${cierre.bg};color:${cierre.color};font-weight:700;font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:6px;white-space:nowrap;">${cierre.label}</span></td>
                        <td style="font-size:0.75rem;color:#475569;">${t.csatObservations||''}</td>
                        <td>${_csatEvidenceCell(t)}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
        </div>`;
}

function exportCsatCSV() {
    const data = getCsatTableData();
    if(!data.length) { alert('No hay datos para exportar.'); return; }
    const headers = ['Período','Cliente','Planta','Analistas','Servicio','Estado Cierre','Puntuación','Observaciones','Justificación','Evidencia (enlaces)'];
    const rows = data.map(t => {
        const cierre = _csatEstadoCierre(t);
        const urls = (t.evidenceFiles||[]).map(f => typeof f === 'string' ? f : f.url).join(' | ');
        return [
            formatReportPeriod(t.mesFacturacion||t.period),
            t.client, t.plantName||'',
            formatAnalystDisplay(t),
            t.serviceType||'',
            cierre.label.replace(/[⭐⚠️🕐]/g,'').trim(),
            t.csatScore||'',
            t.csatObservations||'',
            t.evidenceNotes||'',
            urls
        ];
    });
    const csv = [headers,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Cierres_CSAT_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
}

async function exportCsatPDF() {
    const data = getCsatTableData();
    if(!data.length) { alert('No hay datos para exportar.'); return; }
    if(typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
        alert('La librería PDF está cargando. Intenta en unos segundos.'); return;
    }
    let logoDataUrl = null;
    try {
        const resp = await fetch('logo.png');
        const blob = await resp.blob();
        logoDataUrl = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch(e) {}

    const { jsPDF: JSPDF } = window.jspdf || {};
    const doc = JSPDF
        ? new JSPDF({ orientation:'landscape', unit:'mm', format:'letter' })
        : new jsPDF({ orientation:'landscape', unit:'mm', format:'letter' });

    const pageW = 279.4, pageH = 215.9, mX = 15;
    const BLUE = [30,64,175], LBLUE = [96,165,250];

    function drawLayout(pageNum) {
        if(logoDataUrl) doc.addImage(logoDataUrl,'PNG',pageW-34,5,22,22);
        doc.setTextColor(...BLUE); doc.setFontSize(7); doc.setFont('helvetica','bold');
        doc.text('A-MAQ S.A.',pageW-23,29,{align:'center'});
        doc.setDrawColor(...BLUE); doc.setLineWidth(0.8);
        doc.line(mX,31,pageW-mX,31);
        doc.setLineWidth(0.5); doc.line(mX,pageH-20,pageW-mX,pageH-20);
        doc.setFillColor(...BLUE);  doc.circle(-4,pageH+3,18,'F');
        doc.setFillColor(...LBLUE); doc.circle(pageW+4,pageH+3,18,'F');
        doc.setTextColor(...BLUE); doc.setFontSize(7); doc.setFont('helvetica','normal');
        doc.text('+57 300 8622954   •   info@a-maq.com   •   www.a-maq.com',pageW/2,pageH-14,{align:'center'});
        doc.setTextColor(130); doc.setFontSize(7);
        doc.text(`Pág. ${pageNum}`,pageW-mX,pageH-14,{align:'right'});
    }

    drawLayout(1);
    doc.setTextColor(...BLUE); doc.setFontSize(13); doc.setFont('helvetica','bold');
    doc.text('Reporte de Cierres CSAT — Departamento CBM',mX,22);
    doc.setTextColor(90); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'})}`,mX,27.5);

    const scores = data.filter(t=>t.csatScore&&!t.clientNoResponse).map(t=>parseFloat(t.csatScore));
    const avg = scores.length ? (scores.reduce((s,v)=>s+v,0)/scores.length).toFixed(2) : '—';
    doc.text(`Total: ${data.length}  |  Con CSAT: ${scores.length}  |  Promedio: ${avg}  |  Sin respuesta: ${data.filter(t=>t.clientNoResponse).length}  |  Pendientes: ${data.filter(t=>!t.csatScore&&!t.clientNoResponse).length}`,mX,33);

    doc.autoTable({
        startY: 38,
        head: [['Período','Cliente / Planta','Analistas','Servicio','Estado Cierre','Observaciones','Evidencia']],
        body: data.map(t => {
            const cierre = _csatEstadoCierre(t);
            const nFiles = (t.evidenceFiles||[]).length;
            const evid = [
                nFiles > 0 ? `${nFiles} archivo(s)` : '',
                (t.evidenceNotes||'').trim()
            ].filter(Boolean).join('\n') || '—';
            return [
                formatReportPeriod(t.mesFacturacion||t.period),
                t.plantName ? `${t.client}\n${t.plantName}` : t.client,
                formatAnalystDisplay(t),
                t.serviceType||'-',
                cierre.label.replace(/[⭐⚠️🕐]/g,'').trim(),
                t.csatObservations||'',
                evid
            ];
        }),
        styles: { fontSize:7.5, cellPadding:2 },
        headStyles: { fillColor:BLUE, textColor:[255,255,255], fontStyle:'bold' },
        alternateRowStyles: { fillColor:[239,246,255] },
        columnStyles: { 0:{cellWidth:20}, 1:{cellWidth:42}, 2:{cellWidth:38}, 3:{cellWidth:26}, 4:{cellWidth:28}, 5:{cellWidth:'auto'}, 6:{cellWidth:40} },
        margin: { left:mX, right:mX, bottom:25 },
        didDrawPage: d => { if(d.pageNumber>1) drawLayout(d.pageNumber); }
    });

    doc.save(`Cierres_CSAT_${new Date().toISOString().slice(0,10)}.pdf`);
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

function getExecutionMonths(task) {
    if(!task.scheduledDays || task.scheduledDays.length === 0) return '—';
    const months = new Set();
    task.scheduledDays
        .filter(d => d.type === 'field' && d.date)
        .forEach(d => months.add(d.date.slice(0, 7)));
    if(months.size === 0)
        task.scheduledDays.filter(d => d.date).forEach(d => months.add(d.date.slice(0, 7)));
    if(months.size === 0) return '—';
    return [...months].sort().map(ym => {
        const [y, m] = ym.split('-');
        return `${monthNames[parseInt(m)-1]} ${y}`;
    }).join(', ');
}

function formatAnalystDisplay(t) {
    if(t.analysts_assignment && t.analysts_assignment.length > 1) {
        return t.analysts_assignment.map(a => `${a.name} (${a.percentage}%)`).join(', ');
    }
    return t.analyst || '-';
}

let reportSortState = { column: null, dir: 'asc' };

function sortReportBy(column) {
    if (reportSortState.column === column) {
        reportSortState.dir = reportSortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        reportSortState.column = column;
        reportSortState.dir = 'asc';
    }
    renderReportsTable();
}

function renderReportsTable() {
    const container = document.getElementById('reports-table-container');
    if(!container) return;
    if (tasks.length === 0) { renderSkeletonTable(container, 7, 5); return; }
    let data = getReportData();
    const total = data.reduce((sum, t) => sum + (t.budget || 0), 0);

    if(data.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-secondary); font-size:0.9rem;">No se encontraron gestiones con los filtros aplicados.</div>`;
        return;
    }

    // Ordenamiento por columna
    if (reportSortState.column) {
        const statusOrder = { proyectada: 0, programada: 1, ejecutada: 2, facturada: 3 };
        const getVal = (t) => {
            switch (reportSortState.column) {
                case 'period':  return t.mesFacturacion || t.period || '';
                case 'client':  return (t.client || '').toLowerCase() + (t.plantName ? ' ' + t.plantName.toLowerCase() : '');
                case 'budget':  return t.budget || 0;
                case 'analyst': return (formatAnalystDisplay(t) || '').toLowerCase();
                case 'service': return (t.serviceType || '').toLowerCase();
                case 'status':  return statusOrder[t.status] ?? 99;
                case 'details':   return (t.serviceDetails || '').toLowerCase();
                case 'executed':  return getExecutionMonths(t);
                default:          return '';
            }
        };
        const dir = reportSortState.dir === 'asc' ? 1 : -1;
        data = data.slice().sort((a, b) => {
            const va = getVal(a), vb = getVal(b);
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va).localeCompare(String(vb), 'es') * dir;
        });
    }

    const sortArrow = (col) => {
        if (reportSortState.column !== col) return '<span style="opacity:0.3;">↕</span>';
        return reportSortState.dir === 'asc' ? '↑' : '↓';
    };
    const thSort = (col, label, extraStyle = '') =>
        `<th onclick="sortReportBy('${col}')" style="cursor:pointer; user-select:none; ${extraStyle}">${label} <span style="font-size:0.75em;">${sortArrow(col)}</span></th>`;

    container.innerHTML = `
        <table class="data-table" style="font-size:0.8rem; width:100%;">
            <thead>
                <tr>
                    ${thSort('period',    'Facturación',          'min-width:110px')}
                    ${thSort('executed', 'Mes Ejecutado',        'min-width:110px')}
                    ${thSort('client',  'Cliente (Planta)',     'min-width:160px')}
                    ${thSort('budget',  'Monto ($)',            'min-width:110px; text-align:right')}
                    ${thSort('analyst', 'Analistas',            'min-width:200px')}
                    ${thSort('service', 'Servicio Realizado',   'min-width:120px')}
                    ${thSort('status',  'Estado',               'min-width:90px')}
                    ${thSort('details', 'Detalle p/Comercial',  'min-width:170px')}
                </tr>
            </thead>
            <tbody>
                ${data.map(t => {
                    const det = (t.serviceDetails || '').trim();
                    const detCell = det
                        ? `<span onclick="openServiceDetailsModal('${t.id}')" title="${det.replace(/"/g,'&quot;')}" style="cursor:pointer; color:var(--clr-blue); display:inline-block; max-width:170px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:bottom;">📝 ${det.length > 30 ? det.substring(0,30)+'…' : det}</span>`
                        : '<span style="color:#cbd5e1;">—</span>';
                    return `
                    <tr>
                        <td>${formatReportPeriod(t.mesFacturacion || t.period)}</td>
                        <td style="font-size:0.75rem; color:var(--text-secondary);">${getExecutionMonths(t)}</td>
                        <td><strong>${t.client}</strong>${t.plantName ? `<br><span style="font-size:0.72rem;color:var(--clr-blue);font-weight:600;">📍 ${t.plantName}</span>` : ''}</td>
                        <td style="text-align:right; color:var(--clr-green); font-weight:700;">$${(t.budget||0).toLocaleString('es-CO')}</td>
                        <td style="font-size:0.75rem">${formatAnalystDisplay(t)}</td>
                        <td>${t.serviceType || '-'}</td>
                        <td><span class="status-tag ${t.status}" style="font-size:0.7rem">${t.status.toUpperCase()}</span></td>
                        <td style="font-size:0.75rem">${detCell}</td>
                    </tr>
                `;}).join('')}
            </tbody>
            <tfoot>
                <tr style="background: #f0f9ff; font-weight:800; border-top: 2px solid var(--clr-blue);">
                    <td colspan="3" style="padding: 0.75rem; font-size:0.85rem; color:var(--clr-blue)">TOTAL (${data.length} gestiones)</td>
                    <td style="text-align:right; color:var(--clr-green); font-size:1rem; padding:0.75rem;">$${total.toLocaleString('es-CO')}</td>
                    <td colspan="4"></td>
                </tr>
            </tfoot>
        </table>
    `;
}

function exportReportCSV() {
    const data = getReportData();
    if(data.length === 0) { alert('No hay datos para exportar.'); return; }

    const headers = ['Facturación','Mes Ejecutado','Cliente (Planta)','Monto ($)','Analistas','Servicio Realizado','Estado','Detalle p/Comercial'];
    const rows = data.map(t => [
        formatReportPeriod(t.mesFacturacion || t.period),
        getExecutionMonths(t),
        t.plantName ? `${t.client} - ${t.plantName}` : t.client,
        t.budget || 0,
        formatAnalystDisplay(t),
        t.serviceType || '',
        t.status,
        t.serviceDetails || ''
    ]);
    const total = data.reduce((s, t) => s + (t.budget || 0), 0);
    rows.push(['TOTAL', '', '', total, '', '', '', '']);

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
        getExecutionMonths(t),
        t.plantName ? `${t.client}\n${t.plantName}` : t.client,
        '$' + (t.budget||0).toLocaleString('es-CO'),
        formatAnalystDisplay(t),
        t.serviceType || '-',
        t.status.toUpperCase()
    ]);
    tableData.push([`TOTAL (${data.length} gestiones)`, '', '', '$' + total.toLocaleString('es-CO'), '', '', '']);

    doc.autoTable({
        startY,
        head: [['Facturación','Mes Ejecutado','Cliente (Planta)','Monto ($)','Analistas','Tipo de Servicio','Estado']],
        body: tableData,
        styles: { fontSize: 7.5, cellPadding: 2.5, font:'helvetica' },
        headStyles: { fillColor: BLUE, textColor: 255, fontStyle:'bold', fontSize: 7.5 },
        alternateRowStyles: { fillColor: [245, 248, 255] },
        columnStyles: {
            0: { cellWidth: 26 },
            1: { cellWidth: 26 },
            2: { cellWidth: 52 },
            3: { cellWidth: 28, halign:'right' },
            4: { cellWidth: 62 },
            5: { cellWidth: 34 },
            6: { cellWidth: 21, halign:'center' }
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
            if(d.column.index === 6 && d.row.section === 'body' && d.row.index < tableData.length - 1) {
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

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO DE INVENTARIO CBM
// ══════════════════════════════════════════════════════════════════════════════

let dbInventoryItems = [];
let dbInventoryLoans = []; // préstamos activos (checked_in_at IS NULL)
let dbInventoryIncidents = []; // incidentes abiertos (resolved_at IS NULL)
let _inventoryTab    = 'catalogo'; // 'catalogo' | 'encampo' | 'historial'
let _invScanAction   = null; // { type: 'checkout'|'checkin', itemId, loanId }
let _invHtml5Scanner = null;

const _invCategories = ['Vibraciones', 'Termografía', 'Ultrasonido', 'Balanceo', 'Alineación', 'Rotodinámico', 'Capacitación', 'General'];
const _invCatLabel = {
    Vibraciones: '〰️ Vibraciones', Termografía: '🌡️ Termografía', Ultrasonido: '🔊 Ultrasonido',
    Balanceo: '⚖️ Balanceo', Alineación: '📐 Alineación', Rotodinámico: '⚙️ Rotodinámico',
    Capacitación: '📚 Capacitación', General: '🔧 General'
};
const _invStatusLabel = { disponible:'Disponible', prestado:'En Campo', dañado:'Dañado', perdido:'Perdido' };
const _invStatusColor = { disponible:'#16a34a', prestado:'#d97706', dañado:'#dc2626', perdido:'#7f1d1d' };
const _invStatusBg    = { disponible:'#f0fdf4', prestado:'#fffbeb', dañado:'#fef2f2', perdido:'#fef2f2' };

async function loadInventoryData() {
    if(!supabaseClient) return;
    const [{ data: items }, { data: loans }, { data: incidents }] = await Promise.all([
        supabaseClient.from('inventory_items').select('*').order('category').order('name'),
        supabaseClient.from('inventory_loans').select('*').is('checked_in_at', null).order('checked_out_at', { ascending: false }),
        supabaseClient.from('inventory_incidents').select('*').is('resolved_at', null).order('created_at', { ascending: false })
    ]);
    if(items) dbInventoryItems = items;
    if(loans) dbInventoryLoans = loans;
    if(incidents) dbInventoryIncidents = incidents;
}

function _invOpenIncident(itemId) {
    return dbInventoryIncidents.find(i => i.item_id === itemId);
}

function _invCalibrationStatus(item) {
    if(!item.requires_calibration) return null;
    if(!item.last_calibration_date) return { label: 'Sin calibrar', color: '#dc2626', bg: '#fef2f2' };
    const last = new Date(item.last_calibration_date);
    const next = new Date(last);
    next.setDate(next.getDate() + (item.calibration_interval_days || 365));
    const daysLeft = Math.ceil((next - new Date()) / 86400000);
    const nextStr = next.toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' });
    if(daysLeft < 0)  return { label: `Vencida hace ${Math.abs(daysLeft)}d`, color:'#dc2626', bg:'#fef2f2' };
    if(daysLeft <= 30) return { label: `Vence en ${daysLeft}d (${nextStr})`, color:'#d97706', bg:'#fffbeb' };
    return { label: `Vigente hasta ${nextStr}`, color:'#16a34a', bg:'#f0fdf4' };
}

function initInventoryView() {
    loadInventoryData().then(() => renderInventoryView()).catch(e => console.error(e));
}

function switchInventoryTab(tab) {
    _inventoryTab = tab;
    renderInventoryView();
}

function renderInventoryView() {
    const container = document.getElementById('inventory-view-container');
    if(!container) return;
    const role = currentUserProfile?.role || 'viewer';

    if(role === 'analyst') {
        renderAnalystInventory(container);
        return;
    }

    if(role !== 'admin') {
        container.innerHTML = '<div style="text-align:center;padding:3rem;color:#94a3b8;">No tienes permiso para ver esta sección.</div>';
        return;
    }

    const tabs = [
        { id:'catalogo',  label:'📦 Catálogo' },
        { id:'encampo',   label:'🚚 En Campo' },
        { id:'historial', label:'📋 Historial' }
    ];

    container.innerHTML = `
        <div class="kanban-header" style="margin-bottom:1.5rem;">
            <div>
                <h2>Control de Inventario CBM</h2>
                <p class="subtitle">Gestiona los equipos y herramientas del departamento.</p>
            </div>
            <button class="btn-primary" onclick="openInventoryScannerModal()" style="display:flex;align-items:center;gap:0.5rem;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
                Escanear QR
            </button>
        </div>
        <div class="view-toggle-group" style="margin-bottom:1.5rem;">
            ${tabs.map(t => `<button id="invtab-${t.id}" onclick="switchInventoryTab('${t.id}')" ${_inventoryTab===t.id?'class="active"':''}>${t.label}</button>`).join('')}
        </div>
        <div id="inv-tab-content"></div>
    `;

    if(_inventoryTab === 'catalogo')   renderInventoryCatalog();
    else if(_inventoryTab === 'encampo')   renderInventoryEnCampo();
    else if(_inventoryTab === 'historial') renderInventoryHistorial();
}

function renderAnalystInventory(container) {
    const analystName = currentUserProfile?.analyst_name;
    const myLoans = dbInventoryLoans.filter(l => l.analyst_name === analystName);
    const myItems = myLoans.map(l => {
        const item = dbInventoryItems.find(i => i.id === l.item_id);
        return { loan: l, item };
    }).filter(x => x.item);

    const permanentItems = dbInventoryItems.filter(i => i.is_permanently_assigned && i.assigned_analyst === analystName);

    container.innerHTML = `
        <div class="kanban-header" style="margin-bottom:1.5rem;">
            <div>
                <h2>Mis Equipos</h2>
                <p class="subtitle">Equipos que tenés en tu poder en este momento.</p>
            </div>
            <button class="btn-primary" onclick="openInventoryScannerModal()" style="display:flex;align-items:center;gap:0.5rem;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
                Escanear QR
            </button>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);padding:1.5rem;margin-bottom:1.25rem;">
            <h4 style="margin:0 0 1rem;color:var(--clr-blue);">🚚 En mi poder (${myItems.length})</h4>
            ${myItems.length === 0
                ? '<p style="color:#94a3b8;font-size:0.85rem;">No tenés equipos registrados actualmente.</p>'
                : myItems.map(({ loan, item }) => {
                    const days = Math.floor((Date.now() - new Date(loan.checked_out_at)) / 86400000);
                    return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.65rem 0;border-bottom:1px solid #f1f5f9;">
                        <div>
                            <div style="font-weight:600;font-size:0.9rem;">${item.name}</div>
                            <div style="font-size:0.72rem;color:#64748b;">${_invCatLabel[item.category]||item.category} · Desde hace ${days} día${days!==1?'s':''}</div>
                        </div>
                    </div>`;
                }).join('')
            }
        </div>
        ${permanentItems.length > 0 ? `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);padding:1.5rem;">
            <h4 style="margin:0 0 1rem;color:#7c3aed;">📌 Asignados permanentemente</h4>
            ${permanentItems.map(item => `
                <div style="padding:0.5rem 0;border-bottom:1px solid #f1f5f9;font-size:0.85rem;">
                    <strong>${item.name}</strong>
                    ${item.serial_number ? `<span style="color:#64748b;font-size:0.75rem;"> · ${item.serial_number}</span>` : ''}
                </div>
            `).join('')}
        </div>` : ''}
    `;
}

function renderInventoryCatalog() {
    const el = document.getElementById('inv-tab-content');
    if(!el) return;

    const categories = _invCategories;

    el.innerHTML = `
        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-bottom:1rem;">
            <button class="btn-secondary" onclick="printAllInventoryQRs()" ${dbInventoryItems.length===0?'disabled':''}>🖨️ Imprimir todos los QR</button>
            <button class="btn-primary" onclick="openAddInventoryItemModal()">+ Agregar ítem</button>
        </div>
        ${categories.map(cat => {
            const items = dbInventoryItems.filter(i => i.category === cat);
            if(items.length === 0) return '';
            return `
            <div style="margin-bottom:1.5rem;">
                <h4 style="font-size:0.8rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">${_invCatLabel[cat]}</h4>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);overflow:hidden;">
                    <table class="data-table" style="font-size:0.82rem;">
                        <thead>
                            <tr>
                                <th style="width:44px;">QR</th>
                                <th>Nombre</th>
                                <th>Serial</th>
                                <th>Estado</th>
                                <th>Calibración</th>
                                <th>Asignado a</th>
                                <th style="width:120px;text-align:center;">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(item => {
                                const sc = _invStatusColor[item.status] || '#64748b';
                                const sb = _invStatusBg[item.status] || '#f8fafc';
                                const activeLoan = dbInventoryLoans.find(l => l.item_id === item.id);
                                const openIncident = _invOpenIncident(item.id);
                                const isTrouble = item.status === 'dañado' || item.status === 'perdido';
                                const calib = _invCalibrationStatus(item);
                                return `
                                <tr>
                                    <td style="text-align:center;">
                                        <button onclick="showInventoryQR('${item.id}')" title="Ver QR" style="background:none;border:1px solid #cbd5e1;border-radius:4px;padding:3px 6px;cursor:pointer;font-size:0.9rem;">📷</button>
                                    </td>
                                    <td>
                                        <strong>${item.name}</strong>
                                        ${item.equipment_id ? '<span title="Vinculado a un equipo de gestiones" style="font-size:0.68rem;background:#eef2ff;color:#4f46e5;border:1px solid #4f46e533;padding:1px 6px;border-radius:99px;margin-left:6px;">🔗 Equipo</span>' : ''}
                                        ${item.description ? `<div style="font-size:0.72rem;color:#94a3b8;">${item.description}</div>` : ''}
                                        ${isTrouble && openIncident ? `<div style="font-size:0.72rem;color:#dc2626;margin-top:2px;">⚠️ ${openIncident.note} <span style="color:#94a3b8;">— ${openIncident.reported_by}</span></div>` : ''}
                                    </td>
                                    <td style="color:#64748b;">${item.serial_number || '—'}</td>
                                    <td>
                                        <span style="background:${sb};color:${sc};border:1px solid ${sc}33;font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:99px;">
                                            ${_invStatusLabel[item.status]||item.status}
                                        </span>
                                        ${activeLoan ? `<div style="font-size:0.7rem;color:#d97706;margin-top:2px;">→ ${activeLoan.analyst_name}</div>` : ''}
                                    </td>
                                    <td>
                                        ${calib ? `<span style="background:${calib.bg};color:${calib.color};border:1px solid ${calib.color}33;font-size:0.7rem;font-weight:600;padding:2px 8px;border-radius:99px;white-space:nowrap;">${calib.label}</span>` : '<span style="color:#cbd5e1;">—</span>'}
                                    </td>
                                    <td style="font-size:0.78rem;color:#64748b;">
                                        ${item.is_permanently_assigned ? `📌 ${item.assigned_analyst||'—'}` : '—'}
                                    </td>
                                    <td style="text-align:center;white-space:nowrap;">
                                        <button onclick="openEditInventoryItemModal('${item.id}')" title="Editar" style="background:none;border:none;cursor:pointer;color:#3b82f6;font-size:1rem;">✏️</button>
                                        <button onclick="deleteInventoryItem('${item.id}')" title="Eliminar" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:1rem;">🗑️</button>
                                        ${item.requires_calibration ? `<button onclick="registerCalibrationToday('${item.id}')" title="Registrar calibración hoy" style="background:none;border:none;cursor:pointer;font-size:1rem;">📅</button>` : ''}
                                        ${isTrouble
                                            ? `<button onclick="openResolveIncidentModal('${item.id}')" title="Marcar como disponible" style="background:none;border:none;cursor:pointer;color:#16a34a;font-size:1rem;">✅</button>`
                                            : `<button onclick="openReportIncidentModal('${item.id}')" title="Reportar daño/pérdida" style="background:none;border:none;cursor:pointer;color:#d97706;font-size:1rem;">⚠️</button>`}
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        }).join('')}
        ${dbInventoryItems.length === 0 ? '<div style="text-align:center;padding:3rem;color:#94a3b8;">No hay ítems en el inventario todavía. Agrega el primero.</div>' : ''}
    `;
}

function renderInventoryEnCampo() {
    const el = document.getElementById('inv-tab-content');
    if(!el) return;

    if(dbInventoryLoans.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:3rem;color:#94a3b8;">✅ Todo el inventario está en A-MAQ. No hay ítems en campo.</div>';
        return;
    }

    const rows = dbInventoryLoans.map(loan => {
        const item = dbInventoryItems.find(i => i.id === loan.item_id);
        if(!item) return '';
        const days = Math.floor((Date.now() - new Date(loan.checked_out_at)) / 86400000);
        const since = new Date(loan.checked_out_at).toLocaleDateString('es-CO', { day:'numeric', month:'short' });
        const alertStyle = days >= 7 ? 'color:#dc2626;font-weight:700;' : days >= 3 ? 'color:#d97706;' : '';
        return `
        <tr>
            <td><strong>${loan.analyst_name}</strong></td>
            <td>${item.name}<div style="font-size:0.72rem;color:#64748b;">${_invCatLabel[item.category]||item.category}</div></td>
            <td>${since}</td>
            <td style="${alertStyle}">${days} día${days!==1?'s':''}</td>
            <td style="text-align:center;">
                <button class="btn-secondary" onclick="adminCheckIn('${loan.id}','${item.id}')" style="font-size:0.75rem;padding:4px 10px;">Registrar devolución</button>
            </td>
        </tr>`;
    }).join('');

    el.innerHTML = `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);overflow:hidden;">
            <table class="data-table" style="font-size:0.82rem;">
                <thead>
                    <tr>
                        <th>Analista</th>
                        <th>Ítem</th>
                        <th>Salida</th>
                        <th>Días fuera</th>
                        <th style="text-align:center;">Acción</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

let _invHistorialCache = [];
let _invHistorialFilters = { analyst: '', item: '', dateFrom: '', dateTo: '' };

async function renderInventoryHistorial() {
    const el = document.getElementById('inv-tab-content');
    if(!el) return;
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:#94a3b8;">Cargando historial…</div>';

    const { data: allLoans, error } = await supabaseClient
        .from('inventory_loans')
        .select('*')
        .not('checked_in_at', 'is', null)
        .order('checked_out_at', { ascending: false })
        .limit(500);

    if(error) {
        el.innerHTML = '<div style="text-align:center;padding:3rem;color:#dc2626;">Error cargando historial.</div>';
        return;
    }
    _invHistorialCache = allLoans || [];
    _renderInventoryHistorialFiltered();
}

function clearInvHistorialFilters() {
    _invHistorialFilters = { analyst: '', item: '', dateFrom: '', dateTo: '' };
    _renderInventoryHistorialFiltered();
}

function applyInvHistorialFilters() {
    _invHistorialFilters.analyst  = document.getElementById('invHist_filterAnalyst')?.value || '';
    _invHistorialFilters.item     = document.getElementById('invHist_filterItem')?.value || '';
    _invHistorialFilters.dateFrom = document.getElementById('invHist_filterFrom')?.value || '';
    _invHistorialFilters.dateTo   = document.getElementById('invHist_filterTo')?.value || '';
    _renderInventoryHistorialFiltered();
}

function _renderInventoryHistorialFiltered() {
    const el = document.getElementById('inv-tab-content');
    if(!el) return;

    if(_invHistorialCache.length === 0 && dbInventoryLoans.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:3rem;color:#94a3b8;">No hay movimientos históricos todavía.</div>';
        return;
    }

    const f = _invHistorialFilters;
    const data = _invHistorialCache.filter(loan => {
        if(f.analyst && loan.analyst_name !== f.analyst) return false;
        if(f.item && loan.item_id !== f.item) return false;
        if(f.dateFrom && loan.checked_out_at < f.dateFrom) return false;
        if(f.dateTo && loan.checked_out_at > f.dateTo + 'T23:59:59') return false;
        return true;
    });

    // ── Ranking de frecuencia de uso (salidas históricas + préstamos activos) ──
    const usageCount = {};
    _invHistorialCache.forEach(l => { usageCount[l.item_id] = (usageCount[l.item_id]||0) + 1; });
    dbInventoryLoans.forEach(l => { usageCount[l.item_id] = (usageCount[l.item_id]||0) + 1; });
    const ranking = dbInventoryItems.map(item => ({ item, count: usageCount[item.id] || 0 }))
        .sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, ...ranking.map(r => r.count));

    const rankingHTML = ranking.length === 0 ? '' : `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);padding:1.25rem;margin-bottom:1.5rem;">
            <h4 style="margin:0 0 1rem;font-size:0.85rem;color:var(--clr-blue);">📊 Frecuencia de uso por ítem</h4>
            ${ranking.map(r => `
                <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
                    <div style="flex:0 0 180px;font-size:0.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.item.name}">${r.item.name}</div>
                    <div style="flex:1;background:#f1f5f9;border-radius:4px;height:14px;overflow:hidden;">
                        <div style="width:${(r.count/maxCount*100).toFixed(0)}%;background:${r.count===0?'#cbd5e1':'var(--clr-blue)'};height:100%;"></div>
                    </div>
                    <div style="flex:0 0 70px;text-align:right;font-size:0.75rem;color:#64748b;">${r.count} salida${r.count!==1?'s':''}</div>
                </div>
            `).join('')}
        </div>`;

    // ── Filtros ─────────────────────────────────────────────────────────────
    const analystOptions = [...new Set(_invHistorialCache.map(l => l.analyst_name))].sort();
    const filtersHTML = `
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:flex-end;background:#fff;padding:1rem;border-radius:var(--radius-lg);border:1px solid #e2e8f0;margin-bottom:1.25rem;">
            <div style="flex:1;min-width:150px;">
                <label style="font-size:0.65rem;font-weight:700;color:#64748b;text-transform:uppercase;display:block;margin-bottom:4px;">Analista</label>
                <select id="invHist_filterAnalyst" onchange="applyInvHistorialFilters()" style="width:100%;padding:0.45rem;font-size:0.8rem;border:1px solid #cbd5e1;border-radius:4px;">
                    <option value="">Todos</option>
                    ${analystOptions.map(a => `<option value="${a}" ${f.analyst===a?'selected':''}>${a}</option>`).join('')}
                </select>
            </div>
            <div style="flex:1;min-width:150px;">
                <label style="font-size:0.65rem;font-weight:700;color:#64748b;text-transform:uppercase;display:block;margin-bottom:4px;">Ítem</label>
                <select id="invHist_filterItem" onchange="applyInvHistorialFilters()" style="width:100%;padding:0.45rem;font-size:0.8rem;border:1px solid #cbd5e1;border-radius:4px;">
                    <option value="">Todos</option>
                    ${dbInventoryItems.map(i => `<option value="${i.id}" ${f.item===i.id?'selected':''}>${i.name}</option>`).join('')}
                </select>
            </div>
            <div style="min-width:130px;">
                <label style="font-size:0.65rem;font-weight:700;color:#64748b;text-transform:uppercase;display:block;margin-bottom:4px;">Desde</label>
                <input type="date" id="invHist_filterFrom" value="${f.dateFrom}" onchange="applyInvHistorialFilters()" style="width:100%;padding:0.42rem;font-size:0.8rem;border:1px solid #cbd5e1;border-radius:4px;">
            </div>
            <div style="min-width:130px;">
                <label style="font-size:0.65rem;font-weight:700;color:#64748b;text-transform:uppercase;display:block;margin-bottom:4px;">Hasta</label>
                <input type="date" id="invHist_filterTo" value="${f.dateTo}" onchange="applyInvHistorialFilters()" style="width:100%;padding:0.42rem;font-size:0.8rem;border:1px solid #cbd5e1;border-radius:4px;">
            </div>
            <button class="btn-secondary" onclick="clearInvHistorialFilters()" style="font-size:0.8rem;">Limpiar filtros</button>
        </div>`;

    if(data.length === 0) {
        el.innerHTML = rankingHTML + filtersHTML + '<div style="text-align:center;padding:3rem;color:#94a3b8;">No hay movimientos con estos filtros.</div>';
        return;
    }

    const rows = data.map(loan => {
        const item = dbInventoryItems.find(i => i.id === loan.item_id);
        const out  = new Date(loan.checked_out_at).toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' });
        const inn  = new Date(loan.checked_in_at).toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' });
        const days = Math.floor((new Date(loan.checked_in_at) - new Date(loan.checked_out_at)) / 86400000);
        return `
        <tr>
            <td style="color:#64748b;">${out}</td>
            <td><strong>${loan.analyst_name}</strong></td>
            <td>${item?.name || '(ítem eliminado)'}<div style="font-size:0.72rem;color:#94a3b8;">${item ? (_invCatLabel[item.category]||item.category) : ''}</div></td>
            <td style="color:#64748b;">${inn}</td>
            <td style="color:#64748b;">${days} día${days!==1?'s':''}</td>
        </tr>`;
    }).join('');

    el.innerHTML = rankingHTML + filtersHTML + `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);overflow:hidden;">
            <table class="data-table" style="font-size:0.82rem;">
                <thead>
                    <tr>
                        <th>Salida</th>
                        <th>Analista</th>
                        <th>Ítem</th>
                        <th>Devolución</th>
                        <th>Duración</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// ── CRUD de ítems ──────────────────────────────────────────────────────────────

function toggleAnalystAssign() {
    const checked = document.getElementById('invItem_permanent')?.checked;
    const row = document.getElementById('invItem_analystRow');
    if(row) row.style.display = checked ? 'block' : 'none';
}

function toggleCalibrationFields() {
    const checked = document.getElementById('invItem_requiresCalibration')?.checked;
    const row = document.getElementById('invItem_calibrationRow');
    if(row) row.style.display = checked ? 'flex' : 'none';
}

function _populateInvAnalystSelect() {
    const sel = document.getElementById('invItem_analyst');
    if(!sel) return;
    sel.innerHTML = dbAnalysts.filter(a => a.is_active !== false).map(a =>
        `<option value="${a.name}">${a.name}</option>`
    ).join('');
}

function _populateInvEquipmentSelect() {
    const sel = document.getElementById('invItem_equipment');
    if(!sel) return;
    sel.innerHTML = '<option value="">— No es un equipo de gestión —</option>' +
        dbEquipment.filter(e => e.is_active !== false).map(e =>
            `<option value="${e.id}">${e.name}${e.serial_number ? ' · '+e.serial_number : ''}</option>`
        ).join('');
}

function onInvItemEquipmentChange() {
    const equipId = document.getElementById('invItem_equipment').value;
    if(!equipId) return;
    const equip = dbEquipment.find(e => e.id === equipId);
    if(!equip) return;
    // Autocompleta nombre/serial desde equipment para no duplicar el dato manualmente
    if(!document.getElementById('invItem_name').value.trim()) {
        document.getElementById('invItem_name').value = equip.name || '';
    }
    if(!document.getElementById('invItem_serial').value.trim()) {
        document.getElementById('invItem_serial').value = equip.serial_number || '';
    }
}

function openAddInventoryItemModal() {
    document.getElementById('invItemModalTitle').textContent = 'Agregar Ítem';
    document.getElementById('invItem_editId').value = '';
    document.getElementById('invItem_name').value = '';
    document.getElementById('invItem_category').value = 'Vibraciones';
    document.getElementById('invItem_serial').value = '';
    document.getElementById('invItem_description').value = '';
    document.getElementById('invItem_permanent').checked = false;
    document.getElementById('invItem_analystRow').style.display = 'none';
    document.getElementById('invItem_requiresCalibration').checked = false;
    document.getElementById('invItem_calibrationRow').style.display = 'none';
    document.getElementById('invItem_lastCalibration').value = '';
    document.getElementById('invItem_calibrationInterval').value = '365';
    _populateInvAnalystSelect();
    _populateInvEquipmentSelect();
    document.getElementById('invItem_equipment').value = '';
    document.getElementById('inventoryItemModal').classList.add('active');
}

function openEditInventoryItemModal(itemId) {
    const item = dbInventoryItems.find(i => i.id === itemId);
    if(!item) return;
    document.getElementById('invItemModalTitle').textContent = 'Editar Ítem';
    document.getElementById('invItem_editId').value = itemId;
    document.getElementById('invItem_name').value = item.name || '';
    document.getElementById('invItem_category').value = item.category || 'General';
    document.getElementById('invItem_serial').value = item.serial_number || '';
    document.getElementById('invItem_description').value = item.description || '';
    document.getElementById('invItem_permanent').checked = !!item.is_permanently_assigned;
    document.getElementById('invItem_analystRow').style.display = item.is_permanently_assigned ? 'block' : 'none';
    document.getElementById('invItem_requiresCalibration').checked = !!item.requires_calibration;
    document.getElementById('invItem_calibrationRow').style.display = item.requires_calibration ? 'flex' : 'none';
    document.getElementById('invItem_lastCalibration').value = item.last_calibration_date || '';
    document.getElementById('invItem_calibrationInterval').value = item.calibration_interval_days || 365;
    _populateInvAnalystSelect();
    _populateInvEquipmentSelect();
    document.getElementById('invItem_equipment').value = item.equipment_id || '';
    if(item.assigned_analyst) {
        const sel = document.getElementById('invItem_analyst');
        if(sel) sel.value = item.assigned_analyst;
    }
    document.getElementById('inventoryItemModal').classList.add('active');
}

async function saveInventoryItem() {
    const name = document.getElementById('invItem_name').value.trim();
    if(!name) { showToast('El nombre es obligatorio', 'error'); return; }

    const isPermanent = document.getElementById('invItem_permanent').checked;
    const requiresCalibration = document.getElementById('invItem_requiresCalibration').checked;
    const payload = {
        name,
        category:               document.getElementById('invItem_category').value,
        serial_number:          document.getElementById('invItem_serial').value.trim() || null,
        description:            document.getElementById('invItem_description').value.trim() || null,
        is_permanently_assigned: isPermanent,
        assigned_analyst:       isPermanent ? document.getElementById('invItem_analyst').value : null,
        equipment_id:           document.getElementById('invItem_equipment').value || null,
        requires_calibration:      requiresCalibration,
        last_calibration_date:     requiresCalibration ? (document.getElementById('invItem_lastCalibration').value || null) : null,
        calibration_interval_days: requiresCalibration ? (parseInt(document.getElementById('invItem_calibrationInterval').value) || 365) : null,
        status:                 'disponible'
    };

    const editId = document.getElementById('invItem_editId').value;
    let error;
    if(editId) {
        delete payload.status; // no sobreescribir estado al editar
        ({ error } = await supabaseClient.from('inventory_items').update(payload).eq('id', editId));
    } else {
        ({ error } = await supabaseClient.from('inventory_items').insert(payload));
    }

    if(error) { showToast('Error guardando: ' + error.message, 'error'); return; }
    showToast(editId ? 'Ítem actualizado' : 'Ítem agregado', 'success');
    closeModal('inventoryItemModal');
    await loadInventoryData();
    renderInventoryView();
}

async function deleteInventoryItem(itemId) {
    const item = dbInventoryItems.find(i => i.id === itemId);
    if(!confirm(`¿Eliminar "${item?.name}"? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabaseClient.from('inventory_items').delete().eq('id', itemId);
    if(error) { showToast('Error eliminando: ' + error.message, 'error'); return; }
    showToast('Ítem eliminado', 'success');
    await loadInventoryData();
    renderInventoryView();
}

async function registerCalibrationToday(itemId) {
    const item = dbInventoryItems.find(i => i.id === itemId);
    if(!confirm(`¿Registrar calibración de "${item?.name}" con fecha de hoy?`)) return;
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabaseClient.from('inventory_items').update({ last_calibration_date: today }).eq('id', itemId);
    if(error) { showToast('Error registrando calibración: ' + error.message, 'error'); return; }
    showToast('Calibración registrada', 'success');
    await loadInventoryData();
    renderInventoryView();
}

// ── Incidentes (daño / pérdida) ─────────────────────────────────────────────────

function openReportIncidentModal(itemId) {
    const item = dbInventoryItems.find(i => i.id === itemId);
    if(!item) return;
    document.getElementById('invIncidentModalTitle').textContent = `Reportar incidente — ${item.name}`;
    document.getElementById('invIncident_mode').value = 'report';
    document.getElementById('invIncident_itemId').value = itemId;
    document.getElementById('invIncident_typeRow').style.display = 'block';
    document.getElementById('invIncident_type').value = 'dañado';
    document.getElementById('invIncident_note').value = '';
    document.getElementById('invIncident_note').placeholder = 'Describe qué pasó (obligatorio)...';
    document.getElementById('invIncident_submitBtn').textContent = 'Reportar';
    document.getElementById('inventoryIncidentModal').classList.add('active');
}

function openResolveIncidentModal(itemId) {
    const item = dbInventoryItems.find(i => i.id === itemId);
    if(!item) return;
    document.getElementById('invIncidentModalTitle').textContent = `Resolver incidente — ${item.name}`;
    document.getElementById('invIncident_mode').value = 'resolve';
    document.getElementById('invIncident_itemId').value = itemId;
    document.getElementById('invIncident_typeRow').style.display = 'none';
    document.getElementById('invIncident_note').value = '';
    document.getElementById('invIncident_note').placeholder = 'Nota de resolución (opcional)...';
    document.getElementById('invIncident_submitBtn').textContent = 'Marcar como Disponible';
    document.getElementById('inventoryIncidentModal').classList.add('active');
}

async function submitInventoryIncident() {
    const mode   = document.getElementById('invIncident_mode').value;
    const itemId = document.getElementById('invIncident_itemId').value;
    const note   = document.getElementById('invIncident_note').value.trim();
    const reportedBy = currentUserProfile?.analyst_name || currentUserProfile?.display_name || currentUser?.email || 'Desconocido';

    if(mode === 'report') {
        if(!note) { showToast('La nota es obligatoria para reportar un incidente', 'error'); return; }
        const type = document.getElementById('invIncident_type').value;
        const { error: e1 } = await supabaseClient.from('inventory_incidents').insert({
            item_id: itemId, type, note, reported_by: reportedBy
        });
        const { error: e2 } = await supabaseClient.from('inventory_items').update({ status: type }).eq('id', itemId);
        if(e1 || e2) { showToast('Error reportando incidente', 'error'); return; }
        showToast('Incidente reportado', 'success');
    } else {
        const incident = _invOpenIncident(itemId);
        if(incident) {
            await supabaseClient.from('inventory_incidents').update({
                resolved_at: new Date().toISOString(), resolution_note: note || null
            }).eq('id', incident.id);
        }
        const { error } = await supabaseClient.from('inventory_items').update({ status: 'disponible' }).eq('id', itemId);
        if(error) { showToast('Error resolviendo incidente', 'error'); return; }
        showToast('Ítem marcado como disponible', 'success');
    }

    closeModal('inventoryIncidentModal');
    await loadInventoryData();
    renderInventoryView();
}

// ── QR ─────────────────────────────────────────────────────────────────────────

function showInventoryQR(itemId) {
    const item = dbInventoryItems.find(i => i.id === itemId);
    if(!item) return;
    document.getElementById('invQR_itemName').textContent = item.name;
    document.getElementById('invQR_itemSerial').textContent = item.serial_number ? `Serial: ${item.serial_number}` : '';
    document.getElementById('inventoryQRModal').classList.add('active');
    document.getElementById('inventoryQRModal').dataset.itemId = itemId;
    const box = document.getElementById('invQR_canvas');
    box.innerHTML = '';
    setTimeout(() => {
        new QRCode(box, { text: itemId, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    }, 50);
}

function printInventoryQR() {
    const itemId   = document.getElementById('inventoryQRModal').dataset.itemId;
    const item     = dbInventoryItems.find(i => i.id === itemId);
    const box      = document.getElementById('invQR_canvas');
    const canvasEl = box.querySelector('canvas');
    const imgEl    = box.querySelector('img');
    const dataUrl  = canvasEl ? canvasEl.toDataURL('image/png') : (imgEl ? imgEl.src : '');
    const win = window.open('', '_blank');
    win.document.write(`
        <html><head><title>QR ${item?.name}</title>
        <style>body{font-family:Arial,sans-serif;text-align:center;padding:2rem;}
        h3{margin:0.5rem 0 0.25rem;}p{color:#64748b;font-size:0.8rem;}</style></head>
        <body onload="window.print(); window.close();">
            <img src="${dataUrl}" width="220" height="220">
            <h3>${item?.name || ''}</h3>
            ${item?.serial_number ? `<p>Serial: ${item.serial_number}</p>` : ''}
            <p style="font-size:0.65rem;color:#cbd5e1;margin-top:1rem;">${itemId}</p>
        </body></html>`);
    win.document.close();
}

/** Genera un PDF con el QR de cada ítem del inventario en grilla, 15x15mm cada uno, listos para imprimir y pegar. */
async function printAllInventoryQRs() {
    if(dbInventoryItems.length === 0) { showToast('No hay ítems en el inventario', 'error'); return; }
    if(typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
        showToast('La librería PDF está cargando. Intenta en unos segundos.', 'error'); return;
    }
    showToast('Generando PDF…', 'success');

    // Contenedor oculto: qrcodejs necesita un elemento real en el DOM para dibujar el canvas.
    const hiddenContainer = document.createElement('div');
    hiddenContainer.style.position = 'fixed';
    hiddenContainer.style.left = '-9999px';
    document.body.appendChild(hiddenContainer);

    const QR_RENDER_PX = 180; // resolución del canvas para que 15mm se vea nítido al imprimir
    const qrData = dbInventoryItems.map(item => {
        const box = document.createElement('div');
        hiddenContainer.appendChild(box);
        new QRCode(box, { text: item.id, width: QR_RENDER_PX, height: QR_RENDER_PX, correctLevel: QRCode.CorrectLevel.M });
        const canvasEl = box.querySelector('canvas');
        const imgEl    = box.querySelector('img');
        const dataUrl  = canvasEl ? canvasEl.toDataURL('image/png') : (imgEl ? imgEl.src : '');
        return { item, dataUrl };
    });
    document.body.removeChild(hiddenContainer);

    const { jsPDF: JSPDF } = window.jspdf || {};
    const doc = JSPDF ? new JSPDF({ unit: 'mm', format: 'letter' }) : new jsPDF({ unit: 'mm', format: 'letter' });

    const pageW = 215.9, pageH = 279.4;
    const marginX = 12, marginY = 14;
    const qrSize = 15;      // mm, tamaño solicitado para que no sea invasivo
    const cellW  = qrSize + 6;
    const cellH  = qrSize + 9; // espacio extra abajo para nombre + serial

    const cols = Math.max(1, Math.floor((pageW - marginX * 2) / cellW));
    const rows = Math.max(1, Math.floor((pageH - marginY * 2) / cellH));
    const perPage = cols * rows;

    doc.setFont('helvetica', 'normal');

    qrData.forEach(({ item, dataUrl }, idx) => {
        const idxInPage = idx % perPage;
        if(idx > 0 && idxInPage === 0) doc.addPage();

        const col = idxInPage % cols;
        const row = Math.floor(idxInPage / cols);
        const x = marginX + col * cellW;
        const y = marginY + row * cellH;

        doc.addImage(dataUrl, 'PNG', x, y, qrSize, qrSize);

        const centerX = x + qrSize / 2;
        const name = item.name.length > 18 ? item.name.slice(0, 18) + '…' : item.name;
        doc.setFontSize(6.5);
        doc.setTextColor(30);
        doc.text(name, centerX, y + qrSize + 3, { align: 'center' });

        if(item.serial_number) {
            doc.setFontSize(5.5);
            doc.setTextColor(130);
            doc.text(item.serial_number, centerX, y + qrSize + 5.5, { align: 'center' });
        }
    });

    doc.save(`QR_Inventario_CBM_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── Escáner QR ────────────────────────────────────────────────────────────────

function openInventoryScannerModal() {
    document.getElementById('inventoryScanModal').classList.add('active');
    document.getElementById('invScan_scannerBox').style.display = 'block';
    document.getElementById('invScan_result').style.display = 'none';
    _invScanAction = null;

    setTimeout(() => {
        try {
            _invHtml5Scanner = new Html5Qrcode('inv-qr-reader');
            _invHtml5Scanner.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 250, height: 250 } },
                (decodedText) => {
                    _invHtml5Scanner.stop().catch(() => {});
                    handleInventoryQRScanned(decodedText);
                },
                () => {}
            ).catch(err => {
                showToast('No se pudo acceder a la cámara: ' + err, 'error');
                closeInventoryScanner();
            });
        } catch(e) {
            showToast('Error iniciando escáner: ' + e, 'error');
        }
    }, 200);
}

function closeInventoryScanner() {
    if(_invHtml5Scanner) {
        try {
            const scanner = _invHtml5Scanner;
            // stop()/clear() lanzan sincrónicamente si el escáner nunca llegó a iniciar
            // (ej: cámara denegada). Deben quedar aislados para no bloquear el cierre del modal.
            Promise.resolve()
                .then(() => scanner.stop())
                .catch(() => {})
                .then(() => scanner.clear())
                .catch(() => {});
        } catch(e) { /* ignorar: el escáner nunca llegó a iniciar */ }
        _invHtml5Scanner = null;
    }
    closeModal('inventoryScanModal');
}

function resetInventoryScanner() {
    document.getElementById('invScan_scannerBox').style.display = 'block';
    document.getElementById('invScan_result').style.display = 'none';
    _invScanAction = null;
    setTimeout(() => {
        try {
            _invHtml5Scanner = new Html5Qrcode('inv-qr-reader');
            _invHtml5Scanner.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 250, height: 250 } },
                (decodedText) => {
                    _invHtml5Scanner.stop().catch(() => {});
                    handleInventoryQRScanned(decodedText);
                },
                () => {}
            ).catch(() => {});
        } catch(e) {}
    }, 200);
}

async function handleInventoryQRScanned(scannedId) {
    document.getElementById('invScan_scannerBox').style.display = 'none';
    document.getElementById('invScan_result').style.display = 'block';

    const item = dbInventoryItems.find(i => i.id === scannedId);
    const card = document.getElementById('invScan_itemCard');
    const actionBtn = document.getElementById('invScan_actionBtn');

    if(!item) {
        card.innerHTML = `<div style="text-align:center;color:#dc2626;">⚠️ Ítem no reconocido.<br><small style="color:#94a3b8;">ID: ${scannedId}</small></div>`;
        actionBtn.style.display = 'none';
        return;
    }

    const sc = _invStatusColor[item.status] || '#64748b';
    const sb = _invStatusBg[item.status] || '#f8fafc';
    const activeLoan = dbInventoryLoans.find(l => l.item_id === item.id);
    const analystName = currentUserProfile?.analyst_name || currentUserProfile?.display_name || currentUser?.email;

    card.innerHTML = `
        <div style="font-weight:700;font-size:1rem;margin-bottom:0.25rem;">${item.name}</div>
        <div style="font-size:0.78rem;color:#64748b;margin-bottom:0.75rem;">${_invCatLabel[item.category]||item.category}${item.serial_number ? ' · '+item.serial_number : ''}</div>
        <span style="background:${sb};color:${sc};border:1px solid ${sc}33;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:99px;">
            ${_invStatusLabel[item.status]||item.status}
        </span>
        ${activeLoan ? `<div style="font-size:0.78rem;color:#d97706;margin-top:0.5rem;">En poder de: <strong>${activeLoan.analyst_name}</strong></div>` : ''}
    `;

    if(item.status === 'disponible') {
        _invScanAction = { type: 'checkout', itemId: item.id };
        actionBtn.textContent = `✅ Llevar "${item.name}"`;
        actionBtn.style.display = '';
    } else if(item.status === 'prestado') {
        _invScanAction = { type: 'checkin', itemId: item.id, loanId: activeLoan?.id };
        const sameAnalyst = activeLoan?.analyst_name === analystName;
        actionBtn.textContent = sameAnalyst ? `↩️ Devolver "${item.name}"` : `↩️ Registrar devolución (era de ${activeLoan?.analyst_name})`;
        actionBtn.style.display = '';
    } else {
        actionBtn.style.display = 'none';
        card.innerHTML += `<div style="margin-top:0.75rem;font-size:0.8rem;color:#dc2626;">Este ítem está marcado como <strong>${_invStatusLabel[item.status]}</strong> y no puede prestarse.</div>`;
    }
}

async function confirmInventoryAction() {
    if(!_invScanAction) return;
    const analystName = currentUserProfile?.analyst_name || currentUserProfile?.display_name || currentUser?.email;

    if(_invScanAction.type === 'checkout') {
        const { error: e1 } = await supabaseClient.from('inventory_loans').insert({
            item_id: _invScanAction.itemId, analyst_name: analystName
        });
        const { error: e2 } = await supabaseClient.from('inventory_items').update({ status: 'prestado' }).eq('id', _invScanAction.itemId);
        if(e1 || e2) { showToast('Error registrando salida', 'error'); return; }
        showToast('Salida registrada ✓', 'success');
    } else if(_invScanAction.type === 'checkin') {
        const { error: e1 } = await supabaseClient.from('inventory_loans').update({ checked_in_at: new Date().toISOString() }).eq('id', _invScanAction.loanId);
        const { error: e2 } = await supabaseClient.from('inventory_items').update({ status: 'disponible' }).eq('id', _invScanAction.itemId);
        if(e1 || e2) { showToast('Error registrando entrada', 'error'); return; }
        showToast('Devolución registrada ✓', 'success');
    }

    closeInventoryScanner();
    await loadInventoryData();
    if(document.getElementById('view-inventory')?.style.display !== 'none') renderInventoryView();
}

async function adminCheckIn(loanId, itemId) {
    if(!confirm('¿Registrar la devolución de este ítem?')) return;
    const { error: e1 } = await supabaseClient.from('inventory_loans').update({ checked_in_at: new Date().toISOString() }).eq('id', loanId);
    const { error: e2 } = await supabaseClient.from('inventory_items').update({ status: 'disponible' }).eq('id', itemId);
    if(e1 || e2) { showToast('Error registrando devolución', 'error'); return; }
    showToast('Devolución registrada', 'success');
    await loadInventoryData();
    renderInventoryView();
}

// ══════════════════════════════════════════════════════════════════════════════
// FIN MÓDULO DE INVENTARIO
// ══════════════════════════════════════════════════════════════════════════════

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
                                ${actionIcon('plant',  `openPlantsModal('${c.id}')`,      'Gestionar Plantas')}
                                ${actionIcon('pref',   `openPreferenceModal('${c.id}')`,  'Asignar Analistas')}
                                ${actionIcon('edit',   `editClient('${c.id}')`,            'Editar')}
                                ${actionIcon('delete', `deleteClient('${c.id}')`,           'Eliminar')}
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

// ══════════════════════════════════════════
// ADMIN CRUD: Plantas / Sedes por Cliente
// ══════════════════════════════════════════

function openPlantsModal(clientId) {
    const client = dbClients.find(c => c.id === clientId);
    if(!client) return;

    document.getElementById('adminModalTitle').textContent = `Plantas / Sedes: ${getClientDisplayName(client)}`;
    document.getElementById('adminModalContent').innerHTML = `
        <form onsubmit="addPlant(event, '${clientId}')" style="background:#f8fafc; padding:1rem; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:1rem; display:flex; gap:0.5rem;">
            <input type="text" id="newPlantName" placeholder="Nombre de la planta o sede..." required
                   style="flex:1; padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px; font-size:0.85rem;">
            <button type="submit" class="btn-primary" style="white-space:nowrap;">+ Agregar</button>
        </form>
        <div id="plantsList">
            <div style="text-align:center; font-size:0.8rem; color:var(--text-secondary);">Cargando plantas...</div>
        </div>
    `;
    document.getElementById('adminDataModal').classList.add('active');
    _renderPlantsList(clientId);
}

async function _renderPlantsList(clientId) {
    const listEl = document.getElementById('plantsList');
    if(!listEl) return;
    // Recargar desde Supabase
    if(supabaseClient) {
        const { data, error } = await supabaseClient
            .from('client_plants').select('*').eq('client_id', clientId).order('name');
        if(!error && data) {
            // Actualizar caché local también
            dbPlants = dbPlants.filter(p => p.client_id !== clientId).concat(data);
        }
    }
    const plants = dbPlants.filter(p => p.client_id === clientId);
    if(plants.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; font-size:0.8rem; color:var(--text-secondary); padding:0.75rem 0;">Aún no hay plantas registradas para este cliente.</div>';
        return;
    }
    listEl.innerHTML = plants.map(p => `
        <div style="background:var(--bg-color); padding:0.5rem 0.75rem; border-radius:6px; margin-bottom:0.4rem;
                    font-size:0.85rem; display:flex; justify-content:space-between; align-items:center;
                    border:1px solid #e2e8f0;">
            <span>🏭 <strong>${p.name}</strong></span>
            <span style="color:var(--clr-pink); cursor:pointer; font-size:1rem; padding:0 0.25rem;"
                  onclick="deletePlant('${p.id}', '${clientId}')" title="Eliminar planta">×</span>
        </div>
    `).join('');
}

async function addPlant(event, clientId) {
    event.preventDefault();
    if(!supabaseClient) return;
    const nameEl = document.getElementById('newPlantName');
    const name = nameEl ? nameEl.value.trim() : '';
    if(!name) return;

    const { data, error } = await supabaseClient
        .from('client_plants')
        .insert({ client_id: clientId, name })
        .select()
        .single();

    if(error) { showToast('Error al agregar planta: ' + error.message); return; }
    if(data) dbPlants.push(data);
    if(nameEl) nameEl.value = '';
    _renderPlantsList(clientId);
    showToast('Planta agregada correctamente.', 'success');
}

async function deletePlant(plantId, clientId) {
    if(!confirm('¿Eliminar esta planta? Las gestiones que la usaban quedarán sin planta asignada.')) return;
    if(!supabaseClient) return;
    const { error } = await supabaseClient.from('client_plants').delete().eq('id', plantId);
    if(error) { showToast('Error al eliminar: ' + error.message); return; }
    dbPlants = dbPlants.filter(p => p.id !== plantId);
    _renderPlantsList(clientId);
    showToast('Planta eliminada.', 'success');
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
            // Cargar perfiles de todos los usuarios (necesario para dirigir notifs a otros usuarios)
            loadAllProfiles().catch(() => {});
            // Cargar notificaciones propias y correr los chequeos (CSAT vencidos, resumen mensual)
            loadMyNotifications().then(() => runNotificationsCheck()).catch(() => {});
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

/** Rango común para los selects de mes: 6 meses atrás y 18 adelante
 *  (cubre planeación anual completa + margen para facturación rezagada). */
function _populateMonthSelect(selectId) {
    const select = document.getElementById(selectId);
    if(!select) return;
    select.innerHTML = '';
    const now = new Date();
    for(let i = -6; i <= 18; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const val = `${y}-${String(m).padStart(2, '0')}`;
        const label = `${monthNames[m-1]} ${y}`;
        select.innerHTML += `<option value="${val}">${label}</option>`;
    }
}

function populateBillingMonthSelect() {
    _populateMonthSelect('taskBillingMonth');
}

function populatePeriodMonthSelect() {
    _populateMonthSelect('taskPeriodMonth');
}

document.addEventListener('DOMContentLoaded', async () => {
    await checkSession();
    initUnassignedResizer();
});

/** Ajusta el layout interno del backlog según la altura actual:
 *  - Barra baja  → una fila con scroll horizontal (como estaba)
 *  - Barra alta  → varias filas con scroll vertical */
function _updateUnassignedLayoutForHeight() {
    const bar   = document.getElementById('unassignedSidebar');
    const items = document.getElementById('planning-sidebar-items');
    if(!bar || !items) return;
    // Prioriza el height inline (más confiable si la vista no está renderizada aún)
    const h = parseInt(bar.style.height, 10) || bar.getBoundingClientRect().height || 180;
    if(h > 200) {
        items.style.flexWrap  = 'wrap';
        items.style.overflowX = 'hidden';
        items.style.overflowY = 'auto';
    } else {
        items.style.flexWrap  = 'nowrap';
        items.style.overflowX = 'auto';
        items.style.overflowY = 'hidden';
    }
}

/** Divisor arrastrable en la parte superior del backlog "Por Programar":
 *  permite al usuario expandir o contraer la altura de la barra. */
function initUnassignedResizer() {
    const bar     = document.getElementById('unassignedSidebar');
    const resizer = document.getElementById('unassignedResizer');
    if(!bar || !resizer) return;

    // Restaurar altura persistida en localStorage
    const savedH = parseInt(localStorage.getItem('unassignedBarHeight') || '', 10);
    if(!isNaN(savedH) && savedH >= 90) bar.style.height = savedH + 'px';
    _updateUnassignedLayoutForHeight();

    let startY = 0, startH = 0, dragging = false;
    const MIN = 90, MAX_FRACTION = 0.6; // hasta 60% del viewport

    const onMove = (e) => {
        if(!dragging) return;
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        const delta = startY - y; // arrastrar hacia ARRIBA aumenta altura
        const maxH  = Math.round(window.innerHeight * MAX_FRACTION);
        const newH  = Math.max(MIN, Math.min(maxH, startH + delta));
        bar.style.height = newH + 'px';
        _updateUnassignedLayoutForHeight();
    };
    const onUp = () => {
        if(!dragging) return;
        dragging = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        localStorage.setItem('unassignedBarHeight', parseInt(bar.style.height, 10));
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend',  onUp);
    };
    const onDown = (e) => {
        dragging = true;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        startH = bar.getBoundingClientRect().height;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ns-resize';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend',  onUp);
        e.preventDefault();
    };

    resizer.addEventListener('mousedown',  onDown);
    resizer.addEventListener('touchstart', onDown, { passive: false });
}

// Helper Function

