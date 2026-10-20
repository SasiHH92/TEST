'use strict';
// ============================================================
// KAMU BÍRÓSÁG – NÉZŐ MÓD (/?watch=KÓD): a tárgyalás játékos nélkül nézhető (stream / OBS)
//  A) szerver (socket.io): érvénytelen / nem létező kód; a néző NEM játékos (nincs a listában, nem foglal helyet); a játékosok látják a nézőszámot;
//     a néző semmit nem tud tenni (csevegés, szavazás, indítás); a nyilvános állapotban nincs titkos kártya / saját kihívás / bírói figyelő;
//     a reakció és a kalapács a nézőhöz is eljut; kilépéskor a nézőszám csökken; bezáruló szobáról értesítést kap; nézőszám-korlát (KB_MAX_WATCHERS)
//  B) felület (Playwright): nincs belépőoldal / névválasztó; a lobbi és a játék gombok nélkül látszik; nincs "TE VAGY A …" felfedés; nincs JS-hiba
// Futtatás: node test/watch-mode.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const io = require('socket.io-client');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* a B) rész kimarad */ }
const PORT = Number(process.env.WATCH_PORT || 3266), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-watch-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sockets = [];
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };
const emit = (s, ev, payload = {}) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('nincs válasz: ' + ev)), 5000);
  s.emit(ev, payload, (res) => { clearTimeout(t); resolve(res); });
});
async function connect() {
  const s = io(BASE, { transports: ['websocket'], reconnection: false }); sockets.push(s);
  s.on('state', (st) => { s.lastState = st; });
  s.on('watch_state', (st) => { s.lastWatch = st; });
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}
async function until(cond, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await pause(50); } return cond(); }
const SECRET_KEYS = ['evidence', 'alibi', 'tricks', 'witnessCard', 'myChallenge', 'myChallengeDifficulty', 'judgeWatch', 'judgeNotes', 'watchNow', 'myFunVotes'];

(async () => {
  const f = (x) => path.join(tmp, x);
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', KB_MAX_WATCHERS: '3', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { /* */ } if (!ready) await pause(150); }
    assert(ready, 'a szerver elindult');

    // ---------- A) szerver ----------
    const host = await connect();
    const created = await emit(host, 'create_room', { name: 'Nézett Nándor', playerId: 'hostW' });
    const code = created.code;
    const mate = await connect(); // második ember: így a vádbeszéd alatt mindig van, aki nem a beszélő, és reagálhat
    assert.ok(!(await emit(mate, 'join_room', { code, name: 'Társ Tamás', playerId: 'mateW' })).error);
    await emit(host, 'add_bot');
    await until(() => host.lastState && host.lastState.players.length === 3);
    const w1 = await connect();

    await check('A) érvénytelen vagy nem létező kód: érthető hiba', async () => {
      assert.match((await emit(w1, 'watch_room', { code: 'ZZ' })).error || '', /kód|szoba/i);
      assert.match((await emit(w1, 'watch_room', { code: 'QQQQ' })).error || '', /nem létezik|bezárult|megszűnt/i);
    });
    let first;
    await check('A) a néző a nyilvános lobbi-állapotot kapja, és NEM kerül a játékosok közé', async () => {
      first = await emit(w1, 'watch_room', { code: code.toLowerCase() });
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.state.phase, 'lobby');
      assert.equal(first.state.players.length, 3, 'a néző nincs a listában');
      assert.ok(!JSON.stringify(first.state).includes(created.sessionToken), 'munkamenet-token nem szivárog');
    });
    await check('A) a játékosok látják a nézőszámot (spectators)', async () => {
      assert.ok(await until(() => host.lastState && host.lastState.spectators === 1), 'spectators: ' + (host.lastState && host.lastState.spectators));
    });
    await check('A) a néző nem tud csevegni, indítani, botot adni (nincs játékos-munkamenete)', async () => {
      assert.ok((await emit(w1, 'chat_send', { text: 'helló' })).error);
      await emit(w1, 'start_game', { settings: { modes: ['buli'] } }).catch(() => null);
      assert.ok((await emit(w1, 'add_bot')).error);
      await pause(200);
      assert.equal(host.lastState.phase, 'lobby', 'a játék nem indult el');
      assert.equal(host.lastState.players.length, 3);
    });
    await check('A) nézőszám-korlát (KB_MAX_WATCHERS = 3): a negyedik néző érthető hibát kap', async () => {
      const w2 = await connect(), w3 = await connect(), w4 = await connect();
      assert.equal((await emit(w2, 'watch_room', { code })).ok, true);
      assert.equal((await emit(w3, 'watch_room', { code })).ok, true);
      assert.match((await emit(w4, 'watch_room', { code })).error || '', /nézők|megtelt|sok/i);
      w2.disconnect(); w3.disconnect(); w4.disconnect();
      assert.ok(await until(() => host.lastState.spectators === 1), 'a kilépett nézők levonódnak: ' + host.lastState.spectators);
    });

    // játék indul: a néző a nyilvános állapotot kapja (titkos kártyák nélkül), a reakciók és a kalapács eljutnak hozzá
    const reactions = [], gavels = [];
    w1.on('reaction', (r) => reactions.push(r));
    w1.on('order_in_court', (r) => gavels.push(r));
    const started = await emit(host, 'start_game', { settings: { modes: ['buli'], prepSeconds: 10, speechSeconds: 15, autoNextRound: false, autoNewGame: false } });
    await check('A) játék közben a néző a nyilvános állapotot kapja: fázis, szereplők – titkos kártya, kihívás, bírói figyelő nélkül', async () => {
      assert.equal(started.ok, true, JSON.stringify(started));
      assert.ok(await until(() => w1.lastWatch && w1.lastWatch.phase === 'accusation'), 'accusation');
      const st = w1.lastWatch;
      assert.ok(st.defendantId && st.prosecutorId && st.accusationText, 'szereplők és vád');
      for (const k of SECRET_KEYS) assert.ok(!(k in st), 'nincs ' + k);
      assert.ok(!st.verdictVote || st.verdictVote.canVote === false);
    });
    await check('A) a kalapács (Rendet a teremben!) a nézőhöz is eljut', async () => {
      const judge = host.lastState.currentJudgeId;
      if (judge === 'hostW') {
        host.emit('order_in_court');
        assert.ok(await until(() => gavels.length > 0), 'kalapács');
      } else {
        console.log('  (a bíró most bot, a kalapácsot nem a host üti – kihagyva)');
      }
    });
    await check('A) a beszéd alatt adott reakció a nézőhöz is eljut', async () => {
      (host.lastState.currentJudgeId === 'mateW' ? mate : host).emit('accusation_read'); // a "Felolvastam!" a kör bírójáé (bot-bírónál a bot olvas fel)
      assert.ok(await until(() => w1.lastWatch.phase === 'prep', 5000), 'felkészülés');
      assert.ok(await until(() => w1.lastWatch.phase === 'prosecution', 14000), 'vádbeszéd: ' + w1.lastWatch.phase);
      await pause(300);
      const d = w1.lastWatch;
      const reactor = d.prosecutorId === 'hostW' ? mate : host; // a beszélő maga is reagálhatna, de így biztosan "közönség" reagál
      reactor.emit('react', { emoji: '🔥' });
      assert.ok(await until(() => reactions.some((r) => r.emoji === '🔥'), 4000), 'a reakció eljutott a nézőhöz: ' + JSON.stringify(reactions));
    });
    await check('A) a néző nem tud szavazni / reagálni / tiltakozni (nincs játékos-munkamenete: a szerver figyelmen kívül hagyja)', async () => {
      const before = reactions.length;
      const objBefore = host.lastState.objectionPending ? host.lastState.objectionData && host.lastState.objectionData.objectorId : null;
      w1.emit('react', { emoji: '😂' }); w1.emit('vote_verdict', { verdict: 'guilty' }); w1.emit('objection');
      await pause(500);
      assert.ok(reactions.slice(before).every((r) => r.emoji !== '😂' || (r.by && r.by !== '')), 'a néző reakciója nem megy ki');
      const st = host.lastState;
      if (st.objectionPending && st.objectionData) assert.ok(['hostW', 'mateW'].includes(st.objectionData.objectorId) || /^bot_/.test(st.objectionData.objectorId) || st.objectionData.objectorId === objBefore, 'tiltakozás csak játékostól: ' + st.objectionData.objectorId);
    });
    await check('A) bezáruló szoba: a néző értesítést kap', async () => {
      const h2 = await connect();
      const r2 = await emit(h2, 'create_room', { name: 'Záró Zelma', playerId: 'hostZ' });
      const w5 = await connect();
      let closed = false; w5.on('watch_closed', () => { closed = true; });
      assert.equal((await emit(w5, 'watch_room', { code: r2.code })).ok, true);
      await emit(h2, 'leave_room'); // az üres lobbi-szoba azonnal megszűnik
      assert.ok(await until(() => closed, 3000), 'watch_closed');
    });

    // ---------- B) felület ----------
    if (!chromium) { console.log('SKIP: B) a playwright-core nincs telepítve.'); }
    else {
      const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
      let browser = null; for (const o of attempts) { try { browser = await chromium.launch({ headless: true, ...o }); break; } catch (_) { /* */ } }
      if (!browser) console.log('SKIP: B) nincs böngésző.');
      else {
        try {
          const h3 = await connect();
          const r3 = await emit(h3, 'create_room', { name: 'Stream Sára', playerId: 'hostS' });
          await emit(h3, 'add_bot'); await emit(h3, 'add_bot');
          const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'hu-HU' });
          const page = await context.newPage();
          const errors = []; page.on('pageerror', (e) => errors.push(e.message));
          await page.goto(BASE + '/?watch=' + r3.code, { waitUntil: 'domcontentloaded' });
          await check('B) a néző-oldal: nincs belépőoldal, a lobbi látszik, a jelvény mutatja az ügyet', async () => {
            await page.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 8000 });
            assert.equal(await page.isVisible('#screen-auth'), false);
            assert.match(await page.textContent('#watchBadge'), new RegExp('NÉZŐ.*' + r3.code));
            assert.ok((await page.$$('.poster')).length >= 3, 'a plakátok látszanak');
          });
          const visibleButtons = () => page.evaluate(() => [...document.querySelectorAll('#screen-lobby button, #screen-game button, #screen-lobby a.btn, .card-hand, .bug-fab, #chatFab')]
            .filter((e) => e.checkVisibility && e.checkVisibility({ opacityProperty: true, visibilityProperty: true })).map((e) => e.id || e.className).filter((x) => !/btnMute|info-btn|watch/.test(x)));
          await check('B) a lobbiban nincs kezelőgomb (indítás, bot, link, kész, kilépés, csevegő, hibajelentés)', async () => {
            assert.deepEqual(await visibleButtons(), []);
          });
          let sawReveal = false;
          await page.exposeFunction('__major', (k) => { if (k === 'reveal') sawReveal = true; });
          await page.evaluate(() => { new MutationObserver(() => window.__major(document.body.dataset.courtMajor || '')).observe(document.body, { attributes: true, attributeFilter: ['data-court-major'] }); });
          await emit(h3, 'start_game', { settings: { modes: ['buli'], autoNextRound: false, autoNewGame: false } });
          await check('B) játék közben: a terem látszik, nincs kezelőgomb, nincs "TE VAGY A …" felfedés', async () => {
            await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 8000 });
            await pause(3500);
            assert.ok((await page.$$('#stagePlates .stage-plate')).length >= 3, 'névtáblák');
            assert.deepEqual(await visibleButtons(), []);
            assert.equal(sawReveal, false, 'nem volt szerep-felfedés');
          });
          await check('B) nincs JS-hiba a néző-oldalon', async () => { assert.deepEqual(errors, []); });
          await context.close();
        } finally { await browser.close(); }
      }
    }
  } catch (e) {
    failed++; console.error('FAIL: előkészítés\n  ' + (e && e.stack || e));
  } finally {
    for (const s of sockets) try { s.disconnect(); } catch (_) { /* */ }
    server.kill(); await pause(200);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  }
  console.log('\nNéző mód: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
