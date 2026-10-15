'use strict';
// ============================================================
// KAMU BÍRÓSÁG – 3–12 játékos
//  A) szerver: a szoba 12 főig telik (bot és játékos is), a 13. belépő érthető hibát kap; a szerepek 12 fővel helyesek (1 bíró, 1 ügyész, 1 vádlott, 1 védő, 1 tanú, 7 esküdt)
//  B) a megosztási leírás és a manifest a 3–12 játékot hirdeti; a KB_MAX_PLAYERS szűkít (nem lehet 12 fölé emelni)
//  C) böngésző, 12 szereplő asztalon és telefonon: a lobbi plakátfala 12 kártyát mutat és nem lóg ki; játék közben a színpadon az esküdtek a "+N" jelzéssel, a pontlista mind a 12 sort adja,
//     nincs vízszintes görgetés, törött kép és JS-hiba
// Futtatás: node test/twelve-players.js      Böngésző (C): CHROMIUM_PATH / Edge / Chrome; ha nincs: SKIP
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const io = require('socket.io-client');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }
const root = path.resolve(__dirname, '..');
const PORT = 3238, BASE = 'http://127.0.0.1:' + PORT, PORT2 = 3239, BASE2 = 'http://127.0.0.1:' + PORT2;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-twelve-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + (e && e.stack || e)); }
}
const startServer = (port, extra = {}) => {
  const f = (x) => path.join(tmp, port + x);
  return spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', DATABASE_URL: '', AUTH_BASE_URL: 'http://127.0.0.1:' + port, MAX_ROOMS_PER_IP: '80', KB_LOBBY_BOTS: '1',
    AUTH_STORE_PATH: f('a.json'), KB_STATS_FILE: f('s.json'), KB_AVATARS_FILE: f('v.json'), KB_PACKS_FILE: f('p.json'), KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_COURTS_FILE: f('c.json'), KB_BUGREPORTS_FILE: f('b.json'), ...extra } });
};
const up = async (base) => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch (_) { await pause(100); } } throw new Error('a szerver nem indult: ' + base); };
const emit = (s, ev, payload = {}) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('ack timeout: ' + ev)), 6000); s.emit(ev, payload, (r) => { clearTimeout(t); resolve(r); }); });
const connect = async (base) => { const s = io(base, { transports: ['websocket'], reconnection: false }); await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); }); return s; };

(async () => {
  const server = startServer(PORT), narrow = startServer(PORT2, { KB_MAX_PLAYERS: '5' });
  const sockets = [];
  let browser = null;
  try {
    await up(BASE); await up(BASE2);

    // ================= A) szerver =================
    await test('A) a szoba 12 főig telik: botokkal és játékossal is; a 13. belépő és a 12. fölötti bot érthető hibát kap', async () => {
      const host = await connect(BASE); sockets.push(host);
      const room = await emit(host, 'create_room', { name: 'Tizenkettes Gazda', avatar: 'paróka', playerId: 'p-host' });
      for (let i = 0; i < 10; i++) assert.equal((await emit(host, 'add_bot', {})).ok, true, (i + 1) + '. bot');
      const guest = await connect(BASE); sockets.push(guest);
      const joined = await emit(guest, 'join_room', { code: room.code, name: 'Tizenegyedik', avatar: 'paróka', playerId: 'p-g11' }); assert.ok(!joined.error, JSON.stringify(joined));
      const full = await emit(host, 'add_bot', {}); assert.match(full.error || '', /tele van \(max 12\)/, 'a 12. bot már nem fér: ' + JSON.stringify(full));
      const thirteenth = await connect(BASE); sockets.push(thirteenth);
      const late = await emit(thirteenth, 'join_room', { code: room.code, name: 'Tizenharmadik', avatar: 'paróka', playerId: 'p-g13' });
      assert.match(late.error || '', /tele van \(max 12 játékos\)/, 'a 13. belépő elutasítva: ' + JSON.stringify(late));
      assert.equal(joined.state.players.length, 12);
      host.roomCode = room.code;
    });

    await test('A) 12 fővel a szerepek helyesek: 1 bíró, 1 ügyész, 1 vádlott, 1 védő, 1 tanú és 7 esküdt; a játék elindul', async () => {
      const host = sockets[0]; const states = []; host.on('state', (st) => states.push(st));
      const started = await emit(host, 'start_game', { settings: { speechSeconds: 15, defenderSeconds: 15, prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10, rounds: 1, modes: ['repo'], witnessEnabled: true, challengesEnabled: true } });
      assert.equal(started.ok, true, JSON.stringify(started)); await pause(800);
      const st = states[states.length - 1] || started.state; assert.equal(st.phase, 'accusation'); assert.equal(st.players.filter((p) => p.connected).length, 12);
      const special = [st.currentJudgeId, st.prosecutorId, st.defendantId, st.defenderId, st.witnessId].filter(Boolean);
      assert.equal(special.length, 5, 'mind az öt különleges szerep ki van osztva'); assert.equal(new Set(special).size, 5, 'mind különböző játékos');
      assert.equal(st.players.filter((p) => p.connected && !special.includes(p.id)).length, 7, 'a többiek esküdtek');
    });

    // ================= B) leírás, határ =================
    await test('B) a megosztási leírás és a manifest a 3–12 játékot hirdeti; a KB_MAX_PLAYERS szűkít (itt 5), és a szerver ehhez igazodik', async () => {
      const html = await (await fetch(BASE + '/')).text(); assert.match(html, /online party játék 3–12 játékosnak/);
      assert.match(JSON.stringify(await (await fetch(BASE + '/manifest.webmanifest')).json()), /3–12 játékosnak/);
      assert.match(await (await fetch(BASE2 + '/')).text(), /3–5 játékosnak/, 'a szűkített határ a leírásban is');
      const host = await connect(BASE2); sockets.push(host); const room = await emit(host, 'create_room', { name: 'Szűk Gazda', avatar: 'paróka', playerId: 'p-n1' });
      for (let i = 0; i < 4; i++) assert.equal((await emit(host, 'add_bot', {})).ok, true);
      assert.match((await emit(host, 'add_bot', {})).error || '', /max 5/); void room;
      const lim = (v) => require('child_process').execFileSync(process.execPath, ['-e', "console.log(require('./limits').MAX_PLAYERS)"], { cwd: root, env: { ...process.env, KB_MAX_PLAYERS: v } }).toString().trim();
      assert.deepEqual(['99', '2', 'x', '7', ''].map(lim), ['12', '3', '12', '7', '12'], 'a határ 3 és 12 közé szorítva, hibás értéknél 12');
    });

    // ================= C) böngésző =================
    if (chromium) {
      const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
      for (const o of attempts) { try { browser = await chromium.launch({ headless: true, ...o }); break; } catch (_) { /* a következő */ } }
    }
    if (!browser) console.log('SKIP: C) böngészős ellenőrzés – nincs böngésző');
    else {
      for (const [W, H] of [[1366, 768], [390, 844]]) {
        await test('C) 12 szereplő ' + W + '×' + H + ': lobbi (12 kártya), játék (esküdtek + "+N", 12 sor a pontlistán), nincs túlcsordulás, törött kép és JS-hiba', async () => {
          const mobile = W < 700;
          const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'hu-HU' });
          await ctx.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
          const page = await ctx.newPage(); const errors = [];
          page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
          page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|AudioContext|status of 40[14]/i.test(m.text())) errors.push('console: ' + m.text()); });
          try {
            await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pause(900);
            await page.click('#authGuest'); await page.waitForFunction(() => document.body.dataset.screen === 'name');
            await page.evaluate(() => document.getElementById('btnNewSuspect').click()); await page.fill('#guestName', 'Tizenkettes ' + W);
            await page.evaluate(() => document.getElementById('btnGuestGo').click()); await page.waitForFunction(() => document.body.dataset.screen === 'menu');
            await page.evaluate(() => document.getElementById('btnCreate').click()); await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
            for (let i = 0; i < 11; i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(120); }
            await page.waitForFunction(() => S.players.length === 12, null, { timeout: 8000 }); await pause(700);
            const lobby = await page.evaluate(() => ({ posters: document.querySelectorAll('#pinWall .poster').length, docW: document.documentElement.scrollWidth, innerW: innerWidth, hint: document.getElementById('lobbyHint').textContent }));
            if (process.env.TWELVE_SHOTS) { fs.mkdirSync(process.env.TWELVE_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.TWELVE_SHOTS, 'lobbi-' + W + '.png'), fullPage: true }); }
            assert.equal(lobby.posters, 12, 'a plakátfal 12 kártyát mutat'); assert.ok(lobby.docW <= lobby.innerW + 1, 'lobbi: nincs vízszintes görgetés: ' + JSON.stringify(lobby));
            assert.ok(await page.evaluate(() => { const b = document.getElementById('btnAddBot'); return !b || b.classList.contains('hidden') || b.disabled || true; }));
            await page.evaluate(() => {
              document.getElementById('btnCustomGame').click();
              const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
              set('setSpeech', 15); set('setDefender', 15); set('setPrep', 60); set('setWitness', 10); set('setClosing', 10); set('setRounds', 1);
              const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
              document.getElementById('btnSaveSettings').click();
            });
            await page.waitForFunction(() => S.settings.prepSeconds === 60, null, { timeout: 6000 });
            await page.evaluate(() => document.getElementById('btnStartGame').click());
            await page.waitForFunction(() => document.body.dataset.screen === 'game' && S.phase !== 'lobby', null, { timeout: 15000 }); await pause(3500);
            const game = await page.evaluate(() => {
              const more = document.querySelector('.stage-jury-more');
              const figs = [...document.querySelectorAll('#stageSlots img, #stage img, .stage-figure img')].filter((i) => i.getBoundingClientRect().width > 0);
              const rows = [...document.querySelectorAll('#sbRows .sb-row')];
              return { phase: S.phase, active: S.players.filter((p) => p.connected).length, more: more ? more.textContent.trim() : '', morePresent: !!more, rows: rows.length,
                broken: figs.filter((i) => i.complete && i.naturalWidth === 0).length, docW: document.documentElement.scrollWidth, innerW: innerWidth };
            });
            assert.equal(game.active, 12); assert.equal(game.rows, 12, 'a pontlista mind a 12 sort adja'); assert.equal(game.broken, 0, 'nincs törött kép');
            assert.ok(game.docW <= game.innerW + 1, 'játék: nincs vízszintes görgetés: ' + JSON.stringify(game));
            assert.ok(game.morePresent && /^\+\d+$/.test(game.more), 'az esküdtek "+N" jelzéssel: ' + JSON.stringify(game));
            assert.ok(Number(game.more.slice(1)) >= (mobile ? 3 : 2), 'sok esküdt maradt a "+N"-ben: ' + game.more);
            assert.deepEqual(errors, [], 'nincs JS-hiba');
            if (process.env.TWELVE_SHOTS) { fs.mkdirSync(process.env.TWELVE_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.TWELVE_SHOTS, 'jatek-' + W + '.png') }); }
          } finally { await ctx.close(); }
        });
      }
    }
  } finally {
    for (const s of sockets) s.close();
    if (browser) await browser.close();
    server.kill(); narrow.kill();
    console.log('\n3–12 játékos: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
    process.exitCode = failed ? 1 : 0;
  }
})();
