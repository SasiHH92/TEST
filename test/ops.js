'use strict';
// ============================================================
// KAMU BÍRÓSÁG – üzemeltetés: hibanapló, admin felület, böngészős hibajelentés, kézi jelszó-link
// A hibanapló egységtesztje + valódi szerver (ideiglenes fájlokkal) valódi HTTP-kérésekkel.
// Futtatás: node test/ops.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { createErrorLog, scrub, MAX_PER_KIND } = require('../errorlog');

const PORT = 3189, BASE = 'http://127.0.0.1:' + PORT;
const OFF_PORT = 3190, OFF_BASE = 'http://127.0.0.1:' + OFF_PORT;
const TOKEN = crypto.randomBytes(24).toString('base64url'); // csak ehhez a teszthez, véletlen
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-ops-'));
const children = [];
let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}

async function call(base, method, route, body, headers = {}) {
  const response = await fetch(base + route, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: base } : {}), ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
  return { status: response.status, data, text };
}
const admin = (method, route, body, token = TOKEN) => call(BASE, method, '/api/admin' + route, body, token ? { Authorization: 'Bearer ' + token } : {});

function start(port, base, name, extra) {
  const dir = path.join(tmp, name); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AUTH_BASE_URL: base, DATABASE_URL: '',
      AUTH_STORE_PATH: path.join(dir, 'accounts.json'), KB_AVATARS_FILE: path.join(dir, 'avatars.json'), KB_STATS_FILE: path.join(dir, 'stats.json'),
      KB_DMS_FILE: path.join(dir, 'dms.json'), KB_ERRORS_FILE: path.join(dir, 'errors.json'), ...extra },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  children.push(child);
  return { child, dir };
}
async function ready(base) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) return true; } catch (_) { await pause(100); } }
  return false;
}

async function main() {
  // ---------- hibanapló (egység) ----------
  await test('A szöveg tisztítása: e-mail, hosszú token és adatbázis-cím nem marad benne', () => {
    const s = scrub('hiba anna@example.invalid ' + 'A'.repeat(40) + ' postgresql://user:titok@host/db?sslmode=require vége');
    assert.ok(!s.includes('anna@'), s); assert.ok(!s.includes('AAAAAAAA'), s); assert.ok(!s.includes('titok'), s);
    assert.ok(s.includes('<e-mail>') && s.includes('<token>') && s.includes('<adatbázis-cím>'));
    assert.equal(scrub('ab '.repeat(300), 50).length, 50);
  });

  await test('Azonos hiba egy bejegyzésbe vonódik (darabszám, első/utolsó), a különböző külön marad', () => {
    let clock = 1000;
    const log = createErrorLog({ now: () => clock });
    const boom = () => new Error('Baj van'); // ugyanaz a dobási hely → ugyanaz a bejegyzés
    log.record('socket', boom(), { event: 'vote_verdict' });
    clock = 2000;
    log.record('socket', boom(), { event: 'vote_verdict' });
    log.record('http', new Error('Más baj'));
    const list = log.list();
    assert.equal(list.length, 2);
    const first = list.find((e) => e.message === 'Baj van');
    assert.equal(first.count, 2); assert.equal(first.first, 1000); assert.equal(first.last, 2000);
    assert.equal(first.ctx.event, 'vote_verdict');
    assert.equal(log.summary().total, 3);
    assert.equal(log.summary().byKind.socket, 2);
  });

  await test('Fajtánként legfeljebb a limit marad; a legrégebbi esik ki', () => {
    let clock = 0;
    const log = createErrorLog({ now: () => ++clock, maxPerKind: 5 });
    for (let i = 0; i < 8; i++) log.record('client', { message: 'hiba ' + i });
    log.record('server', new Error('szerver'));
    const msgs = log.list().filter((e) => e.kind === 'client').map((e) => e.message);
    assert.equal(msgs.length, 5);
    assert.ok(!msgs.includes('hiba 0') && msgs.includes('hiba 7'));
    assert.ok(log.list().some((e) => e.kind === 'server'), 'a másik fajtát nem szorítja ki');
    assert.ok(MAX_PER_KIND >= 20);
  });

  await test('Soha nem dob: furcsa bemenetek, körkörös ctx, ismeretlen fajta', () => {
    const log = createErrorLog();
    const loop = {}; loop.self = loop;
    for (const v of [undefined, null, 0, '', {}, [], loop, Symbol.iterator.toString()]) assert.doesNotThrow(() => log.record('server', v, loop));
    assert.doesNotThrow(() => log.record('nincs-ilyen-fajta', new Error('x')));
    assert.equal(log.list().find((e) => e.message === 'x').kind, 'server');
  });

  await test('Mentés fájlba és visszatöltés; törlés kiüríti; sérült fájl nem dönt le', async () => {
    const file = path.join(tmp, 'unit-errors.json');
    let pushes = 0;
    const log = createErrorLog({ file, saveDelayMs: 5, persist: () => { pushes++; } });
    log.record('server', new Error('megmarad'));
    await pause(60);
    assert.ok(pushes >= 1, 'az adatbázis-feltöltés is megkapta');
    assert.ok(!fs.readFileSync(file, 'utf8').includes('@'), 'nincs titok a fájlban');
    const again = createErrorLog({ file });
    assert.equal(again.list()[0].message, 'megmarad');
    again.clear();
    assert.equal(createErrorLog({ file }).list().length, 0);
    fs.writeFileSync(file, '{nem json');
    assert.equal(createErrorLog({ file }).list().length, 0);
  });

  // ---------- admin + böngészős jelentés (valódi szerver) ----------
  const on = start(PORT, BASE, 'on', { ADMIN_TOKEN: TOKEN });
  let stderr = ''; on.child.stderr.on('data', (d) => { stderr += d; });
  const off = start(OFF_PORT, OFF_BASE, 'off', { ADMIN_TOKEN: 'rovid' }); // túl rövid → kikapcsolva
  try {
    assert(await ready(BASE) && await ready(OFF_BASE), 'a szerverek elindultak');

    await test('Rövid vagy hiányzó ADMIN_TOKEN esetén az admin felület 404', async () => {
      assert.equal((await call(OFF_BASE, 'GET', '/api/admin/status', undefined, { Authorization: 'Bearer rovid' })).status, 404);
      assert.equal((await call(OFF_BASE, 'GET', '/api/admin/errors')).status, 404);
    });

    await test('Admin: token nélkül és rossz tokennel 401, jó tokennel megy', async () => {
      assert.equal((await admin('GET', '/status', undefined, '')).status, 401);
      assert.equal((await admin('GET', '/status', undefined, 'nem-ez-a-token-de-hosszu-elég-lesz')).status, 401);
      const ok = await admin('GET', '/status');
      assert.equal(ok.status, 200);
      assert.equal(ok.data.database, false);
      assert.equal(ok.data.backups.count, 0);
      assert.equal(ok.data.mail.configured, false);
      assert.equal(ok.data.errors.total, 0);
      assert.ok(ok.data.uptimeSeconds >= 0);
    });

    await test('Az /admin oldal kiszolgálódik, és nem indexelhető', async () => {
      const r = await call(BASE, 'GET', '/admin');
      assert.equal(r.status, 200);
      assert.match(r.text, /noindex/); assert.match(r.text, /ADMIN_TOKEN/);
      assert.ok(!r.text.includes(TOKEN), 'a token nincs az oldalban');
    });

    await test('Böngészős hibajelentés: bekerül a naplóba tisztítva, összevonva, e-mail nélkül', async () => {
      const send = (message) => call(BASE, 'POST', '/api/client-error', { message, src: 'https://x.hu/client.js?v=1#a', line: 42 }, { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
      assert.equal((await send('TypeError: nem jó, címzett: lili@example.invalid')).status, 204);
      assert.equal((await send('TypeError: nem jó, címzett: lili@example.invalid')).status, 204);
      const list = (await admin('GET', '/errors')).data.errors;
      assert.equal(list.length, 1);
      assert.equal(list[0].kind, 'client'); assert.equal(list[0].count, 2);
      assert.ok(!JSON.stringify(list).includes('lili@'), 'az e-mail kimaradt');
      assert.equal(list[0].ctx.device, 'iOS'); assert.equal(list[0].ctx.line, '42');
      assert.ok(!list[0].ctx.src.includes('?') && !list[0].ctx.src.includes('https'), list[0].ctx.src);
    });

    await test('Böngészős hibajelentés: üres / hibás kérés elutasítva, hibás JSON 400', async () => {
      assert.equal((await call(BASE, 'POST', '/api/client-error', { message: '' })).status, 400);
      assert.equal((await call(BASE, 'POST', '/api/client-error', { nincs: 1 })).status, 400);
      assert.equal((await call(BASE, 'POST', '/api/client-error', '{rossz json')).status, 400);
      assert.equal((await call(BASE, 'POST', '/api/client-error', { message: 'x'.repeat(5000) })).status, 400, 'túl nagy törzs');
    });

    await test('Hibanapló törlése', async () => {
      assert.equal((await admin('POST', '/errors/clear', {})).status, 200);
      assert.equal((await admin('GET', '/errors')).data.errors.length, 0);
    });

    await test('Mentések adatbázis nélkül: üres lista, kézi mentés 409 (nem hiba)', async () => {
      const list = await admin('GET', '/backups');
      assert.equal(list.status, 200); assert.equal(list.data.database, false); assert.deepEqual(list.data.backups, []);
      assert.equal((await admin('POST', '/backups', {})).status, 409);
    });

    await test('Levélpróba beállítás nélkül 503, hibás cím 400 – kulcs nem szivárog', async () => {
      const r = await admin('POST', '/mail-test', { to: 'valaki@example.invalid' });
      assert.equal(r.status, 503); assert.match(r.data.error, /AUTH_MAIL_API_KEY/);
      assert.equal((await admin('POST', '/mail-test', { to: 'nem-email' })).status, 503, 'előbb a beállítás hiánya');
    });

    await test('Kézi jelszó-link: a játékos új jelszóval be tud lépni, a link egyszer használható', async () => {
      const email = crypto.randomUUID() + '@example.invalid', pw = 'Egy hosszú titok 123!', pw2 = 'Egy másik hosszú titok 456!';
      const reg = await call(BASE, 'POST', '/api/auth/register', { username: 'Ops Teszt', email, password: pw, confirmPassword: pw });
      assert.equal(reg.status, 201);
      assert.equal((await admin('POST', '/reset-link', { email: 'nincs@example.invalid' })).status, 404);
      assert.equal((await admin('POST', '/reset-link', { email: 'rossz' })).status, 400);
      const r = await admin('POST', '/reset-link', { email });
      assert.equal(r.status, 200); assert.equal(r.data.username, 'Ops Teszt'); assert.equal(r.data.expiresInMinutes, 60);
      const url = new URL(r.data.link);
      assert.equal(url.origin, BASE); assert.match(url.hash, /^#reset=[A-Za-z0-9_-]{43}$/);
      const token = url.hash.slice(7);
      const done = await call(BASE, 'POST', '/api/auth/reset', { token, password: pw2, confirmPassword: pw2 });
      assert.equal(done.status, 200);
      assert.equal((await call(BASE, 'POST', '/api/auth/reset', { token, password: pw2, confirmPassword: pw2 })).status, 400, 'egyszer használható');
      assert.equal((await call(BASE, 'POST', '/api/auth/login', { email, password: pw })).status, 401, 'a régi jelszó nem jó');
      assert.equal((await call(BASE, 'POST', '/api/auth/login', { email, password: pw2 })).status, 200);
    });

    await test('Böngészős hibajelentés sebességkorlát (percenként 8)', async () => {
      let limited = 0;
      for (let i = 0; i < 12; i++) if ((await call(BASE, 'POST', '/api/client-error', { message: 'korlát ' + i })).status === 429) limited++;
      assert.ok(limited >= 3, 'a korlát működik (' + limited + ')');
    });

    await test('Rossz tokennel 10 próba után 429, a jó token sem enged be ideiglenesen', async () => {
      let last = 0;
      for (let i = 0; i < 12; i++) last = (await admin('GET', '/status', undefined, 'hibas-token-' + i + '-nem-jo-semmire')).status;
      assert.equal(last, 429);
      assert.equal((await admin('GET', '/status')).status, 429);
    });

    await test('A szerver stderr-jén nincs a token, a jelszó vagy az e-mail', () => {
      assert.ok(!stderr.includes(TOKEN)); assert.ok(!stderr.includes('example.invalid')); assert.ok(!stderr.includes('hosszú titok'));
    });
  } finally {
    for (const c of children) c.kill();
    await pause(150);
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nÜzemeltetés: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
