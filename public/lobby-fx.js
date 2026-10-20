'use strict';
// ============================================================
// LOBBI – látvány (index.html #screen-lobby.lw, lobby-wow.css): belépő animáció (képernyőnként egyszer), ülés-számláló a teremben
// ("5 / 12 gyanúsított", pöttyök; 3 alatt "még N kell"), a házigazda-asztal TÁRGYALÁS gombjának kiemelése, ha elég a játékos.
// A lobbi logikája (plakátok, gombok, beállítások, indítás) a client.js-ben marad – a szerver az igazság, itt csak a megjelenítés.
// ============================================================
(function () {
  const root = document.getElementById('screen-lobby');
  if (!root || window.KB_WATCH) return;
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const MIN = 3;
  let max = 12, enterTimer = 0;
  fetch('/api/config', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((c) => { if (c && c.maxPlayers > 0) { max = c.maxPlayers; seats(); } }).catch(() => {});

  function seats() {
    const box = document.getElementById('lwSeats');
    if (!box || typeof S === 'undefined' || !S || S.phase !== 'lobby') return;
    const n = S.players.filter((p) => p.connected).length, need = Math.max(0, MIN - n);
    let pips = '';
    for (let i = 0; i < max; i++) pips += '<i class="' + (i < n ? 'on' : '') + (i === MIN - 1 ? ' min' : '') + '"></i>';
    box.innerHTML = '<span class="lw-seat-pips" aria-hidden="true">' + pips + '</span>' +
      '<span class="lw-seat-txt"><b>' + n + ' / ' + max + '</b> GYANÚSÍTOTT' + (need ? ' · <em>még ' + need + ' kell a tárgyaláshoz</em>' : ' · <em class="ok">indulhat a tárgyalás!</em>') + '</span>';
    box.classList.toggle('ready', !need);
    root.classList.toggle('lw-can-start', !need);
  }

  function enter() {
    seats();
    if (reduced()) return;
    root.classList.remove('lw-enter'); void root.offsetWidth; root.classList.add('lw-enter');
    clearTimeout(enterTimer); enterTimer = setTimeout(() => root.classList.remove('lw-enter'), 2000);
  }
  let current = document.body.dataset.screen || '';
  document.addEventListener('kb:screen', (e) => {
    const prev = current; current = e.detail;
    if (e.detail === 'lobby' && prev !== 'lobby') enter();
    if (e.detail !== 'lobby') { clearTimeout(enterTimer); root.classList.remove('lw-enter'); }
  });
  document.addEventListener('kb:state', seats);
  window.kbLobbyFx = { enter, seats, state: () => ({ entering: root.classList.contains('lw-enter'), max }) };
})();
