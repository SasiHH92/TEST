'use strict';

// ============================================================
// KAMU BÍRÓSÁG – barátlista, online láthatóság, meghívók
// A kapcsolatok a fiókfájlban (és a külső adatbázisban) élnek: user.social =
//   { friends, incoming, outgoing, blocked (fiók-azonosítók), presence: 'all' | 'online' | 'hidden' }
// Az online állapot memóriában van (socket-azonosítók). A socket a fiókjához egy rövid életű
// jeggyel (POST /ticket) azonosítja magát, mert a süti a socket létrejöttekor rögzül.
// Végpontok (mind bejelentkezést kérnek): GET /state, POST /ticket, /request, /accept, /decline,
// /cancel, /remove, /block, /unblock, /settings.
// ============================================================

const express = require('express');
const crypto = require('crypto');
const { cleanText } = require('./textclean');

const PRESENCE_MODES = ['all', 'online', 'hidden'];
const MAX_FRIENDS = 100;
const MAX_PENDING = 30;
const MAX_BLOCKED = 100;
const TICKET_MS = 60 * 1000;
const INVITE_GAP_MS = 15 * 1000;
const REFRESH_DELAY_MS = 250;
const DM_MAX_LEN = 500;
const DM_GAP_MS = 700;            // két privát üzenet között legalább ennyi idő
const ONLINE_QUIET_MS = 5 * 60 * 1000; // ennyi ideig nem szólunk újra, ha ugyanaz a barát többször "online lép" (újracsatlakozások)

class SocialError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new SocialError(status, message); };

const normalize = (value) => String(value == null ? '' : value).normalize('NFKC').trim().toLocaleLowerCase('hu-HU');

// A fiók kapcsolat-adatai normalizálva (hiányzó vagy hibás mezők alapértékkel).
function socialOf(user) {
  const s = (user && user.social) || {};
  const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string'))] : []);
  return {
    friends: ids(s.friends),
    incoming: ids(s.incoming),
    outgoing: ids(s.outgoing),
    blocked: ids(s.blocked),
    presence: PRESENCE_MODES.includes(s.presence) ? s.presence : 'all',
    notifyOnline: s.notifyOnline !== false // értesítés, ha egy barát online lép (alapból be)
  };
}

// Amit egy másik játékos a fiókból láthat.
function cardOf(user) {
  const p = (user && user.profile) || {};
  return {
    id: user.id,
    username: user.username,
    avatar: typeof p.avatar === 'string' ? p.avatar.slice(0, 40) : '',
    titulus: typeof p.titulus === 'string' ? p.titulus.slice(0, 80) : ''
  };
}

const without = (list, id) => list.filter((x) => x !== id);

function createSocial({ auth, roomOf = () => null, emit = () => {}, now = () => Date.now(), dms = null }) {
  const router = express.Router();
  const dmGap = new Map();        // "ki>kinek" -> utolsó privát üzenet ideje
  const announced = new Map();    // userId -> mikor szóltunk utoljára, hogy online lépett
  const calls = new Map();        // userId -> időbélyegek (egyszerű sebességkorlát)
  const online = new Map();       // userId -> Set(socketId)
  const socketUser = new Map();   // socketId -> userId
  const lastSeen = new Map();     // userId -> utolsó kilépés ideje (csak memóriában)
  const tickets = new Map();      // jegy -> { userId, exp }
  const lastInvite = new Map();   // "ki>kinek" -> időbélyeg
  const dirty = new Set();        // akiknek a barátai értesítésre várnak
  let refreshTimer = null;

  const byId = (id) => auth.directory.byId(id);

  // ---------------- online állapot (memória) ----------------

  // Egy játékos állapota változott: a barátai (kis késleltetéssel, összevonva) frissítik a listájukat.
  function touch(userId) {
    if (!userId) return;
    dirty.add(userId);
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const ids = [...dirty]; dirty.clear();
      for (const id of ids) {
        const u = byId(id);
        if (u) for (const friendId of socialOf(u).friends) emit(friendId, 'friends_refresh', {});
      }
    }, REFRESH_DELAY_MS);
    if (refreshTimer.unref) refreshTimer.unref();
  }

  // A barátok értesítése, ha valaki most lépett online (offline → online), kivéve ha láthatatlan, vagy nemrég már szóltunk.
  function announceOnline(userId) {
    const user = byId(userId);
    if (!user || socialOf(user).presence === 'hidden') return;
    const t = now();
    if (t - (announced.get(userId) || 0) < ONLINE_QUIET_MS) return;
    announced.set(userId, t);
    if (announced.size > 5000) announced.delete(announced.keys().next().value);
    for (const friendId of socialOf(user).friends) {
      const friend = byId(friendId);
      if (friend && socialOf(friend).notifyOnline && online.has(friendId)) emit(friendId, 'friend_online', { from: cardOf(user) });
    }
  }

  function connect(userId, socketId) {
    let set = online.get(userId);
    const first = !set || !set.size;
    if (!set) online.set(userId, (set = new Set()));
    set.add(socketId);
    socketUser.set(socketId, userId);
    touch(userId);
    if (first) announceOnline(userId);
  }

  function disconnect(socketId) {
    const userId = socketUser.get(socketId);
    if (!userId) return;
    socketUser.delete(socketId);
    const set = online.get(userId);
    if (set) {
      set.delete(socketId);
      if (!set.size) {
        online.delete(userId);
        lastSeen.set(userId, now());
        if (lastSeen.size > 5000) lastSeen.delete(lastSeen.keys().next().value);
      }
    }
    touch(userId);
  }

  const userOf = (socketId) => socketUser.get(socketId) || null;

  // Egy barát állapota a nézőnek: a láthatósági beállítás szerint szűkítve.
  function presenceOf(target) {
    const mode = socialOf(target).presence;
    if (mode === 'hidden') return { status: 'offline' };
    const set = online.get(target.id);
    if (!set || !set.size) {
      const seen = lastSeen.get(target.id);
      return seen ? { status: 'offline', lastSeen: seen } : { status: 'offline' };
    }
    if (mode === 'online') return { status: 'online' };
    let best = { status: 'online' };
    for (const sid of set) {
      const room = roomOf(sid);
      if (!room) continue;
      best = { status: room.phase === 'lobby' ? 'lobby' : 'game', code: room.code, full: !!room.full };
      if (room.phase === 'lobby') break;
    }
    return best;
  }

  // ---------------- socket-azonosító jegyek ----------------

  function issueTicket(user) {
    const t = now();
    for (const [key, entry] of tickets) if (entry.exp < t) tickets.delete(key);
    const ticket = crypto.randomBytes(24).toString('base64url');
    tickets.set(ticket, { userId: user.id, exp: t + TICKET_MS });
    return ticket;
  }

  function consumeTicket(ticket) {
    const entry = tickets.get(ticket);
    tickets.delete(ticket);
    if (!entry || entry.exp < now() || !byId(entry.userId)) return null;
    return entry.userId;
  }

  // ---------------- HTTP ----------------

  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(express.json({ limit: '4kb' }));

  const requireUser = (req) => {
    const user = auth.session(req);
    if (!user) fail(401, 'Előbb jelentkezz be.');
    return user;
  };

  router.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON-kérés szükséges.' });
    const origin = req.get('origin');
    if (origin && origin !== auth.expectedOrigin(req)) return res.status(403).json({ error: 'A kérés másik oldalról érkezett.' });
    if (!req.body || Array.isArray(req.body)) return res.status(400).json({ error: 'Hiányzó adatok.' });
    next();
  });

  function throttle(user) {
    const t = now();
    const list = (calls.get(user.id) || []).filter((x) => t - x < 10 * 60 * 1000);
    if (list.length >= 120) fail(429, 'Túl sok kérés. Próbáld újra pár perc múlva.');
    list.push(t);
    calls.set(user.id, list);
  }

  const idParam = (body) => (typeof body.userId === 'string' && body.userId.length <= 64 ? body.userId : '');

  function stateFor(user) {
    const s = socialOf(user);
    const cards = (ids) => ids.map(byId).filter(Boolean).map(cardOf);
    const rank = { lobby: 0, game: 1, online: 2, offline: 3 };
    const unread = dms ? dms.unread(user.id) : {};
    const friends = s.friends.map(byId).filter(Boolean)
      .map((f) => ({ ...cardOf(f), ...presenceOf(f), unread: unread[f.id] || 0 }))
      .sort((a, b) => rank[a.status] - rank[b.status] || a.username.localeCompare(b.username, 'hu'));
    return {
      me: { id: user.id, username: user.username },
      presence: s.presence,
      notifyOnline: s.notifyOnline,
      dmUnread: friends.reduce((n, f) => n + f.unread, 0),
      friends,
      incoming: cards(s.incoming),
      outgoing: cards(s.outgoing),
      blocked: cards(s.blocked),
      limits: { friends: MAX_FRIENDS, pending: MAX_PENDING }
    };
  }

  // Két fiók közös módosítása egyetlen mentésben. A `other` hiányozhat (törölt fiók): ilyenkor csak a sajátot módosítjuk.
  function pair(user, otherId, edit) {
    return auth.mutate(user.id, (me, data) => {
      const other = data.users.find((x) => x.id === otherId) || null;
      const a = socialOf(me);
      const b = other ? socialOf(other) : null;
      const result = edit(a, b, me, other);
      me.social = a;
      if (other) other.social = b;
      return { me, result };
    });
  }

  function makeFriends(a, b, meId, otherId) {
    if (a.friends.length >= MAX_FRIENDS) fail(409, 'Elérted a barátlista maximumát (' + MAX_FRIENDS + ').');
    if (b.friends.length >= MAX_FRIENDS) fail(409, 'Neki már megtelt a barátlistája.');
    a.incoming = without(a.incoming, otherId); a.outgoing = without(a.outgoing, otherId);
    b.incoming = without(b.incoming, meId); b.outgoing = without(b.outgoing, meId);
    if (!a.friends.includes(otherId)) a.friends.push(otherId);
    if (!b.friends.includes(meId)) b.friends.push(meId);
  }

  // Egy művelet után a két érintett fiók játékosai frissítik a listájukat.
  const finish = (res, user, otherId, saved) => {
    emit(user.id, 'friends_refresh', {});
    if (otherId) emit(otherId, 'friends_refresh', {});
    res.json({ ...stateFor(saved.me), ...(saved.result || {}) });
  };

  router.get('/state', (req, res) => {
    res.json(stateFor(requireUser(req)));
  });

  router.post('/ticket', (req, res) => {
    const user = requireUser(req); throttle(user);
    res.json({ ticket: issueTicket(user) });
  });

  router.post('/request', (req, res) => {
    const user = requireUser(req); throttle(user);
    const name = typeof req.body.username === 'string' ? req.body.username.slice(0, 60) : '';
    if (!normalize(name)) fail(400, 'Írd be a felhasználónevet.');
    const target = auth.directory.byName(name);
    if (!target) fail(404, 'Nincs ilyen felhasználó.');
    if (target.id === user.id) fail(400, 'Magadat nem jelölheted be.');
    const saved = pair(user, target.id, (a, b, me, other) => {
      if (!other) fail(404, 'Nincs ilyen felhasználó.');
      if (a.friends.includes(other.id)) fail(409, 'Ti már barátok vagytok.');
      if (a.blocked.includes(other.id)) fail(409, 'Letiltottad őt, előbb oldd fel a tiltást.');
      if (b.blocked.includes(me.id)) fail(404, 'Ennek a felhasználónak most nem küldhető kérés.');
      if (a.outgoing.includes(other.id)) fail(409, 'Már elküldted neki a kérést.');
      if (a.incoming.includes(other.id)) { makeFriends(a, b, me.id, other.id); return { outcome: 'friends', username: other.username }; }
      if (a.outgoing.length >= MAX_PENDING) fail(429, 'Túl sok függő kérésed van, várd meg a válaszokat.');
      if (b.incoming.length >= MAX_PENDING) fail(409, 'Ennek a felhasználónak most sok függő kérése van.');
      a.outgoing.push(other.id); b.incoming.push(me.id);
      return { outcome: 'sent', username: other.username };
    });
    finish(res, user, target.id, saved);
  });

  router.post('/accept', (req, res) => {
    const user = requireUser(req); throttle(user);
    const otherId = idParam(req.body);
    const saved = pair(user, otherId, (a, b, me, other) => {
      if (!other || !a.incoming.includes(otherId)) fail(404, 'Ez a kérés már nem érvényes.');
      makeFriends(a, b, me.id, other.id);
      return { outcome: 'friends', username: other.username };
    });
    finish(res, user, otherId, saved);
  });

  router.post('/decline', (req, res) => {
    const user = requireUser(req); throttle(user);
    const otherId = idParam(req.body);
    const saved = pair(user, otherId, (a, b, me) => {
      a.incoming = without(a.incoming, otherId);
      if (b) b.outgoing = without(b.outgoing, me.id);
    });
    finish(res, user, otherId, saved);
  });

  router.post('/cancel', (req, res) => {
    const user = requireUser(req); throttle(user);
    const otherId = idParam(req.body);
    const saved = pair(user, otherId, (a, b, me) => {
      a.outgoing = without(a.outgoing, otherId);
      if (b) b.incoming = without(b.incoming, me.id);
    });
    finish(res, user, otherId, saved);
  });

  router.post('/remove', (req, res) => {
    const user = requireUser(req); throttle(user);
    const otherId = idParam(req.body);
    const saved = pair(user, otherId, (a, b, me) => {
      a.friends = without(a.friends, otherId);
      if (b) b.friends = without(b.friends, me.id);
    });
    if (dms) dms.drop(user.id, otherId); // barátság nélkül nincs közös beszélgetés
    finish(res, user, otherId, saved);
  });

  router.post('/block', (req, res) => {
    const user = requireUser(req); throttle(user);
    const otherId = idParam(req.body);
    if (!otherId || otherId === user.id) fail(400, 'Ezt a felhasználót nem lehet letiltani.');
    const saved = pair(user, otherId, (a, b, me) => {
      if (!byId(otherId)) fail(404, 'Nincs ilyen felhasználó.');
      if (!a.blocked.includes(otherId)) {
        if (a.blocked.length >= MAX_BLOCKED) fail(409, 'Túl sok letiltott felhasználó.');
        a.blocked.push(otherId);
      }
      a.friends = without(a.friends, otherId); a.incoming = without(a.incoming, otherId); a.outgoing = without(a.outgoing, otherId);
      if (b) { b.friends = without(b.friends, me.id); b.incoming = without(b.incoming, me.id); b.outgoing = without(b.outgoing, me.id); }
    });
    if (dms) dms.drop(user.id, otherId);
    finish(res, user, otherId, saved);
  });

  router.post('/unblock', (req, res) => {
    const user = requireUser(req); throttle(user);
    const otherId = idParam(req.body);
    const saved = pair(user, otherId, (a) => { a.blocked = without(a.blocked, otherId); });
    finish(res, user, null, saved);
  });

  router.post('/settings', (req, res) => {
    const user = requireUser(req); throttle(user);
    const { presence, notifyOnline } = req.body;
    if (presence === undefined && notifyOnline === undefined) fail(400, 'Nincs módosítandó beállítás.');
    if (presence !== undefined && !PRESENCE_MODES.includes(presence)) fail(400, 'Ismeretlen láthatósági beállítás.');
    if (notifyOnline !== undefined && typeof notifyOnline !== 'boolean') fail(400, 'Ismeretlen értesítési beállítás.');
    const saved = pair(user, '', (a) => {
      if (presence !== undefined) a.presence = presence;
      if (notifyOnline !== undefined) a.notifyOnline = notifyOnline;
    });
    finish(res, user, null, saved);
    if (presence !== undefined) touch(user.id); // a barátok azonnal az új láthatóságot lássák
  });

  // ---------------- privát üzenetek (csak barátok között) ----------------

  // A barát (kölcsönös barátság kell); egyébként hiba.
  function friendOf(user, friendId) {
    const friend = typeof friendId === 'string' && friendId.length <= 64 ? byId(friendId) : null;
    if (!friend || !socialOf(user).friends.includes(friend.id) || !socialOf(friend).friends.includes(user.id)) fail(403, 'Privát üzenetet csak a barátaidnak írhatsz.');
    return friend;
  }
  const dmPublic = (m) => ({ id: m.id, from: m.from, text: m.text, ts: m.ts });

  // Egy privát üzenet tárolása és kézbesítése (a küldő többi lapjának is). A szöveg már megtisztított.
  function deliverDm(from, toId, text) {
    const entry = dms.add(from.id, toId, text);
    dms.markRead(from.id, toId); // a saját üzeneted nem "olvasatlan" neked
    emit(toId, 'dm_msg', { from: cardOf(from), message: dmPublic(entry) });
    emit(from.id, 'dm_sent', { to: toId, message: dmPublic(entry) });
    return dmPublic(entry);
  }
  // Rendszer-üzenet egy barátnak a küldő nevében (pl. "Ajándékot küldtem neked"): csak kölcsönös barátok között.
  function sendDm(from, toId, text) {
    if (!dms) return null;
    const to = byId(toId);
    if (!to || !socialOf(from).friends.includes(toId) || !socialOf(to).friends.includes(from.id)) return null;
    const clean = cleanText(text, DM_MAX_LEN);
    return clean ? deliverDm(from, toId, clean) : null;
  }
  const areFriends = (aId, bId) => {
    const a = byId(aId), b = byId(bId);
    return !!a && !!b && a.id !== b.id && socialOf(a).friends.includes(b.id) && socialOf(b).friends.includes(a.id);
  };

  router.get('/dm/:userId', (req, res) => {
    const user = requireUser(req);
    if (!dms) fail(503, 'A privát üzenetek most nem érhetők el.');
    const friend = friendOf(user, req.params.userId);
    dms.markRead(user.id, friend.id);
    res.json({ with: cardOf(friend), messages: dms.messages(user.id, friend.id).map(dmPublic) });
  });

  router.post('/dm/send', (req, res) => {
    const user = requireUser(req); throttle(user);
    if (!dms) fail(503, 'A privát üzenetek most nem érhetők el.');
    const friend = friendOf(user, req.body.userId);
    if (typeof req.body.text !== 'string') fail(400, 'Érvénytelen üzenet.');
    const text = cleanText(req.body.text, DM_MAX_LEN);
    if (!text) fail(400, 'Üres üzenet.');
    const key = user.id + '>' + friend.id, t = now();
    if (t - (dmGap.get(key) || 0) < DM_GAP_MS) fail(429, 'Lassabban! Várj egy kicsit a következő üzenettel.');
    dmGap.set(key, t);
    if (dmGap.size > 5000) dmGap.delete(dmGap.keys().next().value);
    res.json({ message: deliverDm(user, friend.id, text) });
  });

  router.post('/dm/read', (req, res) => {
    const user = requireUser(req);
    if (!dms) fail(503, 'A privát üzenetek most nem érhetők el.');
    const friend = friendOf(user, req.body.userId);
    dms.markRead(user.id, friend.id);
    res.json({ ok: true });
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && error.status) return res.status(error.status).json({ error: error.message });
    if (error && error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Érvénytelen kérés.' });
    console.error('Barátlista hiba:', error && (error.code || error.name));
    res.status(503).json({ error: 'A barátlista most nem elérhető. Próbáld újra később.' });
  });

  // ---------------- szobai meghívó (a socket-kezelő hívja) ----------------

  function invite(user, friendId, code) {
    const friend = byId(friendId);
    if (!friend || !socialOf(user).friends.includes(friendId) || !socialOf(friend).friends.includes(user.id)) {
      return { error: 'Ő nem a barátod.' };
    }
    const key = user.id + '>' + friendId;
    const t = now();
    if (t - (lastInvite.get(key) || 0) < INVITE_GAP_MS) return { error: 'Várj egy kicsit a következő meghívó előtt.' };
    lastInvite.set(key, t);
    if (lastInvite.size > 5000) lastInvite.delete(lastInvite.keys().next().value);
    // A letiltó félhez nem megy meghívó, de a küldő ezt nem tudja meg.
    if (!socialOf(friend).blocked.includes(user.id)) emit(friendId, 'friend_invite', { from: cardOf(user), code: String(code) });
    return { ok: true };
  }

  // A néző letiltotta-e a feladót (a letiltott csevegő-üzenetei nem jelennek meg neki).
  function hides(viewerId, senderId) {
    if (!viewerId || !senderId) return false;
    const viewer = byId(viewerId);
    return !!viewer && socialOf(viewer).blocked.includes(senderId);
  }

  return { router, connect, disconnect, userOf, touch, issueTicket, consumeTicket, invite, stateFor, presenceOf, hides, sendDm, areFriends, card: cardOf };
}

module.exports = { createSocial, socialOf, PRESENCE_MODES, MAX_FRIENDS };
