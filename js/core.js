/* Utilidades comunes, router y componentes de UI */
window.App = window.App || {};
(function (App) {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  App.$ = $; App.$$ = $$;

  /* Formato español con punto de miles SIEMPRE (el formato es-ES del navegador no agrupa las cifras de 4 dígitos: 2615,74) */
  const grp = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const bad = (v) => v == null || v === '' || isNaN(v);
  App.int = (v) => { if (bad(v)) return ''; const n = Math.round(+v); return (n < 0 ? '-' : '') + grp(String(Math.abs(n))); };
  App.num = (v) => { if (bad(v)) return ''; const x = +v; if (Math.abs(x) < 0.005) return '0,00'; const [i, d] = Math.abs(x).toFixed(2).split('.'); return (x < 0 ? '-' : '') + grp(i) + ',' + d; };
  App.eur = (v) => bad(v) ? '—' : App.num(v) + ' €';
  App.eur0 = (v) => bad(v) ? '—' : App.int(v) + ' €';
  /* Cualquier número para mostrar: enteros con punto de miles; decimales con coma (p. ej. un tipo de interés 3,265) */
  App.fmt = (v) => typeof v !== 'number' || isNaN(v) ? v : Number.isInteger(v) ? App.int(v) : String(v).replace('.', ',');
  App.pct = (v) => (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(1).replace('.', ',') + ' %';
  App.cls = (v) => v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '';

  App.esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Fechas: se guardan como 'YYYY-MM-DD' */
  App.today = () => new Date().toISOString().slice(0, 10);
  App.ym = (iso) => (iso || '').slice(0, 7);
  App.fdate = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  App.MESES = MESES;
  App.monthName = (ym) => { const [y, m] = ym.split('-'); return MESES[+m - 1] + ' ' + y; };
  App.monthShort = (ym) => { const [y, m] = ym.split('-'); return MES3[+m - 1] + ' ' + y.slice(2); };
  App.addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return y + '-' + String(m).padStart(2, '0'); };
  App.endOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return ym + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0'); };
  App.monthsBetween = (a, b) => { const out = []; let c = a; while (c <= b) { out.push(c); c = App.addMonths(c, 1); } return out; };
  App.parseDate = (s) => {
    if (s == null || s === '') return null;
    if (s instanceof Date) return isNaN(s) ? null : new Date(s.getTime() - s.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (typeof s === 'number') { const d = new Date(Math.round((s - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
    s = String(s).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { let y = m[3]; if (y.length === 2) y = (+y > 70 ? '19' : '20') + y; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    return null;
  };
  App.parseNum = (s) => {
    if (s == null || s === '') return null;
    if (typeof s === 'number') return s;
    let t = String(s).replace(/[€\s ]/g, '').replace(/EUR/i, '');
    if (!t || t === '-') return null;
    const neg = /^\(.*\)$/.test(t); t = t.replace(/[()]/g, '');
    if (/,\d{1,2}$/.test(t) || (t.includes(',') && t.includes('.') && t.lastIndexOf(',') > t.lastIndexOf('.'))) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const v = parseFloat(t); return isNaN(v) ? null : (neg ? -v : v);
  };
  App.round2 = (v) => Math.round(v * 100) / 100;
  App.uid = (p = 'M') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  App.norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  /* Toast y modal */
  let toastT;
  App.toast = (msg, ms = 2800) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); };
  App.modal = (html, onMount) => {
    const m = $("#modal"); m.querySelector(".modal-card").className = "modal-card"; $("#modalBody").innerHTML = html; m.hidden = false;
    const close = () => { m.hidden = true; $('#modalBody').innerHTML = ''; };
    m.onclick = (e) => { if (e.target === m) close(); };
    $$('[data-close]', m).forEach(b => b.onclick = close);
    if (onMount) onMount($('#modalBody'), close);
    return close;
  };
  App.confirm = (msg) => new Promise(res => {
    App.modal(`<p>${App.esc(msg)}</p><div class="modal-actions"><button class="btn" data-close>Cancelar</button><button class="btn btn-primary" id="cfOk">Aceptar</button></div>`,
      (el, close) => { $('#cfOk', el).onclick = () => { close(); res(true); }; $$('[data-close]', el).forEach(b => b.addEventListener('click', () => res(false))); });
  });

  /* Carga perezosa de librerías externas */
  const loaded = {};
  App.loadScript = (src) => loaded[src] || (loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s);
  }));

  /* Router por hash */
  App.views = {};
  App.route = { name: 'dashboard', params: {} };
  App.charts = [];
  App.destroyCharts = () => { App.charts.forEach(c => c.destroy()); App.charts = []; };
  App.render = async () => {
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [name, qs] = hash.split('?');
    App.route = { name, params: Object.fromEntries(new URLSearchParams(qs || '')) };
    $$('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === name));
    $('#sidenav').classList.remove('open');
    App.destroyCharts();
    const v = App.views[name] || App.views.dashboard;
    const el = $('#view');
    try { await v(el, App.route.params); } catch (e) { console.error(e); el.innerHTML = `<div class="alert bad">Error al mostrar la vista: ${App.esc(e.message)}</div>`; }
    el.focus({ preventScroll: true });
  };
  App.go = (h) => { if (location.hash === '#/' + h) App.render(); else location.hash = '#/' + h; };

  /* Tabla HTML reutilizable con ordenación */
  App.table = (cols, rows, opts = {}) => {
    const id = 'tbl' + Math.random().toString(36).slice(2, 8);
    const head = cols.map((c, i) => `<th class="${c.num ? 'num' : ''} ${opts.sortable !== false ? 'sortable' : ''}" data-i="${i}">${App.esc(c.label)}</th>`).join('');
    const body = rows.map(r => `<tr class="${r._cls || ''}" ${r._attrs || ''}>` + cols.map(c => {
      const v = typeof c.get === 'function' ? c.get(r) : r[c.key];
      const html = c.html ? c.html(r) : (c.money ? App.num(v) : c.num ? App.esc(App.fmt(v)) : App.esc(v));
      // el valor numérico se guarda aparte para ordenar sin depender del formato (1.234,56)
      const dv = (c.money || c.num) && typeof v === 'number' ? ` data-v="${v}"` : '';
      return `<td class="${c.num || c.money ? 'num' : ''} ${c.wrap ? 'wrap' : ''} ${c.money && opts.color !== false ? App.cls(v) : ''}"${dv}>${html}</td>`;
    }).join('') + '</tr>').join('');
    const foot = opts.total ? `<tr class="total">${opts.total.map((t, i) => `<td class="${cols[i] && (cols[i].money || cols[i].num) ? 'num' : ''}">${typeof t === 'number' ? (cols[i] && cols[i].num && !cols[i].money ? App.fmt(t) : App.num(t)) : App.esc(t ?? '')}</td>`).join('')}</tr>` : '';
    setTimeout(() => {
      const t = document.getElementById(id); if (!t || opts.sortable === false) return;
      t.querySelectorAll('th.sortable').forEach(th => th.onclick = () => {
        const i = +th.dataset.i, c = cols[i], dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        t.querySelectorAll('th').forEach(x => delete x.dataset.dir); th.dataset.dir = dir;
        const tb = t.tBodies[0]; const trs = Array.from(tb.rows).filter(r => !r.classList.contains('total'));
        const val = (tr) => { const td = tr.cells[i], s = td.textContent; if (c.money || c.num) return td.dataset.v != null ? +td.dataset.v : (App.parseNum(s.replace(/\.(?=\d{3}(?!\d))/g, '')) ?? -Infinity); return s.toLowerCase(); };
        trs.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'asc' ? 1 : -1); });
        const tot = tb.querySelector('tr.total'); trs.forEach(r => tb.insertBefore(r, tot));
      });
    });
    return `<div class="table-wrap" style="${opts.maxH ? 'max-height:' + opts.maxH : ''}"><table class="t" id="${id}"><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table></div>`;
  };

  /* Paleta de gráficos (lee los tokens CSS para modo claro/oscuro) */
  App.css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  App.series = () => [1, 2, 3, 4, 5, 6, 7, 8].map(i => App.css('--s' + i));
  App.chartDefaults = () => {
    if (!window.Chart) return;
    Chart.defaults.font.family = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    Chart.defaults.color = App.css('--text-2');
    Chart.defaults.borderColor = App.css('--grid');
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.useBorderRadius = true;
    Chart.defaults.plugins.legend.labels.borderRadius = 3;
    Chart.defaults.plugins.tooltip.backgroundColor = App.css('--surface');
    Chart.defaults.plugins.tooltip.titleColor = App.css('--text');
    Chart.defaults.plugins.tooltip.bodyColor = App.css('--text');
    Chart.defaults.plugins.tooltip.borderColor = App.css('--border');
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 8;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.elements.bar.borderRadius = 4;
    Chart.defaults.elements.line.borderWidth = 2;
    Chart.defaults.elements.point.radius = 0;
    Chart.defaults.elements.point.hoverRadius = 5;
  };
  App.chart = (canvas, cfg) => { if (!window.Chart) { canvas.parentElement.innerHTML = '<p class="muted small">Gráficos no disponibles sin conexión.</p>'; return null; } const c = new Chart(canvas, cfg); App.charts.push(c); return c; };
  App.moneyTick = (v) => App.eur0(v);
})(window.App);
