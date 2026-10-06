'use strict';

// ============================================================
// KAMU BÍRÓSÁG – napi küldetések
// Minden napra 3 küldetés jár (egy könnyű, egy közepes, egy nehéz). A kiválasztás a dátumból
// számolódik determinisztikus véletlennel, ezért:
//  - minden játékosnak ugyanaz a három küldetése van aznap,
//  - bármelyik napra (az egész évre előre is) kiszámolható, nem kell eltárolni,
//  - két egymást követő napon ugyanaz a küldetés nem ismétlődik, és a három küldetés
//    mindig különböző számlálót mér (nincs két "kört" mérő küldetés egy napra).
// A nap határa az Europe/Budapest éjfél.
// ============================================================

const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'quests.json'), 'utf8'));
const TIERS = DATA.szintek;
const BONUS = Number(DATA.bonusJutalom) || 0;

// A Budapest szerinti dátum "ÉÉÉÉ-HH-NN" alakban.
function budapestDate(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ts));
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// Kis, gyors, determinisztikus véletlenszám-generátor (mulberry32) és szöveg-hash.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A naptár a rögzített kezdőnaptól (EPOCH) sorban, determinisztikusan készül, és gyorsítótárba kerül:
// minden szinten a "legrégebben használt" küldetések közül sorsol (így egyenletesen forognak, és
// két egymást követő napon sosem ismétlődik ugyanaz), a három küldetés pedig különböző számlálót mér.
const EPOCH = '2026-01-01';
const schedule = [];
const lastUsed = new Map(); // küldetés-azonosító -> utolsó nap (a generálás állapota)

function dayIndex(date) {
  const [y, m, d] = date.split('-').map(Number);
  const [ey, em, ed] = EPOCH.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ey, em - 1, ed)) / 86400000);
}

function generateUpTo(index) {
  while (schedule.length <= index) {
    const n = schedule.length;
    const rand = rng(hash('kamu-birosag:' + n));
    const usedStats = new Set();
    const today = [];
    for (const tier of TIERS) {
      let pool = tier.kuldetesek.filter((c) => !usedStats.has(c.stat) && lastUsed.get(c.id) !== n - 1);
      if (!pool.length) pool = tier.kuldetesek.filter((c) => !usedStats.has(c.stat));
      if (!pool.length) pool = tier.kuldetesek;
      const age = (c) => (lastUsed.has(c.id) ? lastUsed.get(c.id) : -Infinity);
      const oldest = Math.min(...pool.map(age));
      const candidates = pool.filter((c) => age(c) === oldest);
      const pick = candidates[Math.floor(rand() * candidates.length)];
      lastUsed.set(pick.id, n);
      usedStats.add(pick.stat);
      today.push({ id: pick.id, tier: tier.id, tierName: tier.nev, stat: pick.stat, target: pick.target, text: pick.text, reward: tier.jutalom });
    }
    schedule.push(today);
  }
}

// A nap három küldetése: [{ id, tier, tierName, stat, target, text, reward }]
function questsForDate(date) {
  let index = dayIndex(date);
  if (index < 0) index = ((index % 365) + 365) % 365; // a kezdőnap előtti dátumokra is jár három küldetés
  generateUpTo(index);
  return schedule[index].map((c) => ({ ...c }));
}

// Az éjfélig hátralévő idő (ms) Budapest szerint: a következő nap kezdetéig.
function msUntilReset(ts = Date.now()) {
  const today = budapestDate(ts);
  // a következő nap kezdete: keressük meg a legkisebb t-t, ahol a dátum már a holnapi
  const tomorrow = addDays(today, 1);
  let lo = ts, hi = ts + 26 * 3600 * 1000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (budapestDate(mid) === tomorrow) hi = mid; else lo = mid;
  }
  return Math.max(0, hi - ts);
}

module.exports = { questsForDate, budapestDate, addDays, msUntilReset, BONUS, TIERS };
