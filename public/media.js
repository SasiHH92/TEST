'use strict';

// ============================================================
// KAMU BÍRÓSÁG – opcionális média: bejelentkező-oldali videó-háttér + hangfájlok (a szintetizált hangok tartaléka mellett)
//
// A szerver a GET /api/media címen megmondja, melyik opcionális fájl van ténylegesen feltöltve (assets/video/, assets/audio/). Ez a modul CSAK azt tölti be,
// ami megvan: nincs 404-zaj, nincs törött elem. Fájl nélkül minden a régi módon megy (statikus háttér, szintetizált hang).
//
// 1) LOGIN VIDEÓ (assets/video/login-loop.webm | .mp4, mobilra: login-loop-mobile.webm | .mp4, állókép: login-poster.webp):
//    autoplay, muted, loop, playsinline, object-fit: cover; a login-űrlap HTML/CSS marad, a videó fölött finom vignetta. Statikus háttérre esik vissza, ha:
//    nincs fájl · csökkentett mozgás · adattakarékos / 2G kapcsolat · keskeny (≤ 700 px) képernyő mobil-fájl nélkül · a videó hibázik / 6 mp alatt nem indul ·
//    a lap rejtett (a videó megáll, az akkut nem meríti). A videó csak a belépőoldalon létezik: elhagyáskor leáll és eltávolítódik (nincs memória-szivárgás).
// 2) HANGFÁJLOK (assets/audio/<hang-név>.mp3 | .ogg | .m4a | .wav): a kbSound.play(név) először ide néz; ha a fájl megvan, azt játssza (HTMLAudio, a mester-hangerővel),
//    különben a szintetizált hang szól. A nevek és a kategóriák: assets/audio/README.md.
// ============================================================
(() => {
  const state = { loaded: false, video: {}, audio: {}, v: '', pending: [] };
  const AUDIO_EXT = ['ogg', 'mp3', 'm4a', 'wav'];
  const reduced = () => document.body.classList.contains('reduced-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cfg = () => window.kbCourtConfig || {};

  // ---- hang-kategóriák (a hook-nevek csoportosítása; a dokumentáció és a teszt is ebből dolgozik) ----
  const CATEGORIES = {
    ui: ['ui-click', 'ready', 'join'],
    card: ['card-hover', 'card-select', 'card-open', 'card-new', 'card-play'],
    paper: ['paper', 'evidence'],
    challenge: ['challenge', 'challenge-success', 'challenge-fail'],
    reaction: ['reaction', 'objection', 'vote'],
    stinger: ['stinger', 'reveal', 'intro', 'intro-open', 'countdown', 'ding'],
    gavel: ['gavel'],
    verdict: ['verdict-guilty', 'verdict-acquitted'],
    score: ['points', 'score'],
    victory: ['victory']
  };
  const categoryOf = (name) => { for (const [cat, list] of Object.entries(CATEGORIES)) if (list.includes(name)) return cat; return ''; };

  // ---- /api/media ----
  const ready = fetch('/api/media', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d && typeof d === 'object') { state.video = d.video || {}; state.audio = d.audio || {}; state.v = typeof d.v === 'string' ? d.v : ''; }
  }).catch(() => {}).then(() => { state.loaded = true; syncVideo(); });

  // ---- 1) login videó ----
  let video = null, videoFailed = false, stallTimer = 0;
  const q = (name) => '/assets/video/' + name + (state.v ? '?v=' + encodeURIComponent(state.v) : '');
  const has = (kind, base) => Object.keys(state[kind]).some((n) => n === base || n.startsWith(base + '.'));
  function pickSources() {
    const narrow = window.matchMedia && matchMedia('(max-width: 700px)').matches;
    const bases = narrow ? ['login-loop-mobile'] : ['login-loop'];
    if (narrow && cfg().loginVideoMobile) bases.push('login-loop');
    const out = [];
    for (const base of bases) for (const [ext, type] of [['webm', 'video/webm'], ['mp4', 'video/mp4']]) if (state.video[base + '.' + ext]) out.push({ src: q(base + '.' + ext), type });
    return out;
  }
  const saveData = () => { const c = navigator.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(String(c.effectiveType || '')))); };
  const onAuth = () => document.body.dataset.screen === 'auth' || !document.body.dataset.screen;
  function dropVideo(reason) {
    clearTimeout(stallTimer);
    if (video) { try { video.pause(); video.removeAttribute('src'); video.querySelectorAll('source').forEach((s) => s.remove()); video.load(); } catch (_) { /* nincs mit */ } video.remove(); }
    video = null;
    document.documentElement.classList.remove('auth-video-on');
    if (reason === 'error') { videoFailed = true; document.documentElement.classList.add('auth-video-off'); }
    document.dispatchEvent(new CustomEvent('kb:login-video', { detail: reason || 'off' }));
  }
  function syncVideo() {
    if (!state.loaded) return;
    const screen = $one('#screen-auth');
    if (!screen) return;
    const wanted = onAuth() && !videoFailed && !reduced() && !saveData() && document.visibilityState === 'visible';
    if (!wanted) { if (video) dropVideo('off'); return; }
    if (video) { if (video.paused) video.play().catch(() => {}); return; }
    const sources = pickSources();
    if (!sources.length) return;
    video = document.createElement('video');
    video.className = 'auth-video';
    video.muted = true; video.defaultMuted = true; video.loop = true; video.autoplay = true; video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1; video.disablePictureInPicture = true;
    const still = screen.querySelector('.auth-background');
    video.poster = state.video['login-poster.webp'] ? q('login-poster.webp') : (still ? still.getAttribute('src') : '');
    for (const s of sources) { const el = document.createElement('source'); el.src = s.src; el.type = s.type; video.appendChild(el); }
    video.addEventListener('error', () => dropVideo('error'), true); // a <source> hibája nem buborékol, de a capture-fázisban látszik
    video.addEventListener('playing', () => { clearTimeout(stallTimer); video.classList.add('ready'); document.documentElement.classList.add('auth-video-on'); document.dispatchEvent(new CustomEvent('kb:login-video', { detail: 'playing' })); }, { once: true });
    stallTimer = setTimeout(() => { if (video && !video.classList.contains('ready')) dropVideo('error'); }, 6000); // lassú / elakadt betöltés → statikus háttér
    if (still) still.after(video); else screen.prepend(video);
    video.play().catch(() => { /* a 'playing' vagy a stall-időzítő dönt */ });
  }
  function $one(sel) { return document.querySelector(sel); }
  document.addEventListener('kb:screen', syncVideo);
  document.addEventListener('visibilitychange', syncVideo);
  if (window.matchMedia) { try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', syncVideo); } catch (_) { /* régi böngésző */ } }

  // ---- 2) hangfájlok ----
  const pool = new Map(); // név -> Audio (újrahasználva: nincs fölösleges objektum / szivárgás)
  function fileFor(name) {
    for (const ext of AUDIO_EXT) { const f = name + '.' + ext; if (state.audio[f]) return '/assets/audio/' + f + (state.v ? '?v=' + encodeURIComponent(state.v) : ''); }
    return '';
  }
  const hasSound = (name) => !!fileFor(name);
  function playSound(name, volume) {
    const url = fileFor(name);
    if (!url || !(volume > 0)) return false;
    try {
      let a = pool.get(name);
      if (!a) { a = new Audio(url); a.preload = 'auto'; pool.set(name, a); }
      a.volume = Math.max(0, Math.min(1, volume));
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => { /* a böngésző az első érintésig letilthatja: nem hiba */ });
      return true;
    } catch (_) { return false; }
  }

  window.kbMedia = {
    ready, state: () => ({ loaded: state.loaded, video: Object.keys(state.video), audio: Object.keys(state.audio), v: state.v }),
    CATEGORIES, categoryOf, hasSound, playSound, loginVideoActive: () => !!video && video.classList.contains('ready'), syncVideo,
    hooks: () => Object.values(CATEGORIES).flat()
  };
})();
