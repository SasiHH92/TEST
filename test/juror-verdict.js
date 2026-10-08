'use strict';
// ============================================================
// KAMU BÍRÓSÁG – ESKÜDT-MÓD (kihívás-szavazás) és HOSSZÚ ÍTÉLET-MONDAT valódi böngészőben (Playwright)
//
//  A) kihívás-szavazás 1 / 2 / 3 kihívással (a játék legfeljebb 3-at ad: ügyész, vádlott, védő), szavazóként és nézőként, 5 méreten
//     (1920×1080, 1366×768, 1024×768, 390×844, 360×800): egyszerre egy kihívás, sorszám-gombok, szavazás után a következő még nem szavazottra ugrik,
//     a tartós sáv nem takarja a karaktereket (≤ 12 %), nem lóg ki, nem olvashatatlanul kicsi
//  B) ítélet-mondat rövid / közepes / nagyon hosszú: a kompakt sávban vágott, DE koppintásra / kattintásra / Enterre a TELJES mondat olvasható (mobilon is),
//     újabb koppintásra összecsukódik; ugyanez a bíró kihívás-ellenőrző sávjának hosszú szövegére
//  C) valódi eskütt-módos játék (a szerver végigviszi a kihívás-szavazást), 1366×768 és 390×844
//
// Futtatás:  npm run test:juror        Böngésző: CHROMIUM_PATH / Edge / Chrome / Playwright Chromium; ha nincs: SKIP (JUROR_REQUIRE=1 esetén hiba)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.JUROR_PORT || 3198), BASE = 'http://127.0.0.1:' + PORT;
const SHOTS = process.env.JUROR_SHOTS ? path.resolve(process.env.JUROR_SHOTS) : '';
const REQUIRE = process.env.JUROR_REQUIRE === '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-juror-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky/i;
const MAX_OVERLAP = 0.12;

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) { try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ } }
  return null;
}
async function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
    AUTH_BASE_URL: BASE, DATABASE_URL: '', MAX_ROOMS_PER_IP: '30', AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'),
    KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'juror-' + name.replace(/[^a-z0-9._-]/gi, '_') + '.png') });
}

// játék indítása egy vendéggel + botokkal; opts: { bots, prep, speech, jury, rounds }
async function startGame(browser, viewport, opts) {
  const mobile = viewport.width < 700;
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'hu-HU' });
  await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#authGuest'); await page.click('#authGuest');
  await page.waitForFunction(() => document.body.dataset.screen === 'name');
  await page.evaluate(() => document.getElementById('btnNewSuspect').click());
  await page.fill('#guestName', 'Juror ' + viewport.width);
  await page.evaluate(() => document.getElementById('btnGuestGo').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'menu');
  await page.evaluate(() => document.getElementById('btnCreate').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
  for (let i = 0; i < (opts.bots || 3); i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(220); }
  await page.evaluate((o) => {
    document.getElementById('btnCustomGame').click();
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('setSpeech', o.speech || 15); set('setDefender', o.speech || 15); set('setPrep', o.prep || 120); set('setWitness', 10); set('setClosing', 10); set('setRounds', o.rounds || 1);
    if (o.jury) { const j = document.getElementById('setChallengeJury'); j.checked = true; j.dispatchEvent(new Event('change', { bubbles: true })); }
    const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
    document.getElementById('btnSaveSettings').click();
  }, opts);
  await page.waitForFunction((o) => S.settings.prepSeconds === (o.prep || 120) && (!o.jury || S.settings.challengeMode === 'jury'), opts, { timeout: 6000 });
  await page.evaluate(() => document.getElementById('btnStartGame').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
  return { context, page, errors };
}

// --- a böngészőben futó mérés: a tartós panel és a karakterek ---
const measure = () => {
  const vis = (el) => !!el && el.offsetParent !== null;
  const R = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const panel = document.getElementById('scenePanel'), pc = panel.querySelector('.phase-content');
  const shown = !!pc && !panel.classList.contains('is-empty') && vis(pc);
  const figs = [...document.querySelectorAll('#stageSlots .stage-slot[data-role]:not([data-role="juror"]) .st-art, #judge .st-art')].filter(vis).map((e) => ({ role: e.closest('[data-role]').dataset.role, r: R(e) })).filter((f) => f.r.w > 20);
  const rp = shown ? R(pc) : null;
  return { vw: innerWidth, vh: innerHeight, panel: rp, overlap: rp ? Math.max(0, ...figs.map((f) => area(f.r, rp) / (f.r.w * f.r.h))) : 0, worst: rp ? (figs.map((f) => [f.role, area(f.r, rp) / (f.r.w * f.r.h)]).sort((a, b) => b[1] - a[1])[0] || [''])[0] : '' };
};
const forge = async (page, patch) => {
  await page.evaluate((p) => { window.__S0 = window.__S0 || JSON.parse(JSON.stringify(S)); S = Object.assign(JSON.parse(JSON.stringify(window.__S0)), p); renderGame(); }, patch);
};
const waitCalm = (page) => page.waitForFunction(() => !document.body.dataset.courtMajor, null, { timeout: 8000, polling: 100 }).then(() => pause(350));
const challenge = (who, text, difficulty) => ({ who, text, difficulty: !!difficulty });
const TEXTS = [
  'Beszélj úgy, mint egy sportkommentátor.',
  'A beszéd közben hirtelen kezdj el énekelni egy lassú dalt a saját szavaiddal, ahogy egy igazi operaénekes tenné a színpadon.',
  'Ne használd az "igen" és a "nem" szót.'
];
const SENTENCES = {
  rövid: 'Egy napig kávét főz.',
  közepes: 'Egy hónapig a csoport hivatalos kávéfőzője, és minden reggel hangosan kell köszöntenie a szobát.',
  'nagyon hosszú': 'Három hétig a csoport hivatalos kávéfőzője, hangoskodó reggeli ébresztője és névtelen jegyzőkönyvvezetője; minden egyes reggel hangosan köszönti a szobát, ' +
    'közben a kávét mindenki más nevén adja át, és ha elrontja, a Discordon nyilvánosan bocsánatot kér a gépétől. '.repeat(2) + 'A fellebbezést a kávéfőző gép bírálja el.'
};
const VPS = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 800 }];

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(REQUIRE ? 1 : 0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(REQUIRE ? 1 : 0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  const open = [];
  try {
    // ======================= A + B) kovácsolt állapotok, 5 méreten párhuzamosan =======================
    const games = await Promise.all(VPS.map(async (vp) => ({ vp, g: await startGame(browser, vp, { prep: 120, bots: 3 }) })));
    for (const x of games) { open.push(x.g.context); await x.g.page.waitForFunction(() => S && S.phase === 'accusation', null, { timeout: 15000 }); await x.g.page.evaluate(() => { const b = document.getElementById('iaAccRead'); if (b) b.click(); }); }
    for (const x of games) await x.g.page.waitForFunction(() => S.phase === 'prep', null, { timeout: 20000 });
    for (const x of games) { await x.g.page.waitForTimeout(3300); await x.g.page.evaluate(() => { KICKED_FROM_ROOM = true; /* a kovácsolt állapotot a szerver következő üzenete ne írja felül */ window.__emits = []; const o = socket.emit.bind(socket); socket.emit = (...a) => { window.__emits.push(a[0] === 'vote_challenge' ? ['vote_challenge', a[1]] : [a[0]]); return o(...a); }; }); }

    for (const { vp, g } of games) {
      const tag = vp.width + '×' + vp.height;
      const page = g.page;
      const base = { phase: 'challenge_vote', phaseEndsAt: Date.now() + 90000, caseNo: 'JV-1' };
      const vote = (n, canVote, extra) => Object.assign({ challengeVote: { canVote, voterCount: 3, counts: {}, myVotes: null, challenges: [challenge('prosecutor', TEXTS[0]), challenge('defendant', TEXTS[2], true), challenge('defender', TEXTS[0])].slice(0, n) } }, extra || {});

      for (const n of [1, 2, 3]) for (const canVote of [true, false]) {
        await check(tag + ' – eskütt-mód, ' + n + ' kihívás, ' + (canVote ? 'szavazóként' : 'nézőként') + ': egyetlen kompakt sáv, lapozó, nem takarja a karaktereket', async () => {
          await page.evaluate(() => { cvIdx = 0; });
          await forge(page, Object.assign({}, base, vote(n, canVote)));
          await waitCalm(page);
          const m = await page.evaluate(measure);
          const info = await page.evaluate(() => ({ chips: document.querySelectorAll('.cv-chip').length, text: (document.querySelector('.cv-text') || {}).textContent, strip: !!document.querySelector('.cv-strip'),
            yes: !!document.querySelector('.cv-btn[data-done="1"]'), fs: parseFloat(getComputedStyle(document.querySelector('.cv-text')).fontSize) }));
          assert.ok(info.strip, 'nincs szavazó-sáv');
          assert.equal(info.chips, n > 1 ? n : 0, 'a lapozó-gombok száma');
          assert.ok(info.text && info.text.includes(TEXTS[0].slice(0, 20)), 'az első kihívás látszik');
          assert.equal(info.yes, canVote, 'a szavazó-gombok csak a szavazónak látszanak');
          assert.ok(info.fs >= 13, 'olvashatatlanul kicsi betű: ' + info.fs);
          assert.ok(m.panel && m.panel.l >= -1 && m.panel.r <= m.vw + 1 && m.panel.b <= m.vh + 1 && m.panel.t >= 60, 'a sáv kilóg: ' + JSON.stringify(m.panel));
          assert.ok(m.overlap <= MAX_OVERLAP, 'a sáv takarja: ' + m.worst + ' ' + Math.round(100 * m.overlap) + '% (panel ' + Math.round(m.panel.h) + ' px)');
          if (n === 3 && canVote) await shot(page, tag + '-vote-3');
        });
      }
      await check(tag + ' – eskütt-mód, 3 kihívás: lapozás sorszám-gombbal; szavazás elküldi az eseményt, ✓ jelet kap, a következő még nem szavazottra ugrik; a szavazott kihívás gombjai zároltak', async () => {
        await page.evaluate(() => { cvIdx = 0; window.__emits.length = 0; });
        await forge(page, Object.assign({}, base, vote(3, true)));
        await page.evaluate(() => document.querySelector('.cv-chip[data-cvi="2"]').click());
        assert.match(await page.textContent('.cv-text'), /Beszélj úgy/, 'a 3. kihívás nem jelent meg a sorszám-gombra'); // 3. = védő (TEXTS[0])
        await page.evaluate(() => document.querySelector('.cv-chip[data-cvi="1"]').click());
        assert.match(await page.textContent('.cv-text'), /igen/, 'a 2. kihívás nem jelent meg');
        await page.evaluate(() => document.getElementById('cv1Yes').click());
        const sent = await page.evaluate(() => window.__emits.filter((e) => e[0] === 'vote_challenge').map((e) => e[1]));
        assert.deepEqual(sent, [{ who: 'defendant', done: true }], 'a szavazat nem a megfelelő kihívásra ment: ' + JSON.stringify(sent));
        // a szerver válasza (a state-ben a saját szavazat): ✓ jel + ugrás a következő nem szavazottra
        await page.evaluate(() => { S.challengeVote.myVotes = { defendant: true }; S.challengeVote.counts = { defendant: 1 }; renderGame(); });
        const st = await page.evaluate(() => ({ idx: cvIdx, done: [...document.querySelectorAll('.cv-chip.done')].map((e) => e.dataset.cvi) }));
        assert.equal(st.idx, 0, 'nem ugrott az első nem szavazott kihívásra: ' + st.idx);
        assert.deepEqual(st.done, ['1'], 'a szavazott kihívás nem kapott ✓ jelet');
        await page.evaluate(() => document.querySelector('.cv-chip[data-cvi="1"]').click());
        assert.ok(await page.evaluate(() => [...document.querySelectorAll('.cv-btn')].every((b) => b.disabled)), 'a szavazott kihívás gombjai nem zároltak');
        assert.ok(await page.evaluate(() => !!document.querySelector('.cv-btn.chosen')), 'a saját választás nem emelt ki');
      });
      await check(tag + ' – eskütt-mód: hosszú kihívás-szöveg 3 sorra vágva, koppintásra teljesen olvasható, újabb koppintásra összecsukódik', async () => {
        const long = 'A beszéd közben hirtelen kezdj el énekelni egy lassú, érzelmes dalt a saját szavaiddal, közben nézz mélyen a bíró szemébe, és minden mondat végén ismételd meg az utolsó szót háromszor.';
        await page.evaluate(() => { cvIdx = 0; });
        await forge(page, Object.assign({}, base, { challengeVote: { canVote: true, voterCount: 3, counts: {}, myVotes: null, challenges: [challenge('prosecutor', long)] } }));
        await pause(250);
        const before = await page.evaluate(() => { const e = document.querySelector('.cv-text'); return { clamped: e.classList.contains('is-clamped'), h: e.clientHeight, role: e.getAttribute('role') }; });
        assert.ok(before.clamped, 'a hosszú szöveg nem vágódott (a teszt szövege túl rövid ezen a méreten)'); assert.equal(before.role, 'button');
        await page.evaluate(() => document.querySelector('.cv-text').click());
        const open = await page.evaluate(() => { const e = document.querySelector('.cv-text'), r = e.getBoundingClientRect(); return { open: e.classList.contains('open'), full: e.scrollHeight <= e.clientHeight + 1, h: e.clientHeight, top: r.top, bottom: r.bottom, text: e.textContent, exp: e.getAttribute('aria-expanded') }; });
        assert.ok(open.open && open.exp === 'true'); assert.ok(open.h > before.h, 'nem nyílt ki');
        assert.ok(open.text.includes('háromszor'), 'a teljes szöveg nincs a DOM-ban'); assert.ok(open.top >= 60 && open.bottom <= (await page.evaluate(() => innerHeight)), 'a kinyitott szöveg kilóg');
        assert.ok(open.full || open.h >= 100, 'a kinyitott szöveg sem olvasható (nincs görgethető teljes szöveg)');
        await page.evaluate(() => document.querySelector('.cv-text').click());
        assert.equal(await page.evaluate(() => document.querySelector('.cv-text').classList.contains('open')), false, 'nem csukódott össze');
      });

      // ---- B) ítélet-mondat ----
      const verdict = (sentence) => ({ phase: 'verdict', phaseEndsAt: 0, caseNo: 'JV-2', verdict: { guilty: true, unanimous: false, guiltyVotes: 2, notGuiltyVotes: 1, sentence, votes: [], challengeResults: [] } });
      for (const [label, sentence] of Object.entries(SENTENCES)) {
        await check(tag + ' – ítélet-mondat (' + label + ', ' + sentence.length + ' karakter): kompakt sáv, nem takar; vágott esetben koppintásra a teljes mondat olvasható, újra koppintásra összecsukódik', async () => {
          await forge(page, verdict(sentence));
          await waitCalm(page);
          const m = await page.evaluate(measure);
          const c = await page.evaluate(() => { const e = document.querySelector('.sc-text'); return { clamped: e.classList.contains('is-clamped'), h: e.clientHeight, role: e.getAttribute('role'), fs: parseFloat(getComputedStyle(e).fontSize) }; });
          assert.ok(m.panel && m.panel.l >= -1 && m.panel.r <= m.vw + 1 && m.panel.b <= m.vh + 1, 'a sáv kilóg: ' + JSON.stringify(m.panel));
          assert.ok(m.overlap <= MAX_OVERLAP, 'az ítélet-sáv takarja: ' + m.worst + ' ' + Math.round(100 * m.overlap) + '% (' + Math.round(m.panel.h) + ' px)');
          assert.ok(c.fs >= 13, 'olvashatatlanul kicsi betű: ' + c.fs);
          if (label === 'rövid') { assert.equal(c.clamped, false, 'a rövid mondat nem vágódhat'); return; }
          if (label === 'nagyon hosszú') assert.ok(c.clamped, 'a nagyon hosszú mondat nem vágódott');
          if (c.clamped) {
            assert.equal(c.role, 'button', 'a vágott mondat nem kezelhető gombként (billentyűzet / képernyőolvasó)');
            await shot(page, tag + '-verdict-' + label.replace(' ', '-') + '-clamped');
            await page.evaluate(() => document.querySelector('.sc-text').click());
            const o = await page.evaluate(() => { const e = document.querySelector('.sc-text'), r = e.getBoundingClientRect(); return { open: e.classList.contains('open'), h: e.clientHeight, scroll: e.scrollHeight, text: e.textContent, top: r.top, bottom: r.bottom, vh: innerHeight, ov: getComputedStyle(e).overflowY }; });
            assert.ok(o.open && o.h > c.h, 'a koppintás nem nyitotta ki a mondatot');
            assert.equal(o.text, sentence, 'a teljes mondat nincs a DOM-ban');
            assert.ok(o.top >= 0 && o.bottom <= o.vh, 'a kinyitott mondat kilóg a képernyőről');
            assert.ok(o.scroll <= o.h + 1 || o.ov === 'auto', 'a kinyitott mondat sem olvasható végig');
            await shot(page, tag + '-verdict-' + label.replace(' ', '-') + '-open');
            // billentyűzettel is: Enter összecsukja
            await page.focus('.sc-text'); await page.keyboard.press('Enter');
            assert.equal(await page.evaluate(() => document.querySelector('.sc-text').classList.contains('open')), false, 'Enter nem csukta össze');
          }
        });
      }
      await check(tag + ' – bíró kihívás-ellenőrzés: hosszú kihívás-szöveg vágott, koppintásra teljes', async () => {
        const long = 'A beszéd közben hirtelen kezdj el énekelni egy lassú, érzelmes dalt a saját szavaiddal, közben nézz mélyen a bíró szemébe, és minden mondat végén ismételd meg az utolsó szót háromszor.';
        await forge(page, { phase: 'challenge_review', phaseEndsAt: 0, caseNo: 'JV-3', challengeReview: { current: 0, total: 1, challenges: [{ who: 'prosecutor', name: 'Gamma', judgeName: 'Robi', text: long, difficulty: true, iAmJudge: true, judged: false, funYes: 0, funNo: 0 }] } });
        await waitCalm(page);
        const m = await page.evaluate(measure);
        assert.ok(m.overlap <= MAX_OVERLAP, 'az ellenőrző sáv takarja: ' + m.worst + ' ' + Math.round(100 * m.overlap) + '%');
        const c = await page.evaluate(() => { const e = document.querySelector('.rv-text'); return { clamped: e.classList.contains('is-clamped') }; });
        if (c.clamped) {
          await page.evaluate(() => document.querySelector('.rv-text').click());
          const o = await page.evaluate(() => { const e = document.querySelector('.rv-text'); return { open: e.classList.contains('open'), text: e.textContent }; });
          assert.ok(o.open && o.text.includes('háromszor'), 'nem nyílt ki a teljes kihívás');
        }
        assert.ok(await page.evaluate(() => !!document.getElementById('rvDone') && !!document.getElementById('rvFail')), 'a ✓ SIKERÜLT / ✕ NEM SIKERÜLT gomb hiányzik');
      });
      await check(tag + ' – nincs JavaScript-hiba a kovácsolt állapotoknál', async () => assert.deepEqual(g.errors, [], g.errors.join(' | ')));
    }
    for (const x of games) await x.g.context.close();

    // ======================= C) valódi eskütt-módos játék =======================
    const realVps = [{ width: 1366, height: 768 }, { width: 390, height: 844 }];
    const real = await Promise.all(realVps.map(async (vp) => ({ vp, g: await startGame(browser, vp, { prep: 10, speech: 15, bots: 5, jury: true, rounds: 1 }) })));
    for (const x of real) open.push(x.g.context);
    const logs = real.map(() => ({ phases: new Set(), problems: [], voteSeen: 0, voted: 0, canVoteSeen: false, maxChips: 0 }));
    await Promise.all(real.map(async ({ vp, g }, k) => {
      const t0 = Date.now();
      while (Date.now() - t0 < 270000) {
        let st;
        try {
          st = await g.page.evaluate(() => {
            const out = { phase: S.phase, mode: S.settings && S.settings.challengeMode };
            if (S.phase === 'challenge_vote') {
              const m = (() => { const vis = (el) => !!el && el.offsetParent !== null; const R = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
                const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
                const panel = document.getElementById('scenePanel'), pc = panel.querySelector('.phase-content'); const shown = !!pc && vis(pc) && getComputedStyle(panel).visibility !== 'hidden' && !document.body.dataset.courtMajor;
                const figs = [...document.querySelectorAll('#stageSlots .stage-slot[data-role]:not([data-role="juror"]) .st-art, #judge .st-art')].filter(vis).map((e) => R(e)).filter((r) => r.w > 20);
                const rp = shown ? R(pc) : null; return { shown, overlap: rp ? Math.max(0, ...figs.map((f) => area(f, rp) / (f.w * f.h))) : 0, h: rp ? rp.h : 0 }; })();
              out.vote = { shown: m.shown, overlap: m.overlap, h: m.h, canVote: !!(S.challengeVote && S.challengeVote.canVote), n: S.challengeVote ? S.challengeVote.challenges.length : 0, chips: document.querySelectorAll('.cv-chip').length, strip: !!document.querySelector('.cv-strip') };
            }
            return out;
          });
        } catch (_) { await pause(300); continue; }
        logs[k].phases.add(st.phase);
        if (st.vote && st.vote.shown) {
          logs[k].voteSeen++; logs[k].maxChips = Math.max(logs[k].maxChips, st.vote.chips);
          if (!st.vote.strip) logs[k].problems.push('nincs .cv-strip a szavazásnál');
          if (st.vote.overlap > MAX_OVERLAP) logs[k].problems.push('szavazó-sáv takarás ' + Math.round(100 * st.vote.overlap) + '% (' + Math.round(st.vote.h) + ' px)');
          if (st.vote.canVote) logs[k].canVoteSeen = true;
        }
        if (st.phase === 'challenge_vote' && st.vote && st.vote.canVote) {
          // szavazunk az éppen látszó kihívásra (a lapozás a sorszám-gombokkal / ugrással megy)
          const did = await g.page.evaluate(() => { const b = [...document.querySelectorAll('.cv-btn[data-done="1"]')].find((x) => !x.disabled); if (b) { b.click(); return true; } return false; }).catch(() => false);
          if (did) logs[k].voted++;
        }
        await g.page.evaluate(() => { for (const id of ['iaAccRead', 'iaDone', 'btnNextRound', 'rvDone', 'voteGuilty', 'objAccept']) { const b = document.getElementById(id); if (b && !b.disabled) { b.click(); break; } } }).catch(() => {});
        if (st.phase === 'verdict') { logs[k].vAt = logs[k].vAt || Date.now(); if (Date.now() - logs[k].vAt > 4800) await g.page.evaluate(() => { const b = document.getElementById('btnProceed'); if (b && !b.disabled) b.click(); }).catch(() => {}); } else logs[k].vAt = 0;
        if (st.phase === 'game_over' || (logs[k].phases.has('challenge_vote') && st.phase === 'verdict' && logs[k].vAt && Date.now() - logs[k].vAt > 1500)) break;
        await pause(300);
      }
    }));
    for (let k = 0; k < real.length; k++) {
      const tag = real[k].vp.width + '×' + real[k].vp.height;
      await check(tag + ' – valódi eskütt-módos játék: a szerver végigviszi a kihívás-szavazást (challenge_vote → verdict), a sáv nem takar, nincs JS-hiba', async () => {
        assert.ok(logs[k].phases.has('challenge_vote'), 'nem volt challenge_vote fázis (volt: ' + [...logs[k].phases].join(',') + ')');
        assert.ok(logs[k].phases.has('verdict'), 'a szavazás után nem jött ítélet');
        // ha a játékos maga szavazhatott, a sávnak látszania kellett; nézőként a fázis rövid lehet (a botok gyorsan szavaznak, a kihívás-bemutató pedig 2 mp-ig elrejti a sávot)
        if (logs[k].canVoteSeen) assert.ok(logs[k].voteSeen >= 1, 'a szavazó-sáv nem látszott a szavazónak');
        assert.deepEqual([...new Set(logs[k].problems)], [], logs[k].problems.join(' | '));
        assert.deepEqual(real[k].g.errors, [], real[k].g.errors.join(' | '));
        console.log('   (' + tag + ': szavazó-sáv minták: ' + logs[k].voteSeen + ', a játékos szavazhatott: ' + logs[k].canVoteSeen + ', leadott szavazat: ' + logs[k].voted + ', lapozó-gombok max: ' + logs[k].maxChips + ')');
      });
    }
  } catch (e) {
    failed++; console.error('FAIL: a teszt megszakadt: ' + (e && e.stack || e));
  } finally {
    for (const c of open) await c.close().catch(() => {});
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(`\nEskütt-mód + hosszú ítélet: ${passed} sikeres, ${failed} hibás.`);
  process.exit(failed ? 1 : 0);
})();
