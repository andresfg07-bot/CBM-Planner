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
    
    const unassignedTasks = filteredTasks;
    
    unassignedTasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.draggable = true;
        card.id = task.id;
        card.innerHTML = `
            <div class="card-title">${task.client}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                <div class="card-budget" style="margin-bottom: 0; font-size: 0.75rem;">$<span style="font-weight:400">${task.budget.toLocaleString('es-CO')}</span></div>
                <div style="font-size: 0.7rem; color: var(--clr-blue); font-weight: 700; background: var(--clr-blue-light); padding: 2px 6px; border-radius: 4px;">
                    ${task.analyst || 'Sin Analista'}
                </div>
            </div>
        `;
        
        // Inherit drag logic
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
        card.addEventListener('click', function(e) {
            if(!this.classList.contains('dragging')) openTaskInfoModal(task.id);
        });
        
        sidebarContainer.appendChild(card);
    });
}

// Render Activity Log (Blog Style)
function renderActivityLog() {
    const feed = document.getElementById('activity-feed');
    if(!feed) return;
    
    // Obtener valores de filtros
    const filterDate = document.getElementById('log-filter-date')?.value;
    const filterType = document.getElementById('log-filter-type')?.value;
    
    feed.innerHTML = '';
    
    let filteredLogs = activityLog;
    
    // Filtrar por Tipo
    if(filterType && filterType !== 'all') {
        filteredLogs = filteredLogs.filter(log => log.type === filterType);
    }
    
    // Filtrar por Fecha (YYYY-MM-DD vs timestamp)
    if(filterDate) {
        filteredLogs = filteredLogs.filter(log => {
            const logDate = new Date(log.timestamp).toISOString().split('T')[0];
            return logDate === filterDate;
        });
    }
    
    if(filteredLogs.length === 0) {
        feed.innerHTML = '<div style="text-align: center; color: var(--text-secondary); margin-top: 2rem;">No se encontraron registros con los filtros seleccionados.</div>';
        return;
    }
    
    let tableRows = filteredLogs.map(log => {
        let borderColor = 'var(--border-color)';
        if(log.type === 'create') borderColor = 'var(--clr-blue)';
        if(log.type === 'assign') borderColor = 'var(--clr-purple)';
        if(log.type === 'status') borderColor = 'var(--clr-yellow)';
        if(log.type === 'csat') borderColor = 'var(--clr-green)';
        
        const dateObj = new Date(log.timestamp);
        const timeString = dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        const dateString = dateObj.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
        
        return `
            <tr>
                <td style="font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; border-left: 4px solid ${borderColor}; padding: 0.5rem 0.75rem;">
                    ${dateString} <span style="font-weight: 700;">${timeString}</span>
                </td>
                <td style="font-size: 0.8rem; line-height: 1.2; padding: 0.5rem 0.75rem; color: var(--text-primary);">
                    ${log.message}
                </td>
            </tr>
        `;
    }).join('');

    feed.innerHTML = `
        <div class="table-container" style="box-shadow: none; border: 1px solid var(--border-color);">
            <table class="data-table log-table" style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="padding: 0.5rem 0.75rem; background: var(--bg-color); font-size: 0.7rem;">Fecha y Hora</th>
                        <th style="padding: 0.5rem 0.75rem; background: var(--bg-color); font-size: 0.7rem;">Descripción</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;
}

function resetLogFilters() {
    const dateInput = document.getElementById('log-filter-date');
    const typeSelect = document.getElementById('log-filter-type');
    if(dateInput) dateInput.value = '';
    if(typeSelect) typeSelect.value = 'all';
    renderActivityLog();
}

// Colombian Holidays Logic
let holidaysCache = {};

function getEaster(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const n = Math.floor((h + l - 7 * m + 114) / 31);
    const p = (h + l - 7 * m + 114) % 31;
    return new Date(year, n - 1, p + 1);
}

function nextMonday(date) {
    if (date.getDay() === 1) return new Date(date);
    const daysToAdd = (8 - date.getDay()) % 7;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + (daysToAdd === 0 ? 1 : daysToAdd));
}

function getHolidaysColombia(year) {
    const holidays = [];
    const add = (m, d) => holidays.push(new Date(year, m - 1, d));
    const addNextMonday = (m, d) => holidays.push(nextMonday(new Date(year, m - 1, d)));
    const addRelative = (easter, daysOffset) => {
        const d = new Date(easter);
        d.setDate(d.getDate() + daysOffset);
        holidays.push(d);
    };
    const addRelativeMonday = (easter, daysOffset) => {
        const d = new Date(easter);
        d.setDate(d.getDate() + daysOffset);
        holidays.push(nextMonday(d));
    };

    const easter = getEaster(year);

    add(1, 1);    // Año Nuevo
    add(5, 1);    // Día del Trabajo
    add(7, 20);   // Independencia
    add(8, 7);    // Batalla Boyacá
    add(12, 8);   // Inmaculada Concepción
    add(12, 25);  // Navidad

    addNextMonday(1, 6);   // Reyes Magos
    addNextMonday(3, 19);  // San José
    addNextMonday(6, 29);  // San Pedro y San Pablo
    addNextMonday(8, 15);  // Asunción
    addNextMonday(10, 12); // Descubrimiento de América
    addNextMonday(11, 1);  // Todos los Santos
    addNextMonday(11, 11); // Independencia de Cartagena

    addRelative(easter, -3); // Jueves Santo
    addRelative(easter, -2); // Viernes Santo
    addRelativeMonday(easter, 43); // Ascensión (+39 -> lunes 43)
    addRelativeMonday(easter, 64); // Corpus Christi (+60 -> lunes 64)
    addRelativeMonday(easter, 71); // Sagrado Corazón (+68 -> lunes 71)

    return holidays.map(d => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`);
}

function isHolidayOrWeekend(year, month, day) {
    const d = new Date(year, month - 1, day);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return true; // Domingo (0) o Sábado (6)
    
    if(!holidaysCache[year]) {
        holidaysCache[year] = getHolidaysColombia(year);
    }
    const dateStr = `${year}-${month}-${day}`;
    return holidaysCache[year].includes(dateStr);
}

// Generate Calendar View
function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    if(!grid) return;
    grid.innerHTML = '';
    
    // Configuración de columnas
    let daysToRender = [];
    if (calendarView === 'month') {
        const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
        for (let i = 1; i <= daysInMonth; i++) {
            daysToRender.push({
                day: i,
                month: currentMonth,
                year: currentYear,
                dateStr: `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(i).padStart(2,'0')}`
            });
        }
    } else {
        // Vista semanal: 7 días desde currentWeekStart
        for (let i = 0; i < 7; i++) {
            const d = new Date(currentWeekStart);
            d.setDate(d.getDate() + i);
            daysToRender.push({
                day: d.getDate(),
                month: d.getMonth() + 1,
                year: d.getFullYear(),
                dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
            });
        }
    }

    const colCount = daysToRender.length;
    // El ancho de columna es flexible '1fr', pero en mes ponemos un mínimo de 60px para el scroll horizontal. 
    // En semana lo dejamos 1fr para que se expanda al máximo.
    const minColWidth = calendarView === 'month' ? '60px' : '100px'; 
    grid.style.gridTemplateColumns = `120px repeat(${colCount}, minmax(${minColWidth}, 1fr))`;
    
    // Aplicar filtros globales a la data que se mostrará en el calendario
    let filteredTasks = tasks.slice().filter(t => isTaskInCurrentPeriod(t));

    if(dashboardFilters.analyst) filteredTasks = filteredTasks.filter(t => t.analyst === dashboardFilters.analyst);
    if(dashboardFilters.client) filteredTasks = filteredTasks.filter(t => t.client === dashboardFilters.client);

    // Header Row (Days)
    grid.innerHTML += `<div class="calendar-header-cell">Analista</div>`;
    daysToRender.forEach(d => {
        const dayName = calendarView === 'week' ? ` <br><small>${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][new Date(d.year, d.month-1, d.day).getDay()]}</small>` : '';
        grid.innerHTML += `<div class="calendar-header-cell">${d.day}${dayName}</div>`;
    });
    
    const activeAnalysts = dbAnalysts.filter(a => a.is_active);
    const rowColors = ['#bfdbfe', '#ddd6fe', '#fbcfe8', '#fde68a', '#bbf7d0', '#fef08a', '#c7d2fe', '#e2e8f0'];
    
    const todayStr = new Date().toISOString().split('T')[0];

    activeAnalysts.forEach((analystObj, idx) => {
        const analista = analystObj.name;
        const rowColor = rowColors[idx % rowColors.length];
        
        // Row Header (Analyst Name)
        grid.innerHTML += `<div class="calendar-row-header" style="background-color: ${rowColor}; font-weight: 700;">Analista ${analista}</div>`;
        
        // Cells for each day
        daysToRender.forEach(d => {
            const cellId = `cal-${analista}-${d.dateStr}`;
            const isSpecialDay = isHolidayOrWeekend(d.year, d.month, d.day);
            const isToday = d.dateStr === todayStr;
            const specialClass = (isSpecialDay ? ' weekend-holiday-cell' : '') + (isToday ? ' today' : '');
            const cellStyle = isSpecialDay ? '' : `background-color: ${rowColor};`;
            
            let cellHTML = `<div class="calendar-cell${specialClass}" id="${cellId}" data-analyst="${analista}" data-day="${d.day}" data-date="${d.dateStr}" style="${cellStyle}">`;
            
            const taskInAnalystRow = filteredTasks.filter(t => {
                if (t.analyst === analista) return true;
                if (t.analysts_assignment && t.analysts_assignment.length > 0) {
                    return t.analysts_assignment.some(a => a.name === analista);
                }
                return false;
            });

            taskInAnalystRow.forEach(t => {
                t.scheduledDays.forEach((sDate, sIdx) => {
                    // Comparación mejorada para soportar cruce de meses en vista semanal
                    const taskDateStr = sDate.date ? sDate.date : `${t.period}-${String(sDate.day).padStart(2,'0')}`;
                    if(taskDateStr === d.dateStr) {
                        // Solo mostrar días de informe al analista asignado para ello
                        if (sDate.type === 'report') {
                            const assignment = t.analysts_assignment ? t.analysts_assignment.find(a => a.name === analista) : null;
                            if (assignment && !assignment.makesReport) return;
                            // Si no hay assignment (legacy), lo dejamos para el analista principal
                            if (!assignment && t.analyst !== analista) return;
                        }
                        const isFinal = t.status === 'ejecutada' || t.status === 'facturada';
                        const draggability = isFinal ? 'false' : 'true';
                        
                        const typeLabel = sDate.type === 'field' ? '(P)' : '(I)';
                        const typeStyle = sDate.type === 'field' ? '' : 'background:var(--clr-purple)';
                        const extraStyle = isFinal ? 'cursor: not-allowed; opacity: 0.8;' : '';
                        
                        cellHTML += `<div class="calendar-task-pill" draggable="${draggability}" id="pill-${t.id}-${sIdx}" data-task-id="${t.id}" data-day-index="${sIdx}" title="${t.client} - ${sDate.type}" style="${typeStyle}; ${extraStyle}">${typeLabel} ${t.client}</div>`;
                    }
                });
            });
            
            cellHTML += `</div>`;
            grid.innerHTML += cellHTML;
        });
    });

    // Add drag and drop listeners to cells
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
            const targetDateStr = cell.getAttribute('data-date'); // NUEVO: Usar el string de fecha completo
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
                    // Rough estimate for auto-programming
                    futureScheduledDays = [{ day: targetDay, date: targetDateStr, type: 'field' }];
                }
                
                const available = await validateEquipmentAvailability(task.equipmentId, task.id, futureScheduledDays);
                if(!available) {
                    alert("Debe escoger otro equipo para esta fecha, el equipo seleccionado ya se encuentra ocupado.");
                    return;
                }
            }

            if (isPillMove) {
                // Mover un día específico
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
                // Arrastrando toda la gestión (desde sidebar o kanban)
                task.analyst = targetAnalyst;
                
                // Auto-programar todos los días si no tenía días programados (Solo en días hábiles)
                if (task.scheduledDays.length === 0) {
                    // Inicializar loopDate desde la fecha del cell
                    const [yStr, mStr, dStr] = targetDateStr.split('-');
                    let loopDate = new Date(parseInt(yStr), parseInt(mStr) - 1, parseInt(dStr));
                    
                    // Asignar días de Planta (P)
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
                    
                    // Asignar días de Informe (I)
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
            
            // Sync specific task to Supabase immediately
            await saveTaskToSupabase(task);
            
            postDropSync();
        });
    });

    // Add drag and click listeners for pill
    document.querySelectorAll('.calendar-task-pill').forEach(pill => {
        pill.addEventListener('dragstart', function(e) {
            if(this.getAttribute('draggable') === 'false') {
                e.preventDefault();
                return;
            }
            draggedTaskId = this.id; // pill-taskid-index
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

// Drag & Drop Logic
let draggedTaskId = null;

function handleDragStart(e) {
    draggedTaskId = this.id;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
}

// Setup Drop Zones
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
                taskId = taskId.split('-')[1]; // Fallback
            }
        }
        
        const taskIndex = tasks.findIndex(t => t.id === taskId);
        
        if (taskIndex !== -1) {
            // Business Rule: CSAT / Hito Check when moving to Ejecutado or Facturable
            if ((newStatus === 'ejecutado' || newStatus === 'facturable') && tasks[taskIndex].status !== newStatus) {
                openCsatModal(taskId, newStatus);
            } else {
                // Determine direction to figure out if it's reverting or advancing
                const task = tasks[taskIndex];
                if(task.status !== newStatus) {
                     logActivity(`🔄 La gestión <strong>${task.client}</strong> se ha movido al estado <strong>${newStatus.toUpperCase()}</strong>.`, 'status');
                }
                
                // Use the update function for proper strict logic and UI refresh
                await updateTaskStatus(task.id, newStatus);
            }
        }
    });
});

// Modal Logic
function openNewTaskModal() {
    document.getElementById('taskForm').reset();
    document.getElementById('editTaskId').value = '';
    document.getElementById('taskModalTitle').textContent = 'Nueva Gestión';
    document.getElementById('taskFormSubmit').textContent = 'Crear Gestión';
    
    // Reset days
    document.getElementById('taskDaysField').value = 1;
    document.getElementById('taskDaysReport').value = 0;
    const dateInputEl = document.getElementById('taskScheduledDate');
    if(dateInputEl) dateInputEl.value = '';
    
    const clientSelect = document.getElementById('taskClient');
    clientSelect.innerHTML = '<option value="">Seleccione un cliente...</option>';
    dbClients.forEach(c => {
        clientSelect.innerHTML += `<option value="${c.id}">${getClientDisplayName(c)}</option>`;
    });
    
    const container = document.getElementById('taskAnalystsContainer');
    if(container) {
        container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); text-align: center;">Seleccione primero un cliente para añadir analistas.</div>';
    }

    const equipSel = document.getElementById('taskEquipment');
    equipSel.innerHTML = '<option value="">Sin equipo asignado</option>';
    dbEquipment.forEach(eq => {
        equipSel.innerHTML += `<option value="${eq.id}">${eq.name}${eq.serial_number ? ' - S/N: '+eq.serial_number : ''}</option>`;
    });

    populateBillingMonthSelect();
    document.getElementById('taskBillingMonth').value = formatPeriod();

    document.getElementById('taskModal').classList.add('active');
    // Ensure visibility is reset for new task
    onTaskServiceTypeChange();
}

function populateBillingMonthSelect() {
    const select = document.getElementById('taskBillingMonth');
    if(!select) return;
    select.innerHTML = '';
    
    // Generar rango de meses (6 meses atrás, 6 adelante)
    const now = new Date();
    for (let i = -6; i <= 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        select.innerHTML += `<option value="${val}">${label}</option>`;
    }
}

function addAnalystToTask(data = null) {
    const container = document.getElementById('taskAnalystsContainer');
    if(container.innerHTML.includes('Seleccione primero')) {
        container.innerHTML = '';
    }

    const row = document.createElement('div');
    row.className = 'analyst-row';
    row.style.display = 'flex';
    row.style.gap = '0.5rem';
    row.style.alignItems = 'center';
    row.style.padding = '0.5rem';
    row.style.background = 'white';
    row.style.border = '1px solid #e2e8f0';
    row.style.borderRadius = '4px';

    const isTitularChecked = data && data.isTitular ? 'checked' : (!data && container.children.length === 0 ? 'checked' : '');
    const isReportChecked = data && data.makesReport ? 'checked' : '';
    const pctValue = data && data.percentage !== undefined ? data.percentage : (container.children.length === 0 ? 100 : 0);

    row.innerHTML = `
        <select class="analyst-select" style="flex: 2; padding: 0.4rem; font-size: 0.8rem; border: 1px solid #cbd5e1; border-radius: 4px;" required>
            <option value="">Seleccione Analista...</option>
            ${dbAnalysts.map(a => `<option value="${a.name}" ${(data && data.name === a.name) ? 'selected' : ''}>${a.name}</option>`).join('')}
        </select>
        <label style="font-size: 0.7rem; display: flex; align-items: center; gap: 2px;">
            <input type="checkbox" class="analyst-titular" ${isTitularChecked}> Titular
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
    
    // Solo auto-poblar si el contenedor está vacío o en estado inicial
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
        // En ausencias, mostrar todos sin depender de un cliente
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
        // Solo recargar si el cliente cambió o no hay analista seleccionado
        onTaskClientChange(); 
    }
}

function openTaskInfoModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;
    
    document.getElementById('infoClient').textContent = task.client;
    document.getElementById('infoAnalyst').textContent = task.analyst ? `Analista ${task.analyst}` : 'Sin Asignar';
    
    // Equipo
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
    
    // Info Días
    document.getElementById('infoDaysPlanned').textContent = `${task.daysField} Planta / ${task.daysReport} Informe`;
    document.getElementById('infoDaysScheduledCount').textContent = `${task.scheduledDays.length} de ${task.daysField + task.daysReport} días asignados`;
    
    const statusEl = document.getElementById('infoStatus');
    statusEl.textContent = task.status;
    
    // Asignar los colores semánticos a la etiqueta de estado
    const colors = {
        'proyectada': 'var(--clr-blue)',
        'programada': 'var(--clr-purple)',
        'ejecutada': 'var(--clr-pink)',
        'facturada': 'var(--clr-green)'
    };
    statusEl.style.color = colors[task.status] || 'var(--text-primary)';
    
    // Si tiene puntuación CSAT y confirmación de reunión, mostrarlas
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

    // Asignar eventos a botones de Editar y Eliminar
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
    type: 'single', // 'single', 'multiple', 'year'
    selectedMonths: [] // Solo para 'multiple'
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
        
        if(data) {
            // Merge with local tasks
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
                
                const idx = tasks.findIndex(t => t.id === mapped.id || t.supabaseId === mapped.id);
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
    const dateInputEl = document.getElementById('taskScheduledDate');
    if(dateInputEl) dateInputEl.value = dateInputStr;

    // Poblar equipos y seleccionar el actual
    const equipSel = document.getElementById('taskEquipment');
    equipSel.innerHTML = '<option value="">Sin equipo asignado</option>';
    dbEquipment.forEach(eq => {
        const selected = (task.equipmentId === eq.id) ? 'selected' : '';
        equipSel.innerHTML += `<option value="${eq.id}" ${selected}>${eq.name}${eq.serial_number ? ' - S/N: '+eq.serial_number : ''}</option>`;
    });

    // Cargar analistas guardados
    const container = document.getElementById('taskAnalystsContainer');
    container.innerHTML = '';
    
    if (task.analysts_assignment && task.analysts_assignment.length > 0) {
        task.analysts_assignment.forEach(a => addAnalystToTask(a));
    } else {
        // Fallback for older tasks
        addAnalystToTask({
            name: task.analyst || '',
            isTitular: true,
            makesReport: true,
            percentage: 100
        });
    }

    // Cargar Tipo de Servicio y disparar el cambio de visibilidad
    const serviceTypeSel = document.getElementById('taskServiceType');
    if(serviceTypeSel) {
        serviceTypeSel.value = task.serviceType || '';
        onTaskServiceTypeChange(); 
    }

    document.getElementById('taskModal').classList.add('active');
    
    populateBillingMonthSelect();
    document.getElementById('taskBillingMonth').value = task.mesFacturacion || task.period || formatPeriod();
}

function deleteTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if(!task) return;

    if(confirm(`¿Estás seguro de que deseas eliminar la gestión de "${task.client}"? Esta acción no se puede deshacer.`)) {
        tasks = tasks.filter(t => t.id !== taskId);
        logActivity(`🗑️ Se ha eliminado la gestión de <strong>${task.client}</strong>.`, 'delete');
        saveTasks();
        renderBoard();
        renderCalendar();
        renderPlanningSidebar();
        renderTasksView();
        closeModal('taskInfoModal');
    }
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

// Form Submissions
document.getElementById('taskForm').addEventListener('submit', e => {
    e.preventDefault();
    
    const clientSelect = document.getElementById('taskClient');
    const clientName = clientSelect.options[clientSelect.selectedIndex].text;
    
    // Equipo
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

    // Analistas Múltiples
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
    const equip = dbEquipment.find(e => e.id === id);
    if(!equip) return;
    const newName = prompt("Editar nombre del equipo:", equip.name);
    if(!newName) return;
    const newSerial = prompt("Editar Serie (S/N):", equip.serial_number || '');
    if(!supabaseClient) return;
    try {
        await supabaseClient.from('equipment').update({ name: newName, serial_number: newSerial }).eq('id', id);
        await loadMasterData();
        renderAdminView();
    } catch(err) { console.error(err); }
}

async function deleteEquipment(id) {
    if(confirm("Está seguro de que desea eliminar este equipo?")) {
        if(!supabaseClient) return;
        try {
            await supabaseClient.from('equipment').delete().eq('id', id);
            await loadMasterData();
            renderAdminView();
        } catch(err) { console.error(err); }
    }
}

function openAdminModal(type) {
    const title = document.getElementById('adminModalTitle');
    const content = document.getElementById('adminModalContent');
    
    if(type === 'analyst') {
        title.textContent = 'Nuevo Analista';
        content.innerHTML = `
            <form id="formAddAnalyst" onsubmit="submitAdminForm(event, 'analyst')">
                <div class="form-group"><label>Nombre</label><input type="text" id="addA_name" required></div>
                <div class="form-group"><label>Especialidad</label><input type="text" id="addA_spec"></div>
                <button type="submit" class="btn-primary" style="width:100%">Guardar Analista</button>
            </form>
        `;
    } else if(type === 'client') {
        title.textContent = 'Nuevo Cliente';
        content.innerHTML = `
            <form id="formAddClient" onsubmit="submitAdminForm(event, 'client')">
                <div class="form-group"><label>Planta / Empresa</label><input type="text" id="addC_plant" required></div>
                <div class="form-group"><label>Contacto</label><input type="text" id="addC_contact"></div>
                <button type="submit" class="btn-primary" style="width:100%">Guardar Cliente</button>
            </form>
        `;
    } else if(type === 'equipment') {
        title.textContent = 'Nuevo Equipo';
        content.innerHTML = `
            <form id="formAddEquip" onsubmit="submitAdminForm(event, 'equipment')">
                <div class="form-group"><label>Nombre del Equipo</label><input type="text" id="addE_name" placeholder="Ej: CSI 2140" required></div>
                <input type="hidden" id="addE_type" value="CBM">
                <div class="form-group"><label>Serie (S/N)</label><input type="text" id="addE_serial"></div>
                <button type="submit" class="btn-primary" style="width:100%">Guardar Equipo</button>
            </form>
        `;
    }
    
    document.getElementById('adminDataModal').classList.add('active');
}

function openPreferencesModal(clientId, companyName) {
    const title = document.getElementById('adminModalTitle');
    const content = document.getElementById('adminModalContent');
    
    title.textContent = `Prioridades para ${companyName}`;
    content.innerHTML = `
        <form id="formAddPref" onsubmit="submitPreferenceForm(event, '${clientId}')">
            <div class="form-group">
                <label>Seleccionar Analista</label>
                <select id="prefAnalyst" required>
                    <option value="">Seleccionar...</option>
                    ${dbAnalysts.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Nivel de Prioridad</label>
                <select id="prefLevel" required>
                    <option value="Primary">Analista Principal (Primary)</option>
                    <option value="Secondary">Analista Secundario (Secondary)</option>
                    <option value="Backup">Analista de Respaldo (Backup)</option>
                </select>
            </div>
            <button type="submit" class="btn-primary bg-purple" style="width:100%">Vincular Analista</button>
        </form>
        <div id="prefList" style="margin-top: 1.5rem; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
            <!-- Render priorities for this client -->
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
            const { error } = await supabaseClient.from('analysts').insert({
                name: document.getElementById('addA_name').value,
                specialty: document.getElementById('addA_spec').value
            });
            if(error) console.error("Error analysts:", error);
        } else if(type === 'client') {
            const { error } = await supabaseClient.from('clients').insert({
                company_name: document.getElementById('addC_plant').value,
                plant: document.getElementById('addC_plant').value,
                contact_name: document.getElementById('addC_contact').value
            });
            if(error) console.error("Error clients:", error);
        } else if(type === 'equipment') {
            const { error } = await supabaseClient.from('equipment').insert({
                name: document.getElementById('addE_name').value,
                serial_number: document.getElementById('addE_serial').value || null
            });
            if(error) console.error("Error equipment:", error);
        }
    } catch(err) {
        console.error("Error inserting data:", err);
    }
    closeModal('adminDataModal');
    // Refresh Data
    await loadMasterData();
    renderAdminView();
    renderCalendar(); // Refresh calendar rows
}

async function submitPreferenceForm(e, clientId) {
    e.preventDefault();
    if(!supabaseClient) return;
    const analystId = document.getElementById('prefAnalyst').value;
    const level = document.getElementById('prefLevel').value;
    
    try {
        await supabaseClient.from('client_analyst_preferences').delete().match({ client_id: clientId, analyst_id: analystId });
        const { error } = await supabaseClient.from('client_analyst_preferences').insert({
            client_id: clientId,
            analyst_id: analystId,
            priority_level: level
        });
        if(error) console.error(error);
    } catch(err) {
        console.error(err);
    }
    
    loadPreferences(clientId); // Refresh list
}

async function deletePreference(clientId, analystId) {
    if(!supabaseClient) return;
    await supabaseClient.from('client_analyst_preferences').delete().match({ client_id: clientId, analyst_id: analystId });
    loadPreferences(clientId);
}
/* === AUTHENTICATION LOGIC === */
let currentUser = null;

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
        if(authContainer) authContainer.style.display = 'none';
        if(appWrapper) appWrapper.style.display = 'flex';
        await initializeApp();
    } else {
        currentUser = null;
        if(authContainer) authContainer.style.display = 'flex';
        if(appWrapper) appWrapper.style.display = 'none';
        // Reset init flag when logged out so it reloads fresh data next time
        window._appInitialized = false; 
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmitBtn');
    
    if(!supabaseClient) return;
    
    if(errorDiv) errorDiv.style.display = 'none';
    if(submitBtn) {
        submitBtn.textContent = 'Verificando...';
        submitBtn.disabled = true;
    }
    
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    
    if (error) {
        if(errorDiv) errorDiv.style.display = 'block';
        if(submitBtn) {
            submitBtn.textContent = 'Ingresar al Sistema';
            submitBtn.disabled = false;
        }
    } else {
        if(submitBtn) submitBtn.textContent = 'Ingresando...';
        // onAuthStateChange se encargará de la redirección
    }
}

async function handleLogout() {
    if(!supabaseClient) return;
    const submitBtn = document.getElementById('loginSubmitBtn');
    if(submitBtn) {
        submitBtn.textContent = 'Ingresar al Sistema';
        submitBtn.disabled = false;
    }
    await supabaseClient.auth.signOut();
}

async function initializeApp() {
    // Only run if not already initialized
    if(window._appInitialized) return;
    window._appInitialized = true;

    // Definir globalmente postDropSync
    window.postDropSync = postDropSync;
    
    updatePeriodDisplay();
    
    // 1. Cargar datos maestros (Analistas, Clientes, Equipos)
    await loadMasterData();
    
    // 2. Cargar tareas desde Supabase
    if(supabaseClient) {
        await loadTasksFromSupabase();
    }
    
    // 3. Renderizar todas las vistas con los datos ya cargados
    renderBoard();
    renderCalendar();
    if(typeof renderPlanningSidebar === 'function') renderPlanningSidebar();
    if(typeof renderAdminView === 'function') renderAdminView();

    // Setup drag-back listener for the unassigned sidebar (Solo una vez)
    const sidebarContainer = document.getElementById('planning-sidebar-items');
    // Prevenir listeners duplicados
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

    // Log filters listeners
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

// Initial Render Bootstrap
document.addEventListener('DOMContentLoaded', async () => {
    // Iniciamos revisando la sesión para saber qué pantalla mostrar
    await checkSession();
});
