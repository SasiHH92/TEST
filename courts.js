'use strict';

// ============================================================
// KAMU BÍRÓSÁG – tárgyalás-munkamenetek (court sessions) és Discord-kapcsolatok
//
// A weboldal és a Discord bot UGYANAHHOZ az állapothoz fér hozzá: ez a modul a hiteles forrás.
// A munkamenet egy játékszobához (roomCode) kötődik; a jelentkezők, a sorsolt szerepek és az állapot itt él.
// Tárolás: data/courts.json (a storage.js a DATABASE_URL-es külső adatbázisba is feltölti, mint a többi adatot),
// így a Render újraindítása / új telepítése után minden megmarad.
//
// Egyidejűség: a Node egyszálú, és minden módosítás EGY szinkron függvényben (transact) fut le, ezért két egyszerre
// érkező kérés (Discord + web, két staff, sok jelentkező) sorosan hajtódik végre, és az állapotgép elutasítja a
// második, már érvénytelen lépést. A requestId-vel ellátott kéréseket (Discord interakció-újrapróbálkozás) a
// munkamenet egyszer hajtja végre, ismétléskor az eredeti választ adja vissza. FELTÉTEL: egyetlen webes példány
// (a Render ingyenes csomagja ilyen); több példányhoz sor-szintű zárolás kellene az adatbázisban.
//
// Állapotok: WAITING → LOCKED → (DRAWING) → READY → IN_PROGRESS → FINISHED; bármelyik élőből CANCELLED.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const STATUS = {
  WAITING: 'WAITING', LOCKED: 'LOCKED', DRAWING: 'DRAWING', READY: 'READY',
  IN_PROGRESS: 'IN_PROGRESS', FINISHED: 'FINISHED', CANCELLED: 'CANCELLED'
};
const LIVE = [STATUS.WAITING, STATUS.LOCKED, STATUS.DRAWING, STATUS.READY, STATUS.IN_PROGRESS];

const ROLES = {
  judge: 'Bíró', prosecutor: 'Ügyész', defender: 'Védőügyvéd', defendant: 'Vádlott', witness: 'Tanú', juror: 'Esküdt'
};
const ROLE_KEYS = Object.keys(ROLES);

const EVENTS = {
  CREATED: 'COURT_SESSION_CREATED', JOINED: 'PLAYER_JOINED', LEFT: 'PLAYER_LEFT', LOCKED: 'SESSION_LOCKED',
  UNLOCKED: 'SESSION_UNLOCKED', ROLES_ASSIGNED: 'ROLES_ASSIGNED', ROLES_CLEARED: 'ROLES_CLEARED',
  STARTED: 'SESSION_STARTED', FINISHED: 'SESSION_FINISHED', CANCELLED: 'SESSION_CANCELLED', REBOUND: 'SESSION_REBOUND'
};

const DEFAULT_MIN = 3;
const DEFAULT_MAX = 8;
const LINK_CODE_MS = 10 * 60 * 1000;
const LINK_CODE_LEN = 8;
const LINK_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_REQUEST_MEMORY = 60;
const SAVE_DELAY_MS = 800;
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

class CourtError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new CourtError(code, message, status); };

const digest = (v) => crypto.createHash('sha256').update('kb-link:' + String(v)).digest('hex');

function createCourts({
  file = null,
  persist = () => {},
  now = () => Date.now(),
  randomInt = (n) => crypto.randomInt(n),
  resolveDiscordId = null, // (kamuUserId) => discordUserId | null  (pl. a Discord-bejelentkezésből is)
  staleMs = 6 * 60 * 60 * 1000
} = {}) {
  let data = { version: 1, seq: 1000, sessions: {}, links: {}, roleStats: {} };
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.version === 1 && parsed.sessions && parsed.links) data = { roleStats: {}, seq: 1000, ...parsed };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('A tárgyalás-fájl nem olvasható, üresen indul:', e.message);
    }
  }
  const events = new EventEmitter();
  events.setMaxListeners(50);
  const codes = new Map(); // csatlakozási kód kivonata -> { userId, expiresAt } (csak memóriában, rövid életű)
  let timer = null;
  let eventSeq = 0;

  // ---------- mentés ----------
  function saveNow() {
    clearTimeout(timer); timer = null;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    try { persist(file); } catch (_) { /* a külső mentés hibája nem állíthat meg semmit */ }
  }
  function save() {
    if (!file || timer) return;
    timer = setTimeout(() => { try { saveNow(); } catch (e) { console.error('A tárgyalás-adatok mentése sikertelen:', e.message); } }, SAVE_DELAY_MS);
    if (timer.unref) timer.unref();
  }

  // ---------- segédek ----------
  const session = (id) => {
    const s = data.sessions[String(id || '')];
    if (!s) fail('not_found', 'Nincs ilyen tárgyalás.', 404);
    return s;
  };
  const discordIdOf = (userId) => {
    for (const [did, l] of Object.entries(data.links)) if (l.kamuUserId === userId) return did;
    return resolveDiscordId ? (resolveDiscordId(userId) || null) : null;
  };
  const userOfDiscord = (discordUserId) => (data.links[discordUserId] ? data.links[discordUserId].kamuUserId : null);

  function view(s) {
    return {
      id: s.id, caseNo: s.id, status: s.status, version: s.version,
      roomCode: s.roomCode, hostUserId: s.hostUserId, hostName: s.hostName,
      minPlayers: s.minPlayers, maxPlayers: s.maxPlayers,
      participants: s.participants.map((p) => ({
        uid: p.userId, name: p.name, role: p.role || null, roleLabel: p.role ? ROLES[p.role] : null,
        via: p.via, joinedAt: p.joinedAt, assignedAt: p.assignedAt || null, discordLinked: !!discordIdOf(p.userId)
      })),
      createdAt: s.createdAt, updatedAt: s.updatedAt, drawnAt: s.drawnAt || null,
      startedAt: s.startedAt || null, finishedAt: s.finishedAt || null, cancelReason: s.cancelReason || null,
      discordPanel: !!(s.discord && s.discord.messageId)
    };
  }
  // A bot nézete: a Discord-azonosítók és a panel-hivatkozások is benne vannak (a web soha nem kapja meg).
  function botView(s) {
    const v = view(s);
    v.participants = v.participants.map((p) => ({ ...p, discordUserId: discordIdOf(p.uid) }));
    v.discord = { guildId: null, channelId: null, messageId: null, announced: [], appliedRoles: {}, ...(s.discord || {}) };
    return v;
  }

  function emit(type, s) {
    eventSeq++;
    const evt = { seq: eventSeq, type, sessionId: s.id, version: s.version, at: now(), status: s.status, roomCode: s.roomCode };
    setImmediate(() => events.emit('event', evt));
    return evt;
  }

  // Egyetlen módosító lépés: ellenőrzés + változtatás + verzió + mentés + esemény.
  function transact(id, requestId, fn) {
    const s = session(id);
    s.requests = s.requests || {};
    if (requestId && s.requests[requestId]) return { ...s.requests[requestId], replay: true };
    const outcome = fn(s) || {};
    let result;
    if (outcome.changed) {
      s.version++; s.updatedAt = now();
      emit(outcome.event, s);
      save();
    }
    result = { ok: true, ...(outcome.already ? { already: true } : {}), session: view(s) };
    if (requestId) {
      s.requests[requestId] = { ok: true, session: result.session };
      const keys = Object.keys(s.requests);
      if (keys.length > MAX_REQUEST_MEMORY) for (const k of keys.slice(0, keys.length - MAX_REQUEST_MEMORY)) delete s.requests[k];
      if (!outcome.changed) save();
    }
    return result;
  }

  const canManage = (s, actor) => !!actor && (actor.staff === true || (actor.userId && actor.userId === s.hostUserId));
  const needManage = (s, actor) => { if (!canManage(s, actor)) fail('forbidden', 'Ehhez a tárgyalás vezetője vagy a stáb jogosult.', 403); };
  const live = (s) => { if (!LIVE.includes(s.status)) fail('closed', 'Ez a tárgyalás már lezárult.'); };

  // ---------- létrehozás ----------
  function create({ hostUserId, hostName, roomCode, minPlayers = DEFAULT_MIN, maxPlayers = DEFAULT_MAX }) {
    if (!hostUserId) fail('auth', 'Bejelentkezés kell.', 401);
    const code = String(roomCode || '').toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) fail('bad_room', 'Érvénytelen szobakód.', 400);
    const existing = Object.values(data.sessions).find((x) => x.roomCode === code && LIVE.includes(x.status));
    if (existing) return { ok: true, already: true, session: view(existing) };
    const mine = Object.values(data.sessions).filter((x) => x.hostUserId === hostUserId && LIVE.includes(x.status));
    if (mine.length >= 3) fail('too_many', 'Legfeljebb 3 élő tárgyalásod lehet.');
    const id = 'KAMU-' + (++data.seq);
    const t = now();
    const s = {
      id, status: STATUS.WAITING, version: 1, hostUserId, hostName: String(hostName || '').slice(0, 30), roomCode: code,
      minPlayers: Math.max(3, Math.min(DEFAULT_MAX, minPlayers | 0)), maxPlayers: Math.max(3, Math.min(DEFAULT_MAX, maxPlayers | 0)),
      participants: [{ userId: hostUserId, name: String(hostName || '').slice(0, 30), via: 'web', joinedAt: t }],
      createdAt: t, updatedAt: t, discord: { announced: [], appliedRoles: {} }, requests: {}
    };
    data.sessions[id] = s;
    emit(EVENTS.CREATED, s);
    save();
    return { ok: true, session: view(s) };
  }

  // ---------- jelentkezés ----------
  function join(id, actor, requestId) {
    return transact(id, requestId, (s) => {
      live(s);
      if (s.participants.some((p) => p.userId === actor.userId)) return { already: true };
      if (s.status !== STATUS.WAITING) fail('closed_signup', 'A jelentkezés lezárult.');
      if (s.participants.length >= s.maxPlayers) fail('full', 'A tárgyalás betelt (' + s.maxPlayers + ' fő).');
      s.participants.push({ userId: actor.userId, name: String(actor.name || '').slice(0, 30), via: actor.via === 'discord' ? 'discord' : 'web', joinedAt: now() });
      return { changed: true, event: EVENTS.JOINED };
    });
  }

  function leave(id, actor, requestId) {
    return transact(id, requestId, (s) => {
      live(s);
      if (s.status === STATUS.IN_PROGRESS) fail('in_progress', 'A tárgyalás már folyik, nem léphetsz vissza.');
      const idx = s.participants.findIndex((p) => p.userId === actor.userId);
      if (idx < 0) return { already: true };
      if (actor.userId === s.hostUserId) fail('host_leave', 'A tárgyalás vezetője nem léphet vissza (mondd le a tárgyalást).');
      s.participants.splice(idx, 1);
      if (s.status === STATUS.READY) { // a sorsolás érvényét veszti: vissza a jelentkezéshez
        for (const p of s.participants) { delete p.role; delete p.assignedAt; }
        s.status = STATUS.WAITING; s.drawnAt = null;
      }
      return { changed: true, event: EVENTS.LEFT };
    });
  }

  function lock(id, actor, requestId) {
    return transact(id, requestId, (s) => {
      live(s); needManage(s, actor);
      if (s.status === STATUS.LOCKED) return { already: true };
      if (s.status !== STATUS.WAITING) fail('bad_state', 'Csak jelentkezési szakaszban zárható le a jelentkezés.');
      s.status = STATUS.LOCKED; s.lockedAt = now();
      return { changed: true, event: EVENTS.LOCKED };
    });
  }
  function unlock(id, actor, requestId) {
    return transact(id, requestId, (s) => {
      live(s); needManage(s, actor);
      if (s.status === STATUS.WAITING) return { already: true };
      if (s.status !== STATUS.LOCKED) fail('bad_state', 'Csak lezárt jelentkezés nyitható újra.');
      s.status = STATUS.WAITING;
      return { changed: true, event: EVENTS.UNLOCKED };
    });
  }

  // ---------- szerepsorsolás ----------
  // Szerepek (a játékmotor kör-szerepei): bíró, vádlott, ügyész – mindig; védőügyvéd 5+ főnél; tanú 4+ főnél (ha engedélyezett);
  // a többiek esküdtek. Fair: az a jelentkező kapja, akinek eddig a legkevesebbszer volt az adott szerepe; döntetlennél az,
  // akinek az utolsó (előző) szerepe más volt, végül véletlen.
  function rolePlan(n, witnessEnabled) {
    const plan = ['defendant', 'prosecutor', 'judge'];
    if (n >= 5) plan.push('defender');
    if (n >= 4 && witnessEnabled !== false) plan.push('witness');
    return plan;
  }
  function drawRoles(participants, witnessEnabled) {
    const pool = participants.map((p) => p.userId);
    const out = {};
    for (const role of rolePlan(pool.length, witnessEnabled)) {
      const stats = (id) => data.roleStats[id] || { counts: {}, last: null };
      const min = Math.min(...pool.map((id) => stats(id).counts[role] || 0));
      let cands = pool.filter((id) => (stats(id).counts[role] || 0) === min);
      const fresh = cands.filter((id) => stats(id).last !== role);
      if (fresh.length) cands = fresh;
      const pick = cands[randomInt(cands.length)];
      out[pick] = role;
      pool.splice(pool.indexOf(pick), 1);
    }
    for (const id of pool) out[id] = 'juror';
    return out;
  }

  function draw(id, actor, { force = false, witnessEnabled = true } = {}, requestId) {
    return transact(id, requestId, (s) => {
      live(s); needManage(s, actor);
      if (s.status === STATUS.IN_PROGRESS) fail('in_progress', 'A tárgyalás már folyik.');
      if (s.status === STATUS.READY && !force) return { already: true }; // idempotens: a második kattintás nem sorsol újra
      if (s.participants.length < s.minPlayers) fail('too_few', 'Legalább ' + s.minPlayers + ' jelentkező kell (most ' + s.participants.length + ').');
      s.status = STATUS.DRAWING;
      const assignment = drawRoles(s.participants, witnessEnabled);
      const t = now();
      for (const p of s.participants) { p.role = assignment[p.userId]; p.assignedAt = t; }
      s.status = STATUS.READY; s.drawnAt = t; s.witnessEnabled = witnessEnabled !== false;
      return { changed: true, event: EVENTS.ROLES_ASSIGNED };
    });
  }

  // ---------- indítás / befejezés / lemondás ----------
  function recordStats(s) {
    for (const p of s.participants) {
      if (!p.role) continue;
      const st = data.roleStats[p.userId] || { counts: {}, last: null };
      st.counts[p.role] = (st.counts[p.role] || 0) + 1; st.last = p.role;
      data.roleStats[p.userId] = st;
    }
  }
  // Az indítás ELŐFELTÉTELEIT a hívó (server.js) ellenőrzi a szobával; ez csak az állapotgép lépése.
  function begin(id, actor, { allowUndrawn = false } = {}, requestId) {
    return transact(id, requestId, (s) => {
      live(s);
      if (actor) needManage(s, actor);
      if (s.status === STATUS.IN_PROGRESS) return { already: true };
      if (s.status !== STATUS.READY && !(allowUndrawn && [STATUS.WAITING, STATUS.LOCKED].includes(s.status))) {
        fail('not_ready', 'Előbb sorsolni kell a szerepeket.');
      }
      s.status = STATUS.IN_PROGRESS; s.startedAt = now();
      if (s.drawnAt) recordStats(s);
      return { changed: true, event: EVENTS.STARTED };
    });
  }
  function finish(id, actor, requestId) {
    return transact(id, requestId, (s) => {
      if (s.status === STATUS.FINISHED) return { already: true };
      live(s);
      if (actor) needManage(s, actor);
      if (s.status !== STATUS.IN_PROGRESS) fail('bad_state', 'Csak folyamatban lévő tárgyalás fejezhető be.');
      s.status = STATUS.FINISHED; s.finishedAt = now();
      return { changed: true, event: EVENTS.FINISHED };
    });
  }
  function cancel(id, actor, reason, requestId) {
    return transact(id, requestId, (s) => {
      if (s.status === STATUS.CANCELLED) return { already: true };
      live(s);
      if (actor) needManage(s, actor);
      s.status = STATUS.CANCELLED; s.cancelledAt = now(); s.cancelReason = String(reason || '').slice(0, 120) || null;
      return { changed: true, event: EVENTS.CANCELLED };
    });
  }

  // Az élő tárgyalás új szobához kötése (pl. a szoba a telepítéskor megszűnt).
  function rebind(id, actor, roomCode) {
    return transact(id, null, (s) => {
      live(s); needManage(s, actor);
      const code = String(roomCode || '').toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) fail('bad_room', 'Érvénytelen szobakód.', 400);
      if (Object.values(data.sessions).some((x) => x.id !== s.id && x.roomCode === code && LIVE.includes(x.status))) fail('room_taken', 'Ehhez a szobához már tartozik tárgyalás.');
      if (s.roomCode === code) return { already: true };
      s.roomCode = code;
      return { changed: true, event: EVENTS.REBOUND };
    });
  }

  // ---------- a játékmotor visszajelzései (a szoba az igazság az indulásról/végéről) ----------
  const byRoom = (code) => Object.values(data.sessions).find((x) => x.roomCode === String(code || '').toUpperCase() && LIVE.includes(x.status)) || null;
  function roomStarted(code) {
    const s = byRoom(code);
    if (!s || s.status === STATUS.IN_PROGRESS) return null;
    return begin(s.id, null, { allowUndrawn: true });
  }
  function roomFinished(code) {
    const s = byRoom(code);
    if (!s) return null;
    if (s.status === STATUS.IN_PROGRESS) return finish(s.id, null);
    return null;
  }
  function roomGone(code) {
    const s = byRoom(code);
    // Folyó játék szobájának megszűnése lezárja a tárgyalást; a jelentkezési/sorsolt szakasz megmarad (újrakötés).
    if (s && s.status === STATUS.IN_PROGRESS) return cancel(s.id, null, 'A szoba megszűnt.');
    return null;
  }

  // ---------- Discord-panel nyilvántartás (a bot hívja a szolgáltatás-végponton át) ----------
  function setDiscordPanel(id, { guildId, channelId, messageId }) {
    const s = session(id);
    s.discord = { announced: [], appliedRoles: {}, ...(s.discord || {}), guildId: String(guildId || ''), channelId: String(channelId || ''), messageId: String(messageId || '') };
    s.updatedAt = now(); save();
    return botView(s);
  }
  function markAnnounced(id, key) {
    const s = session(id);
    s.discord = { announced: [], appliedRoles: {}, ...(s.discord || {}) };
    if (!s.discord.announced.includes(key)) { s.discord.announced.push(key); save(); return true; }
    return false;
  }
  function setAppliedRoles(id, map) {
    const s = session(id);
    const clean = {};
    for (const [did, roles] of Object.entries(map || {})) {
      if (/^\d{5,25}$/.test(did) && Array.isArray(roles)) clean[did] = roles.filter((r) => ROLE_KEYS.includes(r));
    }
    s.discord = { announced: [], ...(s.discord || {}), appliedRoles: clean };
    save();
    return botView(s);
  }

  // ---------- Discord ↔ Kamu fiók ----------
  function createLinkCode(userId) {
    for (const [h, c] of codes) if (c.expiresAt <= now() || c.userId === userId) codes.delete(h); // felhasználónként egy élő kód
    let code = '';
    for (let i = 0; i < LINK_CODE_LEN; i++) code += LINK_CODE_CHARS[randomInt(LINK_CODE_CHARS.length)];
    const expiresAt = now() + LINK_CODE_MS;
    codes.set(digest(code), { userId, expiresAt });
    return { code, expiresAt };
  }
  function consumeLinkCode(code, discordUserId, discordUsername) {
    if (!/^\d{5,25}$/.test(String(discordUserId || ''))) fail('bad_discord', 'Érvénytelen Discord-azonosító.', 400);
    const key = digest(String(code || '').trim().toUpperCase());
    const entry = codes.get(key);
    codes.delete(key); // egyszer használatos: hibás/lejárt próbálkozásnál sem marad élő
    if (!entry || entry.expiresAt <= now()) fail('bad_code', 'Érvénytelen vagy lejárt kód. Kérj újat a weboldalon.', 400);
    const owner = data.links[discordUserId];
    if (owner && owner.kamuUserId !== entry.userId) fail('discord_taken', 'Ez a Discord-fiók már egy másik Kamu-fiókhoz van kötve.');
    for (const [did, l] of Object.entries(data.links)) if (l.kamuUserId === entry.userId && did !== discordUserId) delete data.links[did]; // egy fiók – egy Discord
    data.links[discordUserId] = { kamuUserId: entry.userId, discordUsername: String(discordUsername || '').slice(0, 40), linkedAt: now() };
    save();
    return { kamuUserId: entry.userId, ...data.links[discordUserId] };
  }
  function linkOfUser(userId) {
    for (const [did, l] of Object.entries(data.links)) if (l.kamuUserId === userId) return { discordUserId: did, discordUsername: l.discordUsername, linkedAt: l.linkedAt };
    const viaOauth = resolveDiscordId ? resolveDiscordId(userId) : null;
    return viaOauth ? { discordUserId: viaOauth, discordUsername: '', linkedAt: null, oauth: true } : null;
  }
  function unlink(userId) {
    let n = 0;
    for (const [did, l] of Object.entries(data.links)) if (l.kamuUserId === userId) { delete data.links[did]; n++; }
    if (n) save();
    return n > 0;
  }
  // Fiók-törlés: a kapcsolat és a jelentkezések is megszűnnek.
  function purgeUser(userId) {
    unlink(userId);
    delete data.roleStats[userId];
    for (const s of Object.values(data.sessions)) {
      if (!LIVE.includes(s.status)) continue;
      if (s.hostUserId === userId) { cancel(s.id, null, 'A vezető törölte a fiókját.'); continue; }
      const i = s.participants.findIndex((p) => p.userId === userId);
      if (i >= 0 && s.status !== STATUS.IN_PROGRESS) leave(s.id, { userId });
    }
    save();
  }

  // ---------- lekérdezések ----------
  const get = (id) => view(session(id));
  const getForBot = (id) => botView(session(id));
  const forRoom = (code) => { const s = byRoom(code); return s ? view(s) : null; };
  const listLive = () => Object.values(data.sessions).filter((s) => LIVE.includes(s.status)).map(view);
  // A bot a friss lezártakat is látja (a Discord-takarításhoz: panel lezárása, role-ok levétele)
  const listForBot = () => Object.values(data.sessions)
    .filter((s) => LIVE.includes(s.status) || hasPendingDiscordCleanup(s))
    .map(botView);
  const hasPendingDiscordCleanup = (s) => !LIVE.includes(s.status) && s.discord && (
    Object.keys(s.discord.appliedRoles || {}).length > 0 || (s.discord.messageId && !(s.discord.announced || []).includes('closed:' + s.status)));
  const mine = (userId) => Object.values(data.sessions)
    .filter((s) => LIVE.includes(s.status) && (s.hostUserId === userId || s.participants.some((p) => p.userId === userId))).map(view);
  const hostSessionOf = (userId) => Object.values(data.sessions).filter((s) => LIVE.includes(s.status) && s.hostUserId === userId).map(view);

  // Elavult élő tárgyalások lezárása + régi lezártak törlése (a roleStats megmarad).
  function expireStale() {
    const t = now();
    let n = 0;
    for (const s of Object.values(data.sessions)) {
      if (LIVE.includes(s.status) && t - s.updatedAt > staleMs) { cancel(s.id, null, 'Lejárt (nem volt aktivitás).'); n++; }
      else if (!LIVE.includes(s.status) && t - s.updatedAt > PRUNE_AFTER_MS && !hasPendingDiscordCleanup(s)) { delete data.sessions[s.id]; n++; }
    }
    if (n) save();
    return n;
  }

  return {
    STATUS, ROLES, EVENTS, events, view, create, join, leave, lock, unlock, draw, begin, finish, cancel, rebind,
    roomStarted, roomFinished, roomGone, setDiscordPanel, markAnnounced, setAppliedRoles,
    createLinkCode, consumeLinkCode, linkOfUser, unlink, purgeUser, userOfDiscord, canManage: (id, actor) => canManage(session(id), actor),
    get, getForBot, forRoom, listLive, listForBot, mine, hostSessionOf, expireStale, saveNow,
    _data: () => data
  };
}

module.exports = { createCourts, CourtError, STATUS, LIVE, ROLES, ROLE_KEYS, EVENTS };
