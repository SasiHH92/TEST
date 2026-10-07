'use strict';

// ============================================================
// KAMU BÍRÓSÁG – KÁRTYÁIM: fizikai kártyapakli / játékos-kéz (csak MEGJELENÍTÉS)
//
// A kártyák tartalmát és láthatóságát a SZERVER dönti el: a kliens csak azt kapja (S.evidence, S.alibi, S.tricks, S.witnessCard, S.myChallenge), amit a
// szerver neki küldött; a client.js ezekből építi a leírókat, és ide adja át. Ez a modul NEM tud játékeseményt küldeni, és nem dönt arról, ki mit lát.
// Privát adat soha nem kerül más játékos kliensére – és nincs "CSS-sel elrejtett" tartalom: ami nem az enyém, az a DOM-ban sincs.
//
// Közös architektúra (egy komponens, több típus): CourtCard (arc + típus-stílus) · CardHand (zárt pakli ⇄ nyitott legyező / mobil tálca) · CardPreview
// (nagyító a kéz fölött). A típusok: evidence, witness, challenge, alibi, trick; role és special típus előkészítve, de játékhoz NEM kötve (nincs ilyen kártya).
// Grafika: csak HTML/CSS papír-kezelés (cards.css); SVG-t és új artworköt nem használ.
// ============================================================
(() => {
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => document.body.classList.contains('reduced-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const play = (name) => { try { if (window.kbSound && window.kbSound.play) window.kbSound.play(name); } catch (_) { /* a hang nem kötelező */ } };

  const TYPES = {
    evidence:  { label: 'BIZONYÍTÉK',        stamp: 'AKTÁBA VÉVE', badge: '' },
    witness:   { label: 'TITKOS TANÚKÁRTYA', stamp: 'BIZALMAS',    badge: 'TANÚ' },
    challenge: { label: 'KIHÍVÁSKÁRTYA',     stamp: 'KIHÍVÁS',     badge: '' },
    alibi:     { label: 'TITKOS ALIBI',      stamp: 'BIZALMAS',    badge: 'VÁDLOTT' },
    trick:     { label: 'TITKOS TRÜKK',      stamp: 'BIZALMAS',    badge: 'VÉDŐ' },
    role:      { label: 'SZEREPKÁRTYA',      stamp: 'SZIGORÚAN BIZALMAS', badge: '' }, // a játékban nincs ilyen kártya: a típus készen áll, de semmi sem köti hozzá
    special:   { label: 'KÜLÖNLEGES KÁRTYA', stamp: '',            badge: '' }          // ugyanígy előkészítve
  };
  const FAN_MAX = 5;      // legfeljebb ennyi kártya (vagy 4 + "+N") látszik teljesen a nyitott legyezőben
  const CLOSED_MAX = 4;   // a zárt pakliban legfeljebb ennyi lap látszik
  const SEEN_KEY = 'kb_cards_seen';

  const st = { cards: [], sig: '', open: false, sel: -1, preview: false, phase: '', touched: false, auto: false, seen: new Set(), newTimer: 0, newCardTimer: 0, mounted: false };
  try { for (const id of JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]')) st.seen.add(id); } catch (_) { /* nincs tár */ }
  const saveSeen = () => { try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...st.seen].slice(-80))); } catch (_) { /* nincs tár */ } };
  const root = () => $('#myCardsBar');

  // ---------------- CourtCard: az arc ----------------
  function typeOf(c) { return TYPES[c.type] ? c.type : 'special'; }
  function face(c) {
    const t = typeOf(c), T = TYPES[t];
    const no = c.number ? '#' + String(c.number).padStart(2, '0') : '';
    const badge = c.badge || T.badge;
    return '<span class="cf-clip" aria-hidden="true"></span>' +
      '<span class="cf-head"><span class="cf-type">' + esc(c.title || T.label) + '</span>' + (no ? '<span class="cf-no">' + no + '</span>' : '') + '</span>' +
      (c.subtitle ? '<span class="cf-sub">' + esc(c.subtitle) + '</span>' : '') +
      '<span class="cf-text">' + esc(c.content) + '</span>' +
      '<span class="cf-foot"><span class="cf-case">' + (c.caseNumber ? 'ÜGYIRAT: ' + esc(c.caseNumber) : '') + '</span>' + (badge ? '<span class="cf-badge">' + esc(badge) + '</span>' : '') + '</span>' +
      (T.stamp ? '<span class="cf-stamp" aria-hidden="true">' + esc(T.stamp) + '</span>' : '') +
      (c.status ? '<span class="cf-status">' + esc(c.status) + '</span>' : '') +
      (c.isUsable ? '<span class="cf-usable">' + esc(c.actionLabel || 'HASZNÁLHATÓ') + '</span>' : '');
  }
  const label = (c) => {
    const T = TYPES[typeOf(c)];
    return (c.title || T.label) + (c.number ? ' ' + c.number : '') + (c.subtitle ? ', ' + c.subtitle : '') + ': ' + c.content + '.' + (c.visibility === 'private' ? ' Titkos kártya, csak te látod.' : '');
  };

  // ---------------- CardHand: elrendezés ----------------
  // A zárt pakli: legfeljebb 4 lap, egymás mögé csúsztatva, kissé eltérő elfordulással. A nyitott legyező: a bal alsó sarokból felfelé és jobbra nyílik
  // (a lapok a sarok körül forognak). Mindkét állapot koordinátái CSS-változók; az állapotot a data-state választja – az átmenet csak transform (olcsó).
  function layout(n) {
    const m = Math.min(n, CLOSED_MAX), openN = Math.min(n, FAN_MAX); // nyitva: kártyák, vagy 4 kártya + a "+N" lap
    const fan = (j) => ({ ox: j * 36, oy: -j * 3 - 6, or: openN === 1 ? 0 : -4 + j * (26 / (openN - 1)) });
    const cards = Array.from({ length: n }, (_, k) => {
      const closedK = Math.min(k, m - 1), j = Math.min(k, n > FAN_MAX ? FAN_MAX - 2 : n - 1);
      return { cx: closedK * 9, cy: -(m - 1 - closedK) * 5, cr: (closedK - (m - 1) / 2) * 4, ...fan(j), hiddenClosed: k >= CLOSED_MAX, hiddenOpen: n > FAN_MAX && k >= FAN_MAX - 1 };
    });
    return { cards, more: n > FAN_MAX ? fan(FAN_MAX - 1) : null };
  }

  function build(cards) {
    const n = cards.length, L = layout(n);
    const items = [];
    cards.forEach((c, i) => {
      const p = L.cards[i], t = typeOf(c);
      items.push('<button type="button" class="court-card t-' + t + (c.isUsable ? ' usable' : '') + '" data-i="' + i + '" tabindex="-1" aria-pressed="false" aria-label="' + esc(label(c)) + '"' +
        (p.hiddenClosed ? ' data-hide-closed="1"' : '') + (p.hiddenOpen ? ' data-hide-open="1"' : '') +
        ' style="--i:' + i + ';--cx:' + p.cx + 'px;--cy:' + p.cy + 'px;--cr:' + p.cr + 'deg;--ox:' + p.ox + 'px;--oy:' + p.oy + 'px;--or:' + p.or + 'deg">' + face(c) + '</button>');
    });
    if (L.more) {
      const p = L.more, rest = n - (FAN_MAX - 1);
      items.push('<button type="button" class="court-card more" data-more="1" data-hide-closed="1" tabindex="-1" aria-label="+' + rest + ' további kártya megnyitása" style="--i:' + (FAN_MAX - 1) +
        ';--ox:' + p.ox + 'px;--oy:' + p.oy + 'px;--or:' + p.or + 'deg"><span class="cf-more">+' + rest + '</span></button>');
    }
    return '<div class="ch-stage" id="chStage" role="group" aria-label="Titkos kártyáid">' + items.join('') + '</div>' +
      '<button type="button" class="ch-toggle" id="chToggle" aria-expanded="false" aria-controls="chStage"><span class="ch-label">KÁRTYÁIM</span><span class="ch-count">' + n + '</span><span class="ch-new" aria-hidden="true">ÚJ KÁRTYA</span></button>' +
      '<div class="card-preview hidden" id="cardPreview" role="dialog" aria-label="Kártya megtekintése"></div>' +
      '<span class="sr-only" id="chLive" role="status" aria-live="polite"></span>';
  }

  function renderPreview() {
    const el = $('#cardPreview');
    if (!el) return;
    const c = st.cards[st.sel];
    if (!st.preview || !c) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const t = typeOf(c), n = st.cards.length;
    el.innerHTML = '<div class="cp-bar"><span class="cp-count">' + (st.sel + 1) + ' / ' + n + '</span><span class="cp-private">' + (c.visibility === 'private' ? 'CSAK TE LÁTOD' : '') + '</span>' +
      '<button type="button" class="cp-x" data-act="close" aria-label="Kártya bezárása (Esc)">✕</button></div>' +
      '<div class="court-card big t-' + t + '">' + face(c) + '</div>' +
      (n > 1 ? '<div class="cp-nav"><button type="button" data-act="prev" aria-label="Előző kártya">‹</button><button type="button" data-act="next" aria-label="Következő kártya">›</button></div>' : '');
    el.classList.remove('hidden');
  }

  function apply() {
    const r = root();
    if (!r) return;
    r.dataset.state = st.open ? 'open' : 'closed';
    r.classList.toggle('has-sel', st.open && st.sel >= 0);
    const tg = $('#chToggle');
    if (tg) {
      tg.setAttribute('aria-expanded', st.open ? 'true' : 'false');
      tg.setAttribute('aria-label', 'Kártyáim: ' + st.cards.length + ' titkos kártya, csak te látod. ' + (st.open ? 'Bezárás' : 'Megnyitás'));
    }
    r.querySelectorAll('.court-card[data-i]').forEach((el) => {
      const i = +el.dataset.i, on = i === st.sel && st.open;
      el.classList.toggle('sel', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.tabIndex = st.open && !el.hasAttribute('data-hide-open') ? 0 : -1;
    });
    const more = r.querySelector('.court-card.more');
    if (more) more.tabIndex = st.open ? 0 : -1;
    const stage = $('#chStage');
    if (stage) stage.setAttribute('aria-hidden', st.open ? 'false' : 'true');
    renderPreview();
  }

  // ---------------- műveletek ----------------
  function open(user) {
    if (st.open || !st.cards.length) return;
    st.open = true; if (user) st.touched = true;
    play('card-open');
    apply();
  }
  function closePreview(focusCard) {
    if (!st.preview) return;
    st.preview = false;
    apply();
    if (focusCard) { const el = root() && root().querySelector('.court-card[data-i="' + st.sel + '"]'); if (el) el.focus({ preventScroll: true }); }
  }
  function close(user) {
    if (user) st.touched = true;
    if (!st.open && !st.preview) return;
    st.open = false; st.preview = false; st.sel = -1;
    apply();
    const tg = $('#chToggle');
    if (user && tg && root() && root().contains(document.activeElement)) tg.focus({ preventScroll: true });
  }
  function select(i, withPreview) {
    if (i < 0 || i >= st.cards.length) return;
    if (!st.open) open(true);
    const same = st.sel === i && st.preview;
    st.sel = i; st.touched = true;
    st.preview = withPreview !== false && !same;
    if (!same) play('card-select');
    apply();
    if (st.preview) { const x = $('#cardPreview .cp-x'); if (x && root().contains(document.activeElement)) x.focus({ preventScroll: true }); }
  }
  function toggle() { st.open ? close(true) : open(true); }

  function hide() {
    const r = root();
    st.open = false; st.sel = -1; st.preview = false; st.sig = ''; st.cards = [];
    clearTimeout(st.newTimer);
    if (r) { r.classList.add('hidden'); r.classList.remove('has-new', 'has-sel'); r.dataset.state = 'closed'; r.innerHTML = ''; }
  }

  // ---------------- frissítés a szerver állapotából ----------------
  // cards: a client.js által a SZERVER adataiból épített leírók [{id, type, title?, subtitle?, content, visibility, badge?, caseNumber, number, isUsable?}];
  // ctx: { phase }. Üres lista (vagy tiltott fázis) esetén a kéz eltűnik.
  function update(cards, ctx) {
    const r = root();
    if (!r) return;
    ctx = ctx || {};
    const prevPhase = st.phase;
    st.phase = ctx.phase || '';
    if (!Array.isArray(cards) || !cards.length || ctx.hidden) { if (st.sig || !r.classList.contains('hidden')) hide(); document.body.classList.remove('has-hand'); return; }
    r.classList.remove('hidden');
    document.body.classList.add('has-hand');
    r.setAttribute('role', 'region');
    r.setAttribute('aria-label', 'Kártyáim – titkos kártyák, csak te látod');
    const sig = cards.map((c) => c.id).join('|');
    if (sig !== st.sig) {
      const hadOpen = st.open;
      const fresh = cards.filter((c) => !st.seen.has(c.id));
      st.cards = cards; st.sig = sig;
      st.sel = -1; st.preview = false;
      r.innerHTML = build(cards);
      st.open = hadOpen;
      if (!st.mounted) { st.mounted = true; bind(r); }
      for (const c of cards) st.seen.add(c.id);
      saveSeen();
      if (fresh.length) {
        // ÚJ KÁRTYA: a pakliba becsúszik, rövid ragyogás + jelzés (nem modal, nem szakítja meg a játékot)
        fresh.forEach((c) => { const el = r.querySelector('.court-card[data-i="' + cards.indexOf(c) + '"]'); if (el) el.classList.add('is-new'); });
        r.classList.add('has-new');
        const live = $('#chLive'); if (live) live.textContent = fresh.length === 1 ? 'Új kártyát kaptál.' : fresh.length + ' új kártyát kaptál.';
        play('card-new');
        clearTimeout(st.newTimer);
        st.newTimer = setTimeout(() => { r.classList.remove('has-new'); r.querySelectorAll('.is-new').forEach((e) => e.classList.remove('is-new')); }, 2200);
      }
    }
    // a felkészülés elején a pakli magától kinyílik (olvasni kell a kártyákat); a felkészülés végén becsukódik, ha a játékos nem nyúlt hozzá
    if (st.phase === 'prep' && prevPhase !== 'prep') { st.touched = false; if (!st.open) { st.auto = true; open(false); } }
    else if (st.phase !== 'prep' && prevPhase === 'prep' && st.auto && !st.touched) { st.auto = false; close(false); }
    apply();
  }

  // ---------------- események (egyszer kötjük; delegálva) ----------------
  function bind(r) {
    r.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act, n = st.cards.length;
        if (a === 'close') closePreview(true);
        else if (a === 'prev') select((st.sel - 1 + n) % n, true);
        else if (a === 'next') select((st.sel + 1) % n, true);
        return;
      }
      if (e.target.closest('#chToggle')) { toggle(); return; }
      const more = e.target.closest('.court-card.more');
      if (more) { select(FAN_MAX - 1, true); return; }
      const card = e.target.closest('.court-card[data-i]');
      if (card) { if (!st.open) open(true); else select(+card.dataset.i, true); }
    });
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (st.preview) closePreview(true); else if (st.open) close(true); else return; e.preventDefault(); e.stopPropagation(); return; }
      if (!st.open) return;
      const cards = [...r.querySelectorAll('.court-card[tabindex="0"]')];
      const i = cards.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' && i >= 0) { cards[(i + 1) % cards.length].focus(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' && i >= 0) { cards[(i - 1 + cards.length) % cards.length].focus(); e.preventDefault(); }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && st.preview) { const n = st.cards.length; select((st.sel + (e.key === 'ArrowRight' ? 1 : -1) + n) % n, true); e.preventDefault(); }
    });
    // kattintás a kézen kívül: a pakli (és a nagyító) becsukódik; a játék gombjai közben a megszokott módon működnek
    // (a nagyító újrarajzolódik kattintáskor, ezért az útvonalat nézzük, nem a már leválasztott célelemet)
    document.addEventListener('click', (e) => { const inside = e.composedPath ? e.composedPath().includes(r) : r.contains(e.target); if ((st.open || st.preview) && !inside) close(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (st.open || st.preview) && !r.contains(document.activeElement)) { if (st.preview) closePreview(false); else close(false); } });
  }

  // Teszt / hibakeresés: a kéz megjelenítési állapota (nem játékállapot).
  const state = () => ({ visible: !!root() && !root().classList.contains('hidden'), open: st.open, count: st.cards.length, selected: st.sel, preview: st.preview, types: st.cards.map((c) => c.type), ids: st.cards.map((c) => c.id) });

  window.kbCards = { update, open: () => open(true), close: () => close(true), toggle, select, hide, state, TYPES, FAN_MAX, CLOSED_MAX };
})();
