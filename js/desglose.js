/* Desgloses automáticos (plantillas) y reglas de clasificación aprendidas */
(function (App) {
  const R = App.round2;

  /* El código no contiene datos personales: las plantillas, reglas y préstamos viven en tus datos (navegador y Drive).
     Para instalar la configuración en un dispositivo nuevo: Ajustes › Importar configuración personal. */
  const MARGEN_RENOV = 10; // días: una póliza cuenta como "renovada" en los cargos desde 10 días antes de su fecha
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const addYear = (iso) => (+iso.slice(0, 4) + 1) + iso.slice(4);
  App.addDays = addDays;

  App.migrate = async () => {
    const S = App.state; let changed = false;
    if (!S.plantillas) { S.plantillas = []; changed = true; }
    if (!S.reglas) { S.reglas = []; changed = true; }
    if (changed) await App.db.save({ noSync: true });
  };

  /* Importa un archivo de configuración personal (plantillas, titulares, datos de préstamos). Solo añade lo que falta:
     no sobrescribe plantillas que ya tengas (conservan los importes aprendidos). */
  App.importConfig = async (cfg) => {
    const S = App.state; const r = { plantillas: 0, titulares: 0, prestamos: 0 };
    S.plantillas = S.plantillas || [];
    (cfg.plantillas || []).forEach(t => { if (t && t.id && !S.plantillas.some(x => x.id === t.id)) { S.plantillas.push(t); r.plantillas++; } });
    const tit = new Set(S.settings.titulares || []); (cfg.titulares || []).forEach(n => { if (n && !tit.has(n)) { tit.add(n); r.titulares++; } }); S.settings.titulares = [...tit];
    (cfg.prestamos || []).forEach(p => { const x = App.idx.ptmo[p.id]; if (x) { Object.entries(p).forEach(([k, v]) => { if (k !== 'id' && (x[k] == null || x[k] === '')) { x[k] = v; r.prestamos++; } }); } });
    (cfg.reglas || []).forEach(g => { S.reglas = S.reglas || []; if (g && g.texto && !S.reglas.some(x => App.norm(x.texto) === App.norm(g.texto))) S.reglas.push({ id: App.uid('R'), ...g }); });
    await App.db.save();
    return r;
  };
  /* ---------- Coincidencia de plantillas ---------- */
  const textMatch = (patron, concepto) => { const c = App.norm(concepto).replace(/ /g, ''); return String(patron || '').split('|').map(p => App.norm(p).replace(/ /g, '')).filter(Boolean).some(p => c.includes(p)); };
  App.matchTemplate = (m) => (App.state.plantillas || []).find(t => t.activa !== false &&
    (!t.match.cuenta || (m.cuenta || '').toLowerCase() === t.match.cuenta.toLowerCase()) &&
    (!t.match.signo || (t.match.signo === '-' ? m.importe < 0 : m.importe > 0)) &&
    textMatch(t.match.texto, m.concepto));

  /* ---------- Cálculo del desglose ---------- */
  const lineFrom = (def, importe, obs) => ({ agrup: def.agrup, tipo: def.tipo, area: def.area, activo: def.activo || '', beneficiario: def.beneficiario || '', importe: R(importe), obs: obs ?? def.obs ?? '' });
  /* opts: { capital, tipo, comisionPct, importes:[...] } permite recalcular con valores corregidos en el editor */
  App.computeDesglose = (m, tpl, opts = {}) => {
    const total = +m.importe, abs = Math.abs(total), sg = Math.sign(total) || -1, avisos = [];
    let lineas = [], prestamoNuevo = null, dudoso = false;
    if (tpl.modo === 'prestamo') {
      const p = App.idx.ptmo[tpl.prestamo];
      if (!p) return { lineas: [], avisos: [`No existe el préstamo "${tpl.prestamo}" en el maestro.`], dudoso: true };
      const cap0 = opts.capital ?? +p.capitalPendiente, tipo = opts.tipo ?? +p.tipoAnual;
      if (!cap0 || !tipo) return { lineas: [], avisos: ['Faltan el capital pendiente o el tipo de interés del préstamo (Maestro › Préstamos).'], dudoso: true };
      if (opts.capital == null && p.fechaCapital && m.fecha <= p.fechaCapital) { avisos.push(`El capital pendiente del maestro es a ${App.fdate(p.fechaCapital)}, posterior a este cargo. Indica el capital pendiente antes de esta cuota.`); dudoso = true; }
      const interes = R(cap0 * tipo / 100 / 12), capital = R(abs - interes);
      if (opts.tipo == null && p.cuota && Math.abs(abs - p.cuota) > 0.01) { avisos.push(`La cuota ha cambiado (${App.num(p.cuota)} → ${App.num(abs)}). Suele ser una revisión del tipo de interés: indica el tipo nuevo.`); dudoso = true; }
      if (capital < -0.005 || capital > abs) { avisos.push('Con estos datos la amortización de capital sale negativa o mayor que la cuota: revisa el tipo y el capital pendiente.'); dudoso = true; }
      const enCarencia = Math.abs(capital) < 0.01;
      const pend = R(cap0 - Math.max(0, capital));
      const cuotas = Math.max(0, (+p.cuotasPendientes || 0) - (enCarencia ? 0 : 1));
      const dI = tpl.lineas.find(l => l.rol === 'interes'), dC = tpl.lineas.find(l => l.rol === 'capital');
      lineas.push(lineFrom(dI, sg * interes, `i=${String(tipo).replace('.', ',')}% s/ ${App.num(cap0)}`));
      if (!enCarencia) lineas.push(lineFrom(dC, sg * capital, `Restan ${cuotas} cuotas · pendiente ${App.num(pend)}`));
      prestamoNuevo = { id: p.id, capitalPendiente: pend, fechaCapital: m.fecha, tipoAnual: tipo, cuota: R(abs), cuotasPendientes: cuotas };
      if (!avisos.length) avisos.push(`Interés ${App.num(interes)} · capital ${App.num(Math.max(0, capital))} · pendiente tras la cuota ${App.num(pend)}`);
    } else if (tpl.modo === 'comision') {
      const c = opts.comisionPct ?? +tpl.comisionPct;
      const bruto = R(abs / (1 - c / 100)), com = R(abs - bruto);
      const dB = tpl.lineas.find(l => l.rol === 'bruto'), dC = tpl.lineas.find(l => l.rol === 'comision');
      lineas = [lineFrom(dB, sg * bruto), lineFrom(dC, sg * com)];
      if (total < 0) { avisos.push('El importe es negativo: no parece un cobro de alquiler.'); dudoso = true; }
    } else {
      const imps = (opts.importes || tpl.lineas.map(l => +l.importe || 0)).slice();
      const dif = R(abs - imps.reduce((a, b) => a + b, 0));
      // Pólizas cuya renovación toca en este cargo
      const lim = addDays(m.fecha, MARGEN_RENOV);
      const due = tpl.lineas.map((l, i) => ({ l, i })).filter(x => x.l.renovacion && x.l.renovacion <= lim);
      const nom = (l) => l.obs || l.activo || App.subName(l.agrup);
      if (Math.abs(dif) > 0.005 && !opts.importes) {
        if (due.length === 1 && imps[due[0].i] + dif > 0) {
          const { l, i } = due[0], antes = imps[i]; imps[i] = R(antes + dif);
          avisos.push(`Renovación de "${nom(l)}": ${App.num(antes)} → ${App.num(imps[i])} (${dif > 0 ? '+' : ''}${App.num(dif)}).`);
        } else if (due.length > 1) {
          avisos.push(`El cargo ha cambiado ${App.num(dif)} y este mes renuevan varias pólizas (${due.map(x => nom(x.l)).join(', ')}). Indica el nuevo importe de cada una.`); dudoso = true;
        } else {
          avisos.push(`Las partidas suman ${App.num(abs - dif)} y el cargo es ${App.num(abs)} (diferencia ${App.num(dif)}), pero ninguna póliza renueva este mes. Puede ser un ajuste del banco: corrige la póliza que corresponda.`); dudoso = true;
        }
      } else if (Math.abs(dif) > 0.005) {
        avisos.push(`Faltan ${App.num(dif)} por repartir.`); dudoso = true;
      } else if (due.length && !opts.importes) {
        avisos.push(`Renovación de ${due.map(x => `"${nom(x.l)}"`).join(', ')} sin cambio de importe.`);
      }
      lineas = tpl.lineas.map((l, i) => lineFrom(l, sg * imps[i], l.obs));
    }
    const suma = R(lineas.reduce((a, l) => a + l.importe, 0));
    if (Math.abs(suma - total) > 0.005 && !dudoso) { avisos.push('Las partidas no suman el importe del cargo.'); dudoso = true; }
    return { lineas, avisos, dudoso, prestamoNuevo };
  };

  /* ---------- Aplicar / deshacer (mismo criterio que tus hojas de Desglose) ----------
     · El cargo original pasa a Estado AR con la clasificación de cabecera.
     · Se añade un apunte AR de signo contrario que lo anula.
     · Se añaden las partidas (Estado R) que suman el importe del cargo. */
  App.applyDesglose = async (m, lineas, ctx = {}) => {
    const tpl = ctx.tpl, S = App.state;
    const p = ctx.prestamoNuevo ? App.idx.ptmo[ctx.prestamoNuevo.id] : null;
    const snapshot = p ? { id: p.id, capitalPendiente: p.capitalPendiente, fechaCapital: p.fechaCapital, tipoAnual: p.tipoAnual, cuota: p.cuota, cuotasPendientes: p.cuotasPendientes } : null;
    if (tpl) Object.assign(m, { tipo: tpl.cabecera.tipo, area: tpl.cabecera.area, agrup: tpl.cabecera.agrup, activo: tpl.cabecera.activo, beneficiario: tpl.cabecera.beneficiario });
    m.estado = 'AR'; m.desglose = { plantilla: tpl?.id || null, prestamoAntes: snapshot, fechaAplicado: new Date().toISOString() };
    const base = { fecha: m.fecha, fechaValor: m.fechaValor, cuenta: m.cuenta, concepto: m.concepto, saldo: null, desgloseDe: m.id, mesRec: m.mesRec || null };
    const nuevos = [{ ...base, estado: 'AR', importe: R(-m.importe), tipo: m.tipo, area: m.area, agrup: m.agrup, activo: m.activo, beneficiario: m.beneficiario, idRecibo: `${m.area}:${m.agrup}:${m.activo || ''}`, obs: 'Anula el cargo desglosado' }];
    lineas.filter(l => Math.abs(l.importe) >= 0.005).forEach(l => nuevos.push({ ...base, estado: 'R', importe: l.importe, tipo: l.tipo, area: l.area, agrup: l.agrup, activo: l.activo, beneficiario: l.beneficiario, idRecibo: `${l.area}:${l.agrup}:${l.activo || ''}`, obs: l.obs || '', auto: tpl ? 'plantilla' : 'manual' }));
    if (p) Object.assign(p, ctx.prestamoNuevo);
    if (tpl && tpl.modo === 'fijos' && ctx.aprender !== false) tpl.lineas.forEach((l, i) => { if (lineas[i]) l.importe = R(Math.abs(lineas[i].importe)); });
    // Las pólizas que renovaban en este cargo pasan a renovar dentro de un año
    if (tpl && tpl.modo === 'fijos') { const lim = addDays(m.fecha, MARGEN_RENOV); tpl.lineas.forEach(l => { while (l.renovacion && l.renovacion <= lim) l.renovacion = addYear(l.renovacion); }); }
    if (tpl && tpl.modo === 'comision' && ctx.comisionPct != null) tpl.comisionPct = ctx.comisionPct;
    await App.addMovs(nuevos);
    return nuevos;
  };
  App.undoDesglose = async (m) => {
    const S = App.state;
    S.movimientos = S.movimientos.filter(x => x.desgloseDe !== m.id);
    const snap = m.desglose?.prestamoAntes; const p = snap && App.idx.ptmo[snap.id];
    if (p && p.fechaCapital === m.fecha) Object.assign(p, snap);
    m.estado = 'P'; delete m.desglose;
    await App.db.save();
  };
  App.hasDesglose = (m) => m.estado === 'AR' || !!m.desgloseDe;

  /* Cargos que encajan con una plantilla y aún no están desglosados */
  App.pendingDesgloses = () => App.state.movimientos.filter(m => !App.hasDesglose(m)).map(m => ({ m, tpl: App.matchTemplate(m) }))
    .filter(x => x.tpl && (!x.tpl.desde || x.m.fecha >= x.tpl.desde)).sort((a, b) => a.m.fecha < b.m.fecha ? -1 : 1);
  App.pendingReview = () => { const d = new Set(App.pendingDesgloses().map(x => x.m.id)); return App.state.movimientos.filter(m => m.estado === 'P' && !d.has(m.id) && !m.desgloseDe); };

  /* Pólizas que renuevan en los próximos `dias` días (o con renovación ya vencida y aún no aplicada) */
  App.proximasRenovaciones = (dias = 45) => {
    const hasta = addDays(App.today(), dias), out = [];
    (App.state.plantillas || []).filter(t => t.activa !== false && t.modo === 'fijos').forEach(t => t.lineas.forEach(l => {
      if (l.renovacion && l.renovacion <= hasta) out.push({ tpl: t, linea: l, fecha: l.renovacion, vencida: l.renovacion < App.today() });
    }));
    return out.sort((a, b) => a.fecha < b.fecha ? -1 : 1);
  };

  /* Aplica en orden cronológico todos los desgloses que cuadran solos; devuelve cuántos */
  App.autoDesglosar = async (lista) => {
    let n = 0;
    for (const { m, tpl } of (lista || App.pendingDesgloses())) {
      const r = App.computeDesglose(m, tpl);
      if (!r.dudoso) { await App.applyDesglose(m, r.lineas, { tpl, prestamoNuevo: r.prestamoNuevo }); n++; }
      else if (m.estado !== 'P') m.estado = 'P';
    }
    if (n) await App.db.save();
    return n;
  };

  /* ---------- Reglas de clasificación ---------- */
  App.ruleKey = (concepto) => {
    let k = App.norm(String(concepto || '').split(/[;:]/)[0]).replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (k.length < 4) k = App.norm(concepto).replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
    return k.slice(0, 40).trim();
  };
  App.matchRule = (m) => {
    const c = App.norm(m.concepto);
    return (App.state.reglas || []).filter(r => r.texto && c.includes(App.norm(r.texto)) && (!r.cuenta || r.cuenta === m.cuenta) && (!r.signo || (r.signo === '-' ? m.importe < 0 : m.importe > 0)))
      .sort((a, b) => b.texto.length - a.texto.length)[0] || null;
  };
  App.saveRule = async (texto, m, cuenta) => {
    texto = (texto || '').trim(); if (!texto) return;
    const S = App.state; S.reglas = S.reglas || [];
    const ex = S.reglas.find(r => App.norm(r.texto) === App.norm(texto) && (r.cuenta || '') === (cuenta || ''));
    const v = { texto, cuenta: cuenta || '', signo: m.importe < 0 ? '-' : '+', tipo: m.tipo, area: m.area, agrup: m.agrup, activo: m.activo || '', beneficiario: m.beneficiario || '' };
    if (ex) Object.assign(ex, v); else S.reglas.push({ id: App.uid('R'), ...v });
  };
  /* Clasificación automática de un movimiento nuevo: plantilla > regla > histórico */
  App.autoClassify = (r) => {
    const tpl = App.matchTemplate(r);
    if (tpl) { Object.assign(r, { tipo: tpl.cabecera.tipo, area: tpl.cabecera.area, agrup: tpl.cabecera.agrup, activo: tpl.cabecera.activo, beneficiario: tpl.cabecera.beneficiario }); return { via: 'plantilla', tpl, score: 100, fiable: true }; }
    const rule = App.matchRule(r);
    if (rule) { ['tipo', 'area', 'agrup', 'activo', 'beneficiario'].forEach(k => { if (rule[k] !== undefined && rule[k] !== '') r[k] = rule[k]; }); return { via: 'regla', rule, score: 100, fiable: true }; }
    const s = App.suggest(r.concepto, r.cuenta, r.importe);
    if (s) { Object.assign(r, { tipo: r.tipo || s.tipo, area: r.area || s.area, agrup: s.agrup, activo: r.activo || s.activo, beneficiario: r.beneficiario || s.beneficiario }); return { via: 'historico', score: s.score, fiable: s.score >= (App.state.settings.umbralSimilitud || 60) }; }
    return { via: null, score: 0, fiable: false };
  };
})(window.App);
