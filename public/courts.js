'use strict';
// ============================================================
// KAMU BÍRÓSÁG – Discord-tárgyalás (kliens)
// A tárgyalás állapotát a szerver tárolja (/api/court-sessions); a Discord bot és ez az oldal ugyanazt látja.
// Élő frissítés: `court_update` socket-esemény (a szoba és a jelentkezők fiók-szobája kapja). Itt semmi nem
// "igazság": minden gomb a szerverhez fordul, a jogosultságot a szerver ellenőrzi.
// ============================================================
(() => {
  const STATUS_LABEL = { WAITING: 'JELENTKEZÉS', LOCKED: 'LEZÁRVA', DRAWING: 'SORSOLÁS…', READY: 'SZEREPEK KIOSZTVA', IN_PROGRESS: 'FOLYAMATBAN', FINISHED: 'BEFEJEZVE', CANCELLED: 'LEMONDVA' };
  const ROLE_ORDER = ['judge', 'prosecutor', 'defender', 'defendant', 'witness', 'juror'];
  const ROLE_ICON = { judge: '👨‍⚖️', prosecutor: '🔴', defender: '🔵', defendant: '🧑', witness: '🗣️', juror: '👥' };
  const ROLE_LABEL = { judge: 'Bíró', prosecutor: 'Ügyész', defender: 'Védőügyvéd', defendant: 'Vádlott', witness: 'Tanú', juror: 'Esküdtek' };

  const $c = (sel) => document.querySelector(sel);
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  let link = null;        // { linked, discordUsername, uid, botOnline } | null (vendég)
  let session = null;     // a szoba tárgyalása
  let mySessions = [];    // a saját élő tárgyalásaim (újrakötéshez)
  let code = null;        // az a szobakód, amelyre a session érvényes
  let busy = false;
  let note = '';
  let linkCode = null;    // { code, expiresAt }
  let linkTimer = null;
  // A Discord-panel linkje: /?court=KAMU-1003 – megnyitása jelentkezés + belépés a tárgyalás szobájába
  let pendingCourt = new URLSearchParams(location.search).get('court');
  if (pendingCourt) { try { history.replaceState(null, '', location.pathname); } catch (_) { /* */ } }
  const entered = new Set(); // már megkísérelt automatikus belépések (tárgyalás:szoba)
  const toast = (t) => { if (typeof showToast === 'function') showToast(t); };

  async function api(method, route, body) {
    let response;
    try {
      response = await fetch('/api' + route, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000)
      });
    } catch (_) { throw new Error('Nem érhető el a szerver.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const e = new Error(data.error || 'Nem sikerült.'); e.status = response.status; throw e; }
    return data;
  }
  const rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

  const myUid = () => (link && link.uid) || null;
  const inRoomLobby = () => typeof MY !== 'undefined' && MY.code && typeof S !== 'undefined' && S && S.phase === 'lobby';

  // ---------------- betöltés ----------------
  // Belépés a tárgyalás szobájába: a szerver szükség esetén létrehozza a szobát, és jelentkezésként is számít.
  async function enter(id, auto) {
    try {
      const r = await api('POST', '/court-sessions/' + encodeURIComponent(id) + '/enter', {});
      session = r.session;
      const ok = typeof window.kbJoinFriendRoom === 'function' ? window.kbJoinFriendRoom(r.roomCode) : false;
      if (ok && auto) toast('⚖️ A Discordon jelentkeztél, belépsz a tárgyalás szobájába…');
    } catch (e) { if (!auto) toast(e.message); }
  }
  async function loadLink() {
    try { link = await api('GET', '/discord/link'); } catch (e) { link = null; }
    renderLinkBoxes();
    if (pendingCourt) {
      const id = pendingCourt;
      if (link) { pendingCourt = null; enter(id, false); }
      else if (!loadLink.warned) { loadLink.warned = true; toast('A tárgyaláshoz jelentkezz be a fiókodddal, utána automatikusan belépsz.'); }
    }
  }
  async function loadSession() {
    if (!(typeof MY !== 'undefined' && MY.code) || !link) { session = null; code = null; mySessions = []; renderPanel(); return; }
    try {
      const r = await api('GET', '/court-sessions/by-room/' + encodeURIComponent(MY.code));
      session = r.session || null; code = MY.code;
      mySessions = session ? [] : (await api('GET', '/court-sessions/mine')).sessions.filter((s) => s.hostUserId === myUid());
    } catch (e) { session = null; }
    renderPanel();
  }

  // ---------------- lobbi-panel ----------------
  function roleCards(s) {
    const byRole = {};
    for (const p of s.participants) (byRole[p.role || '-'] = byRole[p.role || '-'] || []).push(p);
    if (!byRole['-'] || Object.keys(byRole).length > 1) {
      return ROLE_ORDER.filter((r) => byRole[r]).map((r) =>
        '<div class="court-role"><span class="court-role-ico">' + ROLE_ICON[r] + '</span><b>' + ROLE_LABEL[r] + '</b><span>' +
        byRole[r].map((p) => esc(p.name)).join(', ') + '</span></div>').join('');
    }
    return '';
  }
  function renderPanel() {
    const el = $c('#courtPanel');
    if (!el) return;
    const show = inRoomLobby() && !!link;
    if (!show) { el.classList.add('hidden'); return; }
    const isHost = typeof S !== 'undefined' && S && S.hostId === MY.playerId;
    if (!session) {
      el.classList.toggle('hidden', !isHost);
      if (!isHost) return;
      const orphans = mySessions.filter((s) => s.roomCode !== MY.code);
      el.innerHTML = '<h3>⚖️ DISCORD-TÁRGYALÁS</h3>' +
        '<p class="hint">Nyiss egy tárgyalást ehhez a szobához: a Discord szerveren jelentkezési panel jelenik meg, a jelentkezők és a szerepek itt is látszanak.</p>' +
        '<button id="courtCreate" class="btn small"' + (busy ? ' disabled' : '') + '>🔗 Discord-tárgyalás nyitása</button>' +
        orphans.map((o) => '<p class="hint">Élő tárgyalásod: <b>' + esc(o.id) + '</b> (' + esc(STATUS_LABEL[o.status] || o.status) + ', ' + o.participants.length + ' jelentkező) <button class="btn small ghost" data-rebind="' + esc(o.id) + '">Ehhez a szobához kötöm</button></p>').join('') +
        (note ? '<p class="court-note">' + esc(note) + '</p>' : '');
      return;
    }
    el.classList.remove('hidden');
    const s = session, uid = myUid();
    const joined = s.participants.some((p) => p.uid === uid);
    const manage = s.hostUserId === uid;
    const live = !['FINISHED', 'CANCELLED'].includes(s.status);
    const btn = (id, label, extra) => '<button class="btn small ' + (extra || '') + '" data-court="' + id + '"' + (busy ? ' disabled' : '') + '>' + label + '</button>';
    const actions = [];
    if (live && s.status === 'WAITING' && !joined) actions.push(btn('join', '⚖️ Jelentkezem'));
    if (live && joined && s.status !== 'IN_PROGRESS' && !manage) actions.push(btn('leave', '❌ Visszalépek', 'ghost'));
    if (manage && live) {
      if (s.status === 'WAITING') actions.push(btn('lock', '🔒 Jelentkezés lezárása', 'ghost'));
      if (s.status === 'LOCKED') actions.push(btn('unlock', '🔓 Jelentkezés megnyitása', 'ghost'));
      if (['WAITING', 'LOCKED'].includes(s.status)) actions.push(btn('draw', '🎲 Szerepsorsolás', s.participants.length < s.minPlayers ? 'ghost' : ''));
      if (s.status === 'READY') { actions.push(btn('start', '▶️ Tárgyalás indítása')); actions.push(btn('draw-force', '🎲 Újrasorsolás', 'ghost')); }
      if (s.status === 'IN_PROGRESS') actions.push(btn('finish', '🏁 Befejezés', 'ghost'));
      actions.push(btn('cancel', '✖️ Lemondás', 'ghost danger'));
    }
    const bot = s.discordBot || {};
    const grid = roleCards(s);
    el.innerHTML =
      '<div class="court-head"><h3>⚖️ DISCORD-TÁRGYALÁS</h3><span class="court-case">' + esc(s.caseNo) + '</span><span class="court-status st-' + esc(s.status) + '">' + esc(STATUS_LABEL[s.status] || s.status) + '</span></div>' +
      '<p class="court-meta">Jelentkezők: <b>' + s.participants.length + '/' + s.maxPlayers + '</b> (legalább ' + s.minPlayers + ' kell) · Discord: <b>' + (bot.online ? '🟢 bot online' : '⚪ bot offline') + '</b>' + (bot.panel ? ' · panel kint' : ' · panel még nincs') + '</p>' +
      (grid ? '<div class="court-roles">' + grid + '</div>' : '') +
      '<ul class="court-list">' + s.participants.map((p) => '<li>' + esc(p.name) + (p.uid === s.hostUserId ? ' <small>(vezető)</small>' : '') +
        ' <small class="' + (p.discordLinked ? 'ok' : 'warn') + '">' + (p.discordLinked ? '✔ Discord' : '• nincs Discord-kapcsolat') + '</small>' + (p.roleLabel ? ' <i>' + esc(p.roleLabel) + '</i>' : '') + '</li>').join('') + '</ul>' +
      (!link.linked ? '<p class="hint">Te még nem kötötted össze a Discordot – a menüben (Discord összekötés) pótolhatod.</p>' : '') +
      '<div class="court-actions">' + actions.join('') + '</div>' +
      (note ? '<p class="court-note">' + esc(note) + '</p>' : '');
  }

  async function act(action, extra) {
    if (busy || !session) return;
    busy = true; note = ''; renderPanel();
    try {
      const real = action === 'draw-force' ? 'draw' : action;
      const r = await api('POST', '/court-sessions/' + encodeURIComponent(session.id) + '/' + real, { requestId: rid(), ...(action === 'draw-force' ? { force: true } : {}), ...(extra || {}) });
      session = r.session;
    } catch (e) { note = e.message; }
    busy = false; renderPanel();
  }

  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest && ev.target.closest('[data-court],#courtCreate,[data-rebind],#dlStart,#dlRemove,#dlDone');
    if (!t) return;
    if (t.dataset.court) return act(t.dataset.court);
    if (t.id === 'courtCreate') {
      busy = true; note = ''; renderPanel();
      try { session = (await api('POST', '/court-sessions', { roomCode: MY.code })).session; } catch (e) { note = e.message; }
      busy = false; return loadSession();
    }
    if (t.dataset.rebind) {
      try { session = (await api('POST', '/court-sessions/' + encodeURIComponent(t.dataset.rebind) + '/rebind', { roomCode: MY.code })).session; } catch (e) { note = e.message; }
      return renderPanel();
    }
    if (t.id === 'dlStart') {
      try { linkCode = await api('POST', '/discord/link/start', {}); } catch (e) { linkCode = null; note = e.message; }
      renderLinkBoxes(); clearInterval(linkTimer);
      linkTimer = setInterval(async () => { await loadLink(); if (link && link.linked) { clearInterval(linkTimer); linkCode = null; renderLinkBoxes(); loadSession(); } else if (!linkCode || linkCode.expiresAt < Date.now()) { clearInterval(linkTimer); linkCode = null; renderLinkBoxes(); } }, 4000);
      return;
    }
    if (t.id === 'dlRemove') { try { await api('POST', '/discord/link/remove', {}); } catch (e) { note = e.message; } return loadLink().then(loadSession); }
    if (t.id === 'dlDone') { return loadLink().then(loadSession); }
  });

  // ---------------- Discord összekötés doboz (menü + lobbi) ----------------
  function renderLinkBoxes() {
    for (const el of document.querySelectorAll('.discord-link-box')) {
      if (!link) { el.classList.add('hidden'); continue; }
      el.classList.remove('hidden');
      if (link.linked) {
        el.innerHTML = '<b>🎮 Discord:</b> összekötve' + (link.discordUsername ? ' (' + esc(link.discordUsername) + ')' : (link.viaLogin ? ' (Discord-belépéssel)' : '')) +
          (link.viaLogin ? '' : ' <button id="dlRemove" class="btn small ghost">Bontás</button>');
      } else if (linkCode) {
        el.innerHTML = '<b>🎮 Discord összekötés:</b> a Discord szerveren írd be: <code>/kapcsol kod:' + esc(linkCode.code) + '</code> <small>(10 percig érvényes, egyszer használható)</small> <button id="dlDone" class="btn small ghost">Kész</button>';
      } else {
        el.innerHTML = '<b>🎮 Discord:</b> nincs összekötve – a Discordon jelentkezéshez kösd össze a fiókodat. <button id="dlStart" class="btn small">Összekötés</button>' + (note ? ' <span class="court-note">' + esc(note) + '</span>' : '');
      }
    }
  }

  // ---------------- élő frissítés ----------------
  if (typeof socket !== 'undefined') {
    socket.on('court_update', (v) => {
      if (!v) return;
      // Discordon jelentkeztél, és épp a menüben vagy: a szerver szobájába automatikusan belépsz
      if (link && v.roomCode && ['WAITING', 'LOCKED', 'READY'].includes(v.status) && v.participants.some((p) => p.uid === link.uid) &&
        typeof MY !== 'undefined' && !MY.code && document.querySelector('#screen-menu.active')) {
        const key = v.id + ':' + v.roomCode;
        if (!entered.has(key)) { entered.add(key); enter(v.id, true); }
      }
      if (typeof MY !== 'undefined' && v.roomCode === MY.code) {
        if (!session || session.id !== v.id || v.version >= session.version) { session = v; code = MY.code; renderPanel(); }
      }
    });
    socket.on('state', () => {
      if (typeof MY === 'undefined') return;
      if (MY.code !== code) loadSession(); else renderPanel();
    });
    socket.on('connect', () => { loadLink().then(loadSession); });
  }

  // Bejelentkezés / kijelentkezés után a kapcsolat újratöltődik (auth.js jelez a socket-azonosítással)
  window.kbCourts = { reload: () => loadLink().then(loadSession), forget: () => { link = null; session = null; renderLinkBoxes(); renderPanel(); } };
  const origIdentify = typeof identifySocket === 'function' ? identifySocket : null;
  if (origIdentify) {
    window.identifySocket = function patched(...a) { const r = origIdentify.apply(this, a); Promise.resolve(r).then(() => window.kbCourts.reload()); return r; };
  }
  loadLink();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) window.kbCourts.reload(); });
})();
