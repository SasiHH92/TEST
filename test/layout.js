'use strict';
// ============================================================
// KAMU BÍRÓSÁG – elrendezés-ellenőrzés valódi böngészőben (Playwright), telefonos és gépi méreteken
//
// Minden méreten végigmegy a képernyőkön (belépés, névválasztó, menü, lobbi, csevegő, játék), és mindegyiken méri:
//   - nincs vízszintes görgetés,
//   - a fontos, rögzített elemek (infó-gomb, sarok-kapcsolók, barát/csevegő gomb, panelek, HUD-sávok) nem lógnak ki,
//   - és nem fedik egymást,
//   - nincs JavaScript-hiba a konzolon.
// Emellett ellenőrzi a „kevesebb mozgás" kapcsolót és az ítélet-effektek (galambok, rázkódás) viselkedését.
//
// Futtatás:  npm run test:layout
// Böngésző:  CHROMIUM_PATH=<futtatható fájl>  – egyébként a gépen lévő Edge / Chrome (Playwright csatorna),
//            végül a Playwright saját Chromiumja (npx playwright install chromium).
//            Ha egyik sincs, a teszt "SKIP" üzenettel 0-val kilép (LAYOUT_REQUIRE=1 esetén hibával).
// Képernyőképek: LAYOUT_SHOTS=./QA_SCREENSHOTS
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const ioClient = require('socket.io-client');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.LAYOUT_PORT || 3191), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-layout-'));
const SHOTS = process.env.LAYOUT_SHOTS ? path.resolve(process.env.LAYOUT_SHOTS) : '';
const REQUIRE = process.env.LAYOUT_REQUIRE === '1';

// [szélesség, magasság, név, játék-ellenőrzés is?]
const VIEWPORTS = [
  [320, 568, 'régi telefon', false],
  [360, 640, 'kis Android', true],
  [360, 800, 'Android', false],
  [375, 812, 'iPhone', false],
  [390, 844, 'iPhone 14', true],
  [414, 896, 'nagy telefon', false],
  [768, 1024, 'tablet', false],
  [1024, 768, 'kis laptop / tablet fekvő', true],
  [1366, 768, 'laptop', true],
  [1440, 900, 'nagy laptop', false],
  [1920, 1080, 'full HD', true]
];

let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}

// A böngészőben fut: visszaadja a talált elrendezési hibák szövegét.
function audit() {
  const vw = innerWidth, vh = innerHeight, out = [];
  const rect = (el) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2 || parseFloat(cs.opacity) < 0.1) return null;
    if (el.closest('.hidden')) return null;
    if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) return null; // teljesen a képernyőn kívül (pl. zárt kihúzható panel)
    // a vád-sáv nyitó animációja közben (charge-intro) a kártya szándékosan a színpad közepén áll
    if (el.classList.contains('accusation-ticker') && el.classList.contains('charge-intro')) return null;
    return r;
  };
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  if (document.documentElement.scrollWidth > vw + 1) out.push('VÍZSZINTES GÖRGETÉS ' + document.documentElement.scrollWidth + '>' + vw);
  const named = [
    ['infó-gomb', '.info-btn'], ['sarok-kapcsolók', '#comfortDock'], ['barát-gomb', '#friendsFab'], ['csevegő-gomb', '#chatFab'],
    ['csevegő-panel', '#chatPanel:not(.embedded)'], ['értesítés', '#toastBox.visible'], ['hírszalag', '.ticker'], ['meghívó', '.invite-card'],
    ['infósáv', '#screen-game .info-bar'], ['szerep-sáv', '#screen-game .role-banner'], ['vád-sáv', '#screen-game .accusation-ticker'],
    ['fázis-panel', '#screen-game #scenePanel'], ['oldalsáv', '#screen-game .score-sidebar'], ['pontok-gomb', '#sbToggle'],
    ['kártyáim', '#screen-game #myCardsBar'], ['bíró-figyelő', '#screen-game #judgeWatch'], ['bíró-buborék', '#screen-game .judge-bubble']
  ];
  const items = [];
  for (const [name, sel] of named) for (const el of document.querySelectorAll(sel)) { const r = rect(el); if (r) items.push({ name, r, el }); }
  for (const p of document.querySelectorAll('.stage-plate')) { const r = rect(p); if (r) items.push({ name: 'névtábla ' + p.innerText.replace(/\n/g, ' ').slice(0, 14), r, el: p }); }
  for (const it of items) {
    if (it.r.left < -2 || it.r.right > vw + 2) out.push('KILÓG vízszintesen: ' + it.name + ' (' + Math.round(it.r.left) + '..' + Math.round(it.r.right) + ' / ' + vw + ')');
    if (it.r.top < -2 || it.r.bottom > vh + 2) { if (!/hírszalag|panel|oldalsáv/.test(it.name)) out.push('KILÓG függőlegesen: ' + it.name + ' (' + Math.round(it.r.top) + '..' + Math.round(it.r.bottom) + ' / ' + vh + ')'); }
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.name === b.name && !/névtábla/.test(a.name)) continue;
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue; // szülő-gyerek: szándékos (pl. az infó-gomb az infósávban ül)
    if (a.name === 'értesítés' || b.name === 'értesítés') continue; // az értesítés átmeneti, szándékosan fed
    const area = inter(a.r, b.r);
    const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
    if (area > 40 && area / smaller > 0.04) out.push('ÁTFEDÉS: ' + a.name + ' × ' + b.name + ' (' + Math.round(100 * area / smaller) + '% a kisebbikből)');
  }
  return { screen: document.body.dataset.screen || '', problems: out };
}

async function launch() {
  const attempts = process.env.CHROMIUM_PATH
    ? [{ executablePath: process.env.CHROMIUM_PATH }]
    : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) {
    try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ }
  }
  return null;
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name.replace(/[^a-z0-9._-]/gi, '_') + '.png') });
}

// Egy képernyő ellenőrzése: elrendezési hibák nélkül.
async function expectClean(page, label, vp) {
  const result = await page.evaluate(audit);
  await shot(page, vp[0] + 'x' + vp[1] + '-' + label);
  assert.deepEqual(result.problems, [], '[' + vp[0] + 'x' + vp[1] + ' ' + label + ' / ' + result.screen + '] ' + result.problems.join(' | '));
}

async function walk(browser, vp) {
  const [width, height, label, game] = vp;
  const tag = width + 'x' + height + ' (' + label + ')';
  const touch = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, locale: 'hu-HU' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#authGuest');
    await page.waitForTimeout(600);

    await check(tag + ' – belépőoldal', async () => { await expectClean(page, 'auth', vp); });

    await page.click('#authGuest');
    await page.waitForFunction(() => document.body.dataset.screen === 'name');
    await page.waitForTimeout(800);
    await check(tag + ' – névválasztó (vendég): sarok-kapcsolók látszanak, nincs átfedés', async () => {
      assert.ok(await page.isVisible('#comfortDock'), 'a sarok-kapcsolók látszanak');
      await expectClean(page, 'name', vp);
    });

    await page.evaluate(() => document.getElementById('btnNewSuspect').click());
    await page.fill('#guestName', 'Layout ' + width);
    await page.evaluate(() => document.getElementById('btnGuestGo').click());
    await page.waitForFunction(() => document.body.dataset.screen === 'menu');
    await page.waitForTimeout(500);
    await check(tag + ' – menü', async () => { await expectClean(page, 'menu', vp); });

    await page.evaluate(() => document.getElementById('btnCreate').click());
    await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
    await page.waitForTimeout(900);
    await check(tag + ' – lobbi', async () => { await expectClean(page, 'lobby', vp); });

    await check(tag + ' – „kevesebb mozgás" kapcsoló a lobbiban: be/ki, megmarad, a játék-kapcsolóval közös', async () => {
      assert.equal(await page.getAttribute('#btnMotionDock', 'aria-pressed'), 'false');
      await page.click('#btnMotionDock');
      assert.equal(await page.getAttribute('#btnMotionDock', 'aria-pressed'), 'true');
      assert.ok(await page.evaluate(() => document.body.classList.contains('reduced-motion')), 'body.reduced-motion');
      assert.equal(await page.evaluate(() => localStorage.getItem('kb_reducedMotion')), '1');
      assert.match(await page.textContent('#btnReduceMotion'), /CSÖKKENT/, 'a játékbeli gomb is követi');
      await page.click('#btnMotionDock');
      assert.equal(await page.evaluate(() => localStorage.getItem('kb_reducedMotion')), '0');
      assert.ok(!(await page.evaluate(() => document.body.classList.contains('reduced-motion'))));
    });

    await check(tag + ' – hang-kapcsoló a lobbiban: némít / visszakapcsol', async () => {
      await page.click('#btnMuteDock');
      assert.equal(await page.evaluate(() => localStorage.getItem('kb_muted')), '1');
      assert.equal((await page.textContent('#btnMuteDock')).trim(), '🔇');
      await page.click('#btnMuteDock');
      assert.equal(await page.evaluate(() => localStorage.getItem('kb_muted')), '0');
    });

    await check(tag + ' – csevegő a lobbiban: megnyílik, a képernyőn belül marad, nem fed semmit', async () => {
      // széles képernyőn a csevegő a lobbiban magától, dokkolva nyílik (ilyenkor a lebegő gomb rejtve): a kbChat.open() mindkét esetben nyit
      await page.evaluate(() => window.kbChat.open());
      await page.waitForTimeout(500);
      assert.ok(await page.isVisible('#chatPanel'), 'a csevegő panel látszik');
      await expectClean(page, 'lobby-chat', vp);
      if (await page.isVisible('#chatFab')) await page.evaluate(() => document.getElementById('chatFab').click());
      else await page.evaluate(() => { const c = document.getElementById('chatClose'); if (c) c.click(); });
    });

    // Moderáció a csevegőben: egy másik játékos üzenete mellett ott a jelentés (⚑) és (a házigazdának) a némítás (🔇) gomb.
    await check(tag + ' – moderáció: jelentés és némítás a csevegőben, elrendezés tiszta', async () => {
      const code = await page.evaluate(() => window.kbInRoom().code);
      const mate = ioClient(BASE, { transports: ['websocket'], reconnection: false });
      await new Promise((resolve, reject) => { mate.once('connect', resolve); mate.once('connect_error', reject); });
      const ask = (event, payload) => new Promise((resolve) => mate.emit(event, payload, resolve));
      try {
        assert.ok((await ask('join_room', { code, name: 'Szomszed ' + width, playerId: 'mate-' + width })).state, 'a másik játékos belépett');
        assert.ok((await ask('chat_send', { text: 'Hahó, én vagyok a szomszéd!' })).ok);
        await page.evaluate(() => window.kbChat.open());
        await page.waitForSelector('#chatLog .chat-msg .cm-act[data-report]', { timeout: 8000 });
        assert.ok(await page.isVisible('#chatLog .cm-act[data-mute]'), 'a házigazda látja a némítás gombot');
        await expectClean(page, 'lobby-chat-mod', vp);
        // némítás: a másik játékos nem írhat, a gomb átvált, feloldásra újra írhat
        await page.click('#chatLog .cm-act[data-mute]');
        await page.waitForSelector('#chatLog .cm-act.on[data-mute]', { timeout: 5000 });
        assert.match((await ask('chat_send', { text: 'ezt már nem' })).error || '', /elnémított/);
        await expectClean(page, 'lobby-chat-muted', vp);
        await page.click('#chatLog .cm-act.on[data-mute]');
        await page.waitForSelector('#chatLog .cm-act[data-mute]:not(.on)', { timeout: 5000 });
        assert.ok((await ask('chat_send', { text: 'újra írhatok' })).ok);
        // jelentés: a gomb ✓-ra vált, a jelzés (⚑ 1) megjelenik
        await page.click('#chatLog .cm-act[data-report]');
        await page.waitForSelector('#chatLog .cm-act.done', { timeout: 5000 });
        await page.waitForSelector('#chatLog .cm-flag', { timeout: 5000 });
        await expectClean(page, 'lobby-chat-reported', vp);
      } finally {
        mate.disconnect();
        await page.evaluate(() => { const c = document.getElementById('chatClose'); if (c && c.offsetParent) c.click(); });
      }
    });

    if (game) {
      await check(tag + ' – játék: a HUD és a színpad átfedés nélkül a fázisokon át', async () => {
        await page.evaluate(() => { document.getElementById('btnAddBot').click(); });
        await page.waitForTimeout(250);
        await page.evaluate(() => { document.getElementById('btnAddBot').click(); });
        await page.waitForTimeout(250);
        await page.evaluate(() => {
          const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
          const mode = document.querySelector('#modeGrid .case-tab[data-mode]');
          if (mode && !mode.classList.contains('active-case')) mode.click();
          set('setSpeech', 15); set('setDefender', 15); set('setPrep', 10); set('setWitness', 10); set('setClosing', 10); set('setRounds', 1);
          document.getElementById('btnSaveSettings').click();
        });
        await page.waitForTimeout(400);
        await page.evaluate(() => document.getElementById('btnStartGame').click());
        await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 15000 });
        const seen = new Set();
        let before = { phase: '', keys: new Set() }; // csak az a hiba számít, ami két egymás utáni mérésben ugyanabban a fázisban is megvan (az átmenetek animációja nem)
        const deadline = Date.now() + 70000;
        while (Date.now() < deadline) {
          await page.waitForTimeout(1500);
          const phase = await page.evaluate(() => (typeof S !== 'undefined' && S && S.phase) || '');
          if (!phase) continue;
          const result = await page.evaluate(audit);
          if (!seen.has(phase)) { seen.add(phase); await shot(page, vp[0] + 'x' + vp[1] + '-game-' + phase); }
          const keys = new Set(result.problems.map((p) => p.replace(/\s*\(.*$/, '')));
          const lasting = result.problems.filter((p) => before.phase === phase && before.keys.has(p.replace(/\s*\(.*$/, '')));
          assert.deepEqual(lasting, [], '[' + tag + ' fázis: ' + phase + '] ' + lasting.join(' | '));
          before = { phase, keys };
          if (seen.size >= 4 && (phase === 'verdict_vote' || phase === 'verdict' || phase === 'round_results' || phase === 'game_over')) break;
        }
        assert.ok(seen.size >= 3, 'legalább 3 fázist láttunk: ' + [...seen].join(', '));
      });

      await check(tag + ' – ítélet-effektek: galambok és rázkódás teljes mozgásnál, csökkentettnél elmaradnak, nincs túlcsordulás', async () => {
        const out = await page.evaluate(async () => {
          const old = S;
          S = { ...(old || {}), phase: 'verdict' };
          const probe = {};
          probe.baseTransform = getComputedStyle(document.getElementById('scenePanel')).transform;
          charAnim.setReducedMotion(false);
          verdictCue({ guilty: false, unanimous: false });
          probe.doves = document.querySelectorAll('.dove').length;
          await new Promise((r) => setTimeout(r, 400));
          probe.scrollW = document.documentElement.scrollWidth;
          verdictCue({ guilty: true, unanimous: false });
          probe.shake = document.getElementById('scenePanel').classList.contains('verdict-shake');
          await new Promise((r) => setTimeout(r, 900));
          probe.shakeGone = !document.getElementById('scenePanel').classList.contains('verdict-shake');
          probe.transform = getComputedStyle(document.getElementById('scenePanel')).transform;
          charAnim.setReducedMotion(true);
          const before = document.querySelectorAll('.dove').length;
          verdictCue({ guilty: false, unanimous: false });
          verdictCue({ guilty: true, unanimous: false });
          probe.reducedNewDoves = document.querySelectorAll('.dove').length - before;
          probe.reducedShake = document.getElementById('scenePanel').classList.contains('verdict-shake');
          charAnim.setReducedMotion(false);
          S = old;
          probe.vw = innerWidth;
          return probe;
        });
        assert.ok(out.doves >= 3, 'galambok szállnak: ' + out.doves);
        assert.ok(out.scrollW <= out.vw + 1, 'a galambok nem okoznak vízszintes görgetést');
        assert.ok(out.shake && out.shakeGone, 'a bűnös ítélet megrázza a színpadot, majd megáll');
        assert.equal(out.transform, out.baseTransform, 'a rázkódás után nincs maradék eltolás');
        assert.equal(out.reducedNewDoves, 0, 'csökkentett mozgásnál nincs galamb');
        assert.ok(!out.reducedShake, 'csökkentett mozgásnál nincs rázkódás');
      });
    }

    await check(tag + ' – nincs JavaScript-hiba a konzolon', async () => { assert.deepEqual(errors, []); });
  } finally {
    await context.close();
  }
}

// Bejelentkezett fiókkal: a barát- és csevegő-gomb, a profil-sor és a lobbi együtt is átfedés nélkül van.
async function walkAccount(browser, vp) {
  const [width, height, label] = vp;
  const tag = width + 'x' + height + ' (' + label + ', fiókkal)';
  const touch = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, locale: 'hu-HU' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const password = 'Egy hosszú titok 123!';
    const register = await page.evaluate(async ({ name, email, password }) => {
      const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, email, password, confirmPassword: password }) });
      return r.status;
    }, { name: 'Fiók ' + width, email: crypto.randomUUID() + '@example.invalid', password });
    assert.equal(register, 201, 'a tesztfiók létrejött');
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#authContinue:not(.hidden)', { timeout: 15000 });
    await page.evaluate(() => document.getElementById('authContinue').click());
    await page.waitForFunction(() => ['name', 'menu'].includes(document.body.dataset.screen), null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    await check(tag + ' – belépés után (kártyaválasztó/menü)', async () => { await expectClean(page, 'acct-first', vp); });

    await page.evaluate(() => { const b = document.getElementById('btnCreate'); if (b && b.offsetParent) b.click(); });
    const reachedLobby = await page.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 4000 }).then(() => true, () => false);
    if (reachedLobby) {
      await page.waitForTimeout(1000);
      await check(tag + ' – lobbi: barát- és csevegő-gomb, sarok-kapcsolók', async () => {
        assert.ok(await page.isVisible('#friendsFab'), 'a barát-gomb látszik');
        await expectClean(page, 'acct-lobby', vp);
      });
      await check(tag + ' – barátlista megnyitva', async () => {
        await page.evaluate(() => document.getElementById('friendsFab').click());
        await page.waitForTimeout(700);
        await expectClean(page, 'acct-friends', vp);
        await page.keyboard.press('Escape');
      });
    }
    await check(tag + ' – nincs JavaScript-hiba', async () => { assert.deepEqual(errors, []); });
  } finally {
    await context.close();
  }
}

async function main() {
  if (!chromium) {
    console.log('SKIP: a playwright-core nincs telepítve (npm install).');
    process.exitCode = REQUIRE ? 1 : 0;
    return;
  }
  const browser = await launch();
  if (!browser) {
    console.log('SKIP: nincs használható böngésző (adj meg CHROMIUM_PATH-t, vagy: npx playwright install chromium).');
    process.exitCode = REQUIRE ? 1 : 0;
    return;
  }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DATABASE_URL: '', MAX_ROOMS_PER_IP: '60', MAX_SOCKETS_PER_IP: '200', REPORTS_PER_10_MIN: '200', // a teszt minden böngészője ugyanarról a címről jön
      AUTH_STORE_PATH: path.join(tmp, 'accounts.json'), KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_STATS_FILE: path.join(tmp, 'stats.json'),
      KB_DMS_FILE: path.join(tmp, 'dms.json'), KB_ERRORS_FILE: path.join(tmp, 'errors.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');
    console.log('Böngésző: ' + browser.version() + ', ' + VIEWPORTS.length + ' méret');
    // A játékos-méretek párhuzamosan futnak (külön böngészőkörnyezet és szoba mindegyiknek).
    await Promise.all(VIEWPORTS.map((vp) => walk(browser, vp).catch((e) => { failed++; console.error('FAIL: ' + vp[0] + 'x' + vp[1] + ' – megszakadt: ' + (e && e.message)); })));
    for (const vp of [VIEWPORTS[1], VIEWPORTS[4], VIEWPORTS[8]]) await walkAccount(browser, vp).catch((e) => { failed++; console.error('FAIL: fiókos ' + vp[0] + 'x' + vp[1] + ' – megszakadt: ' + (e && e.message)); });
    // A tartalom-biztonsági szabály (CSP) mellett is működnie kell az /admin oldal külső szkriptjének (ADMIN_TOKEN nélkül a szerver 404-et ad, ezt a szkript kiírja).
    await check('/admin oldal: a külső szkript fut a CSP mellett, nincs CSP-sértés', async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const problems = [];
      page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to/.test(m.text())) problems.push(m.text()); });
      page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
      try {
        await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
        await page.fill('#token', 'valami-hosszu-teszt-token-0123456789');
        await page.evaluate(() => document.getElementById('loginForm').requestSubmit());
        await page.waitForFunction(() => document.getElementById('loginMsg').textContent.length > 0, null, { timeout: 5000 });
        assert.match(await page.textContent('#loginMsg'), /nincs bekapcsolva|admin token/i);
        assert.deepEqual(problems, []);
      } finally { await context.close(); }
    });

    await check('a szerver nem naplózott hibát a böngészős futás alatt', async () => {
      assert.ok(!/HIBA a\(z\)|uncaughtException|unhandledRejection/.test(stderr), stderr.slice(0, 400));
    });
  } finally {
    await browser.close().catch(() => {});
    child.kill();
    await pause(150);
  }
}

main().catch((e) => { failed++; console.error(e && e.stack || e); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nElrendezés: ' + passed + ' sikeres, ' + failed + ' hibás ellenőrzés.');
  process.exitCode = failed ? 1 : (process.exitCode || 0);
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
