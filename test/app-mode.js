'use strict';
// ============================================================
// KAMU BÍRÓSÁG – Play-alkalmazás mód (public/app-mode.js): az önkéntes támogatás (Ko-fi) linkjei az alkalmazásban nem látszanak, a weben igen
//   web: a menü, a lobbi, a profil és a játék vége támogatási linkje látszik; a /tamogatas oldalon ott a Ko-fi gomb
//   alkalmazás (android-app://com.kamubirosag.app hivatkozó, vagy ?app=android): a fenti linkek rejtve; a /tamogatas oldal csak semleges üzenetet mutat;
//   az alkalmazás-mód a munkamenetben megmarad (újratöltés, belső navigáció), de egy új böngészőlapon (a telefon Chrome-ja) nincs
// Futtatás: node test/app-mode.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { fixture } = require('./browser-check');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }
const PORT = Number(process.env.APPMODE_PORT || 3264), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-appmode-'));
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

// a támogatási elemek láthatósága: a valódi elemek a menüben / lobbiban; a profil és a játék vége gombját a saját osztályával próbáljuk ki
function supportVisibility() {
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  const probe = (html) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); const v = vis(d.firstElementChild); d.remove(); return v; };
  return {
    inApp: document.documentElement.classList.contains('in-app'),
    menu: vis(document.querySelector('.support-link')),
    lobby: vis(document.getElementById('btnSupportLobby')),
    profile: probe('<a id="btnSupportOpen" class="btn" href="/tamogatas">TÁMOGATÁS</a>'),
    gameOver: probe('<p class="go-support">Támogasd</p>')
  };
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  const errors = [];
  const newPage = async (context) => { const p = await context.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return p; };
  const toMenu = async (page) => {
    await page.waitForSelector('#authGuest'); await page.click('#authGuest');
    await page.waitForFunction(() => document.body.dataset.screen === 'name');
    await page.evaluate(() => document.getElementById('btnNewSuspect').click()); await page.fill('#guestName', 'Appos Andi');
    await page.evaluate(() => document.getElementById('btnGuestGo').click());
    await page.waitForFunction(() => document.body.dataset.screen === 'menu');
  };
  const toLobby = async (page) => { await page.evaluate(() => document.getElementById('btnCreate').click()); await page.waitForFunction(() => document.body.dataset.screen === 'lobby'); await pause(300); };
  try {
    const ctxOpts = { viewport: { width: 800, height: 360 }, isMobile: true, hasTouch: true, locale: 'hu-HU' };
    // ---------- web ----------
    {
      const context = await browser.newContext(ctxOpts);
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
      const page = await newPage(context);
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await toMenu(page);
      const m = await page.evaluate(supportVisibility);
      await toLobby(page);
      const l = await page.evaluate(supportVisibility);
      await check('web: a támogatási linkek látszanak (menü, lobbi, profil, játék vége)', async () => {
        assert.equal(m.inApp, false); assert.equal(m.menu, true, 'menü'); assert.equal(l.lobby, true, 'lobbi'); assert.equal(l.profile, true, 'profil'); assert.equal(l.gameOver, true, 'játék vége');
      });
      await page.goto(BASE + '/tamogatas');
      await check('web: a /tamogatas oldalon ott a Ko-fi gomb, az alkalmazás-üzenet rejtve', async () => {
        assert.equal(await page.isVisible('#fo-gomb'), true);
        assert.equal(await page.isVisible('.sp-inapp'), false);
      });
      await context.close();
    }
    // ---------- alkalmazás: a Chrome android-app:// hivatkozóval nyitja meg ----------
    for (const [how, url, ref] of [['android-app:// hivatkozó', BASE + '/', 'android-app://com.kamubirosag.app/'], ['?app=android kapcsoló', BASE + '/?app=android', undefined]]) {
      const context = await browser.newContext(ctxOpts);
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
      const page = await newPage(context);
      await page.goto(url, { waitUntil: 'domcontentloaded', referer: ref });
      const first = await page.evaluate(() => ({ ref: document.referrer, inApp: document.documentElement.classList.contains('in-app') }));
      if (how.startsWith('android') && !first.inApp) {
        // a fejetlen böngésző nem minden esetben adja tovább a nem-http hivatkozót: ilyenkor a felismerést magában a szkriptben ellenőrizzük
        await check('alkalmazás (' + how + '): a felismerő szabály elfogadja a hivatkozót', async () => {
          const ok = await page.evaluate(() => /^android-app:\/\/com\.kamubirosag\.app/.test('android-app://com.kamubirosag.app/') && !/^android-app:\/\/com\.kamubirosag\.app/.test('android-app://com.masik.app/'));
          assert.equal(ok, true);
          console.log('  (megjegyzés: a böngésző ezt a hivatkozót adta tovább: "' + first.ref + '" – a teljes út a ?app=android kapcsolóval fut le)');
        });
        await context.close();
        continue;
      }
      await toMenu(page);
      const m = await page.evaluate(supportVisibility);
      await toLobby(page);
      const l = await page.evaluate(supportVisibility);
      await check('alkalmazás (' + how + '): a támogatási linkek rejtve (menü, lobbi, profil, játék vége)', async () => {
        assert.equal(m.inApp, true, 'html.in-app');
        assert.equal(m.menu, false, 'menü'); assert.equal(l.lobby, false, 'lobbi'); assert.equal(l.profile, false, 'profil'); assert.equal(l.gameOver, false, 'játék vége');
      });
      // a játék vége képernyő a valódi motor állapotából: a "Támogasd" sor nem látszik
      await page.evaluate(() => { const b = document.getElementById('btnLeaveLobby'); if (b) b.click(); const ok = document.getElementById('cfOk'); if (ok) ok.click(); });
      await pause(300);
      const data = fixture('game_over');
      await page.evaluate(({ state, myId }) => { IDENTITY_READY = true; KICKED_FROM_ROOM = true; MY.playerId = myId; MY.code = 'QA42'; S = state; show('game'); renderGame(); }, data);
      await pause(600);
      await check('alkalmazás (' + how + '): a játék vége képernyőn nincs támogatási sor', async () => {
        assert.ok(await page.$('.go-support'), 'a sor a DOM-ban ott van');
        assert.equal(await page.isVisible('.go-support'), false, 'de nem látszik');
      });
      await page.goto(BASE + '/tamogatas');
      await check('alkalmazás (' + how + '): a /tamogatas oldal csak semleges üzenetet mutat (Ko-fi gomb nélkül)', async () => {
        assert.equal(await page.isVisible('#fo-gomb'), false, 'nincs Ko-fi gomb');
        assert.equal(await page.isVisible('.sp-inapp'), true, 'az üzenet látszik');
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('a[href*="ko-fi"]')].some((a) => a.getClientRects().length > 0)), false, 'nincs látható Ko-fi link');
      });
      await page.goto(BASE + '/');
      await check('alkalmazás (' + how + '): újratöltés után is alkalmazás-mód (munkamenet)', async () => {
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('in-app')), true);
      });
      const other = await newPage(await browser.newContext(ctxOpts));
      await other.goto(BASE + '/');
      await check('alkalmazás (' + how + '): egy új böngészőlapon (a telefon Chrome-ja) nincs alkalmazás-mód', async () => {
        assert.equal(await other.evaluate(() => document.documentElement.classList.contains('in-app')), false);
      });
      await other.context().close();
      await context.close();
    }
    await check('nincs JS-hiba', async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nAlkalmazás-mód: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
