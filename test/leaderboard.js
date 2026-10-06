'use strict';
// ============================================================
// KAMU BÍRÓSÁG – ranglista (heti és összesített)
// - tiszta modul: sorrend, azonos értékek, heti szűrés, saját helyezés az élmezőnyön kívül,
// - a hét kezdete / a heti nullázás időpontja (hétfő 00:00 Budapest, nyári időszámításkor is),
// - HTTP-végpont egy előre feltöltött statisztikával (érvénytelen paraméterek, legenda-jelző, sebességkorlát),
// - egy valódi játék a heti számlálót is növeli.
// Futtatás: node test/leaderboard.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const io = require('socket.io-client');
const lb = require('../leaderboard');
const { weekStart, msUntilWeekReset, budapestDate } = require('../quests');

const root = path.resolve(__dirname, '..');
const PORT = 3192, BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-lb-'));
const STATS_FILE = path.join(tmp, 'stats.json');
let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}
const emit = (s, event, payload = {}) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('Ack timeout: ' + event)), 4000);
  s.emit(event, payload, (res) => { clearTimeout(t); resolve(res); });
});

async function main() {
  await test('A hét hétfőtől vasárnapig tart (Budapest szerinti dátum alapján)', async () => {
    assert.equal(weekStart('2026-10-05'), '2026-10-05', 'hétfő');
    assert.equal(weekStart('2026-10-07'), '2026-10-05', 'szerda');
    assert.equal(weekStart('2026-10-11'), '2026-10-05', 'vasárnap még ugyanaz a hét');
    assert.equal(weekStart('2026-10-12'), '2026-10-12', 'a következő hétfő új hét');
    assert.equal(weekStart('2027-01-01'), '2026-12-28', 'évhatáron át is');
    assert.equal(weekStart('2028-03-01'), '2028-02-28', 'szökőév');
  });

  await test('A heti nullázásig hátralévő idő a következő hétfő éjfélig számol (nyári időszámítás váltásakor is)', async () => {
    // 2026-10-25 vasárnap: a nyári időszámítás vége (01:00 UTC-kor 03:00 -> 02:00). 10:00 UTC = 11:00 CET, éjfél 23:00 UTC-kor -> 13 óra.
    const ms = msUntilWeekReset(Date.UTC(2026, 9, 25, 10, 0, 0));
    assert.ok(Math.abs(ms - 13 * 3600 * 1000) <= 1500, 'várt ~13 óra, kapott ' + ms);
    // hétfő reggel 08:00 CEST (06:00 UTC) -> még 6 nap 16 óra
    const monday = msUntilWeekReset(Date.UTC(2026, 9, 12, 6, 0, 0));
    assert.ok(Math.abs(monday - (6 * 24 + 16) * 3600 * 1000) <= 1500, 'hétfő reggel: ' + monday);
    assert.ok(msUntilWeekReset() > 0 && msUntilWeekReset() <= 7 * 86400 * 1000 + 3600 * 1000);
  });

  const week = '2026-10-05';
  const stats = {
    Anna: { pont: 120, gyozelem: 4, jatek: 9, artatlan: 3, kihivas: 5, weekly: { week, counts: { pont: 30, gyozelem: 1, jatek: 2 } } },
    Bela: { pont: 120, gyozelem: 6, jatek: 7, artatlan: 1, kihivas: 2, weekly: { week: '2026-09-28', counts: { pont: 999, jatek: 9 } } },
    Cili: { pont: 80, gyozelem: 2, jatek: 8, weekly: { week, counts: { pont: 55, gyozelem: 2, jatek: 3 } } },
    Dani: { pont: 0, gyozelem: 0, jatek: 3 },
    Eli: { pont: 80, gyozelem: 1, jatek: 4 },
    Frank: 'hibás adat',
    Gabi: { pont: -5, gyozelem: 'sok', jatek: 2 }
  };

  await test('Összesített lista: érték szerint csökkenő, azonos értéknél a kevesebb játékkal elért előz, egyenlők azonos helyezést kapnak', async () => {
    const r = lb.build(stats, { period: 'osszes', metric: 'pont', weekStart: week });
    assert.deepEqual(r.rows.map((x) => x.name + ':' + x.value), ['Bela:120', 'Anna:120', 'Eli:80', 'Cili:80']);
    assert.deepEqual(r.rows.map((x) => x.rank), [1, 1, 3, 3], 'az egyenlők azonos helyezést kapnak (1, 1, 3, 3)');
    assert.equal(r.total, 4, 'a nullás, hibás és negatív értékű nem szerepel');
    assert.equal(r.label, 'Összpontszám');
  });

  await test('Heti lista: csak az aktuális hét számai, a régi hét és a hiányzó adat nem számít', async () => {
    const r = lb.build(stats, { period: 'heti', metric: 'pont', weekStart: week });
    assert.deepEqual(r.rows.map((x) => x.name + ':' + x.value), ['Cili:55', 'Anna:30']);
    const next = lb.build(stats, { period: 'heti', metric: 'pont', weekStart: '2026-10-12' });
    assert.deepEqual(next.rows, [], 'új héten üres a lista (a ranglista nullázódik)');
    assert.deepEqual(lb.build(stats, { period: 'heti', metric: 'gyozelem', weekStart: week }).rows.map((x) => x.name), ['Cili', 'Anna']);
  });

  await test('Saját helyezés az élmezőnyön kívül is; érvénytelen időszak / mutató alapértékre esik; a lista korlátos', async () => {
    const many = {};
    for (let i = 0; i < 50; i++) many['J' + String(i).padStart(2, '0')] = { pont: 1000 - i, jatek: 1 };
    const r = lb.build(many, { period: 'osszes', metric: 'pont', me: 'J30' });
    assert.equal(r.rows.length, lb.LIMIT); assert.equal(r.total, 50);
    assert.deepEqual(r.me, { rank: 31, value: 970 });
    assert.equal(lb.build(many, { me: 'Nincs Ilyen' }).me, null);
    const bad = lb.build(many, { period: 'valami', metric: 'hamis' });
    assert.equal(bad.period, 'osszes'); assert.equal(bad.metric, 'pont');
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(lb.build(many, { metric: key }).metric, 'pont', key + ': nem mutató');
  });

  // ---------------- valódi szerver ----------------
  const today = budapestDate();
  const seeded = {
    'Kyrashi': { pont: 500, gyozelem: 10, jatek: 20, weekly: { week: weekStart(today), counts: { pont: 40, jatek: 3 } } },
    'Vendeg Egy': { pont: 200, gyozelem: 3, jatek: 8, weekly: { week: weekStart(today), counts: { pont: 90, jatek: 4 } } },
    'Regi Hetes': { pont: 900, gyozelem: 9, jatek: 9, weekly: { week: '2020-01-06', counts: { pont: 900, jatek: 9 } } }
  };
  fs.writeFileSync(STATS_FILE, JSON.stringify(seeded));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, KB_STATS_FILE: STATS_FILE,
      AUTH_STORE_PATH: path.join(tmp, 'accounts.json'), KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_DMS_FILE: path.join(tmp, 'dms.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; child.stderr.on('data', (d) => { errors += d; });
  const sockets = [];
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');
    const get = async (query) => { const r = await fetch(BASE + '/api/leaderboard' + query); return { status: r.status, data: await r.json() }; };

    await test('A végpont nyilvános, a heti és összesített listát adja, a legendát megjelöli, a régi hét nem számít', async () => {
      const all = await get('?period=osszes&metric=pont');
      assert.equal(all.status, 200);
      assert.deepEqual(all.data.rows.map((r) => r.name), ['Regi Hetes', 'Kyrashi', 'Vendeg Egy']);
      assert.equal(all.data.rows.find((r) => r.name === 'Kyrashi').legend, true, 'legenda-jelző');
      assert.equal(all.data.rows.find((r) => r.name === 'Vendeg Egy').legend, false);
      const heti = await get('?period=heti&metric=pont');
      assert.deepEqual(heti.data.rows.map((r) => r.name + ':' + r.value), ['Vendeg Egy:90', 'Kyrashi:40']);
      assert.equal(heti.data.weekStart, weekStart(today));
      assert.ok(heti.data.resetsInMs > 0 && heti.data.resetsInMs <= 7 * 86400000 + 3600000);
      assert.ok(heti.data.metrics.pont && heti.data.metrics.gyozelem);
      assert.ok(!JSON.stringify(all.data).includes('uid') && !JSON.stringify(all.data).includes('@'), 'belső adat nem szivárog');
    });

    await test('Érvénytelen paraméterek alapértékre esnek, a saját helyezés (me) megadható', async () => {
      const bad = await get('?period=%3Cx%3E&metric=__proto__');
      assert.equal(bad.status, 200); assert.equal(bad.data.period, 'osszes'); assert.equal(bad.data.metric, 'pont');
      const me = await get('?period=osszes&metric=pont&me=' + encodeURIComponent('Vendeg Egy'));
      assert.deepEqual(me.data.me, { rank: 3, value: 200 });
      assert.equal((await get('?me=' + 'x'.repeat(500))).status, 200, 'hosszú név nem dönti le');
    });

    await test('Egy valódi játék a heti és a napi számlálót is növeli', async () => {
      const host = io(BASE, { transports: ['websocket'], reconnection: false }); sockets.push(host);
      await new Promise((resolve, reject) => { host.once('connect', resolve); host.once('connect_error', reject); });
      const created = await emit(host, 'create_room', { name: 'Heti Jatekos', playerId: 'hj' });
      assert.ok(created.code);
      await emit(host, 'add_bot'); await emit(host, 'add_bot');
      const started = await emit(host, 'start_game', { settings: { modes: ['cs'], autoNextRound: false, autoNewGame: false } });
      assert.ok(!started.error, JSON.stringify(started));
      await pause(1500);
      const file = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      const rec = file['Heti Jatekos'];
      assert.ok(rec, 'a játékos statisztikája létrejött');
      assert.equal(rec.weekly.week, weekStart(today));
      assert.ok(rec.weekly.counts.korok >= 1, 'a heti számláló nő (kör)');
      assert.equal(rec.daily.date, today);
      host.disconnect();
    });

    await test('Sebességkorlát: percenként legfeljebb 60 kérés címenként', async () => {
      let last = 200;
      for (let i = 0; i < 70 && last === 200; i++) last = (await fetch(BASE + '/api/leaderboard')).status;
      assert.equal(last, 429);
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
  console.log('\nRanglista: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
