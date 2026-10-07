'use strict';
// ============================================================
// KAMU BÍRÓSÁG – moderáció: házigazdai némítás, jelentés, automatikus elrejtés, üzemeltetői némítás
//   - csak a házigazda némíthat a szobában; a némítás a név újracsatlakozásával sem kerülhető meg, feloldható,
//   - üzenet jelenthető (szobai csevegő, közös tér): saját üzenet nem, ugyanaz a jelentő egyszer, jelentőnként korlátozva,
//   - a közös tér üzenete 3 különböző jelentő után automatikusan lekerül mindenkiről,
//   - az /admin oldalról a jelentett küldő időre némítható (a fiókost a fiókja, a vendéget a címe szerint),
//     a némítás újraindítás után is él; a kulcsok nem szivárognak ki.
// Valódi szerver (ideiglenes fájlokkal), valódi socket.io + HTTP kérésekkel.
// Futtatás: node test/moderation.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const io = require('socket.io-client');
const { createModeration, MAX_MUTE_MINUTES } = require('../moderation');

const root = path.resolve(__dirname, '..');
const PORT = 3196, BASE = 'http://127.0.0.1:' + PORT;
const TOKEN = crypto.randomBytes(24).toString('base64url');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-moderation-'));
const FILES = { accounts: path.join(tmp, 'accounts.json'), moderation: path.join(tmp, 'moderation.json') };
const sockets = [];
let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}

async function http(method, route, body, jar, headers = {}) {
  const h = { ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...headers };
  if (jar && jar.size) h.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const response = await fetch(BASE + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (jar) for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(';')[0], i = first.indexOf('=');
    if (first.slice(i + 1)) jar.set(first.slice(0, i), first.slice(i + 1)); else jar.delete(first.slice(0, i));
  }
  const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
  return { status: response.status, data, text };
}
const admin = (method, route, body) => http(method, '/api/admin' + route, body, null, { Authorization: 'Bearer ' + TOKEN });
const password = 'Egy hosszú titok 123!';
async function account(name) {
  const jar = new Map();
  const r = await http('POST', '/api/auth/register', { username: name, email: crypto.randomUUID() + '@example.invalid', password, confirmPassword: password }, jar);
  assert.equal(r.status, 201, 'regisztráció: ' + name);
  return { name, jar, id: r.data.user.id };
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
  s.gotFlags = []; s.gotRemoved = []; s.gotBoard = [];
  s.on('chat_flag', (p) => s.gotFlags.push(p)); s.on('board_remove', (p) => s.gotRemoved.push(p)); s.on('board_msg', (m) => s.gotBoard.push(m));
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}
async function identify(s, acct) {
  const ticket = (await http('POST', '/api/friends/ticket', {}, acct.jar)).data.ticket;
  return emit(s, 'identify', { ticket });
}
async function cleanup(keep = []) {
  for (const s of [...sockets]) if (!keep.includes(s)) { s.disconnect(); sockets.splice(sockets.indexOf(s), 1); }
  await pause(150);
}
const startServer = () => spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DATABASE_URL: '', ADMIN_TOKEN: TOKEN,
    MAX_ROOMS_PER_IP: '60', MAX_SOCKETS_PER_IP: '200', REPORTS_PER_10_MIN: '4',
    AUTH_STORE_PATH: FILES.accounts, KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_STATS_FILE: path.join(tmp, 'stats.json'),
    KB_DMS_FILE: path.join(tmp, 'dms.json'), KB_ERRORS_FILE: path.join(tmp, 'errors.json'), KB_MODERATION_FILE: FILES.moderation },
  stdio: ['ignore', 'ignore', 'pipe']
});
async function waitReady() {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch (_) { await pause(100); } }
  throw new Error('a szerver nem indult el');
}

async function unit() {
  await test('Moderációs tároló: jelentés összevonása, némítás lejárata és korlátja, a lista kulcsok nélkül', () => {
    let t = 1_000_000;
    const m = createModeration({ now: () => t });
    const a = m.report({ channel: 'board', msgId: 7, name: 'Rosszarc', text: 'sértés', reporter: 'Anna', reporterKey: 'u:a', senderKeys: ['u:0123456789abcdef-x', 'ip:0123456789abcdef'] });
    assert.equal(a.isNew, true); assert.equal(a.count, 1);
    assert.equal(m.report({ channel: 'board', msgId: 7, name: 'Rosszarc', text: 'sértés', reporter: 'Anna', reporterKey: 'u:a', senderKeys: ['u:0123456789abcdef-x'] }).added, false, 'ugyanaz a jelentő egyszer');
    assert.equal(m.report({ channel: 'board', msgId: 7, name: 'Rosszarc', text: 'sértés', reporter: 'Béla', reporterKey: 'u:b', senderKeys: ['u:0123456789abcdef-x'] }).count, 2);
    const listed = JSON.stringify(m.list());
    assert.ok(!listed.includes('0123456789abcdef') && !listed.includes('senderKeys'), 'a teljes kulcsok nem látszanak (csak rövid címke)');
    assert.equal(m.mute(999, 5), -1);
    assert.equal(m.mute(a.entry.id, 10), 2);
    assert.ok(m.mutedFor('0123456789abcdef-x', '') > 0, 'a fiókos küldő némított');
    assert.equal(m.mutedFor(null, '1.2.3.4'), 0, 'más vendég nem');
    t += 11 * 60 * 1000;
    assert.equal(m.mutedFor('0123456789abcdef-x', ''), 0, 'lejárt');
    m.mute(a.entry.id, 999999999);
    assert.ok(m.mutes()[0].minutesLeft <= MAX_MUTE_MINUTES, 'legfeljebb egy hétig');
  });
}

async function main() {
  await unit();
  let child = startServer(), stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  try {
    await waitReady();

    // ---------- házigazdai némítás ----------
    let code, hostToken;
    const host = await connect(), guest = await connect(), third = await connect();
    await test('Házigazdai némítás: csak a gazda némíthat, magát és botot nem; a némított nem írhat, a többiek igen', async () => {
      const created = await emit(host, 'create_room', { name: 'Gazda Mod', playerId: 'h1' });
      code = created.code; hostToken = created.sessionToken;
      const g = await emit(guest, 'join_room', { code, name: 'Vendeg Pista', playerId: 'g1' });
      assert.ok(g.state);
      assert.ok((await emit(third, 'join_room', { code, name: 'Harmadik Jatekos', playerId: 't1' })).state);
      assert.ok((await emit(guest, 'chat_send', { text: 'szia mindenkinek' })).ok);

      assert.match((await emit(guest, 'chat_mute', { playerId: 't1', muted: true })).error, /Csak a házigazda/);
      assert.match((await emit(host, 'chat_mute', { playerId: 'h1', muted: true })).error, /Érvénytelen/);
      assert.match((await emit(host, 'chat_mute', { playerId: 'nincs-ilyen', muted: true })).error, /Érvénytelen/);
      assert.match((await emit(host, 'chat_mute', { playerId: { $ne: 1 }, muted: true })).error, /Érvénytelen/);
      await emit(host, 'add_bot'); await pause(150);
      const botId = (await emit(host, 'join_room', { code, name: 'Gazda Mod', playerId: 'h1', sessionToken: hostToken })).state.players.find((p) => p.isBot).id;
      assert.match((await emit(host, 'chat_mute', { playerId: botId, muted: true })).error, /botok/);

      assert.deepEqual(await emit(host, 'chat_mute', { playerId: 'g1', muted: true }), { ok: true, muted: true });
      const state = (await emit(host, 'join_room', { code, name: 'Gazda Mod', playerId: 'h1', sessionToken: hostToken })).state;
      assert.equal(state.players.find((p) => p.id === 'g1').chatMuted, true, 'a némítás látszik a játékos-listában');
      assert.equal(state.players.find((p) => p.id === 't1').chatMuted, false);
      assert.match((await emit(guest, 'chat_send', { text: 'ezt már nem' })).error, /házigazda elnémított/);
      assert.ok((await emit(third, 'chat_send', { text: 'én még írhatok' })).ok);
    });

    await test('A házigazdai némítás a névvel együtt él (új azonosítóval visszalépve sem), és feloldható', async () => {
      await emit(guest, 'leave_room');
      const again = await emit(guest, 'join_room', { code, name: 'Vendeg Pista', playerId: 'g1-uj' });
      assert.ok(again.state, 'újra beléphet');
      assert.match((await emit(guest, 'chat_send', { text: 'másik azonosítóval' })).error, /elnémított/, 'a név szerinti némítás megmarad');
      assert.deepEqual(await emit(host, 'chat_mute', { playerId: 'g1-uj', muted: false }), { ok: true, muted: false });
      assert.ok((await emit(guest, 'chat_send', { text: 'feloldva, újra itt vagyok' })).ok);
    });

    // ---------- szobai jelentés ----------
    let rudeId;
    await test('Szobai jelentés: saját üzenet, ismeretlen azonosító és szobán kívüli jelentés elutasítva; az ismétlés nem számít; a szoba értesül', async () => {
      const sent = await emit(guest, 'chat_send', { text: 'sértő üzenet' });
      rudeId = sent.id;
      assert.match((await emit(guest, 'chat_report', { id: rudeId })).error, /saját üzenetedet/);
      assert.match((await emit(third, 'chat_report', { id: 99999 })).error, /már nem érhető el/);
      assert.match((await emit(third, 'chat_report', { id: '1' })).error, /már nem érhető el/);
      assert.match((await emit(await connect(), 'chat_report', { id: rudeId })).error, /Csak szobában/);
      const first = await emit(third, 'chat_report', { id: rudeId });
      assert.deepEqual(first, { ok: true, already: false });
      assert.deepEqual(await emit(third, 'chat_report', { id: rudeId }), { ok: true, already: true }, 'ugyanaz a jelentő egyszer');
      await pause(200);
      assert.ok(host.gotFlags.some((f) => f.id === rudeId && f.count === 1), 'a házigazda látja a jelzést');
      assert.ok(guest.gotFlags.some((f) => f.id === rudeId), 'a szoba minden tagja megkapja a jelzést');
    });

    // ---------- közös tér: jelentés, automatikus elrejtés ----------
    const anna = await account('Anna Jelento'), bela = await account('Bela Jelento'), cili = await account('Cili Jelento'), dora = await account('Dora Kuldo');
    const subs = [];
    await test('Közös tér: 3 különböző jelentő után az üzenet lekerül mindenkiről; saját üzenet nem jelenthető; a jelentés korlátos', async () => {
      const sA = await connect(), sB = await connect(), sC = await connect(), sD = await connect(), spy = await connect();
      await identify(sA, anna); await identify(sB, bela); await identify(sC, cili); await identify(sD, dora);
      for (const s of [sA, sB, sC, sD, spy]) { await emit(s, 'board_sub', {}); subs.push(s); }
      const msg = await emit(sD, 'board_send', { text: 'Valami nagyon sértő a közös térben' });
      assert.ok(msg.ok);
      await pause(150);
      assert.match((await emit(sD, 'board_report', { id: msg.id })).error, /saját üzenetedet/);
      assert.deepEqual(await emit(sA, 'board_report', { id: msg.id }), { ok: true, already: false, hidden: false });
      assert.deepEqual(await emit(sA, 'board_report', { id: msg.id }), { ok: true, already: true, hidden: false }, 'ugyanaz a jelentő egyszer');
      assert.deepEqual(await emit(sB, 'board_report', { id: msg.id }), { ok: true, already: false, hidden: false });
      assert.equal(spy.gotRemoved.length, 0, 'két jelentés még nem rejt el');
      assert.deepEqual(await emit(sC, 'board_report', { id: msg.id }), { ok: true, already: false, hidden: true });
      await pause(200);
      for (const s of [sA, sB, sC, sD, spy]) assert.deepEqual(s.gotRemoved.map((r) => r.id), [msg.id], 'mindenki értesül az eltávolításról');
      const late = await connect();
      assert.ok(!(await emit(late, 'board_sub', {})).msgs.some((m) => m.id === msg.id), 'a későn feliratkozó nem látja');
      assert.match((await emit(sA, 'board_report', { id: msg.id })).error, /már nem érhető el/);

      // jelentés-korlát (a tesztszerveren REPORTS_PER_10_MIN=4): Anna eddig 2 jelentést használt el (az ismétlés is számít),
      // a következő kettő megy, a harmadik már nem. Az üzeneteket külön kapcsolatokról küldjük, így nincs várakozás a közös tér üzenetei között.
      const results = [];
      for (let i = 0; i < 3; i++) {
        const sender = await connect();
        const m = await emit(sender, 'board_send', { text: 'üzenet ' + i + ' ' + crypto.randomUUID(), name: 'Vendeg Tomeg ' + i });
        assert.ok(m.ok, 'az üzenet elment');
        results.push((await emit(sA, 'board_report', { id: m.id })).error || 'ok');
        sender.disconnect();
      }
      assert.deepEqual(results.slice(0, 2), ['ok', 'ok']);
      assert.match(results[2], /Túl sok jelentés/, 'a korlát működik: ' + results.join(' | '));
    });

    // ---------- üzemeltetés ----------
    await cleanup([host, guest, third]);
    let spamReportId;
    await test('Admin: a jelentések listája a küldő nevével és szövegével, a belső kulcsok nélkül', async () => {
      const list = (await admin('GET', '/reports')).data;
      assert.ok(list.reports.length >= 3);
      assert.ok(list.reports.some((r) => r.channel === 'room' && r.name === 'Vendeg Pista' && r.text === 'sértő üzenet' && r.count === 1));
      const board = list.reports.find((r) => r.channel === 'board' && r.name === 'Dora Kuldo' && r.count >= 3);
      assert.ok(board, 'a közös-téri jelentés látszik');
      spamReportId = board.id;
      assert.ok(Array.isArray(board.reporters) && board.reporters.includes('Anna Jelento'));
      const text = JSON.stringify(list);
      assert.doesNotMatch(text, /senderKeys|"u:|ip:[0-9a-f]{16}/, 'a kulcsok nem szivárognak');
      assert.ok((await admin('GET', '/status')).data.reports.open >= 3);
      assert.equal((await http('GET', '/api/admin/reports')).status, 401, 'token nélkül nem');
    });

    await test('Admin némítás: a fiókost a fiókja, a vendéget a címe szerint állítja meg; a közös térre és a szobai csevegőre is; feloldható', async () => {
      assert.equal((await admin('POST', '/reports/mute', { id: 'x' })).status, 400);
      assert.equal((await admin('POST', '/reports/mute', { id: 424242, minutes: 5 })).status, 404);
      const r = await admin('POST', '/reports/mute', { id: spamReportId, minutes: 30 });
      assert.equal(r.status, 200); assert.equal(r.data.muted, 2, 'fiók- és címkulcs is');
      const dSock = await connect(); await identify(dSock, dora);
      assert.match((await emit(dSock, 'board_send', { text: 'újra próbálom' })).error, /némítva/, 'a fiókos küldő némított');
      const annaSock = await connect(); await identify(annaSock, anna);
      assert.ok((await emit(annaSock, 'board_send', { text: 'én nem vagyok némítva' })).ok, 'másik fiók ugyanarról a címről nem érintett');
      const guestSock = await connect();
      assert.match((await emit(guestSock, 'board_send', { text: 'vendégként is', name: 'Vendeg Kerulo' })).error, /némítva/, 'vendég ugyanarról a címről (megkerülés ellen) némított');
      // szobai csevegő is
      const room = await emit(dSock, 'create_room', { name: 'Dora Kuldo', playerId: 'dk' });
      assert.ok(room.code);
      assert.match((await emit(dSock, 'chat_send', { text: 'szobában' })).error, /némítva/);
      const muteList = (await admin('GET', '/reports')).data.mutes;
      assert.ok(muteList.length >= 1 && muteList[0].minutesLeft <= 30 && muteList[0].minutesLeft >= 28);
      assert.doesNotMatch(JSON.stringify(muteList), /"u:|ip:[0-9a-f]{16}/);
      // feloldás
      for (const mute of muteList) assert.equal((await admin('POST', '/mutes/remove', { id: mute.id })).status, 200);
      assert.equal((await admin('POST', '/mutes/remove', { id: 'nincs' })).status, 404);
      assert.ok((await emit(dSock, 'chat_send', { text: 'feloldva' })).ok);
      assert.ok((await emit(guestSock, 'board_send', { text: 'vendég újra', name: 'Vendeg Kerulo' })).ok);
    });

    await test('Admin: a közös-téri üzenet azonnal elrejthető, a szobai jelentésnél ez nem lehetséges; elvetés és törlés', async () => {
      const sub = await connect(); await emit(sub, 'board_sub', {});
      const sender = await connect();
      const msg = await emit(sender, 'board_send', { text: 'Elrejtendő ' + crypto.randomUUID(), name: 'Vendeg Hideme' });
      assert.ok(msg.ok);
      const reporter = await connect(); await identify(reporter, bela);
      await emit(reporter, 'board_sub', {});
      assert.equal((await emit(reporter, 'board_report', { id: msg.id })).ok, true);
      const rep = (await admin('GET', '/reports')).data.reports.find((r) => r.text.startsWith('Elrejtendő'));
      assert.deepEqual((await admin('POST', '/reports/hide', { id: rep.id })).data, { ok: true, hidden: true });
      await pause(200);
      assert.ok(sub.gotRemoved.some((r) => r.id === msg.id), 'a feliratkozók értesültek');
      const roomReport = (await admin('GET', '/reports')).data.reports.find((r) => r.channel === 'room');
      assert.equal((await admin('POST', '/reports/hide', { id: roomReport.id })).status, 409);
      assert.equal((await admin('POST', '/reports/dismiss', { id: rep.id })).status, 200);
      assert.equal((await admin('GET', '/reports')).data.reports.find((r) => r.id === rep.id).status, 'dismissed');
      assert.equal((await admin('POST', '/reports/clear', {})).status, 200);
      assert.deepEqual((await admin('GET', '/reports')).data.reports, []);
    });

    await test('A némítás újraindítás után is él (a lemezről / adatbázisból töltődik vissza)', async () => {
      const spamLine = await connect();
      const probe = await emit(spamLine, 'board_send', { text: 'ping ' + crypto.randomUUID(), name: 'Vendeg Maradok' });
      assert.ok(probe.ok);
      const rep = await emit(await connect().then(async (s) => { await identify(s, cili); return s; }), 'board_report', { id: probe.id });
      assert.ok(rep.ok);
      const id = (await admin('GET', '/reports')).data.reports.find((r) => r.name === 'Vendeg Maradok').id;
      assert.equal((await admin('POST', '/reports/mute', { id, minutes: 60 })).status, 200);
      await pause(1500); // a mentés késleltetett
      for (const s of sockets) s.disconnect();
      sockets.length = 0;
      child.kill(); await pause(500);
      child = startServer(); child.stderr.on('data', (d) => { stderr += d; });
      await waitReady();
      const after = await connect();
      assert.match((await emit(after, 'board_send', { text: 'újraindítás után', name: 'Vendeg Maradok' })).error, /némítva/);
    });

    await test('A szerver nem naplózott belső hibát, és a naplóban nincs e-mail', () => {
      assert.ok(!/HIBA a\(z\)|uncaughtException|unhandledRejection/.test(stderr), stderr.slice(0, 600));
      assert.ok(!stderr.includes('example.invalid'));
    });
  } finally {
    for (const s of sockets) s.disconnect();
    child.kill();
    await pause(200);
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nModeráció: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
