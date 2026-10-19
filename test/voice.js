'use strict';
// ============================================================
// KAMU BÍRÓSÁG – JÁTÉKBELI HANG (BÉTA): WebRTC két böngészőlap között, a Chromium kamu mikrofonjával (--use-fake-device-for-media-stream)
//  A) szerver: kikapcsolt szobában nem lehet belépni; csak a házigazda kapcsolhatja be; létszám-korlát (KB_VOICE_MAX); a jelzés (voice_signal)
//     csak a hangban lévő játékosnak megy, idegen szobába / kívülállónak nem; kikapcsoláskor mindenki kikerül
//  B) böngésző: két játékos belép a hangba → a kapcsolat létrejön, és hang (RTP-csomag) érkezik; beszéd közben csak a beszélő és a bíró mikrofonja él
//     (a többieké automatikusan némul); a kézi némítás erősebb; kilépéskor a kapcsolat lezárul; nincs JS-hiba
// Futtatás: node test/voice.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const io = require('socket.io-client');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* a B) rész kimarad */ }
const PORT = Number(process.env.VOICE_PORT || 3269), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-voice-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sockets = [];
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };
const emit = (s, ev, payload = {}) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('nincs válasz: ' + ev)), 5000); s.emit(ev, payload, (r) => { clearTimeout(t); resolve(r); }); });
async function connect() {
  const s = io(BASE, { transports: ['websocket'], reconnection: false }); sockets.push(s);
  s.on('state', (st) => { s.lastState = st; });
  s.signals = []; s.on('voice_signal', (m) => s.signals.push(m));
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}
async function until(cond, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await pause(80); } return !!(await cond()); }

(async () => {
  const f = (x) => path.join(tmp, x);
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', KB_VOICE: '1', KB_VOICE_MAX: '3', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { /* */ } if (!ready) await pause(150); }
    assert(ready, 'a szerver elindult');

    // ---------- A) szerver ----------
    const h = await connect();
    const r = await emit(h, 'create_room', { name: 'Hangos Hanna', playerId: 'vH' });
    const a = await connect(); assert.ok(!(await emit(a, 'join_room', { code: r.code, name: 'Beszédes Béla', playerId: 'vA' })).error);
    const b = await connect(); assert.ok(!(await emit(b, 'join_room', { code: r.code, name: 'Csendes Cili', playerId: 'vB' })).error);
    const c = await connect(); assert.ok(!(await emit(c, 'join_room', { code: r.code, name: 'Negyedik Nóra', playerId: 'vC' })).error);
    const other = await connect(); const r2 = await emit(other, 'create_room', { name: 'Idegen Ida', playerId: 'vX' });
    await check('A) a konfiguráció jelzi a hangot (KB_VOICE=1); kikapcsolt szobában nem lehet belépni', async () => {
      assert.equal((await (await fetch(BASE + '/api/config')).json()).voice, true);
      assert.equal(h.lastState.voice.on, false);
      assert.match((await emit(a, 'voice_join')).error || '', /nincs bekapcsolva/);
    });
    await check('A) csak a házigazda kapcsolhatja be', async () => {
      assert.match((await emit(a, 'voice_room', { on: true })).error || '', /házigazda/);
      assert.equal((await emit(h, 'voice_room', { on: true })).on, true);
      assert.ok(await until(() => a.lastState.voice && a.lastState.voice.on), 'a többiek látják');
    });
    await check('A) létszám-korlát (KB_VOICE_MAX = 3): a negyedik érthető hibát kap', async () => {
      assert.equal((await emit(h, 'voice_join')).ok, true);
      assert.equal((await emit(a, 'voice_join')).ok, true);
      assert.equal((await emit(b, 'voice_join')).ok, true);
      assert.match((await emit(c, 'voice_join')).error || '', /legfeljebb 3/);
      assert.ok(await until(() => h.lastState.voice.peers.length === 3));
    });
    await check('A) a jelzés csak a hangban lévő célhoz megy; kívülálló és idegen szoba nem kap / nem küldhet', async () => {
      a.emit('voice_signal', { to: 'vB', data: { type: 'offer', sdp: 'v=0 teszt' } });
      a.emit('voice_signal', { to: 'vC', data: { type: 'offer', sdp: 'nem kaphatja' } }); // vC nincs a hangban
      a.emit('voice_signal', { to: 'vX', data: { type: 'offer', sdp: 'idegen szoba' } });
      c.emit('voice_signal', { to: 'vB', data: { type: 'offer', sdp: 'kívülálló küld' } });
      a.emit('voice_signal', { to: 'vB', data: { type: 'hack', sdp: 'rossz típus' } });
      await pause(400);
      assert.deepEqual(b.signals.map((m) => m.from + ':' + m.data.sdp), ['vA:v=0 teszt']);
      assert.equal(c.signals.length, 0); assert.equal(other.signals.length, 0);
    });
    await check('A) kilépés a hangból / a szobából: kikerül a listából; kikapcsoláskor mindenki kikerül', async () => {
      await emit(b, 'voice_leave');
      assert.ok(await until(() => h.lastState.voice.peers.length === 2 && !h.lastState.voice.peers.includes('vB')));
      a.disconnect();
      assert.ok(await until(() => !h.lastState.voice.peers.includes('vA')), 'lecsatlakozás: kikerül');
      await emit(h, 'voice_room', { on: false });
      assert.ok(await until(() => h.lastState.voice.on === false && h.lastState.voice.peers.length === 0));
    });
    void r2;

    // ---------- B) böngésző: valódi WebRTC két lap között ----------
    if (!chromium) { console.log('SKIP: B) a playwright-core nincs telepítve.'); }
    else {
      const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
      const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
      let browser = null; for (const o of attempts) { try { browser = await chromium.launch({ headless: true, args, ...o }); break; } catch (_) { /* */ } }
      if (!browser) console.log('SKIP: B) nincs böngésző.');
      else {
        const errors = [];
        try {
          const mk = async (name) => {
            const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'hu-HU', permissions: ['microphone'] });
            await ctx.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
            const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
            await p.goto(BASE + '/'); await p.waitForSelector('#authGuest'); await p.click('#authGuest');
            await p.waitForFunction(() => document.body.dataset.screen === 'name');
            await p.evaluate(() => document.getElementById('btnNewSuspect').click()); await p.fill('#guestName', name);
            await p.evaluate(() => document.getElementById('btnGuestGo').click()); await p.waitForFunction(() => document.body.dataset.screen === 'menu');
            return p;
          };
          const p1 = await mk('Első Emma'), p2 = await mk('Második Máté');
          await p1.evaluate(() => document.getElementById('btnCreate').click()); await p1.waitForFunction(() => document.body.dataset.screen === 'lobby');
          const code = await p1.evaluate(() => MY.code);
          await p2.fill('#codeInput', code); await p2.click('#btnJoin'); await p2.waitForFunction(() => document.body.dataset.screen === 'lobby');
          await p1.evaluate(() => document.getElementById('btnAddBot').click());
          await check('B) a házigazda a lobbiban bekapcsolja a hangot; mindkét játékos látja a "Belépés a hangba" gombot', async () => {
            await p1.waitForSelector('#btnVoiceRoom', { state: 'visible', timeout: 5000 });
            await p1.click('#btnVoiceRoom');
            await p1.waitForSelector('#btnVoiceLobby', { state: 'visible', timeout: 5000 });
            await p2.waitForSelector('#btnVoiceLobby', { state: 'visible', timeout: 5000 });
            assert.equal(await p2.isVisible('#btnVoiceRoom'), false, 'nem a házigazdának nincs kapcsoló');
          });
          await check('B) mindketten belépnek: a WebRTC-kapcsolat létrejön, és hang (RTP-csomag) érkezik', async () => {
            await p1.click('#btnVoiceLobby'); await p2.click('#btnVoiceLobby');
            const connected = async (p) => p.evaluate(() => { const st = window.kbVoice.state(); return Object.values(st.peers).includes('connected'); });
            assert.ok(await until(() => connected(p1), 15000), 'p1 kapcsolódott: ' + JSON.stringify(await p1.evaluate(() => window.kbVoice.state())));
            assert.ok(await until(() => connected(p2), 15000), 'p2 kapcsolódott');
            const inbound = (p) => p.evaluate(async () => { let n = 0; for (const a of document.querySelectorAll('#voiceAudio audio')) { const s = a.srcObject; if (s && s.getAudioTracks().length) n++; } return n; });
            assert.ok(await until(async () => (await inbound(p1)) >= 1 && (await inbound(p2)) >= 1, 8000), 'mindkét oldalon van bejövő hang-sáv');
            const packets = (p) => p.evaluate(async () => Object.values(await window.kbVoice.stats()).reduce((a, b) => a + b, 0));
            assert.ok(await until(async () => (await packets(p1)) > 20 && (await packets(p2)) > 20, 8000), 'RTP hangcsomagok érkeznek: ' + (await packets(p1)) + ' / ' + (await packets(p2)));
          });
          await check('B) beszéd közben csak a beszélő és a bíró mikrofonja él (a többieké automatikusan némul)', async () => {
            await p1.evaluate(() => { document.getElementById('btnCustomGame').click(); const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('setPrep', 10); set('setSpeech', 60);
              const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click(); document.getElementById('btnSaveSettings').click(); });
            await pause(400);
            await p1.evaluate(() => document.getElementById('btnStartGame').click());
            await p1.waitForFunction(() => S && S.phase === 'accusation', null, { timeout: 10000 });
            const open = await p1.evaluate(() => window.kbVoice.state().trackEnabled);
            assert.equal(open, true, 'a vádemelésnél mindenki beszélhet');
            await p1.evaluate(() => document.getElementById('iaAccRead').click());
            await p1.waitForFunction(() => S && S.phase === 'prosecution', null, { timeout: 15000 });
            await pause(400);
            for (const p of [p1, p2]) {
              const st = await p.evaluate(() => ({ me: MY.playerId, pros: S.prosecutorId, judge: S.currentJudgeId, on: window.kbVoice.state().trackEnabled, auto: window.kbVoice.state().autoMuted }));
              const expect = st.me === st.pros || st.me === st.judge;
              assert.equal(st.on, expect, 'mikrofon ' + (expect ? 'él' : 'némul') + ': ' + JSON.stringify(st));
              assert.equal(st.auto, !expect);
            }
          });
          await check('B) a kézi némítás erősebb: a beszélő is elnémíthatja magát; a játékbeli 🎙️ gomb mutatja', async () => {
            const speaker = (await p1.evaluate(() => MY.playerId === S.prosecutorId || MY.playerId === S.currentJudgeId)) ? p1 : p2;
            await speaker.evaluate(() => window.kbVoice.toggleMute());
            assert.equal(await speaker.evaluate(() => window.kbVoice.state().trackEnabled), false);
            assert.equal((await speaker.textContent('#btnVoice')).trim(), '🔇');
            await speaker.evaluate(() => window.kbVoice.toggleMute());
            assert.equal(await speaker.evaluate(() => window.kbVoice.state().trackEnabled), true);
          });
          await check('B) kilépés a hangból: a kapcsolat lezárul a másik oldalon is', async () => {
            await p2.evaluate(() => window.kbVoice.leave());
            assert.ok(await until(() => p1.evaluate(() => Object.keys(window.kbVoice.state().peers).length === 0), 6000), 'p1-nél megszűnt a kapcsolat');
          });
          await check('B) nincs JS-hiba', async () => { assert.deepEqual(errors, []); });
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
  console.log('\nJátékbeli hang (béta): ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
