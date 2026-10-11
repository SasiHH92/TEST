'use strict';
// ============================================================
// KAMU BÍRÓSÁG – "Támogasd a Kamu Bíróságot!" oldal (Ko-fi)
//  - a támogatás TELJES EGÉSZÉBEN a Ko-fi oldalán történik: a fő gomb egy külső link (új lap, noopener noreferrer),
//  - a weboldalon NINCS fizetési logika, űrlap, kártyaadat-mező, visszaigazolás / "köszönjük" képernyő, szerver-végpont,
//  - tájékoztató összegek (1 / 5 / 10 € / egyedi), önkéntességi szöveg, "mire fordítjuk" szekció megvan,
//  - a régi bolt és útvonalak sértetlenek; mobil / tablet / asztali elrendezés; billentyűzet; új lap megnyitása.
// Nem történik valódi kapcsolat a Ko-fi-vel és nem történik pénzügyi tranzakció: a külső címet a teszt elfogja.
// Futtatás: node test/support.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* böngésző nélkül a böngészős rész kimarad */ }

const root = path.resolve(__dirname, '..');
const KOFI = 'https://ko-fi.com/kamubirosag';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-support-'));
const f = (n) => path.join(tmp, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0, skipped = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}
let child = null;
async function start(port) {
  const base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AUTH_BASE_URL: base, DISCORD_BOT_TOKEN: '',
      AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('st.json'), KB_COURTS_FILE: f('c.json'),
      KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return base; } catch (_) { await pause(100); } }
  throw new Error('a szerver nem indult el');
}

(async () => {
  const BASE = await start(3201);

  await test('Az oldal és a stíluslap / szkript kiszolgálva; a régi útvonalak sértetlenek (/shop, /bolt átirányít; a bolt API védett)', async () => {
    for (const p of ['/tamogatas', '/tamogatas/', '/support', '/support.css', '/support.js']) assert.equal((await fetch(BASE + p)).status, 200, p);
    const red = await fetch(BASE + '/shop', { redirect: 'manual' });
    assert.equal(red.status, 302); assert.equal(red.headers.get('location'), '/');
    assert.equal((await fetch(BASE + '/bolt', { redirect: 'manual' })).status, 302);
    assert.equal((await fetch(BASE + '/api/shop/state')).status, 401, 'a pogácsa-bolt API változatlanul védett');
    assert.equal((await fetch(BASE + '/api/auth/status')).status, 200);
  });

  await test('Tartalom: főcím, alcím, önkéntességi szöveg, tájékoztató összegek (1 / 5 / 10 € / egyedi), "Mire fordítjuk" 3 kártya; nincs 3 €-os kártya', async () => {
    const html = await (await fetch(BASE + '/tamogatas')).text();
    for (const need of ['TÁMOGASD A KAMU BÍRÓSÁGOT!', 'A tárgyalás ingyenes, de a fejlesztő kávéja nem!', 'A támogatás teljesen önkéntes.', 'Nem jár érte játékbeli előny, prémium funkció vagy más ellenszolgáltatás',
      'Játékfejlesztés', 'Új funkciók, karakterek és játékmódok.', 'Szerverfenntartás', 'A Kamu Bíróság működtetésének költségei.', 'Grafikai fejlesztések', 'Új animációk, karakterek és vizuális elemek.',
      'Mire fordítjuk a támogatásokat?', '>1 €<', '>5 €<', '>10 €<', 'legalább 1 €']) assert.ok(html.includes(need), 'hiányzik: ' + need);
    assert.ok(!html.includes('>3 €<'), 'a 3 €-os kártya nem szerepel (a Ko-fi-n nincs ilyen összeg)');
    assert.ok(!/kizárólag ezekre fordítjuk/i.test(html), 'nem állítjuk, hogy kizárólag ezekre fordítjuk');
  });

  await test('Ko-fi link: pontosan https://ko-fi.com/kamubirosag, target=_blank, rel=noopener noreferrer; ez az egyetlen külső hivatkozás; nincs űrlap / beviteli mező / kártya-mező / külső szkript, betűtípus, követő', async () => {
    const html = await (await fetch(BASE + '/tamogatas')).text();
    const m = /<a[^>]*id="fo-gomb"[^>]*>/.exec(html);
    assert.ok(m, 'a fő gomb megvan');
    assert.ok(m[0].includes('href="' + KOFI + '"'));
    assert.ok(m[0].includes('target="_blank"'));
    assert.match(m[0], /rel="noopener noreferrer"/);
    const ext = [...html.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)"/g)].map((x) => x[1]);
    assert.deepEqual([...new Set(ext)], [KOFI], 'egyetlen külső cím: a Ko-fi oldal; kapott: ' + ext.join(', '));
    assert.ok(!/<(form|input|textarea|select|iframe)\b/i.test(html), 'nincs űrlap / beviteli mező / keret');
    assert.ok(!/<button\b/i.test(html), 'nincs gomb: nincs fizetési interakció (csak a link)');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html), 'nincs inline szkript (CSP)');
    assert.ok(!/fonts\.googleapis|google-analytics|googletagmanager|facebook|ko-fi\.com\/cdn|storage\.ko-fi/i.test(html), 'nincs külső betűtípus / követő / Ko-fi widget-szkript');
    const js = fs.readFileSync(path.join(root, 'public', 'support.js'), 'utf8');
    assert.ok(!/fetch\(|XMLHttpRequest|localStorage|cookie|\/api\//.test(js), 'a kliens szkript nem hív szervert és nem tárol semmit');
  });

  await test('Elavult / hibás támogatási komponensek eltávolítva: nincs support.js a szerveren, nincs /api/support végpont, nincs "KÖSZÖNJÜK" képernyő, összegválasztó, egyedi-összeg mező', async () => {
    assert.equal(fs.existsSync(path.join(root, 'support.js')), false, 'a szerver-oldali támogatási modul törölve');
    for (const p of ['/api/support/config', '/api/support/intent', '/api/support/verify?ref=' + 'a'.repeat(32)]) {
      const r = await fetch(BASE + p, { method: p.includes('intent') ? 'POST' : 'GET' });
      assert.ok([404].includes(r.status) || r.headers.get('content-type') !== 'application/json', p + ': ' + r.status);
      assert.notEqual(r.status, 200, p + ' nem élhet');
    }
    assert.equal((await fetch(BASE + '/api/support/webhook/kofi', { method: 'POST', body: '{}' })).status, 404, 'nincs webhook');
    const all = (await (await fetch(BASE + '/tamogatas')).text()) + fs.readFileSync(path.join(root, 'public', 'support.css'), 'utf8') + fs.readFileSync(path.join(root, 'public', 'support.js'), 'utf8');
    for (const old of ['sp-thanks', 'KÖSZÖNJÜK', 'sp-custom-input', 'sp-go" disabled', 'szimulalt', 'elonezet', 'verify']) assert.ok(!all.includes(old), 'maradt belőle: ' + old);
  });

  await test('Nincs hamis visszaigazolás és nincs ígéret ellenszolgáltatásra: a szöveg nem állítja, hogy valaki támogatott; nincs VIP / rang / skin ígéret', async () => {
    const html = (await (await fetch(BASE + '/tamogatas')).text()).replace(/<[^>]+>/g, ' ');
    assert.ok(!/köszönjük, hogy támogattál|sikeres támogatás|támogatásod megérkezett/i.test(html));
    assert.ok(!/(kapsz|jár)\s+(vip|prémium|skin|rang)/i.test(html.replace('Nem jár érte', '')));
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
    const open = async (size, extra = {}) => {
      const ctx = await browser.newContext({ viewport: size, locale: 'hu-HU', ...extra });
      // a Ko-fi felé menő kérést elfogjuk: a teszt nem lép kapcsolatba a valódi oldallal
      await ctx.route('https://ko-fi.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>ko-fi (teszt)</title>' }));
      const page = await ctx.newPage();
      const problems = [], requests = [];
      page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/kaspersky/i.test(m.text() + (m.location().url || ''))) problems.push(m.type() + ': ' + m.text()); });
      page.on('request', (r) => { const u = r.url(); if (!/kaspersky|\.kis\.v2\./i.test(u)) requests.push(u); });
      await page.goto(BASE + '/tamogatas', { waitUntil: 'networkidle' });
      return { ctx, page, problems, requests };
    };
    for (const [label, size] of [['telefon 375×812', { width: 375, height: 812 }], ['telefon 430×932', { width: 430, height: 932 }], ['tablet 768×1024', { width: 768, height: 1024 }], ['asztali 1366×768', { width: 1366, height: 768 }], ['kis telefon 320×568', { width: 320, height: 568 }]]) {
      await test(`Böngésző (${label}): nincs vízszintes görgetés; a fő gomb a képernyőn belül marad, elég nagy; nincs hiba; csak saját kérések`, async () => {
        const { ctx, page, problems, requests } = await open(size);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, 'vízszintes túlcsordulás: ' + overflow + 'px');
        const btn = page.locator('#fo-gomb');
        await btn.scrollIntoViewIfNeeded();
        const bb = await btn.boundingBox();
        assert.ok(bb.x >= 0 && bb.x + bb.width <= size.width + 0.5, 'a gomb kicsúszik a képernyőről: ' + JSON.stringify(bb));
        assert.ok(bb.height >= 48, 'túl kicsi érintési felület: ' + bb.height);
        const fs2 = await btn.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        assert.ok(fs2 >= 15, 'olvashatatlanul kicsi gombfelirat');
        assert.equal(await page.locator('.sp-card').count(), 4);
        assert.equal(await page.locator('.sp-use-card').count(), 3);
        assert.equal((await page.locator('.sp-hero h1').innerText()).toUpperCase().includes('TÁMOGASD A KAMU BÍRÓSÁGOT'), true);
        const hero = await page.evaluate(() => { const i = document.querySelector('#sp-judge'); return i.complete && i.naturalWidth > 100; });
        assert.ok(hero, 'a bíró-portré betöltődött');
        assert.deepEqual(problems, [], problems.join(' | '));
        assert.ok(requests.every((u) => u.startsWith(BASE)), 'külső kérés az oldalbetöltéskor: ' + requests.filter((u) => !u.startsWith(BASE)).join(', '));
        assert.ok(!requests.some((u) => u.includes('/api/')), 'az oldal nem hív API-t');
        await ctx.close();
      });
    }
    await test('Böngésző: a gombra kattintva a Ko-fi oldal ÚJ LAPON nyílik meg (noopener), az eredeti oldal nem navigál el', async () => {
      const { ctx, page } = await open({ width: 1280, height: 800 });
      const [popup] = await Promise.all([ctx.waitForEvent('page'), page.locator('#fo-gomb').click()]);
      await popup.waitForLoadState();
      assert.equal(popup.url(), KOFI, 'a Ko-fi oldal nyílt meg');
      assert.equal(await popup.evaluate(() => window.opener), null, 'noopener: az új lap nem éri el az eredetit');
      assert.ok(page.url().endsWith('/tamogatas'), 'az eredeti lap helyben maradt');
      assert.equal(ctx.pages().length, 2);
      await ctx.close();
    });
    await test('Böngésző: billentyűzettel is használható – Tab-bal elérhető látható fókuszjellel, Enterrel megnyitja a Ko-fi oldalt új lapon', async () => {
      const { ctx, page } = await open({ width: 1280, height: 800 });
      // Tab-bal a fő gombig
      let reached = false;
      for (let i = 0; i < 8 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement && document.activeElement.id === 'fo-gomb'); }
      assert.ok(reached, 'a fő gomb Tab-bal elérhető');
      const outline = await page.locator('#fo-gomb').evaluate((el) => { const s = getComputedStyle(el); return s.outlineStyle + ' ' + s.outlineWidth; });
      assert.ok(!/^none/.test(outline), 'látható fókuszjel: ' + outline);
      const [popup] = await Promise.all([ctx.waitForEvent('page'), page.keyboard.press('Enter')]);
      await popup.waitForLoadState();
      assert.equal(popup.url(), KOFI);
      await ctx.close();
    });
    await test('Böngésző: az összeg-kártyák tájékoztatók (nem kattinthatók, nem nyitnak semmit); a képernyőolvasónak a gomb új lapra figyelmeztet', async () => {
      const { ctx, page } = await open({ width: 1280, height: 800 });
      let opened = false; ctx.on('page', () => { opened = true; });
      for (const c of await page.locator('.sp-card').all()) await c.click({ trial: false }).catch(() => {});
      await pause(300);
      assert.equal(opened, false, 'a kártyák nem nyitnak új lapot');
      assert.equal(await page.locator('.sp-card a, .sp-card button').count(), 0);
      assert.match(await page.locator('#fo-gomb').innerText(), /TÁMOGASD A KAMU BÍRÓSÁGOT/);
      assert.match(await page.locator('#fo-gomb .sp-visually-hidden').textContent(), /új lapon/);
      await ctx.close();
    });
    await test('Böngésző: csökkentett mozgás beállításnál nincs animáció; a főoldalon a támogatás-link megvan, a lobbiban új lapon nyílik; a játék betölt hibátlanul', async () => {
      const { ctx, page } = await open({ width: 1000, height: 700 }, { reducedMotion: 'reduce' });
      const anim = await page.locator('#fo-gomb').evaluate((el) => getComputedStyle(el).animationName);
      assert.equal(anim, 'none');
      await ctx.close();
      const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const p2 = await c2.newPage();
      const errs = []; p2.on('pageerror', (e) => errs.push(e.message));
      await p2.goto(BASE + '/', { waitUntil: 'networkidle' });
      const html = await p2.content();
      assert.ok(html.includes('href="/tamogatas"'), 'a menüben ott a támogatás-link');
      assert.match(html, /id="btnSupportLobby"[^>]*target="_blank"[^>]*rel="noopener"/, 'a lobbi-link új lapon nyílik (a szobából nem lép ki)');
      assert.deepEqual(errs, []);
      await c2.close();
    });
    await browser.close();
  }

  try { child.kill('SIGKILL'); } catch (_) { /* */ }
  await pause(300);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nTámogatási oldal: ${passed} sikeres, ${failed} hibás${skipped ? ', ' + skipped + ' kihagyva' : ''}.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); try { child.kill('SIGKILL'); } catch (_) { /* */ } process.exit(1); });
