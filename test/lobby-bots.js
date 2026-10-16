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

// ---- fiókok (a bot-jog fiókhoz kötött): regisztráció API-val, socket-azonosítás jeggyel ----
const crypto = require('crypto');
const password = 'Egy hosszú titok 123!';
async function http(BASE, method, route, body, jar) {
  const headers = method === 'POST' ? { 'Content-Type': 'application/json', Origin: BASE } : {};
  if (jar && jar.size) headers.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const response = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (jar) for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(';')[0], i = first.indexOf('=');
    if (first.slice(i + 1)) jar.set(first.slice(0, i), first.slice(i + 1)); else jar.delete(first.slice(0, i));
  }
  const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
  return { status: response.status, data };
}
async function account(BASE, name) {
  const jar = new Map();
  const r = await http(BASE, 'POST', '/api/auth/register', { username: name, email: crypto.randomUUID() + '@example.invalid', password, confirmPassword: password }, jar);
  assert.equal(r.status, 201, 'regisztráció: ' + name);
  return { name, jar };
}
// Socket a fiókkal azonosítva, szobával; visszaadja a socketet és az identify válaszát.
async function accountRoom(BASE, acct, playerId) {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); });
  const ticket = (await http(BASE, 'POST', '/api/friends/ticket', {}, acct.jar)).data.ticket;
  const ident = await emit(s, 'identify', { ticket });
  const r = await emit(s, 'create_room', { name: acct.name, avatar: '', playerId });
  assert.ok(r.code, JSON.stringify(r));
  return { s, ident };
}
async function botsFor(BASE, name, playerId) {
  const acct = await account(BASE, name);
  const { s, ident } = await accountRoom(BASE, acct, playerId);
  const add = await emit(s, 'add_bot'), rem = ident.bots ? await emit(s, 'remove_bot') : null;
  s.disconnect();
  return { bots: ident.bots, add, rem };
}

// A böngészőben a fiókkal belépett házigazda lobbijában látszik-e a gomb (a fiók sütije az API-s regisztrációból jön).
async function browserAccountCheck(BASE, name, expectVisible) {
  const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'msedge' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* */ } });
    const reg = await ctx.request.post(BASE + '/api/auth/register', { data: { username: name, email: crypto.randomUUID() + '@example.invalid', password, confirmPassword: password }, headers: { Origin: BASE } });
    assert.equal(reg.status(), 201, 'regisztráció ' + name);
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' }); await pause(900);
    await page.waitForSelector('#authContinue:not(.hidden)', { timeout: 15000 }); await page.locator('#authContinue').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'name' && window.kbAccount, null, { timeout: 15000 }); await pause(700);
    await page.locator('#profileCardSlot .mug-card.mug-me').first().click(); await page.locator('#avatarModalOk').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'menu', null, { timeout: 15000 }); await pause(400);
    await page.evaluate(() => document.getElementById('btnCreate').click());
    await page.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 15000 });
    await pause(1200);
    assert.equal(await page.isVisible('#btnAddBot'), expectVisible, 'a "Bot hozzáadása" gomb láthatósága (' + name + ')');
    if (expectVisible) {
      await page.click('#btnAddBot');
      await page.waitForFunction(() => S.players.some((p) => p.isBot), null, { timeout: 5000 });
      await page.waitForSelector('#btnRemoveBot:not(.hidden)');
    }
  } finally { await browser.close(); }
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
  await test('élesen a botot csak a kijelölt fiók (alapból SasiHH) kapja: más fiók és vendég nem; a szerver is elutasítja', async () => {
    await withServer(3240, { RENDER: 'true' }, async (BASE) => {
      const a = await botsFor(BASE, 'SasiHH', 'pa1');
      assert.equal(a.bots, true, 'az identify jelzi: a kijelölt fiók kaphat botot');
      assert.ok(a.add.ok && a.rem.ok, 'a kijelölt fiók hozzáadhat / elvehet botot: ' + JSON.stringify([a.add, a.rem]));
      const b = await botsFor(BASE, 'Masik Fiok', 'pb1');
      assert.equal(b.bots, false);
      assert.match(b.add.error || '', /ki vannak kapcsolva/);
      // vendég (nincs identify) sem
      const g = await hostRoom(BASE);
      assert.match((await emit(g, 'add_bot')).error || '', /ki vannak kapcsolva/);
      g.disconnect();
      if (chromium) { await browserAccountCheck(BASE, 'SasiHH2', false); }
    });
  });
  await test('a böngészőben élesen csak a kijelölt fióknak látszik a "Bot hozzáadása" gomb (és működik)', async () => {
    if (!chromium) return;
    await withServer(3241, { RENDER: 'true', KB_BOT_USERS: 'Kiv Alasztott' }, async (BASE) => {
      await browserAccountCheck(BASE, 'Kiv Alasztott', true);
    });
    await withServer(3242, { RENDER: 'true', KB_BOT_USERS: 'Kiv Alasztott' }, async (BASE) => {
      await browserAccountCheck(BASE, 'Mas Fiok', false);
    });
  });
  await test('KB_BOT_USERS: kis/nagybetű és szóköz nem számít, lista; a nem szereplő fiók (pl. SasiHH) nem kap botot; a KB_LOBBY_BOTS=1 mindenkinek ad', async () => {
    await withServer(3243, { RENDER: 'true', KB_BOT_USERS: '  tESZT egy ,Teszt Ketto' }, async (BASE) => {
      assert.equal((await botsFor(BASE, 'Teszt Egy', 'pc1')).bots, true);
      assert.equal((await botsFor(BASE, 'Teszt Ketto', 'pc2')).bots, true);
      assert.equal((await botsFor(BASE, 'SasiHH', 'pc3')).bots, false, 'az alapérték nem érvényes, ha a lista meg van adva');
    });
    await withServer(3244, { RENDER: 'true', KB_LOBBY_BOTS: '1' }, async (BASE) => {
      assert.equal((await botsFor(BASE, 'Barki Fiok', 'pd1')).bots, true);
    });
  });
  console.log('\nLobbi-botok: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exit(failed ? 1 : 0);
})();
