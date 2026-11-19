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

  /* ---------- Sustitución de códigos (propuesta automática + aplicar) ---------- */
  const SUST = {
    'agrup-desconocida': { campo: 'agrup', opciones: () => App.state.categorias.map(c => [c.agrup, c.supra]) },
    'agrup-mayusculas': { campo: 'agrup', opciones: () => App.state.categorias.map(c => [c.agrup, c.supra]) },
    'cuenta-desconocida': { campo: 'cuenta', opciones: () => App.state.cuentas.map(c => [c.id, `${c.id} · ${c.banco || c.tipo}`]) },
    'area-desconocida': { campo: 'area', opciones: () => App.state.areas.map(a => [a.id, `${a.id} · ${a.nombre}`]) },
    'tipo-desconocido': { campo: 'tipo', opciones: () => App.state.tipos.map(t => [t.id, `${t.id} · ${t.nombre}`]) },
    'activo-desconocido': { campo: 'activo', vaciar: true, opciones: () => [...App.state.bienes.map(b => [b.id, `${b.id} · ${b.nombre}`]), ...App.state.prestamos.map(p => [p.id, `${p.id} · préstamo`])] }
  };
  // equivalencias evidentes entre códigos de categoría (solo se proponen si el destino existe en tu maestro)
  const EQUIV_AGRUP = { 'ali:rte': 'Ali:Res', 'don:comu': 'Don:Com', 'aut:comb': 'Aut:Com', 'aut:mto': 'Aut:Mtto', 'via:bil': 'Via:Bill', 'imp:veh': 'Imp:Cir',
    'bco:com': 'Ban:Com', 'bco:comi': 'Ban:Com', 'oing:dist': 'OIn:Dist', 'oing:liq': 'Oin:Liq', 'oin:vta': 'OIn:Vviv', 'var:var': 'Var:Var' };
  const nz = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  App.sugerirCodigo = (issueId, code) => {
    const cfg = SUST[issueId]; if (!cfg) return '';
    const ops = cfg.opciones().map(o => o[0]), lc = String(code || '').toLowerCase();
    const exact = ops.find(o => o.toLowerCase() === lc); if (exact && exact !== code) return exact;
    if (cfg.campo === 'agrup') {
      const eq = EQUIV_AGRUP[lc]; if (eq) { const t = ops.find(o => o.toLowerCase() === eq.toLowerCase()); if (t) return t; }
      const [p, s] = lc.split(':'); if (!s) return '';
      const c = ops.filter(o => { const [op, os] = o.toLowerCase().split(':'); return op === p && os && os.trim().length >= 3 && s.length >= 3 && (os.startsWith(s) || s.startsWith(os.trim())); });
      return c.length === 1 ? c[0] : '';
    }
    if (cfg.campo === 'cuenta') { const c = ops.filter(o => o.toLowerCase().startsWith(lc + '_') || lc.startsWith(o.toLowerCase() + '_')); return c.length === 1 ? c[0] : ''; }
    if (cfg.campo === 'activo') {
      const n = nz(code), dig = (n.match(/\d/g) || []);
      const bienes = [...App.state.bienes.map(b => ({ id: b.id, nombre: b.nombre })), ...App.state.prestamos.map(p => ({ id: p.id, nombre: '' }))];
      let c = bienes.filter(b => nz(b.id).length >= 4 && n.includes(nz(b.id)));                                    // BMW_X4_6670JXV → 6670JXV
      if (!c.length) c = bienes.filter(b => nz(b.id).length >= 3 && n.startsWith(nz(b.id)));                        // EPBCur → EPB
      if (!c.length) c = bienes.filter(b => b.nombre && nz(b.nombre).split(/\s+/)[0] && String(b.nombre).toLowerCase().split(/[^a-z0-9áéíóúñ]+/i).some(w => w.length >= 5 && nz(w).startsWith(n.slice(0, 5)) && n.length >= 5)); // Range → Ford Ranger
      if (!c.length) c = bienes.filter(b => b.nombre && nz(b.nombre).slice(0, 4) === n.slice(0, 4) && n.length >= 4 && (!dig.length || dig.some(d => nz(b.nombre + b.id).includes(d)))); // Francos 6 1ºIzq → Francos_6
      return c.length === 1 ? c[0].id : '';
    }
    return '';
  };
  // nombres propuestos al crear una categoría nueva a partir de su código
  const PREF = { fer: 'Fertilizantes', rie: 'Riego', rec: 'Recolección', her: 'Herbicidas', ing: 'Ingresos agrícolas', serv: 'Servicios', var: 'Varios', hip: 'Hipoteca', tra: 'Transferencia', fra: 'Facturas', seg: 'Seguro', bie: 'Bienes', cap: 'Capital', rep: 'Reparto', oin: 'Otros ingresos', oing: 'Otros ingresos', imp: 'Impuestos', sal: 'Salud', bco: 'Bancos', inv: 'Inversión', ptm: 'Préstamo', aut: 'Automóvil', abo: 'Abono' };
  const SUBN = { sum: 'Suministros', lab: 'Labor', liq: 'Liquidación', sub: 'Subvención', cdto: 'Crédito', cap: 'Capital', cuo: 'Cuota', int: 'Intereses', aut: 'Automóvil', var: 'Varios', fis: 'Fisioterapia', gim: 'Gimnasio', vad: 'Vado', prev: 'Prevención', reg: 'Registro', com: 'Comisión', comi: 'Comisión', pro: 'Profesionales', comu: 'Comunidad', tcbbv: 'Tarjeta BBVA', vta: 'Venta', dist: 'Distribución', ret: 'Retenciones', ss: 'Seguridad Social', mov: 'Móvil', apg: 'APG', epg: 'EPG' };
  const propuestaCategoria = (code) => {
    const [p, s] = code.split(':'), lp = (p || '').toLowerCase();
    const sib = App.state.categorias.find(c => c.agrup.toLowerCase().startsWith(lp + ':'));
    const cat = sib ? sib.categoria.trim() : (PREF[lp] || p), sub = s ? (SUBN[s.toLowerCase()] || s) : '';
    return { agrup: code, categoria: cat, subcategoria: sub, supra: sub ? `${cat} : ${sub}` : cat };
  };

  /* Actividad compartida: convierte un traspaso con tus cuentas en reparto/aportación (ingreso o gasto en cada lado) */
  const asegurarCat = (agrup, categoria, subcategoria) => { if (!App.catOf(agrup)) App.state.categorias.push({ agrup, categoria, subcategoria, supra: `${categoria} : ${subcategoria}` }); };
  App.corregirActividad = (it) => {
    const socio = (App.state.settings.socioPropio || 'Yo').trim();
    const area = (m) => App.actividadDe(m.cuenta), nomArea = (a) => App.idx.area[a]?.nombre || a;
    it.movs.forEach(m => {
      const entra = (+m.importe) > 0;
      if (App.esCompartido(m)) {          // lado de la actividad: a ti → reparto (gasto); de ti → aportación de socio (ingreso)
        m.tipo = entra ? 'I' : 'G'; m.agrup = entra ? `Aps:${socio}` : `Rep:${socio}`;
        asegurarCat(m.agrup, entra ? 'Aportación socio' : 'Reparto', socio);
      } else {                            // tu lado: de la actividad → ingreso; a la actividad → gasto
        const a = it.movs.find(x => App.esCompartido(x)); const ar = a ? area(a) : 'O';
        m.tipo = entra ? 'I' : 'G'; m.area = ar; m.agrup = entra ? 'Oli:Rep' : 'Oli:Apo';
        asegurarCat(m.agrup, nomArea(ar), entra ? 'Reparto recibido' : 'Aportación');
      }
      m.estado = m.estado === 'AR' ? 'AR' : 'R';
    });
  };

  App.views.calidad = (el) => {
    const issues = App.validate();
    const total = issues.reduce((a, i) => a + i.items.reduce((b, x) => b + (x.n || 0), 0), 0);
    el.innerHTML = `<div class="page-head"><h1>Calidad de datos</h1><div class="actions"><button class="btn" id="xls">⬇️ Informe Excel</button></div></div>
      <p class="muted">Revisión automática de incongruencias entre los movimientos y las tablas maestras. Se recalcula cada vez que cambian los datos.</p>
      ${!issues.length ? '<div class="alert info">✔ No se han encontrado incongruencias.</div>' : ''}
      <div class="issue-list">${issues.map((is, k) => `<details ${is.sev === 'alta' && k < 2 ? 'open' : ''}><summary><span class="tag ${SEV[is.sev]}">${is.sev}</span><b>${App.esc(is.title)}</b><span class="muted small">${is.items.length} grupos · ${App.int(is.items.reduce((a, x) => a + (x.n || 0), 0))} registros</span></summary>
        <div class="body"><p class="small">${App.esc(is.explain)}</p>
        ${is.fix === 'borrarDuplicados' ? '<p><button class="btn btn-danger btn-sm" data-dupall>Eliminar todas las copias sobrantes (se conserva una)</button></p>' : ''}
        ${is.fix === 'actividadSocio' ? '<p><button class="btn btn-primary btn-sm" data-actall>Corregir todos</button></p>' : ''}
        ${SUST[is.id] ? `<p class="row small"><span>La columna <b>Sustituir por</b> trae una propuesta cuando la app encuentra un código equivalente en tu maestro. Revísala, cámbiala si hace falta y pulsa <b>Aplicar</b>, o</span><button class="btn btn-sm btn-primary" data-allsust="${k}">Aplicar todas las propuestas marcadas</button></p>` : ''}
        <div class="table-wrap" style="max-height:420px"><table class="t"><thead><tr>${SUST[is.id] ? '<th></th>' : ''}<th>Código / grupo</th><th class="num">Nº</th><th class="num">Importe</th><th>Ejemplo / detalle</th>${SUST[is.id] ? '<th>Sustituir por</th>' : ''}<th></th></tr></thead><tbody>
        ${is.items.map((it, j) => { const sug = SUST[is.id] ? (it.maestro || App.sugerirCodigo(is.id, it.code)) : '';
          return `<tr data-row="${k}:${j}">${SUST[is.id] ? `<td><input type="checkbox" data-marca ${sug ? 'checked' : ''}></td>` : ''}<td>${App.esc(it.code)}${it.maestro ? ` → <b>${App.esc(it.maestro)}</b>` : ''}</td><td class="num">${it.n ?? ''}</td><td class="num">${it.importe != null ? App.num(it.importe) : ''}</td><td class="wrap small">${App.esc((it.ejemplo || '').slice(0, 140))}</td>
          ${SUST[is.id] ? `<td><select data-sust style="max-width:240px"><option value="">— elegir —</option>${SUST[is.id].vaciar ? `<option value="∅" ${sug === '∅' ? 'selected' : ''}>(dejar vacío)</option>` : ''}${SUST[is.id].opciones().map(([v, l]) => `<option value="${App.esc(v)}" ${v === sug ? 'selected' : ''}>${App.esc(l)}</option>`).join('')}</select>${sug ? ' <span class="tag good">propuesta</span>' : ''}</td>` : ''}
          <td class="row" style="flex-wrap:nowrap">${it.movs ? `<button class="btn btn-sm" data-ver="${k}:${j}">Ver</button>` : ''}${SUST[is.id] && it.movs ? `<button class="btn btn-sm btn-primary" data-aplicar>Aplicar</button>` : ''}${fixBtn(is, it, k, j)}</td></tr>`; }).join('')}
        </tbody></table></div></div></details>`).join('')}</div>`;

    // Sustituir un código por otro en todos sus movimientos
    const sustituir = (is, it, valor) => { const campo = SUST[is.id].campo; it.movs.forEach(m => { m[campo] = valor === '∅' ? '' : valor; }); return it.movs.length; };
    App.$$('tr[data-row] [data-aplicar]').forEach(b => b.onclick = async () => {
      const tr = b.closest('tr'), [k, j] = tr.dataset.row.split(':').map(Number), is = issues[k], it = is.items[j], v = tr.querySelector('[data-sust]').value;
      if (!v) return App.toast('Elige por qué código sustituirlo (o créalo en el maestro)');
      if (!(await App.confirm(`¿Cambiar "${it.code}" por "${v === '∅' ? '(vacío)' : v}" en ${it.n} movimientos?`))) return;
      sustituir(is, it, v); await App.db.save(); App.toast('Corregido'); App.render();
    });
    App.$$('[data-allsust]').forEach(b => b.onclick = async () => {
      const k = +b.dataset.allsust, is = issues[k];
      const sel = App.$$(`tr[data-row^="${k}:"]`).map(tr => ({ it: is.items[+tr.dataset.row.split(':')[1]], v: tr.querySelector('[data-sust]').value, ok: tr.querySelector('[data-marca]').checked })).filter(x => x.ok && x.v && x.it.movs);
      if (!sel.length) return App.toast('No hay propuestas marcadas');
      if (!(await App.confirm(`Se aplicarán ${sel.length} sustituciones (${App.int(sel.reduce((a, x) => a + x.it.n, 0))} movimientos):\n\n${sel.map(x => `${x.it.code} → ${x.v === '∅' ? '(vacío)' : x.v}`).join('\n')}\n\n¿Continuar?`))) return;
      sel.forEach(x => sustituir(is, x.it, x.v)); await App.db.save(); App.toast(`${sel.length} códigos corregidos`); App.render();
    });

    App.$$('[data-ver]').forEach(b => b.onclick = () => { const [k, j] = b.dataset.ver.split(':').map(Number); showMovs(issues[k].title + ' · ' + issues[k].items[j].code, issues[k].items[j].movs); });
    App.$$('[data-fix]').forEach(b => b.onclick = async () => {
      const [k, j] = b.dataset.fix.split(':').map(Number); const is = issues[k], it = is.items[j];
      const after = () => App.render();
      if (is.fix === 'crearAgrup') return App.editMaster('categorias', null, after, propuestaCategoria(it.code));
      if (is.fix === 'actividadSocio') {
        if (!(await App.confirm(`¿Convertir en reparto/aportación (ingreso o gasto) estos ${it.n} movimiento(s)?\n\n${it.movs.map(m => `${App.fdate(m.fecha)} ${m.cuenta} ${App.num(m.importe)}`).join('\n')}`))) return;
        App.corregirActividad(it); await App.db.save(); App.toast('Corregido'); return after();
      }
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
    const aa = App.$('[data-actall]'); if (aa) aa.onclick = async () => {
      const is = issues.find(i => i.fix === 'actividadSocio');
      if (!(await App.confirm(`¿Corregir los ${is.items.length} casos (${is.items.reduce((a, x) => a + x.n, 0)} movimientos) como repartos/aportaciones?`))) return;
      is.items.forEach(it => App.corregirActividad(it)); await App.db.save(); App.toast('Corregidos'); App.render();
    };
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
    const label = { crearAgrup: 'Crear en maestro', crearArea: 'Crear área', crearTipo: 'Crear tipo', crearBien: 'Crear bien', borrarDuplicados: 'Quitar copias', actividadSocio: 'Corregir', unificarAgrup: 'Unificar', unificarCuenta: it.maestro ? 'Unificar' : 'Crear cuenta' }[is.fix];
    return label ? `<button class="btn btn-sm" data-fix="${k}:${j}">${label}</button>` : '';
  }
})(window.App);
