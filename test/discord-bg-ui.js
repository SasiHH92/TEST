'use strict';
// ============================================================
// KAMU BÍRÓSÁG – Discord-háttér a BÖNGÉSZŐBEN (Playwright, valódi szerver ellen)
//  - nincs Discord-kapcsolat: a boltban a tárgy "ÖSSZEKAPCSOLOM" gombbal látszik (nem vásárolható), a gomb a FIÓKOM ablakot nyitja
//  - van Discord-kapcsolat (a szerver bolt-állapotát átírva szimuláljuk – a valódi OAuth-ot a test/discord-bg.js fedi): "felvéve" jelzés,
//    a kártya-előnézet a Discord-hátteret kapja (valódi CSS-háttérkép), az előnézeti ablak "Ingyen jár" feliratot mutat
//  - ajándék-módban a tárgy nem ajándékozható; a háttér a kártyán olvasható marad (kontraszt)
// Futtatás:  node test/discord-bg-ui.js      Böngésző: CHROMIUM_PATH / Edge / Chrome / Playwright Chromium; ha nincs: SKIP (DBG_UI_REQUIRE=1 esetén hiba)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.DBG_UI_PORT || 3195), BASE = 'http://127.0.0.1:' + PORT;
const REQUIRE = process.env.DBG_UI_REQUIRE === '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-dbgui-'));
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
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: process.env.DBG_UI_VERBOSE ? 'inherit' : 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
    AUTH_BASE_URL: BASE, DATABASE_URL: '', AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'),
    KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); if (REQUIRE) failed++; return finish(); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); if (REQUIRE) failed++; return finish(); }
  const server = await startServer();
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'hu-HU' });
    await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
    let linked = false; // a szimulált Discord-kapcsolat
    // a bolt-állapotot átírjuk: összekapcsolt Discord esetén a szerver (shopOf) is így adná: owned + felvett háttér
    await page.route('**/api/shop/state', async (route) => {
      const response = await route.fetch(); const data = await response.json();
      if (linked) { data.owned = [...data.owned, 'bg_discord']; data.equipped = { ...data.equipped, bg: 'bg_discord' }; }
      await route.fulfill({ response, json: data });
    });

    await check('Belépés fiókkal és a bolt megnyitása', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      const reg = await page.evaluate(async () => (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Discord Bela', email: 'dbela@example.invalid', password: 'Egy hosszú titok 123!', confirmPassword: 'Egy hosszú titok 123!' }) })).status);
      assert.equal(reg, 201);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.getElementById('authContinue').classList.contains('hidden'));
      await page.click('#authContinue');
      await page.waitForFunction(() => document.body.dataset.screen === 'name' && window.kbAccount);
      await page.evaluate(() => window.kbShop.open('shop'));
      await page.waitForSelector('#shopBody .it-card');
    });

    const card = (page) => page.locator('#shopBody .it-card', { hasText: 'Discord-háttér' });

    await check('Összekapcsolás nélkül: a tárgy látszik, "ÖSSZEKAPCSOLOM" gombbal, nem vásárolható / ajándékozható, ára nincs', async () => {
      assert.equal(await card(page).count(), 1);
      assert.match(await card(page).textContent(), /Discord-háttér/);
      assert.equal(await card(page).locator('[data-buy]').count(), 0, 'nincs megvesz-gomb');
      assert.equal(await card(page).locator('[data-unlock="discord"]').count(), 1);
      assert.doesNotMatch(await card(page).textContent(), /🍪/, 'nincs ár a kártyán');
      await page.click('#shopBody .sf[data-filter="bg"]');
      assert.ok((await page.locator('#shopBody .it-card').count()) >= 5, 'a Kártyahát szűrőben ott van a többi háttér mellett');
      // az előnézeti ablak
      await card(page).locator('.it-preview').click();
      await page.waitForSelector('#shopPop .pop-box');
      assert.match(await page.textContent('#shopPop .pop-price'), /Ingyen jár/);
      assert.doesNotMatch(await page.textContent('#shopPop .pop-price'), /Ára:/);
      assert.equal(await page.locator('#shopPop [data-buy]').count(), 0);
      await page.click('#shopPop [data-pop-close]');
    });

    await check('Az összekapcsolás gomb bezárja a boltot és megnyitja a FIÓKOM ablakot (ahol a Discord összekapcsolható)', async () => {
      await card(page).locator('[data-unlock="discord"]').click();
      await page.waitForFunction(() => document.getElementById('shopModal').classList.contains('hidden'));
      await page.waitForFunction(() => !document.getElementById('profileModal').classList.contains('hidden'));
      await page.evaluate(() => document.getElementById('profileModal').classList.add('hidden'));
    });

    await check('Összekapcsolt Discord (szimulálva): "felvéve", a kártya-előnézet a Discord-hátteret kapja, "LEVESZEM" gomb', async () => {
      linked = true;
      await page.evaluate(() => window.kbShop.open('shop'));
      await page.waitForSelector('#shopBody .it-card');
      await page.click('#shopBody .sf[data-filter="bg"]');
      assert.match(await card(page).textContent(), /felvéve/);
      assert.equal(await card(page).locator('[data-unequip="bg"]').count(), 1);
      assert.equal(await card(page).locator('[data-unlock]').count(), 0);
      const preview = await page.evaluate(() => {
        const el = document.querySelector('#shopBody .shop-preview');
        const cs = getComputedStyle(el);
        return { cls: el.className, image: cs.backgroundImage, size: cs.backgroundSize };
      });
      assert.match(preview.cls, /cos-bg-discord/, 'a kártya megkapja az osztályt');
      assert.ok(/gradient/.test(preview.image) && (preview.image.match(/gradient/g) || []).length >= 4, 'valódi, többrétegű háttér: ' + preview.image.slice(0, 120));
    });

    await check('A háttéren a kártya szövege olvasható (kontraszt ≥ 4,5 : 1 a háttér legvilágosabb jellemző színéhez képest is)', async () => {
      const contrast = await page.evaluate(() => {
        const el = document.querySelector('#shopBody .shop-preview');
        const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const text = [...el.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim().length > 2 && getComputedStyle(n).visibility !== 'hidden');
        const fg = parse(getComputedStyle(text).color);
        // a háttér legvilágosabb pontja a kártya tetején: az alap felső színe (#2f3896) + a felső ragyogás (0.24) + a fénysáv csúcsa (0.12) – a CSS-sel egyeztetve
        const mix = (under, over, a) => under.map((v, i) => v * (1 - a) + over[i] * a);
        const worst = mix(mix([47, 56, 150], [130, 145, 255], 0.24), [190, 198, 255], 0.12);
        const hi = Math.max(lum(fg), lum(worst)) + 0.05, lo = Math.min(lum(fg), lum(worst)) + 0.05;
        return { ratio: hi / lo, fg, text: text.textContent.trim().slice(0, 30) };
      });
      assert.ok(contrast.ratio >= 4.5, 'kontraszt: ' + JSON.stringify(contrast));
    });

    await check('Ajándék-módban a Discord-háttér nem ajándékozható', async () => {
      await page.evaluate(() => { window.kbShop.close(); window.kbShop.openGift({ id: 'valaki', username: 'Barát Bori' }); });
      await page.waitForSelector('#shopBody .it-card');
      await page.click('#shopBody .sf[data-filter="bg"]');
      const btn = card(page).locator('button[disabled]');
      assert.equal(await btn.count(), 1); assert.match(await btn.textContent(), /NEM AJÁNDÉKOZHATÓ/);
      assert.equal(await card(page).locator('[data-gift]').count(), 0);
    });

    await check('Nincs konzol-hiba (CSP, szkript)', async () => { assert.deepEqual(errors, []); });
    await context.close();
  } finally {
    await browser.close();
    server.kill();
  }
  finish();
})().catch((e) => { failed++; console.error(e.stack); finish(); });

function finish() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nDiscord-háttér (böngésző): ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
}
