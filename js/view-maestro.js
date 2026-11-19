/* Maestro: configuración de áreas, tipos, categorías, bienes, cuentas y préstamos */
(function (App) {
  App.MASTER = {
    areas: { title: 'Áreas de actividad', key: 'id', movField: 'area', fields: [['id', 'IdArea'], ['nombre', 'Nombre'], ['detalle', 'Detalle']] },
    tipos: { title: 'Tipos de movimiento', key: 'id', movField: 'tipo', fields: [['id', 'IdTipo'], ['nombre', 'Tipo movimiento'], ['detalle', 'Detalle']] },
    categorias: { title: 'Categorías y subcategorías', key: 'agrup', movField: 'agrup', fields: [['agrup', 'Agrup (código)'], ['supra', 'SupraCategoría'], ['categoria', 'Categoría'], ['subcategoria', 'SubCategoría']] },
    bienes: { title: 'Bienes / activos', key: 'id', movField: 'activo', fields: [['id', 'IdBien'], ['tipo', 'Tipo de bien', 'list:Inmuebles,Garaje,Rústico,Parcela,Vehículo,Mueble,Inversión,Personas'], ['nombre', 'Nombre'], ['lugar', 'Lugar'], ['parcela', 'Parcela'], ['refCatastral', 'Ref. catastral'], ['valor', 'Valor estimado €', 'number']] },
    cuentas: { title: 'Cuentas bancarias, tarjetas y efectivo', key: 'id', movField: 'cuenta', fields: [['id', 'IdCuenta'], ['banco', 'Banco / entidad'], ['tipo', 'Tipo', 'list:Corriente,Negocio,Inversión,Efectivo,Tarjeta,Ahorro'], ['saldoInicial', 'Saldo inicial €', 'number'], ['fechaSaldoInicial', 'Fecha saldo inicial', 'date'], ['activa', 'Activa', 'bool'], ['compartida', 'Actividad compartida (con otros)', 'bool0'], ['actividad', 'Área de la actividad compartida']] },
    prestamos: { title: 'Préstamos', key: 'id', movField: 'activo', fields: [['id', 'IdPtmo'], ['entidad', 'Entidad'], ['tipo', 'Tipo préstamo'], ['identificador', 'Identificador'], ['formalizacion', 'Formalización', 'date'], ['vencimiento', 'Vencimiento', 'date'], ['importe', 'Importe inicial €', 'number'], ['interes', 'Interés (texto)'], ['diferencial', 'Diferencial'], ['capitalPendiente', 'Capital pendiente €', 'number'], ['fechaCapital', 'Fecha del capital pendiente', 'date'], ['tipoAnual', 'Tipo aplicado % anual', 'number'], ['cuotasPendientes', 'Cuotas pendientes (sin carencia)', 'number'], ['cuota', 'Cuota actual €', 'number'], ['finCarencia', 'Fin de carencia', 'date'], ['bien', 'Activo vinculado (bien)']] },
    reglas: { title: 'Reglas de clasificación', key: 'id', movField: null, fields: [['texto', 'Si el concepto contiene'], ['cuenta', 'Solo en la cuenta (opcional)'], ['signo', 'Signo (+, − o vacío)'], ['tipo', 'Tipo'], ['area', 'Área'], ['agrup', 'Agrup'], ['activo', 'Activo'], ['beneficiario', 'Beneficiario']] },
    plantillas: { title: 'Plantillas de desglose', key: 'id', movField: null, custom: true, fields: [] }
  };

  const input = (k, label, type, v) => {
    if (type === 'bool0') return `<label class="f">${label}<select name="${k}"><option value="0" ${v !== true ? 'selected' : ''}>No</option><option value="1" ${v === true ? 'selected' : ''}>Sí</option></select></label>`;
    if (type === 'bool') return `<label class="f">${label}<select name="${k}"><option value="1" ${v !== false ? 'selected' : ''}>Sí</option><option value="0" ${v === false ? 'selected' : ''}>No</option></select></label>`;
    if (type && type.startsWith('list:')) { const id = 'dl' + k; return `<label class="f">${label}<input name="${k}" value="${App.esc(v ?? '')}" list="${id}"><datalist id="${id}">${type.slice(5).split(',').map(o => `<option value="${o}">`).join('')}</datalist></label>`; }
    return `<label class="f">${label}<input name="${k}" type="${type || 'text'}" ${type === 'number' ? 'step="any"' : ''} value="${App.esc(v ?? '')}"></label>`;
  };

  App.editMaster = (coll, item, after, prefill) => {
    const def = App.MASTER[coll], isNew = !item, it = item || prefill || {};
    const oldKey = it[def.key];
    App.modal(`<h2>${isNew ? 'Nuevo' : 'Editar'} · ${def.title}</h2><form id="mf" class="form-grid">${def.fields.map(([k, l, t]) => input(k, l, t, it[k])).join('')}</form>
      ${!isNew ? `<p class="small muted">Si cambias el código, se actualizarán también los movimientos que lo usan.</p>` : ''}
      <div class="modal-actions">${!isNew ? '<button class="btn btn-danger" id="del">Eliminar</button><span class="spacer"></span>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Guardar</button></div>`, (el, close) => {
      el.querySelector('#ok').onclick = async () => {
        const f = el.querySelector('#mf'); const o = {};
        def.fields.forEach(([k, , t]) => { const v = f[k].value.trim(); o[k] = t === 'number' ? (v === '' ? null : App.parseNum(v)) : (t === 'bool' || t === 'bool0') ? v === '1' : v || (t === 'date' ? null : ''); });
        const autoKey = !def.fields.some(([k]) => k === def.key);
        if (autoKey) o[def.key] = it[def.key] || App.uid('R');
        if (!o[def.key] || (coll === 'reglas' && !o.texto)) return App.toast(coll === 'reglas' ? 'Indica el texto que debe contener el concepto' : 'El código es obligatorio');
        const arr = App.state[coll] = App.state[coll] || [];
        if ((isNew || o[def.key] !== oldKey) && arr.some(x => x[def.key] === o[def.key])) return App.toast('Ya existe ese código');
        if (isNew) arr.push(o); else {
          Object.assign(it, o);
          if (def.movField && oldKey !== o[def.key]) {
            const nuevo = o[def.key], f = def.movField;
            App.state.movimientos.forEach(m => { if (m[f] === oldKey) m[f] = nuevo; });
            // el cambio de código llega también a plantillas, reglas y préstamos vinculados
            (App.state.plantillas || []).forEach(t => {
              [t.cabecera, ...(t.lineas || [])].forEach(l => { if (l && l[f] === oldKey) l[f] = nuevo; });
              if (coll === 'prestamos' && t.prestamo === oldKey) t.prestamo = nuevo;
              if (coll === 'cuentas' && t.match && t.match.cuenta === oldKey) t.match.cuenta = nuevo;
            });
            (App.state.reglas || []).forEach(r => { if (r[f] === oldKey) r[f] = nuevo; if (coll === 'cuentas' && r.cuenta === oldKey) r.cuenta = nuevo; });
            if (coll === 'bienes') App.state.prestamos.forEach(p => { if (p.bien === oldKey) p.bien = nuevo; });
          }
        }
        await App.db.save(); close(); App.toast('Guardado'); (after || App.render)();
      };
      const d = el.querySelector('#del'); if (d) d.onclick = async () => {
        const uses = def.movField ? App.state.movimientos.filter(m => m[def.movField] === oldKey).length : 0; close();
        if (await App.confirm(uses ? `"${oldKey}" se usa en ${uses} movimientos (que quedarán marcados como "sin maestro"). ¿Eliminar igualmente?` : `¿Eliminar "${oldKey}"?`)) {
          App.state[coll] = App.state[coll].filter(x => x !== it); await App.db.save(); (after || App.render)();
        }
      };
    });
  };

  /* ---------- Editor de plantillas de desglose ---------- */
  const ROLES = { prestamo: [['interes', 'Intereses (calculado)'], ['capital', 'Amortización de capital (calculado)']], comision: [['bruto', 'Importe bruto (calculado)'], ['comision', 'Comisión (calculada)']], fijos: [['fijo', 'Importe fijo']] };
  App.editPlantilla = (tpl) => {
    const isNew = !tpl;
    const t = JSON.parse(JSON.stringify(tpl || { id: App.uid('T'), nombre: '', activa: true, desde: App.today(), modo: 'fijos', match: { cuenta: '', texto: '', signo: '-' }, cabecera: { tipo: 'G', area: 'P', agrup: '', activo: '', beneficiario: '' }, lineas: [{ rol: 'fijo', importe: 0, tipo: 'G', area: 'P', agrup: '', activo: '', beneficiario: '', obs: '' }] }));
    const S = App.state;
    const sel = (name, arr, v, lab = x => x.id, val = x => x.id, empty = '—') => `<select data-n="${name}"><option value="">${empty}</option>${arr.map(x => `<option value="${App.esc(val(x))}" ${val(x) === v ? 'selected' : ''}>${App.esc(lab(x))}</option>`).join('')}${v && !arr.some(x => val(x) === v) ? `<option selected>${App.esc(v)}</option>` : ''}</select>`;
    const cats = S.categorias.slice().sort((a, b) => a.supra.localeCompare(b.supra));
    const acts = [...S.bienes, ...S.prestamos];
    const lineRow = (l, i) => `<tr data-i="${i}"><td><select data-l="rol">${ROLES[t.modo].map(([v, lab]) => `<option value="${v}" ${l.rol === v ? 'selected' : ''}>${lab}</option>`).join('')}</select></td>
      <td class="num">${t.modo === 'fijos' ? `<input data-l="importe" type="number" step="0.01" value="${l.importe ?? 0}" style="width:90px;text-align:right">` : "—"}</td>${t.modo === "fijos" ? `<td><input data-l="renovacion" type="date" value="${l.renovacion || ""}" title="Próxima renovación (déjalo vacío si no renueva)"></td>` : ""}
      <td>${sel('', cats, l.agrup, c => c.supra, c => c.agrup).replace('data-n=""', 'data-l="agrup"')}</td><td>${sel('', S.tipos, l.tipo).replace('data-n=""', 'data-l="tipo"')}</td><td>${sel('', S.areas, l.area).replace('data-n=""', 'data-l="area"')}</td>
      <td>${sel('', acts, l.activo).replace('data-n=""', 'data-l="activo"')}</td><td><input data-l="beneficiario" value="${App.esc(l.beneficiario || '')}" style="width:120px"></td><td><input data-l="obs" value="${App.esc(l.obs || '')}" style="width:160px"></td>
      <td>${t.modo === 'fijos' ? `<button class="btn btn-sm btn-danger" data-dl="${i}">✕</button>` : ''}</td></tr>`;
    const render = (el, close) => {
      el.innerHTML = `<h2>${isNew ? 'Nueva' : 'Editar'} plantilla de desglose</h2>
        <div class="form-grid">
          <label class="f" style="grid-column:span 2">Nombre<input data-n="nombre" value="${App.esc(t.nombre)}"></label>
          <label class="f">Tipo de reparto<select data-n="modo">${[['prestamo', 'Cuota de préstamo (interés + capital)'], ['comision', 'Cobro neto con comisión %'], ['fijos', 'Importes fijos (seguros, recibos agrupados)']].map(([v, l]) => `<option value="${v}" ${t.modo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="f">Activa<select data-n="activa"><option value="1" ${t.activa !== false ? 'selected' : ''}>Sí</option><option value="0" ${t.activa === false ? 'selected' : ''}>No</option></select></label>
          <label class="f" style="grid-column:span 2">El concepto contiene (alternativas separadas por |)<input data-n="match.texto" value="${App.esc(t.match.texto)}"></label>
          <label class="f">Cuenta (opcional)${sel('match.cuenta', S.cuentas, t.match.cuenta, c => c.id, c => c.id, 'Cualquiera')}</label>
          <label class="f">Signo<select data-n="match.signo">${[['-', 'Cargo (−)'], ['+', 'Abono (+)'], ['', 'Cualquiera']].map(([v, l]) => `<option value="${v}" ${t.match.signo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="f">Aplicar a cargos desde<input type="date" data-n="desde" value="${t.desde || ''}"></label>
          ${t.modo === 'prestamo' ? `<label class="f">Préstamo${sel('prestamo', S.prestamos, t.prestamo)}</label>` : ''}
          ${t.modo === 'comision' ? `<label class="f">Comisión % sobre el bruto<input type="number" step="0.01" data-n="comisionPct" value="${t.comisionPct ?? ''}"></label>` : ''}
        </div>
        <h3 class="mt">Clasificación del cargo original (Estado AR)</h3>
        <div class="form-grid"><label class="f" style="grid-column:span 2">Categoría${sel('cabecera.agrup', cats, t.cabecera.agrup, c => c.supra, c => c.agrup)}</label><label class="f">Tipo${sel('cabecera.tipo', S.tipos, t.cabecera.tipo)}</label><label class="f">Área${sel('cabecera.area', S.areas, t.cabecera.area)}</label><label class="f">Activo${sel('cabecera.activo', acts, t.cabecera.activo)}</label><label class="f">Beneficiario<input data-n="cabecera.beneficiario" value="${App.esc(t.cabecera.beneficiario || '')}"></label></div>
        <h3 class="mt">Partidas del desglose</h3>
        <div class="table-wrap"><table class="t"><thead><tr><th>Cálculo</th><th class="num">Importe</th>${t.modo === "fijos" ? "<th>Próxima renovación</th>" : ""}<th>Categoría</th><th>Tipo</th><th>Área</th><th>Activo</th><th>Beneficiario</th><th>Observación</th><th></th></tr></thead><tbody>${t.lineas.map(lineRow).join('')}</tbody></table></div>
        ${t.modo === 'fijos' ? '<button class="btn btn-sm mt" id="addL">＋ Partida</button><p class="small muted">Los importes se actualizan solos cada vez que corriges un desglose de esta plantilla.</p>' : ''}
        <div class="modal-actions">${!isNew ? '<button class="btn btn-danger" id="delT">Eliminar</button>' : ''}<span class="spacer"></span><button class="btn" id="cancelT">Cancelar</button><button class="btn btn-primary" id="okT">Guardar</button></div>`;
      const read = () => {
        el.querySelectorAll('[data-n]').forEach(i => { const path = i.dataset.n.split('.'); let o = t; while (path.length > 1) o = o[path.shift()]; const k = path[0]; o[k] = k === 'activa' ? i.value === '1' : k === 'comisionPct' ? App.parseNum(i.value) : i.value; });
        el.querySelectorAll('tbody tr[data-i]').forEach(tr => tr.querySelectorAll('[data-l]').forEach(i => { t.lineas[+tr.dataset.i][i.dataset.l] = i.dataset.l === 'importe' ? App.parseNum(i.value) || 0 : i.value; }));
      };
      el.querySelector('[data-n=modo]').onchange = () => { read(); t.lineas = ROLES[t.modo].map(([rol]) => ({ rol, importe: 0, tipo: t.cabecera.tipo, area: t.cabecera.area, agrup: '', activo: '', beneficiario: '', obs: '' })); render(el, close); };
      const add = el.querySelector('#addL'); if (add) add.onclick = () => { read(); t.lineas.push({ rol: 'fijo', importe: 0, tipo: 'G', area: t.cabecera.area, agrup: '', activo: '', beneficiario: '', obs: '' }); render(el, close); };
      el.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => { read(); t.lineas.splice(+b.dataset.dl, 1); render(el, close); });
      el.querySelector('#cancelT').onclick = close;
      el.querySelector('#okT').onclick = async () => {
        read();
        if (!t.nombre || !t.match.texto) return App.toast('Indica el nombre y el texto que identifica el cargo');
        if (t.lineas.some(l => !l.agrup)) return App.toast('Indica la categoría de todas las partidas');
        if (t.modo === 'prestamo' && !t.prestamo) return App.toast('Elige el préstamo');
        const arr = App.state.plantillas; const i = arr.findIndex(x => x.id === t.id); if (i >= 0) arr[i] = t; else arr.push(t);
        await App.db.save(); close(); App.updateBadge(); App.toast('Plantilla guardada'); App.render();
      };
      const del = el.querySelector('#delT'); if (del) del.onclick = async () => { close(); if (await App.confirm(`¿Eliminar la plantilla "${t.nombre}"? Los desgloses ya hechos no se tocan.`)) { App.state.plantillas = App.state.plantillas.filter(x => x.id !== t.id); await App.db.save(); App.render(); } };
    };
    App.modal('', (el, close) => { el.parentElement.classList.add('wide'); render(el, close); });
  };

  App.views.maestro = (el, p) => {
    const coll = p.t || 'categorias'; const def = App.MASTER[coll];
    const tabs = `<div class="tabs">${Object.entries(App.MASTER).map(([k, d]) => `<button data-t="${k}" class="${k === coll ? 'active' : ''}">${{ cuentas: 'Cuentas', plantillas: 'Plantillas', reglas: 'Reglas' }[k] || d.title.split(/[ ,]/)[0]} <span class="muted small">${(App.state[k] || []).length}</span></button>`).join('')}</div>`;
    if (def.custom) {
      const T = App.state.plantillas || [];
      const pend = App.pendingDesgloses();
      el.innerHTML = `<div class="page-head"><h1>Maestro</h1><div class="actions"><button class="btn btn-primary" id="nuevo">＋ Nueva plantilla</button></div></div>${tabs}
        <p class="muted small">Una plantilla reconoce un cargo por su concepto y lo reparte en partidas, igual que tus hojas de Desglose: el cargo queda en Estado AR, se añade un apunte AR que lo anula y las partidas en Estado R. Se aplica sola al importar los extractos.</p>
        ${App.table([{ label: 'Plantilla', key: 'nombre' }, { label: 'Reparto', get: t => ({ prestamo: 'Préstamo: ' + (t.prestamo || ''), comision: 'Comisión ' + App.num(t.comisionPct) + ' %', fijos: 'Importes fijos' })[t.modo] },
          { label: 'Reconoce', get: t => t.match.texto }, { label: 'Partidas', get: t => t.lineas.map(l => (App.subName(l.agrup) || l.agrup) + (t.modo === 'fijos' ? ' ' + App.num(l.importe) + (l.renovacion ? ' (renueva ' + App.fdate(l.renovacion) + ')' : '') : '') + (l.activo ? ' · ' + l.activo : '')).join(' | ') },
          { label: 'Desde', get: t => App.fdate(t.desde) }, { label: 'Activa', get: t => t.activa === false ? 'No' : 'Sí' }, { label: 'Pendientes', get: t => pend.filter(x => x.tpl.id === t.id).length, num: 1 }],
          T.map(t => ({ ...t, _attrs: `data-k="${t.id}" style="cursor:pointer"` })), { color: false })}`;
      App.$$('.tabs button', el).forEach(b => b.onclick = () => App.go('maestro?t=' + b.dataset.t));
      App.$('#nuevo').onclick = () => App.editPlantilla(null);
      App.$$('tr[data-k]').forEach(tr => tr.onclick = () => App.editPlantilla(T.find(t => t.id === tr.dataset.k)));
      return;
    }
    const uses = {}; if (def.movField) App.state.movimientos.forEach(m => { const v = m[def.movField]; if (v) uses[v] = (uses[v] || 0) + 1; });
    const q = App.norm(p.q || '');
    const rows = (App.state[coll] || []).filter(x => !q || App.norm(Object.values(x).join(' ')).includes(q));
    el.innerHTML = `<div class="page-head"><h1>Maestro</h1><div class="actions"><button class="btn btn-primary" id="nuevo">＋ Añadir</button><button class="btn" id="xls">⬇️ Exportar maestro a Excel</button></div></div>
      ${tabs}
      <div class="row" style="margin-bottom:10px"><h2 style="margin:0">${def.title}</h2><span class="spacer"></span><input id="q" placeholder="Buscar…" value="${App.esc(p.q || '')}"></div>
      ${coll === 'reglas' ? '<p class="small muted">Las reglas se crean solas al confirmar movimientos en Revisar (o al marcar "Crear regla" al editar uno). Tienen prioridad sobre la similitud con el histórico; si varias coinciden, gana la de texto más largo.</p>' : ''}
      ${App.table([...def.fields.filter(([, , t]) => (t !== 'bool' && t !== 'bool0') || coll === 'cuentas').map(([k, l, t]) => ({ label: l, get: r => t === 'date' ? App.fdate(r[k]) : t === 'bool' ? (r[k] === false ? 'No' : 'Sí') : t === 'bool0' ? (r[k] === true ? 'Sí' : '') : r[k], money: t === 'number' && k !== 'cuotasPendientes' && k !== 'tipoAnual', num: t === 'number' })),
        ...(def.movField ? [{ label: 'Usos', get: r => uses[r[def.key]] || 0, num: 1 }] : [])],
        rows.map(r => ({ ...r, _attrs: `data-k="${App.esc(r[def.key])}" style="cursor:pointer"` })), { maxH: '70vh', color: false })}
      ${coll === 'prestamos' ? '<p class="small muted">Para la proyección se usan: capital pendiente, fecha del capital, tipo aplicado, cuotas pendientes y, si existe, fin de carencia (meses en los que solo se pagan intereses).</p>' : ''}
      ${coll === 'cuentas' ? '<p class="small muted">El grupo se deduce del Tipo: "Tarjeta" = deuda de tarjetas, "Inversión" = inversión, "Efectivo" y el resto = saldo disponible. Una cuenta con <b>Actividad compartida: Sí</b> (p. ej. la del olivar con tus hermanos) queda fuera de tu economía: sus movimientos del área de la actividad se ven en <i>Actividad compartida</i>; los de otra área son tuyos.</p>' : ''}`;
    App.$$('.tabs button', el).forEach(b => b.onclick = () => App.go('maestro?t=' + b.dataset.t));
    App.$('#q').onchange = (e) => App.go(`maestro?t=${coll}&q=${encodeURIComponent(e.target.value)}`);
    App.$('#nuevo').onclick = () => App.editMaster(coll, null);
    App.$$('tr[data-k]').forEach(tr => tr.onclick = () => App.editMaster(coll, App.state[coll].find(x => String(x[def.key]) === tr.dataset.k)));
    App.$('#xls').onclick = () => App.exportXLSX('Maestro_MiEconomia', Object.entries(App.MASTER).filter(([, d]) => !d.custom).map(([k, d]) => ({ name: d.title.split(' ')[0], money: false, rows: (App.state[k] || []).map(x => Object.fromEntries(d.fields.map(([f, l]) => [l, x[f] ?? '']))) })));
  };
})(window.App);
