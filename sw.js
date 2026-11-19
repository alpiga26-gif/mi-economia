/* Service worker: permite abrir la app sin conexión (los datos están en el dispositivo) */
const CACHE = 'mi-economia-v14';
const LOCAL = ['./', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/core.js', 'js/db.js', 'js/calc.js', 'js/export.js', 'js/desglose.js', 'js/view-revisar.js', 'js/entrada.js', 'js/drive.js', 'js/view-dashboard.js', 'js/view-movimientos.js', 'js/view-captura.js',
  'js/view-informes.js', 'js/view-actividad.js', 'js/view-proyeccion.js', 'js/view-maestro.js', 'js/view-calidad.js', 'js/view-ajustes.js', 'js/main.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(LOCAL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('googleapis.com') || u.hostname === 'accounts.google.com') return;
  // Red primero para los ficheros propios (para recibir actualizaciones); caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (u.origin === location.origin || u.hostname === 'cdn.jsdelivr.net')) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request)));
});
