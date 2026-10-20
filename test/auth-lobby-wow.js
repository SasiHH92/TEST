'use strict';
// ============================================================
// KAMU BÍRÓSÁG – az új belépőoldal (auth-wow.css, auth-fx.js) és lobbi (lobby-wow.css, lobby-fx.js)
//  A) belépő: fülek (egyszerre egy kártya, billentyűzettel is), a háttér beégetett címe levágva, a HTML-cím látszik, ÉLŐ sáv,
//     telefonon a JÁTÉK VENDÉGKÉNT az első képernyőn; több méreten: nincs kilógás / átfedés / takarás; csökkentett mozgásnál nincs belépő animáció
//  B) lobbi: ülés-számláló (1 fő: "még 2 kell"; 3 fő: "indulhat"); gépen a TÁRGYALÁS MEGKEZDÉSE görgetés nélkül látszik és görgetéskor is ott marad;
//     a felső sáv második sorában a KÉSZEN ÁLLOK; a nem házigazda a várakozó kártyát látja; több méreten: nincs kilógás / takarás; nincs JS-hiba
// Futtatás: node test/auth-lobby-wow.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }
const PORT = Number(process.env.ALW_PORT || 3288), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-alw-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// általános elrendezés-mérés egy képernyő-gyökérben: kilógás, vízszintes görgetés, egymásra futó szövegek (a díszítő aria-hidden rétegek nélkül),
// és a megadott fontos elemek közepét nem takarja más (pl. rögzített gomb)
function audit({ rootSel, keys }) {
  const out = [], root = document.querySelector(rootSel), vw = document.documentElement.clientWidth;
  const skip = (el) => el.closest('[aria-hidden="true"], .ticker, .hidden, svg, .p-badges, .kb-badges') || getComputedStyle(el).visibility === 'hidden';
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); if (!r.width || skip(el) || getComputedStyle(el).position === 'fixed') continue;
    if (r.right > vw + 1 || r.left < -1) out.push('kilóg: ' + (el.id || String(el.className).slice(0, 40)));
  }
  if (document.documentElement.scrollWidth > vw + 1) out.push('vízszintes görgetés');
  // elforgatott díszelem (pecsét, ferde szalag): a befoglaló téglalapja nagyobb a szövegénél – kimarad (mint a text-fit tesztben)
  const rotated = (el) => { for (let a = el; a && a !== root; a = a.parentElement) { const t = getComputedStyle(a).transform; if (t && t !== 'none') { const m = t.match(/matrix(([^)]+))/); if (m) { const v = m[1].split(',').map(Number); if (Math.abs(v[1]) > 0.001 || Math.abs(v[2]) > 0.001) return true; } } } return false; };
  const texts = [...root.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getBoundingClientRect().width && !skip(el) && !el.closest('.poster') && !rotated(el));
  const lines = (el) => [...el.getClientRects()].filter((q) => q.width > 1 && q.height > 1); // (soronként: a több sorba törő link nem egy nagy téglalap)
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const x = texts[i], y = texts[j]; if (x.contains(y) || y.contains(x)) continue;
    const hit = lines(x).some((a) => lines(y).some((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2));
    if (hit) out.push('átfed: „' + x.textContent.trim().slice(0, 22) + '” × „' + y.textContent.trim().slice(0, 22) + '”');
  }
  for (const sel of keys) {
    const el = document.querySelector(sel); if (!el || !el.getBoundingClientRect().width || el.closest('.hidden')) continue;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    for (const [px, py] of [[0.5, 0.5], [0.12, 0.5], [0.88, 0.5]]) {
      const t = document.elementFromPoint(r.left + r.width * px, r.top + r.height * py);
      if (t && !el.contains(t) && !t.contains(el)) { out.push('takart: ' + sel + ' ← ' + (t.id || String(t.className).slice(0, 40) || t.tagName)); break; }
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
    MAX_ROOMS_PER_IP: '40', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  const errors = [];
  const ctxFor = async (w, h, opts) => {
    const mobile = !!(opts && opts.mobile);
    const context = await browser.newContext({ viewport: { width: w, height: h }, locale: 'hu-HU', isMobile: mobile, hasTouch: mobile, ...(mobile ? { userAgent: UA_PHONE } : {}), ...((opts && opts.ctx) || {}) });
    await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(w + 'x' + h + ': ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#authGuest');
    return { context, page };
  };
  const toLobby = async (page, name) => {
    await page.click('#authGuest'); await page.waitForFunction(() => document.body.dataset.screen === 'name');
    await page.evaluate(() => document.getElementById('btnNewSuspect').click()); await page.fill('#guestName', name);
    await page.evaluate(() => document.getElementById('btnGuestGo').click()); await page.waitForFunction(() => document.body.dataset.screen === 'menu');
    await page.evaluate(() => document.getElementById('btnCreate').click()); await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
  };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { /* */ } await pause(150); }

    // ---------- A) belépő ----------
    const d = await ctxFor(1366, 768);
    await pause(2600);
    await check('A) fülek: alapból a bejelentkezés; a REGISZTRÁCIÓ fül a másik kártyát mutatja; nyíllal vissza', async () => {
      const vis = () => d.page.evaluate(() => ({ login: !!document.getElementById('authLoginCard').getBoundingClientRect().height, reg: !!document.getElementById('authRegisterCard').getBoundingClientRect().height,
        sel: document.getElementById('authRegisterTab').getAttribute('aria-selected'), role: document.getElementById('authRegisterCard').getAttribute('role') }));
      assert.deepEqual(await vis(), { login: true, reg: false, sel: 'false', role: 'tabpanel' });
      await d.page.click('#authRegisterTab');
      assert.deepEqual(await vis(), { login: false, reg: true, sel: 'true', role: 'tabpanel' });
      await d.page.focus('#authRegisterTab'); await d.page.keyboard.press('ArrowLeft');
      assert.deepEqual(await vis(), { login: true, reg: false, sel: 'false', role: 'tabpanel' });
    });
    await check('A) a háttér beégetett címe a képernyőn kívül, a kép kitölti a képernyőt; a HTML-cím látszik', async () => {
      const r = await d.page.evaluate(() => { const bg = document.querySelector('.auth-video.ready') || document.querySelector('.auth-background'); const b = bg.getBoundingClientRect(), lg = document.querySelector('.auth-logo');
        return { top: b.top, left: b.left, right: b.right, bottom: b.bottom, h: b.height, vw: innerWidth, vh: innerHeight, logo: getComputedStyle(lg).visibility, logoH: lg.getBoundingClientRect().height }; });
      assert.ok(r.top < -0.25 * r.h, 'a kép felső ~30%-a kívül: ' + JSON.stringify(r));
      assert.ok(r.left <= 0 && r.right >= r.vw && r.bottom >= r.vh - 1, 'kitölti: ' + JSON.stringify(r));
      assert.equal(r.logo, 'visible'); assert.ok(r.logoH > 30);
    });
    await check('A) ÉLŐ sáv a /api/live alapján', async () => {
      await d.page.waitForFunction(() => /terem nyitva|tárgyalás|szoba|gyanúsított/.test(document.querySelector('.aw-live-txt').textContent), null, { timeout: 5000 });
    });
    await check('A) gépen (1366×768): nincs kilógás / átfedés, a gombokat nem takarja semmi', async () => {
      await d.page.mouse.move(2, 2);
      assert.deepEqual(await d.page.evaluate(audit, { rootSel: '#screen-auth', keys: ['#authGuest', '#authLoginTab', '#authRegisterTab', '#authLoginSubmit'] }), []);
    });
    await d.context.close();
    for (const [w, h, mobile] of [[1920, 937, false], [1024, 768, false], [390, 844, true], [360, 640, true], [844, 390, true], [640, 360, true]]) {
      const v = await ctxFor(w, h, { mobile });
      await pause(2600);
      await check('A) ' + w + '×' + h + ': nincs kilógás / átfedés / takarás' + (w < 700 && h > 600 ? '; a JÁTÉK VENDÉGKÉNT az első képernyőn' : ''), async () => {
        assert.deepEqual(await v.page.evaluate(audit, { rootSel: '#screen-auth', keys: ['#authGuest', '#authLoginTab', '#authRegisterTab', '#authLoginSubmit'] }), []);
        if (w < 700 && h > 600) { const b = await v.page.evaluate(() => document.getElementById('authGuest').getBoundingClientRect().bottom); assert.ok(b <= h, 'a vendég-belépés alja: ' + b + ' <= ' + h); }
      });
      await v.context.close();
    }
    const rm = await ctxFor(1366, 768, { ctx: { reducedMotion: 'reduce' } });
    await check('A) csökkentett mozgásnál nincs belépő animáció', async () => { assert.equal((await rm.page.evaluate(() => window.kbAuthFx.state())).entering, false); });
    await rm.context.close();

    // ---------- B) lobbi ----------
    const host = await ctxFor(1366, 768);
    await toLobby(host.page, 'Lobbi Lajos');
    await check('B) ülés-számláló: egyedül "1 / 12 · még 2 kell"', async () => {
      await host.page.waitForFunction(() => /1 \/ \d+/.test(document.getElementById('lwSeats').textContent), null, { timeout: 5000 });
      assert.match(await host.page.textContent('#lwSeats'), /1 \/ 12 GYANÚSÍTOTT · még 2 kell/);
      assert.equal(await host.page.evaluate(() => document.querySelectorAll('#lwSeats .lw-seat-pips i.on').length), 1);
    });
    await check('B) gépen a TÁRGYALÁS MEGKEZDÉSE görgetés nélkül látszik, és görgetéskor is a képernyőn marad', async () => {
      const top = await host.page.evaluate(() => { window.scrollTo(0, 0); const r = document.getElementById('btnStartGame').getBoundingClientRect(); return { b: r.bottom, h: r.height, vh: innerHeight }; });
      assert.ok(top.h > 40 && top.b <= top.vh, 'görgetés nélkül: ' + JSON.stringify(top));
      for (let i = 0; i < 2; i++) { await host.page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(300); }
      await host.page.evaluate(() => window.scrollTo(0, 700)); await pause(300);
      const after = await host.page.evaluate(() => { const r = document.getElementById('btnStartGame').getBoundingClientRect(); return { t: r.top, b: r.bottom, vh: innerHeight, sy: scrollY }; });
      assert.ok(after.sy > 100, 'görgethető az oldal: ' + after.sy);
      assert.ok(after.t >= 0 && after.b <= after.vh, 'görgetés után is látszik: ' + JSON.stringify(after));
      await host.page.evaluate(() => window.scrollTo(0, 0));
    });
    await check('B) 3 fővel: "3 / 12 · indulhat a tárgyalás!", a gomb kiemelve', async () => {
      await host.page.waitForFunction(() => /3 \/ 12/.test(document.getElementById('lwSeats').textContent), null, { timeout: 5000 });
      assert.match(await host.page.textContent('#lwSeats'), /indulhat a tárgyalás/);
      assert.equal(await host.page.evaluate(() => document.getElementById('screen-lobby').classList.contains('lw-can-start')), true);
    });
    await check('B) a felső sávban a KÉSZEN ÁLLOK a második sorban (a pecsét alatt)', async () => {
      const r = await host.page.evaluate(() => ({ box: document.querySelector('.casefile-box').getBoundingClientRect().bottom, ready: document.getElementById('btnReady').getBoundingClientRect().top }));
      assert.ok(r.ready >= r.box - 2, JSON.stringify(r));
    });
    await check('B) gépen (1366×768): nincs kilógás / átfedés / takarás a lobbiban', async () => {
      assert.deepEqual(await host.page.evaluate(audit, { rootSel: '#screen-lobby', keys: ['#lobbyCode', '#btnCopyLink', '#btnReady', '#btnStartGame', '#btnQuickGame', '#btnCustomGame', '#btnLeaveLobby'] }), []);
    });
    const code = await host.page.textContent('#lobbyCode');
    const guest = await ctxFor(1366, 768);
    await guest.page.click('#authGuest'); await guest.page.waitForFunction(() => document.body.dataset.screen === 'name');
    await guest.page.evaluate(() => document.getElementById('btnNewSuspect').click()); await guest.page.fill('#guestName', 'Vendég Vera');
    await guest.page.evaluate(() => document.getElementById('btnGuestGo').click()); await guest.page.waitForFunction(() => document.body.dataset.screen === 'menu');
    await guest.page.fill('#codeInput', code.trim()); await guest.page.evaluate(() => document.getElementById('btnJoin').click());
    await guest.page.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 8000 });
    await check('B) a nem házigazda a várakozó kártyát látja (nincs indítás gomb), a számláló 4 főt mutat', async () => {
      await guest.page.waitForFunction(() => /4 \/ 12/.test(document.getElementById('lwSeats').textContent), null, { timeout: 5000 });
      const r = await guest.page.evaluate(() => ({ note: !document.getElementById('nonHostNote').classList.contains('hidden') && document.getElementById('nonHostNote').getBoundingClientRect().height > 40, start: !document.getElementById('btnStartGame').closest('.hidden') && !document.getElementById('btnStartGame').classList.contains('hidden') }));
      assert.deepEqual(r, { note: true, start: false });
    });
    await guest.context.close();
    await host.context.close();
    for (const [w, h, mobile] of [[1920, 1080, false], [1024, 768, false], [390, 844, true], [844, 390, true]]) {
      const v = await ctxFor(w, h, { mobile });
      await toLobby(v.page, 'Méret ' + w);
      for (let i = 0; i < 3; i++) { await v.page.evaluate(() => { const b = document.getElementById('btnAddBot'); if (b) b.click(); }); await pause(250); }
      await pause(2200);
      await check('B) lobbi ' + w + '×' + h + ': nincs kilógás / átfedés / takarás', async () => {
        assert.deepEqual(await v.page.evaluate(audit, { rootSel: '#screen-lobby', keys: ['#lobbyCode', '#btnCopyLink', '#btnReady', '#btnStartGame', '#btnLeaveLobby'] }), []);
      });
      await v.context.close();
    }
    await check('nincs JS-hiba', async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nBelépő + lobbi: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
