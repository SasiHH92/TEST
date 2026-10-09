'use strict';
// ============================================================
// KAMU BÍRÓSÁG – SZEREP-KARAKTEREK A COURTROOMBAN, valódi böngészőben (Playwright, valódi szerver + botok ellen)
//
//  A) minden felbontáson (1920×1080, 1366×768, 1024×768, mobil álló 390×844 és 360×640, mobil fekvő 844×390): mind az 5 szerep a megfelelő avatar × szerep képpel,
//     betöltve, nincs törött kép, az arc és a fej a színpadon belül (nincs levágott fej / oldal), az arcot névtábla és a HUD nem takarja indokolatlanul,
//     nincs téglalap-háttér / keret a karakter mögött, nincs JS-hiba
//  B) tartalék: szerep-kép nélküli avatár → az eredeti avatár + szerep-jelvény; hiányzó (404) kép → futás közben tartalékra vált, nincs törött kép
//  C) lassú képbetöltés: betöltésig a kép rejtett (nincs villanás / törött ikon), utána belép (animáció 250–450 ms, mozgáscsökkentésnél nincs animáció)
//  D) szerepváltás (új kör): ugyanaz az avatár a másik szerep képét kapja; a bíró cseréje; újratöltés (F5) után ugyanaz; elrendezés-stabilitás (nincs ugrálás)
//  E) teli szoba (8 játékos): asztalon az esküdtek a hátsó sorban, telefonon 2 esküdt + "+N"; a hálózati kérések száma korlátos (nem tölt be minden képet)
//
// Futtatás:  npm run test:roles-ui     Böngésző: CHROMIUM_PATH / Edge / Chrome / Playwright Chromium; ha nincs: SKIP (ROLES_UI_REQUIRE=1 esetén hiba)
// Képernyőképek: ROLES_UI_SHOTS=./QA_SCREENSHOTS
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.ROLES_UI_PORT || 3185), BASE = 'http://127.0.0.1:' + PORT;
const REQUIRE = process.env.ROLES_UI_REQUIRE === '1';
const SHOTS = process.env.ROLES_UI_SHOTS ? path.resolve(process.env.ROLES_UI_SHOTS) : '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-rolesui-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky/i;
const MAP = { judge: 'av06', prosecutor: 'av04', defendant: 'av05', defender: 'av01', witness: 'av07', jurors: ['av02', 'av03', 'av22', 'av21'] };

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) { try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ } }
  return null;
}
async function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
    AUTH_BASE_URL: BASE, DATABASE_URL: '', MAX_ROOMS_PER_IP: '60', AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'),
    KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}

// ---- játék indítása egy vendéggel + botokkal; az előkészület (prep) fázisig ----
async function startGame(browser, viewport, opts = {}) {
  const mobile = viewport.width < 700 || viewport.height < 500;
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'hu-HU', reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
  const page = await context.newPage();
  const errors = [], roleRequests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('request', (r) => { if (/\/assets\/roles\/.*\.webp/.test(r.url())) roleRequests.push(r.url()); });
  if (opts.setup) await opts.setup(page);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#authGuest'); await page.click('#authGuest');
  await page.waitForFunction(() => document.body.dataset.screen === 'name');
  await page.evaluate(() => document.getElementById('btnNewSuspect').click());
  await page.fill('#guestName', 'Szerep ' + viewport.width);
  await page.evaluate(() => document.getElementById('btnGuestGo').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'menu');
  await page.evaluate(() => document.getElementById('btnCreate').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
  for (let i = 0; i < (opts.bots || 7); i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(200); }
  await page.evaluate(() => {
    document.getElementById('btnCustomGame').click();
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('setSpeech', 15); set('setDefender', 15); set('setPrep', 90); set('setWitness', 10); set('setClosing', 10); set('setRounds', 1);
    const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
    document.getElementById('btnSaveSettings').click();
  });
  await page.waitForFunction(() => S.settings.prepSeconds === 90, null, { timeout: 6000 });
  await page.evaluate(() => document.getElementById('btnStartGame').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
  await page.evaluate(() => { const b = document.getElementById('iaAccRead'); if (b) b.click(); });
  await page.waitForFunction(() => S.phase === 'prep', null, { timeout: 30000 });
  await page.waitForTimeout(mobile ? 12500 : 5500); // a kör-intro és a bizonyíték-bemutató lefut
  return { context, page, errors, roleRequests, mobile };
}

// a szerver állapotát a kliensben befagyasztjuk (KICKED_FROM_ROOM), és a szerepekhez rendeljük az ismert avatárokat; a megjelenítést újrarajzoljuk
const assign = (page, map) => page.evaluate((m) => {
  KICKED_FROM_ROOM = true;
  const ids = { judge: S.currentJudgeId, prosecutor: S.prosecutorId, defendant: S.defendantId, defender: S.defenderId, witness: S.witnessId };
  const used = new Set(Object.values(ids));
  S.players.forEach((p) => { for (const [r, id] of Object.entries(ids)) if (id === p.id && m[r]) p.avatar = m[r]; });
  let i = 0; S.players.filter((p) => !used.has(p.id)).forEach((p) => { p.avatar = m.jurors[i++ % m.jurors.length]; });
  document.getElementById('stage').dataset.key = ''; renderStage();
}, map);
const settle = async (page) => { await page.waitForFunction(() => [...document.querySelectorAll('#stage .st-base')].every((i) => i.complete), null, { timeout: 15000 }); await page.waitForTimeout(900); };

// a megjelenített szerep-képek mérése: látható (alfa) befoglaló doboz, arc-mag, takarás
const measure = (page) => page.evaluate(async () => {
  const stage = document.getElementById('stage').getBoundingClientRect();
  const usable = stage.width - (stage.width > 900 ? 280 : 0);
  const hud = ['#accusationTicker', '#scenePanel', '#roleBanner', '#judgeWatchBar', '.info-bar'].map((s) => document.querySelector(s)).filter((e) => e && !e.classList.contains('hidden') && e.getClientRects().length).map((e) => e.getBoundingClientRect());
  const plates = [...document.querySelectorAll('#stagePlates .stage-plate')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect());
  const rectOv = (a, b) => Math.max(0, Math.min(a.r, b.right) - Math.max(a.l, b.left)) * Math.max(0, Math.min(a.b, b.bottom) - Math.max(a.t, b.top));
  const out = [];
  for (const slot of document.querySelectorAll('.stage-slot')) {
    const img = slot.querySelector('.st-base'); if (!img) continue;
    await img.decode().catch(() => {});
    const r = img.getBoundingClientRect();
    const item = { role: slot.dataset.role, pid: slot.dataset.pid || '', sprite: slot.classList.contains('sprite-slot'), portrait: slot.classList.contains('av-slot'),
      src: (img.getAttribute('src') || '').split('/').pop().split('?')[0], loaded: img.complete && img.naturalWidth > 0, hasBadge: !!slot.querySelector('.role-fallback-badge'), rect: [r.left, r.top, r.width, r.height], slotRect: (() => { const q = slot.getBoundingClientRect(); return [q.left, q.top, q.width, q.height]; })() };
    if (item.sprite && item.loaded) {
      const c = document.createElement('canvas'); c.width = 180; c.height = 240; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 180, 240);
      const d = x.getImageData(0, 0, 180, 240).data; let top = 240, bot = 0, left = 180, right = 0;
      for (let yy = 0; yy < 240; yy++) for (let xx = 0; xx < 180; xx++) if (d[(yy * 180 + xx) * 4 + 3] > 40) { if (yy < top) top = yy; if (yy > bot) bot = yy; if (xx < left) left = xx; if (xx > right) right = xx; }
      const vis = { l: r.left + left / 180 * r.width, r: r.left + (right + 1) / 180 * r.width, t: r.top + top / 240 * r.height, b: r.top + (bot + 1) / 240 * r.height };
      const core = { l: r.left + r.width * .40, r: r.left + r.width * .60, t: r.top + r.height * .15, b: r.top + r.height * .38 };
      const area = (core.r - core.l) * (core.b - core.t);
      item.vis = vis;
      item.outLeft = Math.max(0, stage.left - vis.l); item.outRight = Math.max(0, vis.r - (stage.left + usable)); item.outTop = Math.max(0, stage.top - vis.t); item.outBottom = Math.max(0, vis.b - (stage.top + stage.height));
      item.hudOv = hud.reduce((s, h) => s + rectOv(core, h), 0) / area; item.plateOv = plates.reduce((s, p) => s + rectOv(core, p), 0) / area;
      const cs = getComputedStyle(img), art = getComputedStyle(slot.querySelector('.st-art')), fig = getComputedStyle(slot.querySelector('.st-fig')), after = getComputedStyle(slot, '::after');
      item.boxless = art.backgroundColor === 'rgba(0, 0, 0, 0)' && fig.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.boxShadow === 'none' && cs.borderTopWidth === '0px' && art.boxShadow === 'none' && after.display === 'none';
      item.opacity = cs.opacity; item.animation = art.animationName; item.animationMs = parseFloat(art.animationDuration) * 1000;
    }
    out.push(item);
  }
  return { stage: [stage.left, stage.top, stage.width, stage.height], usable, items: out, brokenImages: [...document.querySelectorAll('#stage img, #stagePlates img')].filter((i) => i.complete && !i.naturalWidth && i.getAttribute('src')).length };
});
const num = (n) => Math.round(n);

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); if (REQUIRE) failed++; return finish(); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); if (REQUIRE) failed++; return finish(); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  const contexts = [];
  let real;
  try {
    real = (await (await fetch(BASE + '/api/role-sprites')).json());
    const realHas = (av, role) => !!(real.available[av] && real.available[av].includes(role));

    // ======================= A) minden felbontás =======================
    const SIZES = [[1920, 1080], [1366, 768], [1024, 768], [390, 844], [360, 640], [844, 390]];
    for (const [W, H] of SIZES) {
      const G = await startGame(browser, { width: W, height: H }); contexts.push(G.context);
      const { page } = G;
      await assign(page, MAP); await settle(page);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'roles-' + W + 'x' + H + '.png') }); }
      const m = await measure(page);
      const landscapePhone = H < 500;
      await check(W + '×' + H + ': mind az 5 szerep a saját avatár × szerep képével (a név a szerep-kép neve), betöltve, nincs törött kép', async () => {
        const want = { judge: 'avatar_06_judge.webp', prosecutor: 'avatar_04_prosecutor.webp', defendant: 'avatar_05_defendant.webp', witness: 'avatar_07_witness.webp' };
        for (const [role, file] of Object.entries(want)) {
          const it = m.items.find((x) => x.role === role); assert.ok(it, role + ': nincs a színpadon');
          assert.equal(it.src, file, role); assert.ok(it.sprite && it.loaded, role + ': szerep-kép betöltve');
        }
        const jurors = m.items.filter((x) => x.role === 'juror' && x.sprite);
        assert.ok(jurors.length >= 2, 'legalább 2 esküdt-kép: ' + jurors.length);
        for (const j of jurors) assert.match(j.src, /^avatar_(02|03|22|21)_juror\.webp$/, 'esküdt: ' + j.src);
        const defender = m.items.find((x) => x.role === 'defender'); assert.ok(defender && defender.portrait && defender.loaded, 'a védő (nincs külön védő-kép) az avatár portréja');
        assert.equal(m.brokenImages, 0, 'törött kép');
      });
      await check(W + '×' + H + ': a fej és az arc a színpadon belül (nincs levágott fej / oldal), a figurák nem lógnak ki', async () => {
        for (const it of m.items.filter((x) => x.sprite)) {
          assert.ok(it.outTop <= 1, it.role + ' feje kilóg felül: ' + num(it.outTop));
          assert.ok(it.outLeft <= 6 && it.outRight <= 6, it.role + ' (' + it.src + ') oldalt kilóg: ' + num(it.outLeft) + ' / ' + num(it.outRight));
          assert.ok(it.outBottom <= 1, it.role + ' alul kilóg: ' + num(it.outBottom));
          const eyeY = it.rect[1] + it.rect[3] * 0.285; assert.ok(eyeY > m.stage[1] + 40, it.role + ': a szem a felső sáv alatt kezdődik');
        }
      });
      await check(W + '×' + H + ': ' + (landscapePhone ? '' : 'az arcot a HUD és a névtábla nem takarja indokolatlanul (≤ 30%), ') + 'nincs téglalap-háttér / keret a karakter mögött', async () => {
        for (const it of m.items.filter((x) => x.sprite)) {
          assert.ok(it.boxless, it.role + ': háttér / keret / árnyék-doboz van a karakter mögött');
          if (!landscapePhone) { assert.ok(it.hudOv <= 0.3, it.role + ' (' + it.src + ') arcát a HUD takarja: ' + it.hudOv.toFixed(2)); assert.ok(it.plateOv <= 0.3, it.role + ' arcát névtábla takarja: ' + it.plateOv.toFixed(2)); }
        }
      });
      await check(W + '×' + H + ': nincs JavaScript-hiba', async () => { assert.deepEqual(G.errors, []); });

      // ---- elrendezés-stabilitás (nincs ugrálás): a figurák helye két mintavétel között nem változik ----
      await check(W + '×' + H + ': az elrendezés stabil (nincs ugrálás / layout shift a betöltés után)', async () => {
        const a = (await measure(page)).items.filter((x) => x.sprite).map((x) => x.slotRect);
        await page.waitForTimeout(700);
        const b = (await measure(page)).items.filter((x) => x.sprite).map((x) => x.slotRect);
        assert.equal(a.length, b.length);
        a.forEach((r, i) => r.forEach((v, k) => assert.ok(Math.abs(v - b[i][k]) <= 1.5, 'elmozdult: ' + i + '.' + k)));
      });
      await G.context.close();
    }

    // ======================= B) tartalék: nincs szerep-kép / hiányzó kép =======================
    {
      const G = await startGame(browser, { width: 1366, height: 768 }, { setup: async (page) => { await page.route('**/avatar_05_defendant.webp*', (r) => r.fulfill({ status: 404, body: 'nincs' })); } }); contexts.push(G.context);
      const { page } = G;
      await assign(page, { ...MAP, witness: 'av08' }); // az av08-nak nincs szerep-képe; az av05 vádlott-képe 404
      await settle(page); await page.waitForTimeout(900);
      const m = await measure(page);
      await check('Tartalék: szerep-kép nélküli avatár (av08 tanú) → az eredeti avatár + szerep-jelvény, betöltve', async () => {
        assert.ok(!realHas('av08', 'witness'), 'az av08 nem szerep-képes');
        const it = m.items.find((x) => x.role === 'witness'); assert.ok(it.portrait && !it.sprite, 'portré-tartalék');
        assert.equal(it.src, 'avatar_08.webp'); assert.ok(it.loaded, 'az eredeti avatár betöltve'); assert.ok(it.hasBadge, 'szerep-jelvény (HTML)');
      });
      await check('Hiányzó (404) szerep-kép: futás közben tartalékra vált (az eredeti avatár + jelvény), nincs törött kép, a többi szerep-kép marad', async () => {
        const d = m.items.find((x) => x.role === 'defendant');
        assert.ok(d.portrait && !d.sprite, 'a vádlott tartalékra váltott'); assert.equal(d.src, 'avatar_05.webp'); assert.ok(d.loaded && d.hasBadge);
        assert.equal(await page.evaluate(() => kbAvatarRoles.has('av05', 'defendant')), false, 'a hiányzó kép kikerült a készletből');
        assert.ok(m.items.find((x) => x.role === 'prosecutor').sprite, 'a prosecutor-kép marad');
        assert.equal(m.brokenImages, 0, 'törött kép');
        assert.deepEqual(G.errors, []);
      });
      await G.context.close();
    }

    // ======================= C) lassú betöltés + mozgáscsökkentés =======================
    {
      const G = await startGame(browser, { width: 1366, height: 768 }, { setup: async (page) => { await page.route(/\/assets\/roles\/avatar_0[4-7]_[a-z]+\.webp/, async (r) => { await new Promise((ok) => setTimeout(ok, 1800)); await r.continue(); }); } }); contexts.push(G.context);
      const { page } = G;
      await page.evaluate((m) => { KICKED_FROM_ROOM = true; }, MAP);
      const t0 = Date.now();
      await page.evaluate((m) => {
        const ids = { judge: S.currentJudgeId, prosecutor: S.prosecutorId, defendant: S.defendantId, witness: S.witnessId };
        S.players.forEach((p) => { for (const [r, id] of Object.entries(ids)) if (id === p.id && m[r]) p.avatar = m[r]; });
        document.getElementById('stage').dataset.key = ''; renderStage();
      }, MAP);
      await page.waitForTimeout(500);
      await check('Lassú képbetöltés: betöltésig a szerep-kép rejtett (nincs villanás / törött ikon / zöld-fehér folt), a slot nem ugrál', async () => {
        const mid = await page.evaluate(() => [...document.querySelectorAll('.stage-slot.sprite-slot')].map((s) => { const i = s.querySelector('.st-base'); return { role: s.dataset.role, op: getComputedStyle(i).opacity, ready: s.querySelector('.st-art').classList.contains('sprite-ready'), complete: i.complete, w: i.getBoundingClientRect().width }; }));
        assert.ok(mid.length >= 3, 'a lassú képek slotjai megvannak: ' + mid.length);
        for (const s of mid.filter((x) => !x.complete)) { assert.equal(s.op, '0', s.role + ': betöltés közben látszik'); assert.equal(s.ready, false); assert.ok(s.w > 20, 'a slot helye foglalt (nincs layout shift)'); }
        assert.ok(mid.some((x) => !x.complete), 'a teszt tényleg lassú betöltést látott');
      });
      await page.waitForFunction(() => [...document.querySelectorAll('.stage-slot.sprite-slot .st-art')].length >= 3 && [...document.querySelectorAll('.stage-slot.sprite-slot .st-art')].every((a) => a.classList.contains('sprite-ready')), null, { timeout: 15000 });
      await check('Lassú képbetöltés után: a kép belép (opacity 1, belépő animáció 250–450 ms szerepenként), nincs hiba', async () => {
        const after = await measure(page);
        for (const it of after.items.filter((x) => x.sprite)) { assert.equal(it.opacity, '1', it.role); assert.match(it.animation, /^spr-/, it.role + ' animáció: ' + it.animation); assert.ok(it.animationMs >= 250 && it.animationMs <= 450, it.role + ' időtartam: ' + it.animationMs); }
        assert.deepEqual(G.errors, []);
      });
      await G.context.close();
      const R = await startGame(browser, { width: 1366, height: 768 }, { reduced: true }); contexts.push(R.context);
      await assign(R.page, MAP); await settle(R.page);
      await check('Csökkentett mozgás: a belépő animáció kikapcsolva, a képek így is megjelennek', async () => {
        const m = await measure(R.page);
        for (const it of m.items.filter((x) => x.sprite)) { assert.equal(it.animation, 'none', it.role + ': ' + it.animation); assert.equal(it.opacity, '1'); }
        assert.ok(m.items.filter((x) => x.sprite).length >= 5);
      });
      await R.context.close();
    }

    // ======================= D) szerepváltás, bíró-csere, újratöltés =======================
    {
      const G = await startGame(browser, { width: 1366, height: 768 }); contexts.push(G.context);
      const { page } = G;
      await assign(page, MAP); await settle(page);
      await check('Szerepváltás (új kör): ugyanaz az avatár a másik szerep képét kapja; az előző szerep-kép nem marad ott', async () => {
        // az av04 (ügyész) lesz a tanú, az av07 (tanú) lesz az ügyész
        await page.evaluate(() => { const pr = S.prosecutorId, wi = S.witnessId; S.prosecutorId = wi; S.witnessId = pr; document.getElementById('stage').dataset.key = ''; renderStage(); });
        await settle(page);
        const m = await measure(page);
        assert.equal(m.items.find((x) => x.role === 'witness').src, 'avatar_04_witness.webp');
        assert.equal(m.items.find((x) => x.role === 'prosecutor').src, 'avatar_07_prosecutor.webp');
        assert.ok(!m.items.some((x) => x.src === 'avatar_04_prosecutor.webp' || x.src === 'avatar_07_witness.webp'), 'a régi szerep-kép nem maradt a színpadon');
        assert.equal(m.brokenImages, 0);
      });
      await check('Beszélő kiemelése: a beszélő karakter ragyog (glow-pulse a képen, enyhe nagyítás), a belépő animáció NEM játszódik le újra, a többi karakter halványul', async () => {
        const before = await page.evaluate(() => { const art = document.querySelector('.stage-slot[data-role="prosecutor"] .st-art'); return { running: art.getAnimations().filter((x) => x.playState === 'running').length }; });
        assert.equal(before.running, 0, 'a belépő már lefutott');
        await page.evaluate(() => { S.phase = 'prosecution'; renderStage(); });
        await page.waitForTimeout(250);
        const r = await page.evaluate(() => {
          const slot = document.querySelector('.stage-slot[data-role="prosecutor"]'), img = slot.querySelector('.st-base'), art = slot.querySelector('.st-art');
          return { speaking: slot.classList.contains('speaking'), glow: getComputedStyle(img).animationName, filter: getComputedStyle(img).filter, artScale: getComputedStyle(art).transform,
            entrance: art.getAnimations().filter((x) => x.animationName && x.animationName.startsWith('spr-') && x.playState === 'running').length,
            dimmed: document.querySelector('.stage-slot[data-role="defendant"]').classList.contains('dim') };
        });
        assert.ok(r.speaking, 'a beszélő slot kiemelt'); assert.equal(r.glow, 'glow-pulse'); assert.match(r.filter, /drop-shadow/);
        assert.notEqual(r.artScale, 'none', 'enyhe nagyítás'); assert.equal(r.entrance, 0, 'a belépő nem játszódott le újra'); assert.ok(r.dimmed, 'a többiek halványak');
        await page.evaluate(() => { S.phase = 'prep'; renderStage(); });
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => document.querySelector('.stage-slot[data-role="prosecutor"] .st-art').getAnimations().filter((x) => x.animationName && x.animationName.startsWith('spr-') && x.playState === 'running').length), 0, 'a beszéd végén sem játszódik le újra a belépő');
      });
      await check('Bíró-csere: az új bíró avatár × bíró képe jelenik meg (nincs villanás: az előző kép rejtve, az új betöltés után lép be); a korábbi bíró a közönséghez kerül', async () => {
        const before = await page.evaluate(() => ({ src: document.querySelector('#judge .st-base').getAttribute('src'), judge: S.currentJudgeId }));
        assert.match(before.src, /avatar_06_judge\.webp/);
        await page.evaluate(() => { const other = S.players.find((p) => p.avatar === 'av02'); S.currentJudgeId = other.id; renderStage(); });
        await settle(page);
        const after = await page.evaluate(() => ({ src: document.querySelector('#judge .st-base').getAttribute('src'), ready: document.querySelector('#judge .st-art').classList.contains('sprite-ready'), op: getComputedStyle(document.querySelector('#judge .st-base')).opacity, ok: document.querySelector('#judge .st-base').naturalWidth > 0 }));
        assert.match(after.src, /avatar_02_judge\.webp/); assert.ok(after.ready && after.ok); assert.equal(after.op, '1');
      });
      await G.context.close();
      // újratöltés (F5) valódi játék közben: ugyanaz a szoba, a szerver-állapot avatárjaival; a képek a szerver listája szerint (nincs kézi felülírás)
      const F = await startGame(browser, { width: 1366, height: 768 }); contexts.push(F.context);
      await check('Újratöltés (F5) játék közben: visszatér a játékba, a szerep-képek a szerver állapota szerint jelennek meg (szerep-kép, ha van; különben az avatár), nincs törött kép / hiba', async () => {
        await F.page.reload({ waitUntil: 'domcontentloaded' });
        await F.page.waitForFunction(() => document.body.dataset.screen === 'game' && S && S.players && S.players.length >= 6, null, { timeout: 25000 });
        await settle(F.page);
        const m = await measure(F.page);
        const avatars = await F.page.evaluate(() => Object.fromEntries(S.players.map((p) => [p.id, p.avatar])));
        const judgeId = await F.page.evaluate(() => S.currentJudgeId), rolesNow = await F.page.evaluate(() => ({ prosecutor: S.prosecutorId, defendant: S.defendantId, witness: S.witnessId }));
        for (const it of m.items) {
          if (!it.pid || !avatars[it.pid]) continue;
          const exp = realHas(avatars[it.pid], it.role);
          assert.equal(it.sprite, exp, it.role + ' (' + avatars[it.pid] + '): szerep-kép ' + it.sprite + ', várt ' + exp);
          assert.ok(it.loaded, it.role + ': betöltve');
        }
        const j = await F.page.evaluate(() => { const i = document.querySelector('#judge .st-base'); return { src: i.getAttribute('src'), ok: i.naturalWidth > 0 }; });
        assert.ok(j.ok, 'a bíró képe betöltve: ' + j.src); assert.ok(rolesNow.prosecutor && judgeId);
        assert.equal(m.brokenImages, 0); assert.deepEqual(F.errors, []);
      });
      await F.context.close();
    }

    // ======================= E) teli szoba (8 játékos) + hálózati kérések =======================
    for (const [W, H] of [[1366, 768], [390, 844]]) {
      const G = await startGame(browser, { width: W, height: H }, { bots: 7 }); contexts.push(G.context);
      const { page } = G;
      await check('Teli szoba (8 játékos) ' + W + '×' + H + ': ' + (W < 700 ? 'telefonon 2 esküdt-kép + "+N" jelzés' : 'az esküdtek a hátsó sorban') + ', minden figura a színpadon belül, nincs törött kép / hiba', async () => {
        await assign(page, MAP); await settle(page);
        const m = await measure(page);
        const jurors = m.items.filter((x) => x.role === 'juror');
        const players = await page.evaluate(() => S.players.filter((p) => p.connected).length);
        assert.equal(players, 8);
        const more = await page.evaluate(() => { const e = document.querySelector('.stage-jury-more'); return e ? e.textContent : ''; });
        if (W < 700) { assert.equal(jurors.length, 2, 'telefonon 2 esküdt'); assert.equal(more, '+1', 'a harmadik esküdt: ' + more); }
        else { assert.equal(jurors.length, 3, 'asztalon 3 esküdt'); assert.equal(more, ''); }
        for (const it of m.items.filter((x) => x.sprite)) assert.ok(it.outLeft <= 6 && it.outRight <= 6 && it.outTop <= 1, it.role + ' kilóg');
        assert.equal(m.brokenImages, 0); assert.deepEqual(G.errors, []);
      });
      if (W > 700) await check('Teljesítmény: a kliens csak a szükséges szerep-képeket kéri le (nem az összeset), és ugyanazt nem kéri újra', async () => {
        const urls = G.roleRequests.map((u) => u.split('/').pop().split('?')[0]);
        const distinct = new Set(urls);
        assert.ok(distinct.size <= 40, 'lekért szerep-képek: ' + distinct.size + ' (az összes 72 lenne)');
        assert.ok(urls.length <= distinct.size + 6, 'ismételt lekérések: ' + urls.length + ' / ' + distinct.size);
      });
      await G.context.close();
    }
  } finally {
    for (const c of contexts) { try { await c.close(); } catch (_) { /* */ } }
    await browser.close();
    server.kill();
  }
  finish();
})().catch((e) => { failed++; console.error(e.stack); finish(); });

function finish() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nSzerep-karakterek a courtroomban (böngésző): ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
}
