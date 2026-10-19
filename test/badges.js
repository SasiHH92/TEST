'use strict';
// ============================================================
// KAMU BÍRÓSÁG – kiérdemelhető jelvények (public/badges.js), a meglévő név szerinti statisztikából számolva
//  A) szabályok: a küszöbök (pl. 1 játék → Első tárgyalás; 10 → Veterán; 5 győzelem → Bajnok; 5× elítélve → Visszaeső); a sorrend a rang;
//     a kis sor legfeljebb N jelvényt mutat + "+M"; a profil-rács mind a 14-et mutatja (megszerzett / még elérhető)
//  B) új jelvény: az első alkalommal csak megjegyzi (a régiekről nem jelez); ha a számok nőnek, értesítés jön; ugyanarról kétszer nem
//  C) felület: a névválasztó kártyáján (legenda, előre feltöltött számokkal) és a lobbi plakátján (vendég, előre feltöltött számokkal) látszanak; nincs JS-hiba
// Futtatás: node test/badges.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }
const PORT = Number(process.env.BADGE_PORT || 3272), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-badges-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };
const zero = { vadlott: 0, bunos: 0, artatlan: 0, dijak: 0, jatek: 0, gyozelem: 0, pont: 0, korok: 0, ugyesz: 0, ugyeszSiker: 0, vedo: 0, vedoSiker: 0, biro: 0, tanu: 0, kihivas: 0 };

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(0); }
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let browser = null; for (const o of attempts) { try { browser = await chromium.launch({ headless: true, ...o }); break; } catch (_) { /* */ } }
  if (!browser) { console.log('SKIP: nincs böngésző.'); process.exit(0); }
  // előre feltöltött statisztika: egy legenda (a névválasztón) és egy vendég (a lobbiban)
  const legend = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'players.json'), 'utf8')).players[0].nev;
  const f = (x) => path.join(tmp, x);
  fs.writeFileSync(f('s.json'), JSON.stringify({
    [legend]: { ...zero, jatek: 12, gyozelem: 5, bunos: 6, korok: 30, pont: 40 },
    'Jelvényes Jenő': { ...zero, jatek: 3, gyozelem: 1, artatlan: 5, vadlott: 6, korok: 9 }
  }));
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  const errors = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { /* */ } await pause(150); }
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'hu-HU' });
    await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/');
    await page.waitForFunction(() => !!window.kbBadges);
    await check('A) küszöbök és sorrend: 1 játék → Első tárgyalás; 10 → Veterán; 5 győzelem → Bajnok (elöl); 5× elítélve → Visszaeső', async () => {
      const r = await page.evaluate(() => ({
        none: window.kbBadges.earned(null), one: window.kbBadges.earned({ jatek: 1 }),
        many: window.kbBadges.earned({ jatek: 10, gyozelem: 5, bunos: 5 }), n: window.kbBadges.list.length
      }));
      assert.deepEqual(r.none, []); assert.deepEqual(r.one, ['elso']);
      assert.deepEqual(r.many, ['bajnok', 'visszaeso', 'veteran', 'gyoztes', 'elso']);
      assert.equal(r.n, 14);
    });
    await check('A) kis sor: legfeljebb N jelvény + "+M"; profil-rács: mind a 14, a megszerzettek jelölve', async () => {
      const r = await page.evaluate(() => {
        const d = document.createElement('div');
        d.innerHTML = window.kbBadges.html({ jatek: 10, gyozelem: 5, bunos: 5 }, 2);
        const small = { shown: d.querySelectorAll('.kb-badge').length, more: (d.querySelector('.kb-badge-more') || {}).textContent };
        d.innerHTML = window.kbBadges.profileHtml({ jatek: 10, gyozelem: 5, bunos: 5 });
        return { small, all: d.querySelectorAll('.pb').length, got: d.querySelectorAll('.pb.got').length, head: d.querySelector('h4').textContent };
      });
      assert.deepEqual(r.small, { shown: 2, more: '+3' });
      assert.equal(r.all, 14); assert.equal(r.got, 5); assert.match(r.head, /5 \/ 14/);
    });
    await check('B) új jelvény: az első alkalommal csak megjegyzi; növekedéskor értesít; ugyanarról kétszer nem', async () => {
      const r = await page.evaluate(() => {
        localStorage.removeItem('kb_badges_seen:Teszt Tibor');
        const first = window.kbBadges.checkNew('Teszt Tibor', { jatek: 1 });
        const second = window.kbBadges.checkNew('Teszt Tibor', { jatek: 10 });
        const toast = (document.getElementById('toastBox') || {}).textContent || '';
        const third = window.kbBadges.checkNew('Teszt Tibor', { jatek: 10 });
        return { first, second, third, toast };
      });
      assert.deepEqual(r.first, []); assert.deepEqual(r.second, ['veteran']); assert.deepEqual(r.third, []);
      assert.match(r.toast, /Új jelvény.*Veterán/);
    });
    await check('C) a névválasztón a legenda kártyáján látszanak a jelvényei', async () => {
      await page.click('#authGuest');
      await page.waitForFunction(() => document.body.dataset.screen === 'name');
      await page.waitForFunction((n) => [...document.querySelectorAll('.mug-card')].some((c) => c.textContent.includes(n) && c.querySelector('.kb-badge')), legend, { timeout: 8000 });
      const icons = await page.evaluate((n) => { const c = [...document.querySelectorAll('.mug-card')].find((x) => x.textContent.includes(n)); return [...c.querySelectorAll('.kb-badge')].map((b) => b.textContent); }, legend);
      assert.deepEqual(icons, ['👑', '🦹', '⚖️'], 'a 3 legrangosabb: ' + icons.join(' '));
    });
    await check('C) a lobbi plakátján a vendég jelvényei látszanak (a szerver a statisztikát a profilhoz csatolja)', async () => {
      await page.evaluate(() => document.getElementById('btnNewSuspect').click()); await page.fill('#guestName', 'Jelvényes Jenő');
      await page.evaluate(() => document.getElementById('btnGuestGo').click()); await page.waitForFunction(() => document.body.dataset.screen === 'menu');
      await page.evaluate(() => document.getElementById('btnCreate').click()); await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
      await page.waitForFunction(() => document.querySelector('.poster .p-badges .kb-badge'), null, { timeout: 8000 });
      const icons = await page.evaluate(() => [...document.querySelector('.poster .p-badges').querySelectorAll('.kb-badge')].map((b) => b.textContent));
      assert.deepEqual(icons, ['😇', '🥇', '🎖️']);
    });
    await check('nincs JS-hiba', async () => { assert.deepEqual(errors, []); });
    await context.close();
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nJelvények: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
