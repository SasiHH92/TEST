'use strict';
// ============================================================
// KAMU BÍRÓSÁG – betöltés-ellenőrzés (public/boot-check.js)
//  Ha a fő szkript (vagy a socket.io) nem töltődik be, az oldal egyszer magától újrapróbálja, utána érthető üzenetet + újratöltés gombot mutat,
//  és jelenti az üzemeltetőnek; a gombbal (a hálózat helyreálltával) a játék rendben betölt. Normál betöltésnél nincs semmi változás.
// Futtatás: node test/boot-check.js
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-boot-'));
const f = (n) => path.join(tmp, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}

(async () => {
  const PORT = 3224, BASE = 'http://127.0.0.1:' + PORT;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DISCORD_BOT_TOKEN: '', RESEND_API_KEY: '', EMAIL_FROM: '', AUTH_MAIL_API_KEY: '', AUTH_MAIL_FROM: '',
      AUTH_STORE_PATH: f('acc.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('st.json'), KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'),
      KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') }
  });
  let browser;
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { await pause(100); } }
    const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
    browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'msedge' });
    const newPage = async () => { const ctx = await browser.newContext({ viewport: { width: 412, height: 800 } }); return ctx.newPage(); };

    await test('normál betöltés: nincs üzenet, a jelző nincs beállítva, a játék működik', async () => {
      const page = await newPage();
      await page.goto(BASE + '/');
      await page.waitForFunction(() => document.body.dataset.screen === 'auth', null, { timeout: 15000 });
      await pause(1800);
      assert.equal(await page.isVisible('#bootFail'), false);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('kb_bootRetry')), null);
    });

    await test('a fő szkript nem töltődik be: egyszer automatikusan újrapróbál, utána üzenet + gomb, jelentés az üzemeltetőnek', async () => {
      const page = await newPage();
      let clientRequests = 0; const reports = [];
      await page.route('**/client.js', (route) => { clientRequests++; route.abort('failed'); });
      await page.route('**/api/client-error', (route) => { reports.push(route.request().postData()); route.fulfill({ status: 204 }); });
      await page.goto(BASE + '/');
      await page.waitForSelector('#bootFail', { timeout: 15000 });
      assert.ok(clientRequests >= 2, 'az automatikus újrapróba megtörtént: ' + clientRequests);
      assert.match(await page.textContent('#bootFail'), /Nem sikerült betölteni a játékot/);
      assert.equal(await page.isVisible('#bootFail button'), true);
      await pause(300);
      assert.ok(reports.some((r) => /boot-check/.test(r) && /client\.js/.test(r)), 'a hiba bekerült a jelentésekbe: ' + JSON.stringify(reports));
      assert.equal(await page.evaluate(() => sessionStorage.getItem('kb_bootRetry')), '1');
      // a hálózat helyreáll: a gombbal a játék rendben betölt
      await page.unroute('**/client.js');
      await page.click('#bootFail button');
      await page.waitForFunction(() => (document.body && document.body.dataset.screen === 'auth') && typeof socket !== 'undefined', null, { timeout: 15000 });
      await pause(1500);
      assert.equal(await page.isVisible('#bootFail'), false, 'az üzenet eltűnt');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('kb_bootRetry')), null, 'a jelző törlődött');
    });

    await test('átmeneti hiba: az első betöltés elbukik, az automatikus újrapróba már sikerül (nincs üzenet)', async () => {
      const page = await newPage();
      let n = 0;
      await page.route('**/client.js', (route) => { n++; if (n === 1) route.abort('failed'); else route.continue(); });
      await page.goto(BASE + '/');
      await page.waitForFunction(() => (document.body && document.body.dataset.screen === 'auth') && typeof socket !== 'undefined', null, { timeout: 15000 });
      await pause(1800);
      assert.ok(n >= 2, 'újrapróbált');
      assert.equal(await page.isVisible('#bootFail'), false);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('kb_bootRetry')), null);
    });

    await test('a socket.io nem töltődik be: ugyanúgy üzenetet kapunk', async () => {
      const page = await newPage();
      await page.route('**/socket.io/socket.io.js', (route) => route.abort('failed'));
      await page.goto(BASE + '/');
      await page.waitForSelector('#bootFail', { timeout: 15000 });
      assert.equal(await page.isVisible('#bootFail button'), true);
    });
  } finally { if (browser) await browser.close(); child.kill(); }
  console.log('\nBetöltés-ellenőrzés: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exit(failed ? 1 : 0);
})();
