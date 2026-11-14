/* Captura de información: escaneo de facturas/tickets (OCR) e importación de extractos bancarios */
(function (App) {
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFW = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const AMT = /-?\d{1,3}(?:[.\s]\d{3})*,\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;

  /* ---------- Extracción de texto ---------- */
  async function pdfDoc(file) { await App.loadScript(PDFJS); pdfjsLib.GlobalWorkerOptions.workerSrc = PDFW; return pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; }
  async function pdfText(file) {
    const pdf = await pdfDoc(file); const lines = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      const rows = {}; tc.items.forEach(it => { const y = Math.round(it.transform[5] / 3); (rows[y] = rows[y] || []).push(it); });
      Object.keys(rows).sort((a, b) => b - a).forEach(y => lines.push(rows[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim()));
    }
    return { text: lines.join('\n'), pdf };
  }
  async function pdfToImage(pdf) { const page = await pdf.getPage(1); const vp = page.getViewport({ scale: 2 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; return c; }
  async function ocr(img, onProgress) {
    await App.loadScript(TESS);
    const r = await Tesseract.recognize(img, 'spa', { logger: m => m.status === 'recognizing text' && onProgress && onProgress(m.progress) });
    return r.data.text;
  }
  async function fileText(file, onProgress) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const { text, pdf } = await pdfText(file);
      if (text.replace(/\s/g, '').length > 30) return text;
      return ocr(await pdfToImage(pdf), onProgress); // PDF escaneado sin texto
    }
    return ocr(file, onProgress);
  }

  /* ---------- Análisis de ticket / factura ---------- */
  App.parseReceipt = (text) => {
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
    const amounts = (l) => (l.match(AMT) || []).map(App.parseNum).filter(v => v != null);
    let total = null;
    for (const l of lines) if (/total|a pagar|importe|tarjeta|efectivo/i.test(l) && !/sub ?total|base|iva\b|cambio/i.test(l)) { const a = amounts(l); if (a.length) { total = Math.abs(a[a.length - 1]); if (/total/i.test(l)) break; } }
    if (total == null) { const all = lines.flatMap(amounts).map(Math.abs); if (all.length) total = Math.max(...all); }
    let fecha = null; for (const l of lines) { const m = l.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (m) { const d = App.parseDate(m[0]); if (d && d <= App.today() && d > '2000') { fecha = d; break; } } }
    const nif = (text.match(/\b([A-HJ-NP-SUVW][- ]?\d{7}[0-9A-J]|\d{8}[- ]?[A-Z])\b/) || [])[1] || '';
    const proveedor = (lines.find(l => /[a-záéíóúñ]{3,}/i.test(l) && !/factura|ticket|simplificada|fecha|nif|cif|tel/i.test(l)) || '').slice(0, 60);
    const factura = (text.match(/(?:factura(?:\s+simplificada)?|fra\.?|n[º°o]\.?)\s*[:#]?\s*([A-Z0-9\-\/]*\d[A-Z0-9\-\/]{2,})/i) || [])[1] || '';
    return { total, fecha, nif: nif.replace(/[- ]/g, ''), proveedor, factura };
  };

  /* Nombre de archivo con tu formato abreviado: Tipo-Área-Activo-Cat-Sub-Proveedor-AAAA_MM_DD
     p. ej. G-P-Fran6_5I-Sum-Ele-Endesa-2026_09_08.pdf  (sin activo → "Gral") */
  App.docClean = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  App.docFecha = (iso) => String(iso || App.today()).slice(0, 10).replace(/-/g, '_');
  App.docName = (m, ext) => {
    const [cat, sub] = String(m.agrup || '').split(':').map(s => s.trim());
    const prov = App.docClean(m.beneficiario || 'Proveedor').slice(0, 40);
    return [m.tipo || 'X', m.area || 'X', App.docClean(m.activo) || 'Gral', cat || 'Sin', sub || cat || 'Sin', prov]
      .map(s => App.docClean(s) || 'X').join('-') + '-' + App.docFecha(m.fecha) + '.' + ext;
  };

  async function storeDoc(file, mov) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const name = App.docName(mov, ext);
    try {
      if (!App.state.settings.googleClientId) throw new Error('sin Drive');
      mov.doc = { ...(await App.drive.uploadDoc(file, name)), proveedor: mov.beneficiario || '' };
      App.toast('Documento guardado en Drive › ' + (App.state.settings.carpetaFacturas || 'Facturas'));
    } catch (e) {
      await App.db.putFile(mov.id + ':' + name, { blob: file, name, movId: mov.id });
      mov.doc = { name, pendiente: true };
      App.toast('Documento guardado en el dispositivo; se subirá a Drive al sincronizar (' + e.message + ')', 5000);
    }
  }

  /* ---------- Extractos: Excel / CSV ---------- */
  const SYN = {
    fecha: ['fecha_p', 'fecha operacion', 'f operacion', 'fecha', 'f contable', 'fecha contable', 'date'],
    fechaValor: ['fecha_valor', 'fecha valor', 'f valor', 'valor'],
    // Caixa no tiene columna "Concepto": usa "Movimiento" + "Más datos"; BBVA usa "Concepto" + "Movimiento"
    concepto: ['supraconcepto', 'concepto', 'descripcion', 'detalle', 'description', 'concepto comun', 'movimiento'],
    extra: ['mas datos', 'movimiento', 'observaciones', 'concepto propio', 'referencia'],
    importe: ['importe', 'cantidad', 'importe eur', 'amount', 'importe euros'],
    tarjeta: ['tarjeta'],
    cargo: ['cargo', 'debe', 'cargos'], abono: ['abono', 'haber', 'abonos'],
    saldo: ['saldo', 'disponible', 'saldo eur'],
    tipo: ['tipo'], area: ['idarea'], agrup: ['agrup'], activo: ['activo'], beneficiario: ['beneficiario'], estado: ['estado'], cuenta: ['cuenta']
  };
  function detectHeader(aoa) {
    let best = { row: -1, score: 0 };
    aoa.slice(0, 40).forEach((r, i) => {
      const n = r.map(c => App.norm(c)); let sc = 0;
      if (n.some(c => SYN.fecha.includes(c) || c.startsWith('fecha'))) sc += 2;
      if (n.some(c => SYN.importe.includes(c) || SYN.cargo.includes(c))) sc += 2;
      if (n.some(c => SYN.concepto.includes(c))) sc += 1;
      if (sc > best.score) best = { row: i, score: sc };
    });
    if (best.score < 3) return null;
    const hdr = aoa[best.row].map(c => App.norm(c)); const map = {};
    Object.entries(SYN).forEach(([k, list]) => { for (const s of list) { const i = hdr.indexOf(s); if (i >= 0 && !Object.values(map).includes(i)) { map[k] = i; break; } } });
    if (map.fecha == null) { const i = hdr.findIndex(c => c.startsWith('fecha')); if (i >= 0) map.fecha = i; }
    return { row: best.row, headers: aoa[best.row].map(String), map };
  }
  function detectAccount(name) {
    const u = name.toUpperCase();
    const direct = App.state.cuentas.find(c => { const d = c.id.match(/\d{4}/); return d && u.includes(d[0]); });
    if (u.includes('TC') && u.includes('BBV')) return 'TCBBVA_1';
    if (u.includes('TC') && (u.includes('SAN') || u.includes('BSA'))) return 'TC San';
    if (direct) return direct.id;
    if (u.includes('ETORO')) return 'Etoro'; if (u.includes('TRADE')) return 'Trade_8911'; if (u.includes('EFECT')) return 'EfAgr';
    return '';
  }
  function rowsFromSheet(aoa, h, cuenta) {
    const out = [];
    aoa.slice(h.row + 1).forEach(r => {
      const g = (k) => h.map[k] != null ? r[h.map[k]] : null;
      const fecha = App.parseDate(g('fecha')); if (!fecha) return;
      let imp = App.parseNum(g('importe'));
      if (imp == null && (h.map.cargo != null || h.map.abono != null)) imp = (App.parseNum(g('abono')) || 0) - Math.abs(App.parseNum(g('cargo')) || 0);
      if (imp == null) return;
      const concepto = [g('concepto'), g('extra')].filter(x => x != null && x !== '').join(' ; ');
      out.push({ fecha, fechaValor: App.parseDate(g('fechaValor')), importe: App.round2(imp), saldo: App.parseNum(g('saldo')), concepto: String(concepto).trim(), cuenta: g('cuenta') || cuenta,
        tipo: g('tipo') || '', area: g('area') || '', agrup: g('agrup') || '', activo: g('activo') || '', beneficiario: g('beneficiario') || '', estado: g('estado') || '' });
    });
    return out;
  }
  /* ---------- Extractos: PDF o imagen (texto línea a línea) ---------- */
  function rowsFromText(text, cuenta) {
    const out = [];
    text.split('\n').forEach(l => {
      const dm = l.match(/^\s*(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)\s+(?:(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)\s+)?(.*)$/); if (!dm) return;
      let d = dm[1]; if (!/[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(d)) d += '/' + new Date().getFullYear();
      const fecha = App.parseDate(d); if (!fecha) return;
      const rest = dm[3]; const am = rest.match(AMT) || []; if (!am.length) return;
      const nums = am.map(App.parseNum);
      const concepto = rest.replace(AMT, '').replace(/€|EUR/g, '').replace(/\s+/g, ' ').trim();
      out.push({ fecha, fechaValor: dm[2] ? App.parseDate(dm[2].length <= 5 ? dm[2] + '/' + fecha.slice(0, 4) : dm[2]) : null, importe: nums.length >= 2 ? nums[nums.length - 2] : nums[0], saldo: nums.length >= 2 ? nums[nums.length - 1] : null, concepto, cuenta });
    });
    return out;
  }

  /* Clasifica y marca duplicados; verde = automático fiable, amarillo = revisar */
  /* Orden de clasificación: plantilla de desglose > regla aprendida > parecido con el histórico */
  function classify(rows) {
    const keys = new Set(App.state.movimientos.map(App.dupKey));
    // Duplicado también si ya existe un movimiento de la misma cuenta, fecha e importe aunque el concepto esté escrito distinto
    // (se cuentan las repeticiones: dos cafés iguales el mismo día no se confunden con uno solo)
    // Variantes de un mismo código de cuenta (SAN_1271 / San_1271, Trade / Trade_8911) cuentan como la misma cuenta
    const ids = App.state.cuentas.map(c => c.id.toLowerCase());
    const canon = (id) => { const l = (id || '').toLowerCase(); if (ids.includes(l)) return l; const c = ids.filter(x => x.startsWith(l + '_') || l.startsWith(x + '_')); return c.length === 1 ? c[0] : l; };
    const cnt = {}; const ck = (m) => `${canon(m.cuenta)}|${m.fecha}|${App.round2(+m.importe || 0).toFixed(2)}`;
    // También si el banco da en una línea lo que tú tenías apuntado en varias ese día (p. ej. interés neto = interés − retención)
    const dia = {}; const dk = (m) => `${canon(m.cuenta)}|${m.fecha}`;
    App.state.movimientos.filter(m => !m.desgloseDe).forEach(m => { const k = ck(m); cnt[k] = (cnt[k] || 0) + 1; const d = dia[dk(m)] = dia[dk(m)] || { suma: 0, n: 0 }; d.suma += +m.importe || 0; d.n++; });
    const enArchivo = {}; rows.forEach(r => { enArchivo[dk(r)] = (enArchivo[dk(r)] || 0) + 1; });
    return rows.map(r => {
      const k = ck(r); let dup = keys.has(App.dupKey(r));
      if (cnt[k] > 0) { dup = true; cnt[k]--; }
      const d = dia[dk(r)];
      if (!dup && d && d.n > 1 && enArchivo[dk(r)] === 1 && Math.abs(d.suma - r.importe) < 0.01) dup = true;
      let c = { via: r.agrup ? 'archivo' : null, score: r.agrup ? 100 : 0, fiable: !!r.agrup };
      if (!r.agrup) c = App.autoClassify(r);
      if (!r.tipo) r.tipo = r.importe < 0 ? 'G' : 'I';
      if (!r.area) r.area = 'P';
      // R = clasificado (por ti, por una regla o con alta similitud); P = pendiente de revisar. AR se reserva para los desgloses.
      r.estado = r.estado || (c.fiable ? 'R' : 'P');
      if (c.via && c.via !== 'archivo') r.auto = c.via;
      return { ...r, _dup: dup, _score: c.score, _ok: c.fiable, _via: c.via, _tpl: c.tpl, _sel: !dup };
    });
  }
  App.classifyRows = classify;
  App._cap = { detectHeader, rowsFromSheet, rowsFromText, pdfText, fileText, detectAccount };
  const VIA = { plantilla: '⇉ plantilla', regla: '📌 regla', historico: '≈ histórico', archivo: 'archivo' };

  function reviewTable(el, rows, file, onDone) {
    const cats = App.state.categorias.slice().sort((a, b) => a.supra.localeCompare(b.supra));
    const catSel = (v) => `<select data-k="agrup">${v && !App.idx.cat[v] ? `<option selected>${App.esc(v)}</option>` : ''}<option value="">Sin clasificar</option>${cats.map(c => `<option value="${c.agrup}" ${c.agrup === v ? 'selected' : ''}>${App.esc(c.supra)}</option>`).join('')}</select>`;
    const small = (k, arr, v) => `<select data-k="${k}">${arr.map(x => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${x.id}</option>`).join('')}${v && !arr.some(x => x.id === v) ? `<option selected>${App.esc(v)}</option>` : ''}</select>`;
    const nOk = rows.filter(r => r._ok && !r._dup).length, nDud = rows.filter(r => !r._ok && !r._dup).length, nDup = rows.filter(r => r._dup).length;
    el.innerHTML = `<div class="row"><span class="tag good">✔ ${nOk} codificados automáticamente</span><span class="tag warn">⚠ ${nDud} dudosos (revisar)</span><span class="tag bad">⧉ ${nDup} ya existentes (no se importan)</span>
      <span class="spacer"></span><label class="row small"><input type="checkbox" id="saveDoc" checked> Guardar el extracto en Drive › Facturas</label><button class="btn btn-primary" id="imp">Importar seleccionados</button></div>
      <div class="table-wrap mt" style="max-height:60vh"><table class="t"><thead><tr><th><input type="checkbox" id="all" checked></th><th>Fecha</th><th>Concepto</th><th class="num">Importe</th><th class="num">Saldo</th><th>Tipo</th><th>Área</th><th>Categoría</th><th>Activo</th><th>Origen</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr data-i="${i}" class="${r._dup ? '' : r._ok ? 'row-ok' : 'row-warn'}" style="${r._dup ? 'opacity:.5' : ''}">
        <td><input type="checkbox" data-k="_sel" ${r._sel ? 'checked' : ''}></td><td>${App.fdate(r.fecha)}</td><td class="wrap">${App.esc(r.concepto)}${r._dup ? ' <span class="tag bad">duplicado</span>' : ''}</td>
        <td class="num"><input type="number" step="0.01" data-k="importe" value="${r.importe}" style="width:100px;text-align:right"></td><td class="num">${App.num(r.saldo)}</td>
        <td>${small('tipo', App.state.tipos, r.tipo)}</td><td>${small('area', App.state.areas, r.area)}</td><td>${catSel(r.agrup)}</td>
        <td><input data-k="activo" value="${App.esc(r.activo || '')}" style="width:110px" list="dlAct"></td><td class="small">${r._via ? VIA[r._via] + (r._via === 'historico' ? ' ' + r._score + '%' : '') : ''}${r._tpl ? `<br><span class="muted">${App.esc(r._tpl.nombre)}</span>` : ''}</td></tr>`).join('')}
      </tbody></table></div><datalist id="dlAct">${[...App.state.bienes, ...App.state.prestamos].map(b => `<option value="${b.id}">`).join('')}</datalist>`;
    el.querySelectorAll('tbody tr').forEach(tr => tr.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
      const r = rows[+tr.dataset.i]; const k = inp.dataset.k; r[k] = k === '_sel' ? inp.checked : k === 'importe' ? App.parseNum(inp.value) : inp.value; if (k !== '_sel') r.estado = 'R';
    }));
    el.querySelector('#all').onchange = (e) => el.querySelectorAll('[data-k=_sel]').forEach((c, i) => { c.checked = e.target.checked && !rows[i]._dup; rows[i]._sel = c.checked; });
    el.querySelector('#imp').onclick = async () => {
      const sel = rows.filter(r => r._sel).map(r => { const m = {}; Object.keys(r).forEach(k => { if (k[0] !== '_') m[k] = r[k]; }); return m; });
      if (!sel.length) return App.toast('No hay movimientos seleccionados');
      if (!sel.every(m => m.cuenta)) return App.toast('Indica la cuenta del extracto');
      await App.addMovs(sel);
      const nDes = await App.autoDesglosar();
      if (file && el.querySelector('#saveDoc').checked) {
        const ext = file.name.split('.').pop();
        const name = `Extracto-${sel[0].cuenta}-${sel[0].fecha}_${sel[sel.length - 1].fecha}.${ext}`;
        try { if (!App.state.settings.googleClientId) throw new Error('Drive no configurado'); await App.drive.uploadDoc(file, name); } catch (e) { App.toast('Extracto no subido a Drive: ' + e.message, 5000); }
      }
      App.updateBadge();
      const pend = App.pendingReview().length + App.pendingDesgloses().length;
      App.toast(`${App.int(sel.length)} movimientos importados${nDes ? ` · ${nDes} desglosados automáticamente` : ''}${pend ? ` · ${pend} para revisar` : ''}`, 5000);
      pend ? App.go('revisar') : (onDone && onDone());
    };
  }

  /* ---------- Vista ---------- */
  App.views.captura = (el, p) => {
    const tab = p.tab || 'ticket';
    el.innerHTML = `<div class="page-head"><h1>Escanear e importar</h1></div>
      <div class="tabs"><button data-t="entrada" class="${tab === "entrada" ? "active" : ""}">📥 Entrada de Drive${App.entradaPendientes ? ` <b class="badge" style="background:var(--warn-bg);color:var(--warn)">${App.entradaPendientes}</b>` : ""}</button><button data-t="ticket" class="${tab === 'ticket' ? 'active' : ''}">🧾 Factura / ticket</button><button data-t="extracto" class="${tab === 'extracto' ? 'active' : ''}">🏦 Extracto bancario</button></div>
      <div id="pane"></div>`;
    App.$$('.tabs button', el).forEach(b => b.onclick = () => App.go('captura?tab=' + b.dataset.t));
    const pane = App.$('#pane', el);
    if (tab === "entrada") App.entradaPane(pane); else if (tab === "ticket") ticketPane(pane); else extractoPane(pane);
  };

  function dropZone(accept, label, onFile) {
    const id = 'f' + Math.random().toString(36).slice(2, 7);
    setTimeout(() => {
      const z = document.getElementById(id + 'z'), inp = document.getElementById(id), cam = document.getElementById(id + 'c');
      const take = (f) => f && onFile(f);
      inp.onchange = () => take(inp.files[0]); if (cam) cam.onchange = () => take(cam.files[0]);
      z.ondragover = (e) => { e.preventDefault(); z.classList.add('over'); }; z.ondragleave = () => z.classList.remove('over');
      z.ondrop = (e) => { e.preventDefault(); z.classList.remove('over'); take(e.dataTransfer.files[0]); };
    });
    return `<div class="drop" id="${id}z"><p>${label}</p><div class="row" style="justify-content:center">
      ${accept.includes('image') ? `<label class="btn btn-primary">📷 Hacer foto<input id="${id}c" type="file" accept="image/*" capture="environment" hidden></label>` : ''}
      <label class="btn">📁 Elegir archivo<input id="${id}" type="file" accept="${accept}" hidden></label></div></div>`;
  }

  function ticketPane(pane) {
    pane.innerHTML = `<div class="grid g-2"><div class="stack">${dropZone('image/*,application/pdf', 'Haz una foto del ticket o factura, o arrastra aquí una imagen o PDF.', go)}
      <div id="prev"></div></div><div id="res"></div></div>`;
    async function go(file) {
      const prev = App.$('#prev', pane), res = App.$('#res', pane);
      prev.innerHTML = file.type.startsWith('image/') ? `<img class="preview-img" src="${URL.createObjectURL(file)}" alt="Documento escaneado">` : `<div class="card">📄 ${App.esc(file.name)}</div>`;
      res.innerHTML = `<div class="card stack"><b>Leyendo el documento…</b><div class="progress"><div id="pb"></div></div><p class="small muted">El reconocimiento de texto (OCR) se hace en tu dispositivo; la primera vez descarga el idioma español (~10 MB).</p></div>`;
      let text = '';
      try { text = await fileText(file, (v) => { const pb = App.$('#pb'); if (pb) pb.style.width = Math.round(v * 100) + '%'; }); }
      catch (e) { res.innerHTML = `<div class="alert bad">No se pudo leer el documento: ${App.esc(e.message)}. Puedes rellenar los datos a mano.</div>`; }
      const d = App.parseReceipt(text || '');
      const sug = App.suggest(d.proveedor + ' ' + text.slice(0, 300), null, d.total ? -d.total : null) || {};
      const m = { fecha: d.fecha || App.today(), importe: d.total ? -d.total : null, tipo: 'G', area: sug.area || 'P', agrup: sug.agrup || '', activo: sug.activo || '', beneficiario: d.proveedor, concepto: [d.proveedor, d.nif && 'NIF ' + d.nif, d.factura && 'Fra ' + d.factura].filter(Boolean).join(' · '), estado: 'R', cuenta: sug.cuenta || '' };
      const cands = d.total ? App.state.movimientos.filter(x => Math.abs(Math.abs(x.importe) - d.total) < 0.011 && Math.abs(new Date(x.fecha) - new Date(m.fecha)) <= 10 * 864e5) : [];
      res.innerHTML = `<div class="card"><h2>Datos detectados</h2>
        ${sug.agrup ? `<p class="small"><span class="tag ${sug.score >= 60 ? 'good' : 'warn'}">Clasificación sugerida por tu histórico · ${sug.score}%</span></p>` : ''}
        ${cands.length ? `<div class="alert info"><b>Este ticket parece corresponder a un movimiento ya registrado:</b>${cands.slice(0, 5).map(c => `<label class="row small" style="margin-top:6px"><input type="radio" name="link" value="${c.id}"> ${App.fdate(c.fecha)} · ${App.esc(c.cuenta)} · ${App.num(c.importe)} € · ${App.esc((c.concepto || '').slice(0, 50))}</label>`).join('')}
          <label class="row small" style="margin-top:6px"><input type="radio" name="link" value="" checked> No, crear un movimiento nuevo</label></div>` : ''}
        <form id="mf" class="mt">${App.movForm(m)}</form>
        <details class="mt"><summary class="small muted">Texto reconocido</summary><pre class="small" style="white-space:pre-wrap">${App.esc(text)}</pre></details>
        <div class="modal-actions"><button class="btn btn-primary" id="save">Guardar ${App.state.settings.googleClientId ? 'y subir a Drive' : ''}</button></div></div>`;
      App.wireMovForm(res);
      App.$('#save', res).onclick = async () => {
        const link = res.querySelector('input[name=link]:checked')?.value;
        if (link) { const ex = App.state.movimientos.find(x => x.id === link); const nm = App.readMovForm(App.$('#mf', res), {}); await storeDoc(file, Object.assign(ex, { beneficiario: ex.beneficiario || nm.beneficiario, agrup: ex.agrup || nm.agrup })); await App.db.save(); App.toast('Documento vinculado al movimiento'); return App.go('movimientos?mes=' + App.ym(ex.fecha)); }
        const f = App.$('#mf', res); if (!f.reportValidity()) return;
        const nm = App.readMovForm(f, { id: App.uid() });
        await storeDoc(file, nm); await App.addMovs([nm]); App.toast('Movimiento guardado'); App.go('movimientos?mes=' + App.ym(nm.fecha));
      };
    }
  }

  function extractoPane(pane) {
    pane.innerHTML = `<div class="card stack">${dropZone('.xlsx,.xls,.csv,.pdf,image/*', 'Arrastra el extracto descargado del banco (Excel, CSV o PDF) o hazle una foto. También acepta tus libros X-*.xlsx.', go)}
      <div class="form-grid"><label class="f">Cuenta del extracto<select id="cta"><option value="">Detectar por el nombre del archivo…</option>${App.state.cuentas.map(c => `<option value="${c.id}">${c.id} · ${App.esc(c.banco)}</option>`).join('')}</select></label>
      <label class="f">Hoja (Excel)<select id="sheet" disabled></select></label></div><div id="map"></div></div><div id="rev" class="mt"></div>`;
    let file, wb;
    async function go(f) {
      file = f; const ctaSel = App.$('#cta', pane); if (!ctaSel.value) ctaSel.value = detectAccount(f.name);
      const rev = App.$('#rev', pane); rev.innerHTML = '<div class="card">Leyendo extracto…<div class="progress mt"><div id="pb2"></div></div></div>';
      try {
        if (/\.(xlsx|xls|xlsm|csv)$/i.test(f.name)) {
          wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
          const sh = App.$('#sheet', pane); sh.disabled = false; sh.innerHTML = wb.SheetNames.map(n => `<option>${App.esc(n)}</option>`).join('');
          sh.onchange = () => fromSheet(sh.value); fromSheet(wb.SheetNames[0]);
        } else {
          const text = await fileText(f, v => { const pb = App.$('#pb2'); if (pb) pb.style.width = Math.round(v * 100) + '%'; });
          const rows = rowsFromText(text, ctaSel.value);
          if (!rows.length) { rev.innerHTML = `<div class="alert warn">No se han encontrado líneas con fecha e importe. Prueba con el Excel del banco o revisa el texto:</div><pre class="small card" style="white-space:pre-wrap">${App.esc(text.slice(0, 3000))}</pre>`; return; }
          reviewTable(rev, classify(rows), f, () => App.go('movimientos?todo=1'));
        }
      } catch (e) { console.error(e); rev.innerHTML = `<div class="alert bad">Error leyendo el archivo: ${App.esc(e.message)}</div>`; }
    }
    function fromSheet(name) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      const h = detectHeader(aoa); const rev = App.$('#rev', pane), map = App.$('#map', pane);
      if (!h) { map.innerHTML = ''; rev.innerHTML = '<div class="alert warn">No se encuentra la fila de cabeceras (Fecha, Concepto, Importe…) en esta hoja.</div>'; return; }
      const fields = { fecha: 'Fecha', fechaValor: 'Fecha valor', concepto: 'Concepto', extra: 'Detalle adicional', importe: 'Importe', cargo: 'Cargo', abono: 'Abono', saldo: 'Saldo', cuenta: 'Cuenta', tipo: 'Tipo', area: 'IdArea', agrup: 'Agrup', activo: 'Activo' };
      map.innerHTML = `<details><summary class="small">Columnas detectadas (fila ${h.row + 1}) — pulsa para corregir</summary><div class="form-grid mt">${Object.entries(fields).map(([k, l]) => `<label class="f">${l}<select data-f="${k}"><option value="">—</option>${h.headers.map((c, i) => `<option value="${i}" ${h.map[k] === i ? 'selected' : ''}>${App.esc(c)}</option>`).join('')}</select></label>`).join('')}</div></details>`;
      const run = () => { const rows = rowsFromSheet(aoa, h, App.$('#cta', pane).value); reviewTable(rev, classify(rows), file, () => App.go('movimientos?todo=1')); };
      map.querySelectorAll('select').forEach(s => s.onchange = () => { h.map[s.dataset.f] = s.value === '' ? undefined : +s.value; run(); });
      App.$('#cta', pane).onchange = run; run();
    }
  }
})(window.App);
