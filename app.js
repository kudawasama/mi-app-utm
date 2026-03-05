/**
 * LÓGICA PRINCIPAL DE LA APLICACIÓN DE CONTROL FINANCIERO
 * --------------------------------------------------------
 * Este archivo gestiona los cálculos, el almacenamiento local,
 * los gráficos y la conexión con la API de indicadores.
 */

document.addEventListener('DOMContentLoaded', () => {

    // Versión de la aplicación (debe coincidir con la del Service Worker)
    const APP_VERSION = 'v19';

    // Mostrar versión inmediatamente (antes de cargar datos para asegurar que se vea)
    const versionEl = document.getElementById('app-version-display');
    if (versionEl) versionEl.textContent = APP_VERSION;

    // --- REGISTRO DEL SERVICE WORKER (Para soporte PWA/Offline) ---
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            // Forzar actualización si hay cambios
            reg.onupdatefound = () => {
                const installingWorker = reg.installing;
                installingWorker.onstatechange = () => {
                    if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        location.reload();
                    }
                };
            };
        }).catch(() => { });
    }

    // --- VARIABLES GLOBALES Y CONFIGURACIÓN ---
    const API_URL_BASE = 'https://mindicador.cl/api'; // Fuente de datos económicos
    let allUtmData = []; // Guardará el historial de la UTM
    let utmChart = null; // Instancia del gráfico de UTM
    let categoryChart = null; // Instancia del gráfico circular

    // Cargar datos desde la memoria del navegador (localStorage)
    // Si no existen, se inicializan como listas vacías []
    let incomes = JSON.parse(localStorage.getItem('myIncomes')) || [];
    let expenses = JSON.parse(localStorage.getItem('myExpenses')) || [];
    let recurrents = JSON.parse(localStorage.getItem('myRecurrents')) || [];
    let tasks = JSON.parse(localStorage.getItem('myTasks')) || [];

    // Preferencia de ocultar montos (persistida en localStorage)
    let hideAmounts = localStorage.getItem('hideAmounts') === 'true';

    // Periodo Inicial: se carga desde localStorage o se usa 'all' por defecto
    let currentPeriod = localStorage.getItem('myAppCurrentPeriod') || 'all';

    // --- ELEMENTOS DEL DOM (Vínculos con HTML) ---
    const utmValueEl = document.getElementById('utm-value');
    const ufValueEl = document.getElementById('uf-value');
    const dolarValueEl = document.getElementById('dolar-value');
    const calc45El = document.getElementById('calc-45');
    const trendEl = document.getElementById('trend-indicator');
    const monthSelector = document.getElementById('month-selector');
    const periodSelector = document.getElementById('global-period-selector');
    const periodDisplay = document.getElementById('period-display-text');

    const totalIncomeEl = document.getElementById('total-income');
    const totalExpenseEl = document.getElementById('total-expense');
    const totalPendingEl = document.getElementById('total-pending');
    const netBalanceEl = document.getElementById('net-balance');
    const netContainer = document.querySelector('.net-balance-dashboard');
    const toggleHideAmounts = document.getElementById('toggle-hide-amounts');

    const formTask = document.getElementById('form-task');
    const taskDescInput = document.getElementById('task-desc');
    const taskDateInput = document.getElementById('task-date');
    const taskListEl = document.getElementById('task-list');
    const taskCountEl = document.getElementById('task-count');

    const btnQuickAdd = document.getElementById('btn-quick-add');
    const quickModal = document.getElementById('quick-add-modal');
    const importFileInput = document.getElementById('import-file');

    const editModal = document.getElementById('edit-modal');
    const formEdit = document.getElementById('form-edit');

    // --- GESTIÓN DE TEMAS (DISEÑO) ---
    const initTheme = () => {
        const savedTheme = localStorage.getItem('appTheme') || 'glass';
        document.body.setAttribute('data-theme', savedTheme);

        // Crear botón de cambio de tema e inyectarlo en el header
        const themeBtn = document.createElement('button');
        themeBtn.className = 'btn-action';
        themeBtn.innerHTML = '💻'; // Icono
        themeBtn.title = 'Cambiar Diseño (Matrix/Glass)';
        themeBtn.onclick = () => {
            const current = document.body.getAttribute('data-theme') || 'glass';
            const next = current === 'glass' ? 'matrix' : 'glass';
            document.body.setAttribute('data-theme', next);
            localStorage.setItem('appTheme', next);
            // Actualizar gráficos para reflejar nuevos colores
            renderAll();
            if (allUtmData.length) renderUtmChart(allUtmData.slice(0, 8).reverse());
        };

        const headerActions = document.querySelector('.header-actions');
        if (headerActions) headerActions.prepend(themeBtn);
    };

    // --- FUNCIONES DE UTILIDAD ---

    /**
     * Formatea un número como moneda chilena (Puntos de miles, sin decimales)
     */
    const formattedCurrency = (val) => new Intl.NumberFormat('es-CL').format(Math.round(val));

    /**
     * Muestra el monto formateado o asteriscos si la opción de ocultar está activa
     */
    const renderAmount = (amount) => hideAmounts ? '*****' : '$' + formattedCurrency(amount);

    /**
     * Genera una URL de Google Calendar para un gasto pendiente.
     * Al abrirse, Google Calendar muestra el formulario del evento pre-llenado.
     */
    const createGoogleCalendarUrl = (item, isTask = false) => {
        let startDate = '';
        let endDate = '';

        if (item.date && item.date.includes('T')) {
            // Formato ISO Datetime (YYYY-MM-DDTHH:MM)
            const baseDate = item.date.replace(/[-:]/g, ''); // YYYYMMDDTHHMM
            startDate = baseDate + '00'; // Añadir segundos

            // Fecha fin = 1 hora después (por defecto para tareas con hora)
            const d = new Date(item.date);
            d.setHours(d.getHours() + 1);
            endDate = d.toISOString().replace(/[-:]/g, '').split('.')[0];
        } else {
            // Formato solo fecha o fallbacks
            let dateForCal = '';
            if (item.date && item.date.includes('/')) {
                const [d, m, y] = item.date.split('/');
                dateForCal = `${y}${m}${d}`;
            } else if (item.date && item.date.includes('-')) {
                dateForCal = item.date.replace(/-/g, '');
            } else {
                const now = new Date();
                dateForCal = now.toISOString().split('T')[0].replace(/-/g, '');
            }

            startDate = dateForCal;
            const y = parseInt(startDate.slice(0, 4));
            const m = parseInt(startDate.slice(4, 6)) - 1;
            const d = parseInt(startDate.slice(6, 8));
            const nextDay = new Date(y, m, d + 1);
            endDate = nextDay.toISOString().split('T')[0].replace(/-/g, '');
        }

        const prefix = isTask ? '\uD83D\uDCDD Tarea: ' : '\uD83D\uDCB0 Pagar: ';
        const title = encodeURIComponent(prefix + (item.desc || ''));

        let detailsText = '';
        if (isTask) {
            const dateStr = item.date ? item.date.replace('T', ' ') : 'Sin fecha';
            detailsText = `Tarea: ${item.desc}\nFecha/Hora: ${dateStr}`;
        } else {
            detailsText = `Monto: $${formattedCurrency(item.amount)}\nCategoría: ${item.category || 'General'}\n` +
                (item.notes ? `Notas: ${item.notes}\n` : '');
        }

        const details = encodeURIComponent(detailsText + `\n\n--- Generado por Mi App UTM ---`);

        return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${details}&trp=true`;
    };

    /**
     * Convierte una fecha ISO (Año-Mes-Día o Datetime) al formato visual chileno con hora opcional
     */
    const formatToCLDateTime = (dateStr) => {
        if (!dateStr) return '-';
        if (dateStr.includes('/')) return dateStr;

        if (dateStr.includes('T')) {
            const [date, time] = dateStr.split('T');
            const [y, m, d] = date.split('-');
            return `${d}/${m}/${y} ${time}`;
        }

        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    };

    /**
     * Obtiene la fecha de hoy en formato ISO (YYYY-MM-DD) para los inputs de fecha
     */
    const getTodayString = () => new Date().toISOString().split('T')[0];

    /**
     * Convierte una fecha ISO (Año-Mes-Día) al formato visual chileno (Día/Mes/Año)
     */
    const formatToCLDate = (dateISO) => {
        if (!dateISO) return '-';
        if (dateISO.includes('/')) return dateISO;
        const [y, m, d] = dateISO.split('-');
        return `${d}/${m}/${y}`;
    };

    /**
     * Convierte una fecha chilena (D/M/Y) de vuelta a ISO (Y-M-D) para poder editarla en un input de fecha
     */
    const parseToISODate = (dateCL) => {
        if (!dateCL || !dateCL.includes('/')) return getTodayString();
        const [d, m, y] = dateCL.split('/');
        return `${y}-${m}-${d}`;
    };

    /**
     * Extrae el Periodo (Año-Mes) de una fecha de forma ultra-robusta.
     * Soporta DD/MM/YYYY, YYYY-MM-DD, timestamps y objetos Date.
     */
    const getPeriodFromDate = (dateInput) => {
        try {
            if (!dateInput) return 'unknown';
            let dateStr = dateInput;

            if (typeof dateStr === 'number') {
                const d = new Date(dateStr);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            }

            if (typeof dateStr !== 'string') return 'unknown';
            dateStr = dateStr.trim();

            if (dateStr.includes('/')) {
                const parts = dateStr.split('/');
                if (parts.length >= 3) {
                    const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                    const month = parts[1].padStart(2, '0');
                    return `${year}-${month}`;
                }
            }

            if (dateStr.includes('-')) {
                const parts = dateStr.split('-');
                if (parts.length >= 3) {
                    if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}`;
                    if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}`;
                } else if (parts.length === 2) {
                    return `${parts[0]}-${parts[1].padStart(2, '0')}`;
                }
            }

            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            }

            return 'unknown';
        } catch (e) {
            return 'unknown';
        }
    };

    /**
     * Realiza una animación numérica (contador) en un elemento de texto
     */
    const animateValue = (el, start, end, duration) => {
        if (!el || isNaN(start) || isNaN(end)) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            el.innerText = formattedCurrency(Math.floor(progress * (end - start) + start));
            if (progress < 1) window.requestAnimationFrame(step);
            else el.innerText = formattedCurrency(end);
        };
        window.requestAnimationFrame(step);
    };

    // --- LÓGICA DE PERIODOS (FILTROS) ---

    /**
     * Escanea todos los registros y crea las opciones del selector de meses
     */
    const setupPeriodSelector = () => {
        try {
            const periods = new Set();
            periods.add(new Date().toISOString().slice(0, 7)); // Siempre incluir mes actual

            // Buscar meses únicos en los datos
            [...incomes, ...expenses].forEach(item => {
                if (item && item.date) {
                    const p = getPeriodFromDate(item.date);
                    if (p && p.length === 7) periods.add(p);
                }
            });

            // Ordenar de más reciente a más antiguo
            const sortedPeriods = Array.from(periods).sort().reverse();
            periodSelector.innerHTML = '<option value="all">Ver Todos los Periodos</option>';

            sortedPeriods.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                const [y, m] = p.split('-');
                const tempDate = new Date(parseInt(y), parseInt(m) - 1, 2);
                opt.textContent = tempDate.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
                periodSelector.appendChild(opt);
            });

            periodSelector.value = currentPeriod;
            updatePeriodDisplayText();
        } catch (err) {
            console.error("Error al configurar selector de periodos:", err);
        }
    };

    /**
     * Actualiza el texto de cabecera que indica qué periodo estamos viendo
     */
    const updatePeriodDisplayText = () => {
        if (!periodDisplay) return;
        if (currentPeriod === 'all') {
            periodDisplay.textContent = "Mostrando Historial Completo";
        } else {
            const [y, m] = currentPeriod.split('-');
            const displayDate = new Date(parseInt(y), parseInt(m) - 1, 2);
            periodDisplay.textContent = displayDate.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
        }
    };

    // --- GASTOS RECURRENTES (Automatización) ---

    /**
     * Revisa si ha cambiado el mes y, en tal caso, genera los gastos fijos programados
     */
    const processRecurrents = () => {
        const now = new Date();
        const thisMonthKey = now.toISOString().slice(0, 7);
        const lastProcessed = localStorage.getItem('lastRecurrentProcessed');

        // Si el mes actual no ha sido procesado aún
        if (lastProcessed !== thisMonthKey) {
            recurrents.forEach(rec => {
                const day = String(rec.day).padStart(2, '0');
                const [y, m] = thisMonthKey.split('-');
                const newExpense = {
                    id: `rec-${Date.now()}-${Math.random()}`,
                    date: `${day}/${m}/${y}`,
                    category: rec.category,
                    desc: `[AUTO] ${rec.desc}`,
                    amount: rec.amount,
                    notes: 'Gasto fijo mensual generado automáticamente',
                    paid: false
                };
                expenses.push(newExpense);
            });
            localStorage.setItem('myExpenses', JSON.stringify(expenses));
            localStorage.setItem('lastRecurrentProcessed', thisMonthKey);
        }
    };

    // --- CONEXIÓN CON API MINDICADOR.CL ---

    /**
     * Obtiene los valores de UF, Dólar y UTM desde la API externa
     */
    const fetchIndicators = async () => {
        try {
            // Consulta general (obtener UF y Dólar de hoy)
            const res = await fetch(API_URL_BASE);
            const data = await res.json();

            if (data.uf && data.uf.valor) {
                ufValueEl.classList.remove('skeleton-text');
                ufValueEl.innerText = formattedCurrency(data.uf.valor);
            }
            if (data.dolar && data.dolar.valor) {
                dolarValueEl.classList.remove('skeleton-text');
                dolarValueEl.innerText = formattedCurrency(data.dolar.valor);
            }

            // Consulta histórica de UTM para el selector y el gráfico
            const utmRes = await fetch(`${API_URL_BASE}/utm`);
            const utmData = await utmRes.json();
            if (utmData.serie) {
                allUtmData = utmData.serie;
                populateUtmSelector(allUtmData);
                updateUtmDisplay(0);
            }
        } catch (e) {
            console.error("Error de API - Usando fallback...", e);
            // Si falla la consulta general, intentamos consultas individuales simples
            try {
                const rUf = await fetch(`${API_URL_BASE}/uf`);
                const dUf = await rUf.json();
                ufValueEl.innerText = formattedCurrency(dUf.serie[0].valor);
            } catch (err) { }
        }
    };

    /**
     * Llena el dropdown con los últimos 12 meses de UTM históricos
     */
    const populateUtmSelector = (series) => {
        monthSelector.innerHTML = '';
        series.slice(0, 12).forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            const date = new Date(d.fecha);
            opt.textContent = date.toLocaleDateString('es-CL', { year: 'numeric', month: 'short' });
            monthSelector.appendChild(opt);
        });
        monthSelector.addEventListener('change', (e) => updateUtmDisplay(parseInt(e.target.value)));
    };

    /**
     * Actualiza los valores de UTM y hace los cálculos derivados (ej: 4.5 UTM para multas/tramites)
     */
    const updateUtmDisplay = (index) => {
        const curr = allUtmData[index];
        if (!curr) return;
        const val = curr.valor;
        utmValueEl.classList.remove('skeleton-text');
        calc45El.classList.remove('skeleton-text');
        animateValue(utmValueEl, 0, val, 600);
        animateValue(calc45El, 0, val * 4.5, 700);

        // Calcular tendencia comparando con el mes anterior
        if (allUtmData[index + 1]) {
            const diff = val - allUtmData[index + 1].valor;
            trendEl.innerText = (diff > 0 ? '↑' : '↓') + ' $' + formattedCurrency(Math.abs(diff));
            trendEl.className = `trend-indicator ${diff > 0 ? 'trend-up' : 'trend-down'}`;
        }
        renderUtmChart(allUtmData.slice(0, 8).reverse());
    };

    // --- GENERACIÓN DE GRÁFICOS (Chart.js) ---

    /**
     * Dibuja la línea de tiempo de la UTM en el Dashboard
     */
    const renderUtmChart = (data) => {
        const canvas = document.getElementById('utmChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (utmChart) utmChart.destroy();

        // Colores dinámicos según el tema
        const isMatrix = document.body.getAttribute('data-theme') === 'matrix';
        const colorLine = isMatrix ? '#00ff41' : '#00d2ff';
        const colorBg = isMatrix ? 'rgba(0, 255, 65, 0.1)' : 'rgba(0,210,255,0.05)';

        utmChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.fecha).toLocaleDateString('es-CL', { month: 'short' })),
                datasets: [{
                    data: data.map(d => d.valor),
                    borderColor: colorLine,
                    backgroundColor: colorBg,
                    fill: true, tension: 0.4, pointRadius: 2
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
        });
    };

    /**
     * Dibuja el gráfico circular de gastos por categoría
     */
    const renderCategoryChart = (filteredExpenses) => {
        const canvas = document.getElementById('categoryChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        // Sumar montos por categoría
        const groups = {};
        filteredExpenses.forEach(e => {
            if (e.category) groups[e.category] = (groups[e.category] || 0) + Number(e.amount);
        });

        const labels = Object.keys(groups);
        const values = Object.values(groups);

        if (categoryChart) categoryChart.destroy();
        if (labels.length === 0) return;

        // Paleta de colores dinámica
        const isMatrix = document.body.getAttribute('data-theme') === 'matrix';
        const colors = isMatrix
            ? ['#00ff41', '#008f11', '#005c00', '#33ff66', '#00cc33', '#006600', '#ccffcc']
            : ['#00d2ff', '#e879f9', '#10b981', '#f59e0b', '#ef4444', '#3a7bd5', '#8b5cf6'];

        categoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let label = context.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed !== null) {
                                    label += hideAmounts ? '*****' : '$' + formattedCurrency(context.parsed);
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    };

    // --- RENDERIZADO GENERAL (Tablas y Resúmenes) ---

    /**
     * Dibuja toda la información visual de la app basándose en los filtros actuales
     */
    const renderAll = () => {
        console.log("Renderizando periodo:", currentPeriod);

        // Filtro defensivo: Aseguramos que currentPeriod sea string y usamos getPeriodFromDate
        const filterFn = (item) => {
            if (currentPeriod === 'all') return true;
            if (!item || !item.date) return false;
            return getPeriodFromDate(item.date) === currentPeriod;
        };

        const filteredIncomes = incomes.filter(filterFn);
        const filteredExpenses = expenses.filter(filterFn);

        // Seleccionar cuerpos de tablas
        const tbodyInc = document.querySelector('#table-incomes tbody');
        const tbodyExp = document.querySelector('#table-expenses tbody');
        const tbodyRec = document.querySelector('#table-recurrents tbody');

        // Renderizar Tabla de Ingresos
        tbodyInc.innerHTML = filteredIncomes.length ? '' : '<tr><td colspan="4" style="text-align:center">No hay registros</td></tr>';
        filteredIncomes.slice().reverse().forEach(inc => {
            try {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${inc.date}</td><td>${inc.desc}</td><td style="color:var(--success-color)">${renderAmount(inc.amount)}</td>
                    <td class="td-actions">
                        <div class="action-btn-group">
                            <button class="action-btn edit-trigger" data-id="${inc.id}" data-type="income" title="Editar">✎</button>
                            <button class="action-btn delete-trigger" data-id="${inc.id}" data-type="income" title="Eliminar">✕</button>
                        </div>
                    </td>`;
                tbodyInc.appendChild(tr);
            } catch (e) { console.error("Error al renderizar fila de ingreso", e); }
        });

        // Renderizar Tabla de Gastos
        tbodyExp.innerHTML = filteredExpenses.length ? '' : '<tr><td colspan="8" style="text-align:center">No hay registros</td></tr>';
        filteredExpenses.slice().reverse().forEach(exp => {
            try {
                const tr = document.createElement('tr');
                const statusClass = exp.paid ? 'badge-paid' : 'badge-pending';
                // Botón de calendario solo para gastos pendientes
                const calBtn = !exp.paid
                    ? `<button class="action-btn calendar-trigger" data-id="${exp.id}" title="Agregar recordatorio a Google Calendar">📅</button>`
                    : '';
                tr.innerHTML = `
                    <td><label class="status-toggle"><input type="checkbox" ${exp.paid ? 'checked' : ''} data-id="${exp.id}"><div class="checkmark"></div><span class="status-badge ${statusClass}">${exp.paid ? 'Pagado' : 'Pendiente'}</span></label></td>
                    <td>${exp.date}</td><td>${exp.category}</td><td>${exp.desc}</td><td style="font-weight:700">${renderAmount(exp.amount)}</td><td style="color:var(--text-muted)">${exp.notes || '-'}</td>
                    <td class="td-actions">
                        <div class="action-btn-group">
                            ${calBtn}
                            <button class="action-btn edit-trigger" data-id="${exp.id}" data-type="expense" title="Editar">✎</button>
                            <button class="action-btn delete-trigger" data-id="${exp.id}" data-type="expense" title="Eliminar">✕</button>
                        </div>
                    </td>`;
                tbodyExp.appendChild(tr);
            } catch (e) { console.error("Error al renderizar fila de gasto", e); }
        });

        // Renderizar Tabla de Recurrentes
        tbodyRec.innerHTML = recurrents.length ? '' : '<tr><td colspan="5" style="text-align:center">Sin gastos recurrentes programados</td></tr>';
        recurrents.forEach(rec => {
            try {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>Día ${rec.day}</td><td>${rec.category}</td><td>${rec.desc}</td><td>${renderAmount(rec.amount)}</td><td><button class="action-btn delete-trigger" data-id="${rec.id}" data-type="recurrent">✕</button></td>`;
                tbodyRec.appendChild(tr);
            } catch (e) { }
        });

        // Calcular Resumen de Totales
        const tInc = filteredIncomes.reduce((a, b) => a + Number(b.amount), 0);
        const tExp = filteredExpenses.reduce((a, b) => a + Number(b.amount), 0);
        const tPend = filteredExpenses.filter(e => !e.paid).reduce((a, b) => a + Number(b.amount), 0);

        totalIncomeEl.innerText = renderAmount(tInc);
        totalExpenseEl.innerText = renderAmount(tExp);
        totalPendingEl.innerText = renderAmount(tPend);
        netBalanceEl.innerText = '$' + formattedCurrency(tInc - tExp);

        // Estilo visual del balance neto (Rojo si es negativo)
        netContainer.style.background = (tInc - tExp) < 0 ? 'rgba(239, 68, 68, 0.05)' : 'rgba(16, 185, 129, 0.05)';

        renderCategoryChart(filteredExpenses);
    };

    // --- LÓGICA DE TAREAS (Agenda) ---

    /**
     * Dibuja la lista de tareas en la pestaña Agenda
     */
    const renderTasks = () => {
        if (!taskListEl) return;
        taskListEl.innerHTML = '';

        const sortedTasks = tasks.slice().sort((a, b) => {
            if (a.completed === b.completed) return new Date(b.createdAt) - new Date(a.createdAt);
            return a.completed ? 1 : -1;
        });

        const pendingCount = tasks.filter(t => !t.completed).length;
        taskCountEl.textContent = `${pendingCount} tarea${pendingCount !== 1 ? 's' : ''} pendiente${pendingCount !== 1 ? 's' : ''}`;

        sortedTasks.forEach(task => {
            const div = document.createElement('div');
            div.className = `task-item ${task.completed ? 'completed' : ''}`;

            const dateDisplay = task.date ? `<span class="task-meta">\uD83D\uDCC5 ${formatToCLDateTime(task.date)}</span>` : '';

            div.innerHTML = `
                <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} data-id="${task.id}">
                <div class="task-info">
                    <span class="task-text">${task.desc}</span>
                    ${dateDisplay}
                </div>
                <div class="task-actions">
                    <button class="action-btn calendar-trigger" data-id="${task.id}" data-type="task" title="Recordatorio en Google Calendar">\uD83D\uDCC5</button>
                    <button class="action-btn delete-trigger" data-id="${task.id}" data-type="task" title="Eliminar">✕</button>
                </div>
            `;
            taskListEl.appendChild(div);
        });
    };

    // --- LÓGICA DE EDICIÓN DE REGISTROS ---

    /**
     * Abre el modal de edición cargando los datos del registro seleccionado
     */
    const openEditModal = (id, type) => {
        let item;
        if (type === 'income') item = incomes.find(i => i.id === id);
        else item = expenses.find(e => e.id === id);

        if (!item) return;

        // Cargar datos en el formulario del modal
        document.getElementById('edit-id').value = id;
        document.getElementById('edit-type').value = type;
        document.getElementById('edit-date').value = parseToISODate(item.date);
        document.getElementById('edit-desc').value = item.desc;
        document.getElementById('edit-amount').value = item.amount;

        const catGroup = document.getElementById('edit-category-group');
        const notesGroup = document.getElementById('edit-notes-group');

        // Ajustar el modal según sea ingreso o gasto
        if (type === 'income') {
            catGroup.style.display = 'none';
            notesGroup.style.display = 'none';
            document.getElementById('edit-modal-title').textContent = "Editar Ingreso";
        } else {
            catGroup.style.display = 'block';
            notesGroup.style.display = 'block';
            document.getElementById('edit-category').value = item.category;
            document.getElementById('edit-notes').value = item.notes || '';
            document.getElementById('edit-modal-title').textContent = "Editar Gasto";
        }

        editModal.classList.add('active');
    };

    /**
     * Procesa el guardado de los cambios realizados en el modal
     */
    formEdit.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-id').value;
        const type = document.getElementById('edit-type').value;

        const updatedData = {
            date: formatToCLDate(document.getElementById('edit-date').value),
            desc: document.getElementById('edit-desc').value,
            amount: Number(document.getElementById('edit-amount').value)
        };

        if (type === 'income') {
            const idx = incomes.findIndex(i => i.id === id);
            incomes[idx] = { ...incomes[idx], ...updatedData };
            localStorage.setItem('myIncomes', JSON.stringify(incomes));
        } else {
            const idx = expenses.findIndex(e => e.id === id);
            expenses[idx] = {
                ...expenses[idx],
                ...updatedData,
                category: document.getElementById('edit-category').value,
                notes: document.getElementById('edit-notes').value
            };
            localStorage.setItem('myExpenses', JSON.stringify(expenses));
        }

        editModal.classList.remove('active');
        setupPeriodSelector();
        renderAll();
    });

    // --- GESTIÓN DE EVENTOS (Interacciones del Usuario) ---

    // Añadir nuevo Ingreso
    document.getElementById('form-income').addEventListener('submit', (e) => {
        e.preventDefault();
        const date = document.getElementById('inc-date').value || getTodayString();
        incomes.push({
            id: Date.now().toString(),
            date: formatToCLDate(date),
            desc: document.getElementById('inc-desc').value,
            amount: Number(document.getElementById('inc-amount').value)
        });
        localStorage.setItem('myIncomes', JSON.stringify(incomes));
        e.target.reset(); document.getElementById('inc-date').value = getTodayString();
        setupPeriodSelector(); renderAll();
    });

    // Añadir nuevo Gasto
    document.getElementById('form-expense').addEventListener('submit', (e) => {
        e.preventDefault();
        const date = document.getElementById('exp-date').value || getTodayString();
        expenses.push({
            id: Date.now().toString(),
            date: formatToCLDate(date),
            category: document.getElementById('exp-category').value,
            desc: document.getElementById('exp-desc').value,
            amount: Number(document.getElementById('exp-amount').value),
            notes: document.getElementById('exp-notes').value,
            paid: false
        });
        localStorage.setItem('myExpenses', JSON.stringify(expenses));
        e.target.reset(); document.getElementById('exp-date').value = getTodayString();
        setupPeriodSelector(); renderAll();
    });

    // Añadir Programación de Gasto Recurrente
    document.getElementById('form-recurrent').addEventListener('submit', (e) => {
        e.preventDefault();
        recurrents.push({
            id: Date.now().toString(),
            day: document.getElementById('rec-day').value,
            category: document.getElementById('rec-category').value,
            desc: document.getElementById('rec-desc').value,
            amount: Number(document.getElementById('rec-amount').value)
        });
        localStorage.setItem('myRecurrents', JSON.stringify(recurrents));
        e.target.reset(); renderAll();
    });

    // Manejo del formulario de Tareas
    if (formTask) {
        formTask.addEventListener('submit', (e) => {
            e.preventDefault();
            const newTask = {
                id: Date.now().toString(),
                desc: taskDescInput.value,
                date: taskDateInput.value,
                completed: false,
                createdAt: new Date().toISOString()
            };
            tasks.push(newTask);
            localStorage.setItem('myTasks', JSON.stringify(tasks));
            e.target.reset();
            renderTasks();
        });
    }

    // Manejo de clicks dinámicos (Borrar, Editar y Calendario)
    document.addEventListener('click', (e) => {
        // Al presionar botón de eliminar
        if (e.target.classList.contains('delete-trigger')) {
            const { id, type } = e.target.dataset;
            if (confirm("¿Seguro que deseas eliminar este registro?")) {
                if (type === 'income') incomes = incomes.filter(i => i.id !== id);
                else if (type === 'expense') expenses = expenses.filter(ex => ex.id !== id);
                else if (type === 'recurrent') recurrents = recurrents.filter(r => r.id !== id);
                else if (type === 'task') tasks = tasks.filter(t => t.id !== id);

                localStorage.setItem('myIncomes', JSON.stringify(incomes));
                localStorage.setItem('myExpenses', JSON.stringify(expenses));
                localStorage.setItem('myRecurrents', JSON.stringify(recurrents));
                localStorage.setItem('myTasks', JSON.stringify(tasks));

                if (type === 'task') renderTasks();
                else renderAll();
            }
        }

        // Al presionar botón de editar
        if (e.target.classList.contains('edit-trigger')) {
            openEditModal(e.target.dataset.id, e.target.dataset.type);
        }

        // Al presionar botón de calendario (📅)
        if (e.target.classList.contains('calendar-trigger')) {
            const { id, type } = e.target.dataset;
            let item;
            const isTask = type === 'task';

            if (isTask) item = tasks.find(t => t.id === id);
            else item = expenses.find(x => x.id === id);

            if (item) {
                const url = createGoogleCalendarUrl(item, isTask);
                window.open(url, '_blank');
            }
        }

        // Botón "Exportar todos a Calendario" en modal de pendientes
        if (e.target.classList.contains('export-all-calendar')) {
            const filterFn = (item) => {
                if (currentPeriod === 'all') return true;
                return getPeriodFromDate(item.date) === currentPeriod;
            };
            const pendientes = expenses.filter(filterFn).filter(ex => !ex.paid);
            if (pendientes.length === 0) {
                alert('No hay gastos pendientes para exportar.');
                return;
            }
            pendientes.forEach((exp, i) => {
                // Abrir con pequeño delay para no saturar el navegador
                setTimeout(() => {
                    window.open(createGoogleCalendarUrl(exp), '_blank');
                }, i * 600);
            });
        }
    });

    // Cambio de estado de Pago o Tarea (Checkboxes)
    document.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox' && e.target.dataset.id) {
            const id = e.target.dataset.id;
            // Si es un checkbox de la lista de tareas
            if (e.target.classList.contains('task-checkbox')) {
                const task = tasks.find(t => t.id === id);
                if (task) {
                    task.completed = e.target.checked;
                    localStorage.setItem('myTasks', JSON.stringify(tasks));
                    renderTasks();
                }
                return;
            }

            // Si es un checkbox de la tabla de gastos
            const exp = expenses.find(ex => ex.id === id);
            if (exp) {
                exp.paid = e.target.checked;
                localStorage.setItem('myExpenses', JSON.stringify(expenses));
                renderAll();
            }
        }
    });

    // Registro rápido (Relámpago ⚡)
    btnQuickAdd.addEventListener('click', () => quickModal.classList.add('active'));

    document.getElementById('form-quick').addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = Number(document.getElementById('quick-amount').value);
        const category = document.getElementById('quick-category').value;
        const desc = document.getElementById('quick-desc').value || 'Gasto Rápido';

        expenses.push({
            id: Date.now().toString(),
            date: formatToCLDate(getTodayString()),
            category,
            desc,
            amount,
            notes: 'Ingreso rápido desde móvil',
            paid: false
        });
        localStorage.setItem('myExpenses', JSON.stringify(expenses));

        quickModal.classList.remove('active');
        e.target.reset();
        setupPeriodSelector();
        renderAll();
    });

    // --- NAVEGACIÓN POR PESTAÑAS (TABS) ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            if (btn.dataset.tab === 'tab-dashboard') {
                renderAll();
                // Forzar scroll al inicio del dashboard
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            if (btn.dataset.tab === 'tab-tasks') {
                renderTasks();
            }
        });
    });

    // --- LÓGICA DE VENTANAS DE DETALLE (MODALES DE RESUMEN) ---
    const detailsModal = document.getElementById('details-modal');
    const detailsTitle = document.getElementById('details-title');
    const detailsTableHead = document.getElementById('details-table-head');
    const detailsTableBody = document.querySelector('#table-details tbody');
    const detailsPeriodInfo = document.getElementById('details-period-info');

    /**
     * Abre un modal con el listado detallado de una categoría del resumen
     */
    const openDetailsModal = (type) => {
        if (!detailsModal) return;

        // Filtrar según el periodo actual
        const filterFn = (item) => {
            if (currentPeriod === 'all') return true;
            return getPeriodFromDate(item.date) === currentPeriod;
        };

        let itemsToShow = [];
        let title = "";
        let headHTML = "";

        if (type === 'income') {
            title = "Detalle de Ingresos";
            itemsToShow = incomes.filter(filterFn);
            headHTML = '<th>Fecha</th><th>Descripción</th><th style="text-align:right">Monto</th>';
        } else if (type === 'expense') {
            title = "Detalle de Gastos (Pagados)";
            itemsToShow = expenses.filter(filterFn).filter(e => e.paid);
            headHTML = '<th>Fecha</th><th>Categoría</th><th>Descripción</th><th style="text-align:right">Monto</th>';
        } else if (type === 'pending') {
            title = "Gastos por Pagar (Pendientes)";
            itemsToShow = expenses.filter(filterFn).filter(e => !e.paid);
            headHTML = '<th>Fecha</th><th>Categoría</th><th>Descripción</th><th style="text-align:right">Monto</th>';
        }

        detailsTitle.textContent = title;
        detailsPeriodInfo.textContent = `Periodo: ${currentPeriod === 'all' ? 'Historial Completo' : currentPeriod}`;
        detailsTableHead.innerHTML = headHTML;
        detailsTableBody.innerHTML = itemsToShow.length ? '' : '<tr><td colspan="4" style="text-align:center; padding: 2rem; color: var(--text-muted);">No hay registros en este periodo</td></tr>';

        itemsToShow.slice().reverse().forEach(item => {
            const tr = document.createElement('tr');
            if (type === 'income') {
                tr.innerHTML = `<td>${item.date}</td><td>${item.desc}</td><td style="text-align:right; font-weight:700; color:var(--success-color)">${renderAmount(item.amount)}</td>`;
            } else {
                // En pendientes, agregar botón de calendario por fila
                const calCell = (type === 'pending')
                    ? `<td><button class="action-btn calendar-trigger" data-id="${item.id}" title="Agregar a Google Calendar">📅</button></td>`
                    : '';
                tr.innerHTML = `<td>${item.date}</td><td>${item.category}</td><td>${item.desc}</td><td style="text-align:right; font-weight:700; color:var(--danger-color)">${renderAmount(item.amount)}</td>${calCell}`;
            }
            detailsTableBody.appendChild(tr);
        });

        // Si es modal de pendientes, agregar botón de exportar todos
        if (type === 'pending' && itemsToShow.length > 0) {
            const exportRow = document.createElement('tr');
            exportRow.innerHTML = `<td colspan="5" style="text-align:center; padding: 1rem;"><button class="btn btn-primary export-all-calendar" style="font-size:0.85rem; padding: 0.5rem 1.2rem;">📅 Exportar todos a Google Calendar</button></td>`;
            detailsTableBody.appendChild(exportRow);
        }

        detailsModal.classList.add('active');
    };

    // Usar delegación de eventos para las tarjetas interactivas (más robusto)
    document.addEventListener('click', (e) => {
        const interactiveCard = e.target.closest('.b-card.interactive');
        if (interactiveCard) {
            const type = interactiveCard.dataset.detail;
            openDetailsModal(type);
        }
    });

    // --- SISTEMA DE RESPALDO (EXPORTAR / IMPORTAR) ---

    // Exportar Datos a JSON (Descarga o Sobrescritura)
    document.getElementById('btn-export').addEventListener('click', async () => {
        const data = { incomes, expenses, recurrents, version: '5.0' };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

        // Intento de guardado directo si el navegador lo permite
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({ suggestedName: 'Respaldo_Control.json', types: [{ accept: { 'application/json': ['.json'] } }] });
                const writable = await handle.createWritable();
                await writable.write(blob); await writable.close(); return;
            } catch (e) { }
        }

        // Fallback: Descarga tradicional
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Respaldo_Control.json'; a.click();
    });

    // Importar Datos desde JSON
    document.getElementById('btn-import-trigger').addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', (e) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const d = JSON.parse(ev.target.result);
                if (d.incomes || d.expenses) {
                    incomes = d.incomes || [];
                    expenses = d.expenses || [];
                    recurrents = d.recurrents || [];
                    localStorage.setItem('myIncomes', JSON.stringify(incomes));
                    localStorage.setItem('myExpenses', JSON.stringify(expenses));
                    localStorage.setItem('myRecurrents', JSON.stringify(recurrents));
                    currentPeriod = 'all'; // Asegurar que los datos importados sean visibles
                    setupPeriodSelector(); renderAll(); alert("¡Datos importados con éxito!");
                }
            } catch (err) { alert("El archivo seleccionado no es un respaldo válido."); }
        };
        reader.readAsText(e.target.files[0]);
    });

    // --- INICIALIZACIÓN (Arranque de la App) ---
    try {
        // Detectar si se abrió desde un acceso directo del móvil (Shortcut)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('action') === 'quick-add') {
            setTimeout(() => {
                const qm = document.getElementById('quick-add-modal');
                if (qm) qm.classList.add('active');
            }, 300);
        }

        // Poner la fecha de hoy por defecto en los formularios
        if (document.getElementById('inc-date')) document.getElementById('inc-date').value = getTodayString();
        if (document.getElementById('exp-date')) document.getElementById('exp-date').value = getTodayString();

        // Configurar listener para el selector global de periodos
        if (periodSelector) {
            periodSelector.addEventListener('change', (e) => {
                console.log("Cambio de periodo detectado:", e.target.value);
                currentPeriod = e.target.value;
                localStorage.setItem('myAppCurrentPeriod', currentPeriod); // Guardar preferencia

                // Actualizar todo inmediatamente
                updatePeriodDisplayText();
                renderAll();

                // Pequeña vibración visual para confirmar el cambio
                periodSelector.style.transform = "scale(1.05)";
                setTimeout(() => periodSelector.style.transform = "scale(1)", 150);
            });
        }

        // Ejecutar procesos iniciales
        processRecurrents(); // Revisar si hay gastos automáticos que crear
        setupPeriodSelector(); // Crear lista de meses según los datos
        initTheme(); // Inicializar tema visual
        fetchIndicators(); // Pedir UF/Dólar/UTM a la API

        // Inicializar toggle de ocultar montos
        if (toggleHideAmounts) {
            toggleHideAmounts.checked = hideAmounts;
            toggleHideAmounts.addEventListener('change', () => {
                hideAmounts = toggleHideAmounts.checked;
                localStorage.setItem('hideAmounts', hideAmounts);
                renderAll();
            });
        }

        renderAll(); // Dibujar tablas y gráficos

    } catch (err) {
        console.error("Error crítico durante el arranque:", err);
    }
});
