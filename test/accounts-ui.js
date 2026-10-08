'use strict';
// ============================================================
// KAMU BÍRÓSÁG – admin fiókkezelés + kötelező jelszócsere A BÖNGÉSZŐBEN (Playwright, valódi szerver ellen)
//  A) /admin: belépés tokennel, fiók létrehozása (egyenként és tömegesen), az ideiglenes jelszó megjelenik, a lista és a keresés, új ideiglenes jelszó
//  B) játékos: ideiglenes jelszóval belépve a kötelező jelszócsere-ablak jön (Esc nem zárja be, nem egyező / rossz jelszó hibát ad), a mentés után a játék megnyílik;
//     F5 után nincs ablak; a megszakított csere (F5 az ablaknál) visszahozza az ablakot; kijelentkezés az ablakból; mobil méreten az ablak elfér és elérhető
// Futtatás:  node test/accounts-ui.js      Böngésző: CHROMIUM_PATH / Edge / Chrome / Playwright Chromium; ha nincs: SKIP (ACCT_UI_REQUIRE=1 esetén hiba)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.ACCT_UI_PORT || 3194), BASE = 'http://127.0.0.1:' + PORT;
const REQUIRE = process.env.ACCT_UI_REQUIRE === '1';
const TOKEN = crypto.randomBytes(24).toString('base64url'); // csak ehhez a teszthez
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-acctui-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky/i;
const TEMP_RE = /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/;
const OWN_PASSWORD = 'Ez az en sajat jelszavam 77!';

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) { try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ } }
  return null;
}
async function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: process.env.ACCT_UI_VERBOSE ? 'inherit' : 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
    AUTH_BASE_URL: BASE, DATABASE_URL: '', ADMIN_TOKEN: TOKEN, AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'),
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
  const contexts = [];
  const newPage = async (viewport) => {
    const context = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 }, locale: 'hu-HU' });
    contexts.push(context);
    await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
    page.on('dialog', (d) => d.accept());
    return { context, page, errors };
  };
  try {
    // ======================= A) admin oldal =======================
    const adminCtx = await newPage();
    const ap = adminCtx.page;
    const created = {}; // név -> ideiglenes jelszó
    await check('Admin: belépés tokennel, megjelenik a Fiókok szakasz (legenda-választóval)', async () => {
      await ap.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await ap.fill('#token', TOKEN); await ap.click('#loginForm button[type=submit]');
      await ap.waitForSelector('#accounts', { state: 'visible' });
      await ap.waitForFunction(() => document.querySelectorAll('#newLegend option').length > 5);
      assert.match(await ap.textContent('#acctSummary'), /0 regisztrált/);
      assert.match(await ap.textContent('#acctList'), /Még nincs regisztrált fiók/);
    });

    await check('Admin: új fiók létrehozása → ideiglenes jelszó látszik, a lista frissül, az űrlap kiürül', async () => {
      await ap.fill('#newName', 'Ui Anna'); await ap.fill('#newEmail', 'ui.anna@example.invalid');
      await ap.click('#newAcctBtn');
      await ap.waitForSelector('#acctResult .pw');
      const pw = (await ap.textContent('#acctResult .pw')).trim();
      assert.match(pw, TEMP_RE);
      created['Ui Anna'] = pw;
      assert.match(await ap.textContent('#acctResult'), /csak most látszanak/);
      await ap.waitForFunction(() => /1 regisztrált/.test(document.getElementById('acctSummary').textContent));
      const row = await ap.textContent('#acctList');
      assert.match(row, /Ui Anna/); assert.match(row, /ui\.anna@example\.invalid/); assert.match(row, /új jelszót kell választania/); assert.match(row, /még nem lépett be/);
      assert.equal(await ap.inputValue('#newName'), ''); assert.equal(await ap.inputValue('#newEmail'), '');
    });

    await check('Admin: hibás űrlap → érthető hiba, nem lesz fiók', async () => {
      await ap.fill('#newName', 'Ui Anna'); await ap.fill('#newEmail', 'masik@example.invalid');
      await ap.click('#newAcctBtn');
      await ap.waitForFunction(() => /foglalt/.test(document.getElementById('newAcctMsg').textContent));
      assert.match(await ap.getAttribute('#newAcctMsg', 'class'), /bad/);
      await ap.fill('#newName', ''); await ap.fill('#newEmail', '');
    });

    await check('Admin: tömeges létrehozás (név; e-mail / vessző / szóköz), hibás sor külön jelölve és a szövegmezőben marad', async () => {
      await ap.fill('#bulkText', ['Ui Bela; ui.bela@example.invalid', 'Ui Cili, ui.cili@example.invalid', 'Ui Dani ui.dani@example.invalid', 'Ui Nincs Cim', 'Ui Anna; foglalt.cim@example.invalid'].join('\n'));
      await ap.click('#bulkBtn');
      await ap.waitForFunction(() => /3 fiók elkészült/.test(document.getElementById('bulkMsg').textContent));
      const names = await ap.$$eval('#acctResult .err b', (els) => els.map((e) => e.textContent));
      assert.ok(names.some((n) => n.includes('Ui Bela')) && names.some((n) => n.includes('Ui Cili')) && names.some((n) => n.includes('Ui Dani')), names.join(' | '));
      assert.equal(names.filter((n) => n.startsWith('✗')).length, 2, 'két hibás sor: ' + names.join(' | '));
      const pws = await ap.$$eval('#acctResult .pw', (els) => els.map((e) => e.textContent.trim()));
      assert.equal(pws.length, 3); assert.ok(pws.every((p) => TEMP_RE.test(p)));
      const rows = await ap.$$eval('#acctResult .err', (els) => els.map((e) => e.textContent));
      for (const [n, label] of [['Ui Bela', 0], ['Ui Cili', 1], ['Ui Dani', 2]]) {
        const row = rows.find((t) => t.includes('✓ ' + n)); assert.ok(row, n);
        created[n] = row.match(/[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}/)[0]; void label;
      }
      const left = await ap.inputValue('#bulkText');
      assert.ok(left.includes('Ui Nincs Cim') && left.includes('foglalt.cim@example.invalid'), 'a hibás sorok maradtak javításra: ' + left);
      assert.ok(!left.includes('ui.bela@'), 'a sikeres sorok eltűntek');
      assert.match(await ap.textContent('#acctResult'), /Mind másolása/);
    });

    await check('Admin: keresés név / e-mail szerint, "új jelszót kell választania" jelvény, legenda-fiók', async () => {
      await ap.waitForFunction(() => /4 regisztrált/.test(document.getElementById('acctSummary').textContent));
      await ap.fill('#acctFilter', 'cili');
      assert.equal(await ap.$$eval('#acctList .acct', (e) => e.length), 1);
      await ap.fill('#acctFilter', 'nincs-ilyen');
      assert.match(await ap.textContent('#acctList'), /Nincs találat/);
      await ap.fill('#acctFilter', '');
      await ap.selectOption('#newLegend', 'Kyrashi'); await ap.fill('#newEmail', 'ui.kyrashi@example.invalid'); await ap.click('#newAcctBtn');
      await ap.waitForFunction(() => /Kyrashi/.test(document.getElementById('acctResult').textContent) && /legenda/.test(document.getElementById('acctResult').textContent));
      const kp = (await ap.textContent('#acctResult .pw')).trim(); assert.match(kp, TEMP_RE); created.Kyrashi = kp;
      await ap.waitForFunction(() => /5 regisztrált/.test(document.getElementById('acctSummary').textContent));
      assert.match(await ap.textContent('#acctList'), /legenda/);
    });

    await check('Admin: "Új ideiglenes jelszó" gomb → új jelszó jelenik meg, a régi nem működik', async () => {
      await ap.fill('#acctFilter', 'ui.dani');
      await ap.click('#acctList button:has-text("Új ideiglenes jelszó")');
      await ap.waitForSelector('#askDialog[open]'); await ap.click('#askOk');
      await ap.waitForFunction(() => /Ui Dani/.test(document.getElementById('acctResult').textContent) && document.querySelector('#acctResult .pw'));
      const fresh = (await ap.textContent('#acctResult .pw')).trim();
      assert.match(fresh, TEMP_RE); assert.notEqual(fresh, created['Ui Dani']);
      const old = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: 'ui.dani@example.invalid', password: created['Ui Dani'] }) });
      assert.equal(old.status, 401);
      created['Ui Dani'] = fresh; await ap.fill('#acctFilter', '');
    });

    await check('Admin: fülek és összesítő kártyák (a kártya a fülre ugrik), a fülválasztás F5 után megmarad', async () => {
      assert.equal(await ap.$$eval('#stats .stat', (e) => e.length), 6);
      assert.match(await ap.textContent('#stats .stat:first-child'), /5\s*regisztrált fiók/);
      await ap.click('#tabbtn-errors'); await ap.waitForSelector('#tab-errors', { state: 'visible' });
      assert.equal(await ap.isVisible('#accounts'), false, 'egyszerre egy fül látszik');
      await ap.click('#tabbtn-system'); await ap.waitForSelector('#status', { state: 'visible' });
      await ap.click('#stats .stat:first-child'); await ap.waitForSelector('#accounts', { state: 'visible' });
      await ap.click('#tabbtn-reports'); await ap.waitForSelector('#tab-reports', { state: 'visible' });
      await ap.reload({ waitUntil: 'domcontentloaded' });
      await ap.waitForSelector('#tab-reports', { state: 'visible' });
      assert.equal(await ap.isVisible('#accounts'), false);
      await ap.click('#tabbtn-accounts'); await ap.waitForSelector('#accounts', { state: 'visible' });
    });

    await check('Admin: szűrő-gombok (számlálóval) és rendezés', async () => {
      await ap.waitForSelector('#acctChips .chip');
      await ap.click('#acctChips .chip:has-text("Legenda")');
      assert.equal(await ap.$$eval('#acctList .acct', (e) => e.length), 1);
      assert.match(await ap.textContent('#acctList'), /Kyrashi/);
      assert.equal(await ap.getAttribute('#acctChips .chip:has-text("Legenda")', 'aria-pressed'), 'true');
      await ap.click('#acctChips .chip:has-text("Mind")');
      assert.equal(await ap.$$eval('#acctList .acct', (e) => e.length), 5);
      await ap.selectOption('#acctSort', 'name');
      const names = await ap.$$eval('#acctList .acct-name b', (e) => e.map((x) => x.textContent));
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'hu')), 'név szerint rendezve');
      await ap.selectOption('#acctSort', 'oldest');
      assert.equal((await ap.$$eval('#acctList .acct-name b', (e) => e.map((x) => x.textContent)))[0], 'Ui Anna', 'a legrégebbi elöl');
      await ap.selectOption('#acctSort', 'newest');
      assert.equal((await ap.$$eval('#acctList .acct-name b', (e) => e.map((x) => x.textContent)))[0], 'Kyrashi', 'a legújabb elöl');
      await ap.click('#acctChips .chip:has-text("Google")');
      assert.match(await ap.textContent('#acctList'), /Nincs találat/);
      await ap.click('#acctChips .chip:has-text("Mind")');
    });

    await check('Admin: törlés – a név begépeléséig nem enged, a Mégse nem töröl, helyes névvel (kis/nagybetűre nem érzékenyen) töröl, a belépés megszűnik', async () => {
      await ap.fill('#acctFilter', 'ui.cili');
      await ap.click('#acctList button:has-text("Törlés")');
      await ap.waitForSelector('#askDialog[open]');
      assert.equal(await ap.isDisabled('#askOk'), true);
      await ap.fill('#askWord', 'Ui Cil'); assert.equal(await ap.isDisabled('#askOk'), true, 'részleges név nem elég');
      await ap.click('#askCancel');
      assert.equal(await ap.evaluate(() => document.getElementById('askDialog').open), false);
      assert.equal(await ap.$$eval('#acctList .acct', (e) => e.length), 1, 'a Mégse nem töröl');
      await ap.click('#acctList button:has-text("Törlés")');
      await ap.waitForSelector('#askDialog[open]');
      await ap.fill('#askWord', 'ui cili');
      assert.equal(await ap.isDisabled('#askOk'), false);
      await ap.click('#askOk');
      await ap.waitForFunction(() => /1 fiók törölve/.test(document.getElementById('acctMsg').textContent));
      await ap.waitForFunction(() => /4 regisztrált/.test(document.getElementById('acctSummary').textContent));
      const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: 'ui.cili@example.invalid', password: created['Ui Cili'] }) });
      assert.equal(r.status, 401, 'a törölt fiókkal nem lehet belépni');
      await ap.fill('#acctFilter', '');
    });

    await check('Admin: kijelölés, "mind kijelölése", tömeges új jelszó és tömeges törlés (TÖRLÖM szó kell)', async () => {
      await ap.fill('#bulkText', 'Eldobhato Egy; egy@example.invalid\nEldobhato Ketto; ketto@example.invalid');
      await ap.click('#bulkBtn');
      await ap.waitForFunction(() => /2 fiók elkészült/.test(document.getElementById('bulkMsg').textContent));
      await ap.fill('#acctFilter', 'eldobhato');
      assert.equal(await ap.isDisabled('#selDelete'), true, 'kijelölés nélkül tiltva');
      await ap.check('#selAll');
      assert.match(await ap.textContent('#selCount'), /2 kijelölve/);
      assert.equal(await ap.$$eval('#acctList .acct.picked', (e) => e.length), 2);
      await ap.uncheck('#acctList .acct:first-child .pick');
      assert.match(await ap.textContent('#selCount'), /1 kijelölve/);
      await ap.check('#acctList .acct:first-child .pick');
      await ap.click('#selTemp'); await ap.waitForSelector('#askDialog[open]'); await ap.click('#askOk');
      await ap.waitForFunction(() => document.querySelectorAll('#acctResult .pw').length === 2);
      await ap.click('#selDelete'); await ap.waitForSelector('#askDialog[open]');
      assert.equal(await ap.isDisabled('#askOk'), true, 'a TÖRLÖM szóig tiltva');
      await ap.fill('#askWord', 'TÖRLÖM'); await ap.click('#askOk');
      await ap.waitForFunction(() => /2 fiók törölve/.test(document.getElementById('acctMsg').textContent));
      assert.match(await ap.textContent('#acctList'), /Nincs találat/);
      await ap.fill('#acctFilter', '');
      await ap.waitForFunction(() => /4 regisztrált/.test(document.getElementById('acctSummary').textContent));
    });

    await check('Admin: kilépés gomb → vissza a belépéshez, F5 után sem marad bent', async () => {
      await ap.click('#adminLogout');
      await ap.waitForSelector('#login', { state: 'visible' });
      assert.equal(await ap.isVisible('#panel'), false);
      await ap.reload({ waitUntil: 'domcontentloaded' });
      await ap.waitForSelector('#login', { state: 'visible' });
      assert.equal(await ap.isVisible('#panel'), false);
      await ap.fill('#token', TOKEN); await ap.click('#loginForm button[type=submit]');
      await ap.waitForSelector('#accounts', { state: 'visible' });
    });

    await check('Admin: nincs konzol-hiba (CSP, szkript)', async () => { assert.deepEqual(adminCtx.errors, []); });

    await check('Admin mobilon (390×844): nincs vízszintes görgetés, a kártyák, a fülek és a sor-gombok elérhetők', async () => {
      const m = await newPage({ width: 390, height: 844 });
      await m.page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await m.page.fill('#token', TOKEN); await m.page.click('#loginForm button[type=submit]');
      await m.page.waitForSelector('#acctList .acct');
      const info = await m.page.evaluate(() => {
        const first = document.querySelector('#acctList .acct');
        const buttons = [...first.querySelectorAll('.acct-actions button')].map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, h: r.height }; });
        return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, buttons, stats: document.querySelectorAll('#stats .stat').length };
      });
      assert.ok(info.scrollW <= info.innerW + 1, 'nincs vízszintes görgetés: ' + JSON.stringify(info));
      assert.ok(info.buttons.length >= 2 && info.buttons.every((b) => b.l >= 0 && b.r <= info.innerW && b.h >= 26), 'a sor-gombok elférnek: ' + JSON.stringify(info.buttons));
      await m.page.click('#tabbtn-errors'); await m.page.waitForSelector('#tab-errors', { state: 'visible' });
      assert.deepEqual(m.errors, []);
      await m.context.close();
    });

    // ======================= B) játékos: kötelező jelszócsere =======================
    const login = async (page, email, password) => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#authLoginEmail', { state: 'visible' });
      await page.fill('#authLoginEmail', email); await page.fill('#authLoginPassword', password);
      await page.evaluate(() => document.getElementById('authLoginSubmit').click());
    };
    const forceOpen = (page) => page.evaluate(() => document.getElementById('authForce').open);
    const screen = (page) => page.evaluate(() => document.body.dataset.screen);

    const player = await newPage();
    const pp = player.page;
    await check('Játékos: ideiglenes jelszóval belépve a kötelező jelszócsere-ablak jön (az ideiglenes jelszó előtöltve), a játék nem nyílik meg', async () => {
      await login(pp, 'ui.anna@example.invalid', created['Ui Anna']);
      await pp.waitForFunction(() => document.getElementById('authForce').open);
      assert.equal(await pp.inputValue('#authForceCurrent'), created['Ui Anna'], 'az épp beírt ideiglenes jelszó átkerül');
      assert.match(await pp.textContent('#authForceIntro'), /Ui Anna/);
      assert.equal(await pp.evaluate(() => window.kbAccount), null, 'a kliens nem tekinti belépettnek');
      assert.equal(await pp.evaluate(() => document.getElementById('authLoginPassword').value), '', 'a bejelentkezési jelszómező kiürült');
      assert.equal(await screen(pp), 'auth');
    });

    await check('Játékos: Esc nem zárja be, a háttérre kattintás sem; nem egyező és rossz mostani jelszó hibát ad', async () => {
      await pp.keyboard.press('Escape'); await pp.keyboard.press('Escape');
      assert.equal(await forceOpen(pp), true, 'Esc után is nyitva');
      await pp.mouse.click(4, 4);
      assert.equal(await forceOpen(pp), true, 'a háttér kattintására is nyitva');
      await pp.fill('#authForceNew', OWN_PASSWORD); await pp.fill('#authForceConfirm', OWN_PASSWORD + 'x');
      await pp.click('#authForceSubmit');
      await pp.waitForFunction(() => /nem egyezik/.test(document.getElementById('authForceMessage').textContent));
      await pp.fill('#authForceCurrent', 'rossz ideiglenes 1234'); await pp.fill('#authForceConfirm', OWN_PASSWORD);
      await pp.click('#authForceSubmit');
      await pp.waitForFunction(() => /mostani jelszó hibás/.test(document.getElementById('authForceMessage').textContent));
      assert.equal(await forceOpen(pp), true);
      assert.equal(await pp.evaluate(() => window.kbAccount), null);
    });

    await check('Játékos: F5 a megszakított csere közben → az ablak visszajön (a munkamenet él, de a fiók zárva)', async () => {
      await pp.reload({ waitUntil: 'domcontentloaded' });
      await pp.waitForFunction(() => document.getElementById('authForce').open);
      assert.equal(await pp.inputValue('#authForceCurrent'), '', 'ilyenkor újra be kell írni az ideiglenes jelszót');
      assert.equal(await pp.evaluate(() => window.kbAccount), null);
    });

    await check('Játékos: helyes csere → az ablak bezárul, a fiók megnyílik (karakterválasztó), a fiók neve a sajátja', async () => {
      await pp.fill('#authForceCurrent', created['Ui Anna']); await pp.fill('#authForceNew', OWN_PASSWORD); await pp.fill('#authForceConfirm', OWN_PASSWORD);
      await pp.click('#authForceSubmit');
      await pp.waitForFunction(() => !document.getElementById('authForce').open && document.body.dataset.screen === 'name');
      assert.equal(await pp.evaluate(() => window.kbAccount && window.kbAccount.username), 'Ui Anna');
      assert.equal(await pp.evaluate(() => window.kbAccount.mustChangePassword), false);
      assert.equal(await pp.inputValue('#authForceNew'), '', 'a mezők kiürültek');
    });

    await check('Játékos: F5 a csere után → nincs ablak, a fiók megvan; az ideiglenes jelszó többé nem jó, az új igen', async () => {
      await pp.reload({ waitUntil: 'domcontentloaded' });
      await pp.waitForSelector('#authLoginEmail', { state: 'visible' });
      await pp.waitForFunction(() => !document.getElementById('authContinue').classList.contains('hidden'));
      assert.equal(await forceOpen(pp), false, 'nincs jelszócsere-ablak');
      assert.match(await pp.textContent('#authContinueName'), /Ui Anna/);
      const attempt = async (password) => (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: 'ui.anna@example.invalid', password }) })).status;
      assert.equal(await attempt(created['Ui Anna']), 401); assert.equal(await attempt(OWN_PASSWORD), 200);
    });

    const second = await newPage();
    await check('Játékos: kijelentkezés a jelszócsere-ablakból → bejelentkezési képernyő, a fiók korlátozott marad', async () => {
      const sp = second.page;
      await login(sp, 'ui.bela@example.invalid', created['Ui Bela']);
      await sp.waitForFunction(() => document.getElementById('authForce').open);
      await sp.click('#authForceLogout');
      await sp.waitForFunction(() => !document.getElementById('authForce').open);
      assert.equal(await screen(sp), 'auth');
      assert.match(await sp.textContent('#authStatus'), /Kijelentkeztél/);
      const st = await sp.evaluate(() => fetch('/api/auth/status', { credentials: 'same-origin' }).then((r) => r.json()));
      assert.equal(st.user, null, 'a munkamenet megszűnt');
      // újra be lehet lépni, és a csere folytatódik
      await login(sp, 'ui.bela@example.invalid', created['Ui Bela']);
      await sp.waitForFunction(() => document.getElementById('authForce').open);
    });

    await check('Játékos: lejárt / hibás ideiglenes jelszó a bejelentkezésnél érthető hibát ad, ablak nélkül', async () => {
      const third = await newPage();
      await login(third.page, 'ui.cili@example.invalid', 'Rossz Ideiglenes 99');
      await third.page.waitForFunction(() => /Hibás e-mail cím vagy jelszó/.test(document.getElementById('authLoginMessage').textContent));
      assert.equal(await forceOpen(third.page), false);
    });

    await check('Mobil (390×844 és 360×640): az ablak elfér, minden mező és a mentés gomb elérhető, nincs vízszintes görgetés', async () => {
      for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
        const m = await newPage(vp);
        await login(m.page, 'ui.dani@example.invalid', created['Ui Dani']);
        await m.page.waitForFunction(() => document.getElementById('authForce').open);
        const box = await m.page.evaluate(() => {
          const r = document.getElementById('authForce').getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
        });
        assert.ok(box.left >= 0 && box.right <= vp.width, vp.width + ': vízszintesen elfér ' + JSON.stringify(box));
        assert.ok(box.scrollW <= box.innerW + 1, vp.width + ': nincs vízszintes görgetés');
        // minden vezérlő elérhető (a dialógus belül görgethet)
        for (const sel of ['#authForceCurrent', '#authForceNew', '#authForceConfirm', '#authForceSubmit', '#authForceLogout']) {
          await m.page.locator(sel).scrollIntoViewIfNeeded();
          const ok = await m.page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.width > 40 && r.height > 20 && r.top >= 0 && r.bottom <= window.innerHeight + 1; }, sel);
          assert.ok(ok, vp.width + '×' + vp.height + ': ' + sel + ' látható');
        }
        const fs16 = await m.page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('authForceNew')).fontSize));
        assert.ok(fs16 >= 14, 'a mező betűmérete olvasható: ' + fs16);
        await m.context.close();
      }
    });

    await check('Játékos: nincs konzol-hiba (CSP, szkript)', async () => {
      assert.deepEqual(player.errors, []); assert.deepEqual(second.errors, []);
    });
  } finally {
    for (const c of contexts) { try { await c.close(); } catch (_) { /* */ } }
    await browser.close();
    server.kill();
  }
  finish();
})().catch((e) => { failed++; console.error(e.stack); finish(); });

function finish() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nAdmin fiókok (böngésző): ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
}
