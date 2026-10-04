'use strict';

// ============================================================
// KAMU BÍRÓSÁG – szerver (Express + Socket.io)
// A kliens saját, localStorage-ban tárolt azonosítót (playerId)
// küld, így a szoba elvesztése / újratöltés után a játékos
// visszacsatlakozhat és megőrzi a pontjait.
// A tartalom a data/cards.json, a játékosok a data/players.json
// fájlból töltődnek; a bűnügyi nyilvántartás a data/stats.json.
// ============================================================

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const crypto = require('crypto');
const QRCode = require('qrcode');

const { Game, PHASES, ALL_MODES } = require('./game');

const app = express();
const server = http.createServer(app);

// ONLINE ÜZEM (Render.com): azonos eredeten nincs CORS; csak ha ALLOWED_ORIGIN
// környezeti változóval engedélyezünk egy külső eredetet, azt fogadjuk el.
// A polling fallback + hangolt ping-időzítések miatt a megszakadt kapcsolatot
// a szerver gyorsan észreveszi, de egy rövid hálózati kiesés nem dobja ki a játékost.
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '').trim();
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN ? [ALLOWED_ORIGIN] : false, credentials: false },
  transports: ['polling', 'websocket'], // websocket + polling fallback
  pingInterval: 20000,
  pingTimeout: 25000
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = 50; // egy szerverpéldányon legfeljebb ennyi szoba élhet egyszerre

// Reverse proxy (Render) mögött a kliens IP-je a proxy fejlécéből jön.
app.set('trust proxy', 1);

// Statikus fájlok: a html/js/css ETag/Last-Modified fejléccel (nem cache-el hosszan),
// a rajzok (assets/) hosszan cache-elhetők, mert ritkán változnak.
app.use(express.static(path.join(__dirname, 'public'), { etag: true, lastModified: true, maxAge: 0 }));

// Tárgyalóterem- és szereprajzok (assets/ mappa, statikusan, hosszú gyorsítótárral).
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d', immutable: true }));

// A játékleírás külön fájlban él, hogy kód módosítása nélkül szerkeszthető legyen.
// Ha a fájl hiányzik/sérült, a játékleírás helyett üres súgó megy – a szerver nem dől el.
app.get('/help.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'help.json'), (err) => {
    if (err && !res.headersSent) res.json({ title: 'Játékleírás', sections: [] });
  });
});

// Render health check: a platform ezzel ellenőrzi, hogy fut-e a szerver.
app.get('/health', (req, res) => res.status(200).type('text').send('ok'));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// QR-kód a szoba csatlakozási linkjéhez (?room=KÓD) – a lobby mutatja,
// így a telefontokkal egy koppintással be lehet lépni.
// A Render proxy mögött az eredeti Host fejléc áll elő (trust proxy), ez a megbízható cím.
app.get('/qr', (req, res) => {
  const room = String(req.query.room || '').trim().toUpperCase().slice(0, 8);
  const proto = req.protocol; // trust proxy miatt a külső https-t adja vissza
  const host = req.get('host');
  const url = proto + '://' + host + '/' + (room ? '?room=' + encodeURIComponent(room) : '');
  QRCode.toBuffer(url, { width: 320, margin: 2, color: { dark: '#26221c', light: '#fdf6e3' } }, (err, buf) => {
    if (err) return res.status(500).send('QR hiba');
    res.type('image/png').set('Cache-Control', 'public, max-age=3600').send(buf);
  });
});

// ---------- előre megadott játékosok + bűnügyi nyilvántartás ----------

const PLAYERS_FILE = path.join(__dirname, 'data', 'players.json');
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');

let PLAYER_DB = { players: [], vendeg_priuszok: [] };
try {
  PLAYER_DB = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
} catch (e) {
  console.error('Nem sikerült olvasni: ' + PLAYERS_FILE, e.message);
}

function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch (e) {
    // Hiányzó fájl (friss telepítés / ideiglenes tárhely újraindítás után) rendben:
    // üres nyilvántartással indulunk. Sérült fájlnál érthető naplóüzenet.
    if (e.code !== 'ENOENT') {
      console.error('A bűnügyi nyilvántartás (data/stats.json) sérült vagy nem olvasható – üresen indul:', e.message);
    }
    return {};
  }
}

let STATS = loadStats();
let statsSaveTimer = null;

let lastStatsSaveError = null;

// Kis késleltetéssel írunk, hogy sok szavazatnál ne splutterjön a lemez.
// HIBATŰRŐ: ha a lemez nem írható (pl. az ingyenes tárhely ideiglenes lemeze),
// a játék fut tovább, csak a nyilvántartás elveszhet – ugyanaz a hiba csak egyszer naplózódik.
function saveStats() {
  clearTimeout(statsSaveTimer);
  statsSaveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify(STATS, null, 2));
      lastStatsSaveError = null;
    } catch (e) {
      if (lastStatsSaveError !== e.code) {
        lastStatsSaveError = e.code;
        console.error('Nem sikerült menteni a nyilvántartást (' + (e.code || e.name) + ') – a játék fut tovább, a statisztika elveszhet:', e.message);
      }
    }
  }, 300);
}

function recordFor(name) {
  if (!STATS[name]) STATS[name] = { vadlott: 0, bunos: 0, artatlan: 0, dijak: 0 };
  return STATS[name];
}

function bumpStat(name, key, by = 1) {
  const r = recordFor(name);
  r[key] += by;
  saveStats();
}

function statsForName(name) {
  const r = STATS[name];
  return r ? { vadlott: r.vadlott, bunos: r.bunos, artatlan: r.artatlan, dijak: r.dijak } : null;
}

// Az összes előre megadott játékos profilja (nyilvántartási kártyához).
const REGISTRY = PLAYER_DB.players.map((p) => ({
  nev: p.nev,
  jelveny: p.jelveny || '',
  titulus: p.titulus || '',
  priusz: p.priusz || '',
  stats: statsForName(p.nev)
}));

const GUEST_PRIORS = PLAYER_DB.vendeg_priuszok || ['Előélete tiszta. Túl tiszta.'];

// ---------- szobakezelés ----------

const rooms = new Map(); // code -> Game
const sockets = new Map(); // socketId -> { code, playerId }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // félreérthető karakterek nélkül

function newCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code; // ütközésmentes: a meglévő szobák közt keresünk
  }
  return null;
}

// ---- Bejövő adatok alapszintű fertőtlenítése (méret-/típus-korlátok) ----
function cleanProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const s = (v) => String(v == null ? '' : v).slice(0, 150);
  return { titulus: s(profile.titulus), priusz: s(profile.priusz), jelveny: s(profile.jelveny) };
}
function cleanAvatar(avatar) {
  return typeof avatar === 'string' ? avatar.slice(0, 40) : '';
}
function cleanPlayerId(playerId, socketId) {
  const p = String(playerId || socketId).slice(0, 64).trim();
  return p || socketId;
}
// Beállítások fertőtlenítése: szám-típusok határai, csak érvényes mód-kulcsok,
// saját vádak max. 30 db × 200 karakter. (A partial merge logika is itt él:
// csak a beküldött kulcsok íródnak felül a `prev`-ben.)
function sanitizeSettings(s, prev) {
  const clamp = (v, min, max, def) => {
    const n = parseInt(v, 10);
    if (isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  const num = (key, min, max) => (s[key] !== undefined ? clamp(s[key], min, max, prev[key]) : prev[key]);
  const bool = (key) => (s[key] !== undefined ? !!s[key] : prev[key]);
  return {
    speechSeconds: num('speechSeconds', 15, 180),
    defenderSeconds: num('defenderSeconds', 15, 120),
    prepSeconds: num('prepSeconds', 10, 120),
    witnessSeconds: num('witnessSeconds', 10, 120),
    closingSeconds: num('closingSeconds', 10, 60),
    rounds: num('rounds', 1, 12),
    witnessEnabled: bool('witnessEnabled'),
    challengesEnabled: bool('challengesEnabled'),
    challengeMode: s.challengeMode !== undefined ? (s.challengeMode === 'jury' ? 'jury' : 'judge') : prev.challengeMode, // 'judge' = bíró dönt, 'jury' = esküdtek szavaznak
    // Csak olyan módok maradhatnak, amelyekhez létezik pakli a cards.json-ben.
    modes: Array.isArray(s.modes)
      ? s.modes.filter((m) => ALL_MODES.includes(m)).slice(0, 10)
      : prev.modes,
    // Saját vádak: max. 30 db, darabonként max. 200 karakter, min. 4 karakter.
    customAccusations: Array.isArray(s.customAccusations)
      ? s.customAccusations.map((a) => String(a).slice(0, 200)).filter((a) => a.trim().length > 3).slice(0, 30)
      : prev.customAccusations
  };
}

// ---- Alapszintű védelem: eseményenkénti rate limit socketenként ----
// Egy hibás/kártékony kliens így sem tudja leterhelni a szervert.
const RATE_LIMIT_EVENTS_PER_SEC = 20;
const rateWindows = new Map(); // socketId -> { start, count, warned }

function isRateLimited(socket, evt) {
  const now = Date.now();
  let w = rateWindows.get(socket.id);
  if (!w || now - w.start >= 1000) {
    w = { start: now, count: 0, warned: false };
    rateWindows.set(socket.id, w);
  }
  w.count += 1;
  if (w.count > RATE_LIMIT_EVENTS_PER_SEC) {
    if (!w.warned) {
      w.warned = true;
      try { socket.emit('host_warning', { message: '⚠️ Túl sok kérés egy pillanat alatt – próbáld újra!' }); } catch (e) { /* */ }
      console.warn('rate limit elérve:', socket.id, evt);
    }
    return true;
  }
  return false;
}

const pidRoom = (playerId) => 'p:' + playerId;

// Avatar-dekorációk (nem kártyatartalom).
const APPEARANCES = ['bírói kalap', 'paróka', 'rabruha', 'napszemüveg', 'feltűnő csokornyakkendő', 'birkajelmez', 'pókaszapityó', 'ünnepi kalap'];

// Az aktív játékosok profiljához rácsatoljuk a nyilvántartási számait,
// hogy a lobby plakátjain megjelenhessen az "Elítélve/Felmentve" és a KÖZELLENSÉG.
// A Game.broadcast-ja minden state-küldés előtt meghívja.
function attachStats(game) {
  for (const p of game.players.values()) {
    if (p.profile) p.profile._stats = statsForName(p.name);
  }
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  // Minden eseménykezelő védve: egy hiba soha ne döntse le a szervert,
  // csak naplózzuk és szólunk a kliensnek. A rate limit is itt van bekötve.
  const safeOn = (evt, fn) => socket.on(evt, (...args) => {
    if (isRateLimited(socket, evt)) return;
    try {
      fn(...args);
    } catch (err) {
      console.error('HIBA a(z) "' + evt + '" eseménykezelőben:', err);
      try { socket.emit('host_warning', { message: '⚠️ Belső hiba történt (“' + evt + '”). Próbáld újra!' }); } catch (e2) { /* */ }
    }
  });

  // ---- Nyilvántartási kártyák a névválasztóhoz ----
  safeOn('get_registry', (...args) => {
    const ack = typeof args[0] === 'function' ? args[0] : args[1];
    const taken = new Set();
    for (const game of rooms.values()) {
      for (const p of game.players.values()) {
        if (p.connected) taken.add(p.name);
      }
    }
    if (typeof ack === 'function') ack({
      registry: REGISTRY,
      vendegPriuszok: GUEST_PRIORS,
      takenNames: Array.from(taken)
    });
  });

  // ---- Szoba létrehozása ----
  safeOn('create_room', ({ name, avatar, playerId, profile }, ack) => {
    if (rooms.size >= MAX_ROOMS) return ack && ack({ error: 'A szerver jelenleg betelt – próbálj meg később csatlakozni!' });
    const code = newCode();
    if (!code) return ack && ack({ error: 'Nem sikerült szobát létrehozni.' });
    const pid = cleanPlayerId(playerId, socket.id);
    const game = new Game(code, io);
    rooms.set(code, game);
    game.addPlayer(pid, name, cleanAvatar(avatar), true);
    game.getPlayer(pid).profile = cleanProfile(profile);
    socket.join(code);
    socket.join(pidRoom(pid));
    sockets.set(socket.id, { code, playerId: pid });
    ack && ack({ code, playerId: pid, state: game.publicState(pid), appearances: APPEARANCES });
    game.broadcast();
  });

  // ---- Csatlakozás kóddal (visszacsatlakozás is ez) ----
  safeOn('join_room', ({ code, name, avatar, playerId, profile }, ack) => {
    const norm = String(code || '').trim().toUpperCase();
    const game = rooms.get(norm);
    if (!game) {
      // A szerver újraindulhatott (a szobák memóriában élnek) – érthető hiba,
      // a kliens ezzel visszakerül a menübe, nem ragad be.
      return ack && ack({ error: 'A szoba megszűnt, hozz létre egy újat! (' + norm + ')' });
    }
    const pid = cleanPlayerId(playerId, socket.id);
    const returning = game.players.has(pid);
    if (!returning) {
      if (game.players.size >= 8) {
        return ack && ack({ error: 'A szoba tele van (max 8 játékos).' });
      }
      // Ugyanaz a név egyszer lehet a szobában.
      const nameTaken = Array.from(game.players.values())
        .some((p) => p.connected && p.name.toLowerCase() === String(name).toLowerCase());
      if (nameTaken) {
        return ack && ack({ error: '"' + name + '" már ŐRIZETBEN van ebben a szobában!' });
      }
    }
    game.addPlayer(pid, name, cleanAvatar(avatar), false);
    game.getPlayer(pid).profile = cleanProfile(profile);
    if (returning) game.handleReconnect(pid);
    socket.join(norm);
    socket.join(pidRoom(pid));
    sockets.set(socket.id, { code: norm, playerId: pid });
    ack && ack({ code: norm, playerId: pid, state: game.publicState(pid), appearances: APPEARANCES });
    game.broadcast();
  });

  // ---- Botok (teszteléshez) ----
  // Ack-robusztus: működik payload nélküli (ack az első arg) ÉS payload+ack
  // (ack az utolsó arg) hívási formával is.
  const findAck = (args) => args.find((a) => typeof a === 'function');
  safeOn('add_bot', (...args) => {
    const ack = findAck(args);
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return ack && ack({ error: 'Nincs szoba.' });
    if (game.hostId() !== sess.playerId) return ack && ack({ error: 'Csak a házigazda adhat hozzá botot.' });
    if (game.players.size >= 8) return ack && ack({ error: 'A szoba tele van (max 8).' });
    game.addBot();
    ack && ack({ ok: true });
  });

  safeOn('remove_bot', (...args) => {
    const ack = findAck(args);
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return ack && ack({ error: 'Nincs szoba.' });
    if (game.hostId() !== sess.playerId) return ack && ack({ error: 'Csak a házigazda vehet el botot.' });
    game.removeBot();
    ack && ack({ ok: true });
  });

  // ---- Beállítások a lobbyban ----
  safeOn('update_settings', ({ settings }, ack) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return ack && ack({ error: 'Nincs szoba.' });
    if (game.hostId() !== sess.playerId) return ack && ack({ error: 'Csak a házigazda módosíthat.' });
    // Részleges, fertőtlenített beállítás-egyesítés: csak a beküldött kulcsok íródnak
    // felül, a számok a határaikra szorulnak. Így a mappa-klikk (ami azonnal, csak
    // a módokat érintve is megérkezhet) nem törli el a többi beállítást.
    game.settings = sanitizeSettings(settings || {}, game.settings);
    ack && ack({ ok: true, state: game.publicState(sess.playerId) });
    game.broadcast();
  });

  // TÁRGYALÁS MEGKEZDÉSE: a gombbal együtt érkező beállítások (módok!) a
  // hiteles forrás – a korábban mentett állapotot felülírják.
  safeOn('start_game', (...args) => {
    const ack = args.find((a) => typeof a === 'function');
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return;
    const payload = args.find((a) => a && typeof a === 'object' && !Array.isArray(a));
    const raw = (payload && payload.settings) || null;
    // A start-gombbal érkező beállítások is fertőtlenítve mennek a motorhoz
    // (számok határai, csak érvényes mód-kulcsok, max. 30 db × 200 karakteres saját vád).
    const patch = raw ? sanitizeSettings(raw, game.settings) : null;
    const ok = game.startGame(patch, sess.playerId);
    if (ok === false) {
      // Nincs érvényes ügyiratmappa (játékmód) kiválasztva.
      return ack && ack({ error: 'Válassz legalább egy ügyiratmappát (játékmódot) a TÁRGYALÁS MEGKEZDÉSE előtt!' });
    }
    ack && ack({ ok: true, state: game.publicState(sess.playerId) });
  });

  // ---- Tárgyalás események ----
  safeOn('accusation_read', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.accusationRead();
  });

  safeOn('done_speaking', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.doneSpeaking(sess.playerId);
  });

  safeOn('vote_verdict', ({ verdict }, ack) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return;
    game.castVerdictVote(sess.playerId, verdict);
    ack && ack({ ok: true });
  });

  safeOn('vote_challenge', ({ who, done }) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.castChallengeVote(sess.playerId, who, done);
  });

  // ---- Kihívás-ellenőrzés: a BÍRÓ döntése ----
  // A szerver itt ellenőrzi, hogy tényleg az adott ügy bírója küldte-e
  // (a kliens nem tudja megkerülni).
  safeOn('challenge_decision', ({ who, done }, ack) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return ack && ack({ error: 'Nincs szoba.' });
    const ok = game.resolveChallenge(sess.playerId, who, !!done);
    if (!ok) return ack && ack({ error: 'Csak az ügy bírója dönthet (vagy már eldöntötték).' });
    ack && ack({ ok: true });
  });

  // A bíró "Észrevettem ✓" emlékeztetője (nem döntés).
  safeOn('judge_note', ({ who }) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.judgeNote(sess.playerId, who);
  });

  // A többiek 😂/👎 "szavazata" szórakoztatásból (nem ad pontot).
  safeOn('challenge_fun_vote', ({ who, done }) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.funChallengeVote(sess.playerId, who, !!done);
  });

  safeOn('proceed_after_verdict', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.proceedAfterVerdict();
  });

  safeOn('next_round', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.nextAfterResults(sess.playerId);
  });

  safeOn('new_game', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game || game.hostId() !== sess.playerId) return;
    game.phase = PHASES.LOBBY;
    game.round = 0;
    game.roundData = null;
    game.clearTimers();
    for (const p of game.players.values()) {
      p.score = 0;
      p.laughCount = 0;
      p.convictions = 0;
      p.challengesDone = 0;
    }
    game.broadcast();
  });

  // ---- TILTAKOZOM! ----
  safeOn('objection', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.tryObjection(sess.playerId);
  });

  // ---- Reakciók ----
  safeOn('react', ({ emoji }) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.handleReaction(sess.playerId, emoji);
  });

  // ---- Rendet a teremben! (csak házigazda) ----
  safeOn('order_in_court', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game || game.hostId() !== sess.playerId) return;
    game.broadcastAll('order_in_court', {});
  });

  // ---- Kilépés ----
  safeOn('leave_room', () => {
    const sess = sockets.get(socket.id);
    if (!sess) return;
    const game = rooms.get(sess.code);
    sockets.delete(socket.id);
    if (game) game.handleLeave(sess.playerId);
  });  safeOn('disconnect', () => {
    rateWindows.delete(socket.id); // rate-limit ablak felszabadítása
    const sess = sockets.get(socket.id);
    if (!sess) return;
    const game = rooms.get(sess.code);

    sockets.delete(socket.id);
    if (game) {
      game.handleDisconnect(sess.playerId);
      // Ha a szoba teljesen kiürült, 10 perc múlva törlődik – addig még
      // visszacsatlakozhat bárki (pl. szerver újraindítás utáni frissítés).
      if (game.activePlayers().length === 0) {
        setTimeout(() => {
          const g = rooms.get(sess.code);
          if (g && g.activePlayers().length === 0) {
            g.dispose();
            rooms.delete(sess.code);
            console.log('room removed:', sess.code);
          }
        }, 10 * 60 * 1000);
      }
    }
    console.log('disconnected:', socket.id);
  });
});

// ---------- üzemeltetés: elhagyott szobák időzített takarítása ----------
// Biztonsági háló a disconnect-timeout mellett: ha egy szobában 10 perce nincs
// csatlakozott játékos (pl. mind lobbiban lépett ki, vagy nem jött disconnect
// esemény), törlődik – memória-szivárgás ellen.
const ROOM_EMPTY_LIFETIME_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, game] of rooms) {
    if (game.activePlayers().length === 0 && now - (game.lastActivityAt || 0) > ROOM_EMPTY_LIFETIME_MS) {
      game.dispose();
      rooms.delete(code);
      console.log('room removed (idle):', code);
    }
  }
}, 60 * 1000).unref();

// ---------- a szerver váratlan hibái ne állítsák le a folyamatot ----------
process.on('uncaughtException', (err) => {
  console.error('uncaughtException (a szerver fut tovább):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection (a szerver fut tovább):', err);
});

Game.setStatRecorder((name, key, by) => bumpStat(name, key, by));

// A state-küldés előtt frissítjük a profilok nyilvántartási számait.
Game.setStateHook(attachStats);

server.listen(PORT, HOST, () => {
  console.log('KAMU BÍRÓSÁG fut: http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + ' (PORT=' + PORT + ')');
});
