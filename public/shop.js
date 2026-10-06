'use strict';
// ============================================================
// KAMU BÍRÓSÁG – bolt és napi küldetések (kliens)
// Az adatok a /api/shop végpontokról jönnek (bejelentkezés kell). A pénznem a pogácsa:
// napi küldetésekből jár, a boltban kártyakeretre, háttérre, névhatásra, pecsétre, feliratra költhető.
// ============================================================
(() => {
  let state = null;       // a legutóbbi /api/shop/state
  let fetchedAt = 0;
  let tab = 'quests';
  let slotFilter = 'all';
  let tryOn = {};         // kipróbálás: slot -> tárgy (csak előnézet, nincs megvéve)
  let busy = false;
  let timer = null;
  let lastRefresh = 0;

  const $s = (sel) => document.querySelector(sel);
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  async function call(method, route, body) {
    let response;
    try {
      response = await fetch('/api/shop' + route, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000)
      });
    } catch (_) { throw new Error('Nem érhető el a szerver. Próbáld újra kicsit később.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nem sikerült. Próbáld újra.');
    return data;
  }

  const items = () => (state ? state.catalog.targyak : []);
  const itemById = (id) => items().find((i) => i.id === id);

  // A felvett tárgyak a megjelenítéshez (azonosítók + a pecsét/felirat szövege); előnézetnél a kipróbált tárgyakkal.
  function cosmeticsOf(equipped) {
    const out = {};
    for (const [slot, id] of Object.entries(equipped || {})) {
      const it = itemById(id);
      if (it && it.slot === slot) out[slot] = id;
    }
    if (out.stamp) out.stampText = itemById(out.stamp).text;
    if (out.label) out.labelText = itemById(out.label).text;
    return Object.keys(out).length ? out : null;
  }
  const ownCosmetics = () => (state ? cosmeticsOf(state.equipped) : null);
  const previewCosmetics = () => (state ? cosmeticsOf({ ...state.equipped, ...tryOn }) : null);

  function readyCount() {
    if (!state) return 0;
    return state.quests.filter((q) => q.done && !q.claimed).length + (state.bonus.available ? 1 : 0);
  }

  function updateBadge() {
    const badge = $s('#shopQuestBadge');
    if (!badge) return;
    const n = readyCount();
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
  }

  // Új adat érkezett: a névválasztó profil-paneljét is frissítjük, ha változott valami.
  function changed(prevJson) {
    updateBadge();
    if (!$s('#shopModal').classList.contains('hidden')) render();
    if (JSON.stringify(state) !== prevJson && typeof renderMugGrid === 'function' && document.body.dataset.screen === 'name') renderMugGrid();
  }

  async function refresh(force) {
    if (!window.kbAccount) { state = null; return null; }
    if (!force && Date.now() - lastRefresh < 4000) return state;
    lastRefresh = Date.now();
    const prev = JSON.stringify(state);
    try {
      state = await call('GET', '/state');
      fetchedAt = Date.now();
    } catch (_) { return state; }
    changed(prev);
    return state;
  }

  function setMessage(text, ok) {
    const el = $s('#shopMessage');
    el.textContent = text || '';
    el.classList.toggle('success', !!ok);
  }

  async function act(method, route, body, okText) {
    if (busy) return;
    busy = true; setMessage('');
    const prev = JSON.stringify(state);
    try {
      state = await call(method, route, body);
      fetchedAt = Date.now();
      if (okText) setMessage(okText, true);
    } catch (error) { setMessage(error.message); }
    finally { busy = false; changed(prev); }
  }

  // ---------------- megjelenítés ----------------

  function resetText() {
    if (!state) return '';
    const ms = Math.max(0, state.resetsInMs - (Date.now() - fetchedAt));
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h ? h + ' óra ' + m + ' perc' : m + ' perc';
  }

  function questsHtml() {
    const cards = state.quests.map((q) => {
      const pct = Math.min(100, Math.round((100 * q.progress) / q.target));
      const action = q.claimed ? '<span class="q-done">✔ ÁTVETTED</span>'
        : q.done ? '<button type="button" class="btn small q-claim" data-claim="' + q.id + '">ÁTVESZEM</button>'
        : '<span class="q-wait">Folyamatban…</span>';
      return '<div class="q-card q-' + q.tier + (q.claimed ? ' claimed' : '') + (q.done && !q.claimed ? ' ready' : '') + '">' +
        '<span class="q-tier">' + escapeHtml(q.tierName) + '</span>' +
        '<p class="q-text">' + escapeHtml(q.text) + '</p>' +
        '<div class="q-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + q.target + '" aria-valuenow="' + q.progress + '"><i style="width:' + pct + '%"></i></div>' +
        '<div class="q-foot"><span class="q-count">' + q.progress + ' / ' + q.target + '</span>' +
        '<span class="q-reward">+' + q.reward + ' 🍪</span>' + action + '</div></div>';
    }).join('');
    const b = state.bonus;
    const bonus = '<div class="q-bonus' + (b.available ? ' ready' : '') + (b.claimed ? ' claimed' : '') + '">' +
      '<span>🎁 <b>Napi bónusz:</b> mind a három küldetés jutalmának átvétele után +' + b.reward + ' 🍪</span>' +
      (b.claimed ? '<span class="q-done">✔ ÁTVETTED</span>'
        : b.available ? '<button type="button" class="btn small q-claim" data-claim-bonus="1">BÓNUSZ ÁTVÉTELE</button>'
        : '<span class="q-wait">Előbb vedd át a három jutalmat</span>') + '</div>';
    return '<p class="shop-info">Minden nap 3 új küldetés vár (új küldetések: <b id="shopReset">' + resetText() + '</b> múlva, éjfélkor). ' +
      'A küldetések játék közben teljesülnek, a <b>saját fiókod nevével</b> játszva (A TE KÁRTYÁD).</p>' +
      '<div class="q-list">' + cards + '</div>' + bonus;
  }

  function shopHtml() {
    const s = state;
    const slots = s.catalog.slotok;
    const filters = [{ id: 'all', nev: 'Összes' }, ...slots].map((f) =>
      '<button type="button" class="sf' + (slotFilter === f.id ? ' active' : '') + '" data-filter="' + f.id + '">' + escapeHtml(f.nev) + '</button>').join('');
    const list = items().filter((i) => slotFilter === 'all' || i.slot === slotFilter);
    const grid = list.map((i) => {
      const owned = s.owned.includes(i.id);
      const equipped = s.equipped[i.slot] === i.id;
      const trying = tryOn[i.slot] === i.id;
      const slotName = slots.find((x) => x.id === i.slot).nev;
      const need = i.ar - s.wallet;
      const action = owned
        ? (equipped ? '<button type="button" class="btn small ghost" data-unequip="' + i.slot + '">LEVESZEM</button>'
          : '<button type="button" class="btn small" data-equip="' + i.id + '">FELVESZEM</button>')
        : '<button type="button" class="btn small" data-buy="' + i.id + '"' + (need > 0 ? ' disabled' : '') + '>MEGVESZEM · ' + fmt(i.ar) + ' 🍪</button>' +
          (need > 0 ? '<small class="it-need">még ' + fmt(need) + ' pogácsa kell</small>' : '');
      return '<div class="it-card r-' + i.ritkasag.replace(/[^a-z]/g, '') + (owned ? ' owned' : '') + (equipped ? ' equipped' : '') + (trying ? ' trying' : '') + '" data-try="' + i.id + '" tabindex="0" role="button" aria-label="' + escapeHtml(i.nev) + ' kipróbálása">' +
        '<div class="it-top"><span class="it-slot">' + escapeHtml(slotName) + '</span><span class="it-rar">' + escapeHtml(i.ritkasag) + '</span></div>' +
        '<b class="it-name">' + escapeHtml(i.nev) + (equipped ? ' <em>✔ felvéve</em>' : owned ? ' <em>a tiéd</em>' : '') + '</b>' +
        '<p class="it-desc">' + escapeHtml(i.leiras) + '</p><div class="it-act">' + action + '</div></div>';
    }).join('');
    const acc = window.kbAccount || {};
    const prof = acc.profile || {};
    const cosm = previewCosmetics();
    const preview = '<div class="mug-card mug-me shop-preview' + cosmeticClasses(cosm) + '">' + mugCardHtml({
      label: 'A TE KÁRTYÁD', cosm, name: acc.username || 'Neved', badge: prof.jelveny || '',
      title: prof.titulus || 'Új gyanúsított', avatar: AVATARS.includes(prof.avatar) ? prof.avatar : '', pick: false
    }) + '</div>';
    const hasTry = Object.keys(tryOn).length > 0;
    return '<div class="shop-layout"><div class="shop-preview-col"><span class="profile-preview-label">ELŐNÉZET</span>' + preview +
      '<p class="shop-hint">Kattints egy tárgyra a kipróbáláshoz: a vásárlás előtt megnézheted, hogyan állna a kártyádon.</p>' +
      (hasTry ? '<button type="button" class="btn small ghost" data-reset-try="1">KIPRÓBÁLÁS VISSZAVONÁSA</button>' : '') + '</div>' +
      '<div class="shop-items"><div class="shop-filters">' + filters + '</div><div class="item-grid">' + grid + '</div></div></div>';
  }

  function render() {
    if (!state) { $s('#shopBody').innerHTML = '<p class="shop-info">Betöltés…</p>'; return; }
    $s('#shopWallet').textContent = fmt(state.wallet);
    $s('#shopTabQuests').setAttribute('aria-selected', String(tab === 'quests'));
    $s('#shopTabShop').setAttribute('aria-selected', String(tab === 'shop'));
    const body = $s('#shopBody');
    const scroll = body.scrollTop;
    body.innerHTML = tab === 'quests' ? questsHtml() : shopHtml();
    body.scrollTop = scroll;
    updateBadge();
  }

  async function open(which) {
    if (!window.kbAccount) return;
    tab = which === 'shop' ? 'shop' : 'quests';
    tryOn = {};
    setMessage('');
    $s('#shopModal').classList.remove('hidden');
    render();
    await refresh(true);
    clearInterval(timer);
    timer = setInterval(() => {
      const el = $s('#shopReset');
      if (el) el.textContent = resetText();
    }, 20000);
  }

  function close() {
    $s('#shopModal').classList.add('hidden');
    clearInterval(timer);
    tryOn = {};
  }

  // ---------------- események ----------------
  $s('#shopClose').addEventListener('click', close);
  $s('#shopModal').addEventListener('click', (e) => { if (e.target === $s('#shopModal')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$s('#shopModal').classList.contains('hidden')) close(); });
  $s('#shopTabQuests').addEventListener('click', () => { tab = 'quests'; render(); });
  $s('#shopTabShop').addEventListener('click', () => { tab = 'shop'; render(); });

  $s('#shopBody').addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-try]');
    if (!t) return;
    if (t.dataset.claim) return act('POST', '/claim', { questId: t.dataset.claim }, '🍪 Jutalom átvéve!');
    if (t.dataset.claimBonus) return act('POST', '/claim-bonus', {}, '🎁 Napi bónusz átvéve!');
    if (t.dataset.buy) { const i = itemById(t.dataset.buy); return act('POST', '/buy', { itemId: t.dataset.buy }, '🛍️ Megvetted: ' + (i ? i.nev : '') + '!'); }
    if (t.dataset.equip) { const i = itemById(t.dataset.equip); delete tryOn[i.slot]; return act('POST', '/equip', { slot: i.slot, itemId: i.id }, '✨ Felvéve: ' + i.nev); }
    if (t.dataset.unequip) { delete tryOn[t.dataset.unequip]; return act('POST', '/equip', { slot: t.dataset.unequip, itemId: null }, 'Levéve.'); }
    if (t.dataset.filter) { slotFilter = t.dataset.filter; return render(); }
    if (t.dataset.resetTry) { tryOn = {}; return render(); }
    if (t.dataset.try) {
      const i = itemById(t.dataset.try);
      if (!i) return;
      if (tryOn[i.slot] === i.id) delete tryOn[i.slot]; else tryOn[i.slot] = i.id;
      render();
    }
  });
  $s('#shopBody').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-try]')) { e.preventDefault(); e.target.click(); }
  });

  // A játék többi része ezen keresztül éri el.
  window.kbShop = {
    open, refresh, close,
    state: () => state,
    cosmetics: ownCosmetics,
    readyCount,
    forget: () => { state = null; tryOn = {}; }
  };
})();
