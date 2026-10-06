'use strict';

// ============================================================
// KAMU BÍRÓSÁG – kliens
// ============================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const socket = io();
const LS = window.localStorage;
let INTENTIONAL_LEAVE = sessionStorage.getItem('kb_left') === '1';
if (INTENTIONAL_LEAVE) {
  LS.removeItem('kb_code');
  LS.removeItem('kb_playerId');
  LS.removeItem('kb_sessionToken');
}

let MY = {
  playerId: LS.getItem('kb_playerId') || null,
  sessionToken: LS.getItem('kb_sessionToken') || null,
  name: LS.getItem('kb_name') || '',
  avatar: LS.getItem('kb_avatar') || null,
  code: LS.getItem('kb_code') || null,
  appearances: ['bírói kalap', 'paróka', 'rabruha', 'napszemüveg']
};
// A belépőoldal engedi tovább a fiókot vagy a vendéget a karakterválasztóhoz.
let IDENTITY_READY = false;

let S = null; // utolsó state (nekem szóló)
let serverOffset = 0; // szerveróra korrekció
let timerInterval = null;
let drumrollInterval = null;
let muted = LS.getItem('kb_muted') === '1';
let volume = parseInt(LS.getItem('kb_volume') || '70', 10);

// ============================================================
// HANGEFFEKTEK (WebAudio – nincs külső fájl)
// ============================================================

let actx = null;
function ensureAudio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { /* nincs hang */ }
  }
  if (actx && actx.state === 'suspended') actx.resume();
}

function vol() { return muted ? 0 : volume / 100; }

function tone(freq, dur, type = 'sine', when = 0, gain = 0.5, slideTo = null) {
  if (!actx || vol() === 0) return;
  const t0 = actx.currentTime + when;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(gain * vol(), t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(actx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noiseBurst(dur, when = 0, gain = 0.4, filterFreq = 1000) {
  if (!actx || vol() === 0) return;
  const t0 = actx.currentTime + when;
  const len = Math.max(1, Math.floor(actx.sampleRate * dur));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource();
  src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filterFreq;
  const g = actx.createGain();
  g.gain.setValueAtTime(gain * vol(), t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(actx.destination);
  src.start(t0);
}

const SFX = {
  gavel() {
    noiseBurst(0.12, 0, 0.9, 400);
    tone(90, 0.15, 'sine', 0, 0.9, 50);
    noiseBurst(0.12, 0.28, 0.9, 400);
    tone(80, 0.18, 'sine', 0.28, 0.9, 45);
  },
  objection() {
    tone(220, 0.28, 'sawtooth', 0, 0.5, 110);
    tone(165, 0.5, 'sawtooth', 0.3, 0.55, 82);
  },
  accepted() {
    tone(660, 0.15, 'triangle', 0, 0.5);
    tone(880, 0.3, 'triangle', 0.15, 0.5);
  },
  rejected() {
    tone(180, 0.35, 'sawtooth', 0, 0.5, 90);
  },
  reaction(i) {
    tone(500 + i * 120, 0.12, 'sine', 0, 0.35, 700 + i * 120);
  },
  drumTick() {
    noiseBurst(0.03, 0, 0.25, 3000);
  },
  applause() {
    for (let i = 0; i < 24; i++) {
      noiseBurst(0.03, Math.random() * 1.6, 0.15 + Math.random() * 0.2, 1800 + Math.random() * 2000);
    }
  },
  whisper() {
    noiseBurst(0.7, 0, 0.12, 5000);
    noiseBurst(0.5, 0.75, 0.1, 4000);
  },
  ding() {
    tone(1200, 0.4, 'sine', 0, 0.4);
    tone(1800, 0.5, 'sine', 0.05, 0.25);
  },
  fanfare() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => tone(n, 0.35, 'triangle', i * 0.16, 0.4));
  }
};

function startDrumroll() {
  stopDrumroll();
  drumrollInterval = setInterval(() => SFX.drumTick(), 90);
}
function stopDrumroll() {
  if (drumrollInterval) { clearInterval(drumrollInterval); drumrollInterval = null; }
}

// ============================================================
// SEGÉDEK
// ============================================================

function show(screen) {
  $$('.screen').forEach((el) => el.classList.remove('active'));
  $('#screen-' + screen).classList.add('active');
  document.body.classList.toggle('in-game', screen === 'game');
  document.body.dataset.screen = screen;
  if (screen === 'menu') renderMenuWho();
  document.dispatchEvent(new CustomEvent('kb:screen', {detail:screen}));
}

// "Belépsz mint" sáv a menüben: a választott karakter avatárja, neve és címe.
function renderMenuWho() {
  const box = $('#menuWho');
  if (!box) return;
  if (!MY.name) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const reg = REGISTRY.find((r) => r.nev === MY.name);
  const title = (CHOSEN && CHOSEN.titulus) || (reg && reg.titulus) || 'Ismeretlen tettes';
  const name = MY.name.replace(/\s*\[[^\]]+\]\s*/, '').trim();
  const mono = AVATARS.includes(MY.avatar)
    ? '<span class="mug-mono mug-avatar mw-av"><img src="' + avatarSrc(MY.avatar) + '" alt=""></span>'
    : '<span class="mug-mono mw-av" style="background:hsl(' + nameHue(name) + ',62%,44%)">' + escapeHtml((name[0] || '?').toUpperCase()) + '</span>';
  box.innerHTML = mono + '<span class="mw-text"><small>BELÉPSZ MINT</small><b>' + escapeHtml(name) + '</b><i>' + escapeHtml(title) + '</i></span>';
  box.classList.remove('hidden');
}

// ============================================================
// KILÉPÉS / VISSZA + megerősítés
// ============================================================

// Saját, stílusos megerősítő ablak (natív confirm helyett).
function confirmDialog(message, okLabel, noLabel) {
  return new Promise((resolve) => {
    let m = document.getElementById('confirmModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'confirmModal';
      m.className = 'confirm-modal';
      m.innerHTML = '<div class="confirm-panel">' +
        '<div class="confirm-stamp">⚖️</div>' +
        '<div class="confirm-text"></div>' +
        '<div class="confirm-actions"><button class="btn big" id="cfOk">KILÉPÉS</button>' +
        '<button class="btn big ghost" id="cfNo">MÉGSE</button></div></div>';
      document.body.appendChild(m);
    }
    m.querySelector('.confirm-text').textContent = message;
    const okB = m.querySelector('#cfOk');
    const noB = m.querySelector('#cfNo');
    okB.textContent = okLabel || 'KILÉPÉS';
    noB.textContent = noLabel || 'MÉGSE';
    m.classList.add('visible');
    const done = (val) => {
      m.classList.remove('visible');
      okB.onclick = null;
      noB.onclick = null;
      resolve(val);
    };
    okB.onclick = () => done(true);
    noB.onclick = () => done(false);
  });
}

function leaveToMenu() {
  INTENTIONAL_LEAVE = true;
  sessionStorage.setItem('kb_left', '1');
  socket.emit('leave_room');
  MY.code = null;
  MY.playerId = null;
  MY.sessionToken = null;
  LS.removeItem('kb_sessionToken');
  LS.removeItem('kb_code');
  LS.removeItem('kb_playerId');
  clearTimeout(rejoinTimer);
  clearInterval(timerInterval);
  timerInterval = null;
  clearInterval(goneTimerInterval);
  goneTimerInterval = null;
  stopDrumroll();
  S = null;
  charAnim.prune(new Set());
  charAnim.stopLoop();
  cancelChargeIntro();
  lastSceneRoles=null;lastCharge=null;chargeCaseKey='';
  $('#objectionOverlay').classList.add('hidden');
  $('#unanimousOverlay').classList.add('hidden');
  hideConnBar();
  renderLobby._lastNotice = null;
  stopTicker();
  show('menu');
}

// Böngésző VISSZA gomb: játék/lobby közben ne dobjon ki hirtelen –
// megerősítést kér; visszadobjuk a történetet, így a játék bent marad.
window.addEventListener('popstate', () => {
  const inRoom = !!MY.code;
  if (!inRoom) return;
  history.pushState({ kbGuard: true }, '', location.href);
});

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0');
}

function me() {
  return S && S.players.find((p) => p.id === MY.playerId);
}

function myRole() {
  if (!S) return 'juror';
  if (S.phase !== 'lobby' && S.currentJudgeId === MY.playerId) return 'judge';
  if (S.defendantId === MY.playerId) return 'defendant';
  if (S.prosecutorId === MY.playerId) return 'prosecutor';
  if (S.defenderId === MY.playerId) return 'defender';
  if (S.witnessId === MY.playerId) return 'witness';
  return 'juror';
}

function playerById(id) {
  return S ? (S.players.find((p) => p.id === id) || (S.departedPlayers || []).find((p) => p.id === id)) : null;
}

function nameOf(id) {
  const p = playerById(id);
  return p ? p.name : '?';
}

function avatarOf(id) {
  const p = playerById(id);
  return p ? p.avatar : '';
}

const AVATAR_EMOJI = {
  'bírói kalap': '🧑‍⚖️', 'paróka': '👱', 'rabruha': '🧑‍🦱', 'napszemüveg': '🕶️',
  'feltűnő csokornyakkendő': '🎀', 'birkajelmez': '🐑', 'pókaszapityó': '🎩', 'ünnepi kalap': '🎉'
};
// Képes avatárok: "av01" … "av50" -> /assets/avatars/avatar_01.webp
const AVATAR_COUNT = 50;
const AVATARS = Array.from({ length: AVATAR_COUNT }, (_, i) => 'av' + String(i + 1).padStart(2, '0'));
const AVATAR_ID_RE = /^av\d\d$/;

function avatarSrc(a) {
  return '/assets/avatars/avatar_' + a.slice(2) + '.webp';
}

function avatarEmoji(a) {
  if (AVATAR_ID_RE.test(a || '')) return '<img class="av-img" src="' + avatarSrc(a) + '" alt="" loading="lazy">';
  return AVATAR_EMOJI[a] || '🎭';
}

// ---- szerepek: színek, rajzok, rövid nevek ----
const ROLE_COLOR = {
  prosecutor: '#e5484d', // ügyész – piros
  defendant: '#f5a524',  // vádlott – borostyán
  defender: '#3b82f6',   // védőügyvéd – kék
  witness: '#22c55e',    // tanú – zöld
  juror: '#a78bfa',      // esküdtek – lila
  judge: '#f2c14e'
};
const ROLE_IMG = {
  prosecutor: '/assets/ugyesz.png',
  defendant: '/assets/vadlott.png',
  defender: '/assets/vedougyved.png',
  witness: '/assets/tanu.png',
  juror: '/assets/eskudt1.png',
  judge: '/assets/biro.png'
};
const CHAR_IMAGES = new Map();
function preloadCharacterImages() {
  const paths = [...Object.values(ROLE_IMG),
    '/assets/eskudt2.png','/assets/eskudt3.png','/assets/targyalotterem.jpg'];
  for (const path of paths) {
    if (CHAR_IMAGES.has(path)) continue;
    const image = new Image();
    image.src = path;
    CHAR_IMAGES.set(path, image);
  }
}

function characterFigure(role, pid, jurorIndex=0) {
  const p = playerById(pid);
  // Aki választott avatárt, annak az avatárja áll a színpadon; a fix figura csak tartalék.
  const hasAv = !!p && AVATAR_ID_RE.test(p.avatar || '');
  const base = hasAv ? avatarSrc(p.avatar) : (role === 'juror' ? '/assets/eskudt' + (jurorIndex % 3 + 1) + '.png' : ROLE_IMG[role]);
  return '<div class="st-fig"><div class="st-art' + (hasAv ? ' av-figure' : '') + '"><img class="st-base" src="' + base + '" alt="' + roleLabel(role) + '">' +
    '<div class="st-fallback"><span>' + (p ? avatarEmoji(p.avatar) : '⚖️') + '</span><small>' + escapeHtml(p?.name || roleLabel(role)) + '</small></div></div></div>';
}

function bindCharacterFallback(slot) {
  const base=slot.querySelector('.st-base');
  if (!base || base.dataset.bound) return;
  base.dataset.bound='1';
  const update=()=>slot.classList.toggle('asset-missing',!base.naturalWidth);
  base.addEventListener('load',update,{once:true});
  base.addEventListener('error',update,{once:true});
  if(base.complete) update();
}

// Karakteranimációs rendszer
// Egyetlen requestAnimationFrame-ciklus hajtja; egyszerre legfeljebb
// MAX_ANIMATED karakter mozog (a beszélő, a bíró, egy reagáló esküdt).
// A többiek csak lassan lélegeznek. Beszélőképek nélkül a belső figurát
// mozgatjuk; a szerep kiemelését külön CSS-réteg adja.
const MAX_ANIMATED = 3;
const JUDGE_KEY = '__judge__'; // a teremben ülő bíró (nem a színpadi slotok között van)

const charAnim = {
  active: new Map(), // pid -> animációs állapot
  reducedMotion: LS.getItem('kb_reducedMotion') === '1',
  ticking: false,

  // Példány (színpadi slot vagy a bíró) regisztrálása az animációhoz.
  register(key, slotEl, role) {
    if (!slotEl) return null;
    let anim = this.active.get(key);
    if (!anim) {
      anim = {
        key: key,
        slot: null,
        fig: null,          // a BELSŐ réteg mozog; a slot CSS-nagyítása megmarad
        role: role,
        speaking: false,
        judgeUntil: 0,      // bírói szöveg/buborék: meddig bólogat
        reactUntil: 0,      // reakció: 0,8 mp
        popUntil: 0,        // tiltakozási "pattanás": 1,2 mp
        popDuration: 450,
        shakeUntil: 0,      // kalapácsütés
        shakeStart: 0,
        nodPhase: Math.random() * Math.PI * 2,
        nodMs: 600 + Math.random() * 300,   // 600-900 ms-os hullám
        nodAmp: 2 + Math.random(),          // 2-3 px
        breathPhase: Math.random() * Math.PI * 2,
        breathMs: 3000 + Math.random() * 1000, // 3-4 mp, véletlenszerű fázissal
        breathAmp: 0.015,
        lastTransform: ''
      };
      this.active.set(key, anim);
    }
    anim.role = role || anim.role;
    // A slot újrarajzolódhat (fázisváltás) → a DOM-elemeket mindig frissítsük.
    if (anim.slot !== slotEl) {
      anim.slot = slotEl;
      anim.fig = slotEl.querySelector('.st-fig');
      anim.lastTransform = '';
    }
    return anim;
  },

  // Színpadi slot regisztrálása (renderStage hívja).
  init(slotEl, pid, role) {
    if (!slotEl || !pid) return null;
    return this.register(pid, slotEl, role);
  },

  // Szereplő beszél: felpattanás, bólogatás és beszéd-pulzálás.
  setSpeaking(key, isSpeaking) {
    const anim = this.active.get(key);
    if (!anim || anim.speaking === isSpeaking) return;
    anim.speaking = isSpeaking;
    if (isSpeaking) {
      anim.popUntil = performance.now() + 450;
      anim.popDuration = 450;
    }
  },

  // Reakció (esküdt emoji): 0,8 mp-es buborék a feje fölött.
  react(key, emoji) {
    const anim = this.active.get(key === S?.currentJudgeId ? JUDGE_KEY : key);
    if (!anim) return;
    anim.reactUntil = performance.now() + 800;
    this._popBubble(anim, emoji);
  },

  // Bírói üzenet: bólogatás a buborék megjelenésekor.
  judgeSpeak(duration = 2500) {
    const anim = this.active.get(JUDGE_KEY);
    if (!anim) return;
    anim.judgeUntil = performance.now() + duration;
  },

  // Kalapácsütés: 4 gyors rázkódás, legfeljebb 4 px-rel.
  judgeShake() {
    const anim = this.active.get(JUDGE_KEY);
    if (!anim) return;
    const now = performance.now();
    anim.shakeUntil = now + 600;
    anim.shakeStart = now;
    anim.judgeUntil = Math.max(anim.judgeUntil, now + 900);
  },

  // Tiltakozás: a tiltakozó röviden felpattan.
  objectionPopup(key) {
    const anim = this.active.get(key);
    if (!anim) return;
    anim.popUntil = performance.now() + 1200;
    anim.popDuration = 1200;
  },

  // Animáció leállítása (kijelentkezés / színpadról lekerülés)
  stop(key) {
    const anim = this.active.get(key);
    if (anim && anim.fig) {
      this._setTransform(anim, '');
      const bub = anim.slot && anim.slot.querySelector('.char-bubble');
      if (bub) { bub.textContent = ''; bub.classList.remove('show'); }
    }
    this.active.delete(key);
  },

  // A színpad újrarajzolása után az eltűnt karakterek leállítása (memória/performancia)
  prune(liveKeys) {
    for (const key of Array.from(this.active.keys())) {
      if (!liveKeys.has(key)) this.stop(key);
    }
  },

  // A kapcsoló és az operációs rendszer beállítása minden mozgást kikapcsol.
  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
    LS.setItem('kb_reducedMotion', reduced ? '1' : '0');
    for (const anim of this.active.values()) this._setTransform(anim, '');
    updateReduceMotionBtn();
  },

  // ---- belső segédek ----

  _popBubble(anim, emoji) {
    const slot = anim.slot;
    if (!slot || !emoji) return;
    let b = slot.querySelector('.char-bubble');
    if (!b) {
      b = document.createElement('div');
      b.className = 'char-bubble';
      slot.appendChild(b);
    }
    b.textContent = emoji;
    // újraindítás (a 0,8 mp-es ablakban marad, a class az eltávolításig él)
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  },
  _setTransform(anim, value) {
    if (anim.lastTransform === value) return;   // csak változáskor írunk DOM-ot
    anim.lastTransform = value;
    if (anim.fig) anim.fig.style.transform = value;
  },

  // ---- a ciklus ----

  start() {
    if (this.ticking) return;
    this.ticking = true;
    this._raf = requestAnimationFrame((t) => this._loop(t));
  },
  stopLoop() { this.ticking = false;cancelAnimationFrame(this._raf); },

  _loop(t) {
    if (!this.ticking) return;
    this._raf = requestAnimationFrame((tt) => this._loop(tt));

    // 1) Ki kell választani, ki mozog: a beszélő, a bíró és legfeljebb
    //    egy reagáló esküdt (teljesítmény-büdzsé).
    const movers = [];
    let reacting = null;
    for (const anim of this.active.values()) {
      if (anim.speaking || anim.judgeUntil > t || anim.popUntil > t) movers.push(anim);
      if (anim.reactUntil > t && !reacting) reacting = anim;
    }
    if (reacting && !movers.includes(reacting)) movers.push(reacting);
    movers.sort((a, b) => (a === reacting ? 1 : 0) - (b === reacting ? 1 : 0));
    const live = new Set(movers.slice(0, MAX_ANIMATED));

    for (const anim of this.active.values()) {
      const isLive = live.has(anim);
      const speaking = anim.speaking || anim.judgeUntil > t;

      const reduced = this.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;

      // --- reakció buborék lezárása ---
      if (anim.reactUntil && t > anim.reactUntil) {
        anim.reactUntil = 0;
        const bub = anim.slot && anim.slot.querySelector('.char-bubble');
        if (bub) bub.classList.remove('show');
      }

      // --- mozgás összeállítása (a BELSŐ figurára, hogy a slot
      //     translateX(-50%) és a beszélő 1,2x nagyítása megőrződjön) ---
      const shaking = anim.shakeUntil > t;
      const popping = anim.popUntil > t;
      if (reduced) {this._setTransform(anim,'');continue;}

      if (shaking) {
        // 3-4 gyors elmozdulás 4 px-rel, csillapodva
        const el = t - anim.shakeStart;
        const amp = 4 * (1 - el / 600);
        const x = Math.sin((el / 600) * Math.PI * 2 * 4) * amp;
        this._setTransform(anim, 'translateX(' + x.toFixed(2) + 'px)');
        continue;
      }
      if (!isLive) {
        this._breath(anim, t);
        continue;
      }
      if (popping) {
        // gyors nagyítás és vissza (1,2 mp)
        const p = Math.max(0,Math.min(1, (t - (anim.popUntil - anim.popDuration)) / anim.popDuration));
        const k = Math.sin(p * Math.PI);
        this._setTransform(anim, 'translateY(' + (-k*4).toFixed(2) + 'px)');
        continue;
      }
      if (speaking) {
        // lassú bólogatás: 2-3 px függőleges hullám
        const y = -Math.abs(Math.sin((anim.nodPhase + (t / anim.nodMs) * Math.PI * 2))) * anim.nodAmp;
        const tilt = Math.sin(anim.nodPhase + t / 650) * 1.5;
        const pulse = 1 + Math.sin(t / 450 * Math.PI * 2) * .012;
        this._setTransform(anim, 'translateY(' + y.toFixed(2) + 'px) rotate(' + tilt.toFixed(2) + 'deg) scale(' + pulse.toFixed(4) + ')');
        continue;
      }
      this._breath(anim, t);
    }
  },

  // Nem beszélő szereplők nagyon lassú, 1-2%-os lélegzése (véletlenszerű fázissal)
  _breath(anim, t) {
    const s = Math.sin((anim.breathPhase + (t / anim.breathMs) * Math.PI * 2));
    const k = 1 + s * anim.breathAmp;
    this._setTransform(anim, 'scale(' + k.toFixed(4) + ')');
  }
};

function updateReduceMotionBtn() {
  const b = document.getElementById('btnReduceMotion');
  if (!b) return;
  const on = charAnim.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.toggle('reduced-motion',on);
  const charge=document.getElementById('accusationTicker');
  if(on && charge?.classList.contains('charge-intro') && lastCharge) {
    cancelChargeIntro();
    charge.classList.remove('charge-intro');
    charge.querySelector('.charge-text').innerHTML=chargeMarkup(lastCharge.text,lastCharge.name);
    scheduleSceneLayout();
  }
  b.textContent = on ? '🐢 Mozgás: CSÖKKENT' : '🏃 Mozgás: TELJES';
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
// TELJES szerepnevek: ponttábla, színpad, fázis-sáv, jegyzőkönyv – kiérthető címkék.
const ROLE_LABEL = {
  prosecutor: 'ÜGYÉSZ',
  defendant: 'VÁDLOTT',
  defender: 'VÉDŐ',
  witness: 'TANÚ',
  juror: 'ESKÜDT',
  judge: 'BÍRÓ'
};
const WHO_LABEL = { prosecutor: 'Az ügyész', defendant: 'A vádlott', defender: 'A védőügyvéd' };

function roleLabel(role) { return ROLE_LABEL[role] || 'ESKÜDT'; }
function roleColorOf(role) { return ROLE_COLOR[role] || '#f2c14e'; }
// Rövid szerepnevek a mobil felső sávjához (a színpad alján).
const SP_LABEL = { prosecutor: 'Ügyész', defendant: 'Vádlott', defender: 'Védő', witness: 'Tanú' };
// Színpadi helyek a kész tárgyalóteremhez igazítva (% a színpadon).
// x: vízszintes közép, b: alsó él (alulról %), h: magasság, z: réteg.
// A horgonyok a háttér eredeti képének százalékai; a cover-vágást vetítjük.
const STAGE_POS = {
  judge:      { x:49, y:45.5, h:22, z:3, plate:39 },
  prosecutor: { x:14, y:73, h:30, z:6, plate:60 },
  defendant:  { x:50, y:73, h:38, z:7, plate:72 },
  defender:   { x:64, y:77, h:30, z:6, plate:70 },
  witness:    { x:70, y:73, h:27, z:8, plate:75 },
  juror:      { x:82, y:65, h:16, z:4, plate:66 }
};
const JUROR_X = [82,86,90,94];
const ROOM_SIZE = {width:1672,height:602};
const ROOM_FURNITURE = [
  {x:542,y:222,w:494,h:130}, // bírói pulpitus előlapja
  {x:0,y:354,w:445,h:174},   // bal oldali asztal
  {x:555,y:423,w:610,h:179}, // elülső asztal
  {x:1290,y:354,w:382,h:160} // esküdtpad előlapja
];
let lastSceneRoles = null;
let sceneLayoutRaf = 0;
function sceneGeometry() {
  const stage = $('#stage');
  const width = stage.clientWidth || innerWidth;
  const height = stage.clientHeight || innerHeight;
  const mobile = width <= 700;
  const rail = width > 900 ? 280 : 0;
  const scale = Math.max(width / ROOM_SIZE.width,height / ROOM_SIZE.height);
  const imageWidth = ROOM_SIZE.width * scale;
  const imageHeight = ROOM_SIZE.height * scale;
  return {width,height,mobile,usable:width-rail,scale,imageWidth,imageHeight,
    offsetX:(width-imageWidth)*.5,offsetY:(height-imageHeight)*(mobile?.60:.55)};
}
function projectScenePoint(x,y,g) {
  return {x:g.offsetX+g.imageWidth*x/100,y:g.offsetY+g.imageHeight*y/100};
}
function scenePosition(role,index,g) {
  const p = STAGE_POS[role];
  const q = projectScenePoint(role==='juror'?JUROR_X[index]:p.x,p.y,g);
  const margin = Math.max(42,g.height*p.h/100*.4)+12;
  let x=Math.max(margin,Math.min(g.usable-margin,q.x));
  let y=q.y, h=p.h;
  let plate=projectScenePoint(p.x,p.plate,g).y;
  if(role==='defender' && !g.mobile) {
    // A védő és a tanú ne csússzon egymásra, ha a háttér vágása miatt kevés a hely: a védő balra tolódik.
    const w=STAGE_POS.witness, wq=projectScenePoint(w.x,w.y,g);
    const wm=Math.max(42,g.height*w.h/100*.4)+12, wx=Math.max(wm,Math.min(g.usable-wm,wq.x));
    const gap=(g.height*(p.h+w.h)*.56/100*2/3)/2+10;
    x=Math.max(margin,Math.min(x,wx-gap));
  }
  if(role==='juror' && !g.mobile) {
    // Hátsó sor: az esküdtek a tanú feje fölött állnak (balra sorakozva), így sosem esnek a védő/tanú mögé.
    // (Széles képernyőn a háttér vágása miatt a régi, a szélességhez viszonyított hely ütközött velük.)
    const w=scenePosition('witness',0,g);
    const jh=g.height*p.h/100, jw=jh*2/3;
    x=Math.max(margin,Math.min(g.usable-margin,w.x/100*g.width-index*(jw+10)));
    y=g.height*(1-(w.b+w.h)/100)-6;
    plate=y+5;
  } else if(role==='juror') {
    plate=y+5;
  }
  if(g.mobile) {
    // Telefonon az avatár-keretek szélesek: a négy fő szereplő egymás mellett, kisebben,
    // az esküdtek hátul, a tanú feje fölött (így nem takarják a védőt és a tanút).
    const m={judge:[.49,.46,16,.425],prosecutor:[.115,.54,16,.545],
      defendant:[.395,.60,21,.575],defender:[.655,.545,15.5,.54],
      witness:[.865,.52,14,.50],juror:[.905-index*.125,.365-index*.03,9,.375-index*.03]};
    const v=m[role]; x=g.usable*v[0];y=g.height*v[1];h=v[2];plate=g.height*v[3];
    const edge=h/100*g.height*.4+8;
    x=Math.max(edge,Math.min(g.usable-edge,x));
  }
  return {x:100*x/g.width,b:100*(g.height-y)/g.height,h,z:p.z,plate:100*plate/g.height};
}
function renderFurniture(g) {
  const layer=$('#sceneFurniture');
  if(!layer.children.length) layer.innerHTML=ROOM_FURNITURE.map(()=>'<div class="room-occluder"><img src="/assets/targyalotterem.jpg" alt=""></div>').join('');
  [...layer.children].forEach((el,i)=>{
    const f=ROOM_FURNITURE[i];
    const x=g.offsetX+f.x*g.scale,y=g.offsetY+f.y*g.scale;
    el.style.left=x+'px';el.style.top=y+'px';el.style.width=f.w*g.scale+'px';el.style.height=f.h*g.scale+'px';
    const img=el.firstElementChild;
    img.style.cssText='left:'+(g.offsetX-x)+'px;top:'+(g.offsetY-y)+'px;width:'+g.imageWidth+'px;height:'+g.imageHeight+'px';
  });
}
function scheduleSceneLayout() {
  cancelAnimationFrame(sceneLayoutRaf);
  sceneLayoutRaf=requestAnimationFrame(layoutStagePlates);
}
function layoutStagePlates() {
  const stage=$('#stage');
  if(!stage || !$('#screen-game').classList.contains('active')) return;
  const g=sceneGeometry(), base=stage.getBoundingClientRect();
  const panel=$('#scenePanel');
  const cards=$('#myCardsBar');
  if(cards && !panel.contains(cards) && !cards.classList.contains('hidden')) {
    cards.style.bottom='';
    const c=cards.getBoundingClientRect(),r=panel.getBoundingClientRect();
    if(c.right>r.left-8 && c.bottom>r.top && c.top<r.bottom) cards.style.bottom=(base.bottom-r.top+12)+'px';
  }
  const barriers=[panel,$('#accusationTicker'),$('.info-bar'),$('#roleBanner'),$('#judgeWatchBar'),$('#judgeBubble'),$('#stageSlots .stage-jury-more'),cards]
    .filter(el=>el && !el.classList.contains('hidden') && el.getClientRects().length)
    .map(el=>el.getBoundingClientRect());
  const placed=[];
  $$('#stagePlates .stage-plate').forEach(el=>{
    const r=el.getBoundingClientRect();
    const clampX=x=>Math.max(r.width/2+8,Math.min(g.usable-r.width/2-8,x));
    const clampY=y=>Math.max(4,Math.min(g.height-r.height-8,y));
    const x=clampX(+el.dataset.x/100*g.width), y=clampY(+el.dataset.y/100*g.height+3);
    const obstacles=[...barriers,...placed];
    const xs=[x],ys=[y];
    obstacles.forEach(b=>{
      xs.push(clampX(b.left-base.left-r.width/2-8),clampX(b.right-base.left+r.width/2+8));
      ys.push(clampY(b.top-base.top-r.height-8),clampY(b.bottom-base.top+8));
    });
    let best=null;
    // A legközelebbi szabad helyet választjuk: a panel kinyitása nem tolhat
    // egy telefonos névtáblát a felső vezérlősáv alá.
    for(const cx of new Set(xs)) for(const cy of new Set(ys)) {
      const box={left:base.left+cx-r.width/2,right:base.left+cx+r.width/2,top:base.top+cy,bottom:base.top+cy+r.height};
      const overlap=obstacles.reduce((sum,b)=>sum+Math.max(0,Math.min(box.right,b.right+5)-Math.max(box.left,b.left-5))*Math.max(0,Math.min(box.bottom,b.bottom+5)-Math.max(box.top,b.top-5)),0);
      const cost=overlap*100000+(cx-x)**2*1.4+(cy-y)**2;
      if(!best || cost<best.cost) best={x:cx,y:cy,box,cost};
    }
    el.style.left=100*best.x/g.width+'%';el.style.top=100*best.y/g.height+'%';
    placed.push(best.box);
  });
}
// Melyik fázisban ki a beszélő (szerepkulcs).
const SPEAKER_OF = {
  prosecution: 'prosecutor',
  defense: 'defendant',
  defender: 'defender',
  witness: 'witness',
  final_prosecution: 'prosecutor',
  final_defense: 'defendant'
};
const SPEAKER_PID = { prosecutor: 'prosecutorId', defendant: 'defendantId', defender: 'defenderId', witness: 'witnessId' };

// Kis figyelmeztető doboz a képernyő tetején (pl. nincs ügyiratmappa kiválasztva).
function showToast(msg) {
  let t = document.getElementById('toastBox');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toastBox';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('visible');
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(() => t.classList.remove('visible'), 6000);
}

// ============================================================
// JÁTÉKLEÍRÁS – "i" gomb + első belépéskor magától nyílik
// (a szöveg a data/help.json-ből jön, kiszolgálva a szerverről)
// ============================================================

let HELP_CACHE = null;

async function loadHelp() {
  if (HELP_CACHE) return HELP_CACHE;
  try {
    const res = await fetch('/help.json');
    HELP_CACHE = await res.json();
  } catch (e) {
    HELP_CACHE = { title: 'Játékleírás', sections: [] };
  }
  return HELP_CACHE;
}

function renderHelp(data) {
  $('#helpTitle').textContent = data.title || 'Játékleírás';
  $('#helpBody').innerHTML = (data.sections || []).map((s) =>
    '<section class="help-sec"><h3>' + escapeHtml(s.heading) + '</h3>' +
    (s.body || []).map((b) => '<p>' + escapeHtml(b) + '</p>').join('') +
    (s.list ? '<ul>' + s.list.map((li) => '<li>' + escapeHtml(li) + '</li>').join('') + '</ul>' : '') +
    (s.after ? '<p>' + escapeHtml(s.after) + '</p>' : '') +
    '</section>'
  ).join('');
}

async function openHelp(firstTime) {
  const data = await loadHelp();
  renderHelp(data);
  $('#helpModal').classList.remove('hidden');
  $('#helpOk').textContent = firstTime ? 'Értem, kezdjük!' : 'BEZÁR';
}

function closeHelp() {
  $('#helpModal').classList.add('hidden');
}

$$('[data-help]').forEach((b) => b.addEventListener('click', () => openHelp(false)));
$('#helpClose').addEventListener('click', closeHelp);
$('#helpOk').addEventListener('click', () => { closeHelp(); LS.setItem('kb_helpSeen', '1'); });
$('#helpModal').addEventListener('click', (e) => { if (e.target === $('#helpModal')) closeHelp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#helpModal').classList.contains('hidden')) closeHelp(); });
if (!LS.getItem('kb_helpSeen')) setTimeout(() => {
  if (IDENTITY_READY) openHelp(true);
}, 500);

// ============================================================
// KÉPERNYŐ 1: KI VAGY TE, GYANÚSÍTOTT? (nyilvántartási kártyák)
// ============================================================

let REGISTRY = []; // { nev, jelveny, titulus, priusz, stats }
let GUEST_PRIORS = [];
let TAKEN_NAMES = [];
let CHOSEN = null; // { nev, titulus, priusz, profile:true } | { nev, vendég }

const VENGEANCE = [
  { min: 0, text: 'Vérdíj: 1 pogácsa' },
  { min: 1, text: (n) => 'Vérdíj: ' + n + ' lángos' },
  { min: 5, text: (n) => 'Vérdíj: ' + n + ' lángos és egy sör' },
  { min: 10, text: (n) => 'Vérdíj: ' + n + ' lángos, egy láda sör és egy kacsa' },
  { min: 20, text: (n) => 'Vérdíj: ' + n + ' lángos, egy láda sör, egy kacsa ÉS EGY KERTITÖRPE' }
];

function bountyText(score) {
  let t = VENGEANCE[0].text;
  for (const v of VENGEANCE) if (score >= v.min) t = typeof v.text === 'function' ? v.text(score) : v.text;
  return t;
}

// --- megjelenítő segédek (noir/rendőrőrs UI) ---

const prevScores = {};        // pirula-villanáshoz
let lastRenderedPhase = null; // fázis-beúszás animációhoz
let lastVerdictFlash = '';    // ítélet-villanás egyszer fusson

function nameHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function tiltFor(id) {
  let s = 0;
  for (const c of String(id)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return (s % 9) - 4; // -4..4 fok
}

const JUDGE_LINES = {
  accusation: 'Figyelem! Felolvassuk a vádat.',
  prep: 'A felek készülnek… csend a tárgyalóteremben!',
  prosecution: 'Az ügyész szólal meg.',
  defense: 'A vádlott védekezik.',
  defender: 'A védőügyvéd szólal meg.',
  witness: 'Meglepetés tanú a podon!',
  final_prosecution: 'Zárószó: az ügyészé.',
  final_defense: 'Zárószó: a vádlotté.',
  verdict_vote: 'Esküdttanács, ti döntötök!',
  challenge_vote: 'Ellenőrzésem a kihívásokról…',
  challenge_review: 'Most ellenőrzöm a titkos kihívásokat…',
  verdict: 'Elhangzott az ítélet!',
  round_results: 'Megvannak a kör pontjai.',
  game_over: 'A tárgyalások véget értek!',
  objection: 'TILTAKOZÁS – a bíró dönt…'
};

function updateJudgeBubble(text) {
  const b = $('#judgeBubble');
  if (!b) return;
  if (!text) {
    b.textContent = '';
    b.classList.remove('flash');
    return;
  }
  if (b.textContent !== text) {
    b.textContent = text;
    b.classList.remove('flash');
    void b.offsetWidth;
    b.classList.add('flash');
    // A bíró szöveget mond, ezért röviden bólogat.
    charAnim.judgeSpeak(2500);
  }
}

// Igaz, ha a bíró szövegbuborékja épp látszik.
function judgeBubbleVisible() {
  const b = $('#judgeBubble');
  return !!(b && b.textContent);
}

// Piros fonál: csak a táblán belül, a plakátok mögött fut.
function drawPinThreads() {
  const wall = $('#pinWall');
  if (!wall) return;
  const old = wall.querySelector('svg.pin-threads');
  if (old) old.remove();
  const posters = Array.from(wall.querySelectorAll('[data-poster]'));
  if (posters.length < 2) return;
  const w = wall.clientWidth, h = wall.clientHeight;
  if (!w || !h) return;
  const wr = wall.getBoundingClientRect();
  const pts = posters.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(Math.max(r.left - wr.left + r.width / 2, 8), w - 8),
      y: Math.min(Math.max(r.top - wr.top + 14, 8), h - 8)
    };
  });
  let paths = '';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const mx = (a.x + b.x) / 2 + ((i % 2) ? 16 : -16);
    const my = Math.min(Math.max((a.y + b.y) / 2, 8), h - 8);
    paths += '<path d="M' + a.x + ' ' + a.y + ' Q' + mx + ' ' + my + ' ' + b.x + ' ' + b.y + '"/>';
  }
  pts.forEach((p) => { paths += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5"/>'; });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pin-threads');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.innerHTML = paths;
  wall.insertBefore(svg, wall.firstChild);
}

function initNameScreen() {
  PERSONAL_STATS = { name: '', stats: null };
  // avatar-választó a vendégűrlaphoz
  if (!AVATARS.includes(MY.avatar)) MY.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  buildAvatarGrid($('#avatarGrid'), (a) => { MY.avatar = a; LS.setItem('kb_avatar', a); });

  requestRegistry(true);
  renderMugGrid();
}

// Avatár-rács: a kiválasztott a MY.avatar; onPick(a) a kattintáskor hívódik.
function buildAvatarGrid(grid, onPick) {
  grid.innerHTML = '';
  AVATARS.forEach((a) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'avatar-cell' + (MY.avatar === a ? ' selected' : '');
    cell.dataset.avatar = a;
    cell.setAttribute('aria-label', 'Avatár ' + a.slice(2));
    cell.innerHTML = '<img src="' + avatarSrc(a) + '" alt="" loading="lazy" decoding="async" width="72" height="72">';
    cell.addEventListener('click', () => {
      grid.querySelectorAll('.avatar-cell').forEach((c) => c.classList.remove('selected'));
      cell.classList.add('selected');
      onPick(a);
    });
    grid.appendChild(cell);
  });
}

// Kártyára kattintás után felugró avatárválasztó; a "Belépés" után megy tovább a név.
function openAvatarPicker(suspectName, onConfirm, onCancel) {
  const modal = $('#avatarModal');
  if (!AVATARS.includes(MY.avatar)) MY.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  $('#avatarModalName').textContent = suspectName.replace(/\s*\[[^\]]+\]\s*/, '').trim();
  const preview = $('#avatarModalPreview');
  const sync = () => { preview.src = avatarSrc(MY.avatar); };
  buildAvatarGrid($('#avatarModalGrid'), (a) => { MY.avatar = a; sync(); });
  sync();
  modal.classList.remove('hidden');
  const sel = $('#avatarModalGrid .selected');
  if (sel) sel.scrollIntoView({ block: 'center' });
  const close = () => {
    modal.classList.add('hidden');
    $('#avatarModalOk').onclick = null;
    $('#avatarModalCancel').onclick = null;
    modal.onclick = null;
  };
  $('#avatarModalOk').onclick = () => { LS.setItem('kb_avatar', MY.avatar); close(); onConfirm(); };
  $('#avatarModalCancel').onclick = () => { close(); onCancel && onCancel(); };
  modal.onclick = (e) => { if (e.target === modal) $('#avatarModalCancel').onclick(); };
}

let registryRequest = 0;
function requestRegistry(restoreSelection = false) {
  const request = ++registryRequest;
  const status = $('#registryStatus');
  status.textContent = 'A nyilvántartás betöltése…';
  $('#btnRegistryRetry').classList.add('hidden');
  socket.timeout(8000).emit('get_registry', (err, res) => {
    if (request !== registryRequest) return;
    if (err || !res || !Array.isArray(res.registry) || !res.registry.length) {
      status.textContent = 'Nem érkezett meg a nyilvántartás. Próbáld újra!';
      $('#btnRegistryRetry').classList.remove('hidden');
      return;
    }
    REGISTRY = res.registry;
    GUEST_PRIORS = res.vendegPriuszok || [];
    TAKEN_NAMES = res.takenNames || [];
    status.textContent = '';
    renderMugGrid();
    if (IDENTITY_READY && restoreSelection && MY.name && REGISTRY.some((r) => r.nev === MY.name) && !TAKEN_NAMES.includes(MY.name)) {
      CHOSEN = { nev: MY.name, profile: true };
      const saved = REGISTRY.find((r) => r.nev === MY.name);
      if (saved && AVATARS.includes(saved.avatar)) MY.avatar = saved.avatar;
      show('menu');
      autoConnectAfterName();
    }
  });
}
$('#btnRegistryRetry').addEventListener('click', () => requestRegistry());
$('#btnNameBack').addEventListener('click', () => show(MY.name ? 'menu' : 'auth'));
$('#btnLeaveGame').addEventListener('click', async () => {
  if (await confirmDialog('Biztosan kilépsz a szobából?')) leaveToMenu();
});

// ---- Névkártyák: közös építő a fix kártyákhoz, a saját kártyához és a profil-előnézethez ----
let PERSONAL_STATS = { name: '', stats: null };

// Egy kártya belső HTML-je. o: { label, name, badge, title, stats, avatar, taken, pick, edit }
function mugCardHtml(o) {
  const name = o.name || '';
  const initial = (name.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase();
  const mono = AVATARS.includes(o.avatar)
    ? '<span class="mug-mono mug-avatar"><img src="' + avatarSrc(o.avatar) + '" alt=""></span>'
    : '<span class="mug-mono" style="background:hsl(' + nameHue(name) + ',62%,44%)">' + escapeHtml(initial) + '</span>';
  const st = o.stats;
  return '<span class="mug-label">' + escapeHtml(o.label || 'NYILVÁNTARTÁS') + '</span>' +
    mono +
    '<span class="mug-name">' + escapeHtml(name) + '</span>' +
    (o.badge ? '<span class="mug-badge">' + escapeHtml(o.badge) + '</span>' : '') +
    '<span class="mug-title">' + escapeHtml(o.title || '') + '</span>' +
    '<span class="mug-stats">' +
      '<span class="ms ms-bad" title="Elítélve"><i aria-hidden="true">🔨</i>Elítélve <b>' + (st ? st.bunos : 0) + '×</b></span>' +
      '<span class="ms ms-good" title="Felmentve"><i aria-hidden="true">🕊️</i>Felmentve <b>' + (st ? st.artatlan : 0) + '×</b></span>' +
    '</span>' +
    (o.pick && !o.taken ? '<span class="mug-pick">VÁLASZTOM <i aria-hidden="true">▸</i></span>' : '') +
    (o.edit && !o.taken ? '<button type="button" class="mug-edit" aria-label="Saját kártya szerkesztése">✎ SZERKESZTÉS</button>' : '') +
    (o.taken ? '<div class="mug-taken"><span>ŐRIZETBEN</span></div>' : '');
}

// A bejelentkezett fiók saját kártyájának adatai (a profilból).
function personalCard() {
  const acc = window.kbAccount;
  if (!acc) return null;
  const pr = acc.profile || {};
  return {
    nev: acc.username,
    titulus: pr.titulus || 'Új gyanúsított',
    priusz: pr.priusz || '',
    jelveny: pr.jelveny || '',
    avatar: AVATARS.includes(pr.avatar) ? pr.avatar : ''
  };
}

// Közös kártya-váz: szerep, felirat, billentyűzet (Enter / szóköz).
function mugCardShell(name, taken, chosen, extraClass) {
  const card = document.createElement('div');
  card.className = 'mug-card' + (extraClass ? ' ' + extraClass : '') + (taken ? ' taken' : '') + (chosen ? ' chosen' : '');
  card.setAttribute('role', 'button');
  card.tabIndex = taken ? -1 : 0;
  if (taken) card.setAttribute('aria-disabled', 'true');
  card.setAttribute('aria-label', name + (taken ? ' – őrizetben' : ' kiválasztása'));
  if (!taken) {
    card.addEventListener('keydown', (e) => {
      if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
    });
  }
  return card;
}

function renderMugGrid() {
  const grid = $('#mugGrid');
  grid.innerHTML = '';

  // A TE KÁRTYÁD: csak bejelentkezett fióknál, elől.
  const me = personalCard();
  if (me) {
    if (PERSONAL_STATS.name !== me.nev) {
      PERSONAL_STATS = { name: me.nev, stats: null };
      socket.emit('get_stats', { name: me.nev }, (res) => {
        if (PERSONAL_STATS.name !== me.nev) return;
        PERSONAL_STATS.stats = res && res.stats ? res.stats : null;
        renderMugGrid();
      });
    }
    const taken = TAKEN_NAMES.includes(me.nev);
    const card = mugCardShell(me.nev, taken, CHOSEN && CHOSEN.nev === me.nev, 'mug-me');
    card.innerHTML = mugCardHtml({
      label: 'A TE KÁRTYÁD', name: me.nev, badge: me.jelveny, title: me.titulus,
      stats: PERSONAL_STATS.name === me.nev ? PERSONAL_STATS.stats : null,
      avatar: me.avatar, taken, pick: true, edit: true
    });
    const edit = card.querySelector('.mug-edit');
    if (edit) {
      edit.addEventListener('click', (e) => { e.stopPropagation(); if (window.kbEditProfile) window.kbEditProfile(); });
      edit.addEventListener('keydown', (e) => e.stopPropagation());
    }
    if (!taken) {
      card.addEventListener('click', () => {
        if (card.classList.contains('chosen')) return;
        card.classList.add('chosen');
        if (me.avatar) MY.avatar = me.avatar;
        openAvatarPicker(me.nev, () => {
          if (window.kbSaveAvatar) window.kbSaveAvatar(MY.avatar);
          choosePersonal(me);
        }, () => card.classList.remove('chosen'));
      });
    }
    grid.appendChild(card);
  }

  REGISTRY.forEach((r) => {
    const taken = TAKEN_NAMES.includes(r.nev);
    // A [TAG] a jelvény: a névtábláról a jelvény-címkére kerül.
    const tagMatch = r.nev.match(/\[([^\]]+)\]/);
    const badge = r.jelveny || (tagMatch ? tagMatch[1] : '');
    const cleanName = r.nev.replace(/\s*\[[^\]]+\]\s*/, '').trim();
    const card = mugCardShell(cleanName, taken, CHOSEN && CHOSEN.nev === r.nev);
    card.innerHTML = mugCardHtml({
      name: cleanName, badge, title: r.titulus, stats: r.stats, avatar: r.avatar, taken, pick: true
    });
    if (!taken) {
      card.addEventListener('click', () => {
        if (card.classList.contains('chosen')) return;
        card.classList.add('chosen'); // arany keret, amíg az avatárválasztó nyitva van
        if (AVATARS.includes(r.avatar)) MY.avatar = r.avatar; // a kártya korábbi avatárja előre kijelölve
        openAvatarPicker(r.nev, () => {
          r.avatar = MY.avatar;
          socket.emit('set_avatar', { name: r.nev, avatar: MY.avatar });
          chooseSuspect(r.nev, true);
        }, () => card.classList.remove('chosen'));
      });
    }
    grid.appendChild(card);
  });
}

// A saját (fiókhoz tartozó) kártyával lépünk be: a szobában a profil szövegei látszanak.
function choosePersonal(me) {
  CHOSEN = {
    nev: me.nev, profile: false, personal: true,
    titulus: me.titulus,
    priusz: me.priusz || (GUEST_PRIORS.length ? GUEST_PRIORS[Math.floor(Math.random() * GUEST_PRIORS.length)] : 'Előélete tiszta. Túl tiszta.'),
    jelveny: me.jelveny
  };
  MY.name = me.nev;
  LS.setItem('kb_name', me.nev);
  show('menu');
  autoConnectAfterName();
}

function chooseSuspect(name, isProfile) {
  CHOSEN = { nev: name, profile: !!isProfile };
  MY.name = name;
  LS.setItem('kb_name', name);
  show('menu');
  autoConnectAfterName();
}

function autoConnectAfterName() {
  if (!IDENTITY_READY || INTENTIONAL_LEAVE || KICKED_FROM_ROOM) return;
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) {
    $('#codeInput').value = roomParam.toUpperCase();
    joinRoom(roomParam.toUpperCase());
  } else if (MY.code) {
    joinRoom(MY.code);
  }
}

$('#btnNewSuspect').addEventListener('click', () => {
  $('#guestForm').classList.toggle('hidden');
  $('#guestName').focus();
});

$('#guestName').addEventListener('input', () => {
  // Vendég-priusz előnézet: random, ha épp gépel.
  if (GUEST_PRIORS.length) {
    const p = GUEST_PRIORS[Math.floor(Math.random() * GUEST_PRIORS.length)];
    $('#guestPrior').textContent = 'Priusz: ' + p;
  }
});

$('#btnGuestGo').addEventListener('click', () => {
  ensureAudio();
  const name = $('#guestName').value.trim();
  if (!name) { $('#guestName').focus(); return; }
  if (TAKEN_NAMES.some((n) => n.toLowerCase() === name.toLowerCase())) {
    $('#guestPrior').textContent = '❌ Ez a név már ŐRIZETBEN van egy szobában!';
    return;
  }
  const prior = GUEST_PRIORS.length ? GUEST_PRIORS[Math.floor(Math.random() * GUEST_PRIORS.length)] : 'Előélete tiszta. Túl tiszta.';
  CHOSEN = { nev: name, profile: false, titulus: 'Ismeretlen tettes', priusz: prior };
  MY.name = name;
  LS.setItem('kb_name', name);
  show('menu');
  autoConnectAfterName();
});

$('#btnChangeSuspect').addEventListener('click', () => {
  MY.code = null;
  LS.removeItem('kb_code');
  CHOSEN = null;
  show('name');
  requestRegistry();
});

// ============================================================
// KÉPERNYŐ 2: menü
// ============================================================

function myProfilePayload() {
  if (!CHOSEN) return null;
  if (CHOSEN.profile) {
    const r = REGISTRY.find((x) => x.nev === CHOSEN.nev);
    return r ? { titulus: r.titulus, priusz: r.priusz, jelveny: r.jelveny } : null;
  }
  return { titulus: CHOSEN.titulus, priusz: CHOSEN.priusz, jelveny: CHOSEN.jelveny || '' };
}

$('#btnCreate').addEventListener('click', () => {
  ensureAudio();
  INTENTIONAL_LEAVE = false;
  sessionStorage.removeItem('kb_left');
  if (!socket.connected) socket.connect();
  if (!MY.playerId) MY.playerId = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  LS.setItem('kb_playerId', MY.playerId);
  socket.emit('create_room', { name: MY.name, avatar: MY.avatar, playerId: MY.playerId, sessionToken: MY.sessionToken, profile: myProfilePayload() }, (res) => {
    if (res && res.error) { $('#menuError').textContent = res.error; return; }
    enterLobby(res);
  });
});

$('#btnJoin').addEventListener('click', () => {
  ensureAudio();
  const code = $('#codeInput').value.trim().toUpperCase();
  if (code.length !== 4) { $('#menuError').textContent = 'Adj meg egy 4 betűs kódot!'; return; }
  joinRoom(code);
});

function joinRoom(code) {
  INTENTIONAL_LEAVE = false;
  sessionStorage.removeItem('kb_left');
  if (!socket.connected) socket.connect();
  if (!MY.playerId) MY.playerId = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  LS.setItem('kb_playerId', MY.playerId);
  socket.emit('join_room', { code, name: MY.name, avatar: MY.avatar, playerId: MY.playerId, sessionToken: MY.sessionToken, profile: myProfilePayload() }, (res) => {
    if (res && res.error) {
      $('#menuError').textContent = res.error;
      show('menu');
      LS.removeItem('kb_code');
      return;
    }
    enterLobby(res);
  });
}

function enterLobby(res) {
  if (!res || res.error || INTENTIONAL_LEAVE) return;
  MY.playerId = res.playerId;
  MY.sessionToken = res.sessionToken || MY.sessionToken;
  LS.setItem('kb_sessionToken', MY.sessionToken || '');
  LS.setItem('kb_playerId', MY.playerId);
  if (res.state) S = res.state;
  KICKED_FROM_ROOM = false; // új csatlakozás – a korábbi kirúgás már nem érvény
  MY.code = res.code;
  MY.appearances = res.appearances || MY.appearances;
  LS.setItem('kb_code', res.code);
  $('#lobbyCode').textContent = res.code;
  $('#gameCode').textContent = res.code;
  if (S && S.phase !== 'lobby') { show('game'); renderGame(); }
  else { show('lobby'); renderLobby(); updateQrBox(); }
  // A böngésző-vissza gomb őrzése megakadályozza a véletlen kilépést.
  if (!history.state || !history.state.kbGuard) history.pushState({ kbGuard: true }, '', location.href);
}

// QR-kód a szobához: a szerver rajzolja (/qr?room=KÓD) – telefonnal beolvasható.
function updateQrBox() {
  const box = $('#qrBox');
  const img = $('#qrImg');
  if (!box || !img) return;
  if (MY.code) {
    img.src = '/qr?room=' + encodeURIComponent(MY.code);
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

// QR-kód: kattintásra nagyít (telefonnal könnyebb beolvasni a nagyobb kódot).
$('#qrBox').addEventListener('click', () => {
  $('#qrBox').classList.toggle('big');
});

$('#btnCopyLink').addEventListener('click', () => {
  const url = location.origin + '/?room=' + MY.code;
  navigator.clipboard.writeText(url).then(() => {
    $('#btnCopyLink').textContent = '✅ Kimásolva!';
    setTimeout(() => { $('#btnCopyLink').textContent = '📋 Link másolása a Discordra'; }, 2000);
  });
});

$('#btnLeaveLobby').addEventListener('click', async () => {
  const ok = await confirmDialog('Biztosan kilépsz a szobából?');
  if (ok) leaveToMenu();
});

// ============================================================
// KÉPERNYŐ 3: lobby
// ============================================================

function refreshVegyesCell(mg) {
  const v = $('#vegyesCell');
  if (!v) return;
  const cells = Array.from(mg.querySelectorAll('.case-tab[data-mode]'));
  v.classList.toggle('active-case', cells.length > 0 && cells.every((c) => c.classList.contains('active-case')));
}

// A lobby beállításainak pillanatnyi értéke a DOM-ból (a módokkal együtt).
function collectLobbySettings() {
  return {
    speechSeconds: +$('#setSpeech').value,
    defenderSeconds: +$('#setDefender').value,
    prepSeconds: +$('#setPrep').value,
    witnessSeconds: +$('#setWitness').value,
    closingSeconds: +$('#setClosing').value,
    rounds: +$('#setRounds').value,
    witnessEnabled: $('#setWitnessOn').checked,
    challengesEnabled: $('#setChallengesOn').checked,
    autoNextRound: $('#setAutoRound').checked,
    autoNewGame: $('#setAutoGame').checked,
    challengeMode: (document.querySelector('input[name="challengeMode"]:checked') || {}).value === 'jury' ? 'jury' : 'judge',
    modes: $$('#modeGrid .case-tab[data-mode]')
      .filter((c) => c.classList.contains('active-case'))
      .map((c) => c.dataset.mode),
    customAccusations: $('#customAccusations').value.split('\n').map((x) => x.trim()).filter((x) => x.length > 3)
  };
}

// A mappára kattintáskor AZONNAL a szerverhez megy a kiválasztás
// (nem kell a "Beállítások mentése" gomb).
let pendingModes = null;
let modesRevision = 0;
function emitLobbyModes() {
  const revision = ++modesRevision;
  pendingModes = collectLobbySettings().modes;
  socket.emit('update_settings', {settings: {modes: pendingModes}}, (res) => {
    if (revision !== modesRevision) return;
    if (res?.error) showToast(res.error);
    pendingModes = null;
  });
}
function emitLobbySettings() {
  socket.emit('update_settings', { settings: collectLobbySettings() });
}

// "Aktív ügyek: …" címke + a start gomb csak úgy indul, ha van kijelölt mód.
function updateActiveModesLabel() {
  const sel = S.hostId === MY.playerId ? $$('#modeGrid .case-tab[data-mode]')
    .filter((c) => c.classList.contains('active-case'))
    .map((c) => c.dataset.mode) : (S.settings.modes || []);
  const names = (S.modes || []).filter((m) => sel.includes(m.key)).map((m) => m.name);
  const label = $('#activeModes');
  if (label) label.textContent = names.length
    ? 'Aktív ügyek: ' + names.join(' • ')
    : 'Válassz legalább egy ügyiratmappát!';
  const btn = $('#btnStartGame');
  if (btn) {
    btn.disabled = sel.length === 0 || S.players.filter((p) => p.connected).length < 3;
    btn.title = sel.length === 0 ? 'Válassz legalább egy ügyiratmappát!' : '';
  }
  const note = $('#nonHostNote');
  if (note && S.hostId !== MY.playerId) {
    note.textContent = names.length
      ? 'Várakozás, míg a házigazda beállítja az ügyeket…\nAktív ügyek: ' + names.join(' • ')
      : 'Várakozás, míg a házigazda beállítja az ügyeket…';
  }
}

// --- plakátfal + hírszalag állapot ---
let posterIds = []; // jelenleg kirakott plakátok (playerId sorrend)
let tickerTimer = null;

const TICKER_TEMPLATES = [
  'RENDKÍVÜLI: [N] ismét \'pill\'-t írt, a nyomozás folyik',
  '[N] látták egy lángosos közelében',
  '[N] tagad mindent',
  'SZEMTANÚ: [N] hajnali 4-kor CAPS LOCK-kal üvöltött',
  'FELOLÓ JELENTÉS: [N] szerint \"ő nem is volt ott\" – a nyomozók kételkednek',
  'BETÖRÉS A KAMIONBA: [N] a fő gyanúsított, a váza sértetlen',
  '[N] a kihallgatáson: \"Jelzem nem vagyok jó benne\"',
  'RIESZKÓ: [N] újabb házát gyújtotta fel \"csak tesztelésnek\"',
  '[N] ellen eljárás indult tiltott smoke-dobásért',
  'ELTŰNT EGY KACSA. [N] minden kérdésre nevetett',
  'SZERVA BEJELENTÉS: [N] éjszaka kertitörpéket számol a kertben',
  '[N] büntetlen előéletét ma újabb ügy rontotta'
];

function startTicker() {
  stopTicker();
  const push = () => {
    const names = S ? S.players.filter((p) => p.connected).map((p) => p.name) : [];
    if (names.length === 0) return;
    const tpl = TICKER_TEMPLATES[Math.floor(Math.random() * TICKER_TEMPLATES.length)];
    const name = names[Math.floor(Math.random() * names.length)];
    const track = $('#tickerTrack');
    if (!track) return;
    track.style.animation = 'none';
    track.textContent = tpl.replace(/^RENDKÍVÜLI:\s*/, '').replaceAll('[N]', name); // újrastart
    void track.offsetWidth;
    track.style.animation = '';
  };
  push();
  tickerTimer = setInterval(push, 18000);
}
function stopTicker() {
  if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
}

function posterHtml(p, idx) {
  const prof = p.profile || {};
  const isBot = !!p.isBot;
  const title = isBot ? 'A rendőrség fizetett tanúja' : (prof.titulus || 'Ismeretlen tettes');
  const priusz = isBot ? 'Mindenestre mindent látott, amit kellett.' : (prof.priusz || 'Előélete tiszta. Túl tiszta.');
  const record = (isBot || !prof._stats)
    ? 'Elítélve: 0x | Felmentve: 0x'
    : 'Elítélve: ' + prof._stats.bunos + 'x | Felmentve: ' + prof._stats.artatlan + 'x';
  const stamp = isBot
    ? '<div class="p-stamp bot">TESZT-BOT</div>'
    : (p.isHost ? '<div class="p-stamp host">A TÁRGYALÁS VEZETŐJE</div>' : '');
  // Házigazdai kirúgás a lobbyban: minden MÁSIK játékos plakátján KIRÚG gomb.
  const canKick = (S && S.hostId === MY.playerId && p.id !== MY.playerId);
  const kickBtn = canKick
    ? '<button class="poster-kick" data-kickpid="' + p.id + '" data-kickname="' + escapeHtml(p.name) + '">KIRÚG</button>'
    : '';
  const tilt = tiltFor(p.id || p.name);
  const pname = String(p.name || '').replace(/\s*\[[^\]]+\]\s*/, '').trim();
  const portrait = !isBot && AVATAR_ID_RE.test(p.avatar || '')
    ? '<img class="p-avatar" src="' + avatarSrc(p.avatar) + '" alt="">'
    : '<span class="p-avatar p-mono" style="background:hsl(' + nameHue(pname) + ',62%,44%)">' + (isBot ? '🤖' : escapeHtml((pname.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase())) + '</span>';
  return '<div class="poster" style="--tilt:' + tilt + 'deg">' +
    portrait +
    '<span class="p-wanted">' + (isBot ? 'HIVATALOS SZEMÉLYZET' : 'KÖRÖZÉS') + '</span>' +
    '<span class="p-name">' + escapeHtml(p.name) + '</span>' +
    '<div class="p-badge-row">' + (prof.jelveny && !isBot ? '<span class="p-badge">' + escapeHtml(prof.jelveny) + '</span>' : '') + '</div>' +
    '<span class="p-title">' + escapeHtml(title) + '</span>' +
    '<span class="p-priors">' + escapeHtml(priusz) + '</span>' +
    '<span class="p-reward">' + bountyText(p.score) + '</span>' +
    '<span class="p-record">' + record + '</span>' +
    stamp + kickBtn +
    (p.connected ? '' : '<div class="p-offline"><span>KIESETT</span></div>') +
    '</div>';
}

function renderLobby() {
  updateQrBox(); // a QR minden lobby-megjelenítésnél élesben álljon
  const host = S.hostId === MY.playerId;
  $('#hostSettings').classList.toggle('hidden', !host);
  $('#nonHostNote').classList.toggle('hidden', host);
  $('#btnStartGame').classList.toggle('hidden', !host);
  $('#btnAddBot').classList.toggle('hidden', !host);
  $('#btnRemoveBot').classList.toggle('hidden', !host || !S.players.some((p) => p.isBot));
  $('#lobbyHint').textContent = S.players.filter((p) => p.connected).length < 3
    ? 'Legalább 3 gyanúsított kell egy tárgyaláshoz!' : '';
  if (!host) $('#btnLeaveLobby').classList.remove('hidden');

  // KÖZELLENSÉG №1: a legtöbb 'bunos' bejegyzésű profil (a szerver odacsatolja a stats-ot)
  const connected = S.players.filter((p) => p.connected);
  let publicEnemy = null;
  connected.forEach((p) => {
    if (p.profile && p.profile._stats && p.profile._stats.bunos > 0) {
      if (!publicEnemy || p.profile._stats.bunos > publicEnemy.profile._stats.bunos) publicEnemy = p;
    }
  });

  // plakátok diffelése: új -> pin-in animáció; lekerülő -> poster-fall
  const wall = $('#pinWall');
  const newIds = connected.map((p) => p.id);
  posterIds.forEach((id) => {
    if (!newIds.includes(id)) {
      const el = wall.querySelector('[data-poster="' + id + '"]');
      if (el) {
        // elhalványulás kilépéskor
        const card = el.querySelector('.poster');
        if (card && card.animate) {
          card.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(10px)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' });
        }
        setTimeout(() => el.remove(), 350);
      }
    }
  });
  // hiányzó plakátok kirakása / meglévők frissítése
  connected.forEach((p, idx) => {
    let el = wall.querySelector('[data-poster="' + p.id + '"]');
    const html = posterHtml(p, idx);
    if (!el) {
      el = document.createElement('div');
      el.dataset.poster = p.id;
      el.innerHTML = html;
      wall.appendChild(el);
      // finom beúszás: 8px lecsúszás (transform-only, hogy bármilyen
      // renderelési környezetben a plakát látható maradjon)
      const card = el.querySelector('.poster');
      if (card && card.animate) {
        card.animate(
          [{ transform: 'translateY(-8px)' }, { transform: 'none' }],
          { duration: 280, easing: 'ease-out' }
        );
      }
    } else if (el.innerHTML !== html) {
      el.innerHTML = html;
    }
  });
  // KÖZELLENSÉG №1 chip
  wall.querySelectorAll('.p-stamp.enemy').forEach((s) => s.remove());
  if (publicEnemy) {
    const el = wall.querySelector('[data-poster="' + publicEnemy.id + '"] .poster');
    if (el) el.insertAdjacentHTML('beforeend', '<div class="p-stamp enemy">KÖZELLENSÉG №1</div>');
  }
  posterIds = newIds;

  // Házigazdai kirúgás a lobbyban (plakátokon lévő gombok – esemény-kezelés a falon).
  if (!$('#pinWall').dataset.kickBound) {
    $('#pinWall').dataset.kickBound = '1';
    $('#pinWall').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-kickpid]');
      if (!btn) return;
      const ok = await confirmDialog('Biztosan kirúgod ' + btn.dataset.kickname + '-t?', 'KIRÚGÁS');
      if (ok) socket.emit('kick_player', { playerId: btn.dataset.kickpid });
    });
  }

  startTicker();
  requestAnimationFrame(drawPinThreads);

  if (!host) updateActiveModesLabel();
  if (host) {
    // ügyiratmappa: játékmódok (+ VEGYES)
    // A rácsot csak akkor építjük újra, ha a mód-lista változott – különben
    // minden state-üzenet lenyelné a friss kattintást.
    const mg = $('#modeGrid');
    const keys = (S.modes || []).map((m) => m.key).join(',');
    if (mg.dataset.modesKey !== keys) {
      mg.dataset.modesKey = keys;
      mg.innerHTML = '';
      (S.modes || []).forEach((m) => {
        const cell = document.createElement('div');
        cell.className = 'case-tab';
        cell.dataset.mode = m.key;
        cell.innerHTML = escapeHtml(m.name.toUpperCase()) +
          '<div class="case-stamp"><span>AKTÍV ÜGY</span></div>';
        cell.addEventListener('click', () => {
          cell.classList.toggle('active-case');
          refreshVegyesCell(mg);
          updateActiveModesLabel();
          emitLobbyModes(); // azonnal a szerverhez!
        });
        mg.appendChild(cell);
      });
      const vcell = document.createElement('div');
      vcell.className = 'case-tab';
      vcell.id = 'vegyesCell';
      vcell.innerHTML = 'VEGYES' +
        '<div class="case-stamp"><span>AKTÍV ÜGY</span></div>';
      vcell.title = 'Mindet bejelöli – körönként keverve';
      vcell.addEventListener('click', () => {
        const turnOn = !vcell.classList.contains('active-case');
        $$('#modeGrid .case-tab[data-mode]').forEach((c) => c.classList.toggle('active-case', turnOn));
        refreshVegyesCell(mg);
        updateActiveModesLabel();
        emitLobbyModes();
      });
      mg.appendChild(vcell);
    }
    // A kijelöltség mindig a szerver állapotát tükrözi (szinkronban mindenkinél).
    const selected = pendingModes || S.settings.modes || [];
    $$('#modeGrid .case-tab[data-mode]').forEach((c) => c.classList.toggle('active-case', selected.includes(c.dataset.mode)));
    refreshVegyesCell(mg);
    updateActiveModesLabel();

    $('#setSpeech').value = S.settings.speechSeconds;
    $('#setDefender').value = S.settings.defenderSeconds;
    $('#setPrep').value = S.settings.prepSeconds;
    $('#setWitness').value = S.settings.witnessSeconds;
    $('#setClosing').value = S.settings.closingSeconds;
    $('#setRounds').value = S.settings.rounds;
    $('#setWitnessOn').checked = S.settings.witnessEnabled;
    $('#setChallengesOn').checked = S.settings.challengesEnabled;
    $('#setAutoRound').checked = S.settings.autoNextRound !== false;
    $('#setAutoGame').checked = S.settings.autoNewGame !== false;
    const cm = S.settings.challengeMode === 'jury' ? 'jury' : 'judge';
    $('#setChallengeJudge').checked = cm === 'judge';
    $('#setChallengeJury').checked = cm === 'jury';
  }
}

$('#btnSaveSettings').addEventListener('click', () => {
  // Minden beállítás (módokkal együtt) megy a szerverhez.
  emitLobbySettings();
  showToast('✅ Beállítások mentve.');
});

$('#btnStartGame').addEventListener('click', () => {
  ensureAudio();
  judgeSmash(); // kalapácsütés a TÁRGYALÁS MEGKEZDÉSE gombra
  const selCount = $$('#modeGrid .case-tab[data-mode]')
    .filter((c) => c.classList.contains('active-case')).length;
  if (selCount === 0) {
    showToast('⚠️ Válassz legalább egy ügyiratmappát a TÁRGYALÁS MEGKEZDÉSE előtt!');
    return;
  }
  // A start a pillanatnyi beállításokat (MÓDOKAT!) is elküldi – a szerver
  // ezt tekinti hitelesnek, nem a korábban mentett állapotot.
  socket.emit('start_game', { settings: collectLobbySettings() }, (res) => {
    if (res && res.error) showToast('⚠️ ' + res.error);
  });
});

$('#btnAddBot').addEventListener('click', () => {
  socket.emit('add_bot');
});
$('#btnRemoveBot').addEventListener('click', () => {
  socket.emit('remove_bot');
});

// ============================================================
// JÁTÉKKÉPERNYŐ renderelés
// ============================================================

// ============================================================
// KÁRTYÁIM – állandó kompakt sáv (ügyész, vádlott, védőügyvéd)
// Az ügyész a bizonyítékait, a vádlott az alibijét, a védőügyvéd az ügyész bizonyítékait ("AZ ÜGYÉSZ BIZONYÍTÉKAI")
// és a trükkjeit, mindenki a saját kihívását látja, a felkészüléstől az ítéletig. Nem tolja ki a visszaszámlálót
// és a gombokat: külön, alacsony sáv a tartalom fölött (mobilon összecsukható).
// ============================================================

// Asztali gépen alapból nyitva (végig látszanak a kártyák), telefonon összecsukva (kevés a hely).
const cardsDefaultCollapsed = () => matchMedia('(max-width:700px)').matches;
let myCardsCollapsed = cardsDefaultCollapsed();
const CARD_VISIBLE_PHASES = ['prep', 'prosecution', 'defense', 'defender', 'witness', 'final_prosecution', 'final_defense', 'verdict_vote', 'verdict', 'objection', 'challenge_review'];

function renderMyCardsBar() {
  const bar = $('#myCardsBar');
  if (!bar) return;
  const role = myRole();
  const chips = [];
  const inPhase = CARD_VISIBLE_PHASES.includes(S.phase);

  if (inPhase && S.evidence && (role === 'prosecutor' || role === 'defender')) {
    const head = role === 'prosecutor' ? 'A TITKOS BIZONYÍTÉKAID' : 'AZ ÜGYÉSZ BIZONYÍTÉKAI';
    chips.push('<span class="mcb-head" style="--role:' + ROLE_COLOR.prosecutor + '">' + head + '</span>');
    S.evidence.forEach((e) => chips.push(
      '<span class="mcb-card" style="--role:' + ROLE_COLOR.prosecutor + '">' +
      '<span class="mcb-type">BIZONYÍTÉK</span><span class="mcb-text">' + escapeHtml(e) + '</span></span>'));
  }
  if (inPhase && S.tricks && role === 'defender') {
    chips.push('<span class="mcb-head" style="--role:' + ROLE_COLOR.defender + '">A TITKOS TRÜKKJEID</span>');
    S.tricks.forEach((t) => chips.push(
      '<span class="mcb-card" style="--role:' + ROLE_COLOR.defender + '">' +
      '<span class="mcb-type">TRÜKK</span><span class="mcb-text">' + escapeHtml(t) + '</span></span>'));
  }
  if (inPhase && S.alibi && role === 'defendant') {
    chips.push('<span class="mcb-head" style="--role:' + ROLE_COLOR.defendant + '">A TITKOS ALIBID</span>');
    chips.push('<span class="mcb-card" style="--role:' + ROLE_COLOR.defendant + '">' +
      '<span class="mcb-type">ALIBI</span><span class="mcb-text">' + escapeHtml(S.alibi) + '</span></span>');
  }
  if (inPhase && S.witnessCard && role === 'witness') {
    chips.push('<span class="mcb-head" style="--role:' + ROLE_COLOR.witness + '">A TITKOS TANÚKÁRTYÁD</span>');
    chips.push('<span class="mcb-card" style="--role:' + ROLE_COLOR.witness + '">' +
      '<span class="mcb-type">TANÚ</span><span class="mcb-text">' + escapeHtml(S.witnessCard) + '</span></span>');
  }
  if (inPhase && S.myChallenge && (role === 'prosecutor' || role === 'defender' || role === 'defendant')) {
    chips.push('<span class="mcb-card" style="--role:' + roleColorOf(role) + '">' +
      '<span class="mcb-type">🎬 KIHÍVÁS</span><span class="mcb-text">' + escapeHtml(S.myChallenge) + '</span></span>');
  }

  const prepHtml=S.phase==='prep'?(role==='defender'?chips.join(''):secretCardsHtml()+challengeHtmlIfMine()):'';
  if(prepHtml && renderMyCardsBar.lastPhase!=='prep') myCardsCollapsed=false;
  if(S.phase!=='prep' && renderMyCardsBar.lastPhase==='prep') myCardsCollapsed=cardsDefaultCollapsed();
  renderMyCardsBar.lastPhase=S.phase;
  if ((!prepHtml && chips.length === 0) || S.phase === 'lobby' || S.phase === 'game_over') {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    delete bar.dataset.html;
    return;
  }

  bar.classList.remove('hidden');
  const body = '<div class="mcb-body' + (myCardsCollapsed ? ' collapsed' : '') + '">' + (prepHtml||chips.join('')) + '</div>';
  const head = '<button class="mcb-toggle" id="mcbToggle" type="button" aria-label="Kártyák összecsukása">' +
    '<span class="mcb-only-you">CSAK TE LÁTOD</span>' +
    '<span class="mcb-cards-ico">🎴 KÁRTYÁIM</span><span class="mcb-caret">' + (myCardsCollapsed ? '▸' : '▾') + '</span></button>';
  const html = head + body;
  if (bar.dataset.html !== html) {
    bar.innerHTML = html;
    bar.dataset.html = html;
    const t = $('#mcbToggle');
    if (t) t.addEventListener('click', () => { myCardsCollapsed = !myCardsCollapsed; renderMyCardsBar(); scheduleSceneLayout(); });
  }
  if(matchMedia('(max-width:700px)').matches && S.phase==='prep') $('#phaseContent').appendChild(bar);
  scheduleSceneLayout();
}

function renderGame() {
  renderHeader();
  renderAccusationTicker();
  renderRoleBanner();
  renderStage();
  renderJudgeWatchBar();
  renderPhaseContent();
  renderMyCardsBar();
  renderSidebar();
  $('#screen-game').dataset.phase=S.phase;
  $('#scenePanel').dataset.layout=SPEAKER_OF[S.phase]?'speech':['verdict','round_results','game_over'].includes(S.phase)?'result':S.phase;
  scheduleSceneLayout();
  // "Rendet a teremben!" – CSAK az aktuális KÖR BÍRÓJA látja és használhatja
  // (a szerver is ezt ellenőrzi).
  const isRoundJudge = !!S.currentJudgeId && S.currentJudgeId === MY.playerId;
  const canOrder = isRoundJudge;
  $('#btnOrder').classList.toggle('hidden', !canOrder);
  $('#btnOrder').innerHTML = '🔨 Rendet a teremben!';
}

// Egyetlen vád-tábla: a bevezető animáció nem ismétlődik minden state-nél.
let chargeCaseKey='';
let chargeIntroRaf=0;
let chargeFlightTimer=0;
let lastCharge=null;
function cancelChargeIntro() {
  cancelAnimationFrame(chargeIntroRaf);clearTimeout(chargeFlightTimer);
}
function chargeMarkup(text,name) {
  const safe=escapeHtml(text), who=escapeHtml(name);
  return who ? safe.split(who).join('<span class="accused-name">'+who+'</span>') : safe;
}
function renderAccusationTicker() {
  const t=$('#accusationTicker');
  if(S.accusationText) lastCharge={text:S.accusationText,name:nameOf(S.defendantId),mode:S.modeName,caseNo:S.caseNo,custom:S.isCustom};
  const c=S.accusationText?lastCharge:(S.phase==='game_over'?lastCharge:null);
  if(!c) {cancelChargeIntro();t.classList.add('hidden');return;}
  t.classList.remove('hidden');
  const key=(c.caseNo||'')+':'+c.text;
  if(t.dataset.charge!==key) {
    cancelChargeIntro();t.dataset.charge=key;t.classList.remove('expanded','charge-intro');t.setAttribute('aria-expanded','false');
    t.innerHTML='<div class="charge-file-head"><span>⚖️ ÜGYIRAT · '+escapeHtml(c.caseNo||'')+'</span><span class="charge-mode">'+escapeHtml(c.mode||'')+(c.custom?' · SAJÁT':'')+'</span></div><div class="charge-text">'+chargeMarkup(c.text,c.name)+'</div><span class="charge-expand-hint">Teljes vád ↗</span>';
    t.title=c.text;
  }
  if(S.phase==='accusation' && chargeCaseKey!==key) {
    chargeCaseKey=key;
    const reduced=charAnim.reducedMotion||matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!reduced) {
      const target=t.querySelector('.charge-text'), started=performance.now();
      const letters=Array.from(c.text);
      t.classList.add('charge-intro');
      const type=now=>{
        target.innerHTML=chargeMarkup(letters.slice(0,Math.ceil(Math.min(1,(now-started)/1700)*letters.length)).join(''),c.name);
        if(now-started<1700) chargeIntroRaf=requestAnimationFrame(type);
      };
      chargeIntroRaf=requestAnimationFrame(type);
      chargeFlightTimer=setTimeout(()=>{target.innerHTML=chargeMarkup(c.text,c.name);t.classList.remove('charge-intro');scheduleSceneLayout();},2000);
    }
  } else if(S.phase!=='accusation' && t.classList.contains('charge-intro')) {
    cancelChargeIntro();t.classList.remove('charge-intro');t.querySelector('.charge-text').innerHTML=chargeMarkup(c.text,c.name);
  }
  scheduleSceneLayout();
}

// ============================================================
// SZÍNPAD: a karakterek rajzai, a beszélő világít (glow)
// ============================================================

function renderStage() {
  const stage = $('#stage');
  const slots = $('#stageSlots');
  if (!stage || !slots) return;
  stage.classList.toggle('hidden', !S.players || S.players.length === 0);

  if(S.defendantId) lastSceneRoles={prosecutorId:S.prosecutorId,defendantId:S.defendantId,defenderId:S.defenderId,witnessId:S.witnessId,currentJudgeId:S.currentJudgeId};
  const scene=S.phase==='game_over'&&lastSceneRoles?{...S,...lastSceneRoles}:S;
  const g=sceneGeometry();
  renderFurniture(g);
  const speakerRole = SPEAKER_OF[S.phase] || null;
  const entries = [];
  const push = (role, pid) => { if (pid) entries.push({ role, pid }); };
  push('prosecutor', scene.prosecutorId);
  push('defendant', scene.defendantId);
  push('defender', scene.defenderId);
  if (scene.witnessId) push('witness', scene.witnessId);
  const mobile=g.mobile;
  // Az avatár-keretek kisebbek a régi alakoknál; a vádlott alapmérete a legnagyobb, ezért ő kapja a legkisebb arányt.
  const AV_SCALE=mobile?{defendant:.6,prosecutor:.7,defender:.7,witness:.7,juror:.8}:{defendant:.46,prosecutor:.56,defender:.56,witness:.56,juror:.66};
  const avH=(h,isAv,role)=>h*(isAv?(AV_SCALE[role]||.75):1);
  const juryPositions=mobile ? [89,95] : JUROR_X;
  // A bíró a saját pulpitusánál áll; nem jelenik meg másodszor esküdtként.
  const jurors = S.players.filter((p) => p.connected &&
    p.id !== scene.prosecutorId && p.id !== scene.defendantId &&
    p.id !== scene.defenderId && p.id !== scene.witnessId && p.id !== scene.currentJudgeId);
  jurors.slice(0, juryPositions.length).forEach((p, i) => {
    entries.push({ role: 'juror', pid: p.id, ji: i });
  });
  const juryMore = Math.max(0, jurors.length - juryPositions.length);

  const key = entries.map((e) => e.role + ':' + e.pid + ':' + playerById(e.pid)?.name + ':' + playerById(e.pid)?.avatar).join('|') +
    '#' + mobile + '+' + juryMore;
  if (stage.dataset.key !== key) {
    stage.dataset.key = key;
    let html = entries.map((e) => {
      const pos=scenePosition(e.role,e.ji||0,g);
      const avSlot=AVATAR_ID_RE.test(playerById(e.pid)?.avatar||'');
      return '<div class="stage-slot'+(avSlot?' av-slot':'')+'" data-role="'+e.role+'" data-pid="'+escapeHtml(e.pid)+'" style="--x:'+pos.x+'%;--b:'+pos.b+'%;--h:'+avH(pos.h,avSlot,e.role)+'%;--z:'+pos.z+';--glow:'+ROLE_COLOR[e.role]+'">'+characterFigure(e.role,e.pid,e.ji||0)+'</div>';
    }).join('');
    if (juryMore > 0) {
      html += '<div class="stage-jury-more" style="--x:95%;--b:38%">+' + juryMore + '</div>';
    }
    slots.innerHTML = html;
  }

  // Új méretkor is vetítjük a horgonyokat; a képeket nem kell újratölteni.
  $$('#stageSlots .stage-slot').forEach((el,i)=>{
    const entry=entries[i]; if(!entry) return;
    const p=scenePosition(entry.role,entry.ji||0,g);
    el.style.setProperty('--x',p.x+'%');el.style.setProperty('--b',p.b+'%');el.style.setProperty('--h',avH(p.h,el.classList.contains('av-slot'),entry.role)+'%');
  });
  const jp=scenePosition('judge',0,g),judgeSlot=$('#judge');
  // Avatáros bírónál a kép nagyobb (a teteje marad, lefelé nő), a pulpitus elé kerül, a névtábla az aljára.
  const jAv=AVATAR_ID_RE.test(playerById(scene.currentJudgeId)?.avatar||'');
  const jf=jAv?.95:1; // az avatáros bíró képe kicsit kisebb, a teteje marad
  const jh=jp.h*jf, jb=jp.b-jp.h*(jf-1), jPlate=jAv?100-jb-5:jp.plate;
  judgeSlot.classList.toggle('av-judge',jAv);
  judgeSlot.style.setProperty('--x',jp.x+'%');judgeSlot.style.setProperty('--b',jb+'%');judgeSlot.style.setProperty('--h',jh+'%');
  $('#accusationTicker').style.left=g.mobile?'50%':jp.x+'%';
  const bubble=$('#judgeBubble');
  bubble.style.left=jp.x+'%';bubble.style.top=g.mobile?'27%':(jPlate+100*40/g.height)+'%';
  const plateHtml=(role,pid)=>{
    const p=playerById(pid);
    return '<span class="plate-role" style="--role:'+roleColorOf(role)+'">'+roleLabel(role)+'</span><span class="plate-person"><span>'+avatarEmoji(p?.avatar)+'</span><b>'+escapeHtml(p?.name||(role==='judge'?'Bíró':''))+'</b></span>';
  };
  const plates=$('#stagePlates');
  const plateKey=key+':judge:'+scene.currentJudgeId+':'+playerById(scene.currentJudgeId)?.name+':'+playerById(scene.currentJudgeId)?.avatar;
  if(plates.dataset.key!==plateKey) {
    plates.dataset.key=plateKey;
    plates.innerHTML='<div id="judgePlate" class="stage-plate judge-plate" data-role="judge">'+plateHtml('judge',scene.currentJudgeId)+'</div>'+entries.map(e=>'<div class="stage-plate" data-role="'+e.role+'" data-pid="'+escapeHtml(e.pid)+'">'+plateHtml(e.role,e.pid)+'</div>').join('');
  }
  [...plates.children].forEach((el,i)=>{
    const e=i===0?{role:'judge',ji:0}:entries[i-1],p=scenePosition(e.role,e.ji||0,g);
    el.dataset.x=p.x;el.dataset.y=(i===0&&jAv)?jPlate:p.plate;
  });
  const speakerPid = speakerRole ? (scene[SPEAKER_PID[speakerRole]] || null) : null;
  // Tiltakozáskor a megtámadott beszélő folytatja a védelmét (20 mp).
  const objData = S.objectionData || null;
  const objectionSpeaker = (S.phase === 'objection' && objData && objData.phase === 'defense')
    ? objData.speakerId : null;
  const liveSpeakerPid = objectionSpeaker || speakerPid;
  // A bíró teljes fényerejű, és saját névcímkéje van.
  const judgeEl = $('#judge');
  if (judgeEl) {
    const p=playerById(scene.currentJudgeId);
    judgeEl.classList.remove('dim','speaking');
    judgeEl.classList.toggle('round-judge',!!p);
    const tag=judgeEl.querySelector('.st-tag');
    if(tag) tag.innerHTML='<span class="st-av">' + avatarEmoji(p?.avatar) + '</span><span class="st-name">' + escapeHtml(p?.name || 'Bíró') + '</span>';
    const fallback=judgeEl.querySelector('.st-fallback');
    if(fallback) fallback.innerHTML='<span>' + avatarEmoji(p?.avatar) + '</span><small>' + escapeHtml(p?.name || 'Bíró') + '</small>';
    const jHasAv = !!p && AVATAR_ID_RE.test(p.avatar || '');
    const jBase = judgeEl.querySelector('.st-base'), jArt = judgeEl.querySelector('.st-art');
    const jWant = jHasAv ? avatarSrc(p.avatar) : '/assets/biro.png';
    if (jBase && jBase.getAttribute('src') !== jWant) jBase.setAttribute('src', jWant);
    if (jArt) jArt.classList.toggle('av-figure', jHasAv);
    bindCharacterFallback(judgeEl);
    // A bíró lélegzése, bólogatása és kalapács-rázkódása ugyanitt fut.
    judgeEl.dataset.pid = scene.currentJudgeId || '';
    charAnim.register(JUDGE_KEY, judgeEl, 'judge');
  }
  const liveKeys = new Set([JUDGE_KEY]);
  $$('#stageSlots .stage-slot').forEach((el) => {
    if (scene.currentJudgeId && el.dataset.pid === scene.currentJudgeId) el.classList.add('is-round-judge');
    const role = el.dataset.role;
    const pid = el.dataset.pid;
    const active = !!liveSpeakerPid && pid === liveSpeakerPid;
    el.style.setProperty('--glow', ROLE_COLOR[role] || '#f2c14e');
    el.classList.toggle('speaking', active);
    el.classList.toggle('dim', !!liveSpeakerPid && !active);
    el.classList.toggle('mine', active && pid === MY.playerId);
    bindCharacterFallback(el);
    // Karakteranimáció: regisztrálás és a beszélő kijelölése.
    if (pid) {
      liveKeys.add(pid);
      charAnim.init(el, pid, role);
      charAnim.setSpeaking(pid, pid === liveSpeakerPid);
    }
  });
  
  $$('#stagePlates .stage-plate').forEach(el=>el.classList.toggle('speaking',el.dataset.pid===liveSpeakerPid));
  scheduleSceneLayout();
  // A színpadról lekerült / rejtett karakterek animációja megáll.
  charAnim.prune(liveKeys);

  // Bírói üzenet közben a bíró bólogat.
  if (judgeBubbleVisible()) charAnim.judgeSpeak(2500);

  // Mobil: a beszélő neve a színpad alján egy sávban.
  const strip = $('#stageSpeaker');
  if (strip) {
    const p = speakerPid ? playerById(speakerPid) : null;
    strip.textContent = (speakerRole && p)
      ? ((SP_LABEL[speakerRole] ? SP_LABEL[speakerRole] + ' — ' : '') + p.name)
      : '';
    strip.style.setProperty('--glow', speakerRole ? (ROLE_COLOR[speakerRole] || '#f2c14e') : '#f2c14e');
  }

  // Beszélőváltás: rövid ding + a szerep színű villanás a színpadon.
  const spKey = speakerRole ? (speakerRole + ':' + (speakerPid || '')) : '';
  if (stage.dataset.speaker !== undefined && stage.dataset.speaker !== spKey) {
    if (speakerRole) {
      SFX.ding();
      const f = $('#stageFlash');
      if (f) {
        f.style.background = 'radial-gradient(circle at 50% 62%, ' + (ROLE_COLOR[speakerRole] || '#f2c14e') + '33, transparent 65%)';
        f.classList.remove('on');
        void f.offsetWidth;
        f.classList.add('on');
      }
    }
  }
  stage.dataset.speaker = spKey;
}

// ============================================================
// BÍRÓI FIGYELŐ SÁV (csak a bíró látja – a szerver csak neki küldi)
// ============================================================

let jwCollapsed = true;
let jwLastNowText = '';

function renderJudgeWatchBar() {
  const bar = $('#judgeWatchBar');
  if (!bar) return;
  if (!S.judgeWatch || S.judgeWatch.length === 0) {
    bar.classList.add('hidden');
    jwLastNowText = '';
    return;
  }
  // Új "most figyeld" kihívásnál nyíljon ki magától.
  if (S.watchNow && S.watchNow.text !== jwLastNowText) {
    jwLastNowText = S.watchNow.text;
    jwCollapsed = true;
  }
  const notes = S.judgeNotes || {};
  const iAmJudge = !!S.currentJudgeId && S.currentJudgeId === MY.playerId;
  const caret = jwCollapsed ? '▸' : '▾';
  let html = '<button class="jw-head" id="jwHead" type="button">' +
    '<span class="jw-label">👨‍⚖️ BÍRÓI FIGYELŐ • ' + (iAmJudge ? 'EBBEN A KÖRBEN TE VAGY A BÍRÓ' :
      ('A KÖR BÍRÓJA: ' + (S.judgeName || '?').toUpperCase())) +
    ' (' + S.judgeWatch.length + ')</span><span class="jw-caret">' + caret + '</span></button>';
  if (S.watchNow) {
    const col = SPEAKER_OF[S.phase] ? ROLE_COLOR[SPEAKER_OF[S.phase]] : '#f2c14e';
    html += '<span class="jw-now" style="--role:' + col + '">Most figyeld: <b>„' + escapeHtml(S.watchNow.text) + '”</b>' +
      (S.watchNow.difficulty ? ' <i class="jw-hard">NEHEZÍTÉS</i>' : '') +
      '<button class="jw-note' + (notes[S.watchNow.who] ? ' on' : '') + '" data-jnote="' + S.watchNow.who + '">Észrevettem ✓</button></span>';
  }
  html += '<div class="jw-body' + (jwCollapsed ? ' collapsed' : '') + '">';
  html += '<div class="jw-list">' + S.judgeWatch.map((c) =>
    '<span class="jw-item' + (notes[c.who] ? ' noted' : '') + '"><b>' + escapeHtml(c.name) + '</b> (' + WHO_LABEL[c.who] + '): ' +
    escapeHtml(c.text) + (c.difficulty ? ' <i class="jw-hard">NEHEZÍTÉS</i>' : '') + '</span>'
  ).join('') + '</div>';
  html += '</div>';
  bar.innerHTML = html;
  bar.classList.remove('hidden');
  bar.classList.toggle('collapsed', jwCollapsed);
  const head = $('#jwHead');
  head.setAttribute('aria-expanded', String(!jwCollapsed));
  if (head) head.addEventListener('click', () => { jwCollapsed = !jwCollapsed; renderJudgeWatchBar(); });
  bar.querySelectorAll('[data-jnote]').forEach((b) => {
    b.addEventListener('click', () => socket.emit('judge_note', { who: b.dataset.jnote }));
  });
}

// ============================================================
// PONTTÁBLA-OLDALSÁV (desktop: jobb oldalt, mobil: felcsúszó)
// ============================================================

function renderSidebar() {
  const rowsEl = $('#sbRows');
  if (!rowsEl || !S.players) return;
  const roleOf = (p) => {
    if (p.id === S.prosecutorId) return 'prosecutor';
    if (p.id === S.defendantId) return 'defendant';
    if (p.id === S.defenderId) return 'defender';
    if (S.witnessId && p.id === S.witnessId) return 'witness';
    if (S.currentJudgeId && p.id === S.currentJudgeId) return 'judge';
    return 'juror';
  };
  const isHostView = S.hostId === MY.playerId;
  // A kirúgott játékos eltűnik a ponttábláról (a lobbyban a plakátja leesik).
  const sorted = S.players.slice().filter((p) => !p.kickedOut)
    .sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));

  // FLIP: a sorok átrendeződése animáltan történjen.
  const oldRects = {};
  rowsEl.querySelectorAll('.sb-row').forEach((el) => {
    oldRects[el.dataset.pid] = el.getBoundingClientRect().top;
  });

  const html = sorted.map((p, i) => {
    const role = roleOf(p);
    const prev = prevScores[p.id];
    const delta = (prev !== undefined && p.score !== prev) ? p.score - prev : 0;
    prevScores[p.id] = p.score;
    const isJudge = role === 'judge';
    const hostIcon = p.isHost ? '<span class="sb-host" title="A tárgyalás vezetője (beállítások)">👑</span>' : '';
    const offBadge = p.connected ? '' :
      '<span class="sb-off-time" data-gone="' + (p.goneSince || Date.now()) + '">LECSATLAKOZOTT</span>';
    const kickBtn = (isHostView && p.id !== MY.playerId)
      ? '<button class="sb-kick' + (p.connected ? '' : ' urgent') + '" data-kickpid="' + p.id + '" data-kickname="' + escapeHtml(p.name) + '" title="Kirúgás a szobából">KIRÚG</button>'
      : '';
    return '<div class="sb-row' + (p.id === MY.playerId ? ' me' : '') + (delta > 0 ? ' flash' : '') + (isJudge ? ' is-judge' : '') +
      (p.connected ? '' : ' is-off') + '" data-pid="' + p.id + '">' +
      '<span class="sb-rank">' + (i + 1) + '</span>' +
      '<span class="sb-av">' + avatarEmoji(p.avatar) + '</span>' +
      '<span class="sb-mid">' +
        '<span class="sb-name">' + escapeHtml(p.name) + hostIcon + offBadge + '</span>' +
        '<span class="sb-sub"><span class="sb-role" style="--role:' + roleColorOf(role) + '">' + roleLabel(role) + '</span>' +
        (isJudge ? '<span class="sb-judge-hammer" title="Ebben a körben ő a bíró">🔨</span>' : '') + '</span>' +
      '</span>' +
      '<span class="sb-score">' + p.score + '</span>' +
      kickBtn +
      (delta > 0 ? '<span class="sb-delta">+' + delta + '</span>' : '') +
      '</div>';
  }).join('');
  if (rowsEl.innerHTML !== html) rowsEl.innerHTML = html;
  updateGoneTimers();

  if (Object.keys(oldRects).length) {
    rowsEl.querySelectorAll('.sb-row').forEach((el) => {
      const oldTop = oldRects[el.dataset.pid];
      if (oldTop === undefined) return;
      const dy = oldTop - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 2 && el.animate && !charAnim.reducedMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.animate(
          [{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0)' }],
          { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' }
        );
      }
    });
  }
}

$('#sbToggle').addEventListener('click', () => {
  $('#scoreSidebar').classList.toggle('open');
});

// ---- LECSATLAKOZOTT visszaszámláló (hány mp-je nincs bent) ----
function fmtGone(goneSince) {
  const s = Math.max(0, Math.floor(((Date.now() + serverOffset) - goneSince) / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function updateGoneTimers() {
  $$('.sb-off-time[data-gone]').forEach((el) => {
    el.textContent = 'LECSATLAKOZOTT · ' + fmtGone(+el.dataset.gone);
  });
}
let goneTimerInterval=null;
function startGoneTimers() {
  if(goneTimerInterval) return;
  goneTimerInterval=setInterval(()=>{
    if(S?.players.some(p=>!p.connected&&!p.kickedOut)) updateGoneTimers();
  },1000);
}

// ---- HÁZIGAZDAI KIRÚGÁS (ponttábla) ----
$('#sbRows').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-kickpid]');
  if (!btn) return;
  const ok = await confirmDialog('Biztosan kirúgod ' + btn.dataset.kickname + '-t?', 'KIRÚGÁS');
  if (ok) socket.emit('kick_player', { playerId: btn.dataset.kickpid });
});

// Beszédfázisok gombjai a tartalomba építve (nincs külön alsó sáv).
function inlineActions() {
  const role = myRole();
  if (S.phase === 'accusation') {
    return '<div class="inline-actions"><button class="btn big green" id="iaAccRead">Felolvastam!</button></div>';
  }
  const speechPhases = {
    prosecution: { speaker: 'prosecutor', opps: ['defendant', 'defender'] },
    defense: { speaker: 'defendant', opps: ['prosecutor'] },
    defender: { speaker: 'defender', opps: ['prosecutor'] },
    witness: { speaker: 'witness', opps: [] },
    final_prosecution: { speaker: 'prosecutor', opps: ['defendant', 'defender'] },
    final_defense: { speaker: 'defendant', opps: ['prosecutor'] }
  };
  const sp = speechPhases[S.phase];
  if (sp) {
    if (role === sp.speaker) {
      return '<div class="inline-actions"><button class="btn big" id="iaDone">Végeztem</button></div>';
    }
    if (sp.opps.includes(role)) {
      return '<div class="inline-actions"><button class="btn big red" id="iaObject">TILTAKOZOM!</button></div>';
    }
  }
  return '';
}

function renderHeader() {
  $('#gameRound').textContent = S.phase === 'game_over'
    ? 'Végeredmény'
    : (S.round || 1) + '. tárgyalás / ' + S.totalRounds;
  const m = $('#btnMute');
  m.textContent = muted ? '🔇' : '🔊';
  $('#volume').value = volume;
  
  // Mozgás csökkentése kapcsoló felirata (a kapcsoló önmagát frissíti).
  updateReduceMotionBtn();
}

function renderRoleBanner() {
  const el = $('#roleBanner');
  const role = myRole();
  el.className = 'role-banner';
  const labels = {
    defendant: ['A TE FENÉKEDTŐL SZÓL A VÁD!', 'defendant'],
    prosecutor: ['TE VAGY AZ ÜGYÉSZ!', 'prosecutor'],
    defender: ['TE VAGY A VÉDŐÜGYVÉD!', 'defender'],
    witness: ['TE VAGY A MEGLEPETÉS TANÚ!', 'witness'],
    juror: ['TE ESKÜDT VAGY!', 'juror']
  };
  const phaseTitles = {
    lobby: ['Várakozás a tárgyalóteremben', 'neutral'],
    accusation: ['VÁDEMELÉS', 'neutral'],
    prep: ['FELKÉSZÜLÉS', 'neutral'],
    prosecution: ['AZ ÜGYÉSZ BESZÉL', 'prosecutor'],
    defense: ['A VÁDLOTT BESZÉL', 'defendant'],
    defender: ['A VÉDŐÜGYVÉD BESZÉL', 'defender'],
    witness: ['A MEGLEPETÉS TANÚ BESZÉL', 'witness'],
    final_prosecution: ['ZÁRÓSZÓ – AZ ÜGYÉSZ', 'prosecutor'],
    final_defense: ['ZÁRÓSZÓ – A VÁDLOTT', 'defendant'],
    objection: [(S.objectionData && S.objectionData.phase === 'defense') ? 'TILTAKOZÁS – VÉDEKEZÉS' : 'TILTAKOZÁS – DÖNTÉS', 'neutral'],
    verdict_vote: ['SZAVAZÁS!', 'neutral'],
    challenge_vote: ['KIHÍVÁS-ELLENŐRZÉS', 'neutral'],
    challenge_review: ['KIHÍVÁS-ELLENŐRZÉS', 'neutral'],
    verdict: ['ÍTÉLET', 'neutral'],
    round_results: ['KÖR VÉGE', 'neutral'],
    game_over: ['A TÁRGYALÁSOK VÉGE', 'neutral']
  };
  const [title, cls] = phaseTitles[S.phase] || ['…', 'neutral'];
  el.className = 'role-banner ' + cls;
  const speakerOfPhase = {
    prosecution: S.prosecutorId,
    defense: S.defendantId,
    defender: S.defenderId,
    witness: S.witnessId,
    final_prosecution: S.prosecutorId,
    final_defense: S.defendantId
  };
  const speakerId = S.phase === 'objection' ? (S.objectionData?.phase === 'defense' ? S.objectionData.speakerId : S.currentJudgeId) : speakerOfPhase[S.phase];
  // A kör elején (vádolvasás + felkészülés) mindenki látja, ki a kör bírója.
  const showJudgeLine = S.judgeName && (S.phase === 'accusation' || S.phase === 'prep');
  const judgeLine = showJudgeLine
    ? '<div class="rb-judge"><span class="rb-judge-chip" style="--role:var(--gold)">BÍRÓ</span>' +
      '<span class="rb-judge-hammer">🔨</span>Ebben a körben <b>' + escapeHtml(S.judgeName) + '</b> a bíró</div>'
    : '';
  el.innerHTML = '<div class="rb-title">' + title + '</div>' +
    (speakerId ? '<div class="rb-speaker"><span class="rb-avatar">' + avatarEmoji(avatarOf(speakerId)) + '</span>' +
      escapeHtml(nameOf(speakerId)) + '</div>' : '') + judgeLine;
}

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;
let timerTotalCache = { endsAt: 0, ms: 0 };

function timerHtml() {
  if (!S.phaseEndsAt) return '';
  const rem = Math.max(0, S.phaseEndsAt - (Date.now() + serverOffset));
  if (timerTotalCache.endsAt !== S.phaseEndsAt) timerTotalCache = { endsAt: S.phaseEndsAt, ms: Math.max(rem, 1000) };
  const frac = Math.max(0, Math.min(1, rem / timerTotalCache.ms));
  const secs = rem / 1000;
  const cls = secs <= 10 ? 'danger' : secs <= 20 ? 'warn' : '';
  return '<div class="timer-ring ' + cls + '" id="timerBox" data-total="' + timerTotalCache.ms + '">' +
    '<svg viewBox="0 0 118 118"><circle class="tr-bg" cx="59" cy="59" r="' + RING_R + '"/>' +
    '<circle class="tr-fg" cx="59" cy="59" r="' + RING_R + '" stroke-dasharray="' + RING_C + '" stroke-dashoffset="' + (RING_C * (1 - frac)) + '"/></svg>' +
    '<div class="tr-text">' + fmtTime(rem) + '</div></div>';
}

// Segédfüggvény a tiltakozás fázisaihoz: külön gyűrű alakban.
function timerRingHtml(remaining, total, color) {
  const frac = Math.max(0, Math.min(1, remaining / total));
  const secs = remaining / 1000;
  const cls = secs <= 10 ? 'danger' : secs <= 20 ? 'warn' : '';
  return '<div id="timerBox" data-total="' + total + '" class="timer-ring ' + cls + '" style="--ring-color:' + color + '">' +
    '<svg viewBox="0 0 118 118"><circle class="tr-bg" cx="59" cy="59" r="' + RING_R + '"/>' +
    '<circle class="tr-fg" cx="59" cy="59" r="' + RING_R + '" stroke-dasharray="' + RING_C + '" ' +
    'stroke-dashoffset="' + (RING_C * (1 - frac)) + '" ' +
    'style="stroke:' + color + '"/></svg>' +
    '<div class="tr-text">' + fmtTime(remaining) + '</div></div>';
}

function startTimerLoop() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const countdown = $('#autoCountdown');
    if (countdown && S?.autoAdvance) countdown.textContent = countdown.dataset.label + ': ' + Math.max(0, Math.ceil((S.autoAdvance.endsAt - Date.now() - serverOffset) / 1000));
    const box = $('#timerBox');
    if (!box || !S || !S.phaseEndsAt) return;
    const rem = Math.max(0, S.phaseEndsAt - (Date.now() + serverOffset));
    const total = +box.dataset.total || 1;
    const frac = Math.max(0, Math.min(1, rem / total));
    const fg = box.querySelector('.tr-fg');
    if (fg) fg.style.strokeDashoffset = RING_C * (1 - frac);
    const txt = box.querySelector('.tr-text');
    if (txt) txt.textContent = fmtTime(rem);
    const secs = rem / 1000;
    box.className = 'timer-ring ' + (secs <= 10 ? 'danger' : secs <= 20 ? 'warn' : '');
  }, 250);
}

function secretCardsHtml() {
  const role = myRole();
  const you = '<span class="only-you">CSAK TE LÁTOD</span>';
  const cardHtml = (type, cls, text, i) =>
    '<div class="secret-card reveal" style="animation-delay:' + (i * 0.09) + 's">' +
    '<span class="card-type ' + cls + '">' + type + '</span>' +
    '<span class="card-text">' + escapeHtml(text) + '</span>' +
    '<span class="card-stamp">ÜGYIRAT</span></div>';

  if (S.phase === 'prep' && role === 'prosecutor' && S.evidence) {
    return '<div class="cards-heading t-head-evidence">🔐 A TITKOS BIZONYÍTÉKAID</div><div class="role-chip" style="--role:' + ROLE_COLOR.prosecutor + '">ÜGYÉSZ</div>' + you + '<div class="cards-row">' +
      S.evidence.map((e, i) => cardHtml('BIZONYÍTÉK', 't-evidence', e, i)).join('') +
      '</div><p class="next-step">Ezekre építsd a vádbeszédet! A többiek nem látják.</p>';
  }
  if (S.phase === 'prep' && role === 'defendant' && S.alibi) {
    return '<div class="cards-heading t-head-alibi">🔐 A TITKOS ALIBID</div><div class="role-chip" style="--role:' + ROLE_COLOR.defendant + '">VÁDLOTT</div>' + you + '<div class="cards-row">' +
      cardHtml('ALIBI', 't-alibi', S.alibi, 0) + '</div>' +
      '<p class="next-step">Erre építsd a védekezésed! A többiek nem látják.</p>';
  }
  if (S.phase === 'prep' && role === 'defender' && S.tricks) {
    return '<div class="cards-heading t-head-trick">🔐 A TITKOS TRÜKKJEID</div><div class="role-chip" style="--role:' + ROLE_COLOR.defender + '">VÉDŐÜGYVÉD</div>' + you + '<div class="cards-row">' +
      S.tricks.map((t, i) => cardHtml('TRÜKK', 't-trick', t, i)).join('') +
      '</div><p class="next-step">Ezekkel erősítsd a védőbeszédedet! A többiek nem látják.</p>';
  }
  if (S.phase === 'prep' && role === 'witness' && S.witnessCard) {
    return '<div class="cards-heading t-head-witness">🔐 A TITKOS TANÚKÁRTYÁD</div><div class="cards-row">' +
      cardHtml('TANÚ', 't-witness', S.witnessCard, 0) + '</div>';
  }
  return '';
}

function challengeHtmlIfMine() {
  const role = myRole();
  // A kihívás a FELKÉSZÜLÉS alatt mindenkinek megjelenik; a beszédfázisokban
  // az ügyész és a védőügyvéd folyamatosan látja (a vádlotténál a szerver
  // a felkészülés után is elküldi – a KÁRTYÁIM sávban marad).
  const phasesOk = S.phase === 'prep';
  if (S.myChallenge && phasesOk) {
    const lbl = roleLabel(role);
    return '<div class="secret-card single reveal"><span class="card-type t-challenge">🎬 A TITKOS KIHÍVÁSOD</span><span class="card-text">' + escapeHtml(S.myChallenge) +
      '</span><span class="role-chip" style="--role:' + roleColorOf(role) + '">' + lbl + '</span><span class="card-stamp">ÜGYIRAT</span></div>' +
      '<p class="next-step">Ez a te titkos kihívásod – teljesítsd a beszéded közben!</p>';
  }
  return '';
}

function autoCountdownHtml() {
  if (!S.autoAdvance) return S.phase === 'game_over' && S.autoStopped ? '<p class="next-step">Az automatikus új játék megállítva.</p>' : '';
  const kind=S.autoAdvance.kind;
  const label=kind==='new_game' ? 'Új játék' : kind==='verdict' ? 'Következő lépés' : S.roundResults?.hasNextRound===false ? 'Végeredmény' : 'Következő tárgyalás';
  const seconds=Math.max(0,Math.ceil((S.autoAdvance.endsAt-Date.now()-serverOffset)/1000));
  return '<div class="auto-countdown" id="autoCountdown" data-label="'+label+'">'+label+': '+seconds+'</div>';
}

function revealedCardsHtml() {
  const c = S.revealedCards;
  if (!c) return '';
  const items = ['ALIBI: ' + c.alibi, ...c.evidence.map(x=>'BIZONYÍTÉK: '+x), ...c.tricks.map(x=>'TRÜKK: '+x)];
  if (c.witnessCard) items.push('TANÚ: ' + c.witnessCard);
  items.push(...c.challenges.map(x=>'KIHÍVÁS: ' + nameOf(x.id) + ' – ' + x.text));
  return '<details class="revealed-cards"><summary>🎴 AZ ÖSSZES KÁRTYA FELFEDÉSE</summary><div class="revealed-panel">' + items.map(x=>'<p>' + escapeHtml(x) + '</p>').join('') + '</div></details>';
}

function renderPhaseContent() {
  const el = $('#phaseContent');
  const cardsBar=$('#myCardsBar');
  if(el.contains(cardsBar)) $('.game-main').appendChild(cardsBar);
  const role = myRole();
  stopDrumroll();
  let html = '';

  switch (S.phase) {
    case 'accusation': {
      // A kör módja egy kis címkével (melyik pakliból jön minden kártya).
      html = '<p class="next-step">'+(role==='defendant'?'Olvasd fel hangosan a vádat a Discordon!':'Valaki olvassa fel a vádat a Discordon!')+'</p>'+inlineActions();
      break;
    }
    case 'prep': {
      // Kompakt sor: a visszaszámláló MELLETT a titkos kártyák (flex-wrap).
      // A kihívás is itt derül ki mindenki számára (felkészülés alatt látszik).
      html = '<div class="prep-row"><div class="prep-clock">'+timerHtml()+'</div><p class="next-step">Felkészülés – olvasd át a titkos kártyáidat.</p></div>';
      if (role === 'juror') html += '<p class="next-step">Kávészünet az esküdteknek – a felek most készülnek, figyeljetek a reakciókra…</p>';
      else if (role === 'judge' || (S.currentJudgeId && S.currentJudgeId === MY.playerId)) {
        html += '<p class="next-step">👨‍⚖️ Te vagy ebben a körben a BÍRÓ – figyelj a felekre, a kihívásokat később Te értékeled!</p>';
      }
      break;
    }
    case 'prosecution':
    case 'defense':
    case 'defender': {
      // A fázis neve és a beszélő a fázis-sávban szerepel – itt nincs dupla cím.
      const label = S.phase === 'prosecution' ? 'Figyeljetek a vádbeszédre!'
        : S.phase === 'defense' ? 'Figyeljetek a védekezésre!' : 'Figyeljetek a védőügyvédre!';
      html = '<div class="speech-row">' + timerHtml() + inlineActions() + '</div>' +
        challengeHtmlIfMine();
      if (role !== (S.phase === 'prosecution' ? 'prosecutor' : S.phase === 'defense' ? 'defendant' : 'defender')) {
        html += '<p class="next-step">' + label + '</p>';
      }
      break;
    }
    case 'witness': {
      html = '<div class="speech-row">' + timerHtml() + inlineActions() + '</div>';
      if (S.witnessCard && role === 'witness') {
        html += '<div class="cards-heading t-head-witness">🔐 A TITKOS TANÚKÁRTYÁD</div>' +
          '<div class="secret-card single reveal"><span class="card-type t-witness">TANÚ</span><span class="card-text">' + escapeHtml(S.witnessCard) + '</span><span class="role-chip" style="--role:' + ROLE_COLOR.witness + '">TANÚ</span><span class="card-stamp">ÜGYIRAT</span></div>' +
          '<p class="next-step">Ez alapján tegyél vallomást! Te döntöd el, kinek segítesz…</p>';
      } else {
        html += '<p class="next-step">Figyeljünk – vajon kinek segít a tanú?</p>';
      }
      break;
    }
    case 'final_prosecution':
    case 'final_defense': {
      // A "ZÁRÓSZÓ – X" cím és a beszélő neve a fázis-sávban van, itt nem ismételjük.
      html = '<div class="speech-row">' + timerHtml() + inlineActions() + '</div>' +
        challengeHtmlIfMine();
      break;
    }
    case 'verdict_vote': {
      const v = S.verdictVote || {};
      if (v.canVote) {
        // Leadott szavazat kiemelve (pipa + glow), a másik halványítva.
        const voted = v.myVote === 'guilty' || v.myVote === 'not_guilty';
        html = '<div class="vote-buttons">' +
          '<button class="vote-btn guilty ' + (v.myVote === 'guilty' ? 'chosen' : '') + (voted && v.myVote !== 'guilty' ? ' faded' : '') + '" id="voteGuilty" ' + (voted ? 'disabled' : '') + '>BŰNÖS</button>' +
          '<button class="vote-btn not-guilty ' + (v.myVote === 'not_guilty' ? 'chosen' : '') + (voted && v.myVote !== 'not_guilty' ? ' faded' : '') + '" id="voteNotGuilty" ' + (voted ? 'disabled' : '') + '>ÁRTATLAN</button>' +
          '</div><p class="next-step">Titkosan szavazol: bűnös vagy ártatlan?</p>';
      } else {
        html = '<div class="drumroll">DOBPERGÉS…</div>' +
          '<p class="next-step">' + (role === 'defendant' ? 'Most derül ki, meggyőzött-e a védekezésed…'
            : 'Az esküdtek szavaznak…') + '</p>';
      }
      if (typeof v.votedCount === 'number') {
        html += '<div class="vote-status">Szavazatok: ' + v.votedCount + ' / ' + v.voterCount + '</div>';
      }
      break;
    }
    case 'objection': {
      // TILTAKOZOM! - a bíró döntési fázisa
      const od = S.objectionData || {};
      // Ha nincs merkez, elavul (a szerver újból küldi a state-et)
      if (!od.objectorName) { html = '<p>…</p>'; break; }

      const speakerIsPros = (S.phase === 'objection' && od.kind && (od.kind === 'prosecution' || od.kind === 'final_prosecution'));
      const speakerName = escapeHtml(od.speakerName || nameOf(od.speakerId));
      const objectorName = escapeHtml(od.objectorName || '?');
      const judgeName = escapeHtml(od.judgeName || S.judgeName || '?');

      // Fázis: védekezés / döntés / eredmény
      if (od.phase === 'defense') {
        // B) Védekezés: a beszélő 20 mp-öt kap
        const remaining = Math.max(0, od.defenderEndsAt - (Date.now() + serverOffset));
        html = '<div class="objection-phase">' +
          '<div class="objection-phase-sub">' + objectorName + ' (' + (speakerIsPros ? 'VÁDLOTT' : 'VÉDŐ') + ') tiltakozik ' + speakerName + '-on (' + (speakerIsPros ? 'ÜGYÉSZ' : 'VÁDLOTT') + ')</div>' +
          '<div class="objection-timer">' + timerRingHtml(remaining, 20000, ROLE_COLOR.defendant) + '</div>' +
          '<div class="objection-instruction">' + speakerName + ', 20 másodperced van, hogy megvédjed magad a Discordon!</div>' +
          '<button class="btn big green" id="iaDone">VÉGEZTEM ✓</button>' +
          '</div>';
      } else if (od.phase === 'judge') {
        hideObjectionOverlay(); // a döntési szakaszban semmi nem takarhatja a gombokat
        // C) Döntés: a bíró dönt
        const remaining = Math.max(0, od.judgeEndsAt - (Date.now() + serverOffset));
        const iAmJudge = S.currentJudgeId === MY.playerId;
        html = '<div class="objection-phase">' +
          '<div class="objection-phase-sub">A bíró döntsön: jogos volt-e ' + objectorName + '-nak tiltakozni?</div>' +
          '<div class="objection-rule">JOGOS: +30 mp a tiltakozónak a következő beszédéhez · NEM JOGOS: −30% a tiltakozó következő beszédéből</div>' +
          '<div class="objection-timer">' + timerRingHtml(remaining, 15000, '#f2c14e') + '</div>';
        if (iAmJudge) {
          html += '<div class="objection-buttons">' +
            '<button class="btn big green" id="objAccept">JOGOS ✓</button>' +
            '<button class="btn big red" id="objReject">NEM JOGOS ✗</button>' +
            '</div>';
        } else {
          html += '<div class="objection-waiting">⏳ <b>' + judgeName + '</b> a bíró alkalmazza a kalapácsot…</div>';
        }
        html += '</div>';
      } else if (od.phase === 'result') {
        // D) Eredmény
        const accepted = od.accepted;
        html = '<div class="objection-phase">' +
          '<div class="objection-result' + (accepted ? ' accepted' : ' rejected') + '">' + (accepted ? 'JOGOS!' : 'NEM JOGOS!') + '</div>' +
          '<div class="objection-phase-sub">' + (accepted
            ? objectorName + ' +30 mp-et kap a következő beszédéhez'
            : objectorName + ' elveszíti a következő beszédének 30%-át') + '</div>' +
          '</div>';
      }
      break;
    }
    case 'challenge_review': {
      // KIHÍVÁS-ELLENŐRZÉS: a bíró dönt kártyánként; a többiek csak szórakoznak.
      // (A fázis címe a fázis-sávban van – itt csak a számláló chip.)
      const rev = S.challengeReview || { challenges: [] };
      const ch = rev.challenges[rev.current] || rev.challenges[0];
      if (!ch) { html = '<div class="drumroll">Nincs kihívás…</div>'; break; }
      const col = { prosecutor: ROLE_COLOR.prosecutor, defendant: ROLE_COLOR.defendant, defender: ROLE_COLOR.defender }[ch.who] || '#f2c14e';
      html = '<div class="review-summary"><div class="review-counter"><span>' + (rev.current + 1) + ' / ' + rev.total + '</span></div>' +
        '<div class="review-note">Ebben az ügyben <b>' + escapeHtml(ch.judgeName) + '</b> a bíró</div></div>' +
        '<div class="review-card" style="--role:' + col + '">' +
        '<span class="card-type" style="background:' + col + '">' + (WHO_LABEL[ch.who] || '').toUpperCase() + ' KIHÍVÁSA' +
        (ch.difficulty ? ' – NEHEZÍTÉS (dupla pont)' : '') + '</span>' +
        '<span class="review-text">„' + escapeHtml(ch.text) + '”</span>' +
        '<span class="review-who">Kihívást kapott: <b>' + escapeHtml(ch.name) + '</b></span>' +
        (ch.noted ? '<span class="review-noted">✔ A bíró beszéd közben jelölte: ÉSZREVETTEM</span>' : '') +
        '<span class="card-stamp">ÜGYIRAT</span></div>';
      if (ch.iAmJudge && !ch.judged) {
        html += '<div class="review-buttons">' +
          '<button class="btn big green" id="rvDone">TELJESÍTETTE ✓</button>' +
          '<button class="btn big red" id="rvFail">NEM SIKERÜLT ✗</button></div>';
      } else if (ch.judged) {
        html += '<div class="review-result ' + (ch.done ? 'ok' : 'no') + '">' +
          (ch.done ? 'A bíró szerint TELJESÍTETTE ✓ (+' + (ch.difficulty ? 4 : 2) + ' pont)' : 'A bíró szerint NEM sikerült ✘') + '</div>';
      } else {
        html += '<p class="next-step">⏳ <b>' + escapeHtml(ch.judgeName) + '</b> gondolkodik… (20 mp után automatikusan „nem sikerült”)</p>';
      }
      // Szórakoztató 😂/👎 szavazás – pontot nem ad.
      const myFun = (myFunVotes[ch.who] !== undefined);
      html += '<div class="fun-vote">Szórakozásul: ' +
        '<button class="btn small' + (myFun && myFunVotes[ch.who] === true ? ' green' : '') + '" data-fun="1" ' + (myFun ? 'disabled' : '') + '>😂</button>' +
        '<button class="btn small' + (myFun && myFunVotes[ch.who] === false ? ' red' : '') + '" data-fun="0" ' + (myFun ? 'disabled' : '') + '>👎</button>' +
        '<span class="fun-counts">😂 ' + ch.funYes + ' · 👎 ' + ch.funNo + '</span></div>';
      break;
    }
    case 'challenge_vote': {
      const cv = S.challengeVote || {};
      // A fázis címe ("KIHÍVÁS-ELLENŐRZÉS") a fázis-sávban van – itt csak a kérdés.
      html = '<p class="next-step">Teljesítették-e a kihívásaikat?</p>';
      const whoLabel = { prosecutor: 'Az ügyész', defendant: 'A vádlott', defender: 'A védőügyvéd' };
      (cv.challenges || []).forEach((ch, i) => {
        html += '<div class="challenge-results"><div class="cr"><b>' + whoLabel[ch.who] + ' kihívása' +
          (ch.difficulty ? ' (NEHEZÍTÉS – dupla pont!)' : '') + ':</b> ' + escapeHtml(ch.text) + '</div>';
        if (cv.canVote) {
          // A saját szavazatod kiemelve (a szerver myVotes-ban küldi vissza); módosítható.
          const mine = cv.myVotes ? cv.myVotes[ch.who] : undefined;
          const cvCls = (yes) => ' cv-btn' + (mine === yes ? ' chosen' : '') + (mine !== undefined && mine !== yes ? ' faded' : '');
          html += '<div style="margin:6px 0">Teljesítette? ' +
            '<button class="btn green' + cvCls(true) + '" id="cv' + i + 'Yes" aria-pressed="' + (mine === true) + '">IGEN</button> ' +
            '<button class="btn red' + cvCls(false) + '" id="cv' + i + 'No" aria-pressed="' + (mine === false) + '">NEM</button></div>';
        }
        html += '</div>';
      });
      if (!cv.canVote) html += '<p class="next-step">Az esküdtek döntenek…</p>';
      if (cv.voterCount) {
        const minCount = Math.min(...(cv.challenges || []).map((c) => (cv.counts || {})[c.who] || 0));
        html += '<div class="vote-status">Szavazatok: ' + minCount + ' / ' + cv.voterCount + '</div>';
      }
      // gomb-kötések az új gombokhoz
      setTimeout(() => {
        (cv.challenges || []).forEach((ch, i) => {
          const y = $('#cv' + i + 'Yes');
          const n = $('#cv' + i + 'No');
          if (y) y.addEventListener('click', () => socket.emit('vote_challenge', { who: ch.who, done: true }));
          if (n) n.addEventListener('click', () => socket.emit('vote_challenge', { who: ch.who, done: false }));
        });
      }, 0);
      break;
    }
    case 'verdict': {
      const v = S.verdict || {};
      if (!v || v.guilty === undefined) { html = '<div class="drumroll">A BÍRÓSÁG GONDOLKOZIK…</div>'; break; }
      // Egy képernyős ítélet: felül görgethető tartalom, alul fix TOVÁBB gombsor.
      // A győztes oldal (BŰNÖS = piros / ÁRTATLAN = zöld) saját színben világít.
      html = '<div class="verdict-scroll">' +
        '<div class="verdict-title winner-glow ' + (v.guilty ? 'guilty' : 'not-guilty') + '">' + (v.guilty ? 'BŰNÖS!' : 'ÁRTATLAN!') + '</div>';
      html += '<div class="case-row">' +
        (S.modeName ? '<span class="mode-chip">' + escapeHtml(S.modeName) + '</span>' : '') + '</div>';
      html += '<div class="vote-list">' + (v.votes || []).map((vv) =>
        '<span class="vote-chip ' + (vv.verdict || '') + (vv.jurorPoint ? ' point-gain' : '') + '">' + avatarEmoji(avatarOf(vv.voterId)) + ' ' +
        escapeHtml(vv.voterName) + ': ' + (vv.verdict === 'guilty' ? 'BŰNÖS' : vv.verdict === 'not_guilty' ? 'ÁRTATLAN' : '—') +
        (vv.jurorPoint ? '<b class="juror-plus">+1</b>' : '') + '</span>'
      ).join('') + '</div>';
      html += '<div class="sentence-card">' + escapeHtml(v.sentence) + '<span class="sentence-stamp">ÍTÉLET</span></div>';
      if (v.unanimous) html += '<div class="favorite-note">EGYHANGÚ ÍTÉLET – bónusz pont!</div>';
      if (Array.isArray(v.challengeResults) && v.challengeResults.length > 0) {
        html += '<div class="challenge-results">' + v.challengeResults.map((c) =>
          '<div class="cr"><b>' + (WHO_LABEL[c.who] || c.who) + '</b> kihívása: „' + escapeHtml(c.text) + '” – ' +
          '<span class="' + (c.done ? 'ok' : 'no') + '">' + (c.done ? 'TELJESÍTETTE ✔ (+' + c.points + ' pont)' : 'NEM sikerült ✘') + '</span>' +
          (c.mode === 'judge' && c.judgeName ? ' <i>– bíró: ' + escapeHtml(c.judgeName) + '</i>' : ' (' + (c.yes || 0) + '/' + c.voterCount + ')') + '</div>'
        ).join('') + '</div>';
      }
      html += '</div>'; // verdict-scroll vége
      html += '<div class="fixed-actions">' +
        '<button class="btn big" id="btnProceed" ' + (S.hostId === MY.playerId ? '' : 'disabled') + '>Tovább</button> ' +
        '<button class="btn small ghost" id="btnRecord">Jegyzőkönyv letöltése</button></div>';
      const flashKey = 'v:' + (S.caseNo || '') + ':' + (S.round || '') + ':' + (v.guilty ? 'g' : 'a');
      if (lastVerdictFlash !== flashKey) {
        lastVerdictFlash = flashKey;
        html += '<div class="verdict-flash ' + (v.guilty ? 'flash-red' : 'flash-green') + '"></div>';
      }
      break;
    }
    case 'round_results': {
      const r = S.roundResults || {};
      html = '<div class="results-scroll">';
      if (r.favorite) {
        html += '<div class="favorite-note">Közönségkedvenc: ' + escapeHtml(r.favorite.name) + ' (' + r.favorite.laughs + ' nevetés) – bónusz pont!</div>';
      }
      html += revealedCardsHtml();
      html += '<div class="score-table compact">' + (r.scores || []).map((p, i) =>
        '<div class="score-row' + (p.id === MY.playerId ? ' me' : '') + '"><span>' + (i + 1) + '. ' +
        avatarEmoji(p.avatar) + ' ' + escapeHtml(p.name) + '</span><span class="pts">' + p.score + ' pont</span></div>'
      ).join('') + '</div></div>';
      if (r.hasNextRound) {
        html += S.hostId === MY.playerId
          ? '<div class="fixed-actions"><button class="btn big" id="btnNextRound">KÖVETKEZŐ TÁRGYALÁS</button></div>'
          : '<p class="next-step">Várakozás, míg a házigazda elindítja a következő tárgyalást…</p>';
      } else {
        html += '<p class="next-step">Ez volt az utolsó tárgyalás – jön a végeredmény!</p>';
        if (S.hostId === MY.playerId) html += '<div class="fixed-actions"><button class="btn big" id="btnNextRound">VÉGEREDMÉNY</button></div>';
      }
      break;
    }
    case 'game_over': {
      const go = S.gameOver || { ranking: [], awards: {} };
      // Ranglista + díjak görgethetően, a gombok fixen látszanak alul.
      // A 3 legjobb: arany (pulzáló) / ezüst / bronz glow a kártya körül.
      const podium = ['gold', 'silver', 'bronze'];
      html = '<div class="results-scroll"><div class="score-table compact">' + (go.ranking || []).map((p, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
        const glow = podium[i] ? ' podium-' + podium[i] : '';
        return '<div class="score-row' + (p.id === MY.playerId ? ' me' : '') + glow + '"><span>' + medal + ' ' +
          avatarEmoji(p.avatar) + ' ' + escapeHtml(p.name) + '</span><span class="pts">' + p.score + ' pont</span></div>';
      }).join('') + '</div>';
      const a = go.awards || {};
      const cards = [a.bestLawyer, a.biggestCriminal, a.audienceFavorite, a.challengeChampion].filter(Boolean);
      if (cards.length) {
        html += '<div class="awards">' + cards.map((c) =>
          '<div class="award-card podium-gold"><span class="emoji">' + c.emoji + '</span>' +
          '<span class="award-name">' + escapeHtml(c.award) + '</span><span class="who">' + escapeHtml(c.name) + '</span></div>'
        ).join('') + '</div>';
      }
      html += '</div>'; // results-scroll vége
      html += '<div class="fixed-actions">';
      if (S.hostId === MY.playerId) {
        html += '<button class="btn big" id="btnNewGame">ÚJ JÁTÉK MOST</button>';
        if (S.autoAdvance) html += '<button class="btn small ghost" id="btnStopAuto">MEGÁLLÍT</button>';
      }
      html += '<button class="btn small ghost" id="btnLeaveAfter">KILÉPÉS</button></div>';

      break;
    }
    default:
      html = '<p>…</p>';
  }
  html += autoCountdownHtml();
  // A kártyák (alibi, bizonyíték, trükk, tanúkártya, kihívás) a KÁRTYÁIM sávban végig látszanak.
  el.dataset.phase = S.phase;
  el.innerHTML = html;
  el.classList.toggle('enter', S.phase !== lastRenderedPhase);
  lastRenderedPhase = S.phase;
  updateJudgeBubble(JUDGE_LINES[S.phase] || '');

  // gomb-kötések
  const voteG = $('#voteGuilty');
  if (voteG) voteG.addEventListener('click', () => socket.emit('vote_verdict', { verdict: 'guilty' }));
  const voteNG = $('#voteNotGuilty');
  if (voteNG) voteNG.addEventListener('click', () => socket.emit('vote_verdict', { verdict: 'not_guilty' }));
  const accRead = $('#iaAccRead');
  if (accRead) accRead.addEventListener('click', () => socket.emit('accusation_read'));
  const iaDone = $('#iaDone');
  if (iaDone) iaDone.addEventListener('click', () => socket.emit(S.phase === 'objection' ? 'objection_defense_done' : 'done_speaking'));
  const iaObj = $('#iaObject');
  if (iaObj) iaObj.addEventListener('click', () => socket.emit('objection'));
  // TILTAKOZÁS: védekezés vége / bíró döntés
  const objAccept = $('#objAccept');
  if (objAccept) objAccept.addEventListener('click', () => socket.emit('objection_judge_decision', { accepted: true }));
  const objReject = $('#objReject');
  if (objReject) objReject.addEventListener('click', () => socket.emit('objection_judge_decision', { accepted: false }));
  // kihívás-ellenőrzés: a bíró döntése (a szerver ellenőrzi a személyazonosságát)
  const rvDone = $('#rvDone');
  if (rvDone) rvDone.addEventListener('click', () => {
    const rev = S.challengeReview || {};
    const ch = (rev.challenges || [])[rev.current];
    if (ch) socket.emit('challenge_decision', { who: ch.who, done: true });
  });
  const rvFail = $('#rvFail');
  if (rvFail) rvFail.addEventListener('click', () => {
    const rev = S.challengeReview || {};
    const ch = (rev.challenges || [])[rev.current];
    if (ch) socket.emit('challenge_decision', { who: ch.who, done: false });
  });
  el.querySelectorAll('[data-fun]').forEach((b) => {
    b.addEventListener('click', () => {
      const rev = S.challengeReview || {};
      const ch = (rev.challenges || [])[rev.current];
      if (ch) { myFunVotes[ch.who] = b.dataset.fun === '1'; socket.emit('challenge_fun_vote', { who: ch.who, done: myFunVotes[ch.who] }); renderPhaseContent(); }
    });
  });
  // (a kihívás-szavazásgombok a challenge_vote ágban kötődnek meg)
  const proceed = $('#btnProceed');
  if (proceed) proceed.addEventListener('click', () => socket.emit('proceed_after_verdict'));
  const recordBtn = $('#btnRecord');
  if (recordBtn) recordBtn.addEventListener('click', downloadRecord);
  const nextR = $('#btnNextRound');
  if (nextR) nextR.addEventListener('click', () => socket.emit('next_round'));
  const newG = $('#btnNewGame');
  if (newG) newG.addEventListener('click', () => {
    LS.setItem('kb_code', MY.code);
    socket.emit('new_game');
  });
  const stopAuto = $('#btnStopAuto');
  if (stopAuto) stopAuto.addEventListener('click', () => socket.emit('stop_auto_game'));
  const leaveAfter = $('#btnLeaveAfter');
  if (leaveAfter) leaveAfter.addEventListener('click', async () => {
    const ok = await confirmDialog('Biztosan kilépsz a szobából?');
    if (ok) leaveToMenu();
  });

  // dobpergés a szavazás alatt (ha én esküdt vagyok és már szavaztam, vagy nem én szavazok)
  if (S.phase === 'verdict_vote') startDrumroll();

  startTimerLoop();
}

// (A régi alsó akció-sáv és játékos-sáv megszűnt: az akciók a tartalomba
// épülnek (inlineActions), a játékosok/pontok a jobb oldali ponttáblán élnek.)

// Saját 😂/👎 szórakoztató szavazataim a kihívás-ellenőrzéshez.
const myFunVotes = {};

// ============================================================
// Reakciók, tiltakozás, rend
// ============================================================

$$('.react-btn').forEach((b) => {
  b.addEventListener('click', () => {
    ensureAudio();
    $$('.react-btn').forEach(el => el.classList.toggle('chosen', el === b));
    socket.emit('react', { emoji: b.dataset.emoji });
  });
});

$('#btnOrder').addEventListener('click', () => {
  socket.emit('order_in_court');
});

function flyEmoji(emoji) {
  const layer = $('#reactionLayer');
  const el = document.createElement('div');
  el.className = 'flying-emoji';
  el.textContent = emoji;
  const startX = Math.random() * 70 + 15;
  const fromLeft = Math.random() < 0.5;
  el.style.left = (fromLeft ? -10 : 90) + 'vw';
  el.style.top = (60 + Math.random() * 30) + 'vh';
  el.style.setProperty('--dx', (fromLeft ? 1 : -1) * (40 + Math.random() * 50) + 'vw');
  el.style.setProperty('--dy', -(50 + Math.random() * 40) + 'vh');
  el.style.setProperty('--rot', (Math.random() * 80 - 40) + 'deg');
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1700);
  SFX.reaction(['😂', '💀', '🤡', '🔥', '👏'].indexOf(emoji));
}

function judgeSmash() {
  if(INTENTIONAL_LEAVE || KICKED_FROM_ROOM || !S) return;
  const j = $('#judge');
  j.classList.remove('smash');
  void j.offsetWidth; // reflow az animáció újraindításához
  j.classList.add('smash');
  SFX.gavel();
  // A bíró figurája megrázkódik a saját PNG-jével.
  charAnim.judgeShake();
}

let objectionOverlayTimer = null;
function hideObjectionOverlay() {
  clearTimeout(objectionOverlayTimer);
  $('#objectionOverlay').classList.add('hidden');
}

function showObjection(name, byPid) {
  $('#objectionName').textContent = '— ' + name + ' —';
  $('#objectionOverlay').classList.remove('hidden');
  // A felirat 5 mp után eltűnik, hogy a bíró lássa és használhassa a döntési gombokat.
  clearTimeout(objectionOverlayTimer);
  objectionOverlayTimer = setTimeout(hideObjectionOverlay, 5000);
  SFX.objection();
  SFX.whisper();
  // Karakteranimáció: a tiltakozó röviden felpattan.
  if (byPid) {
    charAnim.objectionPopup(byPid);
  }
}

// A tiltakozás következménye emberi nyelven (a szerver jegyzőkönyvi bejegyzéséből).
function objectionConsequence(x) {
  if (!x) return '';
  const o = escapeHtml(x.objectorName || '');
  if (x.accepted) return x.bonusMs ? '+' + (x.bonusMs / 1000) + ' mp ' + o + ' következő beszédéhez' : o + '-nak nincs több beszéde, nincs jutalom';
  return x.deductionMs ? '−30% (' + (x.deductionMs / 1000) + ' mp) ' + o + ' következő beszédéből' : o + '-nak nincs több beszéde, nincs levonás';
}

function showRuling(accepted, ruling, objectorName, speakerName, judgeName, data) {
  const bubble = $('#judgeBubble');
  if (bubble) {
    const detail = objectorName && speakerName
      ? '<div style="font-size:12px;margin-top:4px">' + escapeHtml(objectorName) + ' tiltakozott ' + escapeHtml(speakerName) + '-on – ' + (judgeName ? 'bíró: ' + escapeHtml(judgeName) : '') + '</div>' +
        '<div style="font-size:12px;margin-top:2px">' + objectionConsequence(data) + '</div>'
      : '';
    bubble.innerHTML = (accepted
      ? '⚖️ <b class="rb-ok">JOGOS!</b>„'
      : '⚖️ <b class="rb-no">NEM JOGOS!</b>„') + escapeHtml(ruling) + '”' + detail;
    bubble.classList.remove('flash');
    void bubble.offsetWidth;
    bubble.classList.add('flash');
  }
  setTimeout(() => {
    $('#objectionOverlay').classList.add('hidden');
    judgeSmash();
    if (accepted) SFX.accepted(); else SFX.rejected();
  }, 1500);
}

function confettiBurst(n) {
  if (charAnim.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = $('#confettiLayer');
  const colors = ['#e5484d', '#ec5f64', '#f5a524', '#e8e8ea', '#8b90a0'];
  for (let i = 0; i < (n || 120); i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = (2 + Math.random() * 2.5) + 's';
    c.style.animationDelay = Math.random() * 0.8 + 's';
    c.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
    layer.appendChild(c);
    setTimeout(() => c.remove(), 5500);
  }
}

function showUnanimous() {
  $('#unanimousOverlay').classList.remove('hidden');
  confettiBurst(80);
  SFX.fanfare();
  setTimeout(() => $('#unanimousOverlay').classList.add('hidden'), 2200);
}

// ============================================================
// Jegyzőkönyv (canvas → PNG letöltés)
// ============================================================

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line + w + ' ';
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, yy);
      line = w + ' ';
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line.trim()) ctx.fillText(line.trim(), x, yy);
  return yy + lh;
}

function downloadRecord() {
  const v = S.verdict || S.roundResults?.verdict || {};
  const r = S.roundResults || {};
  const extra = ['Bíró: ' + (S.judgeName || '?')];
  (v.challengeResults || []).forEach(x=>extra.push('Kihívás: ' + x.name + ' – ' + x.text + ' – ' + (x.done ? 'sikerült' : 'nem sikerült') + ', bíró: ' + (x.judgeName || S.judgeName)));
  (S.objectionLog || []).forEach(x=>extra.push('Tiltakozás: ' + x.objectorName + ' → ' + x.speakerName + ', ' + (x.accepted ? 'JOGOS' : 'NEM JOGOS') + ', bíró: ' + x.judgeName + ', ' + (x.bonusMs ? 'jutalom: +' + x.bonusMs / 1000 + ' mp' : 'levonás: ' + x.deductionMs / 1000 + ' mp (30%)') + (x.timedOut ? ' (időtúllépés)' : '')));
  if (S.revealedCards) {
    const c=S.revealedCards;
    extra.push('ALIBI: ' + c.alibi, ...c.evidence.map(x=>'BIZONYÍTÉK: '+x), ...c.tricks.map(x=>'TRÜKK: '+x));
    if(c.witnessCard) extra.push('TANÚ: ' + c.witnessCard);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 1000 + extra.reduce((n, text) => n + Math.ceil(text.length / 44) * 34, 0);
  const ctx = canvas.getContext('2d');

  // háttér
  ctx.fillStyle = '#fdf6e3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#6d4c41';
  ctx.lineWidth = 10;
  ctx.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);
  ctx.fillStyle = '#6d4c41';
  ctx.fillRect(40, 40, canvas.width - 80, 110);
  ctx.fillStyle = '#ffc107';
  ctx.font = 'bold 44px Trebuchet MS';
  ctx.textAlign = 'center';
  ctx.fillText('⚖️ KAMU BÍRÓSÁG – JEGYZŐKÖNYV ⚖️', canvas.width / 2, 110);

  ctx.fillStyle = '#26221c';
  ctx.textAlign = 'left';
  let y = 200;
  ctx.font = 'bold 26px Trebuchet MS';
  y = wrapText(ctx, 'Ügyszám: ' + (S.caseNo || '-') + '   •   ' + S.round + '. tárgyalás', 60, y, canvas.width - 120, 34);
  ctx.font = '24px Trebuchet MS';
  y = wrapText(ctx, 'Mód: ' + (S.modeName || '—') + (S.isCustom ? ' (SAJÁT VÁD)' : ''), 60, y, canvas.width - 120, 32);
  ctx.fillStyle = '#6d4c41';
  y = wrapText(ctx, 'Vád: ' + (S.accusationText || ''), 60, y, canvas.width - 120, 32);
  ctx.fillStyle = '#26221c';
  y = wrapText(ctx, 'Ügyész: ' + nameOf(S.prosecutorId), 60, y, canvas.width - 120, 32);
  y = wrapText(ctx, 'Vádlott: ' + nameOf(S.defendantId), 60, y, canvas.width - 120, 32);
  y = wrapText(ctx, 'Ítélet: ' + (v.guilty ? 'BŰNÖS (' + (v.guiltyVotes || 0) + ' bűnös / ' + (v.notGuiltyVotes || 0) + ' ártatlan)' + (v.unanimous ? ' – EGYHANGÚ' : '') : 'FELMENTVE (' + (v.notGuiltyVotes || 0) + ' ártatlan / ' + (v.guiltyVotes || 0) + ' bűnös)' + (v.unanimous ? ' – EGYHANGÚ' : '')), 60, y, canvas.width - 120, 32);

  if (v.guilty) {
    ctx.fillStyle = '#b71c1c';
    y = wrapText(ctx, 'Büntetés: ' + (v.sentence || ''), 60, y, canvas.width - 120, 32);
  } else {
    ctx.fillStyle = '#2e7d32';
    y = wrapText(ctx, 'Felmentő ítélet: ' + (v.sentence || ''), 60, y, canvas.width - 120, 32);
  }

  ctx.fillStyle = '#26221c';
  for (const line of extra) y = wrapText(ctx, line, 60, y, canvas.width - 120, 32);

  if (r.favorite) {
    ctx.fillStyle = '#8d5b00';
    y = wrapText(ctx, '😂 Közönségkedvenc: ' + r.favorite.name + ' (' + r.favorite.laughs + ' reakció)', 60, y, canvas.width - 120, 32);
  }

  ctx.fillStyle = '#26221c';
  y = wrapText(ctx, 'Szavazatok: ' + (v.votes || []).map((vv) => vv.voterName + ': ' + (vv.verdict === 'guilty' ? 'bűnös' : 'ártatlan')).join(', '), 60, y, canvas.width - 120, 30);

  ctx.font = '18px Trebuchet MS';
  ctx.fillStyle = '#8d6e63';
  ctx.textAlign = 'center';
  ctx.fillText('Készült a Kamu Bíróság online tárgyalótermében • ' + new Date().toLocaleString('hu-HU'), canvas.width / 2, canvas.height - 45);

  const link = document.createElement('a');
  link.download = 'kamu-birosag-jegyzokonyv-' + (S.caseNo || '') + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ============================================================
// Szerver események
// ============================================================

let lastPhase = null;

// Szerveri figyelmeztetés (pl. nincs kiválasztott ügyiratmappa, belső hiba).
socket.on('host_warning', (data) => {
  showToast((data && data.message) || '⚠️ Hiba történt.');
});

// Házigazda-átadás jelzése: "X lett a házigazda" (kilépés/kiesés miatt).
socket.on('host_changed', (data) => {
  if (data && data.reason === 'lept') {
    showToast('👑 ' + (data.newHostName || '?') + ' lett a házigazda (az előző kilépett).');
  }
});

// Körbíró-csere jelzése: "Új bíró: X" (a bíró kiesett, átadták a szerepét).
socket.on('judge_changed', (data) => {
  if (data) showToast('🔨 Új bíró: ' + data.judgeName);
});

// Szerepátadás: "X szerepe Y-ra átment" (kiesett/kirúgták a szereplőt).
socket.on('role_handed_over', (data) => {
  if (!data) return;
  const who = { prosecutor: 'az ügyész', defendant: 'a vádlott', defender: 'a védőügyvéd', witness: 'a tanú' }[data.role] || data.role;
  showToast('🔁 ' + who + ' szerepe átkerült: ' + data.toName);
});

// Kirúgás jelzése mindenkinek.
socket.on('player_kicked', (data) => {
  if (data) showToast('⚖️ ' + data.name + '-t kirúgták a tárgyalásról.');
});

// Engem kirúgtak: üzenet + vissza a menübe, a kód törlése (nincs auto-visszaújrás).
let KICKED_FROM_ROOM = false;
socket.on('you_are_kicked', (data) => {
  KICKED_FROM_ROOM = true;
  INTENTIONAL_LEAVE = true;
  sessionStorage.setItem('kb_left','1');
  clearTimeout(rejoinTimer);
  clearInterval(timerInterval);
  timerInterval = null;
  clearInterval(goneTimerInterval);
  goneTimerInterval = null;
  stopDrumroll();
  charAnim.prune(new Set());
  charAnim.stopLoop();
  cancelChargeIntro();
  lastSceneRoles=null;lastCharge=null;chargeCaseKey='';
  S = null;
  MY.code = null;
  LS.removeItem('kb_code');
  hideConnBar();
  stopTicker();
  showToast('⛔ ' + ((data && data.message) || 'A házigazda kirúgott a szobából.'));
  show('menu');
});

// ============================================================
// KAPCSOLAT-FIGYELŐ (online üzem)
// - megszakadásnál sáv: "Kapcsolat megszakadt, újracsatlakozás…"
// - a socket.io automatikusan újrapróbálkozik (reconnection)
// - sikeres újracsatlakozásnál a kliens az ÁLLANDÓ playerAzonosítóval
//   visszajelentkezik a szobába → a szoba és a játék állapota (vád, fázis,
//   visszaszámlálás) a state-ben visszatér
// - ha a szerver újraindult (a szobák elvesztek), érthető hiba + vissza a menübe
// ============================================================

let everConnected = false;
let rejoinTimer = null;

function showConnBar(text) {
  let bar = document.getElementById('connBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'connBar';
    document.body.appendChild(bar);
  }
  if (bar.textContent !== text) bar.textContent = text;
  bar.classList.add('visible');
}
function hideConnBar() {
  const bar = document.getElementById('connBar');
  if (bar) bar.classList.remove('visible');
}

socket.on('connect', () => {
  hideConnBar();
  if (INTENTIONAL_LEAVE || KICKED_FROM_ROOM) return;
  if (!everConnected) { everConnected = true; return; }
  if (!IDENTITY_READY) return;
  // Újracsatlakozás: ha volt szobánk, kérjük vissza az állapotot.
  clearTimeout(rejoinTimer);
  rejoinTimer = setTimeout(() => {
    if (!IDENTITY_READY || !MY.code || INTENTIONAL_LEAVE || KICKED_FROM_ROOM) return; // nem voltunk szobában – nincs teendő
    socket.emit('join_room', {
      code: MY.code, name: MY.name, avatar: MY.avatar,
      playerId: MY.playerId, sessionToken: MY.sessionToken, profile: myProfilePayload()
    }, (res) => {
      if (res && res.error) {
        // A szerver újraindult (a szobák memóriában élnek és elvesztek):
        // érthető hiba, tiszta állapot, vissza a menübe.
        MY.code = null;
        LS.removeItem('kb_code');
        show('menu');
        const errEl = document.querySelector('#menuError');
        if (errEl) errEl.textContent = '⚠️ ' + res.error;
        showToast('⚠️ ' + res.error);
      }
      // Sikeres válasz esetén a socket.on('state') handler rajzolja újra a játékot.
    });
  }, 400);
});

socket.on('disconnect', () => {
  if (!INTENTIONAL_LEAVE && !KICKED_FROM_ROOM && MY.code) showConnBar('Kapcsolat megszakadt, újracsatlakozás…');
});

socket.on('connect_error', () => {
  // A szerver épp nem elérhető (pl. az ingyenes tárhely "alszik", vagy hálózati hiba).
  showConnBar('Nem sikerül a kapcsolat… újrapróbálkozás…');
});

socket.on('state', (state) => {
  if (!IDENTITY_READY || INTENTIONAL_LEAVE || KICKED_FROM_ROOM) return; // belépésre várunk, kiléptünk vagy kirúgtak
  serverOffset = state.serverNow - Date.now();
  if (state.caseNo && state.caseNo !== renderPhaseContent._case) {
    renderPhaseContent._case = state.caseNo;
    for (const k of Object.keys(myFunVotes)) delete myFunVotes[k]; // új kör – fun-szavazatok törlése
  }
  S = state;
  if (!state.players.find((p) => p.id === MY.playerId)) {
    // nem vagyunk benne a szobában
    return;
  }
  startGoneTimers();
  if (state.phase === 'lobby') {
    show('lobby');
    renderLobby();
    if (state.lobbyNotice && renderLobby._lastNotice !== state.lobbyNotice) {
      renderLobby._lastNotice = state.lobbyNotice;
      showToast('ℹ️ ' + state.lobbyNotice);
    }
  } else {
    show('game');
    renderGame();
    // PNG-k előtöltése a tárgyalás elején, majd a közös animációs ciklus.
    preloadCharacterImages();
    charAnim.start();
  }

  // fázisváltás hangok / animációk
  if (state.phase !== lastPhase) {
    if (state.phase === 'verdict' && S.verdict) {
      judgeSmash();
      if (S.verdict.unanimous) showUnanimous();
      else confettiBurst(50);
    }
    if (state.phase === 'game_over') {
      confettiBurst(200);
      SFX.fanfare();
      setTimeout(() => SFX.applause(), 600);
    }
    if (state.phase === 'prep' && myRole() !== 'juror') SFX.whisper();
    if (state.phase === 'round_results') SFX.applause();
    if (state.phase === 'challenge_review') SFX.ding();
    lastPhase = state.phase;
  }
});

socket.on('objection_started', (data) => {
  showObjection(nameOf(data.by), data.by);
});

socket.on('objection_ruling', (data) => {
  showRuling(data.accepted, data.ruling, data.objectorName, data.speakerName, data.judgeName, data);
  // A bíró kihirdeti a döntést: szövegbuborék és bólogatás (2-3 mp),
  // majd a kalapácsütés megrázkódik.
  charAnim.judgeSpeak(2500);
});

socket.on('reaction', (data) => {
  flyEmoji(data.emoji);
  // Karakter animáció: csak az adott esküdt reagál (0,8 mp beszélő kép + buborék).
  if (data.by) charAnim.react(data.by, data.emoji);
});

socket.on('order_in_court', () => {
  judgeSmash();
  SFX.gavel();
  // vörös villanás
  const o = $('#overlay');
  o.style.position = 'fixed';
  o.style.inset = '0';
  o.style.background = 'rgba(229, 72, 77, 0.25)';
  o.style.zIndex = '50';
  o.style.pointerEvents = 'none';
  setTimeout(() => { o.style.background = 'transparent'; }, 350);
});

// ============================================================
// Hangerő
// ============================================================

$('#btnMute').addEventListener('click', () => {
  muted = !muted;
  LS.setItem('kb_muted', muted ? '1' : '0');
  $('#btnMute').textContent = muted ? '🔇' : '🔊';
});
$('#volume').addEventListener('input', (e) => {
  volume = +e.target.value;
  LS.setItem('kb_volume', String(volume));
});

document.body.addEventListener('pointerdown', ensureAudio, { once: true });

// Mozgás csökkentése kapcsoló (alapból kikapcsolva; a böngésző
// prefers-reduced-motion beállítását is figyelembe vesszük).
$('#btnReduceMotion').addEventListener('click', () => {
  charAnim.setReducedMotion(!charAnim.reducedMotion);
});
updateReduceMotionBtn();
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',updateReduceMotionBtn);

const roomBackground=document.querySelector('.stage-bg');
roomBackground.addEventListener('error',()=>{roomBackground.style.display='none';$('#stage').classList.add('room-missing');});

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// A plakát-fonál újrarajzolása átméretezésnél (csak lobby közben).
let resizeTm = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTm);
  resizeTm = setTimeout(() => {
    if (S && S.phase === 'lobby' && $('#screen-lobby').classList.contains('active')) drawPinThreads();
    if (S && S.phase !== 'lobby' && $('#screen-game').classList.contains('active')) {renderStage();renderMyCardsBar();scheduleSceneLayout();}
  }, 150);
});

// ============================================================
// Indítás
// ============================================================

// A nyolc kész karakter-PNG és a háttér előtöltése induláskor.
preloadCharacterImages();

initNameScreen();
show('auth');

$('#accusationTicker').setAttribute('role', 'button');
$('#accusationTicker').setAttribute('tabindex', '0');
function toggleAccusation() {
  const el = $('#accusationTicker');
  const open = el.classList.toggle('expanded');
  el.setAttribute('aria-expanded', String(open));
  if(open) {cancelChargeIntro();el.classList.remove('charge-intro');if(lastCharge) el.querySelector('.charge-text').innerHTML=chargeMarkup(lastCharge.text,lastCharge.name);}
  scheduleSceneLayout();
}
$('#accusationTicker').addEventListener('click', toggleAccusation);
$('#accusationTicker').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAccusation(); } });

// A panelek és a névtáblák méretváltozását csak egy közös RAF méri.
if(window.ResizeObserver) {
  const hudObserver=new ResizeObserver(scheduleSceneLayout);
  ['scenePanel','accusationTicker','myCardsBar','judgeWatchBar'].forEach(id=>hudObserver.observe(document.getElementById(id)));
}
