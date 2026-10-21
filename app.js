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

// Evitar que el scroll del mouse cambie el valor de un <input type="number"> con foco.
// Al hacer scroll sobre un campo numérico enfocado (por accidente al desplazar la página),
// Chrome/Edge incrementan/decrementan el valor. Se le quita el foco al detectar wheel para
// que el scroll se comporte como en cualquier otro elemento de la página.
document.addEventListener('wheel', (e) => {
    if (document.activeElement && document.activeElement.type === 'number') {
        document.activeElement.blur();
    }
}, { passive: true });

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

/** El rol "viewer" puede ver todas las vistas (menos Admin de Datos) pero es de solo observación:
 *  no puede crear, editar, eliminar, programar (drag&drop) ni escanear QR. */
function isViewerRole() { return currentUserProfile?.role === 'viewer'; }
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
        admin:      ['dashboard', 'tasks', 'planning', 'finance', 'admin', 'reports', 'efficiency', 'surveys', 'inventory'],
        analyst:    ['mywork', 'planning', 'inventory'],
        assistant:  ['dashboard', 'tasks', 'planning', 'finance', 'reports', 'surveys'],
        commercial: ['dashboard', 'tasks', 'planning', 'finance', 'reports'],
        viewer:     ['dashboard', 'tasks', 'planning', 'finance', 'reports', 'efficiency', 'surveys', 'inventory'],
    };
    const allowed = allowedViews[role] || allowedViews.viewer;

    // Mostrar/ocultar ítems del nav
    document.querySelectorAll('.nav-item[data-view]').forEach(nav => {
        const view = nav.getAttribute('data-view');
        nav.style.display = allowed.includes(view) ? 'flex' : 'none';
    });

    // El rol viewer es de solo observación: cualquier elemento marcado con
    // class="viewer-hide" (estático o generado dinámicamente en cualquier render)
    // se oculta automáticamente vía CSS mientras el body tenga esta clase.
    document.body.classList.toggle('role-viewer', role === 'viewer');

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

/** Devuelve gestiones con CSAT vencido (>7 días desde que el analista marcó ejecutada) */
function getCsatOverdueTasks(analystName) {
    const today = Date.now();
    return tasks.filter(t => {
        if(t.isAbsence || t.serviceType === 'Metro Administrativo' || t.serviceType === 'Metro Terceros' || t.serviceType === 'Calibración') return false;
        if(t.status !== 'ejecutada') return false;
        if(t.csatScore || t.clientNoResponse) return false;
        if(analystName && !t.analysts_assignment?.some(a => a.name === analystName)) return false;
        // Fallback para gestiones antiguas sin executedAt registrado
        const startRef = t.executedAt
            || (t.scheduledDays||[]).filter(d => d.type === 'report').map(d => d.date).sort().pop();
        if(!startRef) return false;
        const diff = Math.floor((today - new Date(startRef).getTime()) / 86400000);
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
        'resumen_mensual':     { s:'Resumen mensual',             p:'resúmenes mensuales' },
        'consumible_bajo':     { s:'Consumible por agotarse',     p:'consumibles por agotarse' }
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
            if(t.isAbsence || t.serviceType === 'Metro Administrativo' || t.serviceType === 'Metro Terceros' || t.serviceType === 'Calibración') return false;
            if(t.status !== 'ejecutada') return false;
            if(t.csatScore || t.clientNoResponse) return false;
            const startRef = t.executedAt
                || (t.scheduledDays || []).filter(d => d.type === 'report').map(d => d.date).sort().pop();
            if(!startRef) return false;
            const diff = Math.floor((today - new Date(startRef).getTime()) / 86400000);
            return diff >= 15;
        });
        if(veryOverdue.length > 0) {
            const list = veryOverdue.slice(0, 5).map(t => _clientLabelForNotif(t)).join(', ');
            const suffix = veryOverdue.length > 5 ? `, y ${veryOverdue.length - 5} más.` : '.';
            await notifyOncePerTaskAndType({
                user_id: currentUser.id, task_id: null, type: 'csat_admin_vencidos',
                title: `${veryOverdue.length} CSAT vencidos hace más de 15 días`,
                body: list + suffix,
                is_urgent: true,
                extraData: {}
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
    // Con medición por turnos solo se muestran los días de planta de ESTE analista
    const myFieldDays = isFieldSplit(task)
        ? (getFieldDayAssignments(task).get(currentUserProfile?.analyst_name) || []).map(date => ({ date }))
        : (task.scheduledDays?.filter(d => d.type === 'field') || []);
    const fieldStr = fmt(myFieldDays);

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
    const hasChecklist = _ckHasChecklist(task);
    const ckProg       = hasChecklist ? _ckProgress(_ckRowOf(task.id)?.data) : null;
    // El cierre CSAT puede hacerse antes o después de facturar
    const closable     = task.status === 'ejecutada' || task.status === 'facturada';
    const canCsat      = closable && !task.csatScore && !task.clientNoResponse && task.serviceType !== 'Calibración';
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
                <div style="display:flex; gap:0.4rem; flex-shrink:0;">
                    ${hasChecklist ? `<button class="mywork-eye-btn mywork-ck-btn ${ckProg.answered === ckProg.total ? 'ck-done' : (ckProg.fails ? 'ck-warn' : '')}"
                            onclick="event.stopPropagation(); openTaskChecklist('${task.id}')"
                            title="Checklist de servicio (${ckProg.answered} de ${ckProg.total} puntos${ckProg.fails ? ' · ' + ckProg.fails + ' con novedad' : ''})">
                        📋<span class="ck-badge">${ckProg.answered}/${ckProg.total}</span>
                    </button>` : ''}
                    <button class="mywork-eye-btn ${task.serviceDetails ? 'has-details' : ''}"
                            onclick="event.stopPropagation(); openServiceDetailsModal('${task.id}')"
                            title="${task.serviceDetails ? 'Editar detalles para el comercial' : 'Agregar detalles del servicio para el comercial'}">
                        👁️
                    </button>
                </div>
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
                ${csatDone && task.clientNoResponse ? `
                    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                        <div class="mywork-csat-done" style="background:#fff7ed;color:#c2410c;border-color:#fed7aa;">⚠️ Sin calificación — Cliente no respondió</div>
                        <button onclick="reopenCsat('${task.id}')"
                            title="El cliente respondió — toca aquí para reabrir y llenar el CSAT"
                            style="font-size:0.65rem;padding:0.18rem 0.5rem;background:transparent;color:#6b7280;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;white-space:nowrap;">
                            🔄 Ya respondió
                        </button>
                    </div>` : ''}
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
    task.csatClosedAt     = null;

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

    // El ícono "ojo" es una notificación por rol: al abrir y leer el detalle, se
    // marca como leído para ESE rol (pasa de verde a gris) sin afectar al otro.
    const isReviewer = role === 'commercial' || role === 'admin' || role === 'viewer';
    const readField  = role === 'admin' ? 'serviceDetailsReadAtAdmin' : 'serviceDetailsReadAt';
    if(isReviewer && task.serviceDetails && !task[readField]) {
        markServiceDetailsAsRead(task, role);
    }
}

/** Marca el detalle del servicio como leído para el rol dado (admin o commercial/viewer).
 *  Usa update() apuntando solo al campo correspondiente para no depender del upsert general. */
async function markServiceDetailsAsRead(task, role) {
    const isAdmin  = role === 'admin';
    const localKey = isAdmin ? 'serviceDetailsReadAtAdmin' : 'serviceDetailsReadAt';
    const dbKey    = isAdmin ? 'service_details_read_at_admin' : 'service_details_read_at';
    task[localKey] = new Date().toISOString();
    saveTasks();
    renderTasksView();
    if(typeof renderMyWorkView === 'function') renderMyWorkView();
    if(supabaseClient && task.id && !task.id.startsWith('t_')) {
        await supabaseClient.from('tasks').update({ [dbKey]: task[localKey] }).eq('id', task.id);
    }
}

async function saveServiceDetails() {
    const task = tasks.find(t => t.id === _serviceDetailsTaskId);
    if(!task) return;
    _stopServiceDictation();

    const rawText = document.getElementById('serviceDetailsInput').value.trim();

    if(!rawText) {
        task.serviceDetails = '';
        task.serviceDetailsRaw = '';
        task.serviceDetailsReadAt      = null;
        task.serviceDetailsReadAtAdmin = null;
        saveTasks();
        closeModal('serviceDetailsModal');
        if(typeof renderMyWorkView === 'function') renderMyWorkView();
        renderTasksView();
        await saveTaskToSupabase(task);
        showToast('Detalles del servicio guardados.', 'success');
        return;
    }

    // Requerimiento 1: estructurar el texto dictado (desordenado) en la plantilla fija
    // vía IA (llamada server-side, la API key nunca se expone en el navegador).
    const saveBtn = document.querySelector('#serviceDetailsActions .btn-primary');
    const originalLabel = saveBtn ? saveBtn.textContent : '';
    if(saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Estructurando…'; }

    let structured = rawText; // respaldo: si la IA falla, se guarda el texto tal cual
    try {
        const resp = await fetch('/api/structure-service-details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawText })
        });
        if(resp.ok) {
            const data = await resp.json();
            if(data.structured) structured = data.structured;
        } else {
            console.error('Error estructurando detalles:', await resp.text());
        }
    } catch(e) {
        console.error('Error llamando al servicio de estructuración:', e);
    }

    if(saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalLabel; }

    task.serviceDetailsRaw = rawText;
    task.serviceDetails = structured;
    // Nuevo dato del analista → el ícono vuelve a verde para TODOS los revisores (independiente).
    task.serviceDetailsReadAt      = null;
    task.serviceDetailsReadAtAdmin = null;

    saveTasks();
    closeModal('serviceDetailsModal');
    if(typeof renderMyWorkView === 'function') renderMyWorkView();
    renderTasksView();
    await saveTaskToSupabase(task);
    // Notif: nuevos detalles del servicio → a los comerciales
    notifyServiceDetailsUpdated(task).catch(() => {});
    showToast('Detalles del servicio guardados y estructurados.', 'success');
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

/** Expande/colapsa la tabla de Usuarios del Sistema (arranca colapsada). */
function toggleAdminUsers() {
    const list = document.getElementById('admin-users-list');
    const toggleBtn = document.getElementById('adminUsersToggleBtn');
    const refreshBtn = document.getElementById('adminUsersRefreshBtn');
    if(!list) return;
    const open = list.style.display === 'none';
    list.style.display = open ? 'block' : 'none';
    if(toggleBtn) toggleBtn.textContent = open ? '▲ Colapsar' : '▼ Expandir';
    if(refreshBtn) refreshBtn.style.display = open ? '' : 'none';
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
    checklist: `<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    contacts: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.5 17c.6-1.6 2-2.4 3.5-2.4s2.9.8 3.5 2.4"/><line x1="15" y1="9" x2="19" y2="9"/><line x1="15" y1="13" x2="19" y2="13"/></svg>`,
    consume: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
    entry:   `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
    adjust:  `<svg viewBox="0 0 24 24"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
    history: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};
function actionIcon(type, onclick, title) {
    return `<span class="action-icon ${type}" onclick="${onclick}" title="${title}">${SVG_ICONS[type] || ''}</span>`;
}

/** Ícono "ojo" con 3 estados, independiente por rol:
 *  deshabilitado (sin datos) · verde (no leído por este rol) · gris (ya leído). */
function serviceDetailsIcon(task) {
    const svg  = SVG_ICONS.note || '';
    const role = currentUserProfile?.role || 'viewer';
    if(!task.serviceDetails) {
        return `<span class="action-icon note" style="opacity:0.3;cursor:not-allowed;color:#94a3b8;" title="Sin detalles registrados aún">${svg}</span>`;
    }
    const readField = role === 'admin' ? 'serviceDetailsReadAtAdmin' : 'serviceDetailsReadAt';
    const unread    = !task[readField];
    const color     = unread ? '#16a34a' : '#94a3b8';
    const title     = unread ? 'Nuevo: ver detalles del servicio' : 'Ver detalles del servicio (ya leído)';
    return `<span class="action-icon note" onclick="openServiceDetailsModal('${task.id}')" title="${title}" style="color:${color};cursor:pointer;position:relative;display:inline-block;">
        ${svg}
        ${unread ? '<span style="position:absolute;top:-2px;right:-2px;width:8px;height:8px;background:#16a34a;border:1.5px solid #fff;border-radius:50%;"></span>' : ''}
    </span>`;
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

/** Devuelve colores pastel consistentes para un cliente, basados en su nombre base.
 *  El mismo cliente siempre recibe el mismo tono, independiente del orden. */
function getClientColor(clientStr) {
    const base = getClientCompanyBase(clientStr);
    if (!base) return { bg: '#f8fafc', border: '#e2e8f0' };
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
        hash = base.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return {
        bg:     `hsl(${hue}, 55%, 95%)`,
        border: `hsl(${hue}, 50%, 72%)`
    };
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
    'Calibración':           '#10B981',
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

    const calIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
        <rect x="1" y="3" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/>
        <path d="M1 7h14" stroke="currentColor" stroke-width="1.6"/>
        <path d="M5 1v3M11 1v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
    if (calendarView === 'month') {
        display.innerHTML = `${calIcon}<span>${monthNames[currentMonth - 1]} ${currentYear}</span><span style="font-size:0.7rem;opacity:0.8;">▾</span>`;
        display.style.cursor = 'pointer';
        display.title = 'Clic para elegir mes';
        if(title) title.textContent = "Cronograma Mensual";
    } else {
        const start = currentWeekStart;
        const end = getEndOfWeek(start);
        const startDay = start.getDate();
        const startMonth = monthNames[start.getMonth()].substring(0, 3);
        const endDay = end.getDate();
        const endMonth = monthNames[end.getMonth()].substring(0, 3);

        display.innerHTML = `${calIcon}<span>${startDay} ${startMonth} – ${endDay} ${endMonth} ${end.getFullYear()}</span>`;
        display.style.cursor = 'default';
        display.title = '';
        display.onmouseover = null;
        display.onmouseout  = null;
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

// ── Period Picker ─────────────────────────────────────────────────────────────
let _ppYear = currentYear; // año que se está viendo en el picker

function togglePeriodPicker() {
    if (calendarView !== 'month') return;
    const pop = document.getElementById('periodPickerPopover');
    if (!pop) return;
    if (pop.style.display === 'none') {
        _ppYear = currentYear;
        _renderPeriodPicker();
        pop.style.display = 'block';
    } else {
        pop.style.display = 'none';
    }
}

function _renderPeriodPicker() {
    const pop = document.getElementById('periodPickerPopover');
    if (!pop) return;
    const short = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const monthBtns = short.map((m, i) => {
        const active = (_ppYear === currentYear && i + 1 === currentMonth);
        return `<button data-pp-month="${i + 1}"
            style="padding:0.35rem 0; border-radius:6px; border:none; cursor:pointer; font-size:0.82rem; font-weight:${active ? '700' : '500'};
                   background:${active ? 'var(--clr-blue)' : 'transparent'}; color:${active ? '#fff' : 'var(--text-primary)'};
                   transition:background 0.15s;">${m}</button>`;
    }).join('');
    pop.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;gap:0.5rem;">
            <button data-pp-prev style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:var(--text-secondary);padding:0 0.4rem;line-height:1;">‹</button>
            <span style="font-weight:700;color:var(--clr-blue);font-size:0.95rem;">${_ppYear}</span>
            <button data-pp-next style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:var(--text-secondary);padding:0 0.4rem;line-height:1;">›</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.3rem;">${monthBtns}</div>`;

    // Usar addEventListener para evitar que `let _ppYear` quede fuera de scope en onclick inline
    pop.querySelector('[data-pp-prev]').addEventListener('click', e => { e.stopPropagation(); _ppYear--; _renderPeriodPicker(); });
    pop.querySelector('[data-pp-next]').addEventListener('click', e => { e.stopPropagation(); _ppYear++; _renderPeriodPicker(); });
    pop.querySelectorAll('[data-pp-month]').forEach(btn => {
        const m = parseInt(btn.dataset.ppMonth);
        btn.addEventListener('click', () => jumpToPeriod(_ppYear, m));
    });
}

async function jumpToPeriod(year, month) {
    document.getElementById('periodPickerPopover').style.display = 'none';
    currentYear  = year;
    currentMonth = month;
    updatePeriodDisplay();
    if (supabaseClient) await loadTasksFromSupabase();
    renderDashboardStats();
    renderCalendar();
    renderPlanningSidebar();
    renderTasksView();
    renderFinanceView();
    if (document.getElementById('view-mywork')?.classList.contains('active-view')) renderMyWorkView();
}

// Cerrar el picker al hacer clic fuera de él
document.addEventListener('click', e => {
    const anchor = document.getElementById('periodPickerAnchor');
    const pop    = document.getElementById('periodPickerPopover');
    if (pop && pop.style.display !== 'none' && anchor && !anchor.contains(e.target)) {
        pop.style.display = 'none';
    }
});
// ──────────────────────────────────────────────────────────────────────────────

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

/** parseInt con valor por defecto que NO pisa un 0 legítimo (a diferencia de `parseInt(x) || def`,
 *  que convierte 0 en el default por ser falsy). Usado para daysField: hay servicios de solo
 *  informe (sin viaje a planta) donde 0 días de campo es un valor válido, no un dato faltante. */
function parseIntOrDefault(value, def) {
    const n = parseInt(value);
    return Number.isNaN(n) ? def : n;
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
        <div class="filter-toolbar" style="padding:0.6rem 0.85rem;">
            <div>
                <label class="filter-label">Analista</label><br>
                <select onchange="updateGlobalFilter('analyst', this.value)" class="filter-select" style="min-width:130px; margin-top:4px;">
                    <option value="">Todos</option>
                    ${dbAnalysts.map(a => `<option value="${a.name}" ${dashboardFilters.analyst === a.name ? 'selected' : ''}>${a.name}</option>`).join('')}
                </select>
            </div>
            <div>
                <label class="filter-label">Cliente</label><br>
                <select onchange="updateGlobalFilter('client', this.value)" class="filter-select" style="min-width:130px; margin-top:4px;">
                    <option value="">Todos</option>
                    ${dbClients.map(c => getClientDisplayName(c)).map(name => `<option value="${name}" ${dashboardFilters.client === name ? 'selected' : ''}>${name}</option>`).join('')}
                </select>
            </div>
            <button class="filter-clear-btn" onclick="resetGlobalFilters()">✕ Limpiar</button>
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
                            ${(role === 'commercial' || role === 'viewer') ? `
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
                                    ${t.serviceType !== 'Calibración' ? actionIcon('csat',   `openClosingMeetingModal('${t.id}')`, 'Reunión de Cierre') : ''}
                                    ${_ckHasChecklist(t) ? actionIcon('checklist', `openTaskChecklist('${t.id}')`, `Checklist de servicio (${_ckProgress(_ckRowOf(t.id)?.data).answered}/${_CK_ITEM_TOTAL})`) : ''}
                                    ${serviceDetailsIcon(t)}
                                    ${(t.csatScore || t.clientNoResponse) ? actionIcon('reopen', `reopenCsat('${t.id}')`, 'Reabrir CSAT (para que el analista lo llene de nuevo)') : ''}
                                    ${t.status === 'programada' ? actionIcon('revert', `revertToProjected('${t.id}')`, 'Revertir a Proyectada') : ''}
                                    ${actionIcon('delete', `deleteTask('${t.id}')`,              'Borrar')}
                                ` : (role === 'commercial' || role === 'viewer') ? `
                                    ${role === 'viewer' && _ckHasChecklist(t) ? actionIcon('checklist', `openTaskChecklist('${t.id}')`, `Checklist de servicio (${_ckProgress(_ckRowOf(t.id)?.data).answered}/${_CK_ITEM_TOTAL})`) : ''}
                                    ${serviceDetailsIcon(t)}
                                ` : role === 'assistant' ? `
                                    <div style="display:flex;gap:0.3rem;align-items:center;flex-wrap:wrap;">
                                        ${t.status === 'ejecutada' ? `
                                            <button class="mywork-btn btn-execute" style="font-size:0.68rem;padding:0.25rem 0.5rem;white-space:nowrap;"
                                                onclick="updateTaskStatus('${t.id}','facturada')">
                                                💰 A Facturada
                                            </button>` : `
                                            <span style="font-size:0.68rem;color:var(--clr-green);font-weight:600;white-space:nowrap;">✓ Facturada</span>`}
                                        <button class="mywork-btn" style="font-size:0.68rem;padding:0.25rem 0.5rem;background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;border-radius:6px;cursor:pointer;white-space:nowrap;"
                                            onclick="openEditBudgetModal('${t.id}')">
                                            ✏️ Editar valor
                                        </button>
                                        ${getClientCompanyBase(t.client) === 'metro' && t.serviceType !== 'Calibración' ? `
                                        <button class="mywork-btn" style="font-size:0.68rem;padding:0.25rem 0.5rem;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:6px;cursor:pointer;white-space:nowrap;"
                                            onclick="openClosingMeetingModal('${t.id}')">
                                            📋 CSAT
                                        </button>` : ''}
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

// ── Checklist obligatorio de cierre de campo (antes de programada → ejecutada) ──
// Cada tipo de servicio tiene su propio checklist. Los tipos que no aparecen aquí
// usan la confirmación simple de siempre (sin checklist específico).
const _executionChecklistsByService = {
    'Vibraciones': [
        'Pasaste la base de datos de vibraciones al servidor.',
        'Enviaste el correo de informe a Cliente, Comercial y Asistente.',
        'Ya programaste el cierre de gestión.'
    ],
    'Rotodinámico': [
        'Generaste el Backup en los dos discos duros de Respaldo.',
        'Enviaste el correo de informe a Cliente, Comercial y Asistente.',
        'Ya programaste el cierre de gestión.'
    ]
};

let _execChecklistResolve = null;

function confirmExecutionChecklist(serviceType, taskId = null) {
    const items = _executionChecklistsByService[serviceType];

    // Sin checklist específico para este servicio: confirmación simple de siempre
    if(!items) {
        return Promise.resolve(confirm(
            '⚠️ ACCIÓN IRREVERSIBLE\n\n' +
            'Estás a punto de marcar esta gestión como EJECUTADA.\n\n' +
            'Una vez ejecutada, no podrá volver a estado Programada o Proyectada.\n\n' +
            '¿Confirmas que el trabajo de campo fue realizado?'
        ));
    }

    return new Promise((resolve) => {
        const modal = document.getElementById('executionChecklistModal');
        const confirmBtn = document.getElementById('execChecklistConfirmBtn');
        const itemsContainer = document.getElementById('execChecklistItems');
        if(!modal || !confirmBtn || !itemsContainer) { resolve(true); return; } // fallback si el modal no existe

        const ckInfo = (serviceType === 'Rotodinámico' && taskId && _ckHasChecklist(tasks.find(t => t.id === taskId)))
            ? (() => { const p = _ckProgress(_ckRowOf(taskId)?.data); return `<div style="font-size:0.78rem;color:${p.answered === p.total ? '#15803d' : '#b45309'};background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:0.5rem 0.7rem;margin-bottom:0.6rem;">📋 Checklist de servicio: ${p.answered} de ${p.total} puntos${p.fails ? ` · ${p.fails} con novedad` : ''}</div>`; })()
            : '';
        itemsContainer.innerHTML = ckInfo + items.map((label, i) => `
            <div class="form-group checkbox-group" style="align-items:flex-start;">
                <input type="checkbox" class="exec-check" id="execCheck${i}" style="margin-top:3px;">
                <label for="execCheck${i}">${label}</label>
            </div>`).join('');

        const checkboxes = itemsContainer.querySelectorAll('.exec-check');
        confirmBtn.disabled = true;

        const updateBtn = () => {
            confirmBtn.disabled = !Array.from(checkboxes).every(cb => cb.checked);
        };
        checkboxes.forEach(cb => cb.addEventListener('change', updateBtn));
        modal._execUpdateBtn = updateBtn; // para poder desengancharlo al cerrar

        _execChecklistResolve = resolve;
        modal.classList.add('active');
    });
}

function _closeExecutionChecklistModal() {
    const modal = document.getElementById('executionChecklistModal');
    if(!modal) return;
    if(modal._execUpdateBtn) {
        modal.querySelectorAll('.exec-check').forEach(cb => cb.removeEventListener('change', modal._execUpdateBtn));
        modal._execUpdateBtn = null;
    }
    modal.classList.remove('active');
}

function _confirmExecutionChecklist() {
    const modal = document.getElementById('executionChecklistModal');
    const checkboxes = modal ? modal.querySelectorAll('.exec-check') : [];
    if(!Array.from(checkboxes).every(cb => cb.checked)) return; // guard extra
    _closeExecutionChecklistModal();
    if(_execChecklistResolve) { _execChecklistResolve(true); _execChecklistResolve = null; }
}

function _cancelExecutionChecklist() {
    _closeExecutionChecklistModal();
    if(_execChecklistResolve) { _execChecklistResolve(false); _execChecklistResolve = null; }
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
    // Confirmación irreversible: programada → ejecutada.
    // Antes de permitir el paso, se exige el checklist del protocolo de cierre de campo
    // (subir base de datos al servidor / backup, enviar informe, programar cierre),
    // porque esas tareas se estaban olvidando y generaban huecos entre gestiones.
    // El checklist mostrado depende del tipo de servicio (ver _executionChecklistsByService).
    if(task.status === 'programada' && newStatus === 'ejecutada') {
        const confirmed = await confirmExecutionChecklist(task.serviceType, task.id);
        if(!confirmed) {
            renderBoard();
            renderTasksView();
            if(typeof renderMyWorkView === 'function') renderMyWorkView();
            return;
        }
    }

    const oldStatus = task.status;
    task.status = newStatus;

    // Marca el momento exacto en que el analista ejecuta: desde aquí cuentan los días
    // de cierre pendiente (antes se contaba desde el día programado del informe, no
    // desde la ejecución real).
    if(oldStatus !== 'ejecutada' && newStatus === 'ejecutada' && !task.executedAt) {
        task.executedAt = new Date().toISOString();
    }

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
            analysts_assignment: task.analysts_assignment || [],
            executed_at: task.executedAt || null
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

    const index = tasks.findIndex(t => t.id === taskId);
    if(index === -1) return;

    // Actualización optimista: se quita la fila de inmediato, ANTES de esperar a
    // Supabase. Así el botón desaparece al instante y no queda "tildado" — no hay
    // forma de hacer doble clic sobre un botón que ya no está en pantalla.
    const [removedTask] = tasks.splice(index, 1);
    saveTasks();
    renderBoard();
    renderCalendar();
    if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
    renderTasksView();
    renderDashboardStats();

    if(supabaseClient) {
        const { error } = await supabaseClient.from('tasks').delete().eq('id', taskId);
        if(error) {
            // El borrado falló en el servidor: revertir localmente para no quedar
            // desincronizados, y avisar en vez de fallar en silencio.
            tasks.splice(index, 0, removedTask);
            saveTasks();
            renderBoard();
            renderCalendar();
            if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
            renderTasksView();
            renderDashboardStats();
            showToast('Error eliminando la gestión: ' + error.message, 'error');
        }
    }
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
    if(type === 'status') syncTaskStatusFilterTags();
}

/** Alterna el filtro de Estado desde los tags de colores (clic de nuevo = quitar filtro). */
function toggleTaskStatusFilter(status) {
    updateGlobalFilter('status', dashboardFilters.status === status ? '' : status);
}

function syncTaskStatusFilterTags() {
    document.querySelectorAll('#filter-tasks-status-tags .filter-tag').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === dashboardFilters.status);
    });
}

function resetGlobalFilters() {
    dashboardFilters = {
        analyst: '',
        client: '',
        status: ''
    };

    syncTaskStatusFilterTags();

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
    return r === 'analyst' || r === 'commercial' || r === 'assistant' || r === 'viewer';
}

/** El asistente puede arrastrar al calendario solo tareas de ausencia */
function isAssistantAllowed(taskId) {
    if(currentUserProfile?.role !== 'assistant') return false;
    const t = tasks.find(x => x.id === taskId);
    return !!(t?.isAbsence);
}

function handleDragStart(e) {
    // Analistas/Comerciales/Asistente no pueden arrastrar, salvo el asistente con ausencias
    const _dragId = this.id || this.getAttribute('data-task-id');
    if (isPlanningReadOnly() && !isAssistantAllowed(_dragId)) {
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
    // El asistente puede ver y arrastrar solo las ausencias
    const role = currentUserProfile?.role;
    const isAssistant = role === 'assistant';
    const unassignedBar = sidebarContainer.closest('.unassigned-sidebar');
    if (isPlanningReadOnly() && !isAssistant) {
        if (unassignedBar) unassignedBar.style.display = 'none';
        return;
    }
    if (unassignedBar) unassignedBar.style.display = '';

    sidebarContainer.innerHTML = '';

    // Filtrado estricto: Una gestión en 'Por programar' NO DEBE tener días programados.
    // Metro Administrativo se excluye siempre (va directo a facturada, no necesita programarse).
    let filteredTasks = tasks.filter(t => {
        if(!t.status || t.status.toLowerCase() !== 'proyectada') return false;
        if(t.scheduledDays && t.scheduledDays.length > 0) return false;
        if(t.serviceType === 'Metro Administrativo' || t.serviceType === 'Metro Terceros') return false;
        if(!isTaskInCurrentPeriod(t)) return false;
        // El asistente solo ve ausencias en el sidebar
        if(isAssistant && !t.isAbsence) return false;
        return true;
    });

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
        const clr = getClientColor(t.client);
        item.style.background  = clr.bg;
        item.style.borderLeft  = `3px solid ${clr.border}`;
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
                    if (isFieldSplit(t)) {
                        return (getFieldDayAssignments(t).get(analyst.name) || []).includes(day.dateStr);
                    }
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
                    : String(t.client || '').split(' - ')[0].trim(); // solo la empresa, sin "- Planta"
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
        // El asistente puede mover pills de ausencias
        const _pillTaskId = pill.id || pill.getAttribute('data-task-id');
        if (isPlanningReadOnly() && !isAssistantAllowed(_pillTaskId)) {
            pill.draggable = false;
        }
        pill.addEventListener('dragstart', function(e) {
            const _tid = this.id || this.getAttribute('data-task-id');
            if (isPlanningReadOnly() && !isAssistantAllowed(_tid)) {
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

    // Verificar permisos: read-only salvo asistente con ausencias
    if (isPlanningReadOnly() && !isAssistantAllowed(taskId)) return;

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

    // Dos días de la misma gestión no pueden caer en la misma fecha (el calendario solo
    // dibuja uno y el otro "desaparece"). Aplica a planta e informe.
    if (isPillMove && Array.isArray(task.scheduledDays)) {
        const _clashEl  = document.getElementById(dragInfo);
        const _clashIdx = _clashEl ? parseInt(_clashEl.getAttribute('data-day-index'), 10) : parseInt(dragInfo.split('-').pop(), 10);
        const occupied  = task.scheduledDays.some((d, i) => i !== _clashIdx && d.date === targetDateStr);
        if (occupied) {
            alert('Esta gestión ya tiene otro día programado en esa fecha. Elige un día libre: dos días de la misma gestión no pueden quedar en la misma fecha.');
            return;
        }
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

        // Medición por turnos: mover un día de planta a la fila de otro analista lo reasigna
        if (movedDay?.type === 'field' && isFieldSplit(task)) {
            if (task.status === 'facturada') { alert('Una gestión facturada no puede ser modificada.'); return; }
            // Congelar los días implícitos para que no se redistribuyan al mover uno
            const currentFieldMap = getFieldDayAssignments(task);
            task.scheduledDays.forEach(d => {
                if (d.type === 'field' && !d.analyst) {
                    for (const [name, dates] of currentFieldMap.entries()) {
                        if (dates.includes(d.date)) { d.analyst = name; break; }
                    }
                }
            });
            movedDay.analyst = targetAnalyst;
            movedDay.day  = targetDay;
            movedDay.date = targetDateStr;
            const targetEntry = (task.analysts_assignment || []).find(a => a.name === targetAnalyst);
            if (targetEntry) targetEntry.isTitular = true;
            logActivity(`🚚 Se movió un día de planta de <strong>${task.client}</strong> a <strong>${targetAnalyst}</strong> (día ${targetDay}).`, 'assign');
            saveTasks();
            postDropSync();
            await saveTaskToSupabase(task);
            return;
        }

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
            const totalFieldNeeded = parseIntOrDefault(task.daysField, 1);
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
/** Medición por turnos: los analistas titulares van a planta en días DISTINTOS.
 *  La marca vive en analysts_assignment[].splitField (sin columna nueva en Supabase). */
function isFieldSplit(task) {
    return !!(task && task.analysts_assignment && task.analysts_assignment.some(a => a.splitField));
}

/** Reparte los días de planta entre los analistas titulares (mapa nombre → fechas).
 *  Días con analista explícito (movidos a mano) se respetan; el resto se reparte parejo,
 *  dando el sobrante al primero. */
function getFieldDayAssignments(task) {
    const fieldDays = (task.scheduledDays || [])
        .filter(d => d.type === 'field' && d.date)
        .sort((a, b) => a.date.localeCompare(b.date));
    const fieldAnalysts = (task.analysts_assignment || []).filter(a => a.isTitular);
    const map = new Map();

    if (fieldAnalysts.length === 0) {
        if (task.analyst) map.set(task.analyst, fieldDays.map(d => d.date));
        return map;
    }
    fieldAnalysts.forEach(a => map.set(a.name, []));

    fieldDays.filter(d => d.analyst).forEach(d => {
        if (!map.has(d.analyst)) map.set(d.analyst, []);
        map.get(d.analyst).push(d.date);
    });

    const implicit = fieldDays.filter(d => !d.analyst);
    if (implicit.length > 0) {
        const k = fieldAnalysts.length;
        const base = Math.floor(implicit.length / k);
        const extra = implicit.length % k;
        let idx = 0;
        fieldAnalysts.forEach((a, i) => {
            const quota = base + (i === 0 ? extra : 0);
            for (let j = 0; j < quota && idx < implicit.length; j++, idx++) {
                map.get(a.name).push(implicit[idx].date);
            }
        });
    }
    return map;
}

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

// ── Sugerencia de valor presupuestado según el histórico del cliente ───────────
function updateBudgetSuggestion() {
    const box = document.getElementById('budgetSuggestion');
    if(!box) return;
    const hide = () => { box.style.display = 'none'; box.innerHTML = ''; };

    const clientSel = document.getElementById('taskClient');
    const serviceType = document.getElementById('taskServiceType')?.value || '';
    const isAbsence = _absenceModalActive || ['Vacaciones', 'Incapacidad', 'Compensatorio', 'Entrenamiento o Curso'].includes(serviceType);
    if(!clientSel || !clientSel.value || isAbsence) { hide(); return; }

    const clientRec = dbClients.find(c => c.id === clientSel.value);
    const clientName = clientRec ? getClientDisplayName(clientRec) : '';
    const editId = document.getElementById('editTaskId')?.value || '';
    const norm = (v) => String(v || '').trim().toLowerCase();

    const plantSel = document.getElementById('taskPlant');
    const plantFree = document.getElementById('taskPlantFree');
    const plantName = (plantSel && plantSel.style.display !== 'none' && plantSel.value)
        ? plantSel.options[plantSel.selectedIndex].text
        : (plantFree && plantFree.style.display !== 'none' ? plantFree.value.trim() : '');

    const base = tasks.filter(t => !t.isAbsence && t.id !== editId && (parseFloat(t.budget) || 0) > 0
        && (t.clientId === clientSel.value || (clientName && norm(t.client) === norm(clientName))));

    let tier = [], scope = '';
    if(serviceType && plantName) {
        tier = base.filter(t => t.serviceType === serviceType && norm(t.plantName) === norm(plantName));
        scope = `${serviceType} en ${plantName}`;
    }
    if(!tier.length && serviceType) {
        tier = base.filter(t => t.serviceType === serviceType);
        scope = serviceType;
    }
    if(!tier.length) {
        tier = base;
        scope = serviceType ? `sin gestiones de ${serviceType} — mostrando otros servicios` : 'todos los servicios';
    }

    const label = _escHtml(clientName || 'este cliente');
    box.style.display = '';
    if(!tier.length) {
        box.innerHTML = `<div style="margin-top:6px;font-size:0.75rem;color:#94a3b8;">💡 Sin gestiones anteriores con valor para ${label}.</div>`;
        return;
    }

    tier = tier.slice().sort((a, b) => String(b.mesFacturacion || b.period || '').localeCompare(String(a.mesFacturacion || a.period || '')));
    const recent = tier.slice(0, 6);
    const avg = Math.round(recent.reduce((sum, t) => sum + (parseFloat(t.budget) || 0), 0) / recent.length);
    const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');
    const monthLbl = (t) => {
        const [y, m] = String(t.mesFacturacion || t.period || '').split('-');
        return m ? `${monthNames[parseInt(m, 10) - 1]?.slice(0, 3)} ${y}` : '';
    };
    const chipStyle = 'border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:99px;padding:2px 10px;font-size:0.74rem;font-weight:700;cursor:pointer;';

    box.innerHTML = `
        <div style="margin-top:6px;font-size:0.75rem;color:#64748b;">💡 Histórico de <strong>${label}</strong> (${_escHtml(scope)}) — toca un valor para usarlo:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
            ${recent.slice(0, 4).map(t => `<button type="button" style="${chipStyle}" onclick="applyBudgetSuggestion(${Math.round(parseFloat(t.budget) || 0)})" title="Usar este valor">${fmt(t.budget)} <span style="font-weight:400;opacity:.7;">${monthLbl(t)}</span></button>`).join('')}
            ${recent.length > 1 ? `<button type="button" style="${chipStyle}background:#f0fdf4;border-color:#bbf7d0;color:#15803d;" onclick="applyBudgetSuggestion(${avg})" title="Promedio de las últimas ${recent.length} gestiones">Promedio ${fmt(avg)}</button>` : ''}
        </div>`;
}

function applyBudgetSuggestion(value) {
    const input = document.getElementById('taskBudget');
    if(!input) return;
    input.value = value;
    input.focus();
}

// true mientras el modal se usa en modo "Registrar Ausencia": el formulario debe mostrar
// los campos de ausencia desde el inicio, aunque aún no se haya elegido el tipo.
let _absenceModalActive = false;

function onTaskServiceTypeChange() {
    const serviceType = document.getElementById('taskServiceType').value;
    const isAbsence       = _absenceModalActive || (serviceType === 'Vacaciones' || serviceType === 'Incapacidad' || serviceType === 'Compensatorio' || serviceType === 'Entrenamiento o Curso');
    const isAdminContract = (serviceType === 'Metro Administrativo');
    const isThirdParty    = (serviceType === 'Metro Terceros');

    updateBudgetSuggestion();

    // Campos que se ocultan solo en ausencias
    const fieldsToToggle = ['group-client', 'group-budget', 'group-equipment', 'group-report', 'group-billing'];
    fieldsToToggle.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = isAbsence ? 'none' : 'block';
    });

    // Etiquetas propias de ausencia
    const lblDays   = document.getElementById('label-days-field');
    const lblPeriod = document.getElementById('label-period-month');
    if(lblDays)   lblDays.textContent = isAbsence ? 'Días de Ausencia' : 'Días Planta';
    if(lblPeriod) lblPeriod.innerHTML = isAbsence
        ? 'Mes de Ausencia'
        : 'Mes de Gestión <span style="font-weight:400; color:#64748b; font-size:0.72rem;">(en qué mes va a aparecer)</span>';
    const billingSel = document.getElementById('taskBillingMonth');
    if(billingSel) billingSel.required = !isAbsence;

    // Campo de observaciones: solo en ausencias
    const notesGroup = document.getElementById('group-absence-notes');
    if(notesGroup) notesGroup.style.display = isAbsence ? 'block' : 'none';

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

// ── Facturación automática desde el ERP (el ERP solo se consulta, nunca se modifica) ──────
let _erpSettings = null, _erpLog = [], _erpBusy = false;
const _ERP_REASONS = {
    coincide: 'Valor coincide', valor_corregido: 'Valor corregido al de la factura', coincide_varias: 'Total de varias gestiones coincide',
    nota_credito: 'Hay nota crédito', envio_desconocido: 'No se pudo saber si la factura fue enviada',
    diferencia_mayor: 'Diferencia grande con el valor del planner', no_coincide_varias: 'El total facturado no coincide con la suma de las gestiones'
};

async function renderErpSyncPanel() {
    const el = document.getElementById('erp-sync-panel');
    if(!el) return;
    if(!['admin', 'assistant', 'viewer'].includes(currentUserProfile?.role)) { el.style.display = 'none'; return; }
    try {
        const [s, l] = await Promise.all([
            supabaseClient.from('erp_sync_settings').select('*').eq('id', 1).maybeSingle(),
            supabaseClient.from('erp_billing_log').select('*').order('created_at', { ascending: false }).limit(60)
        ]);
        if(s.error || l.error) { el.style.display = 'none'; return; }   // migración aún no ejecutada
        _erpSettings = s.data; _erpLog = l.data || [];
    } catch(e) { el.style.display = 'none'; return; }

    const canAct = ['admin', 'assistant'].includes(currentUserProfile.role);
    const isAdmin = currentUserProfile.role === 'admin';
    const mode = _erpSettings?.mode || 'prueba';
    const last = _erpSettings?.last_run_at ? new Date(_erpSettings.last_run_at).toLocaleString('es-CO') : 'nunca';
    const pending = _erpLog.filter(x => x.state === 'por_revisar');
    const proposed = _erpLog.filter(x => x.state === 'propuesto');
    const applied = _erpLog.filter(x => x.state === 'aplicado').slice(0, 8);
    const money = v => v === null || v === undefined ? '—' : '$' + Number(v).toLocaleString('es-CO');
    const row = x => `<tr>
        <td><strong>${_escHtml(x.negocio)}</strong></td>
        <td style="font-size:0.76rem;">${_escHtml((x.invoice_refs || []).join(', '))}</td>
        <td style="text-align:right;">${money(x.invoiced_total)}</td>
        <td style="font-size:0.76rem;color:#64748b;">${_escHtml(_ERP_REASONS[x.reason] || x.reason || '')}${x.details?.diff ? ` (${money(x.details.diff)})` : ''}</td>
        <td style="text-align:right;">${x.state === 'por_revisar' && canAct ? `<button class="btn-secondary" style="font-size:0.72rem;padding:2px 8px;" onclick="erpResolve('${x.id}')">Ya lo revisé</button>` : ''}</td></tr>`;
    const table = (rows) => `<table class="data-table" style="font-size:0.82rem;"><thead><tr><th>Negocio</th><th>Facturas</th><th style="text-align:right;">Total antes de IVA</th><th>Detalle</th><th></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;

    el.style.display = '';
    el.innerHTML = `
        <div class="stats-card" style="padding:1.25rem;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;">
                <div>
                    <h3 style="margin:0 0 0.2rem;font-size:1rem;">Facturación desde el ERP</h3>
                    <p style="margin:0;font-size:0.75rem;color:var(--text-secondary);">Compara las facturas enviadas en el ERP con los N° de negocio del planner. El ERP solo se consulta. Última revisión: ${last}.</p>
                </div>
                <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
                    <span style="background:${mode === 'activo' ? '#dcfce7' : '#fef3c7'};color:${mode === 'activo' ? '#15803d' : '#a16207'};font-size:0.68rem;font-weight:700;padding:3px 10px;border-radius:999px;text-transform:uppercase;">${mode === 'activo' ? 'Activo' : 'Modo prueba'}</span>
                    ${isAdmin ? `<button class="btn-outline" onclick="erpToggleMode()">${mode === 'activo' ? 'Volver a modo prueba' : 'Activar'}</button>` : ''}
                    ${canAct ? `<button class="btn-primary" id="erp-sync-btn" onclick="erpSyncNow()" ${_erpBusy ? 'disabled' : ''}>Sincronizar ahora</button>` : ''}
                </div>
            </div>
            ${mode !== 'activo' ? '<p style="font-size:0.76rem;color:#a16207;background:#fffbeb;border-radius:8px;padding:0.5rem 0.75rem;margin:0 0 0.75rem;">En modo prueba solo se registra lo que se haría; no se cambia ninguna gestión.</p>' : ''}
            ${pending.length ? `<h4 style="margin:0.75rem 0 0.4rem;font-size:0.85rem;">Por revisar (${pending.length})</h4>${table(pending)}` : ''}
            ${proposed.length ? `<h4 style="margin:0.75rem 0 0.4rem;font-size:0.85rem;">Se facturaría al activar (${proposed.length})</h4>${table(proposed)}` : ''}
            ${applied.length ? `<h4 style="margin:0.75rem 0 0.4rem;font-size:0.85rem;">Facturado automáticamente (últimos ${applied.length})</h4>${table(applied)}` : ''}
            ${!pending.length && !proposed.length && !applied.length ? '<p style="font-size:0.8rem;color:#94a3b8;margin:0.5rem 0 0;">Aún no hay movimientos. Asigna el N° de negocio a las gestiones para empezar.</p>' : ''}
        </div>`;
}

async function erpSyncNow() {
    if(_erpBusy) return;
    _erpBusy = true;
    const btn = document.getElementById('erp-sync-btn');
    if(btn) { btn.disabled = true; btn.textContent = 'Sincronizando…'; }
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch('/api/erp-billing-sync', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
        const out = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(out.error || `Error ${res.status}`);
        showToast(`Revisión lista · ${out.applied} facturadas, ${out.proposed} propuestas, ${out.review} por revisar`, 'success');
        if(out.applied) { await loadTasksFromSupabase(); renderTasksView(); }
    } catch(e) {
        showToast('No se pudo sincronizar con el ERP: ' + e.message, 'error');
    } finally {
        _erpBusy = false;
        renderErpSyncPanel();
    }
}

async function erpToggleMode() {
    const next = _erpSettings?.mode === 'activo' ? 'prueba' : 'activo';
    if(next === 'activo' && !confirm('En modo activo el planner pasará solo a "facturada" las gestiones cuyas facturas ya fueron enviadas en el ERP, y corregirá el valor cuando difiera. ¿Activar?')) return;
    const { error } = await supabaseClient.from('erp_sync_settings').update({ mode: next }).eq('id', 1);
    if(error) { showToast(error.message, 'error'); return; }
    renderErpSyncPanel();
}

async function erpResolve(id) {
    const { error } = await supabaseClient.from('erp_billing_log').update({ state: 'resuelto', resolved_by: currentUserProfile?.display_name || currentUser?.email || null, resolved_at: new Date().toISOString() }).eq('id', id);
    if(error) { showToast(error.message, 'error'); return; }
    renderErpSyncPanel();
}

function renderFinanceView() {
    renderErpSyncPanel();
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
            days_field: parseIntOrDefault(task.daysField, 1),
            days_report: parseInt(task.daysReport) || 0,
            scheduled_days: task.scheduledDays || [],
            status: task.status,
            period: task.period,
            equipment_id: task.equipmentId || null,
            service_type: task.serviceType,
            is_absence: task.isAbsence || false,
            absence_notes: task.absenceNotes || null,
            ...((task.negocio || task.negocioLoaded) ? { negocio: task.negocio || null } : {}),
            csat_score: task.csatScore || null,
            csat_observations: task.csatObservations || null,
            alertvox_checked: task.alertvoxChecked || false,
            client_no_response: task.clientNoResponse || false,
            evidence_notes: task.evidenceNotes || null,
            evidence_files: task.evidenceFiles || [],
            service_details: task.serviceDetails || null,
            service_details_raw: task.serviceDetailsRaw || null,
            service_details_read_at: task.serviceDetailsReadAt || null,
            mes_facturacion: task.mesFacturacion || task.period,
            analysts_assignment: task.analysts_assignment || [],
            plant_id:   task.plantId   || null,
            plant_name: task.plantName || null,
            executed_at:    task.executedAt    || null,
            csat_closed_at: task.csatClosedAt  || null
        };

        const existingId = task.supabaseId || (!isTemporaryId ? task.id : null);
        let result;

        if(existingId) {
            // Tarea existente: UPDATE puntual por id. Más predecible que upsert
            // y permite detectar si 0 filas fueron afectadas (RLS silencioso).
            result = await supabaseClient.from('tasks')
                .update(taskData)
                .eq('id', existingId)
                .select('id, mes_facturacion');

            if(!result.error && (!result.data || result.data.length === 0)) {
                console.error('UPDATE no afectó ninguna fila — posible RLS o id incorrecto:', existingId);
                showToast('El cambio no se guardó en la nube (sin permiso o id inválido). Contacta al administrador.', 'error');
            } else if(!result.error) {
                console.log('UPDATE ok:', result.data);
            }
        } else {
            // Tarea nueva: INSERT
            result = await supabaseClient.from('tasks').insert(taskData).select();
            if(result.data && result.data.length > 0) {
                const newRealId = result.data[0].id;
                task.id = newRealId;
                task.supabaseId = newRealId;
                console.log('Task inserted, new id:', newRealId);
            }
        }

        if(result.error) {
            console.error('Error saving to Supabase:', result.error);
            showToast('Error al guardar en la nube: ' + result.error.message, 'error');
        }
    } catch(err) {
        console.error("Sync error:", err);
        showToast('Error de conexión al guardar. Los cambios pueden no haberse guardado.', 'error');
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
                daysField: parseIntOrDefault(t.days_field, 1),
                daysReport: parseInt(t.days_report) || 0,
                serviceType: t.service_type || '',
                isAbsence: t.is_absence || false,
                scheduledDays: t.scheduled_days || [],
                status: t.status || 'proyectada',
                period: t.period || formatPeriod(),
                mesFacturacion: t.mes_facturacion || t.period || formatPeriod(),
                csatScore: t.csat_score || null,
                csatObservations: t.csat_observations || '',
                absenceNotes: t.absence_notes || '',
                negocio: t.negocio || '',
                negocioLoaded: !!t.negocio,
                alertvoxChecked: t.alertvox_checked || false,
                clientNoResponse: t.client_no_response || false,
                evidenceNotes: t.evidence_notes || '',
                evidenceFiles: t.evidence_files || [],
                serviceDetails: t.service_details || '',
                serviceDetailsRaw: t.service_details_raw || '',
                serviceDetailsReadAt:      t.service_details_read_at       || null,
                serviceDetailsReadAtAdmin: t.service_details_read_at_admin || null,
                plantId:   t.plant_id   || null,
                plantName: t.plant_name || '',
                executedAt:    t.executed_at    || null,
                csatClosedAt:  t.csat_closed_at || null
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

            // 3. SYNC DELETES: Remove local tasks that no longer exist in the remote.
            // Without this, tasks deleted by an admin persist indefinitely in other
            // users' localStorage because the merge above only adds/updates, never removes.
            // Keep t_ tasks only if they have never been synced (no supabaseId); a t_ task
            // with a supabaseId means the UUID migration didn't finish persisting, and the
            // real record may have been deleted — don't keep it.
            const remoteIdSet = new Set(remoteTasks.map(t => t.id));
            tasks = tasks.filter(t => {
                if (remoteIdSet.has(t.id)) return true;
                if (t.supabaseId && remoteIdSet.has(t.supabaseId)) return true;
                // Keep only truly unsynced temp tasks (no supabaseId yet)
                return t.id.startsWith('t_') && !t.supabaseId;
            });
            
            saveTasks();
            if(typeof postDropSync === 'function') postDropSync();
        }
    } catch(err) {
        console.error("Error in loadTasksFromSupabase:", err);
        showToast('Error de conexión al cargar datos. Revisa tu red e intenta recargar.', 'error');
    }
}

// Lista maestra de opciones del selector "Tipo de Servicio" (gestiones normales, sin ausencias).
// openNewAbsenceModal() sustituye temporalmente el innerHTML de #taskServiceType por los tipos
// de ausencia; esta constante permite restaurarlo siempre que se abre una gestión normal,
// evitando que la mutación quede pegada y borre el tipo de servicio al editar (bug reportado).
const _taskServiceTypeOptionsHTML = `
    <option value="">Seleccione tipo...</option>
    <option value="Balanceo">⚖️ Balanceo</option>
    <option value="Alineación">📐 Alineación</option>
    <option value="Vibraciones">〰️ Vibraciones</option>
    <option value="Termografía">🌡️ Termografía</option>
    <option value="Ultrasonido">🔊 Ultrasonido</option>
    <option value="Rotodinámico">⚙️ Rotodinámico</option>
    <option value="Capacitación">📚 Capacitación</option>
    <option value="Calibración">🔬 Calibración</option>
    <option value="Metro Administrativo">🏢 Metro Administrativo</option>
    <option value="Metro Terceros">🤝 Metro Terceros</option>`;

const _absenceServiceTypeOptionsHTML = `
    <option value="">Seleccione tipo…</option>
    <option value="Vacaciones">🌴 Vacaciones</option>
    <option value="Incapacidad">💊 Incapacidad</option>
    <option value="Compensatorio">🔄 Compensatorio</option>
    <option value="Entrenamiento o Curso">🎓 Entrenamiento o Curso</option>`;

function _resetTaskServiceTypeOptions() {
    const sel = document.getElementById('taskServiceType');
    if(sel) sel.innerHTML = _taskServiceTypeOptionsHTML;
}

function openNewTaskModal() {
    try {
        _absenceModalActive = false;
        _resetTaskServiceTypeOptions();
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

        const _splitEl = document.getElementById('taskSplitField');
        if(_splitEl) _splitEl.checked = false;

        // Limpiar campo de observaciones y ocultarlo
        const notesEl    = document.getElementById('taskAbsenceNotes');
        const notesGroup = document.getElementById('group-absence-notes');
        if(notesEl)    notesEl.value           = '';
        if(notesGroup) notesGroup.style.display = 'none';

        // Restaurar el layout de gestión normal (por si el modal se usó antes como "Registrar Ausencia")
        ['group-client', 'group-budget', 'group-report', 'group-billing'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = '';
        });
        const _lblDays = document.getElementById('label-days-field');
        if(_lblDays) _lblDays.textContent = 'Días Planta';
        const _lblPeriod = document.getElementById('label-period-month');
        if(_lblPeriod) _lblPeriod.innerHTML = 'Mes de Gestión <span style="font-weight:400; color:#64748b; font-size:0.72rem;">(en qué mes va a aparecer)</span>';
        const _billSel = document.getElementById('taskBillingMonth');
        if(_billSel) _billSel.required = true;

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

        updateBudgetSuggestion();
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

        // Restaurar lista completa de tipos de servicio (openNewAbsenceModal pudo haberla
        // reducido a solo tipos de ausencia en una apertura previa del modal)
        _absenceModalActive = false;
        _resetTaskServiceTypeOptions();
        if(task.isAbsence) {
            const sel = document.getElementById('taskServiceType');
            if(sel) sel.innerHTML = _absenceServiceTypeOptionsHTML;
        }

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
        const negocioEl = document.getElementById('taskNegocio');
        if (negocioEl) negocioEl.value = task.negocio || '';

        const fieldEl = document.getElementById('taskDaysField');
        if (fieldEl) fieldEl.value = task.daysField ?? 1;

        const reportEl = document.getElementById('taskDaysReport');
        if (reportEl) reportEl.value = task.daysReport ?? 0;

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
            const currentBilling = task.mesFacturacion || formatPeriod();
            _populateMonthSelect('taskBillingMonth', currentBilling);
            billingMonthEl.value = currentBilling;
        }

        const periodMonthEl = document.getElementById('taskPeriodMonth');
        if (periodMonthEl) {
            populatePeriodMonthSelect();
            periodMonthEl.value = task.period || formatPeriod();
        }

        const splitEl = document.getElementById('taskSplitField');
        if(splitEl) splitEl.checked = isFieldSplit(task);

        // Observaciones de ausencia
        const notesEl    = document.getElementById('taskAbsenceNotes');
        const notesGroup = document.getElementById('group-absence-notes');
        if(notesEl)    notesEl.value           = task.absenceNotes || '';
        if(notesGroup) notesGroup.style.display = task.isAbsence ? 'block' : 'none';

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
        const dField = parseIntOrDefault(document.getElementById('taskDaysField').value, 1);
        const dReport = parseInt(document.getElementById('taskDaysReport').value) || 0;
        const serviceType = document.getElementById('taskServiceType').value;
        const editId = document.getElementById('editTaskId').value;
        const clientId = clientSelect ? clientSelect.value : '';

        const isAbsence       = (serviceType === 'Vacaciones' || serviceType === 'Incapacidad' || serviceType === 'Compensatorio' || serviceType === 'Entrenamiento o Curso');
        const isAdminContract = (serviceType === 'Metro Administrativo');
        const isThirdParty    = (serviceType === 'Metro Terceros');
        const finalClientName = isAbsence ? `AUSENCIA: ${serviceType}` : clientName;
        const absenceNotes    = isAbsence ? (document.getElementById('taskAbsenceNotes')?.value.trim() || '') : '';

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

        const splitRequested = !isAbsence && !!document.getElementById('taskSplitField')?.checked;
        if(splitRequested && analystsAssignment.filter(a => a.isTitular).length < 2) {
            alert('Para repartir la medición por turnos se necesitan al menos 2 analistas titulares (marcados para ir a planta).');
            return;
        }
        analystsAssignment.forEach(a => { if(splitRequested) a.splitField = true; });

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
                const oldDaysField  = tasks[idx].daysField  ?? 1;
                const oldDaysReport = tasks[idx].daysReport ?? 0;

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
                tasks[idx].period = document.getElementById('taskPeriodMonth')?.value || tasks[idx].period;
                tasks[idx].mesFacturacion = isAbsence ? tasks[idx].period : document.getElementById('taskBillingMonth').value;
                if(isAbsence) tasks[idx].absenceNotes = absenceNotes;
                if(!isAbsence) {
                    const negNew = (document.getElementById('taskNegocio')?.value || '').toUpperCase().replace(/\s+/g, '');
                    if(negNew !== (tasks[idx].negocio || '')) { tasks[idx].negocio = negNew; tasks[idx].negocioLoaded = true; }
                }
                // Si se desactivó la medición por turnos, los días de planta vuelven a ser comunes
                if(!splitRequested) (tasks[idx].scheduledDays || []).forEach(d => { if(d.type === 'field') delete d.analyst; });
                // Un día de planta asignado a mano a alguien que ya no es titular se vuelve a repartir
                else {
                    const titularNames = new Set(analystsAssignment.filter(a => a.isTitular).map(a => a.name));
                    (tasks[idx].scheduledDays || []).forEach(d => {
                        if(d.type === 'field' && d.analyst && !titularNames.has(d.analyst)) delete d.analyst;
                    });
                }

                // Ajustar scheduledDays si la tarea ya está programada y cambió el conteo de días
                if ((tasks[idx].scheduledDays || []).length > 0 && (oldDaysField !== dField || oldDaysReport !== dReport)) {
                    const adjustScheduledType = (type, oldCount, newCount) => {
                        if (oldCount === newCount) return;
                        // Índices del tipo, ordenados cronológicamente
                        const byDate = tasks[idx].scheduledDays
                            .map((d, i) => ({ ...d, _i: i }))
                            .filter(d => d.type === type)
                            .sort((a, b) => a.date.localeCompare(b.date));
                        if (newCount < oldCount) {
                            // Recortar los últimos (oldCount - newCount) del tipo
                            const toRemove = new Set(byDate.slice(newCount).map(d => d._i));
                            tasks[idx].scheduledDays = tasks[idx].scheduledDays.filter((_, i) => !toRemove.has(i));
                        } else {
                            // Añadir (newCount - oldCount) días laborables después del último del tipo
                            const lastDate = byDate.length > 0 ? byDate[byDate.length - 1].date : null;
                            if (!lastDate) return;
                            let cursor = new Date(lastDate + 'T12:00:00');
                            let added = 0;
                            const needed = newCount - oldCount;
                            while (added < needed) {
                                cursor.setDate(cursor.getDate() + 1);
                                const y = cursor.getFullYear();
                                const m = cursor.getMonth() + 1;
                                const d = cursor.getDate();
                                if (!isHolidayOrWeekend(y, m, d)) {
                                    tasks[idx].scheduledDays.push({
                                        day: d,
                                        date: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
                                        type
                                    });
                                    added++;
                                }
                            }
                        }
                    };
                    adjustScheduledType('field',  oldDaysField,  dField);
                    adjustScheduledType('report', oldDaysReport, dReport);
                }

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
                mesFacturacion: isAbsence
                    ? (document.getElementById('taskPeriodMonth')?.value || formatPeriod())
                    : document.getElementById('taskBillingMonth').value,
                absenceNotes: absenceNotes || '',
                negocio: isAbsence ? '' : (document.getElementById('taskNegocio')?.value || '').toUpperCase().replace(/\s+/g, '')
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

        // Si esta "Reunión de Cierre" ejecuta y cierra en un solo paso (admin/asistente
        // sobre una gestión aún programada), marca el momento de ejecución igual que
        // analystMarkExecuted, para que los días de cierre pendiente cuenten bien.
        if(prevStatus !== 'ejecutada' && targetStatus === 'ejecutada' && !tasks[taskIndex].executedAt) {
            tasks[taskIndex].executedAt = new Date().toISOString();
        }
        // Registra el momento del cierre CSAT (calificado o "cliente no respondió")
        // la primera vez, para poder medir cuánto tardó el analista en cerrar.
        if((score || noResponse) && !tasks[taskIndex].csatClosedAt) {
            tasks[taskIndex].csatClosedAt = new Date().toISOString();
        }

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
    // La vista Semana del cronograma solo tiene sentido dentro de "planning": si se sale
    // de esa vista con Semana activa, se vuelve a Mes para no dejar el selector de período
    // global (usado por todas las demás pantallas) atascado en modo semana.
    if (viewName !== 'planning' && calendarView === 'week') {
        calendarView = 'month';
        updatePeriodDisplay();
        document.querySelectorAll('#view-planning .view-toggle-group button').forEach(btn => btn.classList.remove('active'));
        document.getElementById('btn-view-month')?.classList.add('active');
    }

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
            efficiency: 'Eficiencia de Clientes y Analistas',
            surveys:   'Encuestas de Satisfacción',
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
    } else if(viewName === 'efficiency') {
        renderEfficiencyView();
    } else if(viewName === 'surveys') {
        initSurveysView();
    } else if(viewName === 'inventory') {
        initInventoryView();
    } else {
        renderBoard();
    }

    if(viewName === 'dashboard' && typeof renderDashboardSurveyCard === 'function') renderDashboardSurveyCard();
    updateCsatBadge();

    // Recarga silenciosa desde Supabase al cambiar de vista
    if(supabaseClient) {
        loadTasksFromSupabase().then(() => {
            if(viewName === 'planning')   { renderCalendar(); renderPlanningSidebar(); }
            else if(viewName === 'mywork')  { renderMyWorkView(); updateCsatBadge(); }
            else if(viewName === 'tasks')   { renderTasksView(); }
            else if(viewName === 'finance') { renderFinanceView(); }
            else if(viewName === 'reports') {
                if(reportActiveTab === 'csat')           renderCsatTable();
                else if(reportActiveTab === 'ausencias') renderAusenciasTable();
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
// ENCUESTAS DE SATISFACCIÓN DE CLIENTES (rondas trimestrales)
// Rondas → invitaciones (clientes a llamar) → respuestas. Dashboard de resultados.
// ══════════════════════════════════════════

let dbSurveyRounds = [], dbSurveyInvites = [], dbSurveyResponses = [], dbClientContacts = [], dbSurveyCompanyMap = [];
let _svAllInvites = [], _svAllContacts = [];   // tal como están en la base; dbSurveyInvites / dbClientContacts excluyen las compañías excluidas
let _svTab = 'rounds';          // 'rounds' | 'dashboard' | 'contacts'
let _svOpenRound = null;        // id de la ronda abierta
let _svMissing = false;         // tablas sin migrar
let _svDashScope = 'all';       // 'all' | 'last12' | 'year:2026' | 'round:<id>'
let _svOnlyAlerts = false;
let _svChart = null;
let _svContactSearch = '';
let _svWizard = null;
let _svForm = null;
let _svContactCtx = null;
let _svAttemptId = null;

// Roles que ven los resultados (agregar 'commercial' y 'viewer' cuando se habilite para ellos).
const _SV_RESULTS_ROLES = ['admin', 'viewer'];
const _SV_FILL_ROLES = ['admin', 'assistant'];

const _SV_DIMS = [
    { k: 'q_punctual',     label: 'Cumplimiento de mediciones' },
    { k: 'q_verbal',       label: 'Acercamiento' },
    { k: 'q_reports_time', label: 'Cumplimiento de análisis' },
    { k: 'q_clarity',      label: 'Claridad' },
    { k: 'q_accuracy',     label: 'Certeza' },
    { k: 'q_recommend',    label: 'Recomendación' },
    { k: 'q_ally',         label: 'Confianza' }
];
const _SV_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function _svCanFill()    { return _SV_FILL_ROLES.includes(currentUserProfile?.role); }
function _svCanResults() { return _SV_RESULTS_ROLES.includes(currentUserProfile?.role); }

function _svKey(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function _svSameCompany(a, b) {
    if(!a || !b) return false;
    return a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ');
}

function _svNum(v) { return (v === null || v === undefined || v === '') ? null : Number(v); }

function _svFmt(v, d = 2) { return v === null || v === undefined || isNaN(v) ? '—' : Number(v).toFixed(d).replace('.', ','); }

function _svScoreStyle(v) {
    if(v === null || v === undefined || isNaN(v)) return { color: '#94a3b8', bg: '#f1f5f9' };
    if(v >= 4.5) return { color: '#15803d', bg: '#dcfce7' };
    if(v >= 4)   return { color: '#1d4ed8', bg: '#dbeafe' };
    if(v >= 3.5) return { color: '#b45309', bg: '#fef3c7' };
    return { color: '#b91c1c', bg: '#fee2e2' };
}

function _svBadge(v, big) {
    const st = _svScoreStyle(v);
    return `<span style="display:inline-block;min-width:${big ? 52 : 38}px;text-align:center;background:${st.bg};color:${st.color};border-radius:99px;padding:${big ? '3px 11px' : '1px 7px'};font-weight:800;font-size:${big ? '1rem' : '0.76rem'};">${_svFmt(v)}</span>`;
}

/** Promedio de una respuesta: media de las dimensiones respondidas. */
function _svResponseScore(r) {
    const vals = _SV_DIMS.map(d => _svNum(r[d.k])).filter(v => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Promedios por dimensión y general (media de los promedios por dimensión, como en el Excel). */
function _svAverages(responses) {
    const out = { dims: {}, overall: null, closing: null, n: responses.length };
    const dimVals = [];
    _SV_DIMS.forEach(d => {
        const v = responses.map(r => _svNum(r[d.k])).filter(x => x !== null);
        out.dims[d.k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
        if(out.dims[d.k] !== null) dimVals.push(out.dims[d.k]);
    });
    out.overall = dimVals.length ? dimVals.reduce((a, b) => a + b, 0) / dimVals.length : null;
    const cm = responses.map(r => _svNum(r.q_closing_meeting)).filter(x => x !== null);
    out.closing = cm.length ? cm.reduce((a, b) => a + b, 0) / cm.length : null;
    return out;
}

function _svInviteById(id) { return dbSurveyInvites.find(i => i.id === id); }
function _svResponseOf(inviteId) { return dbSurveyResponses.find(r => r.invite_id === inviteId); }
function _svRoundById(id) { return dbSurveyRounds.find(r => r.id === id); }

function _svRoundStats(roundId) {
    const invites = dbSurveyInvites.filter(i => i.round_id === roundId && i.status !== 'omitida');
    const resp = invites.map(i => _svResponseOf(i.id)).filter(Boolean);
    return { invites: invites.length, answered: resp.length, avg: _svAverages(resp).overall };
}

function _svRoundDate(r) { return r.survey_date || (r.created_at || '').slice(0, 10); }

async function loadSurveyData() {
    if(!supabaseClient) return;
    const [r1, r2, r3, r4, r5] = await Promise.all([
        supabaseClient.from('survey_rounds').select('*'),
        supabaseClient.from('survey_invites').select('*'),
        supabaseClient.from('survey_responses').select('*'),
        supabaseClient.from('client_contacts').select('*').order('sort_order'),
        supabaseClient.from('survey_company_map').select('*')
    ]);
    _svMissing = !!(r1.error && /survey_rounds|schema cache|does not exist/i.test(r1.error.message || ''));
    if(r1.data) dbSurveyRounds = r1.data;
    if(r2.data) _svAllInvites = r2.data;
    if(r3.data) dbSurveyResponses = r3.data;
    if(r4.data) _svAllContacts = r4.data;
    if(r5.data) dbSurveyCompanyMap = r5.data;
    _svApplyCompanyMap();
}

async function initSurveysView() {
    const el = document.getElementById('surveys-container');
    if(el && !dbSurveyRounds.length) el.innerHTML = '<div style="text-align:center;padding:3rem;color:#94a3b8;">Cargando encuestas…</div>';
    await loadSurveyData();
    renderSurveysView();
}

function setSurveyTab(tab) { _svTab = tab; _svOpenRound = null; renderSurveysView(); }

function renderSurveysView() {
    const el = document.getElementById('surveys-container');
    if(!el) return;
    const canFill = _svCanFill(), canRes = _svCanResults();
    if(!canFill && !canRes) {
        el.innerHTML = '<div style="text-align:center;padding:3rem;color:#94a3b8;">No tienes permiso para ver esta sección.</div>';
        return;
    }
    if(_svMissing) {
        el.innerHTML = '<div style="text-align:center;padding:3rem;color:#b45309;">Falta ejecutar la migración de encuestas en Supabase (supabase_migration_surveys.sql).</div>';
        return;
    }
    const tabs = [];
    if(canFill || canRes) tabs.push({ id: 'rounds', label: '📋 Rondas' });
    if(canRes) tabs.push({ id: 'dashboard', label: '📊 Resultados' });
    if(canFill) tabs.push({ id: 'contacts', label: '👥 Contactos' });
    if(canFill) { const pend = _svReconcileRows().filter(r => r.status === 'pending' || r.status === 'suggested').length; tabs.push({ id: 'reconcile', label: `🔗 Conciliar clientes${pend ? ` <span style="background:#d97706;color:#fff;border-radius:99px;padding:0 6px;font-size:0.7rem;margin-left:4px;">${pend}</span>` : ''}` }); }
    if(!tabs.some(t => t.id === _svTab)) _svTab = tabs[0].id;

    let body = '';
    if(_svTab === 'rounds') body = _svOpenRound ? _svRoundDetail() : _svRoundsList();
    else if(_svTab === 'dashboard') body = _svDashboard();
    else if(_svTab === 'reconcile') body = _svReconcileTab();
    else body = _svContactsTab();

    el.innerHTML = `
        <div class="kanban-header" style="margin-bottom:1.25rem;">
            <div>
                <h2>Encuestas de Satisfacción</h2>
                <p class="subtitle">Rondas trimestrales de llamadas a clientes, con sus resultados.</p>
            </div>
            ${(_svTab === 'rounds' && !_svOpenRound && canFill) ? '<button class="btn-primary" onclick="svOpenNewRound()">+ Nueva ronda</button>' : ''}
        </div>
        <div class="view-toggle-group" style="margin-bottom:1.25rem;">
            ${tabs.map(t => `<button class="${_svTab === t.id ? 'active' : ''}" onclick="setSurveyTab('${t.id}')">${t.label}</button>`).join('')}
        </div>
        ${body}`;
    if(_svTab === 'dashboard') { _svDrawChart(); _svDrawGauges(_svDashGaugeItems, 'svg'); }
}

// ── Lista de rondas ───────────────────────────────────────────────────────────
function _svRoundsList() {
    const rounds = dbSurveyRounds.slice().sort((a, b) => _svRoundDate(b).localeCompare(_svRoundDate(a)));
    if(!rounds.length) return '<div class="stats-card" style="text-align:center;padding:3rem;color:#94a3b8;">Aún no hay rondas. Crea la primera con "+ Nueva ronda".</div>';
    const canRes = _svCanResults();
    return `<div class="stats-card" style="padding:0;overflow-x:auto;"><table class="data-table" style="font-size:0.84rem;">
        <thead><tr><th>Ronda</th><th>Fecha</th><th>Estado</th><th style="text-align:center;">Respondidas</th>${canRes ? '<th style="text-align:center;">Promedio</th>' : ''}<th style="text-align:right;">Acciones</th></tr></thead>
        <tbody>${rounds.map(r => {
            const s = _svRoundStats(r.id);
            const pct = s.invites ? Math.round(s.answered / s.invites * 100) : 0;
            return `<tr>
                <td><strong>${_escHtml(r.name)}</strong>${r.source === 'excel' ? ' <span style="font-size:0.68rem;color:#94a3b8;">· historial</span>' : ''}</td>
                <td>${_escHtml(_svRoundDate(r))}</td>
                <td><span style="background:${r.status === 'abierta' ? '#dcfce7' : '#f1f5f9'};color:${r.status === 'abierta' ? '#15803d' : '#64748b'};border-radius:99px;padding:2px 10px;font-size:0.72rem;font-weight:700;">${r.status === 'abierta' ? 'Abierta' : 'Cerrada'}</span></td>
                <td style="text-align:center;white-space:nowrap;">${s.answered}/${s.invites} <span style="color:#94a3b8;font-size:0.72rem;">(${pct}%)</span></td>
                ${canRes ? `<td style="text-align:center;">${_svBadge(s.avg, false)}</td>` : ''}
                <td style="text-align:right;white-space:nowrap;">
                    <button class="btn-outline" onclick="svOpenRound('${r.id}')" style="font-size:0.76rem;padding:3px 12px;">Abrir</button>
                    ${currentUserProfile?.role === 'admin' ? `<button class="btn-secondary" onclick="svDeleteRound('${r.id}')" title="Eliminar ronda" style="font-size:0.76rem;padding:3px 9px;color:#dc2626;">🗑</button>` : ''}
                </td></tr>`;
        }).join('')}</tbody></table></div>`;
}

function svOpenRound(id) { _svOpenRound = id; renderSurveysView(); }
function svBackToRounds() { _svOpenRound = null; renderSurveysView(); }

async function svDeleteRound(id) {
    const r = _svRoundById(id);
    if(!r || !confirm(`¿Eliminar la ronda "${r.name}"?\n\nSe borrarán también sus invitaciones y respuestas.`)) return;
    const { error } = await supabaseClient.from('survey_rounds').delete().eq('id', id);
    if(error) { showToast('No se pudo eliminar: ' + error.message, 'error'); return; }
    await loadSurveyData();
    _svOpenRound = null;
    renderSurveysView();
}

async function svSetRoundStatus(id, status) {
    const upd = { status, closed_at: status === 'cerrada' ? new Date().toISOString() : null };
    const { error } = await supabaseClient.from('survey_rounds').update(upd).eq('id', id);
    if(error) { showToast(error.message, 'error'); return; }
    await loadSurveyData();
    renderSurveysView();
}

// ── Detalle de una ronda: hoja de llamadas ────────────────────────────────────
const _SV_STATUS = {
    pendiente:     { label: 'Pendiente',     color: '#64748b', bg: '#f1f5f9' },
    contactado:    { label: 'Contactado',    color: '#1d4ed8', bg: '#dbeafe' },
    respondida:    { label: 'Respondida',    color: '#15803d', bg: '#dcfce7' },
    sin_respuesta: { label: 'Sin respuesta', color: '#b91c1c', bg: '#fee2e2' },
    omitida:       { label: 'Omitida',       color: '#94a3b8', bg: '#f8fafc' }
};

function _svRoundDetail() {
    const round = _svRoundById(_svOpenRound);
    if(!round) { _svOpenRound = null; return _svRoundsList(); }
    const canFill = _svCanFill(), canRes = _svCanResults();
    const invites = dbSurveyInvites.filter(i => i.round_id === round.id)
        .sort((a, b) => a.company_name.localeCompare(b.company_name, 'es'));
    const s = _svRoundStats(round.id);
    const pct = s.invites ? Math.round(s.answered / s.invites * 100) : 0;
    const open = round.status === 'abierta';

    const rows = invites.map(i => {
        const st = _SV_STATUS[i.status] || _SV_STATUS.pendiente;
        const resp = _svResponseOf(i.id);
        const attempts = Array.isArray(i.attempts) ? i.attempts : [];
        const last = attempts[attempts.length - 1];
        const phone = (i.contact_phone || '').trim();
        const tel = phone.replace(/[^\d+]/g, '');
        return `<tr style="${i.status === 'omitida' ? 'opacity:.55;' : ''}">
            <td><strong>${_escHtml(i.company_name)}</strong>${i.service_months ? `<div style="font-size:0.7rem;color:#64748b;">Servicio: ${_escHtml(i.service_months)}</div>` : ''}${i.analysts ? `<div style="font-size:0.7rem;color:#94a3b8;">${_escHtml(i.analysts)}</div>` : ''}</td>
            <td>${i.contact_name ? `<div>${_escHtml(i.contact_name)}</div><div style="font-size:0.7rem;color:#64748b;">${_escHtml(i.contact_role || '')}</div>` : '<span style="color:#dc2626;font-size:0.78rem;">Sin contacto</span>'}</td>
            <td style="font-size:0.78rem;white-space:nowrap;">${phone ? `<a href="tel:${_escHtml(tel)}" style="color:var(--clr-blue);text-decoration:none;">📞 ${_escHtml(phone)}</a>` : '<span style="color:#cbd5e1;">—</span>'}${i.contact_email ? `<div><a href="mailto:${_escHtml(i.contact_email)}" style="color:#64748b;text-decoration:none;font-size:0.72rem;">✉ ${_escHtml(i.contact_email)}</a></div>` : ''}</td>
            <td><span style="background:${st.bg};color:${st.color};border-radius:99px;padding:2px 10px;font-size:0.72rem;font-weight:700;white-space:nowrap;">${st.label}</span>${resp && canRes ? ` ${_svBadge(_svResponseScore(resp), false)}` : ''}</td>
            <td style="font-size:0.74rem;color:#64748b;" title="${_escHtml(last ? last.note || '' : '')}">${attempts.length ? `${attempts.length} intento${attempts.length !== 1 ? 's' : ''}<div style="color:#94a3b8;">${_escHtml(last.result || '')}</div>` : '—'}</td>
            <td style="text-align:right;white-space:nowrap;">${canFill ? `
                <button class="btn-outline" onclick="svOpenSurvey('${i.id}')" style="font-size:0.74rem;padding:3px 10px;">${resp ? '📝 Editar' : '📝 Encuesta'}</button>
                <button class="btn-secondary" onclick="svOpenAttempt('${i.id}')" title="Registrar intento de contacto" style="font-size:0.74rem;padding:3px 8px;">📞</button>
                <button class="btn-secondary" onclick="svEditInviteContact('${i.id}')" title="Editar contacto" style="font-size:0.74rem;padding:3px 8px;">✏️</button>
                <button class="btn-secondary" onclick="svToggleOmit('${i.id}')" title="${i.status === 'omitida' ? 'Restaurar' : 'Omitir de la ronda'}" style="font-size:0.74rem;padding:3px 8px;">${i.status === 'omitida' ? '↺' : '⊘'}</button>` : ''}</td>
        </tr>`;
    }).join('');

    return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.9rem;">
            <div style="display:flex;align-items:center;gap:0.75rem;">
                <button class="btn-outline" onclick="svBackToRounds()" style="font-size:0.78rem;padding:3px 12px;">← Rondas</button>
                <h3 style="margin:0;">${_escHtml(round.name)}</h3>
                <span style="background:${open ? '#dcfce7' : '#f1f5f9'};color:${open ? '#15803d' : '#64748b'};border-radius:99px;padding:2px 10px;font-size:0.72rem;font-weight:700;">${open ? 'Abierta' : 'Cerrada'}</span>
            </div>
            <div style="display:flex;gap:0.5rem;">
                ${canFill && open ? '<button class="btn-outline" onclick="svAddInvite()" style="font-size:0.78rem;padding:4px 12px;">+ Agregar cliente</button>' : ''}
                ${currentUserProfile?.role === 'admin' ? `<button class="btn-secondary" onclick="svSetRoundStatus('${round.id}', '${open ? 'cerrada' : 'abierta'}')" style="font-size:0.78rem;padding:4px 12px;">${open ? 'Cerrar ronda' : 'Reabrir ronda'}</button>` : ''}
            </div>
        </div>
        <div style="margin-bottom:0.9rem;">
            <div style="background:#e2e8f0;border-radius:99px;height:8px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:#16a34a;"></div></div>
            <div style="font-size:0.78rem;color:#64748b;margin-top:4px;">${s.answered} de ${s.invites} respondidas (${pct}%)${canRes && s.avg !== null ? ` · promedio ${_svFmt(s.avg)}` : ''}${round.window_start ? ` · ventana ${round.window_start} a ${round.window_end}` : ''}</div>
        </div>
        <div class="stats-card" style="padding:0;overflow-x:auto;"><table class="data-table" style="font-size:0.82rem;">
            <thead><tr><th>Cliente</th><th>Contacto</th><th>Teléfono / correo</th><th>Estado</th><th>Intentos</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#94a3b8;">Sin clientes en esta ronda.</td></tr>'}</tbody>
        </table></div>`;
}

async function svToggleOmit(inviteId) {
    const inv = _svInviteById(inviteId);
    if(!inv) return;
    const status = inv.status === 'omitida' ? 'pendiente' : 'omitida';
    const { error } = await supabaseClient.from('survey_invites').update({ status }).eq('id', inviteId);
    if(error) { showToast(error.message, 'error'); return; }
    await loadSurveyData();
    renderSurveysView();
}

// ── Intentos de contacto ──────────────────────────────────────────────────────
function svOpenAttempt(inviteId) {
    const inv = _svInviteById(inviteId);
    if(!inv) return;
    _svAttemptId = inviteId;
    const attempts = Array.isArray(inv.attempts) ? inv.attempts : [];
    document.getElementById('svAttempt_title').textContent = `Intento de contacto — ${inv.company_name}`;
    document.getElementById('svAttempt_history').innerHTML = attempts.length
        ? attempts.slice().reverse().map(a => `<div style="font-size:0.76rem;color:#64748b;padding:2px 0;">${_escHtml(new Date(a.at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }))} · ${_escHtml(a.channel || '')} · <strong>${_escHtml(a.result || '')}</strong>${a.note ? ' — ' + _escHtml(a.note) : ''}</div>`).join('')
        : '<div style="font-size:0.76rem;color:#94a3b8;">Sin intentos registrados.</div>';
    document.getElementById('svAttempt_note').value = '';
    document.getElementById('svAttempt_final').checked = false;
    document.getElementById('svAttemptModal').classList.add('active');
}

async function svSaveAttempt() {
    const inv = _svInviteById(_svAttemptId);
    if(!inv) return;
    const result = document.getElementById('svAttempt_result').value;
    const attempt = {
        at: new Date().toISOString(),
        channel: document.getElementById('svAttempt_channel').value,
        result,
        note: document.getElementById('svAttempt_note').value.trim(),
        by: currentUserProfile?.display_name || currentUserProfile?.analyst_name || currentUser?.email || ''
    };
    const attempts = [...(Array.isArray(inv.attempts) ? inv.attempts : []), attempt];
    const upd = { attempts };
    if(inv.status !== 'respondida') {
        if(document.getElementById('svAttempt_final').checked) upd.status = 'sin_respuesta';
        else if(result === 'Habló con el contacto') upd.status = 'contactado';
    }
    const { error } = await supabaseClient.from('survey_invites').update(upd).eq('id', inv.id);
    if(error) { showToast(error.message, 'error'); return; }
    closeModal('svAttemptModal');
    await loadSurveyData();
    renderSurveysView();
}

// ── Formulario de la encuesta ─────────────────────────────────────────────────
function svOpenSurvey(inviteId) {
    const inv = _svInviteById(inviteId);
    if(!inv) return;
    const r = _svResponseOf(inviteId) || {};
    _svForm = {
        inviteId,
        vals: {},
        closing: r.q_closing_meeting != null ? String(r.q_closing_meeting) : '',
        closingNote: r.closing_meeting_note || '',
        emotion: r.emotion || ''
    };
    _SV_DIMS.forEach(d => { _svForm.vals[d.k] = r[d.k] != null ? Number(r[d.k]) : null; });
    document.getElementById('svSurvey_title').textContent = `Encuesta — ${inv.company_name}`;
    document.getElementById('svSurvey_sub').innerHTML = `${_escHtml(inv.contact_name || 'Sin contacto')}${inv.contact_role ? ' · ' + _escHtml(inv.contact_role) : ''}${inv.contact_phone ? ` · <a href="tel:${_escHtml(inv.contact_phone.replace(/[^\d+]/g, ''))}" style="color:var(--clr-blue);">📞 ${_escHtml(inv.contact_phone)}</a>` : ''}`;
    document.getElementById('svSurvey_comments').value = r.comments || '';
    _svRenderSurveyForm();
    document.getElementById('svSurveyModal').classList.add('active');
}

const _SV_QUESTIONS = {
    q_punctual:     '¿La gestión fue realizada puntualmente?',
    q_verbal:       '¿Cómo califica el reporte verbal entregado por el analista al finalizar la gestión?',
    q_reports_time: '¿Recibió sus informes a tiempo?',
    q_clarity:      '¿Somos claros con la información suministrada en el reporte?',
    q_accuracy:     '¿Considera que los diagnósticos fueron acertados?',
    q_recommend:    '¿Recomendaría los servicios de A-MAQ S.A.?',
    q_ally:         '¿Considera a A-MAQ un aliado en la confiabilidad de su planta?'
};

function _svRatingButtons(field, current, onclickFn) {
    const btn = (v) => {
        const on = current === v;
        return `<button onclick="${onclickFn}('${field}', ${v})" style="min-width:40px;padding:4px 0;border-radius:8px;border:1.5px solid ${on ? '#1d4ed8' : '#cbd5e1'};background:${on ? '#dbeafe' : '#fff'};color:${on ? '#1d4ed8' : '#64748b'};font-weight:800;font-size:0.85rem;cursor:pointer;">${v}</button>`;
    };
    const half = current !== null && current !== undefined && !Number.isInteger(current);
    return `<div style="display:flex;gap:0.3rem;align-items:center;flex-wrap:wrap;">${[1, 2, 3, 4, 5].map(btn).join('')}
        <button onclick="svToggleHalf('${field}')" title="Medio punto menos (ej. 4,5)" style="padding:4px 8px;border-radius:8px;border:1.5px solid ${half ? '#b45309' : '#e2e8f0'};background:${half ? '#fef3c7' : '#fff'};color:${half ? '#b45309' : '#94a3b8'};font-size:0.72rem;cursor:pointer;">−½</button>
        ${current !== null && current !== undefined ? `<span style="font-size:0.78rem;color:#64748b;margin-left:4px;">${_svFmt(current, 1)}</span>` : ''}</div>`;
}

function svSetRating(field, v) {
    _svForm.vals[field] = _svForm.vals[field] === v ? null : v;
    _svRenderSurveyForm();
}

function svToggleHalf(field) {
    const cur = _svForm.vals[field];
    if(cur === null || cur === undefined) return;
    _svForm.vals[field] = Number.isInteger(cur) ? Math.max(1, cur - 0.5) : Math.ceil(cur);
    _svRenderSurveyForm();
}

function svSetClosingScore(field, v) {
    _svForm.closing = _svForm.closing === String(v) ? '' : String(v);
    _svForm.closingNote = '';
    _svRenderSurveyForm();
}

function svSetClosingNote(text) {
    _svForm.closing = '';
    _svForm.closingNote = _svForm.closingNote === text ? '' : text;
    _svRenderSurveyForm();
}

function svSetEmotion(v) {
    _svForm.emotion = _svForm.emotion === v ? '' : v;
    _svRenderSurveyForm();
}

function _svRenderSurveyForm() {
    const f = _svForm;
    const block = (title, inner) => `<div style="padding:0.55rem 0;border-bottom:1px solid #f1f5f9;"><div style="font-size:0.82rem;font-weight:600;margin-bottom:0.35rem;">${title}</div>${inner}</div>`;
    const dimBlock = (k) => block(_SV_QUESTIONS[k], _svRatingButtons(k, f.vals[k], 'svSetRating'));
    const closingNotes = ['No la conoce', 'No la ha tenido', 'No asistió'];
    const emo = (v, label, color, bg) => `<button onclick="svSetEmotion('${v}')" style="padding:4px 12px;border-radius:99px;border:1.5px solid ${f.emotion === v ? color : '#cbd5e1'};background:${f.emotion === v ? bg : '#fff'};color:${f.emotion === v ? color : '#64748b'};font-weight:700;font-size:0.8rem;cursor:pointer;">${label}</button>`;
    document.getElementById('svSurvey_body').innerHTML =
        dimBlock('q_punctual') + dimBlock('q_verbal') + dimBlock('q_reports_time') + dimBlock('q_clarity') + dimBlock('q_accuracy') +
        block('¿Cómo califica la reunión de cierre de gestión a la luz de la plataforma ALERTVOX? <span style="font-weight:400;color:#94a3b8;">(no entra en el promedio)</span>',
            `<div style="display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center;">
                ${[1, 2, 3, 4, 5].map(v => `<button onclick="svSetClosingScore('closing', ${v})" style="min-width:40px;padding:4px 0;border-radius:8px;border:1.5px solid ${f.closing === String(v) ? '#1d4ed8' : '#cbd5e1'};background:${f.closing === String(v) ? '#dbeafe' : '#fff'};color:${f.closing === String(v) ? '#1d4ed8' : '#64748b'};font-weight:800;font-size:0.85rem;cursor:pointer;">${v}</button>`).join('')}
                ${closingNotes.map(n => `<button onclick="svSetClosingNote('${n}')" style="padding:4px 10px;border-radius:99px;border:1.5px solid ${f.closingNote === n ? '#475569' : '#e2e8f0'};background:${f.closingNote === n ? '#e2e8f0' : '#fff'};color:#475569;font-size:0.74rem;cursor:pointer;">${n}</button>`).join('')}
            </div>`) +
        block('¿A-MAQ S.A. como empresa le genera emociones positivas o negativas?',
            `<div style="display:flex;gap:0.4rem;">${emo('positivas', 'Positivas', '#15803d', '#dcfce7')}${emo('neutras', 'Neutras', '#475569', '#e2e8f0')}${emo('negativas', 'Negativas', '#b91c1c', '#fee2e2')}</div>`) +
        dimBlock('q_recommend') + dimBlock('q_ally');
}

async function svSaveSurvey() {
    const f = _svForm;
    if(!f) return;
    const inv = _svInviteById(f.inviteId);
    if(!inv) return;
    const answered = _SV_DIMS.some(d => f.vals[d.k] !== null && f.vals[d.k] !== undefined);
    if(!answered) { showToast('Califica al menos una pregunta', 'error'); return; }
    const payload = {
        invite_id: inv.id,
        answered_at: new Date().toISOString(),
        answered_by: currentUserProfile?.display_name || currentUserProfile?.analyst_name || currentUser?.email || null,
        q_closing_meeting: f.closing ? Number(f.closing) : null,
        closing_meeting_note: f.closingNote || null,
        emotion: f.emotion || null,
        comments: document.getElementById('svSurvey_comments').value.trim() || null
    };
    _SV_DIMS.forEach(d => { payload[d.k] = f.vals[d.k] ?? null; });
    const { error } = await supabaseClient.from('survey_responses').upsert(payload, { onConflict: 'invite_id' });
    if(error) { showToast('No se pudo guardar: ' + error.message, 'error'); return; }
    await supabaseClient.from('survey_invites').update({ status: 'respondida' }).eq('id', inv.id);
    closeModal('svSurveyModal');
    showToast('Encuesta guardada ✓', 'success');
    await loadSurveyData();
    renderSurveysView();
}

// ── Contactos ─────────────────────────────────────────────────────────────────
function _svPlannerCompanies() {
    const map = new Map();
    (dbClients || []).forEach(c => {
        const base = cleanClientName(getClientDisplayName(c)).split(' - ')[0].trim();
        const key = _svKey(base);
        if(key && !map.has(key)) map.set(key, base);
    });
    return map;   // key → nombre
}

function _svContactsFor(companyKey) {
    return dbClientContacts.filter(c => _svSameCompany(c.company_key, companyKey))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function _svContactsTable() {
    const planner = _svPlannerCompanies();
    const all = new Map();
    planner.forEach((name, key) => all.set(key, { key, name, contacts: [] }));
    dbClientContacts.forEach(c => {
        const hit = [...all.keys()].find(k => _svSameCompany(k, c.company_key));
        const key = hit || c.company_key;
        if(!all.has(key)) all.set(key, { key, name: c.company_name, contacts: [] });
        all.get(key).contacts.push(c);
    });
    const q = _svKey(_svContactSearch);
    const list = [...all.values()].filter(x => !q || _svKey(x.name).includes(q) || x.contacts.some(c => _svKey(c.name).includes(q)))
        .sort((a, b) => (b.contacts.length ? 1 : 0) - (a.contacts.length ? 1 : 0) || a.name.localeCompare(b.name, 'es'));
    return `
        <div class="stats-card" style="padding:0;overflow-x:auto;"><table class="data-table" style="font-size:0.82rem;">
            <thead><tr><th>Empresa</th><th>Contacto</th><th>Cargo</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
            <tbody>${list.map(x => x.contacts.length ? x.contacts.map((c, i) => `<tr>
                ${i === 0 ? `<td rowspan="${x.contacts.length}" style="vertical-align:top;"><strong>${_escHtml(x.name)}</strong></td>` : ''}
                <td>${_escHtml(c.name)}</td><td style="color:#64748b;">${_escHtml(c.role || '')}</td>
                <td style="white-space:nowrap;">${_escHtml(c.phone || '')}</td><td style="font-size:0.76rem;">${_escHtml(c.email || '')}</td>
                <td style="text-align:right;white-space:nowrap;">
                    <button class="btn-secondary" onclick="svOpenContactModal({ mode: 'contact', id: '${c.id}' })" style="font-size:0.74rem;padding:2px 8px;">✏️</button>
                    ${currentUserProfile?.role === 'admin' ? `<button class="btn-secondary" onclick="svDeleteContact('${c.id}')" style="font-size:0.74rem;padding:2px 8px;color:#dc2626;">🗑</button>` : ''}</td></tr>`).join('')
                : `<tr><td><strong>${_escHtml(x.name)}</strong></td><td colspan="4" style="color:#dc2626;font-size:0.78rem;">Sin contacto</td>
                    <td style="text-align:right;"><button class="btn-outline" onclick="svOpenContactModal({ mode: 'contact', company: '${_escHtml(x.name).replace(/'/g, "\\'")}' })" style="font-size:0.74rem;padding:2px 10px;">+ Agregar</button></td></tr>`).join('')}
            </tbody></table></div>`;
}

// ── Contactos de la empresa dentro de la ficha de clientes del planner ─────────
let _ccClientId = null;

/** Empresa (parte antes del guion) de un cliente del planner: { key, name }. */
function _svClientCompany(c) {
    const name = cleanClientName(getClientDisplayName(c)).split(' - ')[0].trim();
    return { key: _svKey(name), name };
}

function openClientContacts(clientId) {
    const c = dbClients.find(x => x.id === clientId);
    if(!c) return;
    _ccClientId = clientId;
    renderClientContactsModal();
    document.getElementById('clientContactsModal').classList.add('active');
}

function renderClientContactsModal() {
    const c = dbClients.find(x => x.id === _ccClientId);
    if(!c) return;
    const cc = _svClientCompany(c);
    const list = _svContactsFor(cc.key);
    document.getElementById('cc_title').textContent = `Contactos — ${cc.name}`;
    document.getElementById('cc_add').setAttribute('onclick', `svOpenContactModal({ mode: 'contact', company: '${cc.name.replace(/'/g, "\\'")}' })`);
    const isAdmin = currentUserProfile?.role === 'admin';
    document.getElementById('cc_body').innerHTML = list.length ? `
        <table class="data-table" style="font-size:0.82rem;">
            <thead><tr><th>Contacto</th><th>Cargo</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
            <tbody>${list.map(x => `<tr>
                <td><strong>${_escHtml(x.name)}</strong></td><td style="color:#64748b;">${_escHtml(x.role || '')}</td>
                <td style="white-space:nowrap;">${_escHtml(x.phone || '')}</td><td style="font-size:0.76rem;">${_escHtml(x.email || '')}</td>
                <td style="text-align:right;white-space:nowrap;">
                    <button class="btn-secondary" onclick="svOpenContactModal({ mode: 'contact', id: '${x.id}' })" style="font-size:0.74rem;padding:2px 8px;">✏️</button>
                    ${isAdmin ? `<button class="btn-secondary" onclick="svDeleteContact('${x.id}')" style="font-size:0.74rem;padding:2px 8px;color:#dc2626;">🗑</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<div style="text-align:center;padding:1.5rem;color:#94a3b8;font-size:0.85rem;">Esta empresa aún no tiene contactos.${c.contact_name ? `<br>En su ficha figura: <strong>${_escHtml(c.contact_name)}</strong>.` : ''}</div>`;
}

function _refreshClientContactsViews() {
    if(document.getElementById('clientContactsModal')?.classList.contains('active')) renderClientContactsModal();
    if(document.getElementById('view-admin')?.classList.contains('active-view')) renderAdminView();
}

/** Trae a la libreta los contactos que ya figuran en la ficha de cada cliente del planner (sin duplicar). */
async function svImportPlannerContacts() {
    const toAdd = [];
    const seen = new Set(dbClientContacts.map(c => `${c.company_key}|${_svKey(c.name)}`));
    const counters = new Map();
    dbClients.forEach(c => {
        const name = String(c.contact_name || '').trim();
        if(name.length < 3) return;
        const cc = _svClientCompany(c);
        const k = `${cc.key}|${_svKey(name)}`;
        if(seen.has(k)) return;
        seen.add(k);
        const n = counters.get(cc.key) ?? _svContactsFor(cc.key).length;
        counters.set(cc.key, n + 1);
        toAdd.push({ company_key: cc.key, company_name: cc.name, name, sort_order: n });
    });
    if(!toAdd.length) { showToast('No hay contactos nuevos en las fichas del planner', 'success'); return; }
    if(!confirm(`Se agregarán ${toAdd.length} contactos que figuran en las fichas de clientes del planner:\n\n${toAdd.slice(0, 12).map(x => `• ${x.name} (${x.company_name})`).join('\n')}${toAdd.length > 12 ? `\n… y ${toAdd.length - 12} más` : ''}\n\n¿Continuar?`)) return;
    const { error } = await supabaseClient.from('client_contacts').insert(toAdd);
    if(error) { showToast(error.message, 'error'); return; }
    await loadSurveyData();
    renderSurveysView();
    showToast(`${toAdd.length} contactos agregados ✓`, 'success');
}

function _svContactsTab() {
    return `
        <div style="display:flex;justify-content:space-between;gap:0.75rem;margin-bottom:0.8rem;flex-wrap:wrap;">
            <input type="text" value="${_escHtml(_svContactSearch)}" placeholder="Buscar empresa o contacto…" oninput="svSetContactSearch(this.value)" style="padding:0.45rem 0.7rem;border:1px solid #cbd5e1;border-radius:8px;font-size:0.84rem;min-width:260px;">
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                <button class="btn-outline" onclick="svImportPlannerContacts()" title="Agrega a la libreta los contactos que ya figuran en la ficha de cada cliente del planner">⬇ Traer contactos del planner</button>
                <button class="btn-primary" onclick="svOpenContactModal({ mode: 'contact' })">+ Nuevo contacto</button>
            </div>
        </div>
        <div id="sv_contacts_table">${_svContactsTable()}</div>`;
}

function svSetContactSearch(v) {
    _svContactSearch = v;
    const el = document.getElementById('sv_contacts_table');
    if(el) el.innerHTML = _svContactsTable();
}

/** ctx: { mode: 'contact' | 'invite' | 'newInvite', id?, company? } */
function svOpenContactModal(ctx) {
    _svContactCtx = ctx;
    let v = { company: ctx.company || '', name: '', role: '', phone: '', email: '' };
    let title = 'Nuevo contacto';
    if(ctx.mode === 'contact' && ctx.id) {
        const c = dbClientContacts.find(x => x.id === ctx.id);
        if(c) { v = { company: c.company_name, name: c.name, role: c.role || '', phone: c.phone || '', email: c.email || '' }; title = 'Editar contacto'; }
    } else if(ctx.mode === 'invite') {
        const i = _svInviteById(ctx.id);
        if(i) { v = { company: i.company_name, name: i.contact_name || '', role: i.contact_role || '', phone: i.contact_phone || '', email: i.contact_email || '' }; title = 'Editar contacto de la ronda'; }
    } else if(ctx.mode === 'newInvite') {
        title = 'Agregar cliente a la ronda';
    }
    document.getElementById('svContact_title').textContent = title;
    document.getElementById('svContact_company').value = v.company;
    document.getElementById('svContact_company').disabled = ctx.mode === 'invite';
    document.getElementById('svContact_name').value = v.name;
    document.getElementById('svContact_role').value = v.role;
    document.getElementById('svContact_phone').value = v.phone;
    document.getElementById('svContact_email').value = v.email;
    const names = new Set([..._svPlannerCompanies().values(), ...dbClientContacts.map(c => c.company_name)]);
    document.getElementById('svContact_companies').innerHTML = [...names].sort().map(n => `<option value="${_escHtml(n)}">`).join('');
    document.getElementById('svContact_saveContact').style.display = ctx.mode === 'contact' ? 'none' : '';
    document.getElementById('svContactModal').classList.add('active');
}

function svContactCompanyChanged() {
    if(_svContactCtx?.mode !== 'newInvite') return;
    const key = _svKey(document.getElementById('svContact_company').value);
    const c = _svContactsFor(key)[0];
    if(c) {
        document.getElementById('svContact_name').value = c.name;
        document.getElementById('svContact_role').value = c.role || '';
        document.getElementById('svContact_phone').value = c.phone || '';
        document.getElementById('svContact_email').value = c.email || '';
    }
}

async function svSaveContact() {
    const ctx = _svContactCtx;
    if(!ctx) return;
    const company = document.getElementById('svContact_company').value.trim();
    const v = {
        name: document.getElementById('svContact_name').value.trim(),
        role: document.getElementById('svContact_role').value.trim() || null,
        phone: document.getElementById('svContact_phone').value.trim() || null,
        email: document.getElementById('svContact_email').value.trim() || null
    };
    if(!company) { showToast('Escribe la empresa', 'error'); return; }
    if(ctx.mode !== 'newInvite' && !v.name) { showToast('Escribe el nombre del contacto', 'error'); return; }
    let error;
    if(ctx.mode === 'contact') {
        const row = { company_key: _svKey(company), company_name: company, ...v };
        if(ctx.id) ({ error } = await supabaseClient.from('client_contacts').update(row).eq('id', ctx.id));
        else {
            row.sort_order = _svContactsFor(row.company_key).length;
            ({ error } = await supabaseClient.from('client_contacts').insert(row));
        }
    } else if(ctx.mode === 'invite') {
        ({ error } = await supabaseClient.from('survey_invites').update({ contact_name: v.name, contact_role: v.role, contact_phone: v.phone, contact_email: v.email }).eq('id', ctx.id));
    } else {
        ({ error } = await supabaseClient.from('survey_invites').insert({
            round_id: _svOpenRound, company_name: company, company_key: _svKey(company),
            contact_name: v.name || null, contact_role: v.role, contact_phone: v.phone, contact_email: v.email
        }));
    }
    if(error) { showToast('No se pudo guardar: ' + error.message, 'error'); return; }
    closeModal('svContactModal');
    await loadSurveyData();
    renderSurveysView();
    _refreshClientContactsViews();
}

/** Guarda en la ficha de contactos el contacto escrito en una invitación (para reutilizarlo en rondas futuras). */
async function svSaveInviteContactToBook() {
    const company = document.getElementById('svContact_company').value.trim();
    const name = document.getElementById('svContact_name').value.trim();
    if(!company || !name) { showToast('Escribe empresa y contacto', 'error'); return; }
    const key = _svKey(company);
    const exists = _svContactsFor(key).some(c => _svKey(c.name) === _svKey(name));
    if(exists) { showToast('Ese contacto ya está en la ficha', 'success'); return; }
    const { error } = await supabaseClient.from('client_contacts').insert({
        company_key: key, company_name: company, name,
        role: document.getElementById('svContact_role').value.trim() || null,
        phone: document.getElementById('svContact_phone').value.trim() || null,
        email: document.getElementById('svContact_email').value.trim() || null,
        sort_order: _svContactsFor(key).length
    });
    if(error) { showToast(error.message, 'error'); return; }
    await loadSurveyData();
    showToast('Contacto guardado en la ficha ✓', 'success');
}

function svEditInviteContact(inviteId) { svOpenContactModal({ mode: 'invite', id: inviteId }); }
function svAddInvite() { svOpenContactModal({ mode: 'newInvite' }); }

async function svDeleteContact(id) {
    const c = dbClientContacts.find(x => x.id === id);
    if(!c || !confirm(`¿Eliminar a ${c.name} (${c.company_name})?`)) return;
    const { error } = await supabaseClient.from('client_contacts').delete().eq('id', id);
    if(error) { showToast(error.message, 'error'); return; }
    await loadSurveyData();
    renderSurveysView();
    _refreshClientContactsViews();
}

// ── Asistente: nueva ronda con sugerencia de clientes ─────────────────────────
function _svPrevQuarter() {
    const now = new Date();
    let y = now.getFullYear();
    let q = Math.floor(now.getMonth() / 3) - 1;
    if(q < 0) { q = 3; y -= 1; }
    const start = new Date(y, q * 3, 1), end = new Date(y, q * 3 + 3, 0);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: iso(start), end: iso(end), label: `Encuesta Q${q + 1} ${y}` };
}

function _svLastSurveyDate(companyKey) {
    let best = null;
    dbSurveyResponses.forEach(r => {
        const inv = _svInviteById(r.invite_id);
        if(!inv || !_svSameCompany(inv.company_key, companyKey)) return;
        const d = r.answered_at ? new Date(r.answered_at) : null;
        if(d && (!best || d > best)) best = d;
    });
    return best;
}

function _svMonthsAgo(d) {
    const now = new Date();
    return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) - (now.getDate() < d.getDate() ? 1 : 0);
}

function _svBuildCandidates(start, end) {
    const m0 = start.slice(0, 7), m1 = end.slice(0, 7);
    const groups = new Map();
    tasks.forEach(t => {
        if(t.isAbsence || !['ejecutada', 'facturada'].includes(t.status)) return;
        if(t.serviceType === 'Metro Administrativo' || t.serviceType === 'Metro Terceros') return;
        const field = (t.scheduledDays || []).filter(d => d.type === 'field' && d.date);
        let months = [];
        if(field.length) {
            const inWin = field.filter(d => d.date >= start && d.date <= end);
            if(!inWin.length) return;
            months = inWin.map(d => parseInt(d.date.slice(5, 7), 10));
        } else {
            const p = String(t.period || '');
            if(!p || p < m0 || p > m1) return;
            months = [parseInt(p.slice(5, 7), 10)];
        }
        const name = cleanClientName(t.client).split(' - ')[0].trim();
        const key = _svKey(name);
        if(!key) return;
        if(!groups.has(key)) groups.set(key, { key, name, tasks: 0, services: new Set(), months: new Set(), analysts: new Set() });
        const g = groups.get(key);
        g.tasks++;
        if(t.serviceType) g.services.add(t.serviceType);
        months.forEach(m => g.months.add(m));
        _effAnalystsOf(t).forEach(a => g.analysts.add(a));
    });
    return [...groups.values()].map(g => {
        const last = _svLastSurveyDate(g.key);
        const ago = last ? _svMonthsAgo(last) : null;
        const contacts = _svContactsFor(g.key);
        return { ...g, last, ago, recent: ago !== null && ago < 6, contacts, checked: !(ago !== null && ago < 6) };
    }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function svOpenNewRound() {
    const pq = _svPrevQuarter();
    _svWizard = { name: pq.label, start: pq.start, end: pq.end, candidates: [], allContacts: false, extras: [] };
    _svWizard.candidates = _svBuildCandidates(pq.start, pq.end);
    document.getElementById('svRound_name').value = _svWizard.name;
    document.getElementById('svRound_start').value = _svWizard.start;
    document.getElementById('svRound_end').value = _svWizard.end;
    document.getElementById('svRound_allContacts').checked = false;
    _svRenderWizard();
    document.getElementById('svRoundModal').classList.add('active');
}

function svWizardWindowChanged() {
    if(!_svWizard) return;
    _svWizard.start = document.getElementById('svRound_start').value;
    _svWizard.end = document.getElementById('svRound_end').value;
    const prev = new Map(_svWizard.candidates.map(c => [c.key, c.checked]));
    _svWizard.candidates = _svBuildCandidates(_svWizard.start, _svWizard.end);
    _svWizard.candidates.forEach(c => { if(prev.has(c.key)) c.checked = prev.get(c.key); });
    _svRenderWizard();
}

function svWizardToggle(key) {
    const c = _svWizard.candidates.find(x => x.key === key);
    if(c) c.checked = !c.checked;
    _svRenderWizard();
}

function svWizardAddCompany() {
    const input = document.getElementById('svRound_extra');
    const name = input.value.trim();
    if(!name) return;
    const key = _svKey(name);
    if(_svWizard.candidates.some(c => c.key === key)) { showToast('Esa empresa ya está en la lista', 'error'); return; }
    const last = _svLastSurveyDate(key);
    const ago = last ? _svMonthsAgo(last) : null;
    const contacts = _svContactsFor(key);
    _svWizard.candidates.push({ key, name, tasks: 0, services: new Set(), months: new Set(), analysts: new Set(), last, ago, recent: ago !== null && ago < 6, contacts, checked: true, manual: true });
    input.value = '';
    _svRenderWizard();
}

function _svRenderWizard() {
    const w = _svWizard;
    const checked = w.candidates.filter(c => c.checked).length;
    document.getElementById('svRound_count').textContent = `${checked} de ${w.candidates.length} seleccionados`;
    const names = new Set([..._svPlannerCompanies().values()]);
    document.getElementById('svRound_companies').innerHTML = [...names].sort().map(n => `<option value="${_escHtml(n)}">`).join('');
    document.getElementById('svRound_list').innerHTML = w.candidates.length ? `
        <table class="data-table" style="font-size:0.8rem;">
            <thead><tr><th style="width:32px;"></th><th>Empresa</th><th>Servicios del período</th><th>Analistas</th><th>Última encuesta</th><th>Contacto</th></tr></thead>
            <tbody>${w.candidates.map(c => `<tr style="${c.checked ? '' : 'opacity:.6;'}">
                <td><input type="checkbox" ${c.checked ? 'checked' : ''} onchange="svWizardToggle('${c.key}')"></td>
                <td><strong>${_escHtml(c.name)}</strong>${c.manual ? ' <span style="font-size:0.68rem;color:#94a3b8;">(manual)</span>' : ''}</td>
                <td style="font-size:0.74rem;">${[...c.services].map(s => `<span style="background:#eff6ff;color:#1d4ed8;border-radius:99px;padding:1px 7px;margin-right:3px;">${_escHtml(s)}</span>`).join('')}${c.months.size ? `<div style="color:#94a3b8;margin-top:2px;">${[...c.months].sort((a, b) => a - b).map(m => _SV_MONTHS[m - 1]).join(', ')} · ${c.tasks} gestión${c.tasks !== 1 ? 'es' : ''}</div>` : ''}</td>
                <td style="font-size:0.74rem;color:#64748b;">${_escHtml([...c.analysts].join(', '))}</td>
                <td style="font-size:0.76rem;">${c.last ? (c.recent
                    ? `<span style="color:#b45309;font-weight:700;" title="Se encuestó hace menos de 6 meses">⚠ hace ${c.ago} mes${c.ago !== 1 ? 'es' : ''}</span>`
                    : `<span style="color:#64748b;">hace ${c.ago} meses</span>`) : '<span style="color:#94a3b8;">Nunca</span>'}</td>
                <td style="font-size:0.76rem;">${c.contacts.length ? `${_escHtml(c.contacts[0].name)}${c.contacts.length > 1 ? ` <span style="color:#94a3b8;">+${c.contacts.length - 1}</span>` : ''}` : '<span style="color:#dc2626;">Sin contacto</span>'}</td>
            </tr>`).join('')}</tbody></table>` : '<div style="text-align:center;padding:2rem;color:#94a3b8;">No hay gestiones ejecutadas en esa ventana. Agrega clientes a mano abajo.</div>';
}

async function svCreateRound() {
    const w = _svWizard;
    if(!w) return;
    const name = document.getElementById('svRound_name').value.trim();
    const chosen = w.candidates.filter(c => c.checked);
    if(!name) { showToast('Escribe el nombre de la ronda', 'error'); return; }
    if(!chosen.length) { showToast('Selecciona al menos un cliente', 'error'); return; }
    const recent = chosen.filter(c => c.recent);
    if(recent.length && !confirm(`${recent.length} cliente(s) ya se encuestaron hace menos de 6 meses:\n\n${recent.map(c => '• ' + c.name).join('\n')}\n\n¿Los incluyes de todas formas?`)) return;
    const allContacts = document.getElementById('svRound_allContacts').checked;
    const today = new Date().toISOString().slice(0, 10);
    const { data: round, error } = await supabaseClient.from('survey_rounds').insert({
        name, window_start: w.start || null, window_end: w.end || null, survey_date: today,
        status: 'abierta', source: 'app', created_by: currentUserProfile?.display_name || currentUser?.email || null
    }).select().single();
    if(error || !round) { showToast('No se pudo crear la ronda: ' + (error?.message || ''), 'error'); return; }

    const rows = [];
    chosen.forEach(c => {
        const base = {
            round_id: round.id, company_name: c.name, company_key: c.key,
            service_months: [...c.months].sort((a, b) => a - b).map(m => _SV_MONTHS[m - 1]).join(', ') || null,
            analysts: [...c.analysts].join(', ') || null
        };
        const people = c.contacts.length ? (allContacts ? c.contacts : [c.contacts[0]]) : [null];
        people.forEach(p => rows.push({
            ...base,
            contact_name: p?.name || null, contact_role: p?.role || null, contact_phone: p?.phone || null, contact_email: p?.email || null
        }));
    });
    const { error: e2 } = await supabaseClient.from('survey_invites').insert(rows);
    if(e2) { showToast('Ronda creada, pero fallaron las invitaciones: ' + e2.message, 'error'); }
    closeModal('svRoundModal');
    await loadSurveyData();
    _svTab = 'rounds';
    _svOpenRound = round.id;
    renderSurveysView();
    showToast(`Ronda creada con ${rows.length} contactos ✓`, 'success');
}

// ── Dashboard de resultados (con filtros por compañía, analista y fechas) ──────
let _svFilters = { company: '', analyst: '', from: '', to: '' };
let _svTrendMetric = 'overall';

function svSetScope(v) { _svDashScope = v; renderSurveysView(); }
function svSetFilter(k, v) { _svFilters[k] = v; renderSurveysView(); }
function svClearFilters() {
    _svFilters = { company: '', analyst: '', from: '', to: '' };
    _svDashScope = 'all';
    _svOnlyAlerts = false;
    renderSurveysView();
}
function svToggleAlerts() { _svOnlyAlerts = !_svOnlyAlerts; renderSurveysView(); }
function svSetTrendMetric(v) { _svTrendMetric = v; _svDrawChart(); }

function _svAnalystList(text) {
    return String(text || '').split(/\s*(?:,|\/|&|\+|\by\b)\s*/i).map(s => s.trim()).filter(s => s.length > 1);
}

function _svCompanyOptions() {
    const map = new Map();
    dbSurveyInvites.forEach(inv => {
        if(!_svResponseOf(inv.id)) return;
        const hit = [...map.keys()].find(k => _svSameCompany(k, inv.company_key));
        if(!hit) map.set(inv.company_key, inv.company_name);
    });
    return [...map.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function _svAnalystOptions() {
    const map = new Map();
    dbSurveyInvites.forEach(inv => {
        if(!_svResponseOf(inv.id)) return;
        _svAnalystList(inv.analysts).forEach(a => { const k = _svKey(a); if(k && !map.has(k)) map.set(k, a); });
    });
    return [...map.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function _svInviteMatches(inv) {
    const f = _svFilters;
    if(f.company && !_svSameCompany(inv.company_key, f.company)) return false;
    if(f.analyst && !_svAnalystList(inv.analysts).some(a => _svKey(a) === f.analyst)) return false;
    return true;
}

function _svScopeRounds() {
    const rounds = dbSurveyRounds.slice().sort((a, b) => _svRoundDate(a).localeCompare(_svRoundDate(b)));
    const s = _svDashScope;
    if(s === 'last12') {
        const d = new Date(); d.setMonth(d.getMonth() - 12);
        return rounds.filter(r => _svRoundDate(r) >= d.toISOString().slice(0, 10));
    }
    if(s.startsWith('year:')) return rounds.filter(r => _svRoundDate(r).startsWith(s.slice(5)));
    if(s.startsWith('round:')) return rounds.filter(r => r.id === s.slice(6));
    if(s === 'custom') {
        return rounds.filter(r => {
            const d = _svRoundDate(r);
            return (!_svFilters.from || d >= _svFilters.from) && (!_svFilters.to || d <= _svFilters.to);
        });
    }
    return rounds;
}

/** Respuestas de las rondas dadas, con su invitación y ronda. */
function _svScopeResponses(rounds) {
    const ids = new Set(rounds.map(r => r.id));
    const out = [];
    dbSurveyInvites.forEach(inv => {
        if(!ids.has(inv.round_id)) return;
        const resp = _svResponseOf(inv.id);
        if(resp) out.push({ resp, inv, round: _svRoundById(inv.round_id) });
    });
    return out;
}

/** Respuestas del alcance elegido y de los filtros de compañía / analista. */
function _svFilteredRows() {
    return _svScopeResponses(_svScopeRounds()).filter(x => _svInviteMatches(x.inv));
}

/** Respuestas agrupadas por ronda, en orden cronológico. */
function _svRoundsOf(rows) {
    const byRound = new Map();
    rows.forEach(x => {
        if(!byRound.has(x.round.id)) byRound.set(x.round.id, { round: x.round, resp: [] });
        byRound.get(x.round.id).resp.push(x.resp);
    });
    return [...byRound.values()].sort((a, b) => _svRoundDate(a.round).localeCompare(_svRoundDate(b.round)));
}

function _svFilterBar() {
    const years = [...new Set(dbSurveyRounds.map(r => _svRoundDate(r).slice(0, 4)))].sort().reverse();
    const allSorted = dbSurveyRounds.slice().sort((a, b) => _svRoundDate(b).localeCompare(_svRoundDate(a)));
    const f = _svFilters;
    const active = f.company || f.analyst || _svDashScope !== 'all' || _svOnlyAlerts;
    const sel = (extra = '') => `class="filter-select" style="min-width:170px;margin-top:4px;${extra}"`;
    return `
        <div class="filter-toolbar" style="align-items:flex-end;flex-wrap:wrap;">
            <div><label class="filter-label">Compañía</label><br>
                <select ${sel('min-width:210px;')} onchange="svSetFilter('company', this.value)">
                    <option value="">Todas las compañías</option>
                    ${_svCompanyOptions().map(c => `<option value="${_escHtml(c.key)}" ${f.company === c.key ? 'selected' : ''}>${_escHtml(c.name)}</option>`).join('')}
                </select></div>
            <div><label class="filter-label">Analista</label><br>
                <select ${sel()} onchange="svSetFilter('analyst', this.value)">
                    <option value="">Todos los analistas</option>
                    ${_svAnalystOptions().map(a => `<option value="${_escHtml(a.key)}" ${f.analyst === a.key ? 'selected' : ''}>${_escHtml(a.name)}</option>`).join('')}
                </select></div>
            <div><label class="filter-label">Período</label><br>
                <select ${sel()} onchange="svSetScope(this.value)">
                    <option value="all" ${_svDashScope === 'all' ? 'selected' : ''}>Todas las rondas</option>
                    <option value="last12" ${_svDashScope === 'last12' ? 'selected' : ''}>Últimos 12 meses</option>
                    ${years.map(y => `<option value="year:${y}" ${_svDashScope === 'year:' + y ? 'selected' : ''}>Año ${y}</option>`).join('')}
                    <option value="custom" ${_svDashScope === 'custom' ? 'selected' : ''}>Rango de fechas…</option>
                    <optgroup label="Una ronda">
                        ${allSorted.map(r => `<option value="round:${r.id}" ${_svDashScope === 'round:' + r.id ? 'selected' : ''}>${_escHtml(r.name)}</option>`).join('')}
                    </optgroup>
                </select></div>
            ${_svDashScope === 'custom' ? `
            <div><label class="filter-label">Desde</label><br><input type="date" value="${_escHtml(f.from)}" onchange="svSetFilter('from', this.value)" class="filter-select" style="margin-top:4px;"></div>
            <div><label class="filter-label">Hasta</label><br><input type="date" value="${_escHtml(f.to)}" onchange="svSetFilter('to', this.value)" class="filter-select" style="margin-top:4px;"></div>` : ''}
            ${active ? '<button onclick="svClearFilters()" class="filter-clear-btn">✕ Limpiar</button>' : ''}
            <button class="btn-outline" onclick="svExportCSV()" style="font-size:0.8rem;margin-left:auto;">⬇ Exportar (CSV)</button>
        </div>`;
}

// ── Relojitos (mismo estilo que el CSAT por analista) ─────────────────────────
let _svGaugeCharts = {};
let _svDashGaugeItems = [];

function _svQuality(v) {
    if(v === null || v === undefined || isNaN(v)) return { label: 'Sin datos', bg: '#f1f5f9', color: '#64748b' };
    if(v >= 4.5) return { label: 'Excelente', bg: '#dcfce7', color: '#15803d' };
    if(v >= 4)   return { label: 'Muy bueno', bg: '#dbeafe', color: '#1d4ed8' };
    if(v >= 3.5) return { label: 'Aceptable', bg: '#fef3c7', color: '#a16207' };
    return { label: 'Bajo', bg: '#fee2e2', color: '#b91c1c' };
}

/** Un relojito por indicador: promedio general + las 7 dimensiones. */
function _svGaugeItems(avg, prevAvg) {
    const mk = (label, v, pv) => ({ label, value: v, delta: (v !== null && v !== undefined && pv !== null && pv !== undefined) ? v - pv : null });
    return [mk('Promedio general', avg.overall, prevAvg?.overall),
        ..._SV_DIMS.map(d => mk(d.label, avg.dims[d.k], prevAvg?.dims[d.k]))];
}

function _svGaugesHTML(items, prefix, title, subtitle) {
    const stars = (v, color) => {
        const filled = v !== null && v !== undefined ? Math.round(v) : 0;
        let out = '';
        for(let i = 1; i <= 5; i++) out += `<span style="color:${i <= filled ? color : '#e2e8f0'}; font-size:0.7rem; line-height:1;">★</span>`;
        return out;
    };
    return `
        <div class="stats-card" style="padding:1.25rem;">
            <h3 style="margin:0 0 0.25rem; font-size:1rem;">${title}</h3>
            <p style="font-size:0.75rem; color:var(--text-secondary); margin:0 0 1.25rem;">${subtitle}</p>
            <div class="gauges-grid">
                ${items.map((it, i) => {
                    const has = it.value !== null && it.value !== undefined;
                    const color = has ? _svScoreStyle(it.value).color : '#cbd5e1';
                    const q = _svQuality(it.value);
                    const d = it.delta;
                    const deltaHtml = d === null || d === undefined ? '&nbsp;'
                        : Math.abs(d) < 0.005 ? '<span style="color:#94a3b8;">= igual que antes</span>'
                        : `<span style="color:${d > 0 ? '#15803d' : '#b91c1c'};font-weight:700;">${d > 0 ? '▲' : '▼'} ${_svFmt(Math.abs(d))} vs. anterior</span>`;
                    return `
                    <div class="gauge-card" style="border-top:3px solid ${color}; background:#fff; border-radius:12px; padding:0.55rem 0.5rem 0.65rem; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
                        <div class="gauge-card-canvas-wrap"><canvas id="${prefix}-${i}"></canvas></div>
                        <div class="gauge-value" style="color:${color};">${has ? _svFmt(it.value, 1) : '—'}<span class="gauge-max">/5</span></div>
                        <div style="display:flex; justify-content:center; gap:1px; margin:2px 0 4px;">${stars(it.value, color)}</div>
                        <div class="gauge-name">${_escHtml(it.label)}</div>
                        <div class="gauge-sub">${deltaHtml}</div>
                        <div style="margin-top:6px; display:flex; justify-content:center;">
                            <span style="background:${q.bg}; color:${q.color}; font-size:0.62rem; font-weight:700; padding:2px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:0.03em;">${q.label}</span>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
}

function _svDrawGauges(items, prefix) {
    Object.keys(_svGaugeCharts).filter(k => k.startsWith(prefix + '-')).forEach(k => { try { _svGaugeCharts[k].destroy(); } catch(e) { /* ya destruido */ } delete _svGaugeCharts[k]; });
    if(typeof Chart === 'undefined') return;
    items.forEach((it, i) => {
        const id = `${prefix}-${i}`;
        const ctx = document.getElementById(id);
        if(!ctx) return;
        const has = it.value !== null && it.value !== undefined;
        const score = has ? it.value : 0;
        _svGaugeCharts[id] = new Chart(ctx, {
            type: 'doughnut',
            data: { datasets: [{ data: [score, Math.max(0, 5 - score)], backgroundColor: [has ? _svScoreStyle(it.value).color : '#cbd5e1', '#eef2f7'], borderWidth: 0, borderRadius: 6, spacing: 1 }] },
            options: {
                rotation: -90, circumference: 180, cutout: '68%', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0f172a', padding: 8, cornerRadius: 6, displayColors: false,
                    callbacks: { label: c => c.dataIndex === 0 ? `${it.label}: ${score.toFixed(2)} / 5` : '' } } }
            }
        });
    });
}

function _svDashboard() {
    const rounds = _svScopeRounds();
    const rows = _svFilteredRows();
    const bar = _svFilterBar();
    if(!rows.length) return `${bar}<div class="stats-card" style="text-align:center;padding:3rem;color:#94a3b8;margin-top:1rem;">No hay respuestas con estos filtros.</div>`;

    const avg = _svAverages(rows.map(x => x.resp));
    const roundIds = new Set(rounds.map(r => r.id));
    const invitesIn = dbSurveyInvites.filter(i => roundIds.has(i.round_id) && i.status !== 'omitida' && _svInviteMatches(i)).length;
    const rate = invitesIn ? Math.round(rows.length / invitesIn * 100) : 0;

    // cambio de la última ronda con datos frente a la anterior, dentro de los filtros
    const chrono = _svRoundsOf(rows);
    const lastAvg = chrono.length ? _svAverages(chrono[chrono.length - 1].resp) : avg;
    const prevAvg = chrono.length > 1 ? _svAverages(chrono[chrono.length - 2].resp) : null;
    const delta = (k) => {
        if(!prevAvg || lastAvg.dims[k] === null || prevAvg.dims[k] === null) return '';
        const d = lastAvg.dims[k] - prevAvg.dims[k];
        if(Math.abs(d) < 0.005) return '<span style="color:#94a3b8;font-size:0.72rem;"> =</span>';
        return `<span style="color:${d > 0 ? '#15803d' : '#b91c1c'};font-size:0.72rem;font-weight:700;"> ${d > 0 ? '▲' : '▼'} ${_svFmt(Math.abs(d))}</span>`;
    };

    // última respuesta por empresa
    const byCompany = new Map();
    rows.forEach(x => {
        const key = [...byCompany.keys()].find(k => _svSameCompany(k, x.inv.company_key)) || x.inv.company_key;
        const cur = byCompany.get(key);
        const date = x.resp.answered_at || '';
        if(!cur || date > (cur.resp.answered_at || '')) byCompany.set(key, x);
    });
    let clients = [...byCompany.values()].map(x => ({ ...x, score: _svResponseScore(x.resp), alert: _SV_DIMS.some(d => _svNum(x.resp[d.k]) !== null && _svNum(x.resp[d.k]) < 4) }));
    const alerts = clients.filter(c => c.alert).length;
    if(_svOnlyAlerts) clients = clients.filter(c => c.alert);
    clients.sort((a, b) => (a.score ?? 9) - (b.score ?? 9));

    // por analista (a partir de las invitaciones)
    const byAnalyst = new Map();
    rows.forEach(x => {
        _svAnalystList(x.inv.analysts).forEach(a => {
            const k = _svKey(a);
            if(!byAnalyst.has(k)) byAnalyst.set(k, { name: a, rs: [] });
            byAnalyst.get(k).rs.push(x.resp);
        });
    });
    const analystRows = [...byAnalyst.values()].map(a => ({ name: a.name, n: a.rs.length, avg: _svAverages(a.rs) })).sort((a, b) => (b.avg.overall ?? 0) - (a.avg.overall ?? 0));

    const comments = rows.filter(x => x.resp.comments).sort((a, b) => String(b.resp.answered_at).localeCompare(String(a.resp.answered_at))).slice(0, 25);

    // historial detallado cuando se filtra por una compañía
    const history = _svFilters.company ? rows.slice().sort((a, b) => _svRoundDate(a.round).localeCompare(_svRoundDate(b.round))) : [];
    const companyName = _svFilters.company ? (_svCompanyOptions().find(c => c.key === _svFilters.company)?.name || '') : '';

    _svDashGaugeItems = _svGaugeItems(avg, prevAvg ? lastAvg : null);
    // el relojito muestra el promedio del filtro; la flecha compara la última ronda contra la anterior
    if(prevAvg) {
        _svDashGaugeItems = _svGaugeItems(avg, null);
        const pk = _svGaugeItems(lastAvg, prevAvg);
        _svDashGaugeItems.forEach((it, i) => { it.delta = pk[i].delta; });
    }
    const kpi = (title, value, sub) => `<div class="stats-card" style="text-align:center;padding:1rem;"><div style="font-size:0.72rem;font-weight:700;color:#64748b;text-transform:uppercase;">${title}</div><div style="margin:0.35rem 0;">${value}</div><div style="font-size:0.72rem;color:#94a3b8;">${sub}</div></div>`;
    const metricOptions = [{ k: 'overall', label: 'Promedio general' }, ..._SV_DIMS.map(d => ({ k: d.k, label: d.label }))];

    return `
        ${bar}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0.75rem;margin:1rem 0;">
            ${kpi('Promedio general', _svBadge(avg.overall, true).replace('1rem', '1.5rem'), 'sobre 5')}
            ${kpi('Respuestas', `<span style="font-size:1.5rem;font-weight:800;">${rows.length}</span>`, `${chrono.length} ronda${chrono.length !== 1 ? 's' : ''}`)}
            ${kpi('Tasa de respuesta', `<span style="font-size:1.5rem;font-weight:800;">${rate}%</span>`, `${rows.length} de ${invitesIn} contactos`)}
            ${kpi('Compañías en alerta', `<span style="font-size:1.5rem;font-weight:800;color:${alerts ? '#b91c1c' : '#15803d'};">${alerts}</span>`, 'con alguna nota menor a 4')}
            ${kpi('Reunión de cierre', _svBadge(avg.closing, false), 'no entra en el promedio')}
        </div>
        <div style="margin-bottom:1rem;">${_svGaugesHTML(_svDashGaugeItems, 'svg', 'Indicadores de satisfacción', prevAvg ? 'Promedio del período filtrado. La flecha compara la última ronda con la anterior.' : 'Promedio del período filtrado.')}</div>
        <div class="stats-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.5rem;flex-wrap:wrap;">
                <h4 style="margin:0;">Tendencia por ronda</h4>
                <select class="filter-select" onchange="svSetTrendMetric(this.value)" style="font-size:0.78rem;">
                    ${metricOptions.map(m => `<option value="${m.k}" ${_svTrendMetric === m.k ? 'selected' : ''}>${m.label}</option>`).join('')}
                </select>
            </div>
            <div style="position:relative;height:250px;"><canvas id="svTrendChart"></canvas></div>
        </div>
        ${history.length ? `
        <div class="stats-card" style="margin-top:1rem;padding:0;overflow-x:auto;">
            <h4 style="padding:0.8rem 1rem 0.3rem;">Evolución de ${_escHtml(companyName)}</h4>
            <table class="data-table" style="font-size:0.8rem;"><thead><tr><th>Ronda</th><th>Contacto</th><th style="text-align:center;">Promedio</th>${_SV_DIMS.map(d => `<th style="text-align:center;" title="${d.label}">${d.label.split(' ').slice(-1)[0]}</th>`).join('')}<th>Comentario</th></tr></thead>
            <tbody>${history.map(x => `<tr>
                <td style="white-space:nowrap;"><strong>${_escHtml(x.round?.name || '')}</strong><div style="font-size:0.68rem;color:#94a3b8;">${_escHtml(_svRoundDate(x.round))}</div></td>
                <td style="font-size:0.76rem;">${_escHtml(x.inv.contact_name || '')}</td>
                <td style="text-align:center;">${_svBadge(_svResponseScore(x.resp), false)}</td>
                ${_SV_DIMS.map(d => { const v = _svNum(x.resp[d.k]); return `<td style="text-align:center;font-size:0.76rem;${v !== null && v < 4 ? 'color:#b91c1c;font-weight:800;background:#fef2f2;' : 'color:#64748b;'}">${v === null ? '—' : _svFmt(v, 1)}</td>`; }).join('')}
                <td style="font-size:0.74rem;color:#475569;max-width:280px;">${_escHtml(x.resp.comments || '')}</td></tr>`).join('')}</tbody></table>
        </div>` : ''}
        <div class="stats-card" style="margin-top:1rem;padding:0;overflow-x:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.8rem 1rem;"><h4 style="margin:0;">Compañías (última respuesta)</h4>
                <button class="btn-outline" onclick="svToggleAlerts()" style="font-size:0.76rem;padding:3px 12px;${_svOnlyAlerts ? 'background:#fee2e2;border-color:#b91c1c;color:#b91c1c;' : ''}">${_svOnlyAlerts ? '⚠ Solo alertas (quitar)' : '⚠ Solo alertas'}</button></div>
            <table class="data-table" style="font-size:0.8rem;"><thead><tr><th>Compañía</th><th>Ronda</th><th style="text-align:center;">Promedio</th>${_SV_DIMS.map(d => `<th style="text-align:center;" title="${d.label}">${d.label.split(' ').slice(-1)[0]}</th>`).join('')}</tr></thead>
            <tbody>${clients.map(c => `<tr>
                <td><strong>${_escHtml(c.inv.company_name)}</strong><div style="font-size:0.7rem;color:#94a3b8;">${_escHtml(c.inv.contact_name || '')}</div></td>
                <td style="font-size:0.74rem;color:#64748b;white-space:nowrap;">${_escHtml(c.round?.name || '')}</td>
                <td style="text-align:center;">${_svBadge(c.score, false)}</td>
                ${_SV_DIMS.map(d => { const v = _svNum(c.resp[d.k]); return `<td style="text-align:center;font-size:0.76rem;${v !== null && v < 4 ? 'color:#b91c1c;font-weight:800;background:#fef2f2;' : 'color:#64748b;'}">${v === null ? '—' : _svFmt(v, 1)}</td>`; }).join('')}
            </tr>`).join('') || '<tr><td colspan="10" style="text-align:center;padding:1.5rem;color:#94a3b8;">Sin compañías en alerta.</td></tr>'}</tbody></table>
        </div>
        <div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(300px,1.3fr);gap:1rem;margin-top:1rem;" class="sv-two-col">
            <div class="stats-card" style="padding:0;overflow-x:auto;"><h4 style="padding:0.8rem 1rem 0.2rem;">Por analista</h4>
                <div style="padding:0 1rem 0.4rem;font-size:0.72rem;color:#94a3b8;">Según los analistas que atendieron a cada compañía en la ventana de la ronda.</div>
                <table class="data-table" style="font-size:0.8rem;"><thead><tr><th>Analista</th><th style="text-align:center;">Resp.</th><th style="text-align:center;">Promedio</th><th style="text-align:center;">Mediciones</th><th style="text-align:center;">Claridad</th><th style="text-align:center;">Certeza</th></tr></thead>
                <tbody>${analystRows.map(a => `<tr><td><strong>${_escHtml(a.name)}</strong></td><td style="text-align:center;">${a.n}</td><td style="text-align:center;">${_svBadge(a.avg.overall, false)}</td>
                    <td style="text-align:center;">${_svFmt(a.avg.dims.q_punctual, 1)}</td><td style="text-align:center;">${_svFmt(a.avg.dims.q_clarity, 1)}</td><td style="text-align:center;">${_svFmt(a.avg.dims.q_accuracy, 1)}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:1rem;color:#94a3b8;">Sin datos de analistas.</td></tr>'}</tbody></table></div>
            <div class="stats-card"><h4 style="margin-bottom:0.6rem;">Comentarios recientes</h4>
                <div style="max-height:340px;overflow-y:auto;">${comments.map(x => `<div style="padding:0.5rem 0;border-bottom:1px solid #f1f5f9;">
                    <div style="font-size:0.74rem;color:#64748b;"><strong>${_escHtml(x.inv.company_name)}</strong> · ${_escHtml(x.round?.name || '')} ${_svBadge(_svResponseScore(x.resp), false)}</div>
                    <div style="font-size:0.82rem;margin-top:2px;">${_escHtml(x.resp.comments)}</div></div>`).join('') || '<div style="color:#94a3b8;font-size:0.82rem;">Sin comentarios.</div>'}</div></div>
        </div>`;
}

function _svDrawChart() {
    const canvas = document.getElementById('svTrendChart');
    if(!canvas || typeof Chart === 'undefined') return;
    if(_svChart) { _svChart.destroy(); _svChart = null; }
    const metric = _svTrendMetric;
    const label = metric === 'overall' ? 'Promedio general' : (_SV_DIMS.find(d => d.k === metric)?.label || metric);
    const points = _svRoundsOf(_svFilteredRows()).map(g => {
        const a = _svAverages(g.resp);
        return { label: g.round.name, value: metric === 'overall' ? a.overall : a.dims[metric] };
    }).filter(p => p.value !== null && p.value !== undefined);
    if(!points.length) return;
    const vals = points.map(p => p.value);
    const yMin = Math.max(1, Math.floor((Math.min(...vals) - 0.3) * 2) / 2);
    _svChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: points.map(p => p.label),
            datasets: [{ label, data: vals.map(v => Number(v.toFixed(2))), borderColor: '#2563eb', backgroundColor: '#2563eb22', fill: true, tension: 0.3, pointRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { min: Math.min(yMin, 3), max: 5, ticks: { stepSize: 0.5 } } },
            plugins: { legend: { display: false } }
        }
    });
}

function svExportCSV() {
    const rows = _svFilteredRows();
    if(!rows.length) { showToast('No hay respuestas para exportar', 'error'); return; }
    const head = ['Ronda', 'Fecha', 'Empresa', 'Contacto', 'Cargo', 'Analistas', ..._SV_DIMS.map(d => d.label), 'Promedio', 'Reunión de cierre', 'Nota reunión', 'Emoción', 'Comentarios'];
    const data = rows.map(x => [
        x.round?.name || '', _svRoundDate(x.round || {}), x.inv.company_name, x.inv.contact_name || '', x.inv.contact_role || '', x.inv.analysts || '',
        ..._SV_DIMS.map(d => x.resp[d.k] ?? ''), _svFmt(_svResponseScore(x.resp), 2), x.resp.q_closing_meeting ?? '', x.resp.closing_meeting_note || '', x.resp.emotion || '', x.resp.comments || ''
    ]);
    const csv = [head, ...data].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `encuestas_satisfaccion_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
}

// ── Conciliación: compañía de la encuesta ↔ cliente del planner ───────────────
const _SV_STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'sa', 'sas', 'ltda', 'y', 'e', 'cia', 'compania']);

function _svTokens(key) {
    return new Set(String(key || '').split(' ').filter(t => t.length > 1 && !_SV_STOP.has(t)));
}

/** Parecido entre dos nombres normalizados (0 a 1). */
function _svNameScore(a, b) {
    if(!a || !b) return 0;
    if(a === b) return 1;
    const short = a.length <= b.length ? a : b, long = a.length <= b.length ? b : a;
    if(short.length >= 4 && (` ${long} `).includes(` ${short} `)) return 0.9;
    const ta = _svTokens(a), tb = _svTokens(b);
    if(!ta.size || !tb.size) return 0;
    let hit = 0;
    ta.forEach(x => {
        if(tb.has(x) || [...tb].some(y => (x.length >= 4 && y.startsWith(x)) || (y.length >= 4 && x.startsWith(y)))) hit++;
    });
    return hit / (ta.size + tb.size - hit);
}

/** Mejor cliente del planner para un nombre de la encuesta: { key, name, score } o null. */
function _svSuggestPlanner(surveyKey) {
    let best = null;
    _svPlannerCompanies().forEach((name, key) => {
        const score = _svNameScore(surveyKey, key);
        if(!best || score > best.score) best = { key, name, score };
    });
    return best && best.score >= 0.5 ? best : null;
}

/** Aplica la correspondencia a las encuestas ya cargadas (sin tocar la base de datos). */
function _svApplyCompanyMap() {
    const map = new Map(dbSurveyCompanyMap.map(m => [m.survey_key, m]));
    const apply = (row) => {
        if(row._origKey === undefined) { row._origKey = row.company_key; row._origName = row.company_name; }
        const m = map.get(row._origKey);
        if(m && m.planner_key) { row.company_key = m.planner_key; row.company_name = m.planner_name || m.planner_key; }
        else { row.company_key = row._origKey; row.company_name = row._origName; }
        return !(m && m.excluded);
    };
    dbSurveyInvites = _svAllInvites.filter(apply);
    dbClientContacts = _svAllContacts.filter(apply);
}

/** Compañías tal como quedaron en las encuestas, con su estado de conciliación. */
function _svReconcileRows() {
    const planner = _svPlannerCompanies();
    const map = new Map(dbSurveyCompanyMap.map(m => [m.survey_key, m]));
    const rows = new Map();
    const get = (key, name) => {
        if(!rows.has(key)) rows.set(key, { key, name, responses: 0, rounds: new Set(), contacts: 0, last: '' });
        return rows.get(key);
    };
    _svAllInvites.forEach(i => {
        const r = get(i._origKey ?? i.company_key, i._origName ?? i.company_name);
        const resp = _svResponseOf(i.id);
        r.rounds.add(i.round_id);
        if(resp) {
            r.responses++;
            const d = String(resp.answered_at || '').slice(0, 10);
            if(d > r.last) r.last = d;
        }
    });
    _svAllContacts.forEach(c => { get(c._origKey ?? c.company_key, c._origName ?? c.company_name).contacts++; });
    return [...rows.values()].map(r => {
        const m = map.get(r.key);
        let status, planner_key = null, planner_name = '', suggestion = null;
        if(m && m.excluded) {
            status = 'excluded';
        } else if(m) {
            status = m.planner_key ? 'mapped' : 'none';
            planner_key = m.planner_key; planner_name = m.planner_name || '';
        } else if(planner.has(r.key)) {
            status = 'match'; planner_key = r.key; planner_name = planner.get(r.key);
        } else {
            suggestion = _svSuggestPlanner(r.key);
            status = suggestion ? 'suggested' : 'pending';
        }
        return { ...r, status, planner_key, planner_name, suggestion };
    }).sort((a, b) => {
        const rank = { pending: 0, suggested: 1, none: 2, mapped: 3, match: 4, excluded: 5 };
        return rank[a.status] - rank[b.status] || b.responses - a.responses || a.name.localeCompare(b.name, 'es');
    });
}

function _svReconcileTab() {
    const rows = _svReconcileRows();
    const planner = [...(_svPlannerCompanies().entries())].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const cnt = (st) => rows.filter(r => r.status === st).length;
    const todo = cnt('pending') + cnt('suggested');
    const chip = (r) => ({
        match:     '<span style="background:#dcfce7;color:#15803d;border-radius:99px;padding:2px 10px;font-size:0.72rem;font-weight:700;">✓ Coincide</span>',
        mapped:    '<span style="background:#dbeafe;color:#1d4ed8;border-radius:99px;padding:2px 10px;font-size:0.72rem;font-weight:700;">✓ Conciliado</span>',
        none:      '<span style="background:#f1f5f9;color:#64748b;border-radius:99px;padding:2px 10px;font-size:0.72rem;font-weight:700;">No está en el planner</span>',
        suggested: '<span style="background:#fef3c7;color:#b45309;border-radius:99px;padding:2px 10px;font-size:0.72rem;font-weight:700;">Sugerido</span>',
        pending:   '<span style="background:#fee2e2;color:#b91c1c;border-radius:99px;padding:2px 10px;font-size:0.72rem;font-weight:700;">Sin coincidencia</span>',
        excluded:  '<span style="background:#f1f5f9;color:#94a3b8;border-radius:99px;padding:2px 10px;font-size:0.72rem;font-weight:700;">Excluida</span>'
    }[r.status]);
    const isAdmin = currentUserProfile?.role === 'admin';
    const removable = rows.filter(r => r.status === 'none' || r.status === 'pending');
    const options = (r) => {
        const sug = r.suggestion;
        return `<option value="">— Elegir cliente del planner —</option>
            ${sug ? `<option value="${_escHtml(sug.key)}" ${r.status === 'suggested' ? 'selected' : ''}>★ ${_escHtml(sug.name)} (sugerido)</option>` : ''}
            <option value="__none__" ${r.status === 'none' ? 'selected' : ''}>✕ No está en el planner</option>
            ${planner.filter(p => !sug || p.key !== sug.key).map(p => `<option value="${_escHtml(p.key)}" ${(r.status === 'mapped' || r.status === 'match') && r.planner_key === p.key ? 'selected' : ''}>${_escHtml(p.name)}</option>`).join('')}`;
    };
    return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.8rem;">
            <div style="font-size:0.82rem;color:#64748b;max-width:640px;">Indica a qué cliente del planner corresponde cada compañía de las encuestas. Así los filtros, los contactos y el aviso de "encuestado hace menos de 6 meses" usan los mismos nombres. No modifica las encuestas originales y se puede deshacer.
                <div style="margin-top:4px;"><strong>${cnt('match') + cnt('mapped')}</strong> conciliadas · <strong style="color:#b45309;">${todo}</strong> por revisar · ${cnt('none')} fuera del planner${cnt('excluded') ? ` · ${cnt('excluded')} excluidas` : ''}</div></div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                ${removable.length ? `<button class="btn-outline" onclick="svExcludeAllUnmatched()" style="border-color:#b91c1c;color:#b91c1c;">🗑 Quitar las ${removable.length} que no están en el planner</button>` : ''}
                ${cnt('suggested') ? `<button class="btn-primary" onclick="svAcceptAllSuggestions()">✔ Aceptar las ${cnt('suggested')} sugerencias</button>` : ''}
            </div>
        </div>
        <div class="stats-card" style="padding:0;overflow-x:auto;"><table class="data-table" style="font-size:0.82rem;">
            <thead><tr><th>Compañía en la encuesta</th><th style="text-align:center;">Respuestas</th><th style="min-width:280px;">Cliente del planner</th><th>Estado</th><th></th></tr></thead>
            <tbody>${rows.map(r => `<tr style="${r.status === 'excluded' ? 'opacity:.55;' : ''}">
                <td><strong>${_escHtml(r.name)}</strong><div style="font-size:0.7rem;color:#94a3b8;">${r.rounds.size} ronda${r.rounds.size !== 1 ? 's' : ''}${r.contacts ? ` · ${r.contacts} contacto${r.contacts !== 1 ? 's' : ''}` : ''}${r.last ? ` · última ${_escHtml(r.last)}` : ''}</div></td>
                <td style="text-align:center;">${r.responses}</td>
                <td><select ${r.status === 'excluded' ? 'disabled' : ''} onchange="svMapCompany('${_escHtml(r.key)}', this.value)" style="width:100%;padding:0.4rem 0.5rem;border:1px solid ${r.status === 'pending' ? '#fca5a5' : r.status === 'suggested' ? '#fcd34d' : '#cbd5e1'};border-radius:6px;font-size:0.8rem;">${options(r)}</select></td>
                <td>${chip(r)}</td>
                <td style="text-align:right;white-space:nowrap;">
                    ${r.status === 'suggested' ? `<button class="btn-outline" onclick="svMapCompany('${_escHtml(r.key)}', '${_escHtml(r.suggestion.key)}')" style="font-size:0.74rem;padding:2px 10px;">Aceptar</button>` : ''}
                    ${(r.status === 'mapped' || r.status === 'none') ? `<button class="btn-secondary" onclick="svUndoMap('${_escHtml(r.key)}')" title="Deshacer" style="font-size:0.74rem;padding:2px 8px;">↺</button>` : ''}
                    ${(r.status === 'none' || r.status === 'pending') ? `<button class="btn-secondary" onclick="svExcludeCompany('${_escHtml(r.key)}')" title="Quitar de las encuestas (se puede restaurar)" style="font-size:0.74rem;padding:2px 8px;color:#b91c1c;">🗑 Quitar</button>` : ''}
                    ${r.status === 'excluded' ? `<button class="btn-secondary" onclick="svUndoMap('${_escHtml(r.key)}')" title="Restaurar en las encuestas" style="font-size:0.74rem;padding:2px 8px;">↺ Restaurar</button>
                        ${isAdmin ? `<button class="btn-secondary" onclick="svPurgeCompany('${_escHtml(r.key)}')" title="Eliminar definitivamente de la base de datos" style="font-size:0.74rem;padding:2px 8px;color:#b91c1c;">Eliminar definitivo</button>` : ''}` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#94a3b8;">Aún no hay compañías en las encuestas.</td></tr>'}</tbody></table></div>`;
}

async function _svSaveMapping(rows) {
    const by = currentUserProfile?.display_name || currentUser?.email || null;
    const { error } = await supabaseClient.from('survey_company_map').upsert(
        rows.map(r => ({ survey_key: r.surveyKey, survey_name: r.surveyName, planner_key: r.plannerKey, planner_name: r.plannerName, confirmed_by: by, updated_at: new Date().toISOString() })),
        { onConflict: 'survey_key' });
    if(error) {
        showToast(/survey_company_map|schema cache/i.test(error.message || '') ? 'Falta ejecutar la migración de conciliación en Supabase.' : error.message, 'error');
        return false;
    }
    return true;
}

async function svMapCompany(surveyKey, value) {
    if(!value) return;
    const row = _svReconcileRows().find(r => r.key === surveyKey);
    if(!row) return;
    const planner = _svPlannerCompanies();
    const plannerKey = value === '__none__' ? null : value;
    const ok = await _svSaveMapping([{ surveyKey, surveyName: row.name, plannerKey, plannerName: plannerKey ? (planner.get(plannerKey) || '') : null }]);
    if(!ok) return;
    await loadSurveyData();
    renderSurveysView();
}

async function svAcceptAllSuggestions() {
    const sug = _svReconcileRows().filter(r => r.status === 'suggested');
    if(!sug.length) return;
    if(!confirm(`Se aceptarán las ${sug.length} sugerencias:\n\n${sug.slice(0, 12).map(r => `• ${r.name} → ${r.suggestion.name}`).join('\n')}${sug.length > 12 ? `\n… y ${sug.length - 12} más` : ''}\n\nPuedes deshacer cualquiera después. ¿Continuar?`)) return;
    const ok = await _svSaveMapping(sug.map(r => ({ surveyKey: r.key, surveyName: r.name, plannerKey: r.suggestion.key, plannerName: r.suggestion.name })));
    if(!ok) return;
    await loadSurveyData();
    renderSurveysView();
    showToast(`${sug.length} compañías conciliadas ✓`, 'success');
}

/** Excluye compañías de las encuestas (reversible): dejan de verse, pero siguen guardadas. */
async function _svExclude(rows) {
    const by = currentUserProfile?.display_name || currentUser?.email || null;
    const { error } = await supabaseClient.from('survey_company_map').upsert(
        rows.map(r => ({ survey_key: r.key, survey_name: r.name, planner_key: null, planner_name: null, excluded: true, confirmed_by: by, updated_at: new Date().toISOString() })),
        { onConflict: 'survey_key' });
    if(error) {
        showToast(/excluded|schema cache/i.test(error.message || '') ? 'Falta ejecutar la migración de exclusión en Supabase (supabase_migration_survey_company_exclude.sql).' : error.message, 'error');
        return false;
    }
    return true;
}

function _svImpact(rows) {
    const keys = new Set(rows.map(r => r.key));
    const invites = _svAllInvites.filter(i => keys.has(i._origKey ?? i.company_key));
    const responses = invites.filter(i => _svResponseOf(i.id)).length;
    const contacts = _svAllContacts.filter(c => keys.has(c._origKey ?? c.company_key)).length;
    return { invites: invites.length, responses, contacts };
}

async function svExcludeCompany(key) {
    const row = _svReconcileRows().find(r => r.key === key);
    if(!row) return;
    const imp = _svImpact([row]);
    if(!confirm(`Quitar "${row.name}" de las encuestas?\n\nDejará de verse en rondas, resultados y contactos (${imp.responses} respuestas, ${imp.contacts} contactos). Los datos NO se borran y puedes restaurarla desde esta misma pestaña.`)) return;
    if(!(await _svExclude([row]))) return;
    await loadSurveyData();
    renderSurveysView();
}

async function svExcludeAllUnmatched() {
    const rows = _svReconcileRows().filter(r => r.status === 'none' || r.status === 'pending');
    if(!rows.length) return;
    const imp = _svImpact(rows);
    if(!confirm(`Se quitarán ${rows.length} compañías que no están en el planner:\n\n${rows.slice(0, 15).map(r => '• ' + r.name).join('\n')}${rows.length > 15 ? `\n… y ${rows.length - 15} más` : ''}\n\n(${imp.responses} respuestas, ${imp.contacts} contactos). Los datos NO se borran y puedes restaurarlas cuando quieras. ¿Continuar?`)) return;
    if(!(await _svExclude(rows))) return;
    await loadSurveyData();
    renderSurveysView();
    showToast(`${rows.length} compañías quitadas de las encuestas ✓`, 'success');
}

/** Borrado definitivo (solo admin): elimina invitaciones, respuestas y contactos de la compañía. */
async function svPurgeCompany(key) {
    if(currentUserProfile?.role !== 'admin') { showToast('Solo el administrador puede eliminar definitivamente', 'error'); return; }
    const row = _svReconcileRows().find(r => r.key === key);
    if(!row) return;
    const imp = _svImpact([row]);
    if(!confirm(`ELIMINAR DEFINITIVAMENTE "${row.name}"\n\nSe borrarán de la base de datos ${imp.invites} invitaciones, ${imp.responses} respuestas y ${imp.contacts} contactos. Esto NO se puede deshacer.\n\n¿Seguro?`)) return;
    const typed = (prompt(`Para confirmar, escribe ELIMINAR:`) || '').trim();
    if(typed !== 'ELIMINAR') { showToast('Cancelado: no se eliminó nada', 'error'); return; }
    const inv = await supabaseClient.from('survey_invites').delete().eq('company_key', key);
    if(inv.error) { showToast('No se pudo eliminar: ' + inv.error.message, 'error'); return; }
    const con = await supabaseClient.from('client_contacts').delete().eq('company_key', key);
    if(con.error) { showToast('Se borraron las encuestas, pero no los contactos: ' + con.error.message, 'error'); }
    await supabaseClient.from('survey_company_map').delete().eq('survey_key', key);
    await loadSurveyData();
    // rondas que quedaron sin ninguna invitación
    const empty = dbSurveyRounds.filter(r => !_svAllInvites.some(i => i.round_id === r.id));
    if(empty.length && confirm(`Quedaron ${empty.length} ronda(s) vacía(s):\n\n${empty.map(r => '• ' + r.name).join('\n')}\n\n¿Quieres eliminarlas también?`)) {
        await supabaseClient.from('survey_rounds').delete().in('id', empty.map(r => r.id));
        await loadSurveyData();
    }
    renderSurveysView();
    showToast('Compañía eliminada definitivamente', 'success');
}

async function svUndoMap(surveyKey) {
    const { error } = await supabaseClient.from('survey_company_map').delete().eq('survey_key', surveyKey);
    if(error) { showToast(error.message, 'error'); return; }
    await loadSurveyData();
    renderSurveysView();
}

// ── Tarjeta de satisfacción en el Panel de Control ───────────────────────────
function renderDashboardSurveyCard() {
    const el = document.getElementById('dash-survey-section');
    if(!el) return;
    if(!_svCanResults() || !dbSurveyRounds.length) { el.style.display = 'none'; return; }
    const chrono = dbSurveyRounds.filter(r => dbSurveyInvites.some(i => i.round_id === r.id && _svResponseOf(i.id)))
        .sort((a, b) => _svRoundDate(b).localeCompare(_svRoundDate(a)));
    if(!chrono.length) { el.style.display = 'none'; return; }
    const last = chrono[0], prev = chrono[1] || null;
    const a = _svAverages(_svScopeResponses([last]).map(x => x.resp));
    const p = prev ? _svAverages(_svScopeResponses([prev]).map(x => x.resp)) : null;
    const st = _svRoundStats(last.id);
    const items = _svGaugeItems(a, p);
    el.style.display = '';
    el.innerHTML = `
        ${_svGaugesHTML(items, 'dsg', `Satisfacción del cliente — ${_escHtml(last.name)}`,
            `${st.answered} de ${st.invites} contactos respondieron${prev ? ` · la flecha compara con ${_escHtml(prev.name)}` : ''}. <a href="#" onclick="svGoToResults(); return false;" style="color:var(--clr-blue);font-weight:600;">Ver resultados completos →</a>`)}`;
    _svDrawGauges(items, 'dsg');
}

function svGoToResults() {
    _svTab = 'dashboard';
    _svOpenRound = null;
    switchView('surveys');
}

// ══════════════════════════════════════════
// MÓDULO DE EFICIENCIA (clientes y analistas) — solo admin, Vibraciones y Termografía
// Prioridad 1: subsistemas (leídos del texto del "ojito") frente a los días de medición
// del planner. Prioridad 2 (si no hay subsistemas): horas de la planilla.
// Cada métrica se compara con la mediana de A-MAQ en el mismo servicio → nota 1–10.
// ══════════════════════════════════════════

let _effTab = 'clients';          // 'clients' | 'analysts' | 'compare' | 'missing'
let _effService = 'predictive';   // 'predictive' | 'Vibraciones' | 'Termografía'
let _effScope = 'year';           // 'year' | 'last12' | 'all'

const _EFF_PREDICTIVE = ['Vibraciones', 'Termografía'];
const _EFF_MONEY = (v) => '$' + Math.round(v).toLocaleString('es-CO');
const _EFF_METRICS = {
    vps:         { short: '$/subsistema',        group: 'subs',  fmt: _EFF_MONEY },
    sps_day:     { short: 'Subs./día medición',  group: 'subs',  fmt: (v) => v.toFixed(1) },
    vpd:         { short: '$/día medición',      group: 'subs',  fmt: _EFF_MONEY },
    vph_site:    { short: '$/h planta',          group: 'hours', fmt: _EFF_MONEY },
    vph_charged: { short: '$/h cobrada',         group: 'hours', fmt: _EFF_MONEY },
    bill_eff:    { short: 'Cobrado vs real',     group: 'hours', fmt: (v) => v.toFixed(2) + '×' }
};
const _EFF_CLIENT_METRICS  = ['vps', 'sps_day', 'vpd', 'vph_site', 'vph_charged', 'bill_eff'];
const _EFF_ANALYST_METRICS = ['sps_day', 'vps', 'vpd', 'vph_site', 'bill_eff'];

/** Subsistemas: planilla ("Cantidad de subsistemas: 12") o texto libre ("se midieron 120 subsistemas"). */
function _effExtractSubsystems(src, labelValue, serviceType) {
    const num = (v) => {
        const m = String(v).match(/\d+(?:[.,]\d+)?/);
        const n = m ? parseFloat(m[0].replace(',', '.')) : NaN;
        return n > 0 ? n : null;
    };
    const fromLabel = num(labelValue);
    if(fromLabel) return fromLabel;

    const text = String(src || '');
    // "35 subsistemas", "35 sub sistemas", "35 sub-sistemas" / "subsistemas: 35" / "total de 35 subsistemas"
    const unit = serviceType === 'Termografía' ? '(?:sub\\s*-?\\s*sistemas?|termograf[ií]as?)' : 'sub\\s*-?\\s*sistemas?';
    const found = [];
    let m;
    const before = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*(?:de\\s+)?' + unit, 'gi');
    while((m = before.exec(text)) !== null) {
        const n = parseFloat(m[1].replace(',', '.'));
        if(n > 0) found.push({ n, idx: m.index });
    }
    const after = new RegExp(unit + '\\s*(?:medidos?|intervenidos?|totales?)?\\s*[:=]\\s*(\\d+(?:[.,]\\d+)?)', 'gi');
    while((m = after.exec(text)) !== null) {
        const n = parseFloat(m[1].replace(',', '.'));
        if(n > 0) found.push({ n, idx: m.index });
    }
    if(!found.length) return null;
    // Si dice "total ... N subsistemas", ese manda; si hay varios números, el mayor.
    const totals = found.filter(f => /total/i.test(text.slice(Math.max(0, f.idx - 25), f.idx + 5)));
    return (totals.length ? totals : found).reduce((mx, f) => Math.max(mx, f.n), 0);
}

/** Extrae subsistemas y horas del texto del "ojito" (planilla o texto libre). */
function parseServiceDetailsMetrics(text, serviceType) {
    if(!text) return null;
    const src = String(text);
    const grab = (label) => {
        const m = src.match(new RegExp('^[\\s\\-•*_#>]*(?:' + label + ')[\\s*_]*:[\\s*_]*([^\\n\\r]*)', 'im'));
        const v = m ? m[1].trim() : '';
        return /^(no especificad|n\/a|-+$)/i.test(v) ? '' : v;
    };
    const num = (v) => {
        const m = String(v).match(/\d+(?:[.,]\d+)?/);
        const n = m ? parseFloat(m[0].replace(',', '.')) : NaN;
        return n > 0 ? n : null;
    };
    const minutes = (v) => {
        let m = String(v).match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:([ap])\.?\s*m\.?)?/i);
        let h, min, ap;
        if(m) { h = parseInt(m[1], 10); min = parseInt(m[2], 10); ap = m[3]; }
        else {
            m = String(v).match(/(\d{1,2})\s*([ap])\.?\s*m\b/i);
            if(!m) return null;
            h = parseInt(m[1], 10); min = 0; ap = m[2];
        }
        if(ap) { ap = ap.toLowerCase(); if(ap === 'p' && h < 12) h += 12; if(ap === 'a' && h === 12) h = 0; }
        if(h > 23 || min > 59) return null;
        return h * 60 + min;
    };

    const rawSubs    = grab('(?:Cantidad de )?subsistemas(?: medidos| intervenidos)?');
    const rawCharged = grab('Horas? a cobrar(?: en el servicio)?|Horas? cobradas?|Horas? facturad[ao]s?');
    const rawEntry   = grab('Hora de (?:entrada|ingreso|llegada)|Entrada|Ingreso');
    const rawExit    = grab('Hora de (?:salida|retiro)|Salida|Retiro');
    const subsystems   = _effExtractSubsystems(src, rawSubs, serviceType);
    const chargedHours = num(rawCharged);
    const entry = minutes(rawEntry);
    const exit  = minutes(rawExit);
    let siteHours = null;
    if(entry !== null && exit !== null && exit > entry) {
        const h = (exit - entry) / 60;
        if(h <= 24) siteHours = h;
    }
    return { subsystems, chargedHours, siteHours };
}

function _effMedian(arr) {
    const a = arr.filter(v => isFinite(v)).sort((x, y) => x - y);
    if(a.length === 0) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** 5.5 = igual a la mediana; 10 = el doble o más; 1 = la mitad o menos. */
function _effScore(index) {
    return Math.max(1, Math.min(10, 5.5 + 4.5 * Math.log2(index)));
}

function _effScoreStyle(sc) {
    if(sc === null || sc === undefined) return { color: '#94a3b8', bg: '#f1f5f9' };
    if(sc >= 7.5) return { color: '#15803d', bg: '#dcfce7' };
    if(sc >= 5.5) return { color: '#1d4ed8', bg: '#dbeafe' };
    if(sc >= 4)   return { color: '#b45309', bg: '#fef3c7' };
    return { color: '#b91c1c', bg: '#fee2e2' };
}

function _effScoreBadge(sc, big) {
    if(sc === null || sc === undefined) return '<span style="color:#cbd5e1;">—</span>';
    const st = _effScoreStyle(sc);
    return `<span style="display:inline-block;min-width:${big ? 46 : 36}px;text-align:center;background:${st.bg};color:${st.color};border-radius:99px;padding:${big ? '3px 10px' : '1px 7px'};font-weight:800;font-size:${big ? '0.95rem' : '0.74rem'};">${sc.toFixed(1)}</span>`;
}

/** Días de medición: los programados en el planner (tipo "field") o, si aún no, los planeados. */
function _effFieldDays(t) {
    const scheduled = (t.scheduledDays || []).filter(d => d.type === 'field').length;
    return scheduled || parseInt(t.daysField, 10) || 0;
}

function _effTaskMetrics(t) {
    const d = parseServiceDetailsMetrics(t.serviceDetails, t.serviceType) || {};
    const budget = parseFloat(t.budget) || 0;
    const fieldDays = _effFieldDays(t);
    const m = {};
    // Camino 1: subsistemas frente a los días de medición del planner
    if(d.subsystems) {
        if(budget > 0) m.vps = budget / d.subsystems;
        if(fieldDays > 0) {
            m.sps_day = d.subsystems / fieldDays;
            if(budget > 0) m.vpd = budget / fieldDays;
        }
    }
    // Camino 2: horas de la planilla (se usan para calificar solo si no hay subsistemas)
    if(budget > 0 && d.siteHours)     m.vph_site    = budget / d.siteHours;
    if(budget > 0 && d.chargedHours)  m.vph_charged = budget / d.chargedHours;
    if(d.chargedHours && d.siteHours) m.bill_eff    = d.chargedHours / d.siteHours;
    return m;
}

function _effAllRows() {
    return tasks
        .filter(t => !t.isAbsence && (t.status === 'ejecutada' || t.status === 'facturada')
            && _EFF_PREDICTIVE.includes(t.serviceType)
            && !String(t.id).startsWith('t_'))
        .map(t => ({ t, m: _effTaskMetrics(t) }));
}

/** Mediana de A-MAQ por tipo de servicio y métrica (con todo el histórico). */
function _effBaselines(rows) {
    const acc = {};
    rows.forEach(({ t, m }) => {
        Object.keys(m).forEach(k => {
            acc[t.serviceType] = acc[t.serviceType] || {};
            (acc[t.serviceType][k] = acc[t.serviceType][k] || []).push(m[k]);
        });
    });
    const base = {};
    Object.keys(acc).forEach(svc => {
        base[svc] = {};
        Object.keys(acc[svc]).forEach(k => { base[svc][k] = _effMedian(acc[svc][k]); });
    });
    return base;
}

function _effPeriodOk(t) {
    if(_effScope === 'all') return true;
    const p = String(t.mesFacturacion || t.period || '');
    const now = new Date();
    if(_effScope === 'year') return p.startsWith(String(now.getFullYear()));
    const d = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return p >= from;
}

function _effServiceOk(t) {
    if(_effService === 'predictive') return _EFF_PREDICTIVE.includes(t.serviceType);
    return t.serviceType === _effService;
}

function _effAnalystsOf(t) {
    const a = t.analysts_assignment || [];
    const titulars = a.filter(x => x.isTitular).map(x => x.name);
    if(titulars.length) return titulars;
    if(a.length) return a.map(x => x.name);
    return t.analyst ? [t.analyst] : [];
}

/** Agrupa filas por entidad: medianas, nota por métrica y nota global
 *  (promedio de las métricas de subsistemas; si no hay, de las de horas). */
function _effAggregate(rows, baselines, keysOf, metricKeys) {
    const groups = new Map();
    rows.forEach(r => {
        keysOf(r.t).forEach(key => {
            if(!key) return;
            if(!groups.has(key)) groups.set(key, []);
            groups.get(key).push(r);
        });
    });
    const out = [];
    groups.forEach((list, key) => {
        const raw = {}, scores = {};
        metricKeys.forEach(k => {
            const vals = list.filter(r => r.m[k] !== undefined);
            if(!vals.length) return;
            raw[k] = _effMedian(vals.map(r => r.m[k]));
            const ratios = vals.map(r => {
                const b = baselines[r.t.serviceType]?.[k];
                return b ? r.m[k] / b : null;
            }).filter(v => v !== null);
            if(ratios.length) scores[k] = _effScore(_effMedian(ratios));
        });
        const byGroup = { subs: [], hours: [] };
        Object.keys(scores).forEach(k => byGroup[_EFF_METRICS[k].group].push(scores[k]));
        const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        const basis = byGroup.subs.length ? 'subs' : (byGroup.hours.length ? 'hours' : null);
        out.push({
            key,
            n: list.length,
            nData: list.filter(r => Object.keys(r.m).length > 0).length,
            raw, scores, basis,
            overall: basis ? avg(byGroup[basis]) : null,
            total: list.reduce((s, r) => s + (parseFloat(r.t.budget) || 0), 0)
        });
    });
    out.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
    return out;
}

function setEfficiencyFilter(kind, value) {
    if(kind === 'tab') _effTab = value;
    else if(kind === 'service') _effService = value;
    else if(kind === 'scope') _effScope = value;
    renderEfficiencyView();
}

function _effBasisChip(e) {
    if(!e.basis) return '<span style="color:#cbd5e1;">—</span>';
    return e.basis === 'subs'
        ? '<span title="Calificada con subsistemas y días de medición" style="background:#eff6ff;color:#1d4ed8;border-radius:99px;padding:1px 8px;font-size:0.7rem;font-weight:700;">Subsistemas</span>'
        : '<span title="No hay subsistemas: calificada con horas" style="background:#faf5ff;color:#7e22ce;border-radius:99px;padding:1px 8px;font-size:0.7rem;font-weight:700;">Horas</span>';
}

function _effMetricCell(entity, k) {
    const v = entity.raw[k];
    if(v === undefined) return '<td style="text-align:right;color:#cbd5e1;">—</td>';
    const sc = entity.scores[k];
    return `<td style="text-align:right;white-space:nowrap;" title="Calificación de esta métrica: ${sc !== undefined ? sc.toFixed(1) : '—'}">${_EFF_METRICS[k].fmt(v)}${sc !== undefined ? ` <span style="opacity:.85;">${_effScoreBadge(sc, false)}</span>` : ''}</td>`;
}

function _effCountCell(e) {
    const low = e.nData < 3;
    return `<td style="text-align:center;white-space:nowrap;" title="${e.nData} de ${e.n} gestiones traen datos legibles">${e.nData}/${e.n}${low ? ' <span title="Pocos datos: la calificación es poco confiable" style="color:#d97706;">⚠</span>' : ''}</td>`;
}

function renderEfficiencyView() {
    const el = document.getElementById('efficiency-container');
    if(!el) return;
    if(!['admin', 'viewer'].includes(currentUserProfile?.role)) {
        el.innerHTML = '<div style="text-align:center;padding:3rem;color:#94a3b8;">No tienes permiso para ver esta sección.</div>';
        return;
    }

    const all = _effAllRows();
    const baselines = _effBaselines(all);
    const rows = all.filter(r => _effServiceOk(r.t) && _effPeriodOk(r.t));
    const withData = rows.filter(r => Object.keys(r.m).length > 0).length;
    const withText = rows.filter(r => (r.t.serviceDetails || '').trim()).length;

    const tabs = [
        { id: 'clients',  label: '🏭 Clientes' },
        { id: 'analysts', label: '👤 Analistas' },
        { id: 'compare',  label: '⚖️ Mismo cliente' },
        { id: 'missing',  label: '📭 Datos faltantes' }
    ];

    let body = '';
    if(rows.length === 0) {
        body = '<div style="text-align:center;padding:3rem;color:#94a3b8;">No hay gestiones ejecutadas con estos filtros.</div>';
    } else if(_effTab === 'clients') {
        body = _effClientsTable(rows, baselines);
    } else if(_effTab === 'analysts') {
        body = _effAnalystsTable(rows, baselines);
    } else if(_effTab === 'compare') {
        body = _effCompareSection(rows);
    } else {
        body = _effMissingSection(rows);
    }

    el.innerHTML = `
        <div class="kanban-header" style="margin-bottom:1.25rem;">
            <div>
                <h2>Eficiencia de Clientes y Analistas</h2>
                <p class="subtitle">Vibraciones y Termografía: subsistemas medidos frente a los días de medición del planner (y horas cuando no hay subsistemas).</p>
            </div>
        </div>
        <div class="filter-toolbar" style="align-items:flex-end;">
            <div style="min-width:220px;">
                <label class="filter-label">Servicio</label><br>
                <select class="filter-select" style="margin-top:4px;width:100%;" onchange="setEfficiencyFilter('service', this.value)">
                    <option value="predictive" ${_effService === 'predictive' ? 'selected' : ''}>Vibraciones + Termografía</option>
                    ${_EFF_PREDICTIVE.map(s => `<option value="${s}" ${_effService === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            </div>
            <div style="min-width:170px;">
                <label class="filter-label">Período</label><br>
                <select class="filter-select" style="margin-top:4px;width:100%;" onchange="setEfficiencyFilter('scope', this.value)">
                    <option value="year" ${_effScope === 'year' ? 'selected' : ''}>Este año</option>
                    <option value="last12" ${_effScope === 'last12' ? 'selected' : ''}>Últimos 12 meses</option>
                    <option value="all" ${_effScope === 'all' ? 'selected' : ''}>Todo el histórico</option>
                </select>
            </div>
            <div class="view-toggle-group">
                ${tabs.map(t => `<button class="${_effTab === t.id ? 'active' : ''}" onclick="setEfficiencyFilter('tab', '${t.id}')">${t.label}</button>`).join('')}
            </div>
        </div>
        <div style="margin:0.75rem 0;font-size:0.8rem;color:${withData < rows.length / 2 ? '#b45309' : '#64748b'};">
            📊 ${rows.length} gestiones ejecutadas · ${withText} tienen texto en el ojito · ${withData} se pudieron leer (subsistemas u horas)${withData < rows.length ? ' — las demás no cuentan en la calificación. Mira la pestaña "Datos faltantes".' : '.'}
        </div>
        <div class="stats-card" style="padding:0;overflow-x:auto;">${body}</div>
        <p style="font-size:0.74rem;color:#94a3b8;margin-top:0.75rem;line-height:1.5;">
            <strong>Cómo se califica (1 a 10):</strong> cada métrica se compara con la mediana de A-MAQ en el mismo servicio.
            5.5 = igual a la mediana · 10 = el doble o más · 1 = la mitad o menos.
            Si la gestión tiene subsistemas, la nota promedia $/subsistema, subsistemas por día de medición y $/día de medición; si no, usa las horas ($/h planta, $/h cobrada, cobrado vs real).
            Los subsistemas se leen del texto que escriben los analistas; los viáticos y costos logísticos no están separados del valor.
        </p>`;
}

function _effClientsTable(rows, baselines) {
    const list = _effAggregate(rows, baselines, t => [cleanClientName(t.client)], _EFF_CLIENT_METRICS);
    return `
        <table class="data-table" style="font-size:0.82rem;">
            <thead><tr>
                <th style="width:36px;">#</th><th>Cliente</th><th style="text-align:center;">Calificación</th><th>Base</th>
                <th style="text-align:center;" title="Gestiones con datos / total">Gestiones</th>
                ${_EFF_CLIENT_METRICS.map(k => `<th style="text-align:right;">${_EFF_METRICS[k].short}</th>`).join('')}
                <th style="text-align:right;">Valor total</th>
            </tr></thead>
            <tbody>${list.map((e, i) => `<tr>
                <td style="color:#94a3b8;">${i + 1}</td>
                <td><strong>${_escHtml(e.key)}</strong></td>
                <td style="text-align:center;">${_effScoreBadge(e.overall, true)}</td>
                <td>${_effBasisChip(e)}</td>
                ${_effCountCell(e)}
                ${_EFF_CLIENT_METRICS.map(k => _effMetricCell(e, k)).join('')}
                <td style="text-align:right;color:var(--clr-green);font-weight:700;">${_EFF_MONEY(e.total)}</td>
            </tr>`).join('')}</tbody>
        </table>`;
}

function _effAnalystsTable(rows, baselines) {
    const list = _effAggregate(rows, baselines, t => _effAnalystsOf(t), _EFF_ANALYST_METRICS);
    return `
        <table class="data-table" style="font-size:0.82rem;">
            <thead><tr>
                <th style="width:36px;">#</th><th>Analista</th><th style="text-align:center;">Calificación</th><th>Base</th>
                <th style="text-align:center;" title="Gestiones con datos / total">Gestiones</th>
                ${_EFF_ANALYST_METRICS.map(k => `<th style="text-align:right;">${_EFF_METRICS[k].short}</th>`).join('')}
            </tr></thead>
            <tbody>${list.map((e, i) => `<tr>
                <td style="color:#94a3b8;">${i + 1}</td>
                <td><strong>${_escHtml(e.key)}</strong></td>
                <td style="text-align:center;">${_effScoreBadge(e.overall, true)}</td>
                <td>${_effBasisChip(e)}</td>
                ${_effCountCell(e)}
                ${_EFF_ANALYST_METRICS.map(k => _effMetricCell(e, k)).join('')}
            </tr>`).join('')}</tbody>
        </table>
        <div style="padding:0.75rem 1rem;font-size:0.74rem;color:#94a3b8;">
            Una gestión con varios analistas titulares cuenta para cada uno de ellos. Para comparar a dos analistas en igualdad de condiciones usa la pestaña "Mismo cliente".
        </div>`;
}

/** Clientes atendidos por 2+ analistas: la comparación más justa entre analistas. */
function _effCompareSection(rows) {
    const byClient = new Map();
    rows.forEach(r => {
        if(!Object.keys(r.m).length) return;
        const client = cleanClientName(r.t.client);
        _effAnalystsOf(r.t).forEach(an => {
            if(!an) return;
            if(!byClient.has(client)) byClient.set(client, new Map());
            const m = byClient.get(client);
            if(!m.has(an)) m.set(an, []);
            m.get(an).push(r);
        });
    });
    const cards = [];
    byClient.forEach((analysts, client) => {
        if(analysts.size < 2) return;
        const stats = [...analysts.entries()].map(([name, list]) => {
            const raw = {};
            _EFF_ANALYST_METRICS.forEach(k => {
                const vals = list.filter(r => r.m[k] !== undefined).map(r => r.m[k]);
                if(vals.length) raw[k] = _effMedian(vals);
            });
            return { name, n: list.length, raw };
        });
        cards.push({ client, stats, size: analysts.size });
    });
    cards.sort((a, b) => b.size - a.size || a.client.localeCompare(b.client));
    if(!cards.length) {
        return '<div style="text-align:center;padding:3rem;color:#94a3b8;">Aún no hay clientes atendidos por 2 o más analistas con datos legibles en este filtro.</div>';
    }
    return `<div style="padding:1rem;display:grid;gap:1rem;">${cards.map(c => {
        const best = {};
        _EFF_ANALYST_METRICS.forEach(k => {
            const vals = c.stats.map(s => s.raw[k]).filter(v => v !== undefined);
            if(vals.length >= 2) best[k] = Math.max(...vals);
        });
        return `
        <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <div style="background:#f8fafc;padding:0.6rem 1rem;font-weight:700;">🏭 ${_escHtml(c.client)}</div>
            <table class="data-table" style="font-size:0.8rem;">
                <thead><tr><th>Analista</th><th style="text-align:center;">Gestiones</th>
                    ${_EFF_ANALYST_METRICS.map(k => `<th style="text-align:right;">${_EFF_METRICS[k].short}</th>`).join('')}</tr></thead>
                <tbody>${c.stats.map(s => `<tr>
                    <td><strong>${_escHtml(s.name)}</strong></td>
                    <td style="text-align:center;">${s.n}</td>
                    ${_EFF_ANALYST_METRICS.map(k => {
                        const v = s.raw[k];
                        if(v === undefined) return '<td style="text-align:right;color:#cbd5e1;">—</td>';
                        const isBest = best[k] !== undefined && v === best[k];
                        return `<td style="text-align:right;${isBest ? 'color:#15803d;font-weight:800;' : ''}">${_EFF_METRICS[k].fmt(v)}${isBest ? ' ▲' : ''}</td>`;
                    }).join('')}
                </tr>`).join('')}</tbody>
            </table>
        </div>`;
    }).join('')}</div>
    <div style="padding:0 1rem 1rem;font-size:0.74rem;color:#94a3b8;">▲ marca al mejor de cada métrica dentro del mismo cliente.</div>`;
}

/** Gestiones ejecutadas sin subsistemas ni horas legibles: qué decir al analista. */
function _effMissingSection(rows) {
    const missing = rows.filter(r => Object.keys(r.m).length === 0);
    if(!missing.length) return '<div style="text-align:center;padding:3rem;color:#16a34a;">✅ Todas las gestiones tienen datos legibles.</div>';
    const sorted = missing.slice().sort((a, b) => String(b.t.mesFacturacion || b.t.period).localeCompare(String(a.t.mesFacturacion || a.t.period)));
    return `
        <table class="data-table" style="font-size:0.8rem;">
            <thead><tr><th>Mes</th><th>Cliente</th><th>Servicio</th><th>Analista(s)</th><th>Lo que dice el ojito</th></tr></thead>
            <tbody>${sorted.slice(0, 150).map(r => {
                const txt = (r.t.serviceDetails || '').trim();
                return `<tr>
                <td style="white-space:nowrap;">${_escHtml(r.t.mesFacturacion || r.t.period || '—')}</td>
                <td><strong>${_escHtml(cleanClientName(r.t.client))}</strong></td>
                <td>${_escHtml(r.t.serviceType || '—')}</td>
                <td>${_escHtml(_effAnalystsOf(r.t).join(', ') || '—')}</td>
                <td style="font-size:0.72rem;color:#64748b;max-width:380px;" title="${_escHtml(txt)}">${txt
                    ? _escHtml(txt.replace(/\s+/g, ' ').slice(0, 160)) + (txt.length > 160 ? '…' : '')
                    : '<span style="color:#f59e0b;font-weight:700;">Sin texto en el ojito</span>'}</td>
            </tr>`; }).join('')}</tbody>
        </table>
        ${sorted.length > 150 ? `<div style="padding:0.75rem 1rem;font-size:0.74rem;color:#94a3b8;">Mostrando 150 de ${sorted.length}.</div>` : ''}`;
}

// ══════════════════════════════════════════
// MÓDULO DE REPORTES HISTÓRICOS
// ══════════════════════════════════════════

let reportFilters    = { analyst: '', client: '', serviceType: '', dateFrom: '', dateTo: '', csatStatus: '' };
let reportActiveTab  = 'gestiones'; // 'gestiones' | 'csat'
let reportTimeScope  = 'year';      // 'year' | 'all' | 'months'

let reportsDefaultApplied = false;

function setReportTimeScope(scope) {
    reportTimeScope = scope;
    ['month','year','all','months'].forEach(s => {
        document.getElementById(`rpt-scope-${s}`)?.classList.toggle('active', s === scope);
    });
    const rangeEl = document.getElementById('rpt-month-range');
    if(rangeEl) rangeEl.style.display = scope === 'months' ? 'flex' : 'none';

    if(scope === 'month') {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        reportFilters.dateFrom = ym;
        reportFilters.dateTo   = ym;
    } else if(scope === 'year') {
        const y = new Date().getFullYear();
        reportFilters.dateFrom = `${y}-01`;
        reportFilters.dateTo   = `${y}-12`;
    } else if(scope === 'all') {
        reportFilters.dateFrom = '';
        reportFilters.dateTo   = '';
    } else {
        reportFilters.dateFrom = document.getElementById('report-filter-from')?.value || '';
        reportFilters.dateTo   = document.getElementById('report-filter-to')?.value || '';
    }
    if(reportActiveTab === 'csat') renderCsatTable();
    else renderReportsTable();
}

function initReportsView() {
    if(!reportsDefaultApplied) {
        reportsDefaultApplied = true;
        // El scope 'year' se aplica abajo vía setReportTimeScope
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
    // Restaurar estado del tab activo y aplicar scope actual
    switchReportTab(reportActiveTab);
    setReportTimeScope(reportTimeScope);
}

function applyReportFilters() {
    reportFilters.analyst     = document.getElementById('report-filter-analyst').value;
    reportFilters.client      = document.getElementById('report-filter-client').value;
    reportFilters.serviceType = document.getElementById('report-filter-service')?.value || '';
    reportFilters.csatStatus  = document.getElementById('report-filter-csat-status')?.value || '';
    // Fechas solo se leen del input cuando el usuario está en modo Meses
    if(reportTimeScope === 'months') {
        reportFilters.dateFrom = document.getElementById('report-filter-from')?.value || '';
        reportFilters.dateTo   = document.getElementById('report-filter-to')?.value || '';
    }
    if(reportActiveTab === 'csat') renderCsatTable();
    else renderReportsTable();
}

function clearReportFilters() {
    reportFilters = { analyst:'', client:'', serviceType:'', dateFrom:'', dateTo:'', csatStatus:'' };
    ['report-filter-analyst','report-filter-client','report-filter-service',
     'report-filter-csat-status'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '';
    });
    // Volver al scope por defecto
    setReportTimeScope('year');
}

function switchReportTab(tab) {
    reportActiveTab = tab;
    ['gestiones','csat','ausencias'].forEach(t =>
        document.getElementById(`tab-btn-${t}`)?.classList.toggle('active', t === tab)
    );

    // Mostrar barra de filtros correcta
    const commonBar  = document.getElementById('reports-common-filters');
    const ausBar     = document.getElementById('reports-ausencias-filters');
    const exportBtns = document.getElementById('reports-export-btns');
    if(tab === 'ausencias') {
        if(commonBar)  commonBar.style.display  = 'none';
        if(ausBar)     ausBar.style.display     = '';
        if(exportBtns) exportBtns.style.display = 'none';
        // Inicializar scope por defecto si no se ha hecho
        setAusenciasScope(_ausFilters.scope || 'year');
    } else {
        if(commonBar)  commonBar.style.display  = '';
        if(ausBar)     ausBar.style.display     = 'none';
        if(exportBtns) exportBtns.style.display = '';
    }

    document.getElementById('filter-service-wrap')?.style.setProperty('display',     tab === 'gestiones' ? '' : 'none');
    document.getElementById('filter-csat-status-wrap')?.style.setProperty('display', tab === 'csat'      ? '' : 'none');

    const title = document.getElementById('reports-view-title');
    const sub   = document.getElementById('reports-view-subtitle');
    const msgs = {
        gestiones: ['Reportes Históricos',  'Busca, filtra y exporta gestiones de cualquier período.'],
        csat:      ['Cierres CSAT',          'Resultados de encuestas de satisfacción y evidencias de no-respuesta.'],
        ausencias: ['Ausencias del Equipo',  'Registro histórico de vacaciones, incapacidades y ausencias por analista.'],
    };
    if(title) title.textContent = msgs[tab][0];
    if(sub)   sub.textContent   = msgs[tab][1];

    if(tab === 'csat')      renderCsatTable();
    else if(tab === 'ausencias') renderAusenciasTable();
    else renderReportsTable();
}

// ── Tabla de ausencias ────────────────────────────────────────────────────────
const _absenceTypeIcon = { Vacaciones:'🌴', Incapacidad:'💊', Compensatorio:'🔄', 'Entrenamiento o Curso':'🎓' };
const _shortMonths = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// "2026-02-13" → chip estilizado "Feb 13/26"
function _fmtDate(iso) {
    if(!iso || iso === '—') return '—';
    const [y, m, d] = iso.split('-');
    const label = `${_shortMonths[parseInt(m,10)-1]} ${parseInt(d,10)}`;
    return `<span style="display:inline-flex;align-items:center;gap:3px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;padding:1px 7px;font-size:0.75rem;font-weight:700;white-space:nowrap;">${label}</span>`;
}

let _ausFilters = { analyst: '', type: '', dateFrom: '', dateTo: '', scope: 'year' };

function _ausFilteredTasks() {
    const f = _ausFilters;
    return tasks.filter(t => {
        if(!t.isAbsence) return false;
        const analyst = t.analysts_assignment?.[0]?.name || t.analyst || '';
        if(f.analyst && analyst !== f.analyst) return false;
        if(f.type && t.serviceType !== f.type) return false;
        const period = t.mesFacturacion || t.period || '';
        if(f.dateFrom && period < f.dateFrom) return false;
        if(f.dateTo   && period > f.dateTo)   return false;
        return true;
    });
}

function applyAusenciasFilters() {
    _ausFilters.analyst  = document.getElementById('ausencias-filter-analyst')?.value || '';
    _ausFilters.type     = document.getElementById('ausencias-filter-type')?.value    || '';
    if(_ausFilters.scope === 'months') {
        _ausFilters.dateFrom = document.getElementById('ausencias-filter-from')?.value || '';
        _ausFilters.dateTo   = document.getElementById('ausencias-filter-to')?.value   || '';
    }
    renderAusenciasTable();
}

function setAusenciasScope(scope) {
    _ausFilters.scope = scope;
    ['month','year','all','months'].forEach(s =>
        document.getElementById(`aus-scope-${s}`)?.classList.toggle('active', s === scope)
    );
    const rangeEl = document.getElementById('aus-month-range');
    if(rangeEl) rangeEl.style.display = scope === 'months' ? 'flex' : 'none';
    if(scope === 'month') {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        _ausFilters.dateFrom = ym;
        _ausFilters.dateTo   = ym;
    } else if(scope === 'year') {
        const y = new Date().getFullYear();
        _ausFilters.dateFrom = `${y}-01`;
        _ausFilters.dateTo   = `${y}-12`;
    } else if(scope === 'all') {
        _ausFilters.dateFrom = '';
        _ausFilters.dateTo   = '';
    } else {
        _ausFilters.dateFrom = document.getElementById('ausencias-filter-from')?.value || '';
        _ausFilters.dateTo   = document.getElementById('ausencias-filter-to')?.value   || '';
    }
    renderAusenciasTable();
}

function clearAusenciasFilters() {
    _ausFilters = { analyst: '', type: '', dateFrom: '', dateTo: '', scope: 'year' };
    const selA = document.getElementById('ausencias-filter-analyst');
    const selT = document.getElementById('ausencias-filter-type');
    if(selA) selA.value = '';
    if(selT) selT.value = '';
    setAusenciasScope('year');
}

function _populateAusenciasAnalystSelect() {
    const sel = document.getElementById('ausencias-filter-analyst');
    if(!sel || sel.options.length > 1) return; // ya poblado
    const names = [...new Set(tasks.filter(t => t.isAbsence)
        .map(t => t.analysts_assignment?.[0]?.name || t.analyst).filter(Boolean))].sort();
    names.forEach(n => {
        const o = document.createElement('option');
        o.value = n; o.textContent = n;
        sel.appendChild(o);
    });
}

function renderAusenciasTable() {
    const el = document.getElementById('reports-table-container');
    if(!el) return;
    _populateAusenciasAnalystSelect();

    const data = _ausFilteredTasks();
    const rows = [];
    data.forEach(t => {
        const scheduledDays = (t.scheduledDays || []).filter(d => d.type === 'field' || !d.type);
        const analyst = t.analysts_assignment?.[0]?.name || t.analyst || '—';
        const type    = t.serviceType || '—';
        const period  = t.period || t.mesFacturacion || '—';
        const year    = period.split('-')[0] || '—';
        if(scheduledDays.length > 0) {
            const sorted = [...scheduledDays].sort((a, b) => (a.date||'').localeCompare(b.date||''));
            rows.push({ analyst, type, days: scheduledDays.length, desde: sorted[0]?.date || '—', hasta: sorted[sorted.length-1]?.date || '—', year, habil: true, notes: t.absenceNotes || '' });
        } else {
            // Tarea en backlog: usar daysField como referencia
            const dField = t.daysField || 0;
            if(dField > 0) {
                rows.push({ analyst, type, days: dField, desde: '—', hasta: '—', year, habil: false, notes: t.absenceNotes || '' });
            }
        }
    });

    rows.sort((a, b) => a.desde.localeCompare(b.desde));

    if(rows.length === 0) {
        el.innerHTML = `<div style="text-align:center;padding:3rem;color:#94a3b8;">No hay ausencias registradas para los filtros seleccionados.</div>`;
        return;
    }

    const totalDays = rows.reduce((s, r) => s + r.days, 0);

    el.innerHTML = `
        <div style="display:flex;justify-content:flex-end;padding:1rem 1rem 0;">
            <button onclick="exportAusenciasCSV()" style="display:flex;align-items:center;gap:0.4rem;padding:0.4rem 0.9rem;background:#16a34a;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:0.8rem;cursor:pointer;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Exportar CSV
            </button>
        </div>
        <table class="data-table" style="font-size:0.8rem; width:100%;">
            <thead>
                <tr>
                    <th style="min-width:140px;">Analista</th>
                    <th style="min-width:150px;">Tipo</th>
                    <th style="min-width:110px;" title="Días hábiles (programadas en calendario) o días ingresados (sin programar)">Días hábiles</th>
                    <th style="min-width:80px;">Desde</th>
                    <th style="min-width:80px;">Hasta</th>
                    <th style="min-width:70px;">Año</th>
                    <th style="min-width:220px;">Observaciones</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => `<tr>
                    <td><strong>${r.analyst}</strong></td>
                    <td>${_absenceTypeIcon[r.type] || '•'} ${r.type}</td>
                    <td style="text-align:center;font-weight:700;">${r.days}${!r.habil ? `<span title="Aún sin programar en calendario — días ingresados, no verificados como hábiles" style="margin-left:4px;font-size:0.7rem;color:#f59e0b;cursor:help;">⚠</span>` : ''}</td>
                    <td style="font-variant-numeric:tabular-nums;white-space:nowrap;">${_fmtDate(r.desde)}</td>
                    <td style="font-variant-numeric:tabular-nums;white-space:nowrap;">${_fmtDate(r.hasta)}</td>
                    <td>${r.year !== '—' ? `<span style="display:inline-flex;align-items:center;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;padding:1px 7px;font-size:0.75rem;font-weight:700;">${r.year}</span>` : '—'}</td>
                    <td style="font-size:0.82rem;color:#475569;max-width:220px;">${r.notes ? `<span title="${r.notes.replace(/"/g,'&quot;')}">${r.notes.length > 60 ? r.notes.slice(0,57)+'…' : r.notes}</span>` : '<span style="color:#cbd5e1;">—</span>'}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
                <tr style="background:#f0f9ff; font-weight:800; border-top:2px solid var(--clr-blue);">
                    <td colspan="2" style="padding:0.75rem; font-size:0.85rem; color:var(--clr-blue)">TOTAL (${rows.length} registros)</td>
                    <td style="text-align:center; color:var(--clr-blue); font-size:1rem; padding:0.75rem;">${totalDays}d</td>
                    <td colspan="4"></td>
                </tr>
            </tfoot>
        </table>`;
}

function exportAusenciasCSV() {
    const headers = ['Analista','Tipo','Días','Desde','Hasta','Año','Observaciones'];
    const rows = _ausFilteredTasks().flatMap(t => {
        const sDays   = (t.scheduledDays||[]).filter(d => d.type === 'field' || !d.type);
        const analyst = t.analysts_assignment?.[0]?.name || t.analyst || '';
        const notes   = t.absenceNotes || '';
        const year    = (t.period || t.mesFacturacion || '').split('-')[0] || '';
        if(sDays.length > 0) {
            const sorted = [...sDays].sort((a,b) => (a.date||'').localeCompare(b.date||''));
            return [[analyst, t.serviceType, sDays.length, sorted[0]?.date||'', sorted[sorted.length-1]?.date||'', year, notes]];
        } else if(t.daysField > 0) {
            return [[analyst, t.serviceType, t.daysField, '—', '—', year, notes]];
        }
        return [];
    });
    const totalDays = rows.reduce((s, r) => s + (parseInt(r[2]) || 0), 0);
    rows.push(['TOTAL', '', totalDays, '', '', '', '']);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'}));
    a.download = `ausencias_cbm_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
}

// ── Modal de ausencia para asistente ─────────────────────────────────────────
function openNewAbsenceModal() {
    openNewTaskModal();
    // Restringir selector de tipo de servicio solo a tipos de ausencia
    const sel = document.getElementById('taskServiceType');
    if(!sel) return;
    sel.innerHTML = _absenceServiceTypeOptionsHTML;
    document.getElementById('taskModalTitle').textContent = 'Registrar Ausencia';
    _absenceModalActive = true;
    onTaskServiceTypeChange();
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
    if(t.serviceType === 'Calibración') return { label: '— No aplica', color: '#94a3b8', bg: '#f8fafc' };
    // Fallback para gestiones antiguas ejecutadas antes de registrar executedAt:
    // usan el último día de informe programado como referencia, igual que antes.
    const startRef = t.executedAt
        || (t.scheduledDays||[]).filter(d=>d.type==='report').map(d=>d.date).sort().pop();

    if(t.csatScore && !t.clientNoResponse) {
        const closedSuffix = (startRef && t.csatClosedAt)
            ? ` (${Math.max(0, Math.floor((new Date(t.csatClosedAt) - new Date(startRef)) / 86400000))}d)` : '';
        return { label: `⭐ ${t.csatScore}/5${closedSuffix}`, color: '#16a34a', bg: '#f0fdf4' };
    }
    if(t.clientNoResponse) {
        const closedSuffix = (startRef && t.csatClosedAt)
            ? ` (${Math.max(0, Math.floor((new Date(t.csatClosedAt) - new Date(startRef)) / 86400000))}d)` : '';
        return { label: `⚠️ Sin respuesta${closedSuffix}`, color: '#b45309', bg: '#fffbeb' };
    }
    // Días pendientes: desde que el analista marcó la gestión como ejecutada.
    if(startRef) {
        const diff = Math.floor((Date.now() - new Date(startRef).getTime()) / 86400000);
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
        margin: { left:mX, right:mX, bottom:25, top:35 },
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
        margin: { left: mX, right: mX, bottom: 26, top: 35 },
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
let dbInventoryKits = []; // kits (maletas/equipos compuestos) con checklist propio
let dbInventoryConsumables = []; // consumibles con stock (masas de balanceo, Loctite, shims...)
let _inventoryTab    = 'catalogo'; // 'catalogo' | 'encampo' | 'historial' | 'kits' | 'consumibles'
let _invScanAction          = null; // { type: 'checkout'|'checkin', itemId, loanId }
let _kitChecklistSubmitting = false; // guard contra doble envío del checklist
let _invHtml5Scanner = null;
let _invPendingPhotoBlob = null; // foto ya comprimida, pendiente de subir al guardar

// ── Compresión de fotos (<150KB) antes de subir a Supabase Storage ────────────────
function _invLoadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
    });
}

function _invCanvasToBlob(canvas, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Reduce dimensión y calidad JPEG hasta que el peso quede bajo maxKB. Prioriza mantener
 *  buena calidad visual, y solo baja resolución si con calidad mínima no alcanza. */
async function compressImageUnder150KB(file, maxKB = 150) {
    const img = await _invLoadImageFromFile(file);
    const maxBytes = maxKB * 1024;
    const dimCandidates = [800, 600, 450, 320];

    for (const maxDim of dimCandidates) {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        for (let q = 0.85; q >= 0.3; q -= 0.15) {
            const blob = await _invCanvasToBlob(canvas, q);
            if (blob && blob.size <= maxBytes) return blob;
        }
    }
    // Último recurso: la combinación más pequeña que generamos, aunque exceda el límite.
    const scale = Math.min(1, 320 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await _invCanvasToBlob(canvas, 0.3);
}

async function onInvItemPhotoSelected(event) {
    const file = event.target.files[0];
    if(!file) return;
    if(!file.type.startsWith('image/')) { showToast('Selecciona un archivo de imagen', 'error'); return; }

    const statusEl = document.getElementById('invItem_photoStatus');
    statusEl.textContent = 'Comprimiendo…';
    try {
        const blob = await compressImageUnder150KB(file, 150);
        _invPendingPhotoBlob = blob;
        const preview = document.getElementById('invItem_photoPreview');
        preview.src = URL.createObjectURL(blob);
        preview.style.display = 'block';
        const kb = (blob.size / 1024).toFixed(0);
        statusEl.textContent = blob.size <= 150 * 1024
            ? `Lista para subir (${kb} KB)`
            : `⚠️ No se pudo bajar de 150KB (quedó en ${kb} KB), se subirá igual.`;
    } catch(e) {
        statusEl.textContent = 'Error procesando la imagen.';
        console.error('Error comprimiendo foto:', e);
    }
}

async function _uploadInvItemPhoto(itemId) {
    if(!_invPendingPhotoBlob) return null;
    const path = `${itemId}_${Date.now()}.jpg`;
    const { error } = await supabaseClient.storage
        .from('inventory-photos')
        .upload(path, _invPendingPhotoBlob, { contentType: 'image/jpeg', upsert: true });
    if(error) { showToast('Error subiendo foto: ' + error.message, 'error'); return null; }
    const { data } = supabaseClient.storage.from('inventory-photos').getPublicUrl(path);
    return data.publicUrl;
}

const _invCategories = ['Vibraciones', 'Termografía', 'Ultrasonido', 'Balanceo', 'Alineación', 'Rotodinámico', 'Capacitación', 'Calibración', 'General'];
const _invCatLabel = {
    Vibraciones: '〰️ Vibraciones', Termografía: '🌡️ Termografía', Ultrasonido: '🔊 Ultrasonido',
    Balanceo: '⚖️ Balanceo', Alineación: '📐 Alineación', Rotodinámico: '⚙️ Rotodinámico',
    Capacitación: '📚 Capacitación', Calibración: '🔬 Calibración', General: '🔧 General'
};
const _invStatusLabel = { disponible:'Disponible', prestado:'En Campo', dañado:'Dañado', perdido:'Perdido' };
const _invStatusColor = { disponible:'#16a34a', prestado:'#d97706', dañado:'#dc2626', perdido:'#7f1d1d' };
const _invStatusBg    = { disponible:'#f0fdf4', prestado:'#fffbeb', dañado:'#fef2f2', perdido:'#fef2f2' };

async function loadInventoryData() {
    if(!supabaseClient) return;
    const [{ data: items }, { data: loans }, { data: incidents }, { data: kits }, { data: consumables }] = await Promise.all([
        supabaseClient.from('inventory_items').select('*').order('category').order('name'),
        supabaseClient.from('inventory_loans').select('*').is('checked_in_at', null).order('checked_out_at', { ascending: false }),
        supabaseClient.from('inventory_incidents').select('*').is('resolved_at', null).order('created_at', { ascending: false }),
        supabaseClient.from('inventory_kits').select('*').order('name'),
        supabaseClient.from('inventory_consumables').select('*').order('category').order('name')
    ]);
    if(consumables) dbInventoryConsumables = consumables;
    if(items) dbInventoryItems = items;
    if(loans) dbInventoryLoans = loans;
    if(incidents) dbInventoryIncidents = incidents;
    if(kits) dbInventoryKits = kits;
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

    if(role !== 'admin' && role !== 'viewer') {
        container.innerHTML = '<div style="text-align:center;padding:3rem;color:#94a3b8;">No tienes permiso para ver esta sección.</div>';
        return;
    }

    const consLow = dbInventoryConsumables.filter(c => _consumableStatus(c).low).length;
    const tabs = [
        { id:'catalogo',    label:'📦 Catálogo' },
        { id:'kits',        label:'🧰 Kits' },
        { id:'consumibles', label:`🧪 Consumibles${consLow ? ` <span style="background:#dc2626;color:#fff;border-radius:99px;padding:0 6px;font-size:0.7rem;margin-left:4px;">${consLow}</span>` : ''}` },
        { id:'encampo',     label:'🚚 En Campo' },
        { id:'historial',   label:'📋 Historial' }
    ];

    container.innerHTML = `
        <div class="kanban-header" style="margin-bottom:1.5rem;">
            <div>
                <h2>Control de Inventario CBM</h2>
                <p class="subtitle">Gestiona los equipos y herramientas del departamento.</p>
            </div>
            <button class="btn-primary viewer-hide" onclick="openInventoryScannerModal()" style="display:flex;align-items:center;gap:0.5rem;">
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
    else if(_inventoryTab === 'kits')      renderInventoryKits();
    else if(_inventoryTab === 'consumibles') renderInventoryConsumables();
    else if(_inventoryTab === 'encampo')   renderInventoryEnCampo();
    else if(_inventoryTab === 'historial') renderInventoryHistorial();
}

let _analystInvTab = 'mis';

function switchAnalystInvTab(tab) {
    _analystInvTab = tab;
    renderInventoryView();
}

function renderAnalystInventory(container) {
    if(_analystInvTab === 'catalogo') {
        container.innerHTML = `
            <div class="kanban-header" style="margin-bottom:1.5rem;">
                <div>
                    <h2>Inventario CBM</h2>
                    <p class="subtitle">Listado de equipos y herramientas del departamento (solo consulta).</p>
                </div>
                <button class="btn-primary" onclick="openInventoryScannerModal()" style="display:flex;align-items:center;gap:0.5rem;">Escanear QR</button>
            </div>
            <div class="view-toggle-group" style="margin-bottom:1.5rem;">
                <button onclick="switchAnalystInvTab('mis')">🚚 Mis equipos</button>
                <button class="active" onclick="switchAnalystInvTab('catalogo')">📦 Listado</button>
            </div>
            <div id="inv-tab-content"></div>`;
        renderInventoryCatalog();
        return;
    }
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
        <div class="view-toggle-group" style="margin-bottom:1.5rem;">
            <button class="active" onclick="switchAnalystInvTab('mis')">🚚 Mis equipos</button>
            <button onclick="switchAnalystInvTab('catalogo')">📦 Listado</button>
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
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);padding:1.5rem;margin-top:1.25rem;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap;">
                <h4 style="margin:0;color:#0f766e;">🧪 Consumibles</h4>
                <button class="btn-primary" onclick="openConsumableMovementModal('consumo')" style="font-size:0.8rem;padding:0.4rem 0.9rem;">− Registrar consumo</button>
            </div>
            ${_consumablesListHTML(false)}
        </div>
    `;
}

let _invCatalogCollapsed = new Set(); // categorías colapsadas en el Catálogo (vacío = todas expandidas)
let _invCatalogKitsCollapsed = new Set(); // kits colapsados dentro del Catálogo

function toggleInvCatalogGroup(cat) {
    if(_invCatalogCollapsed.has(cat)) _invCatalogCollapsed.delete(cat);
    else _invCatalogCollapsed.add(cat);
    renderInventoryCatalog();
}

function toggleInvCatalogKit(kitId) {
    if(_invCatalogKitsCollapsed.has(kitId)) _invCatalogKitsCollapsed.delete(kitId);
    else _invCatalogKitsCollapsed.add(kitId);
    renderInventoryCatalog();
}

function renderInventoryCatalog() {
    const el = document.getElementById('inv-tab-content');
    if(!el) return;

    const categories = _invCategories;
    const readOnly = currentUserProfile?.role === 'analyst';   // el analista consulta el listado, no lo edita

    const _norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = _norm(_invSearch).trim();
    const matches = item => {
        if(!q) return true;
        const kit = dbInventoryKits.find(k => k.id === item.kit_id);
        const loan = dbInventoryLoans.find(l => l.item_id === item.id);
        const hay = _norm([item.name, item.serial_number, item.description, kit?.name, item.assigned_analyst, loan?.analyst_name,
            _invStatusLabel[item.status], _invCatLabel[item.category], item.category].join(' '));
        return q.split(/\s+/).every(w => hay.includes(w));
    };
    const visibleItems = dbInventoryItems.filter(matches);

    const theadHtml = `
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
        </thead>`;

    const renderItemRow = (item, insideKit = false) => {
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
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    ${item.photo_url
                        ? `<img src="${item.photo_url}" onclick="showInventoryPhoto('${item.id}')" title="Ver foto en grande" style="width:32px;height:32px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;flex-shrink:0;cursor:pointer;">`
                        : `<div style="width:32px;height:32px;border-radius:6px;background:#f1f5f9;flex-shrink:0;"></div>`}
                    <div>
                        <strong>${item.name}</strong>
                        ${item.equipment_id ? '<span title="Vinculado a un equipo de gestiones" style="font-size:0.68rem;background:#eef2ff;color:#4f46e5;border:1px solid #4f46e533;padding:1px 6px;border-radius:99px;margin-left:6px;">🔗 Equipo</span>' : ''}
                        ${(!insideKit && item.kit_id) ? `<span title="Pertenece a un kit" style="font-size:0.68rem;background:#f5f3ff;color:#7c3aed;border:1px solid #7c3aed33;padding:1px 6px;border-radius:99px;margin-left:6px;">🧰 ${(dbInventoryKits.find(k=>k.id===item.kit_id)?.name)||'Kit'}</span>` : ''}
                        ${item.description ? `<div style="font-size:0.72rem;color:#94a3b8;">${item.description}</div>` : ''}
                        ${isTrouble && openIncident ? `<div style="font-size:0.72rem;color:#dc2626;margin-top:2px;">⚠️ ${openIncident.note} <span style="color:#94a3b8;">— ${openIncident.reported_by}</span></div>` : ''}
                    </div>
                </div>
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
                ${readOnly ? '' : `<span class="viewer-hide">
                    <button onclick="openEditInventoryItemModal('${item.id}')" title="Editar" style="background:none;border:none;cursor:pointer;color:#3b82f6;font-size:1rem;">✏️</button>
                    <button onclick="deleteInventoryItem('${item.id}')" title="Eliminar" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:1rem;">🗑️</button>
                    ${item.requires_calibration ? `<button onclick="registerCalibrationToday('${item.id}')" title="Registrar calibración hoy" style="background:none;border:none;cursor:pointer;font-size:1rem;">📅</button>` : ''}
                    ${isTrouble
                        ? `<button onclick="openResolveIncidentModal('${item.id}')" title="Marcar como disponible" style="background:none;border:none;cursor:pointer;color:#16a34a;font-size:1rem;">✅</button>`
                        : `<button onclick="openReportIncidentModal('${item.id}')" title="Reportar daño/pérdida" style="background:none;border:none;cursor:pointer;color:#d97706;font-size:1rem;">⚠️</button>`}
                </span>`}
            </td>
        </tr>`;
    };

    const renderItemsTable = (items, insideKit = false) => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);overflow:hidden;">
            <table class="data-table" style="font-size:0.82rem;">
                ${theadHtml}
                <tbody>${items.map(i => renderItemRow(i, insideKit)).join('')}</tbody>
            </table>
        </div>`;

    el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap;">
            <input type="search" id="invSearchInput" value="${_escHtml(_invSearch)}" oninput="invSearch(this.value)" placeholder="🔍 Buscar por nombre, serial, kit, analista, estado…" autocomplete="off"
                style="flex:1;min-width:220px;max-width:420px;padding:0.5rem 0.85rem;border:1px solid #cbd5e1;border-radius:8px;font-size:0.85rem;">
            <div style="display:flex;gap:0.75rem;">
            <button onclick="printAllInventoryQRs()" title="Imprimir todos los QR" ${dbInventoryItems.length===0?'disabled':''} style="background:none;border:1px solid #cbd5e1;border-radius:6px;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;color:#64748b;cursor:pointer;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            </button>
            ${readOnly ? '' : '<button class="btn-primary viewer-hide" onclick="openAddInventoryItemModal()">+ Agregar ítem</button>'}
            </div>
        </div>
        ${q ? `<div style="font-size:0.78rem;color:#64748b;margin-bottom:0.75rem;">${visibleItems.length} resultado${visibleItems.length !== 1 ? 's' : ''} de ${dbInventoryItems.length}</div>` : ''}
        ${categories.map(cat => {
            const items = visibleItems.filter(i => i.category === cat);
            if(items.length === 0) return '';
            const collapsed = !q && _invCatalogCollapsed.has(cat);

            const standaloneItems = items.filter(i => !i.kit_id);
            const kitGroups = [...new Set(items.filter(i => i.kit_id).map(i => i.kit_id))]
                .reduce((acc, kitId) => {
                    const kit = dbInventoryKits.find(k => k.id === kitId);
                    if(kit) acc.push({ kit, items: items.filter(i => i.kit_id === kitId) });
                    return acc;
                }, []);

            return `
            <div style="margin-bottom:1.5rem;">
                <h4 onclick="toggleInvCatalogGroup('${cat}')" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;font-size:0.8rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">
                    <span style="display:inline-block;transition:transform .15s;transform:rotate(${collapsed?'-90':'0'}deg);">▾</span>
                    ${_invCatLabel[cat]}
                    <span style="font-weight:600;text-transform:none;letter-spacing:0;color:#94a3b8;">(${items.length})</span>
                </h4>
                <div style="${collapsed?'display:none;':''}">
                    ${standaloneItems.length > 0 ? renderItemsTable(standaloneItems) : ''}
                    ${kitGroups.map(({ kit, items: kitItems }) => {
                        const kitCollapsed = !q && _invCatalogKitsCollapsed.has(kit.id);
                        return `
                        <div style="margin-top:0.5rem;">
                            <div onclick="toggleInvCatalogKit('${kit.id}')" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;padding:6px 12px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;margin-bottom:${kitCollapsed?'0':'4px'};">
                                <span style="display:inline-block;transition:transform .15s;transform:rotate(${kitCollapsed?'-90':'0'}deg);color:#7c3aed;">▾</span>
                                <span style="font-size:0.8rem;font-weight:700;color:#7c3aed;">🧰 ${kit.name}</span>
                                <span style="font-size:0.75rem;color:#a78bfa;font-weight:500;">(${kitItems.length} ítem${kitItems.length !== 1 ? 's' : ''})</span>
                            </div>
                            ${kitCollapsed ? '' : `<div style="padding-left:1rem;">${renderItemsTable(kitItems, true)}</div>`}
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('')}
        ${dbInventoryItems.length === 0 ? '<div style="text-align:center;padding:3rem;color:#94a3b8;">No hay ítems en el inventario todavía. Agrega el primero.</div>' : ''}
        ${dbInventoryItems.length > 0 && visibleItems.length === 0 ? '<div style="text-align:center;padding:3rem;color:#94a3b8;">Ningún ítem coincide con la búsqueda.</div>' : ''}
    `;
}

let _invSearch = '';

/** Filtra el catálogo mientras se escribe, sin perder el foco del buscador. */
function invSearch(value) {
    _invSearch = value;
    renderInventoryCatalog();
    const input = document.getElementById('invSearchInput');
    if(input) { input.focus(); input.setSelectionRange(value.length, value.length); }
}

function renderInventoryKits() {
    const el = document.getElementById('inv-tab-content');
    if(!el) return;

    el.innerHTML = `
        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-bottom:1rem;">
            <button onclick="printAllKitQRs()" title="Imprimir todos los QR de kits" ${dbInventoryKits.length===0?'disabled':''} style="background:none;border:1px solid #cbd5e1;border-radius:6px;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;color:#64748b;cursor:pointer;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            </button>
            <button class="btn-primary viewer-hide" onclick="openAddInventoryKitModal()">+ Agregar kit</button>
        </div>
        ${dbInventoryKits.length === 0 ? '<div style="text-align:center;padding:3rem;color:#94a3b8;">No hay kits creados todavía. Un kit agrupa ítems que ya existen en el catálogo bajo un solo QR (ej. una maleta de instrumentación).</div>' : `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);overflow:hidden;">
            <table class="data-table" style="font-size:0.82rem;">
                <thead>
                    <tr>
                        <th style="width:44px;">QR</th>
                        <th>Nombre</th>
                        <th>Categoría</th>
                        <th>Ítems</th>
                        <th style="width:100px;text-align:center;">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${dbInventoryKits.map(kit => {
                        const n = dbInventoryItems.filter(i => i.kit_id === kit.id).length;
                        return `
                        <tr>
                            <td style="text-align:center;">
                                <button onclick="showKitQR('${kit.id}')" title="Ver QR del kit" style="background:none;border:1px solid #cbd5e1;border-radius:4px;padding:3px 6px;cursor:pointer;font-size:0.9rem;">📷</button>
                            </td>
                            <td>
                                <strong onclick="showKitItems('${kit.id}')" style="cursor:pointer;color:var(--clr-blue);" title="Ver ítems de este kit">🧰 ${kit.name}</strong>
                                ${kit.description ? `<div style="font-size:0.72rem;color:#94a3b8;">${kit.description}</div>` : ''}
                            </td>
                            <td style="color:#64748b;">${_invCatLabel[kit.category]||kit.category}</td>
                            <td style="color:#64748b;">${n} ítem${n!==1?'s':''}</td>
                            <td style="text-align:center;white-space:nowrap;">
                                <span class="viewer-hide">
                                    <button onclick="openEditInventoryKitModal('${kit.id}')" title="Editar" style="background:none;border:none;cursor:pointer;color:#3b82f6;font-size:1rem;">✏️</button>
                                    <button onclick="deleteInventoryKit('${kit.id}')" title="Eliminar" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:1rem;">🗑️</button>
                                </span>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`}
    `;
}

function openAddInventoryKitModal() {
    document.getElementById('invKitModalTitle').textContent = 'Agregar Kit';
    document.getElementById('invKit_editId').value = '';
    document.getElementById('invKit_name').value = '';
    document.getElementById('invKit_category').value = 'Rotodinámico';
    document.getElementById('invKit_description').value = '';
    document.getElementById('inventoryKitModal').classList.add('active');
}

function openEditInventoryKitModal(kitId) {
    const kit = dbInventoryKits.find(k => k.id === kitId);
    if(!kit) return;
    document.getElementById('invKitModalTitle').textContent = 'Editar Kit';
    document.getElementById('invKit_editId').value = kitId;
    document.getElementById('invKit_name').value = kit.name || '';
    document.getElementById('invKit_category').value = kit.category || 'General';
    document.getElementById('invKit_description').value = kit.description || '';
    document.getElementById('inventoryKitModal').classList.add('active');
}

async function saveInventoryKit() {
    const name = document.getElementById('invKit_name').value.trim();
    if(!name) { showToast('El nombre del kit es obligatorio', 'error'); return; }

    const payload = {
        name,
        category: document.getElementById('invKit_category').value,
        description: document.getElementById('invKit_description').value.trim() || null
    };

    const editId = document.getElementById('invKit_editId').value;
    let error;
    if(editId) {
        ({ error } = await supabaseClient.from('inventory_kits').update(payload).eq('id', editId));
    } else {
        ({ error } = await supabaseClient.from('inventory_kits').insert(payload));
    }

    if(error) { showToast('Error guardando kit: ' + error.message, 'error'); return; }
    showToast(editId ? 'Kit actualizado' : 'Kit agregado', 'success');
    closeModal('inventoryKitModal');
    await loadInventoryData();
    renderInventoryView();
}

async function deleteInventoryKit(kitId) {
    const kit = dbInventoryKits.find(k => k.id === kitId);
    const n = dbInventoryItems.filter(i => i.kit_id === kitId).length;
    const warn = n > 0 ? `\n\nLos ${n} ítem(s) de este kit quedarán como independientes (sin kit asignado).` : '';
    if(!confirm(`¿Eliminar el kit "${kit?.name}"?${warn}`)) return;
    const { error } = await supabaseClient.from('inventory_kits').delete().eq('id', kitId);
    if(error) { showToast('Error eliminando kit: ' + error.message, 'error'); return; }
    showToast('Kit eliminado', 'success');
    await loadInventoryData();
    renderInventoryView();
}

function showKitItems(kitId) {
    const kit = dbInventoryKits.find(k => k.id === kitId);
    if(!kit) return;
    const items = dbInventoryItems.filter(i => i.kit_id === kitId);

    document.getElementById('invKitItems_title').textContent = `🧰 ${kit.name}`;
    document.getElementById('invKitItems_subtitle').textContent = `${items.length} ítem${items.length!==1?'s':''} en este kit`;

    const container = document.getElementById('invKitItems_list');
    container.innerHTML = items.length === 0
        ? '<div style="text-align:center;padding:1.5rem;color:#94a3b8;font-size:0.85rem;">Este kit todavía no tiene ítems asignados. Edítalos desde el Catálogo (campo "Pertenece a un kit").</div>'
        : items.map(item => {
            const sc = _invStatusColor[item.status] || '#64748b';
            const sb = _invStatusBg[item.status] || '#f8fafc';
            const activeLoan = dbInventoryLoans.find(l => l.item_id === item.id);
            return `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.55rem 0.65rem;border:1px solid #e2e8f0;border-radius:8px;">
                <div style="display:flex;align-items:center;gap:0.6rem;min-width:0;">
                    ${item.photo_url
                        ? `<img src="${item.photo_url}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;flex-shrink:0;">`
                        : `<div style="width:32px;height:32px;border-radius:6px;background:#f1f5f9;flex-shrink:0;"></div>`}
                    <div style="min-width:0;">
                        <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>
                        <div style="font-size:0.7rem;color:#94a3b8;">${item.serial_number || '—'}</div>
                    </div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <span style="background:${sb};color:${sc};border:1px solid ${sc}33;font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:99px;white-space:nowrap;">
                        ${_invStatusLabel[item.status]||item.status}
                    </span>
                    ${activeLoan ? `<div style="font-size:0.68rem;color:#d97706;margin-top:2px;">→ ${activeLoan.analyst_name}</div>` : ''}
                </div>
            </div>`;
        }).join('');

    document.getElementById('inventoryKitItemsModal').classList.add('active');
}

let _invEnCampoExpanded = new Set(); // kit_loan_id de kits desplegados en "En campo"

function toggleInvEnCampoKit(groupId) {
    if(_invEnCampoExpanded.has(groupId)) _invEnCampoExpanded.delete(groupId);
    else _invEnCampoExpanded.add(groupId);
    renderInventoryEnCampo();
}

function renderInventoryEnCampo() {
    const el = document.getElementById('inv-tab-content');
    if(!el) return;

    if(dbInventoryLoans.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:3rem;color:#94a3b8;">✅ Todo el inventario está en A-MAQ. No hay ítems en campo.</div>';
        return;
    }

    const daysOut = (iso) => Math.floor((Date.now() - new Date(iso)) / 86400000);
    const alertStyleFor = (days) => days >= 7 ? 'color:#dc2626;font-weight:700;' : days >= 3 ? 'color:#d97706;' : '';
    const sinceFmt = (iso) => new Date(iso).toLocaleDateString('es-CO', { day:'numeric', month:'short' });

    const itemRow = (loan, item, nested) => {
        const days = daysOut(loan.checked_out_at);
        return `
        <tr style="${nested ? 'background:#faf5ff;' : ''}">
            <td>${nested ? '' : `<strong>${loan.analyst_name}</strong>`}</td>
            <td${nested ? ' style="padding-left:2rem;"' : ''}>${nested ? '↳ ' : ''}${item.name}${item.serial_number ? ` <span style="color:#94a3b8;font-weight:400;">(${item.serial_number})</span>` : ''}<div style="font-size:0.72rem;color:#64748b;">${_invCatLabel[item.category]||item.category}</div></td>
            <td>${sinceFmt(loan.checked_out_at)}</td>
            <td style="${alertStyleFor(days)}">${days} día${days!==1?'s':''}</td>
            <td style="text-align:center;">
                <button class="btn-secondary viewer-hide" onclick="adminCheckIn('${loan.id}','${item.id}')" style="font-size:0.75rem;padding:4px 10px;">Registrar devolución</button>
            </td>
        </tr>`;
    };

    const kitGroups = new Map();
    const singles = [];
    dbInventoryLoans.forEach(loan => {
        // Préstamo registrado como kit, o ítem escaneado suelto que pertenece a un kit
        // (mismo analista + mismo kit → se muestran juntos).
        const itemKitId = dbInventoryItems.find(i => i.id === loan.item_id)?.kit_id;
        const groupKey = loan.kit_loan_id
            || (itemKitId ? `k_${itemKitId}_${String(loan.analyst_name || '').replace(/[^a-zA-Z0-9]/g, '')}` : null);
        if(groupKey) {
            if(!kitGroups.has(groupKey)) kitGroups.set(groupKey, []);
            kitGroups.get(groupKey).push(loan);
        } else singles.push(loan);
    });

    const kitRows = [...kitGroups.entries()].map(([groupId, loans]) => {
        const kitId = loans[0].kit_id || dbInventoryItems.find(i => i.id === loans[0].item_id)?.kit_id;
        const kit = dbInventoryKits.find(k => k.id === kitId);
        const out = loans.map(l => l.checked_out_at).sort()[0];
        const days = daysOut(out);
        const totalItems = dbInventoryItems.filter(i => i.kit_id === kitId).length;
        const countLabel = totalItems && totalItems !== loans.length ? `${loans.length} de ${totalItems} ítems` : `${loans.length} ítem${loans.length!==1?'s':''}`;
        const open = _invEnCampoExpanded.has(groupId);
        const detail = open ? loans.map(l => {
            const item = dbInventoryItems.find(i => i.id === l.item_id);
            return item ? itemRow(l, item, true) : '';
        }).join('') : '';
        return `
        <tr style="background:#f5f3ff;">
            <td><strong>${loans[0].analyst_name}</strong></td>
            <td><span style="font-weight:700;color:#7c3aed;">🧰 ${kit?.name || 'Kit'}</span> <span style="font-size:0.72rem;color:#64748b;">· ${countLabel}</span></td>
            <td>${sinceFmt(out)}</td>
            <td style="${alertStyleFor(days)}">${days} día${days!==1?'s':''}</td>
            <td style="text-align:center;">
                <button class="btn-secondary" onclick="toggleInvEnCampoKit('${groupId}')" style="font-size:0.75rem;padding:4px 10px;">${open ? '▲ Ocultar detalle' : '▼ Ver detalle'}</button>
            </td>
        </tr>${detail}`;
    }).join('');

    const singleRows = singles.map(loan => {
        const item = dbInventoryItems.find(i => i.id === loan.item_id);
        return item ? itemRow(loan, item, false) : '';
    }).join('');

    el.innerHTML = `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);overflow:hidden;">
            <table class="data-table" style="font-size:0.82rem;">
                <thead>
                    <tr>
                        <th>Analista</th>
                        <th>Ítem / Kit</th>
                        <th>Salida</th>
                        <th>Días fuera</th>
                        <th style="text-align:center;">Acción</th>
                    </tr>
                </thead>
                <tbody>${kitRows}${singleRows}</tbody>
            </table>
        </div>`;
}

// ══════════════════════════════════════════
// CHECKLIST DE SERVICIO — ROTODINÁMICO (puntos críticos + datos reales)
// Reemplaza el checklist en papel (Excel) por 18 puntos de control agrupados en
// 4 etapas, más bitácora de eventos con hora, gaps de sondas, foto del mapa de
// sensores, conteo de equipos y novedades. Se guarda en task_checklists.
// ══════════════════════════════════════════

const _CK_TEMPLATE_ID = 'rotodinamico_v1';

const _CK_STAGES = [
    {
        id: 'prep', label: '1. Preparación', icon: '🧰', a001: 'out',
        items: [
            { id: 'p2', text: 'Estado físico de los equipos revisado (C-DAQ, cables, drivers, sondas, acelerómetros, keyphasor) y daños del último reporte revisados o reparados.', hint: 'Si hay una anomalía, marca ✖, descríbela y separa el elemento.' },
            { id: 'p3', text: 'Base de datos de la central disponible en A-Cloud (si no existía, se pidieron los datos de la máquina al cliente y se creó).' },
            { id: 'p4', text: 'Prueba previa con clip metálico: señal reconocida en todos los canales de la C-DAQ y grabando a 1 dato/segundo en el histórico.' },
            { id: 'p5', text: 'Logística confirmada: fecha, hora y lugar con el cliente, permisos de ingreso y ATS aprobados, transporte y contacto en planta; informe de la medición anterior leído.' }
        ],
        guide: [
            'Asignación de canales: cojinete 1 en el primer módulo → canal 0 sonda X, canal 1 sonda Y, canal 2 acelerómetro; cojinete 2 en el segundo módulo igual, y así sucesivamente.',
            'Keyphasor: canal 0 del módulo posterior al último cojinete asignado.',
            'Pulsar "reconfigurar" y verificar la correcta disposición de las señales.',
            'Encender el sistema multicanal, abrir A-Cloud y encender el servicio de mongo.',
            'Soportes o imanes: en caso de duda, consultar a otro analista el tipo adecuado para cada planta.',
            'Al terminar las pruebas, empaca lo que sale según la lista A001 (arriba).'
        ]
    },
    {
        id: 'meas', label: '2. Medición', icon: '📡',
        items: [
            { id: 'm1', text: 'Permisos de trabajo y ATS diligenciados y aprobados por la planta; uniforme y EPP puestos.' },
            { id: 'm2', text: 'Sensores instalados (acelerómetro en cada cojinete, equidistante de X y Y; sondas X con cable impar y Y con cable par) y mapa de instalación registrado con foto.' },
            { id: 'm3', text: 'Sondas calibradas a ~10 V de separación y gaps registrados abajo.' },
            { id: 'm4', text: 'Keyphasor instalado: el LED enciende al paso de la cinta reflectiva y se captura la velocidad real.' },
            { id: 'm5', text: 'A-Cloud grabando a 1 dato/segundo, confirmado en la tendencia histórica.' },
            { id: 'm6', text: 'Informe verbal de hallazgos entregado al responsable de la máquina en planta.' }
        ],
        guide: [
            'Instalar el sistema multicanal en zona segura, estable y cercana a la turbina (mesa y silla).',
            'Cables grises: 1 y 2 (15 m) cojinete superior · 3 y 4 (20 m) cojinete inferior · 5 y 6 (30 m) cojinete de turbina.',
            'Verificar el LED central de la C-DAQ encendido y arrancar los servicios de mongo y asdaq en A-Cloud.',
            'Solicitar la parada y confirmar que la máquina quedó detenida y desenergizada antes de instalar sensores.',
            'Mapa de instalación: círculo con el ángulo de los sensores de proximidad y sísmicos, sentido de giro y desde qué punto de vista se observa la máquina.',
            'Si los gaps se alejan de ~10 V: inspeccionar conexiones y sustituir el componente con los repuestos.',
            'Secuencia operativa: arranque en vacío → excitación → sincronización a carga mínima → incremento progresivo hasta carga máxima → reducción y paro controlado. Registra la hora de cada evento en la bitácora.'
        ]
    },
    {
        id: 'exit', label: '3. Salida de planta', icon: '🚪', a001: 'plant',
        items: [
            { id: 's1', text: 'Datos guardados correctamente en A-Cloud antes de apagar el sistema.' },
            { id: 's2', text: 'Sistema apagado y sensores retirados (sondas despegadas con cuidado y superficie limpia; cables enrollados sin dobleces; tarjetas con tapas protectoras).' }
        ],
        guide: [
            'Desenergizar la extensión eléctrica desde su fuente y recogerla con cuidado.',
            'Guardar cada tipo de cable (grises, BNC, extensión) en su compartimiento; drivers, adaptadores y multicanal en sus espacios del maletín.',
            'Revisar visualmente la integridad de los drivers y adaptadores.',
            'Última mirada al área de trabajo para no dejar ningún elemento.'
        ]
    },
    {
        id: 'arrive', label: '4. Llegada a A-MAQ', icon: '🏢', a001: 'back',
        items: [
            { id: 'l1', text: 'Bases de las sondas limpias de Loctite y estado físico de los equipos revisado.' },
            { id: 'l2', text: 'Novedades, daños o pérdidas registrados abajo e informados en el grupo de WhatsApp (o sin novedades).' },
            { id: 'l3', text: 'Datos de la medición respaldados en los dos discos duros.' },
            { id: 'l4', text: 'Computador y maletín guardados en el espacio designado.' }
        ],
        guide: [
            'La fecha, planta, analistas y equipos de la medición ya quedan asociados a la gestión: no hay que volver a digitarlos.'
        ]
    }
];

const _CK_ITEM_TOTAL = _CK_STAGES.reduce((n, st) => n + st.items.length + (st.a001 ? 1 : 0), 0);
const _CK_EVENTS = ['Parada de máquina', 'Arranque en vacío', 'Excitación', 'Sincronización a carga mínima', 'Carga máxima', 'Reducción de carga / paro controlado'];

let dbTaskChecklists = {};   // task_id → fila de task_checklists
let _ck = null;              // checklist abierto: { taskId, data, arrived, left, stage, status }
let _ckSaveTimer = null;

function _ckRowOf(taskId) { return dbTaskChecklists[taskId] || null; }

/** Avance de un checklist: puntos respondidos, puntos con novedad (✖) y por etapa. */
function _ckProgress(data) {
    const items = data?.items || {};
    let answered = 0, fails = 0;
    const byStage = {};
    _CK_STAGES.forEach(st => {
        let a = 0;
        st.items.forEach(it => { if(items[it.id]?.s) { a++; if(items[it.id].s === 'fail') fails++; } });
        if(st.a001) {
            const ps = _a001PassStatus(data || {}, st.a001);
            if(ps.done) a++;
            if(ps.missing.length) fails++;
        }
        byStage[st.id] = { answered: a, total: st.items.length + (st.a001 ? 1 : 0) };
        answered += a;
    });
    return { answered, fails, total: _CK_ITEM_TOTAL, byStage };
}

// El checklist de servicio lo ve el admin y los analistas asignados a la gestión.
function _ckHasChecklist(task) {
    if(!task || task.serviceType !== 'Rotodinámico' || task.isAbsence || task.status === 'proyectada') return false;
    const role = currentUserProfile?.role;
    if(role === 'admin' || role === 'viewer') return true;
    if(role === 'analyst') {
        const me = currentUserProfile?.analyst_name;
        return !!me && ((task.analysts_assignment || []).some(a => a.name === me) || task.analyst === me);
    }
    return false;
}

async function loadTaskChecklists() {
    if(!supabaseClient) return;
    supabaseClient.from('checklist_a001_items').select('*').then(({ data: items }) => { if(items) dbA001Items = items; });
    const { data, error } = await supabaseClient.from('task_checklists').select('*');
    if(error || !data) return; // tabla aún sin migrar: el checklist simplemente no muestra avance
    dbTaskChecklists = {};
    data.forEach(r => { dbTaskChecklists[r.task_id] = r; });
}

function _ckDraftKey(taskId) { return `ck_draft_${taskId}`; }

function openTaskChecklist(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;
    const row = _ckRowOf(taskId);
    let state = {
        data: JSON.parse(JSON.stringify(row?.data || {})),
        arrived: row?.arrived_at || null,
        left: row?.left_at || null
    };
    // Borrador local (por si la última vez no hubo señal para guardar)
    try {
        const draft = JSON.parse(localStorage.getItem(_ckDraftKey(taskId)) || 'null');
        if(draft && (!row || new Date(draft.savedAt) > new Date(row.updated_at || 0))) {
            state = { data: draft.data || {}, arrived: draft.arrived || null, left: draft.left || null };
            showToast('Recuperé un borrador que no se había alcanzado a sincronizar.', 'success');
        }
    } catch(e) { /* sin acceso a localStorage */ }

    state.data.items = state.data.items || {};
    _ck = { taskId, ...state, stage: _CK_STAGES[0].id, status: '', readOnly: currentUserProfile?.role === 'viewer' };
    // Abre en la primera etapa con puntos pendientes
    const prog = _ckProgress(_ck.data);
    const firstOpen = _CK_STAGES.find(st => prog.byStage[st.id].answered < prog.byStage[st.id].total);
    if(firstOpen) _ck.stage = firstOpen.id;

    renderTaskChecklist();
    document.getElementById('taskChecklistModal').classList.add('active');
    if(!dbInventoryItems.length) loadInventoryData().then(() => { if(_ck) renderTaskChecklist(); }).catch(() => {});
    if(localStorage.getItem(_ckDraftKey(taskId))) _ckPersist();
}

function closeTaskChecklist() {
    clearTimeout(_ckSaveTimer);
    if(_ck && _ck.dirty && !_ck.readOnly) _ckPersist();
    closeModal('taskChecklistModal');
    // Refresca los avances visibles en Mi Trabajo / Gestiones
    if(document.getElementById('view-mywork')?.classList.contains('active-view')) renderMyWorkView();
    if(document.getElementById('view-tasks')?.classList.contains('active-view')) renderTasksView();
    _ck = null;
}

function _ckSchedule() {
    if(!_ck || _ck.readOnly) return;
    _ck.dirty = true;
    try {
        localStorage.setItem(_ckDraftKey(_ck.taskId), JSON.stringify({ data: _ck.data, arrived: _ck.arrived, left: _ck.left, savedAt: new Date().toISOString() }));
    } catch(e) { /* sin acceso a localStorage */ }
    _ck.status = 'Guardando…';
    _ckUpdateStatus();
    clearTimeout(_ckSaveTimer);
    _ckSaveTimer = setTimeout(_ckPersist, 700);
}

function _ckUpdateStatus() {
    const el = document.getElementById('ck_status');
    if(el && _ck) el.textContent = _ck.status || '';
}

async function _ckPersist() {
    if(!_ck || !supabaseClient) return;
    const taskId = _ck.taskId;
    const payload = {
        task_id: taskId,
        template: _CK_TEMPLATE_ID,
        data: _ck.data,
        arrived_at: _ck.arrived || null,
        left_at: _ck.left || null,
        updated_by: currentUserProfile?.analyst_name || currentUserProfile?.display_name || currentUser?.email || null,
        updated_at: new Date().toISOString()
    };
    // El avance se refleja de inmediato; si el guardado falla queda el borrador local para reintentar.
    dbTaskChecklists[taskId] = { ...(dbTaskChecklists[taskId] || {}), ...payload };
    const { error } = await supabaseClient.from('task_checklists').upsert(payload, { onConflict: 'task_id' });
    if(error) {
        const missing = /task_checklists|schema cache|does not exist/i.test(error.message || '');
        if(_ck && _ck.taskId === taskId) {
            _ck.status = missing ? '⚠ Falta ejecutar la migración del checklist en Supabase' : '⚠ Sin conexión: guardado en este dispositivo';
            _ckUpdateStatus();
        }
        return;
    }
    try { localStorage.removeItem(_ckDraftKey(taskId)); } catch(e) { /* nada */ }
    if(_ck && _ck.taskId === taskId) { _ck.dirty = false; _ck.status = '✓ Guardado'; _ckUpdateStatus(); }
}

function ckSetStage(stageId) { _ck.stage = stageId; renderTaskChecklist(); }

function ckSetItem(itemId, state) {
    const it = (_ck.data.items[itemId] = _ck.data.items[itemId] || {});
    it.s = (it.s === state) ? null : state;      // tocar de nuevo desmarca
    if(!it.s && !it.note) delete _ck.data.items[itemId];
    _ckSchedule();
    renderTaskChecklist();
}

function ckSetNote(itemId, value) {
    const it = (_ck.data.items[itemId] = _ck.data.items[itemId] || {});
    it.note = value;
    _ckSchedule();
}

function ckMarkTime(kind) {
    _ck[kind] = new Date().toISOString();
    _ckSchedule();
    renderTaskChecklist();
}

function ckClearTime(kind) {
    _ck[kind] = null;
    _ckSchedule();
    renderTaskChecklist();
}

function ckAddEvent(label) {
    const text = String(label || '').trim();
    if(!text) return;
    (_ck.data.events = _ck.data.events || []).push({ t: new Date().toISOString(), label: text });
    _ckSchedule();
    renderTaskChecklist();
}

function ckAddCustomEvent() {
    const input = document.getElementById('ck_customEvent');
    if(input && input.value.trim()) { ckAddEvent(input.value); }
}

function ckEditEventTime(idx, value) {
    const ev = _ck.data.events?.[idx];
    if(!ev || !/^\d{2}:\d{2}$/.test(value)) return;
    const d = new Date(ev.t);
    const [h, m] = value.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    ev.t = d.toISOString();
    _ckSchedule();
}

function ckRemoveEvent(idx) {
    _ck.data.events.splice(idx, 1);
    _ckSchedule();
    renderTaskChecklist();
}

function ckAddGap() {
    (_ck.data.gaps = _ck.data.gaps || []).push({ label: '', volts: '' });
    _ckSchedule();
    renderTaskChecklist();
}

function ckSetGap(idx, field, value) {
    const g = _ck.data.gaps?.[idx];
    if(!g) return;
    g[field] = value;
    _ckSchedule();
}

function ckGapChanged() { renderTaskChecklist(); }   // recolorea el voltaje al salir del campo

function ckRemoveGap(idx) {
    _ck.data.gaps.splice(idx, 1);
    _ckSchedule();
    renderTaskChecklist();
}

function ckSetCount(which, field, value) {
    const c = (_ck.data[which] = _ck.data[which] || {});
    c[field] = value === '' ? '' : Number(value);
    _ckSchedule();
}

function ckCountChanged() { renderTaskChecklist(); }

function ckSetText(field, value) {
    _ck.data[field] = value;
    _ckSchedule();
}

async function ckUploadMapPhoto(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if(!file || !_ck) return;
    if(!file.type.startsWith('image/')) { showToast('Selecciona un archivo de imagen', 'error'); return; }
    const taskId = _ck.taskId;
    _ck.status = 'Subiendo foto…';
    _ckUpdateStatus();
    try {
        const blob = await compressImageUnder150KB(file, 150);
        const path = `checklists/${taskId}/${Date.now()}.jpg`;
        const { error } = await supabaseClient.storage.from('inventory-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if(error) throw error;
        const { data } = supabaseClient.storage.from('inventory-photos').getPublicUrl(path);
        if(_ck && _ck.taskId === taskId) {
            (_ck.data.mapPhotos = _ck.data.mapPhotos || []).push(data.publicUrl);
            _ckSchedule();
            renderTaskChecklist();
        }
    } catch(e) {
        showToast('No se pudo subir la foto: ' + (e.message || e), 'error');
        if(_ck) { _ck.status = ''; _ckUpdateStatus(); }
    }
}

function ckRemovePhoto(idx) {
    _ck.data.mapPhotos.splice(idx, 1);
    _ckSchedule();
    renderTaskChecklist();
}

async function ckRegisterLoctite() {
    if(!dbInventoryConsumables.length) await loadInventoryData();
    const c = dbInventoryConsumables.find(x => /loctite/i.test(x.name));
    if(!c) { showToast('No hay un consumible "Loctite" creado en Inventario → Consumibles', 'error'); return; }
    openConsumableMovementModal('consumo', c.id, _ck.taskId);
}

function _ckTimeLabel(iso) {
    return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function _ckDateTimeLabel(iso) {
    return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

function _ckTimeButtons() {
    const mk = (kind, label, icon) => _ck[kind]
        ? `<span style="display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:99px;padding:3px 12px;font-size:0.78rem;font-weight:700;">${icon} ${label}: ${_ckDateTimeLabel(_ck[kind])}
              <button onclick="ckClearTime('${kind}')" title="Borrar" style="background:none;border:none;color:#15803d;cursor:pointer;font-size:0.9rem;">✕</button></span>`
        : `<button class="btn-outline" onclick="ckMarkTime('${kind}')" style="font-size:0.78rem;padding:4px 12px;">${icon} ${label}</button>`;
    return mk;
}

function _ckStageExtras(stageId) {
    const inputStyle = 'padding:0.4rem 0.55rem;border:1px solid #cbd5e1;border-radius:6px;font-size:0.82rem;';
    const box = (title, inner) => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:0.75rem 0.9rem;margin-top:0.85rem;"><div style="font-size:0.74rem;font-weight:800;color:#64748b;text-transform:uppercase;margin-bottom:0.5rem;">${title}</div>${inner}</div>`;
    const timeBtn = _ckTimeButtons();
    let html = '';

    if(stageId === 'meas') {
        html += box('Hora en planta', `<div style="display:flex;flex-wrap:wrap;gap:0.5rem;">${timeBtn('arrived', 'Llegué a planta', '📍')}</div>`);

        const gaps = _ck.data.gaps || [];
        html += box('Gaps de las sondas (voltios) — objetivo ≈ 10 V', `
            ${gaps.map((g, i) => {
                const v = parseFloat(g.volts);
                const dev = isNaN(v) ? null : Math.abs(v - 10);
                const col = dev === null ? '#94a3b8' : dev <= 1 ? '#15803d' : dev <= 2 ? '#b45309' : '#b91c1c';
                return `<div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem;">
                    <input type="text" value="${_escHtml(g.label)}" placeholder="Sonda (ej. Cojinete 1 · X)" oninput="ckSetGap(${i}, 'label', this.value)" style="${inputStyle}flex:2;min-width:0;">
                    <input type="number" step="0.01" value="${_escHtml(g.volts)}" placeholder="V" oninput="ckSetGap(${i}, 'volts', this.value)" onchange="ckGapChanged()" style="${inputStyle}width:90px;border-color:${col};color:${col};font-weight:700;">
                    <button onclick="ckRemoveGap(${i})" title="Quitar" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;">✕</button>
                </div>`;
            }).join('')}
            <button class="btn-outline" onclick="ckAddGap()" style="font-size:0.78rem;padding:3px 12px;">+ Agregar sonda</button>`);

        const events = _ck.data.events || [];
        html += box('Bitácora de eventos operativos (reemplaza el documento de Word)', `
            <div style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-bottom:0.6rem;">
                ${_CK_EVENTS.map(ev => `<button class="btn-outline" onclick="ckAddEvent('${ev}')" style="font-size:0.74rem;padding:3px 10px;">${ev}</button>`).join('')}
            </div>
            <div style="display:flex;gap:0.4rem;margin-bottom:0.6rem;">
                <input id="ck_customEvent" type="text" placeholder="Otro evento o cambio operativo…" onkeydown="if(event.key==='Enter'){ckAddCustomEvent();}" style="${inputStyle}flex:1;min-width:0;">
                <button class="btn-primary" onclick="ckAddCustomEvent()" style="font-size:0.78rem;padding:4px 12px;">Agregar</button>
            </div>
            ${events.length === 0 ? '<div style="font-size:0.78rem;color:#94a3b8;">Aún no hay eventos. Cada botón registra la hora actual; puedes corregirla.</div>' : events.map((ev, i) => `
                <div style="display:flex;gap:0.5rem;align-items:center;padding:0.25rem 0;border-bottom:1px solid #f1f5f9;">
                    <input type="time" value="${_ckTimeLabel(ev.t)}" onchange="ckEditEventTime(${i}, this.value)" style="${inputStyle}width:105px;">
                    <span style="flex:1;font-size:0.82rem;">${_escHtml(ev.label)}</span>
                    <button onclick="ckRemoveEvent(${i})" title="Quitar" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;">✕</button>
                </div>`).join('')}`);

        const photos = _ck.data.mapPhotos || [];
        html += box('Mapa de instalación de sensores (foto)', `
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
                ${photos.map((u, i) => `<span style="position:relative;"><a href="${_escHtml(u)}" target="_blank"><img src="${_escHtml(u)}" style="height:70px;border-radius:8px;border:1px solid #e2e8f0;"></a>
                    <button onclick="ckRemovePhoto(${i})" title="Quitar" style="position:absolute;top:-6px;right:-6px;background:#fff;border:1px solid #cbd5e1;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:0.7rem;">✕</button></span>`).join('')}
                <label class="btn-outline" style="font-size:0.78rem;padding:4px 12px;cursor:pointer;">📷 Agregar foto
                    <input type="file" accept="image/*" capture="environment" onchange="ckUploadMapPhoto(event)" style="display:none;">
                </label>
            </div>`);

        html += box('Consumibles', `<button class="btn-outline" onclick="ckRegisterLoctite()" style="font-size:0.78rem;padding:4px 12px;">🧪 Registrar Loctite usado en las sondas</button>`);
    }

    if(stageId === 'exit') {
        html += box('Hora de salida', `<div style="display:flex;flex-wrap:wrap;gap:0.5rem;">${timeBtn('left', 'Salí de planta', '🚪')}</div>`);
    }

    if(stageId === 'arrive') {
        html += box('Novedades, daños o pérdidas', `
            <textarea rows="3" placeholder="Escribe aquí cualquier daño, pérdida o novedad (o déjalo vacío si no hubo)…" oninput="ckSetText('novedades', this.value)" style="${inputStyle}width:100%;resize:vertical;">${_escHtml(_ck.data.novedades || '')}</textarea>`);
    }
    return html;
}

// ── Lista A001 (alistamiento / conteo de equipos) ─────────────────────────────
// El analista define cuántos de cada elemento salen; el mismo conteo se verifica al salir
// de A-MAQ ('out'), al salir de la planta ('plant') y al volver a A-MAQ ('back').
// La lista es editable por el admin (tabla checklist_a001_items); si está vacía se usa la base.

const _A001_DEFAULTS = (() => {
    const g = (group, names) => names.map(n => ({ group, name: n }));
    const list = [
        ...g('Sensores y cables de señal', ['Drivers', 'Sondas de proximidad', 'Acelerómetros', 'Cables driver–atenuador', 'Cables de acelerómetros', 'Dados para conectar sondas']),
        ...g('Adquisición y energía', ['Cables BNC–BNC', 'Cable atenuador–fuente', 'Cable de alimentación del atenuador', 'Atenuador', 'Fuente del atenuador', 'ASDAQ (C-DAQ y tarjetas)', 'Fuente de alimentación ASDAQ', 'Cable USB acondicionador–Toughbook', 'Laptop', 'Fuente de la laptop']),
        ...g('Accesorios e instalación', ['Base del sensor de referencia', 'Corta picos', 'Extensión eléctrica', 'Cinta reflectiva', 'Marca de paso con fuente (keyphasor)', 'Cable de la marca de paso', 'Multímetro', 'Cinta aislante', 'Bases magnéticas para acelerómetros', 'Llave de expansión', 'Clip metálico para pruebas']),
        ...g('Consumibles', ['Loctite 330', 'Cinta de enmascarar', 'Perillero']),
        ...g('EPP', ['Casco', 'Tapaoídos', 'Gafas', 'Botas de seguridad', 'Guantes', 'Uniformes'])
    ];
    return list.map((d, i) => ({ ...d, id: 'base_' + String(i + 1).padStart(2, '0'), sort_order: i + 1 }));
})();

let dbA001Items = [];   // filas de checklist_a001_items (vacío = usar la lista base)

function _a001Items() {
    if(dbA001Items.length) {
        return dbA001Items.slice()
            .sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
            .map(r => ({ id: r.id, group: r.group_name || 'Otros', name: r.name }));
    }
    return _A001_DEFAULTS.map(d => ({ id: d.id, group: d.group, name: d.name }));
}

const _A001_STATE_LABEL = { ok: 'completo', missing: 'falta', damaged: 'dañado', lost: 'perdido', pending: 'pendiente' };

function _a001Of(data) {
    const a = (data.a001 = data.a001 || {});
    ['plan', 'out', 'plant', 'back', 'names', 'sel', 'units'].forEach(k => { a[k] = a[k] || {}; });
    a.us = a.us || {};
    a.us.plant = a.us.plant || {};
    a.us.back = a.us.back || {};
    return a;
}

/** Ítems del inventario vinculados a una línea de la lista A001. */
function _a001LinkedItems(lineId) {
    return dbInventoryItems.filter(i => i.a001_item_id === lineId);
}

function _a001UnitLabel(itemId) {
    const it = dbInventoryItems.find(i => i.id === itemId);
    return it ? it.name + (it.serial_number ? ' · ' + it.serial_number : '') : 'Equipo';
}

function _a001LineName(a, lineId) {
    return _a001Items().find(i => i.id === lineId)?.name || a.names?.[lineId] || lineId;
}

/** Estado de un conteo: líneas que salen, ya contadas y faltantes (con detalle por serial). */
function _a001PassStatus(data, pass) {
    const a = data?.a001 || {};
    const plan = a.plan || {}, vals = a[pass] || {}, units = a.units || {};
    const st = (a.us && a.us[pass]) || {};
    const planned = Object.keys(plan).filter(id => Number(plan[id]) > 0);
    const counted = [], missing = [];
    planned.forEach(id => {
        const lineName = _a001LineName(a, id);
        const list = units[id];
        if(list && list.length) {
            if(pass === 'out') { if(vals[id] !== undefined && vals[id] !== '') counted.push(id); return; }
            if(!list.every(u => st[u])) return;
            counted.push(id);
            const bad = list.filter(u => st[u] !== 'ok');
            if(bad.length) {
                missing.push({
                    id, name: lineName, plan: list.length, counted: list.length - bad.length,
                    detail: bad.map(u => `${_a001UnitLabel(u)} (${_A001_STATE_LABEL[st[u]] || st[u]})`).join(', ')
                });
            }
            return;
        }
        if(vals[id] === undefined || vals[id] === '') return;
        counted.push(id);
        if(Number(vals[id]) < Number(plan[id])) missing.push({ id, name: lineName, plan: Number(plan[id]), counted: Number(vals[id]) });
    });
    return { planned: planned.length, counted: counted.length, missing, done: planned.length > 0 && counted.length === planned.length };
}

// ── Cantidades (líneas sin enlace al inventario) ──────────────────────────────
function a001SetPlan(id, value) {
    const a = _a001Of(_ck.data);
    const n = Math.max(0, parseInt(value, 10) || 0);
    if(n > 0) { a.plan[id] = n; a.names[id] = _a001LineName(a, id); }
    else delete a.plan[id];
    delete a.out[id]; delete a.plant[id]; delete a.back[id];
    _ckSchedule();
    renderTaskChecklist();
}

function a001Confirm(pass, id) {
    const a = _a001Of(_ck.data);
    const plan = Number(a.plan[id]) || 0;
    if(plan <= 0) return;
    if(a[pass][id] === plan) delete a[pass][id]; else a[pass][id] = plan;
    _ckSchedule();
    renderTaskChecklist();
}

function a001SetCount(pass, id, value) {
    const a = _a001Of(_ck.data);
    if(value === '') delete a[pass][id];
    else a[pass][id] = Math.max(0, parseInt(value, 10) || 0);
    _ckSchedule();
    renderTaskChecklist();
}

async function a001ConfirmGroup(pass, groupName) {
    const a = _a001Of(_ck.data);
    const lines = _a001Items().filter(i => i.group === groupName);
    for(const i of lines) {
        const units = a.units[i.id];
        if(units && units.length) {
            if(pass === 'plant') units.forEach(u => { a.us.plant[u] = 'ok'; });
            if(pass === 'back') {
                const pending = units.filter(u => !['ok', 'damaged', 'lost'].includes(a.us.back[u]));
                for(const u of pending) { if(!_ck) return; await a001UnitBack(u, 'ok', true); }
            }
            continue;
        }
        if(pass === 'out' && _a001LinkedItems(i.id).length && (a.sel[i.id] || []).length) {
            await a001RegisterLine(i.id, true);
            continue;
        }
        const plan = Number(a.plan[i.id]) || 0;
        if(plan > 0 && !(units && units.length)) a[pass][i.id] = plan;
    }
    _ckSchedule();
    renderTaskChecklist();
}

function a001SetPc(value) {
    _a001Of(_ck.data).pc = value;
    _ckSchedule();
}

// ── Unidades del inventario (líneas enlazadas) ────────────────────────────────
function a001SetKit(kitId) {
    const a = _a001Of(_ck.data);
    a.kitId = kitId || '';
    _a001Items().forEach(line => {
        if(a.units[line.id]?.length) return;
        const linked = _a001LinkedItems(line.id);
        if(!linked.length) return;
        a.sel[line.id] = kitId
            ? linked.filter(u => u.kit_id === kitId && u.status === 'disponible').map(u => u.id)
            : [];
    });
    _ckSchedule();
    renderTaskChecklist();
}

function a001ToggleUnit(lineId, itemId) {
    const a = _a001Of(_ck.data);
    const sel = (a.sel[lineId] = a.sel[lineId] || []);
    const i = sel.indexOf(itemId);
    if(i >= 0) sel.splice(i, 1); else sel.push(itemId);
    _ckSchedule();
    renderTaskChecklist();
}

/** Registra la salida real: crea los préstamos en Inventario, a nombre del responsable y con la gestión. */
async function a001RegisterLine(lineId, silent = false) {
    if(!_ck) return false;
    const taskId = _ck.taskId;
    const data = _ck.data;
    const a = _a001Of(data);
    const task = tasks.find(t => t.id === taskId);
    const sel = (a.sel[lineId] || []).slice();
    if(!sel.length) { if(!silent) showToast('Marca al menos un equipo', 'error'); return false; }

    const responsible = (task && _effAnalystsOf(task)[0]) || currentUserProfile?.analyst_name || currentUserProfile?.display_name || currentUser?.email || 'Desconocido';
    if(!a.kitLoanId) a.kitLoanId = (crypto?.randomUUID ? crypto.randomUUID() : `klg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

    const done = [];
    for(const id of sel) {
        const item = dbInventoryItems.find(i => i.id === id);
        if(!item) continue;
        if(dbInventoryLoans.some(l => l.item_id === id && l.task_id === taskId && !l.checked_in_at)) { done.push(id); continue; }
        if(item.status !== 'disponible') { showToast(`"${item.name}" ya no está disponible`, 'error'); continue; }
        const inKit = a.kitId && item.kit_id === a.kitId;
        const { error: e1 } = await supabaseClient.from('inventory_loans').insert({
            item_id: id, analyst_name: responsible, task_id: taskId,
            kit_id: inKit ? a.kitId : null, kit_loan_id: inKit ? a.kitLoanId : null
        });
        let e2 = null;
        if(!e1) ({ error: e2 } = await supabaseClient.from('inventory_items').update({ status: 'prestado' }).eq('id', id));
        if(e1 || e2) {
            const msg = (e1 || e2).message || '';
            showToast(/task_id|schema cache/i.test(msg) ? 'Falta ejecutar la migración del enlace A001 ↔ inventario en Supabase.' : 'Error registrando salida: ' + msg, 'error');
            break;
        }
        done.push(id);
    }
    if(!done.length) return false;

    a.units[lineId] = done;
    a.plan[lineId] = done.length;
    a.out[lineId] = done.length;
    a.names[lineId] = _a001LineName(a, lineId);
    delete a.sel[lineId];
    await loadInventoryData();
    if(_ck && _ck.taskId === taskId) {
        _ckSchedule();
        if(!silent) renderTaskChecklist();
    }
    return true;
}

async function a001RegisterAll() {
    if(!_ck) return;
    const a = _a001Of(_ck.data);
    const lines = _a001Items().filter(l => !a.units[l.id]?.length && (a.sel[l.id] || []).length);
    if(!lines.length) { showToast('No hay equipos marcados para registrar', 'error'); return; }
    for(const l of lines) { if(!_ck) return; await a001RegisterLine(l.id, true); }
    if(_ck) renderTaskChecklist();
    showToast('Salida registrada en Inventario ✓', 'success');
}

function a001UnitPlant(itemId) {
    const a = _a001Of(_ck.data);
    const cur = a.us.plant[itemId];
    if(!cur) a.us.plant[itemId] = 'ok';
    else if(cur === 'ok') a.us.plant[itemId] = 'missing';
    else delete a.us.plant[itemId];
    _ckSchedule();
    renderTaskChecklist();
}

/** Resultado de un equipo al llegar a A-MAQ. ok / dañado / perdido se aplican en Inventario; pendiente queda abierto. */
async function a001UnitBack(itemId, state, silent = false) {
    if(!_ck) return;
    const taskId = _ck.taskId;
    const a = _a001Of(_ck.data);
    if(['ok', 'damaged', 'lost'].includes(a.us.back[itemId])) return;   // ya quedó aplicado en Inventario
    const label = _a001UnitLabel(itemId);

    if(state === 'pending') {
        a.us.back[itemId] = 'pending';
        _ckSchedule();
        if(!silent) renderTaskChecklist();
        return;
    }

    let note = '';
    if(state === 'damaged' || state === 'lost') {
        note = (prompt(state === 'lost' ? `¿Qué pasó con "${label}"? (obligatorio)` : `Describe el daño de "${label}" (obligatorio)`) || '').trim();
        if(!note) return;
        if(state === 'lost' && !confirm(`"${label}" se marcará como PERDIDO en el inventario. ¿Confirmas?`)) return;
    }

    const reportedBy = currentUserProfile?.analyst_name || currentUserProfile?.display_name || currentUser?.email || 'Desconocido';
    const loan = dbInventoryLoans.find(l => l.item_id === itemId && !l.checked_in_at);
    const newStatus = state === 'ok' ? 'disponible' : (state === 'damaged' ? 'dañado' : 'perdido');

    if(loan) {
        const upd = { checked_in_at: new Date().toISOString() };
        if(note) upd.notes = note;
        const { error } = await supabaseClient.from('inventory_loans').update(upd).eq('id', loan.id);
        if(error) { showToast('Error registrando la devolución: ' + error.message, 'error'); return; }
    }
    const { error: e2 } = await supabaseClient.from('inventory_items').update({ status: newStatus }).eq('id', itemId);
    if(e2) { showToast('Error actualizando el equipo: ' + e2.message, 'error'); return; }
    if(state !== 'ok') {
        await supabaseClient.from('inventory_incidents').insert({ item_id: itemId, type: newStatus, note, reported_by: reportedBy });
    }

    await loadInventoryData();
    if(_ck && _ck.taskId === taskId) {
        _a001Of(_ck.data).us.back[itemId] = state;
        _ckSchedule();
        if(!silent) renderTaskChecklist();
    }
}

// ── Sección A001 dentro de cada etapa ─────────────────────────────────────────
function _a001Section(stage, task) {
    const pass = stage.a001;
    if(!pass) return '';
    const a = _a001Of(_ck.data);
    const items = _a001Items();
    const known = new Set(items.map(i => i.id));
    Object.keys(a.plan).forEach(id => {
        if(!known.has(id) && Number(a.plan[id]) > 0) items.push({ id, group: 'Ya no está en la lista', name: a.names[id] || id });
    });
    const isAdmin = currentUserProfile?.role === 'admin';
    const st = _a001PassStatus(_ck.data, pass);
    const titles = { out: 'Lista A001 — Salida de A-MAQ', plant: 'Lista A001 — Salida de la planta', back: 'Lista A001 — Entrada a A-MAQ' };
    const subtitles = {
        out:   'Elige el kit y marca los equipos que salen: se registran en Inventario a nombre del responsable. Lo demás, escribe la cantidad.',
        plant: 'Verifica cada equipo antes de salir de la planta. Toca un equipo para marcarlo completo o faltante.',
        back:  'Registra cómo llegó cada equipo: completo, dañado, perdido o pendiente de aclarar.'
    };
    const inputCss = 'padding:0.3rem 0.4rem;border:1px solid #cbd5e1;border-radius:6px;font-size:0.82rem;width:64px;text-align:center;';
    const okBtn = (on, color = '#15803d', bg = '#dcfce7') => `min-width:34px;padding:3px 8px;border-radius:7px;border:1.5px solid ${on ? color : '#cbd5e1'};background:${on ? bg : '#fff'};color:${on ? color : '#94a3b8'};font-weight:800;cursor:pointer;`;

    const groups = [];
    items.forEach(i => { if(!groups.includes(i.group)) groups.push(i.group); });
    const hasLinked = items.some(i => _a001LinkedItems(i.id).length);

    const lineHtml = (i) => {
        const units = a.units[i.id];
        const registered = !!(units && units.length);
        const linked = _a001LinkedItems(i.id);
        const plan = Number(a.plan[i.id]) || 0;
        const label = `<div style="flex:1;font-size:0.83rem;">${_escHtml(i.name)}</div>`;

        // Equipos enlazados con Inventario, aún sin registrar la salida
        if(pass === 'out' && !registered && linked.length) {
            const sel = a.sel[i.id] || [];
            const avail = linked.filter(u => u.status === 'disponible').length;
            const chips = linked.map(u => {
                const ok = u.status === 'disponible';
                const on = sel.includes(u.id);
                const kitName = dbInventoryKits.find(k => k.id === u.kit_id)?.name;
                return `<button ${ok ? '' : 'disabled'} onclick="a001ToggleUnit('${i.id}', '${u.id}')" title="${_escHtml(kitName ? 'Kit: ' + kitName : 'Sin kit')}${ok ? '' : ' · ' + (_invStatusLabel[u.status] || u.status)}"
                    style="padding:2px 9px;border-radius:99px;border:1.5px solid ${on ? '#15803d' : '#cbd5e1'};background:${on ? '#dcfce7' : '#fff'};color:${on ? '#15803d' : ok ? '#475569' : '#cbd5e1'};font-size:0.74rem;font-weight:${on ? 800 : 500};cursor:${ok ? 'pointer' : 'not-allowed'};${ok ? '' : 'text-decoration:line-through;'}">${on ? '✔ ' : ''}${_escHtml(u.name)}${u.serial_number ? ' · ' + _escHtml(u.serial_number) : ''}${ok ? '' : ' (' + (_invStatusLabel[u.status] || u.status) + ')'}</button>`;
            }).join('');
            return `<div style="padding:0.45rem 0;border-bottom:1px solid #f1f5f9;">
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    ${label}
                    <span style="font-size:0.72rem;color:#64748b;">${sel.length} de ${avail} disponibles</span>
                    <button ${sel.length ? '' : 'disabled'} onclick="a001RegisterLine('${i.id}')" style="${okBtn(sel.length > 0)}">Registrar (${sel.length})</button>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.35rem;">${chips}</div>
            </div>`;
        }

        // Equipos ya registrados: verificación por serial
        if(registered) {
            if(pass === 'out') {
                return `<div style="padding:0.4rem 0;border-bottom:1px solid #f1f5f9;">
                    <div style="display:flex;align-items:center;gap:0.5rem;">${label}<span style="color:#15803d;font-weight:800;font-size:0.8rem;">✓ ${units.length} registrados en Inventario</span></div>
                    <div style="font-size:0.7rem;color:#94a3b8;margin-top:2px;">${units.map(u => _escHtml(_a001UnitLabel(u))).join(' · ')}</div>
                </div>`;
            }
            if(pass === 'plant') {
                const chips = units.map(u => {
                    const s = a.us.plant[u];
                    const c = s === 'ok' ? ['#15803d', '#dcfce7'] : s === 'missing' ? ['#b91c1c', '#fee2e2'] : ['#475569', '#fff'];
                    return `<button onclick="a001UnitPlant('${u}')" style="padding:2px 9px;border-radius:99px;border:1.5px solid ${s ? c[0] : '#cbd5e1'};background:${c[1]};color:${c[0]};font-size:0.74rem;font-weight:700;cursor:pointer;">${s === 'ok' ? '✔ ' : s === 'missing' ? '✖ ' : ''}${_escHtml(_a001UnitLabel(u))}</button>`;
                }).join('');
                return `<div style="padding:0.45rem 0;border-bottom:1px solid #f1f5f9;">
                    <div style="display:flex;align-items:center;gap:0.5rem;">${label}<span style="font-size:0.72rem;color:#64748b;">Debe haber ${units.length}</span></div>
                    <div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.35rem;">${chips}</div>
                </div>`;
            }
            const rows = units.map(u => {
                const s = a.us.back[u];
                const locked = ['ok', 'damaged', 'lost'].includes(s);
                const b = (state, text, color, bg) => `<button ${locked && s !== state ? 'disabled' : ''} onclick="a001UnitBack('${u}', '${state}')" style="${okBtn(s === state, color, bg)}${locked && s !== state ? 'opacity:.35;cursor:not-allowed;' : ''}font-size:0.74rem;">${text}</button>`;
                return `<div style="display:flex;gap:0.35rem;align-items:center;padding:0.2rem 0;">
                    <div style="flex:1;font-size:0.8rem;">${_escHtml(_a001UnitLabel(u))}</div>
                    ${b('ok', '✔ Llegó', '#15803d', '#dcfce7')}${b('damaged', '🔧 Dañado', '#b45309', '#fef3c7')}${b('lost', '❌ Perdido', '#b91c1c', '#fee2e2')}${b('pending', '⏳ Pendiente', '#475569', '#e2e8f0')}
                </div>`;
            }).join('');
            return `<div style="padding:0.45rem 0;border-bottom:1px solid #f1f5f9;">
                <div style="display:flex;align-items:center;gap:0.5rem;">${label}<span style="font-size:0.72rem;color:#64748b;">Debe haber ${units.length}</span></div>
                <div style="margin-top:0.25rem;">${rows}</div>
            </div>`;
        }

        // Sin enlace con Inventario: cantidad
        if(pass === 'out') {
            const ok = plan > 0 && a.out[i.id] === plan;
            return `<div style="display:flex;gap:0.5rem;align-items:center;padding:0.3rem 0;border-bottom:1px solid #f1f5f9;${plan === 0 ? 'opacity:.55;' : ''}">
                ${label}
                <input type="number" min="0" value="${plan || ''}" placeholder="0" onchange="a001SetPlan('${i.id}', this.value)" title="Cantidad que sale" style="${inputCss}">
                <button ${plan === 0 ? 'disabled' : ''} onclick="a001Confirm('out', '${i.id}')" style="${okBtn(ok)}${plan === 0 ? 'cursor:not-allowed;' : ''}">✔</button>
            </div>`;
        }
        const v = a[pass][i.id];
        const counted = v !== undefined && v !== '';
        const complete = counted && Number(v) === plan;
        const lacking = counted && Number(v) < plan;
        const extra = counted && Number(v) > plan;
        return `<div style="display:flex;gap:0.5rem;align-items:center;padding:0.3rem 0;border-bottom:1px solid #f1f5f9;">
            ${label}
            <span style="font-size:0.74rem;color:#64748b;white-space:nowrap;">Debe haber ${plan}</span>
            <input type="number" min="0" value="${counted ? v : ''}" placeholder="—" onchange="a001SetCount('${pass}', '${i.id}', this.value)" title="Cantidad contada" style="${inputCss}border-color:${lacking ? '#fca5a5' : extra ? '#fcd34d' : '#cbd5e1'};">
            <button onclick="a001Confirm('${pass}', '${i.id}')" style="${okBtn(complete)}">✔</button>
        </div>`;
    };

    const groupHtml = groups.map(gname => {
        const lines = items.filter(i => i.group === gname && (pass === 'out' || Number(a.plan[i.id]) > 0));
        if(!lines.length) return '';
        const allBtn = `<button class="btn-outline" onclick="a001ConfirmGroup('${pass}', '${_escHtml(gname).replace(/'/g, "\\'")}')" style="font-size:0.7rem;padding:2px 9px;">✔ ${pass === 'out' ? 'Registrar / empacar todo' : pass === 'back' ? 'Todos llegaron' : 'Todos completos'}</button>`;
        return `<div style="margin-top:0.7rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.15rem;">
                <div style="font-size:0.74rem;font-weight:800;color:#0f766e;text-transform:uppercase;">${_escHtml(gname)}</div>${allBtn}
            </div>${lines.map(lineHtml).join('')}</div>`;
    }).join('');

    const kitSelect = (pass === 'out' && hasLinked && dbInventoryKits.length) ? `
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;margin:0.4rem 0;">
            <label style="font-size:0.78rem;color:#475569;"><strong>Kit que sale:</strong>
                <select onchange="a001SetKit(this.value)" style="margin-left:6px;padding:0.3rem 0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:0.8rem;">
                    <option value="">— Elegir kit —</option>
                    ${dbInventoryKits.map(k => `<option value="${k.id}" ${a.kitId === k.id ? 'selected' : ''}>${_escHtml(k.name)}</option>`).join('')}
                </select></label>
            <button class="btn-primary" onclick="a001RegisterAll()" style="font-size:0.74rem;padding:4px 12px;">Registrar salida de lo marcado</button>
        </div>` : '';

    const header = pass === 'out' ? `
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem 1.2rem;font-size:0.78rem;color:#475569;margin:0.3rem 0 0.2rem;">
            <span><strong>Empresa:</strong> ${_escHtml(cleanClientName(task.client))}</span>
            <span><strong>Responsable(s):</strong> ${_escHtml((_effAnalystsOf(task).join(', ')) || '—')}</span>
            <label><strong>PC:</strong> <input type="text" value="${_escHtml(a.pc || '')}" placeholder="Ej: Toughbook 2" oninput="a001SetPc(this.value)" style="padding:0.25rem 0.45rem;border:1px solid #cbd5e1;border-radius:6px;font-size:0.78rem;width:150px;"></label>
        </div>${kitSelect}` : '';

    const missingHtml = (pass !== 'out' && st.missing.length) ? `
        <div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:0.5rem 0.75rem;margin-top:0.6rem;font-size:0.8rem;">
            <strong>⚠ Faltan:</strong> ${st.missing.map(m => `${_escHtml(m.name)} (${m.counted} de ${m.plan})${m.detail ? ' — ' + _escHtml(m.detail) : ''}`).join(' · ')}
            <div style="font-size:0.72rem;margin-top:2px;">Descríbelo en las novedades de la etapa Llegada a A-MAQ.</div>
        </div>` : '';

    const emptyHtml = (pass !== 'out' && st.planned === 0)
        ? '<div style="font-size:0.8rem;color:#b45309;padding:0.6rem 0;">Primero define qué elementos salen en la etapa Preparación (Lista A001 — Salida de A-MAQ).</div>' : '';

    return `<div style="border:1.5px solid #99f6e4;background:#f0fdfa66;border-radius:12px;padding:0.8rem 0.95rem;margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <div>
                <div style="font-weight:800;font-size:0.92rem;color:#0f766e;">${titles[pass]}</div>
                <div style="font-size:0.74rem;color:#64748b;">${subtitles[pass]}</div>
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem;">
                <span style="font-size:0.78rem;font-weight:700;color:${st.done ? '#15803d' : '#64748b'};">${st.counted}/${st.planned}${st.done ? ' ✓' : ''}</span>
                ${isAdmin ? '<button class="btn-outline" onclick="openA001Editor()" style="font-size:0.72rem;padding:2px 9px;">✏️ Editar lista</button>' : ''}
            </div>
        </div>
        ${header}${emptyHtml}${groupHtml}${missingHtml}
    </div>`;
}

// ── Editor de la lista A001 (admin) ────────────────────────────────────────────
async function openA001Editor() {
    if(!dbInventoryItems.length) await loadInventoryData();
    renderA001Editor();
    document.getElementById('a001EditorModal').classList.add('active');
}

function _a001Rows() {
    // Filas editables: las de la tabla; si aún no hay, la base (solo lectura hasta guardarla)
    return dbA001Items.length
        ? dbA001Items.slice().sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
        : [];
}

function renderA001Editor() {
    const body = document.getElementById('a001_editorBody');
    if(!body) return;
    const rows = _a001Rows();
    if(!rows.length) {
        body.innerHTML = `
            <div style="text-align:center;padding:1.5rem;">
                <p style="font-size:0.85rem;color:#64748b;margin-bottom:1rem;">La lista usa los ${_A001_DEFAULTS.length} elementos base. Guárdala para poder editarla: agregar, renombrar, mover o quitar elementos.</p>
                <button class="btn-primary" onclick="a001LoadBase()">Guardar lista base y editar</button>
            </div>`;
        return;
    }
    const groups = [...new Set(rows.map(r => r.group_name || 'Otros'))];
    const inputCss = 'padding:0.35rem 0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:0.8rem;';
    const groupSelect = (current, onchange) => `<select onchange="${onchange}" style="${inputCss}width:190px;">${groups.map(g => `<option value="${_escHtml(g)}" ${g === current ? 'selected' : ''}>${_escHtml(g)}</option>`).join('')}<option value="__new__">+ Nuevo grupo…</option></select>`;
    body.innerHTML = rows.map((r, idx) => `
        <div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem;">
            <input type="text" value="${_escHtml(r.name)}" onchange="a001RenameItem('${r.id}', this.value)" style="${inputCss}flex:1;min-width:0;">
            ${groupSelect(r.group_name || 'Otros', `a001ChangeGroup('${r.id}', this.value)`)}
            <button onclick="openA001Linker('${r.id}')" title="Equipos del inventario vinculados a esta línea" style="background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:0.75rem;white-space:nowrap;">🔗 ${_a001LinkedItems(r.id).length}</button>
            <button onclick="a001Move('${r.id}', -1)" ${idx === 0 ? 'disabled' : ''} title="Subir" style="background:none;border:none;cursor:pointer;">↑</button>
            <button onclick="a001Move('${r.id}', 1)" ${idx === rows.length - 1 ? 'disabled' : ''} title="Bajar" style="background:none;border:none;cursor:pointer;">↓</button>
            <button onclick="a001Delete('${r.id}')" title="Quitar" style="background:none;border:none;cursor:pointer;color:#dc2626;">🗑</button>
        </div>`).join('') + `
        <div style="display:flex;gap:0.4rem;align-items:center;margin-top:0.8rem;padding-top:0.8rem;border-top:1px dashed #cbd5e1;">
            <input id="a001_newName" type="text" placeholder="Nuevo elemento…" style="${inputCss}flex:1;min-width:0;">
            ${groupSelect(groups[0], '_a001NewGroupChanged(this)').replace('<select ', '<select id="a001_newGroup" ')}
            <button class="btn-primary" onclick="a001AddItem()" style="font-size:0.8rem;padding:5px 14px;">Agregar</button>
        </div>`;
}

async function _a001Reload() {
    const { data } = await supabaseClient.from('checklist_a001_items').select('*');
    dbA001Items = data || [];
    renderA001Editor();
    if(_ck) renderTaskChecklist();
}

function _a001AskGroup() {
    const name = (prompt('Nombre del nuevo grupo:') || '').trim();
    return name || null;
}

function _a001NewGroupChanged(sel) {
    if(sel.value !== '__new__') return;
    const name = _a001AskGroup();
    if(!name) { sel.selectedIndex = 0; return; }
    sel.insertAdjacentHTML('afterbegin', `<option value="${_escHtml(name)}">${_escHtml(name)}</option>`);
    sel.value = name;
}

async function a001LoadBase() {
    const rows = _A001_DEFAULTS.map(d => ({ id: d.id, group_name: d.group, name: d.name, sort_order: d.sort_order }));
    const { error } = await supabaseClient.from('checklist_a001_items').upsert(rows, { onConflict: 'id' });
    if(error) { showToast(/checklist_a001_items|schema cache/i.test(error.message) ? 'Falta ejecutar la migración de la lista A001 en Supabase.' : error.message, 'error'); return; }
    await _a001Reload();
}

async function a001AddItem() {
    const name = document.getElementById('a001_newName').value.trim();
    if(!name) { showToast('Escribe el nombre del elemento', 'error'); return; }
    const group = document.getElementById('a001_newGroup').value;
    const rows = _a001Rows();
    const next = (rows.length ? Math.max(...rows.map(r => r.sort_order ?? 0)) : 0) + 1;
    const { error } = await supabaseClient.from('checklist_a001_items').insert({ id: 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), group_name: group, name, sort_order: next });
    if(error) { showToast('No se pudo agregar: ' + error.message, 'error'); return; }
    await _a001Reload();
}

async function a001RenameItem(id, value) {
    const name = value.trim();
    if(!name) { renderA001Editor(); return; }
    const { error } = await supabaseClient.from('checklist_a001_items').update({ name }).eq('id', id);
    if(error) { showToast(error.message, 'error'); return; }
    await _a001Reload();
}

async function a001ChangeGroup(id, value) {
    let group = value;
    if(value === '__new__') { group = _a001AskGroup(); if(!group) { renderA001Editor(); return; } }
    const { error } = await supabaseClient.from('checklist_a001_items').update({ group_name: group }).eq('id', id);
    if(error) { showToast(error.message, 'error'); return; }
    await _a001Reload();
}

async function a001Move(id, dir) {
    const rows = _a001Rows();
    const i = rows.findIndex(r => r.id === id);
    const j = i + dir;
    if(i < 0 || j < 0 || j >= rows.length) return;
    const [a, b] = [rows[i], rows[j]];
    // Reescribe el orden completo para evitar empates de sort_order
    const reordered = rows.slice();
    reordered[i] = b; reordered[j] = a;
    const payload = reordered.map((r, k) => ({ id: r.id, group_name: r.group_name, name: r.name, sort_order: k + 1 }));
    const { error } = await supabaseClient.from('checklist_a001_items').upsert(payload, { onConflict: 'id' });
    if(error) { showToast(error.message, 'error'); return; }
    await _a001Reload();
}

async function a001Delete(id) {
    const r = dbA001Items.find(x => x.id === id);
    if(!r || !confirm(`¿Quitar "${r.name}" de la lista A001?\n\nLos checklists ya hechos conservan su nombre.`)) return;
    const { error } = await supabaseClient.from('checklist_a001_items').delete().eq('id', id);
    if(error) { showToast(error.message, 'error'); return; }
    await _a001Reload();
}


// ── Vincular líneas de la lista A001 con equipos del Inventario ───────────────
let _a001LinkLine = null;
let _a001LinkSel = new Set();

function openA001Linker(lineId) {
    _a001LinkLine = lineId;
    _a001LinkSel = new Set(_a001LinkedItems(lineId).map(i => i.id));
    const line = _a001Items().find(i => i.id === lineId);
    document.getElementById('a001Link_title').textContent = `Equipos de Inventario para «${line?.name || ''}»`;
    document.getElementById('a001Link_filter').value = '';
    document.getElementById('a001Link_kit').innerHTML =
        '<option value="">Todos los kits</option><option value="__none__">Sin kit</option>' +
        dbInventoryKits.map(k => `<option value="${k.id}">${_escHtml(k.name)}</option>`).join('');
    renderA001Linker();
    document.getElementById('a001LinkModal').classList.add('active');
}

function _a001LinkVisible() {
    const q = (document.getElementById('a001Link_filter').value || '').trim().toLowerCase();
    const kit = document.getElementById('a001Link_kit').value;
    return dbInventoryItems.filter(i =>
        (!q || `${i.name} ${i.serial_number || ''}`.toLowerCase().includes(q)) &&
        (!kit || (kit === '__none__' ? !i.kit_id : i.kit_id === kit)));
}

function renderA001Linker() {
    const list = _a001LinkVisible();
    const lines = _a001Items();
    document.getElementById('a001Link_count').textContent = `${_a001LinkSel.size} seleccionados · ${list.length} equipos en la vista`;
    document.getElementById('a001Link_list').innerHTML = list.slice(0, 300).map(i => {
        const other = i.a001_item_id && i.a001_item_id !== _a001LinkLine ? lines.find(l => l.id === i.a001_item_id)?.name : null;
        const kit = dbInventoryKits.find(k => k.id === i.kit_id)?.name;
        return `<label style="display:flex;gap:0.5rem;align-items:center;padding:0.3rem 0;border-bottom:1px solid #f1f5f9;font-size:0.82rem;cursor:pointer;">
            <input type="checkbox" ${_a001LinkSel.has(i.id) ? 'checked' : ''} onchange="_a001LinkToggle('${i.id}', this.checked)">
            <span style="flex:1;">${_escHtml(i.name)}${i.serial_number ? ` <span style="color:#94a3b8;">· ${_escHtml(i.serial_number)}</span>` : ''}</span>
            ${kit ? `<span style="font-size:0.7rem;color:#7c3aed;">🧰 ${_escHtml(kit)}</span>` : ''}
            ${other ? `<span style="font-size:0.7rem;color:#b45309;" title="Al guardar pasará a esta línea">ya está en «${_escHtml(other)}»</span>` : ''}
        </label>`;
    }).join('') || '<div style="color:#94a3b8;padding:1rem;text-align:center;">Sin equipos con ese filtro.</div>';
}

function _a001LinkToggle(id, checked) {
    if(checked) _a001LinkSel.add(id); else _a001LinkSel.delete(id);
    document.getElementById('a001Link_count').textContent = `${_a001LinkSel.size} seleccionados · ${_a001LinkVisible().length} equipos en la vista`;
}

function a001LinkAllVisible(checked) {
    _a001LinkVisible().forEach(i => { if(checked) _a001LinkSel.add(i.id); else _a001LinkSel.delete(i.id); });
    renderA001Linker();
}

async function saveA001Linker() {
    const lineId = _a001LinkLine;
    if(!lineId) return;
    const r1 = await supabaseClient.from('inventory_items').update({ a001_item_id: null }).eq('a001_item_id', lineId);
    let err = r1.error;
    if(!err && _a001LinkSel.size) err = (await supabaseClient.from('inventory_items').update({ a001_item_id: lineId }).in('id', [..._a001LinkSel])).error;
    if(err) {
        showToast(/a001_item_id|schema cache/i.test(err.message || '') ? 'Falta ejecutar la migración del enlace A001 ↔ inventario en Supabase.' : err.message, 'error');
        return;
    }
    closeModal('a001LinkModal');
    await loadInventoryData();
    renderA001Editor();
    if(_ck) renderTaskChecklist();
    showToast('Equipos vinculados ✓', 'success');
}

function renderTaskChecklist() {
    if(!_ck) return;
    const task = tasks.find(t => t.id === _ck.taskId);
    const body = document.getElementById('ck_body');
    if(!task || !body) return;

    const prog = _ckProgress(_ck.data);
    const stage = _CK_STAGES.find(s => s.id === _ck.stage) || _CK_STAGES[0];

    document.getElementById('ck_title').textContent = `Checklist de servicio — ${cleanClientName(task.client)}${task.plantName ? ' · ' + task.plantName : ''}`;
    const fieldDates = (task.scheduledDays || []).filter(d => d.type === 'field').map(d => d.date).sort();
    const fmtD = (d) => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; };
    document.getElementById('ck_subtitle').innerHTML =
        `Rotodinámico · ${_escHtml(formatAnalystDisplay ? formatAnalystDisplay(task) : (task.analyst || ''))}` +
        `${fieldDates.length ? ' · Planta: ' + fieldDates.map(fmtD).join(', ') : ''}` +
        `${task.equipment ? ' · Equipo: ' + _escHtml(task.equipment) : ''}` +
        `<br><span style="color:#94a3b8;">La fecha, planta, analistas y equipos ya quedan asociados a la gestión.</span>`;

    document.getElementById('ck_tabs').innerHTML = _CK_STAGES.map(st => {
        const p = prog.byStage[st.id];
        const done = p.answered === p.total;
        return `<button class="${st.id === stage.id ? 'active' : ''}" onclick="ckSetStage('${st.id}')" style="white-space:nowrap;">${st.icon} ${st.label} <span style="font-size:0.72rem;color:${done ? '#15803d' : '#94a3b8'};">${p.answered}/${p.total}</span></button>`;
    }).join('');

    document.getElementById('ck_progress').innerHTML =
        `<div style="background:#e2e8f0;border-radius:99px;height:6px;overflow:hidden;"><div style="width:${Math.round(prog.answered / prog.total * 100)}%;height:100%;background:${prog.fails ? '#d97706' : '#16a34a'};"></div></div>
         <div style="font-size:0.72rem;color:#64748b;margin-top:3px;">${prog.answered} de ${prog.total} puntos${prog.fails ? ` · <span style="color:#b91c1c;font-weight:700;">${prog.fails} con novedad</span>` : ''}</div>`;

    const btn = (itemId, state, label, color, bg) => {
        const on = (_ck.data.items[itemId]?.s === state);
        return `<button onclick="ckSetItem('${itemId}', '${state}')" style="min-width:42px;padding:3px 9px;border-radius:7px;border:1.5px solid ${on ? color : '#cbd5e1'};background:${on ? bg : '#fff'};color:${on ? color : '#94a3b8'};font-weight:800;font-size:0.8rem;cursor:pointer;">${label}</button>`;
    };

    const itemsHtml = stage.items.map(it => {
        const st = _ck.data.items[it.id] || {};
        const showNote = st.s === 'fail' || st.note;
        return `<div style="padding:0.65rem 0;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;gap:0.75rem;align-items:flex-start;">
                <div style="flex:1;font-size:0.85rem;line-height:1.4;">${_escHtml(it.text)}${it.hint ? `<div style="font-size:0.72rem;color:#94a3b8;margin-top:2px;">${_escHtml(it.hint)}</div>` : ''}</div>
                <div style="display:flex;gap:0.3rem;flex-shrink:0;">${btn(it.id, 'ok', '✔', '#15803d', '#dcfce7')}${btn(it.id, 'fail', '✖', '#b91c1c', '#fee2e2')}${btn(it.id, 'na', 'N/A', '#475569', '#e2e8f0')}</div>
            </div>
            ${showNote ? `<input type="text" value="${_escHtml(st.note || '')}" placeholder="${st.s === 'fail' ? 'Describe la novedad…' : 'Observación (opcional)'}" oninput="ckSetNote('${it.id}', this.value)" style="margin-top:0.4rem;width:100%;padding:0.4rem 0.55rem;border:1px solid ${st.s === 'fail' ? '#fca5a5' : '#cbd5e1'};border-radius:6px;font-size:0.8rem;">` : ''}
        </div>`;
    }).join('');

    const guideHtml = stage.guide?.length ? `
        <details style="margin-top:0.85rem;border:1px solid #e2e8f0;border-radius:10px;padding:0.55rem 0.9rem;background:#f8fafc;">
            <summary style="cursor:pointer;font-size:0.78rem;font-weight:700;color:#475569;">📖 Guía de consulta de esta etapa</summary>
            <ul style="margin:0.5rem 0 0.2rem 1.1rem;font-size:0.78rem;color:#475569;line-height:1.5;">${stage.guide.map(g => `<li>${_escHtml(g)}</li>`).join('')}</ul>
        </details>` : '';

    body.innerHTML = _a001Section(stage, task) + itemsHtml + _ckStageExtras(stage.id) + guideHtml;
    if(_ck.readOnly) {
        body.querySelectorAll('input, select, textarea, button').forEach(el => { el.disabled = true; });
        document.getElementById('ck_subtitle').insertAdjacentHTML('beforeend', '<br><span style="color:#b45309;font-weight:700;">👁 Solo lectura</span>');
    }
    _ckUpdateStatus();
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSUMIBLES (masas de balanceo, Loctite, shims, ...): stock que se gasta, con alerta
// ══════════════════════════════════════════════════════════════════════════════

function _escHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function _fmtQty(n) {
    const v = Number(n) || 0;
    return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(2)));
}

/** Nivel del consumible: porcentaje de la barra, etiqueta y si está en alerta. */
function _consumableStatus(c) {
    const stock = Number(c.stock) || 0;
    const min = Number(c.min_stock) || 0;
    const reorder = Number(c.reorder_qty) || 0;
    const target = Math.max(min + reorder, stock, 1);
    const pct = Math.max(0, Math.min(100, (stock / target) * 100));
    if(stock <= 0)   return { label:'Agotado',    color:'#dc2626', bg:'#fef2f2', pct, low:true };
    if(stock <= min) return { label:'Stock bajo', color:'#dc2626', bg:'#fef2f2', pct, low:true };
    if(min > 0 && stock <= min * 1.5) return { label:'Próximo a agotarse', color:'#d97706', bg:'#fffbeb', pct, low:false };
    return { label:'OK', color:'#16a34a', bg:'#f0fdf4', pct, low:false };
}

/** Tabla de consumibles; la usan la pestaña del admin y la vista del analista. */
function _consumablesListHTML(isAdmin) {
    const list = dbInventoryConsumables;
    if(list.length === 0) {
        return `<div style="text-align:center;padding:2rem;color:#94a3b8;font-size:0.85rem;">${isAdmin ? 'Aún no hay consumibles. Crea el primero con "+ Nuevo consumible".' : 'No hay consumibles registrados.'}</div>`;
    }
    const low = list.filter(c => _consumableStatus(c).low);
    const banner = low.length ? `
        <div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:0.6rem 0.9rem;margin-bottom:1rem;font-size:0.82rem;font-weight:600;">
            ⚠️ ${low.length} consumible${low.length !== 1 ? 's' : ''} en nivel bajo: ${low.map(c => _escHtml(c.name)).join(', ')}
        </div>` : '';

    const rows = list.map(c => {
        const st = _consumableStatus(c);
        const unit = _escHtml(c.unit || 'unidades');
        const actions = `
            <div class="action-icons" style="justify-content:flex-end;gap:0.4rem;">
                <span class="viewer-hide">${actionIcon('consume', `openConsumableMovementModal('consumo','${c.id}')`, 'Registrar consumo')}</span>
                ${isAdmin ? actionIcon('entry', `openConsumableMovementModal('entrada','${c.id}')`, 'Registrar entrada de stock') : ''}
                ${isAdmin ? actionIcon('adjust', `openConsumableMovementModal('ajuste','${c.id}')`, 'Ajustar stock (conteo físico)') : ''}
                ${actionIcon('history', `openConsumableHistory('${c.id}')`, 'Ver movimientos')}
                ${isAdmin ? actionIcon('edit', `openEditInventoryConsumableModal('${c.id}')`, 'Editar') : ''}
                ${isAdmin ? actionIcon('delete', `deleteInventoryConsumable('${c.id}')`, 'Eliminar') : ''}
            </div>`;
        return `
        <tr>
            <td>
                <strong>${_escHtml(c.name)}</strong>
                <div style="font-size:0.72rem;color:#64748b;">${_invCatLabel[c.category] || _escHtml(c.category || '')}${c.description ? ` · ${_escHtml(c.description)}` : ''}</div>
            </td>
            <td style="min-width:130px;">
                <div style="background:#e2e8f0;border-radius:99px;height:8px;overflow:hidden;">
                    <div style="width:${st.pct}%;height:100%;background:${st.color};"></div>
                </div>
            </td>
            <td style="text-align:right;font-weight:700;white-space:nowrap;">${_fmtQty(c.stock)} <span style="font-weight:400;color:#64748b;font-size:0.75rem;">${unit}</span></td>
            <td style="font-size:0.74rem;color:#64748b;white-space:nowrap;">Alerta ≤ ${_fmtQty(c.min_stock)}${Number(c.reorder_qty) > 0 ? `<br>Reponer ${_fmtQty(c.reorder_qty)}` : ''}</td>
            <td><span style="background:${st.bg};color:${st.color};border:1px solid ${st.color}33;border-radius:99px;padding:2px 9px;font-size:0.72rem;font-weight:700;white-space:nowrap;">${st.label}</span></td>
            <td style="text-align:right;white-space:nowrap;">${actions}</td>
        </tr>`;
    }).join('');

    return `
        ${banner}
        <div style="overflow-x:auto;">
            <table class="data-table" style="font-size:0.82rem;">
                <thead>
                    <tr>
                        <th>Consumible</th>
                        <th>Nivel</th>
                        <th style="text-align:right;">Stock</th>
                        <th>Alerta / reposición</th>
                        <th>Estado</th>
                        <th style="text-align:right;">Acciones</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function renderInventoryConsumables() {
    const el = document.getElementById('inv-tab-content');
    if(!el) return;
    const isAdmin = currentUserProfile?.role === 'admin';
    el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap;">
            <p style="font-size:0.82rem;color:#64748b;margin:0;">Materiales que se gastan (no se devuelven). Cuando el stock baja del nivel de alerta, el sistema te notifica.</p>
            <div style="display:flex;gap:0.5rem;">
                <button class="btn-outline viewer-hide" onclick="openConsumableMovementModal('consumo')">− Registrar consumo</button>
                ${isAdmin ? `<button class="btn-primary" onclick="openAddInventoryConsumableModal()">+ Nuevo consumible</button>` : ''}
            </div>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);padding:1.25rem;">
            ${_consumablesListHTML(isAdmin)}
        </div>`;
}

// ── Crear / editar consumible (admin) ─────────────────────────────────────────
function _fillConsumableCategorySelect(selected) {
    const sel = document.getElementById('invCons_category');
    sel.innerHTML = _invCategories.map(c => `<option value="${c}">${_invCatLabel[c] || c}</option>`).join('');
    sel.value = _invCategories.includes(selected) ? selected : 'General';
}

function openAddInventoryConsumableModal() {
    document.getElementById('invCons_modalTitle').textContent = 'Agregar Consumible';
    document.getElementById('invCons_editId').value = '';
    document.getElementById('invCons_name').value = '';
    _fillConsumableCategorySelect('Balanceo');
    document.getElementById('invCons_unit').value = 'unidades';
    document.getElementById('invCons_stock').value = '0';
    document.getElementById('invCons_stockRow').style.display = '';
    document.getElementById('invCons_min').value = '0';
    document.getElementById('invCons_reorder').value = '0';
    document.getElementById('invCons_description').value = '';
    document.getElementById('inventoryConsumableModal').classList.add('active');
}

function openEditInventoryConsumableModal(id) {
    const c = dbInventoryConsumables.find(x => x.id === id);
    if(!c) return;
    document.getElementById('invCons_modalTitle').textContent = 'Editar Consumible';
    document.getElementById('invCons_editId').value = id;
    document.getElementById('invCons_name').value = c.name || '';
    _fillConsumableCategorySelect(c.category);
    document.getElementById('invCons_unit').value = c.unit || 'unidades';
    // El stock solo cambia con movimientos (entrada / ajuste) para conservar el historial
    document.getElementById('invCons_stockRow').style.display = 'none';
    document.getElementById('invCons_min').value = c.min_stock ?? 0;
    document.getElementById('invCons_reorder').value = c.reorder_qty ?? 0;
    document.getElementById('invCons_description').value = c.description || '';
    document.getElementById('inventoryConsumableModal').classList.add('active');
}

async function saveInventoryConsumable() {
    const name = document.getElementById('invCons_name').value.trim();
    if(!name) { showToast('El nombre es obligatorio', 'error'); return; }
    const num = (id) => Math.max(0, parseFloat(document.getElementById(id).value) || 0);

    const payload = {
        name,
        category: document.getElementById('invCons_category').value,
        unit: document.getElementById('invCons_unit').value,
        min_stock: num('invCons_min'),
        reorder_qty: num('invCons_reorder'),
        description: document.getElementById('invCons_description').value.trim() || null
    };

    const editId = document.getElementById('invCons_editId').value;
    let error, savedId = editId;
    if(editId) {
        ({ error } = await supabaseClient.from('inventory_consumables').update(payload).eq('id', editId));
    } else {
        payload.stock = num('invCons_stock');
        let data;
        ({ data, error } = await supabaseClient.from('inventory_consumables').insert(payload).select('id').single());
        savedId = data?.id;
    }
    if(error) { showToast('Error guardando consumible: ' + error.message, 'error'); return; }

    // Recalcula la alerta (por si cambió el nivel de alerta o el stock inicial ya está bajo)
    if(savedId) await supabaseClient.rpc('sync_consumable_alert', { p_consumable_id: savedId });

    showToast(editId ? 'Consumible actualizado' : 'Consumible agregado', 'success');
    closeModal('inventoryConsumableModal');
    await loadInventoryData();
    renderInventoryView();
    loadMyNotifications().catch(() => {});
}

async function deleteInventoryConsumable(id) {
    const c = dbInventoryConsumables.find(x => x.id === id);
    if(!c) return;
    if(!confirm(`¿Eliminar "${c.name}"?\n\nSe borrará también todo su historial de movimientos.`)) return;
    const { error } = await supabaseClient.from('inventory_consumables').delete().eq('id', id);
    if(error) { showToast('Error eliminando: ' + error.message, 'error'); return; }
    // Cierra la alerta pendiente de este consumible, si la había
    const nowIso = new Date().toISOString();
    await supabaseClient.from('notifications')
        .update({ resolved_at: nowIso, read_at: nowIso })
        .eq('type', 'consumible_bajo').contains('data', { consumable_id: id }).is('resolved_at', null);
    showToast('Consumible eliminado', 'success');
    await loadInventoryData();
    renderInventoryView();
    loadMyNotifications().catch(() => {});
}

// ── Registrar consumo / entrada / ajuste ──────────────────────────────────────
const _consMovTexts = {
    consumo: { title: 'Registrar consumo',          qty: 'Cantidad consumida *',   btn: 'Confirmar consumo', sub: 'Se descuenta del stock total.' },
    entrada: { title: 'Registrar entrada de stock', qty: 'Cantidad que ingresa *', btn: 'Confirmar entrada', sub: 'Reposición recibida o fabricada: se suma al stock.' },
    ajuste:  { title: 'Ajustar stock',              qty: 'Stock real contado *',   btn: 'Confirmar ajuste',  sub: 'Fija el stock en el valor del conteo físico.' }
};

function _consumableTaskOptions() {
    const role = currentUserProfile?.role;
    const me = currentUserProfile?.analyst_name;
    let list = tasks.filter(t => !t.isAbsence
        && t.serviceType !== 'Metro Administrativo' && t.serviceType !== 'Metro Terceros'
        && !String(t.id).startsWith('t_'));
    if(role === 'analyst' && me) list = list.filter(t => t.analysts_assignment?.some(a => a.name === me));
    list.sort((a, b) => (b.period || '').localeCompare(a.period || ''));
    return list.slice(0, 80);
}

function _consumableTaskLabel(t) {
    const [y, m] = String(t.period || '').split('-');
    const month = m ? `${monthNames[parseInt(m, 10) - 1]?.slice(0, 3)} ${y}` : '';
    return `${t.client || '—'}${t.plantName ? ' – ' + t.plantName : ''} · ${t.serviceType || '—'}${month ? ' · ' + month : ''}`;
}

function openConsumableMovementModal(type, consumableId = null, taskId = null) {
    if(dbInventoryConsumables.length === 0) { showToast('Aún no hay consumibles registrados', 'error'); return; }
    const T = _consMovTexts[type];
    document.getElementById('consMov_type').value = type;
    document.getElementById('consMov_title').textContent = T.title;
    document.getElementById('consMov_subtitle').textContent = T.sub;
    document.getElementById('consMov_qtyLabel').textContent = T.qty;
    document.getElementById('consMov_submit').textContent = T.btn;
    document.getElementById('consMov_qty').value = '';
    document.getElementById('consMov_notes').value = '';

    const sel = document.getElementById('consMov_consumable');
    sel.innerHTML = dbInventoryConsumables.map(c =>
        `<option value="${c.id}">${_escHtml(c.name)} — ${_fmtQty(c.stock)} ${_escHtml(c.unit || '')}</option>`).join('');
    if(consumableId) sel.value = consumableId;

    document.getElementById('consMov_taskRow').style.display = type === 'consumo' ? '' : 'none';
    document.getElementById('consMov_task').innerHTML =
        '<option value="">— Sin gestión asociada —</option>' +
        _consumableTaskOptions().map(t => `<option value="${t.id}">${_escHtml(_consumableTaskLabel(t))}</option>`).join('');

    if(taskId) {
        const taskSel = document.getElementById('consMov_task');
        if(![...taskSel.options].some(o => o.value === taskId)) {
            const tk = tasks.find(x => x.id === taskId);
            if(tk) taskSel.insertAdjacentHTML('beforeend', `<option value="${tk.id}">${_escHtml(_consumableTaskLabel(tk))}</option>`);
        }
        taskSel.value = taskId;
    }

    document.getElementById('consMov_qty').oninput = _consMovRefreshHint;
    _consMovRefreshHint();
    document.getElementById('consumableMovementModal').classList.add('active');
}

function _consMovRefreshHint() {
    const c = dbInventoryConsumables.find(x => x.id === document.getElementById('consMov_consumable').value);
    const hint = document.getElementById('consMov_hint');
    if(!c) { hint.textContent = ''; return; }
    const type = document.getElementById('consMov_type').value;
    const q = parseFloat(document.getElementById('consMov_qty').value);
    const unit = c.unit || '';
    let text = `Stock actual: ${_fmtQty(c.stock)} ${unit}`;
    if(!isNaN(q) && q >= 0) {
        const after = type === 'consumo' ? Number(c.stock) - q : type === 'entrada' ? Number(c.stock) + q : q;
        text += ` → quedará en ${_fmtQty(after)} ${unit}`;
        if(type === 'consumo' && q > Number(c.stock)) text += ' (no alcanza el stock)';
    }
    hint.textContent = text;
}

async function submitConsumableMovement() {
    const type = document.getElementById('consMov_type').value;
    const id = document.getElementById('consMov_consumable').value;
    const qty = parseFloat(document.getElementById('consMov_qty').value);
    const c = dbInventoryConsumables.find(x => x.id === id);
    if(!c) { showToast('Selecciona un consumible', 'error'); return; }
    if(isNaN(qty) || qty < 0 || (type !== 'ajuste' && qty === 0)) { showToast('Ingresa una cantidad válida', 'error'); return; }
    if(type === 'consumo' && qty > Number(c.stock)) { showToast(`Solo quedan ${_fmtQty(c.stock)} ${c.unit || ''}`, 'error'); return; }

    const analyst = currentUserProfile?.analyst_name || currentUserProfile?.display_name || currentUser?.email || null;
    const btn = document.getElementById('consMov_submit');
    btn.disabled = true;
    try {
        const { data: newStock, error } = await supabaseClient.rpc('register_consumable_movement', {
            p_consumable_id: id,
            p_type: type,
            p_quantity: qty,
            p_analyst: analyst,
            p_task_id: type === 'consumo' ? (document.getElementById('consMov_task').value || null) : null,
            p_notes: document.getElementById('consMov_notes').value.trim() || null
        });
        if(error) {
            const missing = /could not find the function|schema cache/i.test(error.message || '');
            showToast(missing ? 'Falta ejecutar la migración de consumibles en Supabase.' : error.message, 'error');
            return;
        }
        closeModal('consumableMovementModal');
        const nowLow = _consumableStatus({ ...c, stock: newStock }).low;
        if(type === 'consumo') {
            showToast(nowLow
                ? `Consumo registrado. ⚠️ Quedan ${_fmtQty(newStock)} ${c.unit || ''}: se avisó al administrador.`
                : `Consumo registrado. Quedan ${_fmtQty(newStock)} ${c.unit || ''}.`, 'success');
        } else {
            showToast(`Stock actualizado: ${_fmtQty(newStock)} ${c.unit || ''}.`, 'success');
        }
        await loadInventoryData();
        renderInventoryView();
        loadMyNotifications().catch(() => {});
    } finally {
        btn.disabled = false;
    }
}

// ── Historial de movimientos de un consumible ─────────────────────────────────
async function openConsumableHistory(id) {
    const c = dbInventoryConsumables.find(x => x.id === id);
    if(!c) return;
    document.getElementById('consHist_title').textContent = `Movimientos — ${c.name}`;
    document.getElementById('consHist_subtitle').textContent = `Stock actual: ${_fmtQty(c.stock)} ${c.unit || ''}`;
    const body = document.getElementById('consHist_body');
    body.innerHTML = '<div style="text-align:center;padding:2rem;color:#94a3b8;">Cargando…</div>';
    document.getElementById('consumableHistoryModal').classList.add('active');

    const { data, error } = await supabaseClient
        .from('inventory_consumable_movements').select('*')
        .eq('consumable_id', id).order('created_at', { ascending: false }).limit(200);
    if(error) { body.innerHTML = `<div style="padding:1.5rem;color:#dc2626;">Error: ${_escHtml(error.message)}</div>`; return; }
    if(!data || data.length === 0) { body.innerHTML = '<div style="text-align:center;padding:2rem;color:#94a3b8;">Sin movimientos todavía.</div>'; return; }

    const since = Date.now() - 30 * 86400000;
    const used30 = data.filter(m => m.type === 'consumo' && new Date(m.created_at).getTime() >= since)
                       .reduce((s, m) => s + Number(m.quantity), 0);
    document.getElementById('consHist_subtitle').textContent =
        `Stock actual: ${_fmtQty(c.stock)} ${c.unit || ''} · Consumido en los últimos 30 días: ${_fmtQty(used30)} ${c.unit || ''}`;

    const chip = (m) => {
        if(m.type === 'consumo') return `<span style="color:#dc2626;font-weight:700;">− ${_fmtQty(m.quantity)}</span>`;
        if(m.type === 'entrada') return `<span style="color:#16a34a;font-weight:700;">＋ ${_fmtQty(m.quantity)}</span>`;
        return `<span style="color:#2563eb;font-weight:700;">Ajuste → ${_fmtQty(m.quantity)}</span>`;
    };
    body.innerHTML = `
        <table class="data-table" style="font-size:0.8rem;">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Stock</th><th>Analista</th><th>Gestión</th><th>Observaciones</th></tr></thead>
            <tbody>${data.map(m => {
                const t = m.task_id ? tasks.find(x => x.id === m.task_id) : null;
                return `<tr>
                    <td style="white-space:nowrap;">${new Date(m.created_at).toLocaleString('es-CO', { day:'numeric', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                    <td>${chip(m)}</td>
                    <td style="white-space:nowrap;color:#64748b;">${_fmtQty(m.stock_before)} → <strong>${_fmtQty(m.stock_after)}</strong></td>
                    <td>${_escHtml(m.analyst_name || '—')}</td>
                    <td style="font-size:0.74rem;">${m.task_id ? _escHtml(t ? _consumableTaskLabel(t) : 'Gestión no disponible') : '<span style="color:#cbd5e1;">—</span>'}</td>
                    <td style="font-size:0.76rem;color:#475569;">${m.notes ? _escHtml(m.notes) : '<span style="color:#cbd5e1;">—</span>'}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
}

let _invHistorialCache = [];
let _invHistorialFilters = { analyst: '', service: '', dateFrom: '', dateTo: '' };
let _invShowUsageRanking = false;
let _invRankingExpanded  = new Set(); // categorías expandidas en el ranking (vacío = todas colapsadas)
let _invHistGroupExpanded = new Set(); // kit_loan_id de grupos expandidos en el historial
let invHistSortState = { column: null, dir: 'asc' };

function sortInvHistBy(column) {
    if (invHistSortState.column === column) {
        invHistSortState.dir = invHistSortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        invHistSortState.column = column;
        invHistSortState.dir = 'asc';
    }
    _renderInventoryHistorialFiltered();
}

function toggleInvUsageRanking() {
    _invShowUsageRanking = !_invShowUsageRanking;
    _renderInventoryHistorialFiltered();
}

function toggleInvRankingGroup(cat) {
    if(_invRankingExpanded.has(cat)) _invRankingExpanded.delete(cat);
    else _invRankingExpanded.add(cat);
    _renderInventoryHistorialFiltered();
}

function toggleInvHistGroup(groupId) {
    if(_invHistGroupExpanded.has(groupId)) _invHistGroupExpanded.delete(groupId);
    else _invHistGroupExpanded.add(groupId);
    _renderInventoryHistorialFiltered();
}

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
    _invHistorialFilters = { analyst: '', service: '', dateFrom: '', dateTo: '' };
    _renderInventoryHistorialFiltered();
}

function applyInvHistorialFilters() {
    _invHistorialFilters.analyst  = document.getElementById('invHist_filterAnalyst')?.value || '';
    _invHistorialFilters.service  = document.getElementById('invHist_filterService')?.value || '';
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
    let data = _invHistorialCache.filter(loan => {
        if(f.analyst && loan.analyst_name !== f.analyst) return false;
        if(f.service) {
            const itm = dbInventoryItems.find(i => i.id === loan.item_id);
            if(!itm || itm.category !== f.service) return false;
        }
        if(f.dateFrom && loan.checked_out_at < f.dateFrom) return false;
        if(f.dateTo && loan.checked_out_at > f.dateTo + 'T23:59:59') return false;
        return true;
    });

    // ── Ranking de frecuencia de uso (salidas históricas + préstamos activos), ──
    // ── agrupado por categoría para que no crezca sin control ───────────────────
    const usageCount = {};
    _invHistorialCache.forEach(l => { usageCount[l.item_id] = (usageCount[l.item_id]||0) + 1; });
    dbInventoryLoans.forEach(l => { usageCount[l.item_id] = (usageCount[l.item_id]||0) + 1; });
    const ranking = dbInventoryItems.map(item => ({ item, count: usageCount[item.id] || 0 }))
        .sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, ...ranking.map(r => r.count));

    const rankingByCat = {};
    ranking.forEach(r => {
        const cat = r.item.category || 'General';
        (rankingByCat[cat] = rankingByCat[cat] || []).push(r);
    });
    const catGroups = Object.entries(rankingByCat)
        .map(([cat, rows]) => ({ cat, rows, total: rows.reduce((s,r) => s + r.count, 0) }))
        .sort((a, b) => b.total - a.total);

    const rankingToggleHTML = ranking.length === 0 ? '' : `
        <div style="margin-bottom:1.25rem;">
            <button onclick="toggleInvUsageRanking()" style="background:none;border:1px solid #cbd5e1;border-radius:6px;padding:6px 12px;font-size:0.78rem;color:#475569;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
                📊 ${_invShowUsageRanking ? 'Ocultar' : 'Ver'} frecuencia de uso por ítem
            </button>
        </div>`;

    const rankingHTML = (!_invShowUsageRanking || ranking.length === 0) ? '' : `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);padding:1.25rem;margin-bottom:1.5rem;">
            <h4 style="margin:0 0 1rem;font-size:0.85rem;color:var(--clr-blue);">📊 Frecuencia de uso por ítem</h4>
            ${catGroups.map(g => {
                const expanded = _invRankingExpanded.has(g.cat);
                const top = g.rows[0];
                return `
                <div style="margin-bottom:0.75rem;">
                    <div onclick="toggleInvRankingGroup('${g.cat}')" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;padding:0.5rem 0.6rem;background:#f8fafc;border-radius:8px;">
                        <span style="display:inline-block;font-size:0.75rem;color:#94a3b8;transition:transform .15s;transform:rotate(${expanded?'0':'-90'}deg);">▾</span>
                        <span style="font-size:0.8rem;font-weight:700;color:#334155;">${_invCatLabel[g.cat]||g.cat}</span>
                        <span style="font-size:0.72rem;color:#94a3b8;">(${g.rows.length} ítem${g.rows.length!==1?'s':''})</span>
                        <span style="margin-left:auto;font-size:0.72rem;color:#64748b;">${top && top.count > 0 ? `más usado: ${top.item.name} (${top.count})` : 'sin movimientos'}</span>
                    </div>
                    ${!expanded ? '' : `
                    <div style="padding:0.75rem 0.5rem 0.25rem;">
                        ${g.rows.map(r => `
                            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
                                <div style="flex:0 0 180px;font-size:0.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.item.name}">${r.item.name}</div>
                                <div style="flex:1;background:#f1f5f9;border-radius:4px;height:14px;overflow:hidden;">
                                    <div style="width:${(r.count/maxCount*100).toFixed(0)}%;background:${r.count===0?'#cbd5e1':'var(--clr-blue)'};height:100%;"></div>
                                </div>
                                <div style="flex:0 0 70px;text-align:right;font-size:0.75rem;color:#64748b;">${r.count} salida${r.count!==1?'s':''}</div>
                            </div>
                        `).join('')}
                    </div>`}
                </div>`;
            }).join('')}
        </div>`;

    // ── Filtros ─────────────────────────────────────────────────────────────
    const analystOptions = [...new Set(_invHistorialCache.map(l => l.analyst_name))].sort();
    const filtersHTML = `
        <div class="filter-toolbar" style="align-items:flex-end;">
            <div style="flex:1;min-width:150px;">
                <label class="filter-label">Analista</label><br>
                <select id="invHist_filterAnalyst" onchange="applyInvHistorialFilters()" class="filter-select" style="width:100%;margin-top:4px;">
                    <option value="">Todos</option>
                    ${analystOptions.map(a => `<option value="${a}" ${f.analyst===a?'selected':''}>${a}</option>`).join('')}
                </select>
            </div>
            <div style="flex:1;min-width:150px;">
                <label class="filter-label">Servicio</label><br>
                <select id="invHist_filterService" onchange="applyInvHistorialFilters()" class="filter-select" style="width:100%;margin-top:4px;">
                    <option value="">Todos</option>
                    ${_invCategories.map(c => `<option value="${c}" ${f.service===c?'selected':''}>${c}</option>`).join('')}
                </select>
            </div>
            <div style="min-width:130px;">
                <label class="filter-label">Desde</label><br>
                <input type="date" id="invHist_filterFrom" value="${f.dateFrom}" onchange="applyInvHistorialFilters()" class="filter-select" style="width:100%;margin-top:4px;">
            </div>
            <div style="min-width:130px;">
                <label class="filter-label">Hasta</label><br>
                <input type="date" id="invHist_filterTo" value="${f.dateTo}" onchange="applyInvHistorialFilters()" class="filter-select" style="width:100%;margin-top:4px;">
            </div>
            <button class="filter-clear-btn" onclick="clearInvHistorialFilters()">✕ Limpiar filtros</button>
        </div>`;

    if(data.length === 0) {
        el.innerHTML = rankingToggleHTML + rankingHTML + filtersHTML + '<div style="text-align:center;padding:3rem;color:#94a3b8;">No hay movimientos con estos filtros.</div>';
        return;
    }

    // ── Agrupar por kit_loan_id ──────────────────────────────────────────────
    const shouldGroup = true;
    const kitGroupMap = new Map();
    const singleLoans = [];
    if(shouldGroup) {
        data.forEach(loan => {
            if(loan.kit_loan_id) {
                if(!kitGroupMap.has(loan.kit_loan_id)) kitGroupMap.set(loan.kit_loan_id, []);
                kitGroupMap.get(loan.kit_loan_id).push(loan);
            } else {
                singleLoans.push(loan);
            }
        });
    } else {
        singleLoans.push(...data);
    }

    // Construir lista unificada de displayItems para ordenar
    const displayItems = [];
    kitGroupMap.forEach((loans, groupId) => {
        const repOut = loans.map(l => l.checked_out_at || '').sort()[0];
        const repIn  = loans.map(l => l.checked_in_at  || '').sort().pop();
        const days   = (repOut && repIn) ? Math.floor((new Date(repIn) - new Date(repOut)) / 86400000) : 0;
        const kit    = dbInventoryKits?.find(k => k.id === loans[0].kit_id);
        displayItems.push({ type: 'kit', groupId, loans, kit, analystName: loans[0].analyst_name, repOut, repIn, days });
    });
    singleLoans.forEach(loan => {
        const item = dbInventoryItems.find(i => i.id === loan.item_id);
        displayItems.push({ type: 'item', loan, item });
    });

    // Ordenamiento unificado
    const getDisplayVal = (di) => {
        if(di.type === 'kit') {
            switch(invHistSortState.column) {
                case 'out':     return di.repOut || '';
                case 'analyst': return (di.analystName || '').toLowerCase();
                case 'item':    return (di.kit?.name || '').toLowerCase();
                case 'in':      return di.repIn  || '';
                case 'days':    return di.days;
                default:        return di.repOut || '';
            }
        }
        const item = di.item;
        switch(invHistSortState.column) {
            case 'out':     return di.loan.checked_out_at || '';
            case 'analyst': return (di.loan.analyst_name || '').toLowerCase();
            case 'item':    return (item?.name || '').toLowerCase();
            case 'in':      return di.loan.checked_in_at  || '';
            case 'days':    return Math.floor((new Date(di.loan.checked_in_at) - new Date(di.loan.checked_out_at)) / 86400000);
            default:        return di.loan.checked_out_at || '';
        }
    };
    const dir = invHistSortState.column ? (invHistSortState.dir === 'asc' ? 1 : -1) : -1;
    displayItems.sort((a, b) => {
        const va = getDisplayVal(a), vb = getDisplayVal(b);
        if(typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), 'es') * dir;
    });

    const sortArrow = (col) => {
        if(invHistSortState.column !== col) return '<span style="opacity:0.3;">↕</span>';
        return invHistSortState.dir === 'asc' ? '↑' : '↓';
    };
    const thSort = (col, label) =>
        `<th onclick="sortInvHistBy('${col}')" style="cursor:pointer;user-select:none;">${label} <span style="font-size:0.75em;">${sortArrow(col)}</span></th>`;

    const rows = displayItems.map(di => {
        if(di.type === 'kit') {
            const expanded = _invHistGroupExpanded.has(di.groupId);
            const outDate  = new Date(di.repOut).toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' });
            const inDate   = di.repIn ? new Date(di.repIn).toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' }) : '—';
            const kitName  = di.kit?.name || `Kit (${di.loans.length} ítems)`;
            const arrow    = expanded ? '▾' : '▸';
            const headerRow = `
            <tr onclick="toggleInvHistGroup('${di.groupId}')" style="cursor:pointer;background:#f0f9ff;border-bottom:1px solid #e0f0ff;">
                <td style="color:#64748b;">${outDate}</td>
                <td><strong>${di.analystName}</strong></td>
                <td>
                    <span style="display:inline-flex;align-items:center;gap:5px;">
                        <span style="font-size:0.78rem;color:#64748b;line-height:1;">${arrow}</span>
                        🧰 <strong>${kitName}</strong>
                    </span>
                    <div style="font-size:0.72rem;color:#2563eb;margin-top:2px;">${di.loans.length} ítem${di.loans.length!==1?'s':''} · clic para ${expanded?'colapsar':'ver detalle'}</div>
                </td>
                <td style="color:#64748b;">${inDate}</td>
                <td style="color:#64748b;">${di.days} día${di.days!==1?'s':''}</td>
            </tr>`;
            if(!expanded) return headerRow;
            const itemRows = di.loans.map(loan => {
                const item    = dbInventoryItems.find(i => i.id === loan.item_id);
                const iOut    = new Date(loan.checked_out_at).toLocaleDateString('es-CO', { day:'numeric', month:'short' });
                const iIn     = loan.checked_in_at ? new Date(loan.checked_in_at).toLocaleDateString('es-CO', { day:'numeric', month:'short' }) : '—';
                const iDays   = (loan.checked_in_at) ? Math.floor((new Date(loan.checked_in_at) - new Date(loan.checked_out_at)) / 86400000) : 0;
                return `
                <tr style="background:#f8fafc;">
                    <td style="color:#94a3b8;font-size:0.75rem;padding-left:1.5rem;">${iOut}</td>
                    <td></td>
                    <td style="padding-left:2rem;">
                        <span style="font-size:0.83rem;">${item?.name || '(ítem eliminado)'}${item?.serial_number ? ` <span style="color:#94a3b8;font-weight:400;">(${item.serial_number})</span>` : ''}</span>
                        <div style="font-size:0.7rem;color:#94a3b8;">${item ? (_invCatLabel[item.category]||item.category) : ''}</div>
                    </td>
                    <td style="color:#94a3b8;font-size:0.75rem;">${iIn}</td>
                    <td style="color:#94a3b8;font-size:0.75rem;">${iDays} día${iDays!==1?'s':''}</td>
                </tr>`;
            }).join('');
            return headerRow + itemRows;
        }
        // Ítem individual (préstamo sin kit_loan_id)
        const { loan, item } = di;
        const out  = new Date(loan.checked_out_at).toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' });
        const inn  = new Date(loan.checked_in_at).toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' });
        const days = Math.floor((new Date(loan.checked_in_at) - new Date(loan.checked_out_at)) / 86400000);
        return `
        <tr>
            <td style="color:#64748b;">${out}</td>
            <td><strong>${loan.analyst_name}</strong></td>
            <td>${item?.name || '(ítem eliminado)'}${item?.serial_number ? ` <span style="color:#94a3b8;font-weight:400;">(${item.serial_number})</span>` : ''}<div style="font-size:0.72rem;color:#94a3b8;">${item ? (_invCatLabel[item.category]||item.category) : ''}</div></td>
            <td style="color:#64748b;">${inn}</td>
            <td style="color:#64748b;">${days} día${days!==1?'s':''}</td>
        </tr>`;
    }).join('');

    el.innerHTML = rankingToggleHTML + rankingHTML + filtersHTML + `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:var(--radius-lg);overflow:hidden;">
            <table class="data-table" style="font-size:0.82rem;">
                <thead>
                    <tr>
                        ${thSort('out',     'Salida')}
                        ${thSort('analyst', 'Analista')}
                        ${thSort('item',    'Ítem / Kit')}
                        ${thSort('in',      'Devolución')}
                        ${thSort('days',    'Duración')}
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

function _populateInvKitSelect() {
    const sel = document.getElementById('invItem_kit');
    if(!sel) return;
    sel.innerHTML = '<option value="">— Ítem independiente —</option>' +
        dbInventoryKits.map(k => `<option value="${k.id}">🧰 ${k.name}</option>`).join('');
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
    _populateInvKitSelect();
    document.getElementById('invItem_kit').value = '';
    _invPendingPhotoBlob = null;
    document.getElementById('invItem_photoUrl').value = '';
    document.getElementById('invItem_photoFile').value = '';
    document.getElementById('invItem_photoPreview').style.display = 'none';
    document.getElementById('invItem_photoStatus').textContent = 'Se comprime automáticamente a menos de 150 KB.';
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
    _populateInvKitSelect();
    document.getElementById('invItem_kit').value = item.kit_id || '';
    if(item.assigned_analyst) {
        const sel = document.getElementById('invItem_analyst');
        if(sel) sel.value = item.assigned_analyst;
    }
    _invPendingPhotoBlob = null;
    document.getElementById('invItem_photoUrl').value = item.photo_url || '';
    document.getElementById('invItem_photoFile').value = '';
    const preview = document.getElementById('invItem_photoPreview');
    if(item.photo_url) { preview.src = item.photo_url; preview.style.display = 'block'; }
    else { preview.src = ''; preview.style.display = 'none'; }
    document.getElementById('invItem_photoStatus').textContent = 'Se comprime automáticamente a menos de 150 KB.';
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
        kit_id:                 document.getElementById('invItem_kit').value || null,
        requires_calibration:      requiresCalibration,
        last_calibration_date:     requiresCalibration ? (document.getElementById('invItem_lastCalibration').value || null) : null,
        calibration_interval_days: requiresCalibration ? (parseInt(document.getElementById('invItem_calibrationInterval').value) || 365) : null,
        status:                 'disponible'
    };

    const editId = document.getElementById('invItem_editId').value;
    let error, itemId = editId;

    if(editId) {
        delete payload.status; // no sobreescribir estado al editar
        ({ error } = await supabaseClient.from('inventory_items').update(payload).eq('id', editId));
    } else {
        const result = await supabaseClient.from('inventory_items').insert(payload).select().single();
        error = result.error;
        if(!error) itemId = result.data.id;
    }

    if(error) { showToast('Error guardando: ' + error.message, 'error'); return; }

    if(_invPendingPhotoBlob && itemId) {
        const photoUrl = await _uploadInvItemPhoto(itemId);
        if(photoUrl) await supabaseClient.from('inventory_items').update({ photo_url: photoUrl }).eq('id', itemId);
    }

    showToast(editId ? 'Ítem actualizado' : 'Ítem agregado', 'success');
    closeModal('inventoryItemModal');
    _invPendingPhotoBlob = null;
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

function showInventoryPhoto(itemId) {
    const item = dbInventoryItems.find(i => i.id === itemId);
    if(!item || !item.photo_url) return;
    document.getElementById('invPhoto_itemName').textContent = item.name;
    document.getElementById('invPhoto_img').src = item.photo_url;
    document.getElementById('inventoryPhotoModal').classList.add('active');
}

// ── QR ─────────────────────────────────────────────────────────────────────────

function _showInventoryQRModal(qrText, title, subtitle) {
    document.getElementById('invQR_itemName').textContent = title;
    document.getElementById('invQR_itemSerial').textContent = subtitle || '';
    const modal = document.getElementById('inventoryQRModal');
    modal.classList.add('active');
    modal.dataset.qrText = qrText;
    modal.dataset.printTitle = title;
    modal.dataset.printSubtitle = subtitle || '';
    const box = document.getElementById('invQR_canvas');
    box.innerHTML = '';
    setTimeout(() => {
        new QRCode(box, { text: qrText, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    }, 50);
}

function showInventoryQR(itemId) {
    const item = dbInventoryItems.find(i => i.id === itemId);
    if(!item) return;
    _showInventoryQRModal(itemId, item.name, item.serial_number ? `Serial: ${item.serial_number}` : '');
}

/** El QR de un kit lleva el prefijo "kit:" para que el escáner sepa distinguirlo de un ítem suelto. */
function showKitQR(kitId) {
    const kit = dbInventoryKits.find(k => k.id === kitId);
    if(!kit) return;
    _showInventoryQRModal(`kit:${kitId}`, `🧰 ${kit.name}`, 'Kit — al escanear abre el checklist');
}

function printInventoryQR() {
    const modal    = document.getElementById('inventoryQRModal');
    const box      = document.getElementById('invQR_canvas');
    const canvasEl = box.querySelector('canvas');
    const imgEl    = box.querySelector('img');
    const dataUrl  = canvasEl ? canvasEl.toDataURL('image/png') : (imgEl ? imgEl.src : '');
    const title    = modal.dataset.printTitle || '';
    const subtitle = modal.dataset.printSubtitle || '';
    const qrText   = modal.dataset.qrText || '';
    const win = window.open('', '_blank');
    win.document.write(`
        <html><head><title>QR ${title}</title>
        <style>body{font-family:Arial,sans-serif;text-align:center;padding:2rem;}
        h3{margin:0.5rem 0 0.25rem;}p{color:#64748b;font-size:0.8rem;}</style></head>
        <body onload="window.print(); window.close();">
            <img src="${dataUrl}" width="220" height="220">
            <h3>${title}</h3>
            ${subtitle ? `<p>${subtitle}</p>` : ''}
            <p style="font-size:0.65rem;color:#cbd5e1;margin-top:1rem;">${qrText}</p>
        </body></html>`);
    win.document.close();
}

// ── Modal de configuración de impresión de QR ──────────────────────────────────

function printAllInventoryQRs() { openPrintQRsModal('items'); }
function printAllKitQRs()       { openPrintQRsModal('kits');  }

let _invPrintMode = 'items';

function openPrintQRsModal(mode) {
    _invPrintMode = mode;
    const all = mode === 'kits' ? dbInventoryKits : dbInventoryItems;
    if(all.length === 0) { showToast('No hay elementos para imprimir', 'error'); return; }

    document.getElementById('invPrintConfigModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'invPrintConfigModal';
    modal.className = 'modal active';
    modal.innerHTML = `
    <div class="modal-content" style="max-width:480px;max-height:88vh;display:flex;flex-direction:column;padding:0;">
        <div style="padding:1rem 1.25rem;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">
            <h3 style="margin:0;font-size:1rem;color:#1e293b;">🖨️ Configurar impresión de QR</h3>
            <button onclick="document.getElementById('invPrintConfigModal').remove()" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:#94a3b8;line-height:1;">✕</button>
        </div>
        <div style="overflow-y:auto;flex:1;padding:1.25rem;">

            <div style="margin-bottom:1.5rem;">
                <div style="font-size:0.72rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Tamaño del QR</div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:0.75rem;">
                    ${[['8','Micro','(8 mm)'],['12','Pequeño','(12 mm)'],['18','Mediano','(18 mm)'],['28','Grande','(28 mm)']].map(([s,label,sub]) => `
                    <button id="invPrint_sz${s}" onclick="invPrintSetSize(${s})"
                        style="padding:8px 4px;border:1px solid #cbd5e1;border-radius:8px;font-size:0.75rem;cursor:pointer;background:#f8fafc;text-align:center;line-height:1.4;">
                        ${label}<br><span style="font-size:0.65rem;color:#94a3b8;">${sub}</span>
                    </button>`).join('')}
                </div>
                <div style="display:flex;align-items:center;gap:0.6rem;">
                    <span style="font-size:0.78rem;color:#64748b;white-space:nowrap;">Tamaño personalizado:</span>
                    <input type="number" id="invPrint_customSize" min="6" max="60" value="18"
                        oninput="invPrintCustomSize()"
                        style="width:64px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:0.85rem;text-align:center;">
                    <span style="font-size:0.78rem;color:#64748b;">mm</span>
                </div>
            </div>

            <div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                    <div style="font-size:0.72rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">
                        ${mode === 'kits' ? 'Kits' : 'Ítems'} a imprimir
                        (<span id="invPrint_count">${all.length}</span> de ${all.length})
                    </div>
                    <div style="display:flex;gap:0.4rem;">
                        <button onclick="invPrintSelectAll(true)"  style="font-size:0.7rem;padding:3px 10px;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;background:#f8fafc;">Todos</button>
                        <button onclick="invPrintSelectAll(false)" style="font-size:0.7rem;padding:3px 10px;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;background:#f8fafc;">Ninguno</button>
                    </div>
                </div>
                <div id="invPrint_itemList" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;max-height:280px;overflow-y:auto;">
                    ${all.map((item, i) => `
                    <label style="display:flex;align-items:center;gap:0.6rem;padding:0.45rem 0.75rem;cursor:pointer;${i%2===0?'background:#fff;':'background:#f8fafc;'}border-bottom:1px solid #f1f5f9;">
                        <input type="checkbox" data-id="${item.id}" checked onchange="_updateInvPrintCount(${all.length})"
                            style="width:15px;height:15px;flex-shrink:0;cursor:pointer;">
                        <span style="font-size:0.82rem;flex:1;">${mode==='kits'?'🧰 ':''}${item.name}</span>
                        ${item.serial_number?`<span style="font-size:0.7rem;color:#94a3b8;white-space:nowrap;">${item.serial_number}</span>`:''}
                    </label>`).join('')}
                </div>
            </div>
        </div>
        <div style="padding:0.875rem 1.25rem;border-top:1px solid #e2e8f0;display:flex;gap:0.75rem;justify-content:flex-end;">
            <button onclick="document.getElementById('invPrintConfigModal').remove()"
                style="padding:8px 18px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:0.85rem;">Cancelar</button>
            <button onclick="executePrintQRs()" class="btn-primary" style="padding:8px 18px;">Generar PDF</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
    invPrintSetSize(18); // activa el preset Mediano por defecto
}

function invPrintSetSize(mm) {
    const input = document.getElementById('invPrint_customSize');
    if(input) input.value = mm;
    [8, 12, 18, 28].forEach(s => {
        const btn = document.getElementById(`invPrint_sz${s}`);
        if(!btn) return;
        const active = s === Number(mm);
        btn.style.border    = active ? '2px solid var(--clr-blue)' : '1px solid #cbd5e1';
        btn.style.background = active ? '#eff6ff' : '#f8fafc';
        btn.style.fontWeight = active ? '700' : '';
        btn.style.color      = active ? 'var(--clr-blue)' : '';
    });
}

function invPrintCustomSize() {
    const val = parseInt(document.getElementById('invPrint_customSize')?.value || 18);
    [8, 12, 18, 28].forEach(s => {
        const btn = document.getElementById(`invPrint_sz${s}`);
        if(!btn) return;
        const active = s === val;
        btn.style.border    = active ? '2px solid var(--clr-blue)' : '1px solid #cbd5e1';
        btn.style.background = active ? '#eff6ff' : '#f8fafc';
        btn.style.fontWeight = active ? '700' : '';
        btn.style.color      = active ? 'var(--clr-blue)' : '';
    });
}

function invPrintSelectAll(checked) {
    const list = document.getElementById('invPrint_itemList');
    if(!list) return;
    const cbs = list.querySelectorAll('input[type="checkbox"]');
    cbs.forEach(cb => cb.checked = checked);
    _updateInvPrintCount(cbs.length);
}

function _updateInvPrintCount(total) {
    const list = document.getElementById('invPrint_itemList');
    if(!list) return;
    const checked = list.querySelectorAll('input[type="checkbox"]:checked').length;
    const el = document.getElementById('invPrint_count');
    if(el) el.textContent = checked;
}

async function executePrintQRs() {
    const qrSize = Math.min(60, Math.max(6, parseInt(document.getElementById('invPrint_customSize')?.value || 18)));
    const mode   = _invPrintMode;
    const list   = document.getElementById('invPrint_itemList');
    if(!list) return;
    const selectedIds = new Set(Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.dataset.id));
    if(selectedIds.size === 0) { showToast('Selecciona al menos un elemento', 'error'); return; }

    const items = (mode === 'kits' ? dbInventoryKits : dbInventoryItems).filter(i => selectedIds.has(i.id));
    document.getElementById('invPrintConfigModal')?.remove();
    showToast('Generando PDF…', 'success');
    await _generateQRPDF(items, qrSize, mode);
}

async function _generateQRPDF(items, qrSize, mode) {
    if(typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
        showToast('La librería PDF está cargando. Intenta en unos segundos.', 'error'); return;
    }

    const hiddenContainer = document.createElement('div');
    hiddenContainer.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(hiddenContainer);

    const QR_RENDER_PX = Math.round(qrSize * 14);
    const qrData = items.map(item => {
        const box = document.createElement('div');
        hiddenContainer.appendChild(box);
        const qrText = mode === 'kits' ? `kit:${item.id}` : item.id;
        new QRCode(box, { text: qrText, width: QR_RENDER_PX, height: QR_RENDER_PX, correctLevel: QRCode.CorrectLevel.M });
        const canvasEl = box.querySelector('canvas');
        const imgEl    = box.querySelector('img');
        return { item, dataUrl: canvasEl ? canvasEl.toDataURL('image/png') : (imgEl ? imgEl.src : '') };
    });
    document.body.removeChild(hiddenContainer);

    const { jsPDF: JSPDF } = window.jspdf || {};
    const doc = JSPDF ? new JSPDF({ unit: 'mm', format: 'letter' }) : new jsPDF({ unit: 'mm', format: 'letter' });

    const pageW = 215.9, pageH = 279.4;
    const marginX = 10, marginY = 12;
    const pad   = Math.max(2, qrSize * 0.18);  // padding interno dentro de la celda
    const textH = Math.max(6, qrSize * 0.55);  // altura reservada para texto debajo del QR
    const cellW = qrSize + pad * 2;
    const cellH = qrSize + pad + textH;

    const cols       = Math.max(1, Math.floor((pageW - marginX * 2) / cellW));
    const rowsPerPg  = Math.max(1, Math.floor((pageH - marginY * 2) / cellH));
    const perPage    = cols * rowsPerPg;

    const nameFontSz   = Math.max(4.5, qrSize * 0.41);
    const subFontSz    = Math.max(3.5, qrSize * 0.34);
    const maxNameChars = Math.round(14 * (qrSize / 15));

    doc.setFont('helvetica', 'normal');
    const _setDash = (on) => {
        try { doc.setLineDash(on ? [1, 1.5] : [], 0); } catch(e) {
            try { doc.setLineDashPattern(on ? [1, 1.5] : [], 0); } catch(e2) {}
        }
    };

    qrData.forEach(({ item, dataUrl }, idx) => {
        const idxInPage = idx % perPage;
        if(idx > 0 && idxInPage === 0) doc.addPage();

        const col     = idxInPage % cols;
        const row     = Math.floor(idxInPage / cols);
        const x       = marginX + col * cellW;
        const y       = marginY + row * cellH;
        const qrX     = x + pad;
        const qrY     = y + pad * 0.5;
        const centerX = x + cellW / 2;

        // Línea de corte punteada
        doc.setDrawColor(185, 185, 185);
        doc.setLineWidth(0.12);
        _setDash(true);
        doc.rect(x, y, cellW, cellH, 'S');
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.2);
        _setDash(false);

        doc.addImage(dataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

        const name = item.name.length > maxNameChars ? item.name.slice(0, maxNameChars) + '…' : item.name;
        doc.setFontSize(nameFontSz);
        doc.setTextColor(30);
        doc.text(name, centerX, qrY + qrSize + nameFontSz * 0.38, { align: 'center' });

        const subtitle = mode === 'kits' ? 'Kit' : (item.serial_number || '');
        if(subtitle) {
            doc.setFontSize(subFontSz);
            doc.setTextColor(130);
            doc.text(subtitle, centerX, qrY + qrSize + nameFontSz * 0.38 + subFontSz * 0.48, { align: 'center' });
        }
    });

    const filename = mode === 'kits'
        ? `QR_Kits_CBM_${new Date().toISOString().slice(0, 10)}.pdf`
        : `QR_Inventario_CBM_${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
}

// ── Escáner QR ────────────────────────────────────────────────────────────────
// Estrategia dual:
//   Android Chrome  → BarcodeDetector nativo directo (misma API que la cámara del sistema)
//   iOS / resto     → html5-qrcode como fallback

let _nativeScanStream   = null; // MediaStream activo en el escáner nativo
let _nativeScanInterval = null; // handle del setInterval de detección
let _nativeScanBusy     = false;

async function _startNativeBarcodeScanner(onSuccess) {
    const box = document.getElementById('inv-qr-reader');
    if(!box) return;

    box.innerHTML = `
        <div id="_invScanWrap" style="position:relative;width:100%;background:#000;border-radius:8px;overflow:hidden;min-height:280px;">
            <video id="_invNativeVideo" playsinline autoplay muted
                style="width:100%;display:block;max-height:340px;object-fit:cover;cursor:crosshair;"></video>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
                <div style="width:210px;height:210px;position:relative;">
                    <div style="position:absolute;inset:0;box-shadow:0 0 0 9999px rgba(0,0,0,0.45);border-radius:4px;"></div>
                    <div style="position:absolute;top:0;left:0;width:24px;height:24px;border-top:3px solid #fff;border-left:3px solid #fff;border-radius:3px 0 0 0;"></div>
                    <div style="position:absolute;top:0;right:0;width:24px;height:24px;border-top:3px solid #fff;border-right:3px solid #fff;border-radius:0 3px 0 0;"></div>
                    <div style="position:absolute;bottom:0;left:0;width:24px;height:24px;border-bottom:3px solid #fff;border-left:3px solid #fff;border-radius:0 0 0 3px;"></div>
                    <div style="position:absolute;bottom:0;right:0;width:24px;height:24px;border-bottom:3px solid #fff;border-right:3px solid #fff;border-radius:0 0 3px 0;"></div>
                </div>
            </div>
            <!-- barra inferior: hint + zoom -->
            <div style="position:absolute;bottom:0;left:0;right:0;padding:5px 10px;display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.4);">
                <span style="font-size:0.65rem;color:rgba(255,255,255,0.7);">Toca la imagen para enfocar</span>
                <div id="_invZoomControls" style="display:none;align-items:center;gap:4px;">
                    <button id="_invZoomOut" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);color:#fff;border-radius:5px;width:28px;height:28px;font-size:1.1rem;cursor:pointer;line-height:1;touch-action:manipulation;">−</button>
                    <span id="_invZoomLabel" style="font-size:0.65rem;color:#fff;min-width:30px;text-align:center;">1×</span>
                    <button id="_invZoomIn"  style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);color:#fff;border-radius:5px;width:28px;height:28px;font-size:1.1rem;cursor:pointer;line-height:1;touch-action:manipulation;">+</button>
                </div>
            </div>
            <!-- anillo de tap-to-focus -->
            <div id="_invFocusRing" style="display:none;position:absolute;width:48px;height:48px;border:2px solid #a4e5ff;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);transition:opacity 0.4s;box-shadow:0 0 8px rgba(164,229,255,0.6);"></div>
        </div>`;

    try {
        _nativeScanStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' },
                width:  { ideal: 1920, min: 640 },
                height: { ideal: 1080, min: 480 }
            }
        });
        const video = document.getElementById('_invNativeVideo');
        if(!video) { _stopNativeBarcodeScanner(); return; }
        video.srcObject = _nativeScanStream;
        await video.play();

        const track = _nativeScanStream.getVideoTracks()[0];

        // Activar autofoco continuo al arrancar (ayuda en Samsung Galaxy A-series)
        if(track) {
            try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch(e) {}
        }

        // Controles de zoom (solo si el dispositivo los soporta)
        if(track) {
            try {
                const caps = track.getCapabilities ? track.getCapabilities() : {};
                if(caps.zoom && caps.zoom.max > caps.zoom.min) {
                    let zoomVal = caps.zoom.min;
                    const step = (caps.zoom.max - caps.zoom.min) / 8;
                    const zoomLabel    = document.getElementById('_invZoomLabel');
                    const zoomControls = document.getElementById('_invZoomControls');
                    if(zoomControls) zoomControls.style.display = 'flex';

                    const applyZoom = async (v) => {
                        zoomVal = Math.max(caps.zoom.min, Math.min(caps.zoom.max, v));
                        try { await track.applyConstraints({ advanced: [{ zoom: zoomVal }] }); } catch(e) {}
                        if(zoomLabel) zoomLabel.textContent = zoomVal.toFixed(1) + '×';
                    };

                    document.getElementById('_invZoomIn') ?.addEventListener('click', e => { e.stopPropagation(); applyZoom(zoomVal + step); });
                    document.getElementById('_invZoomOut')?.addEventListener('click', e => { e.stopPropagation(); applyZoom(zoomVal - step); });
                }
            } catch(e) {}
        }

        // Tap para enfocar: dispara single-shot AF y muestra anillo visual
        video.addEventListener('click', async (e) => {
            const wrap = document.getElementById('_invScanWrap');
            const ring = document.getElementById('_invFocusRing');
            if(ring && wrap) {
                const rect = wrap.getBoundingClientRect();
                ring.style.left    = (e.clientX - rect.left) + 'px';
                ring.style.top     = (e.clientY - rect.top)  + 'px';
                ring.style.display = 'block';
                ring.style.opacity = '1';
                setTimeout(() => {
                    ring.style.opacity = '0';
                    setTimeout(() => { ring.style.display = 'none'; }, 400);
                }, 700);
            }
            if(track) {
                try { await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }); } catch(e) {}
            }
        });

        const detector = new BarcodeDetector({ formats: ['qr_code'] });

        _nativeScanInterval = setInterval(async () => {
            if(_nativeScanBusy || !_nativeScanStream) return;
            const v = document.getElementById('_invNativeVideo');
            if(!v || v.readyState < 2) return;
            _nativeScanBusy = true;
            try {
                const codes = await detector.detect(v);
                if(codes.length > 0) {
                    clearInterval(_nativeScanInterval);
                    _nativeScanInterval = null;
                    _stopNativeBarcodeScanner();
                    onSuccess(codes[0].rawValue);
                }
            } catch(e) { /* frame sin QR, seguir */ }
            _nativeScanBusy = false;
        }, 180);

    } catch(err) {
        showToast('No se pudo acceder a la cámara: ' + err, 'error');
        closeInventoryScanner();
    }
}

function _stopNativeBarcodeScanner() {
    if(_nativeScanInterval) { clearInterval(_nativeScanInterval); _nativeScanInterval = null; }
    _nativeScanBusy = false;
    if(_nativeScanStream) {
        _nativeScanStream.getTracks().forEach(t => t.stop());
        _nativeScanStream = null;
    }
    const box = document.getElementById('inv-qr-reader');
    if(box) box.innerHTML = '';
}

function _startHtml5Scanner(onSuccess, onError) {
    try {
        _invHtml5Scanner = new Html5Qrcode('inv-qr-reader', {
            experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        });
        _invHtml5Scanner.start(
            { facingMode: 'environment' },
            { fps: 15, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
                _invHtml5Scanner.stop().catch(() => {});
                onSuccess(decodedText);
            },
            () => {}
        ).catch(err => { if(onError) onError(err); });
    } catch(e) {
        if(onError) onError(e);
    }
}

function _useNativeScanner() {
    return typeof BarcodeDetector !== 'undefined';
}

function openInventoryScannerModal() {
    document.getElementById('inventoryScanModal').classList.add('active');
    document.getElementById('invScan_scannerBox').style.display = 'block';
    document.getElementById('invScan_result').style.display = 'none';
    _invScanAction = null;

    setTimeout(() => {
        if(_useNativeScanner()) {
            _startNativeBarcodeScanner((text) => handleInventoryQRScanned(text));
        } else {
            _startHtml5Scanner(
                (text) => handleInventoryQRScanned(text),
                (err)  => { showToast('No se pudo acceder a la cámara: ' + err, 'error'); closeInventoryScanner(); }
            );
        }
    }, 200);
}

function closeInventoryScanner() {
    _stopNativeBarcodeScanner();
    if(_invHtml5Scanner) {
        try {
            const scanner = _invHtml5Scanner;
            Promise.resolve()
                .then(() => scanner.stop()).catch(() => {})
                .then(() => scanner.clear()).catch(() => {});
        } catch(e) {}
        _invHtml5Scanner = null;
    }
    closeModal('inventoryScanModal');
}

function resetInventoryScanner() {
    document.getElementById('invScan_scannerBox').style.display = 'block';
    document.getElementById('invScan_result').style.display = 'none';
    _invScanAction = null;

    // Detener lo que esté corriendo antes de reiniciar
    _stopNativeBarcodeScanner();
    if(_invHtml5Scanner) {
        try { _invHtml5Scanner.stop().catch(() => {}); } catch(e) {}
        _invHtml5Scanner = null;
    }

    setTimeout(() => {
        if(_useNativeScanner()) {
            _startNativeBarcodeScanner((text) => handleInventoryQRScanned(text));
        } else {
            _startHtml5Scanner((text) => handleInventoryQRScanned(text), () => {});
        }
    }, 200);
}

async function handleInventoryQRScanned(scannedId) {
    if(scannedId.startsWith('kit:')) {
        closeInventoryScanner();
        openKitChecklistModal(scannedId.slice(4));
        return;
    }

    // Refrescar datos antes de decidir salida vs devolución,
    // para que el estado en memoria nunca esté desactualizado.
    await loadInventoryData();

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

    // activeLoan es fuente de verdad: si hay préstamo activo en DB → siempre es devolución,
    // sin importar si item.status en caché local quedó desactualizado.
    if(activeLoan) {
        _invScanAction = { type: 'checkin', itemId: item.id, loanId: activeLoan.id };
        const sameAnalyst = activeLoan.analyst_name === analystName;
        actionBtn.textContent = sameAnalyst ? `↩️ Devolver "${item.name}"` : `↩️ Registrar devolución (era de ${activeLoan.analyst_name})`;
        actionBtn.style.display = '';
    } else if(item.status === 'disponible') {
        _invScanAction = { type: 'checkout', itemId: item.id };
        actionBtn.textContent = `✅ Llevar "${item.name}"`;
        actionBtn.style.display = '';
    } else if(item.status === 'prestado') {
        // Estado inconsistente: item marcado prestado pero sin préstamo activo en DB
        actionBtn.style.display = 'none';
        card.innerHTML += `<div style="margin-top:0.75rem;font-size:0.8rem;color:#d97706;">⚠️ Este ítem aparece como prestado pero no tiene un préstamo activo registrado. Consulta al administrador.</div>`;
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

// ── Checklist de kits (maletas con varios ítems bajo un solo QR) ────────────────

function openKitChecklistModal(kitId) {
    const kit = dbInventoryKits.find(k => k.id === kitId);
    if(!kit) { showToast('Kit no reconocido', 'error'); return; }

    const items = dbInventoryItems.filter(i => i.kit_id === kitId);
    if(items.length === 0) { showToast('Este kit todavía no tiene ítems asignados', 'error'); return; }

    // Modo del checklist según el estado real de los ítems: si están disponibles,
    // el kit está en A-MAQ y esto es una salida; si están prestados, el kit está
    // en campo y esto es un regreso. Si hay mezcla, se avisa por ítem individual.
    const actionable = items.filter(i => i.status === 'disponible' || i.status === 'prestado');
    const allOut  = actionable.length > 0 && actionable.every(i => i.status === 'prestado');
    const allHome = actionable.length > 0 && actionable.every(i => i.status === 'disponible');
    const mode = allOut ? 'return' : allHome ? 'checkout' : 'mixed';

    document.getElementById('invKitChecklist_title').textContent = `🧰 ${kit.name}`;
    document.getElementById('invKitChecklist_kitId').value = kitId;

    const instructions = {
        checkout: 'El kit está en A-MAQ. Marca lo que te llevas — lo que dejes sin marcar debe quedar en el cajón de guardado temporal.',
        return:   'El kit está en campo. Marca lo que estás devolviendo ahora — lo que dejes sin marcar sigue afuera.',
        mixed:    'Este kit tiene ítems en estados distintos. Revisa el estado de cada uno antes de confirmar.'
    };
    document.getElementById('invKitChecklist_instructions').textContent = instructions[mode];

    const btnLabel = { checkout: 'Confirmar salida', return: 'Confirmar regreso', mixed: 'Confirmar' };
    document.getElementById('invKitChecklist_submitBtn').textContent = btnLabel[mode];

    const container = document.getElementById('invKitChecklist_items');
    container.innerHTML = items.map(item => {
        const blocked = item.status === 'dañado' || item.status === 'perdido';
        const activeLoan = dbInventoryLoans.find(l => l.item_id === item.id);
        const actionBadge = item.status === 'disponible'
            ? '<span style="font-size:0.65rem;font-weight:700;color:#2563eb;background:#eff6ff;padding:1px 6px;border-radius:99px;">SALE</span>'
            : item.status === 'prestado'
                ? '<span style="font-size:0.65rem;font-weight:700;color:#d97706;background:#fffbeb;padding:1px 6px;border-radius:99px;">REGRESA</span>'
                : '';
        return `
        <label style="display:flex;align-items:center;gap:0.6rem;padding:0.55rem 0.65rem;border:1px solid #e2e8f0;border-radius:8px;${blocked?'opacity:0.55;':''}">
            <input type="checkbox" data-item-id="${item.id}" data-prev-status="${item.status}" ${blocked ? 'disabled' : 'checked'} style="width:16px;height:16px;flex-shrink:0;">
            <div style="flex:1;">
                <div style="font-size:0.85rem;font-weight:600;display:flex;align-items:center;gap:6px;">${item.name} ${actionBadge}</div>
                <div style="font-size:0.7rem;color:#64748b;">
                    ${_invStatusLabel[item.status]||item.status}${activeLoan ? ` · con ${activeLoan.analyst_name}` : ''}${blocked ? ' — no se puede llevar' : ''}
                </div>
            </div>
        </label>`;
    }).join('');

    document.getElementById('inventoryKitChecklistModal').classList.add('active');
}

async function submitKitChecklist() {
    if(_kitChecklistSubmitting) return;
    _kitChecklistSubmitting = true;

    // Leer todos los datos del formulario ANTES de cerrar el modal
    const kitId      = document.getElementById('invKitChecklist_kitId').value;
    const analystName = currentUserProfile?.analyst_name || currentUserProfile?.display_name || currentUser?.email || 'Desconocido';
    const checkboxes = document.querySelectorAll('#invKitChecklist_items input[type="checkbox"]');
    const selections = Array.from(checkboxes).map(cb => ({
        itemId:     cb.dataset.itemId,
        prevStatus: cb.dataset.prevStatus,
        checked:    cb.checked
    }));

    // Cerrar el modal inmediatamente para evitar doble envío
    closeModal('inventoryKitChecklistModal');

    const kitLoanGroupId = crypto?.randomUUID ? crypto.randomUUID() : `klg_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;

    const leftBehind = [];
    for(const { itemId, prevStatus, checked } of selections) {
        const item = dbInventoryItems.find(i => i.id === itemId);
        if(!item) continue;

        if(checked) {
            if(prevStatus === 'disponible') {
                await supabaseClient.from('inventory_loans').insert({ item_id: itemId, analyst_name: analystName, kit_id: kitId, kit_loan_id: kitLoanGroupId });
                await supabaseClient.from('inventory_items').update({ status: 'prestado' }).eq('id', itemId);
            } else if(prevStatus === 'prestado') {
                const loan = dbInventoryLoans.find(l => l.item_id === itemId);
                if(loan) await supabaseClient.from('inventory_loans').update({ checked_in_at: new Date().toISOString() }).eq('id', loan.id);
                await supabaseClient.from('inventory_items').update({ status: 'disponible' }).eq('id', itemId);
            }
        } else {
            if(prevStatus === 'disponible') leftBehind.push(`${item.name} (queda en el cajón)`);
            if(prevStatus === 'prestado')   leftBehind.push(`${item.name} (sigue en campo)`);
        }
    }

    if(leftBehind.length > 0) {
        showToast(`⚠️ Registrado. Sin marcar: ${leftBehind.join(' · ')}`, 'warning');
    } else {
        showToast('Checklist del kit registrado ✓', 'success');
    }

    _kitChecklistSubmitting = false;
    await loadInventoryData();
    if(document.getElementById('view-inventory')?.classList.contains('active-view')) renderInventoryView();
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
    if(!_svAllContacts.length && !_svMissing && typeof loadSurveyData === 'function') { try { await loadSurveyData(); } catch(e) { /* sin tablas de encuestas */ } }
    const analystsList = document.getElementById('admin-analysts-list');
    const clientsList = document.getElementById('admin-clients-list');
    if(!analystsList || !clientsList) return;

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
                    <th style="width: 30%;">Contacto</th>
                    <th style="width: 25%;">Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${dbClients.map(c => {
                    const cc = _svClientCompany(c);
                    const book = _svContactsFor(cc.key);
                    const main = c.contact_name || book[0]?.name || '-';
                    const more = book.length - (c.contact_name ? 0 : (book.length ? 1 : 0));
                    return `
                    <tr>
                        <td><strong>${getClientDisplayName(c)}</strong></td>
                        <td>${_escHtml(main)}${more > 0 ? ` <span style="color:#94a3b8;font-size:0.68rem;" title="Contactos en la libreta de la empresa">+${more}</span>` : ''}</td>
                        <td>
                            <div class="action-icons" style="gap:0.3rem;">
                                ${actionIcon('contacts', `openClientContacts('${c.id}')`, `Contactos de ${_escHtml(cc.name)} (${book.length})`)}
                                ${actionIcon('plant',  `openPlantsModal('${c.id}')`,      'Gestionar Plantas')}
                                ${actionIcon('pref',   `openPreferenceModal('${c.id}')`,  'Asignar Analistas')}
                                ${actionIcon('edit',   `editClient('${c.id}')`,            'Editar')}
                                ${actionIcon('delete', `deleteClient('${c.id}')`,          'Eliminar')}
                            </div>
                        </td>
                    </tr>
                `; }).join('')}
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
            if(_svCanResults()) loadSurveyData().then(() => renderDashboardSurveyCard()).catch(() => {});
            loadTaskChecklists().then(() => { if(document.getElementById('view-mywork')?.classList.contains('active-view')) renderMyWorkView(); }).catch(() => {});
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

/** Rango común para los selects de mes: 24 meses atrás y 18 adelante.
 *  El rango extendido hacia atrás evita que mesFacturacion de gestiones antiguas
 *  quede fuera del select, lo que causaba que el valor se reseteara al period. */
function _populateMonthSelect(selectId, ensureValue) {
    const select = document.getElementById(selectId);
    if(!select) return;
    select.innerHTML = '';
    const now = new Date();
    for(let i = -24; i <= 18; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const val = `${y}-${String(m).padStart(2, '0')}`;
        const label = `${monthNames[m-1]} ${y}`;
        select.innerHTML += `<option value="${val}">${label}</option>`;
    }
    // Si el valor a preseleccionar todavía no está en el rango generado, lo inyectamos.
    if(ensureValue && !select.querySelector(`option[value="${ensureValue}"]`)) {
        const [y, m] = ensureValue.split('-').map(Number);
        const label = `${monthNames[m-1]} ${y}`;
        const opt = document.createElement('option');
        opt.value = ensureValue;
        opt.textContent = label;
        select.insertBefore(opt, select.firstChild);
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

