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

// Helper: assign a consistent color per analyst
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

async function changeCalendarView(view) {
    calendarView = view;
    
    // UI update
    document.getElementById('btn-view-month').classList.toggle('active', view === 'month');
    document.getElementById('btn-view-week').classList.toggle('active', view === 'week');
    
    // Si cambiamos a semana, sincronizar con el mes actual o con hoy
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

let activityLog = JSON.parse(localStorage.getItem('cbm_activity_log')) || [];

function saveTasks() {
    localStorage.setItem('cbm_tasks', JSON.stringify(tasks));
}

function saveLog() {
    localStorage.setItem('cbm_activity_log', JSON.stringify(activityLog));
}

function logActivity(message, type = 'info') {
    const entry = {
        message: message,
        type: type, // 'create', 'assign', 'status', 'csat'
        timestamp: new Date().toISOString()
    };
    activityLog.unshift(entry); // Add to beginning (blog style)
    saveLog();
}

// Generate unique ID
function generateId() {
    return 't_' + Math.random().toString(36).substr(2, 9);
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
    let filteredTasks = tasks.slice().filter(t => !t.isAbsence && isTaskInCurrentPeriod(t));

    if(dashboardFilters.analyst) filteredTasks = filteredTasks.filter(t => t.analyst === dashboardFilters.analyst);
    if(dashboardFilters.client) filteredTasks = filteredTasks.filter(t => t.client === dashboardFilters.client);
    if(dashboardFilters.status) filteredTasks = filteredTasks.filter(t => t.status === dashboardFilters.status);

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
                        <td>${t.analyst || '<span style="color:var(--text-secondary)">Sin Asignar</span>'}</td>
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
                                <span class="action-icon edit" onclick="openEditTaskModal('${t.id}')" title="Editar">📝</span>
                                <span class="action-icon edit" onclick="openClosingMeetingModal('${t.id}')" title="Reunión de Cierre">🤝</span>
                                ${t.status === 'programada' ? `<span class="action-icon revert" onclick="revertToProjected('${t.id}')" title="Revertir a Proyectada">🔄</span>` : ''}
                                <span class="action-icon delete" onclick="deleteTask('${t.id}')" title="Borrar">🗑️</span>
                            </div>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
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

    const oldStatus = task.status;
    task.status = newStatus;
    
    // Si se pasa a proyectada, se quita la programación
    if(newStatus === 'proyectada') {
        task.scheduledDays = [];
        // Mantener el analista para que no se pierda la asignación preferida
    }

    if(supabaseClient) {
        await supabaseClient.from('tasks').update({ 
            status: newStatus, 
            scheduled_days: task.scheduledDays || [], 
            analyst: task.analyst 
        }).eq('id', taskId);
    }
    
    saveTasks();
    renderBoard();
    renderCalendar();
    if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
    renderTasksView();
    renderDashboardStats();
    addLog('Estado actualizado', `Gestión de ${task.client} cambió de ${oldStatus} a ${newStatus}`);
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
    addLog('Gestión borrada', `Se eliminó la gestión de ${clientName}`);
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
            if (t.status === 'proyectada') return true; 
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
        if(!t.analyst) return;
        if(!analystStats[t.analyst]) analystStats[t.analyst] = { closed: 0, total: 0, csat: 0, csatCount: 0 };
        analystStats[t.analyst].total++;
        if(t.status === 'facturada' || t.status === 'ejecutada') analystStats[t.analyst].closed++;
        if(t.csatScore) {
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
    }
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

    const workloadMap = {};
    const billingMap = {};

    chartData.forEach(t => {
        if (!t.analyst) return;
        if (!workloadMap[t.analyst]) workloadMap[t.analyst] = 0;
        workloadMap[t.analyst]++;

        if (t.status === 'facturada') {
            if (!billingMap[t.analyst]) billingMap[t.analyst] = 0;
            const budget = parseFloat(t.budget) || 0;
            billingMap[t.analyst] += budget;
        }
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
                                    return `${context.label}: ${context.parsed} gestiones (${percentage}%)`;
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

// Render Planning Unassigned Sidebar
function renderPlanningSidebar() {
    const sidebarContainer = document.getElementById('planning-sidebar-items');
    if(!sidebarContainer) return;
    sidebarContainer.innerHTML = '';
    
    let filteredTasks = tasks.filter(t => t.status === 'proyectada' && isTaskInCurrentPeriod(t));

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
        item.innerHTML = `
            <div style="font-weight:700; margin-bottom:0.25rem;">${t.client}</div>
            <div style="font-size:0.7rem; color:var(--text-secondary)">${t.analyst || 'Sin Asignar'}</div>
        `;
        
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('click', () => openTaskInfoModal(t.id));
        
        sidebarContainer.appendChild(item);
    });
}

function renderActivityLog() {
    const logContainer = document.getElementById('activity-log-items');
    if(!logContainer) return;
    logContainer.innerHTML = '';

    const dateFilter = document.getElementById('log-filter-date').value;
    const typeFilter = document.getElementById('log-filter-type').value;

    let filteredLog = activityLog;

    if(dateFilter) {
        filteredLog = filteredLog.filter(entry => entry.timestamp.startsWith(dateFilter));
    }
    if(typeFilter) {
        filteredLog = filteredLog.filter(entry => entry.type === typeFilter);
    }

    if(filteredLog.length === 0) {
        logContainer.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-secondary)">No hay actividades registradas con estos filtros.</div>';
        return;
    }

    filteredLog.forEach(entry => {
        const item = document.createElement('div');
        item.className = `log-entry ${entry.type}`;
        
        const date = new Date(entry.timestamp);
        const dateStr = date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        item.innerHTML = `
            <div class="log-entry-icon"></div>
            <div class="log-entry-content">
                <div class="log-entry-header">
                    <span class="log-entry-type">${entry.type.toUpperCase()}</span>
                    <span class="log-entry-time">${dateStr} ${timeStr}</span>
                </div>
                <div class="log-entry-message">${entry.message}</div>
            </div>
        `;
        logContainer.appendChild(item);
    });
}

function renderCalendar() {
    const calendarBody = document.getElementById('calendar-body');
    if(!calendarBody) return;
    calendarBody.innerHTML = '';

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
            daysToRender.push({
                day: i,
                dateStr: `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`,
                isWeekend: date.getDay() === 0 || date.getDay() === 6
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
            daysToRender.push({
                day: d,
                dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                isWeekend: date.getDay() === 0 || date.getDay() === 6
            });
        }
    }

    // Actualizar Header
    const headerRow = document.getElementById('calendar-header-row');
    if(headerRow) {
        headerRow.innerHTML = '<th class="sticky-col">Analista</th>';
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
                let isAssigned = (t.analyst === analyst.name);
                if (!isAssigned && t.analysts_assignment && t.analysts_assignment.length > 0) {
                    isAssigned = t.analysts_assignment.some(a => a.name === analyst.name);
                }
                return isAssigned && t.scheduledDays && t.scheduledDays.some(sd => sd.date === day.dateStr);
            });
            
            dayTasks.forEach(t => {
                const pill = document.createElement('div');
                const dayInfo = t.scheduledDays.find(sd => sd.date === day.dateStr);
                const dayIdx = t.scheduledDays.findIndex(sd => sd.date === day.dateStr);
                
                pill.className = `calendar-task-pill ${t.status} ${dayInfo.type}`;
                // Analyst color overrides CSS status colors
                if (analystColor) {
                    pill.style.backgroundColor = analystColor;
                    pill.style.borderColor = analystColor;
                    pill.style.color = '#fff';
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

    setupCalendarListeners();
    setupRowResizer();
    if (calendarRowHeight) applyRowHeight(calendarRowHeight);
}

// ── Global row height (persisted in localStorage) ──────────────
let calendarRowHeight = parseInt(localStorage.getItem('cbm_row_height')) || 0;

function applyRowHeight(h) {
    document.querySelectorAll('#calendar-body tr').forEach(r => {
        r.style.height = h + 'px';
        r.querySelectorAll('td').forEach(td => { td.style.height = h + 'px'; });
    });
}

function setupRowResizer() {
    document.querySelectorAll('.calendar-row-resizer').forEach(handle => {
        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            const startY = e.clientY;

            const allRows = document.querySelectorAll('#calendar-body tr');
            const firstRow = allRows[0];
            const startHeight = firstRow ? firstRow.getBoundingClientRect().height : 85;

            function onMouseMove(ev) {
                const delta = ev.clientY - startY;
                const newHeight = Math.max(40, startHeight + delta);
                calendarRowHeight = newHeight;
                applyRowHeight(newHeight);
            }

            function onMouseUp() {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                localStorage.setItem('cbm_row_height', calendarRowHeight);
            }

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
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
            
            let dragInfo = draggedTaskId; 
            let isPillMove = dragInfo && dragInfo.startsWith('pill-');
            let taskId = dragInfo;
            if (isPillMove) {
                let dragEl = document.getElementById(dragInfo);
                if (dragEl) {
                    taskId = dragEl.getAttribute('data-task-id');
                } else {
                    taskId = dragInfo.split('-')[1]; // Fallback
                }
            }
            
            const taskIndex = tasks.findIndex(t => t.id === taskId);
            if (taskIndex === -1) return;

            const targetAnalyst = cell.getAttribute('data-analyst');
            const targetDateStr = cell.getAttribute('data-date'); 
            const targetDay = parseInt(cell.getAttribute('data-day'));
            const task = tasks[taskIndex];

            // Validation: Analyst Assignment
            let isAssignedToTarget = (task.analyst === targetAnalyst);
            if (!isAssignedToTarget && task.analysts_assignment && task.analysts_assignment.length > 0) {
                isAssignedToTarget = task.analysts_assignment.some(a => a.name === targetAnalyst);
            }

            if (!isAssignedToTarget) {
                alert(`Esta gestión está asignada a: ${task.analyst}. Debe arrastrarla a una de las filas de sus analistas.`);
                return;
            }

            // Check equipment availability before applying drop
            if(task.equipmentId) {
                let futureScheduledDays = [...task.scheduledDays];
                if(isPillMove) {
                    let dayIdx = 0;
                    let dragEl = document.getElementById(dragInfo);
                    if (dragEl) {
                        dayIdx = parseInt(dragEl.getAttribute('data-day-index'), 10);
                    } else {
                        dayIdx = parseInt(dragInfo.split('-').pop(), 10); // Fallback
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
                    dayIdx = parseInt(dragInfo.split('-').pop(), 10); // Fallback
                }
                task.scheduledDays[dayIdx].day = targetDay;
                task.scheduledDays[dayIdx].date = targetDateStr;
                task.analyst = targetAnalyst; // Sincronizar analista por si cambió de fila
                logActivity(`🚚 Se movió un día de la gestión <strong>${task.client}</strong> al día <strong>${targetDay}</strong>.`, 'assign');
            } else {
                task.analyst = targetAnalyst;
                
                if (task.scheduledDays.length === 0) {
                    const [yStr, mStr, dStr] = targetDateStr.split('-');
                    let loopDate = new Date(parseInt(yStr), parseInt(mStr) - 1, parseInt(dStr));
                    
                    let fieldAsigned = 0;
                    const totalFieldNeeded = task.daysField || 1;
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
                    const totalReportNeeded = task.daysReport || 0;
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

                if(task.status === 'proyectada') {
                    task.status = 'programada';
                }
            }
            
            await saveTaskToSupabase(task);
            postDropSync();
        });
    });

    document.querySelectorAll('.calendar-task-pill').forEach(pill => {
        pill.addEventListener('dragstart', function(e) {
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
    });
}

let draggedTaskId = null;

function handleDragStart(e) {
    draggedTaskId = this.id;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
}

document.querySelectorAll('.kanban-column').forEach(column => {
    column.addEventListener('dragover', e => {
        e.preventDefault();
        column.classList.add('drag-over');
    });
    
    column.addEventListener('dragleave', e => {
        column.classList.remove('drag-over');
    });
    
    column.addEventListener('drop', async e => {
        e.preventDefault();
        column.classList.remove('drag-over');
        
        let newStatus = column.getAttribute('data-status');
        if(newStatus === 'proyectado' || newStatus === 'proyectada') newStatus = 'proyectada';
        
        let taskId = draggedTaskId;
        if(taskId && taskId.startsWith('pill-')) {
            let dragEl = document.getElementById(draggedTaskId);
            if(dragEl && dragEl.classList.contains('calendar-task-pill')) {
                taskId = dragEl.getAttribute('data-task-id');
            } else {
                taskId = taskId.split('-')[1]; 
            }
        }
        
        const task = tasks.find(t => t.id === taskId);
        if (task && task.status !== newStatus) {
            await updateTaskStatus(taskId, newStatus);
        }
    });
});

function isHolidayOrWeekend(year, month, day) {
    const d = new Date(year, month - 1, day);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return true;
    
    // Festivos Colombia 2026 (Manual)
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const holidays = [
        "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03",
        "2026-05-01", "2026-05-18", "2026-06-08", "2026-06-15", "2026-06-29",
        "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02",
        "2026-11-16", "2026-12-08", "2026-12-25"
    ];
    return holidays.includes(dateStr);
}

function addAnalystToTask(existingData = null) {
    const container = document.getElementById('taskAnalystsContainer');
    const row = document.createElement('div');
    row.className = 'analyst-row';
    
    const analystName = existingData ? existingData.name : '';
    const isTitularChecked = existingData ? (existingData.isTitular ? 'checked' : '') : (container.children.length === 0 ? 'checked' : '');
    const isReportChecked = existingData ? (existingData.makesReport ? 'checked' : '') : (container.children.length === 0 ? 'checked' : '');
    const pctValue = existingData ? existingData.percentage : (container.children.length === 0 ? 100 : 0);

    row.innerHTML = `
        <select class="analyst-select" style="flex: 2; padding: 0.4rem; font-size: 0.8rem; border: 1px solid #cbd5e1; border-radius: 4px;" required>
            <option value="">Analista...</option>
            ${dbAnalysts.map(a => `<option value="${a.name}" ${analystName === a.name ? 'selected' : ''}>${a.name}</option>`).join('')}
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
    
    if(!clientId) {
        container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); text-align: center;">Seleccione primero un cliente para añadir analistas.</div>';
        return;
    }
    
    if(container.innerHTML.trim() === '' || container.innerHTML.includes('Seleccione primero')) {
        container.innerHTML = '';
        if(!supabaseClient) {
            addAnalystToTask();
            return;
        }
        
        try {
            const { data: preferences, error } = await supabaseClient
                .from('client_analyst_preferences')
                .select('priority_level, analysts(id, name)')
                .eq('client_id', clientId);
                
            if (error) console.error("Error cargando prioridades:", error);
            
            const priorityOrder = { 'Primary': 1, 'Secondary': 2, 'Backup': 3 };
            const sortedPrefs = (preferences || []).sort((a,b) => priorityOrder[a.priority_level] - priorityOrder[b.priority_level]);
            
            let titularAdded = false;
            sortedPrefs.forEach(pref => {
                if(pref.analysts && !Array.isArray(pref.analysts)) {
                    addAnalystToTask({
                        name: pref.analysts.name,
                        isTitular: !titularAdded,
                        makesReport: !titularAdded,
                        percentage: !titularAdded ? 100 : 0
                    });
                    titularAdded = true;
                }
            });

            if(!titularAdded) {
                addAnalystToTask();
            }
        } catch(err) {
            console.error("Error in onTaskClientChange:", err);
            addAnalystToTask();
        }
    }
}

function onTaskServiceTypeChange() {
    const serviceType = document.getElementById('taskServiceType').value;
    const isAbsence = (serviceType === 'Vacaciones' || serviceType === 'Incapacidad');
    
    const fieldsToToggle = ['group-client', 'group-budget', 'group-equipment', 'group-report'];
    fieldsToToggle.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = isAbsence ? 'none' : 'block';
    });
    
    const container = document.getElementById('taskAnalystsContainer');

    if(isAbsence) {
        if(container.innerHTML.trim() === '' || container.innerHTML.includes('Seleccione primero')) {
            container.innerHTML = '';
            addAnalystToTask();
        }
        
        document.getElementById('taskClient').required = false;
        document.getElementById('taskBudget').required = false;
        document.getElementById('taskDaysReport').required = false;
    } else {
        document.getElementById('taskClient').required = true;
        document.getElementById('taskBudget').required = true;
        document.getElementById('taskDaysReport').required = true;
        onTaskClientChange(); 
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

function updateFinanceSelectedMonths() {
    const checkboxes = document.querySelectorAll('#finance-months-list input[type="checkbox"]');
    financeFilters.selectedMonths = Array.from(checkboxes)
        .filter(i => i.checked)
        .map(i => i.value);
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
                if(!breakdowns[t.status][t.client]) breakdowns[t.status][t.client] = 0;
                breakdowns[t.status][t.client] += taskValue;
            }
        }
    });
    
    const cards = [
        { label: 'Proyectada', key: 'proyectada', val: stats.proyectada, clr: 'var(--clr-blue)', bg: 'var(--clr-blue-light)' },
        { label: 'Programada', key: 'programada', val: stats.programada, clr: 'var(--clr-purple)', bg: 'var(--clr-purple-light)' },
        { label: 'Ejecutada', key: 'ejecutada', val: stats.ejecutada, clr: 'var(--clr-pink)', bg: 'var(--clr-pink-light)' },
        { label: 'Facturada', key: 'facturada', val: stats.facturada, clr: 'var(--clr-green)', bg: 'var(--clr-green-light)' }
    ];
    
    const periodLabel = financeFilters.type === 'single' ? monthNames[currentMonth-1] :
                       financeFilters.type === 'year' ? `Todo ${currentYear}` :
                       `${filteredPeriods.length} meses seleccionados`;

    container.innerHTML = cards.map(c => {
        const bd = breakdowns[c.key];
        const bdHtml = Object.keys(bd).length > 0 ? 
            Object.entries(bd).map(([client, amount]) => `
                <div style="display: flex; justify-content: space-between; overflow: hidden; white-space: nowrap; margin-bottom: 2px;">
                    <span style="overflow: hidden; text-overflow: ellipsis; max-width: 60%;">${client}</span>
                    <span style="font-weight: 600;">$${amount.toLocaleString('es-CO')}</span>
                </div>
            `).join('') 
            : '<div style="color: var(--text-secondary); text-align: center; font-style: italic;">Sin gestiones</div>';

        return `
        <div class="stats-card" style="border-top: 4px solid ${c.clr}; background: ${c.bg}; display: flex; flex-direction: column;">
            <h3 style="margin-bottom: 0.5rem; color: ${c.clr}">${c.label.toUpperCase()}</h3>
            
            <div class="finance-breakdown" style="flex: 1; max-height: 150px; overflow-y: auto; font-size: 0.75rem; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 0.5rem; margin-bottom: 0.5rem;">
                ${bdHtml}
            </div>

            <div style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary)">$${c.val.toLocaleString('es-CO')}</div>
            <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">Total acumulado: ${periodLabel}</p>
        </div>
        `
    }).join('');
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
    
    const conflictLocal = tasks.find(t => 
        t.id !== taskId && 
        t.equipmentId === equipmentId && 
        t.period === formatPeriod() &&
        t.scheduledDays.some(sd => scheduledDays.some(nsd => nsd.day === sd.day))
    );
    
    if(conflictLocal) return false;
    if(!supabaseClient) return true;
    
    try {
        const { data, error } = await supabaseClient
            .from('tasks')
            .select('id, client, scheduled_days')
            .eq('equipment_id', equipmentId)
            .eq('period', formatPeriod())
            .neq('id', taskId);
            
        if(error) {
            console.error("Error validating availability:", error);
            return true;
        }
        
        const conflictDb = data.find(t => 
            t.scheduled_days.some(sd => scheduledDays.some(nsd => nsd.day === sd.day))
        );
        
        return !conflictDb;
    } catch(err) {
        console.error("Critical error validating availability:", err);
        return true;
    }
}

// Supabase Sync Logic
async function saveTaskToSupabase(task) {
    if(!supabaseClient) return;
    try {
        const taskData = {
            id: (task.id && (typeof task.id === 'string' && task.id.startsWith('t'))) ? undefined : task.id, 
            client: task.client,
            analyst: task.analyst,
            budget: task.budget,
            days_field: task.daysField,
            days_report: task.daysReport,
            scheduled_days: task.scheduledDays,
            status: task.status,
            period: task.period,
            equipment_id: task.equipmentId || null,
            service_type: task.serviceType,
            is_absence: task.isAbsence || false,
            csat_score: task.csatScore || null,
            csat_observations: task.csatObservations || null,
            alertvox_checked: task.alertvoxChecked || false,
            mes_facturacion: task.mesFacturacion || task.period,
            analysts_assignment: task.analysts_assignment || [] 
        };
        
        let result;
        if(task.supabaseId || (task.id && !task.id.startsWith('t'))) {
            result = await supabaseClient.from('tasks').upsert({ ...taskData, id: task.supabaseId || task.id });
        } else {
            result = await supabaseClient.from('tasks').insert(taskData).select();
            if(result.data) task.supabaseId = result.data[0].id;
        }
        
        if(result.error) console.error("Error saving to Supabase:", result.error);
    } catch(err) {
        console.error("Sync error:", err);
    }
}

async function loadTasksFromSupabase() {
    if(!supabaseClient) {
        console.warn("Supabase client not initialized.");
        return;
    }
    try {
        console.log("Cargando gestiones desde Supabase...");
        
        // Cargamos todas las gestiones para asegurar que el backlog y otros periodos se vean
        const { data, error } = await supabaseClient
            .from('tasks')
            .select('*');
            
        if(error) {
            console.error("Error cargando desde Supabase:", error);
            return;
        }
        
        console.log(`Se cargaron ${data ? data.length : 0} gestiones.`);

        // Limpiar dummies t1, t2, t3
        tasks = tasks.filter(t => !['t1', 't2', 't3'].includes(t.id));

        if(data && data.length > 0) {
            data.forEach(dbTask => {
                const mapped = {
                    id: dbTask.id,
                    supabaseId: dbTask.id,
                    client: dbTask.client,
                    analyst: dbTask.analyst,
                    budget: parseFloat(dbTask.budget),
                    daysField: dbTask.days_field,
                    daysReport: dbTask.days_report,
                    scheduledDays: dbTask.scheduled_days || [],
                    status: dbTask.status,
                    period: dbTask.period,
                    equipmentId: dbTask.equipment_id,
                    serviceType: dbTask.service_type,
                    isAbsence: dbTask.is_absence,
                    csatScore: dbTask.csat_score,
                    csatObservations: dbTask.csat_observations,
                    alertvoxChecked: dbTask.alertvox_checked,
                    mesFacturacion: dbTask.mes_facturacion || dbTask.period,
                    analysts_assignment: dbTask.analysts_assignment || []
                };
                
                const idx = tasks.findIndex(t => t.id === mapped.id || (t.supabaseId && t.supabaseId === mapped.id));
                if(idx !== -1) {
                    tasks[idx] = mapped;
                } else {
                    tasks.push(mapped);
                }
            });
            saveTasks();
        }
        
        // Refrescar UI tras la carga
        renderBoard();
        renderCalendar();
        if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();

        if(document.getElementById('view-finance')?.classList.contains('active-view')) {
            populateFinanceMonths();
        }
    } catch (err) {
        console.error("Error crítico en loadTasksFromSupabase:", err);
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

function openEditTaskModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;

    closeModal('taskInfoModal');
    
    document.getElementById('taskModalTitle').textContent = 'Editar Gestión';
    document.getElementById('taskFormSubmit').textContent = 'Guardar Cambios';
    document.getElementById('editTaskId').value = taskId;

    const clientSelect = document.getElementById('taskClient');
    clientSelect.innerHTML = '<option value="">Seleccione un cliente...</option>';
    dbClients.forEach(c => {
        const clientText = getClientDisplayName(c);
        const selected = (task.client === clientText) ? 'selected' : '';
        clientSelect.innerHTML += `<option value="${c.id}" ${selected}>${clientText}</option>`;
    });

    document.getElementById('taskBudget').value = task.budget;
    document.getElementById('taskDaysField').value = task.daysField || 1;
    document.getElementById('taskDaysReport').value = task.daysReport || 0;

    const dateInputStr = task.scheduledDays && task.scheduledDays.length > 0
        ? task.scheduledDays.map(d => d.date ? d.date : `${task.period}-${String(d.day).padStart(2,'0')}`).join(', ')
        : '';
    const dateInputEl = document.getElementById('taskScheduledDate');
    if(dateInputEl) dateInputEl.value = dateInputStr;

    const equipSel = document.getElementById('taskEquipment');
    equipSel.innerHTML = '<option value="">Sin equipo asignado</option>';
    dbEquipment.forEach(eq => {
        const selected = (task.equipmentId === eq.id) ? 'selected' : '';
        equipSel.innerHTML += `<option value="${eq.id}" ${selected}>${eq.name}${eq.serial_number ? ' - S/N: '+eq.serial_number : ''}</option>`;
    });

    const container = document.getElementById('taskAnalystsContainer');
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

    const serviceTypeSel = document.getElementById('taskServiceType');
    if(serviceTypeSel) {
        serviceTypeSel.value = task.serviceType || '';
        onTaskServiceTypeChange(); 
    }

    document.getElementById('taskModal').classList.add('active');
    
    populateBillingMonthSelect();
    document.getElementById('taskBillingMonth').value = task.mesFacturacion || task.period || formatPeriod();
}

function openCsatModal(taskId, targetStatus) {
    document.getElementById('csatForm').reset();
    document.getElementById('csatTaskId').value = taskId;
    document.getElementById('csatTargetStatus').value = targetStatus;
    document.getElementById('csatModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

document.getElementById('taskForm').addEventListener('submit', e => {
    e.preventDefault();
    
    const clientSelect = document.getElementById('taskClient');
    const clientName = clientSelect.options[clientSelect.selectedIndex].text;
    
    const equipSelect = document.getElementById('taskEquipment');
    const equipId = equipSelect.value;
    const equipName = equipId ? equipSelect.options[equipSelect.selectedIndex].text : '';
    
    const budget = parseFloat(document.getElementById('taskBudget').value);
    const dField = parseInt(document.getElementById('taskDaysField').value) || 1;
    const dReport = parseInt(document.getElementById('taskDaysReport').value) || 0;
    const serviceType = document.getElementById('taskServiceType').value;
    const editId = document.getElementById('editTaskId').value;

    const isAbsence = (serviceType === 'Vacaciones' || serviceType === 'Incapacidad');
    const finalClientName = isAbsence ? `AUSENCIA: ${serviceType}` : clientName;

    const container = document.getElementById('taskAnalystsContainer');
    const rows = container.querySelectorAll('.analyst-row');
    let analystsAssignment = [];
    let totalPercentage = 0;
    
    rows.forEach(row => {
        const aName = row.querySelector('.analyst-select').value;
        const isTitular = row.querySelector('.analyst-titular').checked;
        const makesReport = row.querySelector('.analyst-report').checked;
        const pct = parseFloat(row.querySelector('.analyst-pct').value) || 0;
        
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

    if(!isAbsence && analystsAssignment.length > 0 && Math.abs(totalPercentage - 100) > 0.01) {
        alert("El porcentaje financiero total debe sumar exactamente 100%. Actualmente suma " + totalPercentage + "%.");
        return;
    }

    const mainAnalyst = analystsAssignment.length > 0 
        ? (analystsAssignment.find(a => a.isTitular) || analystsAssignment[0]).name 
        : '';
    let displayAnalyst = analystsAssignment.length > 0
        ? analystsAssignment.map(a => `${a.name} (${a.percentage}%)`).join(', ')
        : '';
    if(analystsAssignment.length === 1) displayAnalyst = mainAnalyst;

    const taskObj = editId ? tasks.find(t=>t.id===editId) : null;
    validateEquipmentAvailability(equipId, editId, taskObj ? taskObj.scheduledDays : []).then(available => {
        if(!available) {
            alert("Debe escoger otro equipo para esta fecha, el equipo seleccionado ya se encuentra ocupado.");
            return;
        }

        if(editId) {
            const idx = tasks.findIndex(t => t.id === editId);
            if(idx !== -1) {
                tasks[idx].client = finalClientName;
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
                logActivity(`✏️ Se actualizó la gestión de <strong>${finalClientName}</strong>.`, 'update');
            }
        } else {
            const newTask = {
                id: generateId(),
                client: finalClientName,
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
                status: 'proyectada',
                period: formatPeriod(),
                mesFacturacion: document.getElementById('taskBillingMonth').value
            };
            tasks.push(newTask);
            logActivity(`✨ Se proyectó la gestión de <strong>${finalClientName}</strong>.`, 'create');
        }
        
        saveTasks();
        if(editId) {
            const task = tasks.find(t=>t.id===editId);
            if(task) saveTaskToSupabase(task);
        } else {
            saveTaskToSupabase(tasks[tasks.length - 1]);
        }
        
        renderBoard();
        renderCalendar();
        renderPlanningSidebar();
        renderTasksView(); 
        closeModal('taskModal');
    });
    
    document.getElementById('editTaskId').value = '';
    document.getElementById('taskModalTitle').textContent = 'Nueva Gestión';
    document.getElementById('taskFormSubmit').textContent = 'Crear Gestión';
});

function openClosingMeetingModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;

    openCsatModal(taskId, task.status);
    
    document.getElementById('csatModalTitle').textContent = 'Reunión de Cierre de Gestión';
    document.getElementById('csatSubmitBtn').textContent = 'Guardar Registro de Cierre';
    
    document.getElementById('csatScore').value = task.csatScore || 5;
    document.getElementById('csatObservations').value = task.csatObservations || '';
    document.getElementById('checkAlertvox').checked = task.alertvoxChecked || false;
}

document.getElementById('csatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const taskId = document.getElementById('csatTaskId').value;
    const targetStatus = document.getElementById('csatTargetStatus').value;
    const score = document.getElementById('csatScore').value;
    const observations = document.getElementById('csatObservations').value;
    const alertvox = document.getElementById('checkAlertvox').checked;
    
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if(taskIndex !== -1) {
        const oldStatus = tasks[taskIndex].status;
        tasks[taskIndex].status = targetStatus;
        tasks[taskIndex].csatScore = score;
        tasks[taskIndex].csatObservations = observations;
        tasks[taskIndex].alertvoxChecked = alertvox;
        
        let logMsg = `✅ Registro de cierre para <strong>${tasks[taskIndex].client}</strong> actualizado. CSAT: <strong>⭐ ${score}/5</strong>.`;
        if (oldStatus !== targetStatus) {
            logMsg += ` Estado cambió a <strong>${targetStatus.toUpperCase()}</strong>.`;
        }
        
        logActivity(logMsg, 'csat');
        
        saveTasks();
        await saveTaskToSupabase(tasks[taskIndex]);
        
        renderBoard();
        renderCalendar();
        renderPlanningSidebar();
        renderTasksView();
        closeModal('csatModal');
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
    
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) {
        const titles = {
            dashboard: 'Dashboard',
            planning: 'Cronograma Semanal/Mensual',
            message: 'Bitácora de Movimientos',
            tasks: 'Gestión de Tareas',
            finance: 'Módulo de Finanzas',
            admin: 'Administración de Datos Maestros'
        };
        headerTitle.textContent = titles[viewName] || 'CBM Maestro';
    }

    if(viewName === 'planning') {
        renderCalendar();
        renderPlanningSidebar();
    } else if(viewName === 'message') {
        renderActivityLog();
    } else if(viewName === 'tasks') {
        renderTasksView();
    } else if(viewName === 'finance') {
        populateFinanceMonths();
        renderFinanceView();
    } else if(viewName === 'admin') {
        renderAdminView();
    } else {
        renderBoard();
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
                                <span class="action-icon edit" onclick="editAnalyst('${a.id}')">📝</span>
                                <span class="action-icon delete" onclick="deleteAnalyst('${a.id}')">🗑️</span>
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
                                <span class="action-icon edit" onclick="openPreferenceModal('${c.id}')" title="Asignar Analistas">👥</span>
                                <span class="action-icon edit" onclick="editClient('${c.id}')" title="Editar">📝</span>
                                <span class="action-icon delete" onclick="deleteClient('${c.id}')" title="Borrar">🗑️</span>
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
                                    <span class="action-icon edit" onclick="editEquipment('${e.id}')">📝</span>
                                    <span class="action-icon delete" onclick="deleteEquipment('${e.id}')">🗑️</span>
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

async function submitAdminForm(e, type) {
    e.preventDefault();
    if(!supabaseClient) return;
    try {
        if(type === 'analyst') {
            await supabaseClient.from('analysts').insert({
                name: document.getElementById('addA_name').value,
                specialty: document.getElementById('addA_spec').value
            });
        } else if(type === 'client') {
            await supabaseClient.from('clients').insert({
                company_name: document.getElementById('addC_plant').value,
                plant: document.getElementById('addC_plant').value,
                contact_name: document.getElementById('addC_contact').value
            });
        } else if(type === 'equipment') {
            await supabaseClient.from('equipment').insert({
                name: document.getElementById('addE_name').value,
                serial_number: document.getElementById('addE_serial').value || null
            });
        }
    } catch(err) {
        console.error("Error inserting data:", err);
    }
    closeModal('adminDataModal');
    await loadMasterData();
    renderAdminView();
    renderCalendar();
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

    window.postDropSync = postDropSync;
    updatePeriodDisplay();
    
    try {
        await loadMasterData();
        if(supabaseClient) {
            await loadTasksFromSupabase();
        }
    } catch (err) {
        console.error("Error cargando datos iniciales:", err);
    }
    
    renderBoard();
    renderCalendar();
    if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
    if(typeof renderAdminView === 'function') renderAdminView();

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
                logActivity(`🔄 La gestión <strong>${task.client}</strong> se ha devuelto al estado <strong>PROYECTADA</strong>.`, 'status');
                await updateTaskStatus(task.id, 'proyectada');
            }
        });
    }

    const logDateFilter = document.getElementById('log-filter-date');
    const logTypeFilter = document.getElementById('log-filter-type');
    if(logDateFilter && !window._logDateListenerAttached) {
        window._logDateListenerAttached = true;
        logDateFilter.addEventListener('input', renderActivityLog);
    }
    if(logTypeFilter && !window._logTypeListenerAttached) {
        window._logTypeListenerAttached = true;
        logTypeFilter.addEventListener('change', renderActivityLog);
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
