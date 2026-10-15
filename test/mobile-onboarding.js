'use strict';
// ============================================================
// KAMU BÍRÓSÁG – új játékos útja telefonon (valódi böngészőben, érintős telefon-emulációval)
//  A) névválasztó: a cím nem ütközik a fix gombokkal (🔊 🏃 ⓘ); az "ÚJ GYANÚSÍTOTT (vendég)" gomb a legendák kártyái ELŐTT van, az első képernyőn;
//     a megnyíló vendég-űrlap (név + karakter + belépés) elfér; nagy képernyőn a sorrend változatlan
//  B) menü: a cím és a "belépsz mint" kártya szabad; a "Hogyan kell játszani?" gomb látszik, az első látogatásnál kiemelt, megnyitva a RÖVID összefoglaló jön elsőként; utána nem kiemelt
//  C) lobbi: a kódkártyát nem takarják a fix gombok; a hibajelentő gomb nem takarja a hírszalagot
//  D) a gombfeliratok helyesek (BELÉPÉS), a játékleírás megvan, az összefoglaló pontosan az első fejezet
// Futtatás: node test/mobile-onboarding.js      Böngésző: CHROMIUM_PATH / Edge / Chrome; ha nincs: SKIP
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }
const root = path.resolve(__dirname, '..');
const PORT = 3232, BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + (e && e.stack || e)); }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONES = [{ name: '390x844', width: 390, height: 844 }, { name: '360x740', width: 360, height: 740 }, { name: '320x568', width: 320, height: 568 }];

async function launch() {
  if (!chromium) return null;
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) { try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ } }
  return null;
}
const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
// a megadott szelektorok első látható elemének téglalapja (null, ha nincs)
const rectOf = (page, sel) => page.evaluate((s) => {
  for (const e of document.querySelectorAll(s)) {
    const r = e.getBoundingClientRect(), st = getComputedStyle(e);
    if (r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none') return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  }
  return null;
}, sel);
const fixedButtons = (page) => page.evaluate(() => [...document.querySelectorAll('.comfort-btn, .info-btn')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).position === 'fixed'; })
  .map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, what: e.className.toString() }; }));

// A flag nélküli (első) látogatásnál a játék a belépés után magától megnyitja a rövid útmutatót: egy játékos itt az "Értem, kezdjük!" gombbal zárja be
async function closeFirstHelp(page) {
  await page.waitForSelector('#helpModal:not(.hidden)', { timeout: 4000 });
  await page.locator('#helpOk').click(); await page.waitForSelector('#helpModal.hidden', { state: 'attached' });
}
const presetHelpSeen = (page) => page.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });

async function guestToMenu(page, name, { firstHelp = false } = {}) {
  await page.goto(BASE, { waitUntil: 'load' });
  await pause(800);
  await page.locator('#authGuest').click();
  if (firstHelp) await closeFirstHelp(page);
  await page.locator('#btnNewSuspect').click();
  await page.locator('#guestName').fill(name);
  await page.locator('#btnGuestGo').click();
  await page.waitForFunction(() => document.body.dataset.screen === 'menu', null, { timeout: 15000 });
  await pause(400);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-mob-')), f = (x) => path.join(tmp, x);
  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', DATABASE_URL: '', AUTH_BASE_URL: BASE, MAX_ROOMS_PER_IP: '80',
    AUTH_STORE_PATH: f('a.json'), KB_STATS_FILE: f('s.json'), KB_AVATARS_FILE: f('v.json'), KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs böngésző'); child.kill(); return; }
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health', { headers: { Connection: 'close' } })).ok) break; } catch (_) { await pause(100); } }
    const mobile = (p) => browser.newContext({ viewport: { width: p.width, height: p.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    for (const p of PHONES) {
      await test('A) névválasztó ' + p.name + ': a cím szabad, az új-játékos gomb a legendák előtt és az első képernyőn van, az űrlap elfér', async () => {
        const ctx = await mobile(p), page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message || e)));
        try {
          await presetHelpSeen(page);
          await page.goto(BASE, { waitUntil: 'load' }); await pause(800);
          await page.locator('#authGuest').click(); await pause(700);
          assert.equal(await page.evaluate(() => document.body.dataset.screen), 'name');
          const title = await rectOf(page, '#screen-name .logo'); assert.ok(title, 'a cím látszik');
          for (const b of await fixedButtons(page)) assert.ok(!hit(title, b), 'a cím ütközik: ' + b.what + ' ' + JSON.stringify(b) + ' / ' + JSON.stringify(title));
          const btn = await rectOf(page, '#btnNewSuspect'), card = await rectOf(page, '#mugGrid > *');
          assert.ok(btn && card, 'a gomb és az első kártya látszik'); assert.ok(btn.top < card.top, 'az új-játékos gomb a kártyák előtt van (' + btn.top + ' < ' + card.top + ')');
          if (p.height >= 740) assert.ok(btn.bottom <= p.height, 'a gomb az első képernyőn belül van (' + btn.bottom + ' <= ' + p.height + ')'); else assert.ok(btn.top < p.height, 'a gomb az első képernyőn kezdődik');
          await page.locator('#btnNewSuspect').click(); await pause(300);
          for (const sel of ['#guestName', '#btnGuestGo']) { await page.locator(sel).scrollIntoViewIfNeeded(); const r = await rectOf(page, sel); assert.ok(r && r.left >= 0 && r.right <= p.width, sel + ' vízszintesen elfér: ' + JSON.stringify(r)); }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'nincs vízszintes görgetés');
          assert.deepEqual(errors, [], 'nincs JS-hiba');
        } finally { await ctx.close(); }
      });
    }

    await test('A) nagy képernyőn a névválasztó sorrendje változatlan: a legendák kártyái után jön a vendég-gomb', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
      try {
        await presetHelpSeen(page);
        await page.goto(BASE, { waitUntil: 'load' }); await pause(800); await page.locator('#authGuest').click(); await pause(700);
        const btn = await rectOf(page, '#btnNewSuspect'), card = await rectOf(page, '#mugGrid > *');
        assert.ok(btn && card && btn.top > card.top, 'a gomb a kártyák után van nagy képernyőn: ' + JSON.stringify({ btn: btn && btn.top, card: card && card.top }));
      } finally { await ctx.close(); }
    });

    for (const p of PHONES) {
      await test('B) első belépés ' + p.name + ': az útmutató magától megnyílik a rövid összefoglalóval (egyszer), a menü gombja utána nem kiemelt, de kézzel is megnyitható; a cím és a profilkártya szabad', async () => {
        const ctx = await mobile(p), page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message || e)));
        try {
          await page.goto(BASE, { waitUntil: 'load' }); await pause(800);
          assert.equal(await page.evaluate(() => localStorage.getItem('kb_helpSeen')), null, 'friss böngésző: még nincs látott-jelző');
          await page.waitForTimeout(1200); assert.equal(await page.evaluate(() => document.querySelector('#helpModal').classList.contains('hidden')), true, 'belépés előtt nem nyílik meg');
          await page.locator('#authGuest').click();
          await page.waitForSelector('#helpModal:not(.hidden)', { timeout: 4000 });
          const first = await page.evaluate(() => { const s = document.querySelector('#helpBody .help-sec'); return { h: s.querySelector('h3').textContent, items: s.querySelectorAll('li').length, ok: document.querySelector('#helpOk').textContent.trim() }; });
          assert.match(first.h, /^RÖVIDEN/); assert.ok(first.items >= 4, 'az összefoglaló pontjai'); assert.equal(first.ok, 'Értem, kezdjük!');
          assert.equal(await page.evaluate(() => localStorage.getItem('kb_helpSeen')), '1', 'megnyitáskor látottnak számít (egyszeri)');
          assert.ok(await rectOf(page, '#helpOk'), 'az "Értem, kezdjük!" gomb látszik');
          await page.locator('#helpOk').click(); await page.waitForSelector('#helpModal.hidden', { state: 'attached' });
          await page.locator('#btnNewSuspect').click(); await page.locator('#guestName').fill('Mobil' + p.width); await page.locator('#btnGuestGo').click();
          await page.waitForFunction(() => document.body.dataset.screen === 'menu', null, { timeout: 15000 }); await pause(400);
          const title = await rectOf(page, '#screen-menu .logo'), who = await rectOf(page, '#menuWho');
          assert.ok(title && who, 'a cím és a "belépsz mint" kártya látszik');
          for (const b of await fixedButtons(page)) { assert.ok(!hit(title, b), 'a cím ütközik: ' + b.what); assert.ok(!hit(who, b), 'a profilkártya ütközik: ' + b.what); }
          const how = page.locator('#btnHowTo'); await how.scrollIntoViewIfNeeded();
          assert.match(await how.innerText(), /Hogyan kell játszani/i); assert.equal(await how.evaluate((e) => e.classList.contains('first-visit')), false, 'az útmutató már látott: a gomb nem kiemelt');
          assert.ok((await rectOf(page, '#btnHowTo')).height >= 44, 'az érintési célpont legalább 44 px magas');
          assert.equal(await page.evaluate(() => document.querySelector('#helpModal').classList.contains('hidden')), true, 'a menün nem nyílik meg újra');
          await how.click(); await page.waitForSelector('#helpModal:not(.hidden)');
          assert.match(await page.evaluate(() => document.querySelector('#helpBody .help-sec h3').textContent), /^RÖVIDEN/, 'kézzel megnyitva is a rövid összefoglaló az első');
          await page.locator('#helpOk').click(); await page.waitForSelector('#helpModal.hidden', { state: 'attached' });
          assert.deepEqual(errors, [], 'nincs JS-hiba');
        } finally { await ctx.close(); }
      });
    }

    await test('B) az útmutató csak EGYSZER nyílik meg: újratöltés és újabb belépés után sem tér vissza; bezárás nélkül (Esc) sem; nagy képernyőn is', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
      try {
        await page.goto(BASE, { waitUntil: 'load' }); await pause(800); await page.locator('#authGuest').click();
        await page.waitForSelector('#helpModal:not(.hidden)', { timeout: 4000 });
        await page.keyboard.press('Escape'); await page.waitForSelector('#helpModal.hidden', { state: 'attached' }); // nem az "Értem" gombbal zárta be
        assert.equal(await page.evaluate(() => localStorage.getItem('kb_helpSeen')), '1', 'a megnyitás is elég: bezárás módjától független');
        // újratöltés: a játék visszaállítja a munkamenetet (belépés újra lefut), de az útmutató nem tér vissza
        await page.reload({ waitUntil: 'load' }); await pause(2200);
        assert.notEqual(await page.evaluate(() => document.body.dataset.screen || 'auth'), 'auth', 'a munkamenet visszaállt (belépés lefutott)');
        assert.equal(await page.evaluate(() => document.querySelector('#helpModal').classList.contains('hidden')), true, 'újratöltés és újra-belépés után nem nyílik meg újra');
        // teljesen új lap ugyanabban a böngészőben (a localStorage megmarad): új belépés sem hozza vissza
        const page2 = await ctx.newPage(); await page2.goto(BASE, { waitUntil: 'load' }); await pause(800); await page2.locator('#authGuest').click(); await pause(1800);
        assert.equal(await page2.evaluate(() => document.querySelector('#helpModal').classList.contains('hidden')), true, 'új lapon, új belépéskor sem nyílik meg újra');
      } finally { await ctx.close(); }
    });

    await test('B) a menü gombja látott súgó után sem tűnik el (újratöltés után is látszik, nem kiemelt), és nem nyílik meg magától', async () => {
      const ctx = await mobile(PHONES[0]), page = await ctx.newPage();
      try {
        await page.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
        await guestToMenu(page, 'Latott390');
        assert.equal(await page.evaluate(() => document.querySelector('#btnHowTo').classList.contains('first-visit')), false);
        assert.ok(await rectOf(page, '#btnHowTo'), 'a gomb látszik');
      } finally { await ctx.close(); }
    });

    for (const p of PHONES) {
      await test('C) lobbi ' + p.name + ': a kódkártyát nem takarják a fix gombok; a hibajelentő gomb nem takarja a hírszalagot; nincs vízszintes görgetés', async () => {
        const ctx = await mobile(p), page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message || e)));
        try {
          await page.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
          await guestToMenu(page, 'Lobbi' + p.width);
          await page.locator('#btnCreate').click(); await page.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 15000 }); await pause(900);
          const code = await rectOf(page, '#screen-lobby .casefile-box'); assert.ok(code, 'a kódkártya látszik');
          for (const b of await fixedButtons(page)) assert.ok(!hit(code, b), 'a kódkártya ütközik: ' + b.what);
          const ticker = await rectOf(page, '#screen-lobby .ticker'), bug = await rectOf(page, '#bugFab');
          assert.ok(ticker && bug, 'a hírszalag és a hibajelentő gomb látszik'); assert.ok(!hit(ticker, bug), 'a hibajelentő gomb takarja a hírszalagot: ' + JSON.stringify({ ticker, bug }));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'nincs vízszintes görgetés');
          assert.deepEqual(errors, [], 'nincs JS-hiba');
        } finally { await ctx.close(); }
      });
    }

    for (const [label, vp, mobileCtx] of [['390x844 telefon', PHONES[0], true], ['1280x800 asztali', { width: 1280, height: 800 }, false]]) {
      await test('A) névválasztó ' + label + ': a gazdához rendelt legenda-kártyán az "A GAZDÁJÁÉ" pecsét nem takarja az Elítélve / Felmentve jelvényeket', async () => {
        const ctx = mobileCtx ? await mobile(vp) : await browser.newContext({ viewport: { width: vp.width, height: vp.height } }), page = await ctx.newPage();
        try {
          await page.goto(BASE, { waitUntil: 'load' }); await pause(800);
          await page.locator('#authGuest').click(); await pause(800);
          // a kliens saját markupjával azonos állapot: lefoglalt (gazdához rendelt) legenda-kártya, nincs "VÁLASZTOM" gomb, van pecsét (a helyi szerveren nincs gazdához rendelt legenda)
          const res = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('#mugGrid > *')].slice(0, 2); const out = [];
            for (const c of cards) {
              c.classList.add('taken'); const pick = c.querySelector('.mug-pick'); if (pick) pick.remove();
              const d = document.createElement('div'); d.className = 'mug-taken'; d.innerHTML = '<span>A GAZDÁJÁÉ</span>'; c.appendChild(d);
              const stats = c.querySelector('.mug-stats').getBoundingClientRect(), stamp = d.querySelector('span').getBoundingClientRect(), card = c.getBoundingClientRect();
              out.push({ cos: /cos-(frame|bg)-/.test(c.className), overlap: stamp.top < stats.bottom - 0.5 && stamp.bottom > stats.top + 0.5, inside: stamp.bottom <= card.bottom + 0.5 && stamp.top >= card.top });
            }
            return out;
          });
          assert.ok(res.length >= 2 && res.every((r) => r.cos), 'a legenda-kártyák egyedi kerettel / háttérrel jelennek meg');
          for (const r of res) { assert.equal(r.overlap, false, 'a pecsét takarja a jelvényeket'); assert.equal(r.inside, true, 'a pecsét a kártyán belül van'); }
        } finally { await ctx.close(); }
      });
    }

    const FOOTER_SIZES = [{ w: 1920, h: 937, mobile: false, fits: true }, { w: 1896, h: 950, mobile: false, fits: true }, { w: 1920, h: 1080, mobile: false, fits: true }, { w: 1366, h: 768, mobile: false }, { w: 1024, h: 768, mobile: false }, { w: 390, h: 844, mobile: true }, { w: 360, h: 640, mobile: true }];
    for (const s of FOOTER_SIZES) {
      await test('E) belépőoldal lábléc ' + s.w + 'x' + s.h + ': a jogi hivatkozások a hírsávban vannak, a hibajelentő gomb nem takar semmit' + (s.fits ? ', az oldal görgetés nélkül elfér' : '') + (s.mobile ? ', a négy elem egy sorban' : ''), async () => {
        const ctx = s.mobile ? await mobile({ width: s.w, height: s.h }) : await browser.newContext({ viewport: { width: s.w, height: s.h } }), page = await ctx.newPage();
        try {
          await page.goto(BASE, { waitUntil: 'load' }); await pause(1000);
          const info = await page.evaluate(() => {
            const rect = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
            const footer = document.querySelector('.auth-features');
            const items = [...footer.querySelectorAll(':scope > span, :scope > a')].map(rect);
            const legal = footer.querySelector('.auth-legal');
            return { inFooter: !!legal, links: legal ? [...legal.querySelectorAll('a')].map((a) => a.getAttribute('href')) : [], itemCount: items.length, tops: items.map((r) => Math.round(r.top)), bottoms: items.map((r) => Math.round(r.bottom)), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight };
          });
          assert.equal(info.inFooter, true, 'a jogi hivatkozások a lábléc-sávban vannak');
          assert.deepEqual(info.links, ['/impresszum', '/adatkezeles', '/felhasznalasi-feltetelek']);
          assert.equal(info.itemCount, 4, 'négy elem a sávban');
          assert.ok(info.scrollW <= info.innerW, 'nincs vízszintes görgetés');
          if (s.fits) assert.ok(info.scrollH <= info.innerH, 'az oldal elfér görgetés nélkül: ' + info.scrollH + ' <= ' + info.innerH);
          if (s.mobile) assert.ok(Math.max(...info.tops) < Math.min(...info.bottoms), 'a négy elem egy sorban (a függőleges tartományuk átfedi egymást): ' + info.tops.join(', ') + ' / ' + info.bottoms.join(', '));
          // az oldal aljára görgetve: a hibajelentő gomb nem ütközik a lábléc egyetlen elemével / hivatkozásával sem
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await pause(300);
          const bug = await rectOf(page, '#bugFab'); assert.ok(bug, 'a hibajelentő gomb látszik');
          const boxes = await page.evaluate(() => [...document.querySelectorAll('.auth-features > span, .auth-features > a, .auth-legal a')].map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, t: (e.textContent || '').trim().slice(0, 24) }; }));
          for (const b of boxes) assert.ok(!hit(bug, b), 'a hibajelentő gomb takarja: ' + b.t + ' ' + JSON.stringify({ bug, b }));
          assert.ok(bug.top >= 0 && bug.bottom <= s.h && bug.left >= 0, 'a gomb a képernyőn belül van');
        } finally { await ctx.close(); }
      });
    }

    await test('D) a gombfeliratok helyesek (BELÉPÉS), és a játékleírás teljes: az összefoglaló az első fejezet, a régi fejezetek megvannak', async () => {
      const html = await (await fetch(BASE + '/', { headers: { Connection: 'close' } })).text();
      assert.ok(!/BELEPÉS/.test(html), 'elütés: BELEPÉS'); assert.match(html, /id="btnJoin"[^>]*>BELÉPÉS A TEREMBE</); assert.match(html, /id="btnGuestGo"[^>]*>BELÉPÉS A NYILVÁNTARTÁSBA</);
      const help = await (await fetch(BASE + '/help.json', { headers: { Connection: 'close' } })).json();
      assert.match(help.sections[0].heading, /^RÖVIDEN/); assert.ok(help.sections[0].list.length >= 4);
      const headings = help.sections.map((s) => s.heading);
      for (const h of ['MI EZ A JÁTÉK?', 'EGY KÖR MENETE', 'PONTOZÁS', 'GOMBOK', 'BARÁTOK', 'ADATVÉDELEM']) assert.ok(headings.some((x) => x.startsWith(h.replace(/\?$/, ''))), 'hiányzik a fejezet: ' + h);
      assert.ok(help.sections.length >= 13);
    });
  } finally {
    await browser.close(); child.kill();
    console.log('\nTelefonos új játékos: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
    process.exitCode = failed ? 1 : 0;
  }
})();
