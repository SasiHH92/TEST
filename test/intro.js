'use strict';
// ============================================================
// KAMU BÍRÓSÁG – egyszeri bevezető (intro), Playwright
//   - új látogatónak (nincs kb_introSeen / kb_helpSeen) megjelenik, 5 dia; szobalinkkel (?room=) és az útmutatót már látóknak NEM; ?intro=1 kényszeríti
//   - lapozás: TOVÁBB / pontok / nyilak / húzás; az utolsó dián KEZDJÜK! és nincs KIHAGYOM
//   - egyszer jön: végigvitel → kb_introSeen + kb_helpSeen; kihagyás → csak kb_introSeen; újratöltés után nincs intro; a súgóból újrajátszható
//   - méretek: 800×360, 915×412 (fekvő telefon), 390×844 (álló), 1366×768: a szöveg, a figura, a gombok a képernyőn belül, nincs vízszintes görgetés
//   - a belépőoldal a bevezető után használható; nincs JS-hiba
// Futtatás: node test/intro.js     (böngésző: CHROMIUM_PATH / Edge / Chrome; ha nincs: SKIP, INTRO_REQUIRE=1 esetén hiba;  INTRO_SHOTS=<mappa>)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.INTRO_PORT || 3260), BASE = 'http://127.0.0.1:' + PORT;
const REQUIRE = process.env.INTRO_REQUIRE === '1';
const SHOTS = process.env.INTRO_SHOTS ? path.resolve(process.env.INTRO_SHOTS) : '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-intro-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
let passed = 0, failed = 0;
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky/i;

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
  return null;
}
async function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '', MAX_ROOMS_PER_IP: '30',
    AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'), KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json'), KB_CARDFB_FILE: path.join(tmp, 'cf.json'),
    KB_PACKS_FILE: path.join(tmp, 'p.json'), KB_COURTS_FILE: path.join(tmp, 'c.json'), KB_MODERATION_FILE: path.join(tmp, 'm.json'), KB_BUGREPORTS_FILE: path.join(tmp, 'b.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(REQUIRE ? 1 : 0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(REQUIRE ? 1 : 0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  const errors = [];
  const fresh = async (vp, opts = {}) => {
    const mobile = vp.width < 1000;
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? UA : undefined, locale: 'hu-HU' });
    // a bevezető automatizált böngészőben (navigator.webdriver) magától nem jelenik meg: itt valódi látogatónak tettetjük magunkat (a ?intro=1 és a webdriver-teszt külön van)
    if (!opts.keepWebdriver) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    if (opts.init) await ctx.addInitScript(opts.init);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto(BASE + (opts.url || '/'), { waitUntil: 'domcontentloaded' });
    return { ctx, page };
  };
  const state = (page) => page.evaluate(() => {
    const o = document.getElementById('introOverlay'), cs = o ? getComputedStyle(o) : null;
    const slides = [...document.querySelectorAll('.intro-slide')];
    const ls = (k) => { try { return localStorage.getItem(k); } catch (_) { return 'ERR'; } };
    return { pending: document.documentElement.classList.contains('intro-pending'), shown: !!o && cs.display !== 'none', active: slides.findIndex((s) => s.classList.contains('active')), slides: slides.length, next: (document.getElementById('introNext') || {}).textContent,
      skipHidden: document.getElementById('introSkip').hidden, dots: document.querySelectorAll('.intro-dot').length, dotOn: [...document.querySelectorAll('.intro-dot')].findIndex((d) => d.classList.contains('on')), seen: ls('kb_introSeen'), help: ls('kb_helpSeen') };
  });
  const geo = (page) => page.evaluate(() => {
    const R = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const fig = document.querySelector('.intro-slide.active .intro-figure');
    return { vw: innerWidth, vh: innerHeight, text: R('.intro-slide.active .intro-text'), title: R('.intro-slide.active .intro-title'), fig: R('.intro-slide.active .intro-figure'), figOk: !!fig && fig.naturalWidth > 0, next: R('#introNext'), skip: R('#introSkip'), foot: R('.intro-foot'), overX: document.documentElement.scrollWidth - innerWidth };
  });
  const inside = (b, vw, vh, tol = 2) => b && b.l >= -tol && b.r <= vw + tol && b.t >= -tol && b.b <= vh + tol;

  try {
    await check('új látogatónak megjelenik: 5 dia, az első a cím; pontok, KIHAGYOM, TOVÁBB; a háttér-oldal nem kattintható alatta', async () => {
      const { ctx, page } = await fresh({ width: 915, height: 412 });
      await pause(700);
      const s = await state(page);
      assert.equal(s.pending, true); assert.equal(s.shown, true); assert.equal(s.slides, 5); assert.equal(s.active, 0); assert.equal(s.dots, 5); assert.equal(s.dotOn, 0);
      assert.match(s.next, /TOVÁBB/); assert.equal(s.skipHidden, false);
      assert.match(await page.textContent('.intro-slide.active .intro-title'), /KAMU BÍRÓSÁG/);
      assert.equal(await page.evaluate(() => { const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !!(top && top.closest('#introOverlay')); }), true, 'a képernyő közepén a bevezető van felül (a belépőoldal nem kattintható alatta)');
      await ctx.close();
    });

    for (const vp of [{ width: 800, height: 360 }, { width: 915, height: 412 }, { width: 390, height: 844 }, { width: 1366, height: 768 }]) {
      const tag = vp.width + '×' + vp.height;
      await check('méretek (' + tag + '): mind az 5 dián a szöveg, a figura és a gombok a képernyőn belül, nincs vízszintes görgetés, a kép betöltődik', async () => {
        const { ctx, page } = await fresh(vp);
        await pause(700);
        for (let k = 0; k < 5; k++) {
          await pause(650);
          const g = await geo(page);
          assert.ok(inside(g.text, g.vw, g.vh), k + '. dia: a szöveg a képernyőn belül (' + JSON.stringify(g.text) + ')');
          assert.ok(inside(g.title, g.vw, g.vh), k + '. dia: a cím a képernyőn belül');
          assert.ok(inside(g.fig, g.vw, g.vh), k + '. dia: a figura a képernyőn belül (' + JSON.stringify(g.fig) + ')');
          assert.ok(g.figOk, k + '. dia: a kép betöltődött');
          assert.ok(inside(g.next, g.vw, g.vh), 'a gomb a képernyőn belül');
          if (k < 4) assert.ok(inside(g.skip, g.vw, g.vh), 'a KIHAGYOM a képernyőn belül');
          assert.ok(g.text.b <= g.foot.t + 2, k + '. dia: a szöveg nem csúszik a gombsor alá (' + Math.round(g.text.b) + ' / ' + Math.round(g.foot.t) + ')');
          assert.ok(g.overX <= 1, 'nincs vízszintes görgetés (' + g.overX + ')');
          if (SHOTS && (k === 0 || k === 2)) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'intro-' + tag + '-' + k + '.png') }); }
          if (k < 4) await page.click('#introNext');
        }
        await ctx.close();
      });
    }

    await check('lapozás: TOVÁBB, pontok, nyilak; az utolsó dián KEZDJÜK! és nincs KIHAGYOM; húzással (érintés) is lapoz', async () => {
      const { ctx, page } = await fresh({ width: 844, height: 390 });
      await pause(600);
      await page.click('#introNext'); assert.equal((await state(page)).active, 1);
      await page.keyboard.press('ArrowRight'); assert.equal((await state(page)).active, 2);
      await page.keyboard.press('ArrowLeft'); assert.equal((await state(page)).active, 1);
      await page.click('.intro-dot:nth-child(4)'); let s = await state(page); assert.equal(s.active, 3); assert.equal(s.dotOn, 3);
      await page.evaluate(() => { const o = document.getElementById('introOverlay'); const mk = (type, x) => o.dispatchEvent(new TouchEvent(type, { bubbles: true, changedTouches: [new Touch({ identifier: 1, target: o, clientX: x, clientY: 200 })] })); mk('touchstart', 600); mk('touchend', 300); });
      s = await state(page); assert.equal(s.active, 4, 'balra húzás: következő dia');
      assert.match(s.next, /KEZDJÜK/); assert.equal(s.skipHidden, true);
      await page.evaluate(() => { const o = document.getElementById('introOverlay'); const mk = (type, x) => o.dispatchEvent(new TouchEvent(type, { bubbles: true, changedTouches: [new Touch({ identifier: 1, target: o, clientX: x, clientY: 200 })] })); mk('touchstart', 200); mk('touchend', 520); });
      assert.equal((await state(page)).active, 3, 'jobbra húzás: előző dia');
      await ctx.close();
    });

    await check('végigvitel: a KEZDJÜK! után eltűnik, kb_introSeen + kb_helpSeen; a belépőoldal használható; újratöltés után nincs intro', async () => {
      const { ctx, page } = await fresh({ width: 915, height: 412 });
      await pause(600);
      for (let k = 0; k < 4; k++) await page.click('#introNext');
      assert.match((await state(page)).next, /KEZDJÜK/);
      await page.click('#introNext');
      await page.waitForFunction(() => !document.documentElement.classList.contains('intro-pending'), null, { timeout: 4000 });
      const s = await state(page);
      assert.equal(s.shown, false); assert.equal(s.seen, '1'); assert.equal(s.help, '1', 'a végigvitt intro után az útmutató sem nyílik meg magától');
      await page.click('#authGuest'); await page.waitForFunction(() => document.body.dataset.screen === 'name', null, { timeout: 8000 });
      await page.reload({ waitUntil: 'domcontentloaded' }); await pause(500);
      assert.equal((await state(page)).pending, false, 'újratöltés után nincs intro');
      await ctx.close();
    });

    await check('kihagyás: csak kb_introSeen (az útmutató még megnyílhat); Esc is kihagyja; újratöltés után nincs intro', async () => {
      const a = await fresh({ width: 915, height: 412 });
      await pause(500); await a.page.click('#introSkip');
      await a.page.waitForFunction(() => !document.documentElement.classList.contains('intro-pending'), null, { timeout: 4000 });
      let s = await state(a.page); assert.equal(s.seen, '1'); assert.equal(s.help, null, 'kihagyásnál az útmutató nincs elintézettnek jelölve');
      await a.page.reload({ waitUntil: 'domcontentloaded' }); await pause(400); assert.equal((await state(a.page)).pending, false);
      await a.ctx.close();
      const b = await fresh({ width: 915, height: 412 });
      await pause(500); await b.page.keyboard.press('Escape');
      await b.page.waitForFunction(() => !document.documentElement.classList.contains('intro-pending'), null, { timeout: 4000 });
      s = await state(b.page); assert.equal(s.seen, '1'); assert.equal(s.help, null);
      await b.ctx.close();
    });

    await check('nem jelenik meg: szobalinkkel (?room=) és tárgyalás-linkkel (?court=) érkezőnek, és annak, aki az útmutatót már látta (kb_helpSeen); ?intro=1 kényszeríti', async () => {
      const r = await fresh({ width: 915, height: 412 }, { url: '/?room=ABCD' }); await pause(500);
      let s = await state(r.page); assert.equal(s.pending, false); assert.equal(s.seen, null); await r.ctx.close();
      const c = await fresh({ width: 915, height: 412 }, { url: '/?court=KAMU-1234' }); await pause(500);
      s = await state(c.page); assert.equal(s.pending, false); await c.ctx.close();
      const h = await fresh({ width: 915, height: 412 }, { init: () => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* */ } } }); await pause(500);
      s = await state(h.page); assert.equal(s.pending, false, 'a meglévő tesztek / visszatérő játékosok (kb_helpSeen) nem kapnak introt'); await h.ctx.close();
      const f = await fresh({ width: 915, height: 412 }, { url: '/?intro=1', init: () => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } } }); await pause(600);
      s = await state(f.page); assert.equal(s.pending, true); assert.equal(s.active, 0); await f.ctx.close();
    });

    await check('újrajátszás: a súgó ablak ▶ BEVEZETŐ gombja újra megnyitja a bevezetőt; a ?room= linknél is használható', async () => {
      const { ctx, page } = await fresh({ width: 915, height: 412 }, { url: '/?room=ABCD' });
      await pause(500);
      await page.evaluate(() => document.querySelector('[data-help]').click());
      await page.waitForFunction(() => { const m = document.getElementById('helpModal'); return m && !m.classList.contains('hidden'); });
      await page.click('#helpIntro');
      await page.waitForFunction(() => document.documentElement.classList.contains('intro-pending'), null, { timeout: 3000 });
      const s = await state(page); assert.equal(s.shown, true); assert.equal(s.active, 0);
      assert.equal(await page.evaluate(() => document.getElementById('helpModal').classList.contains('hidden')), true, 'a súgó bezárult');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('intro-pending'), null, { timeout: 4000 });
      await ctx.close();
    });

    await check('automatizált böngészőben (navigator.webdriver) magától nem jelenik meg, a ?intro=1 viszont kényszeríti (így a meglévő tesztek nem akadnak el)', async () => {
      const a = await fresh({ width: 915, height: 412 }, { keepWebdriver: true }); await pause(500);
      assert.equal(await a.page.evaluate(() => navigator.webdriver), true);
      assert.equal((await state(a.page)).pending, false); await a.ctx.close();
      const b = await fresh({ width: 915, height: 412 }, { keepWebdriver: true, url: '/?intro=1' }); await pause(500);
      assert.equal((await state(b.page)).pending, true); await b.ctx.close();
    });

    await check('nincs oldalhiba / konzolhiba', async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.kill(); }
  console.log('\nBevezető (intro): ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  setTimeout(() => process.exit(failed ? 1 : 0), 400);
})();
