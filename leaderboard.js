'use strict';

// ============================================================
// KAMU BÍRÓSÁG – ranglista (heti és összesített)
// A játékosok számai név szerint a statisztikában élnek (STATS: név -> { pont, gyozelem, ..., weekly: { week, counts } }).
// A heti számláló a hét kezdetét (hétfő, Budapest) tárolja: új héten a régi számok már nem számítanak.
// ============================================================

// A ranglista mutatói (kulcs -> felirat).
const METRICS = {
  pont: 'Összpontszám',
  gyozelem: 'Megnyert játék',
  artatlan: 'Felmentés vádlottként',
  kihivas: 'Teljesített kihívás',
  jatek: 'Lejátszott játék'
};
const PERIODS = ['heti', 'osszes'];
const LIMIT = 20;
// Csak a saját kulcsok érvényesek (a "__proto__", "constructor" stb. nem).
const isMetric = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(METRICS, key);

// Egy játékos mutatója a megadott időszakban.
function valueOf(record, period, metric, weekStart) {
  if (!record || typeof record !== 'object') return 0;
  if (period === 'heti') {
    const w = record.weekly;
    if (!w || w.week !== weekStart || !w.counts) return 0;
    const v = w.counts[metric];
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }
  const v = record[metric];
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// A ranglista: azonos értéknél a kevesebb játékkal elért előz (hatékonyabb), utána név szerint.
// me: egy játékos neve, akinek a helyezését akkor is megadjuk, ha nincs az élmezőnyben.
function build(stats, { period = 'osszes', metric = 'pont', weekStart = '', limit = LIMIT, me = '' } = {}) {
  if (!PERIODS.includes(period)) period = 'osszes';
  if (!isMetric(metric)) metric = 'pont';
  const all = [];
  for (const [name, record] of Object.entries(stats || {})) {
    const value = valueOf(record, period, metric, weekStart);
    if (value <= 0) continue;
    all.push({ name, value, games: valueOf(record, period, 'jatek', weekStart) });
  }
  all.sort((a, b) => b.value - a.value || a.games - b.games || a.name.localeCompare(b.name, 'hu'));
  // egyenlő értékek azonos helyezést kapnak (1, 2, 2, 4 …)
  let lastValue = null, lastRank = 0;
  all.forEach((row, i) => { row.rank = row.value === lastValue ? lastRank : i + 1; lastValue = row.value; lastRank = row.rank; });
  const rows = all.slice(0, limit).map(({ rank, name, value }) => ({ rank, name, value }));
  const mine = me ? all.find((r) => r.name === me) : null;
  return { period, metric, label: METRICS[metric], total: all.length, rows, me: mine ? { rank: mine.rank, value: mine.value } : null };
}

module.exports = { build, valueOf, isMetric, METRICS, PERIODS, LIMIT };
