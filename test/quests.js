'use strict';
// ============================================================
// KAMU BÍRÓSÁG – napi küldetések: logikateszt
// 1) Minden napra pontosan 3 küldetés jár (egy könnyű, egy közepes, egy nehéz), 365 napra előre is
// 2) A három küldetés különböző számlálót mér, és két egymást követő napon nem ismétlődik
// 3) Determinisztikus (ugyanaz a nap mindig ugyanazt adja) és egyenletesen forog
// 4) A dátumkezelés: Budapest szerinti nap, napok hozzáadása hónap-/évhatáron át
// Futtatás: node test/quests.js
// ============================================================

const assert = require('assert/strict');
const { questsForDate, budapestDate, addDays, msUntilReset, TIERS } = require('../quests');

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  OK  ' + name); }
  catch (e) { console.log('  HIBA ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

const START = '2026-10-07';
const STATS = ['jatek', 'korok', 'pont', 'gyozelem', 'vadlott', 'bunos', 'artatlan', 'ugyesz', 'ugyeszSiker', 'vedo', 'vedoSiker', 'biro', 'tanu', 'kihivas', 'dijak'];

console.log('1) Minden napra 3 küldetés (730 nap)');
check('minden nap pontosan 3 küldetés: könnyű, közepes, nehéz', () => {
  for (let i = 0; i < 730; i++) {
    const d = addDays(START, i);
    const qs = questsForDate(d);
    assert.equal(qs.length, 3, d + ': ' + qs.length + ' küldetés');
    assert.deepEqual(qs.map((q) => q.tier), TIERS.map((t) => t.id), d + ': szintek');
  }
});
check('minden küldetésnek van szövege, teljesíthető célja és jutalma', () => {
  for (let i = 0; i < 365; i++) {
    for (const q of questsForDate(addDays(START, i))) {
      assert.ok(q.text && q.text.length > 5, q.id + ' szövege');
      assert.ok(Number.isInteger(q.target) && q.target >= 1 && q.target <= 40, q.id + ' célja');
      assert.ok(q.reward >= 40, q.id + ' jutalma');
      assert.ok(STATS.includes(q.stat), q.id + ' ismeretlen számlálót mér: ' + q.stat);
    }
  }
});
check('a jutalom szintenként nő (könnyű < közepes < nehéz)', () => {
  const qs = questsForDate(START);
  assert.ok(qs[0].reward < qs[1].reward && qs[1].reward < qs[2].reward);
});

console.log('2) Változatosság');
check('a három küldetés különböző számlálót mér', () => {
  for (let i = 0; i < 730; i++) {
    const qs = questsForDate(addDays(START, i));
    assert.equal(new Set(qs.map((q) => q.stat)).size, 3, addDays(START, i));
  }
});
check('két egymást követő napon nem ismétlődik ugyanaz a küldetés', () => {
  for (let i = 1; i < 730; i++) {
    const a = questsForDate(addDays(START, i - 1)).map((q) => q.id);
    const b = questsForDate(addDays(START, i)).map((q) => q.id);
    for (const id of b) assert.ok(!a.includes(id), addDays(START, i) + ': ' + id);
  }
});
check('egyenletes forgás: minden küldetés kb. ugyanannyiszor jön (365 napon belül)', () => {
  const count = new Map();
  for (let i = 0; i < 365; i++) for (const q of questsForDate(addDays(START, i))) count.set(q.id, (count.get(q.id) || 0) + 1);
  const total = TIERS.reduce((s, t) => s + t.kuldetesek.length, 0);
  assert.equal(count.size, total, 'mind a ' + total + ' küldetés előfordul az évben');
  const values = [...count.values()];
  assert.ok(Math.max(...values) - Math.min(...values) <= 3, 'legfeljebb 3 különbség: ' + Math.min(...values) + '–' + Math.max(...values));
});

console.log('3) Determinisztikus');
check('ugyanaz a nap mindig ugyanazt adja, a lekérési sorrendtől függetlenül', () => {
  const a = JSON.stringify(questsForDate('2027-03-15'));
  questsForDate('2028-01-01'); questsForDate('2026-10-08'); // más sorrendben lekérve is
  assert.equal(JSON.stringify(questsForDate('2027-03-15')), a);
});
check('a visszaadott lista módosítása nem rontja el a naptárat', () => {
  const qs = questsForDate(START);
  qs[0].reward = 99999; qs.pop();
  const again = questsForDate(START);
  assert.equal(again.length, 3);
  assert.ok(again[0].reward < 1000);
});
check('a kezdőnap előtti dátumra is jár 3 küldetés', () => {
  assert.equal(questsForDate('2025-06-01').length, 3);
});

console.log('4) Dátumkezelés');
check('addDays: hónap- és évhatáron át, szökőévben is', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(addDays('2026-10-07', 365), '2027-10-07');
});
check('budapestDate: a Budapest szerinti nap (nyári és téli idő szerint)', () => {
  assert.equal(budapestDate(Date.UTC(2026, 6, 1, 21, 59, 0)), '2026-07-01'); // nyáron UTC+2: 23:59
  assert.equal(budapestDate(Date.UTC(2026, 6, 1, 22, 0, 0)), '2026-07-02');  // éjfél
  assert.equal(budapestDate(Date.UTC(2026, 0, 15, 22, 59, 0)), '2026-01-15'); // télen UTC+1: 23:59
  assert.equal(budapestDate(Date.UTC(2026, 0, 15, 23, 0, 0)), '2026-01-16');
});
check('msUntilReset: az éjfélig hátralévő idő pontos', () => {
  const t = Date.UTC(2026, 6, 1, 21, 0, 0); // 23:00 Budapest
  const ms = msUntilReset(t);
  assert.ok(Math.abs(ms - 3600 * 1000) <= 1000, 'körülbelül 1 óra: ' + ms);
});

console.log('\n' + passed + ' ellenőrzés sikeres' + (process.exitCode ? ' (VAN HIBÁS)' : '') + '.');
if (!process.exitCode) console.log('ÖSSZES ALTERSZT ZÖLD ✔');
