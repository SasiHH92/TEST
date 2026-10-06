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
const {createAuth,loadAuthEnvironment} = require('./auth');
const {createShop} = require('./shop');
const {createSocial} = require('./social');
const {verifyLegendCode} = require('./legend-claims');
const {createDms} = require('./dms');
const {cleanText} = require('./textclean');
const {budapestDate, weekStart, msUntilWeekReset} = require('./quests');
const lb = require('./leaderboard');
loadAuthEnvironment(path.join(__dirname,'.env'));

// Tartós tárolás: ha van DATABASE_URL, a fiókok / statisztika / avatárok az adatbázisból töltődnek vissza,
// MIELŐTT bármit beolvasnánk. Ez a szerver saját indítási lépése, ezért független attól, hogy a tárhely
// `node server.js`-t vagy `npm start`-ot futtat. Ha az adatbázis nem érhető el, nem indulunk el üres adattal
// (az első mentés különben felülírná az adatbázis tartalmát).
if (process.env.DATABASE_URL) {
  const hydrated = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'hydrate.js')],
    { stdio: 'inherit', env: process.env, timeout: 150000 });
  if (hydrated.status !== 0) {
    console.error('Az adatbázis nem érhető el, a szerver nem indul el (adatvesztés elkerülése).');
    process.exit(1);
  }
}
const {storage} = require('./storage'); // tartós mentés külső adatbázisba (DATABASE_URL)

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
// Legendás kártya igénylése: a kódot a LEGEND_SECRET-ből számoljuk (a titkot a tulajdonos állítja be a tárhelyen, a kódban nincs).
const LEGEND_SECRET = process.env.LEGEND_SECRET || '';
const authApi = createAuth({
  persist:()=>storage.push('accounts'),
  reservedNames:()=>REGISTRY.map((r)=>r.nev),
  onRename:renameStats,
  // érvényes (név, kód) párra a legenda pontos nevét adja vissza, egyébként null
  claimLegend:(name,code)=>{
    const reg=REGISTRY.find((r)=>r.nev===name);
    return reg&&verifyLegendCode(LEGEND_SECRET,reg.nev,code)?reg.nev:null;
  },
  // az igényelt fiók kártyája a legenda adataival indul (a hosszkorlátok a fiók-szabályokhoz igazítva)
  legendProfile:(name)=>{
    const reg=REGISTRY.find((r)=>r.nev===name)||{};
    const avatar=PROFILE_AVATARS[name];
    return {titulus:String(reg.titulus||'').slice(0,60),priusz:String(reg.priusz||'').slice(0,140),
      jelveny:String(reg.jelveny||'').slice(0,8),avatar:AVATAR_ID_RE.test(avatar||'')?avatar:''};
  }
});
app.use('/api/auth',authApi.router);
// Bolt + napi küldetések (pogácsa). A küldetések haladását a nyilvántartás napi számlálói adják.
const shopApi = createShop({
  auth:authApi,
  dailyCounts:(name)=>dailyCountsFor(name),
  areFriends:(a,b)=>socialApi.areFriends(a,b),
  // Ajándék: a barát privát üzenetet kap (megmarad, olvasatlanként látszik), és élő értesítést, ha online
  onGift:(sender,recipient,item)=>{
    socialApi.sendDm(sender,recipient.id,'🎁 Ajándékot küldtem neked: '+item.nev+'!');
    io.to('u:'+recipient.id).emit('gift_received',{from:socialApi.card(sender),item:{id:item.id,nev:item.nev}});
  }
});
app.use('/api/shop',shopApi.router);
// Barátlista: kapcsolatok a fiókban, online állapot a socketekből (a `rooms`/`sockets` térképek lentebb jönnek létre,
// de csak futás közben használjuk őket).
// Privát üzenetek a barátok között: fájlban él, és a külső adatbázisba is feltöltődik (újraindítás után sem vész el).
const dms = createDms({ file: path.resolve(__dirname, process.env.KB_DMS_FILE || 'data/dms.json'), persist: () => storage.push('dms') });
const socialApi = createSocial({
  auth: authApi,
  dms,
  roomOf: (socketId) => {
    const sess = sockets.get(socketId);
    const game = sess && rooms.get(sess.code);
    return game ? { code: sess.code, phase: game.phase === PHASES.LOBBY ? 'lobby' : 'game', full: game.activePlayers().length >= 8 } : null;
  },
  emit: (userId, event, payload) => io.to('u:' + userId).emit(event, payload)
});
app.use('/api/friends',socialApi.router);

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

// ---------- ranglista (nyilvános, csak olvasható) ----------
// GET /api/leaderboard?period=heti|osszes&metric=pont|gyozelem|artatlan|kihivas|jatek&me=<név>
// A számok név szerint a statisztikából jönnek (vendégek és fiókosok egyaránt); a heti lista hétfő 00:00-kor (Budapest) indul újra.
const boardHits = new Map(); // ip -> időbélyegek (egyszerű sebességkorlát)
app.get('/api/leaderboard', (req, res) => {
  const now = Date.now();
  const hits = (boardHits.get(req.ip) || []).filter((t) => now - t < 60 * 1000);
  if (hits.length >= 60) return res.status(429).json({ error: 'Túl sok kérés. Próbáld újra egy perc múlva.' });
  hits.push(now); boardHits.set(req.ip, hits);
  if (boardHits.size > 5000) boardHits.delete(boardHits.keys().next().value);
  const period = lb.PERIODS.includes(req.query.period) ? req.query.period : 'osszes';
  const metric = lb.isMetric(req.query.metric) ? req.query.metric : 'pont';
  const me = typeof req.query.me === 'string' ? req.query.me.slice(0, 40) : '';
  const week = weekStart(budapestDate());
  const result = lb.build(STATS, { period, metric, weekStart: week, me });
  const legends = new Set(REGISTRY.filter((r) => r.keret).map((r) => r.nev));
  res.set('Cache-Control', 'no-store');
  res.json({
    ...result,
    rows: result.rows.map((r) => ({ ...r, legend: legends.has(r.name) })),
    metrics: lb.METRICS, weekStart: week, resetsInMs: msUntilWeekReset()
  });
});

// ---------- előre megadott játékosok + bűnügyi nyilvántartás ----------

const PLAYERS_FILE = path.join(__dirname, 'data', 'players.json');
const STATS_FILE = process.env.KB_STATS_FILE || path.join(__dirname, 'data', 'stats.json'); // (a KB_STATS_FILE csak fejlesztéshez / teszthez kell)

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
let statsPending = false;
function saveStats() {
  clearTimeout(statsSaveTimer);
  statsPending = true;
  statsSaveTimer = setTimeout(() => {
    statsPending = false;
    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify(STATS, null, 2));
      storage.push('stats');
      lastStatsSaveError = null;
    } catch (e) {
      if (lastStatsSaveError !== e.code) {
        lastStatsSaveError = e.code;
        console.error('Nem sikerült menteni a nyilvántartást (' + (e.code || e.name) + ') – a játék fut tovább, a statisztika elveszhet:', e.message);
      }
    }
  }, 300);
}

// A bűnügyi nyilvántartás számai (játékosonként, név szerint). A régi stats.json-ben hiányzó kulcsok 0-nak számítanak.
//   vadlott/bunos/artatlan: vádlottként hányszor, ebből elítélve / felmentve   dijak: díjak
//   jatek/gyozelem/pont: lejátszott játékok, megnyert játékok, összpontszám      korok: lejátszott körök
//   ugyesz/ugyeszSiker, vedo/vedoSiker: ügyészként / védőként hányszor, ebből hány elítélés / felmentés
//   biro/tanu: bíróként / tanúként hányszor                                       kihivas: teljesített kihívások
const STAT_KEYS = ['vadlott', 'bunos', 'artatlan', 'dijak', 'jatek', 'gyozelem', 'pont', 'korok',
  'ugyesz', 'ugyeszSiker', 'vedo', 'vedoSiker', 'biro', 'tanu', 'kihivas'];

function recordFor(name) {
  if (!STATS[name] || typeof STATS[name] !== 'object') STATS[name] = {};
  for (const k of STAT_KEYS) if (typeof STATS[name][k] !== 'number') STATS[name][k] = 0;
  return STATS[name];
}

function bumpStat(name, key, by = 1) {
  if (!STAT_KEYS.includes(key)) return;
  const r = recordFor(name);
  r[key] += by;
  // Napi számláló (Budapest szerinti nap): a napi küldetések haladása ebből jön.
  const day = budapestDate();
  if (!r.daily || r.daily.date !== day) r.daily = { date: day, counts: {} };
  r.daily.counts[key] = (r.daily.counts[key] || 0) + by;
  // Heti számláló (a hét hétfőtől vasárnapig tart, Budapest szerint): a heti ranglista ebből jön.
  const week = weekStart(day);
  if (!r.weekly || r.weekly.week !== week) r.weekly = { week, counts: {} };
  r.weekly.counts[key] = (r.weekly.counts[key] || 0) + by;
  saveStats();
}

// A mai nap számlálói (a régi napé már nem számít).
function dailyCountsFor(name) {
  const r = STATS[name];
  return r && r.daily && r.daily.date === budapestDate() ? r.daily.counts : {};
}

function statsForName(name) {
  const r = STATS[name];
  if (!r) return null;
  const out = {};
  for (const k of STAT_KEYS) out[k] = typeof r[k] === 'number' ? r[k] : 0;
  return out;
}

// Átnevezéskor a számok követik a játékost (a régi név számai az újhoz kerülnek).
function renameStats(oldName, newName) {
  if (!oldName || !newName || oldName === newName || !STATS[oldName]) return;
  const from = recordFor(oldName), to = recordFor(newName);
  for (const k of STAT_KEYS) to[k] += from[k];
  // a mai napi számlálók is átkerülnek
  const day = budapestDate();
  if (from.daily && from.daily.date === day) {
    if (!to.daily || to.daily.date !== day) to.daily = { date: day, counts: {} };
    for (const [k, v] of Object.entries(from.daily.counts || {})) to.daily.counts[k] = (to.daily.counts[k] || 0) + v;
  }
  // a heti számlálók is (ha ugyanarra a hétre szólnak)
  const week = weekStart(day);
  if (from.weekly && from.weekly.week === week) {
    if (!to.weekly || to.weekly.week !== week) to.weekly = { week, counts: {} };
    for (const [k, v] of Object.entries(from.weekly.counts || {})) to.weekly.counts[k] = (to.weekly.counts[k] || 0) + v;
  }
  delete STATS[oldName];
  saveStats();
}

// Az összes előre megadott játékos profilja (nyilvántartási kártyához).
const REGISTRY = PLAYER_DB.players.map((p) => ({
  nev: p.nev,
  jelveny: p.jelveny || '',
  titulus: p.titulus || '',
  priusz: p.priusz || '',
  // A legendás tesztelők egyedi, a boltban nem kapható kerete (frame_<név>); a stíluslapban él a hozzá tartozó animáció.
  keret: /^frame_[a-z]+$/.test(p.keret || '') ? p.keret : '',
  hatter: /^bg_[a-z]+$/.test(p.hatter || '') ? p.hatter : '', // egyedi, szintén nem kapható kártyaháttér
  stats: statsForName(p.nev)
}));
const LEGEND_LABEL = 'LEGENDA';

// A nyilvántartott játékosok utoljára választott avatárja (név -> "av01"…"av50"),
// hogy a névválasztó kártyákon mindenkinél látsszon. Hibatűrő mentés, mint a statisztikánál.
const AVATARS_FILE = process.env.KB_AVATARS_FILE || path.join(__dirname, 'data', 'avatars.json'); // (a KB_AVATARS_FILE csak a teszteknek kell)
const AVATAR_ID_RE = /^av(0[1-9]|[1-4]\d|50)$/;
let PROFILE_AVATARS = {};
try {
  PROFILE_AVATARS = JSON.parse(fs.readFileSync(AVATARS_FILE, 'utf8')) || {};
} catch (e) {
  if (e.code !== 'ENOENT') console.error('data/avatars.json nem olvasható – üresen indul:', e.message);
}
let avatarSaveTimer = null;
let avatarsPending = false;
function saveProfileAvatars() {
  clearTimeout(avatarSaveTimer);
  avatarsPending = true;
  avatarSaveTimer = setTimeout(() => {
    avatarsPending = false;
    try { fs.writeFileSync(AVATARS_FILE, JSON.stringify(PROFILE_AVATARS, null, 2)); storage.push('avatars'); } catch (e) {
      console.error('Nem sikerült menteni az avatárokat:', e.message);
    }
  }, 300);
}

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
// A profil + a fiók felvett kozmetikumai. A cosm és az acct mezőt csak a szerver tölti ki, a socket
// azonosított fiókja alapján (identify), és csak akkor, ha a játékos a fiókja nevével lép be
// (a kliens nem hamisíthatja). Az acct jelzi a többieknek, hogy a játékos bejelentkezett fiók (barátnak jelölhető).
function profileFor(socket, name, rawProfile) {
  let profile = cleanProfile(rawProfile);
  try {
    const userId = socialApi.userOf(socket.id);
    const user = userId ? authApi.directory.byId(userId) : null;
    if (user && String(user.username).toLowerCase() === String(name || '').toLowerCase()) {
      profile = profile || { titulus: '', priusz: '', jelveny: '' };
      profile.acct = true;
      const cosm = shopApi.cosmeticsFor(user);
      if (cosm) profile.cosm = cosm;
    }
    // A legendás tesztelők nyilvántartási nevén mindenkinek ott az egyedi keret és a LEGENDA felirat
    // (a név foglalt: fiókkal nem regisztrálható, a kliens nem adhat hozzá saját kozmetikumot).
    const legend = REGISTRY.find((r) => r.nev === name);
    if (legend && legend.keret) {
      profile = profile || { titulus: '', priusz: '', jelveny: '' };
      // a legenda keret/háttér/felirata; a gazdája bolt-tárgyai (névhatás, pecsét) megmaradnak
      profile.cosm = { ...(profile.cosm || {}), frame: legend.keret, ...(legend.hatter ? { bg: legend.hatter } : {}), labelText: LEGEND_LABEL };
    }
  } catch (e) { /* a profil a kozmetikum nélkül is érvényes */ }
  return profile;
}
function cleanAvatar(avatar) {
  return typeof avatar === 'string' ? avatar.slice(0, 40) : '';
}
// ---- Szobai csevegő: mindenki ír mindenkinek a szobában (lobbi + játék) ----
// Az üzenetek a szoba memóriájában élnek (utolsó CHAT_KEEP db); belépéskor/visszacsatlakozáskor megkapja a belépő.
// Szűrés: hossz, vezérlőkarakterek, sebességkorlát; a bejelentkezett játékos letiltottjának üzenete nem látszik neki.
const CHAT_MAX_LEN = 280, CHAT_KEEP = 80, CHAT_WINDOW_MS = 6000, CHAT_BURST = 4, CHAT_DUP_MS = 4000;
const chatTimes = new Map(); // socketId -> utolsó küldések időbélyegei
const cleanChatText = (v) => cleanText(v, CHAT_MAX_LEN); // (a tiltott karakterek listája a textclean.js-ben él)
function chatVisible(viewerSocketId, entry) {
  const viewer = socialApi.userOf(viewerSocketId);
  return !(viewer && entry.uid && socialApi.hides(viewer, entry.uid));
}
const chatPublic = ({ id, pid, name, text, ts }) => ({ id, pid, name, text, ts });
function chatFor(socketId, game) {
  return (game.chatLog || []).filter((m) => chatVisible(socketId, m)).slice(-50).map(chatPublic);
}

// ---- Közös tér: globális csevegő + hirdetőtábla ("keresek embereket") ----
// Az egész oldalon elérhető (névválasztó, menü, lobbi, játék). A hirdetés egy nyitott lobbi szobakódját teszi közzé
// (a kódot a szerver adja, a kliens nem hamisíthatja), amíg a szoba a lobbiban van, nincs tele, és legfeljebb 20 percig.
const BOARD_KEEP = 100, BOARD_MAX_LEN = 240, AD_MAX_LEN = 120, AD_TTL_MS = 20 * 60 * 1000, AD_GAP_MS = 3 * 60 * 1000;
const BOARD_WINDOW_MS = 30 * 1000, BOARD_BURST = 6, BOARD_GAP_MS = 1500, BOARD_DUP_MS = 10 * 1000;
const board = { msgs: [], seq: 0, ads: new Map(), adSeq: 0 }; // ads: szobakód -> hirdetés
const boardTimes = new Map(); // socketId -> küldések időbélyegei
const adGaps = new Map();     // fiók-azonosító / socketId -> utolsó hirdetés ideje
let lastAdsJson = '[]', adsTimer = null;

const boardPublic = ({ id, name, text, ts, kind }) => ({ id, name, text, ts, kind });
function boardFor(socketId) {
  return board.msgs.filter((m) => chatVisible(socketId, m)).slice(-60).map(boardPublic);
}

// A közös térben használt név: szobában a játékos neve, bejelentkezve a fiók neve; vendégnél a (szabad) megadott név.
function boardNameFor(socket, clientName) {
  const sess = sockets.get(socket.id);
  const game = sess && rooms.get(sess.code);
  const player = game && game.getPlayer(sess.playerId);
  if (player && !player.isBot) return { name: player.name };
  const userId = socialApi.userOf(socket.id);
  const user = userId ? authApi.directory.byId(userId) : null;
  if (user) return { name: user.username };
  const raw = typeof clientName === 'string' ? clientName.trim().slice(0, 20) : '';
  if (!raw) return { error: 'Előbb válaszd ki a karaktered (vagy a vendégnevedet), utána tudsz írni.' };
  // legenda nevén csak az írhat, aki az ő kártyájával játszik (szobában: fent), vendég nem
  if (REGISTRY.some((r) => normName(r.nev) === normName(raw))) return { error: 'Ez egy nyilvántartott játékos neve, vendégként nem használható.' };
  const problem = nameProblem(socket, raw);
  return problem ? { error: problem } : { name: raw };
}

function adsSnapshot() {
  const now = Date.now(), out = [];
  for (const [code, ad] of board.ads) {
    const game = rooms.get(code);
    const players = game ? game.activePlayers().length : 0;
    if (!game || players === 0 || game.phase !== PHASES.LOBBY || players >= 8 || now - ad.ts > AD_TTL_MS) { board.ads.delete(code); continue; }
    out.push({ id: ad.id, code, name: ad.name, text: ad.text, ts: ad.ts, players, max: 8 });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
// A hirdetések listája csak változáskor megy ki (szoba megtelt / elindult / kiürült / lejárt / új hirdetés).
function refreshAds() {
  clearTimeout(adsTimer);
  adsTimer = setTimeout(() => {
    const ads = adsSnapshot(), json = JSON.stringify(ads);
    if (json !== lastAdsJson) { lastAdsJson = json; io.to('board').emit('board_ads', ads); }
  }, 250);
  if (adsTimer.unref) adsTimer.unref();
}
setInterval(refreshAds, 15 * 1000).unref();

// ---- Névszabály: foglalt név nem használható ----
// A nyilvántartott (legendás) nevek csak a saját kártyájukkal, a regisztrált játékosok nevei csak a bejelentkezett
// gazdájuknak járnak; ezek kis/nagybetűs, ékezetes változata sem (megszemélyesítés ellen). Szobán belül a nevek
// úgyis egyediek (kis/nagybetű nélkül). A hibaüzenet üres, ha a név használható.
const normName = (v) => String(v == null ? '' : v).normalize('NFKC').trim().toLocaleLowerCase('hu-HU');
function nameProblem(socket, rawName) {
  const name = String(rawName == null ? '' : rawName).trim();
  if (!name) return 'Adj meg egy nevet.';
  const n = normName(name);
  // a nyilvántartott nevek pontosan (pl. "marci" és "Marci" két külön legenda) használhatók a kártyájukkal
  if (!REGISTRY.some((r) => r.nev === name)) {
    const twin = REGISTRY.find((r) => normName(r.nev) === n);
    if (twin) return 'Ez a név a nyilvántartott „' + twin.nev + '” játékosé. Válassz másik nevet, vagy játssz az ő kártyájával.';
  }
  const owner = authApi.directory.byName(name);
  if (owner) {
    const userId = socialApi.userOf(socket.id);
    if (userId !== owner.id) return 'Ez a név egy regisztrált játékosé. Válassz másik nevet, vagy jelentkezz be vele.';
  }
  return '';
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
    autoNextRound: bool('autoNextRound'),
    autoNewGame: bool('autoNewGame'),
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

const pidRoom = (playerId, code) => 'p:' + code + ':' + playerId;

// Avatar-dekorációk (nem kártyatartalom).
const APPEARANCES = ['bírói kalap', 'paróka', 'rabruha', 'napszemüveg', 'feltűnő csokornyakkendő', 'birkajelmez', 'pókaszapityó', 'ünnepi kalap'];

// Az aktív játékosok profiljához rácsatoljuk a nyilvántartási számait,
// hogy a lobby plakátjain megjelenhessen az "Elítélve/Felmentve" és a KÖZELLENSÉG.
// A Game.broadcast-ja minden state-küldés előtt meghívja.
function attachStats(game) {
  for (const p of game.players.values()) {
    if (p.profile) p.profile._stats = statsForName(p.name);
  }
  // Ha a szoba lobbiból játékba (vagy vissza) váltott, a benne lévő fiókok barátai új állapotot látnak.
  if (game._presencePhase !== game.phase) {
    game._presencePhase = game.phase;
    refreshAds(); // a játékba lépett szoba hirdetése lekerül a közös térről
    for (const [socketId, sess] of sockets) {
      if (sess.code !== game.code) continue;
      const uid = socialApi.userOf(socketId);
      if (uid) socialApi.touch(uid);
    }
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

  // ---- Fiók-azonosítás: a kliens a /api/friends/ticket jegyével jelzi, melyik fiók (vagy vendég) a socket ----
  // (A süti a socket létrejöttekor rögzül, ezért bejelentkezés/kijelentkezés után nem lehetne arra támaszkodni.)
  const presenceChanged = () => { const uid = socialApi.userOf(socket.id); if (uid) socialApi.touch(uid); refreshAds(); };
  safeOn('identify', (payload, ack) => {
    const ticket = payload && typeof payload.ticket === 'string' ? payload.ticket.slice(0, 80) : '';
    const userId = ticket ? socialApi.consumeTicket(ticket) : null;
    const prev = socialApi.userOf(socket.id);
    if (prev !== userId) {
      if (prev) { socket.leave('u:' + prev); socialApi.disconnect(socket.id); }
      if (userId) { socket.join('u:' + userId); socialApi.connect(userId, socket.id); }
    }
    if (typeof ack === 'function') ack({ ok: true, account: !!userId });
  });

  // ---- Meghívás a saját szobámba (csak barátnak, csak lobbiból) ----
  safeOn('friend_invite', ({ friendId } = {}, ack) => {
    const reply = (r) => { if (typeof ack === 'function') ack(r); };
    const userId = socialApi.userOf(socket.id);
    const user = userId ? authApi.directory.byId(userId) : null;
    if (!user) return reply({ error: 'A meghíváshoz be kell jelentkezned.' });
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return reply({ error: 'Előbb hozz létre vagy lépj be egy szobába.' });
    if (game.phase !== PHASES.LOBBY) return reply({ error: 'Meghívni csak a lobbiból lehet.' });
    if (typeof friendId !== 'string' || friendId.length > 64) return reply({ error: 'Érvénytelen kérés.' });
    reply(socialApi.invite(user, friendId, sess.code));
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
      // claimed: a legenda kártyáját már igényelte egy fiók (attól kezdve csak a gazdája használhatja bejelentkezve)
      registry: REGISTRY.map((r) => ({ ...r, stats: statsForName(r.nev), avatar: PROFILE_AVATARS[r.nev] || '', claimed: !!authApi.directory.byName(r.nev) })),
      vendegPriuszok: GUEST_PRIORS,
      takenNames: Array.from(taken)
    });
  });

  // ---- Egy név bűnügyi számai (a bejelentkezett játékos saját kártyájához) ----
  // ---- Csevegő: üzenet küldése a szobának ----
  safeOn('chat_send', ({ text } = {}, ack) => {
    const reply = (r) => { if (typeof ack === 'function') ack(r); };
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    const player = game && game.getPlayer(sess.playerId);
    if (!player) return reply({ error: 'Csak szobában lehet csevegni.' });
    const clean = cleanChatText(text);
    if (!clean) return reply({ error: 'Üres üzenet.' });
    const now = Date.now();
    const recent = (chatTimes.get(socket.id) || []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) return reply({ error: 'Lassabban! Várj egy kicsit a következő üzenettel.' });
    game.chatLog = game.chatLog || [];
    const last = game.chatLog[game.chatLog.length - 1];
    if (last && last.pid === player.id && last.text === clean && now - last.ts < CHAT_DUP_MS) return reply({ error: 'Ezt az üzenetet épp most küldted.' });
    recent.push(now);
    chatTimes.set(socket.id, recent);
    game.chatSeq = (game.chatSeq || 0) + 1;
    const entry = { id: game.chatSeq, pid: player.id, name: player.name, text: clean, ts: now, uid: socialApi.userOf(socket.id) || null };
    game.chatLog.push(entry);
    if (game.chatLog.length > CHAT_KEEP) game.chatLog.splice(0, game.chatLog.length - CHAT_KEEP);
    for (const [sid, s] of sockets) {
      if (s.code === sess.code && chatVisible(sid, entry)) io.to(sid).emit('chat_msg', chatPublic(entry));
    }
    reply({ ok: true, id: entry.id });
  });

  // ---- Közös tér: feliratkozás (előzmény + aktuális hirdetések) ----
  safeOn('board_sub', (_payload, ack) => {
    socket.join('board');
    if (typeof ack === 'function') ack({ msgs: boardFor(socket.id), ads: adsSnapshot() });
  });

  // ---- Közös tér: üzenet ----
  safeOn('board_send', ({ text, name } = {}, ack) => {
    const reply = (r) => { if (typeof ack === 'function') ack(r); };
    const who = boardNameFor(socket, name);
    if (who.error) return reply({ error: who.error });
    const clean = cleanChatText(text).slice(0, BOARD_MAX_LEN);
    if (!clean) return reply({ error: 'Üres üzenet.' });
    const now = Date.now();
    const recent = (boardTimes.get(socket.id) || []).filter((t) => now - t < BOARD_WINDOW_MS);
    if (recent.length && now - recent[recent.length - 1] < BOARD_GAP_MS) return reply({ error: 'Lassabban! Várj egy kicsit a következő üzenettel.' });
    if (recent.length >= BOARD_BURST) return reply({ error: 'Túl sok üzenet. Várj fél percet.' });
    const last = [...board.msgs].reverse().find((m) => m.kind === 'msg' && m.name === who.name);
    if (last && last.text === clean && now - last.ts < BOARD_DUP_MS) return reply({ error: 'Ezt az üzenetet épp most küldted.' });
    recent.push(now);
    boardTimes.set(socket.id, recent);
    board.seq += 1;
    const entry = { id: board.seq, kind: 'msg', name: who.name, text: clean, ts: now, uid: socialApi.userOf(socket.id) || null };
    board.msgs.push(entry);
    if (board.msgs.length > BOARD_KEEP) board.msgs.splice(0, board.msgs.length - BOARD_KEEP);
    const members = io.sockets.adapter.rooms.get('board') || new Set();
    for (const sid of members) if (chatVisible(sid, entry)) io.to(sid).emit('board_msg', boardPublic(entry));
    reply({ ok: true, id: entry.id });
  });

  // ---- Közös tér: hirdetés a saját (nyitott lobbi) szobámról ----
  safeOn('board_ad', ({ text } = {}, ack) => {
    const reply = (r) => { if (typeof ack === 'function') ack(r); };
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    const player = game && game.getPlayer(sess.playerId);
    if (!player) return reply({ error: 'Hirdetni csak a saját szobádból lehet: előbb hozz létre vagy lépj be egy szobába.' });
    if (game.phase !== PHASES.LOBBY) return reply({ error: 'Hirdetni csak a lobbiból lehet, a játék elindulása előtt.' });
    if (game.activePlayers().length >= 8) return reply({ error: 'A szoba tele van, nincs mit hirdetni.' });
    const existing = adsSnapshot().find((a) => a.code === sess.code);
    if (existing) return reply({ error: 'A szobának már van hirdetése. Addig érvényes, amíg a szoba a lobbiban van (legfeljebb 20 percig).' });
    const key = socialApi.userOf(socket.id) || socket.id;
    const now = Date.now();
    if (now - (adGaps.get(key) || 0) < AD_GAP_MS) return reply({ error: 'Hirdetni 3 percenként lehet. Várj egy kicsit.' });
    if (board.ads.size >= 30) return reply({ error: 'Most túl sok a hirdetés. Próbáld később.' });
    const clean = cleanChatText(text).slice(0, AD_MAX_LEN) || 'Keresek embereket a szobámba!';
    adGaps.set(key, now);
    if (adGaps.size > 2000) adGaps.delete(adGaps.keys().next().value);
    board.adSeq += 1;
    board.ads.set(sess.code, { id: board.adSeq, name: player.name, text: clean, ts: now, owner: socket.id, uid: socialApi.userOf(socket.id) || null });
    // a közös csevegőben is megjelenik egy sor
    board.seq += 1;
    const entry = { id: board.seq, kind: 'ad', name: player.name, text: '📣 ' + clean, ts: now, uid: socialApi.userOf(socket.id) || null };
    board.msgs.push(entry);
    if (board.msgs.length > BOARD_KEEP) board.msgs.splice(0, board.msgs.length - BOARD_KEEP);
    const members = io.sockets.adapter.rooms.get('board') || new Set();
    for (const sid of members) if (chatVisible(sid, entry)) io.to(sid).emit('board_msg', boardPublic(entry));
    lastAdsJson = '';
    refreshAds();
    reply({ ok: true, code: sess.code });
  });

  // ---- Közös tér: a saját hirdetés visszavonása (a szoba bármelyik tagja) ----
  safeOn('board_ad_remove', (_payload, ack) => {
    const sess = sockets.get(socket.id);
    if (sess && board.ads.delete(sess.code)) { lastAdsJson = ''; refreshAds(); }
    if (typeof ack === 'function') ack({ ok: true });
  });

  // ---- Szabad-e a név? (a vendég-névmező előzetes ellenőrzése; a szerver a belépéskor úgyis kikényszeríti) ----
  safeOn('check_name', ({ name, guest } = {}, ack) => {
    if (typeof ack !== 'function') return;
    const clean = typeof name === 'string' ? name.slice(0, 40) : '';
    let problem = nameProblem(socket, clean);
    // A vendég-névmezőbe sem írható be egy legenda pontos neve: arra a kártyája való (a kerete is azzal jár).
    if (!problem && guest && REGISTRY.some((r) => r.nev === clean.trim())) {
      problem = 'Ez egy nyilvántartott játékos neve. Válaszd ki a kártyáját a „A legendás tesztelők” között, vagy használj másik nevet.';
    }
    ack(problem ? { error: problem } : { ok: true });
  });

  safeOn('get_stats', ({ name } = {}, ack) => {
    if (typeof ack !== 'function') return;
    ack({ stats: typeof name === 'string' ? statsForName(name.slice(0, 40)) : null });
  });

  // ---- Egy nyilvántartott játékos avatárjának mentése (kártyára kattintás után) ----
  safeOn('set_avatar', ({ name, avatar } = {}) => {
    if (typeof name !== 'string' || !REGISTRY.some((r) => r.nev === name)) return;
    if (typeof avatar !== 'string' || !AVATAR_ID_RE.test(avatar)) return;
    // Aki épp játékban van (ŐRIZETBEN), annak az avatárját más nem írhatja át.
    for (const game of rooms.values()) {
      for (const p of game.players.values()) if (p.connected && p.name === name) return;
    }
    PROFILE_AVATARS[name] = avatar;
    saveProfileAvatars();
  });

  function detachPreviousRoom() {
    const prev=sockets.get(socket.id);
    if (!prev) return;
    sockets.delete(socket.id);
    socket.leave(prev.code);
    socket.leave(pidRoom(prev.playerId, prev.code));
    const game=rooms.get(prev.code);
    if (game && ![...sockets.values()].some((x)=>x.code===prev.code&&x.playerId===prev.playerId)) game.handleLeave(prev.playerId);
    presenceChanged();
  }

  // ---- Szoba létrehozása ----
  safeOn('create_room', ({ name, avatar, playerId, profile }, ack) => {
    if (rooms.size >= MAX_ROOMS) return ack && ack({ error: 'A szerver jelenleg betelt – próbálj meg később csatlakozni!' });
    const code = newCode();
    if (!code) return ack && ack({ error: 'Nem sikerült szobát létrehozni.' });
    const pid = cleanPlayerId(playerId, socket.id);
    const nameIssue = nameProblem(socket, name);
    if (nameIssue) return ack && ack({ error: nameIssue });
    detachPreviousRoom();
    const game = new Game(code, io);
    rooms.set(code, game);
    game.addPlayer(pid, name, cleanAvatar(avatar), true);
    game.getPlayer(pid).profile = profileFor(socket, name, profile);
    game.getPlayer(pid).sessionToken = crypto.randomBytes(24).toString('hex');
    socket.join(code);
    socket.join(pidRoom(pid, code));
    sockets.set(socket.id, { code, playerId: pid });
    ack && ack({ code, playerId: pid, sessionToken: game.getPlayer(pid).sessionToken, state: game.publicState(pid), appearances: APPEARANCES, chat: [] });
    game.broadcast();
    presenceChanged();
  });

  // ---- Csatlakozás kóddal (visszacsatlakozás is ez) ----
  safeOn('join_room', ({ code, name, avatar, playerId, profile, sessionToken }, ack) => {
    const norm = String(code || '').trim().toUpperCase();
    const game = rooms.get(norm);
    if (!game) {
      // A szerver újraindulhatott (a szobák memóriában élnek) – érthető hiba,
      // a kliens ezzel visszakerül a menübe, nem ragad be.
      return ack && ack({ error: 'A szoba megszűnt, hozz létre egy újat! (' + norm + ')' });
    }
    const pid = cleanPlayerId(playerId, socket.id);
    // KIRÚGOTT játékos: az adott játék alatt a kóddal sem tud visszalépni.
    // A lobbyba visszatérve (vagy új játékkal) a házigazda újra meghívhatja.
    if ((game.kickedIds.has(pid) || game.kickedNames.has(String(name).slice(0,20).toLowerCase())) && game.phase !== 'lobby') {
      return ack && ack({ error: 'A házigazda kirúgott a szobából – a lobbyba visszatérve, vagy új játékkal csatlakozhatsz újra.' });
    }
    const returning = game.players.has(pid);
    const existing = game.getPlayer(pid);
    if (returning && existing.sessionToken && existing.sessionToken !== sessionToken) {
      return ack && ack({error:'Ez a játékosazonosító másik munkamenethez tartozik.'});
    }
    if (!returning) {
      if (game.activePlayers().length >= 8) {
        return ack && ack({ error: 'A szoba tele van (max 8 játékos).' });
      }
      const nameIssue = nameProblem(socket, name);
      if (nameIssue) return ack && ack({ error: nameIssue });
      // Ugyanaz a név egyszer lehet a szobában.
      const nameTaken = Array.from(game.players.values())
        .some((p) => p.connected && p.name.toLowerCase() === String(name).toLowerCase());
      if (nameTaken) {
        return ack && ack({ error: '"' + name + '" már ŐRIZETBEN van ebben a szobában!' });
      }
    }
    const prev=sockets.get(socket.id);
    if (prev && (prev.code!==norm || prev.playerId!==pid)) detachPreviousRoom();
    game.addPlayer(pid, name, cleanAvatar(avatar), false);
    const meP = game.getPlayer(pid);
    if (meP.kickedOut) {
      meP.kickedOut = false; // lobbyban a házigazda visszahívhatta
      game.kickedIds.delete(pid);
    }
    meP.profile = profileFor(socket, name, profile);
    if (!meP.sessionToken) meP.sessionToken = crypto.randomBytes(24).toString('hex');
    socket.join(norm);
    socket.join(pidRoom(pid, norm));
    sockets.set(socket.id, { code: norm, playerId: pid });
    if (returning) game.handleReconnect(pid);
    ack && ack({ code: norm, playerId: pid, sessionToken: meP.sessionToken, state: game.publicState(pid), appearances: APPEARANCES, chat: chatFor(socket.id, game) });
    game.broadcast();
    presenceChanged();
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
    if (game.hostId() !== sess.playerId) return ack && ack({error:'Csak a házigazda indíthat tárgyalást.'});
    if (game.activePlayers().length < 3) return ack && ack({error:'Legalább 3 játékos kell.'});
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
    if (game && game.hostId() === sess.playerId) game.proceedAfterVerdict();
  });

  safeOn('next_round', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.nextAfterResults(sess.playerId);
  });

  safeOn('new_game', (...args) => {
    const ack=findAck(args);
    const sess=sockets.get(socket.id);
    const game=sess&&rooms.get(sess.code);
    const ok=game&&game.restartGame(sess.playerId);
    ack && ack(ok ? {ok:true} : {error:'Az új játékot csak a házigazda indíthatja a ranglistáról.'});
  });
  safeOn('stop_auto_game', (...args) => {
    const ack=findAck(args);
    const sess=sockets.get(socket.id);
    const game=sess&&rooms.get(sess.code);
    const ok=game&&game.stopAutomaticRestart(sess.playerId);
    ack && ack(ok ? {ok:true} : {error:'Csak a házigazda állíthatja meg az új játékot.'});
  });

  // ---- TILTAKOZOM! (új rendszer) ----
  safeOn('objection', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.tryObjection(sess.playerId);
  });

  // Védekezés vége: a megtámadott beszélő "Végeztem"-ot nyom.
  safeOn('objection_defense_done', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.objectionDefenseDone(sess.playerId);
  });

  // Bíró döntése a tiltakozásról (csak a bíró küldheti).
  safeOn('objection_judge_decision', ({ accepted }, ack) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return ack && ack({ error: 'Nincs szoba.' });
    const ok = game.objectionJudgeDecision(sess.playerId, !!accepted);
    if (!ok) return ack && ack({ error: 'Nem tegyél ilyet!' });
    ack && ack({ ok: true });
  });

  // ---- Reakciók ----
  safeOn('react', ({ emoji }) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (game) game.handleReaction(sess.playerId, emoji);
  });

  // ---- Rendet a teremben! (csak az aktuális KÖR BÍRÓJA) ----
  // SZERVERI ELLENŐRZÉS: a házigazda-iesség nem elég, csak a kör bírója
  // kalapácsolhat. Körbíró nélkül ez a művelet nem elérhető.
  safeOn('order_in_court', () => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return;
    const d = game.roundData;
    const roundJudge = (game.phase !== 'lobby' && d && d.currentJudgeId) ? d.currentJudgeId : null;
    const allowed = !!roundJudge && roundJudge === sess.playerId;
    if (!allowed) return;
    game.broadcastAll('order_in_court', { by: sess.playerId });
  });

  // ---- HÁZIGAZDAI KIRÚGÁS ----
  // SZERVERI ELLENŐRZÉS: csak a házigazda kérheti, magát nem rúghatja ki.
  safeOn('kick_player', ({ playerId: targetId }, ack) => {
    const sess = sockets.get(socket.id);
    const game = sess && rooms.get(sess.code);
    if (!game) return ack && ack({ error: 'Nincs szoba.' });
    if (game.hostId() !== sess.playerId) return ack && ack({ error: 'Csak a házigazda rúghat ki játékost.' });
    if (!targetId || targetId === sess.playerId) return ack && ack({ error: 'Érvénytelen kirúgás.' });
    const target = game.getPlayer(targetId);
    if (!target) return ack && ack({ error: 'Nincs ilyen játékos a szobában.' });
    const ok = game.kickPlayer(targetId);
    if (!ok) return ack && ack({ error: 'Nem sikerült a kirúgás.' });
    // A kirúgott socket-munkamenetei megszűnnek (nem kaphat több szoba-eseményt,
    // és nem tud eseményeket küldeni – pl. szavazatot).
    for (const [sid, s] of sockets) {
      if (s.playerId === targetId && s.code === game.code) sockets.delete(sid);
    }
    // Rövid késleltetéssel bontjuk a kapcsolatát, hogy a kliens előbb megkapja
    // a you_are_kicked üzenetet és visszaérjen a menübe.
    setTimeout(() => {
      try { io.in(game.playerRoom(targetId)).disconnectSockets(true); } catch (e) { /* */ }
    }, 600);
    ack && ack({ ok: true });
  });

  // ---- Kilépés ----
  safeOn('leave_room', (...args) => {
    const ack = findAck(args);
    const sess = sockets.get(socket.id);
    if (!sess) return ack && ack({ ok: true });
    const game = rooms.get(sess.code);
    sockets.delete(socket.id);
    socket.leave(sess.code);
    socket.leave(pidRoom(sess.playerId, sess.code));
    if (game) game.handleLeave(sess.playerId);
    presenceChanged();
    ack && ack({ ok: true });
  });
  safeOn('disconnect', () => {
    rateWindows.delete(socket.id); // rate-limit ablak felszabadítása
    chatTimes.delete(socket.id);
    boardTimes.delete(socket.id);
    refreshAds(); // a lecsatlakozó szoba hirdetése frissül / eltűnik
    socialApi.disconnect(socket.id); // offline lett (a barátai frissítik a listájukat)
    const sess = sockets.get(socket.id);
    if (!sess) return;
    const game = rooms.get(sess.code);

    sockets.delete(socket.id);
    if (game) {
      if (![...sockets.values()].some((x)=>x.code===sess.code&&x.playerId===sess.playerId)) game.handleDisconnect(sess.playerId);
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

// Leállításkor (Render újraindítás / új telepítés) a függő mentések azonnal kiíródnak,
// és feltöltődnek a külső adatbázisba.
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      if (statsPending) { fs.writeFileSync(STATS_FILE, JSON.stringify(STATS, null, 2)); storage.push('stats'); }
      if (avatarsPending) { fs.writeFileSync(AVATARS_FILE, JSON.stringify(PROFILE_AVATARS, null, 2)); storage.push('avatars'); }
      dms.flush(); // a függő privát üzenetek is kiíródnak (és feltöltődnek)
      await storage.flush();
    } catch (e) {
      console.error('Leállítás közbeni mentés sikertelen:', e.message);
    }
    process.exit(0);
  });
}

server.listen(PORT, HOST, () => {
  console.log('KAMU BÍRÓSÁG fut: http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + ' (PORT=' + PORT + ')');
});
