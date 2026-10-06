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
  let previewId = null;   // az éppen előnézetben nézett tárgy (csak előnézet, nincs megvéve)
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
  // Az előnézet: a most felvett tárgyaid + a megnézett tárgy a saját helyén.
  const previewCosmetics = (item) => (state ? cosmeticsOf({ ...state.equipped, ...(item ? { [item.slot]: item.id } : {}) }) : null);

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
    for (const el of [$s('#shopMessage'), $s('#shopPopMsg')]) { // az előnézeti ablakban is látszik az üzenet
      if (!el) continue;
      el.textContent = text || '';
      el.classList.toggle('success', !!ok);
    }
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

  // Vásárlás / felvétel gomb egy tárgyhoz (a listában és az előnézeti ablakban is ez jelenik meg).
  // Ha nincs elég pogácsa, a gomb le van tiltva, és kiírjuk, mennyi hiányzik (a szerver is elutasítja a vásárlást).
  function actionHtml(i, s) {
    if (s.owned.includes(i.id)) {
      return s.equipped[i.slot] === i.id
        ? '<button type="button" class="btn small ghost" data-unequip="' + i.slot + '">LEVESZEM</button>'
        : '<button type="button" class="btn small" data-equip="' + i.id + '">FELVESZEM</button>';
    }
    const need = i.ar - s.wallet;
    return need > 0
      ? '<button type="button" class="btn small" data-buy="' + i.id + '" disabled title="Nincs elég pogácsád ehhez">🔒 MEGVESZEM · ' + fmt(i.ar) + ' 🍪</button>' +
        '<small class="it-need">Nincs elég pogácsád: még ' + fmt(need) + ' kell</small>'
      : '<button type="button" class="btn small" data-buy="' + i.id + '">MEGVESZEM · ' + fmt(i.ar) + ' 🍪</button>';
  }

  // Nagy előnézeti ablak: a saját kártyád a megnézett tárggyal, a tárgy adataival és a vásárlás gombbal.
  function previewHtml(i) {
    const s = state;
    const list = items().filter((x) => slotFilter === 'all' || x.slot === slotFilter);
    const slotName = s.catalog.slotok.find((x) => x.id === i.slot).nev;
    const acc = window.kbAccount || {};
    const prof = acc.profile || {};
    const cosm = previewCosmetics(i);
    const card = '<div class="mug-card mug-me shop-preview' + cosmeticClasses(cosm) + '">' + mugCardHtml({
      label: 'A TE KÁRTYÁD', cosm, name: acc.username || 'Neved', badge: prof.jelveny || '',
      title: prof.titulus || 'Új gyanúsított', avatar: AVATARS.includes(prof.avatar) ? prof.avatar : '', pick: false
    }) + '</div>';
    const nav = list.length > 1
      ? '<div class="pop-nav"><button type="button" class="btn small ghost" data-pop-prev="1" aria-label="Előző tárgy">◀</button>' +
        '<span>' + (list.findIndex((x) => x.id === i.id) + 1) + ' / ' + list.length + '</span>' +
        '<button type="button" class="btn small ghost" data-pop-next="1" aria-label="Következő tárgy">▶</button></div>'
      : '';
    return '<div class="pop-box r-' + i.ritkasag.replace(/[^a-z]/g, '') + '" role="dialog" aria-label="' + escapeHtml(i.nev) + ' előnézete">' +
      '<div class="pop-card">' + card + '</div>' +
      '<div class="pop-info"><span class="it-top"><span class="it-slot">' + escapeHtml(slotName) + '</span><span class="it-rar">' + escapeHtml(i.ritkasag) + '</span></span>' +
      '<h3>' + escapeHtml(i.nev) + '</h3><p>' + escapeHtml(i.leiras) + '</p>' +
      '<p class="pop-price">Ára: <b>' + fmt(i.ar) + ' 🍪</b> · nálad: <b>' + fmt(s.wallet) + ' 🍪</b></p>' +
      '<div class="it-act">' + actionHtml(i, s) + '</div>' + nav +
      '<p id="shopPopMsg" class="auth-form-message pop-msg" role="status" aria-live="polite"></p>' +
      '<button type="button" class="btn small ghost pop-close" data-pop-close="1">VISSZA A BOLTHOZ</button></div></div>';
  }

  function renderPop() {
    const pop = $s('#shopPop');
    const item = previewId && state ? itemById(previewId) : null;
    if (!item) { pop.classList.add('hidden'); pop.innerHTML = ''; previewId = null; return; }
    pop.innerHTML = previewHtml(item);
    pop.classList.remove('hidden');
    const main = $s('#shopMessage'), mirror = $s('#shopPopMsg');
    if (main && mirror) { mirror.textContent = main.textContent; mirror.classList.toggle('success', main.classList.contains('success')); }
  }

  function openPreview(id) {
    if (!itemById(id)) return;
    previewId = id;
    setMessage(''); // másik tárgyra lapozva a korábbi üzenet már nem idevaló
    renderPop();
    const focus = $s('#shopPop .btn:not([disabled])');
    if (focus) focus.focus({ preventScroll: true });
  }

  function closePreview() {
    previewId = null;
    renderPop();
  }

  function stepPreview(dir) {
    const list = items().filter((x) => slotFilter === 'all' || x.slot === slotFilter);
    if (!list.length) return;
    const at = list.findIndex((x) => x.id === previewId);
    openPreview(list[(at + dir + list.length) % list.length].id);
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
      const slotName = slots.find((x) => x.id === i.slot).nev;
      const previewBtn = '<button type="button" class="btn small ghost it-preview" data-preview="' + i.id + '">👁 ELŐNÉZET</button>';
      return '<div class="it-card r-' + i.ritkasag.replace(/[^a-z]/g, '') + (owned ? ' owned' : '') + (equipped ? ' equipped' : '') + '" data-preview="' + i.id + '" tabindex="0" role="button" aria-label="' + escapeHtml(i.nev) + ' előnézete">' +
        '<div class="it-top"><span class="it-slot">' + escapeHtml(slotName) + '</span><span class="it-rar">' + escapeHtml(i.ritkasag) + '</span></div>' +
        '<b class="it-name">' + escapeHtml(i.nev) + (equipped ? ' <em>✔ felvéve</em>' : owned ? ' <em>a tiéd</em>' : '') + '</b>' +
        '<p class="it-desc">' + escapeHtml(i.leiras) + '</p><div class="it-act">' + previewBtn + actionHtml(i, s) + '</div></div>';
    }).join('');
    const acc = window.kbAccount || {};
    const prof = acc.profile || {};
    const cosm = ownCosmetics();
    const preview = '<div class="mug-card mug-me shop-preview' + cosmeticClasses(cosm) + '">' + mugCardHtml({
      label: 'A TE KÁRTYÁD', cosm, name: acc.username || 'Neved', badge: prof.jelveny || '',
      title: prof.titulus || 'Új gyanúsított', avatar: AVATARS.includes(prof.avatar) ? prof.avatar : '', pick: false
    }) + '</div>';
    return '<div class="shop-layout"><div class="shop-preview-col"><span class="profile-preview-label">A JELENLEGI KÁRTYÁD</span>' + preview +
      '<p class="shop-hint">Bármelyik tárgynál az <b>👁 ELŐNÉZET</b> gombbal megnézheted, hogyan állna a kártyádon. Megvenni csak akkor lehet, ha van rá elég pogácsád.</p></div>' +
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
    if (tab !== 'shop') previewId = null;
    renderPop(); // vásárlás/felvétel után az előnézeti ablak is az új állapotot mutatja
    updateBadge();
  }

  async function open(which) {
    if (!window.kbAccount) return;
    tab = which === 'shop' ? 'shop' : 'quests';
    previewId = null;
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
    previewId = null;
    renderPop();
  }

  // Vásárlás / felvétel / levétel: a lista és az előnézeti ablak közös kezelője.
  function itemAction(t) {
    if (t.dataset.buy) {
      const i = itemById(t.dataset.buy);
      if (i && state && state.wallet < i.ar) { setMessage('Nincs elég pogácsád ehhez (' + fmt(i.ar) + ' kell, ' + fmt(state.wallet) + ' van).'); return true; }
      act('POST', '/buy', { itemId: t.dataset.buy }, '🛍️ Megvetted: ' + (i ? i.nev : '') + '!');
      return true;
    }
    if (t.dataset.equip) { const i = itemById(t.dataset.equip); act('POST', '/equip', { slot: i.slot, itemId: i.id }, '✨ Felvéve: ' + i.nev); return true; }
    if (t.dataset.unequip) { act('POST', '/equip', { slot: t.dataset.unequip, itemId: null }, 'Levéve.'); return true; }
    return false;
  }

  // ---------------- események ----------------
  $s('#shopClose').addEventListener('click', close);
  $s('#shopModal').addEventListener('click', (e) => { if (e.target === $s('#shopModal')) close(); });
  document.addEventListener('keydown', (e) => {
    if ($s('#shopModal').classList.contains('hidden')) return;
    if (e.key === 'Escape') { if (previewId) closePreview(); else close(); return; }
    if (previewId && e.key === 'ArrowLeft') stepPreview(-1);
    if (previewId && e.key === 'ArrowRight') stepPreview(1);
  });
  $s('#shopTabQuests').addEventListener('click', () => { tab = 'quests'; render(); });
  $s('#shopTabShop').addEventListener('click', () => { tab = 'shop'; render(); });

  $s('#shopBody').addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-preview]');
    if (!t) return;
    if (t.dataset.claim) return act('POST', '/claim', { questId: t.dataset.claim }, '🍪 Jutalom átvéve!');
    if (t.dataset.claimBonus) return act('POST', '/claim-bonus', {}, '🎁 Napi bónusz átvéve!');
    if (itemAction(t)) return;
    if (t.dataset.filter) { slotFilter = t.dataset.filter; return render(); }
    if (t.dataset.preview) openPreview(t.dataset.preview);
  });
  $s('#shopBody').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.it-card[data-preview]')) { e.preventDefault(); openPreview(e.target.dataset.preview); }
  });

  $s('#shopPop').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) { if (e.target === $s('#shopPop')) closePreview(); return; }
    if (t.dataset.popClose) return closePreview();
    if (t.dataset.popPrev) return stepPreview(-1);
    if (t.dataset.popNext) return stepPreview(1);
    itemAction(t);
  });

  // A játék többi része ezen keresztül éri el.
  window.kbShop = {
    open, refresh, close,
    state: () => state,
    cosmetics: ownCosmetics,
    readyCount,
    forget: () => { state = null; previewId = null; }
  };
})();
