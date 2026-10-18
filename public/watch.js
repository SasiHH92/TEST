'use strict';
// NÉZŐ MÓD (stream-nézet): /?watch=KÓD – a tárgyalás játékos nélkül, gombok nélkül nézhető (a stream nézői, vagy OBS böngészőforrásként).
// A néző nem játékos: nem foglal helyet a szobában, nem tud szavazni / beszélni / reagálni, és a szervertől csak a NYILVÁNOS állapotot kapja
// (titkos kártyák, saját kihívás, bírói figyelő nélkül) a 'watch_state' eseményben – a játékosok állapotkezelője nem fut (IDENTITY_READY = false).
// A felfedés ("TE VAGY A …") nézőnél nem jelenik meg (client.js courtSnapshot). A reakciók, a tiltakozás és a kalapács a nézőnek is látszanak.
(function () {
  const code = window.KB_WATCH;
  if (!code || typeof socket === 'undefined') return;
  document.body.classList.add('watch-mode');
  IDENTITY_READY = false; // a játékos 'state' kezelője ne fusson (a néző nincs a játékosok között)
  MY.playerId = ''; MY.code = code;

  // jelvény a sarokban: NÉZŐ · ÜGY · nézőszám; és egy üzenetsáv (kapcsolódás, bezárult szoba)
  const badge = document.createElement('div');
  badge.id = 'watchBadge'; badge.className = 'watch-badge';
  badge.setAttribute('aria-live', 'polite');
  document.body.appendChild(badge);
  const note = document.createElement('div');
  note.id = 'watchNote'; note.className = 'watch-note'; note.setAttribute('role', 'status');
  document.body.appendChild(note);
  const setNote = (text) => { note.textContent = text || ''; note.hidden = !text; };
  const setBadge = (n) => { badge.textContent = '📺 NÉZŐ · ÜGY ' + code + (n > 1 ? ' · ' + n + ' néző' : ''); };
  setBadge(0);
  setNote('Kapcsolódás a tárgyaláshoz…');

  // az ügyszám a lobbiban és a játék felső sávjában (a játékosnál a belépés írja ki)
  for (const id of ['lobbyCode', 'gameCode']) { const el = document.getElementById(id); if (el) el.textContent = code; }
  function apply(state) {
    if (!state || !state.players) return;
    serverOffset = state.serverNow - Date.now();
    S = state;
    setBadge(state.spectators || 0);
    if (state.phase === 'lobby') { show('lobby'); renderLobby(); }
    else { show('game'); renderGame(); }
  }
  let closed = false;
  function join() {
    if (closed) return;
    socket.emit('watch_room', { code }, (res) => {
      if (!res || res.error) { setNote((res && res.error) || 'A tárgyalás most nem érhető el.'); return; }
      setNote('');
      apply(res.state);
    });
  }
  socket.on('watch_state', apply);
  socket.on('watch_closed', () => { closed = true; setNote('A tárgyalás véget ért – a szoba bezárult.'); });
  socket.on('connect', join); // az első kapcsolódás és minden újracsatlakozás
  if (socket.connected) join();
  window.kbWatch = { code, state: () => ({ code, closed, spectators: (S && S.spectators) || 0 }) };
})();
