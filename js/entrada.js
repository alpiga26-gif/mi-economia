/* Bandeja de entrada en Drive (MiEconomia/Entrada): reconoce cada extracto, lo importa sin duplicados,
   aplica plantillas y reglas, y lo archiva renombrado en MiEconomia/Extractos/<cuenta>/<año>/ */
(function (App) {
  const JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  const R = App.round2;
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
  const ext = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();

  /* ---------- Reconocimiento de la cuenta ---------- */
  // 1) identificadores aprendidos (IBAN / nº de tarjeta guardados en el maestro de cuentas)
  // 2) IBAN o CCC del archivo: sus 4 últimas cifras coinciden con las del código de cuenta (Caix_0002, San_1271…)
  // 3) tarjeta: entidad del archivo + cuenta de tipo Tarjeta de esa entidad
  // 4) BBVA sin número de cuenta: la cuenta cuyo saldo y movimientos encajan con el archivo
  const BANCOS = [['BBVA', /BBVA|Fecha de generaci.n del informe/i], ['Santander', /SANTANDER/i], ['Caixa', /CAIXA|\b2100\b|ES\d\d ?2100/i], ['Trade Republic', /TRADE REPUBLIC/i]];
  function detectCuenta(cabecera, tarjetas, rows, nombre = '', firma = '') {
    const C = App.state.cuentas, dCab = digits(cabecera);
    // si el nombre del archivo lleva el número de una cuenta ("Cta 3371 extracto.xlsx"), esa cuenta manda (se ignoran años)
    const enNombre = (nombre.match(/(?<!\d)\d{4}(?!\d)/g) || []).filter(n => !/^(19|20)\d\d$/.test(n));
    const porNombre = C.find(c => App.cuentaGrupo(c) !== 'Tarjetas' && enNombre.includes((c.id.match(/\d{4}/) || [])[0]));
    if (porNombre) return { cuenta: porNombre.id, motivo: `nº ${(porNombre.id.match(/\d{4}/) || [])[0]} en el nombre del archivo`, ident: '' };
    for (const c of C) for (const id of (c.identificadores || [])) { const d = digits(id); if (d.length >= 8 && (dCab.includes(d) || tarjetas.some(t => digits(t) === d))) return { cuenta: c.id, motivo: 'identificador guardado', ident: id }; }
    // IBAN español: ES + 2 dígitos + 20 dígitos (con o sin espacios cada 4)
    const iban = (cabecera.match(/ES\d{2}(?:\s?\d{4}){5}/) || cabecera.match(/CCC:?\s*(?:\d{4}\s?){2}\d{2}\s?\d{10}/) || [])[0];
    if (iban) { const d4 = digits(iban).slice(-4); const c = C.find(c => (c.id.match(/\d{4}/) || [])[0] === d4); if (c) return { cuenta: c.id, motivo: 'IBAN …' + d4, ident: iban.replace(/^CCC:?\s*/, '').trim() }; }
    const banco = (BANCOS.find(([, re]) => re.test(cabecera)) || [])[0] || '';
    const pan = tarjetas[0] || (cabecera.match(/\b(\d{4}\s?\d{4}\s?\d{4}\s?\d{4})\b/) || [])[1];
    const esTarjeta = !!tarjetas.length || /CREDITO|TARJETA/i.test(cabecera) && !!pan;
    if (esTarjeta && banco) { const c = C.find(c => App.cuentaGrupo(c) === 'Tarjetas' && new RegExp(banco.split(' ')[0], 'i').test(c.banco + ' ' + c.id)); if (c) return { cuenta: c.id, motivo: 'tarjeta ' + banco, ident: pan ? digits(pan) : '' }; }
    if (banco) {
      const cands = C.filter(c => App.cuentaGrupo(c) !== 'Tarjetas' && new RegExp(banco.split(' ')[0], 'i').test(c.banco));
      let best = null;
      cands.forEach(c => {
        const prev = App.state.movimientos.filter(m => (m.cuenta || '').toLowerCase() === c.id.toLowerCase() && !m.desgloseDe);
        const keys = new Set(prev.map(m => `${m.fecha}|${R(m.importe).toFixed(2)}`));
        let sc = rows.filter(r => keys.has(`${r.fecha}|${R(r.importe).toFixed(2)}`)).length;
        const first = rows.slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1).find(r => r.saldo != null);
        if (first && prev.length) { const b = App.balanceAt(c.id, App.addDays(first.fecha, -1)).saldo; if (Math.abs(b - (first.saldo - first.importe)) < 0.05) sc += 10; }
        if (!best || sc > best.sc) best = { c, sc };
      });
      if (best && (best.sc > 0 || cands.length === 1)) return { cuenta: best.c.id, motivo: best.sc ? `${banco}: encaja con su saldo/movimientos` : banco, ident: '', banco };
      // solo se recuerda lo que eliges tú a mano (no lo que la app dedujo), por banco y formato de archivo
      const recordada = (App.state.settings.cuentaPorFormato || {})[banco + '|' + (firma || '')];
      if (recordada && App.cuentaOf(recordada)) return { cuenta: recordada, motivo: `${banco}: la cuenta que elegiste la última vez para este tipo de archivo`, ident: '', banco };
      return { cuenta: '', motivo: `${banco}: el archivo no indica la cuenta, elígela (se recordará)`, ident: '', banco };
    }
    return { cuenta: App._cap.detectAccount(cabecera) || '', motivo: 'por el nombre del archivo', ident: '' };
  }

  /* ---------- Trade Republic (solo da extracto en PDF) ----------
     El signo de cada movimiento se obtiene de la diferencia entre saldos consecutivos. */
  function rowsTradeRepublic(text) {
    const T = text.replace(/\s+/g, ' ');
    const ini = App.parseNum((T.match(/Cuenta corriente\s+(-?[\d.]+,\d{2})\s*€/i) || [])[1]);
    const a = T.search(/TRANSACCIONES DE CUENTA/i), b = T.search(/RESUMEN DEL BALANCE/i);
    const seg = T.slice(a >= 0 ? a : 0, b > a ? b : undefined);
    // Cada movimiento empieza por "día mes"; el año puede ir pegado o aparecer más adelante (según cómo se lea el PDF)
    const dre = /\b(\d{1,2})\s+(?:(20\d{2})\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\.?(?:\s+(20\d{2}))?\b/gi;
    const ms = [...seg.matchAll(dre)];
    const periodo = (T.match(/\b20\d{2}\b/) || [String(new Date().getFullYear())])[0];
    const out = []; let prev = ini, anio = periodo;
    ms.forEach((m, i) => {
      const block = seg.slice(m.index + m[0].length, i + 1 < ms.length ? ms[i + 1].index : undefined);
      const am = [...block.matchAll(/(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*€/g)]; if (am.length < 2) return;
      const imp = App.parseNum(am[am.length - 2][1]), bal = App.parseNum(am[am.length - 1][1]);
      let v = prev != null ? R(bal - prev) : null;
      if (v == null || Math.abs(Math.abs(v) - imp) > 0.02) v = /outgoing|buy|compra|salida|tarjeta|card/i.test(block) ? -imp : imp;
      anio = m[2] || m[4] || (block.match(/\b(20\d{2})\b/) || [])[1] || anio;
      const fecha = `${anio}-${String(MESES[m[3].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      // descripción: el texto del bloque sin importes, años, IBAN de cabecera ni pies de página
      const concepto = block.replace(/(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*€/g, ' ').replace(/\b20\d{2}\b/g, ' ').replace(/FECHA TIPO DESCRIPCI.N.*?BALANCE( DINERO DINERO)?/i, ' ')
        .replace(/Trade Republic Bank GmbH, Sucursal.*$/i, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      out.push({ fecha, fechaValor: null, importe: R(v), saldo: bal, concepto });
      prev = bal;
    });
    return out;
  }

  /* ---------- Recibos, justificantes y facturas ----------
     De cada documento se extrae: cuenta (IBAN, IBAN enmascarado o nº de tarjeta), fechas, importes y emisor.
     Después se busca el movimiento que justifica: misma cuenta, mismo importe y fecha cercana. */
  const MESL = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const EMISOR = [
    /Entidad emisora\s+(.+?)\s+-\s+[A-Z]\d/i, /ACREEDOR:\s*(.+?)\s+ID\.? ?ACREEDOR/i, /ORGANISMO\s+CONTRIBUYENTE\s+(.+?)\s+(?:[A-ZÑ]+ ){1,4}Concepto/i,
    /NIF EMISOR\s+\S+\s+(.+?)\s+C[ÓO]DIGO/i, /Titular\s+[\d.\/]+\s+(.+?(?:S\.?A\.?U?\.?|S\.?L\.?U?\.?))\s/i, /Por cuenta de\s+(.+?)\s+Concepto/i,
    /ORDENANTE:\s*(.+?)\s+POR CUENTA/i, /Compa[ñn][íi]a Aseguradora:\s*(.+?)\s+Producto/i, /Nombre completo del ordenante\s+(.+?)\s+(?:Referencia|Más|$)/i,
    /Concepto espec[íi]fico\s+(.+?)\s+Remitente/i
  ];
  const MARCAS = [[/Liquidaci[óo]n de tu pr[ée]stamo/i, 'BBVA Préstamo'], [/Pr[ée]stamos\s+Recibo/i, 'CaixaBank Préstamo'], [/Cargo Agrupado MyBox/i, 'MyBox'],
    [/TRADE REPUBLIC/i, 'Trade Republic'], [/Endesa Energ[íi]a/i, 'Endesa'], [/Iberdrola/i, 'Iberdrola'], [/Vodafone/i, 'Vodafone'], [/Naturgy/i, 'Naturgy'], [/VIDACAIXA/i, 'VidaCaixa'], [/CREDITO AQUA/i, 'BBVA Tarjeta Aqua']];
  App.analyzeDoc = (text, name = '') => {
    const T = String(text || '').replace(/\s+/g, ' ');
    const fechas = new Set();
    for (const m of T.matchAll(/(?<!\d)(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?![\d.\/-])/g)) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] <= 31 && y >= '2000' && y <= '2099') fechas.add(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`); }
    for (const m of T.matchAll(/(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre) de (\d{4})/gi)) fechas.add(`${m[3]}-${String(MESL[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    const fechaCargo = (T.match(/(?:fecha (?:de )?cargo|VENCIMIENTO:?|hemos cargado|El d[íi]a)\D{0,25}(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/i) || [])[1];
    const importes = new Set(), NUM = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+\\.\\d{2})(?![\\d.,]|\\s*%)';
    const toNum = (s) => App.parseNum(s.includes(',') ? s : s.replace('.', ','));
    for (const m of T.matchAll(new RegExp('(?<![\\d.,])' + NUM, 'g'))) { const v = toNum(m[1]); if (v > 0) importes.add(R(v)); }   // los porcentajes no son importes
    // importe destacado: el que acompaña a "Importe total", "Total", "hemos cargado"…; si el documento solo tiene uno, ese
    const LBL = ['hemos cargado en tu cuenta', 'asciende a', 'IMPORTE TOTAL', 'Importe Total', 'Importe Recibo', 'IMPORTE\\s*:', 'Importe\\s*-', '\\bTOTAL\\b', '\\bTotal\\b', 'siguiente recibo[^:]*:', 'Importe'];
    let principal = null;
    for (const l of LBL) {
      // para "TOTAL" vale el último (en liquidaciones de valores el último total es el neto cobrado)
      const ms = [...T.matchAll(new RegExp(l + '[^\\d€]{0,25}?(?:\\*+\\s*)?' + NUM, 'g'))];
      if (ms.length) { principal = toNum(ms[/TOTAL|Total/.test(l) && !/IMPORTE|Importe/.test(l) ? ms.length - 1 : 0][1]); break; }
    }
    if (/DESPU[ÉE]S DE IMPUESTOS/i.test(T)) { const m = T.match(new RegExp('DESPU[ÉE]S DE IMPUESTOS.*?' + NUM + '\\s*EUR\\s*(?:Trade|$)', 'i')); if (m) principal = toNum(m[1]); }
    if (principal == null && importes.size === 1) principal = [...importes][0];
    let emisor = '', emisorDebil = false;
    for (const re of EMISOR) { const m = T.match(re); if (m) { emisor = m[1].trim(); emisorDebil = re === EMISOR[EMISOR.length - 1]; break; } }   // "Concepto específico" no es un proveedor fiable
    // corta el emisor donde empiezan otros campos o el nombre de un titular (los titulares se configuran en Ajustes, no en el código)
    const tits = (App.state.settings.titulares || []).map(t => String(t).trim()).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    emisor = emisor.replace(new RegExp(`\\s+(Titular|Referencia|Concepto|Importe${tits.length ? '|' + tits.join('|') : ''})\\b.*$`, 'i'), '').replace(/\s*\(.*$/, '').replace(/[\s,.(]+$/, '');
    const marca = MARCAS.find(([re]) => re.test(T)); if (marca && (!emisor || /Pago Fra|^\d/.test(emisor))) emisor = marca[1];
    const tipoDoc = /DATOS DE LA FACTURA|^\s*Factura/i.test(T) ? 'Factura' : /EX ANTE|Informaci[óo]n trimestral|Evoluci[óo]n de sus ahorros/i.test(T) ? 'Informe'
      : /Liquidaci[óo]n/i.test(T) ? 'Liquidacion' : /Justificante|INFORME DE INTERESES/i.test(T) ? 'Justificante' : /abono|a su favor/i.test(T) ? 'Abono' : /recibo|adeudo|domiciliaci|cargo/i.test(T) ? 'Recibo' : 'Documento';
    // fecha del documento: la de cargo si se indica; si no, la más reciente que no sea futura (evita vencimientos o el recibo del mes siguiente)
    const fs = [...fechas].sort(), hoy = App.addDays(App.today(), 3);
    const fechaDoc = (fechaCargo && App.parseDate(fechaCargo)) || fs.filter(f => f <= hoy).pop() || fs[0] || null;
    // cuentas citadas: IBAN completo, IBAN o CCC enmascarado (XXXX…5004) o tarjeta (…** 0219)
    const dig = digits(T), cuentas = new Set();
    App.state.cuentas.forEach(c => {
      const ids = (c.identificadores || []).map(digits).filter(d => d.length >= 10);
      if (ids.some(d => dig.includes(d.slice(-10)))) return cuentas.add(c.id);
      const last4 = [...new Set([(c.id.match(/\d{4}/) || [])[0], ...ids.map(d => d.slice(-4))].filter(Boolean))];
      if (last4.some(l => new RegExp(`(?:ES\\d\\d(?:\\s?[\\dX*]{4}){4}\\s?|[X*]{2,}\\s?)${l}(?!\\d)`, 'i').test(T))) cuentas.add(c.id);
    });
    return { fechas: fs, fechaCargo: fechaCargo ? App.parseDate(fechaCargo) : null, fechaDoc, importes: [...importes], principal, emisor: emisor.replace(/\s+/g, ' ').slice(0, 60), emisorDebil, tipoDoc, cuentas: [...cuentas] };
  };
  const dias = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;
  /* Movimiento al que corresponde un documento (o null). `usados` evita asignar dos veces el mismo justificante a un movimiento con el mismo importe. */
  App.matchDoc = (info, usados = new Set()) => {
    if (!info || !info.importes.length) return null;
    const imps = new Set(info.importes.map(v => v.toFixed(2)));
    const fechas = info.fechaCargo ? [info.fechaCargo, ...info.fechas] : info.fechas;
    const canon = (id) => (App.cuentaOf(id)?.id || id || '').toLowerCase();
    const cts = new Set(info.cuentas.map(c => c.toLowerCase()));
    let best = null;
    // Sin cuenta ni importe destacado no hay base para emparejar; los informes solo si citan la cuenta
    if (!cts.size && info.principal == null) return null;
    if (info.tipoDoc === 'Informe' && !cts.size) return null;
    App.state.movimientos.forEach(m => {
      if (usados.has(m.id) || m.importe == null || !imps.has(Math.abs(+m.importe).toFixed(2))) return;
      if (m.estado === 'AR' && m.desgloseDe) return;            // el apunte que anula un cargo no se justifica
      if (cts.size && !cts.has(canon(m.cuenta))) return;
      // cualquier fecha del documento sirve para descartar, pero manda la fecha de cargo (dos cuotas iguales en meses seguidos)
      const dMin = fechas.length ? Math.min(...fechas.map(f => dias(f, m.fecha))) : 0;
      if (dMin > 15) return;
      const d = info.fechaDoc ? dias(info.fechaDoc, m.fecha) : dMin;
      if (d > 31) return;
      const esPrincipal = info.principal != null && Math.abs(Math.abs(m.importe) - info.principal) < 0.005;
      // un importe secundario del documento (base, impuesto, neto…) solo vale si cita la cuenta y la fecha casi coincide
      if (!esPrincipal && (!cts.size || d > 2)) return;
      let sc = d;
      if (esPrincipal) sc -= 3;                                   // importe destacado del documento
      if (!cts.size) sc += 2;                                     // sin cuenta en el documento: menos seguro
      if (m.desgloseDe) sc += 0.5;                                // mejor el cargo que una partida, salvo que la partida case mejor
      if (m.doc) sc += 1;                                         // ya tiene un documento
      if (!best || sc < best.sc) best = { m, sc, d };
    });
    return best ? { m: best.m, dias: Math.round(best.d), seguro: best.sc <= 3 && info.cuentas.length > 0 } : null;
  };
  /* Recibos que forman parte de un cargo agrupado (p. ej. MyBox = hogar + hogar + alarma): si varios documentos sin
     movimiento de la misma cuenta suman exactamente un cargo de esas fechas, se vinculan todos a ese cargo. */
  App.matchGrupos = (docs, usados = new Set()) => {
    const out = new Map();
    const porCuenta = {};
    docs.filter(d => d.info && d.info.principal && d.info.cuentas.length).forEach(d => d.info.cuentas.forEach(c => (porCuenta[c] = porCuenta[c] || []).push(d)));
    Object.entries(porCuenta).forEach(([cta, ds]) => {
      if (ds.length < 2 || ds.length > 10) return;
      App.state.movimientos.filter(m => !m.desgloseDe && (App.cuentaOf(m.cuenta)?.id || m.cuenta) === cta).forEach(m => {
        const objetivo = Math.round(Math.abs(m.importe) * 100);
        const cerca = ds.filter(d => !out.has(d) && [d.info.fechaDoc, ...d.info.fechas].some(f => f && dias(f, m.fecha) <= 3));
        for (let mask = 1; mask < (1 << cerca.length); mask++) {      // busca la combinación (de 2 o más) que suma el cargo
          const sel = cerca.filter((_, i) => mask & (1 << i)); if (sel.length < 2) continue;
          if (sel.reduce((a, d) => a + Math.round(d.info.principal * 100), 0) === objetivo) { sel.forEach(d => out.set(d, m)); break; }
        }
      });
    });
    return out;
  };
  /* Nombre según tu convención; si el movimiento no tiene beneficiario se usa el emisor del documento */
  // el proveedor es quien emite el documento; si no se reconoce, el beneficiario del movimiento
  const nombreDoc = (m, info, e) => App.docName({ ...m, beneficiario: (info.emisorDebil ? m.beneficiario || info.emisor : info.emisor || m.beneficiario) || 'Proveedor' }, e);
  // documento sin movimiento (informes, justificantes anuales…): Doc-Tipo-Emisor-AAAA_MM_DD
  const nombreSinMov = (info, e) => ['Doc', info.tipoDoc, App.docClean(info.emisor || 'Desconocido').slice(0, 40)].map(s => App.docClean(s) || 'X').join('-') + '-' + App.docFecha(info.fechaDoc) + '.' + e;

  /* ---------- Los PDF siguen al movimiento ----------
     El nombre de cada documento vinculado se deriva de la clasificación de su movimiento. Si corriges el movimiento
     (tipo, área, activo, categoría, fecha…) el PDF se renombra en Drive. Si el nombre nuevo coincide con el de otro
     documento, no se renombra: queda en Revisar para que decidas. */
  const sinSufijo = (n) => String(n || '').replace(/ \(\d+\)(\.[^.]+)$/, '$1').toLowerCase();
  App.docsOf = (m) => (m.docs && m.docs.length ? m.docs : (m.doc ? [m.doc] : []));
  App.docNameFor = (m, d) => App.docName({ ...m, beneficiario: d.proveedor || m.beneficiario || 'Proveedor' }, ext(d.name || '') || 'pdf');
  App.docsPorRenombrar = () => {
    const out = [], todos = [];
    App.state.movimientos.forEach(m => App.docsOf(m).forEach(d => { if (d.id) todos.push({ m, d }); }));
    const ocupados = {}; todos.forEach(({ d }) => { const k = sinSufijo(d.name); ocupados[k] = (ocupados[k] || 0) + 1; });
    todos.forEach(({ m, d }) => {
      if (d.manual) return;                                       // nombre puesto a mano: no se toca
      const nuevo = App.docNameFor(m, d);
      if (sinSufijo(nuevo) === sinSufijo(d.name)) { delete d.conflicto; return; }
      const choca = (ocupados[sinSufijo(nuevo)] || 0) > 0 || out.some(x => sinSufijo(x.nuevo) === sinSufijo(nuevo));
      if (choca) d.conflicto = nuevo; else { delete d.conflicto; out.push({ m, d, nuevo }); }
    });
    return out;
  };
  App.docsConflicto = () => { const out = []; App.state.movimientos.forEach(m => App.docsOf(m).forEach(d => { if (d.conflicto) out.push({ m, d }); })); return out; };
  let renT = null, renombrando = false;
  App.syncDocNames = async () => {
    if (renombrando || !App.drive?.connected) return 0;
    renombrando = true; let n = 0;
    try {
      for (const { m, d, nuevo } of App.docsPorRenombrar()) {
        try { const r = await App.drive.rename(d.id, nuevo); d.name = r.name || nuevo; if (r.webViewLink) d.url = r.webViewLink; n++; }
        catch (e) { console.warn('No se pudo renombrar', d.name, e); }
      }
      if (n || App.docsConflicto().length) { await App.db.save({ noRename: true }); App.updateBadge(); if (App.route.name === 'revisar') App.render(); }
      if (n) App.toast(`📎 ${n} documento(s) renombrados en Drive según la corrección`);
    } finally { renombrando = false; }
    return n;
  };
  App.scheduleDocRename = () => { clearTimeout(renT); renT = setTimeout(() => App.syncDocNames(), 2500); };

  /* ---------- Lectura de un archivo (Blob) ---------- */
  App.parseStatement = async (name, blob) => {
    const e = ext(name);
    if (['xlsx', 'xls', 'xlsm', 'csv'].includes(e)) {
      const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellDates: true });
      for (const sn of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
        const h = App._cap.detectHeader(aoa); if (!h) continue;
        const rows = App._cap.rowsFromSheet(aoa, h, '');
        if (!rows.length) continue;
        const cab = name + ' ' + aoa.slice(0, Math.min(h.row + 1, 12)).map(r => r.join(' ')).join(' ');
        const tarjetas = h.map.tarjeta != null ? Array.from(new Set(aoa.slice(h.row + 1).map(r => String(r[h.map.tarjeta] || '')).filter(t => digits(t).length >= 15))) : [];
        const yaTieneCuenta = rows.some(r => r.cuenta);
        const firma = h.headers.map(x => App.norm(x)).filter(Boolean).join('|');   // "huella" del formato de columnas
        const det = yaTieneCuenta ? { cuenta: '', motivo: 'el archivo trae la columna Cuenta' } : detectCuenta(cab, tarjetas, rows, name, firma);
        return { tipo: 'extracto', formato: (BANCOS.find(([, re]) => re.test(cab)) || ['Excel'])[0], rows, ...det, firma, multiCuenta: yaTieneCuenta };
      }
      return { tipo: 'desconocido', error: 'No se ha encontrado una tabla de movimientos (Fecha / Concepto / Importe).' };
    }
    if (e === 'pdf') {
      const text = await App._cap.fileText(new File([blob], name, { type: 'application/pdf' }));
      if (/TRADE REPUBLIC/i.test(text) && /TRANSACCIONES DE CUENTA/i.test(text)) {
        const rows = rowsTradeRepublic(text);
        return { tipo: 'extracto', formato: 'Trade Republic (PDF)', rows, ...detectCuenta(name + ' ' + text.slice(0, 1500), [], rows) };
      }
      // PDF de extracto genérico: solo si tiene bastantes líneas de movimientos, se sabe la cuenta y no es un recibo/justificante
      const rows = App._cap.rowsFromText(text, '');
      if (rows.length >= 5 && /extracto|movimientos/i.test(text) && !/justificante|recibo|factura|liquidaci|adeudo|planes? de pensiones/i.test(text)) {
        const det = detectCuenta(name + ' ' + text.slice(0, 1500), [], rows);
        if (det.cuenta) return { tipo: 'extracto', formato: 'PDF', rows, ...det };
      }
      return { tipo: 'documento', texto: text, info: App.analyzeDoc(text, name) };
    }
    if (/^(jpe?g|png|heic|webp)$/.test(e)) { const text = await App._cap.fileText(new File([blob], name, { type: 'image/' + e })).catch(() => ''); return { tipo: 'documento', texto: text, info: App.analyzeDoc(text, name) }; }
    return { tipo: 'desconocido', error: 'Tipo de archivo no admitido.' };
  };

  /* ---------- Lista de archivos de Entrada (los ZIP se abren y se tratan sus archivos) ---------- */
  const carpetaDatos = () => App.state.settings.carpetaDatos || 'MiEconomia';
  App.entradaId = () => App.drive.folderPath([carpetaDatos(), 'Entrada']);
  async function cargarEntrada() {
    const fid = await App.entradaId();
    const files = (await App.drive.listFolder(fid)).filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
    const items = [];
    for (const f of files) {
      const blob = await App.drive.download(f.id);
      if (ext(f.name) === 'zip') {
        await App.loadScript(JSZIP); const z = await JSZip.loadAsync(blob);
        for (const [n, entry] of Object.entries(z.files)) if (!entry.dir && !/__MACOSX|\/\./.test(n)) items.push({ name: n.split('/').pop(), blob: await entry.async('blob'), zip: f });
        items.push({ name: f.name, file: f, esZip: true });
      } else items.push({ name: f.name, blob, file: f });
    }
    for (const it of items) if (!it.esZip) { try { it.res = await App.parseStatement(it.name, it.blob); } catch (e) { console.error(e); it.res = { tipo: 'desconocido', error: e.message }; } }
    // nombres que ya hay en Facturas, para no repetir
    try { items.nombresFacturas = new Set((await App.drive.listFolder(await App.drive.facturasId())).map(f => sinSufijo(f.name))); } catch (e) { items.nombresFacturas = new Set(); }
    return items;
  }
  /* Nombre propuesto para cada documento y detección de nombres repetidos (con Facturas, con otros documentos
     vinculados o dentro del propio lote): los repetidos se quedan en Entrada para revisión */
  function nombrarDocs(items) {
    const docs = items.filter(it => it.res?.tipo === 'documento');
    const existentes = new Set([...(items.nombresFacturas || []), ...App.state.movimientos.flatMap(m => App.docsOf(m).map(d => sinSufijo(d.name)))]);
    docs.forEach(it => { if (!it.nombreManual) { const e = ext(it.name) || 'pdf', m = it.match?.m; it.nombre = m ? nombreDoc(m, it.res.info, e) : nombreSinMov(it.res.info, e); } });
    const cuenta = {}; docs.forEach(it => { const k = sinSufijo(it.nombre); cuenta[k] = (cuenta[k] || 0) + 1; });
    docs.forEach(it => {
      const k = sinSufijo(it.nombre);
      it.repetido = existentes.has(k) || cuenta[k] > 1;
      if (!it.destinoManual) it.destino = it.repetido ? 'dejar' : 'facturas';
    });
  }
  App.contarEntrada = async () => { try { const n = (await App.drive.listFolder(await App.entradaId())).filter(f => f.mimeType !== 'application/vnd.google-apps.folder').length; App.entradaPendientes = n; App.updateBadge(); return n; } catch (e) { return null; } };

  /* ---------- Importar y archivar ---------- */
  /* Asigna a cada documento su movimiento: primero uno a uno y después los recibos que juntos forman un cargo agrupado */
  function emparejarDocs(docs) {
    const usados = new Set();
    docs.forEach(it => { const mt = App.matchDoc(it.res.info, usados); it.match = mt; if (mt) usados.add(mt.m.id); });
    const grupos = App.matchGrupos(docs.filter(it => !it.match).map(it => ({ it, info: it.res.info })));
    grupos.forEach((m, d) => { d.it.match = { m, grupo: true, seguro: true }; });
  }

  async function procesar(items, onStep) {
    const resumen = { importados: 0, duplicados: 0, archivos: 0, documentos: 0, errores: [] };
    const extractosId = await App.drive.folderPath([carpetaDatos(), 'Extractos']);
    for (const it of items) {
      if (it.esZip || it.omitir) continue;
      onStep && onStep(it.name);
      try {
        if (it.res?.tipo === 'extracto') {
          const cuenta = it.cuenta ?? it.res.cuenta;
          if (!cuenta && !it.res.multiCuenta) { resumen.errores.push(`${it.name}: falta indicar la cuenta`); continue; }
          const rows = App.classifyRows(it.res.rows.map(r => ({ ...r, cuenta: r.cuenta || cuenta })));
          const nuevos = rows.filter(r => !r._dup).map(r => { const m = {}; Object.keys(r).forEach(k => { if (k[0] !== '_') m[k] = r[k]; }); m.origen = it.name; return m; });
          resumen.duplicados += rows.length - nuevos.length;
          if (nuevos.length) await App.addMovs(nuevos);
          resumen.importados += nuevos.length;
          // aprende el IBAN / nº de tarjeta para reconocer la cuenta a la primera la próxima vez
          const c = App.cuentaOf(cuenta); if (c && it.res.ident && !(c.identificadores || []).some(x => digits(x) === digits(it.res.ident))) c.identificadores = [...(c.identificadores || []), it.res.ident];
          // si la elegiste tú a mano en un archivo sin número de cuenta, se recuerda para ese banco y formato
          if (c && it.cuentaManual && !it.res.ident && it.res.banco) App.state.settings.cuentaPorFormato = { ...(App.state.settings.cuentaPorFormato || {}), [it.res.banco + '|' + (it.res.firma || '')]: c.id };
          delete App.state.settings.cuentaPorBanco;   // criterio antiguo (por banco), que confundía las dos cuentas BBVA
          const fechas = it.res.rows.map(r => r.fecha).sort(), desde = fechas[0], hasta = fechas[fechas.length - 1];
          const destino = await App.drive.folderPath([carpetaDatos(), 'Extractos', cuenta || 'Varias', hasta.slice(0, 4)]);
          const nombre = `Extracto-${cuenta || 'Varias'}-${desde}_${hasta}.${ext(it.name)}`;
          if (it.zip) await App.drive.uploadTo(it.blob, nombre, destino); else await App.drive.move(it.file, destino, nombre);
          resumen.archivos++;
        }
      } catch (e) { console.error(e); resumen.errores.push(`${it.name}: ${e.message}`); }
    }
    // los ZIP ya abiertos se guardan en Extractos/ZIP procesados
    for (const it of items.filter(i => i.esZip && !i.omitir)) { try { await App.drive.move(it.file, await App.drive.folderPath([carpetaDatos(), 'Extractos', 'ZIP procesados'])); } catch (e) { resumen.errores.push(`${it.name}: ${e.message}`); } }
    resumen.desglosados = await App.autoDesglosar();
    // Documentos: con los movimientos ya importados, se busca a cuál corresponde cada uno, se renombra y se vincula
    resumen.vinculados = 0;
    const docs = items.filter(i => i.res?.tipo === 'documento' && i.destino !== 'dejar' && !i.omitir);
    const fid = docs.length ? await App.drive.facturasId() : null;
    emparejarDocs(docs);
    for (const it of docs) {
      onStep && onStep(it.name);
      try {
        const e = ext(it.name) || 'pdf';
        const m = it.match && it.match.m;
        const nombre = it.nombreManual ? it.nombre : (m ? nombreDoc(m, it.res.info, e) : nombreSinMov(it.res.info, e));
        const r = it.zip ? await App.drive.uploadTo(it.blob, nombre, fid) : await App.drive.move(it.file, fid, nombre);
        if (m) {
          const inf = it.res.info || {};
          const d = { id: r.id, url: r.webViewLink, name: r.name || nombre, proveedor: (inf.emisorDebil ? m.beneficiario || inf.emisor : inf.emisor || m.beneficiario) || '', manual: !!it.nombreManual };
          m.docs = [...(m.docs || []), d]; if (!m.doc) m.doc = d;
          resumen.vinculados++;
        }
        resumen.documentos++;
      } catch (e) { console.error(e); resumen.errores.push(`${it.name}: ${e.message}`); }
    }
    await App.db.save();
    return resumen;
  }

  /* ---------- Vista (pestaña "Entrada de Drive" en Escanear / Importar) ---------- */
  App.entradaPane = async (pane) => {
    if (!App.state.settings.googleClientId) { pane.innerHTML = '<div class="alert warn">Conecta Google Drive en Ajustes para usar la bandeja de entrada.</div>'; return; }
    pane.innerHTML = `<div class="card"><b>Leyendo ${App.esc(carpetaDatos())}/Entrada…</b><div class="progress mt"><div style="width:40%"></div></div></div>`;
    let items;
    try { items = await cargarEntrada(); } catch (e) { pane.innerHTML = `<div class="alert bad">No se pudo leer la carpeta Entrada: ${App.esc(e.message)}</div>`; return; }
    if (!items.length) { pane.innerHTML = `<div class="card"><p>✔ La carpeta <b>${App.esc(carpetaDatos())}/Entrada</b> está vacía.</p><p class="small muted">Descarga los Excel de movimientos de cada banco (y los PDF de recibos o avisos que quieras guardar) en esa carpeta de Drive y vuelve aquí.</p><button class="btn" id="reload">Volver a mirar</button></div>`; App.$('#reload', pane).onclick = () => App.entradaPane(pane); return; }
    const preview = (it) => {
      if (it.res?.tipo !== 'extracto') return null;
      const cuenta = it.cuenta ?? it.res.cuenta;
      const rows = App.classifyRows(it.res.rows.map(r => ({ ...r, cuenta: r.cuenta || cuenta })));
      const f = it.res.rows.map(r => r.fecha).sort();
      return { nuevos: rows.filter(r => !r._dup).length, dup: rows.filter(r => r._dup).length, dud: rows.filter(r => !r._dup && !r._ok).length, tpl: rows.filter(r => !r._dup && r._via === 'plantilla').length, desde: f[0], hasta: f[f.length - 1] };
    };
    /* Simula la importación de los extractos del lote para saber a qué movimiento irá cada documento */
    const previewDocs = () => {
      const tmp = [];
      items.filter(it => it.res?.tipo === 'extracto' && !it.omitir).forEach(it => {
        const cuenta = it.cuenta ?? it.res.cuenta; if (!cuenta && !it.res.multiCuenta) return;
        App.classifyRows(it.res.rows.map(r => ({ ...r, cuenta: r.cuenta || cuenta }))).filter(r => !r._dup).forEach(r => {
          const mv = { ...r, id: '_tmp' + tmp.length }; tmp.push(mv);
          // también las partidas que generarán las plantillas (MyBox, seguros…), para que cada recibo vaya a su partida
          const tpl = App.matchTemplate(mv);
          if (tpl && (!tpl.desde || mv.fecha >= tpl.desde)) { const d = App.computeDesglose(mv, tpl); if (!d.dudoso) d.lineas.forEach(l => tmp.push({ ...l, cuenta: mv.cuenta, fecha: mv.fecha, estado: 'R', desgloseDe: mv.id, id: '_tmp' + tmp.length })); }
        });
      });
      const S = App.state.movimientos; S.push(...tmp);
      try { emparejarDocs(items.filter(it => it.res?.tipo === 'documento')); nombrarDocs(items); }
      finally { S.splice(S.length - tmp.length, tmp.length); }
    };
    const render = () => {
      // conserva la posición (vertical y horizontal) al redibujar la tabla
      const wrap0 = pane.querySelector('.table-wrap'), sx = wrap0 ? wrap0.scrollLeft : 0, sy = window.scrollY;
      previewDocs();
      const ctaOpts = (sel) => `<option value="">— elegir cuenta —</option>` + App.state.cuentas.map(c => `<option value="${App.esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${App.esc(c.id)} · ${App.esc(c.banco)}</option>`).join('');
      pane.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">📥 ${App.esc(carpetaDatos())}/Entrada <span class="muted small">${items.filter(i => !i.esZip).length} archivos</span></h2><span class="spacer"></span><button class="btn" id="reload">Volver a mirar</button><button class="btn btn-primary" id="go">Importar y archivar</button></div>
        <div class="table-wrap mt"><table class="t entrada"><colgroup><col style="width:17%"><col style="width:17%"><col style="width:19%"><col style="width:10%"><col style="width:17%"><col style="width:5%"><col style="width:15%"></colgroup>
        <thead><tr><th>Archivo</th><th>Qué es</th><th>Cuenta</th><th>Periodo</th><th class="num">Nuevos</th><th class="num">Ya estaban</th><th>Acción</th></tr></thead><tbody>
        ${items.map((it, i) => {
          if (it.esZip) return `<tr><td>${App.esc(it.name)}</td><td colspan="5" class="muted small">ZIP abierto: sus archivos aparecen en la lista</td><td class="small">se guardará en Extractos/ZIP procesados</td></tr>`;
          const r = it.res || {}; const p = preview(it); const cuenta = it.cuenta ?? r.cuenta;
          if (r.tipo === 'extracto') return `<tr class="${cuenta || r.multiCuenta ? '' : 'row-warn'}"><td class="wrap small">${App.esc(it.name)}${it.zip ? `<br><span class="muted">dentro de ${App.esc(it.zip.name)}</span>` : ''}</td><td class="small">Extracto ${App.esc(r.formato || '')}<br><span class="muted">${App.esc(r.motivo || '')}</span></td>
            <td>${r.multiCuenta ? '<span class="small">según el archivo</span>' : `<select data-cta="${i}">${ctaOpts(cuenta)}</select>`}</td><td class="small">${App.fdate(p.desde)} – ${App.fdate(p.hasta)}</td>
            <td class="num"><b>${p.nuevos}</b>${p.tpl ? `<br><span class="small muted">${p.tpl} con plantilla</span>` : ''}${p.dud ? `<br><span class="small" style="color:var(--warn)">${p.dud} a revisar</span>` : ''}</td><td class="num">${p.dup}</td>
            <td class="small"><label class="row"><input type="checkbox" data-skip="${i}" ${it.omitir ? '' : 'checked'}> importar y archivar en Extractos/${App.esc(cuenta || '¿?')}</label></td></tr>`;
          if (r.tipo === 'documento') {
            const inf = r.info || {}, m = it.match?.m;
            return `<tr class="${it.repetido ? 'row-warn' : m ? (it.match.seguro ? 'row-ok' : '') : 'row-warn'}"><td class="wrap small">${App.esc(it.name)}</td>
            <td class="small">${App.esc(inf.tipoDoc || 'Documento')} · ${App.esc(inf.emisor || '¿emisor?')}${inf.principal ? `<br>${App.eur(inf.principal)}` : ''}</td>
            <td class="small">${App.esc((inf.cuentas || []).join(', ') || '—')}</td><td class="small">${App.fdate(inf.fechaDoc)}</td>
            <td colspan="2" class="wrap small">${m ? `→ ${App.esc(m.cuenta)} ${App.fdate(m.fecha)} <b>${App.num(m.importe)}</b> ${App.esc((m.concepto || '').slice(0, 40))}${it.match.seguro ? '' : ' <span class="tag warn">revisar</span>'}` : '<span style="color:var(--warn)">sin movimiento que coincida</span>'}
              <br><input data-nombre="${i}" value="${App.esc(it.nombre)}" style="width:100%;min-width:260px;font-size:.8rem" title="Puedes cambiar el nombre">
              ${it.repetido ? `<br><span class="tag warn">nombre repetido: cámbialo para guardarlo</span> <button class="btn btn-sm" data-sufijo="${i}" title="Añade el importe al nombre">＋ importe</button>` : ''}</td>
            <td><select data-doc="${i}"><option value="facturas" ${it.destino !== 'dejar' ? 'selected' : ''}>${m ? 'Vincular y guardar en Facturas' : 'Renombrar y guardar en Facturas'}</option><option value="dejar" ${it.destino === 'dejar' ? 'selected' : ''}>${it.repetido ? 'Dejar para revisión' : 'Dejar en Entrada'}</option></select></td></tr>`;
          }
          return `<tr><td class="wrap small">${App.esc(it.name)}</td><td colspan="5" class="small neg">${App.esc(r.error || 'No reconocido')}</td><td class="small muted">se queda en Entrada</td></tr>`;
        }).join('')}</tbody></table></div>
        <p class="small muted">Los movimientos que ya estaban (misma cuenta, fecha e importe) no se duplican. Cada extracto se archiva renombrado como <i>Extracto-cuenta-desde_hasta</i> en ${App.esc(carpetaDatos())}/Extractos/&lt;cuenta&gt;/&lt;año&gt;/. Los originales no se modifican.</p></div>`;
      { const w = pane.querySelector('.table-wrap'); if (w) w.scrollLeft = sx; window.scrollTo(0, sy); }
      App.$$('[data-cta]', pane).forEach(s => s.onchange = () => { const it = items[+s.dataset.cta]; it.cuenta = s.value; it.cuentaManual = true; render(); });
      App.$$('[data-skip]', pane).forEach(c => c.onchange = () => { items[+c.dataset.skip].omitir = !c.checked; render(); });
      App.$$('[data-doc]', pane).forEach(s => s.onchange = () => { const it = items[+s.dataset.doc]; it.destino = s.value; it.destinoManual = true; });
      // al cambiar el nombre se vuelve a comprobar si se repite; si ya no, pasa a guardarse
      App.$$('[data-nombre]', pane).forEach(inp => inp.onchange = () => { const it = items[+inp.dataset.nombre]; it.nombre = inp.value.trim() || it.nombre; it.nombreManual = true; it.destinoManual = false; render(); });
      App.$$('[data-sufijo]', pane).forEach(b => b.onclick = () => {
        const it = items[+b.dataset.sufijo], imp = it.match?.m ? Math.abs(it.match.m.importe) : it.res.info?.principal;
        it.nombre = it.nombre.replace(/(\.[^.]+)$/, `_${App.num(imp || 0).replace(/\./g, '')}€$1`); it.nombreManual = true; it.destinoManual = false; render();
      });
      App.$('#reload', pane).onclick = () => App.entradaPane(pane);
      App.$('#go', pane).onclick = async () => {
        const sinCuenta = items.filter(it => it.res?.tipo === 'extracto' && !it.omitir && !(it.cuenta ?? it.res.cuenta) && !it.res.multiCuenta);
        if (sinCuenta.length) return App.toast('Elige la cuenta de: ' + sinCuenta.map(i => i.name).join(', '), 5000);
        const btn = App.$('#go', pane); btn.disabled = true;
        const res = await procesar(items, (n) => { btn.textContent = 'Procesando ' + n + '…'; });
        App.entradaPendientes = 0; App.updateBadge();
        pane.innerHTML = `<div class="card stack"><h2>✔ Entrada procesada</h2>
          <p>${res.importados} movimientos nuevos importados · ${res.duplicados} ya estaban · ${res.desglosados} desglosados automáticamente · ${res.archivos} extractos archivados${res.documentos ? ` · ${res.documentos} documentos guardados en Facturas (${res.vinculados} vinculados a su movimiento)` : ''}.</p>
          ${res.errores.length ? `<div class="alert bad small">${res.errores.map(App.esc).join('<br>')}</div>` : ''}
          <div class="row"><a class="btn btn-primary" href="#/revisar">Ir a Revisar (${App.pendingDesgloses().length + App.pendingReview().length})</a><a class="btn" href="#/movimientos?todo=1">Ver movimientos</a></div></div>`;
      };
    };
    render();
  };
})(window.App);
