'use strict';

// ============================================================
// KAMU BÍRÓSÁG – Kártyaműhely (kliens): saját csomagok készítése / szerkesztése, nyilvános könyvtár, kód alapján megnézés, mentés, jelentés,
// és a lobbiban a csomag felvétele a szobába. A szerver (packs.js) dönt mindenről; itt csak megjelenítés és kérések vannak.
// Minden felhasználói szöveg textContent-tel / escape-pel kerül az oldalra.
// Megnyitás: window.kbPacks.open({ tab: 'mine' | 'library' | 'code', code: 'ABC234' }); a menü és a lobbi gombjai hívják.
// ============================================================
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const DECK_HINT = {
    vadak: 'Egy sor = egy vád, pl.: "A [vádlott] ellopta [játékos] kedvenc sapkáját." A [vádlott] és a [játékos] helyőrző csak itt használható.',
    bizonyitekok: 'Amit az ügyész felhasznál: "Egy félig megevett lángos a tetthelyen."',
    alibik: 'A vádlott mentsége: "Épp a lángososnál álltál sorban."',
    trukkok: 'A védő trükkjei: "Állítsd, hogy a bizonyíték photoshopolt."',
    tanuk: 'A tanú szerepe: "Te voltál a lángosos aznap este."',
    kihivasok: 'Titkos beszédkihívás: "Minden mondatodat fejezd be úgy: oksa."',
    buntetesek: 'Büntetés, ha a vádlott bűnös: "Köteles lángost venni mindenkinek."'
  };
  let limits = null, tab = 'mine', modal = null, body = null, current = null; // current: a megnézett / szerkesztett csomag
  let libState = { q: '', sort: 'new', offset: 0 };
  const account = () => window.kbAccount || null;

  async function api(method, route, payload) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (payload !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(payload); }
    let res; try { res = await fetch('/api/packs' + route, opts); } catch (_) { throw Object.assign(new Error('Nincs kapcsolat a szerverrel.'), { status: 0 }); }
    let data = null; try { data = await res.json(); } catch (_) { /* nincs törzs */ }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'Hiba történt.'), { status: res.status, errors: data && data.errors });
    return data;
  }
  const toast = (msg) => { if (typeof showToast === 'function') showToast(msg); };
  const inLobbyAsHost = () => typeof S !== 'undefined' && typeof MY !== 'undefined' && S && S.phase === 'lobby' && S.hostId === MY.playerId;

  // ---------- keret ----------
  function build() {
    if (modal) return;
    modal = el('div', { id: 'packsModal', class: 'packs-modal hidden', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'packsTitle' });
    const panel = el('div', { class: 'packs-panel' },
      el('div', { class: 'packs-head' }, el('h2', { id: 'packsTitle', text: '🃏 KÁRTYAMŰHELY' }), el('button', { type: 'button', class: 'btn small', id: 'packsClose', text: 'BEZÁR', onclick: close })),
      el('div', { class: 'packs-tabs', role: 'tablist' },
        ...[['mine', 'SAJÁT CSOMAGJAIM'], ['library', 'KÖNYVTÁR'], ['code', 'KÓD']].map(([k, label]) => el('button', { type: 'button', role: 'tab', class: 'packs-tab', 'data-tab': k, text: label, onclick: () => { current = null; go(k); } }))),
      (body = el('div', { class: 'packs-body', id: 'packsBody' })));
    modal.append(panel);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
    document.body.append(modal);
  }
  function open(opts = {}) {
    build();
    modal.classList.remove('hidden'); document.body.classList.add('packs-open');
    if (opts.code) { current = null; viewCode(opts.code); } else go(opts.tab || 'mine');
    const x = $('#packsClose'); if (x) x.focus();
  }
  function close() { if (!modal) return; modal.classList.add('hidden'); document.body.classList.remove('packs-open'); current = null; }
  function go(next) {
    tab = next;
    modal.querySelectorAll('.packs-tab').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    body.scrollTop = 0;
    if (tab === 'mine') renderMine(); else if (tab === 'library') renderLibrary(true); else renderCode();
  }
  const loading = (msg = 'Betöltés…') => { body.replaceChildren(el('p', { class: 'packs-note', text: msg })); };
  const failure = (e) => { body.replaceChildren(el('p', { class: 'packs-error', text: e.message || 'Hiba történt.' }), el('button', { type: 'button', class: 'btn small ghost', text: 'ÚJRA', onclick: () => go(tab) })); };

  // ---------- listák ----------
  function card(p, actions) {
    const counts = el('p', { class: 'pk-counts', text: p.total + ' kártya · ' + (p.saves || 0) + ' mentés · ' + (p.uses || 0) + ' játék' });
    return el('div', { class: 'pk-item' + (p.hidden ? ' hidden-pack' : '') },
      el('div', { class: 'pk-main' },
        el('h3', { text: p.name }),
        el('p', { class: 'pk-by', text: 'készítette: ' + p.owner + (p.visibility === 'private' ? ' · PRIVÁT' : '') + (p.hidden ? ' · ELREJTVE (jelentések miatt)' : '') }),
        p.desc ? el('p', { class: 'pk-desc', text: p.desc }) : null, counts,
        el('p', { class: 'pk-code', text: 'Kód: ' + p.code })),
      el('div', { class: 'pk-actions' }, ...actions));
  }
  const btn = (text, fn, cls = 'btn small') => el('button', { type: 'button', class: cls, text, onclick: fn });

  async function renderMine() {
    loading();
    try {
      if (!limits) limits = await api('GET', '/limits');
      const acc = account();
      if (!acc) {
        body.replaceChildren(el('p', { class: 'packs-note', text: 'Saját csomag készítéséhez és a gyűjtemény használatához jelentkezz be. Vendégként a könyvtárat böngészheted, és kóddal bármelyik csomagot használhatod a saját szobádban.' }),
          btn('KÖNYVTÁR MEGNYITÁSA', () => go('library')));
        return;
      }
      const data = await api('GET', '/mine');
      const list = [];
      list.push(el('div', { class: 'packs-toolbar' },
        btn('+ ÚJ CSOMAG', data.owned.length >= limits.perAccount ? () => toast('⚠️ Legfeljebb ' + limits.perAccount + ' saját csomagod lehet: törölj egyet az újhoz.') : () => edit(null), data.owned.length >= limits.perAccount ? 'btn small disabled' : 'btn small'),
        el('span', { class: 'packs-note', text: data.owned.length + ' / ' + limits.perAccount + ' saját csomag' })));
      if (!data.owned.length) list.push(el('p', { class: 'packs-note', text: 'Még nincs saját csomagod. Írd meg a saját vádaidat, bizonyítékaidat, alibiidet és minden mást: a barátaid is használhatják, ha megadod nekik a kódot, vagy nyilvánossá teszed.' }));
      for (const p of data.owned) list.push(card(p, [btn('SZERKESZT', () => edit(p.code)), btn('MEGNÉZ', () => viewCode(p.code), 'btn small ghost'), btn('KÓD MÁSOLÁSA', () => copyCode(p.code), 'btn small ghost'), btn('TÖRLÉS', () => removePack(p), 'btn small ghost danger')].concat(roomButton(p))));
      list.push(el('h4', { class: 'packs-sub', text: 'MENTETT CSOMAGOK' }));
      if (!data.saved.length) list.push(el('p', { class: 'packs-note', text: 'Nincs mentett csomagod. A könyvtárban a MENTÉS gombbal gyűjtheted: a lobbiban mindig kéznél lesznek.' }));
      for (const p of data.saved) list.push(card(p, [btn('MEGNÉZ', () => viewCode(p.code)), btn('LEVÉTEL', () => unsave(p), 'btn small ghost')].concat(roomButton(p))));
      body.replaceChildren(...list);
    } catch (e) { failure(e); }
  }

  async function renderLibrary(reset) {
    if (reset) libState.offset = 0;
    const search = el('input', { type: 'search', class: 'packs-input', placeholder: 'Keresés névre, leírásra, készítőre…', maxlength: '60', value: libState.q, 'aria-label': 'Keresés' });
    const sort = el('select', { class: 'packs-input', 'aria-label': 'Rendezés' }, el('option', { value: 'new', text: 'Legújabb elöl' }), el('option', { value: 'popular', text: 'Legnépszerűbb elöl' }));
    sort.value = libState.sort;
    const run = () => { libState.q = search.value.trim(); libState.sort = sort.value; libState.offset = 0; renderLibrary(false); };
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }); sort.addEventListener('change', run);
    const bar = el('div', { class: 'packs-toolbar' }, search, sort, btn('KERES', run));
    const listBox = el('div', { class: 'packs-list' }, el('p', { class: 'packs-note', text: 'Betöltés…' }));
    body.replaceChildren(bar, listBox);
    try {
      const data = await api('GET', '/library?sort=' + encodeURIComponent(libState.sort) + '&q=' + encodeURIComponent(libState.q) + '&limit=20&offset=' + libState.offset);
      const items = data.packs.map((p) => card(p, [btn('MEGNÉZ', () => viewCode(p.code)), account() && !p.mine ? btn(p.saved ? 'LEVÉTEL' : 'MENTÉS', () => (p.saved ? unsave(p) : save(p)), 'btn small ghost') : null].concat(roomButton(p))));
      if (!items.length) items.push(el('p', { class: 'packs-note', text: libState.q ? 'Nincs találat.' : 'Még nincs nyilvános csomag. Légy te az első!' }));
      const pager = [];
      if (libState.offset > 0) pager.push(btn('‹ ELŐZŐ', () => { libState.offset = Math.max(0, libState.offset - 20); renderLibrary(false); }, 'btn small ghost'));
      if (libState.offset + 20 < data.total) pager.push(btn('KÖVETKEZŐ ›', () => { libState.offset += 20; renderLibrary(false); }, 'btn small ghost'));
      listBox.replaceChildren(...items.filter(Boolean), ...(pager.length ? [el('div', { class: 'packs-toolbar' }, ...pager)] : [])); // a null a replaceChildren-ben "null" szöveg lenne
    } catch (e) { listBox.replaceChildren(el('p', { class: 'packs-error', text: e.message })); }
  }

  function renderCode() {
    const input = el('input', { type: 'text', class: 'packs-input code-input', maxlength: '6', placeholder: 'pl. K7M2QP', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Csomag kódja' });
    const go1 = () => { const c = input.value.trim().toUpperCase(); if (c.length !== 6) { msg.textContent = 'A kód 6 betű vagy szám.'; return; } viewCode(c); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go1(); });
    const msg = el('p', { class: 'packs-error' });
    body.replaceChildren(el('p', { class: 'packs-note', text: 'Add meg a csomag 6 jegyű kódját (a készítő megosztja veled). Megnézheted, elmentheted, vagy a lobbiban a szobádba veheted.' }), el('div', { class: 'packs-toolbar' }, input, btn('MEGNÉZ', go1)), msg);
    input.focus();
  }

  // ---------- megnézés ----------
  async function viewCode(code) {
    loading();
    try {
      const { pack } = await api('GET', '/' + encodeURIComponent(String(code).toUpperCase()));
      if (!limits) limits = await api('GET', '/limits');
      current = pack; renderView(pack);
    } catch (e) { body.replaceChildren(el('p', { class: 'packs-error', text: e.message }), btn('‹ VISSZA', () => go(tab === 'code' ? 'code' : tab), 'btn small ghost')); }
  }
  function renderView(p) {
    const acc = account();
    const actions = [btn('‹ VISSZA', () => { current = null; go(tab); }, 'btn small ghost')];
    if (p.mine) actions.push(btn('SZERKESZT', () => edit(p.code)));
    else if (acc) { actions.push(btn(p.saved ? 'LEVÉTEL A GYŰJTEMÉNYBŐL' : 'MENTÉS A GYŰJTEMÉNYBE', async () => { try { if (p.saved) await api('DELETE', '/' + p.code + '/save'); else await api('POST', '/' + p.code + '/save', {}); toast(p.saved ? 'Levéve a gyűjteményből.' : '✓ Elmentve a gyűjteményedbe.'); viewCode(p.code); } catch (e) { toast('⚠️ ' + e.message); } })); actions.push(btn('JELENTÉS', () => report(p), 'btn small ghost danger')); }
    actions.push(btn('KÓD MÁSOLÁSA', () => copyCode(p.code), 'btn small ghost'));
    actions.push(...roomButton(p, true));
    const sections = limits.decks.map((d) => el('section', { class: 'pk-deck' }, el('h4', { text: d.label + ' (' + p.decks[d.key].length + ')' }), el('ul', {}, ...p.decks[d.key].map((t) => el('li', { text: t })))));
    body.replaceChildren(el('div', { class: 'pk-view-head' }, el('h3', { text: p.name }), el('p', { class: 'pk-by', text: 'készítette: ' + p.owner + ' · ' + (p.visibility === 'private' ? 'privát' : 'nyilvános') + ' · kód: ' + p.code + (p.hidden ? ' · ELREJTVE' : '') }), p.desc ? el('p', { class: 'pk-desc', text: p.desc }) : null), el('div', { class: 'packs-toolbar' }, ...actions), ...sections);
    body.scrollTop = 0;
  }
  // "Használom a szobában": csak a lobbiban, a házigazdának
  function roomButton(p, big) {
    if (!inLobbyAsHost() || p.hidden) return [];
    return [btn('HASZNÁLOM A SZOBÁBAN', () => addToRoom(p.code), big ? 'btn' : 'btn small')];
  }
  function addToRoom(code) {
    if (typeof socket === 'undefined') return;
    socket.emit('pack_add', { code }, (res) => {
      if (res && res.ok) { toast('✓ A "' + res.name + '" csomag a szobában van, ki is van jelölve.'); close(); }
      else toast('⚠️ ' + ((res && res.error) || 'Nem sikerült felvenni.'));
    });
  }

  // ---------- műveletek ----------
  async function copyCode(code) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(code); toast('✓ Kód másolva: ' + code); } else toast('Csomag kódja: ' + code); } catch (_) { toast('Csomag kódja: ' + code); }
  }
  async function save(p) { try { await api('POST', '/' + p.code + '/save', {}); toast('✓ Elmentve: ' + p.name); go(tab); } catch (e) { toast('⚠️ ' + e.message); } }
  async function unsave(p) { try { await api('DELETE', '/' + p.code + '/save'); toast('Levéve a gyűjteményből.'); go(tab); } catch (e) { toast('⚠️ ' + e.message); } }
  async function removePack(p) {
    if (!window.confirm('Biztosan törlöd a "' + p.name + '" csomagot? Ez nem vonható vissza, és a mentők gyűjteményéből is eltűnik.')) return;
    try { await api('DELETE', '/' + p.code); toast('Csomag törölve.'); go('mine'); } catch (e) { toast('⚠️ ' + e.message); }
  }
  async function report(p) {
    if (!window.confirm('Jelented a "' + p.name + '" csomagot? Ha több játékos is jelenti, a csomag automatikusan elrejtődik, és az üzemeltető átnézi.')) return;
    try { await api('POST', '/' + p.code + '/report', {}); toast('✓ Köszönjük, a jelentést rögzítettük.'); } catch (e) { toast('⚠️ ' + e.message); }
  }

  // ---------- szerkesztő ----------
  async function edit(code) {
    loading();
    try {
      if (!limits) limits = await api('GET', '/limits');
      const pack = code ? (await api('GET', '/' + code)).pack : { name: '', desc: '', visibility: 'private', decks: {} };
      renderEditor(pack, !!code);
    } catch (e) { failure(e); }
  }
  function renderEditor(p, existing) {
    const name = el('input', { type: 'text', class: 'packs-input', maxlength: String(limits.name[1]), value: p.name, placeholder: 'A csomag neve (pl. Hétvégi Discord-ügyek)', 'aria-label': 'A csomag neve' });
    const desc = el('input', { type: 'text', class: 'packs-input', maxlength: String(limits.desc), value: p.desc || '', placeholder: 'Rövid leírás (nem kötelező)', 'aria-label': 'Leírás' });
    const pub = el('input', { type: 'radio', name: 'pkvis', value: 'public' }), priv = el('input', { type: 'radio', name: 'pkvis', value: 'private' });
    (p.visibility === 'public' ? pub : priv).checked = true;
    const areas = {}, counters = {};
    const sections = limits.decks.map((d) => {
      const ta = el('textarea', { class: 'packs-input pk-area', rows: '6', 'aria-label': d.label, spellcheck: 'true' }); ta.value = (p.decks[d.key] || []).join('\n'); areas[d.key] = ta;
      const counter = el('span', { class: 'pk-counter' }); counters[d.key] = counter;
      const upd = () => { const n = ta.value.split('\n').filter((x) => x.trim()).length; counter.textContent = n + ' kártya (kell: ' + d.min + '–' + d.max + ')'; counter.classList.toggle('ok', n >= d.min && n <= d.max); counter.classList.toggle('bad', n > d.max); };
      ta.addEventListener('input', upd); upd();
      return el('section', { class: 'pk-deck' }, el('h4', {}, d.label + ' ', counter), el('p', { class: 'pk-hint', text: DECK_HINT[d.key] || '' }), ta);
    });
    const errors = el('div', { class: 'packs-errors', role: 'alert' });
    const saveBtn = btn(existing ? 'MENTÉS' : 'CSOMAG LÉTREHOZÁSA', async () => {
      errors.replaceChildren(); saveBtn.disabled = true;
      const payload = { name: name.value, desc: desc.value, visibility: pub.checked ? 'public' : 'private', decks: Object.fromEntries(Object.entries(areas).map(([k, ta]) => [k, ta.value.split('\n')])) };
      try {
        const r = existing ? await api('PUT', '/' + p.code, payload) : await api('POST', '', payload);
        toast('✓ ' + (existing ? 'Csomag mentve.' : 'Csomag létrehozva. Kód: ' + r.pack.code)); current = r.pack; renderView(r.pack);
      } catch (e) {
        const list = e.errors && e.errors.length ? e.errors : [e.message];
        errors.replaceChildren(el('p', { class: 'packs-error', text: 'A csomag még nem mentható:' }), el('ul', {}, ...list.map((x) => el('li', { text: x })))); errors.scrollIntoView({ block: 'nearest' });
      } finally { saveBtn.disabled = false; }
    });
    body.replaceChildren(
      el('div', { class: 'packs-toolbar' }, btn('‹ MÉGSEM', () => (existing ? viewCode(p.code) : go('mine')), 'btn small ghost')),
      el('h3', { text: existing ? 'Csomag szerkesztése' : 'Új csomag' }),
      el('label', { class: 'pk-field' }, 'Név', name), el('label', { class: 'pk-field' }, 'Leírás', desc),
      el('div', { class: 'pk-vis' }, el('label', {}, priv, ' PRIVÁT: csak a kódot ismerők érik el'), el('label', {}, pub, ' NYILVÁNOS: megjelenik a könyvtárban')),
      el('p', { class: 'packs-note', text: 'Soronként egy kártya. A szövegek 4–' + limits.card[1] + ' karakteresek legyenek, link, @ és < > jel nélkül. Durva, másokat bántó tartalmat ne írj: a nyilvános csomagokat a játékosok jelenthetik, és az üzemeltető törölheti.' }),
      ...sections, errors, el('div', { class: 'packs-toolbar' }, saveBtn));
  }

  window.kbPacks = { open, close, isOpen: () => !!modal && !modal.classList.contains('hidden') };

  // lobbi: csomag felvétele kóddal (a házigazda asztalán)
  const addBtn = $('#btnPackAdd'), codeIn = $('#packCodeInput');
  if (addBtn && codeIn) {
    const run = () => {
      const code = codeIn.value.trim().toUpperCase();
      if (code.length !== 6) { toast('⚠️ A csomag kódja 6 betű vagy szám.'); codeIn.focus(); return; }
      if (typeof socket === 'undefined') return;
      socket.emit('pack_add', { code }, (res) => {
        if (res && res.ok) { toast('✓ A "' + res.name + '" csomag a szobában van, ki is van jelölve.'); codeIn.value = ''; }
        else toast('⚠️ ' + ((res && res.error) || 'Nem sikerült felvenni.'));
      });
    };
    addBtn.addEventListener('click', run);
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  }

  // gombok bekötése (menü és lobbi)
  document.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('[data-packs]') : null;
    if (!t) return;
    e.preventDefault();
    open({ tab: t.dataset.packs || 'mine' });
  });
})();
