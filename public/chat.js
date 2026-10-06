'use strict';
// ============================================================
// KAMU BÍRÓSÁG – szobai csevegő (kliens)
// A lobbiban és a játék közben mindenki ír mindenkinek a szobában. Az üzeneteket a szerver tárolja
// (utolsó 80), belépéskor / újracsatlakozáskor a kliens megkapja az előzményt (kbChat.load).
// ============================================================
(() => {
  const MAX_SHOWN = 120;
  let messages = [];       // { id, pid, name, text, ts }
  let seen = new Set();    // már megjelenített üzenet-azonosítók (az újracsatlakozás nem duplázza)
  let open = false;
  let unread = 0;
  let busy = false;

  const $c = (sel) => document.querySelector(sel);
  const inRoomScreen = () => ['lobby', 'game'].includes(document.body.dataset.screen);
  const mine = (m) => typeof MY !== 'undefined' && m.pid === MY.playerId;

  function timeText(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function messageHtml(m, prev) {
    const same = prev && prev.pid === m.pid && m.ts - prev.ts < 90000;
    const own = mine(m);
    return '<div class="chat-msg' + (own ? ' me' : '') + (same ? ' cont' : '') + '" data-id="' + m.id + '">' +
      (same ? '' : '<span class="cm-name" style="color:hsl(' + nameHue(m.name) + ',70%,72%)">' + escapeHtml(own ? 'Te' : m.name) + '<time>' + timeText(m.ts) + '</time></span>') +
      '<span class="cm-text">' + escapeHtml(m.text) + '</span></div>';
  }

  function render() {
    const log = $c('#chatLog');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.innerHTML = messages.length
      ? messages.map((m, i) => messageHtml(m, messages[i - 1])).join('')
      : '<p class="chat-empty">Még nincs üzenet. Írj valamit a teremnek!</p>';
    if (atBottom || !log.dataset.scrolled) { log.scrollTop = log.scrollHeight; log.dataset.scrolled = '1'; }
    $c('#chatSub').textContent = typeof S !== 'undefined' && S && S.players ? S.players.filter((p) => p.connected && !p.isBot).length + ' játékos a szobában' : '';
  }

  function updateFab() {
    const show = inRoomScreen();
    $c('#chatFab').classList.toggle('hidden', !show || open);
    const badge = $c('#chatBadge');
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.classList.toggle('hidden', !unread);
    if (!show && open) setOpen(false, false);
  }

  // persist: a játékos saját döntése (gomb) megjegyződik; a program általi nyitás/zárás nem írja felül.
  function setOpen(value, persist = true) {
    open = !!value;
    $c('#chatPanel').classList.toggle('hidden', !open);
    if (open) {
      unread = 0;
      render();
      setTimeout(() => { const i = $c('#chatInput'); if (i && matchMedia('(min-width: 701px)').matches) i.focus(); }, 40);
    }
    updateFab();
    if (persist) {
      try { localStorage.setItem('kb_chat_open', open ? '1' : '0'); } catch (_) { /* a beállítás nem kötelező */ }
    }
  }

  function add(m) {
    if (!m || typeof m.id !== 'number' || seen.has(m.id)) return;
    seen.add(m.id);
    messages.push(m);
    if (messages.length > MAX_SHOWN) { const old = messages.shift(); seen.delete(old.id); }
    if (open) render();
    else if (!mine(m)) { unread++; updateFab(); }
  }

  // A szoba előzménye (belépéskor, újracsatlakozáskor): a már látottakat nem duplázza.
  function load(list) {
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || typeof m.id !== 'number' || seen.has(m.id)) continue;
      seen.add(m.id);
      messages.push(m);
    }
    messages.sort((a, b) => a.id - b.id);
    if (messages.length > MAX_SHOWN) messages = messages.slice(-MAX_SHOWN);
    if (open) render();
  }

  function clear() {
    messages = []; seen = new Set(); unread = 0;
    $c('#chatLog').dataset.scrolled = '';
    if (open) render();
    updateFab();
  }

  function setNote(text) {
    const el = $c('#chatNote');
    el.textContent = text || '';
    clearTimeout(setNote._t);
    if (text) setNote._t = setTimeout(() => { el.textContent = ''; }, 3500);
  }

  $c('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $c('#chatInput');
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    socket.emit('chat_send', { text }, (res) => {
      busy = false;
      if (res && res.error) { setNote(res.error); return; }
      input.value = '';
      setNote('');
    });
  });
  $c('#chatFab').addEventListener('click', () => setOpen(true));
  $c('#chatClose').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !$c('#chatPanel').classList.contains('hidden') && document.activeElement === $c('#chatInput')) setOpen(false); });
  socket.on('chat_msg', add);

  // Képernyőváltás: szobán kívül nincs csevegő (az előzmény törlődik); a lobbiba lépve asztali gépen nyitva indul.
  let wasInRoom = false, lastScreen = '';
  document.addEventListener('kb:screen', () => {
    const screen = document.body.dataset.screen, now = inRoomScreen();
    if (!now && wasInRoom) { setOpen(false, false); clear(); }
    if (now && !wasInRoom && screen === 'lobby') {
      let pref = null;
      try { pref = localStorage.getItem('kb_chat_open'); } catch (_) { /* */ }
      if (pref !== '0' && matchMedia('(min-width: 1000px)').matches) setOpen(true, false);
    }
    // A játék kezdetekor a csevegő összecsukódik (ne takarja a termet); a gombbal bármikor megnyitható.
    if (screen === 'game' && lastScreen === 'lobby' && open) setOpen(false, false);
    wasInRoom = now; lastScreen = screen;
    updateFab();
  });

  window.kbChat = { load, clear, open: () => setOpen(true), unread: () => unread };
})();
