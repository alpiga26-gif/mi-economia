/* Calidad de datos: detección de incongruencias y correcciones rápidas */
(function (App) {
  const SEV = { alta: 'bad', media: 'warn', baja: '' };
  App.updateBadge = () => {
    try { const n = App.validate().filter(i => i.sev === 'alta').length; document.getElementById('badgeCalidad').textContent = n || ''; } catch (e) { console.warn(e); }
    try { const r = App.pendingDesgloses().length + App.pendingReview().length + (App.entradaPendientes || 0) + (App.docsConflicto ? App.docsConflicto().length : 0); const b = document.getElementById('badgeRevisar'); b.textContent = r || ''; b.style.background = 'var(--warn-bg)'; b.style.color = 'var(--warn)'; } catch (e) { console.warn(e); }
  };

  const showMovs = (title, movs) => App.modal(`<h2>${App.esc(title)}</h2>${App.table([{ label: 'Fecha', get: m => App.fdate(m.fecha) }, { label: 'Cuenta', key: 'cuenta' }, { label: 'Importe', key: 'importe', money: 1 }, { label: 'Saldo', key: 'saldo', money: 1 }, { label: 'Tipo', key: 'tipo' }, { label: 'Área', key: 'area' }, { label: 'Agrup', key: 'agrup' }, { label: 'Activo', key: 'activo' }, { label: 'Concepto', key: 'concepto', wrap: 1 }],
    movs.slice(0, 300).map(m => ({ ...m, _attrs: `data-id="${m.id}" style="cursor:pointer"` })), { maxH: '60vh', color: false })}<p class="small muted">Pulsa un movimiento para editarlo.</p><div class="modal-actions"><button class="btn" data-close>Cerrar</button></div>`,
    (el, close) => el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { close(); App.editMov(tr.dataset.id); }));

  App.views.calidad = (el) => {
    const issues = App.validate();
    const total = issues.reduce((a, i) => a + i.items.reduce((b, x) => b + (x.n || 0), 0), 0);
    el.innerHTML = `<div class="page-head"><h1>Calidad de datos</h1><div class="actions"><button class="btn" id="xls">⬇️ Informe Excel</button></div></div>
      <p class="muted">Revisión automática de incongruencias entre los movimientos y las tablas maestras. Se recalcula cada vez que cambian los datos.</p>
      ${!issues.length ? '<div class="alert info">✔ No se han encontrado incongruencias.</div>' : ''}
      <div class="issue-list">${issues.map((is, k) => `<details ${is.sev === 'alta' && k < 2 ? 'open' : ''}><summary><span class="tag ${SEV[is.sev]}">${is.sev}</span><b>${App.esc(is.title)}</b><span class="muted small">${is.items.length} grupos · ${App.int(is.items.reduce((a, x) => a + (x.n || 0), 0))} registros</span></summary>
        <div class="body"><p class="small">${App.esc(is.explain)}</p>
        ${is.fix === 'borrarDuplicados' ? '<p><button class="btn btn-danger btn-sm" data-dupall>Eliminar todas las copias sobrantes (se conserva una)</button></p>' : ''}
        <div class="table-wrap" style="max-height:380px"><table class="t"><thead><tr><th>Código / grupo</th><th class="num">Nº</th><th class="num">Importe</th><th>Ejemplo / detalle</th><th></th></tr></thead><tbody>
        ${is.items.map((it, j) => `<tr><td>${App.esc(it.code)}${it.maestro ? ` → <b>${App.esc(it.maestro)}</b>` : ''}</td><td class="num">${it.n ?? ''}</td><td class="num">${it.importe != null ? App.num(it.importe) : ''}</td><td class="wrap small">${App.esc((it.ejemplo || '').slice(0, 140))}</td>
          <td class="row" style="flex-wrap:nowrap">${it.movs ? `<button class="btn btn-sm" data-ver="${k}:${j}">Ver</button>` : ''}${fixBtn(is, it, k, j)}</td></tr>`).join('')}
        </tbody></table></div></div></details>`).join('')}</div>`;

    App.$$('[data-ver]').forEach(b => b.onclick = () => { const [k, j] = b.dataset.ver.split(':').map(Number); showMovs(issues[k].title + ' · ' + issues[k].items[j].code, issues[k].items[j].movs); });
    App.$$('[data-fix]').forEach(b => b.onclick = async () => {
      const [k, j] = b.dataset.fix.split(':').map(Number); const is = issues[k], it = is.items[j];
      const after = () => App.render();
      if (is.fix === 'crearAgrup') { const pre = it.code.split(':')[0].toLowerCase(); const sib = App.state.categorias.find(c => c.agrup.toLowerCase().startsWith(pre + ':')); return App.editMaster('categorias', null, after, { agrup: it.code, supra: sib ? sib.categoria.trim() + ' : ' : '', categoria: sib ? sib.categoria.trim() : '', subcategoria: '' }); }
      if (is.fix === 'crearArea') return App.editMaster('areas', null, after, { id: it.code });
      if (is.fix === 'crearTipo') return App.editMaster('tipos', null, after, { id: it.code });
      if (is.fix === 'crearBien') return App.editMaster('bienes', null, after, { id: it.code, nombre: it.code });
      if (is.fix === 'unificarAgrup' || is.fix === 'unificarCuenta') {
        if (!it.maestro) return App.editMaster('cuentas', null, after, { id: it.code, activa: true });
        const field = is.fix === 'unificarAgrup' ? 'agrup' : 'cuenta';
        if (await App.confirm(`¿Cambiar "${it.code}" por "${it.maestro}" en ${it.n} movimientos?`)) { it.movs.forEach(m => m[field] = it.maestro); await App.db.save(); App.toast('Corregido'); after(); }
      }
      if (is.fix === 'borrarDuplicados') { if (await App.confirm(`¿Eliminar ${it.n - 1} copia(s) de este movimiento?`)) { const del = new Set(it.movs.slice(1).map(m => m.id)); App.state.movimientos = App.state.movimientos.filter(m => !del.has(m.id)); await App.db.save(); after(); } }
    });
    const da = App.$('[data-dupall]'); if (da) da.onclick = async () => {
      const is = issues.find(i => i.fix === 'borrarDuplicados'); const del = new Set(is.items.flatMap(it => it.movs.slice(1).map(m => m.id)));
      if (await App.confirm(`¿Eliminar ${del.size} movimientos duplicados?`)) { App.state.movimientos = App.state.movimientos.filter(m => !del.has(m.id)); await App.db.save(); App.render(); }
    };
    App.$('#xls').onclick = () => App.exportXLSX('Incongruencias_' + App.today(), [
      { name: 'Resumen', rows: issues.map(i => ({ Severidad: i.sev, Incidencia: i.title, Grupos: i.items.length, Registros: i.items.reduce((a, x) => a + (x.n || 0), 0), Explicacion: i.explain })) },
      { name: 'Detalle', rows: issues.flatMap(i => i.items.map(it => ({ Incidencia: i.title, Codigo: it.code, Sugerencia: it.maestro || '', N: it.n, Importe: it.importe ?? '', Detalle: it.ejemplo || '' }))) },
      { name: 'Movimientos afectados', rows: issues.flatMap(i => i.items.flatMap(it => (it.movs || []).map(m => ({ Incidencia: i.title, Codigo: it.code, ...App.movsToRows([m])[0] })))) }]);
    App.updateBadge();
  };
  function fixBtn(is, it, k, j) {
    const label = { crearAgrup: 'Crear en maestro', crearArea: 'Crear área', crearTipo: 'Crear tipo', crearBien: 'Crear bien', borrarDuplicados: 'Quitar copias', unificarAgrup: 'Unificar', unificarCuenta: it.maestro ? 'Unificar' : 'Crear cuenta' }[is.fix];
    return label ? `<button class="btn btn-sm" data-fix="${k}:${j}">${label}</button>` : '';
  }
})(window.App);
