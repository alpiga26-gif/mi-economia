/* Listado, filtros y edición de movimientos */
(function (App) {
  const opts = (arr, sel, label = x => x.nombre, val = x => x.id, empty = '') =>
    (empty !== null ? `<option value="">${empty}</option>` : '') + arr.map(x => `<option value="${App.esc(val(x))}" ${val(x) === sel ? 'selected' : ''}>${App.esc(label(x))}</option>`).join('');

  /* Formulario de movimiento reutilizable (alta, edición, escaneo) */
  App.movForm = (m = {}) => {
    const S = App.state;
    const cats = S.categorias.slice().sort((a, b) => a.supra.localeCompare(b.supra));
    const bienes = [...S.bienes.map(b => ({ id: b.id, nombre: `${b.nombre.trim()} (${b.tipo})` })), ...S.prestamos.map(p => ({ id: p.id, nombre: `${p.id} · préstamo ${p.entidad}` }))];
    const unknownAgrup = m.agrup && !App.idx.cat[m.agrup] ? `<option value="${App.esc(m.agrup)}" selected>${App.esc(m.agrup)} (no está en el maestro)</option>` : '';
    const unknownAct = m.activo && !bienes.some(b => b.id === m.activo) ? `<option value="${App.esc(m.activo)}" selected>${App.esc(m.activo)} (no está en el maestro)</option>` : '';
    const unknownCta = m.cuenta && !App.idx.cuenta[m.cuenta] ? `<option value="${App.esc(m.cuenta)}" selected>${App.esc(m.cuenta)} (no está en el maestro)</option>` : '';
    return `<div class="form-grid">
      <label class="f">Fecha<input type="date" name="fecha" value="${m.fecha || App.today()}" required></label>
      <label class="f">Fecha valor<input type="date" name="fechaValor" value="${m.fechaValor || ''}"></label>
      <label class="f">Importe (− gasto, + ingreso)<input type="number" step="0.01" name="importe" value="${m.importe ?? ''}" required inputmode="decimal"></label>
      <label class="f">Cuenta<select name="cuenta" required>${unknownCta}${opts(S.cuentas, m.cuenta, c => `${c.id} · ${c.banco || c.tipo}`, c => c.id, 'Elegir…')}</select></label>
      <label class="f">Tipo<select name="tipo">${opts(S.tipos, m.tipo, t => `${t.id} · ${t.nombre}`)}${m.tipo && !App.idx.tipo[m.tipo] ? `<option selected>${App.esc(m.tipo)}</option>` : ''}</select></label>
      <label class="f">Área<select name="area">${opts(S.areas, m.area, a => `${a.id} · ${a.nombre}`)}${m.area && !App.idx.area[m.area] ? `<option selected>${App.esc(m.area)}</option>` : ''}</select></label>
      <label class="f" style="grid-column:span 2">Categoría : subcategoría<select name="agrup">${unknownAgrup}${opts(cats, m.agrup, c => c.supra, c => c.agrup, 'Sin clasificar')}</select></label>
      <label class="f">Activo / préstamo<select name="activo">${unknownAct}${opts(bienes, m.activo, b => b.nombre, b => b.id, '—')}</select></label>
      <label class="f">Beneficiario<input name="beneficiario" value="${App.esc(m.beneficiario || '')}"></label>
      <label class="f">Estado<select name="estado">${['R', 'AR', 'P'].map(e => `<option ${e === (m.estado || 'P') ? 'selected' : ''} value="${e}">${{ R: 'R · Clasificado', AR: 'AR · Desglosado', P: 'P · Pendiente de revisar' }[e]}</option>`).join('')}</select></label>
      <label class="f">Saldo tras el movimiento<input type="number" step="0.01" name="saldo" value="${m.saldo ?? ''}"></label>
      <label class="f" style="grid-column:1/-1">Concepto<textarea name="concepto">${App.esc(m.concepto || '')}</textarea></label>
      <label class="f" style="grid-column:1/-1">Observaciones<input name="obs" value="${App.esc(m.obs || '')}"></label>
      <label class="f">Mes del recibo<input type="month" name="mesRec" value="${m.mesRec ? App.ym(m.mesRec) : ''}"></label>
      <label class="f">IdRecibo<input name="idRecibo" value="${App.esc(m.idRecibo || '')}"></label>
    </div>${(() => { const ds = m.docs && m.docs.length ? m.docs : (m.doc ? [m.doc] : []); return ds.length ? `<p class="small">📎 Documento${ds.length > 1 ? 's' : ''}: ${ds.map(d => d.url ? `<a href="${App.esc(d.url)}" target="_blank" rel="noopener">${App.esc(d.name || 'ver en Drive')}</a>` : App.esc(d.name) + ' (pendiente de subir a Drive)').join(' · ')}</p>` : ''; })()}`;
  };
  App.readMovForm = (root, base = {}) => {
    const g = (n) => root.querySelector(`[name="${n}"]`)?.value ?? '';
    const m = Object.assign({}, base, {
      fecha: g('fecha'), fechaValor: g('fechaValor') || null, importe: App.parseNum(g('importe')), cuenta: g('cuenta'), tipo: g('tipo'), area: g('area'), agrup: g('agrup'),
      activo: g('activo'), beneficiario: g('beneficiario'), estado: g('estado'), saldo: App.parseNum(g('saldo')), concepto: g('concepto'), obs: g('obs'), mesRec: g('mesRec') ? g('mesRec') + '-01' : null, idRecibo: g('idRecibo')
    });
    return m;
  };
  /* Al elegir categoría en un alta, si el tipo no casa con el signo se avisa */
  App.wireMovForm = (root) => {
    const imp = root.querySelector('[name=importe]'), tipo = root.querySelector('[name=tipo]');
    const chk = () => { const v = App.parseNum(imp.value); if (v == null) return; if (v < 0 && tipo.value === 'I') tipo.value = 'G'; if (v > 0 && tipo.value === 'G' && !imp.dataset.touched) tipo.value = 'I'; };
    imp.addEventListener('change', chk);
  };

  App.editMov = (id, after) => {
    const m = id ? App.state.movimientos.find(x => x.id === id) : { estado: 'R', fecha: App.today(), tipo: 'G', area: 'P' };
    const S = App.state;
    const hijos = id ? S.movimientos.filter(x => x.desgloseDe === id) : [];
    const padre = m.desgloseDe ? S.movimientos.find(x => x.id === m.desgloseDe) : null;
    const desgInfo = hijos.length ? `<div class="alert info small mt">⇉ Cargo desglosado en ${hijos.length - 1} partidas: ${hijos.filter(h => h.estado === 'R').map(h => `${App.esc(App.subName(h.agrup) || h.agrup)} ${App.num(h.importe)}`).join(' · ')}</div>`
      : padre ? `<div class="alert info small mt">Esta partida pertenece al desglose del cargo de ${App.num(padre.importe)} del ${App.fdate(padre.fecha)}. Para cambiarla, deshaz el desglose desde ese cargo.</div>` : '';
    App.modal(`<h2>${id ? 'Editar movimiento' : 'Nuevo movimiento'}</h2><form id="mf">${App.movForm(m)}</form>${desgInfo}
      ${id && !padre ? `<label class="row small mt"><input type="checkbox" id="mkRule"> Crear regla: los movimientos cuyo concepto contenga <input id="ruleTxt" value="${App.esc(App.ruleKey(m.concepto))}" style="min-width:200px"> se clasificarán así</label>` : ''}
      <div class="modal-actions">${id ? '<button class="btn btn-danger" id="del">Eliminar</button>' : ''}
        ${hijos.length ? '<button class="btn" id="undo">Deshacer desglose</button>' : id && !padre && m.estado !== 'AR' ? '<button class="btn" id="split">⇉ Desglosar</button>' : ''}
        <span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Guardar</button></div>`, (el, close) => {
      App.wireMovForm(el);
      const agrupSel = el.querySelector('[name=agrup]'), rule = el.querySelector('#mkRule');
      if (rule) agrupSel.addEventListener('change', () => { rule.checked = true; });
      el.querySelector('#ok').onclick = async () => {
        const f = el.querySelector('#mf'); if (!f.reportValidity()) return;
        const nm = App.readMovForm(f, m);
        if (id) { Object.assign(m, nm); if (m.estado === 'P' && m.agrup) m.estado = 'R'; if (rule?.checked) await App.saveRule(el.querySelector('#ruleTxt').value, m); await App.db.save(); }
        else await App.addMovs([nm]);
        close(); App.updateBadge(); App.toast('Movimiento guardado' + (rule?.checked ? ' y regla creada' : '')); (after || App.render)();
      };
      const sp = el.querySelector('#split'); if (sp) sp.onclick = () => { close(); App.openDesglose(m, null, after); };
      const un = el.querySelector('#undo'); if (un) un.onclick = async () => { close(); if (await App.confirm('Se borrarán las partidas del desglose y el cargo volverá a quedar pendiente. Si era un préstamo, se restaura su capital pendiente. ¿Continuar?')) { await App.undoDesglose(m); App.updateBadge(); App.toast('Desglose deshecho'); (after || App.render)(); } };
      const d = el.querySelector('#del'); if (d) d.onclick = async () => { close(); if (await App.confirm(hijos.length ? '¿Eliminar este movimiento y las partidas de su desglose?' : '¿Eliminar este movimiento?')) { if (hijos.length) await App.undoDesglose(m); App.state.movimientos = App.state.movimientos.filter(x => x.id !== id); await App.db.save(); App.toast('Eliminado'); (after || App.render)(); } };
    });
  };

  App.views.movimientos = (el, p) => {
    const S = App.state;
    const f = { ym: p.mes || '', desde: p.desde || '', hasta: p.hasta || '', cuenta: p.cuenta || '', area: p.area || '', tipo: p.tipo || '', categoria: p.categoria || '', texto: p.q || '', activo: p.activo || '' };
    if (!f.ym && !f.desde && !f.hasta && !f.texto && !p.todo) f.ym = App.defaultMonth();
    // Jerarquía: con un mes elegido, "Desde/Hasta" solo pueden moverse dentro de ese mes; sin mes, son libres
    const lim = f.ym ? { min: f.ym + '-01', max: App.endOfMonth(f.ym) } : { min: '', max: '' };
    if (f.ym) {
      if (f.desde && (f.desde < lim.min || f.desde > lim.max)) f.desde = '';
      if (f.hasta && (f.hasta < lim.min || f.hasta > lim.max)) f.hasta = '';
    }
    if (f.desde && f.hasta && f.desde > f.hasta) [f.desde, f.hasta] = [f.hasta, f.desde];
    const movs = App.filterMovs(f).slice().reverse();
    const s = App.summarize(movs);
    const LIMIT = 400;
    const catNames = Array.from(new Set(S.movimientos.map(m => App.catName(m.agrup)))).sort();
    const months = App.monthsWithData().reverse();
    el.innerHTML = `
      <div class="page-head"><h1>Movimientos</h1>
        <div class="actions"><button class="btn btn-primary" id="nuevo">＋ Nuevo</button><button class="btn" id="xls">⬇️ Excel</button><button class="btn" id="pdf">⬇️ PDF</button></div></div>
      <form class="filters card" id="flt">
        <label class="f">Mes<select name="mes"><option value="">— (fechas libres)</option>${months.map(m => `<option value="${m}" ${m === f.ym ? 'selected' : ''}>${App.monthName(m)}</option>`).join('')}</select></label>
        <label class="f"><span>Desde <span class="muted" id="fDesdeAyuda">${f.ym ? '(dentro del mes)' : ''}</span></span><input type="date" name="desde" value="${f.desde}" min="${lim.min}" max="${f.hasta || lim.max}"></label>
        <label class="f"><span>Hasta <span class="muted" id="fHastaAyuda">${f.ym ? '(dentro del mes)' : ''}</span></span><input type="date" name="hasta" value="${f.hasta}" min="${f.desde || lim.min}" max="${lim.max}"></label>
        <label class="f">Cuenta<select name="cuenta">${opts(S.cuentas, f.cuenta, c => c.id, c => c.id, 'Todas')}</select></label>
        <label class="f">Área<select name="area">${opts(S.areas, f.area, a => a.nombre, a => a.id, 'Todas')}</select></label>
        <label class="f">Tipo<select name="tipo">${opts(S.tipos, f.tipo, t => t.nombre, t => t.id, 'Todos')}</select></label>
        <label class="f">Categoría<select name="categoria"><option value="">Todas</option>${catNames.map(c => `<option ${c === f.categoria ? 'selected' : ''}>${App.esc(c)}</option>`).join('')}</select></label>
        <label class="f" style="flex:1;min-width:180px">Buscar<input name="q" value="${App.esc(f.texto)}" placeholder="concepto, beneficiario, importe…"></label>
        <button class="btn btn-primary">Filtrar</button><button class="btn" type="button" id="clr">Limpiar</button>
      </form>
      <div class="grid g-kpi">
        <div class="card kpi"><div class="label">Movimientos</div><div class="value">${App.int(movs.length)}</div></div>
        <div class="card kpi"><div class="label">Ingresos</div><div class="value">${App.eur(s.ingresos)}</div></div>
        <div class="card kpi"><div class="label">Gastos</div><div class="value">${App.eur(s.gastos)}</div></div>
        <div class="card kpi"><div class="label">Neto</div><div class="value ${App.cls(s.ahorro)}">${App.eur(s.ahorro)}</div></div>
      </div>
      <div class="mt">${App.table([
        { label: 'Fecha', get: m => App.fdate(m.fecha) }, { label: 'Concepto', key: 'concepto', wrap: 1, html: m => App.esc(m.concepto) + (m.obs ? `<br><span class="muted small">${App.esc(m.obs)}</span>` : '') + (m.desgloseDe ? ' <span class="tag">partida</span>' : m.estado === 'AR' ? ' <span class="tag">desglosado</span>' : '') }, { label: 'Importe', key: 'importe', money: 1 },
        { label: 'Tipo', key: 'tipo' }, { label: 'Área', get: m => App.areaName(m.area) }, { label: 'Categoría', get: m => App.catName(m.agrup) }, { label: 'Subcat.', get: m => App.subName(m.agrup) },
        { label: 'Cuenta', key: 'cuenta' }, { label: 'Activo', key: 'activo' }, { label: 'Est.', html: m => `<span class="tag ${m.estado === 'P' ? 'warn' : 'good'}">${App.esc(m.estado || '')}</span>` },
        { label: '📎', html: m => m.doc ? (m.doc.url ? `<a href="${App.esc(m.doc.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📎</a>` : '⏳') : '' }
      ], movs.slice(0, LIMIT).map(m => ({ ...m, _attrs: `data-id="${m.id}" style="cursor:pointer"` })), { maxH: '65vh' })}
      ${movs.length > LIMIT ? `<p class="small muted">Se muestran los ${LIMIT} más recientes de ${App.int(movs.length)}. Afina el filtro o exporta a Excel para verlos todos.</p>` : ''}</div>`;

    App.$('#flt').onsubmit = (e) => { e.preventDefault(); const q = new URLSearchParams(); new FormData(e.target).forEach((v, k) => v && q.set(k, v)); if (![...q.keys()].length) q.set('todo', 1); App.go('movimientos?' + q.toString()); };
    App.$('#clr').onclick = () => App.go('movimientos?todo=1');
    // Al cambiar el mes, las fechas Desde/Hasta quedan acotadas a ese mes (o libres si el mes se deja vacío)
    const fm = App.$('#flt'), selMes = fm.mes, iDesde = fm.desde, iHasta = fm.hasta;
    const acotar = () => {
      const ym = selMes.value, min = ym ? ym + '-01' : '', max = ym ? App.endOfMonth(ym) : '';
      [iDesde, iHasta].forEach(i => { if (i.value && ym && (i.value < min || i.value > max)) i.value = ''; });
      iDesde.min = min; iDesde.max = iHasta.value || max; iHasta.min = iDesde.value || min; iHasta.max = max;
      App.$('#fDesdeAyuda').textContent = App.$('#fHastaAyuda').textContent = ym ? '(dentro del mes)' : '';
    };
    selMes.onchange = acotar; iDesde.onchange = acotar; iHasta.onchange = acotar;
    App.$('#nuevo').onclick = () => App.editMov(null);
    App.$$('tr[data-id]').forEach(tr => tr.onclick = () => App.editMov(tr.dataset.id));
    const desc = [f.ym && App.monthName(f.ym), f.desde && 'desde ' + App.fdate(f.desde), f.hasta && 'hasta ' + App.fdate(f.hasta), f.cuenta, f.area && App.areaName(f.area), f.categoria, f.texto && `"${f.texto}"`].filter(Boolean).join(' · ') || 'Todos';
    App.$('#xls').onclick = () => App.exportXLSX('Movimientos_' + (f.ym || App.today()), [{ name: 'Movimientos', rows: App.movsToRows(movs) }]);
    App.$('#pdf').onclick = () => App.exportPDF('Movimientos_' + (f.ym || App.today()), 'Movimientos', desc + ` · Ingresos ${App.eur(s.ingresos)} · Gastos ${App.eur(s.gastos)}`, [
      { head: ['Fecha', 'Concepto', 'Importe', 'Tipo', 'Área', 'Categoría', 'Cuenta'], body: movs.map(m => [App.fdate(m.fecha), (m.concepto || '').slice(0, 70), App.num(m.importe), m.tipo, m.area, App.catName(m.agrup) + (App.subName(m.agrup) ? ' / ' + App.subName(m.agrup) : ''), m.cuenta]), numCols: [2] }], { landscape: true });
  };
})(window.App);
