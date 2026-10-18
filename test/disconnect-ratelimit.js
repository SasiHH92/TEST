'use strict';
// ============================================================
// KAMU BÍRÓSÁG – a lecsatlakozás a kéréskorlát (20 esemény / mp) alatt is lefut
//  Hiba volt: aki egy másodpercen belül túl sok kérést küldött, majd kilépett, annál a szerver nem futtatta a lecsatlakozást,
//  így "szellemként" csatlakozottnak látszott a szobában (foglalta a helyet, a játék rá várt).
//  Futtatás: node test/disconnect-ratelimit.js
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');

const PORT = 3255, URL = 'http://127.0.0.1:' + PORT;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sockets = [];
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + (e && e.stack || e)); }
}
function emit(s, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Ack timeout: ' + event)), 4000);
    s.emit(event, payload, (res) => { clearTimeout(t); resolve(res); });
  });
}
async function connect() {
  const s = io(URL, { transports: ['websocket'], reconnection: false }); sockets.push(s);
  s.on('state', (st) => { s.lastState = st; });
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}
async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await pause(50); }
  return cond();
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-dcrl-')), f = (x) => path.join(tmp, x);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', DATABASE_URL: '',
    AUTH_STORE_PATH: f('a.json'), KB_STATS_FILE: f('s.json'), KB_AVATARS_FILE: f('v.json'), KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'),
    KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(URL + '/health')).ok; } catch (_) { /* még indul */ } if (!ready) await pause(250); }
    assert(ready, 'a szerver elindult');

    const host = await connect();
    const created = await emit(host, 'create_room', { name: 'Gazda', playerId: 'host1' });
    assert(created.code, 'szoba létrejött');
    const peer = await connect();
    assert(!(await emit(peer, 'join_room', { code: created.code, name: 'Nyomkodó', playerId: 'peer1' })).error, 'belépett');
    await until(() => host.lastState && host.lastState.players.some((p) => p.id === 'peer1' && p.connected));

    await test('kéréskorlát túllépése után azonnal kilépő játékos lecsatlakozottnak látszik (nem marad szellem)', async () => {
      for (let i = 0; i < 40; i++) peer.emit('get_registry', () => {}); // > 20 esemény ugyanabban a másodpercben
      peer.disconnect();
      const gone = await until(() => host.lastState.players.some((p) => p.id === 'peer1' && p.connected === false), 3000);
      assert(gone, 'a gazda állapotában a játékos lecsatlakozott (connected: false)');
    });

    await test('a korlát a többi eseményt továbbra is fékezi (egy socketen > 20 kérés / mp: figyelmeztetés)', async () => {
      const spam = await connect();
      let warned = false;
      spam.on('host_warning', (w) => { if (/Túl sok kérés/.test(w && w.message || '')) warned = true; });
      for (let i = 0; i < 40; i++) spam.emit('get_registry', () => {});
      assert(await until(() => warned, 2000), 'figyelmeztetés jött');
    });
  } catch (e) {
    failed++; console.error('FAIL: előkészítés\n' + (e && e.stack || e));
  } finally {
    for (const s of sockets) try { s.disconnect(); } catch (_) { /* */ }
    child.kill(); await pause(200);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  }
  console.log('\n' + passed + ' sikeres, ' + failed + ' hibás');
  process.exit(failed ? 1 : 0);
})();
