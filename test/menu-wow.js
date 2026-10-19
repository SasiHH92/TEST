'use strict';
// ============================================================
// KAMU BÍRÓSÁG – főmenü ("a tárgyalóterem előcsarnoka": public/menu.js, menu.css, /api/live)
//  A) /api/live: csak összesítés (folyó / gyülekező szobák, játékosok, botok nélkül); a menü ÉLŐ sávja ezt mutatja (üres teremnél tréfás szöveg)
//  B) színpad: a saját avatár szerep-képe látszik, és a szerepek váltakoznak; RENDKÍVÜLI hírszalag a játékos nevével
//  C) a kártyák működnek: ÚJ TÁRGYALÁS → lobbi; rossz kód → hibaüzenet; 4 betű → a belépés-gomb kiemelve, Enter = belépés; egérrel 3D-dőlés
//  D) gépen, tableten, álló és fekvő telefonon: nincs kilógás / vízszintes görgetés / egymásra futó szöveg, a rögzített gombok nem takarják a kártyákat
//  E) csökkentett mozgásnál nincs belépő animáció; nincs JS-hiba
// Futtatás: node test/menu-wow.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }
const PORT = Number(process.env.MENU_PORT || 3278), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-menu-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// elrendezés: kilógás, vízszintes görgetés, egymásra futó szöveg, a kártyák közepét nem takarja rögzített elem
function auditMenu() {
  const out = [], root = document.querySelector('#screen-menu'), vw = document.documentElement.clientWidth;
  for (const el of root.querySelectorAll('.mm-wrap *')) {
    const r = el.getBoundingClientRect(); if (!r.width || el.closest('[aria-hidden="true"]')) continue; // (a díszítő réteg – háttér, színpad, hírszalag, legyező – szándékosan lóg ki / fed át)
    if (r.right > vw + 1 || r.left < -1) out.push('kilóg: ' + (el.id || el.className));
  }
  if (document.documentElement.scrollWidth > vw + 1) out.push('vízszintes görgetés');
  const texts = [...root.querySelectorAll('.mm-wrap *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getBoundingClientRect().width && !el.closest('[aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden');
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const x = texts[i], y = texts[j]; if (x.contains(y) || y.contains(x)) continue;
    const a = x.getBoundingClientRect(), b = y.getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push('átfed: „' + x.textContent.trim().slice(0, 22) + '” × „' + y.textContent.trim().slice(0, 22) + '”');
  }
  // a kártyák díszítő figurái nem lóghatnak rá a feliratra
  for (const card of root.querySelectorAll('.mm-card')) {
    const imgs = [...card.querySelectorAll('.mm-art img')].filter((im) => getComputedStyle(im).display !== 'none').map((im) => im.getBoundingClientRect());
    for (const tx of card.querySelectorAll('.mm-txt b, .mm-txt small, .mm-txt i')) {
      const range = document.createRange(); range.selectNodeContents(tx); const tr = range.getBoundingClientRect();
      for (const b of imgs) if (Math.min(tr.right, b.right) - Math.max(tr.left, b.left) > 3 && Math.min(tr.bottom, b.bottom) - Math.max(tr.top, b.top) > 3) { out.push('figura a feliraton: „' + tx.textContent.slice(0, 20) + '”'); break; }
    }
  }
  for (const id of ['btnCreate', 'codeInput', 'btnJoin', 'btnPacks', 'btnHowTo']) {
    const el = document.getElementById(id); el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(), pts = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5]];
    for (const [px, py] of pts) {
      const t = document.elementFromPoint(r.left + r.width * px, r.top + r.height * py);
      if (t && !el.contains(t) && !t.contains(el)) { out.push('takart: #' + id + ' ← ' + (t.id || t.className || t.tagName)); break; }
    }
  }
  window.scrollTo(0, 0);
  return out;
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(0); }
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let browser = null; for (const o of attempts) { try { browser = await chromium.launch({ headless: true, ...o }); break; } catch (_) { /* */ } }
  if (!browser) { console.log('SKIP: nincs böngésző.'); process.exit(0); }
  const f = (x) => path.join(tmp, x);
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  const errors = [];
  const toMenu = async (viewport, opts) => {
    const mobile = viewport.width < 900 && (opts && opts.mobile);
    const context = await browser.newContext({ viewport, locale: 'hu-HU', isMobile: !!mobile, hasTouch: !!mobile, ...(mobile ? { userAgent: UA_PHONE } : {}), ...((opts && opts.ctx) || {}) });
    await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(viewport.width + 'x' + viewport.height + ': ' + e.message));
    await page.goto(BASE + '/'); await page.click('#authGuest'); await page.waitForFunction(() => document.body.dataset.screen === 'name');
    await page.evaluate(() => document.getElementById('btnNewSuspect').click()); await page.fill('#guestName', (opts && opts.name) || 'Menü Mátyás');
    await page.evaluate(() => document.getElementById('btnGuestGo').click()); await page.waitForFunction(() => document.body.dataset.screen === 'menu');
    return { context, page };
  };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { /* */ } await pause(150); }
    const { context, page } = await toMenu({ width: 1366, height: 768 });
    await check('A) /api/live: üres teremnél 0 / 0 / 0, a menü ÉLŐ sávja tréfás szöveget mutat', async () => {
      assert.deepEqual(await (await fetch(BASE + '/api/live')).json(), { playing: 0, lobbies: 0, players: 0 });
      await page.waitForFunction(() => /üres/.test(document.querySelector('.mm-live-txt').textContent), null, { timeout: 5000 });
    });
    await check('B) színpad: a saját avatár szerep-képe látszik, a szerepek váltakoznak; hírszalag a játékos nevével', async () => {
      await page.waitForFunction(() => { const h = document.querySelector('.mm-hero.on'); return h && h.complete && h.naturalWidth > 0; }, null, { timeout: 6000 });
      const first = await page.evaluate(() => ({ role: document.querySelector('.mm-role').textContent, src: document.querySelector('.mm-hero.on').getAttribute('src'), avatar: MY.avatar }));
      assert.equal(first.role, 'BÍRÓ');
      assert.ok(first.src.includes('avatar_' + first.avatar.slice(2) + '_judge'), 'a saját avatár bírói képe: ' + first.src);
      await page.waitForFunction(() => document.querySelector('.mm-role').textContent !== 'BÍRÓ', null, { timeout: 9000 });
      await pause(700); // (az áttűnés vége)
      assert.match(await page.textContent('.mm-news-txt'), /Menü Mátyás/);
      assert.equal(await page.evaluate(() => !!document.querySelector('.mm-hero.on') && getComputedStyle(document.querySelector('.mm-hero.on')).opacity), '1');
    });
    await check('C) egérrel a kártya 3D-ben dől (--rx / --ry), elhagyva visszaáll', async () => {
      const r = await page.locator('#btnPacks').boundingBox();
      await page.mouse.move(r.x + r.width * 0.9, r.y + r.height * 0.2); await pause(150);
      const tilt = await page.evaluate(() => { const c = document.getElementById('btnPacks'); return { cls: c.classList.contains('tilt'), ry: c.style.getPropertyValue('--ry') }; });
      assert.ok(tilt.cls && parseFloat(tilt.ry) > 2, 'dőlés: ' + JSON.stringify(tilt));
      await page.mouse.move(5, 5); await pause(150);
      assert.equal(await page.evaluate(() => document.getElementById('btnPacks').classList.contains('tilt')), false);
    });
    await check('C) rossz kód → hibaüzenet; 4 betű → a gomb kiemelve; Enter = belépés (nem létező szoba: hiba)', async () => {
      await page.fill('#codeInput', 'ab'); await page.click('#btnJoin');
      assert.match(await page.textContent('#menuError'), /4 betűs/);
      await page.fill('#codeInput', 'zz9q');
      assert.equal(await page.inputValue('#codeInput'), 'ZZ9Q');
      assert.equal(await page.evaluate(() => document.getElementById('btnJoin').classList.contains('ready')), true);
      await page.press('#codeInput', 'Enter');
      await page.waitForFunction(() => document.getElementById('menuError').textContent && !/4 betűs/.test(document.getElementById('menuError').textContent), null, { timeout: 6000 });
    });
    await check('D) gépen (1366×768): tiszta elrendezés', async () => { await page.mouse.move(5, 5); assert.deepEqual(await page.evaluate(auditMenu), []); });
    await check('C) ÚJ TÁRGYALÁS → lobbi; ekkor az ÉLŐ számok: 1 gyülekező szoba, 1 játékos', async () => {
      await page.click('#btnCreate'); await page.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 8000 });
      await pause(5200); // (a szerver 5 mp-ig gyorsítótáraz)
      assert.deepEqual(await (await fetch(BASE + '/api/live')).json(), { playing: 0, lobbies: 1, players: 1 });
    });
    await context.close();

    for (const [w, h, mobile] of [[1024, 768, false], [390, 844, true], [360, 640, true], [844, 390, true], [640, 360, true], [932, 430, true]]) {
      const v = await toMenu({ width: w, height: h }, { mobile, name: 'Hosszú Nevű Játékos' });
      await pause(2300);
      await check('D) ' + w + '×' + h + (mobile ? ' (telefon)' : '') + ': tiszta elrendezés, a rögzített gombok nem takarják a kártyákat', async () => { assert.deepEqual(await v.page.evaluate(auditMenu), []); });
      await v.context.close();
    }
    const rm = await toMenu({ width: 1366, height: 768 }, { ctx: { reducedMotion: 'reduce' } });
    await check('E) csökkentett mozgásnál nincs belépő animáció', async () => {
      assert.equal((await rm.page.evaluate(() => window.kbMenu.state())).entering, false);
    });
    await rm.context.close();
    await check('E) nincs JS-hiba', async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nFőmenü: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
