/* Bandeja de revisión: desgloses pendientes y movimientos por clasificar */
(function (App) {
  const catOpts = (sel) => App.state.categorias.slice().sort((a, b) => a.supra.localeCompare(b.supra)).map(c => `<option value="${App.esc(c.agrup)}" ${c.agrup === sel ? 'selected' : ''}>${App.esc(c.supra)}</option>`).join('') + (sel && !App.idx.cat[sel] ? `<option selected>${App.esc(sel)}</option>` : '');
  const idOpts = (arr, sel, empty) => (empty != null ? `<option value="">${empty}</option>` : '') + arr.map(x => `<option value="${App.esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${App.esc(x.id)}</option>`).join('') + (sel && !arr.some(x => x.id === sel) ? `<option selected>${App.esc(sel)}</option>` : '');
  const activos = () => [...App.state.bienes, ...App.state.prestamos];

  /* ---------- Editor de desglose (para un cargo concreto) ---------- */
  App.openDesglose = (m, tplId, after) => {
    const tpls = (App.state.plantillas || []).filter(t => t.activa !== false);
    let tpl = tpls.find(t => t.id === tplId) || App.matchTemplate(m) || null;
    let opts = {};
    let lineas = [];
    let res = null;
    const recompute = () => {
      if (tpl) { res = App.computeDesglose(m, tpl, opts); lineas = res.lineas.map(l => ({ ...l })); }
      else { res = { avisos: ['Desglose manual: añade las partidas.'], dudoso: false }; if (!lineas.length) lineas = [{ agrup: '', tipo: m.importe < 0 ? 'G' : 'I', area: m.area || 'P', activo: '', beneficiario: '', importe: m.importe, obs: '' }]; }
    };
    recompute();
    const p = tpl?.modo === 'prestamo' ? App.idx.ptmo[tpl.prestamo] : null;
    const render = (el) => {
      const suma = App.round2(lineas.reduce((a, l) => a + (+l.importe || 0), 0)), dif = App.round2(m.importe - suma);
      el.innerHTML = `<h2>Desglosar cargo</h2>
        <p class="small"><b>${App.fdate(m.fecha)} · ${App.esc(m.cuenta)} · ${App.eur(m.importe)}</b><br><span class="muted">${App.esc(m.concepto)}</span></p>
        <div class="form-grid"><label class="f">Plantilla<select id="dTpl"><option value="">Manual (sin plantilla)</option>${tpls.map(t => `<option value="${t.id}" ${tpl && t.id === tpl.id ? 'selected' : ''}>${App.esc(t.nombre)}</option>`).join('')}</select></label>
        ${tpl?.modo === 'prestamo' ? `<label class="f">Capital pendiente antes de la cuota<input id="dCap" type="number" step="0.01" value="${opts.capital ?? p?.capitalPendiente ?? ''}"></label><label class="f">Tipo de interés % anual<input id="dTipo" type="number" step="0.001" value="${opts.tipo ?? p?.tipoAnual ?? ''}"></label>` : ''}
        ${tpl?.modo === 'comision' ? `<label class="f">Comisión % sobre la renta<input id="dCom" type="number" step="0.01" value="${opts.comisionPct ?? tpl.comisionPct}"></label>` : ''}</div>
        ${res.avisos.map(a => `<div class="alert ${res.dudoso ? 'warn' : 'info'} mt small">${App.esc(a)}</div>`).join('')}
        <div class="table-wrap mt"><table class="t"><thead><tr><th>Categoría</th><th class="num">Importe</th><th>Activo</th><th>Tipo</th><th>Área</th><th>Observación</th><th></th></tr></thead><tbody>
        ${lineas.map((l, i) => `<tr data-i="${i}"><td><select data-k="agrup" style="max-width:230px"><option value="">—</option>${catOpts(l.agrup)}</select></td><td class="num"><input data-k="importe" type="number" step="0.01" value="${l.importe}" style="width:100px;text-align:right"></td><td><select data-k="activo">${idOpts(activos(), l.activo, "—")}</select></td><td><select data-k="tipo">${idOpts(App.state.tipos, l.tipo)}</select></td><td><select data-k="area">${idOpts(App.state.areas, l.area)}</select></td>          <td><input data-k="obs" value="${App.esc(l.obs || '')}" style="min-width:160px"></td><td>${!tpl || tpl.modo === 'fijos' ? '' : ''}<button class="btn btn-sm btn-danger" data-del="${i}" ${tpl && tpl.modo !== 'fijos' ? 'disabled' : ''}>✕</button></td></tr>`).join('')}
        <tr class="total"><td colspan="4">Suma de partidas ${!tpl ? '<button class="btn btn-sm" id="dAdd">＋ partida</button>' : ''}</td><td class="num">${App.num(suma)}</td><td colspan="2" class="${Math.abs(dif) > 0.005 ? 'neg' : 'pos'}">${Math.abs(dif) > 0.005 ? 'Faltan ' + App.num(dif) : '✔ Cuadra con el cargo'}</td></tr></tbody></table></div>
        ${tpl?.modo === 'fijos' ? '<label class="row small mt"><input type="checkbox" id="dLearn" checked> Guardar estos importes en la plantilla para los próximos meses</label>' : ''}
        <div class="modal-actions"><button class="btn" data-close>Cancelar</button><button class="btn btn-primary" id="dOk" ${Math.abs(dif) > 0.005 ? 'disabled' : ''}>Aplicar desglose</button></div>`;
      el.querySelector('#dTpl').onchange = (e) => { tpl = tpls.find(t => t.id === e.target.value) || null; opts = {}; lineas = []; recompute(); render(el); bind(el); };
      const num = (id, k) => { const i = el.querySelector(id); if (i) i.onchange = () => { opts[k] = App.parseNum(i.value); recompute(); render(el); bind(el); }; };
      num('#dCap', 'capital'); num('#dTipo', 'tipo'); num('#dCom', 'comisionPct');
    };
    let closeFn;
    const bind = (el) => {
      el.querySelectorAll('tbody tr[data-i]').forEach(tr => tr.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
        const l = lineas[+tr.dataset.i]; l[inp.dataset.k] = inp.dataset.k === 'importe' ? App.parseNum(inp.value) || 0 : inp.value;
        if (inp.dataset.k === 'importe' && tpl?.modo === 'fijos') { opts.importes = lineas.map(x => Math.abs(+x.importe || 0)); const keep = lineas.map(x => ({ ...x })); recompute(); lineas = lineas.map((x, i) => ({ ...x, ...keep[i], importe: x.importe })); }
        render(el); bind(el);
      }));
      el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { lineas.splice(+b.dataset.del, 1); render(el); bind(el); });
      const add = el.querySelector('#dAdd'); if (add) add.onclick = () => { const s = lineas.reduce((a, l) => a + (+l.importe || 0), 0); lineas.push({ agrup: '', tipo: 'G', area: m.area || 'P', activo: '', beneficiario: '', importe: App.round2(m.importe - s), obs: '' }); render(el); bind(el); };
      el.querySelectorAll('[data-close]').forEach(b => b.onclick = closeFn);
      el.querySelector('#dOk').onclick = async () => {
        if (lineas.some(l => !l.agrup)) return App.toast('Indica la categoría de todas las partidas');
        await App.applyDesglose(m, lineas, { tpl, prestamoNuevo: res?.prestamoNuevo, aprender: el.querySelector('#dLearn')?.checked, comisionPct: opts.comisionPct });
        closeFn(); App.toast('Desglose aplicado'); App.updateBadge(); (after || App.render)();
      };
    };
    App.modal('', (el, close) => { closeFn = close; el.parentElement.classList.add('wide'); render(el); bind(el); });
  };

  /* ---------- Vista ---------- */
  App.views.revisar = (el) => {
    const pend = App.pendingDesgloses();
    const prev = pend.map(x => ({ ...x, r: App.computeDesglose(x.m, x.tpl) }));
    const okN = prev.filter(x => !x.r.dudoso).length;
    const rev = App.pendingReview().slice().sort((a, b) => a.fecha < b.fecha ? 1 : -1);
    const LIMIT = 150;
    el.innerHTML = `<div class="page-head"><h1>Revisar</h1><div class="actions"><a class="btn" href="#/maestro?t=plantillas">⚙️ Plantillas</a><a class="btn" href="#/maestro?t=reglas">⚙️ Reglas (${(App.state.reglas || []).length})</a></div></div>
      <p class="muted">Aquí solo aparece lo que la app no ha podido resolver sola. Cuando esta página está vacía, tus cuentas están al día.</p>
      ${App.entradaPendientes ? `<div class="alert warn" style="margin-bottom:16px">📥 Hay <b>${App.entradaPendientes}</b> archivo(s) en la carpeta Entrada de Drive sin procesar (o dejados para revisión por nombre repetido). <a href="#/captura?tab=entrada">Revisarlos ahora</a></div>` : ''}
      ${(() => { const cf = App.docsConflicto ? App.docsConflicto() : []; return cf.length ? `<div class="card" style="margin-bottom:16px"><h2>📎 Documentos con nombre repetido <span class="muted small">${cf.length}</span></h2>
        <p class="small muted">Corregiste estos movimientos, pero el nombre que les tocaría a sus PDF ya lo tiene otro documento. Escribe un nombre distinto o mantén el actual.</p>
        <div class="table-wrap"><table class="t"><thead><tr><th>Movimiento</th><th>Nombre actual</th><th>Nombre nuevo</th><th></th></tr></thead><tbody>
        ${cf.map(({ m, d }, i) => `<tr data-cf="${i}"><td class="small">${App.fdate(m.fecha)} · ${App.esc(m.cuenta)} · ${App.num(m.importe)}</td><td class="small wrap">${d.url ? `<a href="${App.esc(d.url)}" target="_blank" rel="noopener">${App.esc(d.name)}</a>` : App.esc(d.name)}</td>
          <td><input value="${App.esc(d.conflicto)}" style="width:100%;min-width:260px;font-size:.8rem"></td>
          <td class="row" style="flex-wrap:nowrap"><button class="btn btn-sm btn-primary" data-ren>Renombrar</button><button class="btn btn-sm" data-keep>Mantener actual</button></td></tr>`).join('')}
        </tbody></table></div></div>` : ''; })()}
      ${(() => { const rn = App.proximasRenovaciones(45); return rn.length ? `<div class="alert info mt" style="margin-bottom:16px"><b>📅 Renovaciones de pólizas próximas</b><ul style="margin:6px 0 0;padding-left:18px">${rn.map(x => `<li>${App.fdate(x.fecha)} · ${App.esc(x.linea.obs || x.linea.activo)} (${App.esc(x.tpl.nombre)}) · importe actual ${App.eur(x.linea.importe)}${x.vencida ? ' · <i>se aplicará con el próximo cargo</i>' : ''}</li>`).join('')}</ul>
        <span class="small">Si el cargo de ese mes cambia, la diferencia se asigna sola a esa póliza. Puedes cambiar las fechas en Maestro › Plantillas.</span></div>` : ''; })()}
      <div class="card"><div class="row"><h2 style="margin:0">⇉ Desgloses pendientes <span class="muted small">${pend.length}</span></h2><span class="spacer"></span>${okN ? `<button class="btn btn-primary" id="autoAll">Aplicar los ${okN} que cuadran</button>` : ''}</div>
        ${pend.length ? `<div class="table-wrap mt"><table class="t"><thead><tr><th>Fecha</th><th>Cuenta</th><th class="num">Importe</th><th>Plantilla</th><th>Resultado</th><th></th></tr></thead><tbody>
        ${prev.map((x, i) => `<tr class="${x.r.dudoso ? 'row-warn' : 'row-ok'}"><td>${App.fdate(x.m.fecha)}</td><td>${App.esc(x.m.cuenta)}</td><td class="num">${App.num(x.m.importe)}</td><td>${App.esc(x.tpl.nombre)}</td>
          <td class="wrap small" style="min-width:200px;max-width:300px">${x.r.lineas.map(l => `${App.esc(App.subName(l.agrup) || l.agrup)} ${App.num(l.importe)}`).join(' · ')}${x.r.dudoso ? `<br><span class="neg">${App.esc(x.r.avisos[0] || '')}</span>` : ''}</td>
          <td class="row" style="flex-wrap:nowrap">${!x.r.dudoso ? `<button class="btn btn-sm btn-primary" data-ap="${i}">Aplicar</button>` : ''}<button class="btn btn-sm" data-ed="${i}">${x.r.dudoso ? 'Revisar' : 'Editar'}</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted small">✔ No hay cargos pendientes de desglosar.</p>'}</div>
      <div class="card mt"><div class="row"><h2 style="margin:0">🏷️ Movimientos por clasificar <span class="muted small">${rev.length}</span></h2><span class="spacer"></span>
        ${rev.length ? `<label class="row small"><input type="checkbox" id="mkRule" checked> Crear regla al confirmar</label><button class="btn" id="okAll">Confirmar todos con la sugerencia</button>` : ''}</div>
        ${rev.length ? `<p class="small muted">Corrige lo que haga falta y pulsa ✓. Con "Crear regla", la próxima vez un concepto igual se clasificará solo.</p>
        <div class="table-wrap mt" style="max-height:65vh"><table class="t"><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Importe</th><th>Categoría</th><th>Tipo</th><th>Área</th><th>Activo</th><th>Regla: si contiene…</th><th></th></tr></thead><tbody>
        ${rev.slice(0, LIMIT).map(m => `<tr data-id="${m.id}"><td>${App.fdate(m.fecha)}<br><span class="muted small">${App.esc(m.cuenta)}</span></td><td class="wrap small" style="min-width:180px;max-width:260px">${App.esc(m.concepto)}</td><td class="num ${App.cls(m.importe)}">${App.num(m.importe)}</td>
          <td><select data-k="agrup" style="max-width:220px"><option value="">—</option>${catOpts(m.agrup)}</select></td><td><select data-k="tipo">${idOpts(App.state.tipos, m.tipo)}</select></td><td><select data-k="area">${idOpts(App.state.areas, m.area)}</select></td>
          <td><select data-k="activo" style="max-width:130px">${idOpts(activos(), m.activo, '—')}</select></td><td><input data-k="regla" value="${App.esc(App.ruleKey(m.concepto))}" style="width:170px"></td>
          <td class="row" style="flex-wrap:nowrap"><button class="btn btn-sm btn-primary" data-ok>✓</button><button class="btn btn-sm" data-split title="Desglosar en varias partidas">⇉</button></td></tr>`).join('')}
        </tbody></table></div>${rev.length > LIMIT ? `<p class="small muted">Se muestran ${LIMIT} de ${rev.length}.</p>` : ''}` : '<p class="muted small">✔ No hay movimientos pendientes de clasificar.</p>'}</div>`;

    const refresh = () => { App.updateBadge(); App.render(); };
    // Documentos con nombre repetido tras corregir un movimiento
    const cfs = App.docsConflicto ? App.docsConflicto() : [];
    App.$$('tr[data-cf]').forEach(tr => {
      const { d } = cfs[+tr.dataset.cf];
      tr.querySelector('[data-keep]').onclick = async () => { d.manual = true; delete d.conflicto; await App.db.save({ noRename: true }); refresh(); };
      tr.querySelector('[data-ren]').onclick = async () => {
        const nuevo = tr.querySelector('input').value.trim(); if (!nuevo) return;
        const usado = App.state.movimientos.some(m => App.docsOf(m).some(x => x !== d && x.name && x.name.toLowerCase() === nuevo.toLowerCase()));
        if (usado) return App.toast('Ese nombre también lo tiene otro documento');
        try { const r = await App.drive.rename(d.id, nuevo); d.name = r.name || nuevo; d.manual = true; delete d.conflicto; await App.db.save({ noRename: true }); App.toast('Documento renombrado'); refresh(); }
        catch (e) { App.toast('No se pudo renombrar en Drive: ' + e.message, 5000); }
      };
    });
    App.$$('[data-ap]').forEach(b => b.onclick = async () => { const x = prev[+b.dataset.ap]; const r = App.computeDesglose(x.m, x.tpl); if (r.dudoso) return App.openDesglose(x.m, x.tpl.id, refresh); await App.applyDesglose(x.m, r.lineas, { tpl: x.tpl, prestamoNuevo: r.prestamoNuevo }); App.toast('Desglose aplicado'); refresh(); });
    App.$$('[data-ed]').forEach(b => b.onclick = () => { const x = prev[+b.dataset.ed]; App.openDesglose(x.m, x.tpl.id, refresh); });
    const aa = App.$('#autoAll'); if (aa) aa.onclick = async () => { const n = await App.autoDesglosar(); App.toast(`${n} desgloses aplicados`); refresh(); };
    const confirmRow = async (tr, save = true) => {
      const m = App.state.movimientos.find(x => x.id === tr.dataset.id); if (!m) return false;
      tr.querySelectorAll('select[data-k]').forEach(s => m[s.dataset.k] = s.value);
      if (!m.agrup) { App.toast('Elige la categoría'); return false; }
      m.estado = 'R'; m.auto = 'revisado';
      if (App.$('#mkRule')?.checked) await App.saveRule(tr.querySelector('[data-k=regla]').value, m);
      if (save) await App.db.save();
      return true;
    };
    App.$$('tr[data-id] [data-ok]').forEach(b => b.onclick = async () => { const tr = b.closest('tr'); if (await confirmRow(tr)) { tr.remove(); App.updateBadge(); } });
    App.$$('tr[data-id] [data-split]').forEach(b => b.onclick = () => { const m = App.state.movimientos.find(x => x.id === b.closest('tr').dataset.id); App.openDesglose(m, null, refresh); });
    const oa = App.$('#okAll'); if (oa) oa.onclick = async () => {
      const trs = App.$$('tr[data-id]').filter(tr => tr.querySelector('[data-k=agrup]').value);
      if (!(await App.confirm(`¿Confirmar ${trs.length} movimientos con la categoría que muestran? (los que no tienen categoría se quedan pendientes)`))) return;
      for (const tr of trs) await confirmRow(tr, false);
      await App.db.save(); App.toast(`${trs.length} movimientos confirmados`); refresh();
    };
  };
})(window.App);
