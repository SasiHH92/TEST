'use strict';

// ============================================================
// KAMU BÍRÓSÁG – végponttól végpontig teszt
// Lobby: nyilvántartás, foglalt nevek, vendég-priusz, stats.json.
// Plusz rövid játékfüzet a pont-íráshoz.
// Futtatás: npm test
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const io = require('socket.io-client');
const CARDS = require('../data/cards.json');
const PLAYERS = require('../data/players.json');

const PORT = 3123;
const URL = 'http://localhost:' + PORT;
const LOG = path.join(__dirname, 'e2e-log.txt');
const STATS_FILE = path.join(__dirname, '..', 'data', 'stats.json');
const logLines = [];
function log(s) {
  logLines.push(s);
  process.stdout.write(s + '\n');
}

const WATCHDOG = setTimeout(() => {
  log('!! GLOBÁLIS IDŐTÚLLÉPÉS (240 s) – a teszt elakadt !!');
  finish(2);
}, 240000);

function finish(code) {
  clearTimeout(WATCHDOG);
  try { fs.writeFileSync(LOG, logLines.join('\n')); } catch (e) { /* */ }
  process.exit(code);
}

let failures = 0;
let passes = 0;

function check(name, cond) {
  if (cond) { passes++; log('  OK  ' + name); }
  else { failures++; log('  HIBA ' + name); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false, timeout: 5000 });
    s.on('connect', () => {
      s.lastState = null;
      s.on('state', (st) => { s.lastState = st; });
      resolve(s);
    });
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 6000);
  });
}

function emit(s, event, payload) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 5000);
    s.emit(event, payload, (res) => {
      if (!done) { done = true; clearTimeout(t); resolve(res); }
    });
  });
}

function fire(s, event, payload) {
  s.emit(event, payload);
  return Promise.resolve(null);
}

function waitState(sock, predicate, timeoutMs = 10000) {
  if (sock.lastState && predicate(sock.lastState)) return Promise.resolve(sock.lastState);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off('state', handler);
      reject(new Error('timeout waiting state (last=' + (sock.lastState && sock.lastState.phase) + ')'));
    }, timeoutMs);
    const handler = (st) => {
      if (predicate(st)) {
        clearTimeout(timer);
        sock.off('state', handler);
        resolve(st);
      }
    };
    sock.on('state', handler);
  });
}

let serverProc = null;

async function startServer() {
  serverProc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => log('[szerver-hiba] ' + d.toString()));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('A szerver nem indult el')), 8000);
    const ping = () => {
      http.get(URL + '/healthz', (res) => {
        res.resume();
        if (res.statusCode === 200) { clearTimeout(t); resolve(); }
        else setTimeout(ping, 200);
      }).on('error', () => setTimeout(ping, 200));
    };
    ping();
  });
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch (e) { /* */ }
    serverProc = null;
  }
}

async function main() {
  await startServer();
  log('Szerver elindult :' + PORT);
  try {
    await testRegistry();
    await testTakenAndGuest();
    await testStatsRecorded();
  } catch (err) {
    failures++;
    log('TESZTI KIVÉTEL: ' + err.message);
  } finally {
    stopServer();
  }
  log('');
  log('==============================');
  log('Sikeres: ' + passes + ', hibás: ' + failures);
  log('==============================');
  finish(failures > 0 ? 1 : 0);
}

// ---- nyilvántartás a névválasztóhoz ----
async function testRegistry() {
  log('--- Nyilvántartás (bögrefotók) ---');
  const c = await connect();
  const reg = await emit(c, 'get_registry');
  check('nyilvántartás visszaad ' + PLAYERS.players.length + ' játékost', reg && reg.registry.length === PLAYERS.players.length);
  check('mindenkinél van titulus', reg.registry.every((r) => r.titulus && r.titulus.length > 2));
  check('mindenkinél van priusz', reg.registry.every((r) => r.priusz && r.priusz.length > 5));
  check('a jelvények átkerültek (pl. DÖG)', reg.registry.some((r) => r.jelveny === 'DÖG'));
  check('vendég-priusz sablonok betöltve', reg.vendegPriuszok.length >= 5);
  check('nincs foglalt név üres szobákkal', reg.takenNames.length === 0);
  c.disconnect();
  await sleep(120);
}

// ---- foglalt név + vendég-priusz ----
async function testTakenAndGuest() {
  log('--- Foglalt név és vendég ---');
  const a = await connect();
  const b = await connect();
  const created = await emit(a, 'create_room', { name: 'Izsván [DÖG]', avatar: 'paróka', playerId: 't0', profile: { titulus: 'A Kriszmoszman', priusz: 'x', jelveny: 'DÖG' } });
  check('szoba létrejött', created && created.code);

  const dup = await emit(b, 'join_room', { code: created.code, name: 'Izsván [DÖG]', avatar: 'paróka', playerId: 't1', profile: null });
  check('ugyanazzal a névvel a belépés elutasítva', dup && !!dup.error && dup.error.includes('ŐRIZETBEN'));

  const guest = await emit(b, 'join_room', { code: created.code, name: 'Vendég Károly', avatar: 'napszemüveg', playerId: 't1', profile: { titulus: 'Ismeretlen tettes', priusz: 'Előélete tiszta. Túl tiszta.', jelveny: '' } });
  check('vendég beléphet más névvel', guest && guest.state.players.length === 2);
  const prof = guest.state.players.find((p) => p.id === 't1').profile;
  check('a vendég profilja megérkezett (Ismeretlen tettes)', prof && prof.titulus === 'Ismeretlen tettes');

  // a plakáthoz a szerver csatolja a stats-ot is
  const hostState = (await emit(a, 'get_registry')) ; // just to keep flow
  const st = a.lastState;
  const guestInState = st.players.find((p) => p.id === 't1');
  check('a state profilja a plakáthoz _stats is hordoz', guestInState && guestInState.profile && ' _stats' in {} || guestInState.profile._stats !== undefined);

  a.disconnect();
  b.disconnect();
  await sleep(120);
}

// ---- statisztika íródik a stats.json-be ----
async function testStatsRecorded() {
  log('--- Bűnügyi nyilvántartás (stats.json) ---');
  const before = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));

  const clients = [];
  for (let i = 0; i < 3; i++) clients.push(await connect());
  const created = await emit(clients[0], 'create_room', { name: '2CORE', avatar: 'paróka', playerId: 's0', profile: { titulus: 't', priusz: 'p', jelveny: '' } });
  const code = created.code;
  const joinerName = (i) => (i === 1 ? 'Szipuska' : 'marci');
  for (let i = 1; i < 3; i++) {
    const prof = PLAYERS.players.find((p) => p.nev === joinerName(i));
    const joined = await emit(clients[i], 'join_room', { code, name: joinerName(i), avatar: 'paróka', playerId: 's' + i, profile: { titulus: prof.titulus, priusz: prof.priusz, jelveny: prof.jelveny } });
    check(joinerName(i) + ' belépett', joined && joined.state.players.length === i + 1);
  }
  await emit(clients[0], 'update_settings', {
    settings: { modes: ['pubg'], rounds: 1, speechSeconds: 15, prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10, witnessEnabled: false, challengesEnabled: false }
  });
  await emit(clients[0], 'start_game');
  const acc = await waitState(clients[0], (s) => s.phase === 'accusation');
  const defId = acc.defendantId;
  const defName = acc.players.find((p) => p.id === defId).name;
  check('a vádlott előre megadott játékos (2CORE, Szipuska vagy marci)', ['2CORE', 'Szipuska', 'marci'].includes(defName));

  await fire(clients[0], 'accusation_read');
  await waitState(clients[0], (s) => s.phase === 'prosecution', 20000);
  const s1 = clients[0].lastState;
  const pIdx = (pid) => parseInt(String(pid).replace('s', ''), 10);
  await fire(clients[pIdx(s1.prosecutorId)], 'done_speaking');
  await waitState(clients[0], (s) => s.phase === 'defense', 15000);
  await fire(clients[pIdx(s1.defendantId)], 'done_speaking');
  await waitState(clients[0], (s) => s.phase === 'final_prosecution', 15000);
  await fire(clients[pIdx(s1.prosecutorId)], 'done_speaking');
  await waitState(clients[0], (s) => s.phase === 'final_defense', 15000);
  await fire(clients[pIdx(s1.defendantId)], 'done_speaking');
  await waitState(clients[0], (s) => s.phase === 'verdict_vote', 15000);
  const vv = await Promise.all(clients.map((c) => waitState(c, (s) => s.phase === 'verdict_vote')));
  for (let i = 0; i < clients.length; i++) {
    if (vv[i].verdictVote.canVote) await emit(clients[i], 'vote_verdict', { verdict: 'guilty' });
  }
  const vs = await Promise.all(clients.map((c) => waitState(c, (s) => s.phase === 'verdict', 20000)));
  check('ítélet megérkezett', vs.every((s) => s.verdict && typeof s.verdict.guilty === 'boolean'));

  // megvárjuk, míg a szerver kiírja (300 ms késleltetett mentés)
  await sleep(800);
  const after = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  check('a nyilvántartásba bekerült a vádlott ("' + defName + '")', !!after[defName]);
  check('a vádlott száma nőtt: vadlott=' + (after[defName] ? after[defName].vadlott : '?'), after[defName] && after[defName].vadlott > (before[defName] ? before[defName].vadlott : 0));
  check('bűnös vagy ártatlan számláló nőtt', after[defName] && (
    after[defName].bunos > (before[defName] ? before[defName].bunos : 0) ||
    after[defName].artatlan > (before[defName] ? before[defName].artatlan : 0)
  ));

  clients.forEach((c) => c.disconnect());
}

main();
