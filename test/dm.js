'use strict';
// ============================================================
// KAMU BÍRÓSÁG – privát üzenetek a barátok között + értesítés, ha egy barát online lép
// Valódi szerver (ideiglenes fájlokkal), valódi HTTP + socket.io kérésekkel.
// Futtatás: node test/dm.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const io = require('socket.io-client');

const root = path.resolve(__dirname, '..');
const PORT = 3191, BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-dm-'));
const DMS_FILE = path.join(tmp, 'dms.json');
const sockets = [];
let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}

async function http(method, route, body, jar) {
  const headers = method === 'POST' ? { 'Content-Type': 'application/json', Origin: BASE } : {};
  if (jar && jar.size) headers.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const response = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (jar) for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(';')[0], i = first.indexOf('=');
    if (first.slice(i + 1)) jar.set(first.slice(0, i), first.slice(i + 1)); else jar.delete(first.slice(0, i));
  }
  const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
  return { status: response.status, data };
}
const password = 'Egy hosszú titok 123!';
async function account(name) {
  const jar = new Map();
  const email = crypto.randomUUID() + '@example.invalid';
  const r = await http('POST', '/api/auth/register', { username: name, email, password, confirmPassword: password }, jar);
  assert.equal(r.status, 201, 'regisztráció: ' + name);
  const f = (method, route, body) => http(method, '/api/friends' + route, body, jar);
  return { name, email, id: r.data.user.id, get: () => f('GET', '/state'), post: f, dm: (id) => f('GET', '/dm/' + id), send: (id, text) => f('POST', '/dm/send', { userId: id, text }) };
}
async function connect() {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  sockets.push(s);
  s.dms = []; s.sent = []; s.online = [];
  s.on('dm_msg', (p) => s.dms.push(p)); s.on('dm_sent', (p) => s.sent.push(p)); s.on('friend_online', (p) => s.online.push(p));
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}
const identify = async (s, acct) => new Promise((resolve) => s.emit('identify', { ticket: '' }, () => resolve())).then(async () => {
  const ticket = (await acct.post('POST', '/ticket', {})).data.ticket;
  return new Promise((resolve) => s.emit('identify', { ticket }, resolve));
});
async function befriend(a, b) {
  await a.post('POST', '/request', { username: b.name });
  assert.equal((await b.post('POST', '/accept', { userId: a.id })).status, 200);
}

async function main() {
  const spawnServer = () => spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, KB_DMS_FILE: DMS_FILE,
      AUTH_STORE_PATH: path.join(tmp, 'accounts.json'), KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_STATS_FILE: path.join(tmp, 'stats.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  const waitReady = async () => { let ok = false; for (let i = 0; i < 60 && !ok; i++) { try { ok = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } } assert(ok, 'a szerver elindult'); };
  let child = spawnServer(), errors = ''; child.stderr.on('data', (d) => { errors += d; });
  try {
    await waitReady();
    const anna = await account('Anna Teszt'), bela = await account('Bela Teszt'), cili = await account('Cili Teszt');
    await befriend(anna, bela);

    await test('Privát üzenet csak barátnak: idegennek, magadnak és bejelentkezés nélkül nem', async () => {
      assert.equal((await cili.send(anna.id, 'szia')).status, 403, 'idegen nem írhat');
      assert.equal((await anna.send(cili.id, 'szia')).status, 403);
      assert.equal((await anna.send(anna.id, 'magamnak')).status, 403);
      assert.equal((await anna.send('nincs-ilyen-azonosito', 'x')).status, 403);
      assert.equal((await http('POST', '/api/friends/dm/send', { userId: bela.id, text: 'x' })).status, 401);
      assert.equal((await http('GET', '/api/friends/dm/' + bela.id)).status, 401);
      assert.equal((await cili.dm(anna.id)).status, 403, 'idegen a beszélgetést sem olvashatja');
    });

    const sAnna = await connect(), sBela = await connect();
    await test('A barát élőben megkapja az üzenetet (a belső adat nélkül), a feladó többi lapja is', async () => {
      await identify(sAnna, anna); await identify(sBela, bela);
      const sAnna2 = await connect(); await identify(sAnna2, anna);
      const r = await anna.send(bela.id, '  Szia   Béla!  ');
      assert.equal(r.status, 200); assert.equal(r.data.message.text, 'Szia Béla!'); assert.equal(r.data.message.from, anna.id);
      await pause(150);
      assert.equal(sBela.dms.length, 1);
      assert.equal(sBela.dms[0].from.id, anna.id); assert.equal(sBela.dms[0].message.text, 'Szia Béla!');
      assert.ok(!JSON.stringify(sBela.dms[0]).includes('example.invalid'), 'e-mail nem szivárog');
      assert.equal(sAnna2.sent.length, 1, 'a feladó másik lapja is látja');
      assert.equal(sAnna.dms.length, 0, 'a feladó nem kapja vissza');
      sAnna2.disconnect();
    });

    await test('Olvasatlan számláló a barátlistán; a beszélgetés megnyitása olvasottnak jelöli', async () => {
      await pause(900); // az azonos pár két üzenete között legyen köz
      await anna.send(bela.id, 'Itt vagy?');
      let st = (await bela.get()).data;
      assert.equal(st.friends[0].unread, 2); assert.equal(st.dmUnread, 2);
      assert.equal((await anna.get()).data.dmUnread, 0, 'a feladónak nincs olvasatlanja');
      const thread = await bela.dm(anna.id);
      assert.equal(thread.status, 200);
      assert.deepEqual(thread.data.messages.map((m) => m.text), ['Szia Béla!', 'Itt vagy?'], 'sorrendben');
      assert.equal(thread.data.with.id, anna.id);
      st = (await bela.get()).data;
      assert.equal(st.dmUnread, 0, 'megnyitás után nincs olvasatlan');
      await pause(900);
      await bela.send(anna.id, 'Itt!');
      assert.equal((await anna.get()).data.friends[0].unread, 1);
      assert.equal((await bela.get()).data.dmUnread, 0, 'a saját üzeneted nem olvasatlan neked');
      await anna.post('POST', '/dm/read', { userId: bela.id });
      assert.equal((await anna.get()).data.dmUnread, 0);
    });

    await test('Szűrés: üres, vezérlő- és bidi-karakterek, 500 karakter, sebességkorlát', async () => {
      const c = (n) => String.fromCharCode(n);
      await pause(900);
      assert.equal((await anna.send(bela.id, '   ')).status, 400);
      assert.equal((await anna.send(bela.id, c(7) + c(0x200b) + c(0x202e))).status, 400);
      const r = await anna.send(bela.id, 'a' + c(7) + 'b' + c(0x200b) + 'c <i>x</i>' + c(10) + 'sor');
      assert.equal(r.data.message.text, 'a b c <i>x</i> sor');
      assert.equal((await anna.send(bela.id, 'túl gyors')).status, 429, 'két üzenet között várni kell');
      await pause(900);
      assert.equal((await anna.send(bela.id, 'x'.repeat(2000))).data.message.text.length, 500);
      assert.equal((await anna.post('POST', '/dm/send', { userId: bela.id, text: { $ne: 1 } })).status, 400);
    });

    await test('A beszélgetés fájlba mentődik (újraindítás után is megvan), a belső adat nélkül', async () => {
      await pause(1200);
      const file = JSON.parse(fs.readFileSync(DMS_FILE, 'utf8'));
      const thread = Object.values(file.threads)[0];
      assert.ok(thread.msgs.length >= 5);
      for (const s of sockets) s.disconnect();
      child.kill(); await pause(500);
      child = spawnServer(); child.stderr.on('data', (d) => { errors += d; });
      await waitReady();
      // a munkamenetek is a fájlban vannak: ugyanazok a sütik érvényesek maradnak, a beszélgetés megvan
      const after = await anna.dm(bela.id);
      assert.equal(after.status, 200);
      assert.equal(after.data.messages.length, thread.msgs.length);
    });

    await test('Értesítés, ha egy barát online lép: be-/kikapcsolható, láthatatlanul és újracsatlakozáskor nem', async () => {
      const dani = await account('Dani Teszt'), eli = await account('Eli Teszt');
      await befriend(bela, dani); await befriend(bela, eli); await befriend(bela, anna).catch(() => {});
      const watcher = await connect(); await identify(watcher, bela);
      // 1) Dani online lép: Béla értesítést kap
      const sDani = await connect(); await identify(sDani, dani);
      await pause(200);
      assert.deepEqual(watcher.online.map((p) => p.from.username), ['Dani Teszt']);
      assert.ok(!JSON.stringify(watcher.online[0]).includes('example.invalid'), 'e-mail nem szivárog');
      // 2) Dani újracsatlakozik (pl. hálózatváltás): nem szólunk újra
      sDani.disconnect(); await pause(200);
      const sDani2 = await connect(); await identify(sDani2, dani); await pause(200);
      assert.equal(watcher.online.length, 1, 'újracsatlakozáskor nincs új értesítés');
      // 3) láthatatlan barát: nincs értesítés
      assert.equal((await eli.post('POST', '/settings', { presence: 'hidden' })).status, 200);
      const sEli = await connect(); await identify(sEli, eli); await pause(200);
      assert.equal(watcher.online.length, 1, 'a láthatatlan barát belépése nem jelenik meg');
      // 4) a beállítás ki van kapcsolva: nincs értesítés
      assert.equal((await bela.post('POST', '/settings', { notifyOnline: false })).data.notifyOnline, false);
      const frank = await account('Frank Teszt'); await befriend(bela, frank);
      const sFrank = await connect(); await identify(sFrank, frank); await pause(200);
      assert.equal(watcher.online.length, 1, 'kikapcsolt értesítésnél nincs');
      assert.equal((await bela.post('POST', '/settings', { notifyOnline: 'igen' })).status, 400, 'csak logikai érték');
      assert.equal((await bela.post('POST', '/settings', {})).status, 400);
      assert.equal((await bela.post('POST', '/settings', { notifyOnline: true })).data.notifyOnline, true);
      for (const s of [watcher, sDani2, sEli, sFrank]) s.disconnect();
    });

    await test('Barátság megszűnése (eltávolítás / letiltás) törli a beszélgetést', async () => {
      assert.ok((await anna.dm(bela.id)).data.messages.length >= 5, 'a beszélgetés megvan');
      assert.equal((await anna.post('POST', '/remove', { userId: bela.id })).status, 200);
      assert.equal((await anna.dm(bela.id)).status, 403, 'barátság nélkül nincs beszélgetés');
      await befriend(anna, bela);
      assert.deepEqual((await anna.dm(bela.id)).data.messages, [], 'újra barátok: tiszta lappal indul');
      await pause(900);
      await anna.send(bela.id, 'újra');
      assert.equal((await bela.post('POST', '/block', { userId: anna.id })).status, 200);
      assert.equal((await bela.dm(anna.id)).status, 403, 'letiltás után sincs beszélgetés');
      assert.equal((await anna.dm(bela.id)).status, 403);
      await pause(1200);
      const file = JSON.parse(fs.readFileSync(DMS_FILE, 'utf8'));
      assert.ok(!Object.keys(file.threads).some((k) => k.includes(anna.id) && k.includes(bela.id)), 'a fájlból is törlődött');
    });

    await test('Szerver-hibák nélkül lefutott', async () => {
      assert.ok(!/HIBA|Error|uncaught/i.test(errors), errors.slice(0, 800));
    });
  } finally {
    for (const s of sockets) s.disconnect();
    child.kill();
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nPrivát üzenetek: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
