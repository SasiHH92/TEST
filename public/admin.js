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
  const msg = (sel, text, cls) => { const m = $(sel); m.textContent = text; m.className = 'msg ' + (cls || ''); };

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
    $('#topActions').classList.toggle('hidden', !on);
  }

  // ---- Fülek ----
  const TABS = { accounts: '#accounts', reports: '#tab-reports', errors: '#tab-errors', system: '#tab-system' };
  function selectTab(name, focus) {
    if (!TABS[name]) name = 'accounts';
    for (const [key, sel] of Object.entries(TABS)) {
      $(sel).classList.toggle('hidden', key !== name);
      const b = $('#tabbtn-' + key); b.setAttribute('aria-selected', String(key === name)); b.tabIndex = key === name ? 0 : -1;
      if (key === name && focus) b.focus();
    }
    try { sessionStorage.setItem('kb_admin_tab', name); } catch (_) { /* nem kritikus */ }
  }
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => selectTab(b.dataset.tab));
  $('.tabs').addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const names = Object.keys(TABS), now = names.findIndex((n) => $('#tabbtn-' + n).getAttribute('aria-selected') === 'true');
    selectTab(names[(now + (ev.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length], true);
    ev.preventDefault();
  });
  let startTab = 'accounts';
  try { startTab = sessionStorage.getItem('kb_admin_tab') || 'accounts'; } catch (_) { /* nem kritikus */ }
  selectTab(startTab);

  // ---- Megerősítő ablak: veszélyes műveletnél a nevet / a TÖRLÖM szót be kell gépelni ----
  const ask = { dlg: $('#askDialog'), done: null };
  function askConfirm({ title, lines = [], word = '', wordLabel = '', okLabel = 'OK', danger = false }) {
    return new Promise((resolve) => {
      $('#askTitle').textContent = title;
      $('#askBody').replaceChildren(...lines.map((t) => el('p', { textContent: t })));
      const box = $('#askWordBox'), input = $('#askWord'), ok = $('#askOk');
      box.classList.toggle('hidden', !word);
      $('#askWordLabel').textContent = wordLabel;
      input.value = '';
      ok.textContent = okLabel; ok.className = danger ? 'solid-danger' : '';
      const lower = (t) => t.trim().toLocaleLowerCase('hu-HU');
      const check = () => { ok.disabled = !!word && lower(input.value) !== lower(word); };
      check();
      ask.done = (v) => { ask.done = null; if (ask.dlg.open) ask.dlg.close(); resolve(v); };
      input.oninput = check;
      $('#askForm').onsubmit = (ev) => { ev.preventDefault(); if (!ok.disabled && ask.done) ask.done(true); };
      $('#askCancel').onclick = () => { if (ask.done) ask.done(false); };
      ask.dlg.oncancel = (ev) => { ev.preventDefault(); if (ask.done) ask.done(false); };
      ask.dlg.showModal();
      (word ? input : ok).focus();
    });
  }

  function row(dl, k, v, cls) { dl.append(el('dt', { textContent: k }), el('dd', { textContent: v, className: cls || '' })); }

  // ---- Betöltés ----
  let lastStatus = null;
  async function load() {
    const s = await api('GET', '/status'); // előbb ez: rossz tokennel csak egy sikertelen próba számít
    show(true);
    const [errs, backs, accts, reps] = await Promise.all([api('GET', '/errors'), api('GET', '/backups'), api('GET', '/accounts'), api('GET', '/reports')]);
    lastStatus = s;
    renderSystem(s); renderErrors(errs); renderBackups(backs); renderReports(reps); renderAccounts(accts);
    $('#cntErrors').textContent = s.errors.total ? String(s.errors.total) : ''; $('#cntErrors').className = 'count' + (s.errors.total ? ' bad' : '');
    $('#cntReports').textContent = s.reports.open ? String(s.reports.open) : ''; $('#cntReports').className = 'count' + (s.reports.open ? ' bad' : '');
  }

  function renderSystem(s) {
    const dl = $('#status'); dl.replaceChildren();
    row(dl, 'Futásidő', Math.floor(s.uptimeSeconds / 60) + ' perc');
    row(dl, 'Adatbázis (Neon)', s.database ? 'be van kötve' : 'NINCS (csak helyi fájlok)', s.database ? 'ok' : 'bad');
    row(dl, 'Mentések', s.backups.error ? 'hiba: ' + s.backups.error : s.backups.count + ' db, legutóbbi: ' + (s.backups.latest ? when(s.backups.latest.takenAt) : 'még nincs'), s.backups.error ? 'bad' : (s.backups.count ? 'ok' : 'dim'));
    row(dl, 'Levélküldés', s.mail.configured ? 'be van állítva' : 'nincs beállítva (kulcs: ' + (s.mail.key ? 'van' : 'nincs') + ', feladó: ' + (s.mail.sender ? 'van' : 'nincs') + ', AUTH_BASE_URL: ' + (s.mail.baseUrl ? 'van' : 'nincs') + ')', s.mail.configured ? 'ok' : 'bad');
    row(dl, 'Jelentések', s.reports.open + ' új, ' + s.reports.mutes + ' aktív némítás', s.reports.open ? 'bad' : 'ok');
    row(dl, 'Hibák', s.errors.distinct + ' féle, összesen ' + s.errors.total + ' előfordulás', s.errors.total ? 'bad' : 'ok');
  }

  // Összesítő kártyák a lap tetején (a kártyára kattintva a megfelelő fülre ugrik)
  function renderStats() {
    const s = lastStatus; if (!s) return;
    const waiting = accountData.accounts.filter((a) => a.mustChangePassword).length;
    const card = (tab, value, label, cls) => el('button', { type: 'button', className: 'stat', onclick: () => selectTab(tab) },
      el('b', { textContent: value, className: cls || '' }), el('span', { textContent: label }));
    $('#stats').replaceChildren(
      card('accounts', String(accountData.accounts.length), 'regisztrált fiók'),
      card('accounts', String(waiting), 'még nem választott saját jelszót', waiting ? 'bad' : 'ok'),
      card('reports', String(s.reports.open), 'új jelentés', s.reports.open ? 'bad' : 'ok'),
      card('errors', String(s.errors.total), 'rögzített hiba', s.errors.total ? 'bad' : 'ok'),
      card('system', s.database ? 'Neon ✓' : 'NINCS', 'adatbázis', s.database ? 'ok' : 'bad'),
      card('system', s.backups.latest ? when(s.backups.latest.takenAt).replace(/:\d\d$/, '') : 'még nincs', 'legutóbbi mentés', s.backups.latest ? '' : 'bad'));
  }

  // ---- Fiókok: lista (szűrés, rendezés, kijelölés), létrehozás ideiglenes jelszóval, új ideiglenes jelszó, törlés ----
  let accountData = { accounts: [], legends: [] };
  const view = { chip: 'all' };
  const picked = new Set();
  const isExpired = (a) => !!(a.mustChangePassword && a.tempPasswordExpiresAt && a.tempPasswordExpiresAt < Date.now());
  const CHIPS = [
    ['all', 'Mind', () => true],
    ['waiting', 'Új jelszót kell választania', (a) => a.mustChangePassword && !isExpired(a)],
    ['expired', 'Lejárt ideiglenes jelszó', isExpired],
    ['legend', 'Legenda', (a) => !!a.legend],
    ['external', 'Google / Discord', (a) => a.providers.length > 0],
    ['never', 'Még nem lépett be', (a) => !a.lastLoginAt]
  ];
  const SORTS = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    name: (a, b) => a.username.localeCompare(b.username, 'hu'),
    login: (a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0)
  };

  function renderAccounts(data) {
    accountData = data;
    const sel = $('#newLegend'), keep = sel.value;
    sel.replaceChildren(el('option', { value: '', textContent: '– sima fiók (nem legenda) –' }),
      ...data.legends.map((n) => el('option', { value: n, textContent: 'Legenda: ' + n })));
    sel.value = keep;
    const ids = new Set(data.accounts.map((a) => a.id));
    for (const id of [...picked]) if (!ids.has(id)) picked.delete(id);
    $('#cntAccounts').textContent = String(data.accounts.length);
    renderStats();
    drawAccounts();
  }

  function visibleAccounts() {
    const q = $('#acctFilter').value.trim().toLocaleLowerCase('hu-HU');
    const test = CHIPS.find((c) => c[0] === view.chip)[2];
    return accountData.accounts.filter((a) => test(a) && (!q || (a.username + ' ' + a.email).toLocaleLowerCase('hu-HU').includes(q))).sort(SORTS[$('#acctSort').value] || SORTS.newest);
  }

  function drawAccounts() {
    const waiting = accountData.accounts.filter((a) => a.mustChangePassword).length;
    $('#acctSummary').textContent = '– ' + accountData.accounts.length + ' regisztrált' + (waiting ? ', ' + waiting + ' még nem választott saját jelszót' : '');
    $('#acctChips').replaceChildren(...CHIPS.map(([key, label, fn]) => el('button', { type: 'button', className: 'chip', textContent: label + ' (' + accountData.accounts.filter(fn).length + ')',
      onclick: () => { view.chip = key; drawAccounts(); } }, '')));
    for (const [i, c] of CHIPS.entries()) $('#acctChips').children[i].setAttribute('aria-pressed', String(c[0] === view.chip));
    const box = $('#acctList'); box.replaceChildren();
    const list = visibleAccounts();
    if (!list.length) box.append(el('p', { className: 'dim', textContent: accountData.accounts.length ? 'Nincs találat.' : 'Még nincs regisztrált fiók.' }));
    const now = Date.now();
    for (const a of list) {
      const tags = [];
      if (a.legend) tags.push(el('span', { className: 'tag', textContent: 'legenda' }));
      if (isExpired(a)) tags.push(el('span', { className: 'tag bad', textContent: 'ideiglenes jelszó lejárt' }));
      else if (a.mustChangePassword) tags.push(el('span', { className: 'tag bad', textContent: 'új jelszót kell választania' }));
      else if (a.password) tags.push(el('span', { className: 'tag good', textContent: 'saját jelszó' }));
      for (const p of a.providers) tags.push(el('span', { className: 'tag', textContent: p }));
      const box1 = el('input', { type: 'checkbox', className: 'pick', checked: picked.has(a.id) });
      box1.setAttribute('aria-label', a.username + ' kijelölése');
      const item = el('div', { className: 'acct' + (picked.has(a.id) ? ' picked' : '') });
      box1.addEventListener('change', () => {
        if (box1.checked) picked.add(a.id); else picked.delete(a.id);
        item.classList.toggle('picked', box1.checked); updateSelbar(visibleAccounts());
      });
      const actions = el('div', { className: 'acct-actions' });
      if (a.password) actions.append(el('button', { type: 'button', className: 'ghost small', textContent: 'Új ideiglenes jelszó', onclick: () => newTemporary(a) }));
      actions.append(el('button', { type: 'button', className: 'danger small', textContent: 'Törlés', onclick: () => deleteAccounts([a]) }));
      item.append(box1,
        el('div', {},
          el('div', { className: 'acct-name' }, ...tags, el('b', { textContent: a.username })),
          el('div', { className: 'acct-mail', textContent: a.email }),
          el('div', { className: 'acct-dates', textContent: 'regisztrált: ' + when(a.createdAt) + ' • utolsó belépés: ' + (a.lastLoginAt ? when(a.lastLoginAt) : 'még nem lépett be') }),
          a.mustChangePassword && a.tempPasswordExpiresAt ? el('div', { className: 'acct-note', textContent: a.tempPasswordExpiresAt >= now ? 'Az ideiglenes jelszó eddig érvényes: ' + when(a.tempPasswordExpiresAt) : 'Az ideiglenes jelszó lejárt (' + when(a.tempPasswordExpiresAt) + '), kérj újat.' }) : ''),
        actions);
      box.append(item);
    }
    updateSelbar(list);
  }

  function updateSelbar(list) {
    const n = picked.size, shown = list.filter((a) => picked.has(a.id)).length;
    $('#selCount').textContent = n ? n + ' kijelölve' : '';
    $('#selTemp').disabled = !n; $('#selDelete').disabled = !n;
    const all = $('#selAll'); all.checked = !!list.length && shown === list.length; all.indeterminate = shown > 0 && shown < list.length;
  }
  $('#selAll').addEventListener('change', (ev) => {
    for (const a of visibleAccounts()) { if (ev.target.checked) picked.add(a.id); else picked.delete(a.id); }
    drawAccounts();
  });
  $('#acctFilter').addEventListener('input', drawAccounts);
  $('#acctSort').addEventListener('change', drawAccounts);

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
    if (good.length > 1) head.append(el('button', { type: 'button', textContent: 'Mind másolása', onclick: () => copy(good.map(inviteText).join('\n\n')) }));
    head.append(el('button', { type: 'button', className: 'ghost', textContent: 'Eredmény elrejtése', onclick: () => { box.replaceChildren(); box.classList.add('hidden'); } }));
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
        el('div', { className: 'row', style: 'margin-top:6px' }, el('button', { type: 'button', className: 'ghost small', textContent: 'Üzenet másolása', onclick: () => copy(inviteText(i)) }))));
    }
    box.scrollIntoView({ block: 'nearest' });
  }

  const refreshAccounts = async () => renderAccounts(await api('GET', '/accounts'));
  const fail = (a, e) => ({ ok: false, username: a.username, email: a.email, error: e.message });

  // Új ideiglenes jelszó egy vagy több fióknak (egymás után; a jelszó nélküli – Google / Discord – fiók hibasorként jelenik meg)
  async function newTemporary(list) {
    if (!Array.isArray(list)) list = [list];
    const many = list.length > 1;
    const yes = await askConfirm({ title: 'Új ideiglenes jelszó', okLabel: 'Új jelszó készítése',
      lines: [many ? list.length + ' fiók kap új ideiglenes jelszót.' : list[0].username + ' kap egy új ideiglenes jelszót.',
        'A mostani jelszó megszűnik, és a játékos minden eszközről kilép. Belépéskor új, saját jelszót kell választania.'] });
    if (!yes) return;
    msg('#acctMsg', '');
    const items = [];
    for (const [i, a] of list.entries()) {
      if (many) msg('#acctMsg', 'Készül… (' + (i + 1) + '/' + list.length + ')');
      if (!a.password) { items.push(fail(a, new Error('Google / Discord belépést használ, nincs jelszava.'))); continue; }
      try { items.push({ ok: true, ...(await api('POST', '/accounts/temp-password', { id: a.id })) }); }
      catch (e) { items.push(fail(a, e)); }
    }
    showResults(items); msg('#acctMsg', '');
    try { await refreshAccounts(); } catch (e) { msg('#acctMsg', e.message, 'bad'); }
  }

  // Végleges törlés: egy fióknál a felhasználónevet, többnél a TÖRLÖM szót kell begépelni
  async function deleteAccounts(list) {
    const one = list.length === 1;
    const lines = one
      ? [list[0].username + ' (' + list[0].email + ') fiókja végleg törlődik: a belépése, a barátlistái, a privát üzenetei és a bolt-adatai is megszűnnek.']
      : [list.length + ' fiók végleg törlődik: a belépésük, a barátlistáik, a privát üzeneteik és a bolt-adataik is megszűnnek.'];
    if (list.some((a) => a.legend)) lines.push('A legendás kártyák statisztikája megmarad, a kártya újra odaadható.');
    lines.push('Ez nem vonható vissza.');
    const yes = await askConfirm({ title: one ? 'Fiók törlése' : 'Fiókok törlése', lines, okLabel: 'Végleg törlöm', danger: true,
      word: one ? list[0].username : 'TÖRLÖM', wordLabel: one ? 'A megerősítéshez írd be a felhasználónevet: ' + list[0].username : 'A megerősítéshez írd be: TÖRLÖM' });
    if (!yes) return;
    let done = 0; const errors = [];
    for (const [i, a] of list.entries()) {
      if (!one) msg('#acctMsg', 'Törlés… (' + (i + 1) + '/' + list.length + ')');
      try { await api('POST', '/accounts/delete', { id: a.id, confirmName: a.username }); done++; picked.delete(a.id); }
      catch (e) { errors.push(a.username + ': ' + e.message); }
    }
    try { await refreshAccounts(); } catch (e) { errors.push('a lista frissítése: ' + e.message); } // előbb a lista frissül, utána jön az üzenet
    msg('#acctMsg', done + ' fiók törölve.' + (errors.length ? ' Hiba: ' + errors.join(' • ') : ''), errors.length ? 'bad' : 'ok');
  }
  $('#selTemp').addEventListener('click', () => newTemporary(accountData.accounts.filter((a) => picked.has(a.id))));
  $('#selDelete').addEventListener('click', () => deleteAccounts(accountData.accounts.filter((a) => picked.has(a.id))));

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

  $('#newAcctForm').addEventListener('submit', async (ev) => {
    ev.preventDefault(); msg('#newAcctMsg', '');
    const b = $('#newAcctBtn'); b.disabled = true;
    try {
      const r = await api('POST', '/accounts', { username: $('#newName').value, email: $('#newEmail').value, legend: $('#newLegend').value });
      showResults([{ ok: true, ...r }]);
      $('#newName').value = ''; $('#newEmail').value = ''; $('#newLegend').value = '';
      await refreshAccounts();
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
      await refreshAccounts();
    } catch (e) { msg('#bulkMsg', e.message, 'bad'); }
    b.disabled = false;
  });

  // ---- Hibák ----
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

  // ---- Jelentések és némítások ----
  function renderReports(data) {
    const box = $('#reports'); box.replaceChildren();
    $('#repSummary').textContent = data.reports.length + ' jelentés';
    if (!data.reports.length) box.append(el('p', { className: 'ok', textContent: 'Nincs jelentés.' }));
    const act = (label, path, body, cls) => el('button', { type: 'button', className: 'small ' + (cls || 'ghost'), textContent: label, onclick: async () => {
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
        el('button', { type: 'button', className: 'ghost small', textContent: 'Feloldás', onclick: async () => {
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

  // ---- Belépés, kilépés, a többi űrlap ----
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
  $('#adminLogout').addEventListener('click', () => {
    token = ''; try { sessionStorage.removeItem('kb_admin'); } catch (_) { /* nem kritikus */ }
    const r = $('#acctResult'); r.replaceChildren(); r.classList.add('hidden'); picked.clear();
    show(false);
  });
  $('#reload').addEventListener('click', () => load().catch((e) => msg('#acctMsg', e.message, 'bad')));
  $('#clearReports').addEventListener('click', async () => {
    if (await askConfirm({ title: 'Jelentések törlése', lines: ['Biztosan törlöd az összes jelentést? (A némítások megmaradnak.)'], okLabel: 'Törlés', danger: true })) { await api('POST', '/reports/clear'); load(); }
  });
  $('#clearErrors').addEventListener('click', async () => {
    if (await askConfirm({ title: 'Hibanapló törlése', lines: ['Biztosan törlöd a hibanaplót?'], okLabel: 'Törlés', danger: true })) { await api('POST', '/errors/clear'); load(); }
  });
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
