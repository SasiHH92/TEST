'use strict';
// ============================================================
// KAMU BÍRÓSÁG – ranglista (kliens)
// A /api/leaderboard végpontról jön (nyilvános): heti és összesített lista, mutatónként.
// ============================================================
(() => {
  let period = 'heti';
  let metric = 'pont';
  let data = null;
  let busy = 0;

  const $r = (sel) => document.querySelector(sel);
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const myName = () => (typeof MY !== 'undefined' && MY.name) || (window.kbAccount && window.kbAccount.username) || '';
  const isOpen = () => !$r('#rankModal').classList.contains('hidden');

  async function load() {
    const ticket = ++busy;
    $r('#rankBody').innerHTML = '<p class="shop-info">Betöltés…</p>';
    try {
      const q = new URLSearchParams({ period, metric });
      if (myName()) q.set('me', myName());
      const response = await fetch('/api/leaderboard?' + q, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Nem sikerült betölteni.');
      if (ticket !== busy) return; // közben másik fület / mutatót választottak
      data = json;
    } catch (error) {
      if (ticket !== busy) return;
      data = null;
      $r('#rankBody').innerHTML = '<p class="shop-info">' + escapeHtml(error.message || 'Nem érhető el a szerver.') + '</p>';
      return;
    }
    render();
  }

  function resetText(ms) {
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return d ? d + ' nap ' + h + ' óra' : h ? h + ' óra ' + m + ' perc' : m + ' perc';
  }

  function render() {
    $r('#rkTabWeek').setAttribute('aria-selected', String(period === 'heti'));
    $r('#rkTabAll').setAttribute('aria-selected', String(period === 'osszes'));
    const metrics = (data && data.metrics) || { pont: 'Összpontszám', gyozelem: 'Megnyert játék', artatlan: 'Felmentés vádlottként', kihivas: 'Teljesített kihívás', jatek: 'Lejátszott játék' };
    $r('#rankMetrics').innerHTML = Object.entries(metrics).map(([k, label]) =>
      '<button type="button" class="sf' + (k === metric ? ' active' : '') + '" data-metric="' + k + '">' + escapeHtml(label) + '</button>').join('');
    if (!data) return;
    const me = myName();
    const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank);
    const rows = data.rows.map((r) =>
      '<div class="rk-row' + (r.rank <= 3 ? ' top' + r.rank : '') + (r.name === me ? ' me' : '') + '">' +
      '<span class="rk-pos">' + medal(r.rank) + '</span>' +
      '<span class="rk-name">' + escapeHtml(r.name) + (r.legend ? ' <i class="rk-legend">LEGENDA</i>' : '') + (r.name === me ? ' <i class="rk-you">TE</i>' : '') + '</span>' +
      '<b class="rk-val">' + fmt(r.value) + '</b></div>').join('');
    const outside = data.me && !data.rows.some((r) => r.name === me)
      ? '<div class="rk-gap">…</div><div class="rk-row me"><span class="rk-pos">#' + data.me.rank + '</span><span class="rk-name">' + escapeHtml(me) + ' <i class="rk-you">TE</i></span><b class="rk-val">' + fmt(data.me.value) + '</b></div>'
      : '';
    $r('#rankBody').innerHTML = data.rows.length
      ? '<h3 class="fr-h">' + escapeHtml(data.label).toUpperCase() + ' · ' + (period === 'heti' ? 'EZEN A HÉTEN' : 'MINDEN IDŐK') + ' · ' + data.total + ' JÁTÉKOS</h3>' + rows + outside
      : '<p class="shop-info">' + (period === 'heti' ? 'Ezen a héten még nem játszott senki ' : 'Még nincs adat ') + 'ebben a kategóriában. Játssz egy tárgyalást, és te leszel az első!</p>';
    $r('#rankFoot').textContent = period === 'heti'
      ? 'A heti ranglista hétfőn éjfélkor (magyar idő) indul újra: ' + resetText(data.resetsInMs) + ' múlva. Vendégek és bejelentkezettek is szerepelnek a nevükkel.'
      : 'Az összesített lista minden eddigi játékot számol. A névvel játszott eredmények nevenként gyűlnek.';
  }

  function open(which) {
    if (which === 'heti' || which === 'osszes') period = which;
    $r('#rankModal').classList.remove('hidden');
    load();
  }
  function close() { $r('#rankModal').classList.add('hidden'); }

  $r('#rankClose').addEventListener('click', close);
  $r('#rankModal').addEventListener('click', (e) => { if (e.target === $r('#rankModal')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
  $r('#rkTabWeek').addEventListener('click', () => { period = 'heti'; load(); });
  $r('#rkTabAll').addEventListener('click', () => { period = 'osszes'; load(); });
  $r('#rankMetrics').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metric]');
    if (!b) return;
    metric = b.dataset.metric; load();
  });

  window.kbRanking = { open, close };
})();
