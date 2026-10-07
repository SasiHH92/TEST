'use strict';

// Az /admin oldal szkriptje (külön fájlban, mert a CSP nem engedi az inline szkriptet).
(function () {
  const $ = (s) => document.querySelector(s);
  let token = '';
  try { token = sessionStorage.getItem('kb_admin') || ''; } catch (_) { /* tiltott tároló */ }

  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    Object.assign(e, props || {});
    for (const k of kids) e.append(k);
    return e;
  }
  const when = (v) => v ? new Date(v).toLocaleString('hu-HU') : '–';

  async function api(method, path, body) {
    const res = await fetch('/api/admin' + path, {
      method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* nincs JSON */ }
    if (!res.ok) { const e = new Error(data.error || ('Hiba (' + res.status + ')')); e.status = res.status; throw e; }
    return data;
  }

  function show(on) {
    $('#login').classList.toggle('hidden', on);
    $('#panel').classList.toggle('hidden', !on);
  }

  function row(dl, k, v, cls) { dl.append(el('dt', { textContent: k }), el('dd', { textContent: v, className: cls || '' })); }

  async function load() {
    const s = await api('GET', '/status');
    show(true);
    const dl = $('#status'); dl.replaceChildren();
    row(dl, 'Futásidő', Math.floor(s.uptimeSeconds / 60) + ' perc');
    row(dl, 'Adatbázis (Neon)', s.database ? 'be van kötve' : 'NINCS (csak helyi fájlok)', s.database ? 'ok' : 'bad');
    row(dl, 'Mentések', s.backups.error ? 'hiba: ' + s.backups.error : s.backups.count + ' db, legutóbbi: ' + (s.backups.latest ? when(s.backups.latest.takenAt) : 'még nincs'), s.backups.error ? 'bad' : (s.backups.count ? 'ok' : 'dim'));
    row(dl, 'Levélküldés', s.mail.configured ? 'be van állítva' : 'nincs beállítva (kulcs: ' + (s.mail.key ? 'van' : 'nincs') + ', feladó: ' + (s.mail.sender ? 'van' : 'nincs') + ', AUTH_BASE_URL: ' + (s.mail.baseUrl ? 'van' : 'nincs') + ')', s.mail.configured ? 'ok' : 'bad');
    row(dl, 'Hibák', s.errors.distinct + ' féle, összesen ' + s.errors.total + ' előfordulás', s.errors.total ? 'bad' : 'ok');
    const [errs, backs] = await Promise.all([api('GET', '/errors'), api('GET', '/backups')]);
    renderErrors(errs); renderBackups(backs);
  }

  function renderErrors(data) {
    const box = $('#errors'); box.replaceChildren();
    $('#errSummary').textContent = data.summary.total + ' előfordulás';
    if (!data.errors.length) { box.append(el('p', { className: 'ok', textContent: 'Nincs rögzített hiba. 🎉' })); return; }
    for (const e of data.errors) {
      const ctx = Object.entries(e.ctx || {}).map(([k, v]) => k + '=' + v).join(', ');
      box.append(el('div', { className: 'err' },
        el('div', {}, el('span', { className: 'tag', textContent: e.kind }), el('b', { textContent: e.message || '(üres üzenet)' })),
        el('div', { className: 'dim', textContent: e.count + '× • első: ' + when(e.first) + ' • utolsó: ' + when(e.last) + (ctx ? ' • ' + ctx : '') }),
        e.stack && e.stack.length ? el('pre', { textContent: e.stack.join('\n') }) : ''));
    }
  }

  function renderBackups(data) {
    const box = $('#backups'); box.replaceChildren();
    if (!data.database) { box.append(el('p', { className: 'bad', textContent: 'Nincs adatbázis (DATABASE_URL), ezért nincs mentés.' })); return; }
    if (!data.backups.length) { box.append(el('p', { className: 'dim', textContent: 'Még nincs mentés.' })); return; }
    for (const b of data.backups) box.append(el('div', { className: 'err' }, el('b', { textContent: b.id }), el('span', { className: 'dim', textContent: '  ' + when(b.takenAt) + ' • ' + Math.round((b.bytes || 0) / 1024) + ' KB' })));
  }

  const msg = (sel, text, cls) => { const m = $(sel); m.textContent = text; m.className = 'msg ' + (cls || ''); };

  $('#loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    token = $('#token').value.trim();
    msg('#loginMsg', '');
    try {
      await load();
      try { sessionStorage.setItem('kb_admin', token); } catch (_) { /* nem kritikus */ }
      $('#token').value = '';
    } catch (e) {
      token = '';
      msg('#loginMsg', e.status === 404 ? 'Az admin felület nincs bekapcsolva (hiányzik vagy túl rövid az ADMIN_TOKEN).' : e.message, 'bad');
    }
  });
  $('#reload').addEventListener('click', () => load().catch((e) => msg('#backupMsg', e.message, 'bad')));
  $('#clearErrors').addEventListener('click', async () => { if (confirm('Biztosan törlöd a hibanaplót?')) { await api('POST', '/errors/clear'); load(); } });
  $('#backupNow').addEventListener('click', async () => {
    const b = $('#backupNow'); b.disabled = true; msg('#backupMsg', 'Mentés…');
    try { const r = await api('POST', '/backups'); msg('#backupMsg', 'Kész: ' + r.backup.id, 'ok'); await load(); }
    catch (e) { msg('#backupMsg', e.message, 'bad'); }
    b.disabled = false;
  });
  $('#mailForm').addEventListener('submit', async (ev) => {
    ev.preventDefault(); msg('#mailMsg', 'Küldés…');
    try { await api('POST', '/mail-test', { to: $('#mailTo').value }); msg('#mailMsg', 'Elküldve – nézd meg a postaládát (a spamet is).', 'ok'); }
    catch (e) { msg('#mailMsg', e.message, 'bad'); }
  });
  $('#resetForm').addEventListener('submit', async (ev) => {
    ev.preventDefault(); msg('#resetMsg', '');
    try {
      const r = await api('POST', '/reset-link', { email: $('#resetEmail').value });
      const m = $('#resetMsg'); m.className = 'msg ok'; m.replaceChildren(el('span', { textContent: r.username + ' számára (' + r.expiresInMinutes + ' percig érvényes): ' }), el('code', { textContent: r.link }));
    } catch (e) { msg('#resetMsg', e.message, 'bad'); }
  });

  if (token) load().catch(() => { token = ''; try { sessionStorage.removeItem('kb_admin'); } catch (_) { /* */ } });
})();
