/* Actividad compartida (p. ej. el olivar con tus hermanos): rendición de cuentas separada de tu economía */
(function (App) {
  const R = App.round2;
  // Campaña agrícola: de octubre a septiembre
  const campana = (iso) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const y0 = m >= 10 ? y : y - 1; return [`${y0}-10-01`, `${y0 + 1}-09-30`]; };
  const esReparto = (m) => /^rep:/i.test(m.agrup || '');
  const esAportacion = (m) => /^aps:/i.test(m.agrup || '');
  const socioDe = (m) => (String(m.agrup || '').split(':')[1] || m.beneficiario || '¿?').trim();

  /* Caja de la actividad en una fecha: saldo de las cuentas compartidas menos el dinero propio que pasó por ellas */
  App.cajaActividad = (iso) => R(App.state.cuentas.filter(c => c.compartida).reduce((a, c) => a + App.balanceAt(c.id, iso).saldo - App.propioEnCuenta(c.id, iso), 0));

  App.views.actividad = (el, p) => {
    const comp = App.state.cuentas.filter(c => c.compartida);
    if (!comp.length) {
      el.innerHTML = `<div class="page-head"><h1>Actividad compartida</h1></div><div class="card stack"><p>No hay ninguna cuenta marcada como <b>actividad compartida</b>.</p>
        <p class="small muted">En Maestro › Cuentas, edita la cuenta (o cuentas) de la actividad que compartes con otras personas, pon "Actividad compartida: Sí" y el área de la actividad. También puedes cargar tu configuración personal en Ajustes.</p>
        <a class="btn btn-primary" href="#/maestro?t=cuentas" style="align-self:flex-start">Ir a Maestro › Cuentas</a></div>`;
      return;
    }
    const area = comp[0].actividad || 'O', nombre = App.areaName(area);
    const ultimo = App.lastDataMonth() + '-28';
    const [c0, c1] = campana(ultimo);
    const desde = p.desde || c0, hasta = p.hasta || c1;
    const movs = App.filterMovs({ desde, hasta, ambito: 'compartido' });

    const socios = {}, ing = {}, gas = {}; let ingresos = 0, gastos = 0, aport = 0, repart = 0, otros = 0;
    movs.forEach(m => {
      const v = +m.importe || 0;
      if (esReparto(m) || esAportacion(m)) {
        const s = socios[socioDe(m)] = socios[socioDe(m)] || { aportado: 0, recibido: 0, n: 0 };
        if (v >= 0) { s.aportado += v; aport += v; } else { s.recibido -= v; repart -= v; }
        s.n++;
      } else if (m.tipo === 'I') { ingresos += v; ing[m.agrup || '—'] = (ing[m.agrup || '—'] || 0) + v; }
      else if (m.tipo === 'G') { gastos -= v; gas[m.agrup || '—'] = (gas[m.agrup || '—'] || 0) - v; }
      else otros += v;     // traspasos entre las cuentas de la actividad (se compensan) u otros sin clasificar
    });
    const resultado = R(ingresos - gastos);
    const cajaIni = App.cajaActividad(App.addDays(desde, -1)), cajaFin = App.cajaActividad(hasta);
    // la caja de la actividad = lo que hay en bancos/efectivo − tu dinero propio depositado + lo que has usado de ella
    const enBancos = R(comp.reduce((a, c) => a + App.balanceAt(c.id, hasta).saldo, 0));
    const propioFin = R(comp.reduce((a, c) => a + App.propioEnCuenta(c.id, hasta), 0));
    const socioPropio = App.state.settings.socioPropio || 'tú';
    const esperado = R(cajaIni + ingresos - gastos + aport - repart + otros), dif = R(cajaFin - esperado);
    const filas = (o) => Object.entries(o).map(([k, v]) => ({ agrup: k, cat: App.catName(k), sub: App.subName(k), importe: R(v) })).sort((a, b) => b.importe - a.importe);
    const fIng = filas(ing), fGas = filas(gas);
    const fSoc = Object.entries(socios).map(([k, s]) => ({ socio: k, aportado: R(s.aportado), recibido: R(s.recibido), neto: R(s.recibido - s.aportado), n: s.n })).sort((a, b) => a.socio.localeCompare(b.socio));
    const meses = App.monthsBetween(App.ym(desde), App.ym(hasta));
    const porMes = meses.map(ym => { const ms = movs.filter(m => App.ym(m.fecha) === ym && !esReparto(m) && !esAportacion(m)); return { ym, i: R(ms.filter(m => m.tipo === 'I').reduce((a, m) => a + (+m.importe || 0), 0)), g: R(-ms.filter(m => m.tipo === 'G').reduce((a, m) => a + (+m.importe || 0), 0)) }; });
    const kpi = (l, v, s, c = '') => `<div class="card kpi"><div class="label">${l}</div><div class="value ${c}">${v}</div><div class="sub">${s || ''}</div></div>`;
    const periodo = `Del ${App.fdate(desde)} al ${App.fdate(hasta)}`;

    el.innerHTML = `<div class="page-head"><h1>Actividad compartida · ${App.esc(nombre)}</h1><div class="actions"><button class="btn" id="xls">⬇️ Excel</button><button class="btn" id="pdf">⬇️ PDF (rendición de cuentas)</button></div></div>
      <p class="muted small">Cuentas: ${comp.map(c => App.esc(c.id)).join(', ')}. Solo cuentan los movimientos del área ${App.esc(nombre)}; los de otras áreas en estas cuentas son tuyos y aparecen en tu economía.</p>
      <form class="filters card" id="f">
        <label class="f">Desde<input type="date" name="desde" value="${desde}"></label><label class="f">Hasta<input type="date" name="hasta" value="${hasta}"></label>
        <div class="row">${[['Campaña actual', c0, c1], ['Campaña anterior', App.addDays(c0, -365).slice(0, 4) + '-10-01', c0.slice(0, 4) + '-09-30'], ['Año ' + ultimo.slice(0, 4), ultimo.slice(0, 4) + '-01-01', ultimo.slice(0, 4) + '-12-31']]
          .map(([l, d, h]) => `<button type="button" class="btn btn-sm" data-d="${d}" data-h="${h}">${l}</button>`).join('')}</div><button class="btn btn-primary">Ver</button></form>
      <div class="grid g-kpi">
        ${kpi('Ingresos de la actividad', App.eur(ingresos), periodo)}
        ${kpi('Gastos de la actividad', App.eur(gastos))}
        ${kpi('Resultado', App.eur(resultado), 'Ingresos − gastos', App.cls(resultado))}
        ${kpi('Repartos a socios', App.eur(repart), `Aportaciones: ${App.eur(aport)}`)}
        ${kpi('Caja de la actividad', App.eur(cajaFin), `Al inicio: ${App.eur(cajaIni)}`)}
        ${kpi('En bancos y efectivo', App.eur(enBancos), `Saldo real de ${comp.map(c => App.esc(c.id)).join(' + ')}`)}
        ${propioFin < -0.005 ? kpi(`Pendiente de ${App.esc(socioPropio)}`, App.eur(-propioFin), `Dinero de la actividad usado en movimientos propios de ${App.esc(socioPropio)} (área distinta de ${App.esc(nombre)})`, 'neg')
          : propioFin > 0.005 ? kpi(`Dinero propio de ${App.esc(socioPropio)} en estas cuentas`, App.eur(propioFin), 'No es de la actividad') : ''}
      </div>
      <div class="card mt"><h2>Conciliación de caja</h2>
        ${App.table([{ label: 'Concepto', key: 'c' }, { label: 'Importe', key: 'v', money: 1 }], [
          { c: 'Caja al inicio del periodo', v: cajaIni }, { c: '+ Ingresos de la actividad', v: ingresos }, { c: '− Gastos de la actividad', v: -gastos },
          { c: '+ Aportaciones de socios', v: aport }, { c: '− Repartos a socios', v: -repart }, { c: '± Traspasos internos y otros sin clasificar', v: otros },
          { c: '= Caja esperada', v: esperado }, { c: 'Caja real al final del periodo', v: cajaFin },
          { c: `   de la cual: en bancos y efectivo`, v: enBancos }, { c: `   menos: dinero propio de ${socioPropio} depositado`, v: -Math.max(0, propioFin) }, { c: `   más: pendiente de ${socioPropio} (usado en movimientos propios)`, v: Math.max(0, -propioFin) }], { sortable: false, color: false })}
        ${Math.abs(dif) > 0.05 ? `<div class="alert warn small mt">Diferencia de ${App.eur(dif)} entre la caja real y la esperada: falta algún movimiento por registrar o hay movimientos de esta cuenta en otra área.</div>` : '<p class="small pos mt">✔ La caja cuadra.</p>'}</div>
      <div class="grid g-2 mt">
        <div class="card"><h2>Ingresos por categoría</h2>${App.table([{ label: 'Categoría', key: 'cat' }, { label: 'Subcategoría', key: 'sub' }, { label: 'Importe', key: 'importe', money: 1 }], fIng, { total: ['Total', '', ingresos], color: false })}</div>
        <div class="card"><h2>Gastos por categoría</h2>${App.table([{ label: 'Categoría', key: 'cat' }, { label: 'Subcategoría', key: 'sub' }, { label: 'Importe', key: 'importe', money: 1 }], fGas, { total: ['Total', '', gastos], color: false })}</div>
      </div>
      <div class="grid g-2 mt">
        <div class="card"><h2>Socios: aportaciones y repartos</h2>
          ${fSoc.length ? App.table([{ label: 'Socio', key: 'socio' }, { label: 'Aportado', key: 'aportado', money: 1 }, { label: 'Recibido', key: 'recibido', money: 1 }, { label: 'Neto recibido', key: 'neto', money: 1 }, { label: 'Movs.', key: 'n', num: 1 }], fSoc,
            { total: ['Total', aport, repart, R(repart - aport), ''], color: false }) : '<p class="muted small">No hay repartos ni aportaciones en el periodo.</p>'}
          <p class="small muted">Repartos: categorías "Rep:&lt;socio&gt;". Aportaciones: "Aps:&lt;socio&gt;".</p></div>
        <div class="card"><h2>Ingresos y gastos por mes</h2><div class="legend"><span><i style="background:var(--s1)"></i>Ingresos</span><span><i style="background:var(--s2)"></i>Gastos</span></div><div class="chart-box"><canvas id="cAct"></canvas></div></div>
      </div>
      <div class="card mt"><h2>Movimientos de la actividad <span class="muted small">${App.int(movs.length)}</span></h2>
        ${App.table([{ label: 'Fecha', get: m => App.fdate(m.fecha) }, { label: 'Cuenta', key: 'cuenta' }, { label: 'Concepto', key: 'concepto', wrap: 1 }, { label: 'Importe', key: 'importe', money: 1 }, { label: 'Tipo', key: 'tipo' }, { label: 'Categoría', get: m => App.catName(m.agrup) + (App.subName(m.agrup) ? ' / ' + App.subName(m.agrup) : '') }],
          movs.slice().reverse().map(m => ({ ...m, _attrs: `data-id="${m.id}" style="cursor:pointer"` })), { maxH: '50vh' })}</div>`;

    const f = App.$('#f');
    f.onsubmit = (e) => { e.preventDefault(); App.go('actividad?' + new URLSearchParams(new FormData(f))); };
    App.$$('[data-d]', f).forEach(b => b.onclick = () => { f.desde.value = b.dataset.d; f.hasta.value = b.dataset.h; f.requestSubmit(); });
    App.$$('tr[data-id]').forEach(tr => tr.onclick = () => App.editMov(tr.dataset.id));
    App.chartDefaults(); const S = App.series();
    App.chart(App.$('#cAct'), { type: 'bar', data: { labels: porMes.map(x => App.monthShort(x.ym)), datasets: [{ label: 'Ingresos', data: porMes.map(x => x.i), backgroundColor: S[0] }, { label: 'Gastos', data: porMes.map(x => x.g), backgroundColor: S[1] }] },
      options: { plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: c => ` ${c.dataset.label}: ${App.eur(c.raw)}` } } }, scales: { y: { ticks: { callback: App.moneyTick } }, x: { grid: { display: false } } } } });

    const nombreArch = `Rendicion_${nombre}_${desde}_${hasta}`;
    App.$('#xls').onclick = () => App.exportXLSX(nombreArch, [
      { name: 'Resumen', autofilter: false, rows: [['Actividad', nombre], ['Periodo', periodo], ['Cuentas', comp.map(c => c.id).join(', ')], [], ['Caja al inicio', cajaIni], ['Ingresos', R(ingresos)], ['Gastos', R(gastos)], ['Resultado', resultado], ['Aportaciones de socios', R(aport)], ['Repartos a socios', R(repart)], ['Traspasos internos y otros', R(otros)], ['Caja esperada', esperado], ['Caja real al final', cajaFin], ['  en bancos y efectivo', enBancos], [`  pendiente de ${socioPropio}`, R(Math.max(0, -propioFin))], [`  dinero propio de ${socioPropio} depositado`, R(Math.max(0, propioFin))], ['Diferencia', dif]] },
      { name: 'Ingresos', rows: fIng.map(r => ({ Agrup: r.agrup, Categoria: r.cat, Subcategoria: r.sub, Importe: r.importe })) },
      { name: 'Gastos', rows: fGas.map(r => ({ Agrup: r.agrup, Categoria: r.cat, Subcategoria: r.sub, Importe: r.importe })) },
      { name: 'Socios', rows: fSoc.map(r => ({ Socio: r.socio, Aportado: r.aportado, Recibido: r.recibido, NetoRecibido: r.neto })) },
      { name: 'Movimientos', rows: App.movsToRows(movs) }]);
    App.$('#pdf').onclick = () => App.exportPDF(nombreArch, `Rendición de cuentas · ${nombre}`, `${periodo} · Cuentas ${comp.map(c => c.id).join(', ')}`, [
      { heading: 'Resumen', head: ['Concepto', 'Importe'], body: [['Caja al inicio', App.num(cajaIni)], ['+ Ingresos de la actividad', App.num(ingresos)], ['− Gastos de la actividad', App.num(gastos)], ['= Resultado', App.num(resultado)], ['+ Aportaciones de socios', App.num(aport)], ['− Repartos a socios', App.num(repart)], ['± Traspasos internos y otros', App.num(otros)], ['Caja esperada', App.num(esperado)], ['Caja real al final', App.num(cajaFin)], ['   en bancos y efectivo', App.num(enBancos)], [`   pendiente de ${socioPropio}`, App.num(Math.max(0, -propioFin))], [`   dinero propio de ${socioPropio} depositado`, App.num(Math.max(0, propioFin))], ['Diferencia', App.num(dif)]], numCols: [1] },
      { heading: 'Ingresos por categoría', head: ['Categoría', 'Subcategoría', 'Importe'], body: fIng.map(r => [r.cat, r.sub, App.num(r.importe)]), foot: ['Total', '', App.num(ingresos)], numCols: [2] },
      { heading: 'Gastos por categoría', head: ['Categoría', 'Subcategoría', 'Importe'], body: fGas.map(r => [r.cat, r.sub, App.num(r.importe)]), foot: ['Total', '', App.num(gastos)], numCols: [2] },
      { heading: 'Socios', head: ['Socio', 'Aportado', 'Recibido', 'Neto recibido'], body: fSoc.map(r => [r.socio, App.num(r.aportado), App.num(r.recibido), App.num(r.neto)]), numCols: [1, 2, 3] },
      { heading: 'Ingresos y gastos por mes', chart: App.$('#cAct') },
      { heading: 'Movimientos', head: ['Fecha', 'Cuenta', 'Concepto', 'Importe', 'Categoría'], body: movs.map(m => [App.fdate(m.fecha), m.cuenta, (m.concepto || '').slice(0, 60), App.num(m.importe), App.catName(m.agrup) + (App.subName(m.agrup) ? ' / ' + App.subName(m.agrup) : '')]), numCols: [3] }
    ], { landscape: true });
  };
})(window.App);
