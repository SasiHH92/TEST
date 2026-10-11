'use strict';
// ============================================================
// KAMU BÍRÓSÁG – tesztelői pogácsa-jutalom: a legendás (alapító) kártyát igénylő fiók EGYSZER, automatikusan
// bőséges pogácsát kap; sima fiók nem; ismételt megnyitás / újraindítás nem duplázza. Futtatás: node test/tester-bonus.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { legendCode } = require('../legend-claims');
const io = require('socket.io-client');

const root = path.resolve(__dirname, '..');
const PORT = 3196, BASE = 'http://127.0.0.1:' + PORT;
const SECRET = 'csak-teszthez-valo-titok-0123456789';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-tester-'));
const f = (n) => path.join(tmp, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0, child = null;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}
async function http(method, route, body, jar) {
  const headers = method === 'POST' ? { 'Content-Type': 'application/json', Origin: BASE } : {};
  if (jar && jar.size) headers.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const res = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (jar) for (const cookie of res.headers.getSetCookie()) {
    const first = cookie.split(';')[0], i = first.indexOf('=');
    if (first.slice(i + 1)) jar.set(first.slice(0, i), first.slice(i + 1)); else jar.delete(first.slice(0, i));
  }
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
  return { status: res.status, data };
}
const password = 'Egy hosszú titok 123!';
async function start(env = {}) {
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, LEGEND_SECRET: SECRET, ...env,
      AUTH_STORE_PATH: f('accounts.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('st.json'), KB_COURTS_FILE: f('c.json'),
      KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch (_) { await pause(100); } }
  throw new Error('a szerver nem indult el');
}
async function stop() {
  const c = child; child = null;
  if (!c) return;
  await new Promise((r) => { c.once('exit', r); c.kill('SIGTERM'); setTimeout(() => { try { c.kill('SIGKILL'); } catch (_) { /* */ } }, 3000); });
}

(async () => {
  const players = require('../data/players.json').players;
  const legend = players[0].nev;
  await start();
  const tester = new Map(), normal = new Map();
  await test('Legendás (tesztelő) fiók az első bolt-megnyitáskor megkapja a pogácsa-jutalmat; sima fiók nem', async () => {
    const r = await http('POST', '/api/auth/register', { username: 'bármi', legend, claim: legendCode(SECRET, legend), email: 't@example.invalid', password, confirmPassword: password }, tester);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const first = await http('GET', '/api/shop/state', undefined, tester);
    assert.equal(first.status, 200);
    assert.equal(first.data.testerBonus, 5000);
    assert.equal(first.data.wallet, 5000, 'a pénztárcában ott a jutalom');
    assert.equal(first.data.earned, 0, 'a küldetésből szerzett összeg nem változik');
    const n = await http('POST', '/api/auth/register', { username: 'Sima Fiok', email: 'n@example.invalid', password, confirmPassword: password }, normal);
    assert.equal(n.status, 201);
    const ns = await http('GET', '/api/shop/state', undefined, normal);
    assert.equal(ns.data.wallet, 0);
    assert.equal(ns.data.testerBonus, undefined);
  });
  await test('Ismételt megnyitás és újraindítás nem adja meg újra; a jutalomból vásárolni lehet', async () => {
    const again = await http('GET', '/api/shop/state', undefined, tester);
    assert.equal(again.data.wallet, 5000);
    assert.equal(again.data.testerBonus, undefined, 'csak az első megnyitáskor jelzi');
    const items = again.data.catalog.targyak;
    const cheap = items.find((i) => !i.feloldas && !i.szezon && i.ar > 0 && i.ar <= 1000);
    const bought = await http('POST', '/api/shop/buy', { itemId: cheap.id }, tester);
    assert.equal(bought.status, 200, JSON.stringify(bought.data));
    assert.equal(bought.data.wallet, 5000 - cheap.ar);
    await pause(1500); // a mentés késleltetése
    await stop();
    await start();
    const after = await http('GET', '/api/shop/state', undefined, tester);
    assert.equal(after.status, 200, 'a munkamenet a fájlból tér vissza');
    assert.equal(after.data.wallet, 5000 - cheap.ar, 'újraindítás után sem adja meg újra');
    assert.equal(after.data.testerBonus, undefined);
  });
  await test('SZEKRÉNY: a legenda egyedi kerete/háttere tárgy (felvéve), más nem látja; mást felvéve az egyedi nem tűnik el, és visszavehető – a játékban is', async () => {
    const st = (await http('GET', '/api/shop/state', undefined, tester)).data;
    const ids = st.catalog.targyak.filter((i) => i.feloldas === 'legend').map((i) => i.id).sort();
    assert.deepEqual(ids, ['bg_glitch', 'frame_glitch'], 'csak a saját legendájának tárgyai látszanak');
    assert.ok(st.owned.includes('frame_glitch') && st.owned.includes('bg_glitch'));
    assert.equal(st.equipped.frame, 'frame_glitch', 'az első megnyitáskor fel van véve');
    assert.equal(st.equipped.bg, 'bg_glitch');
    const nst = (await http('GET', '/api/shop/state', undefined, normal)).data;
    assert.ok(!nst.catalog.targyak.some((i) => i.feloldas === 'legend'), 'sima fióknak nem látszik');
    assert.equal((await http('POST', '/api/shop/buy', { itemId: 'frame_glitch' }, normal)).status, 403, 'nem vásárolható');
    assert.equal((await http('POST', '/api/shop/equip', { slot: 'frame', itemId: 'frame_glitch' }, normal)).status === 200, false, 'más nem veheti fel');

    // vásárol egy másik keretet és felveszi: az egyedi nem tűnik el
    const other = st.catalog.targyak.find((i) => i.slot === 'frame' && !i.feloldas && !i.szezon && i.ar > 0 && i.ar <= 1000 && !st.owned.includes(i.id));
    assert.equal((await http('POST', '/api/shop/buy', { itemId: other.id }, tester)).status, 200);
    let eq = await http('POST', '/api/shop/equip', { slot: 'frame', itemId: other.id }, tester);
    assert.equal(eq.status, 200, JSON.stringify(eq.data));
    assert.equal(eq.data.equipped.frame, other.id);
    assert.ok(eq.data.owned.includes('frame_glitch'), 'az egyedi keret megmaradt a szekrényben');
    assert.ok(eq.data.catalog.targyak.some((i) => i.id === 'frame_glitch'), 'a boltban továbbra is ott van');
    // az újramegnyitás nem veszi fel újra erőszakosan (egyszeri automatikus felvétel)
    assert.equal((await http('GET', '/api/shop/state', undefined, tester)).data.equipped.frame, other.id);

    // a JÁTÉKBAN is a felvett keret látszik, és visszaváltható az egyedire
    const ticket = async () => (await http('POST', '/api/friends/ticket', {}, tester)).data.ticket;
    const emit = (s, ev, p) => new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('ack: ' + ev)), 5000); s.emit(ev, p, (r) => { clearTimeout(to); res(r); }); });
    const sock = io(BASE, { transports: ['websocket'], reconnection: false });
    await new Promise((res, rej) => { sock.once('connect', res); sock.once('connect_error', rej); });
    await emit(sock, 'identify', { ticket: await ticket() });
    const frameInRoom = async (pid) => {
      const r = await emit(sock, 'create_room', { name: legend, avatar: '', playerId: pid, profile: null });
      assert.ok(r.code, JSON.stringify(r));
      const me = r.state.players.find((p) => p.id === pid);
      await emit(sock, 'leave_room', {});
      return me.profile && me.profile.cosm && me.profile.cosm.frame;
    };
    assert.equal(await frameInRoom('p-' + Date.now() + 'a'), other.id, 'a játékban a felvett (vásárolt) keret látszik, nem az egyedi');
    eq = await http('POST', '/api/shop/equip', { slot: 'frame', itemId: 'frame_glitch' }, tester);
    assert.equal(eq.status, 200);
    assert.equal(await frameInRoom('p-' + Date.now() + 'b'), 'frame_glitch', 'visszavéve: az egyedi keret újra látszik');
    const un = await http('POST', '/api/shop/equip', { slot: 'frame', itemId: null }, tester);
    assert.equal(un.status, 200);
    assert.equal(await frameInRoom('p-' + Date.now() + 'c'), 'frame_glitch', 'felvett keret nélkül a legenda alapértelmezése érvényes');
    sock.disconnect();
  });
  await test('Az összeg környezeti változóból állítható (TESTER_POGACSA), 0 = kikapcsolva', async () => {
    await stop();
    await start({ TESTER_POGACSA: '1234' });
    const jar = new Map();
    const email = 'u2@example.invalid';
    const second = players[1].nev;
    const r = await http('POST', '/api/auth/register', { username: 'x', legend: second, claim: legendCode(SECRET, second), email, password, confirmPassword: password }, jar);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal((await http('GET', '/api/shop/state', undefined, jar)).data.wallet, 1234);
    await stop();
    await start({ TESTER_POGACSA: '0' });
    const third = players[2].nev, jar3 = new Map();
    assert.equal((await http('POST', '/api/auth/register', { username: 'y', legend: third, claim: legendCode(SECRET, third), email: 'u3@example.invalid', password, confirmPassword: password }, jar3)).status, 201);
    assert.equal((await http('GET', '/api/shop/state', undefined, jar3)).data.wallet, 0, 'TESTER_POGACSA=0: nincs jutalom');
  });
  await stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nTesztelői jutalom: ${passed} sikeres, ${failed} hibás teszt.`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await stop(); process.exit(1); });
