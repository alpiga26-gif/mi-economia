/* Ajustes: importación/exportación de datos, Google Drive y preferencias */
(function (App) {
  App.applyTheme = () => { const t = App.state.settings.tema; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); };

  App.views.ajustes = async (el) => {
    const st = App.state.settings; const S = App.state;
    const pend = (await App.db.pendingFiles()).length;
    el.innerHTML = `<div class="page-head"><h1>Ajustes y Google Drive</h1></div>
      <div class="grid g-2">
        <div class="card stack"><h2>☁️ Google Drive</h2>
          <p class="small">Los documentos escaneados se guardan en <b>${App.esc(st.carpetaDatos)}/${App.esc(st.carpetaFacturas)}</b> de tu Drive y la base de datos en <b>${App.esc(st.carpetaDatos)}/economia_datos.json</b>, para usar la app con los mismos datos en el ordenador, el móvil y la tablet.</p>
          <form id="gd" class="form-grid">
            <label class="f" style="grid-column:1/-1">Client ID de Google (OAuth)<input name="googleClientId" value="${App.esc(st.googleClientId)}" placeholder="xxxxxxxx.apps.googleusercontent.com"></label>
            <label class="f">Carpeta de facturas<input name="carpetaFacturas" value="${App.esc(st.carpetaFacturas)}"></label>
            <label class="f">Carpeta de datos<input name="carpetaDatos" value="${App.esc(st.carpetaDatos)}"></label>
            <label class="row small"><input type="checkbox" name="autoSync" ${st.autoSync ? 'checked' : ''}> Sincronizar automáticamente al guardar</label>
          </form>
          <div class="row"><button class="btn" id="gdSave">Guardar</button><button class="btn btn-primary" id="gdCon">${App.drive.connected ? 'Reconectar' : 'Conectar con Google'}</button><button class="btn" id="gdSync">Sincronizar ahora</button>${App.drive.connected ? '<button class="btn" id="gdOff">Desconectar</button>' : ''}</div>
          ${pend ? `<div class="alert warn">${pend} documento(s) escaneados pendientes de subir a Drive. Se subirán al sincronizar.</div>` : ''}
          <details id="verBox"><summary class="small"><b>🕘 Versiones anteriores en Drive</b> (recuperar datos)</summary>
            <p class="small muted">Drive guarda las versiones anteriores de tus datos durante unas semanas. Pulsa "Comprobar" para ver cuántos movimientos tiene cada una y "Restaurar" para volver a ella: sustituye los datos de este dispositivo y de Drive.</p>
            <button class="btn btn-sm" id="verList">Ver versiones</button><div id="verOut" class="mt"></div></details>
          <details><summary class="small">¿Cómo obtengo el Client ID? (una sola vez, 5 minutos)</summary><ol class="small">
            <li>Entra en <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a> con tu cuenta de Google y crea un proyecto (p. ej. "Mi Economía").</li>
            <li>En <i>APIs y servicios › Biblioteca</i> habilita <b>Google Drive API</b>.</li>
            <li>En <i>Pantalla de consentimiento OAuth</i> elige "Externo", rellena el nombre y añade tu correo como <b>usuario de prueba</b>.</li>
            <li>En <i>Credenciales › Crear credenciales › ID de cliente OAuth</i> elige "Aplicación web" y en <b>Orígenes de JavaScript autorizados</b> añade la dirección desde la que abres la app (p. ej. <code>http://localhost:8080</code> y la de GitHub Pages si la publicas).</li>
            <li>Copia el ID de cliente y pégalo arriba. Pulsa "Conectar con Google".</li></ol></details>
        </div>
        <div class="card stack"><h2>📥 Importar datos</h2>
          <p class="small">Carga el archivo <b>datos_iniciales.json</b> (generado a partir de tus Excel: maestros, préstamos y movimientos de 2025-2026) o una copia de seguridad.</p>
          <label class="btn btn-primary" style="align-self:flex-start">📂 Cargar archivo JSON<input type="file" id="impJson" accept=".json,application/json" hidden></label>
          <p class="small">Configuración personal (plantillas de desglose, titulares, datos de préstamos): carga <b>configuracion_personal.json</b>. Solo añade lo que falte; no cambia lo que ya tienes.</p>
          <label class="btn" style="align-self:flex-start">⚙️ Importar configuración personal<input type="file" id="impCfg" accept=".json,application/json" hidden></label>
          <p class="small">Para añadir movimientos desde Excel (extractos del banco, tus libros X-*.xlsx o Mov-2025.xlsx) usa <a href="#/captura?tab=extracto">Escanear / Importar › Extracto bancario</a>: detecta las columnas, evita duplicados y clasifica según tu histórico.</p>
          <h2 class="mt">📤 Exportar</h2>
          <div class="row"><button class="btn" id="expJson">Copia de seguridad (JSON)</button><button class="btn" id="expXls">Todo a Excel</button></div>
        </div>
        <div class="card stack"><h2>🎛️ Preferencias</h2>
          <form id="pref" class="form-grid">
            <label class="f">Tema<select name="tema">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<option value="${v}" ${st.tema === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="f">Umbral de similitud para codificar automáticamente (%)<input type="number" name="umbralSimilitud" min="0" max="100" value="${st.umbralSimilitud}"></label>
            <label class="f" style="grid-column:1/-1">Titulares (nombres que aparecen en los recibos y no son el proveedor), separados por comas<input name="titulares" value="${App.esc((st.titulares || []).join(', '))}"></label>
            <label class="f">Tu código como socio en la actividad compartida (p. ej. tus iniciales)<input name="socioPropio" value="${App.esc(st.socioPropio || '')}"></label>
            <label class="f">Días de desfase admitidos en traspasos entre bancos<input type="number" name="desfaseTraspasos" min="0" max="15" value="${st.desfaseTraspasos ?? 3}" title="Una transferencia puede aparecer 1-2 días después en el otro banco (3 si hay fin de semana). Dentro de ese margen no se avisa."></label>
            <label class="f">Palabras que indican descuento (gasto en positivo admitido)<input name="palabrasDescuento" value="${App.esc(st.palabrasDescuento ?? 'dto, descuento')}" title="Separadas por comas. Un gasto positivo cuyo concepto u observaciones contenga alguna de estas palabras es un descuento (menor gasto) y no se avisa en Calidad."></label>
          </form><button class="btn" id="prefSave" style="align-self:flex-start">Guardar preferencias</button>
        </div>
        <div class="card stack"><h2>ℹ️ Datos en este dispositivo</h2>
          <p class="small">${App.int(S.movimientos.length)} movimientos · ${S.categorias.length} categorías · ${S.cuentas.length} cuentas · ${S.bienes.length} bienes · ${S.prestamos.length} préstamos.<br>Última modificación: ${S.updatedAt ? new Date(S.updatedAt).toLocaleString('es-ES') : '—'}</p>
          <p class="small muted">Para instalarla como aplicación: en el móvil o la tablet abre el menú del navegador y elige "Añadir a pantalla de inicio"; en el ordenador, el icono de instalar de la barra de direcciones.</p>
          <button class="btn btn-danger" id="wipe" style="align-self:flex-start">Borrar los datos de este dispositivo</button>
        </div>
      </div>`;

    const gd = App.$('#gd');
    const saveGd = async () => { st.googleClientId = gd.googleClientId.value.trim(); st.carpetaFacturas = gd.carpetaFacturas.value.trim() || 'Facturas'; st.carpetaDatos = gd.carpetaDatos.value.trim() || 'MiEconomia'; st.autoSync = gd.autoSync.checked; await App.db.save({ noSync: true, keepTime: true }); };
    App.$('#gdSave').onclick = async () => { await saveGd(); App.toast('Guardado'); };
    App.$('#gdCon').onclick = async () => { await saveGd(); try { await App.drive.connect(); await App.drive.sync(); App.render(); } catch (e) { App.toast(e.message, 5000); } };
    App.$('#gdSync').onclick = async () => { await saveGd(); const r = await App.drive.sync(); if (r === 'pushed') App.toast('Datos subidos a Drive'); if (r === 'pulled') App.toast('Datos descargados de Drive'); };
    const off = App.$('#gdOff'); if (off) off.onclick = () => { App.drive.disconnect(); App.render(); };
    App.$('#verList').onclick = async () => {
      const out = App.$('#verOut'); out.innerHTML = '<p class="small">Consultando Drive…</p>';
      try {
        await saveGd(); await App.drive.connect();
        const { file, revs } = await App.drive.versiones();
        if (!file || !revs.length) { out.innerHTML = '<p class="small">No hay versiones guardadas.</p>'; return; }
        out.innerHTML = App.table([{ label: 'Guardada', get: r => new Date(r.modifiedTime).toLocaleString('es-ES') }, { label: 'Tamaño', get: r => r.size ? App.int(r.size / 1024) + ' KB' : '' },
          { label: 'Movimientos', html: r => `<span data-n="${r.id}">—</span>` }, { label: '', html: r => `<button class="btn btn-sm" data-chk="${r.id}">Comprobar</button> <button class="btn btn-sm btn-primary" data-res="${r.id}" disabled>Restaurar</button>` }], revs, { sortable: false });
        const cache = {};
        out.querySelectorAll('[data-chk]').forEach(b => b.onclick = async () => {
          const id = b.dataset.chk; b.disabled = true; b.textContent = '…';
          try { const d = cache[id] = await App.drive.leerVersion(file.id, id); out.querySelector(`[data-n="${id}"]`).textContent = App.int(App.drive.n(d)) + ' · plantillas ' + (d.plantillas || []).length; out.querySelector(`[data-res="${id}"]`).disabled = !App.drive.n(d); b.textContent = 'Comprobada'; }
          catch (e) { b.textContent = 'Error'; App.toast(e.message, 5000); }
        });
        out.querySelectorAll('[data-res]').forEach(b => b.onclick = async () => {
          const d = cache[b.dataset.res]; if (!d) return;
          if (!(await App.confirm(`Restaurar la versión con ${App.int(App.drive.n(d))} movimientos. Sustituirá los datos de este dispositivo y de Drive. ¿Continuar?`))) return;
          try { await App.drive.conservarVersion(file.id, b.dataset.res).catch(() => {}); const r = await App.drive.restaurar(d); App.updateBadge(); App.toast(r === 'pushed' ? `Restaurados ${App.int(App.drive.n(d))} movimientos y subidos a Drive` : 'Restaurado en este dispositivo', 6000); App.go('dashboard'); }
          catch (e) { App.toast('Error al restaurar: ' + e.message, 6000); }
        });
      } catch (e) { out.innerHTML = `<div class="alert bad small">${App.esc(e.message)}</div>`; }
    };

    App.$('#impJson').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        if (!obj.movimientos || !obj.categorias) throw new Error('El archivo no tiene el formato esperado');
        if (S.movimientos.length && !(await App.confirm(`Se sustituirán los datos actuales (${App.int(S.movimientos.length)} movimientos) por los del archivo (${App.int(obj.movimientos.length)}). ¿Continuar?`))) return;
        await App.db.replace(obj); App.updateBadge(); App.toast(`Importados ${obj.movimientos.length} movimientos`); App.go('dashboard');
      } catch (err) { App.toast('Error: ' + err.message, 5000); }
    };
    App.$('#expJson').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(App.db.export())], { type: 'application/json' })); a.download = `MiEconomia_copia_${App.today()}.json`; a.click(); };
    App.$('#expXls').onclick = () => App.exportXLSX('MiEconomia_' + App.today(), [
      { name: 'Movimientos', rows: App.movsToRows(S.movimientos) },
      ...Object.entries(App.MASTER).filter(([, d]) => !d.custom).map(([k, d]) => ({ name: d.title.split(' ')[0], money: false, rows: (S[k] || []).map(x => Object.fromEntries(d.fields.map(([f, l]) => [l, x[f] ?? '']))) }))]);
    App.$('#impCfg').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const cfg = JSON.parse(await f.text());
        if (cfg.tipo !== 'configuracion-mi-economia') throw new Error('No es un archivo de configuración de Mi Economía');
        const r = await App.importConfig(cfg); App.updateBadge();
        App.toast(`Configuración importada: ${r.plantillas} plantillas nuevas, ${r.titulares} titulares, ${r.prestamos} datos de préstamos, ${r.cuentas} datos de cuentas`, 5000); App.render();
      } catch (err) { App.toast('Error: ' + err.message, 5000); }
    };
    App.$('#prefSave').onclick = async () => { const p = App.$('#pref'); st.tema = p.tema.value; st.umbralSimilitud = +p.umbralSimilitud.value || 60; st.titulares = p.titulares.value.split(',').map(s => s.trim()).filter(Boolean); st.socioPropio = p.socioPropio.value.trim(); st.desfaseTraspasos = Math.max(0, +p.desfaseTraspasos.value || 0); st.palabrasDescuento = p.palabrasDescuento.value.trim(); await App.db.save(); App.applyTheme(); App.toast('Preferencias guardadas'); App.render(); };
    App.$('#wipe').onclick = async () => { if (await App.confirm('Se borrarán todos los datos guardados en este dispositivo (no los de Drive). ¿Continuar?')) { const keep = st.googleClientId; await App.db.replace({ movimientos: [], categorias: [], settings: { googleClientId: keep } }); App.go('dashboard'); } };
  };
})(window.App);
