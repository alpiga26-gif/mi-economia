/* Proyección a futuro de la situación financiera */
(function (App) {
  App.views.proyeccion = (el, p) => {
    const S = App.state, st = S.settings;
    const ref = p.ref || App.addMonths(App.defaultMonth(), -1);
    const n = +(p.n || st.mesesMedia || 6), H = +(p.h || st.horizonte || 60);
    const infl = p.inf != null ? +p.inf : st.inflacion, gI = p.gi != null ? +p.gi : st.crecimientoIngresos;
    const aI = +(p.ai || 0), aG = +(p.ag || 0);
    const incl = st.projIncl || {};
    const base = App.baseline(ref, n).map(b => ({ ...b, incluir: incl[b.agrup] != null ? incl[b.agrup] : b.incluir }));
    const liqNow = App.liquidity(App.endOfMonth(ref));
    const liqIni = p.liq != null ? +p.liq : App.round2(liqNow.disponible + liqNow.tarjetas);
    const valorBienes = S.bienes.reduce((a, b) => a + (+b.valor || 0), 0);
    const proj = App.project({ base, desde: App.addMonths(ref, 1), horizonte: H, inflacion: infl, crecimientoIngresos: gI, ajusteIngresos: aI, ajusteGastos: aG, liquidezInicial: liqIni, inversion: liqNow.inversion, valorBienes, eventos: S.eventos });
    const rows = proj.rows, last = rows[rows.length - 1];
    const neg = rows.find(r => r.liquidez < 0);
    const cuotasHoy = rows[0]?.cuotas || 0;

    el.innerHTML = `<div class="page-head"><h1>Proyección financiera</h1><div class="actions"><button class="btn" id="xls">⬇️ Excel</button><button class="btn" id="pdf">⬇️ PDF</button></div></div>
      <form class="filters card" id="f">
        <label class="f">Último mes real<input type="month" name="ref" value="${ref}"></label>
        <label class="f">Media de los últimos<select name="n">${[3, 6, 9, 12, 24].map(x => `<option value="${x}" ${x === n ? 'selected' : ''}>${x} meses</option>`).join('')}</select></label>
        <label class="f">Horizonte<select name="h">${[12, 24, 36, 60, 120, 240].map(x => `<option value="${x}" ${x === H ? 'selected' : ''}>${x / 12} año${x > 12 ? 's' : ''}</option>`).join('')}</select></label>
        <label class="f">Inflación gastos %/año<input type="number" step="0.1" name="inf" value="${infl}" style="width:110px"></label>
        <label class="f">Subida ingresos %/año<input type="number" step="0.1" name="gi" value="${gI}" style="width:110px"></label>
        <label class="f">Escenario ingresos %<input type="number" step="1" name="ai" value="${aI}" style="width:100px" title="+10 = 10 % más de ingresos que la media"></label>
        <label class="f">Escenario gastos %<input type="number" step="1" name="ag" value="${aG}" style="width:100px" title="-10 = recortar gastos un 10 %"></label>
        <label class="f">Liquidez inicial €<input type="number" step="0.01" name="liq" value="${liqIni}" style="width:130px" title="Saldo disponible + efectivo − deuda de tarjetas"></label>
        <button class="btn btn-primary">Recalcular</button>
      </form>
      <div class="grid g-kpi">
        <div class="card kpi"><div class="label">Ingresos medios/mes</div><div class="value">${App.eur(proj.baseI)}</div><div class="sub">base de ${n} meses hasta ${App.monthShort(ref)}</div></div>
        <div class="card kpi"><div class="label">Gastos medios/mes</div><div class="value">${App.eur(proj.baseG)}</div><div class="sub">sin cuotas de préstamos</div></div>
        <div class="card kpi"><div class="label">Cuotas préstamos (1er mes)</div><div class="value">${App.eur(cuotasHoy)}</div><div class="sub">según cuadros de amortización</div></div>
        <div class="card kpi"><div class="label">Liquidez en ${App.monthShort(last.ym)}</div><div class="value ${App.cls(last.liquidez)}">${App.eur0(last.liquidez)}</div><div class="sub">${neg ? `<span class="neg">⚠ Negativa desde ${App.monthName(neg.ym)}</span>` : 'Sin tensiones de liquidez'}</div></div>
        <div class="card kpi"><div class="label">Deuda en ${App.monthShort(last.ym)}</div><div class="value">${App.eur0(last.deuda)}</div><div class="sub">hoy ${App.eur0(App.debtAt(ref))}</div></div>
        <div class="card kpi"><div class="label">Patrimonio neto en ${App.monthShort(last.ym)}</div><div class="value ${App.cls(last.patrimonio)}">${App.eur0(last.patrimonio)}</div><div class="sub">liquidez + inversión ${valorBienes ? '+ bienes ' : ''}− deuda</div></div>
      </div>
      <div class="card mt"><h2>Evolución proyectada</h2>
        <div class="legend"><span><i style="background:var(--s1)"></i>Liquidez</span><span><i style="background:var(--s8)"></i>Deuda pendiente</span><span><i style="background:var(--s3)"></i>Patrimonio neto</span></div>
        <div class="chart-box tall"><canvas id="cP"></canvas></div>
        ${!valorBienes ? '<p class="small muted">Consejo: indica el valor estimado de tus inmuebles, vehículos y fincas en Maestro › Bienes para que el patrimonio neto los incluya.</p>' : ''}</div>
      <div class="grid g-2 mt">
        <div class="card"><h2>Base de cálculo por categoría</h2><p class="small muted">Marca qué partidas se repiten cada mes. Las de préstamos se sustituyen por los cuadros de amortización y las puntuales (ventas, herencias…) se excluyen por defecto.</p>
          <div class="table-wrap" style="max-height:420px"><table class="t"><thead><tr><th>Incluir</th><th>Categoría</th><th>Sub.</th><th>Tipo</th><th class="num">Media/mes</th><th>Nota</th></tr></thead><tbody>
          ${base.map(b => `<tr><td><input type="checkbox" data-a="${App.esc(b.agrup)}" ${b.incluir ? 'checked' : ''}></td><td>${App.esc(b.categoria)}</td><td>${App.esc(b.sub)}</td><td>${b.tipo}</td><td class="num ${App.cls(b.tipo === 'I' ? b.media : -b.media)}">${App.num(b.tipo === 'I' ? b.media : -b.media)}</td><td class="small">${b.prestamo ? '<span class="tag">préstamo</span>' : ''}${b.puntual ? '<span class="tag warn">puntual</span>' : ''} ${b.mesesConDatos}/${n} meses</td></tr>`).join('')}
          </tbody></table></div></div>
        <div class="card"><h2>Eventos futuros previstos</h2><p class="small muted">Ingresos o gastos extraordinarios (venta de aceite, IBI, derrama, compra de coche…). Importe negativo para gastos.</p>
          <form id="ev" class="form-grid"><label class="f">Fecha<input type="date" name="fecha" required></label><label class="f">Descripción<input name="desc" required></label>
            <label class="f">Importe €<input type="number" step="0.01" name="importe" required></label><label class="f">Repetir cada mes hasta<input type="date" name="hasta"></label>
            <button class="btn">Añadir</button></form>
          ${S.eventos.length ? App.table([{ label: 'Fecha', get: e => App.fdate(e.fecha) }, { label: 'Descripción', key: 'desc' }, { label: 'Importe', key: 'importe', money: 1 }, { label: 'Hasta', get: e => e.recurrente ? App.fdate(e.hasta) || 'siempre' : '' }, { label: '', html: e => `<button class="btn btn-sm btn-danger" data-del="${e.id}">✕</button>` }], S.eventos, { sortable: false }) : '<p class="muted small mt">Sin eventos.</p>'}</div>
      </div>
      <div class="card mt"><h2>Detalle mensual</h2>${App.table([{ label: 'Mes', get: r => App.monthShort(r.ym) }, { label: 'Ingresos', key: 'ingresos', money: 1 }, { label: 'Gastos', get: r => -r.gastos, money: 1 }, { label: 'Cuotas', get: r => -r.cuotas, money: 1 }, { label: 'Eventos', key: 'eventos', money: 1 }, { label: 'Flujo neto', key: 'flujo', money: 1 }, { label: 'Liquidez', key: 'liquidez', money: 1 }, { label: 'Deuda', key: 'deuda', money: 1, }, { label: 'Patrimonio', key: 'patrimonio', money: 1 }], rows, { maxH: '420px', sortable: false })}</div>`;

    const f = App.$('#f');
    f.onsubmit = (e) => { e.preventDefault(); const q = new URLSearchParams(new FormData(f)); st.mesesMedia = +f.n.value; st.horizonte = +f.h.value; st.inflacion = +f.inf.value; st.crecimientoIngresos = +f.gi.value; App.db.save(); App.go('proyeccion?' + q); };
    const qs = () => new URLSearchParams(new FormData(f)).toString();
    App.$$('[data-a]').forEach(c => c.onchange = async () => { st.projIncl = Object.assign({}, st.projIncl, { [c.dataset.a]: c.checked }); await App.db.save(); App.go('proyeccion?' + qs()); });
    App.$('#ev').onsubmit = async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); S.eventos.push({ id: App.uid('E'), fecha: fd.fecha, desc: fd.desc, importe: +fd.importe, recurrente: !!fd.hasta, hasta: fd.hasta || null }); await App.db.save(); App.go('proyeccion?' + qs()); };
    App.$$('[data-del]').forEach(b => b.onclick = async () => { S.eventos = S.eventos.filter(x => x.id !== b.dataset.del); await App.db.save(); App.go('proyeccion?' + qs()); });

    App.chartDefaults(); const C = App.series();
    App.chart(App.$('#cP'), { type: 'line', data: { labels: rows.map(r => App.monthShort(r.ym)), datasets: [
      { label: 'Liquidez', data: rows.map(r => r.liquidez), borderColor: C[0], backgroundColor: C[0] },
      { label: 'Deuda pendiente', data: rows.map(r => r.deuda), borderColor: C[7], backgroundColor: C[7] },
      { label: 'Patrimonio neto', data: rows.map(r => r.patrimonio), borderColor: C[2], backgroundColor: C[2] }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${App.eur0(c.raw)}` } } },
        scales: { y: { ticks: { callback: App.moneyTick }, grid: { color: App.css('--grid') } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } } } } });

    const tableRows = rows.map(r => [r.ym, r.ingresos, -r.gastos, -r.cuotas, r.eventos, r.flujo, r.liquidez, r.deuda, r.patrimonio]);
    const head = ['Mes', 'Ingresos', 'Gastos', 'Cuotas', 'Eventos', 'Flujo neto', 'Liquidez', 'Deuda', 'Patrimonio'];
    const params = [['Último mes real', ref], ['Meses de media', n], ['Horizonte (meses)', H], ['Inflación gastos %', infl], ['Subida ingresos %', gI], ['Escenario ingresos %', aI], ['Escenario gastos %', aG], ['Liquidez inicial', liqIni], ['Ingresos medios', proj.baseI], ['Gastos medios', proj.baseG]];
    App.$('#xls').onclick = () => App.exportXLSX('Proyeccion_' + ref, [
      { name: 'Proyección', rows: [head, ...tableRows] }, { name: 'Parámetros', rows: [['Parámetro', 'Valor'], ...params], autofilter: false },
      { name: 'Base', rows: base.map(b => ({ Incluir: b.incluir ? 'Sí' : 'No', Agrup: b.agrup, Categoria: b.categoria, Subcategoria: b.sub, Tipo: b.tipo, MediaMensual: b.tipo === 'I' ? b.media : -b.media, Nota: (b.prestamo ? 'préstamo ' : '') + (b.puntual ? 'puntual' : '') })) },
      { name: 'Eventos', rows: S.eventos.map(e => ({ Fecha: e.fecha, Descripcion: e.desc, Importe: e.importe, Hasta: e.hasta || '' })) }]);
    App.$('#pdf').onclick = () => App.exportPDF('Proyeccion_' + ref, 'Proyección financiera', `Base: media de ${n} meses hasta ${App.monthName(ref)} · horizonte ${H} meses · inflación ${infl} % · ingresos +${gI} %/año`, [
      { heading: 'Hipótesis', head: ['Parámetro', 'Valor'], body: params.map(([a, b]) => [a, typeof b === 'number' ? App.num(b) : b]) },
      { heading: 'Evolución', chart: App.$('#cP') },
      { heading: 'Detalle mensual', head, body: tableRows.map(r => r.map((v, i) => i ? App.num(v) : v)), numCols: [1, 2, 3, 4, 5, 6, 7, 8] }], { landscape: true });
  };
})(window.App);
