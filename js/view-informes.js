/* Informes: tablas dinámicas por periodo exportables a Excel y PDF */
(function (App) {
  const TIPOS = {
    pyg: 'Ingresos y gastos por categoría y mes',
    area: 'Área › Categoría › Subcategoría (periodo)',
    activo: 'Resultado por activo y mes',
    saldos: 'Saldos de cuentas a fin de mes',
    prestamos: 'Cuadro de amortización de préstamos'
  };

  function build(tipo, desde, hasta, area) {
    const months = App.monthsBetween(App.ym(desde), App.ym(hasta));
    const movs = App.filterMovs({ desde, hasta, area }).filter(App.isPL);
    const sgn = (m) => +m.importe || 0;
    if (tipo === 'pyg') {
      const rows = {};
      movs.forEach(m => { const k = (m.tipo === 'I' ? '1 Ingresos' : '2 Gastos') + '|' + App.catName(m.agrup); const r = rows[k] = rows[k] || { _g: m.tipo === 'I' ? 'Ingresos' : 'Gastos', Categoria: App.catName(m.agrup), v: {} }; const ym = App.ym(m.fecha); r.v[ym] = (r.v[ym] || 0) + sgn(m); });
      const head = ['Tipo', 'Categoría', ...months.map(App.monthShort), 'Total'];
      const keys = Object.keys(rows).sort();
      const body = keys.map(k => { const r = rows[k]; const vals = months.map(m => App.round2(r.v[m] || 0)); return [r._g, r.Categoria, ...vals, App.round2(vals.reduce((a, b) => a + b, 0))]; });
      const tot = ['', 'Resultado neto', ...months.map((m, i) => App.round2(body.reduce((a, r) => a + r[i + 2], 0)))]; tot.push(App.round2(tot.slice(2).reduce((a, b) => a + b, 0)));
      return { head, body, foot: tot, numFrom: 2 };
    }
    if (tipo === 'area') {
      const rows = {};
      movs.forEach(m => { const k = [App.areaName(m.area), App.catName(m.agrup), App.subName(m.agrup) || '—'].join('|'); const r = rows[k] = rows[k] || { ing: 0, gas: 0, n: 0 }; if (m.tipo === 'I') r.ing += sgn(m); else r.gas += sgn(m); r.n++; });
      const body = Object.keys(rows).sort().map(k => { const [a, c, s] = k.split('|'); const r = rows[k]; return [a, c, s, r.n, App.round2(r.ing), App.round2(r.gas), App.round2(r.ing + r.gas)]; });
      const sum = (i) => App.round2(body.reduce((a, r) => a + r[i], 0));
      return { head: ['Área', 'Categoría', 'Subcategoría', 'Nº mov.', 'Ingresos', 'Gastos', 'Neto'], body, foot: ['Total', '', '', sum(3), sum(4), sum(5), sum(6)], numFrom: 3 };
    }
    if (tipo === 'activo') {
      const rows = {};
      movs.filter(m => m.activo).forEach(m => { const r = rows[m.activo] = rows[m.activo] || {}; const ym = App.ym(m.fecha); r[ym] = (r[ym] || 0) + sgn(m); });
      const body = Object.keys(rows).sort().map(k => { const vals = months.map(m => App.round2(rows[k][m] || 0)); return [k, App.bienName(k), ...vals, App.round2(vals.reduce((a, b) => a + b, 0))]; });
      const tot = ['Total', '', ...months.map((m, i) => App.round2(body.reduce((a, r) => a + r[i + 2], 0)))]; tot.push(App.round2(tot.slice(2).reduce((a, b) => a + b, 0)));
      return { head: ['Activo', 'Nombre', ...months.map(App.monthShort), 'Total'], body, foot: tot, numFrom: 2 };
    }
    if (tipo === 'saldos') {
      const ids = App.balances(App.endOfMonth(months[months.length - 1])).map(b => b.id);
      const body = ids.map(id => [id, App.cuentaGrupo(App.cuentaOf(id)), ...months.map(m => App.balanceAt(id, App.endOfMonth(m)).saldo)]);
      const disp = ['Total disponible', '', ...months.map((m, i) => App.round2(body.filter(r => r[1] === 'Disponible' || r[1] === 'Efectivo').reduce((a, r) => a + r[i + 2], 0)))];
      return { head: ['Cuenta', 'Grupo', ...months.map(App.monthShort)], body, foot: disp, numFrom: 2 };
    }
    if (tipo === 'prestamos') {
      const body = [];
      App.state.prestamos.forEach(p => App.loanSchedule(p).forEach(r => body.push([p.id, p.entidad, r.ym, r.cuota, r.interes, r.principal, r.pendiente])));
      return { head: ['Préstamo', 'Entidad', 'Mes', 'Cuota', 'Intereses', 'Amortización', 'Capital pendiente'], body, numFrom: 3 };
    }
  }

  App.views.informes = (el, p) => {
    const last = App.defaultMonth();
    const tipo = p.tipo || 'pyg';
    const desde = p.desde || (last.slice(0, 4) + '-01-01'), hasta = p.hasta || App.endOfMonth(last), area = p.area || '';
    const rep = build(tipo, desde, hasta, area);
    const title = TIPOS[tipo];
    const sub = (tipo === 'prestamos' ? 'Desde ' + App.fdate(App.today()) : `Del ${App.fdate(desde)} al ${App.fdate(hasta)}`) + (area ? ' · Área ' + App.areaName(area) : '');
    // importes con 2 decimales y punto de miles; recuentos (columna "Nº …") como enteros con punto de miles
    const fmt = (v, i) => i >= rep.numFrom && typeof v === 'number' ? (/^Nº/.test(rep.head[i]) ? App.int(v) : App.num(v)) : v;
    el.innerHTML = `<div class="page-head"><h1>Informes</h1><div class="actions"><button class="btn" id="xls">⬇️ Excel</button><button class="btn" id="pdf">⬇️ PDF</button><button class="btn" id="all">⬇️ Libro Excel completo</button></div></div>
      <form class="filters card" id="f">
        <label class="f" style="min-width:260px">Informe<select name="tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">Desde<input type="date" name="desde" value="${desde}"></label><label class="f">Hasta<input type="date" name="hasta" value="${hasta}"></label>
        <label class="f">Área<select name="area"><option value="">Todas</option>${App.state.areas.map(a => `<option value="${a.id}" ${a.id === area ? 'selected' : ''}>${App.esc(a.nombre)}</option>`).join('')}</select></label>
        <div class="row">${[['Año en curso', last.slice(0, 4) + '-01-01', App.endOfMonth(last)], ['Año anterior', (+last.slice(0, 4) - 1) + '-01-01', (+last.slice(0, 4) - 1) + '-12-31'], ['Últimos 12 meses', App.addMonths(last, -11) + '-01', App.endOfMonth(last)]].map(([l, d, h]) => `<button type="button" class="btn btn-sm" data-d="${d}" data-h="${h}">${l}</button>`).join('')}</div>
        <button class="btn btn-primary">Ver</button></form>
      <div class="card"><h2>${title}</h2><p class="small muted">${sub}</p>
      <div class="table-wrap" style="max-height:70vh"><table class="t"><thead><tr>${rep.head.map((h, i) => `<th class="${i >= rep.numFrom ? 'num' : ''}">${App.esc(h)}</th>`).join('')}</tr></thead><tbody>
      ${rep.body.map(r => `<tr>${r.map((v, i) => `<td class="${i >= rep.numFrom ? 'num ' + (typeof v === 'number' && tipo !== 'prestamos' ? App.cls(v) : '') : ''}">${App.esc(fmt(v, i))}</td>`).join('')}</tr>`).join('')}
      ${rep.foot ? `<tr class="total">${rep.foot.map((v, i) => `<td class="${i >= rep.numFrom ? 'num' : ''}">${App.esc(fmt(v, i))}</td>`).join('')}</tr>` : ''}</tbody></table></div></div>`;
    const f = App.$('#f');
    f.onsubmit = (e) => { e.preventDefault(); const q = new URLSearchParams(new FormData(f)); App.go('informes?' + q); };
    f.tipo.onchange = () => f.requestSubmit();
    App.$$('[data-d]', f).forEach(b => b.onclick = () => { f.desde.value = b.dataset.d; f.hasta.value = b.dataset.h; f.requestSubmit(); });
    App.$('#xls').onclick = () => App.exportXLSX(`Informe_${tipo}_${desde}_${hasta}`, [{ name: title, rows: [rep.head, ...rep.body, ...(rep.foot ? [rep.foot] : [])] }]);
    App.$('#pdf').onclick = () => App.exportPDF(`Informe_${tipo}_${desde}_${hasta}`, title, sub, [{ head: rep.head, body: rep.body.map(r => r.map(fmt)), foot: rep.foot && rep.foot.map(fmt), numCols: rep.head.map((_, i) => i).filter(i => i >= rep.numFrom) }], { landscape: rep.head.length > 7 });
    App.$('#all').onclick = () => App.exportXLSX(`MiEconomia_${desde}_${hasta}`, [
      ...Object.keys(TIPOS).map(k => { const r = build(k, desde, hasta, area); return { name: TIPOS[k].slice(0, 31), rows: [r.head, ...r.body, ...(r.foot ? [r.foot] : [])] }; }),
      { name: 'Movimientos', rows: App.movsToRows(App.filterMovs({ desde, hasta, area })) }
    ]);
  };
})(window.App);
