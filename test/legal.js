'use strict';
// ============================================================
// KAMU BÍRÓSÁG – jogi oldalak és az elfogadás
//  A. oldalak: impresszum, adatkezelési tájékoztató, felhasználási feltételek és játékszabályok (üzemeltetői adatok a LEGAL_* változókból, escape, hiányzó adat jelzése)
//  B. regisztráció: a feltételek elfogadása (és a korhatár) kötelező élesen; a szerver rögzíti az elfogadás idejét és verzióját; a meg nem erősített fiókok takarítása
//  C. felület: a belépőoldal jelölőnégyzete, linkek (böngésző), az admin állapotjelző
// Futtatás: node test/legal.js
// ============================================================
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { createAuth } = require('../auth');
const { createLegal, LEGAL_VERSION } = require('../legal');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* böngésző nélkül a böngészős rész kimarad */ }

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-legal-'));
const f = (n) => path.join(tmp, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');

const OP = { LEGAL_OPERATOR_NAME: 'Teszt Elek', LEGAL_OPERATOR_ADDRESS: '1234 Budapest, Minta utca 1.', LEGAL_OPERATOR_EMAIL: 'info@example.invalid', LEGAL_OPERATOR_KIND: 'magánszemély',
  LEGAL_RENDER_REGION: 'Frankfurt, EU', LEGAL_NEON_REGION: 'Frankfurt, EU' };

async function pages() {
  async function serve(env) {
    const app = express(); const legal = createLegal({ env, origin: 'https://kamubirosag.com' }); app.use(legal.router);
    const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { server, legal, base: 'http://127.0.0.1:' + server.address().port };
  }
  const full = await serve(OP);
  try {
    await test('A: a három oldal elérhető (HTML, nincs gyorsítótár), az üzemeltetői adatok a változókból jönnek', async () => {
      for (const p of ['/impresszum', '/adatkezeles', '/felhasznalasi-feltetelek']) {
        const r = await fetch(full.base + p);
        assert.equal(r.status, 200, p); assert.match(r.headers.get('content-type'), /text\/html; charset=utf-8/); assert.equal(r.headers.get('cache-control'), 'no-cache');
        const html = await r.text();
        assert.ok(html.includes('lang="hu"') && html.includes('/legal.css'), p + ' váz');
        assert.ok(!/<script/i.test(html), p + ': nincs szkript (CSP: script-src self)');
        assert.ok(html.includes('Teszt Elek') && html.includes('info@example.invalid'), p + ' üzemeltetői adatok');
        if (p !== '/felhasznalasi-feltetelek') assert.ok(html.includes('1234 Budapest, Minta utca 1.'), p + ' cím');
        assert.ok(!html.includes('KITÖLTENDŐ') && !html.includes('lg-warn'), p + ': kitöltött adatnál nincs hiányjelzés');
        assert.ok(html.includes(LEGAL_VERSION), p + ' verzió');
      }
      assert.equal(full.legal.missing().length, 0);
    });

    await test('A: az adatkezelési tájékoztató a szükséges tartalmat adja: adatkezelő, adatkörök, jogalap, megőrzés, címzettek, tárolás, gyermekek, jogok, NAIH', async () => {
      const t = text(await (await fetch(full.base + '/adatkezeles')).text());
      for (const piece of ['Ki az adatkezelő', 'Teszt Elek', 'jogalap', 'szerződés teljesítése', 'jogos érdek', 'hozzájárulás', 'Megőrzés', 'scrypt', 'Render', 'Neon', 'Cloudflare', 'Resend', 'Discord', 'Google', 'Ko-fi',
        'Frankfurt, EU', 'Adattovábbítás', 'Sütik és helyi tárolás', 'Nem használunk analitikai', 'Gyermekek és fiatalok', 'legalább 16 évesnek', 'vendégként', 'Adataim letöltése', 'Fiók törlése', 'egy hónapon belül',
        'Nemzeti Adatvédelmi és Információszabadság Hatóság', 'ugyfelszolgalat@naih.hu', 'legfeljebb 14 napig', 'Jelszavak', 'privát üzenet', 'Hibajelentések', 'Moderáció']) {
        assert.ok(t.toLowerCase().includes(piece.toLowerCase()), 'hiányzik: ' + piece);
      }
    });

    // Az űrlap („Elmúltam 16 éves”) és a szöveg egyezik: 16 év alatt nincs fiók (nincs "szülői hozzájárulással regisztrálhat" út), a játék 16+ ajánlott, vendégként is.
    await test('A: korhatár: az űrlap és a szabályzat egyezik – 16 év alatt nincs fiók, a játék 16 éven felülieknek ajánlott (vendégként is)', async () => {
      const priv = text(await (await fetch(full.base + '/adatkezeles')).text()), terms = text(await (await fetch(full.base + '/felhasznalasi-feltetelek')).text());
      assert.ok(priv.includes('fiókot nem hozhatnak létre'), 'adatkezelés: 16 alatt nincs fiók');
      assert.ok(priv.includes('16 éven felülieknek ajánlott') && terms.includes('16 éven felülieknek ajánlott'), 'mindkét oldal kimondja az ajánlást');
      assert.ok(terms.includes('vendégként is') && terms.includes('a Játék vendégként, fiók nélkül játszható'), 'feltételek: a vendég-játék és a 16 alatti helyzet');
      assert.ok(!/szülői felügyeletet gyakorló személy hozzájárulásával/.test(priv + terms), 'nincs régi "szülői hozzájárulással regisztrálhat" szöveg');
      assert.ok(!/hozzájárulásával és tudtával engedett/.test(priv + terms));
      assert.ok(priv.includes('a fiókot és az adatait töröljük'), 'a szülő jelezheti a fiatalabb regisztrációt, a fiók törlődik');
      assert.ok(terms.includes('Ha kiderül, hogy a fiókot ennél fiatalabb hozta létre, a fiókot töröljük'));
      assert.ok(terms.includes('Közösségi viselkedési szabályokat'), 'a feltételek az ajánlásnál a szabályokra hivatkoznak');
    });

    await test('A: a felhasználási feltételek és játékszabályok: játék, fiók, szabályok, kiskorúak védelme, moderáció, szankciók, támogatás, felelősség, jog', async () => {
      const html = await (await fetch(full.base + '/felhasznalasi-feltetelek')).text(); const t = text(html);
      for (const piece of ['Játékszabályok', 'béta állapotú', 'nincs pénzbeli értékük', 'legalább 16 éves', 'A játék fikció', 'Kiskorúak védelme', 'Személyes adatok', 'figyelmeztetés → némítás → kitiltás',
        'Jelentés', 'Önkéntes támogatás', 'nem jár érte ellenszolgáltatás', 'Felelősség', 'békéltető testület', 'magyar jog']) assert.ok(t.includes(piece), 'hiányzik: ' + piece);
      assert.ok(html.includes('id="jatekszabalyok"') && html.includes('id="viselkedes"'), 'az ugrópontok megvannak');
    });

    await test('A: az impresszum: üzemeltető, cím, e-mail, tárhely- és közreműködő szolgáltatók, panasz', async () => {
      const t = text(await (await fetch(full.base + '/impresszum')).text());
      for (const piece of ['Teszt Elek', 'magánszemély', 'Székhely / levelezési cím', 'info@example.invalid', 'Render', 'Neon', 'Cloudflare', 'Resend', 'Panasz', 'Fikció']) assert.ok(t.includes(piece), 'hiányzik: ' + piece);
    });

    await test('A: rövid útvonalak és átirányítás', async () => {
      for (const p of ['/privacy', '/terms', '/imprint', '/aszf', '/adatkezelesi-tajekoztato', '/adatkezeles/']) assert.equal((await fetch(full.base + p)).status, 200, p);
      const r = await fetch(full.base + '/jatekszabalyok', { redirect: 'manual' });
      assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/felhasznalasi-feltetelek#jatekszabalyok');
    });
  } finally { full.server.close(); }

  const at = await serve({ ...OP, LEGAL_OPERATOR_COUNTRY: 'at', LEGAL_OPERATOR_ADDRESS: '1010 Wien, Musterstraße 1' });
  try {
    await test('A: osztrák üzemeltetőnél az adatkezelési tájékoztató az osztrák hatóságot (DSB) és a lakóhely szerinti NAIH-ot is megnevezi; a feltételek az osztrák jogot jelölik', async () => {
      const p = text(await (await fetch(at.base + '/adatkezeles')).text());
      assert.ok(p.includes('Osztrák Adatvédelmi Hatóság') && p.includes('dsb@dsb.gv.at') && p.includes('Barichgasse') && p.includes('Nemzeti Adatvédelmi és Információszabadság Hatóság'));
      const tt = text(await (await fetch(at.base + '/felhasznalasi-feltetelek')).text());
      assert.ok(tt.includes('osztrák jog az irányadó') && !tt.includes('magyar jog az irányadó'));
      assert.ok(text(await (await fetch(at.base + '/impresszum')).text()).includes('1010 Wien, Musterstraße 1 (Ausztria)'));
    });
    await test('A: magyar üzemeltetőnél (alap) a NAIH az egyetlen hatóság és a magyar jog az irányadó', async () => {
      const full2 = await serve(OP);
      try {
        const p = text(await (await fetch(full2.base + '/adatkezeles')).text());
        assert.ok(p.includes('Nemzeti Adatvédelmi és Információszabadság Hatóság') && !p.includes('Datenschutzbehörde'));
        assert.ok(text(await (await fetch(full2.base + '/felhasznalasi-feltetelek')).text()).includes('magyar jog az irányadó'));
      } finally { full2.server.close(); }
    });
  } finally { at.server.close(); }

  const bad = await serve({ LEGAL_OPERATOR_NAME: '<script>alert(1)</script>"x', LEGAL_OPERATOR_EMAIL: '', LEGAL_MIN_AGE: '14' });
  try {
    await test('A: hiányzó adat feltűnően jelölve; a megadott értékek HTML-escape-elve; a korhatár állítható', async () => {
      assert.deepEqual(bad.legal.missing(), ['LEGAL_OPERATOR_ADDRESS', 'LEGAL_OPERATOR_EMAIL']);
      const html = await (await fetch(bad.base + '/impresszum')).text();
      assert.ok(html.includes('lg-warn') && html.includes('KITÖLTENDŐ: LEGAL_OPERATOR_ADDRESS') && html.includes('KITÖLTENDŐ: LEGAL_OPERATOR_EMAIL'));
      assert.ok(!html.includes('<script>alert(1)') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;&quot;x'), 'escape');
      assert.ok(text(await (await fetch(bad.base + '/adatkezeles')).text()).includes('legalább 14 évesnek'), 'a korhatár a változóból jön');
      assert.ok(!text(await (await fetch(bad.base + '/adatkezeles')).text()).includes('legalább 16 évesnek'));
    });
  } finally { bad.server.close(); }
}

// ---------- B. regisztráció ----------
const servers = [];
async function boot(env) {
  const app = express(), server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); servers.push(server);
  const base = 'http://127.0.0.1:' + server.address().port;
  const file = path.join(tmp, crypto.randomUUID() + '.json');
  let clock = Date.now();
  const auth = createAuth({ file, env: { AUTH_BASE_URL: base, AUTH_REQUIRE_EMAIL_VERIFICATION: '0', ...env }, now: () => clock, maxAttempts: 200 });
  app.use('/api/auth', auth.router);
  const req = async (method, route, body) => {
    const r = await fetch(base + '/api/auth' + route, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json', Origin: base } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let data = null; try { data = JSON.parse(t); } catch (_) { /* */ } return { status: r.status, data };
  };
  return { req, file, auth, advance: (ms) => { clock += ms; }, stored: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { users: [] }) };
}
const password = 'Egy hosszú titok 123!';
const reg = (name, email, extra = {}) => ({ username: name, email, password, confirmPassword: password, ...extra });

async function registration() {
  await test('B: kötelező elfogadás (AUTH_REQUIRE_TERMS=1 / https): elfogadás nélkül 400 a korhatárral; elfogadással 201, a szerver rögzíti az időt és a verziót', async () => {
    const a = await boot({ AUTH_REQUIRE_TERMS: '1' });
    const no = await a.req('POST', '/register', reg('Elfogadas Nelkul', 'nincs@example.invalid'));
    assert.equal(no.status, 400); assert.match(no.data.error, /Felhasználási feltételek/); assert.match(no.data.error, /16 éves/);
    for (const v of [false, 'true', 1, null, 'igen']) assert.equal((await a.req('POST', '/register', reg('Elfogadas Nelkul', 'nincs@example.invalid', { acceptTerms: v }))).status, 400, JSON.stringify(v));
    assert.equal(a.stored().users?.length || 0, 0, 'elfogadás nélkül nem jön létre fiók');
    const ok = await a.req('POST', '/register', reg('Elfogadott Elek', 'ok@example.invalid', { acceptTerms: true }));
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    const u = a.stored().users[0];
    assert.equal(u.terms.version, LEGAL_VERSION); assert.equal(u.terms.minAge, 16); assert.ok(Math.abs(u.terms.at - Date.now()) < 60000);
    assert.equal((await a.req('GET', '/status')).data.legal.termsRequired, true);
    assert.equal((await a.req('GET', '/status')).data.legal.minAge, 16);
  });

  await test('B: a korhatár a LEGAL_MIN_AGE változóból jön (státusz + hibaüzenet + rögzítés)', async () => {
    const a = await boot({ AUTH_REQUIRE_TERMS: '1', LEGAL_MIN_AGE: '18' });
    assert.equal((await a.req('GET', '/status')).data.legal.minAge, 18);
    assert.match((await a.req('POST', '/register', reg('Korhatar', 'k@example.invalid'))).data.error, /18 éves/);
    await a.req('POST', '/register', reg('Korhatar', 'k@example.invalid', { acceptTerms: true }));
    assert.equal(a.stored().users[0].terms.minAge, 18);
  });

  await test('B: helyi / teszt környezetben (http) nem kötelező, élesen (https) alapból kötelező; az AUTH_REQUIRE_TERMS felülírja', async () => {
    const local = await boot({});
    assert.equal((await local.req('GET', '/status')).data.legal.termsRequired, false);
    assert.equal((await local.req('POST', '/register', reg('Helyi Hugo', 'h@example.invalid'))).status, 201, 'helyben elfogadás nélkül is megy');
    const off = await boot({ AUTH_REQUIRE_TERMS: '0' });
    assert.equal((await off.req('GET', '/status')).data.legal.termsRequired, false);
    // https alap: a kérés Origin-je nem egyezne, ezért csak a státuszt nézzük
    const app = express(); const prod = createAuth({ file: path.join(tmp, 'p.json'), env: { AUTH_BASE_URL: 'https://kamubirosag.com' } }); app.use('/api/auth', prod.router);
    const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r)); servers.push(server);
    assert.equal((await (await fetch('http://127.0.0.1:' + server.address().port + '/api/auth/status')).json()).legal.termsRequired, true);
  });

  await test('B: Google / Discord belépéssel létrejövő fiók is megkapja az elfogadás-jelzést (a belépőoldal figyelmeztetése fedi)', () => {
    const src = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
    assert.ok(/terms:\{version:LEGAL_VERSION,at:now\(\),via:provider\}/.test(src));
  });

  await test('B: a meg nem erősített, soha be nem lépett fiókot 7 nap után a takarítás törli; a megerősített / belépett marad', async () => {
    const a = await boot({ AUTH_REQUIRE_EMAIL_VERIFICATION: '1', sendMailNeeded: '' , AUTH_REQUIRE_TERMS: '0' });
    // levélküldés nélkül nincs megerősítés: kézzel jelöljük a fiókokat
    await a.req('POST', '/register', reg('Regi Megerosito', 'regi@example.invalid'));
    await a.req('POST', '/register', reg('Belepett Bela', 'bela@example.invalid'));
    const s = a.stored();
    s.users[0].emailVerified = false; s.users[0].createdAt = Date.now() - 8 * 24 * 3600 * 1000; delete s.users[0].lastLoginAt; // soha nem lépett be
    s.users[1].emailVerified = false; s.users[1].createdAt = Date.now() - 8 * 24 * 3600 * 1000; s.users[1].lastLoginAt = Date.now() - 1000;
    fs.writeFileSync(a.file, JSON.stringify(s));
    const b = createAuth({ file: a.file, env: { AUTH_BASE_URL: 'http://127.0.0.1:9' } });
    assert.equal(b.purgeUnverified(), 1);
    const left = JSON.parse(fs.readFileSync(a.file, 'utf8')).users.map((u) => u.username);
    assert.deepEqual(left, ['Belepett Bela']);
    assert.equal(b.purgeUnverified(), 0, 'nincs több teendő');
  });
}

// ---------- C. felület ----------
async function ui() {
  const PORT = 3222, BASE = 'http://127.0.0.1:' + PORT, TOKEN = 'admin-token-' + 'x'.repeat(24);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, AUTH_REQUIRE_TERMS: '1', DISCORD_BOT_TOKEN: '', ADMIN_TOKEN: TOKEN, RESEND_API_KEY: '', EMAIL_FROM: '', AUTH_MAIL_API_KEY: '', AUTH_MAIL_FROM: '',
      LEGAL_OPERATOR_NAME: '', LEGAL_OPERATOR_ADDRESS: '', LEGAL_OPERATOR_EMAIL: '',
      AUTH_STORE_PATH: f('acc.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('st.json'), KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'),
      KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') }
  });
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');

    await test('C: a szerverről elérhetők a jogi oldalak (a CSP-fejlécekkel), a stíluslap, és a hiányzó üzemeltetői adat látszik az admin állapotban', async () => {
      for (const p of ['/impresszum', '/adatkezeles', '/felhasznalasi-feltetelek', '/legal.css']) assert.equal((await fetch(BASE + p)).status, 200, p);
      const r = await fetch(BASE + '/adatkezeles');
      assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/);
      assert.match(await r.text(), /Az üzemeltetői adatok még nincsenek kitöltve/);
      const st = await (await fetch(BASE + '/api/admin/status', { headers: { Authorization: 'Bearer ' + TOKEN } })).json();
      assert.deepEqual(st.legal.missing, ['LEGAL_OPERATOR_NAME', 'LEGAL_OPERATOR_ADDRESS', 'LEGAL_OPERATOR_EMAIL']);
      assert.equal(st.legal.minAge, 16);
    });

    if (chromium) {
      await test('C: böngésző: a belépőoldalon ott a jogi sáv, az elfogadás jelölőnégyzete kötelező, a regisztráció elfogadás nélkül nem megy; az oldalak mobilon is rendben vannak', async () => {
        const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
        const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'msedge' });
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          await page.goto(BASE + '/');
          await page.waitForFunction(() => !document.querySelector('#authRegisterSubmit').disabled, null, { timeout: 15000 });
          const hrefs = await page.$$eval('.auth-legal a', (as) => as.map((a) => a.getAttribute('href')));
          assert.deepEqual(hrefs, ['/impresszum', '/adatkezeles', '/felhasznalasi-feltetelek']);
          assert.equal(await page.isVisible('#authTerms'), true);
          assert.equal(await page.getAttribute('#authTerms', 'required'), '');
          assert.match(await page.textContent('label.auth-terms'), /Elmúltam 16 éves/);
          await page.fill('#authRegisterName', 'Elfogadas Ede'); await page.fill('#authRegisterEmail', 'ede@example.invalid');
          await page.fill('#authRegisterPassword', password); await page.fill('#authRegisterConfirm', password);
          // a böngésző kötelező-mező ellenőrzése megállítja a küldést
          const posted = []; page.on('request', (r) => { if (r.url().endsWith('/api/auth/register')) posted.push(r.url()); });
          await page.click('#authRegisterSubmit'); await pause(600);
          assert.equal(posted.length, 0, 'jelölés nélkül nem megy el a kérés');
          // a szerver is elutasítja (a böngészős ellenőrzést megkerülő kérés)
          const direct = await page.evaluate(async (pw) => (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Elfogadas Ede', email: 'ede@example.invalid', password: pw, confirmPassword: pw }) })).status, password);
          assert.equal(direct, 400);
          await page.check('#authTerms');
          await page.click('#authRegisterSubmit');
          await page.waitForFunction(() => !!window.kbAccount, null, { timeout: 15000 });
          // mobil: az oldalak olvashatók, nincs vízszintes oldal-görgetés (a táblázat a saját dobozában görgethető)
          const m = await browser.newPage({ viewport: { width: 375, height: 700 } });
          for (const p of ['/impresszum', '/adatkezeles', '/felhasznalasi-feltetelek']) {
            await m.goto(BASE + p);
            assert.equal(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, p + ' vízszintes túlcsordulás');
            assert.ok((await m.textContent('h1')).length > 5);
          }
          const sup = await browser.newPage(); await sup.goto(BASE + '/tamogatas');
          assert.deepEqual(await sup.$$eval('.sp-footer a[href^="/i"], .sp-footer a[href="/adatkezeles"], .sp-footer a[href="/felhasznalasi-feltetelek"]', (as) => as.map((a) => a.getAttribute('href'))), ['/impresszum', '/adatkezeles', '/felhasznalasi-feltetelek']);
        } finally { await browser.close(); }
      });
    }
  } finally { child.kill(); }
}

(async () => {
  await pages();
  await registration();
  await ui();
  for (const s of servers) s.close();
  console.log('\nJogi oldalak: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exit(failed ? 1 : 0);
})();
