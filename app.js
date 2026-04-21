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
    renderDashboardCharts();
}

function updateGlobalFilter(type, value) {
    dashboardFilters[type] = value;
    
    // Refresh all relevant views
    renderBoard();
    renderDashboardStats();
    renderCalendar();
    renderPlanningSidebar();
    renderTasksView();
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
    
    // Refresh all views
    renderBoard();
    renderDashboardStats();
    renderCalendar();
    renderPlanningSidebar();
    renderTasksView();
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
    renderDashboardCharts();
}

function renderDashboardCharts() {
    // 1. Preparar datos segun el scope actual (ya filtrados en renderDashboardStats o filtrarlos aqui)
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
        // Solo contar analistas activos o que tengan data
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

    // Colores premium
    const bgColors = [
        'rgba(37, 99, 235, 0.8)',  // clr-blue
        'rgba(147, 51, 234, 0.8)', // clr-purple
        'rgba(16, 185, 129, 0.8)', // clr-green
        'rgba(244, 63, 94, 0.8)',  // clr-pink
        'rgba(245, 158, 11, 0.8)',  // clr-orange
        'rgba(14, 165, 233, 0.8)', // Sky blue
        'rgba(100, 116, 139, 0.8)' // Slate
    ];

    // Destruir instancias previas si existen
    if(workloadChartInstance) workloadChartInstance.destroy();
    if(billingChartInstance) billingChartInstance.destroy();

    const ctxWorkload = document.getElementById('workloadChart');
    if (ctxWorkload) {
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
    }

    const ctxBilling = document.getElementById('billingChart');
    if (ctxBilling) {
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
    
    // Sort and collect all scheduled days
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
    
    // Sort by day
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
    
    // Filtrado de Tareas en Sidebar (respetando filtros globales)
    let filteredTasks = tasks.filter(t => t.status === 'proyectada' && isTaskInCurrentPeriod(t));
    
    if(dashboardFilters.analyst) filteredTasks = filteredTasks.filter(t => t.analyst === dashboardFilters.analyst);
    if(dashboardFilters.client) filteredTasks = filteredTasks.filter(t => t.client === dashboardFilters.client);

    filteredTasks.forEach(t => {
        const item = document.createElement('div');
        item.className = 'planning-sidebar-item';
        item.draggable = true;
        item.dataset.taskId = t.id;
        item.innerHTML = `
            <div style="font-weight:700; margin-bottom:0.2rem;">${t.client}</div>
            <div style="font-size:0.75rem; color:var(--text-secondary)">Analista: ${t.analyst || 'Pendiente'}</div>
            <div style="font-size:0.7rem; margin-top:0.3rem;">
                <span class="card-analyst" style="font-size:0.6rem; padding:1px 4px;">${t.serviceType || 'CBM'}</span>
                <span style="margin-left:0.5rem; color:var(--clr-green); font-weight:600">$${(t.budget||0).toLocaleString('es-CO')}</span>
            </div>
        `;
        
        item.addEventListener('dragstart', e => {
            e.dataTransfer.setData('taskId', t.id);
            item.classList.add('dragging');
        });
        
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
        });

        item.addEventListener('click', () => openTaskDetailModal(t.id));
        
        sidebarContainer.appendChild(item);
    });
}

function renderCalendar() {
    const calendarGrid = document.getElementById('calendar-grid');
    if(!calendarGrid) return;
    calendarGrid.innerHTML = '';
    
    if (calendarView === 'month') {
        renderMonthView(calendarGrid);
    } else {
        renderWeekView(calendarGrid);
    }
}

function renderMonthView(container) {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const firstDayIndex = new Date(currentYear, currentMonth - 1, 1).getDay(); // 0 is Sunday
    
    const filterAnalyst = dashboardFilters.analyst;
    const filterClient = dashboardFilters.client;

    // Empty slots for previous month
    for (let i = 0; i < firstDayIndex; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        container.appendChild(emptyCell);
    }

    const today = new Date();
    const isCurrentMonth = today.getMonth() + 1 === currentMonth && today.getFullYear() === currentYear;

    for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        if(isCurrentMonth && today.getDate() === d) cell.classList.add('today');
        
        cell.innerHTML = `<div class="day-number">${d}</div><div class="tasks-container"></div>`;
        
        // Filter tasks scheduled on this day
        const dayTasks = tasks.filter(t => 
            t.status !== 'proyectada' && 
            t.scheduledDays && 
            t.scheduledDays.some(sd => {
                const sdDate = sd.date ? new Date(sd.date + 'T00:00:00') : null;
                if (sdDate) {
                    return sdDate.getDate() === d && (sdDate.getMonth() + 1) === currentMonth && sdDate.getFullYear() === currentYear;
                }
                return sd.day === d && t.period === formatPeriod();
            })
        );
        
        const tasksContainer = cell.querySelector('.tasks-container');
        
        dayTasks.forEach(t => {
            // Apply analyst and client filters
            if(filterAnalyst && t.analyst !== filterAnalyst) return;
            if(filterClient && t.client !== filterClient) return;

            const taskEl = document.createElement('div');
            taskEl.className = `calendar-task ${t.status}`;
            if(t.isAbsence) taskEl.classList.add('absence');
            
            // Determinar si es un día de reporte o de campo
            const dayInfo = t.scheduledDays.find(sd => {
                const sdDate = sd.date ? new Date(sd.date + 'T00:00:00') : null;
                if (sdDate) {
                    return sdDate.getDate() === d && (sdDate.getMonth() + 1) === currentMonth && sdDate.getFullYear() === currentYear;
                }
                return sd.day === d;
            });
            const typeLabel = dayInfo && dayInfo.type === 'report' ? '📝' : '';
            
            taskEl.innerHTML = `<span>${typeLabel} ${t.client}</span>`;
            taskEl.title = `${t.client} (${t.status.toUpperCase()})${t.analyst ? ' - ' + t.analyst : ''}`;
            taskEl.addEventListener('click', (e) => {
                e.stopPropagation();
                openTaskDetailModal(t.id);
            });
            tasksContainer.appendChild(taskEl);
        });

        // Drop handling
        cell.addEventListener('dragover', e => {
            e.preventDefault();
            cell.classList.add('drag-over');
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
        cell.addEventListener('drop', e => {
            e.preventDefault();
            cell.classList.remove('drag-over');
            const taskId = e.dataTransfer.getData('taskId');
            assignTaskToDay(taskId, d);
        });

        container.appendChild(cell);
    }
}

function renderWeekView(container) {
    container.style.gridTemplateColumns = 'repeat(7, 1fr)';
    
    const filterAnalyst = dashboardFilters.analyst;
    const filterClient = dashboardFilters.client;

    const today = new Date();
    today.setHours(0,0,0,0);

    for (let i = 0; i < 7; i++) {
        const currentDay = new Date(currentWeekStart);
        currentDay.setDate(currentDay.getDate() + i);
        const dayNum = currentDay.getDate();
        const monthNum = currentDay.getMonth() + 1;
        const yearNum = currentDay.getFullYear();
        
        const cell = document.createElement('div');
        cell.className = 'calendar-day week-view';
        if (currentDay.getTime() === today.getTime()) cell.classList.add('today');
        
        const dayName = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][currentDay.getDay()];
        cell.innerHTML = `
            <div class="day-header-week">
                <span class="day-name">${dayName}</span>
                <span class="day-number">${dayNum}</span>
            </div>
            <div class="tasks-container"></div>
        `;
        
        // Filtrar tareas para este día específico
        const dayTasks = tasks.filter(t => 
            t.status !== 'proyectada' && 
            t.scheduledDays && 
            t.scheduledDays.some(sd => {
                const sdDate = sd.date ? new Date(sd.date + 'T00:00:00') : null;
                if (sdDate) {
                    return sdDate.getDate() === dayNum && (sdDate.getMonth() + 1) === monthNum && sdDate.getFullYear() === yearNum;
                }
                // Fallback para datos viejos que solo tenían 'day' y dependían del 'period' global
                return sd.day === dayNum && t.period === `${yearNum}-${monthNum.toString().padStart(2,'0')}`;
            })
        );
        
        const tasksContainer = cell.querySelector('.tasks-container');
        dayTasks.forEach(t => {
            if(filterAnalyst && t.analyst !== filterAnalyst) return;
            if(filterClient && t.client !== filterClient) return;

            const taskEl = document.createElement('div');
            taskEl.className = `calendar-task ${t.status}`;
            if(t.isAbsence) taskEl.classList.add('absence');
            
            const dayInfo = t.scheduledDays.find(sd => {
                const sdDate = sd.date ? new Date(sd.date + 'T00:00:00') : null;
                if (sdDate) return sdDate.getDate() === dayNum && (sdDate.getMonth() + 1) === monthNum;
                return sd.day === dayNum;
            });
            const typeLabel = dayInfo && dayInfo.type === 'report' ? '📝' : '';
            
            taskEl.innerHTML = `
                <div style="font-weight:700; font-size:0.75rem;">${typeLabel} ${t.client}</div>
                <div style="font-size:0.65rem; opacity:0.9;">${t.analyst || ''}</div>
            `;
            taskEl.addEventListener('click', (e) => {
                e.stopPropagation();
                openTaskDetailModal(t.id);
            });
            tasksContainer.appendChild(taskEl);
        });

        // Drop handling
        cell.addEventListener('dragover', e => {
            e.preventDefault();
            cell.classList.add('drag-over');
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
        cell.addEventListener('drop', e => {
            e.preventDefault();
            cell.classList.remove('drag-over');
            const taskId = e.dataTransfer.getData('taskId');
            
            // Para la vista semanal, necesitamos pasar la fecha completa o el día relativo al mes de la celda
            assignTaskToDay(taskId, dayNum, `${yearNum}-${monthNum.toString().padStart(2,'0')}`);
        });

        container.appendChild(cell);
    }
}

async function assignTaskToDay(taskId, day, customPeriod) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;
    
    const targetPeriod = customPeriod || formatPeriod();

    // Si ya está en otro estado, no permitir re-asignar desde el sidebar (aunque el sidebar solo muestra proyectadas)
    if(task.status !== 'proyectada') {
        // Lógica para mover entre días (拖拽 en el calendario) - Pendiente implementar
        return;
    }

    // Validar disponibilidad del equipo
    const isAvailable = await validateEquipmentAvailability(task.equipmentId, task.id, [{ day, type: 'field' }]);
    if(!isAvailable) {
        alert("El equipo seleccionado no está disponible para este día.");
        return;
    }

    task.status = 'programada';
    task.period = targetPeriod;
    task.scheduledDays = [{ day: day, type: 'field', date: `${targetPeriod}-${String(day).padStart(2,'0')}` }];
    
    // Si la gestión requiere más días (field o report), abrir modal para completar
    if(task.daysField > 1 || task.daysReport > 0) {
        openEditTaskModal(task.id);
    } else {
        saveTasks();
        if(supabaseClient) await saveTaskToSupabase(task);
        renderCalendar();
        renderPlanningSidebar();
        logActivity(`📅 Se programó <strong>${task.client}</strong> para el día ${day}.`, 'assign');
    }
}

function openTaskDetailModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;
    
    const modal = document.getElementById('taskInfoModal');
    const content = document.getElementById('taskInfoContent');
    if(!modal || !content) return;
    
    const daysStr = task.scheduledDays ? task.scheduledDays.map(d => `${d.day} (${d.type === 'report' ? 'Reporte' : 'Campo'})`).join(', ') : 'No asignados';
    
    content.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div>
                <p><strong>Cliente:</strong><br>${task.client}</p>
                <p><strong>Analista:</strong><br>${task.analyst || 'No asignado'}</p>
                <p><strong>Estado:</strong><br><span class="card-status ${task.status}">${task.status.toUpperCase()}</span></p>
                <p><strong>Tipo Servicio:</strong><br>${task.serviceType || 'CBM'}</p>
            </div>
            <div>
                <p><strong>Presupuesto:</strong><br>$${(task.budget || 0).toLocaleString('es-CO')}</p>
                <p><strong>Equipo:</strong><br>${task.equipment || 'Ninguno'}</p>
                <p><strong>Días Programados:</strong><br>${daysStr}</p>
                <p><strong>Mes Facturación:</strong><br>${task.mesFacturacion || task.period}</p>
            </div>
        </div>
        ${task.csatScore ? `
        <div style="margin-top:1rem; padding:1rem; background:var(--clr-green-light); border-radius:8px;">
            <p style="margin:0"><strong>Satisfacción Cliente (CSAT):</strong> ⭐ ${task.csatScore}/5</p>
            <p style="margin:0.5rem 0 0 0; font-style:italic; font-size:0.85rem">"${task.csatObservations || ''}"</p>
        </div>` : ''}
        <div style="margin-top: 1.5rem; display: flex; gap: 0.5rem;">
            <button class="btn-primary" onclick="openEditTaskModal('${task.id}')">Editar Gestión</button>
            <button class="btn-secondary" onclick="closeModal('taskInfoModal')">Cerrar</button>
        </div>
    `;
    
    modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if(modal) modal.classList.remove('active');
}

function openTaskModal() {
    // Reset form
    document.getElementById('taskModalTitle').textContent = 'Nueva Gestión';
    document.getElementById('taskFormSubmit').textContent = 'Crear Gestión';
    document.getElementById('editTaskId').value = '';
    document.getElementById('taskForm').reset();
    
    // Poblar clientes
    const clientSelect = document.getElementById('taskClient');
    clientSelect.innerHTML = '<option value="">Seleccione un cliente...</option>';
    dbClients.forEach(c => {
        clientSelect.innerHTML += `<option value="${c.id}">${getClientDisplayName(c)}</option>`;
    });

    // Poblar analistas en la tabla de asignación
    resetAnalystAssignmentTable();
    
    // Poblar equipos
    const equipSelect = document.getElementById('taskEquipment');
    equipSelect.innerHTML = '<option value="">Seleccione un equipo...</option>';
    dbEquipment.forEach(e => {
        equipSelect.innerHTML += `<option value="${e.id}">${e.name} (${e.serial_number || 'S/N'})</option>`;
    });

    // Mes de facturacion default
    document.getElementById('taskBillingMonth').value = formatPeriod();

    document.getElementById('taskModal').classList.add('active');
}

function resetAnalystAssignmentTable() {
    const tbody = document.querySelector('#analyst-assignment-table tbody');
    tbody.innerHTML = '';
    addAnalystRow(); // Empezar con una fila
}

function addAnalystRow(selectedAnalyst = '', isTitular = false, makesReport = false, percentage = 100) {
    const tbody = document.querySelector('#analyst-assignment-table tbody');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>
            <select class="analyst-name" style="width:100%; font-size:0.8rem;">
                <option value="">Seleccione...</option>
                ${dbAnalysts.map(a => `<option value="${a.name}" ${selectedAnalyst === a.name ? 'selected' : ''}>${a.name}</option>`).join('')}
            </select>
        </td>
        <td style="text-align:center"><input type="checkbox" class="analyst-titular" ${isTitular ? 'checked' : ''} onchange="handleTitularChange(this)"></td>
        <td style="text-align:center"><input type="checkbox" class="analyst-report" ${makesReport ? 'checked' : ''}></td>
        <td><input type="number" class="analyst-pct" value="${percentage}" min="0" max="100" style="width:100%; font-size:0.8rem;"></td>
        <td><button type="button" class="btn-secondary" onclick="this.closest('tr').remove()" style="padding:2px 5px; font-size:0.7rem;">✕</button></td>
    `;
    tbody.appendChild(row);
}

function handleTitularChange(checkbox) {
    if(checkbox.checked) {
        // Desmarcar otros titulares
        const allTitulars = document.querySelectorAll('.analyst-titular');
        allTitulars.forEach(cb => {
            if(cb !== checkbox) cb.checked = false;
        });
    }
}

document.getElementById('taskForm').addEventListener('submit', e => {
    e.preventDefault();
    
    const editId = document.getElementById('editTaskId').value;
    const clientId = document.getElementById('taskClient').value;
    const clientObj = dbClients.find(c => c.id === clientId);
    const clientNameFromSelect = clientObj ? getClientDisplayName(clientObj) : '';
    
    // Si es edición y no se cambió el cliente, usar el que ya tenía
    const existingTask = editId ? tasks.find(t => t.id === editId) : null;
    const finalClientName = clientNameFromSelect || (existingTask ? existingTask.client : '');

    if(!finalClientName) {
        alert("Por favor seleccione un cliente");
        return;
    }

    const equipId = document.getElementById('taskEquipment').value;
    const equipObj = dbEquipment.find(e => e.id === equipId);
    const equipName = equipObj ? equipObj.name : '';
    const budget = parseFloat(document.getElementById('taskBudget').value) || 0;
    const dField = parseInt(document.getElementById('taskDaysField').value) || 1;
    const dReport = parseInt(document.getElementById('taskDaysReport').value) || 0;
    const serviceType = document.getElementById('taskServiceType').value;
    const isAbsence = document.getElementById('taskIsAbsence').checked;

    // Recoger asignación de analistas
    const analystsAssignment = [];
    let totalPercentage = 0;
    document.querySelectorAll('#analyst-assignment-table tbody tr').forEach(row => {
        const aName = row.querySelector('.analyst-name').value;
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

    // Validation
    const taskObj = editId ? tasks.find(t=>t.id===editId) : null;
    validateEquipmentAvailability(equipId, editId, taskObj ? taskObj.scheduledDays : []).then(available => {
        if(!available) {
            alert("Debe escoger otro equipo para esta fecha, el equipo seleccionado ya se encuentra ocupado.");
            return;
        }

        if(editId) {
            // ACTUALIZAR
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
            // CREAR
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
    
    // Limpiar estado edición para la próxima vez
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
    
    // El openCsatModal ya resetea el form y añade la clase active, pero nosotros queremos sobreescribir campos:
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

// View Navigation Logic
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

// Update Global Drop logic across Kanban to force sidebar sync
function postDropSync() {
    saveTasks();
    renderBoard();
    renderCalendar();
    if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
}

// Overwrite the normal saveTasks in the drop listeners:
// Wait, to be elegant I'll define postDropSync above and call it inside the existing drop events.

// Admin Data Module & App Initialization
async function loadMasterData() {
    if(!supabaseClient) {
        console.warn("Supabase client is not available.");
        return;
    }
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

    // Añadir botón de sincronización masiva si no existe
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

    
    // Render Analysts Table
    analystsList.innerHTML = `
    <div class="table-container">
        <table class="data-table dense-table">
            <thead>
                <tr>
                    <th style="width: 35%;">Nombre</th>
                    <th style="width: 30%;">Especialidad</th>
                    <th style="width: 20%;">Estado</th>
                    <th style="width: 15%;">Acción</th>
                </tr>
            </thead>
            <tbody>
                ${dbAnalysts.map(a => `
                <tr>
                    <td><strong>${a.name}</strong></td>
                    <td>${a.specialty || '-'}</td>
                    <td><span class="card-analyst" style="background: ${a.is_active ? 'var(--clr-green-light)' : 'var(--clr-pink-light)'}; color: ${a.is_active ? 'var(--clr-green)' : 'var(--clr-pink)'}">${a.is_active ? 'Activo' : 'Inactivo'}</span></td>
                    <td>
                        <div class="action-icons" style="gap: 10px;">
                            <span class="action-icon edit" onclick="editAnalyst('${a.id}')" title="Editar" style="font-size: 1.1rem; cursor: pointer;">📝</span>
                            <span class="action-icon delete" onclick="deleteAnalyst('${a.id}')" title="Borrar" style="font-size: 1.1rem; cursor: pointer;">🗑️</span>
                        </div>
                    </td>
                </tr>
                `).join('')}
                <tr>
                    <td><input type="text" id="qa_analyst_name" placeholder="Nuevo analista..." onkeydown="if(event.key==='Enter') quickAddAnalyst()"></td>
                    <td><input type="text" id="qa_analyst_spec" placeholder="Especialidad..." onkeydown="if(event.key==='Enter') quickAddAnalyst()"></td>
                    <td style="font-size:0.8rem; color:var(--text-secondary)">Nuevo</td>
                    <td><button class="btn-primary" style="padding:0.4rem; font-size:0.8rem; width:100%" onclick="quickAddAnalyst()">Guardar</button></td>
                </tr>
            </tbody>
        </table>
    </div>`;
    
    // Render Clients Table
    clientsList.innerHTML = `
    <div class="table-container">
        <table class="data-table dense-table">
            <thead>
                <tr>
                    <th style="width: 35%;">Planta</th>
                    <th style="width: 30%;">Contacto</th>
                    <th style="width: 20%;">Ciudad</th>
                    <th style="width: 15%;">Acción</th>
                </tr>
            </thead>
            <tbody>
                ${dbClients.map(c => `
                <tr>
                    <td><strong>${getClientDisplayName(c)}</strong></td>
                    <td>${c.contact_name || '-'}</td>
                    <td>
                        <div class="action-icons" style="gap: 10px;">
                            <span class="action-icon edit" onclick="openPreferencesModal('${c.id}', '${c.company_name}')" title="Prioridades" style="font-size: 1.1rem; cursor: pointer;">⭐</span>
                            <span class="action-icon edit" onclick="editClient('${c.id}')" title="Editar" style="font-size: 1.1rem; cursor: pointer;">📝</span>
                            <span class="action-icon delete" onclick="deleteClient('${c.id}')" title="Borrar" style="font-size: 1.1rem; cursor: pointer;">🗑️</span>
                        </div>
                    </td>
                </tr>
                `).join('')}
                <tr>
                    <td><input type="text" id="qa_client_plant" placeholder="Nombre Planta..." onkeydown="if(event.key==='Enter') quickAddClient()"></td>
                    <td><input type="text" id="qa_client_contact" placeholder="Contacto..." onkeydown="if(event.key==='Enter') quickAddClient()"></td>
                    <td><button class="btn-primary" style="padding:0.4rem; font-size:0.8rem; width:100%" onclick="quickAddClient()">Guardar</button></td>
                </tr>
            </tbody>
        </table>
    </div>`;

    renderEquipmentTable();
}

// ----------------------------------------------------
// ADMIN EQUIPMENT RENDER
// ----------------------------------------------------
function renderEquipmentTable() {
    const equipList = document.getElementById('admin-equipment-list');
    if(!equipList) return;
    equipList.innerHTML = `
    <div class="table-container">
        <table class="data-table dense-table">
            <thead><tr>
                <th style="width: 40%;">Nombre del Equipo</th>
                <th style="width: 25%;">Serie (S/N)</th>
                <th style="width: 20%;">Estado</th>
                <th style="width: 15%;">Acción</th>
            </tr></thead>
            <tbody>
                ${dbEquipment.map(eq => `
                <tr>
                    <td><strong>${eq.name}</strong></td>
                    <td style="font-size:0.85rem">${eq.serial_number || '-'}</td>
                    <td><span class="card-analyst" style="background:${eq.is_active ? 'var(--clr-green-light)':'var(--clr-pink-light)'}; color:${eq.is_active ? 'var(--clr-green)':'var(--clr-pink)'}">${eq.is_active ? 'Activo':'Inactivo'}</span></td>
                    <td>
                        <div class="action-icons" style="gap: 10px;">
                            <span class="action-icon edit" onclick="editEquipment('${eq.id}')" title="Editar" style="font-size: 1.1rem; cursor: pointer;">📝</span>
                            <span class="action-icon delete" onclick="deleteEquipment('${eq.id}')" title="Borrar" style="font-size: 1.1rem; cursor: pointer;">🗑️</span>
                        </div>
                    </td>
                </tr>
                `).join('')}
                <tr>
                    <td><input type="text" id="qa_equip_name" placeholder="Ej: CSI 2140..." onkeydown="if(event.key==='Enter') quickAddEquipment()"></td>
                    <td><input type="text" id="qa_equip_serial" placeholder="S/N (opcional)" onkeydown="if(event.key==='Enter') quickAddEquipment()"></td>
                    <td style="font-size:0.8rem; color:var(--text-secondary)">Nuevo</td>
                    <td><button class="btn-primary" style="padding:0.4rem; font-size:0.8rem; width:100%" onclick="quickAddEquipment()">Guardar</button></td>
                </tr>
            </tbody>
        </table>
    </div>`;
}

async function quickAddEquipment() {
    if(!supabaseClient) return;
    const name = document.getElementById('qa_equip_name').value.trim();
    const serial = document.getElementById('qa_equip_serial').value.trim();
    if(!name) { alert('El nombre del equipo es requerido'); return; }
    try {
        const { error } = await supabaseClient.from('equipment').insert({ name, serial_number: serial || null }); // Se quitó type: 'CBM'
        if(error) { console.error(error); return; }
        await loadMasterData();
        renderAdminView();
    } catch(err) { console.error(err); }
}

// ----------------------------------------------------
// TASKS VIEW (GESTIONES) - QUICK ENTRY TABLE
// ----------------------------------------------------
function renderTasksView() {
    const listContainer = document.getElementById('tasks-list-container');
    if(listContainer) renderTasksTable(listContainer);
}

async function quickAddAnalyst() {
    if(!supabaseClient) return;
    const name = document.getElementById('qa_analyst_name').value.trim();
    const spec = document.getElementById('qa_analyst_spec').value.trim();
    if(!name) { alert("El nombre del analista es requerido"); return; }
    
    try {
        const { error } = await supabaseClient.from('analysts').insert({ name: name, specialty: spec });
        if(error) console.error(error);
        await loadMasterData();
        renderAdminView();
        renderCalendar();
    } catch(err) { console.error(err); }
}

async function quickAddClient() {
    if(!supabaseClient) return;
    const plant = document.getElementById('qa_client_plant').value.trim();
    const contact = document.getElementById('qa_client_contact').value.trim();
    if(!plant) { alert("Planta es requerido"); return; }
    
    try {
        const { error } = await supabaseClient.from('clients').insert({ company_name: plant, plant: plant, contact_name: contact });
        if(error) console.error(error);
        await loadMasterData();
        renderAdminView();
        renderCalendar();
    } catch(err) { console.error(err); }
}

function downloadClientTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([["Planta", "Contacto"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    XLSX.writeFile(wb, "Plantilla_Clientes.xlsx");
}

function handleClientImport(event) {
    const file = event.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, {defval: ""});
            
            if(jsonData.length === 0) { alert("El archivo está vacío"); return; }
            
            const recordsToInsert = jsonData.map(row => {
                const plant = row['Planta'] || row['planta'] || row['PLANTA'] || '';
                const contact = row['Contacto'] || row['contacto'] || row['CONTACTO'] || '';
                return {
                    company_name: plant,
                    plant: plant,
                    contact_name: contact
                };
            }).filter(r => r.plant);
            
            if(recordsToInsert.length === 0) {
                alert("No se encontraron registros válidos. Asegúrate de tener la columna 'Planta'.");
                event.target.value = '';
                return;
            }
            
            if(!supabaseClient) { alert("Error de conexión"); return; }
            
            const { error } = await supabaseClient.from('clients').insert(recordsToInsert);
            if(error) {
                console.error("Error importando:", error);
                alert("Hubo un error importando los clientes.");
            } else {
                alert("Importación exitosa. Se añadieron " + recordsToInsert.length + " clientes.");
                await loadMasterData();
                renderAdminView();
                renderCalendar();
            }
        } catch(err) {
            console.error("Error procesando archivo:", err);
            alert("Error procesando el archivo Excel/CSV.");
        }
        event.target.value = ''; // Reset input
    };
    reader.readAsArrayBuffer(file);
}

async function editAnalyst(id) {
    const analyst = dbAnalysts.find(a => a.id === id);
    if(!analyst) return;
    const newName = prompt("Editar nombre:", analyst.name);
    if(!newName) return;
    const newSpec = prompt("Editar especialidad:", analyst.specialty || '');
    if(!supabaseClient) return;
    if(confirm("Desea activar el analista?")) { analyst.is_active = true; } else { analyst.is_active = false; }
    try {
        await supabaseClient.from('analysts').update({ name: newName, specialty: newSpec, is_active: analyst.is_active }).eq('id', id);
        await loadMasterData();
        renderAdminView();
    } catch(err) { console.error(err); }
}

async function deleteAnalyst(id) {
    if(confirm("Está seguro de que desea eliminar este analista?")) {
        if(!supabaseClient) return;
        try {
            await supabaseClient.from('analysts').delete().eq('id', id);
            await loadMasterData();
            renderAdminView();
        } catch(err) { console.error(err); }
    }
}

async function editClient(id) {
    const client = dbClients.find(c => c.id === id);
    if(!client) return;
    const newPlant = prompt("Editar Nombre de la Planta:", client.plant || client.company_name);
    if(!newPlant) return;
    const newContact = prompt("Editar Contacto:", client.contact_name || '');
    if(!supabaseClient) return;
    try {
        await supabaseClient.from('clients').update({ company_name: newPlant, plant: newPlant, contact_name: newContact }).eq('id', id);
        await loadMasterData();
        renderAdminView();
    } catch(err) { console.error(err); }
}

async function deleteClient(id) {
    if(confirm("Está seguro de que desea eliminar este cliente?")) {
        if(!supabaseClient) return;
        try {
            await supabaseClient.from('clients').delete().eq('id', id);
            await loadMasterData();
            renderAdminView();
        } catch(err) { console.error(err); }
    }
}

async function editEquipment(id) {
    const eq = dbEquipment.find(e => e.id === id);
    if(!eq) return;
    const newName = prompt("Editar nombre equipo:", eq.name);
    if(!newName) return;
    const newSerial = prompt("Editar S/N:", eq.serial_number || '');
    if(!supabaseClient) return;
    try {
        await supabaseClient.from('equipment').update({ name: newName, serial_number: newSerial }).eq('id', id);
        await loadMasterData();
        renderAdminView();
    } catch(err) { console.error(err); }
}

async function deleteEquipment(id) {
    if(confirm("Eliminar equipo?")) {
        if(!supabaseClient) return;
        try {
            await supabaseClient.from('equipment').update({ is_active: false }).eq('id', id);
            await loadMasterData();
            renderAdminView();
        } catch(err) { console.error(err); }
    }
}

// Global Activity Log (Memory/Local)
function renderActivityLog() {
    const container = document.getElementById('activity-log-items');
    if(!container) return;
    
    if(activityLog.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-secondary)">Aún no hay actividad registrada.</div>';
        return;
    }
    
    container.innerHTML = activityLog.map(log => {
        const date = new Date(log.timestamp);
        const timeStr = date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
        
        let icon = 'ℹ️';
        if(log.type === 'create') icon = '✨';
        if(log.type === 'assign') icon = '📅';
        if(log.type === 'update') icon = '✏️';
        if(log.type === 'csat') icon = '⭐';
        
        return `
            <div class="log-entry">
                <div class="log-icon">${icon}</div>
                <div class="log-content">
                    <div class="log-message">${log.message}</div>
                    <div class="log-time">${dateStr}, ${timeStr}</div>
                </div>
            </div>
        `;
    }).join('');
}

// CSAT and Meeting Closure
function openCsatModal(taskId, targetStatus) {
    document.getElementById('csatTaskId').value = taskId;
    document.getElementById('csatTargetStatus').value = targetStatus;
    document.getElementById('csatForm').reset();
    document.getElementById('csatModal').classList.add('active');
}

// Finance Module View
let financeFilters = {
    type: 'single', // 'single', 'multiple', 'year'
    selectedMonths: []
};

function changeFinanceType(type) {
    financeFilters.type = type;
    document.querySelectorAll('.view-toggle-group button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`fin-${type}`).classList.add('active');
    
    const monthsContainer = document.getElementById('finance-months-selector');
    if(monthsContainer) {
        monthsContainer.style.display = type === 'multiple' ? 'block' : 'none';
    }
    
    renderFinanceView();
}

function populateFinanceMonths() {
    const container = document.getElementById('finance-months-list');
    if(!container) return;
    container.innerHTML = '';
    
    // Obtener todos los meses presentes en las tareas para que el usuario elija
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
    
    // Decidir qué meses filtrar
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
        
        // Match analyst filter
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

// Validation Logic
async function validateEquipmentAvailability(equipmentId, taskId, scheduledDays) {
    if(!equipmentId || !scheduledDays || scheduledDays.length === 0) return true;
    
    // Check locally first (for speed and offline support)
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
            return true; // Proceed anyway or block? Let's proceed but log.
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
            id: task.id.startsWith('t_') ? undefined : task.id, // Let DB generate UUID if it's local temp ID
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
            analysts_assignment: task.analysts_assignment || [] // Nueva columna en DB
        };
        
        let result;
        if(task.supabaseId || !task.id.startsWith('t_')) {
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
    if(!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('tasks')
            .select('*')
            .eq('period', formatPeriod());
            
        if(error) {
            console.error("Error loading from Supabase:", error);
            return;
        }
        
        // Si logramos conectar a Supabase, eliminamos los datos de prueba iniciales
        // si aún están presentes (id t1, t2, t3) para que no se mezclen con los reales
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
                    scheduledDays: dbTask.scheduled_days,
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
        
        // Populate finance months if in finance view
        if(document.getElementById('view-finance').classList.contains('active-view')) {
            populateFinanceMonths();
        }
    } catch(err) {
        console.error("Load error:", err);
    }
}

// Nueva función para sincronizar todos los datos locales que no están en Supabase
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
            // Solo sincronizar si no tiene id de Supabase o es un ID temporal de local
            if (!task.supabaseId || task.id.startsWith('t_')) {
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
    
    // Preparar el formulario
    document.getElementById('taskModalTitle').textContent = 'Editar Gestión';
    document.getElementById('taskFormSubmit').textContent = 'Guardar Cambios';
    document.getElementById('editTaskId').value = taskId;

    // Poblar clientes y seleccionar el actual
    const clientSelect = document.getElementById('taskClient');
    clientSelect.innerHTML = '<option value="">Seleccione un cliente...</option>';
    dbClients.forEach(c => {
        const clientText = getClientDisplayName(c);
        const selected = (task.client === clientText) ? 'selected' : '';
        clientSelect.innerHTML += `<option value="${c.id}" ${selected}>${clientText}</option>`;
    });

    // Cargar presupuesto e ID de edición
    document.getElementById('taskBudget').value = task.budget;
    document.getElementById('taskDaysField').value = task.daysField || 1;
    document.getElementById('taskDaysReport').value = task.daysReport || 0;

    const dateInputStr = task.scheduledDays && task.scheduledDays.length > 0
        ? task.scheduledDays.map(d => d.date ? d.date : `${task.period}-${String(d.day).padStart(2,'0')}`).join(', ')
        : '';
    document.getElementById('taskDate').value = dateInputStr;
    
    document.getElementById('taskEquipment').value = task.equipmentId || '';
    document.getElementById('taskServiceType').value = task.serviceType || 'CBM';
    document.getElementById('taskIsAbsence').checked = task.isAbsence || false;
    document.getElementById('taskBillingMonth').value = task.mesFacturacion || task.period || formatPeriod();

    // Poblar analistas en la tabla de asignación
    const tbody = document.querySelector('#analyst-assignment-table tbody');
    tbody.innerHTML = '';
    if(task.analysts_assignment && task.analysts_assignment.length > 0) {
        task.analysts_assignment.forEach(a => {
            addAnalystRow(a.name, a.isTitular, a.makesReport, a.percentage);
        });
    } else {
        // Fallback: tratar al analista principal como titular 100%
        addAnalystRow(task.analyst, true, true, 100);
    }

    document.getElementById('taskModal').classList.add('active');
}

// Auth Management
let currentUser = null;

async function checkSession() {
    if(!supabaseClient) return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    handleAuthChange(session);
}

function handleAuthChange(session) {
    const authContainer = document.getElementById('auth-container');
    const appWrapper = document.getElementById('app-wrapper');
    
    if (session) {
        currentUser = session.user;
        if(authContainer) authContainer.style.display = 'none';
        if(appWrapper) appWrapper.style.display = 'flex';
        initializeApp();
    } else {
        currentUser = null;
        if(authContainer) authContainer.style.display = 'flex';
        if(appWrapper) appWrapper.style.display = 'none';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;
    const loginBtn = document.getElementById('login-btn');
    
    loginBtn.textContent = 'Entrando...';
    loginBtn.disabled = true;
    
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
    
    if (error) {
        alert("Error: " + error.message);
        loginBtn.textContent = 'Entrar al Sistema';
        loginBtn.disabled = false;
    }
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
}

async function initializeApp() {
    await loadMasterData();
    await loadTasksFromSupabase();
    
    updatePeriodDisplay();
    renderBoard();
    renderCalendar();
    renderPlanningSidebar();
    
    // Auth listeners
    supabaseClient.auth.onAuthStateChange((_event, session) => {
        handleAuthChange(session);
    });
}

// Client Preferences (⭐)
function openPreferencesModal(clientId, clientName) {
    const modal = document.getElementById('preferencesModal');
    const title = document.getElementById('prefModalTitle');
    const tbody = document.querySelector('#pref-analysts-table tbody');
    
    if(!modal || !tbody) return;
    
    title.textContent = `Analistas Preferidos: ${clientName}`;
    document.getElementById('prefClientId').value = clientId;
    tbody.innerHTML = '';
    
    // Fetch current preferences for this client
    fetchPreferences(clientId).then(prefs => {
        dbAnalysts.forEach(a => {
            const pref = prefs.find(p => p.analyst_id === a.id);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${a.name}</td>
                <td style="text-align:center"><input type="radio" name="priority_1" value="${a.id}" ${pref && pref.priority === 1 ? 'checked' : ''}></td>
                <td style="text-align:center"><input type="radio" name="priority_2" value="${a.id}" ${pref && pref.priority === 2 ? 'checked' : ''}></td>
                <td style="text-align:center"><input type="radio" name="priority_3" value="${a.id}" ${pref && pref.priority === 3 ? 'checked' : ''}></td>
            `;
            tbody.appendChild(row);
        });
    });
    
    modal.classList.add('active');
}

async function fetchPreferences(clientId) {
    if(!supabaseClient) return [];
    const { data, error } = await supabaseClient.from('client_analyst_preferences').select('*').eq('client_id', clientId);
    if(error) return [];
    return data;
}

async function savePreferences() {
    const clientId = document.getElementById('prefClientId').value;
    const prefsToSave = [];
    
    [1, 2, 3].forEach(priority => {
        const selected = document.querySelector(`input[name="priority_${priority}"]:checked`);
        if(selected) {
            prefsToSave.push({
                client_id: clientId,
                analyst_id: selected.value,
                priority: priority
            });
        }
    });
    
    if(!supabaseClient) return;
    
    // Delete old
    await supabaseClient.from('client_analyst_preferences').delete().eq('client_id', clientId);
    // Insert new
    if(prefsToSave.length > 0) {
        await supabaseClient.from('client_analyst_preferences').insert(prefsToSave);
    }
    
    closeModal('preferencesModal');
    alert("Preferencias guardadas.");
}

// Start everything
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    
    const loginForm = document.getElementById('login-form');
    if(loginForm) loginForm.addEventListener('submit', handleLogin);
    
    const logoutBtn = document.getElementById('btn-logout');
    if(logoutBtn) logoutBtn.addEventListener('click', handleLogout);
});
