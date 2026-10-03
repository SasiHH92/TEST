'use strict';

// ============================================================
// KAMU BÍRÓSÁG – üzemeltetési ellenőrzés (online üzem)
// 1) PORT + /health
// 2) kapcsolat megszakad → újracsatlakozás ugyanazzal a playerId-vel →
//    a szoba/állapot visszatér
// 3) szerver újraindul → a régi szobakódra csatlakozás érthető hibát ad
// Futtatás: node test/deploy-check.js
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const io = require('socket.io-client');

const PORT = 4577;
const URL = 'http://localhost:' + PORT;
let fails = 0;

function ok(cond, label) {
  console.log((cond ? '  OK  ' : '  HIBA ') + label);
  if (!cond) fails++;
}

function waitPort(url, tries = 40) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      const req = http.get(url + '/health', (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => {
        if (n <= 0) resolve(false);
        else setTimeout(() => attempt(n - 1), 250);
      });
    };
    attempt(tries);
  });
}

function connect() {
  return io(URL, { reconnection: false, transports: ['polling', 'websocket'] });
}

function emit(socket, evt, payload) {
  return new Promise((resolve) => {
    socket.emit(evt, payload, (res) => resolve(res || {}));
  });
}

function killChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on('exit', resolve);
    child.kill();
    setTimeout(resolve, 2000);
  });
}

(async function main() {
  // ---------- 1) indulás PORT-tal + /health ----------
  console.log('== 1) Indítás PORT=' + PORT + ' + /health ==');
  let child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) } });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stdout.write('[srv] ' + d));
  const up = await waitPort(URL);
  ok(up, 'a szerver elindult a beállított PORT-on, a /health ok-kal válaszol');

  // ---------- 2) kapcsolat megszakad → újracsatlakozás → állapot vissza ----------
  console.log('== 2) Újracsatlakozás: a játékos visszakapja a szobát ==');
  const a = connect();
  await new Promise((r) => a.on('connect', r));
  const created = await emit(a, 'create_room', {
    name: 'DeployTeszt', avatar: 'paróka', playerId: 'p1', profile: { titulus: 't', priusz: 'p', jelveny: '' }
  });
  ok(created && created.code, 'szoba létrejött: ' + (created && created.code));
  await emit(a, 'add_bot', {});
  await emit(a, 'add_bot', {});
  await emit(a, 'update_settings', { settings: { modes: ['cs'], rounds: 2 } });

  // kapcsolat megszakítása
  a.disconnect();
  await new Promise((r) => setTimeout(r, 300));

  // újracsatlakozás ugyanazzal az állandó playerId-vel (mint a kliens teszi)
  const b = connect();
  await new Promise((r) => b.on('connect', r));
  const rejoined = await emit(b, 'join_room', {
    code: created.code, name: 'DeployTeszt', avatar: 'paróka',
    playerId: 'p1', profile: { titulus: 't', priusz: 'p', jelveny: '' }
  });
  ok(rejoined && !rejoined.error, 'újracsatlakozás elfogadva (nincs hiba)');
  ok(rejoined && rejoined.state && rejoined.state.players.some((p) => p.id === 'p1'),
    'a játékos visszakapta magát a szobában (playerId marad)');
  ok(rejoined && rejoined.state && Array.isArray(rejoined.state.players) && rejoined.state.players.length === 3,
    'a szoba állapota megmaradt (3 résztvevő: 1 ember + 2 bot)');
  ok(rejoined && rejoined.state && rejoined.state.settings && rejoined.state.settings.modes.includes('cs'),
    'a beállítások megmaradtak (mód: cs)');
  b.disconnect();

  // ---------- 3) szerver újraindul → érthető hiba ----------
  console.log('== 3) Szerver-újraindítás: a régi szobakód érthető hibát kap ==');
  await killChild(child);
  child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) } });
  child.stdout.on('data', () => {});
  const up2 = await waitPort(URL);
  ok(up2, 'a szerver újraindult (üres szobákkal)');

  const c = connect();
  await new Promise((r) => c.on('connect', r));
  const dead = await emit(c, 'join_room', { code: created.code, name: 'DeployTeszt', avatar: 'paróka', playerId: 'p1', profile: null });
  ok(dead && dead.error && dead.error.includes('megszűnt'),
    'a kliens érthető hibát kap: "' + (dead && dead.error) + '"');
  c.disconnect();

  await killChild(child);
  console.log('');
  console.log(fails === 0 ? 'DEPLOY-CHECK MIND ZÖLD' : 'HIBÁS: ' + fails);
  process.exit(fails > 0 ? 1 : 0);
})().catch((e) => { console.error('deploy-check hiba:', e); process.exit(1); });
