'use strict';

// ============================================================
// KAMU BÍRÓSÁG – tárgyalótermi "TV-show" réteg (jelenet-rendező)
//
// A szerver a forrás: ez a modul KIZÁRÓLAG MEGJELENÍT. Nem dönt szerepről, fázisról, pontról, ítéletről, időzítőről vagy szoba-tulajdonról, és nem
// küld játékeseményt a szervernek. A client.js minden `state` után átadja a szerver állapotának kivonatát (kbCourt.update), az időzítő-ciklusból
// pedig a szerver által adott hátralévő időt (kbCourt.tick) – nincs második, kliens-oldali óra. Minden hívás védett: hiba esetén a játék a régi
// módon fut tovább.
//
// Rétegek (public/index.html, a #stage-ben): intro, bizonyíték, kihívás, ítélet-pecsét, visszaszámlálás; a pont-felrepülés fix réteg.
// A kamera (#courtCamera) a jelenet fókuszát mozgatja a fázis szerint; mozgás-csökkentésnél a kamera áll, a kiemelő vignetta marad.
// Grafika: csak a meglévő raszter-assetek; ez a fájl nem rajzol karaktert, tárgyalótermet, zászlót vagy címert (SVG sincs benne).
// ============================================================
(() => {
  const cfg = window.kbCourtConfig = Object.assign({ scene: 'hu' }, window.kbCourtConfig || {});
  const $ = (sel) => document.querySelector(sel);
  const safe = (fn) => (...args) => { try { return fn(...args); } catch (e) { console.warn('[court]', e && e.message); return undefined; } };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssEsc = (v) => ((window.CSS && CSS.escape) ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, ''));
  const reduced = () => document.body.classList.contains('reduced-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const play = (name) => { try { if (window.kbSound && window.kbSound.play) window.kbSound.play(name); } catch (_) { /* a hang nem kötelező */ } };

  // ---------------- 1) FÁZIS → MEGJELENÍTÉS (egyetlen leképezés) ----------------
  // A kulcsok a szerver fázis-nevei (game.js PHASES). cam: melyik szereplőre fókuszál a kamera; sub: a HUD alcíme.
  const PHASE_UI = {
    lobby:             { sub: 'A bíróság összegyűlik.',                    cam: 'wide' },
    accusation:        { sub: 'A bíróság ismerteti az ügyet.',            cam: 'judge' },
    prep:              { sub: 'Rendezzétek a bizonyítékokat.',           cam: 'wide' },
    prosecution:       { sub: 'A vád ismertetése.',                       cam: 'prosecutor' },
    defense:           { sub: 'A vádlott védekezik.',                     cam: 'defendant' },
    defender:          { sub: 'A védelem érvel.',                         cam: 'defender' },
    witness:           { sub: 'A bíróság hallgat.',                       cam: 'witness' },
    final_prosecution: { sub: 'Utolsó érvek a vád oldaláról.',            cam: 'prosecutor' },
    final_defense:     { sub: 'Utolsó esély a vádlottnak.',               cam: 'defendant' },
    objection:         { sub: 'A bíró dönt.',                             cam: 'judge' },
    verdict_vote:      { sub: 'Az esküdtszék dönt: bűnös vagy ártatlan?', cam: 'wide' },
    challenge_vote:    { sub: 'Teljesítették? Az esküdtszék dönt.',       cam: 'wide' },
    challenge_review:  { sub: 'A bíró ellenőrzi a kihívást.',             cam: 'judge' },
    verdict:           { sub: 'Rendet a teremben!',                       cam: 'judge' },
    round_results:     { sub: 'Az ítélet bekerült az aktába.',            cam: 'wide' },
    game_over:         { sub: 'Megszületett a végső rangsor.',            cam: 'wide' }
  };
  const ROLE_WORD = { prosecutor: 'ÜGYÉSZ', defendant: 'VÁDLOTT', defender: 'VÉDŐÜGYVÉD', witness: 'TANÚ', judge: 'BÍRÓ', juror: 'ESKÜDT' };
  const TIMED = ['prosecution', 'defense', 'defender', 'witness', 'final_prosecution', 'final_defense', 'prep', 'verdict_vote', 'challenge_vote', 'objection'];

  // A tiltakozás védekezés-szakaszában a megtámadott beszélőre fókuszál a kamera, a döntésnél a bíróra.
  function phaseUi(phase, snap) {
    const base = PHASE_UI[phase] || { sub: '', cam: 'wide' };
    if (phase === 'objection' && snap && snap.objection && snap.objection.phase === 'defense') {
      return { sub: 'A megtámadott beszélő védekezik.', cam: snap.objection.speakerRole || 'judge' };
    }
    return base;
  }

  // ---------------- 2) KAMERA ----------------
  // s: nagyítás, ox / oy: a fókusz-pont a jelenet %-ában (innen nagyít, és enyhén ide húz). Szándékosan finom (max. ~7%).
  const CAMERA = {
    wide:       { s: 1,    ox: 50, oy: 55 },
    judge:      { s: 1.05, ox: 50, oy: 30 },
    prosecutor: { s: 1.07, ox: 24, oy: 48 },
    defendant:  { s: 1.06, ox: 50, oy: 62 },
    defender:   { s: 1.06, ox: 66, oy: 62 },
    witness:    { s: 1.07, ox: 80, oy: 44 }
  };
  const st = {
    cam: 'wide', camKey: '', lastCase: '', snap: null, intro: null, introActive: false, verdictActive: false, verdictKey: '',
    scoreSeen: {}, scoreQueue: [], countdown: 0, evidenceKey: '', challengeKey: '', timers: new Set(), phase: '', verdictObj: null,
    reveal: null, revealKey: '', stingerPhase: '', stingerT: 0, reviewCase: '', reviewSeen: {}, winnerObj: null, winnerKey: ''
  };
  const later = (fn, ms) => { const t = setTimeout(() => { st.timers.delete(t); safe(fn)(); }, ms); st.timers.add(t); return t; };
  const cancel = (t) => { if (t) { clearTimeout(t); st.timers.delete(t); } };

  function focus(kind) {
    const cam = $('#courtCamera'), glow = $('#courtFocus');
    const c = CAMERA[kind] || CAMERA.wide;
    st.cam = CAMERA[kind] ? kind : 'wide';
    if (cam) {
      cam.dataset.cam = st.cam;
      if (reduced()) ['--cam-x', '--cam-y', '--cam-s', '--cam-ox', '--cam-oy'].forEach((p) => cam.style.removeProperty(p));
      else {
        cam.style.setProperty('--cam-ox', c.ox + '%'); cam.style.setProperty('--cam-oy', c.oy + '%'); cam.style.setProperty('--cam-s', String(c.s));
        cam.style.setProperty('--cam-x', ((50 - c.ox) * 0.05).toFixed(2) + '%'); cam.style.setProperty('--cam-y', ((50 - c.oy) * 0.04).toFixed(2) + '%');
      }
    }
    if (glow) { glow.dataset.focus = st.cam; glow.classList.toggle('active', st.cam !== 'wide'); }
  }

  const shake = () => {
    if (reduced()) return;
    const el = $('#stage');
    if (!el) return;
    el.classList.remove('court-shake'); void el.offsetWidth; el.classList.add('court-shake');
    later(() => el.classList.remove('court-shake'), 520);
  };

  // ---------------- OVERLAY-MENEDZSER ----------------
  // Egyszerre legfeljebb EGY nagy (cinematic) overlay látszik a jelenet közepén: kör-intro, ítélet, kihívás-kártya, bizonyíték. Az intro és az ítélet KRITIKUS:
  // azonnal átveszi a helyet (az éppen látszó átmeneti kártyát elengedi). A többi sorban vár (prioritás szerint), és ha várakozás közben fázis váltott, elmarad
  // (elavult kártyát nem mutatunk). Ezek MIND átmenetiek: néhány másodperc után maguktól eltűnnek; tartós információ (kártyáim, idő, pontok) a széleken él.
  const OVL = { reveal: { critical: true, prio: 6 }, intro: { critical: true, prio: 5 }, verdict: { critical: true, prio: 4 }, challenge: { prio: 3 }, evidence: { prio: 2 } };
  const ov = { active: null, queue: [] };
  function ovStart(o) {
    ov.active = o;
    document.body.dataset.courtMajor = o.kind;
    o.show();
    if (o.dur) o.timer = later(() => ovEnd(o), o.dur);
  }
  function ovEnd(o, quick) {
    if (!o || ov.active !== o) return;
    cancel(o.timer);
    ov.active = null;
    delete document.body.dataset.courtMajor;
    try { o.hide(quick); } catch (e) { console.warn('[court]', e && e.message); }
    later(ovNext, quick || reduced() ? 0 : 360);
  }
  function ovNext() {
    if (ov.active) return;
    while (ov.queue.length) {
      const o = ov.queue.shift();
      if (o.phase && st.phase !== o.phase) continue;
      ovStart(o);
      return;
    }
  }
  function present(o) {
    Object.assign(o, OVL[o.kind]);
    if (!ov.active) return ovStart(o);
    if (o.critical && !ov.active.critical) { ovEnd(ov.active, true); return ovStart(o); }
    ov.queue.push(o);
    ov.queue.sort((x, y) => y.prio - x.prio);
  }

  // ---------------- 3) KÖR-INTRO ----------------
  // "N. TÁRGYALÁS – AZ ÁLLAM VS. <vádlott> – VÁD: <vád>" a szerver állapotából (kör, vádlott, vád), majd "A TÁRGYALÁS MEGKEZDŐDIK!" + kalapács.
  // Kihagyható (kattintás / Esc / Enter / szóköz). Mozgás-csökkentésnél rövidebb, mozgás nélkül.
  function introEnd() { if (st.intro && st.intro.o) ovEnd(st.intro.o); }
  function introStep2() {
    const el = $('#courtIntro');
    if (!st.intro || st.intro.step === 2 || !el) return;
    st.intro.step = 2;
    cancel(st.intro.t1);
    // A kalapácsot a bíró saját figurája üti (judgeSmash); ide csak a felirat kerül – új kalapács-rajz nincs.
    el.innerHTML = '<div class="court-open"><div class="co-text">A TÁRGYALÁS<br>MEGKEZDŐDIK!</div></div>';
    el.classList.add('step2');
    if (typeof window.judgeSmash === 'function') window.judgeSmash(); else play('gavel');
    play('intro-open');
    shake();
    st.intro.t3 = later(introEnd, reduced() ? 700 : 1200);
  }
  const showIntro = safe((snap) => {
    const el = $('#courtIntro');
    if (!el || !snap.accusationText) return;
    const role = snap.myRole && ROLE_WORD[snap.myRole] ? '<div class="ci-role">A TE SZEREPED: <b>' + esc(ROLE_WORD[snap.myRole]) + '</b></div>' : '';
    const html = '<div class="court-intro-card court-parchment">' +
      '<div class="ci-kicker">' + esc(snap.round) + '. TÁRGYALÁS' + (snap.totalRounds > 1 ? ' <small>/ ' + esc(snap.totalRounds) + '</small>' : '') + '</div>' +
      '<div class="ci-vs">AZ ÁLLAM <span>VS.</span> ' + esc(snap.names.defendant || 'GYANÚSÍTOTT') + '</div>' +
      '<div class="ci-label">VÁD</div><div class="ci-charge">' + esc(snap.accusationText) + '</div>' + role +
      '<div class="court-stamp">BEIDÉZVE</div><div class="ci-skip">Kihagyás: kattintás vagy Esc</div></div>';
    const o = {
      // Nem fázishoz kötött: a szerep-felfedés (2,7 s) alatt a vád felolvasása után a játék továbbléphet (botok / gyors házigazda), de a kör-intro a tárgyalás
      // bemutatása mindenkinek – legfeljebb ~3 s késéssel, rövidített első lépéssel játszódik le (a felfedés mögött várakozó intro nem avul el).
      kind: 'intro', phase: '', dur: 0,
      show() {
        const late = st.phase !== 'accusation';
        el.className = 'court-intro';
        el.innerHTML = html;
        el.classList.remove('hidden');
        requestAnimationFrame(() => el.classList.add('show'));
        st.introActive = true;
        document.body.classList.add('court-intro-on');
        st.intro = { step: 1, o, late };
        play('intro');
        st.intro.t1 = later(introStep2, reduced() ? 1200 : late ? 2000 : 2800);
      },
      hide() {
        if (st.intro) { cancel(st.intro.t1); cancel(st.intro.t3); }
        el.classList.remove('show', 'step2');
        later(() => { el.classList.add('hidden'); el.innerHTML = ''; }, reduced() ? 0 : 320);
        st.introActive = false; st.intro = null;
        document.body.classList.remove('court-intro-on');
      }
    };
    present(o);
  });
  const skipIntro = () => {
    if (st.reveal && st.reveal.o && ov.active === st.reveal.o) { ovEnd(st.reveal.o); return; } // a szerep-felfedés is kihagyható
    if (!st.introActive || !st.intro) return;
    if (st.intro.step === 1) introStep2(); else introEnd();
  };
  // A réteg áteresztő (pointer-events: none), ezért a kattintást az egész jelenet-zónán figyeljük, míg az intro / a szerep-felfedés látszik.
  document.addEventListener('click', (e) => { if ((st.introActive || st.reveal) && e.target && e.target.closest && e.target.closest('#stage, #courtIntro, #courtReveal')) skipIntro(); });
  document.addEventListener('keydown', (e) => { if ((st.introActive || st.reveal) && ['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); skipIntro(); } });

  // ---------------- 3b) SZEREP-FELFEDÉS ----------------
  // Minden új tárgyalás elején, a szerver kiosztotta szerepről: "TE VAGY A <SZEREP>", a SAJÁT avatárod szerep-képével (kbAvatarRoles.getRoleAvatar: szerep-kép, ennek
  // hiányában az eredeti avatár portréja). Csak megjelenít: a szerep a szerver állapotából jön (snap.myRole), nem a kliens dönti el. 2–3 mp, kihagyható (kattintás / Esc).
  const REVEAL = {
    judge:      { art: 'A',  word: 'BÍRÓ',       icon: '⚖️', color: '#f2c14e' },
    prosecutor: { art: 'AZ', word: 'ÜGYÉSZ',     icon: '🔥', color: '#e5484d' },
    defendant:  { art: 'A',  word: 'VÁDLOTT',    icon: '⛓️', color: '#f5a524' },
    defender:   { art: 'A',  word: 'VÉDŐÜGYVÉD', icon: '🛡️', color: '#3b82f6' },
    witness:    { art: 'A',  word: 'TANÚ',       icon: '📜', color: '#22c55e' },
    juror:      { art: 'AZ', word: 'ESKÜDT',     icon: '👥', color: '#a78bfa' }
  };
  const showReveal = safe((snap) => {
    const el = $('#courtReveal'), R = REVEAL[snap.myRole];
    if (!el || !R || snap.phase !== 'accusation') return;
    const key = snap.round + '|' + snap.caseNo + '|' + snap.myRole;
    if (st.revealKey === key) return;
    st.revealKey = key;
    let seen = '';
    try { seen = sessionStorage.getItem('kb_reveal_case') || ''; } catch (_) { /* nincs tár */ }
    if (seen === key) return; // oldal-újratöltés után ugyanarra a körre nem ismétlődik
    try { sessionStorage.setItem('kb_reveal_case', key); } catch (_) { /* nincs tár */ }
    const art = window.kbAvatarRoles ? window.kbAvatarRoles.getRoleAvatar(snap.myAvatar, snap.myRole) : { kind: 'generic', src: '' };
    const media = art.kind === 'sprite' ? '<img class="rv-sprite" src="' + esc(art.src) + '" alt="" decoding="async">'
      : art.kind === 'portrait' ? '<span class="rv-portrait"><img src="' + esc(art.src) + '" alt="" decoding="async"></span>'
      : '<span class="rv-emoji" aria-hidden="true">' + R.icon + '</span>';
    const round = esc(snap.round) + '. TÁRGYALÁS' + (snap.totalRounds > 1 ? ' / ' + esc(snap.totalRounds) : '');
    const html = '<div class="rv-stage"><div class="rv-round">' + round + '</div><div class="rv-kicker">TE VAGY ' + R.art + '</div>' +
      '<div class="rv-title"><span class="rv-icon" aria-hidden="true">' + R.icon + '</span> ' + esc(R.word) + '</div>' + media + '<div class="rv-skip">Kihagyás: kattintás vagy Esc</div></div>';
    const o = {
      kind: 'reveal', phase: 'accusation', dur: reduced() ? 1500 : 2700,
      show() {
        st.reveal = { o };
        el.className = 'court-reveal role-' + snap.myRole;
        el.style.setProperty('--rv', R.color);
        el.innerHTML = html;
        el.querySelector('.rv-title').style.setProperty('--len', String(R.word.length + 1));
        el.classList.remove('hidden');
        if (!reduced()) {
          let dust = '';
          for (let i = 0; i < 14; i++) dust += '<i class="rv-dust" style="--x:' + (6 + Math.random() * 88).toFixed(1) + '%;--d:' + (2.4 + Math.random() * 2.2).toFixed(2) + 's;--w:' + (Math.random() * 1.6).toFixed(2) + 's;--s:' + (3 + Math.random() * 4).toFixed(1) + 'px"></i>';
          el.insertAdjacentHTML('beforeend', '<div class="rv-dusts" aria-hidden="true">' + dust + '</div>');
        }
        const go = () => { if (st.reveal && st.reveal.o === o) { el.classList.add('show'); play('reveal'); } };
        const img = el.querySelector('.rv-sprite, .rv-portrait img');
        if (img && img.decode) Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 650))]).then(go); else requestAnimationFrame(go);
      },
      hide(quick) {
        st.reveal = null;
        el.classList.remove('show');
        later(() => { el.classList.add('hidden'); el.innerHTML = ''; }, quick || reduced() ? 0 : 320);
      }
    };
    present(o);
  });

  // Egy átmeneti kártya-overlay (bizonyíték / kihívás) közös megjelenítője: a tartalmat a hívó adja, az eltűnést a menedzser időzíti.
  function cardOverlay(kind, elId, className, html, sound, dur) {
    const el = $(elId);
    if (!el) return;
    present({
      kind, phase: st.phase, dur,
      show() {
        el.className = className;
        el.innerHTML = html;
        el.classList.remove('hidden');
        // a kártya a KÁRTYÁIM kézből "emelkedik fel" a jelenet felé (kezdőpont: a kéz közepe; csak transform / opacity animálódik)
        try {
          const bar = $('#myCardsBar'), r = bar && bar.getBoundingClientRect(), er = el.getBoundingClientRect();
          if (r && r.width && er.width && !reduced()) {
            el.style.setProperty('--from-x', Math.round((r.left + r.width / 2) - (er.left + er.width / 2)) + 'px');
            el.style.setProperty('--from-y', Math.round((r.top + r.height / 2) - (er.top + er.height * 0.3)) + 'px');
          }
        } catch (_) { /* a kezdőpont csak díszítés */ }
        requestAnimationFrame(() => el.classList.add('show'));
        play('card-play'); // a lap felemelkedik a kézből
        play(sound);
      },
      hide(quick) {
        el.classList.remove('show');
        later(() => { el.classList.add('hidden'); el.innerHTML = ''; }, quick || reduced() ? 0 : 320);
      }
    });
  }

  // ---------------- 4) BIZONYÍTÉK ----------------
  // Valódi játékesemény: a felkészülés elején az ügyész és a védő megkapja a bizonyítékokat (a szerver csak nekik küldi); a kör végén, a leleplezésnél
  // mindenki látja az összes kártyát. Csak a játék által adott szöveg jelenik meg. (A kártyák tartósan a KÁRTYÁIM-ban vannak; ez csak a rövid bemutató.)
  const showEvidence = safe((snap, items, label, key) => {
    if (!items || !items.length || st.evidenceKey === key) return;
    st.evidenceKey = key;
    const rows = items.slice(0, 4).map((t, i) => '<li><b>#' + String(i + 1).padStart(2, '0') + '</b><span>' + esc(t) + '</span></li>').join('');
    cardOverlay('evidence', '#courtEvidence', 'court-evidence',
      '<div class="evidence-folder"><div class="ev-tab">' + esc(label) + ' · ' + esc(snap.caseNo || 'AKTA') + '</div>' +
      '<ol class="ev-list">' + rows + '</ol><div class="court-stamp ev-stamp">AKTÁBA VÉVE</div></div>', 'evidence', reduced() ? 1600 : 2800);
  });

  // ---------------- 5) KIHÍVÁSKÁRTYA ----------------
  // Rövid (1,5–2,5 mp) bemutató; utána a kártya eltűnik, és a bíró kompakt ellenőrző sávja marad (nincs két nagy kihívás-felület egyszerre).
  const showChallenge = safe((snap, title, lines, key, note) => {
    if (!lines || !lines.length || st.challengeKey === key) return;
    st.challengeKey = key;
    const body = lines.map((l) => '<div class="cc-line">' + (l.who ? '<b>' + esc(l.who) + '</b> ' : '') + esc(l.text) + '</div>').join('');
    cardOverlay('challenge', '#courtChallenge', 'court-challenge',
      '<div class="challenge-card court-parchment"><div class="cc-kicker cc-slam">⚔️ KIHÍVÁS!</div><div class="cc-title">' + esc(title) + '</div>' + body +
      (note ? '<div class="cc-note">' + esc(note) + '</div>' : '') + '<div class="court-stamp cc-stamp">KIHÍVÁS</div></div>', 'challenge', reduced() ? 1500 : 2200);
  });

  // ---------------- 6) ÍTÉLET ----------------
  // A szerver ítélete (snap.verdict) indítja; az animáció csak megjeleníti. Sorrend: bíró-fókusz → (a kalapácsot a client.js ütteti meg a fázisváltáskor)
  // → ütés-villanás, rázkódás, pecsét → vádlott-fókusz → eltűnik. Ha közben tovább lép a fázis (a házigazda gyorsan lép), a réteg kecsesen elhal;
  // a pontok mindenképp megjelennek.
  const showVerdict = safe((snap) => {
    const el = $('#courtVerdict'), v = snap.verdict;
    if (!el || !v || typeof v.guilty !== 'boolean') return;
    const key = snap.round + '|' + snap.caseNo + '|' + v.guilty;
    if (st.verdictKey === key) return;
    st.verdictKey = key;
    const guilty = !!v.guilty;
    const tally = (Number.isInteger(v.guiltyVotes) && Number.isInteger(v.notGuiltyVotes)) ? v.guiltyVotes + ' : ' + v.notGuiltyVotes : '';
    const o = {
      kind: 'verdict', phase: 'verdict', dur: 0,
      show() {
        st.verdictActive = true; st.verdictObj = o;
        focus('judge');
        // 1) várakozás: a háttér elsötétül, a bíró a fókuszban, "ÍTÉLETHIRDETÉS" – még nincs ítélet-kártya
        el.className = 'court-verdict anticipate';
        el.innerHTML = '<div class="vd-ante"><span class="vd-ante-icon" aria-hidden="true">🔨</span><span class="vd-ante-text">ÍTÉLETHIRDETÉS</span></div>';
        requestAnimationFrame(() => el.classList.add('show'));
        play('stinger');
        // 2) a kalapács-ütés: a bíró kalapácsa + ütés-hang, a színpad megrázkódik, az ítélet-hang / konfetti / galambok (client.js verdictCue), majd a nagy felfedés
        st.vT1 = later(() => {
          if (typeof window.judgeSmash === 'function') window.judgeSmash(); else play('gavel');
          shake();
          if (typeof window.verdictCue === 'function') window.verdictCue(v);
          el.className = 'court-verdict impact ' + (guilty ? 'flash-guilty' : 'flash-acquitted');
          el.innerHTML = '<div class="verdict-card court-parchment ' + (guilty ? 'guilty' : 'acquitted') + '">' +
            '<div class="verdict-kicker">A BÍRÓSÁG ÍTÉLETE</div><div class="verdict-name">' + esc(snap.names.defendant || 'A VÁDLOTT') + '</div>' +
            '<div class="vd-headline">' + (guilty ? 'BŰNÖS!' : 'ÁRTATLAN!') + '</div>' +
            '<div class="court-stamp">' + (guilty ? 'BŰNÖS' : 'FELMENTVE') + '</div>' +
            '<div class="verdict-sub">' + (tally ? '<b>' + esc(tally) + '</b> ' : '') + '</div>' + (v.unanimous ? '<div class="verdict-unanimous">EGYHANGÚ ÍTÉLET – BÓNUSZPONT</div>' : '') + '</div>';
          requestAnimationFrame(() => el.classList.add('show'));
          st.vT2 = later(() => focus('defendant'), reduced() ? 900 : 1500);
          st.vT3 = later(() => ovEnd(o), reduced() ? 1500 : 2700);
        }, reduced() ? 220 : 1000);
      },
      hide(quick) {
        cancel(st.vT1); cancel(st.vT2); cancel(st.vT3);
        st.verdictActive = false; st.verdictObj = null;
        el.classList.remove('show');
        later(() => { el.className = 'court-verdict hidden'; el.innerHTML = ''; }, quick || reduced() ? 0 : 340);
        flushScore(false);
        // ESKÜDT-MÓD: a kihívások eredménye (a szerver ítélet-állapotából), sorban, a nagy felület eltűnése után
        if (!quick && Array.isArray(v.challengeResults)) {
          v.challengeResults.slice(0, 3).forEach((r, i) => later(() => challengeResultFx(!!r.done, (snap.names && snap.names[r.who]) || ''), 500 + i * 1500));
        }
      }
    };
    present(o);
  });

  // ---------------- 7b) GYŐZTES ----------------
  // A játék végén (szerver: game_over, S.gameOver.ranking) a győztes nagy avatárral áll a spotlightban; az alsó panelben a helyezések (pódium, díjak, gombok) élnek.
  // Csak megjelenít: a rangsort a szerver adja. A győztes képe: a legjobb szerep-kép (tanú-póz: felemelt kéz), különben az eredeti avatár portréja.
  // A réteg a game_over alatt marad (nem akadályoz: áteresztő, a panel gombjai fölötte vannak), a fázis elhagyásakor eltűnik.
  const WINNER_POSES = ['witness', 'prosecutor', 'judge', 'juror', 'defendant'];
  function winnerArt(avatar) {
    const ra = window.kbAvatarRoles;
    if (!ra) return { kind: 'generic', src: '' };
    for (const role of WINNER_POSES) { const a = ra.getRoleAvatar(avatar, role); if (a.kind === 'sprite') return a; }
    return ra.getRoleAvatar(avatar, 'juror');
  }
  // A győztes-réteg a lenti eredmény-panel tetejéig tart (a panel magassága felbontásonként más): a név és a pont soha nem csúszik alá.
  const fitWinner = safe(() => {
    const el = $('#courtWinner'), panel = $('#scenePanel'), stage = $('#stage');
    if (!el || !panel || !stage || el.classList.contains('hidden') || !panel.getClientRects().length) return;
    const tf = getComputedStyle(panel).transform, dy = tf && tf !== 'none' ? new DOMMatrixReadOnly(tf).f : 0; // a belépő eltolás ne számítson bele
    const top = panel.getBoundingClientRect().top - dy - stage.getBoundingClientRect().top;
    el.style.setProperty('--wn-limit', Math.max(220, Math.round(top - 6)) + 'px');
  });
  window.addEventListener('resize', () => fitWinner());
  const showWinner = safe((snap) => {
    const el = $('#courtWinner'), go = snap.gameOver, rank = go && go.ranking;
    if (!el || !rank || !rank.length) return;
    const key = (snap.caseNo || '') + '|' + rank.map((p) => p.id + ':' + p.score).join(',');
    if (st.winnerKey === key && st.winnerObj) return;
    if (st.winnerObj) ovEnd(st.winnerObj, true);
    st.winnerKey = key;
    const top = rank[0].score, winners = rank.filter((p) => p.score === top).slice(0, 3), w = winners[0];
    const art = winnerArt(w.avatar);
    const media = art.kind === 'sprite' ? '<img class="wn-sprite" src="' + esc(art.src) + '" alt="" decoding="async">'
      : art.kind === 'portrait' ? '<span class="wn-portrait"><img src="' + esc(art.src) + '" alt="" decoding="async"></span>' : '<span class="wn-emoji" aria-hidden="true">🏆</span>';
    const names = winners.map((p) => esc(p.name)).join(' &amp; ');
    const html = '<div class="wn-stage"><div class="wn-spot" aria-hidden="true"></div><div class="wn-kicker">A TÁRGYALÁSOK VÉGE</div>' +
      '<div class="wn-title">' + (winners.length > 1 ? 'GYŐZTESEK' : 'GYŐZTES') + '</div>' +
      '<div class="wn-hero"><span class="wn-crown" aria-hidden="true">👑</span>' + media + '</div>' +
      '<div class="wn-name">' + names + '</div><div class="wn-score"><b>' + esc(top) + '</b> pont · 1. HELY</div></div>';
    const o = {
      kind: 'winner', phase: 'game_over', dur: 0,
      show() {
        st.winnerObj = o;
        el.className = 'court-winner';
        el.innerHTML = html;
        el.classList.remove('hidden');
        fitWinner(); later(fitWinner, 450); later(fitWinner, 1400); // a lenti panel belépő mozgása után is a végleges magassághoz igazodik
        const img = el.querySelector('.wn-sprite, .wn-portrait img');
        const go2 = () => { if (st.winnerObj === o) { el.classList.add('show'); play('victory'); } };
        if (img && img.decode) Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 650))]).then(go2); else requestAnimationFrame(go2);
      },
      hide(quick) {
        if (st.winnerObj === o) st.winnerObj = null;
        el.classList.remove('show');
        later(() => { el.classList.add('hidden'); el.innerHTML = ''; }, quick || reduced() ? 0 : 320);
      }
    };
    present(o);
  });

  // ---------------- 7) PONT-FELREPÜLÉS ----------------
  // A szerver scoreEvents-éből (ki, mennyi, miért): a "+N" az avatár névtáblájánál felrepül, a ponttábla sora pulzál. Szabályt nem találunk ki:
  // ami nincs az eseményben, az nem jelenik meg; az ok csak a szerver által adott fajtából (kind) származik.
  const SCORE_REASON = {
    prosecution: 'ELÍTÉLÉS', defense: 'FELMENTÉS', defender: 'SIKERES VÉDELEM', unanimous: 'EGYHANGÚ ÍTÉLET',
    juror: 'JÓ ÍTÉLET', challenge: 'SIKERES KIHÍVÁS', favorite: 'KÖZÖNSÉGKEDVENC'
  };
  function anchorFor(pid, judgeId) {
    const q = (sel) => { const e = document.querySelector(sel); const r = e && e.getBoundingClientRect(); return r && r.width && r.height ? r : null; };
    let r = q('#stagePlates .stage-plate[data-pid="' + cssEsc(pid) + '"]');
    if (!r && pid === judgeId) r = q('#judgePlate');
    if (!r) r = q('#sbRows [data-pid="' + cssEsc(pid) + '"]');
    return r;
  }
  function spawnScore(ev, snap, delay) {
    const layer = $('#courtScore');
    if (!layer) return;
    later(() => {
      const r = anchorFor(ev.pid, snap.ids && snap.ids.judge);
      const el = document.createElement('div');
      el.className = 'score-float' + (ev.pid === snap.meId ? ' mine' : '');
      el.innerHTML = '<b>+' + esc(ev.points) + '</b>' + (SCORE_REASON[ev.kind] ? '<span>' + esc(SCORE_REASON[ev.kind]) + '</span>' : '');
      const x = r ? r.left + r.width / 2 : window.innerWidth / 2, y = r ? r.top : window.innerHeight * 0.4;
      el.style.left = Math.max(70, Math.min(window.innerWidth - 70, x)) + 'px';
      el.style.top = Math.max(60, y) + 'px';
      el.setAttribute('aria-hidden', 'true');
      layer.appendChild(el);
      play('points');
      later(() => el.remove(), reduced() ? 1800 : 2600);
      const row = document.querySelector('#sbRows [data-pid="' + cssEsc(ev.pid) + '"]');
      if (row) { row.classList.remove('score-bump'); void row.offsetWidth; row.classList.add('score-bump'); }
    }, delay);
  }
  // Az új (még nem mutatott) események sorba kerülnek; az ítélet-pecsét alatt várnak, utána sorban repülnek fel.
  function queueScore(snap) {
    const events = Array.isArray(snap.scoreEvents) ? snap.scoreEvents : [];
    const key = snap.round + '|' + snap.caseNo;
    const seen = st.scoreSeen[key] || 0;
    const fresh = events.filter((e) => e.seq > seen);
    if (!fresh.length) return;
    st.scoreSeen[key] = Math.max(...fresh.map((e) => e.seq));
    st.scoreQueue.push(...fresh.map((e) => ({ ev: e, snap })));
    if (!st.verdictActive) flushScore(true);
  }
  function flushScore(stagger) {
    const q = st.scoreQueue.splice(0);
    q.forEach((x, i) => spawnScore(x.ev, x.snap, stagger ? 260 * i : 120 * i));
  }

  // ---------------- 8) VISSZASZÁMLÁLÁS ----------------
  // A szerver által adott hátralévő időből (a client.js időzítő-ciklusa hívja): a végén 3-2-1. A tényleges időzítőt nem módosítja.
  const tick = safe((remainingMs, phase) => {
    const el = $('#courtCountdown');
    if (!el) return;
    const n = TIMED.includes(phase) && remainingMs > 0 && remainingMs <= 3000 ? Math.ceil(remainingMs / 1000) : 0;
    if (n === st.countdown) return;
    st.countdown = n;
    if (!n || st.introActive) { el.classList.add('hidden'); return; }
    el.textContent = String(n);
    el.className = 'court-countdown n' + n;
    el.classList.remove('hidden');
    if (!reduced()) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
    play('countdown');
  });

  // ---------------- 8b) FÁZIS-STINGER ÉS KIHÍVÁS-EREDMÉNY ----------------
  // Rövid (0,8–1,3 mp), nem blokkoló sáv a jelenet felső harmadában, a FONTOSABB fázisváltásoknál (a szerver fázisából; nem tart tovább a játéknál). Nem nagy overlay:
  // ha épp nagy overlay (intro, szerep-felfedés, bizonyíték, kihívás, ítélet) látszik vagy várakozik, a stinger kimarad (egyszerre egy nagy felület). Újratöltéskor /
  // újracsatlakozáskor (nincs előző fázis) nem játszódik le.
  const STINGERS = {
    prosecution:       { icon: '🔥', text: 'AZ ÜGYÉSZSÉG KÖVETKEZIK', tone: 'red' },
    defense:           { icon: '⛓️', text: 'A VÁDLOTT VÉDEKEZIK', tone: 'amber' },
    defender:          { icon: '🛡️', text: 'A VÉDELEM ÉRVEL', tone: 'blue' },
    witness:           { icon: '📜', text: 'TANÚKIHALLGATÁS', tone: 'green' },
    final_prosecution: { icon: '🔥', text: 'ZÁRÓBESZÉD – A VÁD', tone: 'red' },
    final_defense:     { icon: '⛓️', text: 'UTOLSÓ SZÓ A VÁDLOTTNAK', tone: 'amber' },
    verdict_vote:      { icon: '👥', text: 'AZ ESKÜDTSZÉK DÖNT', tone: 'purple' },
    challenge_review:  { icon: '⚔️', text: 'A BÍRÓ ELLENŐRZI A KIHÍVÁST', tone: 'gold' }
  };
  function stinger(def, ms) {
    const el = $('#courtStinger');
    if (!el || !def || document.body.dataset.courtMajor || st.introActive || st.reveal) return false;
    cancel(st.stingerT);
    el.className = 'court-stinger';
    let sparks = '';
    if ((def.tone === 'ok' || def.tone === 'fail') && !reduced()) {
      for (let i = 0; i < 10; i++) sparks += '<i class="cs-spark" style="--a:' + (i * 36 + Math.round(Math.random() * 14)) + 'deg;--r:' + (46 + Math.round(Math.random() * 40)) + 'px"></i>';
    }
    el.innerHTML = '<div class="cs-card tone-' + esc(def.tone || 'gold') + '"><span class="cs-icon" aria-hidden="true">' + def.icon + '</span><span class="cs-body"><span class="cs-text">' + esc(def.text) + '</span>' +
      (def.sub ? '<span class="cs-sub">' + esc(def.sub) + '</span>' : '') + '</span>' + (sparks ? '<span class="cs-sparks" aria-hidden="true">' + sparks + '</span>' : '') + '</div>';
    void el.offsetWidth; // az animáció újraindítása
    el.classList.add('show');
    if (def.tone === 'fail') shake();
    play(def.sound || 'stinger');
    st.stingerT = later(() => el.classList.remove('show'), ms || (reduced() ? 900 : def.sub ? 1500 : 1200));
    return true;
  }
  const challengeResultFx = (done, name) => stinger({ icon: done ? '✓' : '✕', text: done ? 'SIKERÜLT' : 'NEM SIKERÜLT', sub: name || '', tone: done ? 'ok' : 'fail', sound: done ? 'challenge-success' : 'challenge-fail' });
  // A bíró döntése a kihívás-ellenőrzésben (élő): az újonnan eldöntött kihívás eredménye. Az első látott állapot (pl. újratöltés után) nem játszódik le újra.
  function trackReview(snap) {
    const rev = snap.phase === 'challenge_review' && snap.challengeReview;
    if (!rev || !Array.isArray(rev.challenges)) return;
    const caseKey = snap.round + '|' + snap.caseNo;
    const fresh = st.reviewCase !== caseKey;
    if (fresh) { st.reviewCase = caseKey; st.reviewSeen = {}; }
    for (const c of rev.challenges) {
      if (!c.judged || st.reviewSeen[c.who]) continue;
      st.reviewSeen[c.who] = true;
      // az eredmény fontosabb az éppen látszó kihívás-kártyánál (gyors bírói döntésnél a kártya még fent lehet): a kártya kecsesen félreáll
      if (!fresh) { if (ov.active && ov.active.kind === 'challenge') ovEnd(ov.active, true); challengeResultFx(!!c.done, c.name); }
    }
  }

  // ---------------- 9) LUSTA ELŐTÖLTÉS ----------------
  // A játékosok szerep-képei tétlen időben, két párhuzamos letöltéssel (nem mind a 250 egyszerre): a mostani szerepek, plusz a valószínű következők
  // (bíró, esküdt). Hiányzó kép: nincs kérés, az avatár alapképe marad.
  const preloaded = new Set();
  const preloadRoles = safe((players, roleOf) => {
    if (!window.kbAvatarRoles || !Array.isArray(players)) return;
    const urls = [];
    for (const p of players.slice(0, 8)) {
      for (const role of [roleOf && roleOf(p.id), 'judge', 'juror']) {
        if (!role) continue;
        const u = window.kbAvatarRoles.spriteFor(p.avatar, role);
        if (u && !preloaded.has(u)) { preloaded.add(u); urls.push(u); }
      }
    }
    let active = 0;
    const pump = () => {
      while (active < 2 && urls.length) {
        const img = new Image();
        active++;
        img.onload = img.onerror = () => { active--; pump(); };
        img.src = urls.shift();
      }
    };
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 250)))(pump);
  });

  // ---------------- 10) FRISSÍTÉS A SZERVER ÁLLAPOTÁBÓL ----------------
  const update = safe((snap) => {
    if (!snap || !snap.phase) return;
    st.snap = snap; st.phase = snap.phase;
    const ui = phaseUi(snap.phase, snap);
    const camKey = snap.phase + ':' + ((snap.objection && snap.objection.phase) || '');
    const caseKey = (snap.caseNo || '') + '|' + snap.round;

    // kamera: csak fázisváltáskor (az ítélet saját sorrendet vezérel)
    if (st.camKey !== camKey && !st.verdictActive) { st.camKey = camKey; focus(ui.cam); }

    // kör-intro: új tárgyalás elején; oldal-újratöltés után ugyanarra az ügyre nem ismétlődik
    if (caseKey !== st.lastCase) {
      st.lastCase = caseKey;
      if (snap.phase === 'accusation') {
        showReveal(snap); // előbb a saját szereped (kritikus overlay), utána a kör-intro (sorban vár)
        let seen = '';
        try { seen = sessionStorage.getItem('kb_intro_case') || ''; } catch (_) { /* nincs tár */ }
        if (seen !== caseKey) { try { sessionStorage.setItem('kb_intro_case', caseKey); } catch (_) { /* nincs tár */ } showIntro(snap); }
      }
    }
    if (st.introActive && snap.phase !== 'accusation' && st.intro && st.intro.step === 1 && !st.intro.late) introStep2();

    // bizonyíték: a felkészülés elején (akinek a szerver adja), és a kör végi leleplezéskor mindenkinek
    if (snap.phase === 'prep' && snap.evidence && snap.evidence.length) showEvidence(snap, snap.evidence, 'BIZONYÍTÉK', caseKey + '|prep');
    const rc = snap.revealedCards;
    if (snap.phase === 'round_results' && rc && rc.evidence && rc.evidence.length) showEvidence(snap, rc.evidence, 'BIZONYÍTÉKOK', caseKey + '|reveal');

    // kihívás: a saját titkos kártya a felkészülés elején; az ellenőrzésnél a soron lévő kihívás; esküdt-szavazásnál a szavazandók
    if (snap.phase === 'prep' && snap.myChallenge) showChallenge(snap, 'TITKOS KIHÍVÁS', [{ text: snap.myChallenge }], caseKey + '|mine', 'CSAK TE LÁTOD');
    if (snap.phase === 'challenge_review' && snap.challengeReview && snap.challengeReview.challenges) {
      const idx = snap.challengeReview.current || 0, c = snap.challengeReview.challenges[idx];
      if (c) showChallenge(snap, 'KIHÍVÁSKÁRTYA', [{ who: c.name, text: c.text }], caseKey + '|review|' + idx, c.difficulty ? 'NEHEZÍTETT KIHÍVÁS · dupla pont' : '');
    }
    if (snap.phase === 'challenge_vote' && snap.challengeVote && snap.challengeVote.challenges && snap.challengeVote.challenges.length) {
      showChallenge(snap, 'KIHÍVÁSOK', snap.challengeVote.challenges.map((c) => ({ who: ROLE_WORD[(c.who || '').toLowerCase()] || ({ prosecutor: 'ÜGYÉSZ', defendant: 'VÁDLOTT', defender: 'VÉDŐÜGYVÉD' }[c.who]) || '', text: c.text })), caseKey + '|vote');
    }

    // ítélet: a szerver ítéletére; ha a fázis elhagyta, a réteg kecsesen elhal
    if (snap.phase === 'verdict') showVerdict(snap);
    else if (st.verdictObj) ovEnd(st.verdictObj, true);

    // győztes: a game_over alatt a spotlightban áll; a fázis elhagyásakor (új játék) eltűnik
    if (snap.phase === 'game_over') showWinner(snap);
    else if (st.winnerObj) ovEnd(st.winnerObj, true);

    // pontok: a szerver eseményeiből, az ítélet után
    if (['verdict', 'challenge_review', 'round_results', 'game_over'].includes(snap.phase)) queueScore(snap);

    // kihívás-eredmény (élő) + fázis-stinger: a nagy overlayek után, hogy egyszerre egy nagy felület látszódjon
    trackReview(snap);
    const prevPhase = st.stingerPhase;
    st.stingerPhase = snap.phase;
    if (prevPhase && prevPhase !== snap.phase && STINGERS[snap.phase] && !ov.active && !ov.queue.length) stinger(STINGERS[snap.phase]);
  });

  // A lobbiba / menübe lépéskor a rétegek takarítása (új játék, kilépés).
  const reset = safe(() => {
    for (const t of st.timers) clearTimeout(t);
    document.body.classList.remove('court-intro-on');
    ov.active = null; ov.queue = []; delete document.body.dataset.courtMajor;
    Object.assign(st, { timers: new Set(), introActive: false, verdictActive: false, verdictObj: null, intro: null, camKey: '', lastCase: '', verdictKey: '', evidenceKey: '', challengeKey: '', scoreQueue: [], scoreSeen: {}, countdown: 0, phase: '', reveal: null, revealKey: '', stingerPhase: '', stingerT: 0, reviewCase: '', reviewSeen: {}, winnerObj: null, winnerKey: '' });
    for (const id of ['#courtWinner', '#courtIntro', '#courtEvidence', '#courtChallenge', '#courtVerdict', '#courtCountdown', '#courtReveal']) {
      const el = $(id);
      if (el) { el.classList.add('hidden'); el.classList.remove('show', 'step2'); el.innerHTML = ''; }
    }
    const sc = $('#courtScore'); if (sc) sc.innerHTML = '';
    const sg = $('#courtStinger'); if (sg) { sg.classList.remove('show'); sg.innerHTML = ''; }
    focus('wide');
  });
  document.addEventListener('kb:screen', (e) => { if (e.detail !== 'game') reset(); });

  // Teszt / hibakeresés: a megjelenítés pillanatnyi állapota (nem játékállapot).
  const getState = () => ({ camera: st.cam, introActive: st.introActive, revealActive: !!st.reveal, timers: st.timers.size, verdictActive: st.verdictActive, countdown: st.countdown, phase: st.phase, preloaded: preloaded.size, major: ov.active ? ov.active.kind : '', queued: ov.queue.map((o) => o.kind) });

  // ---------------- 11) AVATÁR × SZEREP KÉPEK ----------------
  // A szerver listája a feltöltött szerep-képekről (/api/role-sprites); hiányzó képnél az eredeti avatár marad (nincs SVG-tartalék).
  const loadRoleSprites = safe(() => {
    if (!window.kbAvatarRoles || typeof fetch !== 'function') return;
    fetch('/api/role-sprites', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then(safe((d) => {
      if (!d || !d.available) return;
      const before = window.kbAvatarRoles.count();
      if (window.kbAvatarRoles.setAvailable(d.available, d.v) !== before && typeof S !== 'undefined' && S && document.body.dataset.screen === 'game' && typeof renderStage === 'function') renderStage();
    })).catch(() => {});
  });
  loadRoleSprites();

  window.kbCourt = { update, tick, focus, reset, phaseUi, preloadRoles, loadRoleSprites, getState, skipIntro, stinger: (key) => stinger(STINGERS[key]), STINGERS, REVEAL, ownsVerdict: true, config: cfg, PHASE_UI, CAMERA, SCORE_REASON };
})();
