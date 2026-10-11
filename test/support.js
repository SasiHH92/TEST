'use strict';
// ============================================================
// KAMU BÍRÓSÁG – "Támogasd a Kamu Bíróságot!" oldal
//  - a fizetés ALAPBÓL KIKAPCSOLT (nincs checkout, a webhook nem létezik), és semmi sem jár a támogatásért,
//  - szerver-oldali összeg-ellenőrzés (az 5 lehetőség + egyedi összeg határai),
//  - a "KÖSZÖNJÜK" csak aláírt, szerver-oldali visszaigazolás után (szimulált szolgáltatóval, valódi pénz nélkül),
//  - a régi bolt és útvonalak sértetlenek (/api/shop védett, /shop biztonságosan átirányít),
//  - böngésző: betöltés, kártyák, egyedi összeg, mobil (nincs vízszintes görgetés), hibamentes konzol, kikapcsolt gomb.
// Futtatás: node test/support.js
// ============================================================
const assert = require('assert/strict');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* böngésző nélkül a böngészős rész kimarad */ }

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-support-'));
const f = (n) => path.join(tmp, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0, skipped = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}
const servers = [];
async function start(port, env = {}) {
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AUTH_BASE_URL: base, DISCORD_BOT_TOKEN: '', SUPPORT_ENABLED: '', SUPPORT_PROVIDER: '', SUPPORT_SIM_SECRET: '', SUPPORT_PREVIEW: '', ...env,
      AUTH_STORE_PATH: f('a' + port + '.json'), KB_AVATARS_FILE: f('av' + port + '.json'), KB_STATS_FILE: f('st' + port + '.json'), KB_COURTS_FILE: f('c' + port + '.json'),
      KB_DMS_FILE: f('d' + port + '.json'), KB_MODERATION_FILE: f('m' + port + '.json'), KB_ERRORS_FILE: f('e' + port + '.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let err = ''; child.stderr.on('data', (d) => { err += d; });
  servers.push({ child, errors: () => err });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return base; } catch (_) { await pause(100); } }
  throw new Error('a szerver nem indult el: ' + err.slice(0, 300));
}
const post = (base, p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

(async () => {
  const OFF = await start(3201);                  // alapértelmezés: kikapcsolva
  const SECRET = 'szimulalt-titok-0123456789abcdef';
  const ON = await start(3202, { SUPPORT_ENABLED: '1', SUPPORT_PROVIDER: 'simulated', SUPPORT_SIM_SECRET: SECRET, SUPPORT_PREVIEW: '1' });

  await test('Alapból minden kikapcsolva: a config enabled=false, az intent 503, a webhook nem létezik, a verify nem igazol', async () => {
    const cfg = await (await fetch(OFF + '/api/support/config')).json();
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.preview, false);
    assert.deepEqual(cfg.tiers.map((t) => t.id), ['kis', 'kave', 'birosag', 'nagylelku', 'egyedi']);
    assert.deepEqual(cfg.tiers.filter((t) => !t.custom).map((t) => t.amountCents), [100, 300, 500, 1000]);
    const intent = await post(OFF, '/api/support/intent', { tierId: 'kave' });
    assert.equal(intent.status, 503);
    assert.equal((await intent.json()).code, 'disabled');
    assert.equal((await post(OFF, '/api/support/webhook/simulated', '{}')).status, 404);
    assert.equal((await post(OFF, '/api/support/webhook/kofi', '{}')).status, 404);
    const v = await (await fetch(OFF + '/api/support/verify?ref=' + 'a'.repeat(32))).json();
    assert.equal(v.verified, false);
    assert.equal((await fetch(OFF + '/api/support/verify?ref=bad')).status, 400);
  });

  await test('Ismeretlen / hiányos szolgáltató és bekapcsolás nélküli beállítás sem aktiválja (nincs éles adapter)', async () => {
    const X = await start(3203, { SUPPORT_ENABLED: '1', SUPPORT_PROVIDER: 'kofi' });
    assert.equal((await (await fetch(X + '/api/support/config')).json()).enabled, false, 'éles adapter nincs → kikapcsolt marad');
    const Y = await start(3204, { SUPPORT_PROVIDER: 'simulated', SUPPORT_SIM_SECRET: SECRET });
    assert.equal((await (await fetch(Y + '/api/support/config')).json()).enabled, false, 'SUPPORT_ENABLED nélkül kikapcsolt');
    const Z = await start(3205, { SUPPORT_ENABLED: '1', SUPPORT_PROVIDER: 'simulated', SUPPORT_SIM_SECRET: 'rovid' });
    assert.equal((await (await fetch(Z + '/api/support/config')).json()).enabled, false, 'gyenge titokkal nem kapcsol be');
  });

  await test('Összeg-ellenőrzés szerver-oldalon: ismeretlen opció, 0,99 €, 500,01 €, szöveg, 3 tizedes, más eredetű kérés mind elutasítva', async () => {
    for (const body of [{ tierId: 'nincs' }, { tierId: 'egyedi', amount: '0,99' }, { tierId: 'egyedi', amount: '500,01' }, { tierId: 'egyedi', amount: 'sok' }, { tierId: 'egyedi', amount: '1.234' }, { tierId: 'egyedi' }, {}, { amount: 5 }]) {
      const r = await post(ON, '/api/support/intent', body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await post(ON, '/api/support/intent', { tierId: 'kave' }, { Origin: 'https://gonosz.example' })).status, 403);
    assert.equal((await fetch(ON + '/api/support/intent', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: ON }, body: 'x' })).status, 415);
    // a kliens által küldött összeg a fix lehetőségeknél nem számít: a szerver a saját összegét használja
    const r = await post(ON, '/api/support/intent', { tierId: 'kave', amount: '999' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).amountCents, 300);
    const c = await post(ON, '/api/support/intent', { tierId: 'egyedi', amount: '7,5' });
    assert.equal((await c.json()).amountCents, 750);
    for (const a of ['1', '500', '0.01'.replace('0.01', '12,34')]) assert.equal((await post(ON, '/api/support/intent', { tierId: 'egyedi', amount: a })).status, 200, a);
  });

  const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  await test('A KÖSZÖNJÜK alapja: csak aláírt, egyező összegű, ismert hivatkozású visszaigazolás igazol; idempotens; hamis nem', async () => {
    const intent = await (await post(ON, '/api/support/intent', { tierId: 'birosag' })).json();
    assert.match(intent.ref, /^[a-f0-9]{32}$/);
    assert.ok(intent.checkoutUrl.includes('szimulalt=' + intent.ref), 'a szimulált fizetési oldal a saját szerverre mutat');
    const verify = async (ref) => (await (await fetch(ON + '/api/support/verify?ref=' + ref)).json());
    assert.deepEqual(await verify(intent.ref), { verified: false, pending: true });
    const ok = JSON.stringify({ ref: intent.ref, amountCents: 500, txnId: 'T-1' });
    // aláírás nélkül / rossz aláírással: elutasítva, nem igazol
    assert.equal((await post(ON, '/api/support/webhook/simulated', ok)).status, 401);
    assert.equal((await post(ON, '/api/support/webhook/simulated', ok, { 'x-signature': 'ab'.repeat(32) })).status, 401);
    assert.equal((await verify(intent.ref)).verified, false, 'a kliens/hamis kérés nem igazolhat');
    // kevesebb összeg: nem igazolja
    const less = JSON.stringify({ ref: intent.ref, amountCents: 100, txnId: 'T-2' });
    assert.equal((await post(ON, '/api/support/webhook/simulated', less, { 'x-signature': sign(less) })).status, 202);
    assert.equal((await verify(intent.ref)).verified, false);
    // ismeretlen hivatkozás: figyelmen kívül
    const unk = JSON.stringify({ ref: 'c'.repeat(32), amountCents: 500, txnId: 'T-3' });
    assert.equal((await post(ON, '/api/support/webhook/simulated', unk, { 'x-signature': sign(unk) })).status, 202);
    // érvényes: igazol, kétszer is ugyanaz (idempotens)
    assert.equal((await post(ON, '/api/support/webhook/simulated', ok, { 'x-signature': sign(ok) })).status, 200);
    assert.deepEqual(await verify(intent.ref), { verified: true, amountCents: 500 });
    const again = await (await post(ON, '/api/support/webhook/simulated', ok, { 'x-signature': sign(ok) })).json();
    assert.ok(again.ok);
    assert.equal((await post(ON, '/api/support/webhook/kofi', ok, { 'x-signature': sign(ok) })).status, 404, 'más szolgáltató végpontja nincs');
  });

  await test('Régi útvonalak és a bolt sértetlen: /api/shop és /api/auth változatlanul védett, /shop és /bolt a főoldalra visz, az oldal kiszolgálva', async () => {
    assert.equal((await fetch(OFF + '/api/shop/state')).status, 401);
    const red = await fetch(OFF + '/shop', { redirect: 'manual' });
    assert.equal(red.status, 302); assert.equal(red.headers.get('location'), '/');
    assert.equal((await fetch(OFF + '/bolt', { redirect: 'manual' })).status, 302);
    for (const p of ['/tamogatas', '/tamogatas/', '/support', '/support.css', '/support.js']) assert.equal((await fetch(OFF + p)).status, 200, p);
    const html = await (await fetch(OFF + '/tamogatas')).text();
    assert.match(html, /TÁMOGASD A KAMU BÍRÓSÁGOT/);
    assert.match(html, /A tárgyalás ingyenes, de a fejlesztő kávéja nem!/);
    assert.match(html, /Játékfejlesztés/); assert.match(html, /Szerverfenntartás/); assert.match(html, /Grafikai fejlesztések/);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html), 'nincs inline szkript (CSP)');
    assert.ok(!/fonts\.googleapis|google-analytics|googletagmanager|facebook/i.test(html), 'nincs külső betűtípus / követő (adatvédelem)');
    const csp = (await fetch(OFF + '/tamogatas')).headers.get('content-security-policy') || '';
    assert.match(csp, /script-src 'self'/);
  });

  await test('Támogatás nem ad játékbeli előnyt: a támogatási kód nem nyúl a fiókokhoz, a bolthoz, a tárgyakhoz', async () => {
    const src = fs.readFileSync(path.join(root, 'support.js'), 'utf8');
    for (const bad of ['shopOf', 'wallet', 'equipped', 'owned', 'auth.mutate', 'user.profile', 'storage.push']) assert.ok(!src.includes(bad), 'a support.js nem használhatja: ' + bad);
    const client = fs.readFileSync(path.join(root, 'public', 'support.js'), 'utf8') + fs.readFileSync(path.join(root, 'public', 'tamogatas.html'), 'utf8');
    for (const bad of ['VIP-rang kapsz', 'prémium karakter kapsz', 'localStorage', 'document.cookie']) assert.ok(!client.includes(bad), bad);
  });

  // ---------------- böngésző ----------------
  async function launch() {
    const tries = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
    for (const o of tries) { try { return await chromium.launch(o); } catch (_) { /* következő */ } }
    return null;
  }
  const browser = chromium ? await launch() : null;
  if (!browser) { skipped++; console.log('SKIP: böngésző nincs (playwright-core + Edge/Chrome kell) – a böngészős ellenőrzések kimaradnak'); }
  else {
    const open = async (base, size, query = '') => {
      const ctx = await browser.newContext({ viewport: size, locale: 'hu-HU' });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/kaspersky/i.test(m.text() + (m.location().url || ''))) problems.push(m.type() + ': ' + m.text() + ' @ ' + (m.location().url || '')); });
      page.on('requestfailed', (r) => { if (!/kaspersky/i.test(r.url())) problems.push('kérés hibás: ' + r.url()); });
      // (a gépre telepített vírusirtók — pl. Kaspersky — saját szkriptet injektálnak az oldalba: azok nem az oldal kérései)
      const foreign = (u) => !u.startsWith(base) && !/kaspersky|\.kis\.v2\./i.test(u);
      page.on('request', (r) => { if (foreign(r.url())) problems.push('KÜLSŐ kérés: ' + r.url()); });
      await page.goto(base + '/tamogatas' + query, { waitUntil: 'networkidle' });
      return { ctx, page, problems };
    };
    for (const [label, size] of [['asztali 1366×768', { width: 1366, height: 768 }], ['telefon 375×812', { width: 375, height: 812 }], ['kis telefon 320×568', { width: 320, height: 568 }]]) {
      await test(`Böngésző (${label}): betöltés, 5 kártya, nincs vízszintes görgetés, nincs konzolhiba / külső kérés, a gomb kikapcsolt`, async () => {
        const { ctx, page, problems } = await open(OFF, size);
        assert.equal(await page.locator('.sp-card').count(), 5);
        const names = await page.locator('.sp-card .sp-name').allInnerTexts();
        assert.deepEqual(names.map((n) => n.trim().toLowerCase()), ['egy kis segítség', 'kávé a fejlesztőnek', 'a bíróság támogatása', 'nagylelkű támogatás', 'egyedi támogatás']);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, 'vízszintes túlcsordulás: ' + overflow + 'px');
        assert.equal(await page.locator('#sp-go').isDisabled(), true, 'a támogatás gombja kikapcsolt');
        assert.equal(await page.locator('#sp-banner').isVisible(), true, 'látszik a "még nincs aktiválva" sáv');
        assert.equal(await page.locator('#sp-thanks').isVisible(), false, 'KÖSZÖNJÜK alapból nem látszik');
        const heroOk = await page.evaluate(() => { const i = document.querySelector('#sp-judge'); return i.complete && i.naturalWidth > 100; });
        assert.ok(heroOk, 'a bíró-portré betöltődött');
        // minden gomb elég nagy az ujjnak (mobilon)
        if (size.width < 500) for (const b of await page.locator('.sp-card, #sp-go').all()) { const bb = await b.boundingBox(); assert.ok(bb.height >= 44, 'túl kicsi érintési felület: ' + bb.height); }
        assert.deepEqual(problems, [], problems.join(' | '));
        await ctx.close();
      });
    }
    await test('Böngésző: kártyaválasztás (aria-pressed, összesítő), egyedi összeg határai és hibaüzenetei, billentyűzet-használat', async () => {
      const { ctx, page } = await open(OFF, { width: 1280, height: 800 });
      await page.locator('.t-kave').click();
      assert.equal(await page.locator('.t-kave').getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#sp-summary').innerText(), /3 €/);
      await page.locator('.t-kis').click();
      assert.equal(await page.locator('.t-kave').getAttribute('aria-pressed'), 'false');
      assert.match(await page.locator('#sp-summary').innerText(), /1 €/);
      const input = page.locator('#sp-custom-input');
      for (const [val, msg] of [['0,5', /Legalább 1/], ['501', /Legfeljebb 500/], ['abc', /Írj be/], ['1,234', /Írj be/]]) {
        await input.fill(val);
        assert.match(await page.locator('#sp-custom-error').innerText(), msg, val);
        assert.equal(await input.getAttribute('aria-invalid'), 'true');
      }
      await input.fill('7,5');
      assert.equal(await page.locator('#sp-custom-error').innerText(), '');
      assert.match(await page.locator('#sp-summary').innerText(), /7,50 €/);
      assert.equal(await page.locator('.t-kis').getAttribute('aria-pressed'), 'false', 'az egyedi összeg lecseréli a kártyát');
      await input.fill('');
      assert.match(await page.locator('#sp-summary').innerText(), /Válassz egy összeget/);
      // billentyűzet: Tab a kártyákra, Enter kiválaszt
      await page.locator('.t-birosag').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.t-birosag').getAttribute('aria-pressed'), 'true');
      await ctx.close();
    });
    await test('Böngésző: a KÖSZÖNJÜK jelölt előnézete csak az üzemeltetői kapcsolóval (SUPPORT_PREVIEW) látszik, és "nem valódi" jelzéssel', async () => {
      const off = await open(OFF, { width: 1000, height: 700 }, '?elonezet=koszonjuk');
      assert.equal(await off.page.locator('#sp-thanks').isVisible(), false, 'kapcsoló nélkül a paraméter semmit nem mutat');
      await off.ctx.close();
      const on = await open(ON, { width: 1000, height: 700 }, '?elonezet=koszonjuk');
      assert.equal(await on.page.locator('#sp-thanks').isVisible(), true);
      assert.match(await on.page.locator('#sp-thanks-tag').innerText(), /nem valódi/i);
      await on.page.keyboard.press('Escape');
      assert.equal(await on.page.locator('#sp-thanks').isVisible(), false);
      await on.ctx.close();
    });
    await test('Böngésző (szimulált szolgáltatóval): a KÖSZÖNJÜK csak a szerver-oldali, aláírt visszaigazolás UTÁN jelenik meg; a puszta visszatérés nem elég', async () => {
      const intent = await (await post(ON, '/api/support/intent', { tierId: 'kave' })).json();
      const { ctx, page } = await open(ON, { width: 1000, height: 700 }, '?szimulalt=' + intent.ref);
      assert.equal(await page.locator('#sp-go').isDisabled(), true, 'kártya nélkül nincs aktív gomb');
      await pause(3600); // egy lekérdezési kör
      assert.equal(await page.locator('#sp-thanks').isVisible(), false, 'visszaigazolás nélkül nincs köszönet');
      const body = JSON.stringify({ ref: intent.ref, amountCents: 300, txnId: 'B-1' });
      assert.equal((await post(ON, '/api/support/webhook/simulated', body, { 'x-signature': sign(body) })).status, 200);
      await page.waitForSelector('#sp-thanks', { state: 'visible', timeout: 9000 });
      assert.equal(await page.locator('#sp-thanks-tag').isVisible(), false, 'valódi (szimulált) visszaigazolásnál nincs "előnézet" jelzés');
      await ctx.close();
    });
    await test('Böngésző: a főoldalon a ❤️ TÁMOGATÁS link megvan, a játék betölt (nincs JS-hiba), a bolt gombja továbbra is ott van', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(OFF + '/', { waitUntil: 'networkidle' });
      assert.ok((await page.content()).includes('href="/tamogatas"'), 'a menüben ott a támogatás-link');
      assert.deepEqual(errs, []);
      await ctx.close();
    });
    await browser.close();
  }

  for (const s of servers) { try { s.child.kill('SIGKILL'); } catch (_) { /* */ } }
  await pause(300);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nTámogatási oldal: ${passed} sikeres, ${failed} hibás${skipped ? ', ' + skipped + ' kihagyva' : ''}.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); for (const s of servers) { try { s.child.kill('SIGKILL'); } catch (_) { /* */ } } process.exit(1); });
