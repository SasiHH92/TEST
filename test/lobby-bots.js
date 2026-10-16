'use strict';
// ============================================================
// KAMU BÍRÓSÁG – lobbi-botok: élesen (Render) alapból KI, helyben / teszteken BE; a KB_LOBBY_BOTS felülírja
//  - /api/config mondja meg a kliensnek; a szerver a kikapcsolt botkérést elutasítja
//  - böngésző: a házigazda lobbijában a "Bot hozzáadása / eltávolítása" gomb élesen nem látszik, helyben igen
// Futtatás: node test/lobby-bots.js
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* böngésző nélkül a böngészős rész kimarad */ }

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-bots-'));
const f = (n) => path.join(tmp, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}

async function withServer(port, env, work) {
  const BASE = 'http://127.0.0.1:' + port;
  const clean = { ...process.env }; delete clean.RENDER; delete clean.KB_LOBBY_BOTS;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...clean, PORT: String(port), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DISCORD_BOT_TOKEN: '', RESEND_API_KEY: '', EMAIL_FROM: '', AUTH_MAIL_API_KEY: '', AUTH_MAIL_FROM: '',
      AUTH_STORE_PATH: f('acc' + port + '.json'), KB_AVATARS_FILE: f('av' + port + '.json'), KB_STATS_FILE: f('st' + port + '.json'), KB_COURTS_FILE: f('c' + port + '.json'),
      KB_DMS_FILE: f('d' + port + '.json'), KB_MODERATION_FILE: f('m' + port + '.json'), KB_ERRORS_FILE: f('e' + port + '.json'), KB_BUGREPORTS_FILE: f('b' + port + '.json'), ...env }
  });
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');
    await work(BASE);
  } finally { child.kill(); }
}
const emit = (s, ev, payload = {}) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('Ack timeout: ' + ev)), 4000); s.emit(ev, payload, (res) => { clearTimeout(t); resolve(res); }); });
async function hostRoom(BASE) {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); });
  const r = await emit(s, 'create_room', { name: 'Bot Bela', avatar: '', playerId: 'hb1' });
  assert.ok(r.code, JSON.stringify(r));
  return s;
}

async function browserCheck(BASE, expectVisible) {
  const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* */ } });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#authGuest'); await page.click('#authGuest');
    await page.waitForFunction(() => document.body.dataset.screen === 'name');
    await page.evaluate(() => document.getElementById('btnNewSuspect').click());
    await page.fill('#guestName', 'Gomb Geza');
    await page.evaluate(() => document.getElementById('btnGuestGo').click());
    await page.waitForFunction(() => document.body.dataset.screen === 'menu');
    await page.evaluate(() => document.getElementById('btnCreate').click());
    await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
    await page.waitForFunction(() => typeof LOBBY_BOTS === 'boolean');
    await pause(500);
    const visible = await page.isVisible('#btnAddBot');
    assert.equal(visible, expectVisible, 'a "Bot hozzáadása" gomb láthatósága');
    assert.equal(await page.isVisible('#btnRemoveBot'), false, 'bot nélkül az eltávolítás gomb nem látszik');
    if (expectVisible) {
      await page.click('#btnAddBot');
      await page.waitForFunction(() => S.players.some((p) => p.isBot), null, { timeout: 5000 });
      await page.waitForSelector('#btnRemoveBot:not(.hidden)');
    }
  } finally { await browser.close(); }
}

(async () => {
  await test('élesen (RENDER=true): /api/config szerint nincs bot, a szerver elutasítja a kérést, a "Bot hozzáadása" gomb nem látszik', async () => {
    await withServer(3218, { RENDER: 'true' }, async (BASE) => {
      assert.deepEqual(await (await fetch(BASE + '/api/config')).json(), { lobbyBots: false });
      const s = await hostRoom(BASE);
      const a = await emit(s, 'add_bot'); assert.match(a.error || '', /ki vannak kapcsolva/);
      const r = await emit(s, 'remove_bot'); assert.match(r.error || '', /ki vannak kapcsolva/);
      s.disconnect();
      if (chromium) await browserCheck(BASE, false);
    });
  });
  await test('helyben / teszteken (nincs RENDER): a botok működnek, a gomb látszik', async () => {
    await withServer(3219, {}, async (BASE) => {
      assert.deepEqual(await (await fetch(BASE + '/api/config')).json(), { lobbyBots: true });
      const s = await hostRoom(BASE);
      assert.ok((await emit(s, 'add_bot')).ok);
      assert.ok((await emit(s, 'remove_bot')).ok);
      s.disconnect();
      if (chromium) await browserCheck(BASE, true);
    });
  });
  await test('a KB_LOBBY_BOTS felülírja az alapot (élesen bekapcsolható, helyben kikapcsolható)', async () => {
    await withServer(3220, { RENDER: 'true', KB_LOBBY_BOTS: '1' }, async (BASE) => {
      assert.deepEqual(await (await fetch(BASE + '/api/config')).json(), { lobbyBots: true });
    });
    await withServer(3221, { KB_LOBBY_BOTS: '0' }, async (BASE) => {
      assert.deepEqual(await (await fetch(BASE + '/api/config')).json(), { lobbyBots: false });
    });
  });
  console.log('\nLobbi-botok: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exit(failed ? 1 : 0);
})();
