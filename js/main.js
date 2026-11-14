/* Arranque de la aplicación */
(async function (App) {
  await App.db.load();
  if (App.state.movimientos.length) await App.migrate();
  App.applyTheme();
  window.addEventListener('hashchange', App.render);
  document.getElementById('btnMenu').onclick = () => document.getElementById('sidenav').classList.toggle('open');
  document.getElementById('btnQuickScan').onclick = () => App.go('captura?tab=ticket');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => App.render());
  await App.render();
  setTimeout(App.updateBadge, 50);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  // Si ya se conectó Drive en este dispositivo, intenta sincronizar en silencio
  // y comprueba si hay extractos esperando en la carpeta Entrada
  if (App.state.settings.googleClientId && localStorage.getItem('driveConnected')) setTimeout(async () => {
    await App.drive.sync(false);
    const n = await App.contarEntrada();
    if (n) { App.toast(`📥 ${n} archivo(s) nuevos en la carpeta Entrada de Drive`, 5000); if (['revisar', 'captura'].includes(App.route.name)) App.render(); }
  }, 1500);
})(window.App);
