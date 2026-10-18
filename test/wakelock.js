'use strict';
// ============================================================
// KAMU BÍRÓSÁG – a képernyő ébren tartása szobában (public/wakelock.js, Screen Wake Lock API)
//   A böngésző valódi zárját fejetlen módban nem lehet megfigyelni, ezért egy figyelő (ál) navigator.wakeLock rögzíti a kéréseket / elengedéseket:
//   belépés, névválasztó, menü: nincs kérés; lobbi: kér; játék: ébren marad (nincs új kérés); háttérbe kerülés: elenged; visszatérés: újra kér;
//   kilépés a játékból: elenged. A valódi API-val (ál nélkül) csak azt nézi, hogy nincs JS-hiba (megtagadott kérésnél sem).
// Futtatás: node test/wakelock.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }
const PORT = Number(process.env.WAKE_PORT || 3263), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-wake-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
  return null;
}
async function startServer() {
  const f = (x) => path.join(tmp, x);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { /* */ } await pause(150); }
  child.kill();
  throw new Error('a szerver nem indult el');
}
// figyelő (ál) Wake Lock: minden kérés / elengedés a window.__wl naplóba kerül
function fakeWakeLock() {
  const log = []; window.__wl = log;
  const api = { request: async (type) => {
    const listeners = [];
    const s = { type, released: false, addEventListener: (ev, fn) => { if (ev === 'release') listeners.push(fn); },
      release: async () => { if (s.released) return; s.released = true; log.push('release'); listeners.forEach((fn) => fn()); } };
    log.push('request:' + type); window.__wlSentinel = s; return s;
  } };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, get: () => api });
}
// az oldal láthatóságának állítása (a böngésző háttérbe kerüléskor maga is elengedi a zárat)
function setVisibility(v) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  if (v === 'hidden' && window.__wlSentinel) window.__wlSentinel.release();
  document.dispatchEvent(new Event('visibilitychange'));
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  try {
    const enterLobby = async (page) => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#authGuest'); await page.click('#authGuest');
      await page.waitForFunction(() => document.body.dataset.screen === 'name');
      await page.evaluate(() => document.getElementById('btnNewSuspect').click()); await page.fill('#guestName', 'Ébren Elek');
      await page.evaluate(() => document.getElementById('btnGuestGo').click());
      await page.waitForFunction(() => document.body.dataset.screen === 'menu');
    };
    // ---------- a viselkedés, figyelő Wake Lockkal ----------
    {
      const context = await browser.newContext({ viewport: { width: 800, height: 360 }, isMobile: true, hasTouch: true, locale: 'hu-HU' });
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
      await context.addInitScript(fakeWakeLock);
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const log = () => page.evaluate(() => window.__wl.slice());
      const state = () => page.evaluate(() => window.kbWakeLock.state());
      await enterLobby(page);
      await check('belépés, névválasztó, menü: nem kér ébren tartást', async () => {
        assert.deepEqual(await log(), []);
        assert.equal((await state()).active, false);
      });
      await page.evaluate(() => document.getElementById('btnCreate').click());
      await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
      await check('lobbi: ébren tartást kér (screen)', async () => {
        await page.waitForFunction(() => window.kbWakeLock.state().active, null, { timeout: 3000 });
        assert.deepEqual(await log(), ['request:screen']);
      });
      for (let i = 0; i < 2; i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(200); }
      await page.evaluate(() => { document.getElementById('btnCustomGame').click(); const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click(); });
      await pause(300);
      await page.evaluate(() => document.getElementById('btnStartGame').click());
      await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 15000 });
      await check('játék: ébren marad, nincs fölösleges új kérés', async () => {
        await pause(400);
        assert.equal((await state()).active, true);
        assert.deepEqual(await log(), ['request:screen']);
      });
      await check('háttérbe kerülés: elengedi; visszatérés: újra kéri', async () => {
        await page.evaluate(setVisibility, 'hidden');
        await pause(200);
        assert.equal((await state()).active, false, 'háttérben nincs zár');
        await page.evaluate(setVisibility, 'visible');
        await page.waitForFunction(() => window.kbWakeLock.state().active, null, { timeout: 3000 });
        assert.deepEqual(await log(), ['request:screen', 'release', 'request:screen']);
      });
      await check('kilépés a játékból (menü): elengedi', async () => {
        await page.evaluate(() => document.getElementById('btnLeaveGame').click());
        await page.waitForSelector('#cfOk', { state: 'visible' }); await page.click('#cfOk');
        await page.waitForFunction(() => document.body.dataset.screen === 'menu', null, { timeout: 8000 });
        await pause(300);
        assert.equal((await state()).active, false);
        assert.equal((await log()).slice(-1)[0], 'release');
      });
      await check('nincs JS-hiba (figyelő Wake Lockkal)', async () => { assert.deepEqual(errors, []); });
      await context.close();
    }
    // ---------- a valódi API-val: nem okoz hibát (akkor sem, ha a böngésző megtagadja) ----------
    {
      const context = await browser.newContext({ viewport: { width: 800, height: 360 }, locale: 'hu-HU' });
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && /wake/i.test(m.text())) errors.push(m.text()); });
      await enterLobby(page);
      await page.evaluate(() => document.getElementById('btnCreate').click());
      await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
      await pause(800);
      await check('valódi Wake Lock API: a lobbiban nincs JS-hiba; az API elérhető (biztonságos környezet)', async () => {
        const st = await page.evaluate(() => window.kbWakeLock.state());
        assert.equal(st.supported, true, 'a böngésző ismeri a Wake Lock API-t');
        assert.equal(st.wanted, true);
        assert.deepEqual(errors, []);
      });
      await context.close();
    }
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nÉbren tartás: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
