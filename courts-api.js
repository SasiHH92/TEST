'use strict';

// ============================================================
// KAMU BÍRÓSÁG – tárgyalás-végpontok: weboldal (süti-bejelentkezés) és Discord bot (szolgáltatás-token)
//
// Webes végpontok (mind bejelentkezést kérnek):
//   GET  /api/discord/link                 – a fiók Discord-kapcsolata
//   POST /api/discord/link/start           – egyszer használatos, 10 perces kapcsolási kód
//   POST /api/discord/link/remove          – kapcsolat bontása
//   POST /api/court-sessions               – új tárgyalás a saját szobához { roomCode }
//   GET  /api/court-sessions/mine | /by-room/:code | /:id
//   POST /api/court-sessions/:id/{join,leave,lock,unlock,draw,start,finish,cancel,rebind}
// Bot végpontok (Authorization: Bearer <BOT_SERVICE_TOKEN>), előtag: /api/bot
//   GET  /stream (SSE) · GET /sessions · GET /sessions/:id
//   POST /sessions/:id/{join,leave,lock,unlock,draw,start,finish,cancel}  { discordUserId, discordUsername, staff, requestId }
//   POST /sessions/:id/panel · /announce · /applied-roles · POST /link
// A bot sosem mondja meg, KI a Kamu-felhasználó: azt a szerver a Discord-azonosítóból (kapcsolatból) oldja fel.
// ============================================================

const express = require('express');
const crypto = require('crypto');
const { CourtError } = require('./courts');

const ACTIONS = ['join', 'leave', 'lock', 'unlock', 'draw', 'start', 'finish', 'cancel'];

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * @param {object} deps
 *  courts, auth, io, botToken
 *  rooms: { info(code) -> {exists, phase, hostUserId, witnessEnabled, players:[{playerId,userId,name,connected}]} | null,
 *           start(code, presetByRole) -> {ok:true} | {error} }   (a server.js adja: a játékszoba a motor igazsága)
 */
function createCourtsApi({ courts, auth, io, botToken = '', rooms, onError = () => {}, now = () => Date.now() }) {
  const streams = new Set();
  const botOnline = () => streams.size > 0;
  const decorate = (v) => (v ? { ...v, discordBot: { online: botOnline(), panel: v.discordPanel } } : v);

  // ---------- esemény-szétosztás: web (socket.io) + bot (SSE) ----------
  courts.events.on('event', (evt) => {
    try {
      const v = courts.get(evt.sessionId);
      const payload = decorate(v);
      io.to(v.roomCode).emit('court_update', payload);
      for (const p of v.participants) io.to('u:' + p.uid).emit('court_update', payload);
      const line = 'event: court\ndata: ' + JSON.stringify(evt) + '\n\n';
      for (const res of streams) res.write(line);
    } catch (e) { onError('court-event', e); }
  });
  const heartbeat = setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 20000);
  if (heartbeat.unref) heartbeat.unref();

  // ---------- közös műveletek ----------
  // A szoba játékosai és a jelentkezők megfeleltetése (a userId-t a szerver rögzíti a socket fiókjából).
  function startPrereq(session) {
    const room = rooms.info(session.roomCode);
    if (!room || !room.exists) throw new CourtError('no_room', 'A szoba már nem létezik. A tárgyalás vezetője kösse új szobához a lobbiban.');
    if (room.phase !== 'lobby') throw new CourtError('room_busy', 'A szobában már folyik a játék.');
    const preset = {};
    const missing = [];
    for (const p of session.participants) {
      const seat = room.players.find((x) => x.userId === p.uid && x.connected);
      if (!seat) { missing.push(p.name); continue; }
      if (p.role && p.role !== 'juror') preset[p.role] = seat.playerId;
    }
    return { room, preset, missing };
  }

  function perform(action, id, actor, body = {}, requestId) {
    switch (action) {
      case 'join': return courts.join(id, actor, requestId);
      case 'leave': return courts.leave(id, actor, requestId);
      case 'lock': return courts.lock(id, actor, requestId);
      case 'unlock': return courts.unlock(id, actor, requestId);
      case 'cancel': return courts.cancel(id, actor, body.reason || 'Lemondva.', requestId);
      case 'finish': return courts.finish(id, actor, requestId);
      case 'draw': {
        const room = rooms.info(courts.get(id).roomCode);
        return courts.draw(id, actor, { force: body.force === true, witnessEnabled: room ? room.witnessEnabled !== false : true }, requestId);
      }
      case 'start': {
        const s = courts.get(id);
        if (!courts.canManage(id, actor)) throw new CourtError('forbidden', 'Ehhez a tárgyalás vezetője vagy a stáb jogosult.', 403);
        if (s.status === 'IN_PROGRESS') return { ok: true, already: true, session: s };
        if (s.status !== 'READY') throw new CourtError('not_ready', 'Előbb sorsolni kell a szerepeket.');
        const { preset, missing } = startPrereq(s);
        if (missing.length) throw new CourtError('players_missing', 'Még nem léptek be a szobába: ' + missing.join(', ') + '.');
        const r = rooms.start(s.roomCode, preset);
        if (r.error) throw new CourtError('start_failed', r.error);
        return courts.begin(id, null); // a motor indulási visszajelzése már IN_PROGRESS-re tette: idempotens
      }
      default: throw new CourtError('bad_action', 'Ismeretlen művelet.', 400);
    }
  }

  const sendError = (res, e) => {
    if (e instanceof CourtError) return res.status(e.status).json({ error: e.message, code: e.code });
    onError('court-api', e);
    return res.status(500).json({ error: 'Szerverhiba.' });
  };
  const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { sendError(res, e); } };

  // =================== WEB ===================
  const web = express.Router();
  const MINE = ['/discord', '/court-sessions']; // csak a saját útvonalaink: a többi /api kérést nem érintjük
  web.use(MINE, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  web.use(MINE, express.json({ limit: '4kb' }));
  web.use(MINE, (req, res, next) => {
    if (req.method !== 'POST') return next();
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON-kérés szükséges.' });
    const origin = req.get('origin');
    if (origin && origin !== auth.expectedOrigin(req)) return res.status(403).json({ error: 'A kérés másik oldalról érkezett.' });
    if (!req.body || Array.isArray(req.body)) return res.status(400).json({ error: 'Hiányzó adatok.' });
    next();
  });
  const calls = new Map();
  const userOf = (req) => {
    const user = auth.session(req);
    if (!user) throw new CourtError('auth', 'Előbb jelentkezz be.', 401);
    const t = now();
    const list = (calls.get(user.id) || []).filter((x) => t - x < 60 * 1000);
    if (list.length >= 60) throw new CourtError('rate', 'Túl sok kérés. Várj egy kicsit.', 429);
    list.push(t); calls.set(user.id, list);
    return user;
  };

  web.get('/discord/link', wrap((req, res) => {
    const user = userOf(req);
    const l = courts.linkOfUser(user.id);
    res.json({ uid: user.id, linked: !!l, discordUsername: l ? l.discordUsername : '', linkedAt: l ? l.linkedAt : null, viaLogin: !!(l && l.oauth), botOnline: botOnline() });
  }));
  web.post('/discord/link/start', wrap((req, res) => {
    const user = userOf(req);
    const { code, expiresAt } = courts.createLinkCode(user.id);
    res.json({ code, expiresAt, command: '/kapcsol kod:' + code });
  }));
  web.post('/discord/link/remove', wrap((req, res) => {
    const user = userOf(req);
    res.json({ ok: true, removed: courts.unlink(user.id) });
  }));

  web.post('/court-sessions', wrap((req, res) => {
    const user = userOf(req);
    const code = String(req.body.roomCode || '').toUpperCase();
    const room = rooms.info(code);
    if (!room || !room.exists) throw new CourtError('no_room', 'Nincs ilyen szoba.', 404);
    if (room.hostUserId !== user.id) throw new CourtError('forbidden', 'Csak a szoba házigazdája nyithat tárgyalást.', 403);
    const r = courts.create({ hostUserId: user.id, hostName: user.username, roomCode: code });
    res.status(r.already ? 200 : 201).json({ ...r, session: decorate(r.session) });
  }));
  web.get('/court-sessions/mine', wrap((req, res) => {
    const user = userOf(req);
    res.json({ sessions: courts.mine(user.id).map(decorate) });
  }));
  web.get('/court-sessions/by-room/:code', wrap((req, res) => {
    userOf(req);
    res.json({ session: decorate(courts.forRoom(req.params.code)) });
  }));
  web.get('/court-sessions/:id', wrap((req, res) => {
    userOf(req);
    res.json({ session: decorate(courts.get(req.params.id)) });
  }));
  web.post('/court-sessions/:id/rebind', wrap((req, res) => {
    const user = userOf(req);
    const code = String(req.body.roomCode || '').toUpperCase();
    const room = rooms.info(code);
    if (!room || !room.exists) throw new CourtError('no_room', 'Nincs ilyen szoba.', 404);
    if (room.hostUserId !== user.id) throw new CourtError('forbidden', 'Csak a szoba házigazdája kötheti hozzá.', 403);
    const r = courts.rebind(req.params.id, { userId: user.id }, code);
    res.json({ ...r, session: decorate(r.session) });
  }));
  web.post('/court-sessions/:id/:action', wrap((req, res) => {
    const user = userOf(req);
    const action = req.params.action;
    if (!ACTIONS.includes(action)) throw new CourtError('bad_action', 'Ismeretlen művelet.', 404);
    // A webes kérés SOHA nem kap stáb-jogot: a vezetőség a tárgyalás vezetőjére korlátozódik.
    const actor = { userId: user.id, name: user.username, via: 'web', staff: false };
    const r = perform(action, req.params.id, actor, req.body, typeof req.body.requestId === 'string' ? req.body.requestId.slice(0, 64) : undefined);
    res.json({ ...r, session: decorate(r.session) });
  }));

  // =================== BOT ===================
  const bot = express.Router();
  bot.use((req, res, next) => {
    if (!botToken) return res.status(503).json({ error: 'A Discord-integráció nincs bekapcsolva (BOT_SERVICE_TOKEN).' });
    const h = String(req.get('authorization') || '');
    if (!h.startsWith('Bearer ') || !safeEqual(h.slice(7), botToken)) return res.status(401).json({ error: 'Érvénytelen szolgáltatás-token.' });
    res.set('Cache-Control', 'no-store');
    next();
  });
  bot.use(express.json({ limit: '8kb' }));

  bot.get('/stream', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 3000\n: hello\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
  });
  bot.get('/sessions', wrap((req, res) => res.json({ sessions: courts.listForBot() })));
  bot.get('/sessions/:id', wrap((req, res) => res.json({ session: courts.getForBot(req.params.id) })));

  const discordId = (body) => {
    const id = String(body.discordUserId || '');
    if (!/^\d{5,25}$/.test(id)) throw new CourtError('bad_discord', 'Érvénytelen Discord-azonosító.', 400);
    return id;
  };
  function userOfDiscord(did) {
    const id = courts.userOfDiscord(did);
    const user = id ? auth.directory.byId(id) : auth.directory.byProvider('discord', did);
    return user || null;
  }

  bot.post('/link', wrap((req, res) => {
    const did = discordId(req.body);
    const r = courts.consumeLinkCode(req.body.code, did, req.body.discordUsername);
    const user = auth.directory.byId(r.kamuUserId);
    if (!user) throw new CourtError('no_user', 'A fiók már nem létezik.', 404);
    res.json({ ok: true, kamuUsername: user.username });
  }));
  bot.post('/sessions/:id/panel', wrap((req, res) => {
    res.json({ session: courts.setDiscordPanel(req.params.id, req.body) });
  }));
  bot.post('/sessions/:id/announce', wrap((req, res) => {
    res.json({ first: courts.markAnnounced(req.params.id, String(req.body.key || '').slice(0, 40)) });
  }));
  bot.post('/sessions/:id/applied-roles', wrap((req, res) => {
    res.json({ session: courts.setAppliedRoles(req.params.id, req.body.assignments) });
  }));
  bot.post('/sessions/:id/:action', wrap((req, res) => {
    const action = req.params.action;
    if (!ACTIONS.includes(action)) throw new CourtError('bad_action', 'Ismeretlen művelet.', 404);
    const did = discordId(req.body);
    const user = userOfDiscord(did);
    if (!user) return res.status(409).json({ error: 'A Discord-fiókod még nincs összekötve a Kamu-fiókoddal.', code: 'not_linked' });
    // A szerver dönt: a bot csak a (hitelesített szolgáltatásként) közölt stáb-jelzést adhatja át, a fiók kapcsolata kötelező.
    const actor = { userId: user.id, name: user.username, via: 'discord', staff: req.body.staff === true };
    const r = perform(action, req.params.id, actor, req.body, typeof req.body.requestId === 'string' ? req.body.requestId.slice(0, 64) : undefined);
    res.json({ ...r, session: decorate(r.session), kamuUsername: user.username });
  }));

  return { web, bot, decorate, botOnline, perform, startPrereq, _streams: streams };
}

module.exports = { createCourtsApi };
