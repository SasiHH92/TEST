'use strict';
// ============================================================
// Támogatási oldal – viselkedés. Az összeget és a "támogatás sikeres" állapotot a SZERVER dönti el:
// a kliens csak választ és megjelenít. A KÖSZÖNJÜK képernyő kizárólag a /api/support/verify szerver-válasza után látszik
// (vagy jelölt előnézetként, ha az üzemeltető bekapcsolta: SUPPORT_PREVIEW=1).
// ============================================================
(() => {
  document.documentElement.classList.remove('no-js');
  const $ = (s) => document.querySelector(s);
  const cards = [...document.querySelectorAll('.sp-card[data-tier]:not(.sp-custom)')];
  const custom = $('.sp-custom');
  const input = $('#sp-custom-input');
  const err = $('#sp-custom-error');
  const summary = $('#sp-summary');
  const go = $('#sp-go');
  const banner = $('#sp-banner');
  const thanks = $('#sp-thanks');
  let config = { enabled: false, minCents: 100, maxCents: 50000, preview: false };
  let sel = null; // { tierId, cents }
  let pollTimer = null;

  const fmt = (cents) => (cents / 100).toLocaleString('hu-HU', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';

  // "12", "12,5", "12.50" → cent; érvénytelen → null (ugyanaz a szabály, mint a szerveren)
  function parseCents(text) {
    const t = String(text || '').trim().replace(',', '.');
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
    const c = Math.round(parseFloat(t) * 100);
    return Number.isFinite(c) ? c : null;
  }

  function refresh() {
    if (!sel) { summary.textContent = 'Válassz egy összeget a folytatáshoz.'; go.disabled = true; go.textContent = '❤️ TÁMOGATOM'; return; }
    summary.textContent = 'Kiválasztva: ' + fmt(sel.cents) + ' – köszönjük, hogy segítenél!';
    if (!config.enabled) { go.disabled = true; go.textContent = 'HAMAROSAN – MÉG NEM AKTÍV'; return; }
    go.disabled = false; go.textContent = '❤️ TÁMOGATOM · ' + fmt(sel.cents);
  }

  function selectCard(card) {
    for (const c of cards) c.setAttribute('aria-pressed', String(c === card));
    custom.dataset.selected = 'false';
    err.textContent = ''; input.removeAttribute('aria-invalid');
    sel = { tierId: card.dataset.tier, cents: Number(card.dataset.cents) };
    refresh();
  }
  for (const c of cards) c.addEventListener('click', () => selectCard(c));

  function onCustom() {
    for (const c of cards) c.setAttribute('aria-pressed', 'false');
    const raw = input.value;
    custom.dataset.selected = raw.trim() ? 'true' : 'false';
    if (!raw.trim()) { sel = null; err.textContent = ''; input.removeAttribute('aria-invalid'); return refresh(); }
    const c = parseCents(raw);
    if (c === null) { sel = null; err.textContent = 'Írj be egy összeget, pl. 7,50 (legfeljebb két tizedes).'; input.setAttribute('aria-invalid', 'true'); return refresh(); }
    if (c < config.minCents) { sel = null; err.textContent = 'Legalább 1 € kell.'; input.setAttribute('aria-invalid', 'true'); return refresh(); }
    if (c > config.maxCents) { sel = null; err.textContent = 'Legfeljebb 500 € adható meg.'; input.setAttribute('aria-invalid', 'true'); return refresh(); }
    err.textContent = ''; input.removeAttribute('aria-invalid');
    sel = { tierId: 'egyedi', cents: c, amount: raw.trim() };
    refresh();
  }
  input.addEventListener('input', onCustom);
  input.addEventListener('focus', () => { if (input.value.trim()) onCustom(); });

  // ----- KÖSZÖNJÜK -----
  function showThanks(preview) {
    $('#sp-thanks-tag').hidden = !preview;
    thanks.hidden = false;
    $('#sp-thanks-close').focus();
  }
  $('#sp-thanks-close').addEventListener('click', () => { thanks.hidden = true; history.replaceState(null, '', location.pathname); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !thanks.hidden) $('#sp-thanks-close').click(); });

  // ----- támogatás indítása (csak ha az üzemeltető bekapcsolta) -----
  async function api(method, path, body) {
    const r = await fetch('/api/support' + path, {
      method, credentials: 'omit', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000)
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }
  function pollVerify(ref) {
    clearInterval(pollTimer);
    let n = 0;
    pollTimer = setInterval(async () => {
      n++;
      try {
        const r = await api('GET', '/verify?ref=' + encodeURIComponent(ref));
        if (r.ok && r.data.verified === true) { clearInterval(pollTimer); banner.hidden = true; showThanks(false); }
      } catch (_) { /* a következő körben újra */ }
      if (n > 300) clearInterval(pollTimer); // ~15 perc
    }, 3000);
  }
  go.addEventListener('click', async () => {
    if (!sel || !config.enabled) return;
    go.disabled = true;
    try {
      const r = await api('POST', '/intent', { tierId: sel.tierId, ...(sel.tierId === 'egyedi' ? { amount: sel.amount } : {}) });
      if (!r.ok) { banner.hidden = false; banner.textContent = r.data.error || 'Most nem sikerült elindítani a támogatást.'; return; }
      banner.hidden = false; banner.textContent = 'A fizetési oldal megnyílt egy új lapon. Itt megvárjuk a visszaigazolást, utána jön a köszönet.';
      window.open(r.data.checkoutUrl, '_blank', 'noopener');
      pollVerify(r.data.ref);
    } catch (_) {
      banner.hidden = false; banner.textContent = 'A szerver most nem érhető el. Próbáld újra később.';
    } finally { refresh(); }
  });

  // ----- a "mire fordítjuk" kártyák finom megjelenése görgetéskor -----
  const reveals = [...document.querySelectorAll('.reveal')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: 0.2 });
    for (const el of reveals) io.observe(el);
  } else for (const el of reveals) el.classList.add('in');

  // ----- konfiguráció + állapot -----
  (async () => {
    try {
      const r = await api('GET', '/config');
      if (r.ok) config = { ...config, ...r.data };
      // ha van külön "bíró kávéval" kép, azt használjuk; különben marad a játék saját bíró-portréja
      if (config.heroImage && /^\/assets\/[\w\/.-]+$/.test(config.heroImage)) { const judge = $('#sp-judge'); if (judge) judge.src = config.heroImage; }
    } catch (_) { /* a kártyák konfiguráció nélkül is látszanak; a fizetés ilyenkor kikapcsolt marad */ }
    if (!config.enabled) {
      banner.hidden = false;
      banner.textContent = '🚧 A támogatás indítása még nincs aktiválva – az oldal felülete már kész, a fizetési lehetőséget hamarosan kapcsoljuk be. Addig is köszönjük, hogy jársz hozzánk!';
    }
    refresh();
    // szimulált (csak teszt / bemutató): a visszatérő hivatkozás NEM igazol semmit, a szerver ellenőrzése dönt
    const sim = new URLSearchParams(location.search).get('szimulalt');
    if (sim && /^[a-f0-9]{32}$/.test(sim) && config.simulated) pollVerify(sim);
    // jelölt előnézet a tervezéshez: csak ha az üzemeltető bekapcsolta (SUPPORT_PREVIEW=1)
    if (config.preview && new URLSearchParams(location.search).get('elonezet') === 'koszonjuk') showThanks(true);
  })();
})();
