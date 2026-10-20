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
  const TABS = { overview: '#tab-overview', live: '#tab-live', accounts: '#accounts', reports: '#tab-reports', bugs: '#tab-bugs', packs: '#tab-packs', cards: '#tab-cards', errors: '#tab-errors', system: '#tab-system' };
  const TITLES = {
    overview: ['Áttekintés', 'A játék állapota egy pillantással'], live: ['Élő szobák', 'Most futó szobák és játékosok – 15 másodpercenként frissül'],
    accounts: ['Fiókok', 'Regisztrált fiókok, ideiglenes jelszavak, törlés'], reports: ['Jelentések', 'Játékosok jelentései és a némítások'],
    bugs: ['Hibajelentések', 'Amit a játékosok a játékból küldtek be'], packs: ['Közösségi csomagok', 'Kártyaműhely: közzététel, jelentések, elrejtés'],
    cards: ['Kártyák', 'Vádak értékelése (😂 / 👎)'], errors: ['Hibák', 'A szerver és a böngészők hibanaplója'], system: ['Rendszer', 'Adatbázis, mentések, levélküldés, jelszó-visszaállítás']
  };
  function selectTab(name, focus) {
    if (!TABS[name]) name = 'overview';
    $('#pageTitle').textContent = TITLES[name][0]; $('#pageSub').textContent = TITLES[name][1];
    $('#stats').classList.toggle('hidden', ['overview', 'live', 'bugs'].includes(name)); // ott a saját élő számaik látszanak
    for (const [key, sel] of Object.entries(TABS)) {
      $(sel).classList.toggle('hidden', key !== name);
      const b = $('#tabbtn-' + key); b.setAttribute('aria-selected', String(key === name)); b.tabIndex = key === name ? 0 : -1;
      if (key === name && focus) b.focus();
    }
    try { sessionStorage.setItem('kb_admin_tab', name); } catch (_) { /* nem kritikus */ }
  }
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => selectTab(b.dataset.tab));
  $('.tabs').addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    const names = Object.keys(TABS), now = names.findIndex((n) => $('#tabbtn-' + n).getAttribute('aria-selected') === 'true');
    selectTab(names[(now + (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : names.length - 1)) % names.length], true);
    ev.preventDefault();
  });
  let startTab = 'overview';
  try { startTab = sessionStorage.getItem('kb_admin_tab') || 'overview'; } catch (_) { /* nem kritikus */ }
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
    const cardsQuery = '/cardfeedback?sort=' + encodeURIComponent($('#cardsSort').value) + '&min=' + encodeURIComponent($('#cardsMin').value || '3');
    const [errs, backs, accts, reps, packs, cards, ov] = await Promise.all([api('GET', '/errors'), api('GET', '/backups'), api('GET', '/accounts'), api('GET', '/reports'), api('GET', '/packs'), api('GET', cardsQuery), api('GET', '/overview')]);
    lastStatus = s;
    renderSystem(s); renderErrors(errs); renderBackups(backs); renderReports(reps); renderAccounts(accts); renderPacks(packs); renderCards(cards); renderOverview(ov);
    $('#cntAccounts').textContent = accts.accounts ? String(accts.accounts.length) : '';
    const reportedPacks = s.packs ? s.packs.reported : 0; $('#cntPacks').textContent = reportedPacks ? String(reportedPacks) : ''; $('#cntPacks').className = 'count' + (reportedPacks ? ' bad' : '');
    $('#cntErrors').textContent = s.errors.total ? String(s.errors.total) : ''; $('#cntErrors').className = 'count' + (s.errors.total ? ' bad' : '');
    $('#cntReports').textContent = s.reports.open ? String(s.reports.open) : ''; $('#cntReports').className = 'count' + (s.reports.open ? ' bad' : '');
  }

  function renderSystem(s) {
    const dl = $('#status'); dl.replaceChildren();
    row(dl, 'Futásidő', Math.floor(s.uptimeSeconds / 60) + ' perc');
    row(dl, 'Adatbázis (Neon)', s.database ? 'be van kötve' : 'NINCS (csak helyi fájlok)', s.database ? 'ok' : 'bad');
    row(dl, 'Mentések', s.backups.error ? 'hiba: ' + s.backups.error : s.backups.count + ' db, legutóbbi: ' + (s.backups.latest ? when(s.backups.latest.takenAt) : 'még nincs'), s.backups.error ? 'bad' : (s.backups.count ? 'ok' : 'dim'));
    row(dl, 'Levélküldés', s.mail.configured ? 'be van állítva' : 'nincs beállítva (kulcs: ' + (s.mail.key ? 'van' : 'nincs') + ', feladó: ' + (s.mail.sender ? 'van' : 'nincs') + ', AUTH_BASE_URL: ' + (s.mail.baseUrl ? 'van' : 'nincs') + ')', s.mail.configured ? 'ok' : 'bad');
    if (s.legal) row(dl, 'Jogi oldalak', s.legal.missing.length ? 'HIÁNYZIK az üzemeltetői adat: ' + s.legal.missing.join(', ') + ' (Render → Environment)' : 'kitöltve (verzió: ' + s.legal.version + ', korhatár: ' + s.legal.minAge + ')', s.legal.missing.length ? 'bad' : 'ok');
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

  // ============================================================
  // MŰSZERFAL (Áttekintés), ÉLŐ SZOBÁK, HIBAJELENTÉSEK – GET /api/admin/overview, 15 másodpercenként frissül (élő frissítés)
  // ============================================================
  const PHASE_HU = { lobby: 'Gyülekező', accusation: 'Vádemelés', prep: 'Felkészülés', prosecution: 'Vádbeszéd', defense: 'Védekezés', defender: 'Védőbeszéd',
    witness: 'Tanúvallomás', final_prosecution: 'Zárszó (vád)', final_defense: 'Zárszó (védelem)', objection: 'Tiltakozás', jury_question: 'Keresztkérdés',
    verdict_vote: 'Szavazás', verdict: 'Ítélet', challenge_review: 'Kihívások', challenge_vote: 'Kihívás-szavazás', round_results: 'Kör vége', game_over: 'Játék vége' };
  const BUG_ST = { new: 'Új', progress: 'Folyamatban', ice: 'Jegelve', done: 'Kész', wontfix: 'Nem javítjuk', cantrepro: 'Nem reprodukálható' };
  const BUG_KIND = { bug: 'Hiba', sound: 'Hang', ui: 'Kinézet', room: 'Szoba', other: 'Egyéb' };
  const fmtN = (n) => (Number(n) || 0).toLocaleString('hu-HU');
  const ago = (t) => { if (!t) return '–'; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); if (s < 60) return s + ' mp'; const m = Math.round(s / 60); if (m < 60) return m + ' perc'; const h = Math.floor(m / 60); if (h < 48) return h + ' óra ' + (m % 60) + ' perc'; return Math.round(h / 24) + ' nap'; };
  const hourLabel = (t) => new Date(t).toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' });
  const dayLabel = (key) => key.slice(5).replace('-', '.') + '.';
  let lastOverview = null, topMode = 'week', bugFilter = 'all';

  // tooltip (egy közös, a kurzor mellett)
  const tip = el('div', { className: 'tip hidden', role: 'status' }); document.body.append(tip);
  function showTip(target, title, rows) {
    tip.replaceChildren(el('b', { textContent: title }), ...rows.map((r) => el('div', { className: 't-row' }, el('i', { className: 't-key', style: 'background:' + (r.color || 'var(--muted)') }), el('strong', { textContent: fmtN(r.value) }), el('span', { textContent: r.label }))));
    tip.classList.remove('hidden');
    const b = target.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let x = b.left + b.width / 2 - w / 2; x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    let y = b.top - h - 8; if (y < 8) y = b.bottom + 8;
    tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
  }
  const hideTip = () => tip.classList.add('hidden');

  // tiszta tengely-léptékek (0, 1, 2, 5, 10, 20, 50 … szorzók), egész számokra
  function ticksFor(max) {
    const raw = Math.max(1, max) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag);
    const top = Math.max(step, Math.ceil(Math.max(1, max) / step) * step), out = [];
    for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v));
    return out;
  }
  // oszlopdiagram: rows = [{ x, label, values: [...] }], series = [{ name, cls, color }]; egér / billentyű (← →) alatt értékcímke; táblázat-nézet
  function barChart(box, rows, series, emptyText) {
    box.replaceChildren();
    const total = (r) => r.values.reduce((s, v) => s + v, 0);
    const max = Math.max(0, ...rows.map(total));
    if (!max) { box.append(el('div', { className: 'ch-empty', textContent: emptyText })); return; }
    const ticks = ticksFor(max), top = ticks[ticks.length - 1];
    const y = el('div', { className: 'ch-y' }), area = el('div', { className: 'ch-area' }), cols = el('div', { className: 'ch-cols' });
    for (const t of ticks) {
      const pct = (t / top) * 100;
      y.append(el('span', { textContent: t >= 1000 ? (t / 1000) + 'K' : String(t), style: 'bottom:' + pct + '%' }));
      if (t) area.append(el('div', { className: 'ch-grid', style: 'bottom:' + pct + '%' }));
    }
    const colEls = rows.map((r) => {
      const c = el('div', { className: 'ch-col' });
      r.values.forEach((v, i) => { if (v > 0) c.append(el('div', { className: 'seg-bar ' + series[i].cls, style: 'height:calc(' + ((v / top) * 100) + '% - ' + (i ? 2 : 0) + 'px)' })); });
      const rowsFor = () => series.map((s, i) => ({ label: s.name, value: r.values[i], color: s.color }));
      c.addEventListener('pointerenter', () => showTip(c, r.label, rowsFor()));
      c.addEventListener('pointerleave', hideTip);
      c._tip = () => showTip(c, r.label, rowsFor());
      cols.append(c); return c;
    });
    area.append(cols);
    const plot = el('div', { className: 'ch-plot', tabIndex: 0, role: 'img', ariaLabel: series.map((s) => s.name).join(' / ') + ': legfeljebb ' + max + ' (a ← → nyíllal végiglépkedhető)' }, y, area);
    let cur = rows.length - 1;
    plot.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault(); cur = Math.max(0, Math.min(rows.length - 1, cur + (ev.key === 'ArrowRight' ? 1 : -1)));
      colEls.forEach((c, i) => c.classList.toggle('focus', i === cur)); colEls[cur]._tip();
    });
    plot.addEventListener('focus', () => { colEls[cur].classList.add('focus'); colEls[cur]._tip(); });
    plot.addEventListener('blur', () => { colEls.forEach((c) => c.classList.remove('focus')); hideTip(); });
    const xl = el('div', { className: 'ch-x-labels' });
    const every = Math.max(1, Math.ceil(rows.length / 7));
    rows.forEach((r, i) => { if (i % every === 0 || i === rows.length - 1) xl.append(el('span', { textContent: r.short, style: 'left:' + (((i + 0.5) / rows.length) * 100) + '%' })); });
    const table = el('details', { className: 'ch-table' }, el('summary', { textContent: 'Adatok táblázatban' }));
    const tb = el('table'); tb.append(el('tr', {}, el('th', { textContent: '' }), ...series.map((s) => el('th', { textContent: s.name }))));
    for (const r of rows.slice().reverse()) tb.append(el('tr', {}, el('td', { textContent: r.label }), ...r.values.map((v) => el('td', { textContent: fmtN(v) }))));
    table.append(tb);
    box.append(plot, el('div', { className: 'ch-x' }, el('span'), xl), table);
  }

  function kpi(label, value, sub, cls, subCls) {
    return el('div', { className: 'kpi' + (cls ? ' ' + cls : '') }, el('span', { className: 'k-label', textContent: label }), el('span', { className: 'k-value', textContent: value }), sub ? el('span', { className: 'k-sub' + (subCls ? ' ' + subCls : ''), textContent: sub }) : '');
  }
  function roomCard(r) {
    const people = r.players.filter((p) => p.on && !p.bot).length, isGame = r.phase !== 'lobby';
    const meta = [isGame && r.rounds ? r.round + '. kör / ' + r.rounds : '', r.createdAt ? 'él ' + ago(r.createdAt) + ' óta' : '', r.watchers ? '📺 ' + r.watchers + ' néző' : '', r.voice ? '🎙️ hang be' : ''].filter(Boolean).join(' · ');
    return el('div', { className: 'room' },
      el('div', { className: 'room-head' }, el('span', { className: 'room-code', textContent: r.code }), el('span', { className: 'phase ' + (isGame ? 'game' : 'lobby'), textContent: (isGame ? '● ' : '◌ ') + (PHASE_HU[r.phase] || r.phase) })),
      el('div', { className: 'room-meta', textContent: people + ' játékos' + (meta ? ' · ' + meta : '') }),
      el('div', { className: 'people' }, ...r.players.map((p) => el('span', { className: 'person' + (p.on ? '' : ' off') + (p.bot ? ' bot' : ''), title: (p.host ? 'házigazda · ' : '') + (p.bot ? 'bot · ' : '') + (p.on ? 'kapcsolódva' : 'nincs kapcsolat') + ' · ' + p.score + ' pont', textContent: (p.host ? '👑 ' : p.bot ? '🤖 ' : '') + p.name }))));
  }
  function bugRow(b) {
    return el('div', { className: 'bug' },
      el('div', { className: 'bug-head' }, el('b', { textContent: b.id }), el('span', { className: 'st ' + b.status, textContent: BUG_ST[b.status] || b.status }), el('span', { className: 'tag', textContent: BUG_KIND[b.kind] || b.kind }),
        el('span', { textContent: (b.name || 'vendég') + (b.account ? ' (fiók)' : '') + ' · ' + when(b.ts) + (b.where ? ' · ' + b.where : '') + (b.room ? ' · szoba ' + b.room : '') })),
      el('div', { className: 'bug-text', textContent: b.text }));
  }

  function renderOverview(o) {
    lastOverview = o;
    const tot = o.live.totals, days = o.activity.days, today = days[days.length - 1] || {};
    // élő jelző + hős-szám
    const pill = $('#livePill'); pill.classList.remove('stale'); $('#liveTxt').textContent = 'élő · frissítve ' + new Date(o.time).toLocaleTimeString('hu-HU');
    $('#ovOnline').textContent = fmtN(tot.humans);
    $('#ovOnlineSub').textContent = tot.rooms + ' szoba · ' + tot.playing + ' folyó tárgyalás · ' + tot.lobbies + ' gyülekező' + (tot.bots ? ' · ' + tot.bots + ' bot' : '');
    const s = lastStatus || { reports: { open: 0 }, errors: { total: 0 } };
    const newBugs = (o.bugs.byStatus && o.bugs.byStatus.new) || 0;
    $('#ovKpis').replaceChildren(
      kpi('Folyó tárgyalások', fmtN(tot.playing), tot.lobbies + ' szoba gyülekezik'),
      kpi('Kapcsolatok', fmtN(tot.sockets), tot.watching ? tot.watching + ' néző' : 'böngésző / telefon'),
      kpi('Ma játszott', fmtN(today.players || 0), (today.started || 0) + ' játék indult ma'),
      kpi('Mai csúcs', fmtN(today.peakPlayers || 0), 'egyszerre online · ' + (today.peakRooms || 0) + ' szoba'),
      kpi('Fiókok', fmtN(o.accounts.total), '+' + o.accounts.new7d + ' az elmúlt 7 napban', '', o.accounts.new7d ? 'up' : ''),
      kpi('Aktív fiókok (7 nap)', fmtN(o.accounts.active7d), 'ma: ' + o.accounts.active24h),
      kpi('Ismert játékosnév', fmtN(o.players.known), 'heti aktív: ' + o.players.weeklyActive),
      kpi('Új hibajelentés', fmtN(newBugs), o.bugs.total + ' összesen', newBugs ? 'alert' : ''),
      kpi('Nyitott jelentés', fmtN(s.reports.open), 'moderáció', s.reports.open ? 'alert' : ''),
      kpi('Rögzített hiba', fmtN(s.errors.total), (s.errors.distinct || 0) + ' féle', s.errors.total ? 'alert' : ''));
    // grafikonok
    barChart($('#chOnline'), o.activity.hours.map((h) => ({ label: new Date(h.t).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), short: hourLabel(h.t), values: [h.players] })),
      [{ name: 'online játékos', cls: 's1', color: 'var(--series-1)' }], 'Még nincs mérés – a szerver percenként jegyzi fel, hányan vannak online.');
    barChart($('#chGames'), days.map((d) => ({ label: d.day, short: dayLabel(d.day), values: [d.finished, d.aborted] })),
      [{ name: 'befejezett', cls: 's1', color: 'var(--series-1)' }, { name: 'megszakadt', cls: 's2', color: 'var(--series-2)' }], 'Még nincs befejezett vagy megszakadt játék a naplóban.');
    barChart($('#chPlayers'), days.map((d) => ({ label: d.day, short: dayLabel(d.day), values: [d.players] })),
      [{ name: 'egyedi játékos', cls: 's1', color: 'var(--series-1)' }], 'Még nincs játék a naplóban.');
    barChart($('#chSignups'), days.map((d) => ({ label: d.day, short: dayLabel(d.day), values: [d.signups || 0] })),
      [{ name: 'új fiók', cls: 's1', color: 'var(--series-1)' }], 'Az elmúlt 30 napban nem volt regisztráció.');
    // élő szobák
    const live = o.live.rooms;
    $('#ovRoomsSub').textContent = live.length ? live.length + ' szoba él' : 'most nincs élő szoba';
    const mini = el('div', { className: 'mini-rooms' }, ...live.slice(0, 3).map(roomCard));
    $('#ovRooms').replaceChildren(live.length ? mini : el('div', { className: 'empty', textContent: 'Most senki nem játszik. 🌙' }));
    $('#liveSummary').textContent = '– ' + live.length + ' szoba, ' + tot.humans + ' játékos online';
    $('#liveRooms').replaceChildren(...(live.length ? live.map(roomCard) : [el('div', { className: 'empty', textContent: 'Most nincs élő szoba.' })]));
    const cl = $('#cntLive'); cl.textContent = tot.humans ? String(tot.humans) : '';
    renderTop();
    // hibajelentések
    $('#ovBugsSub').textContent = o.bugs.total ? o.bugs.total + ' jelentés · ' + newBugs + ' új' : 'még nincs jelentés';
    $('#ovBugs').replaceChildren(...(o.bugs.latest.length ? o.bugs.latest.slice(0, 3).map(bugRow) : [el('div', { className: 'empty', textContent: 'Nincs hibajelentés. 🎉' })]));
    const cb = $('#cntBugs'); cb.textContent = newBugs ? String(newBugs) : ''; cb.className = 'count' + (newBugs ? ' bad' : '');
    renderBugs();
    // szerver
    const sv = o.server, mb = (b) => Math.round(b / 1048576), LIMIT = 512, used = mb(sv.memory.rss), pct = Math.min(100, Math.round((used / LIMIT) * 100));
    $('#ovServerSub').textContent = 'fut ' + ago(sv.startedAt) + ' óta';
    $('#ovServer').replaceChildren(
      el('div', { className: 'meter' + (pct >= 85 ? ' crit' : pct >= 70 ? ' warn' : '') }, el('div', { className: 'm-top' }, el('span', { textContent: 'Memória (a Render ingyenes csomag: ' + LIMIT + ' MB)' }), el('b', { textContent: used + ' MB · ' + pct + '%' })),
        el('div', { className: 'm-track' }, el('div', { className: 'm-fill', style: 'width:' + pct + '%' }))),
      el('dl', { className: 'kv' }, el('dt', { textContent: 'Node' }), el('dd', { textContent: sv.node }), el('dt', { textContent: 'Verzió' }), el('dd', { textContent: sv.commit || 'helyi' }),
        el('dt', { textContent: 'Szobák' }), el('dd', { textContent: tot.rooms + ' / ' + sv.maxRooms + ' (szobánként legfeljebb ' + sv.maxPlayers + ' fő)' })),
      el('div', { className: 'flags' }, el('span', { className: 'tag' + (sv.render ? ' good' : ''), textContent: sv.render ? 'Render' : 'helyi szerver' }), el('span', { className: 'tag' + (sv.voice ? ' good' : ''), textContent: 'hang (béta): ' + (sv.voice ? 'BE' : 'ki') }),
        el('span', { className: 'tag', textContent: 'lobbi-botok: ' + (sv.lobbyBots ? 'be' : 'ki') })));
  }
  function renderTop() {
    const o = lastOverview; if (!o) return;
    const rows = topMode === 'week' ? o.players.topWeek : o.players.top, max = Math.max(1, ...rows.map((r) => r.value));
    $('#topWeekBtn').setAttribute('aria-pressed', String(topMode === 'week')); $('#topAllBtn').setAttribute('aria-pressed', String(topMode !== 'week'));
    $('#ovTop').replaceChildren(rows.length ? el('ol', { className: 'toplist' }, ...rows.map((r) => el('li', {}, el('span', { className: 'rk', textContent: r.rank + '.' }),
      el('span', { className: 'nm' }, el('span', { textContent: r.name }), el('div', { className: 'bar-mini', style: 'width:' + Math.max(4, (r.value / max) * 100) + '%' })), el('span', { className: 'vl', textContent: fmtN(r.value) }))))
      : el('div', { className: 'empty', textContent: topMode === 'week' ? 'Ezen a héten még nincs pont.' : 'Még nincs pont a nyilvántartásban.' }));
  }
  function renderBugs() {
    const o = lastOverview; if (!o) return;
    const all = o.bugs.latest, statuses = ['all', ...Object.keys(BUG_ST).filter((k) => all.some((b) => b.status === k))];
    if (!statuses.includes(bugFilter)) bugFilter = 'all';
    $('#bugsSummary').textContent = '– ' + o.bugs.total + ' összesen';
    $('#bugChips').replaceChildren(...statuses.map((k) => el('button', { type: 'button', className: 'chip', textContent: k === 'all' ? 'Mind (' + all.length + ')' : BUG_ST[k] + ' (' + all.filter((b) => b.status === k).length + ')', onclick: () => { bugFilter = k; renderBugs(); } })));
    for (const b of $('#bugChips').children) b.setAttribute('aria-pressed', String(b.textContent.startsWith(bugFilter === 'all' ? 'Mind' : BUG_ST[bugFilter])));
    const list = all.filter((b) => bugFilter === 'all' || b.status === bugFilter);
    $('#bugList').replaceChildren(...(list.length ? list.map(bugRow) : [el('div', { className: 'empty', textContent: 'Nincs ilyen hibajelentés.' })]));
  }
  $('#topWeekBtn').addEventListener('click', () => { topMode = 'week'; renderTop(); });
  $('#topAllBtn').addEventListener('click', () => { topMode = 'all'; renderTop(); });
  // élő frissítés: 15 mp-enként az áttekintő (a többi szakasz kézi Frissítéssel – ne bántsa a félig kitöltött űrlapokat)
  let refreshTimer = 0;
  async function refreshOverview() {
    if (!token || $('#panel').classList.contains('hidden')) return;
    try { renderOverview(await api('GET', '/overview')); }
    catch (_) { $('#livePill').classList.add('stale'); $('#liveTxt').textContent = 'nincs friss adat'; }
  }
  function scheduleRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { if ($('#autoRefresh').checked && document.visibilityState === 'visible') refreshOverview(); }, 15000);
  }
  $('#autoRefresh').addEventListener('change', () => { if ($('#autoRefresh').checked) refreshOverview(); });
  scheduleRefresh();

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
  // Közösségi kártyacsomagok: a jelentettek elöl; elrejtés / visszaállítás / törlés
  function renderPacks(data) {
    const box = $('#packsAdmin'); box.replaceChildren();
    $('#packsSummary').textContent = data.packs.length + ' csomag';
    if (!data.packs.length) box.append(el('p', { className: 'dim', textContent: 'Még nincs csomag.' }));
    const act = (label, path, body, cls, confirm) => el('button', { type: 'button', className: 'small ' + (cls || 'ghost'), textContent: label, onclick: async () => {
      if (confirm && !(await askConfirm(confirm))) return;
      try { await api('POST', path, body); await load(); msg('#packsMsg', 'Kész.', 'ok'); } catch (e) { msg('#packsMsg', e.message, 'bad'); }
    } });
    for (const p of data.packs) {
      const state = p.hidden ? (p.hiddenBy === 'admin' ? '🙈 elrejtve (üzemeltető)' : '🙈 elrejtve (jelentések)') : (p.visibility === 'public' ? 'nyilvános' : 'privát');
      const buttons = [p.hidden ? act('Visszaállítás', '/packs/unhide', { code: p.code }, '') : act('Elrejtés', '/packs/hide', { code: p.code }, 'ghost'),
        act('Törlés', '/packs/delete', { code: p.code }, 'danger', { title: 'Csomag törlése', lines: ['Biztosan törlöd a(z) „' + p.name + '” csomagot (' + p.owner + ')? A gyűjteményekből is eltűnik, nem vonható vissza.'], okLabel: 'Törlés', danger: true })];
      box.append(el('div', { className: 'err' }, ...[
        el('div', {}, el('span', { className: 'tag', textContent: p.code }), el('b', { textContent: p.name }), el('span', { className: 'dim', textContent: '  ' + p.owner + ' • ' + state + (p.reports ? ' • ' + p.reports + ' jelentés' : '') })),
        p.desc ? el('div', { textContent: p.desc }) : null,
        el('div', { className: 'dim', textContent: p.total + ' kártya • ' + p.saves + ' mentés • ' + p.uses + ' játék • létrehozva: ' + when(p.createdAt) }),
        p.sample && p.sample.length ? el('div', { className: 'dim', textContent: 'Ízelítő: ' + p.sample.map((t) => '„' + t + '”').join(' ') }) : null,
        el('div', { className: 'row', style: 'margin-top:6px' }, ...buttons)].filter(Boolean))); // az el() a null-t "null" szövegként fűzné be
    }
  }

  // Vádak értékelése (kártya-visszajelzés): a leggyengébbek elöl; egy kártya szavazatainak törlése
  function renderCards(data) {
    const box = $('#cardsAdmin'); box.replaceChildren();
    $('#cardsSummary').textContent = data.summary.cards + ' értékelt vád • ' + data.summary.votes + ' szavazat';
    if (!data.cards.length) box.append(el('p', { className: 'dim', textContent: data.summary.votes ? 'Ezzel a szűrővel nincs kártya (csökkentsd a szavazatok minimumát).' : 'Még nincs szavazat. Az ítélet után a játékosok a vád alatti 😂 / 👎 gombbal értékelhetnek.' }));
    for (const c of data.cards) {
      const pct = Math.round(c.noShare * 100);
      box.append(el('div', { className: 'err' }, ...[
        el('div', {}, el('span', { className: 'tag', textContent: c.modeName }), el('b', { textContent: '😂 ' + c.yes + ' · 👎 ' + c.no }), el('span', { className: 'dim', textContent: '  ' + c.total + ' szavazat • ' + pct + '% 👎' + (c.updatedAt ? ' • utolsó: ' + when(c.updatedAt) : '') })),
        el('div', { textContent: c.text }),
        el('div', { className: 'row', style: 'margin-top:6px' }, el('button', { type: 'button', className: 'small ghost', textContent: 'Szavazatok törlése', onclick: async () => {
          if (!(await askConfirm({ title: 'Szavazatok törlése', lines: ['Biztosan törlöd ennek a vádnak a szavazatait? (Pl. lecserélés után az újragyűjtéshez.)'], okLabel: 'Törlés', danger: true }))) return;
          try { await api('POST', '/cardfeedback/clear', { key: c.key }); await load(); msg('#cardsMsg', 'Kész.', 'ok'); } catch (e) { msg('#cardsMsg', e.message, 'bad'); }
        } }))].filter(Boolean)));
    }
  }
  $('#cardsSort').addEventListener('change', () => { load().catch((e) => msg('#cardsMsg', e.message, 'bad')); });
  $('#cardsMin').addEventListener('change', () => { load().catch((e) => msg('#cardsMsg', e.message, 'bad')); });

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
    try { await api('POST', '/mail-test', { to: $('#mailTo').value, template: $('#mailTpl').value }); msg('#mailMsg', 'Elküldve – nézd meg a postaládát (a spamet is).', 'ok'); }
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
