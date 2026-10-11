'use strict';
// ============================================================
// KAMU BÍRÓSÁG – a bolt "Szekrényem" füle (böngésző): a legendás egyedi tárgyak a szekrényben vannak (nem a boltban),
// a vásárolt tárgy is ott jelenik meg, felvehető / levehető, az egyedi nem tűnik el. Futtatás: node test/wardrobe-ui.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { legendCode } = require('../legend-claims');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* */ }

const root = path.resolve(__dirname, '..');
const PORT = 3206, BASE = 'http://127.0.0.1:' + PORT, SECRET = 'csak-teszthez-valo-titok-0123456789';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-wardrobe-'));
const f = (n) => path.join(tmp, n);
let passed = 0, failed = 0;
async function test(name, work) { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); } }

(async () => {
  if (!chromium) { console.log('SKIP: playwright-core hiányzik'); process.exit(0); }
  const tries = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let browser = null;
  for (const o of tries) { try { browser = await chromium.launch(o); break; } catch (_) { /* */ } }
  if (!browser) { console.log('SKIP: nincs böngésző (Edge / Chrome)'); process.exit(0); }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, LEGEND_SECRET: SECRET, DISCORD_BOT_TOKEN: '',
      AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('st.json'), KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); } }
  const password = 'Egy hosszú titok 123!';
  const legend = require('../data/players.json').players[0].nev;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    const reg = await page.evaluate(async ([legend, code, pw]) => (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'x', legend, claim: code, email: 'w@example.invalid', password: pw, confirmPassword: pw }) })).status, [legend, legendCode(SECRET, legend), password]);
    assert.equal(reg, 201);
    await page.reload({ waitUntil: 'networkidle' });
    await page.fill('#authLoginEmail', 'w@example.invalid');
    await page.fill('#authLoginPassword', password);
    await page.locator('#authLoginEmail').evaluate((el) => el.closest('form').requestSubmit());
    await page.waitForSelector('#btnShopOpen', { timeout: 10000 });
    await page.click('#btnShopOpen');
    await page.waitForSelector('#shopBody .it-card', { timeout: 10000 });

    await test('BOLT: a legenda egyedi tárgyai nincsenek a boltban', async () => {
      await page.click('#shopTabShop');
      const names = await page.locator('#shopBody .it-name').allInnerTexts();
      assert.ok(names.length > 20, 'a bolt tárgyai megvannak');
      assert.ok(!names.some((n) => /egyedi/.test(n)), 'az egyedi tárgyak nem a boltban vannak');
    });
    await test('SZEKRÉNYEM: fül + számláló, az egyedi keret és kártyahát ott van felvéve, a "Jelenleg rajtad" sáv mutatja', async () => {
      await page.click('#shopTabWardrobe');
      assert.equal(await page.locator('#shopTabWardrobe').getAttribute('aria-selected'), 'true');
      const names = (await page.locator('#shopBody .it-name').allInnerTexts()).map((n) => n.replace(/\s+/g, ' '));
      assert.ok(names.some((n) => /egyedi keret/.test(n) && /felvéve/.test(n)), names.join(' | '));
      assert.ok(names.some((n) => /egyedi kártyahát/.test(n) && /felvéve/.test(n)));
      assert.equal(await page.locator('#shopWardrobeCount').innerText(), '2');
      assert.match(await page.locator('.wd-equipped').innerText(), /egyedi keret/i);
    });
    await test('Vásárolt tárgy megjelenik a szekrényben; felvéve az egyedi nem tűnik el (a szekrényben marad), és visszaváltható', async () => {
      await page.click('#shopTabShop');
      const buy = page.locator('#shopBody [data-buy]:not([disabled])').first();
      await buy.click();
      await page.waitForFunction(() => document.querySelector('#shopWardrobeCount') && document.querySelector('#shopWardrobeCount').textContent === '3', null, { timeout: 8000 });
      await page.click('#shopTabWardrobe');
      const cards = await page.locator('#shopBody .it-card').count();
      assert.equal(cards, 3, 'a szekrényben 3 tárgy: 2 egyedi + 1 vásárolt');
      // a vásárolt (nem legendás) tárgy FELVESZEM gombja
      await page.locator('#shopBody .it-card:not(.r-legends) [data-equip]').first().click();
      await page.waitForTimeout(700);
      const after = (await page.locator('#shopBody .it-name').allInnerTexts()).map((n) => n.replace(/\s+/g, ' '));
      assert.ok(after.some((n) => /egyedi keret/.test(n) && !/felvéve/.test(n)), 'az egyedi keret már nincs felvéve, de megvan: ' + after.join(' | '));
      assert.equal(after.length, 3);
      // vissza az egyedire
      await page.locator('#shopBody .it-card', { hasText: 'egyedi keret' }).locator('[data-equip]').click();
      await page.waitForTimeout(700);
      const back = (await page.locator('#shopBody .it-name').allInnerTexts()).map((n) => n.replace(/\s+/g, ' '));
      assert.ok(back.some((n) => /egyedi keret/.test(n) && /felvéve/.test(n)), back.join(' | '));
    });
    await test('Nincs JavaScript-hiba', async () => { assert.deepEqual(errs, []); });
    await ctx.close();
  } finally {
    await browser.close();
    child.kill('SIGKILL');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nSzekrény (böngésző): ${passed} sikeres, ${failed} hibás.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
