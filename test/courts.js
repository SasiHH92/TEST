'use strict';
// ============================================================
// KAMU BÍRÓSÁG – tárgyalás-munkamenetek: állapotgép, sorsolás, egyidejűség, tartós tárolás, Discord-kapcsolat
// (courts.js, szerver nélkül). Futtatás: node test/courts.js
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCourts, CourtError } = require('../courts');

let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof CourtError && e.code === code, 'várt hibakód: ' + code);

const host = { userId: 'u-host', name: 'Host', via: 'web' };
const user = (n) => ({ userId: 'u' + n, name: 'Játékos' + n, via: 'discord' });
function fill(c, id, n) { for (let i = 1; i <= n; i++) c.join(id, user(i)); }

(async () => {
  await test('létrehozás: azonosító, WAITING, a vezető jelentkező; ugyanarra a szobára nem készül második', () => {
    const c = createCourts();
    const r = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'ab12' });
    assert.match(r.session.id, /^KAMU-\d+$/);
    assert.equal(r.session.status, 'WAITING');
    assert.equal(r.session.roomCode, 'AB12');
    assert.equal(r.session.participants.length, 1);
    const again = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'AB12' });
    assert.equal(again.already, true);
    assert.equal(again.session.id, r.session.id);
    throwsCode(() => c.create({ hostUserId: 'x', hostName: 'x', roomCode: '!' }), 'bad_room');
  });

  await test('jelentkezés: duplikáció nem számít, teltház elutasít, lezárás után nincs belépés', () => {
    const c = createCourts();
    const { session: s } = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'AAAA' });
    c.join(s.id, user(1));
    assert.equal(c.join(s.id, user(1)).already, true);
    assert.equal(c.get(s.id).participants.length, 2);
    fill(c, s.id, 7); // összesen 8
    assert.equal(c.get(s.id).participants.length, 8);
    throwsCode(() => c.join(s.id, user(99)), 'full');
    const c2 = createCourts();
    const t = c2.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'BBBB' }).session;
    c2.lock(t.id, host);
    throwsCode(() => c2.join(t.id, user(1)), 'closed_signup');
    c2.unlock(t.id, host);
    c2.join(t.id, user(1));
  });

  await test('jogosultság: sorsolni/indítani csak a vezető vagy a stáb tud; a játékos nem', () => {
    const c = createCourts();
    const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'CCCC' }).session.id;
    fill(c, id, 3);
    throwsCode(() => c.draw(id, user(1)), 'forbidden');
    throwsCode(() => c.cancel(id, user(1)), 'forbidden');
    c.draw(id, { userId: 'u2', staff: true }); // a stáb (a bot állítja, szolgáltatás-hitelesítés mögött) sorsolhat
    assert.equal(c.get(id).status, 'READY');
  });

  await test('sorsolás: kevés játékos elutasítva; 3/4/5/8 főnél a szerepkészlet helyes és egyedi', () => {
    for (const [n, expect] of [[3, { judge: 1, prosecutor: 1, defendant: 1 }], [4, { judge: 1, prosecutor: 1, defendant: 1, witness: 1 }],
      [5, { judge: 1, prosecutor: 1, defendant: 1, defender: 1, witness: 1 }], [8, { judge: 1, prosecutor: 1, defendant: 1, defender: 1, witness: 1, juror: 3 }]]) {
      const c = createCourts();
      const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'DDDD' }).session.id;
      if (n === 3) throwsCode(() => c.draw(id, host), 'too_few');
      fill(c, id, n - 1);
      const r = c.draw(id, host).session;
      const counts = {};
      for (const p of r.participants) counts[p.role] = (counts[p.role] || 0) + 1;
      assert.deepEqual(counts, expect.juror === undefined && n === 3 ? { ...expect } : expect, 'n=' + n);
      assert.ok(r.participants.every((p) => p.role && p.roleLabel));
    }
  });

  await test('sorsolás idempotens: a második hívás nem sorsol újra; force igen', () => {
    const c = createCourts();
    const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'EEEE' }).session.id;
    fill(c, id, 5);
    const a = c.draw(id, host).session;
    const b = c.draw(id, host);
    assert.equal(b.already, true);
    assert.deepEqual(b.session.participants.map((p) => p.role), a.participants.map((p) => p.role));
    assert.equal(b.session.version, a.version, 'a verzió nem nő');
    const forced = c.draw(id, host, { force: true }).session;
    assert.equal(forced.status, 'READY');
    assert.equal(forced.version, a.version + 1);
  });

  await test('egyidejűség: ugyanaz a requestId egyszer hajtódik végre; két vezető-kattintás egy sorsolás', () => {
    const c = createCourts();
    const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'FFFF' }).session.id;
    fill(c, id, 4);
    const r1 = c.draw(id, host, {}, 'req-1');
    const r2 = c.draw(id, host, {}, 'req-1');
    assert.equal(r2.replay, true);
    assert.deepEqual(r2.session, r1.session);
    const staff = { userId: 'x', staff: true };
    const r3 = c.draw(id, staff); // "egyszerre" érkező második sorsolás
    assert.equal(r3.already, true);
    assert.equal(c.get(id).version, r1.session.version);
    // nagy tömegű egyidejű jelentkezés: soha nem lépi túl a létszámot, és nincs duplikáció
    const c2 = createCourts();
    const id2 = c2.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'GGGG' }).session.id;
    let ok = 0, full = 0;
    for (let i = 0; i < 40; i++) { try { c2.join(id2, user(i % 20)); ok++; } catch (e) { if (e.code === 'full') full++; else throw e; } }
    const ps = c2.get(id2).participants;
    assert.equal(ps.length, 8);
    assert.equal(new Set(ps.map((p) => p.uid)).size, 8);
    assert.ok(full > 0 && ok > 0);
  });

  await test('indítás: csak sorsolt tárgyalás indul; kétszer nem indul; játék végén FINISHED; utána nincs módosítás', () => {
    const c = createCourts();
    const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'HHHH' }).session.id;
    fill(c, id, 4);
    throwsCode(() => c.begin(id, host), 'not_ready');
    c.draw(id, host);
    assert.equal(c.begin(id, host).session.status, 'IN_PROGRESS');
    assert.equal(c.begin(id, host).already, true);
    throwsCode(() => c.draw(id, host, { force: true }), 'in_progress');
    throwsCode(() => c.leave(id, user(1)), 'in_progress');
    assert.equal(c.finish(id, host).session.status, 'FINISHED');
    assert.equal(c.finish(id, host).already, true);
    throwsCode(() => c.cancel(id, host), 'closed');
    throwsCode(() => c.join(id, user(9)), 'closed');
  });

  await test('kilépés sorsolás után érvényteleníti a szerepeket (vissza WAITING)', () => {
    const c = createCourts();
    const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'JJJJ' }).session.id;
    fill(c, id, 4);
    c.draw(id, host);
    const r = c.leave(id, user(2)).session;
    assert.equal(r.status, 'WAITING');
    assert.ok(r.participants.every((p) => !p.role));
    throwsCode(() => c.leave(id, host), 'host_leave');
  });

  await test('szoba-visszajelzések: a játékmotor indulása/vége állítja az állapotot, sorsolás nélkül is', () => {
    const c = createCourts();
    const a = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'KKKK' }).session.id;
    c.roomStarted('KKKK');
    assert.equal(c.get(a).status, 'IN_PROGRESS');
    c.roomFinished('KKKK');
    assert.equal(c.get(a).status, 'FINISHED');
    assert.equal(c.forRoom('KKKK'), null, 'lezárt tárgyalás nem "élő"');
    const b = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'LLLL' }).session.id;
    c.roomGone('LLLL'); // jelentkezési szakaszban a szoba megszűnése nem zárja le (újrakötés lehetséges)
    assert.equal(c.get(b).status, 'WAITING');
    assert.equal(c.rebind(b, host, 'MMMM').session.roomCode, 'MMMM');
    const d = c.create({ hostUserId: 'other', hostName: 'O', roomCode: 'NNNN' }).session.id;
    throwsCode(() => c.rebind(d, { userId: 'other' }, 'MMMM'), 'room_taken');
    c.roomStarted('NNNN'); c.roomGone('NNNN');
    assert.equal(c.get(d).status, 'CANCELLED');
  });

  await test('fairség: a korábban sokat szerepet kapó játékos ritkábban kapja ugyanazt', () => {
    const c = createCourts();
    let judgeCounts = {};
    for (let round = 0; round < 40; round++) {
      const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'P' + String(round).padStart(3, '0') }).session.id;
      fill(c, id, 4); // 5 játékos: host + u1..u4
      const r = c.draw(id, host).session;
      c.begin(id, host);
      const judge = r.participants.find((p) => p.role === 'judge').uid;
      judgeCounts[judge] = (judgeCounts[judge] || 0) + 1;
      c.finish(id, host);
    }
    const counts = Object.values(judgeCounts);
    assert.equal(counts.length, 5, 'mindenki bíró volt');
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'egyenletes eloszlás: ' + JSON.stringify(judgeCounts));
  });

  await test('tartósság: újraindítás után minden visszatölt (jelentkezők, szerepek, panel-azonosító, kapcsolatok)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-courts-'));
    const file = path.join(dir, 'courts.json');
    const c = createCourts({ file });
    const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'QQQQ' }).session.id;
    fill(c, id, 3);
    c.draw(id, host);
    c.setDiscordPanel(id, { guildId: '111111', channelId: '222222', messageId: '333333' });
    c.markAnnounced(id, 'x');
    const { code } = c.createLinkCode('u1');
    c.consumeLinkCode(code, '555555', 'anna');
    c.saveNow();
    const c2 = createCourts({ file }); // "újraindítás"
    const v = c2.getForBot(id);
    assert.equal(v.status, 'READY');
    assert.equal(v.participants.length, 4);
    assert.ok(v.participants.every((p) => p.role));
    assert.equal(v.discord.messageId, '333333');
    assert.deepEqual(v.discord.announced, ['x']);
    assert.equal(v.participants.find((p) => p.uid === 'u1').discordUserId, '555555');
    assert.equal(c2.userOfDiscord('555555'), 'u1');
    assert.equal(fs.statSync(file).size > 10, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('fiók-összekötés: egyszer használatos, lejáró kód; más fiók nem foglalhatja le a Discordot', () => {
    let t = 1000000;
    const c = createCourts({ now: () => t });
    const { code, expiresAt } = c.createLinkCode('userA');
    assert.equal(code.length, 8);
    assert.ok(expiresAt - t <= 10 * 60 * 1000 + 5);
    throwsCode(() => c.consumeLinkCode('NINCSILYEN', '12345678', 'x'), 'bad_code');
    c.consumeLinkCode(code, '12345678', 'Anna');
    throwsCode(() => c.consumeLinkCode(code, '12345678', 'Anna'), 'bad_code'); // már felhasználva
    assert.equal(c.linkOfUser('userA').discordUserId, '12345678');
    // másik fiók ugyanazt a Discordot nem kötheti magához
    const b = c.createLinkCode('userB');
    throwsCode(() => c.consumeLinkCode(b.code, '12345678', 'Anna'), 'discord_taken');
    // lejárt kód
    const d = c.createLinkCode('userB');
    t += 11 * 60 * 1000;
    throwsCode(() => c.consumeLinkCode(d.code, '999999', 'B'), 'bad_code');
    // a username csak címke: a Discord ID az azonosító; új kód új Discordot ad ugyanannak a fióknak (egy fiók – egy Discord)
    const e = c.createLinkCode('userA');
    c.consumeLinkCode(e.code, '77777777', 'Anna2');
    assert.equal(c.userOfDiscord('12345678'), null);
    assert.equal(c.linkOfUser('userA').discordUserId, '77777777');
    assert.equal(c.unlink('userA'), true);
    assert.equal(c.linkOfUser('userA'), null);
    throwsCode(() => c.consumeLinkCode('x', 'nem-szam', 'x'), 'bad_discord');
  });

  await test('OAuth-os Discord-belépés is kapcsolatnak számít (resolveDiscordId)', () => {
    const c = createCourts({ resolveDiscordId: (uid) => (uid === 'oauthUser' ? '424242424' : null) });
    assert.equal(c.linkOfUser('oauthUser').discordUserId, '424242424');
    assert.equal(c.linkOfUser('oauthUser').oauth, true);
    const id = c.create({ hostUserId: 'oauthUser', hostName: 'O', roomCode: 'RRRR' }).session.id;
    assert.equal(c.getForBot(id).participants[0].discordUserId, '424242424');
  });

  await test('fiók-törlés: kapcsolat és jelentkezés megszűnik, a saját tárgyalás lemondva', () => {
    const c = createCourts();
    const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'SSSS' }).session.id;
    fill(c, id, 2);
    c.purgeUser('u1');
    assert.equal(c.get(id).participants.some((p) => p.uid === 'u1'), false);
    c.purgeUser(host.userId);
    assert.equal(c.get(id).status, 'CANCELLED');
  });

  await test('események: létrehozás, jelentkezés, sorsolás, indítás, vége', async () => {
    const c = createCourts();
    const seen = [];
    c.events.on('event', (e) => seen.push(e.type));
    const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'TTTT' }).session.id;
    fill(c, id, 2);
    c.draw(id, host); c.begin(id, host); c.finish(id, host);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(seen, ['COURT_SESSION_CREATED', 'PLAYER_JOINED', 'PLAYER_JOINED', 'ROLES_ASSIGNED', 'SESSION_STARTED', 'SESSION_FINISHED']);
  });

  await test('elavult tárgyalás lejár; a bot a friss lezártat is látja a takarításhoz', () => {
    let t = 5000;
    const c = createCourts({ now: () => t, staleMs: 1000 });
    const id = c.create({ hostUserId: host.userId, hostName: 'Host', roomCode: 'UUUU' }).session.id;
    t += 2000;
    assert.equal(c.expireStale(), 1);
    assert.equal(c.get(id).status, 'CANCELLED');
    c.setDiscordPanel(id, { guildId: '1', channelId: '2', messageId: '3' });
    assert.equal(c.listForBot().length, 1, 'panel lezárására vár');
    c.markAnnounced(id, 'closed:CANCELLED');
    assert.equal(c.listForBot().length, 0);
  });

  console.log(`\n${passed} sikeres, ${failed} sikertelen`);
  process.exit(failed ? 1 : 0);
})();
