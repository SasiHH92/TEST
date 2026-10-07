'use strict';
// ============================================================
// KAMU BÍRÓSÁG – adatvédelem: adatkérés (letöltés) és fiók-törlés
//   - az adatkérés csak bejelentkezve megy, és nem tartalmaz jelszó-hasht, munkamenetet, tokent,
//   - a törléshez újra-azonosítás kell (jelszó); törlés után a fiók, a munkamenetek, a barátságok, a privát üzenetek
//     és a névhez kötött statisztika is eltűnik, a név újra foglalható, és az új fióknak nincs örökölt adata,
//   - a legendás kártya statisztikája megmarad, és a legenda újra igényelhető.
// Valódi szerver (ideiglenes fájlokkal), valódi HTTP + socket.io kérésekkel.
// Futtatás: node test/privacy.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const io = require('socket.io-client');
const { createDms } = require('../dms');
const { legendCode } = require('../legend-claims');

const root = path.resolve(__dirname, '..');
const PORT = 3195, BASE = 'http://127.0.0.1:' + PORT;
const SECRET = 'csak-teszthez-valo-titok-0123456789';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-privacy-'));
const FILES = { accounts: path.join(tmp, 'accounts.json'), stats: path.join(tmp, 'stats.json'), dms: path.join(tmp, 'dms.json') };
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
  const cookies = response.headers.getSetCookie();
  if (jar) for (const cookie of cookies) {
    const first = cookie.split(';')[0], i = first.indexOf('=');
    if (first.slice(i + 1)) jar.set(first.slice(0, i), first.slice(i + 1)); else jar.delete(first.slice(0, i));
  }
  const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
  return { status: response.status, data, text, headers: response.headers, cookies };
}
const password = 'Egy hosszú titok 123!';
async function account(name) {
  const jar = new Map();
  const email = crypto.randomUUID() + '@example.invalid';
  const r = await http('POST', '/api/auth/register', { username: name, email, password, confirmPassword: password }, jar);
  assert.equal(r.status, 201, 'regisztráció: ' + name);
  const f = (method, route, body) => http(method, '/api/friends' + route, body, jar);
  return { name, email, jar, id: r.data.user.id, friends: () => f('GET', '/state'), post: f, dm: (id) => f('GET', '/dm/' + id), send: (id, text) => f('POST', '/dm/send', { userId: id, text }) };
}
async function connect() {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  sockets.push(s);
  s.refreshes = 0; s.on('friends_refresh', () => { s.refreshes++; });
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

async function unitDms() {
  await test('Üzenet-tároló: a törlendő felhasználó összes beszélgetése és jelölője megszűnik, a többieké megmarad', () => {
    const file = path.join(tmp, 'unit-dms.json');
    const dms = createDms({ file, persist: () => {} });
    dms.add('a', 'b', 'a→b'); dms.add('b', 'a', 'b→a'); dms.add('b', 'c', 'b→c'); dms.add('c', 'd', 'c→d');
    dms.markRead('a', 'b'); dms.markRead('c', 'b'); dms.markRead('c', 'd');
    assert.deepEqual(Object.keys(dms.exportFor('b')).sort(), ['a', 'c']);
    assert.deepEqual(dms.exportFor('b').a.map((m) => m.text), ['a→b', 'b→a']);
    assert.ok(dms.purgeUser('b') >= 3);
    assert.deepEqual(dms.exportFor('b'), {});
    assert.deepEqual(dms.messages('a', 'b'), []); assert.deepEqual(dms.messages('b', 'c'), []);
    assert.deepEqual(dms.messages('c', 'd').map((m) => m.text), ['c→d'], 'más beszélgetés érintetlen');
    assert.deepEqual(dms.unread('c'), {}, 'nincs olvasatlan jelölő a törölt félhez');
    dms.flush();
    assert.ok(!fs.readFileSync(file, 'utf8').includes('a→b'), 'a fájlból is eltűnt');
    assert.equal(dms.purgeUser('nincs-ilyen'), 0);
  });
}

async function main() {
  await unitDms();
  // a törlendő fióknak már van statisztikája (a nyilvántartás név szerint tárol); egy legendának is
  fs.writeFileSync(FILES.stats, JSON.stringify({
    'Anna Torlo': { vadlott: 2, bunos: 1, artatlan: 1, dijak: 0 },
    'Bela Marad': { vadlott: 3, bunos: 3, artatlan: 0, dijak: 1 },
    Alexhh: { vadlott: 5, bunos: 4, artatlan: 1, dijak: 2 }
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DATABASE_URL: '', LEGEND_SECRET: SECRET,
      AUTH_STORE_PATH: FILES.accounts, KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_STATS_FILE: FILES.stats,
      KB_DMS_FILE: FILES.dms, KB_ERRORS_FILE: path.join(tmp, 'errors.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');

    const anna = await account('Anna Torlo'), bela = await account('Bela Marad'), cili = await account('Cili Marad');
    await anna.post('POST', '/request', { username: bela.name });
    assert.equal((await bela.post('POST', '/accept', { userId: anna.id })).status, 200);
    await anna.post('POST', '/request', { username: cili.name }); // függő kérés Annától Cilinek
    assert.equal((await anna.send(bela.id, 'Szia Bela, ez privát!')).status, 200);
    assert.equal((await bela.send(anna.id, 'Szia Anna!')).status, 200);

    await test('Adatkérés: bejelentkezés nélkül 401', async () => {
      assert.equal((await http('GET', '/api/account/export')).status, 401);
    });

    await test('Adatkérés: a saját adatok letölthetők, jelszó-hash, munkamenet és token nélkül', async () => {
      const r = await http('GET', '/api/account/export', undefined, anna.jar);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-disposition') || '', /attachment; filename="kamu-birosag-adataim\.json"/);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      const d = r.data;
      assert.equal(d.account.username, 'Anna Torlo'); assert.equal(d.account.email, anna.email);
      assert.equal(d.account.hasPassword, true);
      assert.deepEqual(d.social.friends, ['Bela Marad']); assert.deepEqual(d.social.outgoingRequests, ['Cili Marad']);
      assert.equal(d.stats.bunos, 1);
      assert.deepEqual(d.messages.map((m) => m.with), ['Bela Marad']);
      assert.deepEqual(d.messages[0].messages.map((m) => m.from + ': ' + m.text), ['Anna Torlo: Szia Bela, ez privát!', 'Bela Marad: Szia Anna!']);
      assert.doesNotMatch(r.text, /"password"|"hash"|"salt"|"sessions"|"resets"|scrypt/i, 'nincs benne jelszó-hash vagy munkamenet');
      assert.ok(!r.text.includes(bela.email) && !r.text.includes(cili.email), 'más fiók e-mail címe nem szivárog');
    });

    await test('Törlés: bejelentkezés nélkül 401; hiányzó, rossz vagy nem szöveges jelszó nem töröl semmit', async () => {
      assert.equal((await http('POST', '/api/auth/delete', { password })).status, 401);
      assert.equal((await http('POST', '/api/auth/delete', {}, anna.jar)).status, 400);
      assert.equal((await http('POST', '/api/auth/delete', { password: 'rossz jelszó 123456' }, anna.jar)).status, 401);
      assert.equal((await http('POST', '/api/auth/delete', { password: { $ne: 1 } }, anna.jar)).status, 400);
      assert.equal((await http('GET', '/api/auth/status', undefined, anna.jar)).data.user.username, 'Anna Torlo', 'a fiók megvan');
      assert.equal((await bela.friends()).data.friends.length, 1, 'a barátság megvan');
    });

    await test('Törlés: a fiók, a munkamenet, a barátságok, a kérések, a privát üzenetek és a statisztika eltűnik; a barátok értesülnek', async () => {
      const belaSocket = await connect();
      const ticket = (await bela.post('POST', '/ticket', {})).data.ticket;
      await new Promise((resolve) => belaSocket.emit('identify', { ticket }, resolve));
      const before = belaSocket.refreshes;
      const oldSession = new Map(anna.jar);

      const del = await http('POST', '/api/auth/delete', { password }, anna.jar);
      assert.equal(del.status, 200); assert.deepEqual(del.data, { ok: true });
      assert.ok(del.cookies.some((c) => /kb_account=;|kb_account=$/.test(c.split(';')[0] + ';') || /Expires=Thu, 01 Jan 1970/i.test(c)), 'a munkamenet-süti törlődik');

      assert.equal((await http('GET', '/api/auth/status', undefined, oldSession)).data.user, null, 'a régi munkamenet érvénytelen');
      assert.equal((await http('POST', '/api/auth/login', { email: anna.email, password })).status, 401, 'belépni nem lehet');
      assert.equal((await http('POST', '/api/auth/delete', { password }, oldSession)).status, 401, 'kétszer nem törölhető');

      assert.deepEqual((await bela.friends()).data.friends, [], 'Bela barátlistája üres');
      assert.deepEqual((await cili.friends()).data.incoming, [], 'Cili beérkező kérései közül is kikerült');
      assert.notEqual((await bela.dm(anna.id)).status, 200, 'a beszélgetés nem olvasható');
      await pause(300);
      assert.ok(belaSocket.refreshes > before, 'a barát listája élőben frissült');

      await pause(1200); // az üzenet- és a statisztika-mentés késleltetett
      const accounts = readJson(FILES.accounts);
      assert.ok(!accounts.users.some((u) => u.id === anna.id || u.email === anna.email), 'a fiók nincs a fiókfájlban');
      assert.ok(!accounts.sessions.some((s) => s.userId === anna.id) && !accounts.resets.some((r) => r.userId === anna.id));
      assert.ok(!fs.readFileSync(FILES.accounts, 'utf8').includes(anna.id), 'sehol nem marad az azonosítója');
      assert.ok(!fs.readFileSync(FILES.dms, 'utf8').includes('Szia Bela'), 'az üzenetek eltűntek');
      const stats = readJson(FILES.stats);
      assert.equal(stats['Anna Torlo'], undefined, 'a névhez kötött statisztika törölve');
      assert.equal(stats['Bela Marad'].bunos, 3, 'másé érintetlen');
    });

    await test('Törlés után a felhasználónév újra foglalható, és az új fióknak nincs örökölt adata', async () => {
      const again = await account('Anna Torlo');
      const d = (await http('GET', '/api/account/export', undefined, again.jar)).data;
      assert.deepEqual(d.social.friends, []); assert.deepEqual(d.messages, []); assert.equal(d.stats, null);
      assert.equal((await again.friends()).data.friends.length, 0);
    });

    await test('Legendás fiók törlése: a kártya statisztikája megmarad, a legenda újra igényelhető', async () => {
      const jar = new Map();
      const claim = () => http('POST', '/api/auth/register', { username: 'x', legend: 'Alexhh', claim: legendCode(SECRET, 'Alexhh'), email: crypto.randomUUID() + '@example.invalid', password, confirmPassword: password }, jar);
      assert.equal((await claim()).status, 201);
      assert.equal((await http('POST', '/api/auth/delete', { password }, jar)).status, 200);
      await pause(900);
      assert.equal(readJson(FILES.stats).Alexhh.bunos, 4, 'a legenda nyilvántartása megmaradt');
      assert.equal((await claim()).status, 201, 'a legenda újra igényelhető');
    });

    await test('Törlés: a böngészőből idegen eredetű vagy nem JSON kérés elutasítva (CSRF)', async () => {
      const jar = new Map();
      const c = await account('Csrf Teszt');
      const cross = await fetch(BASE + '/api/auth/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://rossz.example', Cookie: [...c.jar].map(([k, v]) => k + '=' + v).join('; ') }, body: JSON.stringify({ password }) });
      assert.equal(cross.status, 403);
      const form = await fetch(BASE + '/api/auth/delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Cookie: [...c.jar].map(([k, v]) => k + '=' + v).join('; ') }, body: 'password=' + encodeURIComponent(password) });
      assert.equal(form.status, 415);
      assert.equal((await http('GET', '/api/auth/status', undefined, c.jar)).data.user.username, 'Csrf Teszt', 'a fiók megvan');
      void jar;
    });

    await test('A szerver nem naplózott belső hibát, és az adatkérés / törlés nem szivárogtat e-mailt a naplóba', () => {
      assert.ok(!/HIBA a\(z\)|uncaughtException|unhandledRejection|A fiók-törlés utólagos takarítása hibázott/.test(stderr), stderr.slice(0, 500));
      assert.ok(!stderr.includes('example.invalid'));
    });
  } finally {
    for (const s of sockets) s.disconnect();
    child.kill();
    await pause(150);
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nAdatvédelem: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
