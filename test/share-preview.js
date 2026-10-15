'use strict';
// ============================================================
// KAMU BÍRÓSÁG – megosztási előnézet (Open Graph) + "Hozzáadás a kezdőképernyőhöz" (manifest, ikonok)
//  A) a főoldal fejléce: leírás, theme-color, og:*, twitter:*, manifest és ikon-hivatkozások; nincs kitöltetlen {{helyőrző}}; az og:image abszolút cím (AUTH_BASE_URL-ből)
//  B) szobalink (/?room=KÓD): szobára szóló cím és URL; érvénytelen kód / támadási próbálkozás nem jut a HTML-be (escape / szigorú ellenőrzés)
//  C) cím-tartalék: AUTH_BASE_URL nélkül a Host fejlécből; hibás Host fejléc nem jut a HTML-be
//  D) az előnézeti kép valódi 1200×630 JPEG (kicsi), az ikonok valódi PNG-k a deklarált méretben
//  E) a manifest érvényes, a típusa application/manifest+json, minden ikonja letölthető, a méretek egyeznek a valódival, van maszkolható ikon; a színek a fejléccel egyeznek
//  F) a főoldal gyorsítótár-fejléce (ETag, 304), a játék elemei változatlanok; böngészőben nincs CSP-sértés / konzolhiba az ikonok és a manifest miatt
// Futtatás: node test/share-preview.js      Böngésző (F): CHROMIUM_PATH / Edge / Chrome; ha nincs: SKIP
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }
const root = path.resolve(__dirname, '..');
const PORT_A = 3234, PORT_B = 3235;
const FAKE_ORIGIN = 'https://kamubirosag.example';
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + (e && e.stack || e)); }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// egyetlen kérés, tetszőleges fejlécekkel (a fetch nem engedi a Host felülírását)
const get = (port, urlPath, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', headers: { Connection: 'close', ...headers } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject); req.end();
});
const text = (r) => r.body.toString('utf8');
const meta = (html, attr, name) => { const m = new RegExp('<meta[^>]*' + attr + '="' + name + '"[^>]*content="([^"]*)"').exec(html); return m ? m[1] : null; };
const link = (html, rel) => [...html.matchAll(/<link[^>]*rel="([^"]+)"[^>]*>/g)].filter((m) => m[1] === rel).map((m) => m[0]);

function jpegSize(buf) {
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8, 'JPEG kezdőjel');
  let i = 2;
  while (i < buf.length) {
    assert.equal(buf[i], 0xff, 'JPEG jelölő'); const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('nincs SOF jelölő');
}
function pngSize(buf) {
  assert.equal(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG fejléc'); assert.equal(buf.slice(12, 16).toString(), 'IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-share-')), f = (x) => path.join(tmp, x);
  const start = (port, extraEnv) => spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', DATABASE_URL: '',
    AUTH_STORE_PATH: f(port + 'a.json'), KB_STATS_FILE: f(port + 's.json'), KB_AVATARS_FILE: f(port + 'v.json'), KB_COURTS_FILE: f(port + 'c.json'), KB_DMS_FILE: f(port + 'd.json'),
    KB_MODERATION_FILE: f(port + 'm.json'), KB_ERRORS_FILE: f(port + 'e.json'), KB_BUGREPORTS_FILE: f(port + 'b.json'), ...extraEnv } });
  const withOrigin = start(PORT_A, { AUTH_BASE_URL: FAKE_ORIGIN });
  const noOrigin = start(PORT_B, { AUTH_BASE_URL: '' });
  const up = async (port) => { for (let i = 0; i < 80; i++) { try { if ((await get(port, '/health')).status === 200) return; } catch (_) { await pause(100); } } throw new Error('a szerver nem indult: ' + port); };
  try {
    await up(PORT_A); await up(PORT_B);

    await test('A) a főoldal fejléce: leírás, theme-color, og:*, twitter:*, manifest, ikonok; az og:image abszolút cím; nincs kitöltetlen helyőrző', async () => {
      const html = text(await get(PORT_A, '/'));
      assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'kitöltetlen {{helyőrző}} maradt');
      const desc = meta(html, 'name', 'description'); assert.ok(desc && desc.length > 40 && desc.length < 200, 'leírás: ' + desc);
      assert.equal(meta(html, 'name', 'theme-color'), '#2a0b14');
      assert.equal(meta(html, 'property', 'og:type'), 'website'); assert.equal(meta(html, 'property', 'og:site_name'), 'Kamu Bíróság'); assert.equal(meta(html, 'property', 'og:locale'), 'hu_HU');
      assert.match(meta(html, 'property', 'og:title'), /Kamu Bíróság/); assert.equal(meta(html, 'property', 'og:description'), desc, 'az og:description a leírás');
      assert.equal(meta(html, 'property', 'og:url'), FAKE_ORIGIN + '/');
      assert.equal(meta(html, 'property', 'og:image'), FAKE_ORIGIN + '/assets/og-image.jpg?v=1', 'abszolút kép-cím');
      assert.equal(meta(html, 'property', 'og:image:width'), '1200'); assert.equal(meta(html, 'property', 'og:image:height'), '630'); assert.ok(meta(html, 'property', 'og:image:alt'));
      assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image'); assert.equal(meta(html, 'name', 'twitter:image'), FAKE_ORIGIN + '/assets/og-image.jpg?v=1');
      assert.equal(meta(html, 'name', 'twitter:title'), meta(html, 'property', 'og:title'));
      assert.ok(/<link[^>]*rel="manifest"[^>]*href="\/manifest\.webmanifest"/.test(html), 'manifest-hivatkozás');
      assert.ok(/<link[^>]*rel="icon"[^>]*href="\/assets\/icons\/favicon-32\.png"/.test(html), 'favicon'); assert.ok(/<link[^>]*rel="apple-touch-icon"[^>]*href="\/assets\/icons\/apple-touch-icon\.png"/.test(html), 'apple-touch-icon');
      assert.equal(meta(html, 'name', 'apple-mobile-web-app-capable'), 'yes'); assert.equal(link(html, 'icon').length, 1, 'egyetlen favicon-hivatkozás (nincs beágyazott emoji-ikon)');
      assert.equal((await get(PORT_A, '/index.html')).status, 200);
    });

    await test('B) szobalink: szobára szóló cím és URL; érvénytelen kód / támadási próbálkozás nem jut a HTML-be', async () => {
      const html = text(await get(PORT_A, '/?room=kra7'));
      assert.match(meta(html, 'property', 'og:title'), /KRA7/); assert.match(meta(html, 'property', 'og:description'), /KRA7/);
      assert.equal(meta(html, 'property', 'og:url'), FAKE_ORIGIN + '/?room=KRA7'); assert.equal(meta(html, 'name', 'twitter:title'), meta(html, 'property', 'og:title'));
      const base = text(await get(PORT_A, '/')), generic = meta(base, 'property', 'og:title');
      for (const bad of ['ab', 'abcde', 'KR%20A7', '%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E', '%3Cb%3E', 'a%26b%22c', '', '%00%00%00%00']) {
        const r = text(await get(PORT_A, '/?room=' + bad));
        assert.equal(meta(r, 'property', 'og:title'), generic, 'érvénytelen kód (' + bad + '): általános cím');
        assert.ok(!/<script>alert/.test(r), 'beinjektált tartalom: ' + bad); assert.equal(r, base, 'érvénytelen kódnál a válasz azonos az általános oldallal: ' + bad);
      }
      const arr = text(await get(PORT_A, '/?room[]=KRA7&room[]=ABCD')); assert.equal(meta(arr, 'property', 'og:title'), generic, 'tömb-paraméter: általános cím');
      assert.equal(meta(text(await get(PORT_A, '/?room=KRA7&x=1')), 'property', 'og:url'), FAKE_ORIGIN + '/?room=KRA7', 'extra paraméter nem kerül az URL-be');
    });

    await test('C) cím-tartalék: AUTH_BASE_URL nélkül a Host fejlécből; hibás Host fejléc nem jut a HTML-be', async () => {
      const html = text(await get(PORT_B, '/'));
      assert.equal(meta(html, 'property', 'og:image'), 'http://127.0.0.1:' + PORT_B + '/assets/og-image.jpg?v=1'); assert.equal(meta(html, 'property', 'og:url'), 'http://127.0.0.1:' + PORT_B + '/');
      const evil = text(await get(PORT_B, '/', { Host: 'evil"><script>alert(1)</script>' }));
      assert.ok(!/<script>alert/.test(evil) && !evil.includes('evil'), 'a hibás Host nem kerülhet a HTML-be');
      assert.equal(meta(evil, 'property', 'og:image'), '/assets/og-image.jpg?v=1', 'ellenőrizhetetlen cím esetén relatív tartalék');
      assert.ok(!/\{\{[A-Z_]+\}\}/.test(evil));
    });

    await test('D) az előnézeti kép valódi 1200×630 JPEG (kicsi); az ikonok valódi PNG-k a deklarált méretben', async () => {
      const og = await get(PORT_A, '/assets/og-image.jpg?v=1'); assert.equal(og.status, 200); assert.match(og.headers['content-type'], /image\/jpeg/);
      assert.deepEqual(jpegSize(og.body), { width: 1200, height: 630 }); assert.ok(og.body.length < 250 * 1024 && og.body.length > 20 * 1024, 'méret: ' + og.body.length);
      const expect = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180, 'favicon-32.png': 32 };
      for (const [file, size] of Object.entries(expect)) {
        const r = await get(PORT_A, '/assets/icons/' + file); assert.equal(r.status, 200, file); assert.match(r.headers['content-type'], /image\/png/);
        assert.deepEqual(pngSize(r.body), { width: size, height: size }, file); assert.ok(r.body.length < 300 * 1024, file + ' mérete');
      }
    });

    await test('E) a manifest érvényes (application/manifest+json), az ikonok letölthetők és a méretük egyezik, van maszkolható ikon, a színek egyeznek a fejléccel', async () => {
      const r = await get(PORT_A, '/manifest.webmanifest'); assert.equal(r.status, 200); assert.match(r.headers['content-type'], /application\/manifest\+json/);
      const m = JSON.parse(text(r));
      assert.equal(m.name, 'Kamu Bíróság'); assert.ok(m.short_name && m.short_name.length <= 14, 'rövid név'); assert.equal(m.lang, 'hu'); assert.equal(m.start_url, '/'); assert.equal(m.scope, '/'); assert.equal(m.display, 'standalone');
      const head = text(await get(PORT_A, '/')); assert.equal(m.theme_color, meta(head, 'name', 'theme-color')); assert.equal(m.background_color, '#2a0b14');
      assert.ok(Array.isArray(m.icons) && m.icons.length >= 3);
      for (const ic of m.icons) {
        assert.ok(ic.src.startsWith('/'), 'helyi ikon'); const png = await get(PORT_A, ic.src); assert.equal(png.status, 200, ic.src);
        const real = pngSize(png.body); assert.equal(ic.sizes, real.width + 'x' + real.height, ic.src + ': deklarált és valódi méret'); assert.equal(ic.type, 'image/png'); assert.ok(['any', 'maskable'].includes(ic.purpose), 'purpose: ' + ic.purpose);
      }
      const sizes = (purpose) => m.icons.filter((i) => i.purpose === purpose).map((i) => i.sizes);
      assert.ok(sizes('any').includes('192x192') && sizes('any').includes('512x512'), '192 és 512 px "any" ikon'); assert.ok(sizes('maskable').includes('512x512'), 'maszkolható 512 px ikon');
    });

    await test('F) a főoldal ETag-et ad (304 változatlanul), a játék elemei megvannak, a nem-főoldali útvonalak nem változtak', async () => {
      const first = await get(PORT_A, '/'); assert.equal(first.status, 200); assert.ok(first.headers.etag, 'ETag'); assert.match(first.headers['cache-control'], /no-cache/);
      assert.equal((await get(PORT_A, '/', { 'If-None-Match': first.headers.etag })).status, 304);
      const html = text(first); for (const id of ['authGuest', 'btnJoin', 'btnHowTo', 'mugGrid', 'bugFab'.replace('bugFab', 'screen-lobby')]) assert.ok(html.includes('id="' + id + '"'), id + ' hiányzik');
      assert.equal((await get(PORT_A, '/style.css')).status, 200); assert.equal((await get(PORT_A, '/help.json')).status, 200); assert.equal((await get(PORT_A, '/nincs-ilyen-oldal')).status, 404);
      assert.match(first.headers['content-security-policy'] || '', /default-src 'self'/, 'a biztonsági fejlécek megmaradtak');
    });

    const browser = await (async () => {
      if (!chromium) return null;
      const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
      for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
      return null;
    })();
    if (!browser) console.log('SKIP: F) böngészős ellenőrzés – nincs böngésző');
    else {
      try {
        await test('F) böngészőben: az ikonok és a manifest betöltődnek, nincs CSP-sértés vagy konzolhiba; a játék szokás szerint indul', async () => {
          const page = await browser.newPage(); const problems = [];
          page.on('console', (m) => { if (m.type() === 'error' && !/Google|fonts|net::ERR|favicon\.ico|status of 401|Failed to load resource.*(googleapis|gstatic)/i.test(m.text())) problems.push(m.text()); });
          page.on('pageerror', (e) => problems.push(String(e.message || e)));
          try {
            await page.goto('http://127.0.0.1:' + PORT_B + '/?room=KRA7', { waitUntil: 'load' }); await pause(800);
            const res = await page.evaluate(async () => {
              const m = document.querySelector('link[rel=manifest]'), man = await (await fetch(m.href)).json();
              const icon = document.querySelector('link[rel=icon]'), img = new Image();
              await new Promise((ok) => { img.onload = ok; img.onerror = ok; img.src = icon.href; });
              return { title: document.querySelector('meta[property="og:title"]').content, manifestName: man.name, iconOk: img.naturalWidth === 32, screen: document.body.dataset.screen || 'auth', guest: !!document.getElementById('authGuest') };
            });
            assert.match(res.title, /KRA7/); assert.equal(res.manifestName, 'Kamu Bíróság'); assert.equal(res.iconOk, true, 'a favicon betöltődik'); assert.equal(res.guest, true);
            assert.deepEqual(problems, [], 'konzolhiba / CSP-sértés: ' + problems.join(' | '));
          } finally { await page.close(); }
        });
      } finally { await browser.close(); }
    }
  } finally {
    withOrigin.kill(); noOrigin.kill();
    console.log('\nMegosztási előnézet és telepíthetőség: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
    process.exitCode = failed ? 1 : 0;
  }
})();
