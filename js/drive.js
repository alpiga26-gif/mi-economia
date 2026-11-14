/* Integración con Google Drive: guarda facturas/tickets en la carpeta "Facturas"
   y sincroniza la base de datos (economia_datos.json) entre escritorio, móvil y tablet. */
(function (App) {
  const SCOPE = 'https://www.googleapis.com/auth/drive';
  const DATA_FILE = 'economia_datos.json';
  let token = null, tokenExp = 0, tokenClient = null, syncT = null;
  const folderCache = {};

  const status = (txt) => { const el = document.getElementById('syncStatus'); if (el) el.textContent = txt; };

  async function ensureToken(interactive = true) {
    if (token && Date.now() < tokenExp - 60000) return token;
    const cid = App.state.settings.googleClientId;
    if (!cid) throw new Error('Configura el "Client ID" de Google en Ajustes para usar Drive.');
    await App.loadScript('https://accounts.google.com/gsi/client');
    return new Promise((res, rej) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cid, scope: SCOPE,
        callback: (r) => { if (r.error) return rej(new Error(r.error)); token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000; localStorage.setItem('driveConnected', '1'); status('☁️ Drive conectado'); res(token); },
        error_callback: (e) => rej(new Error(e.message || e.type || 'Acceso cancelado'))
      });
      if (!interactive && !localStorage.getItem('driveConnected')) return rej(new Error('No conectado'));
      tokenClient.requestAccessToken({ prompt: localStorage.getItem('driveConnected') ? '' : 'consent' });
    });
  }

  async function api(path, opts = {}) {
    const t = await ensureToken(opts.interactive !== false);
    const r = await fetch(path.startsWith('http') ? path : 'https://www.googleapis.com/drive/v3/' + path, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
    if (r.status === 401) { token = null; throw new Error('Sesión de Google caducada, vuelve a conectar.'); }
    if (!r.ok) throw new Error('Drive: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return opts.raw ? r : r.json();
  }

  async function folder(name, parent = 'root') {
    const key = parent + '/' + name; if (folderCache[key]) return folderCache[key];
    const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false` + (parent === 'any' ? '' : ` and '${parent}' in parents`));
    let r = await api(`files?q=${q}&fields=files(id,name)&spaces=drive`);
    if (!r.files.length && parent === 'any') return folder(name, 'root');
    if (!r.files.length) r = { files: [await api('files?fields=id,name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) })] };
    return (folderCache[key] = r.files[0].id);
  }

  async function upload(blob, name, parentId, fileId) {
    const meta = fileId ? { name } : { name, parents: [parentId] };
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    fd.append('file', blob);
    const url = 'https://www.googleapis.com/upload/drive/v3/files' + (fileId ? '/' + fileId : '') + '?uploadType=multipart&fields=id,name,webViewLink,modifiedTime';
    return api(url, { method: fileId ? 'PATCH' : 'POST', body: fd });
  }

  App.drive = {
    get connected() { return !!token; },
    async connect() { await ensureToken(true); App.toast('Conectado a Google Drive'); return true; },
    disconnect() { if (token && window.google) google.accounts.oauth2.revoke(token); token = null; localStorage.removeItem('driveConnected'); status(''); },

    /* Carpeta de facturas: MiEconomia/Facturas (si no existe se crea ahí) */
    async facturasId() { return App.drive.folderPath([App.state.settings.carpetaDatos || 'MiEconomia', App.state.settings.carpetaFacturas || 'Facturas']); },
    /* Sube un documento escaneado a la carpeta Facturas */
    async uploadDoc(blob, name) {
      const fid = await App.drive.facturasId();
      const r = await upload(blob, name, fid);
      return { id: r.id, url: r.webViewLink, name: r.name };
    },

    /* Sube los documentos que quedaron pendientes (sin conexión) */
    async flushPending() {
      const keys = await App.db.pendingFiles(); let n = 0;
      for (const k of keys) {
        const rec = await App.db.getFile(k); if (!rec) continue;
        const r = await App.drive.uploadDoc(rec.blob, rec.name);
        const m = App.state.movimientos.find(x => x.id === rec.movId); if (m) m.doc = { ...r, pendiente: false };
        await App.db.delFile(k); n++;
      }
      if (n) await App.db.save({ noSync: true });
      return n;
    },

    /* ---------- Bandeja de entrada (MiEconomia/Entrada) ---------- */
    async folderPath(names) { let p = 'root'; for (const n of names) p = await folder(n, p); return p; },
    async folderId(name) { return folder(name, 'any'); },
    async rename(id, name) { return api(`files/${id}?fields=id,name,webViewLink`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }), interactive: false }); },
    async listFolder(folderId) {
      const out = []; let tk = '';
      do {
        const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
        const r = await api(`files?q=${q}&fields=nextPageToken,files(id,name,mimeType,parents,size,modifiedTime)&pageSize=200${tk ? '&pageToken=' + tk : ''}`);
        out.push(...r.files); tk = r.nextPageToken || '';
      } while (tk);
      return out;
    },
    async download(id) { const r = await api(`files/${id}?alt=media`, { raw: true }); return r.blob(); },
    /* Mueve (y renombra) un archivo; si ya existe uno con ese nombre en el destino añade un sufijo (2), (3)… */
    async move(file, destId, newName) {
      let name = newName || file.name;
      const existing = (await App.drive.listFolder(destId)).map(f => f.name);
      if (existing.includes(name)) { const b = name.replace(/(\.[^.]+)?$/, ''), e = (name.match(/\.[^.]+$/) || [''])[0]; let i = 2; while (existing.includes(`${b} (${i})${e}`)) i++; name = `${b} (${i})${e}`; }
      return api(`files/${file.id}?addParents=${destId}&removeParents=${(file.parents || []).join(',')}&fields=id,name,parents,webViewLink`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    },
    async uploadTo(blob, name, parentId) { return upload(blob, name, parentId); },

    async findDataFile() {
      const fid = await folder(App.state.settings.carpetaDatos || 'MiEconomia', 'root');
      const q = encodeURIComponent(`name='${DATA_FILE}' and '${fid}' in parents and trashed=false`);
      const r = await api(`files?q=${q}&fields=files(id,modifiedTime,appProperties)`);
      return { folderId: fid, file: r.files[0] || null };
    },
    async pull() {
      const { file } = await App.drive.findDataFile(); if (!file) return null;
      const r = await api(`files/${file.id}?alt=media`, { raw: true }); return r.json();
    },
    async push() {
      const { folderId, file } = await App.drive.findDataFile();
      const data = App.db.export(); delete data.settings.googleClientId;
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      await upload(blob, DATA_FILE, folderId, file?.id);
      localStorage.setItem('lastPush', App.state.updatedAt || '');
      status('☁️ Sincronizado ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
    },
    /* Sincronización: si en Drive hay una versión más reciente que la local, se descarga; si no, se sube */
    async sync(interactive = true) {
      status('☁️ Sincronizando…');
      try {
        await ensureToken(interactive);
        await App.drive.flushPending().catch(e => console.warn(e));
        const remote = await App.drive.pull();
        const localTs = App.state.updatedAt || '';
        if (remote && remote.updatedAt && remote.updatedAt > localTs && remote.updatedAt !== localStorage.getItem('lastPush')) {
          const keep = App.state.settings; remote.settings = Object.assign({}, remote.settings, { googleClientId: keep.googleClientId });
          App.state = Object.assign(App.state, remote); await App.db.save({ noSync: true }); localStorage.setItem('lastPush', remote.updatedAt);
          status('☁️ Datos actualizados desde Drive'); App.render(); return 'pulled';
        }
        await App.drive.push();
        if (App.syncDocNames) App.syncDocNames();   // renombra los PDF de movimientos corregidos sin conexión
        return 'pushed';
      } catch (e) { status('☁️ Sin sincronizar'); if (interactive) App.toast(e.message, 5000); return 'error'; }
    },
    scheduleSync() {
      if (!App.state.settings.autoSync || !token) return;
      clearTimeout(syncT); syncT = setTimeout(() => App.drive.push().catch(e => status('☁️ Error al subir')), 4000);
    }
  };
})(window.App);
