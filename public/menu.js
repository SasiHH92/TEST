'use strict';
// ============================================================
// FŐMENÜ – "a tárgyalóterem előcsarnoka" (index.html #screen-menu, menu.css)
//  - színpad: a saját avatár szerep-képei (bíró → ügyész → vádlott → tanú → esküdt) reflektorfényben váltakoznak; ha nincs szerep-kép, a szerepek alapfigurái
//  - belépő: kép-ráközelítés, a cím lehull + kalapácsütés, a figura beúszik, a kártyák berepülnek (képernyőnként egyszer; csökkentett mozgásnál nincs)
//  - kártyák: egérrel 3D-dőlés + csillanás (csak egérrel; érintésnél nincs)
//  - élő sáv: /api/live (folyó tárgyalások, gyülekező szobák, játékosok – csak összesítés), 20 mp-enként, amíg a menü látszik
//  - RENDKÍVÜLI hírszalag a játékos saját nevével (a lobbi hírsablonjai)
//  - háttér: a terem képe a beégetett felirat nélkül (a teteje levágva, mint a játékban); a login-videó itt nem kell (abban is benne van a felirat)
// A gombok (btnCreate, btnJoin, codeInput, btnPacks, btnHowTo …) a client.js / packs.js / súgó saját kezelői: itt csak a látvány.
// ============================================================
(function () {
  const root = document.getElementById('screen-menu');
  if (!root || window.KB_WATCH) return;
  const $m = (sel) => root.querySelector(sel);
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const ROLES = [
    { role: 'judge', img: 'biro.png', name: 'BÍRÓ', sub: 'Kalapács a kézben, te döntesz.' },
    { role: 'prosecutor', img: 'ugyesz.png', name: 'ÜGYÉSZ', sub: 'Bizonyítsd, hogy bűnös!' },
    { role: 'defendant', img: 'vadlott.png', name: 'VÁDLOTT', sub: 'Tagadj le mindent. Mindent.' },
    { role: 'witness', img: 'tanu.png', name: 'TANÚ', sub: 'Láttál valamit… vagy mégsem?' },
    { role: 'juror', img: 'eskudt1.png', name: 'ESKÜDT', sub: 'A nép ítél. Te vagy a nép.' }
  ];
  let timers = [], heroI = 0, heroLayer = 0, liveTimer = 0, newsTimer = 0;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };

  // ---------- színpad: szerep-váltó ----------
  function heroSrc(r) {
    const av = typeof MY !== 'undefined' ? MY.avatar : '';
    const sp = window.kbAvatarRoles && av ? window.kbAvatarRoles.spriteFor(av, r.role) : null;
    return { src: sp || '/assets/' + r.img, sprite: !!sp };
  }
  function showHero(i, instant) {
    const r = ROLES[i % ROLES.length], h = heroSrc(r);
    const imgs = root.querySelectorAll('.mm-hero'), next = imgs[heroLayer ^ 1], cur = imgs[heroLayer];
    const swap = () => {
      next.classList.toggle('sprite', h.sprite);
      next.classList.add('on'); cur.classList.remove('on');
      heroLayer ^= 1;
      const role = $m('.mm-role'), sub = $m('.mm-role-sub'), plate = $m('.mm-plate');
      if (role) role.textContent = r.name;
      if (sub) sub.textContent = r.sub;
      if (plate && !instant) { plate.classList.remove('flip'); void plate.offsetWidth; plate.classList.add('flip'); }
    };
    if (next.getAttribute('src') === h.src && next.complete) return swap();
    next.onload = () => { next.onload = null; swap(); };
    next.onerror = () => { next.onerror = null; if (h.sprite && window.kbAvatarRoles) window.kbAvatarRoles.markMissing(MY.avatar, r.role); };
    next.src = h.src;
  }
  function cycle() { heroI = (heroI + 1) % ROLES.length; showHero(heroI); later(cycle, 3400); }

  // ---------- élő számok ----------
  function plural(n, one) { return n + ' ' + one; }
  function renderLive(d) {
    const box = $m('.mm-live-txt'); if (!box) return;
    if (!d) { box.textContent = 'a terem nyitva'; return; }
    const parts = [];
    if (d.playing) parts.push(plural(d.playing, 'tárgyalás folyik'));
    if (d.lobbies) parts.push(plural(d.lobbies, 'szoba gyülekezik'));
    if (d.players) parts.push(plural(d.players, 'gyanúsított a teremben'));
    box.textContent = parts.length ? parts.join(' · ') : 'a terem üres – te lehetsz az első vádlott!';
  }
  function pollLive() {
    fetch('/api/live', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(renderLive).catch(() => renderLive(null));
  }

  // ---------- hírszalag ----------
  function pushNews() {
    const el = $m('.mm-news-txt'); if (!el) return;
    const name = (typeof MY !== 'undefined' && MY.name ? MY.name.replace(/\s*\[[^\]]+\]\s*/, '').trim() : '') || 'Egy ismeretlen tettes';
    const list = typeof TICKER_TEMPLATES !== 'undefined' && TICKER_TEMPLATES.length ? TICKER_TEMPLATES : ['[N] tagad mindent'];
    el.style.animation = 'none';
    el.textContent = list[Math.floor(Math.random() * list.length)].replace(/^RENDKÍVÜLI:\s*/, '').replaceAll('[N]', name);
    void el.offsetWidth; el.style.animation = '';
  }

  // ---------- 3D-dőlés + csillanás (egérrel) ----------
  const fine = () => { try { return matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (_) { return false; } };
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || reduced() || !fine()) return;
    const card = e.target.closest && e.target.closest('.mm-card'); if (!card) return;
    const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--ry', ((x - 0.5) * 10).toFixed(2) + 'deg');
    card.style.setProperty('--rx', ((0.5 - y) * 8).toFixed(2) + 'deg');
    card.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); card.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
    card.classList.add('tilt');
  });
  root.addEventListener('pointerout', (e) => {
    const card = e.target.closest && e.target.closest('.mm-card');
    if (card && !card.contains(e.relatedTarget)) { card.classList.remove('tilt'); card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }
  });

  // ---------- meghívókód: kész a 4 betű → a gomb kiemelve; Enter = belépés ----------
  const code = document.getElementById('codeInput'), join = document.getElementById('btnJoin');
  if (code && join) {
    const sync = () => { const v = code.value.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, 4); if (v !== code.value) code.value = v; join.classList.toggle('ready', v.length === 4); };
    code.addEventListener('input', sync);
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter' && code.value.trim().length === 4) { e.preventDefault(); join.click(); } });
  }

  // ---------- belépés / kilépés a menübe ----------
  function enter() {
    stop();
    heroI = 0;
    root.querySelectorAll('.mm-hero').forEach((im) => im.classList.remove('on'));
    showHero(0, true);
    pushNews(); newsTimer = setInterval(pushNews, 16000);
    pollLive(); liveTimer = setInterval(pollLive, 20000);
    if (!reduced()) {
      root.classList.remove('mm-enter'); void root.offsetWidth; root.classList.add('mm-enter');
      later(() => { root.classList.add('mm-thud'); try { if (window.kbSound && window.kbSound.play) window.kbSound.play('gavel'); } catch (_) { /* */ } }, 700); // a lehulló cím (0,15 + 0,55 mp) ekkor ér le
      later(() => root.classList.remove('mm-thud'), 1100);
      later(() => root.classList.remove('mm-enter'), 2000);
      later(cycle, 3600);
    }
  }
  function stop() {
    for (const t of timers) clearTimeout(t); timers = [];
    clearInterval(liveTimer); clearInterval(newsTimer); liveTimer = newsTimer = 0;
    root.classList.remove('mm-enter', 'mm-thud');
  }
  // csak valódi belépéskor (a show('menu') hibánál – pl. rossz kód – újra jelez, ilyenkor nem játsszuk újra a belépőt)
  let current = document.body.dataset.screen || '';
  document.addEventListener('kb:screen', (e) => {
    const prev = current; current = e.detail;
    if (e.detail === 'menu') { if (prev !== 'menu') enter(); } else if (prev === 'menu') stop();
  });
  if (document.body.dataset.screen === 'menu') enter();
  window.kbMenu = { enter, stop, live: pollLive, state: () => ({ hero: ROLES[heroI].role, entering: root.classList.contains('mm-enter') }) };
})();
