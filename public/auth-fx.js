'use strict';
// ============================================================
// BELÉPŐOLDAL – látvány (index.html #screen-auth.aw, auth-wow.css): belépő animáció (képernyőnként egyszer), ÉLŐ sáv (/api/live, 20 mp-enként,
// amíg a belépő látszik), egérrel 3D-dőlés a nagy kártyákon. A bejelentkezés / regisztráció / vendég-belépés logikája az auth.js-ben van – itt csak a látvány.
// ============================================================
(function () {
  const root = document.getElementById('screen-auth');
  if (!root || window.KB_WATCH) return;
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const onAuth = () => !document.body.dataset.screen || document.body.dataset.screen === 'auth';
  let liveTimer = 0, enterTimer = 0;

  function renderLive(d) {
    const el = root.querySelector('.aw-live-txt'); if (!el) return;
    if (!d) { el.textContent = 'a terem nyitva'; return; }
    const parts = [];
    if (d.playing) parts.push(d.playing + ' tárgyalás folyik');
    if (d.lobbies) parts.push(d.lobbies + ' szoba gyülekezik');
    if (d.players) parts.push(d.players + ' gyanúsított a teremben');
    el.textContent = parts.length ? parts.join(' · ') : 'a terem nyitva – légy te az első vádlott!';
  }
  const pollLive = () => fetch('/api/live', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(renderLive).catch(() => renderLive(null));

  function enter() {
    clearInterval(liveTimer); pollLive(); liveTimer = setInterval(() => { if (onAuth() && document.visibilityState === 'visible') pollLive(); }, 20000);
    if (reduced()) return;
    root.classList.remove('aw-enter'); void root.offsetWidth; root.classList.add('aw-enter');
    clearTimeout(enterTimer); enterTimer = setTimeout(() => root.classList.remove('aw-enter'), 2400);
  }
  function leave() { clearInterval(liveTimer); liveTimer = 0; clearTimeout(enterTimer); root.classList.remove('aw-enter'); }

  // 3D-dőlés + csillanás (csak egérrel)
  const fine = () => { try { return matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (_) { return false; } };
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || reduced() || !fine()) return;
    const card = e.target.closest && e.target.closest('.aw-card'); if (!card || card.disabled) return;
    const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--ry', ((x - 0.5) * 9).toFixed(2) + 'deg'); card.style.setProperty('--rx', ((0.5 - y) * 8).toFixed(2) + 'deg');
    card.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); card.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
    card.classList.add('tilt');
  });
  root.addEventListener('pointerout', (e) => {
    const card = e.target.closest && e.target.closest('.aw-card');
    if (card && !card.contains(e.relatedTarget)) { card.classList.remove('tilt'); card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }
  });

  let current = document.body.dataset.screen || '';
  document.addEventListener('kb:screen', (e) => {
    const prev = current; current = e.detail;
    if (e.detail === 'auth') { if (prev !== 'auth') enter(); } else if (prev === 'auth' || prev === '') leave();
  });
  if (onAuth()) enter();
  window.kbAuthFx = { enter, leave, live: pollLive, state: () => ({ entering: root.classList.contains('aw-enter') }) };
})();
