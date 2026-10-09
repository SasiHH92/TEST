'use strict';
// ============================================================
// KAMU BÍRÓSÁG – FILMES JÁTÉKÉLMÉNY / ANIMÁCIÓS RÉTEG, valódi böngészőben (Playwright) + a szerver /api/media végpontja
//
//  A) /api/media (böngésző nélkül): üres mappák → üres lista; csak a szabályos nevű / kiterjesztésű fájlok szerepelnek; a dokumentáció (assets/audio, assets/video) lefedi a hook-neveket
//  B) bejelentkező videó-háttér: nincs fájl → nincs <video>; nem elérhető fájl → leesik statikus háttérre; elérhető videó → lejátszódik, a belépőoldal elhagyásakor eltűnik;
//     csökkentett mozgás / keskeny képernyő mobil-fájl nélkül → nincs videó, nincs kérés
//  C) lobbi: belépő-animáció, kimásolható szobakód
//  D) szerep-felfedés (valódi játékindításnál): megjelenik a saját szereppel és képpel, 2–3,4 mp, utána a kör-intro jön; mind a 6 szerep; Esc kihagyja; újratöltéskor nem ismétlődik
//  E) fázis-stinger (megjelenik / nem blokkol / újratöltéskor és nagy overlay alatt kimarad), kihívás-eredmény (✓ SIKERÜLT / ✕ NEM SIKERÜLT)
//  F) ítélet: várakozás → kalapács → BŰNÖS! / ÁRTATLAN!, sorrend és időzítés, egyszer; kör-összegző (count-up, vezető); játék vége (pódium, győztes, gombok, takarítás)
//  G) reakciók a küldő fölött (határ: 2 / játékos, 14 összesen, takarítás), idle-mozgás (eltérő fázis, kicsi amplitúdó), kártya-animációk
//  H) hang-architektúra: fájl az szintetizált hang elé kerül, némítás mindenre érvényes, minden hook kategóriába tartozik és dokumentált
//  I) csökkentett mozgás: nincs animáció / rázkódás / részecske, de minden információ látszik
//  J) szivárgás: ismételt ciklusok után nem nő az eseményfigyelők, időzítők, DOM-csomópontok száma
//  K) reszponzív: 1920×1080, 1366×768, 1024×768, 390×844 – a rétegek elférnek, a cím nem csúszik a felső sáv alá, nincs vízszintes görgetés, nincs JS-hiba
//
// Futtatás:  npm run test:cinema     Böngésző: CHROMIUM_PATH / Edge / Chrome / Playwright Chromium; ha nincs: SKIP (CINEMA_REQUIRE=1 esetén hiba)
// Képernyőképek: CINEMA_SHOTS=./QA_SCREENSHOTS
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.CINEMA_PORT || 3191), PORT2 = PORT + 1, PORT3 = PORT + 2;
const BASE = 'http://127.0.0.1:' + PORT, BASE2 = 'http://127.0.0.1:' + PORT2, BASE3 = 'http://127.0.0.1:' + PORT3;
const REQUIRE = process.env.CINEMA_REQUIRE === '1';
const SHOTS = process.env.CINEMA_SHOTS ? path.resolve(process.env.CINEMA_SHOTS) : '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-cinema-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0, skipped = 0;
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}
const skip = (name, why) => { skipped++; console.log('SKIP: ' + name + ' – ' + why); };
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky|net::ERR|the server responded with a status of 404/i;
const ROLES = ['judge', 'prosecutor', 'defendant', 'defender', 'witness', 'juror'];
const WORD = { judge: 'BÍRÓ', prosecutor: 'ÜGYÉSZ', defendant: 'VÁDLOTT', defender: 'VÉDŐÜGYVÉD', witness: 'TANÚ', juror: 'ESKÜDT' };
const MAP = { judge: 'av06', prosecutor: 'av04', defendant: 'av05', defender: 'av01', witness: 'av07', jurors: ['av02', 'av03', 'av22', 'av21'] };

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) { try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ } }
  return null;
}
function startServer(port, extra = {}) {
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(port), HOST: '127.0.0.1',
    AUTH_BASE_URL: base, DATABASE_URL: '', MAX_ROOMS_PER_IP: '80', AUTH_STORE_PATH: path.join(tmp, 'a' + port + '.json'), KB_AVATARS_FILE: path.join(tmp, 'av' + port + '.json'),
    KB_STATS_FILE: path.join(tmp, 's' + port + '.json'), KB_DMS_FILE: path.join(tmp, 'd' + port + '.json'), KB_ERRORS_FILE: path.join(tmp, 'e' + port + '.json'), ...extra } });
  return (async () => {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return child; } catch (_) { await pause(100); } }
    child.kill();
    throw new Error('a szerver nem indult el (' + port + ')');
  })();
}
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'cinema_' + name + '.png') }); };

// ---- böngésző-oldal: új oldal figyelt hibákkal ----
async function newPage(browser, viewport, opts = {}) {
  const mobile = viewport.width < 700 || viewport.height < 500;
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'hu-HU', reducedMotion: opts.reduced ? 'reduce' : 'no-preference', permissions: opts.permissions || [] });
  await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('request', (r) => requests.push(r.url()));
  return { context, page, errors, requests, mobile };
}

// ---- játék indítása egy vendéggel + botokkal; a "game" képernyőig (a szerep-felfedés közben); a felfedés figyelője már a lobbiban él ----
async function startGame(browser, viewport, opts = {}) {
  const ctx = await newPage(browser, viewport, opts);
  const { page } = ctx;
  await page.goto((opts.base || BASE) + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#authGuest'); await page.click('#authGuest');
  await page.waitForFunction(() => document.body.dataset.screen === 'name');
  await page.evaluate(() => document.getElementById('btnNewSuspect').click());
  await page.fill('#guestName', 'Mozi ' + viewport.width);
  await page.evaluate(() => document.getElementById('btnGuestGo').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'menu');
  await page.evaluate(() => document.getElementById('btnCreate').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
  // figyelők: belépő-animáció a plakátokon, szerep-felfedés időtartama / tartalma
  await page.evaluate(() => {
    window.__penter = 0;
    new MutationObserver((ms) => ms.forEach((x) => { if (x.target.classList && x.target.classList.contains('p-enter')) window.__penter++; })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    window.__rv = { start: 0, end: 0, title: '', kicker: '', src: '', role: '', avatar: '', cls: '', majors: [] };
    setInterval(() => {
      const now = performance.now();
      const a = window.kbCourt && window.kbCourt.getState().revealActive;
      if (a && !window.__rv.start) {
        window.__rv.start = now; window.__rv.role = myRole(); window.__rv.avatar = (me() || {}).avatar || '';
        const el = document.getElementById('courtReveal');
        window.__rv.title = (el.querySelector('.rv-title') || {}).textContent || ''; window.__rv.kicker = (el.querySelector('.rv-kicker') || {}).textContent || '';
        const img = el.querySelector('.rv-sprite, .rv-portrait img'); window.__rv.src = img ? img.getAttribute('src') : ''; window.__rv.cls = el.className;
      }
      if (!a && window.__rv.start && !window.__rv.end) window.__rv.end = now;
      const m = document.body.dataset.courtMajor; if (m && window.__rv.majors[window.__rv.majors.length - 1] !== m) window.__rv.majors.push(m);
    }, 20);
  });
  for (let i = 0; i < (opts.bots || 7); i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(200); }
  ctx.lobby = await page.evaluate(() => {
    const code = document.querySelector('.code-badge.copyable');
    return { penter: window.__penter, posters: document.querySelectorAll('#pinWall .poster').length, code: code ? code.textContent.trim() : '', myCode: MY.code };
  });
  await page.evaluate(() => {
    document.getElementById('btnCustomGame').click();
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('setSpeech', 15); set('setDefender', 15); set('setPrep', 90); set('setWitness', 10); set('setClosing', 10); set('setRounds', 1);
    const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
    document.getElementById('btnSaveSettings').click();
  });
  await page.waitForFunction(() => S.settings.prepSeconds === 90, null, { timeout: 6000 });
  if (opts.beforeStart) await opts.beforeStart(ctx);
  await page.evaluate(() => document.getElementById('btnStartGame').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
  return ctx;
}
// a szerver állapotát a kliensben befagyasztjuk, és a következő szintetikus állapotokat a valódi kliens-úton (kbCourt.update / renderGame) játsszuk le
const freeze = (page) => page.evaluate(() => { KICKED_FROM_ROOM = true; kbCourt.reset(); });
const snapWith = (page, patch) => page.evaluate((p) => { const s = courtSnapshot(); Object.assign(s, p); kbCourt.update(s); }, patch);
const hasMajor = (page) => page.evaluate(() => document.body.dataset.courtMajor || '');
const assign = (page, map) => page.evaluate((m) => {
  KICKED_FROM_ROOM = true;
  const ids = { judge: S.currentJudgeId, prosecutor: S.prosecutorId, defendant: S.defendantId, defender: S.defenderId, witness: S.witnessId };
  const used = new Set(Object.values(ids));
  S.players.forEach((p) => { for (const [r, id] of Object.entries(ids)) if (id === p.id && m[r]) p.avatar = m[r]; });
  let i = 0; S.players.filter((p) => !used.has(p.id)).forEach((p) => { p.avatar = m.jurors[i++ % m.jurors.length]; });
  document.getElementById('stage').dataset.key = ''; renderStage();
}, map);
const settle = async (page) => { await page.waitForFunction(() => [...document.querySelectorAll('#stage .st-base')].every((i) => i.complete), null, { timeout: 15000 }); await page.waitForTimeout(700); };

const rectOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; }, sel);
const hudBottom = (page) => page.evaluate(() => { let b = 0; for (const s of ['.info-bar', '#gameHeader', '.game-header']) { const e = document.querySelector(s); if (e && e.getClientRects().length) b = Math.max(b, e.getBoundingClientRect().bottom); } return b; });
const inViewport = (r, what, slack = 2) => { assert.ok(r, what + ': nincs elem'); assert.ok(r.l >= -slack && r.r <= r.vw + slack && r.t >= -slack && r.b <= r.vh + slack, what + ' kilóg a képernyőből: ' + JSON.stringify(r)); };
const textRect = (page, sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight }; }, sel);
const railOf = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('stage')).getPropertyValue('--rail')) || 0);
const noHScroll = async (page, what) => { const o = await page.evaluate(() => ({ d: document.documentElement.scrollWidth, b: document.body.scrollWidth, w: innerWidth })); assert.ok(o.d <= o.w + 1 && o.b <= o.w + 1, what + ': vízszintes görgetés ' + JSON.stringify(o)); };

// =============================== A) /api/media ===============================
async function partMediaApi() {
  const dirV = path.join(tmp, 'media-video'), dirA = path.join(tmp, 'media-audio'), dirV0 = path.join(tmp, 'media-video0'), dirA0 = path.join(tmp, 'media-audio0');
  for (const d of [dirV, dirA, dirV0, dirA0]) fs.mkdirSync(d, { recursive: true });
  for (const f of ['login-loop.webm', 'login-loop-mobile.mp4', 'login-poster.webp', 'Nagy-Betu.webm', 'rossz nev.webm', 'script.js', 'x.exe', '.hidden.webm']) fs.writeFileSync(path.join(dirV, f), 'x');
  for (const f of ['gavel.ogg', 'verdict-guilty.mp3', 'ui-click.wav', 'UPPER.mp3', 'sh.sh', 'a b.mp3']) fs.writeFileSync(path.join(dirA, f), 'x');
  const empty = await startServer(PORT3, { KB_VIDEO_DIR: dirV0, KB_AUDIO_DIR: dirA0 });
  try {
    await check('A1 /api/media üres mappákkal: üres lista, nincs hiba', async () => {
      const res = await fetch(BASE3 + '/api/media'), body = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual(body.video, {}); assert.deepEqual(body.audio, {});
      assert.ok(/no-cache/.test(res.headers.get('cache-control') || ''), 'a lista nem gyorsítótárazható tartósan');
    });
  } finally { empty.kill(); }
  await pause(200);
  const full = await startServer(PORT3, { KB_VIDEO_DIR: dirV, KB_AUDIO_DIR: dirA });
  try {
    await check('A2 /api/media csak a szabályos fájlokat listázza (kisbetű, ismert kiterjesztés), méretekkel', async () => {
      const body = await (await fetch(BASE3 + '/api/media')).json();
      assert.deepEqual(Object.keys(body.video).sort(), ['login-loop-mobile.mp4', 'login-loop.webm', 'login-poster.webp']);
      assert.deepEqual(Object.keys(body.audio).sort(), ['gavel.ogg', 'ui-click.wav', 'verdict-guilty.mp3']);
      assert.equal(body.video['login-loop.webm'], 1);
      assert.ok(typeof body.v === 'string' && body.v.length > 0, 'verzió-azonosító a gyorsítótár-törléshez');
    });
    await check('A3 a hiányzó mappa nem dönti el a szervert (nem létező KB_*_DIR)', async () => {
      const res = await fetch(BASE3 + '/api/media'); assert.equal(res.status, 200);
    });
  } finally { full.kill(); }
  await check('A4 a hangfájl-dokumentáció minden hook-nevet és mind a 10 kategóriát tartalmazza', async () => {
    const readme = fs.readFileSync(path.join(ROOT, 'assets/audio/README.md'), 'utf8');
    const media = fs.readFileSync(path.join(ROOT, 'public/media.js'), 'utf8');
    const client = fs.readFileSync(path.join(ROOT, 'public/client.js'), 'utf8');
    const hooks = [...(client.match(/const SOUND_HOOKS = \{[\s\S]*?\n\};/) || [''])[0].matchAll(/(?:'([a-z-]+)'|\b([a-z]+)):\s*'/g)].map((m) => m[1] || m[2]);
    assert.ok(hooks.length >= 25, 'a SOUND_HOOKS nem olvasható ki (' + hooks.length + ')');
    const missing = hooks.filter((h) => !readme.includes('`' + h + '`'));
    assert.deepEqual(missing, [], 'a README-ből hiányzik: ' + missing.join(', '));
    for (const cat of ['ui', 'card', 'paper', 'challenge', 'reaction', 'stinger', 'gavel', 'verdict', 'score', 'victory']) {
      assert.ok(readme.includes('**' + cat + '**'), 'kategória nincs dokumentálva: ' + cat);
      assert.ok(new RegExp('\\b' + cat + ': \\[').test(media), 'kategória hiányzik a media.js-ből: ' + cat);
    }
    const video = fs.readFileSync(path.join(ROOT, 'assets/video/README.md'), 'utf8');
    for (const f of ['login-loop.webm', 'login-loop.mp4', 'login-loop-mobile', 'login-poster.webp', 'ASSET NEEDED']) assert.ok(video.includes(f), 'assets/video/README.md: ' + f);
  });
}

// =============================== B) bejelentkező videó ===============================
async function recordWebm(browser) {
  const { context, page } = await newPage(browser, { width: 400, height: 300 });
  try {
    await page.goto(BASE + '/health');
    return await page.evaluate(async () => {
      const mime = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      if (!mime) return '';
      const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(20), { mimeType: mime }), chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise((r) => { rec.onstop = r; });
      rec.start(100);
      for (let i = 0; i < 30; i++) { x.fillStyle = 'hsl(' + (i * 12) + ',60%,30%)'; x.fillRect(0, 0, 320, 180); await new Promise((r) => setTimeout(r, 50)); }
      rec.stop(); await done;
      const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
  } finally { await context.close(); }
}
async function partLoginVideo(browser, servers) {
  const goAuth = async (page, base) => { await page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#authGuest'); await page.evaluate(() => window.kbMedia.ready); await page.waitForTimeout(250); };
  const videoReq = (reqs) => reqs.filter((u) => /\/assets\/video\//.test(u)).length;

  await check('B1 nincs videó-fájl: nincs <video>, nincs kérés, a statikus háttér marad', async () => {
    const c = await newPage(browser, { width: 1366, height: 768 });
    try {
      await goAuth(c.page, BASE);
      assert.equal(await c.page.locator('video.auth-video').count(), 0);
      assert.equal(videoReq(c.requests), 0, 'felesleges videó-kérés');
      assert.equal(await c.page.evaluate(() => window.kbMedia.state().video.length), 0);
      assert.equal(await c.page.evaluate(() => document.documentElement.classList.contains('auth-video-on')), false);
      assert.ok(await c.page.locator('.auth-background').count() >= 1, 'statikus háttér');
      assert.deepEqual(c.errors, []);
    } finally { await c.context.close(); }
  });

  await check('B2 a listázott, de nem elérhető videó: a <video> létrejön, a hiba után eltűnik, statikus háttér (auth-video-off)', async () => {
    const c = await newPage(browser, { width: 1366, height: 768 });
    try {
      await goAuth(c.page, BASE2);
      await c.page.waitForFunction(() => document.documentElement.classList.contains('auth-video-off'), null, { timeout: 8000 });
      assert.equal(await c.page.locator('video.auth-video').count(), 0, 'a hibás videó-elem nem maradhat');
      assert.equal(await c.page.evaluate(() => window.kbMedia.loginVideoActive()), false);
      assert.deepEqual(c.errors, []);
    } finally { await c.context.close(); }
  });

  await check('B3 csökkentett mozgás: nincs videó, nincs kérés', async () => {
    const r = await newPage(browser, { width: 1366, height: 768 }, { reduced: true });
    try {
      await goAuth(r.page, BASE2);
      assert.equal(await r.page.locator('video.auth-video').count(), 0);
      assert.equal(videoReq(r.requests), 0);
    } finally { await r.context.close(); }
  });

  await check('B4 keskeny képernyő mobil-fájl nélkül: a nagy asztali videó nem töltődik (nincs kérés)', async () => {
    const c = await newPage(browser, { width: 390, height: 844 });
    try {
      await goAuth(c.page, BASE2);
      assert.equal(await c.page.locator('video.auth-video').count(), 0);
      assert.equal(videoReq(c.requests), 0, 'a telefon nem tölthet nagy videót');
    } finally { await c.context.close(); }
  });

  const b64 = await recordWebm(browser).catch(() => '');
  if (!b64) { skip('B5 elérhető videó lejátszása', 'a böngésző nem tud WebM-et rögzíteni (MediaRecorder) – valódi videó-asset nincs, a teszt-videót is így állítjuk elő'); return; }
  await check('B5 elérhető videó: autoplay + muted + loop + playsinline, "playing" után auth-video-on; a belépőoldal elhagyásakor eltávolítódik', async () => {
    const c = await newPage(browser, { width: 1366, height: 768 });
    try {
      await c.page.route('**/assets/video/login-loop.webm*', (route) => route.fulfill({ status: 200, contentType: 'video/webm', body: Buffer.from(b64, 'base64') }));
      await goAuth(c.page, BASE2);
      await c.page.waitForFunction(() => window.kbMedia.loginVideoActive(), null, { timeout: 9000 });
      const attrs = await c.page.evaluate(() => { const v = document.querySelector('video.auth-video'); const cs = getComputedStyle(v); return { muted: v.muted, loop: v.loop, autoplay: v.autoplay, inline: v.playsInline, fit: cs.objectFit, pos: cs.position, aria: v.getAttribute('aria-hidden'), preload: v.preload, poster: !!v.poster, on: document.documentElement.classList.contains('auth-video-on') }; });
      assert.deepEqual({ ...attrs, poster: undefined }, { muted: true, loop: true, autoplay: true, inline: true, fit: 'cover', pos: attrs.pos, aria: 'true', preload: 'metadata', poster: undefined, on: true });
      assert.ok(attrs.poster, 'poster (állókép) a betöltés idejére');
      await shot(c.page, 'login_video');
      await c.page.click('#authGuest');
      await c.page.waitForFunction(() => document.body.dataset.screen === 'name');
      await c.page.waitForFunction(() => !document.querySelector('video.auth-video'), null, { timeout: 3000 });
      assert.equal(await c.page.evaluate(() => document.documentElement.classList.contains('auth-video-on')), false);
      assert.deepEqual(c.errors, []);
    } finally { await c.context.close(); }
  });
}

// =============================== a fő forgatókönyv (asztali, 1366×768) ===============================
async function partMain(browser) {
  const g = await startGame(browser, { width: 1366, height: 768 }, { permissions: ['clipboard-read', 'clipboard-write'] });
  const { page } = g;
  try {
    // ---- C) lobbi ----
    await check('C1 lobbi: a plakátok belépő-animációt kapnak (p-enter), minden játékos kirakva', async () => {
      assert.ok(g.lobby.penter >= 7, 'belépő-animációk (a figyelő a házigazda után indul): ' + g.lobby.penter);
      assert.ok(g.lobby.posters >= 8, 'plakátok: ' + g.lobby.posters);
    });
    await check('C2 lobbi: a szobakód kimásolható (gombként kezelhető), a kód egyezik', async () => {
      assert.ok(g.lobby.code && g.lobby.code.includes(g.lobby.myCode), 'a kód-jelvény a szobakódot mutatja: ' + g.lobby.code);
    });

    // ---- D) szerep-felfedés (a valódi játékindítás pillanata) ----
    await page.waitForFunction(() => window.__rv.start > 0, null, { timeout: 9000 }).catch(() => {});
    await page.waitForFunction(() => window.__rv.end > 0, null, { timeout: 9000 }).catch(() => {});
    await check('D1 a játék elején megjelenik a szerep-felfedés a SAJÁT szereppel és a saját avatár képével, 2–3,4 mp-ig, majd a kör-intro következik', async () => {
      const rv = await page.evaluate(() => window.__rv);
      assert.ok(rv.start > 0, 'a szerep-felfedés nem jelent meg');
      assert.ok(rv.end > rv.start, 'a szerep-felfedés nem ért véget');
      const ms = rv.end - rv.start;
      assert.ok(ms >= 2000 && ms <= 3400, 'a felfedés hossza ' + Math.round(ms) + ' ms');
      assert.ok(/^TE VAGY (A|AZ)$/.test(rv.kicker.trim()), 'felirat: ' + rv.kicker);
      assert.ok(rv.title.includes(WORD[rv.role]), 'a cím a szerver szerepe (' + rv.role + ') szerint: ' + rv.title);
      assert.ok(rv.cls.includes('role-' + rv.role));
      assert.ok(rv.src, 'a saját kép');
      const art = await page.evaluate((a) => window.kbAvatarRoles.getRoleAvatar(a.avatar, a.role), { avatar: rv.avatar, role: rv.role });
      if (art.kind !== 'generic') assert.equal(rv.src, art.src, 'a saját avatár × szerep képe');
      // a felfedés az ELSŐ nagy felület; ami utána jön (kör-intro, vagy – ha a botok közben már felolvasták a vádat, és az intro elavult – a felkészülés kártyái), sorban követi, nem vele egyszerre
      await page.waitForTimeout(600);
      const majors = await page.evaluate(() => window.__rv.majors);
      assert.equal(majors[0], 'reveal', 'a felfedés az első nagy felület: ' + majors.join(','));
      assert.ok(majors.slice(1).every((m) => m !== 'reveal'), 'a felfedés nem ismétlődik: ' + majors.join(','));
      await shot(page, 'reveal_flow');
    });
    await check('D2 a felfedés után a kör-intro magától folytatódik (nem blokkol), kihagyható Esc-pel', async () => {
      await page.waitForFunction(() => window.kbCourt.getState().major === 'intro' || window.kbCourt.getState().introActive || S.phase !== 'accusation', null, { timeout: 4000 });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.kbCourt.getState().introActive || S.phase !== 'accusation', null, { timeout: 6000 });
    });
    await check('D3 a felfedés a hátralévő időzítőt nem módosítja és nem akadályozza a játékot (a játék tovább lép a felfedés alatt is)', async () => {
      const t = await page.evaluate(() => ({ phase: S.phase, major: window.kbCourt.getState().major }));
      assert.ok(t.phase, 'a játék fázisban van');
    });

    // innentől a szerver állapotát befagyasztjuk, és szintetikus (de a valódi kliens-úton átmenő) állapotokat játszunk le
    await page.waitForFunction(() => S.phase !== 'accusation' || true);
    await freeze(page);
    await assign(page, MAP); await settle(page);

    await check('D4 mind a 6 szerep: helyes felirat (TE VAGY A/AZ …), szerep-szín osztály, a szerep-kép src egyezik a getRoleAvatar-ral', async () => {
      for (const role of ROLES) {
        await freeze(page);
        const info = await page.evaluate(async (r) => {
          const s = courtSnapshot(); s.phase = 'accusation'; s.myRole = r; s.caseNo = 'RV-' + r; kbCourt.update(s);
          await new Promise((res) => setTimeout(res, 900));
          const el = document.getElementById('courtReveal');
          const img = el.querySelector('.rv-sprite, .rv-portrait img');
          return { shown: el.classList.contains('show') && !el.classList.contains('hidden'), kicker: el.querySelector('.rv-kicker').textContent, title: el.querySelector('.rv-title').textContent, cls: el.className,
            src: img ? img.getAttribute('src') : '', art: window.kbAvatarRoles.getRoleAvatar(s.myAvatar, r), major: document.body.dataset.courtMajor, emoji: !!el.querySelector('.rv-emoji') };
        }, role);
        assert.ok(info.shown, role + ': látszik');
        assert.equal(info.major, 'reveal');
        assert.ok(info.title.includes(WORD[role]), role + ': ' + info.title);
        assert.ok(/^TE VAGY (A|AZ)$/.test(info.kicker), role + ': ' + info.kicker);
        assert.ok(info.cls.includes('role-' + role));
        if (info.art.kind === 'generic') assert.ok(info.emoji, role + ': emoji-tartalék'); else assert.equal(info.src, info.art.src, role + ': kép');
      }
    });
    await check('D5 Esc / kattintás azonnal kihagyja a felfedést, a kör-intro utána sorra kerül', async () => {
      await freeze(page);
      await snapWith(page, { phase: 'accusation', myRole: 'prosecutor', caseNo: 'RV-SKIP' });
      await page.waitForFunction(() => window.kbCourt.getState().revealActive, null, { timeout: 2000 });
      assert.ok((await page.evaluate(() => window.kbCourt.getState().queued)).includes('intro'), 'az intro sorban vár');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.kbCourt.getState().revealActive, null, { timeout: 1500 });
      await page.waitForFunction(() => window.kbCourt.getState().major === 'intro', null, { timeout: 2500 });
    });
    await check('D6 újratöltés (ugyanaz a kör / szerep) után a felfedés nem ismétlődik', async () => {
      await freeze(page);
      await snapWith(page, { phase: 'accusation', myRole: 'witness', caseNo: 'RV-ONCE' });
      await page.waitForFunction(() => window.kbCourt.getState().revealActive, null, { timeout: 2000 });
      await freeze(page); // reset = "friss oldal": a memória-állapot elvész, a sessionStorage marad
      await snapWith(page, { phase: 'accusation', myRole: 'witness', caseNo: 'RV-ONCE' });
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(() => window.kbCourt.getState().revealActive), false);
    });

    await check('D7 ha a játék a felfedés alatt továbblép (gyors vád-felolvasás), a kör-intro akkor is lejátszódik (rövidítve), nem avul el', async () => {
      await freeze(page);
      const charge = 'Teszt vád a késői introhoz';
      await snapWith(page, { phase: 'accusation', myRole: 'juror', caseNo: 'RV-LATE', accusationText: charge });
      await page.waitForFunction(() => window.kbCourt.getState().revealActive, null, { timeout: 2000 });
      await snapWith(page, { phase: 'prep', myRole: 'juror', caseNo: 'RV-LATE', accusationText: charge, evidence: null, myChallenge: null });
      await page.waitForFunction(() => window.kbCourt.getState().major === 'intro', null, { timeout: 5000 });
      const first = await page.evaluate(() => ({ text: document.querySelector('#courtIntro').innerText, step2: document.getElementById('courtIntro').classList.contains('step2') }));
      assert.ok(/AZ ÁLLAM/.test(first.text) && first.text.includes(charge.slice(0, 18)), 'az intro a szerver vádját mutatja: ' + first.text);
      assert.equal(first.step2, false, 'az első lépés nem ugrik át azonnal');
      await page.waitForFunction(() => document.getElementById('courtIntro').classList.contains('step2'), null, { timeout: 4000 });
      await page.waitForFunction(() => !window.kbCourt.getState().introActive && !document.body.dataset.courtMajor, null, { timeout: 4000 });
    });

    // ---- E) stinger ----
    await check('E1 fázisváltáskor rövid stinger-sáv (nem nagy overlay): megjelenik, ≤1,6 mp, nem tartja fel a játékot', async () => {
      await freeze(page);
      await snapWith(page, { phase: 'prep', evidence: null, myChallenge: null }); // a véletlen szerep kártyái ne nyissanak nagy felületet
      await snapWith(page, { phase: 'prosecution' });
      await page.waitForFunction(() => document.getElementById('courtStinger').classList.contains('show'), null, { timeout: 800 });
      const txt = await page.evaluate(() => document.querySelector('#courtStinger .cs-text').textContent);
      assert.equal(txt, 'AZ ÜGYÉSZSÉG KÖVETKEZIK');
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('courtStinger')).pointerEvents), 'none', 'a sáv nem fog kattintást');
      assert.equal(await hasMajor(page), '', 'a stinger nem "major" overlay');
      await shot(page, 'stinger');
      const t0 = Date.now();
      await page.waitForFunction(() => !document.getElementById('courtStinger').classList.contains('show'), null, { timeout: 2500 });
      assert.ok(Date.now() - t0 <= 1700, 'a stinger túl hosszú: ' + (Date.now() - t0));
    });
    await check('E2 minden fontos fázisnak van stingere, a szöveg a szerver fázisából jön', async () => {
      const keys = await page.evaluate(() => Object.keys(window.kbCourt.STINGERS));
      for (const k of ['prosecution', 'defense', 'defender', 'witness', 'final_prosecution', 'final_defense', 'verdict_vote', 'challenge_review']) assert.ok(keys.includes(k), k);
    });
    await check('E3 első állapotnál (újratöltés / újracsatlakozás) nincs stinger; nagy overlay alatt kimarad', async () => {
      await freeze(page);
      await snapWith(page, { phase: 'witness' });
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.getElementById('courtStinger').classList.contains('show')), false, 'első állapotnál nincs');
      await snapWith(page, { phase: 'accusation', myRole: 'juror', caseNo: 'ST-1' }); // nagy overlay (szerep-felfedés) látszik
      assert.equal(await hasMajor(page), 'reveal');
      await snapWith(page, { phase: 'final_defense' });
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.getElementById('courtStinger').classList.contains('show')), false, 'major alatt nincs');
    });
    await check('E4 kihívás-eredmény: ✓ SIKERÜLT (tone-ok) és ✕ NEM SIKERÜLT (tone-fail + rázkódás); az első látott állapot nem játszódik le', async () => {
      await freeze(page);
      const review = (judged, done, who) => ({ phase: 'challenge_review', round: 1, caseNo: 'CH-1', challengeReview: { challenges: [{ who, name: 'Bot 7', judged, done, text: 'Teszt kihívás' }], current: 0, total: 1 } });
      await snapWith(page, review(true, true, 'prosecutor')); // az első látott állapot (pl. újratöltés) → nincs eredmény-stinger
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.getElementById('courtStinger').classList.contains('show')), false, 'újratöltés után nincs ismétlés');
      await freeze(page);
      await snapWith(page, review(false, false, 'prosecutor'));
      await page.waitForFunction(() => !document.body.dataset.courtMajor, null, { timeout: 5000 }); // a kihívás-kártya lejár
      await snapWith(page, review(true, true, 'prosecutor'));
      await page.waitForFunction(() => document.getElementById('courtStinger').classList.contains('show'), null, { timeout: 800 });
      const ok = await page.evaluate(() => ({ text: document.querySelector('#courtStinger .cs-text').textContent, tone: !!document.querySelector('#courtStinger .tone-ok'), icon: document.querySelector('#courtStinger .cs-icon').textContent }));
      assert.deepEqual(ok, { text: 'SIKERÜLT', tone: true, icon: '✓' });
      await shot(page, 'challenge_ok');
      await page.waitForFunction(() => !document.getElementById('courtStinger').classList.contains('show'), null, { timeout: 2500 });
      await snapWith(page, { phase: 'challenge_review', caseNo: 'CH-1', challengeReview: { challenges: [{ who: 'prosecutor', name: 'Bot 7', judged: true, done: true, text: 'x' }, { who: 'defendant', name: 'Bot 8', judged: true, done: false, text: 'y' }], current: 1, total: 2 } });
      await page.waitForFunction(() => document.getElementById('courtStinger').classList.contains('show'), null, { timeout: 800 });
      const fail = await page.evaluate(() => ({ text: document.querySelector('#courtStinger .cs-text').textContent, tone: !!document.querySelector('#courtStinger .tone-fail'), shake: document.getElementById('stage').classList.contains('court-shake') }));
      assert.equal(fail.text, 'NEM SIKERÜLT'); assert.ok(fail.tone); assert.ok(fail.shake, 'a színpad megrázkódik');
      await shot(page, 'challenge_fail');
    });

    // ---- F) ítélet ----
    await check('F1 ítélet BŰNÖS: várakozás (elsötétülés, bíró-fókusz) → kalapács-ütés → BŰNÖS! + pecsét; egyszer, a megadott sorrendben', async () => {
      await freeze(page);
      const rec = await page.evaluate(async () => {
        const calls = []; const t0 = performance.now();
        const origSmash = window.judgeSmash, origCue = window.verdictCue;
        window.judgeSmash = () => calls.push(['smash', performance.now() - t0]);
        window.verdictCue = (v) => calls.push(['cue', performance.now() - t0, v.guilty]);
        const s = courtSnapshot(); s.phase = 'verdict'; s.caseNo = 'VD-1'; s.verdict = { guilty: true, unanimous: true, guiltyVotes: 5, notGuiltyVotes: 0 };
        kbCourt.update(s);
        const el = document.getElementById('courtVerdict');
        const early = { cls: el.className, ante: (el.querySelector('.vd-ante-text') || {}).textContent || '', major: document.body.dataset.courtMajor, cam: window.kbCourt.getState().camera, impactAt: 0, headline: '', stamp: '', sub: '' };
        for (let i = 0; i < 120 && !el.classList.contains('impact'); i++) await new Promise((r) => setTimeout(r, 20));
        early.impactAt = performance.now() - t0;
        await new Promise((r) => setTimeout(r, 80));
        early.headline = (el.querySelector('.vd-headline') || {}).textContent || ''; early.stamp = (el.querySelector('.court-stamp') || {}).textContent || '';
        early.unanimous = !!el.querySelector('.verdict-unanimous'); early.cardCls = (el.querySelector('.verdict-card') || {}).className || ''; early.shake = document.getElementById('stage').classList.contains('court-shake');
        await new Promise((r) => setTimeout(r, 600));
        early.stillImpact = el.classList.contains('impact');
        window.judgeSmash = origSmash; window.verdictCue = origCue;
        return { early, calls };
      });
      assert.ok(/anticipate/.test(rec.early.cls), 'azonnal a várakozás: ' + rec.early.cls);
      assert.equal(rec.early.ante, 'ÍTÉLETHIRDETÉS');
      assert.equal(rec.early.major, 'verdict'); assert.equal(rec.early.cam, 'judge', 'a kamera a bírón');
      assert.ok(rec.early.impactAt >= 750 && rec.early.impactAt <= 1500, 'ütés ideje: ' + Math.round(rec.early.impactAt) + ' ms');
      assert.equal(rec.early.headline, 'BŰNÖS!'); assert.equal(rec.early.stamp, 'BŰNÖS');
      assert.ok(rec.early.unanimous, 'egyhangú-jelzés'); assert.ok(/guilty/.test(rec.early.cardCls)); assert.ok(rec.early.shake, 'rázkódás az ütéskor');
      const names = rec.calls.map((c) => c[0]);
      assert.deepEqual(names, ['smash', 'cue'], 'kalapács, utána ítélet-hang / konfetti – pontosan egyszer: ' + JSON.stringify(rec.calls));
      assert.ok(rec.calls[0][1] <= rec.early.impactAt + 60 && rec.calls[0][1] >= rec.early.impactAt - 160, 'a kalapács az ütés pillanatában');
      assert.equal(rec.calls[1][2], true);
      assert.ok(rec.early.stillImpact);
      await shot(page, 'verdict_guilty');
    });
    await check('F2 ítélet ÁRTATLAN: ÁRTATLAN! + FELMENTVE, a réteg magától eltűnik (≤4,6 mp), a major jelzés is', async () => {
      await freeze(page);
      await snapWith(page, { phase: 'verdict', caseNo: 'VD-2', verdict: { guilty: false, unanimous: false, guiltyVotes: 2, notGuiltyVotes: 3 } });
      await page.waitForFunction(() => document.getElementById('courtVerdict').classList.contains('impact'), null, { timeout: 2500 });
      const o = await page.evaluate(() => ({ h: document.querySelector('#courtVerdict .vd-headline').textContent, s: document.querySelector('#courtVerdict .court-stamp').textContent, cls: document.getElementById('courtVerdict').className, tally: document.querySelector('#courtVerdict .verdict-sub').textContent }));
      assert.equal(o.h, 'ÁRTATLAN!'); assert.equal(o.s, 'FELMENTVE'); assert.ok(/flash-acquitted/.test(o.cls)); assert.ok(o.tally.includes('2 : 3'));
      const t0 = Date.now();
      await page.waitForFunction(() => document.getElementById('courtVerdict').classList.contains('hidden') && !document.body.dataset.courtMajor, null, { timeout: 5000 });
      assert.ok(Date.now() - t0 <= 4600, 'eltűnési idő ' + (Date.now() - t0));
    });
    await check('F3 az ítélet nem ismétlődik ugyanarra az ügyre (ismételt update), és fázisváltáskor kecsesen elhal', async () => {
      await freeze(page);
      const patch = { phase: 'verdict', caseNo: 'VD-3', verdict: { guilty: true, unanimous: false, guiltyVotes: 3, notGuiltyVotes: 2 } };
      const n = await page.evaluate(async (p) => {
        let cues = 0; const orig = window.verdictCue; window.verdictCue = () => { cues++; };
        for (let i = 0; i < 6; i++) { const s = courtSnapshot(); Object.assign(s, p); kbCourt.update(s); await new Promise((r) => setTimeout(r, 300)); }
        const s = courtSnapshot(); Object.assign(s, p, { phase: 'round_results' }); kbCourt.update(s); // a házigazda tovább lépett
        await new Promise((r) => setTimeout(r, 500));
        window.verdictCue = orig;
        return { cues, hidden: document.getElementById('courtVerdict').classList.contains('hidden'), major: document.body.dataset.courtMajor || '' };
      }, patch);
      assert.equal(n.cues, 1, 'egyetlen ítélet-hang');
      assert.ok(n.hidden && n.major === '', 'a réteg elhalt: ' + JSON.stringify(n));
    });
    await check('F4 kör-összegző: sorok, vezető korona, +N és ok a szerver eseményeiből, az összpontok felpörögnek a végértékig, a gomb látszik', async () => {
      await freeze(page);
      const r = await page.evaluate(async () => {
        const ps = S.players; S.phase = 'round_results'; S.caseNo = 'RR-1';
        S.roundResults = { scores: ps.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, score: [9, 7, 5, 3, 2, 1][i] || 0 })), hasNextRound: true };
        S.scoreEvents = [{ seq: 1, pid: ps[0].id, points: 3, kind: 'prosecution' }, { seq: 2, pid: ps[1].id, points: 2, kind: 'juror' }, { seq: 3, pid: ps[2].id, points: 4, kind: 'challenge' }];
        renderGame();
        const first = [...document.querySelectorAll('.rr-total')].map((e) => e.textContent);
        const from = [...document.querySelectorAll('.rr-total')].map((e) => e.dataset.from);
        await new Promise((res) => setTimeout(res, 2200));
        const rows = [...document.querySelectorAll('.rr-row')];
        return { n: rows.length, players: ps.length, first, from, last: [...document.querySelectorAll('.rr-total')].map((e) => e.textContent), to: [...document.querySelectorAll('.rr-total')].map((e) => e.dataset.to),
          gains: [...document.querySelectorAll('.rr-gain')].map((e) => e.textContent), reasons: [...document.querySelectorAll('.rr-who small')].map((e) => e.textContent),
          leaders: document.querySelectorAll('.rr-row.leader').length, crowns: document.querySelectorAll('.rr-crown').length, btn: (document.getElementById('btnNextRound') || {}).textContent,
          boardVisible: (() => { const b = document.querySelector('.rr-board'); const cs = getComputedStyle(b); const rc = b.getBoundingClientRect(); return cs.display !== 'none' && rc.width > 200 && rc.height > 100; })() };
      });
      assert.equal(r.n, r.players, 'minden játékos sora');
      assert.deepEqual(r.first, r.from, 'a count-up a régi összegről indul');
      assert.deepEqual(r.last, r.to, 'a végén a szerver összege');
      assert.deepEqual(r.gains, ['+3', '+2', '+4']);
      assert.ok(r.reasons.some((x) => /ELÍTÉLÉS/.test(x)) && r.reasons.some((x) => /JÓ ÍTÉLET/.test(x)) && r.reasons.some((x) => /SIKERES KIHÍVÁS/.test(x)), 'okok: ' + r.reasons.join(' | '));
      assert.equal(r.leaders, 1); assert.equal(r.crowns, 1);
      assert.equal(r.btn, 'KÖVETKEZŐ TÁRGYALÁS'); assert.ok(r.boardVisible, 'a ponttábla látszik');
      await shot(page, 'round_summary');
    });
    await check('F5 játék vége: pódium (arany / ezüst / bronz), díjak, győztes-spotlight a helyes névvel, gombok elérhetők; új játéknál a réteg eltűnik', async () => {
      await freeze(page);
      const r = await page.evaluate(async () => {
        const ps = S.players; S.phase = 'game_over'; S.caseNo = 'GO-1';
        S.gameOver = { ranking: ps.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, score: [21, 17, 12, 9, 5, 2, 1, 0][i] || 0 })), awards: { bestLawyer: { emoji: '⚖️', award: 'Legjobb ügyvéd', name: ps[0].name, value: 12 }, sharpestJuror: { emoji: '🧠', award: 'Éles esküdt', name: ps[1].name, value: 5 } } };
        renderGame();
        await new Promise((res) => setTimeout(res, 1800));
        const w = document.getElementById('courtWinner'), btn = document.getElementById('btnNewGame'), leave = document.getElementById('btnLeaveAfter');
        const hit = (b) => { const rc = b.getBoundingClientRect(); const e = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2); return !!e && (e === b || b.contains(e)); };
        return { shown: w.classList.contains('show'), name: (w.querySelector('.wn-name') || {}).textContent, top: ps[0].name, title: (w.querySelector('.wn-title') || {}).textContent, major: document.body.dataset.courtMajor,
          pe: getComputedStyle(w).pointerEvents, podium: ['gold', 'silver', 'bronze'].map((m) => document.querySelectorAll('#phaseContent .score-row.podium-' + m).length), awards: document.querySelectorAll('#phaseContent .award-card').length,
          newGame: btn && btn.textContent, newHit: btn && hit(btn), leave: leave && leave.textContent, leaveHit: leave && hit(leave), score: (w.querySelector('.wn-score') || {}).textContent };
      });
      assert.ok(r.shown, 'a győztes-réteg látszik'); assert.equal(r.name, r.top); assert.equal(r.title, 'GYŐZTES'); assert.equal(r.major, 'winner'); assert.equal(r.pe, 'none');
      assert.deepEqual(r.podium.map((n) => n >= 1), [true, true, true]); assert.ok(r.awards >= 2); assert.ok(/21/.test(r.score) && /1\. HELY/.test(r.score));
      assert.equal(r.newGame, 'ÚJ TÁRGYALÁS'); assert.ok(r.newHit, 'az ÚJ TÁRGYALÁS gombot nem takarja a győztes-réteg');
      assert.equal(r.leave, 'KILÉPÉS'); assert.ok(r.leaveHit);
      await shot(page, 'game_over');
      await page.evaluate(() => { S.phase = 'accusation'; S.caseNo = 'GO-2'; renderGame(); });
      await page.waitForFunction(() => document.getElementById('courtWinner').classList.contains('hidden'), null, { timeout: 2000 });
    });
    await check('F6 a "KÖVETKEZŐ TÁRGYALÁS" a házigazdánál működik (gomb a szerver-eseményt küldi: nincs kliens-oldali játéklogika)', async () => {
      const src = fs.readFileSync(path.join(ROOT, 'public/client.js'), 'utf8');
      assert.ok(/btnNextRound[\s\S]{0,200}emit\('next_round'/.test(src) || /emit\('next_round'/.test(src), 'next_round esemény');
      assert.ok(/emit\('new_game'/.test(src), 'new_game esemény');
    });

    // ---- G) reakciók, idle, kártyák ----
    await check('G1 reakció a KÜLDŐ karaktere fölött (a fej fölött), játékosonként legfeljebb 2 él, összesen ≤14, takarítás ≤1,8 mp, nincs elárvult elem', async () => {
      await freeze(page);
      await page.evaluate(() => { S.phase = 'prosecution'; renderGame(); });
      await settle(page);
      const r = await page.evaluate(async () => {
        const pid = S.prosecutorId; for (let i = 0; i < 5; i++) popReaction('😂', pid);
        const pops = [...document.querySelectorAll('#reactionLayer .react-pop[data-pid="' + pid + '"]')];
        const slot = document.querySelector('#stageSlots .stage-slot[data-pid="' + pid + '"]'), sr = slot.getBoundingClientRect(), img = slot.querySelector('.st-base').getBoundingClientRect();
        const pr = pops[pops.length - 1].getBoundingClientRect();
        const near = { dx: Math.abs((pr.left + pr.width / 2) - (img.left + img.width / 2)), above: pr.top <= sr.top + sr.height * 0.35 };
        const kinds = { sparks: pops[0].querySelectorAll('.rp-sparks i').length, emoji: pops[0].querySelector('.rp-emoji').textContent, anim: getComputedStyle(pops[0]).animationName };
        const others = S.players.filter((p) => p.id !== pid); let sent = 0; for (let i = 0; i < 40; i++) { if (flyEmoji('🔥', others[i % others.length].id) !== false) sent++; }
        const total = document.getElementById('reactionLayer').children.length;
        await new Promise((res) => setTimeout(res, 1900));
        return { count: pops.length, near, kinds, total, left: document.getElementById('reactionLayer').children.length };
      });
      assert.equal(r.count, 2, 'ugyanattól a játékostól legfeljebb 2 pop');
      assert.ok(r.near.dx <= 60 && r.near.above, 'a pop a küldő fölött: ' + JSON.stringify(r.near));
      assert.equal(r.kinds.emoji, '😂'); assert.ok(r.kinds.sparks >= 3, 'részecskék'); assert.ok(r.kinds.anim && r.kinds.anim !== 'none', 'animáció: ' + r.kinds.anim);
      assert.ok(r.total <= 14, 'egyszerre legfeljebb 14: ' + r.total);
      assert.equal(r.left, 0, 'a réteg kiürül');
    });
    await check('G2 idle-mozgás: a szerep-képek karakterenként eltérő fázissal lebegnek (≤3 px), nem szinkronban; a szerver állapotához nem nyúl', async () => {
      await page.evaluate(() => { S.phase = 'prosecution'; renderGame(); });
      await settle(page);
      const r = await page.evaluate(async () => {
        const slots = [...document.querySelectorAll('#stageSlots .stage-slot.sprite-slot')];
        const seeds = slots.map((s) => s.style.getPropertyValue('--idle-seed')).filter(Boolean);
        const imgs = slots.map((s) => s.querySelector('.st-art.role-sprite.sprite-ready .st-base')).filter(Boolean);
        const ty = () => imgs.map((i) => { const m = new DOMMatrix(getComputedStyle(i).transform); return m.f; });
        const samples = []; for (let k = 0; k < 6; k++) { samples.push(ty()); await new Promise((res) => setTimeout(res, 450)); }
        const names = imgs.flatMap((i) => getComputedStyle(i).animationName.split(',').map((x) => x.trim()));
        const all = samples.flat();
        return { n: slots.length, seeds: new Set(seeds).size, names: [...new Set(names)], maxAbs: Math.max(...all.map(Math.abs)), moved: Math.max(...all) - Math.min(...all), imgs: imgs.length };
      });
      assert.ok(r.imgs >= 4, 'szerep-kép karakterek: ' + r.imgs);
      assert.ok(r.seeds >= Math.min(4, r.n), 'eltérő fázisok: ' + r.seeds + '/' + r.n);
      assert.ok(r.names.includes('spr-idle'), 'idle animáció: ' + r.names);
      assert.deepEqual(r.names.filter((n) => n !== 'spr-idle' && n !== 'glow-pulse'), [], 'váratlan animáció-nevek: ' + r.names);
      assert.ok(r.maxAbs <= 3.5, 'az amplitúdó legfeljebb ~3 px: ' + r.maxAbs.toFixed(2));
      assert.ok(r.moved > 0.2, 'látható (de finom) mozgás: ' + r.moved.toFixed(2));
    });
    await check('G3 kártya-animációk: új lap becsúszik (ch-draw), kijelölés kiemel, hover (egérrel) fény; a játékot nem blokkolja', async () => {
      const r = await page.evaluate(async () => {
        const cards = [1, 2, 3].map((n) => ({ id: 'cin-' + n + '-' + Date.now(), type: n === 3 ? 'challenge' : 'evidence', content: 'Teszt kártya ' + n, visibility: 'private', caseNumber: 'T-1', number: n, isUsable: true }));
        kbCards.update(cards, { phase: 'prep' });
        await new Promise((res) => setTimeout(res, 150));
        const fresh = [...document.querySelectorAll('.court-card.is-new')];
        const anim = fresh.length ? getComputedStyle(fresh[0]).animationName : '';
        kbCards.open(); await new Promise((res) => setTimeout(res, 450));
        kbCards.select(1, true); await new Promise((res) => setTimeout(res, 450));
        const sel = document.querySelectorAll('.court-card.sel').length;
        const others = [...document.querySelectorAll('.ch-stage .court-card:not(.sel):not(.more)')].map((c) => getComputedStyle(c).scale);
        return { fresh: fresh.length, anim, sel, others, state: kbCards.state() };
      });
      assert.ok(r.fresh >= 1 && r.anim === 'ch-draw', 'új kártya-animáció: ' + JSON.stringify({ f: r.fresh, a: r.anim }));
      assert.equal(r.sel, 1); assert.ok(r.others.length && r.others.every((s) => parseFloat(s) < 1), 'a többi lap visszahúzódik: ' + r.others);
      assert.ok(r.state.visible && r.state.open);
      const box = await page.evaluate(() => { const c = document.querySelector('.ch-stage .court-card:not(.sel):not(.more)'); const rc = c.getBoundingClientRect(); return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2, shadow: getComputedStyle(c).boxShadow }; });
      await page.mouse.move(box.x, box.y); await page.waitForTimeout(450);
      const hov = await page.evaluate((b) => { const e = document.elementFromPoint(b.x, b.y); const c = e && e.closest('.court-card'); return c ? getComputedStyle(c).boxShadow : ''; }, box);
      assert.ok(hov && hov !== box.shadow, 'hover-ragyogás: ' + hov);
      await page.evaluate(() => kbCards.hide());
    });

    // ---- H) hang ----
    await check('H1 hang-architektúra: fájl > szintetizált; némítva semmi nem szól; minden hook kategóriába tartozik; a hangerő-állítás érvényes', async () => {
      const r = await page.evaluate(() => {
        const out = {};
        const calls = []; const origSfx = {}; for (const k of Object.keys(SFX)) { origSfx[k] = SFX[k]; SFX[k] = () => calls.push('sfx:' + k); }
        const origHas = kbMedia.hasSound, origPlay = kbMedia.playSound;
        try {
          kbMedia.hasSound = () => false; kbSound.play('gavel'); out.synth = calls.slice();
          calls.length = 0; kbMedia.hasSound = (n) => n === 'gavel'; kbMedia.playSound = (n, v) => { calls.push('file:' + n + ':' + (v > 0)); return true; };
          kbSound.play('gavel'); out.file = calls.slice();
          calls.length = 0; kbSound.play('ui-click'); out.otherStillSynth = calls.slice();
          calls.length = 0; kbMedia.playSound = () => { calls.push('file-fail'); return false; }; kbSound.play('gavel'); out.fileFailFallsBack = calls.slice();
          calls.length = 0; const was = muted; muted = true; kbSound.play('gavel'); kbSound.play('ui-click'); out.muted = calls.slice(); muted = was;
        } finally { for (const k of Object.keys(origSfx)) SFX[k] = origSfx[k]; kbMedia.hasSound = origHas; kbMedia.playSound = origPlay; }
        out.hooks = kbSound.hooks(); out.uncategorised = kbSound.hooks().filter((h) => !kbMedia.categoryOf(h)); out.orphanCat = kbMedia.hooks().filter((h) => !kbSound.hooks().includes(h));
        return out;
      });
      assert.deepEqual(r.synth, ['sfx:gavel']);
      assert.deepEqual(r.file, ['file:gavel:true'], 'a hangfájl a szintetizált helyett szól');
      assert.deepEqual(r.otherStillSynth, ['sfx:uiClick']);
      assert.deepEqual(r.fileFailFallsBack, ['file-fail', 'sfx:gavel'], 'ha a fájl nem játszható, a szintetizált hang szól');
      assert.deepEqual(r.muted, [], 'némítva se fájl, se szintetizált hang');
      assert.deepEqual(r.uncategorised, [], 'kategória nélküli hook: ' + r.uncategorised);
      assert.deepEqual(r.orphanCat, [], 'a kategóriákban szereplő, de nem létező hook: ' + r.orphanCat);
    });
    await check('H2 az első érintés élesíti a hangot (autoplay-szabály), hang nélküli környezetben sem dob hibát', async () => {
      const r = await page.evaluate(() => { try { for (const h of kbSound.hooks()) kbSound.play(h); return 'ok'; } catch (e) { return e.message; } });
      assert.equal(r, 'ok');
    });

    // ---- J) szivárgás ----
    await check('J1 ismételt ciklusok után nem nő az eseményfigyelők, az időzítők és a DOM-csomópontok száma; a rétegek kiürülnek', async () => {
      const cdp = await g.context.newCDPSession(page);
      const listeners = async () => {
        let total = 0;
        for (const expr of ['document', 'window', 'document.body', 'document.getElementById("stage")', 'document.getElementById("stageSlots")', 'document.getElementById("phaseContent")', 'document.getElementById("reactionLayer")', 'document.getElementById("pinWall")']) {
          const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
          if (!result.objectId) continue;
          const { listeners: l } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
          total += l.length;
        }
        return total;
      };
      const cycle = async (n) => {
        await page.evaluate(async (n) => {
          const w = (ms) => new Promise((r) => setTimeout(r, ms));
          for (let i = 0; i < 4; i++) { S.phase = 'prosecution'; renderGame(); S.phase = 'prep'; renderGame(); }
          kbCourt.reset();
          const s = courtSnapshot(); s.phase = 'accusation'; s.myRole = ['judge', 'witness', 'juror'][n % 3]; s.caseNo = 'LK-' + n + '-' + Date.now(); kbCourt.update(s); await w(500);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await w(350);
          kbCourt.reset();
          const v = courtSnapshot(); v.phase = 'verdict'; v.caseNo = 'LKV-' + n; v.verdict = { guilty: n % 2 === 0, unanimous: false, guiltyVotes: 3, notGuiltyVotes: 2 }; kbCourt.update(v); await w(1500);
          kbCourt.reset();
          S.phase = 'prosecution'; renderGame(); for (let i = 0; i < 6; i++) popReaction('🔥', S.prosecutorId);
          S.phase = 'round_results'; S.caseNo = 'LKR-' + n; S.roundResults = { scores: S.players.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, score: i })), hasNextRound: true }; S.scoreEvents = [{ seq: 1, pid: S.players[0].id, points: 2, kind: 'juror' }]; renderGame(); await w(300);
          kbCourt.reset();
        }, n);
      };
      await cycle(0);
      await page.waitForTimeout(2200);
      const base = { l: await listeners(), nodes: await page.evaluate(() => document.querySelectorAll('*').length) };
      for (let n = 1; n <= 3; n++) await cycle(n);
      await page.waitForTimeout(2600);
      const after = { l: await listeners(), nodes: await page.evaluate(() => document.querySelectorAll('*').length) };
      const st = await page.evaluate(() => ({ timers: window.kbCourt.getState().timers, react: document.querySelectorAll('#reactionLayer *').length, score: document.querySelectorAll('#courtScore *').length, major: document.body.dataset.courtMajor || '' }));
      assert.equal(after.l, base.l, 'eseményfigyelők: ' + base.l + ' → ' + after.l);
      assert.ok(after.nodes <= base.nodes * 1.05 + 20, 'DOM-csomópontok: ' + base.nodes + ' → ' + after.nodes);
      assert.ok(st.timers <= 3, 'függő időzítők: ' + st.timers);
      assert.equal(st.react, 0); assert.equal(st.score, 0); assert.equal(st.major, '');
      await cdp.detach();
    });
    assert.deepEqual(g.errors, [], 'JS-hibák a fő forgatókönyvben:\n' + g.errors.join('\n'));
    passed++; console.log('PASS: nincs JS-hiba / konzol-hiba a fő forgatókönyvben');
  } catch (e) {
    failed++; console.error('FAIL: fő forgatókönyv\n  ' + (e && e.message || e));
  } finally { await g.context.close(); }
}

// =============================== I) csökkentett mozgás ===============================
async function partReduced(browser) {
  const g = await startGame(browser, { width: 1366, height: 768 }, { reduced: true, bots: 5 });
  const { page } = g;
  try {
    await freeze(page);
    await assign(page, MAP); await settle(page);
    await check('I1 csökkentett mozgás: nincs lebegő idle / árnyék-animáció, nincs rázkódás, nincs por / részecske – de a felirat, az ítélet és a pontok látszanak', async () => {
      await page.evaluate(() => { S.phase = 'prosecution'; renderGame(); });
      await page.waitForTimeout(500);
      const idle = await page.evaluate(() => [...document.querySelectorAll('.st-art.role-sprite.sprite-ready .st-base')].map((i) => getComputedStyle(i).animationName));
      assert.ok(idle.length >= 3 && idle.every((n) => n === 'none'), 'idle animáció: ' + idle);
      await freeze(page);
      await snapWith(page, { phase: 'accusation', myRole: 'prosecutor', caseNo: 'RM-1' });
      await page.waitForFunction(() => document.getElementById('courtReveal').classList.contains('show'), null, { timeout: 2500 });
      const rv = await page.evaluate(() => ({ dust: document.querySelectorAll('#courtReveal .rv-dust').length, title: document.querySelector('#courtReveal .rv-title').textContent }));
      assert.equal(rv.dust, 0); assert.ok(rv.title.includes('ÜGYÉSZ'));
      await freeze(page);
      const v = await page.evaluate(async () => {
        const s = courtSnapshot(); s.phase = 'verdict'; s.caseNo = 'RM-2'; s.verdict = { guilty: true, unanimous: false, guiltyVotes: 3, notGuiltyVotes: 2 }; kbCourt.update(s);
        const t0 = performance.now(); let shake = false, impact = 0, head = '';
        for (let i = 0; i < 80; i++) { if (document.getElementById('stage').classList.contains('court-shake')) shake = true; if (!impact && document.getElementById('courtVerdict').classList.contains('impact')) { impact = performance.now() - t0; await new Promise((r) => setTimeout(r, 40)); head = (document.querySelector('#courtVerdict .vd-headline') || {}).textContent; } await new Promise((r) => setTimeout(r, 25)); }
        return { shake, impact, head };
      });
      assert.equal(v.shake, false, 'nincs rázkódás'); assert.ok(v.impact > 0 && v.impact < 700, 'az ítélet gyorsabban jön: ' + Math.round(v.impact)); assert.equal(v.head, 'BŰNÖS!');
      await freeze(page);
      const pop = await page.evaluate(() => { S.phase = 'prosecution'; renderGame(); popReaction('😂', S.prosecutorId); const p = document.querySelector('#reactionLayer .react-pop'); return { sparks: p.querySelectorAll('.rp-sparks i').length, anim: getComputedStyle(p).animationName }; });
      assert.equal(pop.sparks, 0, 'nincs részecske');
      const rr = await page.evaluate(() => {
        const ps = S.players; S.phase = 'round_results'; S.caseNo = 'RM-3';
        S.roundResults = { scores: ps.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, score: [9, 7, 5, 3, 2, 1][i] || 0 })), hasNextRound: true };
        S.scoreEvents = [{ seq: 1, pid: ps[0].id, points: 3, kind: 'prosecution' }]; renderGame();
        return { sums: [...document.querySelectorAll('.rr-total')].map((e) => e.textContent === e.dataset.to), n: document.querySelectorAll('.rr-row').length };
      });
      assert.ok(rr.n > 0 && rr.sums.every(Boolean), 'az összpontok azonnal a végértéken');
      assert.deepEqual(g.errors, []);
    });
  } finally { await g.context.close(); }
}

// =============================== K) reszponzív ===============================
async function partResponsive(browser) {
  const VIEWS = [{ w: 1920, h: 1080, n: 'fullhd' }, { w: 1366, h: 768, n: 'laptop' }, { w: 1024, h: 768, n: 'tablet' }, { w: 390, h: 844, n: 'phone' }];
  for (const v of VIEWS) {
    await check('K ' + v.w + '×' + v.h + ': szerep-felfedés, stinger, ítélet, kör-összegző, játék vége, reakció – elférnek, a cím a felső sáv alatt, nincs vízszintes görgetés, nincs JS-hiba', async () => {
      const g = await startGame(browser, { width: v.w, height: v.h }, { bots: 7 });
      const { page } = g;
      try {
        await freeze(page);
        await assign(page, MAP); await settle(page);
        const hud = await hudBottom(page);
        const rail = await railOf(page);
        assert.equal(rail, v.w > 900 ? 280 : 0, 'a jobb oldali sáv szélessége (--rail)');
        const inScene = (r, what) => { inViewport(r, what); assert.ok(r.r <= r.vw - rail + 2, what + ' a jobb oldali sáv alá lóg: jobb szél ' + Math.round(r.r) + ' > ' + (r.vw - rail)); };
        // szerep-felfedés (a leghosszabb szóval: VÉDŐÜGYVÉD)
        await snapWith(page, { phase: 'accusation', myRole: 'defender', caseNo: 'RS-1' });
        await page.waitForFunction(() => document.getElementById('courtReveal').classList.contains('show'), null, { timeout: 2500 });
        await page.waitForTimeout(900);
        inScene(await rectOf(page, '#courtReveal .rv-stage'), 'felfedés');
        const title = await textRect(page, '#courtReveal .rv-title');
        assert.ok(title.t >= hud - 2, 'a cím a felső sáv alatt (' + Math.round(title.t) + ' ≥ ' + Math.round(hud) + ')');
        inScene(title, 'felfedés-cím (a VÉDŐÜGYVÉD szöveg)');
        assert.ok(title.w <= (title.vw - rail) * 0.98, 'a cím a szabad színpad szélességén belül: ' + Math.round(title.w) + ' / ' + (title.vw - rail));
        const clip = await page.evaluate(() => { const t = document.querySelector('#courtReveal .rv-title'); return t.scrollWidth <= t.clientWidth + 1; });
        assert.ok(clip, 'a cím nem lóg ki');
        const sprite = await rectOf(page, '#courtReveal .rv-sprite, #courtReveal .rv-portrait');
        if (sprite) { inScene(sprite, 'felfedés-karakter'); assert.ok(sprite.t >= title.b - 6, 'a karakter nem takarja a címet'); }
        await noHScroll(page, 'felfedés'); await shot(page, 'reveal_' + v.n);
        // stinger
        await freeze(page);
        await snapWith(page, { phase: 'prep', evidence: null, myChallenge: null }); await snapWith(page, { phase: 'verdict_vote' });
        await page.waitForFunction(() => document.getElementById('courtStinger').classList.contains('show'), null, { timeout: 1000 });
        await page.waitForTimeout(500);
        inScene(await rectOf(page, '#courtStinger .cs-card'), 'stinger'); await shot(page, 'stinger_' + v.n);
        // ítélet
        await freeze(page);
        await snapWith(page, { phase: 'verdict', caseNo: 'RS-V', verdict: { guilty: true, unanimous: true, guiltyVotes: 7, notGuiltyVotes: 0 } });
        await page.waitForFunction(() => document.getElementById('courtVerdict').classList.contains('impact'), null, { timeout: 3000 });
        await page.waitForTimeout(700);
        const vc = await rectOf(page, '#courtVerdict .verdict-card'); inScene(vc, 'ítélet-kártya');
        assert.ok(vc.t >= hud - 2, 'az ítélet-kártya a felső sáv alatt');
        const hl = await rectOf(page, '#courtVerdict .vd-headline'); inScene(hl, 'BŰNÖS!');
        await noHScroll(page, 'ítélet'); await shot(page, 'verdict_' + v.n);
        // kör-összegző
        await freeze(page);
        await page.evaluate(() => {
          const ps = S.players; S.phase = 'round_results'; S.caseNo = 'RS-R';
          S.roundResults = { scores: ps.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, score: [19, 17, 15, 13, 9, 7, 3, 1][i] || 0 })), hasNextRound: true };
          S.scoreEvents = ps.slice(0, 6).map((p, i) => ({ seq: i + 1, pid: p.id, points: 3, kind: ['prosecution', 'juror', 'challenge', 'unanimous', 'defender', 'favorite'][i] })); renderGame();
        });
        await page.waitForTimeout(2200);
        const rows = await page.evaluate(() => { const board = document.querySelector('.rr-board').getBoundingClientRect(); return { n: document.querySelectorAll('.rr-row').length, over: [...document.querySelectorAll('.rr-row')].filter((r) => r.scrollWidth > r.clientWidth + 1).length, left: board.left, right: board.right, vw: innerWidth, head: document.querySelector('.rr-head').getBoundingClientRect().top }; });
        assert.equal(rows.n, 8); assert.equal(rows.over, 0, 'szöveg kilóg a sorokból'); assert.ok(rows.left >= -1 && rows.right <= rows.vw + 1, 'a ponttábla szélessége');
        assert.ok(rows.head >= hud - 2, 'a "KÖR VÉGE" cím a felső sáv alatt');
        await noHScroll(page, 'kör-összegző'); await shot(page, 'round_' + v.n);
        // játék vége
        await freeze(page);
        await page.evaluate(() => {
          const ps = S.players; S.phase = 'game_over'; S.caseNo = 'RS-G';
          S.gameOver = { ranking: ps.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, score: [21, 17, 12, 9, 5, 2, 1, 0][i] || 0 })), awards: { bestLawyer: { emoji: '⚖️', award: 'Legjobb ügyvéd', name: ps[0].name, value: 12 } } };
          renderGame();
        });
        await page.waitForTimeout(2000);
        const wn = await rectOf(page, '#courtWinner .wn-stage'); inScene(wn, 'győztes-réteg');
        const wt = await rectOf(page, '#courtWinner .wn-title'); assert.ok(wt.t >= hud - 2, 'a GYŐZTES cím a felső sáv alatt'); inScene(wt, 'győztes-cím');
        // a győztes neve és pontja a lenti eredmény-panel FÖLÖTT marad (nem csúszik alá), és a név olvasható (nem levágott)
        const panelTop = await page.evaluate(() => document.getElementById('scenePanel').getBoundingClientRect().top);
        const wname = await textRect(page, '#courtWinner .wn-name'), wscore = await textRect(page, '#courtWinner .wn-score');
        assert.ok(wname.b <= panelTop + 2, 'a győztes neve a panel fölött (' + Math.round(wname.b) + ' ≤ ' + Math.round(panelTop) + ')');
        assert.ok(wscore.b <= panelTop + 2, 'a győztes pontja a panel fölött (' + Math.round(wscore.b) + ' ≤ ' + Math.round(panelTop) + ')');
        inScene(wname, 'győztes-név');
        const hero = await rectOf(page, '#courtWinner .wn-sprite, #courtWinner .wn-portrait');
        if (hero) assert.ok(hero.h >= 70, 'a győztes-figura látható méretű: ' + Math.round(hero.h));
        const pod = await page.evaluate(() => [...document.querySelectorAll('.go-podium .score-row')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, vw: innerWidth }; }));
        assert.equal(pod.length, 3); pod.forEach((p) => assert.ok(p.l >= -1 && p.r <= p.vw + 1, 'pódium-kártya kilóg: ' + JSON.stringify(p)));
        const btn = await rectOf(page, '#btnNewGame'); inViewport(btn, 'ÚJ TÁRGYALÁS gomb');
        await noHScroll(page, 'játék vége'); await shot(page, 'gameover_' + v.n);
        // reakció
        await freeze(page);
        await page.evaluate(() => { S.phase = 'witness'; renderGame(); });
        await settle(page);
        await page.evaluate(() => { popReaction('👏', S.witnessId); popReaction('😂', S.prosecutorId); });
        await page.waitForTimeout(350);
        const pops = await page.evaluate(() => [...document.querySelectorAll('.react-pop')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }; }));
        assert.equal(pops.length, 2); pops.forEach((p) => inViewport(p, 'reakció'));
        await shot(page, 'reaction_' + v.n);
        assert.deepEqual(g.errors, [], 'JS-hibák:\n' + g.errors.join('\n'));
      } finally { await g.context.close(); }
    });
  }
}

(async () => {
  const t0 = Date.now();
  await partMediaApi();
  if (!chromium) { skip('böngészős rész', 'a playwright-core nincs telepítve'); if (REQUIRE) failed++; return finish(); }
  const browser = await launch();
  if (!browser) { skip('böngészős rész', 'nincs használható böngésző'); if (REQUIRE) failed++; return finish(); }
  const servers = [];
  try {
    servers.push(await startServer(PORT));
    // a 2. szerver "feltöltött" (de nem kiszolgálható) videó-fájlokat hirdet: a videó-háttér hibaágát és a keskeny / csökkentett mozgás ágat teszteli
    const vdir = path.join(tmp, 'v2'); fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, 'login-loop.webm'), 'not-a-video');
    servers.push(await startServer(PORT2, { KB_VIDEO_DIR: vdir }));
    await partLoginVideo(browser, servers);
    await partMain(browser);
    await partReduced(browser);
    await partResponsive(browser);
  } catch (e) { failed++; console.error('FAIL: a teszt futtatása\n  ' + (e && e.stack || e)); }
  finally { for (const s of servers) s.kill(); await browser.close().catch(() => {}); }
  console.log('Futási idő: ' + Math.round((Date.now() - t0) / 1000) + ' s');
  finish();
})();

function finish() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* nem baj */ }
  console.log('\nÖsszesen: ' + passed + ' PASS, ' + failed + ' FAIL, ' + skipped + ' SKIP');
  process.exit(failed ? 1 : 0);
}
