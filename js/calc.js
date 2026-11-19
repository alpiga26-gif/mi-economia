/* Cálculos: agregados, saldos, préstamos, proyección, clasificador y validación */
(function (App) {
  const R = App.round2;
  const isPL = (m) => m.tipo === 'I' || m.tipo === 'G';
  App.isPL = isPL;

  /* ---------- Actividad compartida (p. ej. el olivar, con tus hermanos) ----------
     Una cuenta marcada como "compartida" en el maestro (con su área de actividad) recoge una actividad que no es solo
     tuya. Sus movimientos de ese área son de la actividad; los de otra área son tuyos (p. ej. la venta de un piso
     cobrada en esa cuenta). Tu economía excluye la actividad compartida: solo cuenta lo que entra o sale de ella
     hacia tus cuentas, como ingreso o gasto. */
  App.cuentaCompartida = (id) => !!App.cuentaOf(id)?.compartida;
  App.actividadDe = (id) => App.cuentaOf(id)?.actividad || 'O';
  App.esCompartido = (m) => App.cuentaCompartida(m.cuenta) && (m.area || '') === App.actividadDe(m.cuenta);
  App.hayCompartidas = () => App.state.cuentas.some(c => c.compartida);

  /* ---------- Filtros y agregados ---------- */
  // ambito: 'propio' (tu economía), 'compartido' (la actividad compartida) o vacío (todo)
  App.filterMovs = (f = {}) => App.state.movimientos.filter(m =>
    (!f.ambito || (f.ambito === 'compartido' ? App.esCompartido(m) : !App.esCompartido(m))) &&
    (!f.desde || m.fecha >= f.desde) && (!f.hasta || m.fecha <= f.hasta) &&
    (!f.ym || m.fecha.startsWith(f.ym)) && (!f.area || m.area === f.area) && (!f.cuenta || m.cuenta === f.cuenta) &&
    (!f.tipo || m.tipo === f.tipo) && (!f.categoria || App.catName(m.agrup) === f.categoria) && (!f.agrup || m.agrup === f.agrup) &&
    (!f.activo || m.activo === f.activo) &&
    (!f.texto || App.norm([m.concepto, m.agrup, m.beneficiario, m.activo, m.importe].join(' ')).includes(App.norm(f.texto))));

  /* Ingresos = suma de importes tipo I; Gastos = -suma de importes tipo G (las devoluciones restan gasto) */
  App.summarize = (movs) => {
    const s = { ingresos: 0, gastos: 0, traspasos: 0, otros: 0, n: movs.length, byArea: {}, byCat: {}, bySub: {}, byActivo: {}, byCuenta: {} };
    const acc = (obj, k, field, v) => { obj[k] = obj[k] || { ingresos: 0, gastos: 0 }; obj[k][field] += v; };
    movs.forEach(m => {
      const v = +m.importe || 0;
      if (m.tipo === 'I') { s.ingresos += v; acc(s.byArea, m.area || '—', 'ingresos', v); acc(s.byCat, App.catName(m.agrup), 'ingresos', v); acc(s.bySub, m.agrup || '—', 'ingresos', v); if (m.activo) acc(s.byActivo, m.activo, 'ingresos', v); acc(s.byCuenta, m.cuenta, 'ingresos', v); }
      else if (m.tipo === 'G') { s.gastos -= v; acc(s.byArea, m.area || '—', 'gastos', -v); acc(s.byCat, App.catName(m.agrup), 'gastos', -v); acc(s.bySub, m.agrup || '—', 'gastos', -v); if (m.activo) acc(s.byActivo, m.activo, 'gastos', -v); acc(s.byCuenta, m.cuenta, 'gastos', -v); }
      else if (m.tipo === 'T') s.traspasos += v; else s.otros += v;
    });
    s.ahorro = s.ingresos - s.gastos;
    s.tasaAhorro = s.ingresos > 0 ? s.ahorro / s.ingresos : null;
    return s;
  };

  App.monthsWithData = () => { const set = new Set(App.state.movimientos.map(m => App.ym(m.fecha))); return Array.from(set).filter(Boolean).sort(); };
  App.lastDataMonth = () => { const ms = App.monthsWithData(); return ms[ms.length - 1] || App.ym(App.today()); };

  /* ---------- Saldos por cuenta ---------- */
  /* Saldo al final del día de la última fila con saldo conocido; luego se suman los movimientos posteriores sin saldo.
     Si el banco ordena al revés dentro del día, se identifica la fila de cierre del día como aquella cuyo saldo
     no es el "saldo previo" de ninguna otra fila del mismo día. */
  const endOfDayRow = (rows) => {
    if (rows.length === 1) return rows[0];
    const prevs = new Set(rows.map(r => R(r.saldo - r.importe).toFixed(2)));
    const cands = rows.filter(r => !prevs.has(R(r.saldo).toFixed(2)));
    return cands.length === 1 ? cands[0] : rows[rows.length - 1];
  };
  App.balanceAt = (cuentaId, iso) => {
    const c = App.cuentaOf(cuentaId);
    const movs = App.state.movimientos.filter(m => (m.cuenta || '').toLowerCase() === (cuentaId || '').toLowerCase() && m.fecha <= iso);
    let lastIdx = -1;
    for (let i = movs.length - 1; i >= 0; i--) if (movs[i].saldo != null && !isNaN(movs[i].saldo)) { lastIdx = i; break; }
    if (lastIdx >= 0) {
      const day = movs[lastIdx].fecha;
      const dayRows = movs.filter(m => m.fecha === day && m.saldo != null);
      let saldo = endOfDayRow(dayRows).saldo;
      movs.forEach(m => { if (m.fecha > day) saldo += (+m.importe || 0); });
      return { saldo: R(saldo), fechaRef: movs[movs.length - 1]?.fecha, metodo: 'extracto' };
    }
    const base = (c && c.saldoInicial) || 0;
    const desde = (c && c.fechaSaldoInicial) || '0000';
    const sum = movs.filter(m => m.fecha >= desde).reduce((a, m) => a + (+m.importe || 0), 0);
    return { saldo: R(base + sum), fechaRef: movs[movs.length - 1]?.fecha, metodo: 'acumulado' };
  };
  App.cuentaGrupo = (c) => {
    if (c?.compartida) return 'Compartida';
    const t = (c?.tipo || '').toLowerCase();
    if (t.includes('tarjeta')) return 'Tarjetas';
    if (t.includes('invers')) return 'Inversión';
    if (t.includes('efectivo')) return 'Efectivo';
    return 'Disponible';
  };
  App.balances = (iso) => {
    const ids = new Map();
    App.state.cuentas.filter(c => c.activa !== false).forEach(c => ids.set(c.id.toLowerCase(), c.id));
    App.state.movimientos.forEach(m => { if (m.cuenta && !ids.has(m.cuenta.toLowerCase())) ids.set(m.cuenta.toLowerCase(), m.cuenta); });
    return Array.from(ids.values()).map(id => { const c = App.cuentaOf(id); const b = App.balanceAt(id, iso); return { id, banco: c?.banco || '', tipo: c?.tipo || '(no está en el maestro)', grupo: App.cuentaGrupo(c), ...b }; });
  };
  /* En una cuenta compartida, la parte tuya es lo acumulado por tus movimientos propios (los de otra área);
     el resto del saldo es caja de la actividad compartida */
  App.propioEnCuenta = (id, iso) => R(App.state.movimientos.filter(m => (m.cuenta || '').toLowerCase() === id.toLowerCase() && m.fecha <= iso && !App.esCompartido(m))
    .reduce((a, m) => a + (+m.importe || 0), 0));
  App.liquidity = (iso) => {
    const bs = App.balances(iso); const g = (k) => R(bs.filter(b => b.grupo === k).reduce((a, b) => a + b.saldo, 0));
    bs.filter(b => b.grupo === 'Compartida').forEach(b => { b.propio = App.propioEnCuenta(b.id, iso); b.actividad = R(b.saldo - b.propio); });
    const comp = bs.filter(b => b.grupo === 'Compartida');
    // si tus movimientos propios en una cuenta compartida dejan saldo positivo, es dinero tuyo depositado allí;
    // si es negativo, has usado dinero de la actividad: es un saldo pendiente con ella (no se resta del disponible)
    const propiosEnCompartidas = R(comp.reduce((a, b) => a + Math.max(0, b.propio), 0)), pendienteConActividad = R(comp.reduce((a, b) => a + Math.max(0, -b.propio), 0));
    const cajaActividad = R(comp.reduce((a, b) => a + b.actividad, 0));
    return { bs, disponible: R(g('Disponible') + g('Efectivo') + propiosEnCompartidas), efectivo: g('Efectivo'), inversion: g('Inversión'), tarjetas: g('Tarjetas'), propiosEnCompartidas, pendienteConActividad, cajaActividad };
  };

  /* ---------- Préstamos (sistema francés, con carencia de intereses) ---------- */
  App.loanSchedule = (p) => {
    const out = []; if (!p || !p.capitalPendiente || !p.fechaCapital) return out;
    let cap = +p.capitalPendiente; const r = (+p.tipoAnual || 0) / 100 / 12;
    let n = +p.cuotasPendientes || 0;
    if (!n && p.vencimiento) n = Math.max(1, App.monthsBetween(App.addMonths(App.ym(p.fechaCapital), 1), App.ym(p.vencimiento)).length);
    let ym = App.addMonths(App.ym(p.fechaCapital), 1);
    const finCar = p.finCarencia ? App.ym(p.finCarencia) : null;
    let cuota = null;
    for (let k = 0; k < 600 && cap > 0.005; k++, ym = App.addMonths(ym, 1)) {
      const interes = R(cap * r);
      if (finCar && ym <= finCar) { out.push({ ym, cuota: interes, interes, principal: 0, pendiente: R(cap) }); continue; }
      // cuotasPendientes = cuotas de amortización (sin contar los meses de carencia)
      if (cuota == null) { const left = Math.max(1, n); cuota = (p.cuota && !finCar) ? +p.cuota : (r ? cap * r / (1 - Math.pow(1 + r, -left)) : cap / left); }
      let principal = R(Math.min(cap, cuota - interes)); if (principal <= 0) principal = R(cap); // evita bucles con datos incoherentes
      cap = R(cap - principal);
      out.push({ ym, cuota: R(principal + interes), interes, principal, pendiente: cap });
    }
    return out;
  };
  App.loanPending = (p, ym) => {
    if (!p.capitalPendiente) return null;
    if (ym <= App.ym(p.fechaCapital)) return +p.capitalPendiente;
    const s = App.loanSchedule(p); const row = s.filter(x => x.ym <= ym).pop(); return row ? row.pendiente : +p.capitalPendiente;
  };
  App.debtAt = (ym) => App.state.prestamos.reduce((a, p) => a + (App.loanPending(p, ym) || 0), 0);

  /* ---------- Clasificador automático por histórico ---------- */
  const tokens = (s) => App.norm(s).split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w));
  let clsIndex = null, clsVersion = null;
  App.buildClassifier = () => {
    const ver = App.state.updatedAt + ':' + App.state.movimientos.length;
    if (clsIndex && clsVersion === ver) return clsIndex;
    clsIndex = App.state.movimientos.filter(m => m.agrup && m.concepto).map(m => ({ m, t: new Set(tokens(m.concepto)) })).filter(x => x.t.size);
    clsVersion = ver; return clsIndex;
  };
  App.suggest = (concepto, cuenta, importe) => {
    const idx = App.buildClassifier(); const t = new Set(tokens(concepto)); if (!t.size) return null;
    let best = null;
    for (const x of idx) {
      let inter = 0; t.forEach(w => { if (x.t.has(w)) inter++; });
      if (!inter) continue;
      let score = 200 * inter / (t.size + x.t.size); // coeficiente de Dice (0-100)
      if (cuenta && x.m.cuenta === cuenta) score += 5;
      if (importe != null && Math.sign(importe) === Math.sign(x.m.importe)) score += 3;
      if (importe != null && Math.abs((+x.m.importe) - importe) < 0.01) score += 7;
      if (!best || score > best.score || (score === best.score && x.m.fecha > best.m.fecha)) best = { score, m: x.m };
    }
    if (!best) return null;
    const m = best.m;
    return { score: Math.min(100, Math.round(best.score)), tipo: m.tipo, area: m.area, agrup: m.agrup, activo: m.activo, beneficiario: m.beneficiario };
  };

  /* ---------- Proyección futura ---------- */
  const LOAN_CATS = /^(ptm|hip|pre|pag)/i;
  App.isLoanAgrup = (a) => LOAN_CATS.test(a || '') || /pr[eé]stamo|hipoteca/i.test(App.catName(a));
  App.baseline = (endYm, n) => {
    const startYm = App.addMonths(endYm, -(n - 1));
    const movs = App.filterMovs({ desde: startYm + '-01', hasta: App.endOfMonth(endYm), ambito: 'propio' }).filter(isPL);   // la proyección es de tu economía
    const by = {};
    movs.forEach(m => {
      const k = m.agrup || '—';
      const r = by[k] = by[k] || { agrup: k, categoria: App.catName(k), sub: App.subName(k), tipo: m.tipo, total: 0, meses: {} };
      const v = m.tipo === 'I' ? +m.importe : -m.importe;
      r.total += v; const ym = App.ym(m.fecha); r.meses[ym] = (r.meses[ym] || 0) + v;
    });
    return Object.values(by).map(r => {
      const vals = Object.values(r.meses); const max = Math.max(...vals.map(Math.abs));
      const loan = App.isLoanAgrup(r.agrup);
      // Partida puntual: un solo mes concentra más de la mitad del total y supera 3.000 € (compra de vivienda, herencia, venta…)
      const puntual = Math.abs(r.total) > 0 && max > 3000 && max > 0.5 * Math.abs(r.total);
      return { ...r, media: R(r.total / n), mesesConDatos: vals.length, prestamo: loan, puntual, incluir: !loan && !puntual };
    }).sort((a, b) => Math.abs(b.media) - Math.abs(a.media));
  };
  App.project = (o) => {
    const rows = []; const loans = App.state.prestamos.map(p => ({ p, s: App.loanSchedule(p) }));
    const baseI = o.base.filter(b => b.incluir && b.tipo === 'I').reduce((a, b) => a + b.media, 0);
    const baseG = o.base.filter(b => b.incluir && b.tipo === 'G').reduce((a, b) => a + b.media, 0);
    let liq = o.liquidezInicial; const patrimonioFijo = o.inversion + o.valorBienes;
    for (let k = 1; k <= o.horizonte; k++) {
      const ym = App.addMonths(o.desde, k - 1);
      const ingresos = baseI * Math.pow(1 + o.crecimientoIngresos / 100, k / 12) * (1 + (o.ajusteIngresos || 0) / 100);
      const gastos = baseG * Math.pow(1 + o.inflacion / 100, k / 12) * (1 + (o.ajusteGastos || 0) / 100);
      let cuotas = 0, deuda = 0;
      loans.forEach(({ p, s }) => {
        const r = s.find(x => x.ym === ym); if (r) cuotas += r.cuota;
        else if (p.cuota && p.fechaCapital && ym <= App.ym(p.fechaCapital)) cuotas += +p.cuota; // meses anteriores a la fecha del capital pendiente
        const prev = s.filter(x => x.ym <= ym).pop(); deuda += prev ? prev.pendiente : (ym <= App.ym(p.fechaCapital || '9999') ? (+p.capitalPendiente || 0) : 0);
      });
      const ev = (o.eventos || []).filter(e => App.ym(e.fecha) === ym || (e.recurrente && App.ym(e.fecha) <= ym && (!e.hasta || ym <= App.ym(e.hasta)))).reduce((a, e) => a + (+e.importe || 0), 0);
      const flujo = ingresos - gastos - cuotas + ev; liq += flujo;
      rows.push({ ym, ingresos: R(ingresos), gastos: R(gastos), cuotas: R(cuotas), eventos: R(ev), flujo: R(flujo), liquidez: R(liq), deuda: R(deuda), patrimonio: R(liq + patrimonioFijo - deuda) });
    }
    return { rows, baseI: R(baseI), baseG: R(baseG) };
  };

  /* ---------- Validación / incongruencias ---------- */
  App.validate = () => {
    const s = App.state, issues = [];
    const add = (id, sev, title, explain, items, extra = {}) => { if (items.length) issues.push({ id, sev, title, explain, items, ...extra }); };
    const mv = s.movimientos;
    const groupCount = (arr, kf) => { const g = {}; arr.forEach(x => { const k = kf(x); (g[k] = g[k] || []).push(x); }); return g; };

    // Agrupaciones
    const sinAgrup = mv.filter(m => !m.agrup);
    const agrupUnknown = mv.filter(m => m.agrup && !App.idx.cat[m.agrup]);
    const caseOnly = agrupUnknown.filter(m => App.idx.catLower[m.agrup.toLowerCase()]);
    const trulyUnknown = agrupUnknown.filter(m => !App.idx.catLower[m.agrup.toLowerCase()]);
    add('agrup-desconocida', 'alta', 'Códigos de agrupación (Agrup) que no existen en el maestro de categorías',
      'Estos movimientos usan un código que no está en la tabla Categoría, por lo que no se pueden asociar a categoría/subcategoría. Créalos en el maestro o reclasifica los movimientos.',
      Object.entries(groupCount(trulyUnknown, m => m.agrup)).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ code: k, n: v.length, ejemplo: v[0].concepto, movs: v })), { fix: 'crearAgrup' });
    add('agrup-mayusculas', 'media', 'Códigos que solo difieren en mayúsculas/minúsculas del maestro',
      'Ej. "Oin:Liq" frente a "OIn:Liq". La app los trata como iguales, pero conviene unificarlos.',
      Object.entries(groupCount(caseOnly, m => m.agrup)).map(([k, v]) => ({ code: k, n: v.length, maestro: App.idx.catLower[k.toLowerCase()].agrup, movs: v })), { fix: 'unificarAgrup' });
    add('sin-agrup', 'media', 'Movimientos sin clasificar', 'No tienen código de agrupación.', sinAgrup.map(m => ({ code: m.id, n: 1, ejemplo: m.concepto, movs: [m] })));

    // Cuentas, áreas, tipos, activos
    const cuentaUnknown = mv.filter(m => m.cuenta && !App.idx.cuenta[m.cuenta]);
    add('cuenta-desconocida', 'alta', 'Cuentas usadas en movimientos que no coinciden exactamente con el maestro de Cuentas',
      'Puede ser un problema de mayúsculas (SAN_1271 / San_1271) o una cuenta que no está dada de alta (Trade / Trade_8911).',
      Object.entries(groupCount(cuentaUnknown, m => m.cuenta)).map(([k, v]) => ({ code: k, n: v.length, maestro: App.idx.cuentaLower[k.toLowerCase()]?.id || '', movs: v })), { fix: 'unificarCuenta' });
    add('area-desconocida', 'alta', 'Áreas de actividad (IdArea) no definidas en el maestro',
      'La tabla Area solo contiene ' + s.areas.map(a => a.id).join(', ') + '.',
      Object.entries(groupCount(mv.filter(m => m.area && !App.idx.area[m.area]), m => m.area)).map(([k, v]) => ({ code: k, n: v.length, ejemplo: v[0].agrup + ' · ' + v[0].concepto, movs: v })), { fix: 'crearArea' });
    add('tipo-desconocido', 'alta', 'Tipos de movimiento no definidos en el maestro',
      'La tabla de tipos solo contiene ' + s.tipos.map(t => t.id).join(', ') + '.',
      Object.entries(groupCount(mv.filter(m => m.tipo && !App.idx.tipo[m.tipo]), m => m.tipo)).map(([k, v]) => ({ code: k, n: v.length, ejemplo: v[0].agrup + ' · ' + v[0].concepto, movs: v })), { fix: 'crearTipo' });
    const knownAct = (a) => App.idx.bien[a] || App.idx.ptmo[a] || App.cuentaOf(a);
    add('activo-desconocido', 'media', 'Activos/préstamos indicados en movimientos que no existen en el maestro de Bienes',
      'Algunos pueden ser variantes de nombre de bienes que ya existen en el maestro (otra forma de escribir el mismo inmueble o vehículo). Unifícalos o créalos en Maestro › Bienes.',
      Object.entries(groupCount(mv.filter(m => m.activo && !knownAct(m.activo)), m => m.activo)).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ code: k, n: v.length, ejemplo: v[0].agrup + ' · ' + v[0].concepto, movs: v })), { fix: 'crearBien' });

    // Signo
    // Los movimientos AR son desgloses (el cargo original se compensa con un apunte de signo contrario y se reparte en varias partidas): no se revisa su signo
    const signo = mv.filter(m => m.estado !== 'AR' && ((m.tipo === 'G' && m.importe > 0) || (m.tipo === 'I' && m.importe < 0)));
    add('signo', 'media', 'Importe con signo contrario al tipo (gasto positivo o ingreso negativo)',
      'Excluidos los desgloses (Estado AR). Pueden ser devoluciones o abonos legítimos (se netean en la categoría), o errores de tipo.',
      Object.entries(groupCount(signo, m => m.tipo + ' · ' + m.agrup)).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ code: k, n: v.length, importe: R(v.reduce((a, m) => a + m.importe, 0)), ejemplo: v[0].concepto, movs: v })));

    // Desgloses AR: la suma de los apuntes AR de cada cuenta y día debe ser 0
    const arDesc = Object.values(groupCount(mv.filter(m => m.estado === 'AR'), m => m.cuenta + '|' + m.fecha))
      .map(v => ({ v, s: R(v.reduce((a, m) => a + (+m.importe || 0), 0)) })).filter(x => Math.abs(x.s) > 0.005);
    add('desglose-ar', 'media', 'Desgloses (Estado AR) cuya suma no es 0',
      'En cada cuenta y fecha, el apunte que anula el cargo original y las partidas en que se desglosa deben sumar 0. Un descuadre indica una partida que falta, un importe mal tecleado o una partida con fecha distinta.',
      arDesc.map(({ v, s }) => ({ code: v[0].cuenta + ' ' + App.fdate(v[0].fecha), n: v.length, importe: s, ejemplo: v.map(m => `${m.agrup} ${App.num(m.importe)}`).join(' · '), movs: v })));

    // Actividad compartida: el dinero que entra o sale de ella hacia tus cuentas es ingreso o gasto, no traspaso
    if (App.hayCompartidas()) {
      const T = mv.filter(m => m.tipo === 'T' && m.importe), usados = new Set(), grupos = [];
      T.filter(m => App.esCompartido(m)).forEach(c => {
        const d0 = new Date(c.fecha);
        const p = T.find(x => !usados.has(x.id) && !App.esCompartido(x) && !App.cuentaCompartida(x.cuenta) && Math.abs((+x.importe) + (+c.importe)) < 0.02 && Math.abs(new Date(x.fecha) - d0) <= 7 * 864e5);
        if (p) { usados.add(p.id); usados.add(c.id); grupos.push({ code: `${p.cuenta} ⇄ ${c.cuenta} ${App.fdate(c.fecha)}`, n: 2, importe: p.importe, ejemplo: `${p.concepto} ⟷ ${c.concepto}`, movs: [p, c], par: true }); }
        else if (/^rep:/i.test(c.agrup || '')) grupos.push({ code: `${c.cuenta} ${App.fdate(c.fecha)} · ${c.agrup}`, n: 1, importe: c.importe, ejemplo: c.concepto, movs: [c], par: false });
      });
      add('actividad-traspasos', 'alta', 'Movimientos entre la actividad compartida y tus cuentas registrados como traspaso',
        'La actividad compartida no es solo tuya: lo que sale de ella hacia ti es un reparto (ingreso tuyo, gasto de la actividad) y lo que pones tú es una aportación (gasto tuyo, ingreso de la actividad). Corregir: tu lado pasa a Ingreso/Gasto "Olivar : Reparto recibido / Aportación" y el lado de la actividad a "Reparto / Aportación de socio".',
        grupos, { fix: 'actividadSocio' });
    }

    // Transferencias / traspasos clasificados como ingreso o gasto (sin contar los repartos/aportaciones de la actividad compartida)
    const traMal = mv.filter(m => /^tra/i.test(m.agrup || '') && m.tipo !== 'T' && !App.esCompartido(m));
    add('tra-tipo', 'media', 'Transferencias o traspasos (Agrup Tra:…) con tipo Ingreso o Gasto',
      'Si el dinero se mueve entre tus propias cuentas debería ser tipo T (Traspaso); si no, se cuenta dos veces como gasto o ingreso en el dashboard.',
      Object.entries(groupCount(traMal, m => m.tipo + ' · ' + m.agrup)).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ code: k, n: v.length, importe: R(v.reduce((a, m) => a + m.importe, 0)), ejemplo: v[0].concepto, movs: v })));

    // Duplicados
    const dups = Object.values(groupCount(mv, m => App.dupKey(m))).filter(g => g.length > 1);
    const dupSeguro = dups.filter(g => new Set(g.map(m => m.saldo)).size < g.length && g.some(m => m.saldo != null));
    const dupPosible = dups.filter(g => !dupSeguro.includes(g));
    add('duplicados', 'alta', 'Movimientos duplicados (misma cuenta, fecha, importe, concepto y mismo saldo)',
      'Casi con seguridad son registros repetidos que inflan ingresos o gastos.',
      dupSeguro.map(g => ({ code: g[0].cuenta + ' ' + App.fdate(g[0].fecha), n: g.length, importe: g[0].importe, ejemplo: g[0].concepto, movs: g })), { fix: 'borrarDuplicados' });
    add('duplicados-posibles', 'baja', 'Posibles duplicados (misma cuenta, fecha, importe y concepto pero saldo distinto o sin saldo)',
      'Pueden ser compras repetidas reales (p. ej. dos cafés el mismo día) o cargos duplicados. Revísalos.',
      dupPosible.map(g => ({ code: g[0].cuenta + ' ' + App.fdate(g[0].fecha), n: g.length, importe: g[0].importe, ejemplo: g[0].concepto, movs: g })));

    // Saldos encadenados (a nivel de día)
    const saltos = [];
    Object.entries(groupCount(mv.filter(m => m.saldo != null && !isNaN(m.saldo)), m => m.cuenta)).forEach(([cta, rows]) => {
      const days = groupCount(rows, m => m.fecha); const ds = Object.keys(days).sort(); let prev = null;
      ds.forEach(d => {
        const dr = days[d]; const allDay = mv.filter(m => m.cuenta === cta && m.fecha === d); const end = endOfDayRow(dr).saldo;
        if (prev != null) { const exp = R(prev + allDay.reduce((a, m) => a + (+m.importe || 0), 0)); if (Math.abs(exp - end) > 0.05) saltos.push({ code: cta + ' ' + App.fdate(d), n: allDay.length, importe: R(end - exp), ejemplo: `Saldo esperado ${App.num(exp)} · saldo en extracto ${App.num(end)}`, movs: allDay }); }
        prev = end;
      });
    });
    add('saldos', 'media', 'Saldos que no cuadran con los movimientos (falta o sobra algún movimiento)',
      'Se compara, día a día, el saldo final del extracto con el saldo anterior más los movimientos del día. La columna "Importe" indica el descuadre.',
      saltos);

    // Traspasos sin contrapartida
    const T = mv.filter(m => m.tipo === 'T'); const used = new Set(); const huerf = [];
    // Las tarjetas registran el ingreso en la fecha de liquidación (hasta ~45 días después del cargo en cuenta)
    const esTarjeta = (c) => App.cuentaGrupo(App.cuentaOf(c)) === 'Tarjetas' || /^tc/i.test(c || '');
    const dias = (a, b) => Math.abs(new Date(a.fecha) - new Date(b.fecha)) / 864e5;
    T.forEach(m => {
      if (used.has(m.id) || !(+m.importe)) return;
      let best = null;
      T.forEach(x => {
        if (used.has(x.id) || x.id === m.id || x.cuenta === m.cuenta || Math.abs((+x.importe) + (+m.importe)) >= 0.02) return;
        const d = dias(m, x), max = esTarjeta(m.cuenta) || esTarjeta(x.cuenta) ? 45 : 7;
        if (d <= max && (!best || d < best.d)) best = { x, d };
      });
      if (best) { used.add(m.id); used.add(best.x.id); } else huerf.push(m);
    });
    add('traspasos', 'baja', 'Traspasos (tipo T) sin movimiento opuesto en otra cuenta',
      'Un traspaso entre cuentas propias debería aparecer dos veces (sale de una y entra en otra). Si la otra cuenta no está registrada, el saldo global queda descuadrado.',
      huerf.map(m => {
        const c = mv.find(x => x.id !== m.id && x.cuenta !== m.cuenta && x.tipo !== 'T' && Math.abs((+x.importe) + (+m.importe)) < 0.02 && dias(m, x) <= 15);
        return { code: `${m.cuenta} ${App.fdate(m.fecha)} · ${m.agrup}`, n: 1, importe: m.importe, ejemplo: m.concepto + (c ? ` ⟶ posible contrapartida: ${c.cuenta} ${App.fdate(c.fecha)} tipo ${c.tipo} ${c.agrup}` : ''), movs: [m] };
      }));
    const ceros = mv.filter(m => m.importe == null || +m.importe === 0);
    add('importe-cero', 'baja', 'Movimientos con importe vacío o 0', 'No afectan a los saldos; probablemente sobran o falta teclear el importe.',
      ceros.map(m => ({ code: `${m.cuenta} ${App.fdate(m.fecha)} · ${m.agrup}`, n: 1, importe: m.importe, ejemplo: m.concepto, movs: [m] })));

    // Maestro
    const mi = [];
    Object.entries(groupCount(s.categorias, c => c.agrup.toLowerCase())).forEach(([k, v]) => { if (v.length > 1) mi.push({ code: v[0].agrup, n: v.length, ejemplo: 'Código de agrupación repetido en Categoría' }); });
    s.categorias.forEach(c => { if (!c.subcategoria && c.categoria !== c.supra) mi.push({ code: c.agrup, n: 1, ejemplo: `"${c.supra}" no tiene subcategoría` }); });
    s.categorias.forEach(c => { const sup = c.supra.split(':')[1]?.trim(); if (sup && c.subcategoria && App.norm(sup).replace(/ /g, '') !== App.norm(c.subcategoria).replace(/ /g, '') && !/^\w+ \(/.test(c.subcategoria)) mi.push({ code: c.agrup, n: 1, ejemplo: `SupraCategoría "${c.supra}" no coincide con SubCategoría "${c.subcategoria}"` }); });
    Object.entries(groupCount(s.bienes, b => b.nombre.trim().toLowerCase())).forEach(([k, v]) => { if (v.length > 1) mi.push({ code: v.map(b => b.id).join(', '), n: v.length, ejemplo: `Bien repetido: "${v[0].nombre.trim()}"` }); });
    s.prestamos.forEach(p => { if (App.idx.bien[p.id]) mi.push({ code: p.id, n: 1, ejemplo: 'El mismo identificador está en Bienes y en Préstamos' }); if (!p.importe && !p.capitalPendiente) mi.push({ code: p.id, n: 1, ejemplo: 'Préstamo sin importe, fechas ni tipo de interés' }); });
    s.cuentas.forEach(c => { if (!c.banco) mi.push({ code: c.id, n: 1, ejemplo: 'Cuenta sin banco/entidad' }); });
    s.tipos.forEach(t => { if (!t.detalle || /que\s*$/.test(t.detalle)) mi.push({ code: t.id, n: 1, ejemplo: `Tipo "${t.nombre}" con descripción vacía o incompleta` }); });
    s.cuentas.forEach(c => { if (!mv.some(m => (m.cuenta || '').toLowerCase() === c.id.toLowerCase())) mi.push({ code: c.id, n: 0, ejemplo: 'Cuenta del maestro sin ningún movimiento' }); });
    add('maestro', 'baja', 'Incoherencias dentro de las tablas maestras', 'Revisión de las tablas Area, Tipo, Bienes, Categoría, Cuentas y Préstamos.', mi);

    return issues;
  };
})(window.App);
