/* Almacenamiento local (IndexedDB) del estado completo de la aplicación */
(function (App) {
  const DB_NAME = 'mi-economia', STORE = 'kv', KEY = 'state';
  let idb;
  const open = () => idb || (idb = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const st = t.objectStore(STORE); const out = fn(st); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); };
  const idbGet = (k) => tx('readonly', st => st.get(k));
  const idbSet = (k, v) => tx('readwrite', st => { st.put(v, k); });

  const empty = () => ({
    version: 1, updatedAt: null,
    areas: [], tipos: [], categorias: [], bienes: [], cuentas: [], prestamos: [], movimientos: [], eventos: [],
    settings: { googleClientId: '', carpetaFacturas: 'Facturas', carpetaDatos: 'MiEconomia', autoSync: true, umbralSimilitud: 60, mesesMedia: 12, inflacion: 2.5, crecimientoIngresos: 2, horizonte: 60, cuentasDisponibles: null, tema: 'auto' }
  });

  App.state = empty();
  App.idx = {};

  App.reindex = () => {
    const s = App.state, by = (arr, k) => Object.fromEntries(arr.map(x => [x[k], x]));
    App.idx = {
      area: by(s.areas, 'id'), tipo: by(s.tipos, 'id'), cat: by(s.categorias, 'agrup'), bien: by(s.bienes, 'id'),
      cuenta: by(s.cuentas, 'id'), ptmo: by(s.prestamos, 'id'),
      catLower: Object.fromEntries(s.categorias.map(c => [c.agrup.toLowerCase(), c])),
      cuentaLower: Object.fromEntries(s.cuentas.map(c => [c.id.toLowerCase(), c]))
    };
    s.movimientos.sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.orden || 0) - (b.orden || 0));
  };

  /* Etiquetas legibles */
  App.catOf = (agrup) => App.idx.cat[agrup] || App.idx.catLower[(agrup || '').toLowerCase()] || null;
  App.catName = (agrup) => { const c = App.catOf(agrup); if (c) return (c.categoria || c.supra || agrup).trim(); return agrup ? `${(agrup.split(':')[0])} (sin maestro)` : 'Sin clasificar'; };
  App.subName = (agrup) => { const c = App.catOf(agrup); return c ? (c.subcategoria || '').trim() : (agrup || '').split(':')[1] || ''; };
  App.areaName = (id) => App.idx.area[id]?.nombre || (id ? id + ' (sin maestro)' : 'Sin área');
  App.cuentaOf = (id) => App.idx.cuenta[id] || App.idx.cuentaLower[(id || '').toLowerCase()] || null;
  App.cuentaName = (id) => { const c = App.cuentaOf(id); return c ? `${c.id}${c.banco ? ' · ' + c.banco : ''}` : (id || '—'); };
  App.bienName = (id) => App.idx.bien[id]?.nombre || App.idx.ptmo[id]?.tipo && `${id} (préstamo)` || id || '';

  let saveT, saveWaiters = [], saveSync = false;
  App.db = {
    async load() {
      const v = await idbGet(KEY);
      if (v) App.state = Object.assign(empty(), v, { settings: Object.assign(empty().settings, v.settings || {}) });
      App.reindex();
      return !!v;
    },
    save(opts = {}) {
      App.state.updatedAt = new Date().toISOString();
      App.reindex();
      clearTimeout(saveT);
      if (!opts.noSync) saveSync = true;
      // Varias llamadas seguidas se agrupan en una sola escritura; todas esperan a que termine
      return new Promise(res => { saveWaiters.push(res); saveT = setTimeout(async () => {
        const ws = saveWaiters; saveWaiters = []; const sync = saveSync; saveSync = false;
        await idbSet(KEY, App.state); ws.forEach(r => r()); if (sync && App.drive) App.drive.scheduleSync();
        if (!opts.noRename && App.scheduleDocRename) App.scheduleDocRename();   // si se corrigió un movimiento, renombra sus PDF
      }, 150); });
    },
    async replace(obj) {
      const base = empty();
      App.state = Object.assign(base, obj, { settings: Object.assign(base.settings, App.state.settings || {}, obj.settings || {}, { migracion: obj.settings?.migracion || 0 }) });
      App.state.movimientos.forEach((m, i) => { if (!m.id) m.id = App.uid(); if (m.orden == null) m.orden = i + 1; });
      await App.db.save();
      if (App.migrate) await App.migrate();
    },
    export() { return JSON.parse(JSON.stringify(App.state)); },
    async putFile(key, blob) { return idbSet('file:' + key, blob); },
    async getFile(key) { return idbGet('file:' + key); },
    async delFile(key) { return tx('readwrite', st => { st.delete('file:' + key); }); },
    async pendingFiles() { const d = await open(); return new Promise(res => { const out = []; const t = d.transaction(STORE).objectStore(STORE).openCursor(); t.onsuccess = () => { const c = t.result; if (c) { if (String(c.key).startsWith('file:')) out.push(String(c.key).slice(5)); c.continue(); } else res(out); }; }); }
  };

  /* Alta / edición de movimientos */
  App.addMovs = (list) => {
    let maxOrden = App.state.movimientos.reduce((m, x) => Math.max(m, x.orden || 0), 0);
    list.forEach(m => { m.id = m.id || App.uid(); m.orden = m.orden || ++maxOrden; App.state.movimientos.push(m); });
    return App.db.save();
  };
  App.dupKey = (m) => [(m.cuenta || '').toLowerCase(), m.fecha, App.round2(+m.importe || 0).toFixed(2), App.norm(m.concepto).slice(0, 40)].join('|');
})(window.App);
