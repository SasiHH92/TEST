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
    scoreSeen: {}, scoreQueue: [], countdown: 0, evidenceKey: '', challengeKey: '', timers: new Set(), phase: '', verdictObj: null
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
  const OVL = { intro: { critical: true, prio: 5 }, verdict: { critical: true, prio: 4 }, challenge: { prio: 3 }, evidence: { prio: 2 } };
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
      kind: 'intro', phase: 'accusation', dur: 0,
      show() {
        el.className = 'court-intro';
        el.innerHTML = html;
        el.classList.remove('hidden');
        requestAnimationFrame(() => el.classList.add('show'));
        st.introActive = true;
        document.body.classList.add('court-intro-on');
        st.intro = { step: 1, o };
        play('intro');
        st.intro.t1 = later(introStep2, reduced() ? 1500 : 2800);
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
    if (!st.introActive || !st.intro) return;
    if (st.intro.step === 1) introStep2(); else introEnd();
  };
  // A réteg áteresztő (pointer-events: none), ezért a kattintást az egész jelenet-zónán figyeljük, míg az intro látszik.
  document.addEventListener('click', (e) => { if (st.introActive && e.target && e.target.closest && e.target.closest('#stage, #courtIntro')) skipIntro(); });
  document.addEventListener('keydown', (e) => { if (st.introActive && ['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); skipIntro(); } });

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
        requestAnimationFrame(() => el.classList.add('show'));
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
      '<div class="challenge-card court-parchment"><div class="cc-kicker">KAMU BÍRÓSÁG</div><div class="cc-title">' + esc(title) + '</div>' + body +
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
        el.className = 'court-verdict hidden';
        st.vT1 = later(() => {
          shake();
          el.className = 'court-verdict ' + (guilty ? 'flash-guilty' : 'flash-acquitted');
          el.innerHTML = '<div class="verdict-card court-parchment ' + (guilty ? 'guilty' : 'acquitted') + '">' +
            '<div class="verdict-kicker">A BÍRÓSÁG ÍTÉLETE</div><div class="verdict-name">' + esc(snap.names.defendant || 'A VÁDLOTT') + '</div>' +
            '<div class="court-stamp">' + (guilty ? 'BŰNÖS' : 'FELMENTVE') + '</div>' +
            '<div class="verdict-sub">' + (tally ? '<b>' + esc(tally) + '</b> ' : '') + '</div>' + (v.unanimous ? '<div class="verdict-unanimous">EGYHANGÚ ÍTÉLET – BÓNUSZPONT</div>' : '') + '</div>';
          requestAnimationFrame(() => el.classList.add('show'));
          st.vT2 = later(() => focus('defendant'), reduced() ? 900 : 1500);
          st.vT3 = later(() => ovEnd(o), reduced() ? 1500 : 2600);
        }, reduced() ? 150 : 480);
      },
      hide(quick) {
        cancel(st.vT1); cancel(st.vT2); cancel(st.vT3);
        st.verdictActive = false; st.verdictObj = null;
        el.classList.remove('show');
        later(() => { el.className = 'court-verdict hidden'; el.innerHTML = ''; }, quick || reduced() ? 0 : 340);
        flushScore(false);
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
        let seen = '';
        try { seen = sessionStorage.getItem('kb_intro_case') || ''; } catch (_) { /* nincs tár */ }
        if (seen !== caseKey) { try { sessionStorage.setItem('kb_intro_case', caseKey); } catch (_) { /* nincs tár */ } showIntro(snap); }
      }
    }
    if (st.introActive && snap.phase !== 'accusation' && st.intro && st.intro.step === 1) introStep2();

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

    // pontok: a szerver eseményeiből, az ítélet után
    if (['verdict', 'challenge_review', 'round_results', 'game_over'].includes(snap.phase)) queueScore(snap);
  });

  // A lobbiba / menübe lépéskor a rétegek takarítása (új játék, kilépés).
  const reset = safe(() => {
    for (const t of st.timers) clearTimeout(t);
    document.body.classList.remove('court-intro-on');
    ov.active = null; ov.queue = []; delete document.body.dataset.courtMajor;
    Object.assign(st, { timers: new Set(), introActive: false, verdictActive: false, verdictObj: null, intro: null, camKey: '', lastCase: '', verdictKey: '', evidenceKey: '', challengeKey: '', scoreQueue: [], scoreSeen: {}, countdown: 0, phase: '' });
    for (const id of ['#courtIntro', '#courtEvidence', '#courtChallenge', '#courtVerdict', '#courtCountdown']) {
      const el = $(id);
      if (el) { el.classList.add('hidden'); el.classList.remove('show', 'step2'); el.innerHTML = ''; }
    }
    const sc = $('#courtScore'); if (sc) sc.innerHTML = '';
    focus('wide');
  });
  document.addEventListener('kb:screen', (e) => { if (e.detail !== 'game') reset(); });

  // Teszt / hibakeresés: a megjelenítés pillanatnyi állapota (nem játékállapot).
  const getState = () => ({ camera: st.cam, introActive: st.introActive, verdictActive: st.verdictActive, countdown: st.countdown, phase: st.phase, preloaded: preloaded.size, major: ov.active ? ov.active.kind : '', queued: ov.queue.map((o) => o.kind) });

  // ---------------- 11) AVATÁR × SZEREP KÉPEK ----------------
  // A szerver listája a feltöltött szerep-képekről (/api/role-sprites); hiányzó képnél az eredeti avatár marad (nincs SVG-tartalék).
  const loadRoleSprites = safe(() => {
    if (!window.kbAvatarRoles || typeof fetch !== 'function') return;
    fetch('/api/role-sprites', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then(safe((d) => {
      if (!d || !d.available) return;
      const before = window.kbAvatarRoles.count();
      if (window.kbAvatarRoles.setAvailable(d.available) !== before && typeof S !== 'undefined' && S && document.body.dataset.screen === 'game' && typeof renderStage === 'function') renderStage();
    })).catch(() => {});
  });
  loadRoleSprites();

  window.kbCourt = { update, tick, focus, reset, phaseUi, preloadRoles, loadRoleSprites, getState, skipIntro, config: cfg, PHASE_UI, CAMERA, SCORE_REASON };
})();
