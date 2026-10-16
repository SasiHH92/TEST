'use strict';
// ============================================================
// KAMU BÍRÓSÁG – kártya-visszajelzés a böngészőben (Playwright)
//   - az ítélet-sáv lenyitható részleteiben és a KÖR VÉGE képernyőn megjelenik a "Vicces volt a vád? 😂 / 👎" sor (számokkal, a saját szavazat kiemelve)
//   - a gomb a megfelelő `acc_fun_vote` üzenetet küldi (ugyanarra újra kattintva visszavonás: up:null), tiltva, ha nem szavazhat
//   - nincs sor, ha a szerver nem küld `accFun`-t (egyéni vád / közösségi csomag)
//   - asztali (1366×768) és telefonos (390×844) méreten nincs vízszintes kilógás, a gombok a képernyőn vannak
//   - a szerver a hibás `acc_fun_vote` üzeneteket (rossz típus, hiányzó adat) csendben eldobja
// Futtatás: node test/card-feedback-ui.js     (böngésző: CHROMIUM_PATH / Edge / Chrome / Playwright Chromium; ha nincs: SKIP, CFUI_REQUIRE=1 esetén hiba)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { io } = require('socket.io-client');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.CFUI_PORT || 3251), BASE = 'http://127.0.0.1:' + PORT;
const REQUIRE = process.env.CFUI_REQUIRE === '1';
const SHOTS = process.env.CFUI_SHOTS ? path.resolve(process.env.CFUI_SHOTS) : '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-cfui-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky/i;

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) { try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ } }
  return null;
}
async function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '',
    AUTH_BASE_URL: BASE, DATABASE_URL: '', MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'),
    KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json'), KB_CARDFB_FILE: path.join(tmp, 'cf.json'), KB_PACKS_FILE: path.join(tmp, 'p.json'), KB_COURTS_FILE: path.join(tmp, 'c.json'),
    KB_MODERATION_FILE: path.join(tmp, 'm.json'), KB_BUGREPORTS_FILE: path.join(tmp, 'b.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}

// játék indítása egy vendéggel + botokkal (a szoba lobbijából a tárgyalásig)
async function startGame(browser, viewport) {
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
  await page.fill('#guestName', 'Ertekelo ' + viewport.width);
  await page.evaluate(() => document.getElementById('btnGuestGo').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'menu');
  await page.evaluate(() => document.getElementById('btnCreate').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
  for (let i = 0; i < 3; i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(220); }
  await page.evaluate(() => {
    document.getElementById('btnCustomGame').click();
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('setSpeech', 15); set('setDefender', 15); set('setPrep', 120); set('setWitness', 10); set('setClosing', 10); set('setRounds', 1);
    const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
    document.getElementById('btnSaveSettings').click();
  });
  await page.waitForFunction(() => S.settings.prepSeconds === 120, null, { timeout: 6000 });
  await page.evaluate(() => document.getElementById('btnStartGame').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
  await page.waitForFunction(() => S && S.phase === 'accusation', null, { timeout: 15000 });
  await page.evaluate(() => { const b = document.getElementById('iaAccRead'); if (b) b.click(); });
  await page.waitForFunction(() => S.phase === 'prep', null, { timeout: 20000 });
  await page.waitForTimeout(3300);
  // a kovácsolt állapotot a szerver következő üzenete ne írja felül; az elküldött üzenetek (név + teljes adat) gyűjtése
  await page.evaluate(() => { KICKED_FROM_ROOM = true; window.__emits = []; const o = socket.emit.bind(socket); socket.emit = (...a) => { window.__emits.push(a.filter((x) => typeof x !== 'function')); return o(...a); }; });
  return { context, page, errors };
}
const forge = async (page, patch) => {
  await page.evaluate((p) => { window.__S0 = window.__S0 || JSON.parse(JSON.stringify(S)); S = Object.assign(JSON.parse(JSON.stringify(window.__S0)), p); renderGame(); }, patch);
  await pause(250);
};
const accFun = (extra) => Object.assign({ yes: 2, no: 1, mine: null, canVote: true }, extra || {});
const VERDICT = (acc) => ({ phase: 'verdict', phaseEndsAt: 0, caseNo: 'CF-1', round: 1, accFun: acc, verdict: { guilty: true, unanimous: false, sentence: 'Egy napig kávét főz.', votes: [], challengeResults: [] } });
const RESULTS = (acc) => ({ phase: 'round_results', phaseEndsAt: 0, caseNo: 'CF-1', round: 1, accFun: acc, scoreEvents: [],
  roundResults: { scores: [{ id: 'a1', name: 'Anna', avatar: '', score: 3 }, { id: 'b2', name: 'Bela', avatar: '', score: 1 }], favorite: null, hasNextRound: true } });
const lastEmit = (page) => page.evaluate(() => window.__emits[window.__emits.length - 1]);

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(REQUIRE ? 1 : 0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(REQUIRE ? 1 : 0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  const open = [];
  try {
    for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const tag = vp.width + '×' + vp.height;
      const g = await startGame(browser, vp); open.push(g.context);
      const page = g.page;
      await check('kör vége képernyő (' + tag + '): megjelenik a sor számokkal, a gombok a képernyőn vannak, nincs vízszintes kilógás', async () => {
        await forge(page, RESULTS(accFun()));
        const info = await page.evaluate(() => {
          const row = document.querySelector('.acc-fun-row'); if (!row) return null;
          const b = [...row.querySelectorAll('.acc-fun')].map((x) => { const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), l: r.left, r: r.right, top: r.top, bottom: r.bottom, dis: x.disabled, pressed: x.getAttribute('aria-pressed') }; });
          const board = document.querySelector('.rr-board');
          return { text: row.textContent.replace(/\s+/g, ' ').trim(), b, vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth - innerWidth, above: board ? row.getBoundingClientRect().bottom <= board.getBoundingClientRect().top + 1 : null };
        });
        assert.ok(info, 'van .acc-fun-row');
        assert.match(info.text, /Vicces volt a vád\?/);
        assert.equal(info.b.length, 2);
        assert.match(info.b[0].t, /😂\s*2/); assert.match(info.b[1].t, /👎\s*1/);
        for (const x of info.b) { assert.ok(x.l >= 0 && x.r <= info.vw, 'a gomb vízszintesen a képernyőn van'); assert.ok(x.bottom > 0 && x.top < info.vh, 'a gomb a látható sávban van (görgetés nélkül)'); assert.equal(x.dis, false); }
        assert.ok(info.over <= 1, 'nincs vízszintes kilógás (' + info.over + ')');
        assert.equal(info.above, true, 'a sor a pontlista felett van');
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'cfui-results-' + tag + '.png') }); }
      });
      await check('kattintás (' + tag + '): 😂 -> up:true; a saját szavazat kiemelve; ugyanarra újra -> up:null; a másikra váltás -> up:false', async () => {
        await forge(page, RESULTS(accFun()));
        await page.click('.acc-fun-row .acc-fun[data-acc="1"]');
        assert.deepEqual(await lastEmit(page), ['acc_fun_vote', { up: true }]);
        await forge(page, RESULTS(accFun({ mine: true, yes: 3 })));
        assert.equal(await page.getAttribute('.acc-fun[data-acc="1"]', 'aria-pressed'), 'true');
        assert.ok((await page.getAttribute('.acc-fun[data-acc="1"]', 'class')).includes('green'), 'a 😂 zölddel kiemelve');
        assert.equal(await page.getAttribute('.acc-fun[data-acc="0"]', 'aria-pressed'), 'false');
        await page.click('.acc-fun-row .acc-fun[data-acc="1"]');
        assert.deepEqual(await lastEmit(page), ['acc_fun_vote', { up: null }]);
        await page.click('.acc-fun-row .acc-fun[data-acc="0"]');
        assert.deepEqual(await lastEmit(page), ['acc_fun_vote', { up: false }]);
        await forge(page, RESULTS(accFun({ mine: false, no: 2 })));
        assert.ok((await page.getAttribute('.acc-fun[data-acc="0"]', 'class')).includes('red'), 'a 👎 pirossal kiemelve');
      });
      await check('ítélet-sáv (' + tag + '): a lenyitható részletekben ott a sor, a sáv nem lóg ki, a gomb működik', async () => {
        await forge(page, VERDICT(accFun()));
        const before = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, has: !!document.querySelector('.vd-body .acc-fun-row') }));
        assert.equal(before.has, true); assert.ok(before.over <= 1, 'nyitás előtt nincs kilógás');
        await page.evaluate(() => { document.querySelector('.vd-details').open = true; });
        await pause(200);
        const after = await page.evaluate(() => {
          const r = document.querySelector('.vd-body .acc-fun').getBoundingClientRect();
          return { over: document.documentElement.scrollWidth - innerWidth, l: r.left, rr: r.right, vw: innerWidth };
        });
        assert.ok(after.over <= 1, 'nyitás után sincs kilógás'); assert.ok(after.l >= 0 && after.rr <= after.vw);
        await page.click('.vd-body .acc-fun[data-acc="0"]');
        assert.deepEqual(await lastEmit(page), ['acc_fun_vote', { up: false }]);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cfui-verdict-' + tag + '.png') });
      });
      await check('nincs sor, ha a szerver nem küld accFun-t; tiltva, ha nem szavazhat (' + tag + ')', async () => {
        await forge(page, RESULTS(undefined));
        assert.equal(await page.locator('.acc-fun-row').count(), 0);
        await forge(page, VERDICT(undefined));
        assert.equal(await page.locator('.acc-fun-row').count(), 0);
        await forge(page, RESULTS(accFun({ canVote: false })));
        assert.equal(await page.locator('.acc-fun-row .acc-fun:disabled').count(), 2);
        const n = await page.evaluate(() => window.__emits.length);
        await page.click('.acc-fun-row .acc-fun[data-acc="1"]', { force: true, timeout: 1000 }).catch(() => { /* a tiltott gomb nem kattintható: rendben */ });
        assert.equal(await page.evaluate(() => window.__emits.length), n, 'tiltott gombra nem megy üzenet');
      });
      await check('nincs oldalhiba / konzolhiba (' + tag + ')', async () => { assert.deepEqual(g.errors, []); });
    }

    // ---- a szerver a hibás üzeneteket csendben eldobja ----
    await check('szerver: hibás acc_fun_vote üzenetek (típus, hiány, szoba nélkül) nem okoznak hibát', async () => {
      const s = io(BASE, { transports: ['websocket'], reconnection: false });
      await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); });
      for (const bad of [undefined, null, 'igen', 7, {}, { up: 'x' }, { up: 1 }, { up: {} }, { up: [true] }]) s.emit('acc_fun_vote', bad); // szoba nélkül
      const r = await new Promise((resolve) => s.emit('create_room', { name: 'Hiba Hugo', avatar: '', playerId: 'hh1' }, resolve));
      assert.ok(r.code);
      for (const bad of [undefined, null, 'igen', 7, {}, { up: 'x' }, { up: 1 }, { up: {} }, { up: [true] }, { up: true }, { up: false }, { up: null }]) s.emit('acc_fun_vote', bad); // lobbiban
      await pause(400);
      assert.equal((await fetch(BASE + '/health')).ok, true);
      s.disconnect();
      const errFile = path.join(tmp, 'e.json');
      assert.ok(!fs.existsSync(errFile) || !/acc_fun|accusationFunVote/.test(fs.readFileSync(errFile, 'utf8')), 'nincs szerver-hiba a naplóban');
    });
  } finally {
    for (const c of open) { try { await c.close(); } catch (_) { /* */ } }
    await browser.close();
    server.kill();
  }
  console.log('\nKártya-visszajelzés (böngésző): ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exit(failed ? 1 : 0);
})();
