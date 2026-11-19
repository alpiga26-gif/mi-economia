/* Dashboard mensual */
(function (App) {
  App.defaultMonth = () => {
    const counts = {}; App.state.movimientos.forEach(m => { const k = App.ym(m.fecha); counts[k] = (counts[k] || 0) + 1; });
    const ms = Object.keys(counts).sort(); if (!ms.length) return App.ym(App.today());
    const avg = ms.reduce((a, k) => a + counts[k], 0) / ms.length;
    for (let i = ms.length - 1; i >= 0; i--) if (counts[ms[i]] >= avg * 0.5) return ms[i];
    return ms[ms.length - 1];
  };

  const kpi = (label, value, sub, cls = '') => `<div class="card kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub || ''}</div></div>`;
  const delta = (cur, prev, invert) => {
    if (prev == null || !isFinite(prev) || Math.abs(prev) < 0.01) return '';
    const d = (cur - prev) / Math.abs(prev); const good = invert ? d < 0 : d > 0;
    return `<span class="${good ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${App.pct(Math.abs(d))}</span> vs mes anterior`;
  };

  App.views.dashboard = (el, params) => {
    if (!App.state.movimientos.length && !App.state.cuentas.length) {
      el.innerHTML = `<div class="page-head"><h1>Bienvenido a Mi Economía</h1></div>
        <div class="card stack"><p>Todavía no hay datos. Puedes:</p>
        <div class="row"><a class="btn btn-primary" href="#/ajustes">⬆️ Importar datos iniciales (datos_iniciales.json)</a>
        <a class="btn" href="#/ajustes">☁️ Conectar con Google Drive y descargar datos</a></div></div>`;
      return;
    }
    const ym = params.mes || App.defaultMonth();
    const area = params.area || '';
    // ámbito: tu economía (por defecto si hay cuentas compartidas), la actividad compartida o todo
    const ambito = params.ambito != null ? params.ambito : (App.hayCompartidas() ? 'propio' : '');
    const months = App.monthsWithData();
    const prevYm = App.addMonths(ym, -1);
    const movs = App.filterMovs({ ym, area, ambito });
    const s = App.summarize(movs), sp = App.summarize(App.filterMovs({ ym: prevYm, area, ambito }));
    const eom = App.endOfMonth(ym);
    const liq = App.liquidity(eom), liqPrev = App.liquidity(App.endOfMonth(prevYm));
    const deuda = App.debtAt(ym);
    const last12 = App.monthsBetween(App.addMonths(ym, -11), ym);
    const evo = last12.map(m => App.summarize(App.filterMovs({ ym: m, area, ambito })));

    const areaOpts = `<option value="">Todas las áreas</option>` + App.state.areas.map(a => `<option value="${a.id}" ${a.id === area ? 'selected' : ''}>${App.esc(a.nombre)}</option>`).join('');
    const monthOpts = months.slice().reverse().map(m => `<option value="${m}" ${m === ym ? 'selected' : ''}>${App.monthName(m)}</option>`).join('');

    // Gastos por categoría (top 10 + otros)
    const catRows = Object.entries(s.byCat).map(([k, v]) => ({ cat: k, ingresos: v.ingresos, gastos: v.gastos, neto: v.ingresos - v.gastos })).sort((a, b) => b.gastos - a.gastos);
    const gastoCats = catRows.filter(r => r.gastos > 0.005);
    const top = gastoCats.slice(0, 10); const otros = gastoCats.slice(10).reduce((a, r) => a + r.gastos, 0);
    if (otros > 0) top.push({ cat: 'Otras categorías', gastos: otros });
    const prevCat = App.summarize(App.filterMovs({ ym: prevYm, area, ambito })).byCat;

    const areaRows = Object.entries(s.byArea).map(([k, v]) => ({ area: App.areaName(k), ingresos: v.ingresos, gastos: v.gastos, neto: v.ingresos - v.gastos })).sort((a, b) => b.gastos - a.gastos);
    const ctaRows = liq.bs.map(b => ({ ...b, mov: (s.byCuenta[b.id]?.ingresos || 0) - (s.byCuenta[b.id]?.gastos || 0) })).sort((a, b) => a.grupo.localeCompare(b.grupo) || b.saldo - a.saldo);

    // Rentabilidad por activo en el año en curso hasta el mes
    const ytd = App.summarize(App.filterMovs({ desde: ym.slice(0, 4) + '-01-01', hasta: eom, area, ambito }));
    const actRows = Object.entries(ytd.byActivo).map(([k, v]) => ({ activo: k, nombre: App.bienName(k), ingresos: v.ingresos, gastos: v.gastos, neto: v.ingresos - v.gastos })).filter(r => App.idx.bien[r.activo]).sort((a, b) => b.neto - a.neto);
    const ptRows = App.state.prestamos.filter(p => p.capitalPendiente).map(p => { const sch = App.loanSchedule(p); const r = sch.find(x => x.ym === App.addMonths(ym, 1)) || sch[0]; return { id: p.id, entidad: p.entidad, pendiente: App.loanPending(p, ym), cuota: r ? r.cuota : p.cuota, fin: sch.length ? sch[sch.length - 1].ym : '' }; });

    el.innerHTML = `
      <div class="page-head">
        <h1>Dashboard · ${App.monthName(ym)}</h1>
        <div class="actions">
          <button class="btn" id="mPrev" aria-label="Mes anterior">◀</button>
          <select id="mSel" aria-label="Mes">${monthOpts}</select>
          <button class="btn" id="mNext" aria-label="Mes siguiente">▶</button>
          ${App.hayCompartidas() ? `<select id="ambSel" aria-label="Ámbito"><option value="propio" ${ambito === 'propio' ? 'selected' : ''}>Mi economía</option><option value="compartido" ${ambito === 'compartido' ? 'selected' : ''}>Actividad compartida</option><option value="" ${!ambito ? 'selected' : ''}>Todo</option></select>` : ''}
          <select id="aSel" aria-label="Área">${areaOpts}</select>
          <button class="btn" id="xls">⬇️ Excel</button>
          <button class="btn" id="pdf">⬇️ PDF</button>
        </div>
      </div>
      <div class="grid g-kpi">
        ${kpi('Ingresos del mes', App.eur(s.ingresos), delta(s.ingresos, sp.ingresos))}
        ${kpi('Gastos del mes', App.eur(s.gastos), delta(s.gastos, sp.gastos, true))}
        ${kpi('Ahorro neto', App.eur(s.ahorro), 'Tasa de ahorro: ' + App.pct(s.tasaAhorro), App.cls(s.ahorro))}
        ${ambito === 'compartido'
          ? kpi('Caja de la actividad', App.eur(liq.cajaActividad), 'Cuentas compartidas, sin tu dinero propio, a ' + App.fdate(eom) + '<br>' + delta(liq.cajaActividad, liqPrev.cajaActividad))
          : kpi('Saldo disponible', App.eur(liq.disponible), 'Cuentas + efectivo a ' + App.fdate(eom) + (liq.propiosEnCompartidas ? `<br>incluye ${App.eur(liq.propiosEnCompartidas)} tuyos en cuentas compartidas` : '') + '<br>' + delta(liq.disponible, liqPrev.disponible))}
        ${ambito !== 'compartido' && liq.pendienteConActividad ? kpi('Pendiente con la actividad compartida', App.eur(liq.pendienteConActividad), 'Dinero de la actividad usado en movimientos tuyos (ver Actividad compartida)', 'neg') : ''}
        ${kpi('Inversión', App.eur(liq.inversion), 'Trade Republic, eToro…')}
        ${kpi('Deuda tarjetas', App.eur(liq.tarjetas), 'Saldo acumulado de tarjetas', App.cls(liq.tarjetas))}
        ${kpi('Préstamos pendientes', App.eur(deuda), ptRows.length + ' préstamos activos')}
      </div>
      <div class="grid g-2 mt">
        <div class="card"><h2>Ingresos y gastos · últimos 12 meses</h2>
          <div class="legend"><span><i style="background:var(--s1)"></i>Ingresos</span><span><i style="background:var(--s2)"></i>Gastos</span></div>
          <div class="chart-box"><canvas id="cEvo"></canvas></div></div>
        <div class="card"><h2>Gastos por categoría</h2>
          <div class="chart-box"><canvas id="cCat"></canvas></div></div>
      </div>
      <div class="grid g-2 mt">
        <div class="card"><h2>Resumen por área de actividad</h2>
          ${App.table([{ label: 'Área', key: 'area' }, { label: 'Ingresos', key: 'ingresos', money: 1 }, { label: 'Gastos', key: 'gastos', money: 1 }, { label: 'Neto', key: 'neto', money: 1 }], areaRows.map(r => ({ ...r, gastos: -r.gastos })),
            { total: ['Total', s.ingresos, -s.gastos, s.ahorro] })}</div>
        <div class="card"><h2>Saldo por cuenta a ${App.fdate(eom)}</h2>
          ${App.table([{ label: 'Cuenta', key: 'id' }, { label: 'Entidad', key: 'banco' }, { label: 'Grupo', key: 'grupo' }, { label: 'Saldo', key: 'saldo', money: 1 },
              ...(App.hayCompartidas() ? [{ label: 'Tuyo', get: r => r.grupo === 'Compartida' ? r.propio : (r.grupo === 'Disponible' || r.grupo === 'Efectivo' ? r.saldo : null), money: 1 }] : []), { label: 'Último mov.', get: r => App.fdate(r.fechaRef) }],
            ctaRows, { total: App.hayCompartidas() ? ['Total disponible tuyo', '', '', '', liq.disponible, ''] : ['Total disponible', '', '', liq.disponible, ''] })}
          <p class="small muted">Saldo tomado del último saldo del extracto; en cuentas sin columna de saldo se acumulan los movimientos desde el saldo inicial del maestro.${App.hayCompartidas() ? ' En las cuentas de actividad compartida, "Tuyo" es tu dinero propio que pasó por ellas; el resto es caja de la actividad.' : ''}</p></div>
      </div>
      <div class="grid g-2 mt">
        <div class="card"><h2>Detalle de categorías del mes</h2>
          ${App.table([{ label: 'Categoría', key: 'cat' }, { label: 'Ingresos', key: 'ingresos', money: 1 }, { label: 'Gastos', key: 'gastos', money: 1 }, { label: 'Mes anterior (gasto)', get: r => -(prevCat[r.cat]?.gastos || 0), money: 1 }],
            catRows.map(r => ({ ...r, gastos: -r.gastos })), { maxH: '360px' })}</div>
        <div class="stack">
          <div class="card"><h2>Resultado por activo · ${ym.slice(0, 4)} (hasta ${App.monthShort(ym)})</h2>
            ${actRows.length ? App.table([{ label: 'Activo', key: 'nombre' }, { label: 'Ingresos', key: 'ingresos', money: 1 }, { label: 'Gastos', get: r => -r.gastos, money: 1 }, { label: 'Neto', key: 'neto', money: 1 }], actRows, { maxH: '260px' }) : '<p class="muted">Sin movimientos asociados a bienes.</p>'}</div>
          <div class="card"><h2>Préstamos</h2>
            ${App.table([{ label: 'Préstamo', key: 'id' }, { label: 'Entidad', key: 'entidad' }, { label: 'Pendiente', key: 'pendiente', money: 1 }, { label: 'Cuota', key: 'cuota', money: 1 }, { label: 'Fin', get: r => r.fin ? App.monthShort(r.fin) : '' }], ptRows, { color: false })}</div>
        </div>
      </div>`;

    const go = (m, a = area, am = ambito) => App.go(`dashboard?mes=${m}${a ? '&area=' + a : ''}&ambito=${am}`);
    const ambS = App.$('#ambSel'); if (ambS) ambS.onchange = (e) => go(ym, area, e.target.value);
    App.$('#mSel').onchange = (e) => go(e.target.value);
    App.$('#aSel').onchange = (e) => go(ym, e.target.value);
    App.$('#mPrev').onclick = () => go(App.addMonths(ym, -1));
    App.$('#mNext').onclick = () => go(App.addMonths(ym, 1));

    App.chartDefaults();
    const S = App.series();
    App.chart(App.$('#cEvo'), {
      type: 'bar',
      data: { labels: last12.map(App.monthShort), datasets: [
        { label: 'Ingresos', data: evo.map(x => App.round2(x.ingresos)), backgroundColor: S[0], borderColor: App.css('--surface'), borderWidth: { right: 1, left: 1 } },
        { label: 'Gastos', data: evo.map(x => App.round2(x.gastos)), backgroundColor: S[1], borderColor: App.css('--surface'), borderWidth: { right: 1, left: 1 } }] },
      options: { plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: c => ` ${c.dataset.label}: ${App.eur(c.raw)}`, footer: (items) => 'Ahorro: ' + App.eur(items[0].raw - (items[1]?.raw || 0)) } } },
        scales: { y: { ticks: { callback: App.moneyTick }, grid: { color: App.css('--grid') } }, x: { grid: { display: false } } },
        onClick: (e, els) => { if (els.length) go(last12[els[0].index]); } }
    });
    App.chart(App.$('#cCat'), {
      type: 'bar',
      data: { labels: top.map(r => r.cat), datasets: [{ label: 'Gasto', data: top.map(r => App.round2(r.gastos)), backgroundColor: S[1], barThickness: 14 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + App.eur(c.raw) + ' · ' + App.pct(c.raw / s.gastos) + ' del gasto' } } },
        scales: { x: { ticks: { callback: App.moneyTick }, grid: { color: App.css('--grid') } }, y: { grid: { display: false } } },
        onClick: (e, els) => { if (els.length && top[els[0].index].cat !== 'Otras categorías') App.go(`movimientos?mes=${ym}&categoria=${encodeURIComponent(top[els[0].index].cat)}`); } }
    });

    App.$('#xls').onclick = () => App.exportXLSX(`Dashboard_${ym}`, [
      { name: 'Resumen', rows: [['Mes', App.monthName(ym)], ['Área', area ? App.areaName(area) : 'Todas'], ['Ingresos', App.round2(s.ingresos)], ['Gastos', App.round2(s.gastos)], ['Ahorro neto', App.round2(s.ahorro)], ['Saldo disponible', liq.disponible], ['Inversión', liq.inversion], ['Deuda tarjetas', liq.tarjetas], ['Préstamos pendientes', App.round2(deuda)]], autofilter: false },
      { name: 'Por área', rows: areaRows.map(r => ({ Area: r.area, Ingresos: App.round2(r.ingresos), Gastos: App.round2(r.gastos), Neto: App.round2(r.neto) })) },
      { name: 'Por categoría', rows: catRows.map(r => ({ Categoria: r.cat, Ingresos: App.round2(r.ingresos), Gastos: App.round2(r.gastos), Neto: App.round2(r.neto) })) },
      { name: 'Saldos cuentas', rows: ctaRows.map(r => ({ Cuenta: r.id, Entidad: r.banco, Tipo: r.tipo, Grupo: r.grupo, Saldo: r.saldo, UltimoMovimiento: App.fdate(r.fechaRef) })) },
      { name: 'Evolución 12m', rows: last12.map((m, i) => ({ Mes: m, Ingresos: App.round2(evo[i].ingresos), Gastos: App.round2(evo[i].gastos), Ahorro: App.round2(evo[i].ahorro) })) },
      { name: 'Activos', rows: actRows.map(r => ({ Activo: r.activo, Nombre: r.nombre, Ingresos: App.round2(r.ingresos), Gastos: App.round2(r.gastos), Neto: App.round2(r.neto) })) },
      { name: 'Préstamos', rows: ptRows.map(r => ({ Prestamo: r.id, Entidad: r.entidad, Pendiente: App.round2(r.pendiente || 0), Cuota: r.cuota, Fin: r.fin })) },
      { name: 'Movimientos', rows: App.movsToRows(movs) }
    ]);
    App.$('#pdf').onclick = () => App.exportPDF(`Dashboard_${ym}`, 'Dashboard mensual · ' + App.monthName(ym), area ? 'Área: ' + App.areaName(area) : 'Todas las áreas', [
      { heading: 'Indicadores', head: ['Indicador', 'Importe'], body: [['Ingresos', App.eur(s.ingresos)], ['Gastos', App.eur(s.gastos)], ['Ahorro neto', App.eur(s.ahorro)], ['Tasa de ahorro', App.pct(s.tasaAhorro)], ['Saldo disponible', App.eur(liq.disponible)], ['Inversión', App.eur(liq.inversion)], ['Deuda tarjetas', App.eur(liq.tarjetas)], ['Préstamos pendientes', App.eur(deuda)]], numCols: [1] },
      { heading: 'Ingresos y gastos · últimos 12 meses', chart: App.$('#cEvo') },
      { heading: 'Gastos por categoría', chart: App.$('#cCat') },
      { heading: 'Resumen por área', head: ['Área', 'Ingresos', 'Gastos', 'Neto'], body: areaRows.map(r => [r.area, App.num(r.ingresos), App.num(r.gastos), App.num(r.neto)]), foot: ['Total', App.num(s.ingresos), App.num(s.gastos), App.num(s.ahorro)], numCols: [1, 2, 3] },
      { heading: 'Categorías', head: ['Categoría', 'Ingresos', 'Gastos', 'Neto'], body: catRows.map(r => [r.cat, App.num(r.ingresos), App.num(r.gastos), App.num(r.neto)]), numCols: [1, 2, 3] },
      { heading: 'Saldo por cuenta', head: ['Cuenta', 'Entidad', 'Grupo', 'Saldo'], body: ctaRows.map(r => [r.id, r.banco, r.grupo, App.num(r.saldo)]), numCols: [3] },
      { heading: 'Préstamos', head: ['Préstamo', 'Entidad', 'Pendiente', 'Cuota', 'Fin'], body: ptRows.map(r => [r.id, r.entidad, App.num(r.pendiente), App.num(r.cuota), r.fin]), numCols: [2, 3] }
    ]);
  };
})(window.App);
