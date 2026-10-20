'use strict';
// ============================================================
// KAMU BÍRÓSÁG – HTML-beszúrás elleni ellenőrzés (helyi szerveren): a felhasználótól jövő szöveg sehol nem válhat valódi HTML-elemmé
//  A) valódi folyamat: két játékos HTML-jelölős névvel, csevegő-üzenet, közös tér (board), lobbi plakátjai, menü
//  B) minden játékfázis hamisított állapottal: a nevek, titulus / priusz / jelvény, a vád, a mód neve, a kártyák szövege, a bírói jegyzet,
//     az esküdt-kérdés mind jelölőt tartalmaz → egyetlen .xp elem sem jöhet létre
//  (A CSP miatt szkript amúgy sem futna, de a beszúrt HTML is hiba: hamis gomb / link / kép.)
// Futtatás: node test/xss-probe.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { fixture, phases } = require('./browser-check');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }
const PORT = Number(process.env.XSS_PORT || 3290), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-xss-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };
const PAY = '<i class="xp">X</i><img class="xp" src="/assets/icons/favicon-32.png">';
const SHORT_A = '<i class=xp>A</i>', SHORT_B = '<b class=xp>B</b>'; // (a név legfeljebb 20 karakter)
const probe = () => document.querySelectorAll('.xp').length;

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(0); }
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let browser = null; for (const o of attempts) { try { browser = await chromium.launch({ headless: true, ...o }); break; } catch (_) { /* */ } }
  if (!browser) { console.log('SKIP: nincs böngésző.'); process.exit(0); }
  const f = (x) => path.join(tmp, x);
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '40', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  const errors = [];
  const newPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'hu-HU' });
    await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#authGuest');
    return { context, page };
  };
  const guest = async (page, name) => {
    await page.click('#authGuest'); await page.waitForFunction(() => document.body.dataset.screen === 'name');
    await page.evaluate(() => document.getElementById('btnNewSuspect').click());
    await page.evaluate((n) => { document.getElementById('guestName').value = n; }, name);
    await page.evaluate(() => document.getElementById('btnGuestGo').click());
    await page.waitForFunction(() => document.body.dataset.screen === 'menu', null, { timeout: 8000 });
  };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { /* */ } await pause(150); }

    // ---------- A) valódi folyamat ----------
    const a = await newPage(), b = await newPage();
    await check('A) HTML-jelölős vendégnév: a menüben szövegként jelenik meg', async () => {
      await guest(a.page, SHORT_A); await guest(b.page, SHORT_B);
      await pause(600);
      assert.equal(await a.page.evaluate(probe), 0, 'A menüje'); assert.equal(await b.page.evaluate(probe), 0, 'B menüje');
      assert.match(await a.page.textContent('#menuWho'), /<i class=xp>A<\/i>/, 'a név szövegként látszik');
    });
    await check('A) lobbi: a plakátokon, a hírszalagon a nevek szövegként', async () => {
      await a.page.evaluate(() => document.getElementById('btnCreate').click()); await a.page.waitForFunction(() => document.body.dataset.screen === 'lobby');
      const code = (await a.page.textContent('#lobbyCode')).trim();
      await b.page.fill('#codeInput', code); await b.page.evaluate(() => document.getElementById('btnJoin').click());
      await b.page.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 8000 });
      await pause(1200);
      assert.equal(await a.page.evaluate(probe), 0, 'A lobbija'); assert.equal(await b.page.evaluate(probe), 0, 'B lobbija');
    });
    await check('A) csevegő: a HTML-jelölős üzenet szövegként jelenik meg mindkét félnél', async () => {
      await b.page.evaluate(() => window.kbChat.open()); await pause(300);
      const sent = await b.page.evaluate((t) => new Promise((r) => socket.emit('chat_send', { text: t }, r)), PAY);
      assert.ok(sent && sent.ok, 'az üzenet elment: ' + JSON.stringify(sent));
      await a.page.evaluate(() => window.kbChat.open());
      await a.page.waitForFunction(() => /class="xp"/.test(document.getElementById('chatLog').textContent), null, { timeout: 6000 });
      assert.equal(await a.page.evaluate(probe), 0, 'A csevegője'); assert.equal(await b.page.evaluate(probe), 0, 'B csevegője');
    });
    await check('A) közös tér (board) üzenete szövegként', async () => {
      const r = await b.page.evaluate((t) => new Promise((res) => { socket.emit('board_sub', {}, () => socket.emit('board_send', { text: t }, res)); setTimeout(() => res({ timeout: true }), 3000); }), PAY);
      await pause(800);
      assert.equal(await a.page.evaluate(probe), 0); assert.equal(await b.page.evaluate(probe), 0);
      console.log('    (board_send válasz: ' + JSON.stringify(r).slice(0, 80) + ')');
    });
    await a.context.close(); await b.context.close();

    // ---------- B) minden játékfázis hamisított állapottal ----------
    const g = await newPage();
    await guest(g.page, 'Fázis Feri');
    const states = [...phases.map((p) => [p, null]), ['prep', 'defendant'], ['prep', 'defender'], ['prep', 'witness'], ['prep', 'judge'], ['prep', 'juror'], ['prosecution', 'defendant'], ['prosecution', 'judge']];
    const bad = [];
    for (const [phase, role] of states) {
      const data = fixture(phase, role);
      const st = data.state;
      for (const p of st.players || []) { p.name = SHORT_A; p.profile = { ...(p.profile || {}), titulus: PAY, priusz: PAY, jelveny: SHORT_B }; }
      if (st.accusationText) st.accusationText = 'Vád: ' + PAY;
      if (st.modeName) st.modeName = PAY;
      if (st.caseNo) st.caseNo = PAY;
      for (const key of ['myCards', 'playedCards', 'evidence', 'hand']) if (Array.isArray(st[key])) for (const c of st[key]) { if (c && typeof c === 'object') { if ('text' in c) c.text = PAY; if ('title' in c) c.title = PAY; } }
      if (st.judgeNote !== undefined) st.judgeNote = PAY;
      if (st.juryQuestion && Array.isArray(st.juryQuestion.picks)) for (const q of st.juryQuestion.picks) { if (q) q.text = PAY; }
      if (st.myChallenge && typeof st.myChallenge === 'object') st.myChallenge.text = PAY;
      if (st.gameOver && Array.isArray(st.gameOver.ranking)) for (const r of st.gameOver.ranking) r.name = SHORT_A;
      const n = await g.page.evaluate(({ state, myId }) => {
        IDENTITY_READY = true; INTENTIONAL_LEAVE = false; KICKED_FROM_ROOM = true; MY.playerId = myId; MY.code = 'QA42'; S = state; serverOffset = 0;
        show('game'); renderGame(); charAnim.start(); startTimerLoop();
        return new Promise((r) => setTimeout(() => r(document.querySelectorAll('.xp').length), 350));
      }, data).catch((e) => 'hiba: ' + e.message);
      if (n !== 0) bad.push(phase + (role ? ' (' + role + ')' : '') + ': ' + n);
    }
    await check('B) ' + states.length + ' játékállapot: a nevek / titulus / priusz / vád / kártyák / jegyzet / kérdés sehol nem válik HTML-lé', async () => {
      assert.deepEqual(bad, []);
    });
    await g.context.close();
    await check('nincs JS-hiba', async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nHTML-beszúrás: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
