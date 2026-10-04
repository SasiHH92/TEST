'use strict';

// ============================================================
// KAMU BÍRÓSÁG – kliens
// ============================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const socket = io();
const LS = window.localStorage;

let MY = {
  playerId: LS.getItem('kb_playerId') || null,
  name: LS.getItem('kb_name') || '',
  avatar: LS.getItem('kb_avatar') || null,
  code: LS.getItem('kb_code') || null,
  appearances: ['bírói kalap', 'paróka', 'rabruha', 'napszemüveg']
};

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
}

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0');
}

function me() {
  return S && S.players.find((p) => p.id === MY.playerId);
}

function myRole() {
  if (!S) return 'juror';
  if (S.defendantId === MY.playerId) return 'defendant';
  if (S.prosecutorId === MY.playerId) return 'prosecutor';
  if (S.defenderId === MY.playerId) return 'defender';
  if (S.phase === 'witness' && S.witnessId === MY.playerId) return 'witness';
  return 'juror';
}

function playerById(id) {
  return S ? S.players.find((p) => p.id === id) : null;
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
const AVATARS = Object.keys(AVATAR_EMOJI);

function avatarEmoji(a) {
  return AVATAR_EMOJI[a] || '🎭';
}

// ---- szerepek: színek, rajzok, rövid nevek ----
const ROLE_COLOR = {
  prosecutor: '#e5484d', // ügyész – piros
  defendant: '#f5a524',  // vádlott – borostyán
  defender: '#3b82f6',   // védőügyvéd – kék
  witness: '#22c55e',    // tanú – zöld
  juror: '#a78bfa'       // esküdtek – lila
};
const ROLE_IMG = {
  prosecutor: '/assets/ugyesz.svg',
  defendant: '/assets/vadlott.svg',
  defender: '/assets/vedougyved.svg',
  witness: '/assets/tanu.svg',
  juror: '/assets/eskudt.svg',
  judge: '/assets/biro.svg'
};
const ROLE_SHORT = { prosecutor: 'ÜÜ', defendant: 'VÁ', defender: 'VÉ', witness: 'TA', juror: 'ES' };
const WHO_LABEL = { prosecutor: 'Az ügyész', defendant: 'A vádlott', defender: 'A védőügyvéd' };
// Rövid szerepnevek a mobil felső sávjához (a színpad alján).
const SP_LABEL = { prosecutor: 'Ügyész', defendant: 'Vádlott', defender: 'Védő', witness: 'Tanú' };
// Színpadi helyek a rajzolt tárgyalóteremhez igazítva (% a 16:9 vásznon).
// x: vízszintes közép, b: alsó él (alulról %), h: magasság, z: réteg.
const STAGE_POS = {
  judge:      { x: 50,   b: 38.9, h: 30, z: 2 },  // a pulpitus mögül emelkedik ki
  prosecutor: { x: 15.6, b: 26.4, h: 28, z: 6 },  // a bal asztalnál, elöl
  defendant:  { x: 50,   b: 25.0, h: 30, z: 7 },  // középen elöl, legközelebb
  defender:   { x: 62,   b: 25.9, h: 27, z: 6 },  // a vádlott mellett, kisebb
  witness:    { x: 74,   b: 35.2, h: 20, z: 5 },  // a bíró jobb oldalán, középtájon
  juror:      { x: 0,    b: 48.1, h: 19, z: 2 }   // az esküdtpadban, mögüle
};
const JUROR_X = [79.4, 83.7, 88.0, 92.3]; // max 4 látszik, a többi "+N"
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
if (!LS.getItem('kb_helpSeen')) setTimeout(() => openHelp(true), 500);

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
  game_over: 'A tárgyalások véget értek!'
};

function updateJudgeBubble(text) {
  const b = $('#judgeBubble');
  if (!b || !text) return;
  if (b.textContent !== text) {
    b.textContent = text;
    b.classList.remove('flash');
    void b.offsetWidth;
    b.classList.add('flash');
  }
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
  // avatar-választó a vendégűrlaphoz
  const grid = $('#avatarGrid');
  grid.innerHTML = '';
  AVATARS.forEach((a) => {
    const cell = document.createElement('div');
    cell.className = 'avatar-cell' + (MY.avatar === a ? ' selected' : '');
    cell.innerHTML = '<span class="emoji">' + AVATAR_EMOJI[a] + '</span>' + a;
    cell.addEventListener('click', () => {
      MY.avatar = a;
      $$('#avatarGrid .avatar-cell').forEach((c) => c.classList.remove('selected'));
      cell.classList.add('selected');
    });
    grid.appendChild(cell);
  });
  if (!MY.avatar) {
    MY.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    grid.children[AVATARS.indexOf(MY.avatar)].classList.add('selected');
  }

  socket.emit('get_registry', (res) => {
    REGISTRY = (res && res.registry) || [];
    GUEST_PRIORS = (res && res.vendegPriuszok) || [];
    TAKEN_NAMES = (res && res.takenNames) || [];
    renderMugGrid();
    // Ha már van kiválasztott nevünk és nincs foglalt, kihagyhatjuk a választót.
    if (MY.name && REGISTRY.some((r) => r.nev === MY.name) && !TAKEN_NAMES.includes(MY.name)) {
      CHOSEN = { nev: MY.name, profile: true };
      show('menu');
      autoConnectAfterName();
    }
  });
  renderMugGrid();
}

function renderMugGrid() {
  const grid = $('#mugGrid');
  grid.innerHTML = '';
  REGISTRY.forEach((r) => {
    const taken = TAKEN_NAMES.includes(r.nev);
    const card = document.createElement('div');
    card.className = 'mug-card' + (taken ? ' taken' : '');
    const st = r.stats;
    // A [TAG] a jelvény: a névtábláról a jelvény-címkére kerül.
    const tagMatch = r.nev.match(/\[([^\]]+)\]/);
    const badge = r.jelveny || (tagMatch ? tagMatch[1] : '');
    const cleanName = r.nev.replace(/\s*\[[^\]]+\]\s*/, '').trim();
    const initial = (cleanName.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase();
    const hue = nameHue(cleanName);
    card.innerHTML =
      '<span class="mug-mono" style="background:hsl(' + hue + ',62%,44%)">' + escapeHtml(initial) + '</span>' +
      '<span class="mug-name">' + escapeHtml(cleanName) + '</span>' +
      (badge ? '<span class="mug-badge">' + escapeHtml(badge) + '</span>' : '') +
      '<span class="mug-title">' + escapeHtml(r.titulus) + '</span>' +
      (st ? '<span class="mug-stats">Elítélve: ' + st.bunos + 'x | Felmentve: ' + st.artatlan + 'x</span>' : '') +
      (taken ? '<div class="mug-taken"><span>ŐRIZETBEN</span></div>' : '');
    if (!taken) {
      card.addEventListener('click', () => {
        if (card.classList.contains('chosen')) return;
        card.classList.add('chosen'); // piros keret + címke, rövid ideig látszik
        setTimeout(() => chooseSuspect(r.nev, true), 550);
      });
    }
    grid.appendChild(card);
  });
}

function chooseSuspect(name, isProfile) {
  CHOSEN = { nev: name, profile: !!isProfile };
  MY.name = name;
  LS.setItem('kb_name', name);
  show('menu');
  autoConnectAfterName();
}

function autoConnectAfterName() {
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
  socket.emit('get_registry', (res) => {
    REGISTRY = (res && res.registry) || [];
    GUEST_PRIORS = (res && res.vendegPriuszok) || [];
    TAKEN_NAMES = (res && res.takenNames) || [];
    renderMugGrid();
  });
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
  return { titulus: CHOSEN.titulus, priusz: CHOSEN.priusz, jelveny: '' };
}

$('#btnCreate').addEventListener('click', () => {
  ensureAudio();
  if (!MY.playerId) MY.playerId = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  LS.setItem('kb_playerId', MY.playerId);
  socket.emit('create_room', { name: MY.name, avatar: MY.avatar, playerId: MY.playerId, profile: myProfilePayload() }, (res) => {
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
  if (!MY.playerId) MY.playerId = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  LS.setItem('kb_playerId', MY.playerId);
  socket.emit('join_room', { code, name: MY.name, avatar: MY.avatar, playerId: MY.playerId, profile: myProfilePayload() }, (res) => {
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
  MY.code = res.code;
  MY.appearances = res.appearances || MY.appearances;
  LS.setItem('kb_code', res.code);
  $('#lobbyCode').textContent = res.code;
  $('#gameCode').textContent = res.code;
  show('lobby');
  updateQrBox();
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

$('#btnLeaveLobby').addEventListener('click', () => {
  socket.emit('leave_room');
  LS.removeItem('kb_code');
  show('menu');
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
    challengeMode: (document.querySelector('input[name="challengeMode"]:checked') || {}).value === 'jury' ? 'jury' : 'judge',
    modes: $$('#modeGrid .case-tab[data-mode]')
      .filter((c) => c.classList.contains('active-case'))
      .map((c) => c.dataset.mode),
    customAccusations: $('#customAccusations').value.split('\n').map((x) => x.trim()).filter((x) => x.length > 3)
  };
}

// A mappára kattintáskor AZONNAL a szerverhez megy a kiválasztás
// (nem kell a "Beállítások mentése" gomb).
function emitLobbySettings() {
  socket.emit('update_settings', { settings: collectLobbySettings() });
}

// "Aktív ügyek: …" címke + a start gomb csak úgy indul, ha van kijelölt mód.
function updateActiveModesLabel() {
  const sel = $$('#modeGrid .case-tab[data-mode]')
    .filter((c) => c.classList.contains('active-case'))
    .map((c) => c.dataset.mode);
  const names = (S.modes || []).filter((m) => sel.includes(m.key)).map((m) => m.name);
  const label = $('#activeModes');
  if (label) label.textContent = names.length
    ? 'Aktív ügyek: ' + names.join(' • ')
    : '⚠️ Nincs kijelölt ügyiratmappa – válassz legalább egyet!';
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
  const tilt = tiltFor(p.id || p.name);
  return '<div class="poster" style="--tilt:' + tilt + 'deg">' +
    '<span class="p-wanted">' + (isBot ? 'HIVATALOS SZEMÉLYZET' : 'KÖRÖZÉS') + '</span>' +
    '<span class="p-name">' + escapeHtml(p.name) + '</span>' +
    '<div class="p-badge-row">' + (prof.jelveny && !isBot ? '<span class="p-badge">' + escapeHtml(prof.jelveny) + '</span>' : '') + '</div>' +
    '<span class="p-title">' + escapeHtml(title) + '</span>' +
    '<span class="p-priors">' + escapeHtml(priusz) + '</span>' +
    '<span class="p-reward">' + bountyText(p.score) + '</span>' +
    '<span class="p-record">' + record + '</span>' +
    stamp +
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

  startTicker();
  requestAnimationFrame(drawPinThreads);

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
          emitLobbySettings(); // azonnal a szerverhez!
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
        emitLobbySettings();
      });
      mg.appendChild(vcell);
    }
    // A kijelöltség mindig a szerver állapotát tükrözi (szinkronban mindenkinél).
    const selected = S.settings.modes || [];
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

function renderGame() {
  renderHeader();
  renderAccusationTicker();
  renderRoleBanner();
  renderStage();
  renderJudgeWatchBar();
  renderPhaseContent();
  renderSidebar();
  $('#btnOrder').classList.toggle('hidden', S.hostId !== MY.playerId || S.phase === 'lobby');
}

// A vád mindig látszik a képernyő tetején (vékony sáv) – a kör módjával jelölve.
function renderAccusationTicker() {
  const t = $('#accusationTicker');
  if (!t) return;
  if (S.accusationText && S.phase !== 'lobby' && S.phase !== 'game_over') {
    const html = '<b>VÁD:</b> ' + escapeHtml(S.accusationText) +
      (S.modeName ? ' <span class="mode-chip">' + escapeHtml(S.modeName) + '</span>' : '') +
      (S.isCustom ? ' <span class="mode-chip own">SAJÁT</span>' : '');
    if (t.innerHTML !== html) t.innerHTML = html;
    t.title = S.accusationText; // hosszú vádnál a teljes szöveg tippként
    t.classList.remove('hidden');
  } else {
    t.classList.add('hidden');
  }
}

// ============================================================
// SZÍNPAD: a karakterek rajzai, a beszélő világít (glow)
// ============================================================

function renderStage() {
  const stage = $('#stage');
  const slots = $('#stageSlots');
  if (!stage || !slots) return;
  stage.classList.toggle('hidden', !S.players || S.players.length === 0);

  const speakerRole = SPEAKER_OF[S.phase] || null;
  const entries = [];
  const push = (role, pid) => { if (pid) entries.push({ role, pid }); };
  push('prosecutor', S.prosecutorId);
  push('defendant', S.defendantId);
  push('defender', S.defenderId);
  if (S.witnessId) push('witness', S.witnessId);
  // Esküdtek: a jobb oldali padban egyenként, max 4 látszik, a többi "+N".
  const jurors = S.players.filter((p) => p.connected &&
    p.id !== S.prosecutorId && p.id !== S.defendantId &&
    p.id !== S.defenderId && p.id !== S.witnessId);
  jurors.slice(0, JUROR_X.length).forEach((p, i) => {
    entries.push({ role: 'juror', pid: p.id, ji: i });
  });
  const juryMore = Math.max(0, jurors.length - JUROR_X.length);

  const key = entries.map((e) => e.role + ':' + (e.pid || '')).join('|') +
    '#' + String(speakerRole) + '+' + juryMore;
  if (stage.dataset.key !== key) {
    stage.dataset.key = key;
    let html = entries.map((e) => {
      const pos = STAGE_POS[e.role];
      const x = e.role === 'juror' ? JUROR_X[e.ji] : pos.x;
      const p = playerById(e.pid);
      const mini = e.role === 'juror' ? ' mini' : '';
      const tag = '<div class="st-tag' + mini + '"' + (p ? ' title="' + escapeHtml(p.name) + '"' : '') + '>' +
        '<span class="st-av">' + (p ? avatarEmoji(p.avatar) : '👥') + '</span>' +
        (p ? '<span class="st-name">' + escapeHtml(p.name) + '</span>' : '') + '</div>';
      return '<div class="stage-slot" data-role="' + e.role + '" data-pid="' + (e.pid || '') + '"' +
        ' style="--x:' + x + '%;--b:' + pos.b + '%;--h:' + pos.h + '%;--z:' + pos.z + ';--glow:' + (ROLE_COLOR[e.role] || '#f2c14e') + '">' +
        '<div class="st-fig"><img src="' + ROLE_IMG[e.role] + '" alt=""></div>' + tag + '</div>';
    }).join('');
    if (juryMore > 0) {
      html += '<div class="stage-jury-more" style="--x:' + (JUROR_X[JUROR_X.length - 1] + 4) + '%;--b:' + STAGE_POS.juror.b + '%">+' + juryMore + '</div>';
    }
    slots.innerHTML = html;
  }

  const speakerPid = speakerRole ? (S[SPEAKER_PID[speakerRole]] || null) : null;
  // a terem bírója sosem "beszélő", de a többiekkel együtt ő is elhalványul
  const judgeEl = $('#judge');
  if (judgeEl) judgeEl.classList.toggle('dim', !!speakerRole);
  $$('#stageSlots .stage-slot').forEach((el) => {
    const role = el.dataset.role;
    const pid = el.dataset.pid;
    const active = !!speakerRole && role === speakerRole;
    el.style.setProperty('--glow', ROLE_COLOR[role] || '#f2c14e');
    el.classList.toggle('speaking', active);
    el.classList.toggle('dim', !!speakerRole && !active);
    el.classList.toggle('mine', !!(active && speakerPid && speakerPid === MY.playerId));
    // név/avatar frissítése a címkén (szerepcserénél is pontos legyen)
    if (active && speakerPid) {
      const p = playerById(speakerPid);
      const tag = el.querySelector('.st-tag');
      if (tag && p) {
        const t = '<span class="st-av">' + avatarEmoji(p.avatar) + '</span><span class="st-name">' + escapeHtml(p.name) + '</span>';
        if (tag.innerHTML !== t) tag.innerHTML = t;
      }
    }
  });

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

let jwCollapsed = false;
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
    jwCollapsed = false;
  }
  const notes = S.judgeNotes || {};
  const isHost = S.hostId === MY.playerId;
  const caret = jwCollapsed ? '▸' : '▾';
  let html = '<button class="jw-head" id="jwHead" type="button">' +
    '<span class="jw-label">👨‍⚖️ BÍRÓI FIGYELŐ • ' + (isHost ? 'A TÁRGYALÁS VEZETŐJE' : 'EBBEN AZ ÜGYBEN TE VAGY A BÍRÓ') +
    ' (' + S.judgeWatch.length + ')</span><span class="jw-caret">' + caret + '</span></button>';
  html += '<div class="jw-body' + (jwCollapsed ? ' collapsed' : '') + '">';
  if (S.watchNow) {
    const col = SPEAKER_OF[S.phase] ? ROLE_COLOR[SPEAKER_OF[S.phase]] : '#f2c14e';
    html += '<span class="jw-now" style="--role:' + col + '">Most figyeld: <b>„' + escapeHtml(S.watchNow.text) + '”</b>' +
      (S.watchNow.difficulty ? ' <i class="jw-hard">NEHEZÍTÉS</i>' : '') +
      '<button class="jw-note' + (notes[S.watchNow.who] ? ' on' : '') + '" data-jnote="' + S.watchNow.who + '">Észrevettem ✓</button></span>';
  }
  html += '<div class="jw-list">' + S.judgeWatch.map((c) =>
    '<span class="jw-item' + (notes[c.who] ? ' noted' : '') + '"><b>' + escapeHtml(c.name) + '</b> (' + WHO_LABEL[c.who] + '): ' +
    escapeHtml(c.text) + (c.difficulty ? ' <i class="jw-hard">NEHEZÍTÉS</i>' : '') + '</span>'
  ).join('') + '</div>';
  html += '</div>';
  bar.innerHTML = html;
  bar.classList.remove('hidden');
  const head = $('#jwHead');
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
    return 'juror';
  };
  const sorted = S.players.slice().sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));

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
    return '<div class="sb-row' + (p.id === MY.playerId ? ' me' : '') + (delta > 0 ? ' flash' : '') + '" data-pid="' + p.id + '">' +
      '<span class="sb-rank">' + (i + 1) + '</span>' +
      '<span class="sb-av">' + avatarEmoji(p.avatar) + '</span>' +
      '<span class="sb-name">' + escapeHtml(p.name) + (p.isHost ? ' <i class="sb-host">👑</i>' : '') +
        (p.connected ? '' : ' <i class="sb-off">×</i>') + '</span>' +
      '<span class="sb-role" style="--role:' + (ROLE_COLOR[role] || '#f2c14e') + '" title="' + role + '">' + (ROLE_SHORT[role] || '—') + '</span>' +
      '<span class="sb-score">' + p.score + '</span>' +
      (delta > 0 ? '<span class="sb-delta">+' + delta + '</span>' : '') +
      '</div>';
  }).join('');
  if (rowsEl.innerHTML !== html) rowsEl.innerHTML = html;

  if (Object.keys(oldRects).length) {
    rowsEl.querySelectorAll('.sb-row').forEach((el) => {
      const oldTop = oldRects[el.dataset.pid];
      if (oldTop === undefined) return;
      const dy = oldTop - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 2 && el.animate) {
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
  const speakerId = speakerOfPhase[S.phase];
  el.innerHTML = '<div class="rb-title">' + title + '</div>' +
    (speakerId ? '<div class="rb-speaker"><span class="rb-avatar">' + avatarEmoji(avatarOf(speakerId)) + '</span>' +
      escapeHtml(nameOf(speakerId)) + '</div>' : '');
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
  const cls = secs <= 5 ? 'danger' : secs <= 10 ? 'warn' : '';
  return '<div class="timer-ring ' + cls + '" id="timerBox" data-total="' + timerTotalCache.ms + '">' +
    '<svg viewBox="0 0 118 118"><circle class="tr-bg" cx="59" cy="59" r="' + RING_R + '"/>' +
    '<circle class="tr-fg" cx="59" cy="59" r="' + RING_R + '" stroke-dasharray="' + RING_C + '" stroke-dashoffset="' + (RING_C * (1 - frac)) + '"/></svg>' +
    '<div class="tr-text">' + fmtTime(rem) + '</div></div>';
}

function startTimerLoop() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
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
    box.className = 'timer-ring ' + (secs <= 5 ? 'danger' : secs <= 10 ? 'warn' : '');
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
    return '<div class="cards-heading">🔐 A TITKOS BIZONYÍTÉKAID</div>' + you + '<div class="cards-row">' +
      S.evidence.map((e, i) => cardHtml('BIZONYÍTÉK', 't-evidence', e, i)).join('') +
      '</div><p class="next-step">Használd őket a vádbeszédben! A többiek nem látják.</p>';
  }
  if (S.phase === 'prep' && role === 'defendant' && S.alibi) {
    return '<div class="cards-heading">🔐 A TITKOS ALIBID</div>' + you + '<div class="cards-row">' +
      cardHtml('ALIBI', 't-alibi', S.alibi, 0) + '</div>' +
      '<p class="next-step">Erre építsd a védekezésed! A többiek nem látják.</p>';
  }
  if (S.phase === 'prep' && role === 'defender' && S.tricks) {
    return '<div class="cards-heading">🔐 A TITKOS TRÜKKJEID (védőügyvédként)</div>' + you + '<div class="cards-row">' +
      S.tricks.map((t, i) => cardHtml('TRÜKK', 't-trick', t, i)).join('') +
      '</div><p class="next-step">Ezekkel támogathatod a védekezést a beszédedben!</p>';
  }
  return '';
}

function challengeHtmlIfMine() {
  const role = myRole();
  if (S.myChallenge && (S.phase === 'prosecution' || S.phase === 'defense' || S.phase.startsWith('final'))) {
    return '<div class="secret-card single reveal"><span class="card-type t-challenge">🎬 TITKOS KIHÍVÁS' +
      (role === 'prosecutor' ? ' (ügyész)' : ' (vádlott)') + '</span><span class="card-text">' + escapeHtml(S.myChallenge) +
      '</span><span class="card-stamp">ÜGYIRAT</span></div>';
  }
  return '';
}

function renderPhaseContent() {
  const el = $('#phaseContent');
  const role = myRole();
  stopDrumroll();
  let html = '';

  switch (S.phase) {
    case 'accusation': {
      // A kör módja egy kis címkével (melyik pakliból jön minden kártya).
      const modeChips = (S.modeName ? '<span class="mode-chip">' + escapeHtml(S.modeName) + '</span>' : '') +
        (S.isCustom ? '<span class="mode-chip own">SAJÁT VÁD</span>' : '');
      html = '<div class="case-row"><span class="case-no">ÜGYSZÁM: ' + S.caseNo + '</span>' + modeChips + '</div>' +
        '<div class="accusation-card">' + escapeHtml(S.accusationText) + '</div>' +
        '<p class="next-step">' + (role === 'defendant'
          ? 'Olvasd fel hangosan a vádat a Discordon!'
          : 'Valaki olvassa fel hangosan a vádat! Aztán nyomjátok meg a gombot.') + '</p>' + inlineActions();
      break;
    }
    case 'prep': {
      // Kompakt sor: a visszaszámláló MELLETT a titkos kártyák (flex-wrap).
      html = '<div class="prep-row">' + timerHtml() + (secretCardsHtml() || '') + '</div>';
      if (role === 'juror') html += '<p class="next-step">Kávészünet az esküdteknek – a felek most készülnek, figyeljetek a reakciókra…</p>';
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
        html += '<div class="secret-card single reveal"><span class="card-type t-witness">TANÚKÁRTYA</span><span class="card-text">' + escapeHtml(S.witnessCard) + '</span><span class="card-stamp">ÜGYIRAT</span></div>' +
          '<p class="next-step">Mondj el egy "vallomást"! Te döntöd el, kinek segítesz…</p>';
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
        html = '<div class="vote-buttons">' +
          '<button class="vote-btn guilty ' + (v.myVote === 'guilty' ? 'chosen' : '') + '" id="voteGuilty">BŰNÖS</button>' +
          '<button class="vote-btn not-guilty ' + (v.myVote === 'not_guilty' ? 'chosen' : '') + '" id="voteNotGuilty">ÁRTATLAN</button>' +
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
    case 'challenge_review': {
      // KIHÍVÁS-ELLENŐRZÉS: a bíró dönt kártyánként; a többiek csak szórakoznak.
      // (A fázis címe a fázis-sávban van – itt csak a számláló chip.)
      const rev = S.challengeReview || { challenges: [] };
      const ch = rev.challenges[rev.current] || rev.challenges[0];
      if (!ch) { html = '<div class="drumroll">Nincs kihívás…</div>'; break; }
      const col = { prosecutor: ROLE_COLOR.prosecutor, defendant: ROLE_COLOR.defendant, defender: ROLE_COLOR.defender }[ch.who] || '#f2c14e';
      html = '<div class="review-counter"><span>' + (rev.current + 1) + ' / ' + rev.total + '</span></div>' +
        '<div class="review-note">Ebben az ügyben <b>' + escapeHtml(ch.judgeName) + '</b> a bíró</div>' +
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
          html += '<div style="margin:6px 0">Teljesítette? ' +
            '<button class="btn green" id="cv' + i + 'Yes">IGEN</button> ' +
            '<button class="btn red" id="cv' + i + 'No">NEM</button></div>';
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
      html = '<div class="verdict-scroll">' +
        '<div class="verdict-title ' + (v.guilty ? 'guilty' : 'not-guilty') + '">' + (v.guilty ? 'BŰNÖS!' : 'ÁRTATLAN!') + '</div>';
      html += '<div class="case-row">' +
        (S.modeName ? '<span class="mode-chip">' + escapeHtml(S.modeName) + '</span>' : '') + '</div>';
      html += '<div class="vote-list">' + (v.votes || []).map((vv) =>
        '<span class="vote-chip ' + (vv.verdict || '') + '">' + avatarEmoji(avatarOf(vv.voterId)) + ' ' +
        escapeHtml(vv.voterName) + ': ' + (vv.verdict === 'guilty' ? 'BŰNÖS' : vv.verdict === 'not_guilty' ? 'ÁRTATLAN' : '—') + '</span>'
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
        '<button class="btn big" id="btnProceed">Tovább</button> ' +
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
      html = '<div class="results-scroll"><div class="score-table compact">' + (go.ranking || []).map((p, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
        return '<div class="score-row' + (p.id === MY.playerId ? ' me' : '') + '"><span>' + medal + ' ' +
          avatarEmoji(p.avatar) + ' ' + escapeHtml(p.name) + '</span><span class="pts">' + p.score + ' pont</span></div>';
      }).join('') + '</div>';
      const a = go.awards || {};
      const cards = [a.bestLawyer, a.biggestCriminal, a.audienceFavorite, a.challengeChampion].filter(Boolean);
      if (cards.length) {
        html += '<div class="awards">' + cards.map((c) =>
          '<div class="award-card"><span class="emoji">' + c.emoji + '</span>' +
          '<span class="award-name">' + escapeHtml(c.award) + '</span><span class="who">' + escapeHtml(c.name) + '</span></div>'
        ).join('') + '</div>';
      }
      html += '</div>'; // results-scroll vége
      html += S.hostId === MY.playerId
        ? '<div class="fixed-actions"><button class="btn big" id="btnNewGame">ÚJ TÁRGYALÁS</button>' +
          '<button class="btn small ghost" id="btnLeaveAfter">KILÉPÉS</button></div>'
        : '<p class="next-step">Várakozás az új tárgyalásra…</p>';
      break;
    }
    default:
      html = '<p>…</p>';
  }
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
  if (iaDone) iaDone.addEventListener('click', () => socket.emit('done_speaking'));
  const iaObj = $('#iaObject');
  if (iaObj) iaObj.addEventListener('click', () => socket.emit('objection'));
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
      if (ch) socket.emit('challenge_fun_vote', { who: ch.who, done: b.dataset.fun === '1' });
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
  const leaveAfter = $('#btnLeaveAfter');
  if (leaveAfter) leaveAfter.addEventListener('click', () => {
    socket.emit('leave_room');
    LS.removeItem('kb_code');
    show('menu');
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
  const j = $('#judge');
  j.classList.remove('smash');
  void j.offsetWidth; // reflow az animáció újraindításához
  j.classList.add('smash');
  SFX.gavel();
}

function showObjection(name) {
  $('#objectionName').textContent = '— ' + name + ' —';
  $('#objectionOverlay').classList.remove('hidden');
  SFX.objection();
  SFX.whisper();
}

function showRuling(accepted, ruling) {
  const bubble = $('#judgeBubble');
  if (bubble) {
    bubble.innerHTML = (accepted
      ? '⚖️ <b class="rb-ok">ELFOGADVA!</b> „'
      : '⚖️ <b class="rb-no">ELUTASÍTVA!</b> „') + escapeHtml(ruling) + '”';
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
  const v = S.verdict || {};
  const r = S.roundResults || {};
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 1000;
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

  if (v.challengeResults) {
    ctx.fillStyle = '#26221c';
    const cr = v.challengeResults;
    if (cr.prosecutorChallenge) y = wrapText(ctx, 'Ügyész kihívása: „' + cr.prosecutorChallenge + '” – ' + (cr.prosecutorDone ? 'teljesítve ✔' : 'nem sikerült ✘'), 60, y, canvas.width - 120, 32);
    if (cr.defendantChallenge) y = wrapText(ctx, 'Vádlott kihívása: „' + cr.defendantChallenge + '” – ' + (cr.defendantDone ? 'teljesítve ✔' : 'nem sikerült ✘'), 60, y, canvas.width - 120, 32);
  }

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
  if (!everConnected) { everConnected = true; return; }
  // Újracsatlakozás: ha volt szobánk, kérjük vissza az állapotot.
  clearTimeout(rejoinTimer);
  rejoinTimer = setTimeout(() => {
    if (!MY.code) return; // nem voltunk szobában – nincs teendő
    socket.emit('join_room', {
      code: MY.code, name: MY.name, avatar: MY.avatar,
      playerId: MY.playerId, profile: myProfilePayload()
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
  showConnBar('Kapcsolat megszakadt, újracsatlakozás…');
});

socket.on('connect_error', () => {
  // A szerver épp nem elérhető (pl. az ingyenes tárhely "alszik", vagy hálózati hiba).
  showConnBar('Nem sikerül a kapcsolat… újrapróbálkozás…');
});

socket.on('state', (state) => {
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
  if (state.phase === 'lobby') {
    show('lobby');
    renderLobby();
  } else {
    show('game');
    renderGame();
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
  showObjection(nameOf(data.by));
});

socket.on('objection_ruling', (data) => {
  showRuling(data.accepted, data.ruling);
});

socket.on('reaction', (data) => {
  flyEmoji(data.emoji);
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
  }, 150);
});

// ============================================================
// Indítás
// ============================================================

initNameScreen();
show('name');
