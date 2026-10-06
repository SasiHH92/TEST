'use strict';
// ============================================================
// KAMU BÍRÓSÁG – barátlista (kliens)
// Az adatok a /api/friends végpontokról jönnek (bejelentkezés kell). Az online állapotot a szerver a
// socketekből számolja a barát láthatósági beállítása szerint; a változásról a `friends_refresh`
// socket-esemény szól, a szobai meghívó a `friend_invite` eseménnyel érkezik.
// ============================================================
(() => {
  let state = null;          // a legutóbbi /api/friends/state
  let tab = 'friends';       // friends | requests | add
  let busy = false;
  let lastRefresh = 0;
  let loaded = false;        // az első sikeres betöltés után jelezzük az új kéréseket
  let knownIncoming = new Set();
  let confirming = null;     // { key, timer }: kétlépéses megerősítés (eltávolítás, tiltás)
  let refreshTimer = null;
  let renderTimer = null;
  let dm = { id: null, card: null, msgs: [] }; // a megnyitott privát beszélgetés

  const $f = (sel) => document.querySelector(sel);
  const key = (name) => String(name || '').normalize('NFKC').trim().toLocaleLowerCase('hu-HU');
  const modalOpen = () => !$f('#friendsModal').classList.contains('hidden');

  async function call(method, route, body) {
    let response;
    try {
      response = await fetch('/api/friends' + route, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000)
      });
    } catch (_) { throw new Error('Nem érhető el a szerver. Próbáld újra kicsit később.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nem sikerült. Próbáld újra.');
    return data;
  }

  const friendsOnline = () => (state ? state.friends.filter((f) => f.status !== 'offline') : []);
  const requestCount = () => (state ? state.incoming.length : 0);
  const dmUnread = () => (state ? state.dmUnread || 0 : 0);
  const attention = () => requestCount() + dmUnread(); // a lebegő gomb piros száma: új kérések + olvasatlan privát üzenetek
  // A viszonyok (nem az online állapot) ujjlenyomata: ha ez változik, a lobbi-plakátok gombjait újra kell rajzolni.
  const relKey = () => (state ? [state.friends, state.incoming, state.outgoing, state.blocked].map((l) => l.map((c) => c.id).sort().join(',')).join('|') : '');

  function setMessage(text, ok) {
    const el = $f('#friendsMessage');
    el.textContent = text || '';
    el.classList.toggle('success', !!ok);
  }

  // ---------------- megjelenítés ----------------

  function avatarHtml(card) {
    const name = String(card.username || '?').replace(/\s*\[[^\]]+\]\s*/, '').trim();
    if (typeof AVATARS !== 'undefined' && AVATARS.includes(card.avatar)) {
      return '<span class="fr-av"><img src="' + avatarSrc(card.avatar) + '" alt=""></span>';
    }
    return '<span class="fr-av fr-mono" style="background:hsl(' + nameHue(name) + ',62%,44%)">' + escapeHtml((name[0] || '?').toUpperCase()) + '</span>';
  }

  function agoText(ts) {
    const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (min < 1) return 'épp most';
    if (min < 60) return min + ' perce';
    const h = Math.round(min / 60);
    if (h < 24) return h + ' órája';
    return Math.round(h / 24) + ' napja';
  }

  function statusHtml(f) {
    if (f.status === 'lobby') return '<span class="fr-st lobby">🏛️ Lobbiban' + (f.code ? ' · <b>' + escapeHtml(f.code) + '</b>' : '') + '</span>';
    if (f.status === 'game') return '<span class="fr-st game">⚖️ Tárgyaláson' + (f.code ? ' · <b>' + escapeHtml(f.code) + '</b>' : '') + '</span>';
    if (f.status === 'online') return '<span class="fr-st online">🟢 Online</span>';
    return '<span class="fr-st">Offline' + (f.lastSeen ? ' · ' + agoText(f.lastSeen) : '') + '</span>';
  }

  function friendRow(f, here) {
    const same = f.code && f.code === here.code;
    const actions = [];
    if ((f.status === 'lobby' || f.status === 'game') && f.code && !same && !here.code) {
      actions.push(f.full ? '<span class="fr-full">Tele</span>'
        : '<button type="button" class="btn small" data-join="' + escapeHtml(f.code) + '">CSATLAKOZOM</button>');
    }
    if (same) actions.push('<span class="fr-full">Veled van</span>');
    if (here.lobby && f.status !== 'offline' && !same) {
      actions.push('<button type="button" class="btn small ghost" data-invite="' + f.id + '">MEGHÍVOM</button>');
    }
    actions.push('<button type="button" class="fr-icon fr-dm' + (f.unread ? ' has-unread' : '') + '" data-dm="' + f.id + '" title="Privát üzenet" aria-label="Privát üzenet">💬' +
      (f.unread ? '<i class="shop-badge">' + f.unread + '</i>' : '') + '</button>');
    actions.push('<button type="button" class="fr-icon" data-remove="' + f.id + '" title="Eltávolítás a barátok közül" aria-label="Eltávolítás">✕</button>');
    actions.push('<button type="button" class="fr-icon" data-block="' + f.id + '" title="Letiltás" aria-label="Letiltás">⛔</button>');
    return '<div class="fr-row' + (f.status === 'offline' ? ' off' : '') + (f.unread ? ' unread' : '') + '">' + avatarHtml(f) +
      '<span class="fr-main"><b>' + escapeHtml(f.username) + '</b>' + statusHtml(f) + '</span>' +
      '<span class="fr-actions">' + actions.join('') + '</span></div>';
  }

  function friendsHtml() {
    if (!state.friends.length) {
      return '<p class="shop-info">Még nincs barátod. A <b>＋ HOZZÁADÁS</b> fülön név alapján jelölhetsz be valakit, ' +
        'a lobbiban pedig a bejelentkezett játékostársak plakátján a <b>＋ BARÁT</b> gombbal.</p>';
    }
    const here = window.kbInRoom ? window.kbInRoom() : { code: '', lobby: false };
    const on = state.friends.filter((f) => f.status !== 'offline');
    const off = state.friends.filter((f) => f.status === 'offline');
    return (on.length ? '<h3 class="fr-h">ONLINE · ' + on.length + '</h3>' + on.map((f) => friendRow(f, here)).join('') : '') +
      (off.length ? '<h3 class="fr-h">OFFLINE · ' + off.length + '</h3>' + off.map((f) => friendRow(f, here)).join('') : '');
  }

  function requestsHtml() {
    const row = (c, actions, note) => '<div class="fr-row">' + avatarHtml(c) +
      '<span class="fr-main"><b>' + escapeHtml(c.username) + '</b><span class="fr-st">' + note + '</span></span>' +
      '<span class="fr-actions">' + actions + '</span></div>';
    const incoming = state.incoming.map((c) => row(c,
      '<button type="button" class="btn small" data-accept="' + c.id + '">ELFOGADOM</button>' +
      '<button type="button" class="btn small ghost" data-decline="' + c.id + '">ELUTASÍTOM</button>' +
      '<button type="button" class="fr-icon" data-block="' + c.id + '" title="Letiltás" aria-label="Letiltás">⛔</button>', 'barátnak jelölt')).join('');
    const outgoing = state.outgoing.map((c) => row(c,
      '<button type="button" class="btn small ghost" data-cancel="' + c.id + '">VISSZAVONOM</button>', 'válaszra vár')).join('');
    const blocked = state.blocked.map((c) => row(c,
      '<button type="button" class="btn small ghost" data-unblock="' + c.id + '">FELOLDOM</button>', 'letiltva')).join('');
    return '<h3 class="fr-h">BEÉRKEZŐ KÉRÉSEK · ' + state.incoming.length + '</h3>' +
      (incoming || '<p class="shop-hint fr-empty">Nincs új kérés.</p>') +
      (outgoing ? '<h3 class="fr-h">ELKÜLDÖTT KÉRÉSEK · ' + state.outgoing.length + '</h3>' + outgoing : '') +
      (blocked ? '<h3 class="fr-h">LETILTOTTAK · ' + state.blocked.length + '</h3>' + blocked : '');
  }

  function addHtml() {
    return '<p class="shop-info">Írd be a barátod <b>felhasználónevét</b> (a fiókja neve, ahogy a kártyáján látszik). ' +
      'A kérést neki el kell fogadnia, utána látjátok egymás online állapotát és meghívhatjátok egymást.</p>' +
      '<form id="frAddForm" class="fr-add"><input id="frAddName" maxlength="40" placeholder="Felhasználónév" autocomplete="off" spellcheck="false">' +
      '<button type="submit" class="btn">KÉRÉS KÜLDÉSE</button></form>' +
      '<p class="shop-hint">Játék közben a lobbi plakátjain a bejelentkezett játékostársaknál a <b>＋ BARÁT</b> gombbal is bejelölheted őket.</p>';
  }

  // ---- privát beszélgetés ----
  const dmTime = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function dmMessageHtml(m) {
    const own = state && m.from === state.me.id;
    return '<div class="chat-msg' + (own ? ' me' : '') + '" data-id="' + m.id + '"><span class="cm-text">' + escapeHtml(m.text) + '</span><time class="dm-time">' + dmTime(m.ts) + '</time></div>';
  }
  function dmHtml() {
    const card = dm.card || (state && state.friends.find((f) => f.id === dm.id)) || { username: '…', avatar: '' };
    const f = state && state.friends.find((x) => x.id === dm.id);
    return '<div class="dm-head"><button type="button" class="btn small ghost" data-dm-back="1">◀ VISSZA</button>' + avatarHtml(card) +
      '<span class="fr-main"><b>' + escapeHtml(card.username) + '</b>' + (f ? statusHtml(f) : '') + '</span></div>' +
      '<div id="dmLog" class="dm-log" role="log" aria-live="polite">' +
      (dm.msgs.length ? dm.msgs.map(dmMessageHtml).join('') : '<p class="chat-empty">Még nincs üzenet. Írj valamit!</p>') + '</div>' +
      '<form id="dmForm" class="chat-form dm-form" autocomplete="off"><input id="dmInput" type="text" maxlength="500" placeholder="Privát üzenet…" aria-label="Privát üzenet" autocomplete="off">' +
      '<button type="submit" class="btn small">KÜLD</button></form>';
  }
  function scrollDm() { const log = $f('#dmLog'); if (log) log.scrollTop = log.scrollHeight; }
  function addDm(m) {
    if (!m || dm.msgs.some((x) => x.id === m.id)) return;
    dm.msgs.push(m);
    const log = $f('#dmLog');
    if (!log) return;
    const empty = log.querySelector('.chat-empty'); if (empty) empty.remove();
    log.insertAdjacentHTML('beforeend', dmMessageHtml(m));
    scrollDm();
  }
  async function openDm(id) {
    dm = { id, card: null, msgs: [] };
    tab = 'dm'; setMessage(''); render(true);
    try {
      const d = await call('GET', '/dm/' + encodeURIComponent(id));
      if (dm.id !== id) return;
      dm.card = d.with; dm.msgs = d.messages;
    } catch (error) { setMessage(error.message); dm = { id: null, card: null, msgs: [] }; tab = 'friends'; render(true); return; }
    render(true); scrollDm();
    refresh(true); // az olvasatlan-számlálók frissülnek
    setTimeout(() => { const i = $f('#dmInput'); if (i && matchMedia('(min-width: 701px)').matches) i.focus(); }, 40);
  }

  function updateFab() {
    const fab = $f('#friendsFab');
    const screen = document.body.dataset.screen;
    fab.classList.toggle('hidden', !(window.kbAccount && ['name', 'menu', 'lobby'].includes(screen)));
    const on = friendsOnline().length, req = attention();
    const onEl = $f('#friendsFabOnline'), badge = $f('#friendsFabBadge');
    onEl.textContent = on; onEl.classList.toggle('hidden', !on);
    badge.textContent = req; badge.classList.toggle('hidden', !req);
    const count = $f('#frCount'), reqBadge = $f('#frReqBadge');
    count.textContent = on + '/' + (state ? state.friends.length : 0);
    count.classList.toggle('hidden', !state || !state.friends.length);
    reqBadge.textContent = requestCount(); reqBadge.classList.toggle('hidden', !requestCount()); // csak az új kérések (a privát üzenetek a sorokon látszanak)
  }

  function render(force) {
    if (!state) { $f('#friendsBody').innerHTML = '<p class="shop-info">Betöltés…</p>'; return; }
    $f('#frTabFriends').setAttribute('aria-selected', String(tab === 'friends' || tab === 'dm'));
    $f('#frTabRequests').setAttribute('aria-selected', String(tab === 'requests'));
    $f('#frTabAdd').setAttribute('aria-selected', String(tab === 'add'));
    $f('#frPresence').value = state.presence;
    $f('#frNotify').checked = state.notifyOnline !== false;
    updateFab();
    const body = $f('#friendsBody');
    if (tab === 'add' && !force && body.querySelector('#frAddName')) return; // ne töröljük a beírt nevet
    if (tab === 'dm' && !force && body.querySelector('#dmInput')) return;    // a beszélgetés élőben egészül ki (addDm)
    const scroll = body.scrollTop;
    body.innerHTML = tab === 'friends' ? friendsHtml() : tab === 'requests' ? requestsHtml() : tab === 'dm' ? dmHtml() : addHtml();
    body.scrollTop = scroll;
  }

  // ---------------- adatok ----------------

  function announceNewRequests() {
    const ids = new Set(state.incoming.map((c) => c.id));
    if (loaded) {
      for (const c of state.incoming) {
        if (!knownIncoming.has(c.id) && typeof showToast === 'function') showToast('👋 ' + c.username + ' barátnak jelölt. A 👥 BARÁTOK ablakban elfogadhatod.');
      }
    }
    knownIncoming = ids; loaded = true;
  }

  function changed(prevReq, prevRel) {
    updateFab();
    if (modalOpen()) render();
    const screen = document.body.dataset.screen;
    // A profil-panel gombja (kérés-jelvény) és a lobbi-plakátok gombjai a viszonyok változásakor frissülnek.
    if (screen === 'name' && requestCount() !== prevReq && typeof renderMugGrid === 'function') renderMugGrid();
    if (screen === 'lobby' && relKey() !== prevRel && typeof renderLobby === 'function' && typeof S !== 'undefined' && S) renderLobby();
  }

  async function refresh(force) {
    if (!window.kbAccount) { state = null; updateFab(); return null; }
    if (!force && Date.now() - lastRefresh < 3000) return state;
    lastRefresh = Date.now();
    const prevReq = requestCount(), prevRel = relKey();
    try { state = await call('GET', '/state'); } catch (_) { return state; }
    announceNewRequests();
    changed(prevReq, prevRel);
    return state;
  }

  async function act(route, body, okText) {
    if (busy) return null;
    busy = true; setMessage('');
    const prevReq = requestCount(), prevRel = relKey();
    let data = null;
    try {
      data = await call('POST', route, body);
      state = data;
      knownIncoming = new Set(state.incoming.map((c) => c.id)); loaded = true;
      if (okText) setMessage(typeof okText === 'function' ? okText(data) : okText, true);
    } catch (error) { setMessage(error.message); }
    finally { busy = false; changed(prevReq, prevRel); }
    return data;
  }

  // Kétlépéses megerősítés a visszafordíthatatlan gomboknál (eltávolítás, tiltás).
  function confirmThen(id, button, fn) {
    if (confirming && confirming.key === id) { clearTimeout(confirming.timer); confirming = null; return fn(); }
    if (confirming) clearTimeout(confirming.timer);
    const old = button.textContent;
    button.textContent = 'BIZTOS?'; button.classList.add('danger');
    confirming = { key: id, timer: setTimeout(() => { confirming = null; button.textContent = old; button.classList.remove('danger'); }, 4000) };
  }

  const nameOf = (id) => {
    const all = state ? [...state.friends, ...state.incoming, ...state.outgoing, ...state.blocked] : [];
    const c = all.find((x) => x.id === id);
    return c ? c.username : '';
  };

  // ---------------- ablak ----------------

  function open(which) {
    if (!window.kbAccount) return;
    tab = ['friends', 'requests', 'add'].includes(which) ? which : (requestCount() ? 'requests' : 'friends');
    dm = { id: null, card: null, msgs: [] };
    setMessage('');
    $f('#friendsModal').classList.remove('hidden');
    render(true);
    refresh(true);
    clearInterval(renderTimer);
    renderTimer = setInterval(() => { if (modalOpen()) render(); }, 30000); // az "x perce" feliratok frissítése
  }

  function close() {
    $f('#friendsModal').classList.add('hidden');
    clearInterval(renderTimer);
  }

  $f('#friendsClose').addEventListener('click', close);
  $f('#friendsModal').addEventListener('click', (e) => { if (e.target === $f('#friendsModal')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOpen()) close(); });
  $f('#friendsFab').addEventListener('click', () => open());
  $f('#frTabFriends').addEventListener('click', () => { tab = 'friends'; setMessage(''); render(true); });
  $f('#frTabRequests').addEventListener('click', () => { tab = 'requests'; setMessage(''); render(true); });
  $f('#frTabAdd').addEventListener('click', () => { tab = 'add'; setMessage(''); render(true); setTimeout(() => { const i = $f('#frAddName'); if (i) i.focus(); }, 30); });
  $f('#frPresence').addEventListener('change', (e) => {
    act('/settings', { presence: e.target.value }, 'Láthatóság elmentve.');
  });

  $f('#frNotify').addEventListener('change', (e) => {
    act('/settings', { notifyOnline: e.target.checked }, e.target.checked ? 'Értesítünk, ha egy barátod online lép.' : 'Nem értesítünk az online lépésekről.');
  });

  $f('#friendsBody').addEventListener('submit', async (e) => {
    if (e.target.matches('#dmForm')) {
      e.preventDefault();
      const input = $f('#dmInput'), text = input.value.trim();
      if (!text || !dm.id) return;
      input.disabled = true;
      try {
        const r = await call('POST', '/dm/send', { userId: dm.id, text });
        input.value = ''; addDm(r.message); setMessage('');
      } catch (error) { setMessage(error.message); }
      finally { input.disabled = false; input.focus(); }
      return;
    }
    if (!e.target.matches('#frAddForm')) return;
    e.preventDefault();
    const input = $f('#frAddName');
    const username = input.value.trim();
    if (!username) { input.focus(); return; }
    const data = await act('/request', { username }, (d) => d.outcome === 'friends'
      ? '🎉 Barátok lettetek: ' + d.username + '!' : '📨 Kérés elküldve neki: ' + d.username);
    if (data) input.value = '';
  });

  $f('#friendsBody').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.dm) return openDm(d.dm);
    if (d.dmBack) { dm = { id: null, card: null, msgs: [] }; tab = 'friends'; setMessage(''); render(true); return; }
    if (d.join) { close(); return window.kbJoinFriendRoom && window.kbJoinFriendRoom(d.join); }
    if (d.invite) {
      t.disabled = true;
      return socket.emit('friend_invite', { friendId: d.invite }, (res) => {
        t.disabled = false;
        if (res && res.error) setMessage(res.error);
        else setMessage('📨 Meghívó elküldve: ' + nameOf(d.invite), true);
      });
    }
    if (d.accept) return act('/accept', { userId: d.accept }, (r) => '🎉 Barátok lettetek: ' + r.username + '!');
    if (d.decline) return act('/decline', { userId: d.decline }, 'Kérés elutasítva.');
    if (d.cancel) return act('/cancel', { userId: d.cancel }, 'Kérés visszavonva.');
    if (d.unblock) return act('/unblock', { userId: d.unblock }, 'Tiltás feloldva.');
    if (d.remove) return confirmThen('remove:' + d.remove, t, () => act('/remove', { userId: d.remove }, 'Eltávolítva a barátok közül.'));
    if (d.block) return confirmThen('block:' + d.block, t, () => act('/block', { userId: d.block }, 'Letiltva. Nem küldhet neked kérést vagy meghívót.'));
  });

  // ---------------- szobai meghívó (kártya a képernyő sarkában) ----------------

  function showInvite(p) {
    if (!p || !p.from || typeof p.from.id !== 'string' || !/^[A-Z0-9]{4}$/.test(String(p.code || ''))) return;
    const stack = $f('#inviteStack');
    for (const old of [...stack.children]) if (old.dataset.from === p.from.id) old.remove();
    while (stack.children.length >= 3) stack.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'invite-card';
    el.dataset.from = p.from.id;
    el.dataset.code = p.code;
    el.innerHTML = avatarHtml(p.from) +
      '<span class="iv-text"><b>' + escapeHtml(p.from.username) + '</b> meghívott a szobájába<small>Kód: ' + escapeHtml(p.code) + '</small></span>' +
      '<button type="button" class="btn small" data-iv-join="' + escapeHtml(p.code) + '">CSATLAKOZOM</button>' +
      '<button type="button" class="btn small ghost" data-iv-close="1" aria-label="Bezár">✕</button>';
    stack.appendChild(el);
    setTimeout(() => el.remove(), 60000);
  }

  $f('#inviteStack').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const card = t.closest('.invite-card');
    if (t.dataset.ivJoin) { if (window.kbJoinFriendRoom && window.kbJoinFriendRoom(t.dataset.ivJoin)) card.remove(); return; }
    if (t.dataset.ivClose) card.remove();
  });

  // ---------------- gyors hozzáadás a lobbi plakátjáról ----------------

  function canAdd(name) {
    if (!state || !window.kbAccount) return false;
    const n = key(name);
    if (n === key(state.me.username)) return false;
    return ![...state.friends, ...state.incoming, ...state.outgoing, ...state.blocked].some((c) => key(c.username) === n);
  }

  async function quickAdd(name, button) {
    if (button) button.disabled = true;
    const prevReq = requestCount(), prevRel = relKey();
    try {
      const data = await call('POST', '/request', { username: name });
      state = data;
      knownIncoming = new Set(state.incoming.map((c) => c.id));
      showToast(data.outcome === 'friends' ? '🎉 Barátok lettetek: ' + data.username + '!' : '📨 Barátkérés elküldve: ' + data.username);
    } catch (error) {
      showToast('⚠️ ' + error.message);
      if (button) button.disabled = false;
    }
    changed(prevReq, prevRel);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add-friend]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    quickAdd(b.dataset.addFriend, b);
  }, true);

  // ---------------- élő frissítés ----------------

  socket.on('friends_refresh', () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(true), 400);
  });
  socket.on('friend_invite', showInvite);

  // Új privát üzenet: ha épp az a beszélgetés van nyitva, beíródik és olvasottnak számít; egyébként értesítés + számláló.
  socket.on('dm_msg', ({ from, message } = {}) => {
    if (!from || !message) return;
    const watching = modalOpen() && tab === 'dm' && dm.id === from.id;
    if (watching) {
      addDm(message);
      call('POST', '/dm/read', { userId: from.id }).catch(() => {});
    } else if (typeof showToast === 'function') {
      showToast('💬 ' + from.username + ': ' + String(message.text).slice(0, 80));
    }
    if (window.kbSound) window.kbSound.ping();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(true), 300);
  });
  socket.on('dm_sent', ({ to, message } = {}) => { if (message && modalOpen() && tab === 'dm' && dm.id === to) addDm(message); });
  // Egy barátod most lépett online (a láthatóságát és a te beállításodat a szerver már figyelembe vette).
  socket.on('friend_online', ({ from } = {}) => {
    if (!from || document.body.dataset.screen === 'game') return; // játék közben nem zavarunk
    if (typeof showToast === 'function') showToast('🟢 ' + from.username + ' online lett');
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(true), 300);
  });
  document.addEventListener('kb:screen', () => {
    updateFab();
    // A szobában, ahová a meghívó szólt, már bent vagyunk: a kártya felesleges.
    const here = window.kbInRoom ? window.kbInRoom().code : '';
    if (here) for (const card of $f('#inviteStack').querySelectorAll('.invite-card')) if (card.dataset.code === here) card.remove();
    if (window.kbAccount && Date.now() - lastRefresh > 20000) refresh(true);
  });
  setInterval(() => { if (window.kbAccount && !document.hidden) refresh(true); }, 45000);

  // A játék többi része ezen keresztül éri el.
  window.kbFriends = {
    open, close, refresh, canAdd, requestCount,
    state: () => state,
    onlineCount: () => friendsOnline().length,
    forget: () => {
      state = null; loaded = false; knownIncoming = new Set(); lastRefresh = 0;
      $f('#inviteStack').replaceChildren();
      close(); updateFab();
    }
  };
})();
