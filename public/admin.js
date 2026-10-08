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
    row(dl, 'Jelentések', s.reports.open + ' új, ' + s.reports.mutes + ' aktív némítás', s.reports.open ? 'bad' : 'ok');
    row(dl, 'Hibák', s.errors.distinct + ' féle, összesen ' + s.errors.total + ' előfordulás', s.errors.total ? 'bad' : 'ok');
    const [errs, backs, accts] = await Promise.all([api('GET', '/errors'), api('GET', '/backups'), api('GET', '/accounts')]);
    renderErrors(errs); renderBackups(backs); renderAccounts(accts);
    renderReports(await api('GET', '/reports'));
  }

  // ---- Fiókok: lista, létrehozás ideiglenes jelszóval, új ideiglenes jelszó ----
  let accountData = { accounts: [], legends: [] };

  function renderAccounts(data) {
    accountData = data;
    const sel = $('#newLegend'), keep = sel.value;
    sel.replaceChildren(el('option', { value: '', textContent: '– sima fiók (nem legenda) –' }),
      ...data.legends.map((n) => el('option', { value: n, textContent: 'Legenda: ' + n })));
    sel.value = keep;
    drawAccounts();
  }

  function drawAccounts() {
    const q = $('#acctFilter').value.trim().toLocaleLowerCase('hu-HU');
    const waiting = accountData.accounts.filter((a) => a.mustChangePassword).length;
    $('#acctSummary').textContent = '– ' + accountData.accounts.length + ' regisztrált' + (waiting ? ', ' + waiting + ' még nem választott saját jelszót' : '');
    const box = $('#acctList'); box.replaceChildren();
    const list = accountData.accounts.filter((a) => !q || (a.username + ' ' + a.email).toLocaleLowerCase('hu-HU').includes(q));
    if (!list.length) { box.append(el('p', { className: 'dim', textContent: accountData.accounts.length ? 'Nincs találat.' : 'Még nincs regisztrált fiók.' })); return; }
    const now = Date.now();
    for (const a of list) {
      const tags = [];
      if (a.legend) tags.push(el('span', { className: 'tag', textContent: 'legenda' }));
      if (a.mustChangePassword) {
        const expired = a.tempPasswordExpiresAt && a.tempPasswordExpiresAt < now;
        tags.push(el('span', { className: 'tag bad', textContent: expired ? 'ideiglenes jelszó lejárt' : 'új jelszót kell választania' }));
      }
      if (a.password) tags.push(el('span', { className: 'tag', textContent: 'jelszó' }));
      for (const p of a.providers) tags.push(el('span', { className: 'tag', textContent: p }));
      const buttons = [];
      if (a.password) {
        buttons.push(el('button', { className: 'ghost', textContent: 'Új ideiglenes jelszó', onclick: () => newTemporary(a) }));
      }
      box.append(el('div', { className: 'err' },
        el('div', {}, ...tags, el('b', { textContent: a.username })),
        el('div', { className: 'dim', textContent: a.email + ' • regisztrált: ' + when(a.createdAt) + ' • utolsó belépés: ' + (a.lastLoginAt ? when(a.lastLoginAt) : 'még nem lépett be') +
          (a.mustChangePassword && a.tempPasswordExpiresAt && a.tempPasswordExpiresAt >= now ? ' • az ideiglenes jelszó eddig érvényes: ' + when(a.tempPasswordExpiresAt) : '') }),
        buttons.length ? el('div', { className: 'row', style: 'margin-top:6px' }, ...buttons) : ''));
    }
  }

  // A játékosnak küldhető üzenet (az ideiglenes jelszóval); csak itt, a böngészőben áll össze.
  const inviteText = (i) => 'Szia ' + i.username + '! Elkészült a Kamu Bíróság fiókod.\nOldal: ' + location.origin + '\nE-mail: ' + i.email +
    '\nIdeiglenes jelszó: ' + i.temporaryPassword + ' (' + i.expiresInDays + ' napig érvényes)\nAz első belépéskor új, saját jelszót kell választanod.';

  async function copy(text, sel) {
    try { await navigator.clipboard.writeText(text); msg(sel || '#acctMsg', 'Vágólapra másolva.', 'ok'); }
    catch (_) { msg(sel || '#acctMsg', 'A másolás nem sikerült – jelöld ki és másold ki kézzel.', 'bad'); }
  }

  // Az ideiglenes jelszavak csak itt jelennek meg (a szerver nem tárolja olvashatóan, nem naplózza).
  function showResults(items) {
    const box = $('#acctResult'); box.replaceChildren(); box.classList.remove('hidden');
    box.append(el('p', { className: 'warn', textContent: 'Az ideiglenes jelszavak csak most látszanak – a szerver nem őrzi őket olvasható formában. Küldd el a játékosoknak (pl. Discordon), mielőtt frissíted vagy bezárod az oldalt.' }));
    const good = items.filter((i) => i.ok);
    const head = el('div', { className: 'row', style: 'margin-bottom:6px' },
      el('span', { className: 'dim', textContent: good.length + ' elkészült' + (items.length > good.length ? ', ' + (items.length - good.length) + ' hibás' : '') }));
    if (good.length > 1) head.append(el('button', { textContent: 'Mind másolása', onclick: () => copy(good.map(inviteText).join('\n\n')) }));
    head.append(el('button', { className: 'ghost', textContent: 'Eredmény elrejtése', onclick: () => { box.replaceChildren(); box.classList.add('hidden'); } }));
    box.append(head);
    for (const i of items) {
      if (!i.ok) {
        box.append(el('div', { className: 'err' }, el('b', { className: 'bad', textContent: '✗ ' + (i.username || '(nincs név)') }),
          el('span', { className: 'dim', textContent: '  ' + (i.email || '') }), el('div', { className: 'bad', textContent: i.error })));
        continue;
      }
      box.append(el('div', { className: 'err' },
        el('div', {}, el('b', { textContent: '✓ ' + i.username }), i.legend ? el('span', { className: 'tag', textContent: 'legenda', style: 'margin-left:6px' }) : '',
          el('span', { className: 'dim', textContent: '  ' + i.email })),
        el('div', {}, 'Ideiglenes jelszó: ', el('span', { className: 'pw', textContent: i.temporaryPassword }), el('span', { className: 'dim', textContent: '  (' + i.expiresInDays + ' napig érvényes)' })),
        el('div', { className: 'row', style: 'margin-top:6px' }, el('button', { className: 'ghost', textContent: 'Üzenet másolása', onclick: () => copy(inviteText(i)) }))));
    }
    box.scrollIntoView({ block: 'nearest' });
  }

  async function newTemporary(a) {
    if (!confirm(a.username + ' kap egy új ideiglenes jelszót. A mostani jelszava megszűnik, és minden eszközről kilép. Folytatod?')) return;
    msg('#acctMsg', '');
    try {
      const r = await api('POST', '/accounts/temp-password', { id: a.id });
      showResults([{ ok: true, ...r }]);
      accountData = await api('GET', '/accounts'); renderAccounts(accountData);
    } catch (e) { msg('#acctMsg', e.message, 'bad'); }
  }

  // Soronként „név; e-mail” (vessző / tabulátor is jó): az e-mail címet a @ alapján keressük, ami marad, az a név.
  function parseBulk(text) {
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+/);
      if (!m) { out.push({ error: 'Nincs e-mail cím a sorban.', username: line.slice(0, 30) }); continue; }
      out.push({ username: line.replace(m[0], '').replace(/[;,\t]+/g, ' ').replace(/\s+/g, ' ').trim(), email: m[0] });
    }
    return out;
  }

  $('#acctFilter').addEventListener('input', drawAccounts);
  $('#newAcctForm').addEventListener('submit', async (ev) => {
    ev.preventDefault(); msg('#newAcctMsg', '');
    const b = $('#newAcctBtn'); b.disabled = true;
    try {
      const r = await api('POST', '/accounts', { username: $('#newName').value, email: $('#newEmail').value, legend: $('#newLegend').value });
      showResults([{ ok: true, ...r }]);
      $('#newName').value = ''; $('#newEmail').value = ''; $('#newLegend').value = '';
      renderAccounts(await api('GET', '/accounts'));
    } catch (e) { msg('#newAcctMsg', e.message, 'bad'); }
    b.disabled = false;
  });
  $('#bulkBtn').addEventListener('click', async () => {
    msg('#bulkMsg', '');
    const rows = parseBulk($('#bulkText').value);
    if (!rows.length) { msg('#bulkMsg', 'Írj be legalább egy sort.', 'bad'); return; }
    const sendable = rows.filter((r) => !r.error);
    if (sendable.length > 40) { msg('#bulkMsg', 'Egyszerre legfeljebb 40 fiók hozható létre – oszd több részre.', 'bad'); return; }
    const b = $('#bulkBtn'); b.disabled = true; msg('#bulkMsg', 'Készül… (a jelszó-védelem miatt pár másodpercig tarthat)');
    try {
      const sent = sendable.length ? (await api('POST', '/accounts/bulk', { accounts: sendable })).results : [];
      const results = [...rows.filter((r) => r.error).map((r) => ({ ok: false, ...r })), ...sent];
      showResults(results);
      msg('#bulkMsg', sent.filter((r) => r.ok).length + ' fiók elkészült.', 'ok');
      // csak a sikeres sorok tűnnek el, a hibásak maradnak javításra
      const failed = new Set(results.filter((r) => !r.ok).map((r) => (r.email || '').toLowerCase()));
      $('#bulkText').value = rows.filter((r) => r.error || failed.has(r.email.toLowerCase())).map((r) => r.error ? r.username : r.username + '; ' + r.email).join('\n');
      renderAccounts(await api('GET', '/accounts'));
    } catch (e) { msg('#bulkMsg', e.message, 'bad'); }
    b.disabled = false;
  });

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

  // Jelentések és némítások
  function renderReports(data) {
    const box = $('#reports'); box.replaceChildren();
    $('#repSummary').textContent = data.reports.length + ' jelentés';
    if (!data.reports.length) box.append(el('p', { className: 'ok', textContent: 'Nincs jelentés.' }));
    const act = (label, path, body, cls) => el('button', { className: cls || 'ghost', textContent: label, onclick: async () => {
      try { await api('POST', path, body); await load(); msg('#repMsg', 'Kész.', 'ok'); } catch (e) { msg('#repMsg', e.message, 'bad'); }
    } });
    for (const r of data.reports) {
      const buttons = [act('Némítás 1 óra', '/reports/mute', { id: r.id, minutes: 60 }, ''), act('1 nap', '/reports/mute', { id: r.id, minutes: 1440 }, 'ghost')];
      if (r.channel === 'board') buttons.push(act('Üzenet elrejtése', '/reports/hide', { id: r.id }, 'ghost'));
      if (r.status !== 'dismissed') buttons.push(act('Elvet', '/reports/dismiss', { id: r.id }, 'ghost'));
      box.append(el('div', { className: 'err' },
        el('div', {}, el('span', { className: 'tag', textContent: r.channel === 'room' ? 'szoba ' + (r.code || '') : 'közös tér' }), el('b', { textContent: r.name }),
          el('span', { className: 'dim', textContent: '  ' + (r.status === 'muted' ? '🔇 némítva' : r.status === 'dismissed' ? '✓ elvetve' : 'új') })),
        el('div', { textContent: '„' + r.text + '”' }),
        el('div', { className: 'dim', textContent: r.count + '× jelentették: ' + r.reporters.join(', ') + ' • ' + when(r.ts) }),
        el('div', { className: 'row', style: 'margin-top:6px' }, ...buttons)));
    }
    const mutes = $('#mutes'); mutes.replaceChildren();
    if (!data.mutes.length) mutes.append(el('p', { className: 'dim', textContent: 'Nincs aktív némítás.' }));
    for (const m of data.mutes) {
      mutes.append(el('div', { className: 'err row' }, el('span', { textContent: m.label + ' – még ' + m.minutesLeft + ' perc' }),
        el('button', { className: 'ghost', textContent: 'Feloldás', onclick: async () => {
          try { await api('POST', '/mutes/remove', { id: m.id }); await load(); } catch (e) { msg('#repMsg', e.message, 'bad'); }
        } })));
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
  $('#clearReports').addEventListener('click', async () => { if (confirm('Biztosan törlöd az összes jelentést? (A némítások megmaradnak.)')) { await api('POST', '/reports/clear'); load(); } });
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
