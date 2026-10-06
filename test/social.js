'use strict';
// ============================================================
// KAMU BÍRÓSÁG – barátlista: kérések, elfogadás, tiltás, online láthatóság, meghívó
// Valódi szerver (ideiglenes fiók-, statisztika- és avatár-fájllal), valódi HTTP + socket.io kérésekkel.
// Futtatás: node test/social.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const io = require('socket.io-client');

const PORT = 3187, BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-social-'));
const sockets = [];
let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}

async function http(method, route, body, settings = {}) {
  const headers = { ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...settings.headers };
  if (settings.jar && settings.jar.size) headers.Cookie = [...settings.jar].map(([k, v]) => k + '=' + v).join('; ');
  const response = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (settings.jar) for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(';')[0], i = first.indexOf('=');
    const key = first.slice(0, i), value = first.slice(i + 1);
    if (value) settings.jar.set(key, value); else settings.jar.delete(key);
  }
  const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
  return { status: response.status, data };
}

const password = 'Egy hosszú titok 123!';
async function account(name) {
  const jar = new Map();
  const r = await http('POST', '/api/auth/register', { username: name, email: crypto.randomUUID() + '@example.invalid', password, confirmPassword: password }, { jar });
  assert.equal(r.status, 201, 'regisztráció: ' + name);
  const f = (method, route, body) => http(method, '/api/friends' + route, body, { jar });
  return { name, jar, id: r.data.user.id, get: () => f('GET', '/state'), post: f };
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
  s.refreshes = 0; s.invites = [];
  s.on('friends_refresh', () => { s.refreshes++; });
  s.on('friend_invite', (p) => { s.invites.push(p); });
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}
// A socket azonosítása a fiókkal (jeggyel) – ugyanígy teszi a kliens.
async function identify(s, acct) {
  const ticket = acct ? (await acct.post('POST', '/ticket', {})).data.ticket : '';
  return { ticket, res: await emit(s, 'identify', { ticket }) };
}
const statusOf = async (viewer, friend) => (await viewer.get()).data.friends.find((f) => f.id === friend.id);

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

    const anna = await account('Anna Teszt'), bela = await account('Bela Teszt'), cili = await account('Cili Teszt'), dani = await account('Dani Teszt');

    await test('Bejelentkezés nélkül nincs barátlista és nincs jegy', async () => {
      assert.equal((await http('GET', '/api/friends/state')).status, 401);
      assert.equal((await http('POST', '/api/friends/ticket', {})).status, 401);
      assert.equal((await http('POST', '/api/friends/request', { username: 'Anna Teszt' })).status, 401);
    });

    await test('Új fiók: üres lista, alap láthatóság: mindenki', async () => {
      const r = await anna.get();
      assert.equal(r.status, 200);
      assert.deepEqual(r.data.friends, []); assert.deepEqual(r.data.incoming, []); assert.deepEqual(r.data.outgoing, []);
      assert.equal(r.data.presence, 'all');
      assert.ok(!JSON.stringify(r.data).includes('@example.invalid'), 'e-mail nem szivárog');
    });

    await test('Kérés küldése: névre (kis/nagybetű nélkül), duplikáció, önmaga, ismeretlen', async () => {
      const r = await anna.post('POST', '/request', { username: 'bela teszt' });
      assert.equal(r.status, 200); assert.equal(r.data.outcome, 'sent');
      assert.equal(r.data.outgoing[0].id, bela.id);
      assert.equal((await bela.get()).data.incoming[0].id, anna.id);
      assert.equal((await anna.post('POST', '/request', { username: 'Bela Teszt' })).status, 409, 'kétszer nem');
      assert.equal((await anna.post('POST', '/request', { username: 'Anna Teszt' })).status, 400, 'magadat nem');
      assert.equal((await anna.post('POST', '/request', { username: 'Nincs Ilyen' })).status, 404);
      assert.equal((await anna.post('POST', '/request', { username: '' })).status, 400);
    });

    await test('Elfogadás: mindkét oldalon barát, a kérés eltűnik; csak a címzett fogadhat el', async () => {
      assert.equal((await anna.post('POST', '/accept', { userId: bela.id })).status, 404, 'a küldő nem fogadhatja el');
      const r = await bela.post('POST', '/accept', { userId: anna.id });
      assert.equal(r.status, 200); assert.equal(r.data.outcome, 'friends');
      assert.deepEqual(r.data.friends.map((f) => f.id), [anna.id]); assert.deepEqual(r.data.incoming, []);
      const a = (await anna.get()).data;
      assert.deepEqual(a.friends.map((f) => f.id), [bela.id]); assert.deepEqual(a.outgoing, []);
      assert.equal((await anna.post('POST', '/request', { username: 'Bela Teszt' })).status, 409, 'barátnak nem küldhető kérés');
    });

    await test('Kölcsönös kérés: azonnal barátok', async () => {
      assert.equal((await anna.post('POST', '/request', { username: 'Cili Teszt' })).data.outcome, 'sent');
      const r = await cili.post('POST', '/request', { username: 'Anna Teszt' });
      assert.equal(r.status, 200); assert.equal(r.data.outcome, 'friends');
      assert.ok((await anna.get()).data.friends.some((f) => f.id === cili.id));
    });

    await test('Elutasítás és visszavonás: nincs barátság, a lista tiszta', async () => {
      await dani.post('POST', '/request', { username: 'Anna Teszt' });
      assert.equal((await anna.get()).data.incoming.length, 1);
      const d = await anna.post('POST', '/decline', { userId: dani.id });
      assert.equal(d.status, 200); assert.deepEqual(d.data.incoming, []);
      assert.deepEqual((await dani.get()).data.outgoing, []);
      await dani.post('POST', '/request', { username: 'Anna Teszt' });
      const c = await dani.post('POST', '/cancel', { userId: anna.id });
      assert.deepEqual(c.data.outgoing, []); assert.deepEqual((await anna.get()).data.incoming, []);
    });

    await test('Tiltás: megszünteti a barátságot, a tiltott nem küldhet kérést (és nem tudja meg miért)', async () => {
      const b = await anna.post('POST', '/block', { userId: cili.id });
      assert.equal(b.status, 200);
      assert.deepEqual(b.data.friends.map((f) => f.id), [bela.id]); assert.equal(b.data.blocked[0].id, cili.id);
      assert.deepEqual((await cili.get()).data.friends, []);
      const r = await cili.post('POST', '/request', { username: 'Anna Teszt' });
      assert.equal(r.status, 404); assert.ok(!/tilt/i.test(r.data.error), 'a tiltás ténye nem derül ki');
      assert.equal((await anna.post('POST', '/request', { username: 'Cili Teszt' })).status, 409, 'letiltottnak nem küldünk kérést');
      assert.deepEqual((await anna.post('POST', '/unblock', { userId: cili.id })).data.blocked, []);
      assert.equal((await cili.post('POST', '/request', { username: 'Anna Teszt' })).status, 200, 'feloldás után újra lehet');
      await anna.post('POST', '/decline', { userId: cili.id });
    });

    await test('Barát eltávolítása mindkét oldalon', async () => {
      await dani.post('POST', '/request', { username: 'Bela Teszt' });
      await bela.post('POST', '/accept', { userId: dani.id });
      assert.equal((await bela.get()).data.friends.length, 2);
      const r = await bela.post('POST', '/remove', { userId: dani.id });
      assert.deepEqual(r.data.friends.map((f) => f.id), [anna.id]);
      assert.deepEqual((await dani.get()).data.friends, []);
    });

    await test('Biztonság: másik eredet, nem JSON, kamu adatok, ismeretlen láthatóság', async () => {
      assert.equal((await http('POST', '/api/friends/request', { username: 'Bela Teszt' }, { jar: anna.jar, headers: { Origin: 'https://masik.example' } })).status, 403);
      const wrong = await fetch(BASE + '/api/friends/request', { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: [...anna.jar].map(([k, v]) => k + '=' + v).join('; ') }, body: 'x' });
      assert.equal(wrong.status, 415);
      assert.equal((await anna.post('POST', '/request', { username: { $ne: 1 } })).status, 400);
      assert.equal((await anna.post('POST', '/accept', { userId: ['x'] })).status, 404);
      assert.equal((await anna.post('POST', '/block', { userId: anna.id })).status, 400, 'magadat nem tilthatod');
      assert.equal((await anna.post('POST', '/settings', { presence: 'barmi' })).status, 400);
    });

    // ---------------- socket: online állapot, láthatóság, meghívó ----------------
    const sAnna = await connect(), sBela = await connect();

    await test('Socket-azonosítás jeggyel: egyszer használható, hamis jegy vendég marad', async () => {
      const first = await identify(sAnna, anna);
      assert.equal(first.res.account, true);
      const again = await emit(sBela, 'identify', { ticket: first.ticket });
      assert.equal(again.account, false, 'a már felhasznált jegy nem érvényes');
      assert.equal((await emit(sBela, 'identify', { ticket: 'hamis-jegy' })).account, false);
      assert.equal((await emit(sBela, 'identify', {})).account, false);
      assert.equal((await identify(sBela, bela)).res.account, true);
    });

    await test('Online állapot: a barát látja, hogy online; a lista frissítést kap (friends_refresh)', async () => {
      await pause(450);
      assert.equal((await statusOf(bela, anna)).status, 'online');
      assert.ok(sBela.refreshes > 0, 'a barát értesítést kapott');
      assert.equal((await statusOf(anna, bela)).status, 'online');
    });

    let code;
    await test('Szobában: lobbi + kód látszik a barátnak; játékban nincs lobbi', async () => {
      const created = await emit(sAnna, 'create_room', { name: 'Anna Teszt', playerId: 'anna1' });
      code = created.code; assert.ok(code);
      assert.equal(created.state.players[0].profile.acct, true, 'a szerver jelzi: bejelentkezett fiók');
      await pause(450);
      const s = await statusOf(bela, anna);
      assert.equal(s.status, 'lobby'); assert.equal(s.code, code);
    });

    await test('Az acct jelző csak a fiók saját nevénél jár (más név, vendég: nem)', async () => {
      const other = await connect();
      await identify(other, bela);
      const j = await emit(other, 'join_room', { code, name: 'Valami Mas', playerId: 'bela1' });
      assert.ok(!j.error);
      assert.ok(!j.state.players.find((p) => p.name === 'Valami Mas').profile?.acct, 'más név alatt nincs acct');
      assert.ok(!(j.state.players.find((p) => p.name === 'Anna Teszt').profile?.cosm?.x), 'sértetlen');
      await emit(other, 'leave_room');
      const guest = await connect();
      const g = await emit(guest, 'join_room', { code, name: 'Vendeg Valaki', playerId: 'g1', profile: { titulus: 'x', acct: true, cosm: { frame: 'frame_rainbow' } } });
      const gp = g.state.players.find((p) => p.name === 'Vendeg Valaki').profile;
      assert.ok(!gp.acct && !gp.cosm, 'a kliens nem hamisíthatja az acct/cosm mezőt');
      await emit(guest, 'leave_room'); guest.disconnect(); other.disconnect();
    });

    await test('Láthatóság: "csak online" nem mutat szobát, "láthatatlan" offline-nak látszik, visszaállítható', async () => {
      await anna.post('POST', '/settings', { presence: 'online' });
      let s = await statusOf(bela, anna);
      assert.equal(s.status, 'online'); assert.equal(s.code, undefined, 'a szobakód nem látszik');
      await anna.post('POST', '/settings', { presence: 'hidden' });
      s = await statusOf(bela, anna);
      assert.equal(s.status, 'offline'); assert.equal(s.code, undefined); assert.equal(s.lastSeen, undefined);
      assert.equal((await anna.get()).data.presence, 'hidden', 'magadnak a saját beállításod látszik');
      await anna.post('POST', '/settings', { presence: 'all' });
      s = await statusOf(bela, anna);
      assert.equal(s.status, 'lobby'); assert.equal(s.code, code);
    });

    await test('Meghívó: a barát megkapja a kódot; gyakori ismétlés és idegen elutasítva', async () => {
      const r = await emit(sAnna, 'friend_invite', { friendId: bela.id });
      assert.equal(r.ok, true);
      await pause(150);
      assert.equal(sBela.invites.length, 1);
      assert.equal(sBela.invites[0].code, code); assert.equal(sBela.invites[0].from.id, anna.id);
      assert.ok(!JSON.stringify(sBela.invites[0]).includes('example.invalid'));
      assert.match((await emit(sAnna, 'friend_invite', { friendId: bela.id })).error, /Várj/, 'rövid időn belül nem ismételhető');
      assert.match((await emit(sAnna, 'friend_invite', { friendId: cili.id })).error, /nem a barátod/);
      assert.match((await emit(sAnna, 'friend_invite', { friendId: { x: 1 } })).error || '', /./);
      const lone = await connect(); await identify(lone, anna);
      assert.match((await emit(lone, 'friend_invite', { friendId: bela.id })).error, /szob/);
      lone.disconnect();
    });

    await test('Meghívni csak lobbiból lehet (játék közben nem)', async () => {
      await emit(sAnna, 'add_bot'); await emit(sAnna, 'add_bot');
      const started = await emit(sAnna, 'start_game', { settings: { modes: ['cs'], autoNextRound: false, autoNewGame: false } });
      assert.ok(!started.error, JSON.stringify(started));
      await pause(450);
      assert.equal((await statusOf(bela, anna)).status, 'game');
      assert.match((await emit(sAnna, 'friend_invite', { friendId: bela.id })).error, /lobbi/);
    });

    await test('Kijelentkezés (azonosítás nélküli identify) és lecsatlakozás: offline; a lastSeen csak látható barátnak', async () => {
      await emit(sAnna, 'identify', { ticket: '' });
      await pause(450);
      assert.equal((await statusOf(bela, anna)).status, 'offline');
      await identify(sAnna, anna);
      await pause(450);
      assert.equal((await statusOf(bela, anna)).status, 'game', 'újra azonosítva a szobában van');
      sAnna.disconnect();
      await pause(450);
      const s = await statusOf(bela, anna);
      assert.equal(s.status, 'offline'); assert.ok(s.lastSeen > 0);
    });

    await test('Szerver-hibák nélkül lefutott', async () => {
      assert.ok(!/HIBA|Error|uncaught/i.test(errors), errors.slice(0, 600));
    });
  } finally {
    for (const s of sockets) s.disconnect();
    child.kill();
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nBarátlista: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
