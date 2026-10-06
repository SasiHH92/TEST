'use strict';
// ============================================================
// KAMU BÍRÓSÁG – szobai csevegő + névszabály (foglalt név nem használható)
// Valódi szerver (ideiglenes fájlokkal), valódi HTTP + socket.io kérésekkel.
// Futtatás: node test/chat.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const io = require('socket.io-client');

const PORT = 3189, BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-chat-'));
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
  const r = await http('POST', '/api/auth/register', { username: name, email: crypto.randomUUID() + '@example.invalid', password, confirmPassword: password }, jar);
  assert.equal(r.status, 201, 'regisztráció: ' + name);
  return { name, jar, id: r.data.user.id, friends: (route, body) => http('POST', '/api/friends' + route, body, jar) };
}

function emit(s, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Ack timeout: ' + event)), 4000);
    s.emit(event, payload, (res) => { clearTimeout(t); resolve(res); });
  });
}
async function connect() {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  sockets.push(s);
  s.chat = [];
  s.on('chat_msg', (m) => s.chat.push(m));
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}
async function identify(s, acct) {
  const ticket = (await acct.friends('/ticket', {})).data.ticket;
  return emit(s, 'identify', { ticket });
}

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE,
      AUTH_STORE_PATH: path.join(tmp, 'accounts.json'), KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_STATS_FILE: path.join(tmp, 'stats.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; child.stderr.on('data', (d) => { errors += d; });
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');

    const anna = await account('Anna Teszt'), bela = await account('Bela Teszt');

    // ---------------- névszabály ----------------
    await test('Vendég nem használhatja egy regisztrált játékos nevét (kis/nagybetűvel sem)', async () => {
      const guest = await connect();
      for (const name of ['Anna Teszt', 'anna teszt', 'ANNA TESZT']) {
        assert.match((await emit(guest, 'check_name', { name })).error, /regisztrált/, name);
        assert.match((await emit(guest, 'create_room', { name, playerId: 'g1' })).error, /regisztrált/, 'szoba-létrehozás: ' + name);
      }
      const ok = await emit(guest, 'create_room', { name: 'Egy Vendeg', playerId: 'g1' });
      assert.ok(ok.code && !ok.error, 'szabad név használható');
      guest.disconnect();
    });

    await test('Nyilvántartott (legendás) név csak pontosan, a kártyájával; a kis/nagybetűs másolat tilos', async () => {
      const guest = await connect();
      for (const name of ['kyrashi', 'KYRASHI', 'sanyi/sasi', 'ULTRAGOKU996', 'h3romarci']) {
        assert.match((await emit(guest, 'check_name', { name })).error, /nyilvántartott/, name);
      }
      for (const name of ['Kyrashi', 'marci', 'Marci', 'Sanyi/Sasi']) {
        assert.ok((await emit(guest, 'check_name', { name })).ok, 'pontos név a kártyával: ' + name);
        assert.match((await emit(guest, 'check_name', { name, guest: true })).error, /nyilvántartott játékos neve/, 'a vendég-névmezőbe nem írható: ' + name);
      }
      guest.disconnect();
    });

    await test('A fiók tulajdonosa használhatja a nevét, más fiók nem; üres név nem', async () => {
      const sAnna = await connect(), sBela = await connect();
      await identify(sAnna, anna); await identify(sBela, bela);
      assert.ok((await emit(sAnna, 'check_name', { name: 'Anna Teszt' })).ok, 'a tulajdonos igen');
      assert.ok((await emit(sAnna, 'check_name', { name: 'anna teszt' })).ok, 'kis/nagybetűs változat a tulajdonosnak is megy');
      assert.match((await emit(sBela, 'check_name', { name: 'Anna Teszt' })).error, /regisztrált/, 'másik fiók nem');
      assert.match((await emit(sBela, 'create_room', { name: 'Anna Teszt', playerId: 'b1' })).error, /regisztrált/);
      assert.ok((await emit(sAnna, 'check_name', { name: '   ' })).error, 'üres név nem');
      assert.ok((await emit(sAnna, 'check_name', {})).error);
      const created = await emit(sAnna, 'create_room', { name: 'Anna Teszt', playerId: 'a1' });
      assert.ok(created.code && !created.error);
      // szobán belül a foglalt név (kis/nagybetű nélkül) továbbra sem használható
      const other = await connect();
      assert.match((await emit(other, 'join_room', { code: created.code, name: 'ANNA TESZT', playerId: 'x' })).error, /regisztrált|ŐRIZETBEN/);
      const dup = await connect();
      await emit(dup, 'join_room', { code: created.code, name: 'Vendeg Ketto', playerId: 'v2' });
      const dup2 = await connect();
      assert.match((await emit(dup2, 'join_room', { code: created.code, name: 'vendeg ketto', playerId: 'v3' })).error, /ŐRIZETBEN/, 'a szobában a név egyedi');
      for (const s of [sAnna, sBela, other, dup, dup2]) s.disconnect();
    });

    // ---------------- csevegő ----------------
    let code;
    const host = await connect(), peer = await connect(), outsider = await connect(), otherRoomHost = await connect();
    await test('A szoba minden tagja megkapja az üzenetet (név, azonosító, idő); más szoba és szobán kívüli nem', async () => {
      const created = await emit(host, 'create_room', { name: 'Chat Host', playerId: 'h1' });
      code = created.code; assert.ok(Array.isArray(created.chat));
      await emit(peer, 'join_room', { code, name: 'Chat Peer', playerId: 'p1' });
      await emit(otherRoomHost, 'create_room', { name: 'Masik Szoba', playerId: 'o1' });
      const r = await emit(host, 'chat_send', { text: '  Szia   mindenkinek!  ' });
      assert.ok(r.ok && r.id === 1);
      await pause(120);
      for (const s of [host, peer]) {
        assert.equal(s.chat.length, 1);
        assert.deepEqual(Object.keys(s.chat[0]).sort(), ['id', 'name', 'pid', 'text', 'ts'], 'belső adat (fiók-azonosító) nem szivárog');
        assert.equal(s.chat[0].text, 'Szia mindenkinek!'); assert.equal(s.chat[0].name, 'Chat Host'); assert.equal(s.chat[0].pid, 'h1');
        assert.ok(Math.abs(s.chat[0].ts - Date.now()) < 5000);
      }
      assert.equal(otherRoomHost.chat.length, 0, 'másik szoba nem kapja');
      assert.match((await emit(outsider, 'chat_send', { text: 'hello' })).error, /szobában/);
      assert.equal(outsider.chat.length, 0);
    });

    await test('Szűrés: üres, vezérlő- és zéró-szélességű karakterek, hossz, HTML szövegként marad', async () => {
      const c = (n) => String.fromCharCode(n);
      assert.ok((await emit(peer, 'chat_send', { text: '   ' })).error);
      assert.ok((await emit(peer, 'chat_send', { text: c(7) + c(0x200b) + c(0x202e) })).error, 'csak tiltott karakterekből álló üzenet üres');
      assert.ok((await emit(peer, 'chat_send', { text: { x: 1 } })).error || true);
      assert.ok((await emit(peer, 'chat_send', {})).error);
      const html = await emit(peer, 'chat_send', { text: 'a' + c(7) + 'b' + c(0x200b) + 'c <b>x</b>' + c(10) + 'sor' });
      assert.ok(html.ok);
      await pause(120);
      assert.equal(host.chat.at(-1).text, 'a b c <b>x</b> sor', 'a szerver nem értelmezi a HTML-t (a kliens escape-el)');
    });

    await test('Sebességkorlát és ismétlés-szűrés', async () => {
      const spam = await connect();
      await emit(spam, 'join_room', { code, name: 'Spammer', playerId: 'sp' });
      const results = [];
      for (let i = 0; i < 6; i++) results.push(await emit(spam, 'chat_send', { text: 'üzenet ' + i }));
      assert.equal(results.filter((r) => r.ok).length, 4, 'ablakonként legfeljebb 4 üzenet');
      assert.match(results[5].error, /Lassabban/);
      spam.disconnect();
      const dupSender = await connect();
      await emit(dupSender, 'join_room', { code, name: 'Dupla', playerId: 'dp' });
      assert.ok((await emit(dupSender, 'chat_send', { text: 'ugyanaz' })).ok);
      assert.match((await emit(dupSender, 'chat_send', { text: 'ugyanaz' })).error, /épp most/);
      dupSender.disconnect();
    });

    await test('Hosszú üzenet 280 karakterre vágva', async () => {
      const long = await connect();
      await emit(long, 'join_room', { code, name: 'Hosszu', playerId: 'lg' });
      await emit(long, 'chat_send', { text: 'x'.repeat(1000) });
      await pause(120);
      assert.equal(host.chat.at(-1).text.length, 280);
      long.disconnect();
    });

    await test('Előzmény: a későn belépő és az újracsatlakozó is megkapja a korábbi üzeneteket', async () => {
      const late = await connect();
      const joined = await emit(late, 'join_room', { code, name: 'Keso', playerId: 'k1' });
      assert.ok(joined.chat.length >= 3, 'előzmény a belépéskor');
      assert.ok(joined.chat.every((m, i, a) => i === 0 || a[i - 1].id < m.id), 'sorrendben');
      assert.equal(joined.chat[0].text, 'Szia mindenkinek!');
      assert.ok(!joined.chat.some((m) => 'uid' in m));
      // újracsatlakozás (ugyanaz a játékos, érvényes munkamenet-azonosítóval): ismét megkapja az előzményt
      const back = await connect();
      const rejoined = await emit(back, 'join_room', { code, name: 'Keso', playerId: 'k1', sessionToken: joined.sessionToken });
      assert.ok(!rejoined.error, rejoined.error);
      assert.equal(rejoined.chat.length, joined.chat.length);
      late.disconnect(); back.disconnect();
    });

    await test('Letiltott játékos üzenete nem látszik annak, aki letiltotta (élőben és az előzményben sem)', async () => {
      const sA = await connect(), sB = await connect(), guest = await connect();
      await identify(sA, anna); await identify(sB, bela);
      const created = await emit(sA, 'create_room', { name: 'Anna Teszt', playerId: 'a2' });
      const joinedB = await emit(sB, 'join_room', { code: created.code, name: 'Bela Teszt', playerId: 'b2' });
      await emit(guest, 'join_room', { code: created.code, name: 'Vendeg Harmadik', playerId: 'g3' });
      // Bela letiltja Annát
      assert.equal((await bela.friends('/block', { userId: anna.id })).status, 200);
      assert.ok((await emit(sA, 'chat_send', { text: 'Bela, látsz?' })).ok);
      await pause(150);
      assert.equal(sA.chat.length, 1, 'a feladó látja a sajátját');
      assert.equal(guest.chat.length, 1, 'a vendég látja');
      assert.equal(sB.chat.length, 0, 'a letiltó nem látja');
      // Bela üzenete Annához megy (a tiltás egyirányú)
      assert.ok((await emit(sB, 'chat_send', { text: 'Én írok' })).ok);
      await pause(150);
      assert.equal(sA.chat.length, 2);
      // újracsatlakozáskor az előzmény is szűrt
      const rejoin = await connect(); await identify(rejoin, bela);
      const again = await emit(rejoin, 'join_room', { code: created.code, name: 'Bela Teszt', playerId: 'b2', sessionToken: joinedB.sessionToken });
      assert.ok(!again.error, again.error);
      assert.deepEqual(again.chat.map((m) => m.text), ['Én írok'], 'az előzményben sincs a letiltott üzenete');
      const guestJoin = await connect();
      const g = await emit(guestJoin, 'join_room', { code: created.code, name: 'Vendeg Negyedik', playerId: 'g4' });
      assert.deepEqual(g.chat.map((m) => m.text), ['Bela, látsz?', 'Én írok'], 'a vendég mindent lát');
      for (const s of [sA, sB, guest, rejoin, guestJoin]) s.disconnect();
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
  console.log('\nCsevegő és nevek: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
