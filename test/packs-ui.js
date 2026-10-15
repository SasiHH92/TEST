'use strict';
// ============================================================
// KAMU BÍRÓSÁG – Kártyaműhely felülete valódi böngészőben (asztali és telefonos méret)
//  A) a menüben ott a gomb; az ablak megnyílik / bezárul (gomb, Esc, háttér); vendégnek nincs "+ ÚJ CSOMAG", és mentés sincs
//  B) csomag készítése: a számlálók, a hibalista (link), sikeres mentés után a megnézés nézet a kóddal; szerkesztés; idegen szöveg escape-elve (idézőjel, aposztróf)
//  C) a könyvtár: a nyilvános csomag látszik, keresés, mentés másik fiókkal, a gyűjteményben megjelenik
//  D) lobbi: a házigazda saját / mentett csomagja csempeként ott van (🃏 + készítő), a kód-mező felvesz egy privát csomagot és kijelöli; a GYORS JÁTÉK nem használja a csomagokat
//  E) telefon: teljes képernyős ablak, nincs vízszintes görgetés, az érintési célpontok >= 44 px, a szerkesztő mezői elférnek
// Futtatás: node test/packs-ui.js      Böngésző: CHROMIUM_PATH / Edge / Chrome; ha nincs: SKIP
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }
const root = path.resolve(__dirname, '..');
const PORT = 3237, BASE = 'http://127.0.0.1:' + PORT;
const ADMIN_TOKEN = 'admin-token-' + 'x'.repeat(20);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-packsui-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + (e && e.stack || e)); }
}
const cards = (deck, n, extra = '') => Array.from({ length: n }, (_, i) => 'A ' + deck + ' pakli ' + (i + 1) + '. kártyája' + extra + '.');
const SIZE = { vadak: 6, bizonyitekok: 4, alibik: 3, trukkok: 3, tanuk: 3, kihivasok: 3, buntetesek: 3 };
const lines = (extra = '') => Object.fromEntries(Object.entries(SIZE).map(([d, n]) => [d, cards(d, n, extra)]));
const password = 'Egy hosszú titok 123!';

async function launch() {
  if (!chromium) return null;
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
  return null;
}
const mb = (page, name, exact) => page.locator('#packsModal').getByRole('button', { name, exact: !!exact }); // csak az ablakban keres
const rectOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; }, sel);

(async () => {
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs böngésző'); return; }
  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DISCORD_BOT_TOKEN: '', DATABASE_URL: '', MAX_ROOMS_PER_IP: '80', ADMIN_TOKEN,
    AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_STATS_FILE: path.join(tmp, 's.json'), KB_AVATARS_FILE: path.join(tmp, 'v.json'), KB_PACKS_FILE: path.join(tmp, 'p.json'), KB_DMS_FILE: path.join(tmp, 'd.json'),
    KB_MODERATION_FILE: path.join(tmp, 'm.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json'), KB_COURTS_FILE: path.join(tmp, 'c.json'), KB_BUGREPORTS_FILE: path.join(tmp, 'b.json') } });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { await pause(100); } }

    // fiókok: regisztráció API-val, a böngésző a bejelentkezéssel kapott sütit viszi
    async function makeContext(name, vp, mobile) {
      const email = crypto.randomUUID() + '@example.invalid';
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
      await ctx.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
      if (name) {
        const reg = await ctx.request.post(BASE + '/api/auth/register', { data: { username: name, email, password, confirmPassword: password }, headers: { Origin: BASE } });
        assert.equal(reg.status(), 201, 'regisztráció ' + name);
      }
      return ctx;
    }
    async function toMenu(page, asAccount) {
      await page.goto(BASE, { waitUntil: 'load' }); await pause(900);
      if (asAccount) {
        // fiókkal: a saját kártyára kattintva (karakter-választó után) a menübe jut
        await page.waitForSelector('#authContinue:not(.hidden)', { timeout: 15000 }); await page.locator('#authContinue').click();
        await page.waitForFunction(() => document.body.dataset.screen === 'name' && window.kbAccount, null, { timeout: 15000 }); await pause(700);
        await page.locator('#profileCardSlot .mug-card.mug-me').first().click(); await page.locator('#avatarModalOk').click();
      } else {
        await page.locator('#authGuest').click(); await page.locator('#btnNewSuspect').click(); await page.locator('#guestName').fill('Vendég' + Math.floor(Math.random() * 900 + 100)); await page.locator('#btnGuestGo').click();
      }
      await page.waitForFunction(() => document.body.dataset.screen === 'menu', null, { timeout: 15000 }); await pause(400);
    }
    const openPacks = async (page) => { await page.locator('#btnPacks').click(); await page.waitForSelector('#packsModal:not(.hidden)'); await pause(300); };
    const fillEditor = async (page, { name, desc = '', vis = 'private', extra = '', override = {} }) => {
      await page.locator('#packsBody input[aria-label="A csomag neve"]').fill(name);
      await page.locator('#packsBody input[aria-label="Leírás"]').fill(desc);
      await page.locator('#packsBody input[name="pkvis"][value="' + vis + '"]').check();
      const data = { ...lines(extra), ...override };
      const labels = { vadak: 'Vádak', bizonyitekok: 'Bizonyítékok', alibik: 'Alibik', trukkok: 'Trükkök', tanuk: 'Tanúk', kihivasok: 'Kihívások', buntetesek: 'Büntetések' };
      for (const [d, label] of Object.entries(labels)) await page.locator('#packsBody textarea[aria-label="' + label + '"]').fill(data[d].join('\n'));
    };
    const errors = [];
    const track = (page) => { page.on('pageerror', (e) => errors.push(String(e.message || e))); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|status of 40[14]|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()); }); };

    const ctxA = await makeContext('Műhely Anna', { width: 1280, height: 800 });
    const ctxB = await makeContext('Műhely Béla', { width: 1280, height: 800 });
    const ctxG = await makeContext(null, { width: 1280, height: 800 });
    const pageA = await ctxA.newPage(), pageB = await ctxB.newPage(), pageG = await ctxG.newPage(); [pageA, pageB, pageG].forEach(track);
    await toMenu(pageA, true); await toMenu(pageB, true); await toMenu(pageG, false);
    const NAME_A = 'Anna "csomagja" & Co';

    await test('A) menü: a Kártyaműhely gomb látszik; az ablak megnyílik, Esc és háttér-kattintás bezárja; üres állapot, "+ ÚJ CSOMAG" bejelentkezve', async () => {
      assert.ok(await rectOf(pageA, '#btnPacks'), 'a gomb látszik');
      await openPacks(pageA);
      assert.equal(await pageA.locator('.packs-tab.active').innerText(), 'SAJÁT CSOMAGJAIM');
      assert.match(await pageA.locator('#packsBody').innerText(), /Még nincs saját csomagod/); assert.ok(await mb(pageA, '+ ÚJ CSOMAG').count());
      await pageA.keyboard.press('Escape'); assert.equal(await pageA.locator('#packsModal').evaluate((e) => e.classList.contains('hidden')), true, 'Esc bezárja');
      await openPacks(pageA); await pageA.mouse.click(5, 5); assert.equal(await pageA.locator('#packsModal').evaluate((e) => e.classList.contains('hidden')), true, 'a háttér bezárja');
      await openPacks(pageA); await pageA.locator('#packsClose').click(); assert.equal(await pageA.locator('#packsModal').evaluate((e) => e.classList.contains('hidden')), true, 'a gomb bezárja');
    });

    await test('A) vendég: nincs saját csomag és mentés, de a könyvtár és a kód működik', async () => {
      await openPacks(pageG);
      assert.match(await pageG.locator('#packsBody').innerText(), /jelentkezz be/); assert.equal(await mb(pageG, '+ ÚJ CSOMAG').count(), 0);
      await pageG.locator('.packs-tab[data-tab="library"]').click(); await pause(500); assert.match(await pageG.locator('#packsBody').innerText(), /Még nincs nyilvános csomag/);
      await pageG.locator('.packs-tab[data-tab="code"]').click(); assert.ok(await pageG.locator('#packsBody input[aria-label="Csomag kódja"]').count());
      await pageG.locator('#packsBody input[aria-label="Csomag kódja"]').fill('ZZZZZZ'); await mb(pageG, 'MEGNÉZ').click(); await pause(500);
      assert.match(await pageG.locator('#packsBody').innerText(), /Nincs ilyen csomag/);
      await pageG.keyboard.press('Escape');
    });

    let annaCode = '';
    await test('B) csomag készítése: számlálók, hibalista (link), sikeres mentés → megnézés a kóddal és a kártyákkal; idézőjel és & escape-elve', async () => {
      await openPacks(pageA); await mb(pageA, '+ ÚJ CSOMAG').click(); await pause(300);
      assert.match(await pageA.locator('#packsBody .pk-counter').first().innerText(), /0 kártya \(kell: 6–60\)/);
      await fillEditor(pageA, { name: NAME_A, desc: 'Teszt "leírás" <b> nélkül', vis: 'public', override: { vadak: ['Nézd https://rossz.link/x oldalt.', ...cards('vadak', 5)] } });
      assert.match(await pageA.locator('#packsBody .pk-counter').first().innerText(), /6 kártya/);
      await mb(pageA, 'CSOMAG LÉTREHOZÁSA').click(); await pause(600);
      const errText = await pageA.locator('.packs-errors').innerText(); assert.match(errText, /Vádak, 1\. sor: nem tartalmazhat linket/); assert.match(errText, /leírás/i, 'a < > a leírásban hibát ad');
      await fillEditor(pageA, { name: NAME_A, desc: 'Teszt leírás', vis: 'public' });
      await mb(pageA, 'CSOMAG LÉTREHOZÁSA').click(); await pageA.waitForSelector('.pk-view-head', { timeout: 6000 });
      assert.equal(await pageA.locator('.pk-view-head h3').innerText(), NAME_A, 'a név pontosan (idézőjellel, &-jellel) látszik');
      annaCode = (await pageA.locator('.pk-view-head .pk-by').innerText()).match(/kód: ([A-Z2-9]{6})/)[1];
      assert.equal(await pageA.locator('.pk-deck').count(), 7); assert.match(await pageA.locator('.pk-deck').first().innerText(), /Vádak \(6\)/); assert.match(await pageA.locator('.pk-deck li').first().innerText(), /A vadak pakli 1\. kártyája/);
      assert.equal(await mb(pageA, 'SZERKESZT').count(), 1); assert.equal(await mb(pageA, 'JELENTÉS').count(), 0, 'a sajátot nem jelentheti');
      assert.ok(!(await pageA.evaluate(() => document.querySelector('#packsBody').innerHTML.includes('<b>'))), 'nincs beinjektált HTML');
    });

    await test('B) szerkesztés: a mezők a mentett tartalommal töltődnek, a módosítás mentődik; a lista a saját csomagot mutatja a kóddal', async () => {
      await mb(pageA, 'SZERKESZT').click(); await pause(400);
      assert.equal(await pageA.locator('#packsBody input[aria-label="A csomag neve"]').inputValue(), NAME_A);
      const first = await pageA.locator('#packsBody textarea[aria-label="Alibik"]').inputValue(); assert.match(first, /A alibik pakli 1\. kártyája/);
      await pageA.locator('#packsBody textarea[aria-label="Alibik"]').fill(cards('alibik', 4, ' (módosított)').join('\n'));
      await mb(pageA, 'MENTÉS', true).click(); await pageA.waitForSelector('.pk-view-head'); assert.match(await pageA.locator('.pk-deck').nth(2).innerText(), /Alibik \(4\)/);
      await mb(pageA, '‹ VISSZA').click(); await pause(500);
      assert.match(await pageA.locator('.pk-item').first().innerText(), new RegExp(annaCode)); assert.match(await pageA.locator('#packsBody .packs-toolbar').first().innerText(), /1 \/ 5 saját csomag/);
      await pageA.keyboard.press('Escape');
    });

    await test('C) könyvtár: a nyilvános csomag látszik és kereshető; másik fiókkal mentés → a gyűjteményben; idegen csomagot nem lehet szerkeszteni, jelenteni lehet', async () => {
      await openPacks(pageB); await pageB.locator('.packs-tab[data-tab="library"]').click(); await pause(700);
      assert.match(await pageB.locator('.pk-item').first().innerText(), /Anna "csomagja" & Co/);
      assert.ok(!/null|undefined/.test(await pageB.locator('#packsBody').innerText()), 'nincs null / undefined szöveg a könyvtárban'); assert.match(await pageB.locator('.pk-item').first().innerText(), /készítette: Műhely Anna/);
      await pageB.locator('input[type="search"]').fill('nincsilyen'); await mb(pageB, 'KERES').click(); await pause(500); assert.match(await pageB.locator('#packsBody').innerText(), /Nincs találat/);
      await pageB.locator('input[type="search"]').fill('annа'.replace('а', 'a')); await mb(pageB, 'KERES').click(); await pause(500);
      assert.equal(await pageB.locator('.pk-item').count(), 1, 'a keresés megtalálja a készítő nevére');
      await mb(pageB, 'MENTÉS', true).click(); await pause(600);
      await pageB.locator('.packs-tab[data-tab="mine"]').click(); await pause(600);
      assert.match(await pageB.locator('#packsBody').innerText(), /MENTETT CSOMAGOK[\s\S]*Anna "csomagja" & Co/);
      await mb(pageB, 'MEGNÉZ').first().click(); await pageB.waitForSelector('.pk-view-head');
      assert.equal(await mb(pageB, 'SZERKESZT').count(), 0, 'idegen csomag nem szerkeszthető'); assert.equal(await mb(pageB, 'JELENTÉS').count(), 1);
      assert.ok(await mb(pageB, 'LEVÉTEL A GYŰJTEMÉNYBŐL').count(), 'mentve van');
      await pageB.keyboard.press('Escape');
    });

    await test('D) lobbi: Béla mentett csomagja csempeként ott van (🃏 + készítő); a kód-mező felvesz egy privát csomagot és kijelöli; a GYORS JÁTÉK nem használja a csomagokat', async () => {
      // Anna második, PRIVÁT csomagja (csak kóddal)
      await openPacks(pageA); await mb(pageA, '+ ÚJ CSOMAG').click(); await fillEditor(pageA, { name: 'Titkos Anna', vis: 'private', extra: ' t' });
      await mb(pageA, 'CSOMAG LÉTREHOZÁSA').click(); await pageA.waitForSelector('.pk-view-head');
      const privCode = (await pageA.locator('.pk-view-head .pk-by').innerText()).match(/kód: ([A-Z2-9]{6})/)[1]; await pageA.keyboard.press('Escape');
      // Béla: szoba létrehozása → lobbi
      await pageB.locator('#btnCreate').click(); await pageB.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 15000 }); await pause(900);
      await pageB.locator('#btnCustomGame').click(); await pause(500);
      const tile = pageB.locator('#modeGrid .case-tab.pack-tile'); assert.equal(await tile.count(), 1, 'a mentett csomag csempéje');
      assert.match(await tile.first().innerText(), /🃏 ANNA "CSOMAGJA" & CO[\s\S]*készítette: Műhely Anna/);
      assert.ok(!(await tile.first().evaluate((e) => e.classList.contains('active-case'))), 'alapból nincs kijelölve');
      await pageB.locator('#packCodeInput').fill(privCode.toLowerCase()); await pageB.locator('#btnPackAdd').click(); await pause(900);
      assert.equal(await pageB.locator('#modeGrid .case-tab.pack-tile').count(), 2, 'a kóddal felvett csomag is csempe');
      const selected = await pageB.locator('#modeGrid .case-tab.pack-tile.active-case').allInnerTexts(); assert.equal(selected.length, 1); assert.match(selected[0], /TITKOS ANNA/);
      await pageB.locator('#packCodeInput').fill('ZZZZZZ'); await pageB.locator('#btnPackAdd').click(); await pause(500); assert.match(await pageB.locator('#toastBox').innerText().catch(() => ''), /Nincs ilyen csomag|⚠️/);
      // GYORS JÁTÉK: a csomagok nincsenek a gyors beállításban
      const quickModes = await pageB.evaluate(() => quickSettings().modes); assert.ok(quickModes.length >= 12 && quickModes.every((m) => !m.startsWith('pack:')), 'gyors játék: csak beépített témák (' + quickModes.length + ')');
      // a lobbi "Kártyaműhely" gombja a csomaglistát nyitja, a "HASZNÁLOM A SZOBÁBAN" gomb a lobbiban jelenik meg
      await pageB.locator('.pack-lobby-row [data-packs]').click(); await pageB.waitForSelector('#packsModal:not(.hidden)'); await pause(700);
      assert.ok(await mb(pageB, 'HASZNÁLOM A SZOBÁBAN').count() >= 1, 'a házigazda a lobbiból felvehet csomagot');
      await pageB.keyboard.press('Escape');
    });

    await test('D) a csomag a játék állapotában a módok között van (a másik játékos is látja a csempét), és a vendég nem kap csomag-csempét', async () => {
      const code = await pageB.evaluate(() => MY.code);
      await pageG.locator('#packsClose').click().catch(() => {}); await pageG.locator('#codeInput').fill(code); await pageG.locator('#btnJoin').click();
      await pageG.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 15000 }); await pause(900);
      const modes = await pageG.evaluate(() => S.modes.filter((m) => m.pack).map((m) => m.name)); assert.deepEqual(modes.sort(), ['Anna "csomagja" & Co', 'Titkos Anna'].sort());
    });

    await test('G) admin: a Csomagok lapon látszik a csomag a jelentésszámmal; elrejtés (a könyvtárból eltűnik), visszaállítás; nincs "null" szöveg', async () => {
      const ctxAdm = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const adm = await ctxAdm.newPage(); track(adm);
      await adm.goto(BASE + '/admin', { waitUntil: 'load' }); await adm.locator('#token').fill(ADMIN_TOKEN); await adm.locator('#loginForm button[type=submit], #loginForm button').first().click();
      await adm.waitForSelector('#panel:not(.hidden)', { timeout: 8000 }); await adm.locator('#tabbtn-packs').click(); await pause(500);
      const list = adm.locator('#packsAdmin .err'); assert.ok(await list.count() >= 2, 'a csomagok látszanak');
      const first = list.filter({ hasText: 'Anna "csomagja" & Co' }); assert.equal(await first.count(), 1); assert.match(await first.innerText(), /Műhely Anna/); assert.match(await first.innerText(), /nyilvános/);
      assert.ok(!/null/.test(await adm.locator('#packsAdmin').innerText()), 'nincs null szöveg');
      await first.getByRole('button', { name: 'Elrejtés' }).click(); await pause(800);
      assert.match(await adm.locator('#packsAdmin .err', { hasText: 'Anna "csomagja" & Co' }).innerText(), /elrejtve \(üzemeltető\)/);
      const lib = await (await fetch(BASE + '/api/packs/library')).json(); assert.ok(!lib.packs.some((p) => p.name === NAME_A), 'elrejtve nincs a könyvtárban');
      await adm.locator('#packsAdmin .err', { hasText: 'Anna "csomagja" & Co' }).getByRole('button', { name: 'Visszaállítás' }).click(); await pause(800);
      const lib2 = await (await fetch(BASE + '/api/packs/library')).json(); assert.ok(lib2.packs.some((p) => p.name === NAME_A), 'visszaállítva újra látszik');
      await ctxAdm.close();
    });

    // ---------- telefon ----------
    await test('E) telefon: teljes képernyős ablak, nincs vízszintes görgetés, az érintési célpontok >= 44 px, a szerkesztő mezői elférnek, a tartalom görgethető', async () => {
      const ctxM = await makeContext('Műhely Mobil', { width: 390, height: 844 }, true); const page = await ctxM.newPage(); track(page);
      await toMenu(page, true);
      await page.locator('#btnPacks').scrollIntoViewIfNeeded(); await openPacks(page);
      const panel = await rectOf(page, '.packs-panel'); assert.ok(panel.width >= 389 && panel.height >= 843, 'teljes képernyő: ' + JSON.stringify(panel));
      await mb(page, '+ ÚJ CSOMAG').click(); await pause(400);
      const overflow = await page.evaluate(() => { const b = document.querySelector('#packsBody'); return { sw: b.scrollWidth, cw: b.clientWidth, docW: document.documentElement.scrollWidth, innerW: innerWidth, scrollable: b.scrollHeight > b.clientHeight }; });
      assert.ok(overflow.sw <= overflow.cw + 1, 'nincs vízszintes túlcsordulás az ablakban: ' + JSON.stringify(overflow)); assert.ok(overflow.docW <= overflow.innerW + 1); assert.equal(overflow.scrollable, true, 'a hosszú szerkesztő görgethető');
      const small = await page.evaluate(() => [...document.querySelectorAll('#packsModal button, #packsModal input:not([type=radio]), #packsModal textarea, #packsModal .pk-vis label')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.getAttribute('aria-label') || e.className).toString().slice(0, 20), h: Math.round(r.height), w: Math.round(r.width) }; }).filter((x) => x.h < 44));
      assert.deepEqual(small, [], 'túl kicsi érintési célpontok: ' + JSON.stringify(small));
      const widths = await page.evaluate(() => [...document.querySelectorAll('#packsBody textarea, #packsBody input[type=text]')].map((e) => Math.round(e.getBoundingClientRect().right)));
      assert.ok(widths.every((x) => x <= 390), 'a mezők elférnek: ' + widths.join(','));
      await page.locator('#packsClose').click(); await ctxM.close();
    });

    await test('F) nincs JS-hiba / konzolhiba az egész folyamatban', () => { assert.deepEqual(errors, []); });
  } finally {
    await browser.close(); child.kill();
    console.log('\nKártyaműhely (böngésző): ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
    process.exitCode = failed ? 1 : 0;
  }
})();
