'use strict';
// ============================================================
// KAMU BÍRÓSÁG – F5 / ÚJRACSATLAKOZÁS regresszió (a "visszalépés a szobába" biztonsága)
//
//  A) szerver (socket.io-client, böngésző nélkül): a `resume` csak a SAJÁT, tokennel igazolt ülésre léptet vissza; ismeretlen ülés / rossz token / megszűnt szoba → hiba,
//     a szobába nem kerül be új játékos és nem veszi át más ülését
//  B) böngésző (Playwright), egy valódi szerver ellen:
//       vendég játék közben F5 · bejelentkezett játékos játék közben F5 · lejárt munkamenet (sütik törölve) + F5 · lobbi F5 · nem létező szoba F5 ·
//       véget ért játék + F5 · friss látogató (nincs munkamenet) · friss lap elavult tárolt kóddal · idegen ülés / idegen token · szándékos kilépés után F5 · dupla F5
//     Ellenőrzés mindegyiknél: nincs végtelen újracsatlakozás (a join_room legfeljebb egyszer megy ki), nem a rossz szobába lép, nincs elavult állapot, nincs auth-kerülés
//
// Futtatás:  npm run test:rejoin       Böngésző: CHROMIUM_PATH / Edge / Chrome / Playwright Chromium; ha nincs: a B) rész SKIP (REJOIN_REQUIRE=1 esetén hiba)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const ioClient = require('socket.io-client');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.REJOIN_PORT || 3199), BASE = 'http://127.0.0.1:' + PORT;
const REQUIRE = process.env.REJOIN_REQUIRE === '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-rejoin-'));
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
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: process.env.REJOIN_VERBOSE ? 'inherit' : 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
    AUTH_BASE_URL: BASE, DATABASE_URL: '', MAX_ROOMS_PER_IP: '40', AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'),
    KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}
const connect = () => new Promise((resolve, reject) => { const s = ioClient(BASE, { transports: ['websocket'], reconnection: false }); s.once('connect', () => resolve(s)); s.once('connect_error', reject); });
const ask = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));

(async () => {
  const server = await startServer();
  const sockets = [];
  try {
    // ======================= A) szerver: a "resume" csak a saját ülésre =======================
    const host = await connect(); sockets.push(host);
    const created = await ask(host, 'create_room', { name: 'Hazigazda', avatar: 'av01', playerId: 'u_host_' + Date.now() });
    const code = created.code, hostPid = created.playerId, hostToken = created.sessionToken;
    assert.ok(code && hostToken, 'a szoba létrejött');
    const playersOf = async () => { const s = await connect(); sockets.push(s); const r = await ask(s, 'join_room', { code, name: 'Megfigyelo' + Math.random().toString(36).slice(2, 6), avatar: 'av02', playerId: 'u_obs_' + Math.random().toString(36).slice(2, 8) }); s.disconnect(); return r.state.players.filter((p) => !String(p.name).startsWith('Megfigyelo')).length; };

    await check('szerver: a saját ülésre a helyes tokennel lehet visszalépni (resume), új játékos nem jön létre', async () => {
      const s = await connect(); sockets.push(s);
      const r = await ask(s, 'join_room', { code, name: 'Hazigazda', avatar: 'av01', playerId: hostPid, sessionToken: hostToken, resume: true });
      assert.ok(!r.error, 'a visszalépés hibát adott: ' + r.error); assert.equal(r.playerId, hostPid); assert.equal(r.code, code);
      assert.equal(await playersOf(), 1, 'duplikált ülés jött létre');
    });
    await check('szerver: ismeretlen ülés + resume → "a szoba megszűnt" hiba, a szobába NEM kerül be új játékos', async () => {
      const s = await connect(); sockets.push(s);
      const r = await ask(s, 'join_room', { code, name: 'Idegen', avatar: 'av03', playerId: 'u_nincs_ilyen_ules', sessionToken: 'x', resume: true });
      assert.match(r.error || '', /megszűnt/); assert.ok(!r.state, 'állapotot kapott');
      assert.equal(await playersOf(), 1, 'az idegen bekerült a szobába');
    });
    await check('szerver: más ülésére (helyes playerId, rossz token) nem lehet visszalépni, sem resume-mal, sem anélkül', async () => {
      for (const resume of [true, false]) {
        const s = await connect(); sockets.push(s);
        const r = await ask(s, 'join_room', { code, name: 'Hazigazda', avatar: 'av01', playerId: hostPid, sessionToken: 'hamis', resume });
        assert.match(r.error || '', /másik munkamenet/, 'resume=' + resume + ': ' + JSON.stringify(r.error)); assert.ok(!r.state);
      }
      const s2 = await connect(); sockets.push(s2);
      const r2 = await ask(s2, 'join_room', { code, name: 'Hazigazda', avatar: 'av01', playerId: hostPid, resume: true }); // token nélkül
      assert.match(r2.error || '', /másik munkamenet/, 'token nélkül is tilos');
    });
    await check('szerver: nem létező szoba + resume → érthető hiba (nincs beragadás)', async () => {
      const s = await connect(); sockets.push(s);
      const r = await ask(s, 'join_room', { code: 'ZZZZ', name: 'X', avatar: 'av01', playerId: 'u_x', sessionToken: 'y', resume: true });
      assert.match(r.error || '', /megszűnt/);
    });
    await check('szerver: resume nélküli (új) belépés változatlanul működik (új játékos a lobbiban)', async () => {
      const s = await connect(); sockets.push(s);
      const r = await ask(s, 'join_room', { code, name: 'Uj Jatekos', avatar: 'av04', playerId: 'u_new_' + Date.now() });
      assert.ok(!r.error && r.state, 'új belépés hiba: ' + r.error);
    });
    sockets.forEach((s) => s.disconnect());

    // ======================= B) böngésző =======================
    if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve (a böngészős rész kimarad).'); if (REQUIRE) failed++; }
    else {
      const browser = await launch();
      if (!browser) { console.log('SKIP: nincs használható böngésző (a böngészős rész kimarad).'); if (REQUIRE) failed++; }
      else {
        const contexts = [];
        const newPage = async (viewport, preset) => {
          const context = await browser.newContext({ viewport: viewport || { width: 1366, height: 768 }, locale: 'hu-HU' });
          contexts.push(context);
          const errors = [];
          await context.addInitScript(() => {
            try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ }
            // a kliens által küldött join_room események számlálása (a socket.io szállítója közben polling → websocket, ezért a socket.emit-et figyeljük)
            let _io;
            Object.defineProperty(window, 'io', { configurable: true, get() { return _io; }, set(v) {
              _io = function (...a) { const s = v(...a); const em = s.emit.bind(s); window.__emits = []; window.__stacks = []; window.__ev = []; for (const n of ['connect', 'disconnect', 'connect_error']) s.on(n, (r) => window.__ev.push(n + '@' + Math.round(performance.now()) + (r ? ':' + String(r).slice(0, 40) : ''))); s.emit = (...x) => { window.__emits.push(x[0] + '@' + Math.round(performance.now())); if (x[0] === 'join_room') window.__stacks.push(new Error().stack.split(String.fromCharCode(10)).slice(2, 6).map((l) => l.trim().replace(/^at /, '')).join(' < ')); return em(...x); }; return s; };
              Object.assign(_io, v);
            } });
          });
          const page = await context.newPage();
          page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
          page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
          return { context, page, errors };
        };
        const joins = (page) => page.evaluate(() => (window.__emits || []).filter((e) => /^join_room@/.test(e)).length);
const joinStacks = (page) => page.evaluate(() => (window.__stacks || []).join(' ## ') + ' | események: ' + (window.__ev || []).join(', ') + ' | emit: ' + (window.__emits || []).join(', '));
        const screen = (page) => page.evaluate(() => document.body.dataset.screen);
        const guestEnter = async (page, name) => {
          await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#authGuest'); await page.click('#authGuest');
          await page.waitForFunction(() => document.body.dataset.screen === 'name');
          await page.evaluate(() => document.getElementById('btnNewSuspect').click());
          await page.fill('#guestName', name);
          await page.evaluate(() => document.getElementById('btnGuestGo').click());
          await page.waitForFunction(() => document.body.dataset.screen === 'menu');
        };
        const accountEnter = async (page, name) => {
          await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
          const password = 'Egy hosszú titok 123!';
          const status = await page.evaluate(async ({ name, email, password }) => (await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, email, password, confirmPassword: password }) })).status,
            { name, email: crypto.randomUUID() + '@example.invalid', password });
          assert.equal(status, 201, 'a tesztfiók létrejött');
          await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#authContinue:not(.hidden)', { timeout: 15000 });
          await page.evaluate(() => document.getElementById('authContinue').click());
          await page.waitForFunction(() => document.body.dataset.screen === 'name', null, { timeout: 15000 });
          await page.evaluate(() => document.getElementById('btnNewSuspect').click());
          await page.evaluate((n) => { const e = document.getElementById('guestName'); if (!e.value) e.value = n; }, name);
          await page.evaluate(() => document.getElementById('btnGuestGo').click());
          await page.waitForFunction(() => document.body.dataset.screen === 'menu');
        };
        const createRoom = async (page) => { await page.evaluate(() => document.getElementById('btnCreate').click()); await page.waitForFunction(() => document.body.dataset.screen === 'lobby'); };
        const startGame = async (page, opts) => {
          opts = opts || {};
          for (let i = 0; i < 3; i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(220); }
          await page.evaluate((o) => {
            document.getElementById('btnCustomGame').click();
            const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
            set('setSpeech', 15); set('setDefender', 15); set('setPrep', o.prep || 120); set('setWitness', 10); set('setClosing', 10); set('setRounds', 1);
            if (o.noAuto) { const a = document.getElementById('setAutoGame'); a.checked = false; a.dispatchEvent(new Event('change', { bubbles: true })); const r = document.getElementById('setAutoRound'); r.checked = false; r.dispatchEvent(new Event('change', { bubbles: true })); }
            const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
            document.getElementById('btnSaveSettings').click();
          }, opts);
          await page.waitForFunction((o) => S.settings.prepSeconds === (o.prep || 120), opts, { timeout: 6000 });
          await page.evaluate(() => document.getElementById('btnStartGame').click());
          await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
        };
        const snap = (page) => page.evaluate(() => ({ code: MY.code, pid: MY.playerId, n: S ? S.players.length : -1, phase: S ? S.phase : null, screen: document.body.dataset.screen, room: (document.getElementById('gameCode') || {}).textContent }));
        const reloadAndWait = async (page, cond) => { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(cond, null, { timeout: 20000 }); };
        const inRoom = () => document.body.dataset.screen === 'game' && typeof S !== 'undefined' && S && S.players;

        try {
          await check('vendég játék közben F5: magától visszatér ugyanabba a szobába, ugyanazzal az ülésszel; egyszeri join_room, nincs ismételgetés, nincs duplikált játékos', async () => {
            const { page, errors } = await newPage(); await guestEnter(page, 'Vendeg F5'); await createRoom(page); await startGame(page);
            await page.waitForFunction(() => S.phase === 'accusation' || S.phase === 'prep', null, { timeout: 15000 });
            const before = await snap(page);
            await reloadAndWait(page, inRoom);
            const after = await snap(page);
            assert.equal(after.code, before.code, 'rossz szoba'); assert.equal(after.pid, before.pid, 'másik ülés'); assert.equal(after.n, before.n, 'duplikált / hiányzó játékos'); assert.equal(after.screen, 'game');
            assert.equal(await joins(page), 1, 'a join_room nem pontosan egyszer ment ki: ' + await joinStacks(page));
            await pause(4000);
            assert.equal(await joins(page), 1, 'ismételt újracsatlakozás'); assert.equal(await screen(page), 'game');
            // dupla, gyors F5
            await page.reload({ waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(inRoom, null, { timeout: 20000 });
            const again = await snap(page);
            assert.equal(again.code, before.code); assert.equal(again.n, before.n, 'a dupla F5 után duplikált játékos');
            assert.deepEqual(errors, [], errors.join(' | '));
          });
          await check('bejelentkezett (fiókos) játékos játék közben F5: visszatér a játékba a fiókjával; a lejárt munkamenet (sütik törölve) utáni F5 a bejelentkezést adja, nem lép vissza sem fiókként, sem vendégként', async () => {
            const { context, page, errors } = await newPage(); await accountEnter(page, 'Fiok' + Date.now().toString(36)); await createRoom(page); await startGame(page);
            await page.waitForFunction(() => S.phase === 'accusation' || S.phase === 'prep', null, { timeout: 15000 });
            const before = await snap(page);
            const acct = await page.evaluate(() => window.kbAccount && window.kbAccount.id);
            assert.ok(acct, 'nincs fiók');
            await reloadAndWait(page, inRoom);
            const after = await snap(page);
            assert.equal(after.code, before.code, 'rossz szoba'); assert.equal(after.pid, before.pid); assert.equal(after.n, before.n);
            assert.equal(await page.evaluate(() => window.kbAccount && window.kbAccount.id), acct, 'másik fiók');
            assert.equal(await joins(page), 1);
            // a munkamenet lejárt (a süti eltűnt) → F5 → bejelentkezési oldal, nincs automatikus visszalépés
            await context.clearCookies();
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.body.dataset.screen === 'auth', null, { timeout: 15000 });
            await pause(2500);
            assert.equal(await screen(page), 'auth', 'a lejárt munkamenet után bejelentkezési oldal kell');
            assert.equal(await joins(page), 0, 'a lejárt munkamenet után nem léphet vissza a szobába');
            assert.deepEqual(errors, [], errors.join(' | '));
          });
          await check('lobbi F5: visszatér ugyanabba a lobbiba (nincs duplikált játékos)', async () => {
            const { page } = await newPage(); await guestEnter(page, 'Lobbi F5'); await createRoom(page);
            const before = await snap(page);
            await reloadAndWait(page, () => document.body.dataset.screen === 'lobby' && typeof S !== 'undefined' && S && S.players);
            const after = await snap(page);
            assert.equal(after.code, before.code); assert.equal(after.pid, before.pid); assert.equal(after.n, before.n, 'duplikált játékos'); assert.equal(after.phase, 'lobby');
            assert.equal(await joins(page), 1);
          });
          await check('nem létező / megszűnt szoba F5: érthető hiba a menüben, a tárolt kód törlődik, NINCS ismételgetés és nincs elavult állapot', async () => {
            const { page } = await newPage(); await guestEnter(page, 'Elavult');
            await page.evaluate(() => {
              localStorage.setItem('kb_code', 'ZZZZ'); localStorage.setItem('kb_playerId', 'u_elavult'); localStorage.setItem('kb_sessionToken', 'regi-token');
              sessionStorage.setItem('kb_tab', '1'); sessionStorage.setItem('kb_guest', '1');
            });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.body.dataset.screen === 'menu' && /megszűnt/.test((document.getElementById('menuError') || {}).textContent || ''), null, { timeout: 15000 });
            assert.equal(await page.evaluate(() => localStorage.getItem('kb_code')), null, 'a tárolt kód nem törlődött');
            assert.equal(await page.evaluate(() => typeof S === 'undefined' || S === null), true, 'elavult állapot maradt');
            await pause(5000);
            assert.equal(await joins(page), 1, 'ismételt próbálkozás'); assert.equal(await screen(page), 'menu');
          });
          await check('friss látogató (nincs munkamenet): a bejelentkezés jön először, nincs automatikus belépés, a tárolt (elavult) kód nem használódik', async () => {
            const a = await newPage(); await a.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await a.page.waitForFunction(() => document.body.dataset.screen === 'auth', null, { timeout: 15000 });
            assert.equal(await joins(a.page), 0);
            const b = await newPage(); await b.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await b.page.evaluate(() => { localStorage.setItem('kb_code', 'ABCD'); localStorage.setItem('kb_playerId', 'u_regi'); localStorage.setItem('kb_sessionToken', 'regi'); localStorage.setItem('kb_name', 'Regi Nev'); localStorage.setItem('kb_accountId', 'guest'); });
            await b.page.reload({ waitUntil: 'domcontentloaded' });
            await b.page.waitForFunction(() => document.body.dataset.screen === 'auth', null, { timeout: 15000 });
            await pause(2500);
            assert.equal(await screen(b.page), 'auth', 'új lapon (nincs munkamenet-jelző) a tárolt kód nem léptethet vissza');
            assert.equal(await joins(b.page), 0);
          });
          await check('idegen ülés / idegen token: a másik játékos szobájába nem lehet "visszalépni" (nem kerül be, nem szakítja meg a másik játékost)', async () => {
            const A = await newPage(); await guestEnter(A.page, 'Szoba Gazda'); await createRoom(A.page);
            const aSnap = await snap(A.page);
            const G = await newPage(); await guestEnter(G.page, 'Idegen Vendeg');
            // 1) tárolt kód + ismeretlen ülés
            await G.page.evaluate((code) => { localStorage.setItem('kb_code', code); localStorage.setItem('kb_playerId', 'u_nem_ulok_itt'); localStorage.setItem('kb_sessionToken', 'nem-az-enyem'); sessionStorage.setItem('kb_tab', '1'); sessionStorage.setItem('kb_guest', '1'); }, aSnap.code);
            await G.page.reload({ waitUntil: 'domcontentloaded' });
            await G.page.waitForFunction(() => document.body.dataset.screen === 'menu' && /megszűnt/.test((document.getElementById('menuError') || {}).textContent || ''), null, { timeout: 15000 });
            // 2) A saját ülésének azonosítója, rossz tokennel
            await G.page.evaluate(({ code, pid }) => { localStorage.setItem('kb_code', code); localStorage.setItem('kb_playerId', pid); localStorage.setItem('kb_sessionToken', 'hamis'); sessionStorage.setItem('kb_tab', '1'); sessionStorage.setItem('kb_guest', '1'); }, { code: aSnap.code, pid: aSnap.pid });
            await G.page.reload({ waitUntil: 'domcontentloaded' });
            await G.page.waitForFunction(() => document.body.dataset.screen === 'menu' && /munkamenet|megszűnt/.test((document.getElementById('menuError') || {}).textContent || ''), null, { timeout: 15000 });
            assert.equal(await joins(G.page), 1, 'ismételgetés');
            const aAfter = await A.page.evaluate(() => ({ n: S.players.length, me: S.players.find((p) => p.id === MY.playerId), screen: document.body.dataset.screen }));
            assert.equal(aAfter.n, aSnap.n, 'az idegen bekerült a szobába'); assert.ok(aAfter.me && aAfter.me.connected, 'a szoba gazdája megszakadt'); assert.equal(aAfter.screen, 'lobby');
          });
          await check('szándékos kilépés után F5: nincs automatikus visszalépés (bejelentkezési oldal, a tárolt kód törölve)', async () => {
            const { page } = await newPage(); await guestEnter(page, 'Kilepo'); await createRoom(page);
            await page.evaluate(() => leaveToMenu());
            await page.waitForFunction(() => document.body.dataset.screen === 'menu');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.body.dataset.screen === 'auth', null, { timeout: 15000 });
            await pause(2000);
            assert.equal(await joins(page), 0); assert.equal(await page.evaluate(() => localStorage.getItem('kb_code')), null);
          });
          await check('véget ért játék + F5: ugyanabba a szobába tér vissza, a végeredmény (game_over) látszik, nem elavult lobbi / játékállapot', async () => {
            const { page, errors } = await newPage(); await guestEnter(page, 'Vegeredmeny'); await createRoom(page); await startGame(page, { prep: 10, noAuto: true });
            const t0 = Date.now();
            while (Date.now() - t0 < 200000) {
              const ph = await page.evaluate(() => S.phase);
              if (ph === 'game_over') break;
              await page.evaluate(() => { for (const id of ['iaAccRead', 'iaDone', 'btnNextRound', 'rvDone', 'voteGuilty', 'objAccept']) { const b = document.getElementById(id); if (b && !b.disabled) { b.click(); break; } } }).catch(() => {});
              if (ph === 'verdict') await pause(1500), await page.evaluate(() => { const b = document.getElementById('btnProceed'); if (b && !b.disabled) b.click(); }).catch(() => {});
              await pause(400);
            }
            assert.equal(await page.evaluate(() => S.phase), 'game_over', 'a játék nem ért véget időben');
            const before = await snap(page);
            const rank = await page.evaluate(() => S.gameOver.ranking.map((p) => p.score));
            await reloadAndWait(page, inRoom);
            await page.waitForFunction(() => S.phase === 'game_over', null, { timeout: 10000 });
            const after = await snap(page);
            assert.equal(after.code, before.code); assert.equal(after.pid, before.pid); assert.equal(after.n, before.n);
            assert.deepEqual(await page.evaluate(() => S.gameOver.ranking.map((p) => p.score)), rank, 'a végeredmény eltér');
            assert.ok(await page.evaluate(() => document.querySelectorAll('#phaseContent .score-row').length > 0), 'a rangsor nem látszik');
            await pause(3000); assert.equal(await joins(page), 1);
            assert.deepEqual(errors, [], errors.join(' | '));
          });
        } catch (e) { failed++; console.error('FAIL: a böngészős rész megszakadt: ' + (e && e.stack || e)); }
        for (const c of contexts) await c.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    }
  } catch (e) {
    failed++; console.error('FAIL: a teszt megszakadt: ' + (e && e.stack || e));
  } finally {
    sockets.forEach((s) => { try { s.disconnect(); } catch (_) { /* */ } });
    server.kill();
  }
  console.log(`\nF5 / újracsatlakozás: ${passed} sikeres, ${failed} hibás.`);
  process.exit(failed ? 1 : 0);
})();
