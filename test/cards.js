'use strict';
// ============================================================
// KAMU BÍRÓSÁG – KÁRTYÁIM (kártya-kéz) + a courtroom-takarás / duplikáció ellenőrzése valódi böngészőben (Playwright)
//
//  A) kártya-kéz komponens (desktop): zárt pakli → nyitott legyező → kijelölés + nagyító, billentyűzet (Tab / Enter / nyilak / Esc), hosszú szöveg, +N,
//     típus-leképezés, ÚJ KÁRTYA jelzés, csökkentett mozgás
//  B) mobil (390×844): kis pakli → alsó tálca → nagyító, nincs vízszintes görgetés
//  C) valódi játék 3 desktop méreten (1366×768, 1920×1080, 1024×768) + mobilon: minden fázisban
//       - nincs nagy alsó időzítő (gyűrű), az idő pontosan EGYSZER látszik (felső sáv), az időzítő-logika él (HUD-idő a szerver lejáratához igazodik)
//       - a felkészülés alatt nincs panel (a közép szabad), a kártya-kéz a valódi (szerver által küldött) kártyákat mutatja
//       - tartós panel nem takarja a karaktereket (biztonságos zónák), a nagy overlayek közül egyszerre legfeljebb egy aktív,
//         a kihívás-kártya a kompakt ellenőrző sáv megjelenésekor már nincs a jelenetben
//
// Futtatás:  npm run test:cards
// Böngésző:  CHROMIUM_PATH=<futtatható fájl> – egyébként Edge / Chrome / Playwright Chromium; ha egyik sincs: SKIP (CARDS_REQUIRE=1 esetén hiba).
// Képernyőképek: CARDS_SHOTS=./QA_SCREENSHOTS
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.CARDS_PORT || 3197), BASE = 'http://127.0.0.1:' + PORT;
const SHOTS = process.env.CARDS_SHOTS ? path.resolve(process.env.CARDS_SHOTS) : '';
const REQUIRE = process.env.CARDS_REQUIRE === '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-cards-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky/i;

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) { try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ } }
  return null;
}
async function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
    AUTH_BASE_URL: BASE, DATABASE_URL: '', MAX_ROOMS_PER_IP: '30', /* a teszt több szobát nyit ugyanarról a címről */ AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'),
    KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'cards-' + name.replace(/[^a-z0-9._-]/gi, '_') + '.png') });
}

// ---- játék indítása egy vendéggel + 3 bottal; az időzítők a feladathoz igazítva ----
async function startGame(browser, viewport, opts) {
  const mobile = viewport.width < 700;
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'hu-HU', reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#authGuest'); await page.click('#authGuest');
  await page.waitForFunction(() => document.body.dataset.screen === 'name');
  await page.evaluate(() => document.getElementById('btnNewSuspect').click());
  await page.fill('#guestName', 'Kartya ' + viewport.width);
  await page.evaluate(() => document.getElementById('btnGuestGo').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'menu');
  await page.evaluate(() => document.getElementById('btnCreate').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
  for (let i = 0; i < 3; i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(220); }
  await page.evaluate((o) => {
    document.getElementById('btnCustomGame').click();
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('setSpeech', o.speech); set('setDefender', o.speech); set('setPrep', o.prep); set('setWitness', 10); set('setClosing', 10); set('setRounds', 1);
    const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
    document.getElementById('btnSaveSettings').click();
  }, opts);
  await page.waitForFunction((o) => S.settings.prepSeconds === o.prep, opts, { timeout: 6000 });
  await page.evaluate(() => document.getElementById('btnStartGame').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
  return { context, page, errors };
}

// szintetikus kártyák a valódi játékképernyőn (a client.js myCardList()-jét ideiglenesen felülírjuk; a szerver állapotát nem érinti)
const SYNTH = (n, long, tag) => Array.from({ length: n }, (_, i) => ({
  id: 'syn' + (tag || '') + (long ? 'L' : '') + ':' + i, type: ['evidence', 'witness', 'challenge', 'alibi', 'trick', 'evidence', 'challenge'][i % 7],
  content: long && i === 1 ? 'Nagyon hosszú kártyaszöveg, amely sok sorra tördelődik, és nem csúszhat ki a keretből. '.repeat(6) : ['Egy darabokra tört zongora a folyosón.', 'Te voltál a villager.', 'Beszélj úgy, mint aki épp egy creeper előtt áll.',
    'Egy szekrényben bujkáltál, onnan semmit nem láttál.', 'Tilos az "igen" és a "nem" szó.', 'A kacsa vallomása.', 'Minden mondatod kérdés legyen.'][i % 7],
  visibility: 'private', caseNumber: 'B.0000/26', number: i < 3 ? i + 1 : 0, subtitle: 'Teszt'
}));
const useCards = (page, cards) => page.evaluate((c) => { window.__realCards = window.__realCards || window.myCardList; window.myCardList = () => c; renderMyCardsBar(); }, cards);
const useReal = (page) => page.evaluate(() => { if (window.__realCards) window.myCardList = window.__realCards; renderMyCardsBar(); });
const clickCard = async (page, i) => {
  const pt = await page.evaluate((idx) => {
    const c = document.querySelector('#chStage .court-card[data-i="' + idx + '"]'), r = c.getBoundingClientRect();
    for (let y = r.top + 6; y < r.bottom - 6; y += 5) for (let x = r.left + 4; x < r.right - 4; x += 5) { const e = document.elementFromPoint(x, y); if (e && e.closest('.court-card') === c) return { x, y }; }
    return null;
  }, i);
  assert.ok(pt, 'a lapnak nincs kattintható (nem takart) része: ' + i);
  await page.mouse.click(pt.x, pt.y);
};
const handState = (page) => page.evaluate(() => kbCards.state());
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const inside = (r, vw, vh) => r && r.l >= -1 && r.t >= -1 && r.r <= vw + 1 && r.b <= vh + 1;

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(REQUIRE ? 1 : 0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(REQUIRE ? 1 : 0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  const open = [];
  try {
    // ======================= A) DESKTOP: a kártya-kéz komponens =======================
    const D = await startGame(browser, { width: 1366, height: 768 }, { prep: 90, speech: 15 }); open.push(D.context);
    await D.page.evaluate(() => { const b = document.getElementById('iaAccRead'); if (b) b.click(); });
    await D.page.waitForFunction(() => S.phase === 'prep', null, { timeout: 20000 });
    await D.page.waitForTimeout(3600); // a kör-intro és a bizonyíték-bemutató lefut
    const VW = 1366, VH = 768;

    await check('felkészülés: nincs nagy alsó időzítő-gyűrű, a felső sávban egyetlen idő látszik, a panel nincs renderelve (a közép szabad)', async () => {
      const r = await D.page.evaluate(() => {
        const times = [...document.querySelectorAll('#screen-game *')].filter((e) => e.children.length === 0 && /^\d+:\d\d$/.test(e.textContent.trim()) && e.offsetParent !== null).map((e) => e.id || e.className);
        const panel = document.getElementById('scenePanel');
        return { rings: document.querySelectorAll('.timer-ring, #timerBox').length, times, panelDisplay: getComputedStyle(panel).display, panelEmpty: panel.classList.contains('is-empty'),
          hud: (document.getElementById('rbTime') || {}).textContent || '', left: Math.max(0, (S.phaseEndsAt - (Date.now() + serverOffset)) / 1000) };
      });
      assert.equal(r.rings, 0, 'időzítő-gyűrű van a DOM-ban');
      assert.deepEqual(r.times, ['rbTime'], 'az idő nem pontosan egyszer látszik: ' + r.times);
      assert.equal(r.panelDisplay, 'none', 'a prep-panel nincs elrejtve');
      const [m, s] = r.hud.split(':').map(Number);
      assert.ok(Math.abs(m * 60 + s - r.left) <= 2.2, 'a felső időzítő nem a szerver ideje: ' + r.hud + ' vs ' + r.left.toFixed(1));
      await shot(D.page, 'prep-desktop');
    });
    await check('a kártya-kéz a SZERVER által küldött kártyákat mutatja (ugyanannyi, ugyanaz a szöveg); felkészülésnél magától kinyílik', async () => {
      const r = await D.page.evaluate(() => {
        const mine = [].concat(S.evidence || [], S.tricks || [], S.alibi ? [S.alibi] : [], S.witnessCard ? [S.witnessCard] : [], S.myChallenge ? [S.myChallenge] : []);
        const texts = [...document.querySelectorAll('#chStage .court-card[data-i] .cf-text')].map((e) => e.textContent);
        return { mine, texts, state: kbCards.state(), role: myRole() };
      });
      assert.deepEqual(r.texts.slice().sort(), r.mine.slice().sort(), 'a kéz tartalma eltér a szerver adatától (' + r.role + ')');
      if (r.mine.length) { assert.equal(r.state.visible, true); assert.equal(r.state.open, true, 'prep: a pakli magától kinyílik'); }
      else assert.equal(r.state.visible, false, 'kártya nélküli szerep: nincs kéz');
    });

    await useCards(D.page, SYNTH(3));
    await D.page.evaluate(() => kbCards.close()); await D.page.waitForTimeout(450);
    await check('zárt pakli: kompakt (bal alsó sarok), a képernyőn belül, 3 lap egymás mögött, a számláló és a címke látszik; nem takar karaktert', async () => {
      const s = await handState(D.page), r = await rect(D.page, '#myCardsBar'), t = await D.page.textContent('#chToggle');
      assert.equal(s.open, false); assert.equal(s.count, 3);
      assert.ok(inside(r, VW, VH), 'a kéz kilóg: ' + JSON.stringify(r));
      assert.ok(r.w <= 270 && r.h <= 170, 'a zárt pakli nem kompakt: ' + Math.round(r.w) + '×' + Math.round(r.h));
      assert.ok(r.l < 40 && r.b > VH - 40, 'nem a bal alsó sarokban áll');
      assert.match(t, /KÁRTYÁIM/); assert.match(t, /3/);
      assert.equal(await D.page.getAttribute('#chToggle', 'aria-expanded'), 'false');
      const rot = await D.page.evaluate(() => [...document.querySelectorAll('#chStage .court-card[data-i]')].map((e) => getComputedStyle(e).transform));
      assert.equal(new Set(rot).size, 3, 'a lapok transzformációi nem különböznek (nincs "csúsztatott" pakli)');
      await shot(D.page, 'hand-closed');
    });
    await check('nyitott legyező: a lapok szétnyílnak (különböző helyen, a képernyőn belül, a ribbon fölött), felfelé és jobbra; a kézen kívül kattintva becsukódik', async () => {
      await D.page.click('#chToggle'); await D.page.waitForTimeout(500);
      const s = await handState(D.page);
      assert.equal(s.open, true);
      assert.equal(await D.page.getAttribute('#chToggle', 'aria-expanded'), 'true');
      const rs = await D.page.evaluate(() => [...document.querySelectorAll('#chStage .court-card[data-i]')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
      assert.equal(new Set(rs.map((r) => Math.round(r[0]))).size, 3, 'a lapok vízszintesen nem nyílnak szét');
      assert.ok(rs.every((r) => r[0] >= 0 && r[1] >= 0 && r[2] <= VW && r[3] <= VH), 'a legyező kilóg: ' + JSON.stringify(rs));
      assert.ok(rs[2][0] > rs[0][0], 'a legyező nem jobbra nyílik');
      assert.ok(Math.max(...rs.map((r) => r[1])) < VH - 120, 'a lapok nem emelkednek fel');
      await shot(D.page, 'hand-open');
      await D.page.mouse.click(700, 330); await D.page.waitForTimeout(300);
      assert.equal((await handState(D.page)).open, false, 'a kézen kívüli kattintás nem csukta be');
    });
    await check('kijelölés + nagyító: a lapra kattintva előre jön és a nagyító a TELJES szöveget mutatja; Esc előbb a nagyítót, aztán a kezet zárja; a fókusz visszatér', async () => {
      await D.page.evaluate(() => kbCards.close()); await D.page.click('#chToggle'); await D.page.waitForTimeout(400);
      await clickCard(D.page, 1); await D.page.waitForTimeout(450);
      let s = await handState(D.page);
      assert.equal(s.selected, 1); assert.equal(s.preview, true);
      const pv = await D.page.evaluate(() => ({ vis: !document.getElementById('cardPreview').classList.contains('hidden'), text: document.querySelector('#cardPreview .cf-text').textContent,
        sel: document.querySelectorAll('#chStage .court-card.sel').length, r: (() => { const b = document.getElementById('cardPreview').getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; })() }));
      assert.ok(pv.vis); assert.equal(pv.sel, 1); assert.match(pv.text, /villager/);
      assert.ok(pv.r[0] >= 0 && pv.r[1] >= 60 && pv.r[2] <= VW && pv.r[3] <= VH, 'a nagyító kilóg / a felső sávba nyúlik: ' + JSON.stringify(pv.r));
      await shot(D.page, 'hand-preview');
      // a nagyító gombjai (léptetés, ✕) nem csukhatják be a kezet (a nagyító újrarajzolódik kattintáskor)
      await D.page.click('#cardPreview [data-act="next"]'); await D.page.waitForTimeout(200);
      s = await handState(D.page);
      assert.equal(s.selected, 2, 'a léptetés nem a következő lapra ugrott'); assert.equal(s.open, true, 'a léptetés bezárta a kezet'); assert.equal(s.preview, true);
      await D.page.click('#cardPreview [data-act="close"]'); await D.page.waitForTimeout(200);
      s = await handState(D.page);
      assert.equal(s.preview, false); assert.equal(s.open, true, 'a nagyító ✕ gombja bezárta a kezet is');
      await clickCard(D.page, 1); await D.page.waitForTimeout(300);
      assert.equal((await handState(D.page)).preview, true);
      await D.page.keyboard.press('Escape'); await D.page.waitForTimeout(250);
      s = await handState(D.page);
      assert.equal(s.preview, false); assert.equal(s.open, true, 'az első Esc csak a nagyítót zárja');
      await D.page.keyboard.press('Escape'); await D.page.waitForTimeout(250);
      assert.equal((await handState(D.page)).open, false, 'a második Esc zárja a kezet');
    });
    await check('billentyűzet: a szalag fókuszolható és Enterre nyit, a nyilak a lapok közt lépnek, Enter kijelöl (nagyító), látható fókusz', async () => {
      await D.page.evaluate(() => kbCards.close());
      await D.page.focus('#chToggle');
      await D.page.keyboard.press('Enter'); await D.page.waitForTimeout(400);
      assert.equal((await handState(D.page)).open, true);
      await D.page.focus('#chStage .court-card[data-i="0"]');
      await D.page.keyboard.press('ArrowRight');
      assert.equal(await D.page.evaluate(() => document.activeElement.dataset.i), '1');
      const outline = await D.page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth);
      assert.ok(!/^none/.test(outline), 'nincs látható fókusz: ' + outline);
      await D.page.keyboard.press('Enter'); await D.page.waitForTimeout(300);
      const s = await handState(D.page);
      assert.equal(s.selected, 1); assert.equal(s.preview, true);
      const labels = await D.page.evaluate(() => [...document.querySelectorAll('#chStage .court-card[data-i]')].map((e) => e.getAttribute('aria-label')));
      assert.ok(labels.every((l) => /csak te látod/i.test(l)), 'a privát kártya nem jelzi a hozzáférhető címkében: ' + labels[0]);
      await D.page.keyboard.press('Escape'); await D.page.keyboard.press('Escape');
    });
    await check('kártya-típusok: minden típus a saját stílus-osztályát kapja (evidence / witness / challenge / alibi / trick); role és special előkészítve, de játékhoz nem kötött', async () => {
      const r = await D.page.evaluate(() => ({ cls: [...document.querySelectorAll('#chStage .court-card[data-i]')].map((e) => e.className.match(/\bt-(evidence|witness|challenge|alibi|trick|role|special)\b/)[1]), types: Object.keys(kbCards.TYPES),
      }));
      assert.deepEqual(r.cls, ['evidence', 'witness', 'challenge']);
      for (const t of ['evidence', 'witness', 'challenge', 'alibi', 'trick', 'role', 'special']) assert.ok(r.types.includes(t), 'hiányzó típus: ' + t);
      const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
      const body = code.slice(code.indexOf('function myCardList'), code.indexOf('function renderMyCardsBar'));
      const used = [...body.matchAll(/add\('(\w+)'/g)].map((m) => m[1]);
      assert.deepEqual([...new Set(used)].sort(), ['alibi', 'challenge', 'evidence', 'trick', 'witness'], 'a játékhoz kötött típusok: ' + used);
    });
    await check('hosszú szöveg: a lap nem csúszik ki (a szöveg a kereten belül marad), a nagyítóban a teljes szöveg olvasható; több mint 5 lapnál "+N" jelzés', async () => {
      await useCards(D.page, SYNTH(7, true));
      await D.page.evaluate(() => { kbCards.close(); kbCards.open(); }); await D.page.waitForTimeout(450);
      const r = await D.page.evaluate(() => {
        const cards = [...document.querySelectorAll('#chStage .court-card[data-i]')].filter((e) => e.offsetParent !== null);
        const over = cards.filter((e) => { const t = e.querySelector('.cf-text'); const c = e.getBoundingClientRect(); return t && (t.getBoundingClientRect().bottom > c.bottom + 1 || t.getBoundingClientRect().right > c.right + 1); }).length;
        const more = document.querySelector('#chStage .court-card.more');
        return { visible: cards.length, over, more: more && more.offsetParent !== null ? more.textContent : '' };
      });
      assert.equal(r.over, 0, 'szöveg kilóg a lapból');
      assert.ok(r.visible <= 5 - 1, 'egyszerre legfeljebb 4 lap + a "+N" lap: ' + r.visible);
      assert.equal(r.more, '+3');
      await D.page.evaluate(() => kbCards.select(1, true)); await D.page.waitForTimeout(300);
      const full = await D.page.evaluate(() => document.querySelector('#cardPreview .cf-text').textContent);
      assert.ok(full.length > 300, 'a nagyító nem a teljes szöveget mutatja: ' + full.length);
      await D.page.evaluate(() => kbCards.close());
    });
    await check('ÚJ KÁRTYA: a megérkező lap jelzést kap (nincs modal), a jelzés 1–2 mp után eltűnik; ugyanaz a lap újra nem "új"', async () => {
      await useCards(D.page, SYNTH(2, false, 'N')); await D.page.waitForTimeout(150);
      await useCards(D.page, SYNTH(3, false, 'N'));
      const on = await D.page.evaluate(() => ({ badge: document.getElementById('myCardsBar').classList.contains('has-new'), isNew: document.querySelectorAll('#chStage .is-new').length, modal: document.querySelectorAll('.modal:not(.hidden), dialog[open]').length }));
      assert.equal(on.badge, true); assert.ok(on.isNew >= 1, 'nincs .is-new lap'); assert.equal(on.modal, 0, 'nem lehet modal');
      await D.page.waitForTimeout(2600);
      const off = await D.page.evaluate(() => ({ badge: document.getElementById('myCardsBar').classList.contains('has-new'), isNew: document.querySelectorAll('#chStage .is-new').length }));
      assert.equal(off.badge, false); assert.equal(off.isNew, 0);
      await useCards(D.page, SYNTH(3, false, 'N'));
      assert.equal(await D.page.evaluate(() => document.getElementById('myCardsBar').classList.contains('has-new')), false, 'ugyanaz a lap újra "új"');
    });
    await check('csökkentett mozgás: a legyező azonnal nyílik (nincs átmenet / animáció), a funkció megmarad', async () => {
      await D.page.evaluate(() => charAnim.setReducedMotion(true));
      await useCards(D.page, SYNTH(4));
      await D.page.evaluate(() => { kbCards.close(); kbCards.open(); });
      const r = await D.page.evaluate(() => { const c = document.querySelector('#chStage .court-card[data-i="2"]'); const s = getComputedStyle(c); return { dur: s.transitionDuration, anim: s.animationName, open: kbCards.state().open }; });
      assert.ok(/^0s(, 0s)*$/.test(r.dur), 'átmenet fut: ' + r.dur); assert.equal(r.anim, 'none'); assert.equal(r.open, true);
      await D.page.evaluate(() => { kbCards.close(); charAnim.setReducedMotion(false); });
    });
    await useReal(D.page);
    await check('nincs JavaScript-hiba (desktop)', async () => assert.deepEqual(D.errors, [], D.errors.join(' | ')));

    // ======================= B) MOBIL: tálca =======================
    const M = await startGame(browser, { width: 390, height: 844 }, { prep: 90, speech: 15 }); open.push(M.context);
    await M.page.evaluate(() => { const b = document.getElementById('iaAccRead'); if (b) b.click(); });
    await M.page.waitForFunction(() => S.phase === 'prep', null, { timeout: 20000 });
    await M.page.waitForTimeout(3600);
    await useCards(M.page, SYNTH(5));
    await M.page.evaluate(() => kbCards.close()); await M.page.waitForTimeout(400);
    await check('mobil: zárt pakli kicsi (nem tölti ki a képernyőt), a képernyőn belül, nincs vízszintes görgetés', async () => {
      const r = await rect(M.page, '#myCardsBar'), sw = await M.page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(inside(r, 390, 844), 'kilóg: ' + JSON.stringify(r));
      assert.ok(r.h <= 100 && r.w <= 170, 'a mobil pakli túl nagy: ' + Math.round(r.w) + '×' + Math.round(r.h));
      assert.ok(sw <= 391, 'vízszintes görgetés: ' + sw);
      await shot(M.page, 'mobile-closed');
    });
    await check('mobil: koppintásra alsó tálca (vízszintesen görgethető, nem 5 nagy lap a fél képernyőn), koppintás a lapra → nagyító, ✕ / Esc zár', async () => {
      await M.page.tap('#chToggle'); await M.page.waitForTimeout(450);
      const r = await M.page.evaluate(() => { const st = document.getElementById('chStage'); const h = document.getElementById('myCardsBar').getBoundingClientRect(); return { open: kbCards.state().open, scrollable: st.scrollWidth > st.clientWidth, h: h.height, top: h.top, bottom: h.bottom, sw: document.documentElement.scrollWidth }; });
      assert.equal(r.open, true); assert.ok(r.scrollable, '5 lap, de a tálca nem görgethető'); assert.ok(r.h <= 180, 'a tálca túl magas: ' + r.h); assert.ok(r.bottom <= 844 && r.sw <= 391);
      await shot(M.page, 'mobile-tray');
      await M.page.tap('#chStage .court-card[data-i="1"]'); await M.page.waitForTimeout(400);
      const p = await M.page.evaluate(() => { const b = document.getElementById('cardPreview').getBoundingClientRect(); return { vis: !document.getElementById('cardPreview').classList.contains('hidden'), r: [b.left, b.top, b.right, b.bottom], text: document.querySelector('#cardPreview .cf-text').textContent }; });
      assert.ok(p.vis); assert.ok(p.r[0] >= 0 && p.r[2] <= 391 && p.r[1] >= 60 && p.r[3] <= 844, 'a nagyító kilóg: ' + JSON.stringify(p.r)); assert.match(p.text, /villager/);
      await shot(M.page, 'mobile-preview');
      await M.page.tap('#cardPreview .cp-x'); await M.page.waitForTimeout(250);
      assert.equal((await handState(M.page)).preview, false);
      await M.page.tap('#chToggle'); await M.page.waitForTimeout(250);
      assert.equal((await handState(M.page)).open, false);
    });
    await check('mobil: a szerep-füzet és a kéz nem fedik egymást, a ponttábla-sáv szabad', async () => {
      const r = await M.page.evaluate(() => { const q = (s) => { const e = document.querySelector(s); if (!e || e.classList.contains('hidden') || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
        return { hand: q('#myCardsBar'), brief: q('#judgeWatchBar'), side: q('#sbToggle') }; });
      if (r.hand && r.side) assert.ok(r.hand.b <= r.side.t + 1, 'a kéz a ponttábla-sávra lóg: ' + JSON.stringify(r));
      if (r.hand && r.brief) assert.ok(r.brief.b <= r.hand.t || r.brief.r <= r.hand.l || r.hand.r <= r.brief.l, 'a füzet és a kéz fedik egymást');
    });
    await useReal(M.page);
    await check('nincs JavaScript-hiba (mobil)', async () => assert.deepEqual(M.errors, [], M.errors.join(' | ')));
    await D.context.close(); await M.context.close();

    // ======================= C) VALÓDI JÁTÉK: fázisonként, több méreten =======================
    const VPS = [{ width: 1366, height: 768, full: true }, { width: 1920, height: 1080, full: true }, { width: 1440, height: 900, full: true }, { width: 1024, height: 768, full: true },
      { width: 390, height: 844, full: false }, { width: 360, height: 800, full: false }];
    const games = await Promise.all(VPS.map(async (vp) => ({ vp, g: await startGame(browser, { width: vp.width, height: vp.height }, { prep: 12, speech: 15 }) })));
    for (const x of games) open.push(x.g.context);
    // minden játékos külön, párhuzamosan játssza végig a kört; közben 250 ms-onként méri a képernyőt
    const sample = () => {
      const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
      const R = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
      const out = { phase: S.phase, role: myRole(), problems: [], info: {} };
      const panel = document.getElementById('scenePanel'), pc = panel && panel.querySelector('.phase-content');
      const panelShown = !!pc && !panel.classList.contains('is-empty') && vis(pc) && getComputedStyle(panel).visibility !== 'hidden';
      // duplikáció: gyűrű, ismétlődő idő
      const rings = document.querySelectorAll('.timer-ring, #timerBox').length;
      if (rings) out.problems.push('időzítő-gyűrű a DOM-ban: ' + rings);
      const times = [...document.querySelectorAll('#screen-game *')].filter((e) => e.children.length === 0 && /^\d+:\d\d$/.test(e.textContent.trim()) && vis(e)).map((e) => e.id || e.className);
      if (times.length > 1) out.problems.push('az idő többször látszik: ' + times.join(','));
      if (S.phase === 'prep' && panelShown) out.problems.push('prep: panel látszik');
      // szerep-útmutató: a bíró / esküdt felkészülési szövege nem lehet a panelben
      if (panelShown && /Kávészünet|Te vagy ebben a körben a BÍRÓ|Figyeljetek a (vád|véd)/.test(pc.innerText)) out.problems.push('szerep-útmutató a panelben (duplikáció): ' + pc.innerText.slice(0, 50));
      // nagy overlayek: egyszerre legfeljebb egy
      const majors = ['courtIntro', 'courtEvidence', 'courtChallenge', 'courtVerdict'].filter((id) => { const e = document.getElementById(id); return e && e.classList.contains('show'); });
      if (majors.length > 1) out.problems.push('egyszerre több nagy overlay: ' + majors.join(','));
      out.info.majors = majors;
      // kihívás-ellenőrzés: a nagy kártya és a kompakt sáv nem látszik egyszerre
      const strip = document.querySelector('#scenePanel .rv-strip, #scenePanel .cv-strip');
      if (strip && panelShown && majors.includes('courtChallenge')) out.problems.push('kihívás-kártya és ellenőrző sáv egyszerre látszik');
      // biztonságos zónák: tartós UI nem takarja a karaktereket (átmeneti overlay és kinyitott kéz alatt nem mérünk)
      // (a végeredmény-képernyő szándékosan a jelenet közepén áll: a játék véget ért, a végső pontlista és a díjak az esemény)
      if (!majors.length && !document.body.dataset.courtMajor && S.phase !== 'game_over') {
        const figs = [...document.querySelectorAll('#stageSlots .stage-slot[data-role]:not([data-role="juror"]) .st-art, #judge .st-art')].filter(vis).map((e) => ({ role: (e.closest('[data-role]') || {}).dataset.role, r: R(e) })).filter((f) => f.r.w > 20);
        const ui = [];
        if (panelShown) ui.push({ name: 'panel', r: R(pc) });
        const hand = document.getElementById('myCardsBar');
        if (vis(hand) && hand.dataset.state === 'closed') ui.push({ name: 'kéz (zárt)', r: R(hand) });
        for (const f of figs) for (const u of ui) {
          const ratio = area(f.r, u.r) / Math.max(1, f.r.w * f.r.h);
          if (ratio > 0.12) out.problems.push(u.name + ' takarja: ' + f.role + ' (' + Math.round(100 * ratio) + '%)');
        }
      }
      return out;
    };
    const stop = { v: false };
    const logs = games.map(() => ({ phases: new Set(), problems: [], counts: 0 }));
    await Promise.all(games.map(async ({ vp, g }, k) => {
      const t0 = Date.now();
      let iaRead = 0;
      while (Date.now() - t0 < 150000) {
        let st;
        try { st = await g.page.evaluate(sample); } catch (_) { await pause(300); continue; }
        logs[k].counts++; logs[k].phases.add(st.phase);
        for (const p of st.problems) if (!logs[k].problems.some((x) => x.startsWith(st.phase + ': ' + p))) logs[k].problems.push(st.phase + ': ' + p);
        if (vp.full && logs[k].counts % 9 === 1 && ['prep', 'challenge_review', 'verdict_vote'].includes(st.phase) && !logs[k]['shot' + st.phase]) { logs[k]['shot' + st.phase] = 1; await shot(g.page, 'game-' + vp.width + 'x' + vp.height + '-' + st.phase); }
        if (st.phase === 'round_results') logs[k].rrAt = logs[k].rrAt || Date.now(); // a kör végének időt hagyunk, hogy mérhető legyen
        const wait = st.phase === 'round_results' && Date.now() - logs[k].rrAt < 1600;
        await g.page.evaluate((skipNext) => { for (const id of ['iaAccRead', 'iaDone', skipNext ? '' : 'btnNextRound', 'rvDone', 'voteGuilty', 'cv0Yes', 'cv1Yes', 'objAccept']) { const b = id && document.getElementById(id); if (b && !b.disabled) { b.click(); break; } } }, wait).catch(() => {});
        if (st.phase === 'verdict') { logs[k].verdictAt = logs[k].verdictAt || Date.now(); if (Date.now() - logs[k].verdictAt > 4800) await g.page.evaluate(() => { const b = document.getElementById('btnProceed'); if (b && !b.disabled) b.click(); }).catch(() => {}); }
        if (st.phase === 'game_over') break;
        await pause(250);
      }
    }));
    for (let k = 0; k < games.length; k++) {
      const { vp } = games[k];
      await check(vp.width + '×' + vp.height + ': a játék minden fázisában nincs duplikált idő / gyűrű, nincs takarás, egyszerre legfeljebb egy nagy overlay', async () => {
        const need = ['prep', 'prosecution', 'defense', 'verdict_vote', 'round_results'];
        for (const ph of need) assert.ok(logs[k].phases.has(ph), 'a fázis nem volt mérhető: ' + ph + ' (volt: ' + [...logs[k].phases].join(',') + ')');
        const relevant = vp.full ? logs[k].problems : logs[k].problems.filter((p) => !/takarja/.test(p)); // mobilon a jelenet kicsi: a takarás-mérés csak a duplikációra / overlayekre vonatkozik
        assert.deepEqual(relevant, [], relevant.join(' | '));
      });
      await check(vp.width + '×' + vp.height + ': nincs JavaScript-hiba a játék alatt', async () => assert.deepEqual(games[k].g.errors, [], games[k].g.errors.join(' | ')));
    }
  } catch (e) {
    failed++; console.error('FAIL: a teszt megszakadt: ' + (e && e.stack || e));
  } finally {
    for (const c of open) await c.close().catch(() => {});
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(`\nKártyák: ${passed} sikeres, ${failed} hibás.`);
  process.exit(failed ? 1 : 0);
})();
