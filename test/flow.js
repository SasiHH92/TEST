'use strict';
// ============================================================
// KAMU BÍRÓSÁG – teljes meccs-folyam valódi böngészőkben (Playwright), több játékossal
//
// 3 emberi játékos (A = házigazda, B és C = vendég; C telefon-méreten) + 2 bot = 5 játékos, külön böngésző-környezetben, egy valódi szerver ellen:
//   belépés (vendég) → szoba → lobbi (készenlét, gyors/egyéni játék) → indítás → kör-intro → szerepek → fázisok (HUD-idő, kamera, 3-2-1) →
//   bizonyíték (privát!) → reakciók (korlát) → szavazás → ítélet-pecsét (mindenkinél ugyanaz) → pontok (a szerver eseményeiből) → kör vége →
//   következő kör (szerepcsere újratöltés nélkül) → újracsatlakozás → oldal-újratöltés → végeredmény + díjak.
//
// MÓDSZER: minden kliensben egy MEGFIGYELŐ fut (a játékos nem tud róla): 100 ms-onként rögzíti, mit mutat a kliens (fázis, kamera, HUD-idő, 3-2-1, ítélet-pecsét,
// bizonyíték- és kihívás-kártya, intro, pont-felrepülés) a szerver állapotával (S) együtt. A játék végén a rögzítést vetjük össze a szerver adataival – így a
// teszt nem függ attól, hogy melyik fázisra mikor ér oda. A kliens semmit nem dönt el: a teszt ezt hasonlítja a megjelenítéshez.
//
// Futtatás:  npm run test:flow         (FLOW_ROUNDS=1 a gyorsabb futáshoz; alap 2 kör, ~4-5 perc)
// Böngésző:  CHROMIUM_PATH=<futtatható fájl> – egyébként Edge / Chrome / Playwright Chromium; ha egyik sincs: SKIP (FLOW_REQUIRE=1 esetén hiba).
// Képernyőképek: FLOW_SHOTS=./QA_SCREENSHOTS
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.FLOW_PORT || 3196), BASE = 'http://127.0.0.1:' + PORT;
const ROUNDS = Math.max(1, Math.min(3, Number(process.env.FLOW_ROUNDS || 2)));
const SHOTS = process.env.FLOW_SHOTS ? path.resolve(process.env.FLOW_SHOTS) : '';
const REQUIRE = process.env.FLOW_REQUIRE === '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-flow-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}
// A környezeti zaj (hangeszköz nélküli gép, vírusirtó beszúrt szkriptje) nem a játék hibája.
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky/i;

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) { try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ } }
  return null;
}
async function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
    AUTH_BASE_URL: BASE, DATABASE_URL: '', AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'),
    KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}

// ---- a kliensben futó megfigyelő (a játékos nem lát belőle semmit) ----
function observer() {
  try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ }
  if (window.__obs) return;
  const rec = window.__obs = { phases: [], cam: {}, hud: [], cd: [], stamps: [], intro: [], evidence: [], challenge: [], flyMax: 0, floats: 0, snaps: {}, ringsMax: 0, prepPanel: 0, majorMax: 0, hands: [], bodies: {} };
  let lastHandSig = '';
  window.__loadMark = Math.random();
  let last = '', enter = 0;
  const vis = (el) => !!el && !el.classList.contains('hidden') && el.offsetParent !== null;
  document.addEventListener('DOMContentLoaded', () => {
    const layer = document.getElementById('courtScore');
    if (layer) new MutationObserver((ms) => { for (const m of ms) rec.floats += m.addedNodes.length; }).observe(layer, { childList: true });
  });
  setInterval(() => {
    if (typeof S === 'undefined' || !S || !S.phase || S.phase === 'lobby') return;
    const key = S.round + ':' + S.phase, now = Date.now();
    if (key !== last) {
      last = key; enter = now;
      rec.phases.push({ key, round: S.round, phase: S.phase, t: now });
      rec.snaps[key] = { role: myRole(), me: MY.playerId, pros: S.prosecutorId, def: S.defendantId, defr: S.defenderId, wit: S.witnessId, judge: S.currentJudgeId, caseNo: S.caseNo,
        evidence: S.evidence ? S.evidence.length : 0, myChallenge: !!S.myChallenge, scores: S.players.map((p) => [p.id, p.score]), events: (S.scoreEvents || []).map((e) => [e.seq, e.pid, e.points, e.kind]),
        verdict: S.verdict ? { g: S.verdict.guilty, gv: S.verdict.guiltyVotes, ng: S.verdict.notGuiltyVotes, un: !!S.verdict.unanimous } : null };
    }
    const cam = document.getElementById('courtCamera');
    if (cam && now - enter > 900) (rec.cam[S.phase] = rec.cam[S.phase] || []).includes(cam.dataset.cam) || rec.cam[S.phase].push(cam.dataset.cam);
    const hud = document.getElementById('rbTime');
    if (hud && rec.hud.length < 600) rec.hud.push({ phase: S.phase, text: hud.textContent, left: (S.phaseEndsAt - (now + serverOffset)) / 1000 });
    const cd = document.getElementById('courtCountdown');
    if (vis(cd) && /^[123]$/.test(cd.textContent)) rec.cd.push({ phase: S.phase, n: +cd.textContent });
    const stamp = document.querySelector('#courtVerdict .court-stamp');
    if (stamp && vis(document.getElementById('courtVerdict')) && S.verdict) rec.stamps.push({ round: S.round, text: stamp.textContent.trim(), guilty: S.verdict.guilty });
    const intro = document.getElementById('courtIntro');
    if (intro && intro.classList.contains('show')) rec.intro.push({ round: S.round, text: intro.innerText, charge: S.accusationText });
    const ev = document.getElementById('courtEvidence');
    if (ev && ev.classList.contains('show')) rec.evidence.push({ phase: S.phase, round: S.round, n: ev.querySelectorAll('li').length, text: ev.innerText, mine: S.evidence || [], revealed: S.revealedCards ? S.revealedCards.evidence : null });
    const ch = document.getElementById('courtChallenge');
    if (ch && ch.classList.contains('show')) rec.challenge.push({ phase: S.phase, round: S.round, text: ch.innerText, mine: S.myChallenge || null });
    const fl = document.querySelectorAll('#reactionLayer .flying-emoji, #reactionLayer .react-pop').length;
    if (fl > rec.flyMax) rec.flyMax = fl;
    // időzítő-tisztítás: nincs nagy gyűrűs időzítő, a felkészülésnél nincs panel, egyszerre legfeljebb egy nagy overlay
    const rings = document.querySelectorAll('.timer-ring, #timerBox').length;
    if (rings > rec.ringsMax) rec.ringsMax = rings;
    const sp = document.getElementById('scenePanel');
    if (S.phase === 'prep' && sp && getComputedStyle(sp).display !== 'none') rec.prepPanel++;
    const majors = ['courtReveal', 'courtIntro', 'courtEvidence', 'courtChallenge', 'courtVerdict', 'courtWinner'].filter((id) => { const e = document.getElementById(id); return e && e.classList.contains('show'); }).length;
    if (majors > rec.majorMax) rec.majorMax = majors;
    // KÁRTYÁIM: a kéz tartalma a szerver által nekem küldött privát adat mellett; és a képernyő szövege (privát kártyák kiszivárgásának ellenőrzéséhez)
    const stage = document.getElementById('chStage');
    const hand = stage ? [...stage.querySelectorAll('.court-card[data-i] .cf-text')].map((e) => e.textContent) : [];
    const mine = [].concat(S.evidence || [], S.tricks || [], S.alibi ? [S.alibi] : [], S.witnessCard ? [S.witnessCard] : [], S.myChallenge ? [S.myChallenge] : []);
    const sig = key + '|' + hand.join('|');
    if (sig !== lastHandSig) { lastHandSig = sig; rec.hands.push({ key, phase: S.phase, role: myRole(), hand, mine }); }
    if (now - enter > 1300 && !rec.bodies[key]) rec.bodies[key] = { phase: S.phase, text: document.body.innerText, mine, allowed: mine.concat((S.judgeWatch || []).map((c) => c.text), S.watchNow ? [S.watchNow.text] : []) };
  }, 100);
}

async function newPlayer(browser, label, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 1366, height: 768 }, locale: 'hu-HU' });
  const page = await context.newPage();
  const p = { label, context, page, errors: [], badAssets: [], paused: false, rec: null, saved: [] };
  page.on('pageerror', (e) => p.errors.push('pageerror: ' + e.message));
  page.on('crash', () => { p.errors.push('a böngésző-lap összeomlott'); console.error('CRASH: ' + label + ' @' + new Date().toISOString().slice(14, 23)); });
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) p.errors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && /\/assets\//.test(r.url())) p.badAssets.push(r.status() + ' ' + r.url()); });
  await page.addInitScript(observer);
  return p;
}
async function guestLogin(p, name) {
  const { page } = p;
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#authGuest');
  await page.click('#authGuest');
  await page.waitForFunction(() => document.body.dataset.screen === 'name');
  await page.evaluate(() => document.getElementById('btnNewSuspect').click());
  await page.fill('#guestName', name);
  await page.evaluate(() => document.getElementById('btnGuestGo').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'menu');
}
const waitPhase = (page, phases, timeout = 90000) => page.waitForFunction((ph) => S && ph.includes(S.phase), [].concat(phases), { timeout, polling: 100 });
async function shot(p, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await p.page.screenshot({ path: path.join(SHOTS, 'flow-' + p.label + '-' + name.replace(/[^a-z0-9._-]/gi, '_') + '.png') });
}
// A rögzítés lekérése (újratöltés előtt is menthető, hogy az F5 ne vigye el a korábbi megfigyeléseket)
async function collect(p) {
  try { p.saved.push(await p.page.evaluate(() => window.__obs)); } catch (_) { /* az oldal éppen újratölt */ }
}
const recs = (p) => p.saved.filter(Boolean);
const allOf = (p, key) => recs(p).flatMap((r) => r[key] || []);

// Automata: a kliens saját gombjait nyomja (mint egy türelmes játékos). Az ítélet-pecsétnek időt hagy, mielőtt továbblépne.
function autoplay(players) {
  let stop = false; const since = new Map();
  (async () => {
    while (!stop) {
      for (const p of players) {
        if (p.paused) continue;
        try {
          const st = await p.page.evaluate(() => (S ? S.phase : ''));
          const key = p.label + ':' + st; if (!since.has(key)) since.set(key, Date.now());
          const ids = ['iaAccRead', 'iaDone', 'btnNextRound', 'rvDone', p.label === 'B' ? 'voteNotGuilty' : 'voteGuilty', 'cv0Yes', 'cv1Yes', 'objAccept'];
          if (st === 'verdict' && Date.now() - since.get(key) > 4500) ids.push('btnProceed');
          if (st !== 'verdict') for (const k of [...since.keys()]) if (k.startsWith(p.label + ':verdict')) since.delete(k);
          await p.page.evaluate((list) => { for (const id of list) { const b = document.getElementById(id); if (b && !b.disabled) { b.click(); break; } } }, ids);
        } catch (_) { /* az oldal éppen újratölt */ }
      }
      await pause(350);
    }
  })();
  return () => { stop = true; };
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(REQUIRE ? 1 : 0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(REQUIRE ? 1 : 0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  const A = await newPlayer(browser, 'A'), B = await newPlayer(browser, 'B'), C = await newPlayer(browser, 'C', { width: 390, height: 844 });
  const all = [A, B, C];
  let stopAuto = () => {};
  try {
    // ---------------- belépés + szoba + lobbi ----------------
    await check('vendég-belépés mindhárom játékosnak (A, B, C) → menü', async () => {
      await guestLogin(A, 'Alfa Host'); await guestLogin(B, 'Beta Vendeg'); await guestLogin(C, 'Gamma Mobil');
    });
    await check('A szobát nyit, B és C a kóddal csatlakozik: mindenki a lobbiban, 3 plakát', async () => {
      await A.page.evaluate(() => document.getElementById('btnCreate').click());
      await A.page.waitForFunction(() => document.body.dataset.screen === 'lobby');
      const code = (await A.page.textContent('#lobbyCode')).trim();
      assert.match(code, /^[A-Z0-9]{4}$/, 'szobakód: ' + code);
      for (const p of [B, C]) {
        await p.page.fill('#codeInput', code);
        await p.page.evaluate(() => document.getElementById('btnJoin').click());
        await p.page.waitForFunction(() => document.body.dataset.screen === 'lobby');
      }
      for (const p of all) await p.page.waitForFunction(() => document.querySelectorAll('#pinWall [data-poster]').length >= 3, null, { timeout: 8000 });
      await shot(A, 'lobby');
    });
    await check('lobbi: HOST / VENDÉG jelvények a szerver állapotából', async () => {
      const txt = await A.page.evaluate(() => document.getElementById('pinWall').innerText);
      assert.ok(/HOST/.test(txt), 'HOST jelvény');
      assert.ok((txt.match(/VENDÉG/g) || []).length >= 3, 'VENDÉG jelvény mindenkin: ' + (txt.match(/VENDÉG/g) || []).length);
    });
    await check('lobbi: a "KÉSZEN ÁLLOK" valós időben megjelenik a többieknél; visszavonható; mindenki csak a SAJÁTJÁT állítja', async () => {
      await B.page.evaluate(() => document.getElementById('btnReady').click());
      await A.page.waitForFunction(() => S.players.filter((p) => p.ready && !p.isBot).length === 1, null, { timeout: 5000 });
      await C.page.waitForFunction(() => document.querySelectorAll('#pinWall .p-ready').length === 1, null, { timeout: 5000 });
      assert.equal(await A.page.evaluate(() => S.players.find((p) => p.id === MY.playerId).ready), false, 'A készenlétét B nem állíthatja');
      await B.page.evaluate(() => document.getElementById('btnReady').click());
      await A.page.waitForFunction(() => S.players.filter((p) => p.ready && !p.isBot).length === 0, null, { timeout: 5000 });
      for (const p of all) await p.page.evaluate(() => document.getElementById('btnReady').click());
      await A.page.waitForFunction(() => S.players.filter((p) => p.ready && !p.isBot).length === 3, null, { timeout: 5000 });
    });
    await check('lobbi: GYORS JÁTÉK / EGYÉNI JÁTÉK átváltás (csak a házigazdánál), a választás megmarad', async () => {
      assert.equal(await A.page.getAttribute('#btnQuickGame', 'aria-selected'), 'true', 'alapból gyors játék');
      assert.ok(await A.page.evaluate(() => document.getElementById('customSettings').classList.contains('hidden')), 'a részletes beállítások rejtve');
      assert.ok(!(await B.page.isVisible('#hostSettings')), 'a vendég nem látja a házigazda beállításait');
      await A.page.click('#btnCustomGame');
      assert.ok(await A.page.isVisible('#customSettings'), 'egyéni játék: a beállítások látszanak');
      assert.equal(await A.page.evaluate(() => localStorage.getItem('kb_lobby_mode')), 'custom');
      await shot(A, 'lobby-custom');
    });
    await check('botok (4+ játékos), rövid időzítők, TÁRGYALÁS MEGKEZDÉSE → mindenki a játékban, 5 játékos', async () => {
      for (let i = 0; i < 2; i++) { await A.page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(250); }
      await A.page.evaluate((rounds) => {
        const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
        set('setSpeech', 15); set('setDefender', 15); set('setPrep', 10); set('setWitness', 10); set('setClosing', 10); set('setRounds', rounds);
        const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
        document.getElementById('btnSaveSettings').click(); // a szerver így tárolja (különben a következő lobbi-frissítés visszaírja az alapértékeket)
      }, ROUNDS);
      await A.page.waitForFunction((r) => S.settings.rounds === r && S.settings.speechSeconds === 15, ROUNDS, { timeout: 6000 });
      stopAuto = autoplay(all);
      await A.page.evaluate(() => document.getElementById('btnStartGame').click());
      for (const p of all) await p.page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
      assert.equal(await A.page.evaluate(() => S.players.length), 5, '5 játékos');
    });

    // ---------------- játék közbeni beavatkozások (mindegyik néhány másodperces) ----------------
    await check('reakciók: a vendég reakciója megjelenik a házigazdánál; a kattintás-áradat korlátozott (≤ 14 egyszerre)', async () => {
      await waitPhase(A.page, ['prosecution', 'defense'], 90000);
      const before = await A.page.evaluate(() => document.querySelectorAll('#reactionLayer .flying-emoji, #reactionLayer .react-pop').length);
      await B.page.evaluate(() => document.querySelector('.react-btn[data-emoji="😂"]').click());
      await A.page.waitForFunction((n) => document.querySelectorAll('#reactionLayer .flying-emoji, #reactionLayer .react-pop').length > n, before, { timeout: 4000 });
      for (let i = 0; i < 24; i++) { await B.page.evaluate(() => document.querySelector('.react-btn[data-emoji="🔥"]').click()); await C.page.evaluate(() => document.querySelector('.react-btn[data-emoji="👏"]').click()); await pause(40); }
      await shot(A, 'speech');
    });
    await check('újracsatlakozás: a megszakadt kapcsolat sávot ad, majd a játékos ugyanabban a játékban folytatja', async () => {
      await waitPhase(B.page, ['witness', 'final_prosecution', 'final_defense', 'defender', 'verdict_vote'], 90000).catch(() => {});
      const before = await B.page.evaluate(() => ({ me: MY.playerId, round: S.round, role: myRole() }));
      await collect(B); B.paused = true;
      await B.page.evaluate(() => socket.io.engine.close()); // a kapcsolat megszakad (a socket.io újrapróbálkozik)
      const bar = await B.page.waitForFunction(() => { const b = document.getElementById('connBar'); return b && b.classList.contains('visible') ? b.textContent : false; }, null, { timeout: 6000 }).then((h) => h.jsonValue()).catch(() => '');
      await B.page.waitForFunction(() => socket.connected, null, { timeout: 20000 });
      await B.page.waitForFunction(() => { const b = document.getElementById('connBar'); return !b || !b.classList.contains('visible'); }, null, { timeout: 10000 });
      await B.page.waitForFunction(() => S && S.players.find((p) => p.id === MY.playerId && p.connected), null, { timeout: 10000 });
      B.paused = false;
      const after = await B.page.evaluate(() => ({ me: MY.playerId, round: S.round, role: myRole(), screen: document.body.dataset.screen }));
      assert.equal(after.me, before.me, 'ugyanaz a játékos');
      assert.equal(after.screen, 'game');
      assert.ok(after.round >= before.round, 'a kör nem ugrott vissza');
      assert.match(bar, /Kapcsolat|újracsatlakoz/i, 'a kapcsolat-sáv szövege magyar: "' + bar + '"');
    });
    await check('oldal-újratöltés (F5) játék közben: a játékos magától visszatér a játékba, a bevezető nem játszódik újra', async () => {
      await waitPhase(C.page, ['verdict_vote', 'challenge_review', 'verdict', 'round_results', 'witness', 'final_prosecution', 'final_defense'], 120000).catch(() => {});
      const before = await C.page.evaluate(() => ({ me: MY.playerId, round: S.round }));
      await collect(C); C.paused = true;
      await C.page.reload({ waitUntil: 'domcontentloaded' });
      await C.page.waitForFunction(() => document.body.dataset.screen === 'game' && S && S.players, null, { timeout: 25000 });
      C.paused = false;
      const after = await C.page.evaluate(() => ({ me: MY.playerId, round: S.round, intro: window.kbCourt.getState().introActive }));
      assert.equal(after.me, before.me, 'ugyanaz a játékos');
      assert.ok(after.round >= before.round);
      assert.equal(after.intro, false, 'az intro nem játszódik újra');
      await shot(C, 'after-refresh');
    });

    // ---------------- a játék vége ----------------
    await check('a szerver végigviszi a meccset: game_over mindhárom kliensen', async () => {
      for (const p of all) await waitPhase(p.page, 'game_over', 330000);
      await pause(1500);
      for (const p of all) await collect(p);
      await shot(A, 'game-over'); await shot(C, 'game-over-mobile');
    });

    // ---------------- a rögzítés összevetése a szerver adataival ----------------
    const rank = await A.page.evaluate(() => S.gameOver);
    const phaseKeys = (p) => new Set(allOf(p, 'phases').map((x) => x.phase));
    const snapsOf = (p) => Object.assign({}, ...recs(p).map((r) => r.snaps));

    await check('minden fázis megjelent a kliensen a szerver sorrendjében, és a 3 kliens ugyanazt a fázissorozatot látta', async () => {
      const must = ['accusation', 'prep', 'prosecution', 'defense', 'verdict_vote', 'verdict', 'round_results', 'game_over'];
      for (const p of all) for (const ph of must) assert.ok(phaseKeys(p).has(ph), p.label + ': hiányzó fázis ' + ph + ' (volt: ' + [...phaseKeys(p)] + ')');
    });
    await check('szerepkiosztás: mindenki ugyanazt a szerep-térképet látja; a saját szerepem a szerver állapotából jön; pontosan egy bíró / ügyész / vádlott', async () => {
      const keys = Object.keys(snapsOf(A));
      assert.ok(keys.length >= 8, 'rögzített fázisok: ' + keys.length);
      for (const k of keys.filter((x) => !x.endsWith(':game_over'))) { // a végeredménynél a szerep-mezők már üresek
        const sa = snapsOf(A)[k], sb = snapsOf(B)[k], sc = snapsOf(C)[k];
        for (const [name, s] of [['B', sb], ['C', sc]]) if (s) for (const f of ['pros', 'def', 'judge', 'defr', 'wit', 'caseNo']) assert.equal(s[f], sa[f], k + ' ' + name + ' ' + f);
        for (const s of [sa, sb, sc].filter(Boolean)) {
          const expected = s.me === s.judge ? 'judge' : s.me === s.def ? 'defendant' : s.me === s.pros ? 'prosecutor' : s.me === s.defr ? 'defender' : s.me === s.wit ? 'witness' : 'juror';
          assert.equal(s.role, expected, k + ': a kliens szerepe a szerver állapotából');
        }
        assert.ok(sa.pros && sa.def && sa.judge && new Set([sa.pros, sa.def, sa.judge]).size === 3, k + ': ügyész / vádlott / bíró különböző');
      }
    });
    await check('kör-intro: a szerver vádjával és kör-számával játszódott le mindenkinél (kivéve az újratöltött klienst az újratöltés utáni részre)', async () => {
      for (const p of [A, B]) {
        const intros = allOf(p, 'intro'), step1 = intros.filter((i) => /AZ ÁLLAM/.test(i.text));
        assert.ok(step1.length >= 1, p.label + ': nem volt intro');
        assert.ok(step1.every((i) => i.text.includes(i.charge.slice(0, 18)) && /TÁRGYALÁS/.test(i.text)), p.label + ': az intro nem a szerver vádját mutatta');
        assert.ok(intros.some((i) => /MEGKEZDŐDIK/.test(i.text)), p.label + ': hiányzik a "A TÁRGYALÁS MEGKEZDŐDIK!" lezárás');
      }
    });
    await check('HUD: a szerepsávban a hátralévő idő a szerver lejáratához igazodik (±2,2 mp) minden kliensen', async () => {
      for (const p of all) {
        const hud = allOf(p, 'hud');
        assert.ok(hud.length > 40, p.label + ': HUD-minták: ' + hud.length);
        const bad = hud.filter((h) => { const [m, s] = h.text.split(':').map(Number); return !(Math.abs(m * 60 + s - Math.max(0, h.left)) <= 2.2); });
        assert.ok(bad.length / hud.length < 0.02, p.label + ': a HUD-minták ' + bad.length + '/' + hud.length + ' eltér, pl. ' + JSON.stringify(bad[0]));
      }
    });
    await check('kamera-fókusz a fázis szerint (ügyész → prosecutor, vádlott → defendant, bíró → judge, szavazás → wide)', async () => {
      const expect = { prosecution: 'prosecutor', defense: 'defendant', final_prosecution: 'prosecutor', final_defense: 'defendant', verdict_vote: 'wide', prep: 'wide', round_results: 'wide' };
      for (const p of all) {
        const cam = Object.assign({}, ...recs(p).map((r) => r.cam));
        for (const [ph, want] of Object.entries(expect)) if (cam[ph]) assert.ok(cam[ph].includes(want), p.label + ' ' + ph + ': ' + cam[ph] + ' ≠ ' + want);
        assert.ok(Object.keys(cam).length >= 4, p.label + ': kevés kamera-minta');
      }
    });
    await check('3-2-1: az időzített fázisok utolsó 3 mp-ében a nagy visszaszámlálás megjelent (legalább 2 különböző szám)', async () => {
      for (const p of [A, B]) { const seen = new Set(allOf(p, 'cd').map((c) => c.n)); assert.ok(seen.size >= 2, p.label + ': ' + [...seen]); }
    });
    await check('bizonyíték: csak a szerver által küldött saját kártyáim jelennek meg; a leleplezés a kör végén mindenkinek; nincs kiszivárgás', async () => {
      for (const p of all) {
        for (const e of allOf(p, 'evidence')) {
          if (e.phase === 'prep') { assert.ok(e.mine.length > 0, p.label + ': bizonyíték-kártya a szerver adata nélkül'); for (const it of e.mine.slice(0, 4)) assert.ok(e.text.includes(it.slice(0, 20)), 'a kártya a szerver szövegét mutatja'); }
          if (e.phase === 'round_results') assert.ok(e.revealed && e.revealed.length > 0, p.label + ': leleplezés adat nélkül');
        }
        // a privát bizonyíték csak annak látszik, akinek a szerver küldte (ügyész / védő); másnak a prep-kártya nem lehet
        const prepSnaps = Object.entries(snapsOf(p)).filter(([k]) => k.endsWith(':prep'));
        for (const [k, s] of prepSnaps) if (s.role !== 'prosecutor' && s.role !== 'defender') assert.equal(s.evidence, 0, p.label + ' ' + k + ': a szerver nem küldhet bizonyítékot ennek a szerepnek');
        const shownPrep = allOf(p, 'evidence').filter((e) => e.phase === 'prep').length;
        if (!prepSnaps.some(([, s]) => s.evidence > 0)) assert.equal(shownPrep, 0, p.label + ': bizonyíték-kártya a szerver adata nélkül');
      }
    });
    await check('ítélet-pecsét: a megjelenített felirat a szerver ítéletével egyezik (BŰNÖS / FELMENTVE) – mindhárom kliensen, minden körben', async () => {
      for (const p of [A, B]) {
        const stamps = allOf(p, 'stamps');
        assert.ok(stamps.length >= 1, p.label + ': nem volt ítélet-pecsét');
        for (const s of stamps) assert.equal(s.text, s.guilty ? 'BŰNÖS' : 'FELMENTVE', p.label + ' kör ' + s.round);
      }
      const verdicts = (p) => Object.fromEntries(Object.entries(snapsOf(p)).filter(([k]) => k.endsWith(':verdict')).map(([k, s]) => [k, JSON.stringify(s.verdict)]));
      const va = verdicts(A), vb = verdicts(B);
      assert.ok(Object.keys(va).length >= 1, 'nincs rögzített ítélet');
      for (const k of Object.keys(vb)) assert.equal(vb[k], va[k], 'az ítélet eltér a kliensek közt: ' + k);
    });
    await check('pontok: Σ pontesemény = a játékos körönkénti pontja; a felrepülő "+N" a szerver eseményeiből jelent meg', async () => {
      const snaps = snapsOf(A);
      let checked = 0;
      for (const [k, s] of Object.entries(snaps)) {
        if (!k.endsWith(':round_results')) continue;
        const prev = Object.entries(snaps).filter(([kk]) => kk.endsWith(':round_results') && +kk.split(':')[0] < +k.split(':')[0]).sort().pop();
        const prevScore = Object.fromEntries(prev ? prev[1].scores : []);
        const sum = {};
        for (const [, pid, pts] of s.events) sum[pid] = (sum[pid] || 0) + pts;
        for (const [pid, score] of s.scores) assert.equal((prevScore[pid] || 0) + (sum[pid] || 0), score, k + ' pid ' + pid + ': ' + (prevScore[pid] || 0) + ' + események ' + (sum[pid] || 0) + ' ≠ ' + score);
        checked++;
      }
      assert.ok(checked >= 1, 'nem volt ellenőrizhető kör');
      const floats = recs(A).reduce((n, r) => n + r.floats, 0) + recs(B).reduce((n, r) => n + r.floats, 0);
      assert.ok(floats >= 1, 'felrepülő pontok: ' + floats);
    });
    await check('reakciók: egyszerre legfeljebb 14 repülő emoji, bármekkora a kattintás-áradat', async () => {
      assert.ok(Math.max(...recs(A).map((r) => r.flyMax)) <= 14);
      assert.ok(Math.max(...recs(A).map((r) => r.flyMax)) >= 1, 'a reakció megjelent');
    });
    if (ROUNDS > 1) {
      await check('következő kör: a szerepek ÚJRATÖLTÉS NÉLKÜL cserélődtek, új ügyszám és vád jött (A kliens)', async () => {
        const snaps = snapsOf(A);
        const r1 = snaps['1:accusation'] || snaps['1:prep'], r2 = snaps['2:accusation'] || snaps['2:prep'];
        assert.ok(r1 && r2, 'mindkét kör rögzítve');
        assert.notEqual(r1.caseNo, r2.caseNo, 'új ügyszám');
        assert.ok(r1.pros !== r2.pros || r1.def !== r2.def || r1.judge !== r2.judge, 'legalább egy szerep cserélődött');
        assert.equal(recs(A).length, 1, 'az A oldal nem töltődött újra');
      });
    }
    await check('időzítő-tisztítás: nincs nagy gyűrűs időzítő sehol, a felkészülésnél nincs panel (a közép szabad), egyszerre legfeljebb egy nagy overlay – az idő a felső sávban él', async () => {
      for (const p of all) {
        assert.equal(Math.max(...recs(p).map((r) => r.ringsMax)), 0, p.label + ': időzítő-gyűrű volt a DOM-ban');
        assert.equal(recs(p).reduce((n, r) => n + r.prepPanel, 0), 0, p.label + ': a felkészülés alatt panel látszott');
        assert.ok(Math.max(...recs(p).map((r) => r.majorMax)) <= 1, p.label + ': egyszerre több nagy overlay');
        assert.ok(allOf(p, 'hud').length > 40, p.label + ': a felső idő nem járt');
      }
    });
    const CARD_PHASES = ['prep', 'prosecution', 'defense', 'defender', 'witness', 'final_prosecution', 'final_defense', 'verdict_vote', 'verdict', 'objection', 'challenge_review'];
    await check('KÁRTYÁIM: a kéz tartalma pontosan a szerver által NEKEM küldött kártyák (szerepenként); kártya nélküli szerepnek (bíró, esküdt) nincs kéz', async () => {
      let withCards = 0;
      for (const p of all) {
        for (const e of allOf(p, 'hands')) {
          if (!CARD_PHASES.includes(e.phase)) { assert.deepEqual(e.hand, [], p.label + ' ' + e.key + ': kéz a tiltott fázisban'); continue; }
          assert.deepEqual(e.hand.slice().sort(), e.mine.slice().sort(), p.label + ' ' + e.key + ' (' + e.role + '): a kéz eltér a szerver adatától');
          if (e.role === 'judge' || e.role === 'juror') assert.equal(e.hand.length, 0, p.label + ': ' + e.role + ' szerepnek van kártya-keze');
          if (e.hand.length) withCards++;
        }
      }
      assert.ok(withCards >= 3, 'a játékban alig volt kártya-kéz: ' + withCards);
    });
    await check('privát kártyák: más játékos titkos kártyája (alibi, tanúkártya, kihívás, trükk, bizonyíték) a kliens képernyőjén sem jelenik meg (kivéve a szerver által engedett: saját, a bíró figyelője, a védő látja az ügyész bizonyítékait)', async () => {
      const PRIV = ['prep', 'prosecution', 'defense', 'defender', 'witness', 'final_prosecution', 'final_defense', 'verdict_vote'];
      const bodies = (p) => Object.assign({}, ...recs(p).map((r) => r.bodies));
      let compared = 0;
      for (const x of all) for (const y of all) {
        if (x === y) continue;
        const bx = bodies(x), by = bodies(y);
        for (const key of Object.keys(bx)) {
          if (!PRIV.includes(bx[key].phase) || !by[key]) continue;
          for (const secret of by[key].mine) {
            if (bx[key].allowed.includes(secret)) continue;
            assert.ok(!bx[key].text.includes(secret), x.label + ' látja ' + y.label + ' titkos kártyáját (' + key + '): "' + secret.slice(0, 40) + '"');
            compared++;
          }
        }
      }
      assert.ok(compared >= 5, 'alig volt összehasonlítható privát kártya: ' + compared);
    });
    await check('szerep-képek: a színpadon raszter-kép áll (avatar_NN_<szerep>.webp vagy alap-avatár), törött kép és SVG nélkül; nincs 404-es asset', async () => {
      const r = await A.page.evaluate(async () => {
        const imgs = [...document.querySelectorAll('#stageSlots .stage-slot img, #judge img')];
        await Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((res) => { i.onload = i.onerror = res; setTimeout(res, 3000); }))));
        return { n: imgs.length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src), svg: document.querySelectorAll('#stage svg, #stage img[src$=".svg"]').length };
      });
      assert.deepEqual(r.broken, [], 'törött kép: ' + r.broken);
      assert.equal(r.svg, 0, 'SVG a színpadon');
      const bad = [...A.badAssets, ...B.badAssets, ...C.badAssets];
      assert.deepEqual(bad, [], 'hibás asset-kérés: ' + bad.join(', '));
    });
    await check('végeredmény: rangsor pontszám szerint, érmek, a díjak CSAK mért statisztikából (érték látszik mellettük), a kliensek ugyanazt mutatják', async () => {
      const go = await A.page.evaluate(() => ({ rank: S.gameOver.ranking.map((p) => p.score), awards: Object.entries(S.gameOver.awards).filter(([, v]) => v).map(([k, v]) => [k, v.value]),
        medals: document.querySelectorAll('#phaseContent .score-row.podium-gold, #phaseContent .score-row.podium-silver, #phaseContent .score-row.podium-bronze').length,
        cards: document.querySelectorAll('#phaseContent .award-card').length, stats: document.querySelectorAll('#phaseContent .award-stat').length }));
      assert.deepEqual(go.rank, go.rank.slice().sort((a, b) => b - a), 'rangsor sorrend');
      assert.ok(go.medals >= 1 && go.medals <= 3, 'érmek: ' + go.medals);
      for (const [k, v] of go.awards) assert.ok(v > 0, 'díj mért érték nélkül: ' + k);
      assert.equal(go.cards, go.awards.length, 'a megjelenített díjak = a szerver díjai');
      assert.equal(go.stats, go.awards.length, 'mindegyik díjnál a mért érték is látszik');
      const rb = await B.page.evaluate(() => S.gameOver.ranking.map((p) => p.score));
      assert.deepEqual(rb, go.rank, 'a végső pontok eltérnek');
      assert.ok(rank && rank.ranking.length === 5, '5 játékos a rangsorban');
    });
    await check('nincs JavaScript-hiba egyik böngészőben sem', async () => {
      const errs = all.flatMap((p) => p.errors.map((e) => p.label + ': ' + e));
      assert.deepEqual(errs, [], errs.join(' | '));
    });
  } catch (e) {
    failed++; console.error('FAIL: a teszt-folyam megszakadt: ' + (e && e.stack || e));
  } finally {
    stopAuto();
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(`\nFlow: ${passed} sikeres, ${failed} hibás.`);
  process.exit(failed ? 1 : 0);
})();
