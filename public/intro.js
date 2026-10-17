'use strict';
// Egyszeri bevezető (intro): 5 dia, lapozás gombbal / nyíllal / húzással; a végén "KEZDJÜK!" vagy bármikor "KIHAGYOM".
// A megjelenés feltételét az intro-boot.js dönti (html.intro-pending). Itt: lapozás, bezárás, megjegyzés (localStorage), újrajátszás a súgóból.
//   - végigment (KEZDJÜK!): kb_introSeen + kb_helpSeen (a rövid útmutató sem nyílik meg magától az első belépéskor)
//   - kihagyta: csak kb_introSeen (az első belépéskor az útmutató még megnyílik)
(function () {
  const root = document.getElementById('introOverlay');
  if (!root) return;
  const slides = Array.from(root.querySelectorAll('.intro-slide'));
  const dotsBox = root.querySelector('#introDots'), next = root.querySelector('#introNext'), skip = root.querySelector('#introSkip');
  if (!slides.length || !next) return;
  let i = 0, opener = null;
  const last = slides.length - 1;
  const reduced = () => document.body.classList.contains('reduced-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const mark = (k) => { try { window.localStorage.setItem(k, '1'); } catch (_) { /* nincs tár */ } };
  const play = (name) => { try { if (window.kbSound && window.kbSound.play) window.kbSound.play(name); } catch (_) { /* a hang nem kötelező */ } };
  const pending = () => document.documentElement.classList.contains('intro-pending');

  const dots = slides.map((_, k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'intro-dot'; b.setAttribute('aria-label', (k + 1) + '. dia');
    b.addEventListener('click', () => go(k));
    dotsBox.appendChild(b);
    return b;
  });

  function go(n) {
    i = Math.max(0, Math.min(last, n));
    slides.forEach((s, k) => { s.classList.toggle('active', k === i); s.setAttribute('aria-hidden', k === i ? 'false' : 'true'); });
    dots.forEach((d, k) => { d.classList.toggle('on', k === i); if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    next.textContent = i === last ? 'KEZDJÜK! ⚖️' : 'TOVÁBB ▸';
    if (skip) skip.hidden = i === last;
  }

  function finish(completed) {
    mark('kb_introSeen');
    if (completed) {
      mark('kb_helpSeen');
      document.querySelectorAll('.howto-btn').forEach((b) => b.classList.remove('first-visit'));
    }
    const done = () => { document.documentElement.classList.remove('intro-pending'); root.classList.remove('leaving'); try { if (opener && opener.focus) opener.focus({ preventScroll: true }); } catch (_) { /* */ } };
    if (reduced()) done(); else { root.classList.add('leaving'); setTimeout(done, 340); }
  }

  function show() {
    opener = document.activeElement;
    document.documentElement.classList.add('intro-pending');
    go(0);
    // a képek előtöltése, hogy lapozáskor ne villanjon
    slides.forEach((s) => { const im = s.querySelector('img'); if (im && !im.complete) { const p = new Image(); p.src = im.currentSrc || im.src; } });
    setTimeout(() => { try { next.focus({ preventScroll: true }); } catch (_) { /* */ } }, 60);
  }

  next.addEventListener('click', () => { if (i < last) { play('ui-click'); go(i + 1); } else { play('gavel'); finish(true); } });
  if (skip) skip.addEventListener('click', () => finish(false));

  document.addEventListener('keydown', (e) => {
    if (!pending()) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); if (i < last) go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });

  // húzás (érintés): balra = következő, jobbra = előző
  let sx = null, sy = null;
  root.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = sy = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) { if (dx < 0 && i < last) go(i + 1); else if (dx > 0) go(i - 1); }
  }, { passive: true });

  // újrajátszás: a súgó ablak "Bevezető" gombja
  const replay = document.getElementById('helpIntro');
  if (replay) replay.addEventListener('click', () => { const c = document.getElementById('helpClose'); if (c) c.click(); show(); });

  window.kbIntro = { show, reset() { try { window.localStorage.removeItem('kb_introSeen'); } catch (_) { /* */ } } };
  if (pending()) show();
})();
