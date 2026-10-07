'use strict';
// ============================================================
// KAMU BÍRÓSÁG – csevegő (kliens)
// Két csatorna egy panelen:
//   SZOBA: a lobbiban és a játék közben mindenki ír mindenkinek a szobában (előzmény a belépéskor).
//   KÖZÖS: az egész oldalra szóló tér + hirdetőtábla ("keresek embereket", szobakóddal, csatlakozás gombbal).
// Elhelyezés: lebegő (névválasztó, menü, keskeny lobbi), dokkolt (széles lobbi: nem takarja a tartalmat),
// beágyazott (játék közben a ponttábla-oldalsáv CSEVEGŐ füle: nem lóg a jelenetbe).
// ============================================================
(() => {
  const MAX_SHOWN = 120;
  const DOCK_MIN_WIDTH = 1560; // ennél szélesebb képernyőn a lobbiban a csevegő a tartalom mellé dokkol
  const room = { msgs: [], seen: new Set(), unread: 0 };
  const reported = new Set();   // 'csatorna:azonosító' – amit én már jelentettem
  const flags = new Map();      // szobai üzenet azonosítója -> hányan jelentették
  const board = { msgs: [], seen: new Set(), unread: 0 };
  let ads = [];
  let channel = 'room';
  let open = false;        // a lebegő/dokkolt panel nyitva van
  let gameTab = false;     // játék közben a CSEVEGŐ fül aktív az oldalsávon
  let busy = false;
  let wasInRoom = false, lastScreen = '';

  const $c = (sel) => document.querySelector(sel);
  const screen = () => document.body.dataset.screen;
  const here = () => (window.kbInRoom ? window.kbInRoom() : { code: '', lobby: false });
  const inRoom = () => ['lobby', 'game'].includes(screen()) && !!here().code;
  const current = () => (inRoom() ? channel : 'board'); // szobán kívül csak a közös tér van
  const store = (c) => (c === 'room' ? room : board);
  const mine = (m) => typeof MY !== 'undefined' && m.pid && m.pid === MY.playerId;
  const myBoardName = () => (typeof MY !== 'undefined' && MY.name) || (window.kbAccount && window.kbAccount.username) || '';
  const visible = () => (screen() === 'game' ? gameTab : open);
  const meInRoom = () => (typeof S !== 'undefined' && S && S.players && typeof MY !== 'undefined' ? S.players.find((p) => p.id === MY.playerId) : null);
  const iAmHost = () => !!(typeof S !== 'undefined' && S && typeof MY !== 'undefined' && S.hostId && S.hostId === MY.playerId);
  const playerOf = (pid) => (typeof S !== 'undefined' && S && S.players ? S.players.find((p) => p.id === pid) : null);

  function timeText(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function messageHtml(m, prev, c) {
    const own = c === 'room' ? mine(m) : (m.name === myBoardName() && !!m.name);
    const same = prev && prev.kind !== 'ad' && m.kind !== 'ad' && (c === 'room' ? prev.pid === m.pid : prev.name === m.name) && m.ts - prev.ts < 90000;
    // Moderáció: más üzenetét jelenthetem (⚑); a szoba házigazdája a küldőt némíthatja is (🔇 / 🔊).
    let actions = '';
    if (!own) {
      const done = reported.has(c + ':' + m.id);
      const count = c === 'room' ? (flags.get(m.id) || 0) : 0;
      if (count) actions += '<span class="cm-flag" title="Ennyien jelentették ezt az üzenetet">⚑ ' + count + '</span>';
      actions += '<button type="button" class="cm-act' + (done ? ' done' : '') + '" data-report="' + m.id + '"' + (done ? ' disabled' : '') +
        ' title="' + (done ? 'Már jelentetted' : 'Üzenet jelentése') + '" aria-label="' + (done ? 'Már jelentetted' : 'Üzenet jelentése') + '">' + (done ? '✓' : '⚑') + '</button>';
      if (c === 'room' && iAmHost() && m.pid) {
        const muted = !!(playerOf(m.pid) && playerOf(m.pid).chatMuted);
        actions += '<button type="button" class="cm-act' + (muted ? ' on' : '') + '" data-mute="' + escapeHtml(m.pid) + '" data-muted="' + (muted ? '1' : '0') + '"' +
          ' title="' + (muted ? 'Némítás feloldása' : 'Némítás a szoba csevegőjében') + '" aria-label="' + (muted ? 'Némítás feloldása' : 'Némítás a szoba csevegőjében') + '">' + (muted ? '🔊' : '🔇') + '</button>';
      }
    }
    return '<div class="chat-msg' + (own ? ' me' : '') + (same ? ' cont' : '') + (m.kind === 'ad' ? ' is-ad' : '') + (c === 'room' && flags.get(m.id) ? ' flagged' : '') + '" data-id="' + m.id + '">' +
      (same ? '' : '<span class="cm-name" style="color:hsl(' + nameHue(m.name) + ',70%,72%)">' + escapeHtml(own ? 'Te' : m.name) + '<time>' + timeText(m.ts) + '</time></span>') +
      '<span class="cm-row"><span class="cm-text">' + escapeHtml(m.text) + '</span>' + (actions ? '<span class="cm-actions">' + actions + '</span>' : '') + '</span></div>';
  }

  const qrOpen = new Set(); // azok a hirdetések, amelyeknél a QR-kód ki van nyitva

  function adsHtml() {
    const myCode = here().code;
    return ads.map((a) => {
      const ownRoom = myCode && myCode === a.code;
      const code = escapeHtml(a.code);
      const action = ownRoom
        ? '<button type="button" class="btn small ghost" data-ad-remove="1">VISSZAVON</button>'
        : (myCode ? '<span class="ad-note">Előbb lépj ki a szobádból</span>'
          : '<button type="button" class="btn small" data-ad-join="' + code + '">CSATLAKOZOM</button>');
      const tools = '<span class="ad-tools"><button type="button" class="ad-mini" data-ad-copy="' + code + '" title="Meghívó-link másolása" aria-label="Link másolása">🔗</button>' +
        '<button type="button" class="ad-mini' + (qrOpen.has(a.code) ? ' on' : '') + '" data-ad-qr="' + code + '" title="QR-kód (telefonnal beolvasható)" aria-label="QR-kód">▦</button></span>';
      return '<div class="ad-wrap"><div class="ad-card"><span class="ad-main"><b>' + escapeHtml(a.name) + '</b><span>' + escapeHtml(a.text) + '</span>' +
        '<small>' + a.players + '/' + a.max + ' játékos · kód <b>' + code + '</b></small></span>' + action + tools + '</div>' +
        (qrOpen.has(a.code) ? '<div class="ad-qr"><img src="/qr?room=' + encodeURIComponent(a.code) + '" alt="QR-kód a ' + code + ' szobához"></div>' : '') + '</div>';
    }).join('');
  }

  // A szoba meghívó-linkje a vágólapra (ugyanaz a link, amit a QR is tartalmaz).
  async function copyRoomLink(code) {
    const url = location.origin + '/?room=' + encodeURIComponent(code);
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (_) { /* tartalék: kijelölés + másolás */ }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (_) { /* */ }
      ta.remove();
    }
    setNote(ok ? '🔗 Meghívó-link kimásolva: ' + url : 'Nem sikerült másolni, a link: ' + url);
  }

  function renderLog() {
    const c = current(), list = store(c).msgs, log = $c('#chatLog');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const empty = c === 'room' ? 'Még nincs üzenet. Írj valamit a teremnek!' : 'Még nincs üzenet a közös térben. Köszönj be, vagy hirdesd meg a szobád!';
    log.innerHTML = list.length ? list.map((m, i) => messageHtml(m, list[i - 1], c)).join('') : '<p class="chat-empty">' + empty + '</p>';
    if (atBottom || log.dataset.channel !== c) { log.scrollTop = log.scrollHeight; log.dataset.channel = c; }
  }

  function renderHead() {
    const c = current(), rin = inRoom();
    $c('#chTabRoom').classList.toggle('hidden', !rin);
    $c('#chTabRoom').setAttribute('aria-selected', String(c === 'room'));
    $c('#chTabBoard').setAttribute('aria-selected', String(c === 'board'));
    $c('#chTabBoard').classList.toggle('only', !rin);
    const players = typeof S !== 'undefined' && S && S.players ? S.players.filter((p) => p.connected && !p.isBot).length : 0;
    const mutedCount = typeof S !== 'undefined' && S && S.players ? S.players.filter((p) => p.chatMuted).length : 0;
    $c('#chatSub').textContent = c === 'room' ? (players ? players + ' játékos a szobában' : '') + (iAmHost() && mutedCount ? ' · némítva: ' + mutedCount : '')
      : 'Közös tér: az egész oldal látja. Hirdesd meg a szobád, ha embereket keresel.';
    const adsEl = $c('#chatAds');
    adsEl.classList.toggle('hidden', c !== 'board' || !ads.length);
    if (c === 'board') adsEl.innerHTML = adsHtml();
    const me = meInRoom(), muted = c === 'room' && !!(me && me.chatMuted);
    $c('#chatInput').placeholder = muted ? 'A házigazda elnémított a szoba csevegőjében' : (c === 'room' ? 'Írj a teremnek…' : 'Írj mindenkinek…');
    $c('#chatInput').disabled = muted;
    // hirdetni csak nyitott lobbi-szobából lehet
    $c('#chatAdBtn').classList.toggle('hidden', !(c === 'board' && here().lobby));
  }

  function badge(el, n) {
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hidden', !n);
  }

  function renderBadges() {
    badge($c('#chRoomBadge'), room.unread);
    badge($c('#chBoardBadge'), board.unread);
    const total = room.unread + board.unread;
    badge($c('#chatBadge'), total);
    badge($c('#sbChatBadge'), total);
    badge($c('#sbToggleBadge'), total);
  }

  // Elhelyezés: a játékban az oldalsáv fülébe ágyazva, egyébként lebegő / (széles lobbiban) dokkolt.
  function place() {
    const panel = $c('#chatPanel'), s = screen();
    if (s === 'game') {
      const slot = $c('#sbChatSlot');
      if (panel.parentNode !== slot) slot.appendChild(panel);
      panel.classList.add('embedded'); panel.classList.remove('docked');
      document.body.classList.remove('chat-docked');
    } else {
      if (panel.parentNode !== document.body) document.body.appendChild(panel);
      panel.classList.remove('embedded');
      const docked = open && s === 'lobby' && innerWidth >= DOCK_MIN_WIDTH;
      panel.classList.toggle('docked', docked);
      document.body.classList.toggle('chat-docked', docked);
    }
  }

  function apply() {
    const s = screen(), vis = visible(), panel = $c('#chatPanel');
    place();
    panel.classList.toggle('hidden', !vis);
    // játék közben az oldalsáv fülei döntik el, mi látszik
    const ing = s === 'game';
    $c('#sbRows').classList.toggle('hidden', ing && gameTab);
    $c('#sbChatSlot').classList.toggle('hidden', !(ing && gameTab));
    $c('#sbTabScores').classList.toggle('active', !gameTab);
    $c('#sbTabScores').setAttribute('aria-selected', String(!gameTab));
    $c('#sbTabChat').classList.toggle('active', gameTab);
    $c('#sbTabChat').setAttribute('aria-selected', String(gameTab));
    if (vis) store(current()).unread = 0;
    $c('#chatFab').classList.toggle('hidden', !['name', 'menu', 'lobby'].includes(s) || vis);
    renderHead();
    if (vis) renderLog();
    renderBadges();
  }

  function setOpen(value, persist = true) {
    open = !!value;
    apply();
    if (open && matchMedia('(min-width: 701px)').matches) setTimeout(() => { const i = $c('#chatInput'); if (i) i.focus(); }, 40);
    if (persist) { try { localStorage.setItem('kb_chat_open', open ? '1' : '0'); } catch (_) { /* a beállítás nem kötelező */ } }
  }

  function setChannel(c) {
    channel = c;
    store(c).unread = 0;
    apply();
  }

  function add(c, m) {
    if (!m || typeof m.id !== 'number') return;
    const st = store(c);
    if (st.seen.has(m.id)) return;
    st.seen.add(m.id);
    st.msgs.push(m);
    if (st.msgs.length > MAX_SHOWN) { const old = st.msgs.shift(); st.seen.delete(old.id); }
    const own = c === 'room' ? mine(m) : (m.name === myBoardName() && !!m.name);
    const watching = visible() && current() === c;
    if (watching) renderLog();
    else if (!own) { st.unread++; renderBadges(); }
    // Hang: a szoba üzeneteire mindig, a közös térre csak ha nyitva van a panel (a nyilvános tér ne zavarjon).
    if (!own && window.kbSound && (c === 'room' || visible())) window.kbSound.chat();
  }

  function loadInto(c, list) {
    const st = store(c);
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || typeof m.id !== 'number' || st.seen.has(m.id)) continue;
      st.seen.add(m.id);
      st.msgs.push(m);
    }
    st.msgs.sort((a, b) => a.id - b.id);
    if (st.msgs.length > MAX_SHOWN) st.msgs = st.msgs.slice(-MAX_SHOWN);
    if (visible() && current() === c) renderLog();
  }

  // A szoba előzménye (belépéskor, újracsatlakozáskor): a már látottakat nem duplázza.
  const load = (list) => loadInto('room', list);

  function clearRoom() {
    room.msgs = []; room.seen = new Set(); room.unread = 0; flags.clear();
    for (const k of [...reported]) if (k.startsWith('room:')) reported.delete(k);
    $c('#chatLog').dataset.channel = '';
  }

  function setNote(text) {
    const el = $c('#chatNote');
    el.textContent = text || '';
    clearTimeout(setNote._t);
    if (text) setNote._t = setTimeout(() => { el.textContent = ''; }, 4500);
  }

  // Feliratkozás a közös térre (előzmény + hirdetések); bejelentkezés után újra, hogy a letiltottak szűrése érvényesüljön.
  function subscribe() {
    socket.emit('board_sub', {}, (res) => {
      if (!res) return;
      loadInto('board', res.msgs);
      ads = Array.isArray(res.ads) ? res.ads : [];
      if (visible()) renderHead();
    });
  }

  // ---------------- események ----------------
  $c('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $c('#chatInput'), text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    const c = current();
    const done = (res) => {
      busy = false;
      if (res && res.error) { setNote(res.error); return; }
      input.value = ''; setNote('');
    };
    if (c === 'room') socket.emit('chat_send', { text }, done);
    else socket.emit('board_send', { text, name: myBoardName() }, done);
  });

  // Jelentés és némítás (gombok az üzenetek mellett)
  $c('#chatLog').addEventListener('click', (e) => {
    const b = e.target.closest('button.cm-act');
    if (!b) return;
    const c = current();
    if (b.dataset.report) {
      const id = Number(b.dataset.report), key = c + ':' + id;
      if (reported.has(key)) return;
      socket.emit(c === 'room' ? 'chat_report' : 'board_report', { id }, (res) => {
        if (res && res.error) { setNote(res.error); return; }
        reported.add(key);
        if (visible()) renderLog();
        setNote(res && res.hidden ? '⚑ Az üzenet több jelentés miatt lekerült.' : '⚑ Jelentetted az üzenetet. Köszönjük, az üzemeltető megnézi.');
      });
      return;
    }
    if (b.dataset.mute) {
      const muted = b.dataset.muted !== '1';
      socket.emit('chat_mute', { playerId: b.dataset.mute, muted }, (res) => {
        if (res && res.error) { setNote(res.error); return; }
        setNote(muted ? '🔇 Elnémítottad a szoba csevegőjében. A gombbal bármikor feloldhatod.' : '🔊 Feloldottad a némítást.');
      });
    }
  });

  $c('#chatAdBtn').addEventListener('click', () => {
    if (busy) return;
    const input = $c('#chatInput');
    busy = true;
    socket.emit('board_ad', { text: input.value.trim() }, (res) => {
      busy = false;
      if (res && res.error) { setNote(res.error); return; }
      input.value = '';
      setNote('📣 Kihirdetted a szobád (kód: ' + res.code + '). A hirdetés addig látszik, amíg a lobbiban vagytok és van hely.');
    });
  });

  $c('#chatAds').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.adRemove) { socket.emit('board_ad_remove', {}); return; }
    if (t.dataset.adCopy) { copyRoomLink(t.dataset.adCopy); return; }
    if (t.dataset.adQr) {
      if (qrOpen.has(t.dataset.adQr)) qrOpen.delete(t.dataset.adQr); else qrOpen.add(t.dataset.adQr);
      renderHead();
      return;
    }
    if (t.dataset.adJoin && window.kbJoinFriendRoom) {
      if (window.kbJoinFriendRoom(t.dataset.adJoin)) setOpen(false, false);
    }
  });

  // 🔔 / 🔕: hang új üzenetnél (szoba, közös tér, privát üzenet)
  const paintSound = () => {
    const on = window.kbSound ? window.kbSound.enabled() : true;
    const b = $c('#chatSoundBtn');
    b.textContent = on ? '🔔' : '🔕'; b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Hang új üzenetnél: be (kattints a kikapcsoláshoz)' : 'Hang új üzenetnél: ki (kattints a bekapcsoláshoz)';
  };
  $c('#chatSoundBtn').addEventListener('click', () => {
    if (!window.kbSound) return;
    window.kbSound.setEnabled(!window.kbSound.enabled());
    paintSound();
    if (window.kbSound.enabled()) window.kbSound.chat(); // meghallgathatod, milyen
  });
  paintSound();

  $c('#chTabRoom').addEventListener('click', () => setChannel('room'));
  $c('#chTabBoard').addEventListener('click', () => setChannel('board'));
  $c('#chatFab').addEventListener('click', () => setOpen(true));
  $c('#chatClose').addEventListener('click', () => {
    if (screen() === 'game') { gameTab = false; apply(); } else setOpen(false);
  });
  $c('#sbTabScores').addEventListener('click', () => { gameTab = false; apply(); });
  $c('#sbTabChat').addEventListener('click', () => { gameTab = true; apply(); setTimeout(() => { const i = $c('#chatInput'); if (i && matchMedia('(min-width: 701px)').matches) i.focus(); }, 40); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && visible() && document.activeElement === $c('#chatInput')) {
      if (screen() === 'game') { gameTab = false; apply(); } else setOpen(false);
    }
  });
  window.addEventListener('resize', () => { if (!$c('#chatPanel').classList.contains('hidden')) place(); });

  socket.on('chat_msg', (m) => add('room', m));
  socket.on('board_msg', (m) => add('board', m));
  // Moderáció: egy szobai üzenetet jelentettek (jelzés mindenkinek), vagy egy közös-téri üzenet lekerült (jelentések / üzemeltető).
  socket.on('chat_flag', (p) => {
    if (!p || typeof p.id !== 'number') return;
    flags.set(p.id, Number(p.count) || 1);
    if (visible() && current() === 'room') renderLog();
  });
  socket.on('board_remove', (p) => {
    if (!p || typeof p.id !== 'number') return;
    board.msgs = board.msgs.filter((m) => m.id !== p.id);
    if (visible() && current() === 'board') renderLog();
  });
  // A szoba állapota változott (pl. a házigazda némított valakit): a gombok és a beviteli mező frissül.
  // (csak akkor rajzol újra, ha a házigazda vagy a némítottak köre tényleg változott: az állapot gyakran érkezik)
  let modSig = '';
  socket.on('state', () => {
    const sig = (typeof S !== 'undefined' && S && S.players ? (S.hostId || '') + '|' + S.players.filter((p) => p.chatMuted).map((p) => p.id).join(',') : '');
    if (sig === modSig) return;
    modSig = sig;
    if (visible() && inRoom()) { renderHead(); if (current() === 'room') renderLog(); }
  });
  socket.on('board_ads', (list) => {
    ads = Array.isArray(list) ? list : [];
    if (visible() && current() === 'board') renderHead();
  });
  socket.on('connect', subscribe);
  if (socket.connected) subscribe();

  // Képernyőváltás: szobán kívül nincs szoba-csatorna (az előzmény törlődik); a széles lobbiba lépve a csevegő dokkolva nyitva indul.
  document.addEventListener('kb:screen', () => {
    const s = screen(), now = ['lobby', 'game'].includes(s);
    if (!now && wasInRoom) { clearRoom(); channel = 'room'; gameTab = false; }
    if (now && !wasInRoom && s === 'lobby') {
      let pref = null;
      try { pref = localStorage.getItem('kb_chat_open'); } catch (_) { /* */ }
      if (pref !== '0' && innerWidth >= DOCK_MIN_WIDTH) open = true;
    }
    // A játék kezdetekor a lebegő panel bezárul, az oldalsáv a ponttáblával indul; a CSEVEGŐ fülre bármikor átválthatsz.
    if (s === 'game' && lastScreen === 'lobby') { open = false; gameTab = false; }
    if (!['lobby', 'name', 'menu'].includes(s) && s !== 'game') open = false;
    wasInRoom = now; lastScreen = s;
    apply();
  });

  window.kbChat = { load, clear: clearRoom, resubscribe: subscribe, open: () => setOpen(true), unread: () => room.unread + board.unread };
})();
