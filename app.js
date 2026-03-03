document.addEventListener('DOMContentLoaded', () => {
    // --- PWA REGISTRY ---
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => { });
    }

    // --- VARIABLES Y STORAGE ---
    const API_URL_BASE = 'https://mindicador.cl/api';
    let allUtmData = [];
    let utmChart = null;
    let categoryChart = null;

    let incomes = JSON.parse(localStorage.getItem('myIncomes')) || [];
    let expenses = JSON.parse(localStorage.getItem('myExpenses')) || [];
    let recurrents = JSON.parse(localStorage.getItem('myRecurrents')) || [];

    // Periodo Inicial (Mes Actual)
    let currentPeriod = 'all'; // Default a 'all' para asegurar visibilidad inicial

    // --- ELEMENTOS DOM ---
    const utmValueEl = document.getElementById('utm-value');
    const ufValueEl = document.getElementById('uf-value');
    const dolarValueEl = document.getElementById('dolar-value');
    const calc45El = document.getElementById('calc-45');
    const trendEl = document.getElementById('trend-indicator');
    const monthSelector = document.getElementById('month-selector');
    const periodSelector = document.getElementById('global-period-selector');
    const periodDisplay = document.getElementById('current-period-display');

    const totalIncomeEl = document.getElementById('total-income');
    const totalExpenseEl = document.getElementById('total-expense');
    const totalPendingEl = document.getElementById('total-pending');
    const netBalanceEl = document.getElementById('net-balance');
    const netContainer = document.querySelector('.net-balance-dashboard');

    const btnQuickAdd = document.getElementById('btn-quick-add');
    const quickModal = document.getElementById('quick-add-modal');
    const importFileInput = document.getElementById('import-file');

    const editModal = document.getElementById('edit-modal');
    const formEdit = document.getElementById('form-edit');

    // --- UTILIDADES ---
    const formattedCurrency = (val) => new Intl.NumberFormat('es-CL').format(Math.round(val));

    const getTodayString = () => new Date().toISOString().split('T')[0];

    const formatToCLDate = (dateISO) => {
        if (!dateISO) return '-';
        if (dateISO.includes('/')) return dateISO; // Ya está formateada
        const [y, m, d] = dateISO.split('-');
        return `${d}/${m}/${y}`;
    };

    const parseToISODate = (dateCL) => {
        if (!dateCL || !dateCL.includes('/')) return getTodayString();
        const [d, m, y] = dateCL.split('/');
        return `${y}-${m}-${d}`;
    };

    const getPeriodFromDate = (dateCL) => {
        try {
            if (!dateCL || typeof dateCL !== 'string' || !dateCL.includes('/')) return 'unknown';
            const parts = dateCL.split('/');
            if (parts.length < 3) return 'unknown';
            return `${parts[2]}-${parts[1]}`;
        } catch (e) { return 'unknown'; }
    };

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
    const setupPeriodSelector = () => {
        try {
            const periods = new Set();
            periods.add(new Date().toISOString().slice(0, 7)); // Mes actual

            [...incomes, ...expenses].forEach(item => {
                if (item && item.date) {
                    const p = getPeriodFromDate(item.date);
                    if (p && p.length === 7) periods.add(p);
                }
            });

            const sortedPeriods = Array.from(periods).sort().reverse();
            periodSelector.innerHTML = '<option value="all">Ver Todos</option>';

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
            console.error("Error in setupPeriodSelector:", err);
        }
    };

    const updatePeriodDisplayText = () => {
        if (currentPeriod === 'all') {
            periodDisplay.textContent = "Todos los datos";
        } else {
            const [y, m] = currentPeriod.split('-');
            const displayDate = new Date(parseInt(y), parseInt(m) - 1, 2);
            periodDisplay.textContent = displayDate.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
        }
    };

    // --- GASTOS RECURRENTES ---
    const processRecurrents = () => {
        const now = new Date();
        const thisMonthKey = now.toISOString().slice(0, 7);
        const lastProcessed = localStorage.getItem('lastRecurrentProcessed');

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
                    notes: 'Generado automáticamente',
                    paid: false
                };
                expenses.push(newExpense);
            });
            localStorage.setItem('myExpenses', JSON.stringify(expenses));
            localStorage.setItem('lastRecurrentProcessed', thisMonthKey);
        }
    };

    // --- INDICADORES ---
    const fetchIndicators = async () => {
        try {
            // Intentamos el endpoint principal primero
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

            // UTM siempre desde su propio endpoint para asegurar la serie histórica
            const utmRes = await fetch(`${API_URL_BASE}/utm`);
            const utmData = await utmRes.json();
            if (utmData.serie) {
                allUtmData = utmData.serie;
                populateUtmSelector(allUtmData);
                updateUtmDisplay(0);
            }
        } catch (e) {
            console.error("API Error - Fallback individual...", e);
            // Plan B: Fetch individual sin paraámetros extra
            try {
                const rUf = await fetch(`${API_URL_BASE}/uf`);
                const dUf = await rUf.json();
                ufValueEl.innerText = formattedCurrency(dUf.serie[0].valor);
            } catch (err) { }

            try {
                const rDol = await fetch(`${API_URL_BASE}/dolar`);
                const dDol = await rDol.json();
                dolarValueEl.innerText = formattedCurrency(dDol.serie[0].valor);
            } catch (err) { }
        }
    };

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

    const updateUtmDisplay = (index) => {
        const curr = allUtmData[index];
        if (!curr) return;
        const val = curr.valor;
        utmValueEl.classList.remove('skeleton-text');
        calc45El.classList.remove('skeleton-text');
        animateValue(utmValueEl, 0, val, 600);
        animateValue(calc45El, 0, val * 4.5, 700);

        if (allUtmData[index + 1]) {
            const diff = val - allUtmData[index + 1].valor;
            trendEl.innerText = (diff > 0 ? '↑' : '↓') + ' $' + formattedCurrency(Math.abs(diff));
            trendEl.className = `trend-indicator ${diff > 0 ? 'trend-up' : 'trend-down'}`;
        }
        renderUtmChart(allUtmData.slice(0, 8).reverse());
    };

    // --- GRÁFICOS ---
    const renderUtmChart = (data) => {
        const canvas = document.getElementById('utmChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (utmChart) utmChart.destroy();
        utmChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.fecha).toLocaleDateString('es-CL', { month: 'short' })),
                datasets: [{ data: data.map(d => d.valor), borderColor: '#00d2ff', backgroundColor: 'rgba(0,210,255,0.05)', fill: true, tension: 0.4, pointRadius: 2 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
        });
    };

    const renderCategoryChart = (filteredExpenses) => {
        const canvas = document.getElementById('categoryChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const groups = {};
        filteredExpenses.forEach(e => {
            if (e.category) groups[e.category] = (groups[e.category] || 0) + Number(e.amount);
        });

        const labels = Object.keys(groups);
        const values = Object.values(groups);

        if (categoryChart) categoryChart.destroy();
        if (labels.length === 0) return;

        categoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{ data: values, backgroundColor: ['#00d2ff', '#e879f9', '#10b981', '#f59e0b', '#ef4444', '#3a7bd5'], borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false } } }
        });
    };

    // --- RENDERING ---
    const renderAll = () => {
        // Filtrado por periodo
        const filterFn = (item) => currentPeriod === 'all' || getPeriodFromDate(item.date) === currentPeriod;
        const filteredIncomes = incomes.filter(filterFn);
        const filteredExpenses = expenses.filter(filterFn);

        // Tablas
        const tbodyInc = document.querySelector('#table-incomes tbody');
        const tbodyExp = document.querySelector('#table-expenses tbody');
        const tbodyRec = document.querySelector('#table-recurrents tbody');

        tbodyInc.innerHTML = filteredIncomes.length ? '' : '<tr><td colspan="4" style="text-align:center">No hay registros</td></tr>';
        filteredIncomes.slice().reverse().forEach(inc => {
            try {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${inc.date}</td><td>${inc.desc}</td><td style="color:var(--success-color)">$${formattedCurrency(inc.amount)}</td>
                    <td class="td-actions">
                        <div class="action-btn-group">
                            <button class="action-btn edit-trigger" data-id="${inc.id}" data-type="income" title="Editar">✎</button>
                            <button class="action-btn delete-trigger" data-id="${inc.id}" data-type="income" title="Eliminar">✕</button>
                        </div>
                    </td>`;
                tbodyInc.appendChild(tr);
            } catch (e) { console.error("Err rendering row", e); }
        });

        tbodyExp.innerHTML = filteredExpenses.length ? '' : '<tr><td colspan="7" style="text-align:center">No hay registros</td></tr>';
        filteredExpenses.slice().reverse().forEach(exp => {
            try {
                const tr = document.createElement('tr');
                const statusClass = exp.paid ? 'badge-paid' : 'badge-pending';
                tr.innerHTML = `
                    <td><label class="status-toggle"><input type="checkbox" ${exp.paid ? 'checked' : ''} data-id="${exp.id}"><div class="checkmark"></div><span class="status-badge ${statusClass}">${exp.paid ? 'Pagado' : 'Pendiente'}</span></label></td>
                    <td>${exp.date}</td><td>${exp.category}</td><td>${exp.desc}</td><td style="font-weight:700">$${formattedCurrency(exp.amount)}</td><td style="color:var(--text-muted)">${exp.notes || '-'}</td>
                    <td class="td-actions">
                        <div class="action-btn-group">
                            <button class="action-btn edit-trigger" data-id="${exp.id}" data-type="expense" title="Editar">✎</button>
                            <button class="action-btn delete-trigger" data-id="${exp.id}" data-type="expense" title="Eliminar">✕</button>
                        </div>
                    </td>
                `;
                tbodyExp.appendChild(tr);
            } catch (e) { console.error("Err rendering row", e); }
        });

        tbodyRec.innerHTML = recurrents.length ? '' : '<tr><td colspan="5" style="text-align:center">Sin gastos recurrentes</td></tr>';
        recurrents.forEach(rec => {
            try {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>Día ${rec.day}</td><td>${rec.category}</td><td>${rec.desc}</td><td>$${formattedCurrency(rec.amount)}</td><td><button class="action-btn delete-trigger" data-id="${rec.id}" data-type="recurrent">✕</button></td>`;
                tbodyRec.appendChild(tr);
            } catch (e) { }
        });

        // Dashboard Summary
        const tInc = filteredIncomes.reduce((a, b) => a + Number(b.amount), 0);
        const tExp = filteredExpenses.reduce((a, b) => a + Number(b.amount), 0);
        const tPend = filteredExpenses.filter(e => !e.paid).reduce((a, b) => a + Number(b.amount), 0);

        totalIncomeEl.innerText = '$' + formattedCurrency(tInc);
        totalExpenseEl.innerText = '$' + formattedCurrency(tExp);
        totalPendingEl.innerText = '$' + formattedCurrency(tPend);
        netBalanceEl.innerText = '$' + formattedCurrency(tInc - tExp);

        netContainer.style.background = (tInc - tExp) < 0 ? 'rgba(239, 68, 68, 0.05)' : 'rgba(16, 185, 129, 0.05)';

        renderCategoryChart(filteredExpenses);
    };

    // --- LÓGICA DE EDICIÓN ---
    const openEditModal = (id, type) => {
        let item;
        if (type === 'income') item = incomes.find(i => i.id === id);
        else item = expenses.find(e => e.id === id);

        if (!item) return;

        document.getElementById('edit-id').value = id;
        document.getElementById('edit-type').value = type;
        document.getElementById('edit-date').value = parseToISODate(item.date);
        document.getElementById('edit-desc').value = item.desc;
        document.getElementById('edit-amount').value = item.amount;

        const catGroup = document.getElementById('edit-category-group');
        const notesGroup = document.getElementById('edit-notes-group');

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

    // --- EVENTOS ---
    document.getElementById('form-income').addEventListener('submit', (e) => {
        e.preventDefault();
        const date = document.getElementById('inc-date').value || getTodayString();
        incomes.push({ id: Date.now().toString(), date: formatToCLDate(date), desc: document.getElementById('inc-desc').value, amount: Number(document.getElementById('inc-amount').value) });
        localStorage.setItem('myIncomes', JSON.stringify(incomes));
        e.target.reset(); document.getElementById('inc-date').value = getTodayString();
        setupPeriodSelector(); renderAll();
    });

    document.getElementById('form-expense').addEventListener('submit', (e) => {
        e.preventDefault();
        const date = document.getElementById('exp-date').value || getTodayString();
        expenses.push({ id: Date.now().toString(), date: formatToCLDate(date), category: document.getElementById('exp-category').value, desc: document.getElementById('exp-desc').value, amount: Number(document.getElementById('exp-amount').value), notes: document.getElementById('exp-notes').value, paid: false });
        localStorage.setItem('myExpenses', JSON.stringify(expenses));
        e.target.reset(); document.getElementById('exp-date').value = getTodayString();
        setupPeriodSelector(); renderAll();
    });

    document.getElementById('form-recurrent').addEventListener('submit', (e) => {
        e.preventDefault();
        recurrents.push({ id: Date.now().toString(), day: document.getElementById('rec-day').value, category: document.getElementById('rec-category').value, desc: document.getElementById('rec-desc').value, amount: Number(document.getElementById('rec-amount').value) });
        localStorage.setItem('myRecurrents', JSON.stringify(recurrents));
        e.target.reset(); renderAll();
    });

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-trigger')) {
            const { id, type } = e.target.dataset;
            if (type === 'income') incomes = incomes.filter(i => i.id !== id);
            else if (type === 'expense') expenses = expenses.filter(ex => ex.id !== id);
            else if (type === 'recurrent') recurrents = recurrents.filter(r => r.id !== id);
            localStorage.setItem('myIncomes', JSON.stringify(incomes));
            localStorage.setItem('myExpenses', JSON.stringify(expenses));
            localStorage.setItem('myRecurrents', JSON.stringify(recurrents));
            renderAll();
        }

        if (e.target.classList.contains('edit-trigger')) {
            openEditModal(e.target.dataset.id, e.target.dataset.type);
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox' && e.target.dataset.id) {
            const exp = expenses.find(x => x.id === e.target.dataset.id);
            if (exp) { exp.paid = e.target.checked; localStorage.setItem('myExpenses', JSON.stringify(expenses)); renderAll(); }
        }
    });

    btnQuickAdd.addEventListener('click', () => quickModal.classList.add('active'));

    document.getElementById('form-quick').addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = Number(document.getElementById('quick-amount').value);
        const category = document.getElementById('quick-category').value;
        const desc = document.getElementById('quick-desc').value || 'Gasto Rápido';

        expenses.push({ id: Date.now().toString(), date: formatToCLDate(getTodayString()), category, desc, amount, notes: 'Ingreso rápido móvil', paid: false });
        localStorage.setItem('myExpenses', JSON.stringify(expenses));

        quickModal.classList.remove('active');
        e.target.reset();
        setupPeriodSelector();
        renderAll();
    });

    // --- TABS ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            if (btn.dataset.tab === 'tab-dashboard') renderAll();
        });
    });

    // --- EXPORT/IMPORT ---
    document.getElementById('btn-export').addEventListener('click', async () => {
        const data = { incomes, expenses, recurrents, version: '5.0' };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({ suggestedName: 'Respaldo_Control.json', types: [{ accept: { 'application/json': ['.json'] } }] });
                const writable = await handle.createWritable();
                await writable.write(blob); await writable.close(); return;
            } catch (e) { }
        }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Respaldo_Control.json'; a.click();
    });

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
                    currentPeriod = 'all'; // Asegura visibilidad tras importar
                    setupPeriodSelector(); renderAll(); alert("¡Datos importados con éxito!");
                }
            } catch (err) { alert("Archivo no válido"); }
        };
        reader.readAsText(e.target.files[0]);
    });

    // --- INIT ---
    try {
        document.getElementById('inc-date').value = getTodayString();
        document.getElementById('exp-date').value = getTodayString();

        if (periodSelector) {
            periodSelector.addEventListener('change', (e) => {
                currentPeriod = e.target.value;
                updatePeriodDisplayText();
                renderAll();
            });
        }

        processRecurrents();
        setupPeriodSelector();
        fetchIndicators();
        renderAll();
    } catch (err) {
        console.error("Critical error in INIT:", err);
    }
});
