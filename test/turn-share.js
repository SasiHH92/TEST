'use strict';
// ============================================================
// KAMU BÍRÓSÁG – "Te jössz!" jelzés (public/turn-alert.js) és Megosztás gomb (Web Share API)
//  A) jelzés: a saját beszéd, a tiltakozásról döntés (bíró), szavazás, kihívás-ellenőrzés (bíró), válasz a kérdésre: egyszer rezeg + "ding" + értesítés;
//     ugyanarra nem ismétel; más beszédére nincs jelzés; háttérben nincs rezgés, a visszatéréskor jelez; kb_vibrate = '0': nincs rezgés (a hang marad);
//     néző módban nincs jelzés
//  B) megosztás: ha van navigator.share, a lobbiban látszik a 📤 Megosztás gomb, és a szobalinket osztja meg; ha nincs, a gomb rejtve
// Futtatás: node test/turn-share.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }
const PORT = Number(process.env.TURN_PORT || 3268), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-turn-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };

// rögzítő rezgés / megosztás (a valódi API helyett): window.__vib, window.__share
function fakes() {
  window.__vib = []; window.__share = [];
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__vib.push(p); return true; } });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__share.push(d); } });
}
function setVisibility(v) { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); }

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(0); }
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let browser = null; for (const o of attempts) { try { browser = await chromium.launch({ headless: true, ...o }); break; } catch (_) { /* */ } }
  if (!browser) { console.log('SKIP: nincs böngésző.'); process.exit(0); }
  const f = (x) => path.join(tmp, x);
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { /* */ } await pause(150); }
    const ctxOpts = { viewport: { width: 800, height: 360 }, isMobile: true, hasTouch: true, locale: 'hu-HU' };
    const errors = [];
    // ---------- A) "Te jössz!" ----------
    {
      const context = await browser.newContext(ctxOpts);
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
      await context.addInitScript(fakes);
      const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.kbTurnAlert && window.kbSound, null, { timeout: 8000 });
      await page.evaluate(() => { window.__snd = []; const orig = window.kbSound.play; window.kbSound.play = (n) => { window.__snd.push(n); try { orig(n); } catch (_) { /* */ } }; MY.playerId = 'u1'; });
      // állapot beállítása és a 'kb:state' esemény (amit a client.js minden állapot után küld)
      const put = (st) => page.evaluate((s) => { S = Object.assign({ players: [], round: 1, caseNo: 'T-1' }, s); document.dispatchEvent(new CustomEvent('kb:state')); }, st);
      const got = () => page.evaluate(() => ({ vib: window.__vib.length, snd: window.__snd.filter((n) => n === 'ding').length, toast: (document.getElementById('toastBox') || {}).textContent || '' }));
      await check('A) a saját vádbeszéd: egyszer rezeg, csippan, és kiírja ("Te jössz")', async () => {
        await put({ phase: 'prosecution', prosecutorId: 'u1', defendantId: 'u2' }); await pause(150);
        const g = await got();
        assert.equal(g.vib, 1); assert.equal(g.snd, 1); assert.match(g.toast, /Te jössz.*vádbeszéd/);
        await put({ phase: 'prosecution', prosecutorId: 'u1', defendantId: 'u2' }); await pause(150);
        assert.equal((await got()).vib, 1, 'ugyanarra nem ismétel');
      });
      await check('A) más beszédére nincs jelzés; a saját zárószóra újra jelez', async () => {
        await put({ phase: 'defense', prosecutorId: 'u1', defendantId: 'u2' }); await pause(150);
        assert.equal((await got()).vib, 1);
        await put({ phase: 'final_prosecution', prosecutorId: 'u1', defendantId: 'u2' }); await pause(150);
        assert.equal((await got()).vib, 2);
      });
      await check('A) szavazás (amíg nem szavazott) és tiltakozás-döntés bíróként: jelez', async () => {
        await put({ phase: 'verdict_vote', prosecutorId: 'u2', defendantId: 'u3', verdictVote: { canVote: true, myVote: null } }); await pause(150);
        assert.equal((await got()).vib, 3);
        await put({ phase: 'verdict_vote', prosecutorId: 'u2', defendantId: 'u3', verdictVote: { canVote: true, myVote: 'guilty' } }); await pause(150);
        assert.equal((await got()).vib, 3, 'szavazás után nincs újabb jelzés');
        await put({ phase: 'objection', currentJudgeId: 'u1', objectionData: { phase: 'judge', objectorId: 'u3', speakerId: 'u2' } }); await pause(150);
        assert.equal((await got()).vib, 4);
        assert.match((await got()).toast, /TILTAKOZOM/);
      });
      await check('A) háttérben nincs rezgés; visszatéréskor jelez (ha a teendő még áll)', async () => {
        await page.evaluate(setVisibility, 'hidden');
        await put({ phase: 'challenge_review', challengeReview: { current: 0, challenges: [{ who: 'defendant', iAmJudge: true, judged: false }] } }); await pause(150);
        assert.equal((await got()).vib, 4, 'háttérben nem rezgett');
        await page.evaluate(setVisibility, 'visible'); await pause(150);
        assert.equal((await got()).vib, 5, 'visszatéréskor jelzett');
        assert.match((await got()).toast, /kihívást/);
      });
      await check('A) kb_vibrate = 0: nincs rezgés, de a hang és az értesítés marad (kérdésre válasz)', async () => {
        await page.evaluate(() => localStorage.setItem('kb_vibrate', '0'));
        const before = await got();
        await put({ phase: 'jury_question', juryQuestion: { canAnswer: true, picks: [] } }); await pause(150);
        const g = await got();
        assert.equal(g.vib, before.vib, 'nem rezgett'); assert.equal(g.snd, before.snd + 1, 'csippant'); assert.match(g.toast, /Kérdést kaptál/);
      });
      await context.close();
    }
    // ---------- B) Megosztás ----------
    for (const withShare of [true, false]) {
      const context = await browser.newContext(ctxOpts);
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
      if (withShare) await context.addInitScript(fakes);
      else await context.addInitScript(() => { try { delete Navigator.prototype.share; } catch (_) { /* */ } Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
      const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE + '/');
      await page.waitForSelector('#authGuest'); await page.click('#authGuest');
      await page.waitForFunction(() => document.body.dataset.screen === 'name');
      await page.evaluate(() => document.getElementById('btnNewSuspect').click()); await page.fill('#guestName', withShare ? 'Megosztó Mia' : 'Asztali Aladár');
      await page.evaluate(() => document.getElementById('btnGuestGo').click()); await page.waitForFunction(() => document.body.dataset.screen === 'menu');
      await page.evaluate(() => document.getElementById('btnCreate').click()); await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
      await pause(300);
      if (withShare) {
        await check('a valódi szerver-állapot után a kliens kiadja a kb:state eseményt (erre figyel a "Te jössz!" jelzés)', async () => {
          await page.evaluate(() => { window.__kbState = 0; document.addEventListener('kb:state', () => { window.__kbState++; }); });
          await page.evaluate(() => document.getElementById('btnAddBot').click());
          await page.waitForFunction(() => window.__kbState > 0, null, { timeout: 4000 });
        });
        await check('B) Web Share API-val: a 📤 Megosztás gomb látszik, és a szobalinket osztja meg', async () => {
          assert.equal(await page.isVisible('#btnShareLink'), true);
          await page.tap('#btnShareLink'); await pause(300);
          const sh = await page.evaluate(() => ({ list: window.__share, code: MY.code }));
          assert.equal(sh.list.length, 1);
          assert.equal(sh.list[0].url, BASE + '/?room=' + sh.code);
          assert.match(sh.list[0].text, new RegExp(sh.code));
        });
      } else {
        await check('B) Web Share API nélkül (asztali böngésző): a Megosztás gomb rejtve', async () => {
          assert.equal(await page.isVisible('#btnShareLink'), false);
        });
      }
      await context.close();
    }
    // ---------- néző módban nincs "Te jössz!" ----------
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'hu-HU' });
      const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE + '/?watch=ABCD');
      await pause(800);
      await check('néző módban nincs "Te jössz!" jelzés', async () => { assert.equal(await page.evaluate(() => typeof window.kbTurnAlert), 'undefined'); });
      await context.close();
    }
    await check('nincs JS-hiba', async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\n"Te jössz!" + Megosztás: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
