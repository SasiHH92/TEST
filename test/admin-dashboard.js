'use strict';
// ============================================================
// KAMU BÍRÓSÁG – az admin műszerfal (activity.js, GET /api/admin/overview, public/admin.js Áttekintés / Élő szobák / Hibajelentések)
//  A) activity.js: napi számok (egyedi játékos név nélkül, napváltáskor új nap), percenkénti minta → napi csúcs + óránkénti legtöbb (48 óra), a fájlba nem kerül név;
//     látogatottság: megnyitás / egyedi látogató / szobalinkről, a lenyomat naponta új kulccsal, IP-cím nem kerül a fájlba; botszűrő
//  B2) GET /: böngésző számít, bot / link-előnézet / előtöltés / HEAD nem; /?room=KÓD szobalinkről
//  B) /api/admin/overview: token nélkül 401; tokennel az élő szoba (játékosnevek, bot, házigazda), a számlálók, a hibajelentés, az indított játék a naplóban
//  C) böngésző: belépés után az Áttekintés az alapfül, a KPI-k, a 4 grafikon (oszlopok, értékcímke egérre és ← → nyílra, táblázat-nézet), élő szoba-kártya,
//     ranglista-váltó, hibajelentés-szűrő; a játékosnév / hibaszöveg SZÖVEGKÉNT jelenik meg (nincs HTML-befecskendezés); mobilon (390) nincs vízszintes görgetés; nincs konzol-hiba
// Futtatás:  node test/admin-dashboard.js      (böngésző nélkül a C) rész SKIP; ADMIN_DASH_REQUIRE=1 esetén hiba)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { io } = require('socket.io-client');
const { createActivity, dayOf, isBotAgent } = require('../activity');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* a C) rész kimarad */ }
const PORT = Number(process.env.ADMIN_DASH_PORT || 3293), BASE = 'http://127.0.0.1:' + PORT;
const REQUIRE = process.env.ADMIN_DASH_REQUIRE === '1';
const TOKEN = crypto.randomBytes(24).toString('base64url'); // csak ehhez a teszthez
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-admindash-'));
const f = (x) => path.join(tmp, x);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky/i;
const EVIL = '<img src=x onerror="window.__pwned=1">';
const EVIL_NAME = '<b id=pwn>XSS</b>'; // a játékosnév legfeljebb 20 karakter
let passed = 0, failed = 0;
const sockets = [];
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); }
}
const emit = (s, ev, payload = {}) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('nincs válasz: ' + ev)), 5000);
  s.emit(ev, payload, (res) => { clearTimeout(t); resolve(res); });
});
async function connect() {
  const s = io(BASE, { transports: ['websocket'], reconnection: false }); sockets.push(s);
  s.on('state', (st) => { s.lastState = st; });
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}
async function until(cond, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await pause(60); } return cond(); }
const admin = (p, token = TOKEN) => fetch(BASE + '/api/admin' + p, { headers: token ? { Authorization: 'Bearer ' + token } : {} });

// ---------- A) activity.js ----------
async function unit() {
  let clock = Date.parse('2026-03-10T10:15:00Z');
  const file = f('act-unit.json');
  let persisted = 0;
  const a = createActivity({ file, now: () => clock, persist: () => { persisted++; } });
  await check('A) indított játék: a napi egyedi játékosszám nevek szerint (kis/nagybetű, szóköz mindegy), több játék nem duplázza', async () => {
    a.gameStarted(['Anna', 'Béla', 'Cili']);
    a.gameStarted([' anna ', 'BÉLA', 'Dóra']);
    a.gameFinished(); a.gameAborted();
    const today = a.summary(3).days.at(-1);
    assert.equal(today.day, dayOf(clock));
    assert.deepEqual({ s: today.started, f: today.finished, a: today.aborted, p: today.players }, { s: 2, f: 1, a: 1, p: 4 });
  });
  await check('A) percenkénti minta: napi csúcs és óránként a legtöbb; a hiányzó órák / napok 0-val jönnek', async () => {
    a.sample({ players: 5, rooms: 2, sockets: 9 }); clock += 60000;
    a.sample({ players: 3, rooms: 1, sockets: 4 }); clock += HOUR;
    a.sample({ players: 7, rooms: 3, sockets: 12 });
    const s = a.summary(30);
    assert.equal(s.days.length, 30); assert.equal(s.hours.length, 48);
    assert.equal(s.days.at(-1).peakPlayers, 7); assert.equal(s.days.at(-1).peakRooms, 3);
    assert.deepEqual(s.hours.slice(-2).map((h) => h.players), [5, 7]);
    assert.ok(s.hours.slice(0, -2).every((h) => h.players === 0), 'a korábbi órák 0');
    assert.ok(s.days.slice(0, -1).every((d) => d.started === 0 && d.players === 0), 'a korábbi napok 0');
    for (let i = 1; i < s.hours.length; i++) assert.equal(s.hours[i].t - s.hours[i - 1].t, HOUR, 'folytonos órák');
  });
  await check('A) napváltás: új nap, a tegnapi számok megmaradnak, a ma egyedi játékosai újra számolódnak; 48 óránál régebbi minta törlődik', async () => {
    clock += DAY;
    a.gameStarted(['Anna']);
    const s = a.summary(3);
    assert.equal(s.days.at(-1).players, 1, 'ma Anna új egyedi játékos');
    assert.equal(s.days.at(-2).players, 4, 'a tegnapi szám marad');
    clock += 3 * DAY; a.sample({ players: 1, rooms: 1, sockets: 1 });
    assert.equal(a.summary(1).hours.filter((h) => h.players).length, 1, 'csak a friss minta maradt');
  });
  await check('A) a fájlba nem kerül játékosnév (csak rövid ujjlenyomat), és újratöltve megmaradnak a számok', async () => {
    a.flush();
    const raw = fs.readFileSync(file, 'utf8');
    for (const n of ['Anna', 'anna', 'Béla', 'Cili', 'Dóra']) assert.ok(!raw.includes(n), 'nincs benne: ' + n);
    assert.ok(persisted >= 1, 'a Neon-mentés jelzést kapott');
    const b = createActivity({ file, now: () => clock });
    assert.equal(b.summary(5).days.find((d) => d.day === dayOf(Date.parse('2026-03-10T10:15:00Z'))).players, 4);
  });
  await check('A) látogatás: azonos cím + böngésző egy látogató; másik böngésző / cím új; szobalinkről külön; újratöltve is megmarad', async () => {
    const UA1 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', UA2 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36';
    a.visit({ ip: '203.0.113.7', ua: UA1 }); a.visit({ ip: '203.0.113.7', ua: UA1 }); a.visit({ ip: '203.0.113.7', ua: UA2, invite: true }); a.visit({ ip: '198.51.100.9', ua: UA1 });
    const t = a.summary(1).days[0];
    assert.deepEqual({ v: t.views, u: t.visitors, i: t.invites }, { v: 4, u: 3, i: 1 });
    a.flush();
    const raw = fs.readFileSync(file, 'utf8');
    for (const x of ['203.0.113.7', '198.51.100.9', 'iPhone', 'Chrome/130']) assert.ok(!raw.includes(x), 'nincs a fájlban: ' + x);
    const b = createActivity({ file, now: () => clock });
    b.visit({ ip: '203.0.113.7', ua: UA1 });
    assert.deepEqual({ v: b.summary(1).days[0].views, u: b.summary(1).days[0].visitors }, { v: 5, u: 3 }, 'újraindítás után ugyanaz a látogató nem számít újnak');
  });
  await check('A) látogatás: napváltáskor új kulcs, a tegnapi lenyomatok törlődnek (a tegnapi látogató ma újra számít, a tegnapi szám marad)', async () => {
    const before = JSON.parse(fs.readFileSync(file, 'utf8')).today;
    clock += DAY;
    a.visit({ ip: '203.0.113.7', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' });
    a.flush();
    const after = JSON.parse(fs.readFileSync(file, 'utf8')).today;
    assert.notEqual(after.salt, before.salt, 'új napi kulcs'); assert.equal(after.visitors.length, 1);
    assert.ok(!after.visitors.some((x) => before.visitors.includes(x)), 'a tegnapi lenyomatok nincsenek meg');
    const days = a.summary(2).days;
    assert.equal(days[1].visitors, 1); assert.equal(days[0].visitors, 3);
  });
  await check('A) botszűrő: keresőrobot, link-előnézet, letöltő, fej nélküli böngésző, üres UA nem látogató; telefon / gép igen', async () => {
    for (const ua of ['Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', 'facebookexternalhit/1.1', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'TelegramBot (like TwitterBot)',
      'WhatsApp/2.23', 'curl/8.4.0', 'python-requests/2.31', 'node-fetch', 'Go-http-client/1.1', 'Mozilla/5.0 HeadlessChrome/120', 'Render/1.0', '', 'x'])
      assert.equal(isBotAgent(ua), true, ua);
    for (const ua of ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'])
      assert.equal(isBotAgent(ua), false, ua);
  });
}

// előre feltöltött napló, hogy a grafikonokon legyen mit mutatni
function seedActivity() {
  const t = Date.now(), days = {}, hours = [];
  for (let i = 0; i < 12; i++) days[dayOf(t - i * DAY)] = { started: 3 + (i % 4), finished: 2 + (i % 3), aborted: i % 2, players: 6 + i, peakPlayers: 4 + (i % 5), peakRooms: 1 + (i % 3) };
  for (let i = 0; i < 30; i++) hours.push({ t: Math.floor((t - (29 - i) * HOUR) / HOUR) * HOUR, players: (i * 7) % 11, rooms: (i % 4), sockets: (i * 7) % 11 + 2 });
  fs.writeFileSync(f('activity.json'), JSON.stringify({ version: 1, days, hours, today: { day: '', ids: [] } }));
}

async function main() {
  await unit();
  seedActivity();
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: process.env.ADMIN_DASH_VERBOSE ? 'inherit' : 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
    DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '', ADMIN_TOKEN: TOKEN, KB_LOBBY_BOTS: '1', MAX_ROOMS_PER_IP: '30',
    AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'), KB_CARDFB_FILE: f('cf.json'),
    KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json'), KB_BUGIMAGES_DIR: f('bugimg'), KB_ACTIVITY_FILE: f('activity.json') } });
  let browser = null;
  try {
    assert.ok(await until(async () => { try { return (await fetch(BASE + '/health')).ok; } catch (_) { return false; } }, 12000), 'a szerver elindult');

    // két szoba: egy folyó tárgyalás (3 ember + bot) és egy gyülekező (a házigazda neve "gonosz" HTML)
    const host = await connect();
    const code = (await emit(host, 'create_room', { name: 'Admin Aladár', playerId: 'adH' })).code;
    const mates = [];
    for (const [n, id] of [['Bíró Bella', 'adB'], ['Cinkos Csaba', 'adC']]) { const s = await connect(); mates.push(s); assert.ok(!(await emit(s, 'join_room', { code, name: n, playerId: id })).error); }
    await emit(host, 'add_bot');
    await until(() => host.lastState && host.lastState.players.length === 4);
    const started = await emit(host, 'start_game', { settings: { modes: ['buli'], autoNextRound: false, autoNewGame: false } });
    assert.ok(!started || !started.error, 'a játék elindult: ' + JSON.stringify(started));
    const evil = await connect();
    const evilRoom = await emit(evil, 'create_room', { name: EVIL_NAME, playerId: 'adE' });
    assert.ok(evilRoom && evilRoom.code, 'a "gonosz" nevű szoba létrejött: ' + JSON.stringify(evilRoom));
    const bugRes = await fetch(BASE + '/api/bugreport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Hibás Henrik', kind: 'ui', text: 'A gomb eltűnt ' + EVIL + ' a menüből', where: 'menu', room: code }) });
    assert.equal(bugRes.status, 200, 'hibajelentés elküldve');

    // ---------- B2) látogatás a főoldalon ----------
    const page0 = (q, headers, method = 'GET') => fetch(BASE + '/' + q, { method, headers });
    const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', DESK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36';
    await page0('', { 'User-Agent': PHONE }); await page0('', { 'User-Agent': PHONE }); await page0('?room=' + code, { 'User-Agent': DESK });
    await page0('?room=' + code, { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' });
    await page0('', { 'User-Agent': DESK, 'Sec-Purpose': 'prefetch' });
    await page0('', { 'User-Agent': DESK }, 'HEAD');
    await page0('?room=<script>', { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.0 Safari/605.1.15' });
    await check('B2) GET /: 4 megnyitás, 3 egyedi látogató, 1 szobalinkről; a Discord-előnézet, az előtöltés és a HEAD nem számít; rossz kód nem szobalink', async () => {
      const t = (await (await admin('/overview')).json()).activity.days.at(-1);
      assert.deepEqual({ v: t.views, u: t.visitors, i: t.invites }, { v: 4, u: 3, i: 1 }, JSON.stringify(t));
    });

    // ---------- B) API ----------
    let o;
    await check('B) /api/admin/overview: token nélkül és rossz tokennel 401', async () => {
      assert.equal((await admin('/overview', '')).status, 401);
      assert.equal((await admin('/overview', 'rossz-token-0123456789abcdef')).status, 401);
    });
    await check('B) tokennel: élő szobák (folyó tárgyalás + gyülekező), játékosnevek, bot, házigazda, számlálók', async () => {
      const r = await admin('/overview'); assert.equal(r.status, 200);
      assert.match(r.headers.get('cache-control') || '', /no-store/);
      o = await r.json();
      assert.equal(o.live.totals.rooms, 2); assert.equal(o.live.totals.playing, 1); assert.equal(o.live.totals.lobbies, 1);
      assert.equal(o.live.totals.humans, 4); assert.equal(o.live.totals.bots, 1);
      const game = o.live.rooms.find((x) => x.code === code);
      assert.ok(game && game.phase !== 'lobby', 'a folyó tárgyalás');
      assert.equal(game.rounds > 0, true);
      assert.deepEqual(game.players.filter((p) => !p.bot).map((p) => p.name).sort(), ['Admin Aladár', 'Bíró Bella', 'Cinkos Csaba']);
      assert.ok(game.players.find((p) => p.host).name === 'Admin Aladár');
      assert.equal(game.players.filter((p) => p.bot).length, 1);
      assert.equal(o.live.rooms[0].code, code, 'a több játékosú szoba elöl');
      assert.ok(!JSON.stringify(o).includes(TOKEN), 'a token nem kerül a válaszba');
      assert.ok(!/sessionToken|password|email/i.test(JSON.stringify(o.live)), 'nincs munkamenet / jelszó / e-mail az élő adatban');
    });
    await check('B) a napló: a ma indított játék és a 3 egyedi ember (bot nélkül), 30 nap + 48 óra, a betöltött korábbi napok', async () => {
      const today = o.activity.days.at(-1);
      assert.equal(o.activity.days.length, 30); assert.equal(o.activity.hours.length, 48);
      assert.ok(today.started >= 4, 'a betöltött 3 + a mostani: ' + today.started);
      assert.ok(today.players >= 3);
      assert.ok(today.peakPlayers >= 4, 'a lekérés is mintát vesz: ' + today.peakPlayers);
      assert.equal(o.activity.days.at(-2).finished, 3, 'a tegnapi betöltött érték');
    });
    await check('B) hibajelentés, szerver- és fiókadatok a válaszban', async () => {
      assert.equal(o.bugs.total, 1); assert.equal(o.bugs.byStatus.new, 1);
      assert.equal(o.bugs.latest[0].kind, 'ui'); assert.equal(o.bugs.latest[0].room, code);
      assert.ok(o.server.memory.rss > 0 && o.server.uptimeSeconds >= 0 && o.server.maxRooms > 0 && o.server.maxPlayers >= 3);
      assert.equal(typeof o.accounts.total, 'number'); assert.ok(Array.isArray(o.players.top) && Array.isArray(o.players.topWeek));
    });

    // ---------- C) böngésző ----------
    if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve (C rész).'); if (REQUIRE) failed++; return; }
    for (const options of process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
      try { browser = await chromium.launch({ headless: true, ...options }); break; } catch (_) { /* a következőt próbáljuk */ }
    }
    if (!browser) { console.log('SKIP: nincs használható böngésző (C rész).'); if (REQUIRE) failed++; return; }
    const open = async (viewport) => {
      const context = await browser.newContext({ viewport, locale: 'hu-HU' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await page.fill('#token', TOKEN); await page.click('#loginForm button[type=submit]');
      await page.waitForSelector('#tab-overview', { state: 'visible' });
      await page.waitForFunction(() => document.querySelectorAll('#ovKpis .kpi').length > 0);
      return { context, page, errors };
    };
    const { context, page, errors } = await open({ width: 1440, height: 1000 });
    await check('C) belépés után az Áttekintés: cím, élő jelző, online szám, 10 KPI; a Fiókok nincs elöl', async () => {
      assert.equal(await page.textContent('#pageTitle'), 'Áttekintés');
      assert.equal(await page.isVisible('#accounts'), false);
      assert.equal(await page.isVisible('#stats'), false, 'az összesítő sor az Áttekintésen rejtett (a KPI-k helyettesítik)');
      assert.equal((await page.textContent('#ovOnline')).trim(), '4');
      assert.match(await page.textContent('#ovOnlineSub'), /2 szoba · 1 folyó tárgyalás · 1 gyülekező · 1 bot/);
      assert.match(await page.textContent('#liveTxt'), /élő · frissítve \d/);
      assert.equal(await page.$$eval('#ovKpis .kpi', (e) => e.length), 10);
      assert.match(await page.textContent('#ovKpis'), /Új hibajelentés\s*1/);
      assert.match(await page.textContent('#ovKpis'), /Mai látogató\s*3\s*4 megnyitás · 1 szobalinkről/);
      assert.match(await page.textContent('#ovServer'), /Kapcsolatok/);
      assert.equal(await page.textContent('#cntLive'), '4'); assert.equal(await page.textContent('#cntBugs'), '1');
    });
    await check('C) az 5 grafikon: oszlopok a betöltött napokra, rakott oszlop 2 sorozattal, x/y címkék, táblázat-nézet (a látogatóknál a megnyitás is)', async () => {
      const info = await page.evaluate(() => ['#chOnline', '#chGames', '#chPlayers', '#chSignups', '#chVisitors'].map((sel) => {
        const box = document.querySelector(sel);
        return { sel, cols: box.querySelectorAll('.ch-col').length, bars: box.querySelectorAll('.seg-bar').length, s2: box.querySelectorAll('.seg-bar.s2').length,
          y: box.querySelectorAll('.ch-y span').length, x: box.querySelectorAll('.ch-x-labels span').length, rows: box.querySelectorAll('.ch-table tr').length, empty: !!box.querySelector('.ch-empty'),
          maxBarW: Math.max(0, ...[...box.querySelectorAll('.seg-bar')].map((b) => b.getBoundingClientRect().width)) };
      }));
      const [on, games, players, signups, visitors] = info;
      assert.equal(visitors.cols, 30); assert.equal(visitors.bars, 1, 'ma van látogató: ' + JSON.stringify(visitors));
      assert.match(await page.textContent('#chVisitors .ch-table tr:nth-child(2)'), /3\s*4\s*1/, 'a mai sor: látogató, megnyitás, szobalinkről');
      assert.match(await page.textContent('#chVisitors .ch-table tr:first-child'), /egyedi látogató\s*megnyitás\s*szobalinkről/);
      assert.equal(on.cols, 48); assert.ok(on.bars >= 20, JSON.stringify(on)); assert.equal(on.rows, 49);
      assert.equal(games.cols, 30); assert.ok(games.s2 >= 5, 'megszakadt szeletek: ' + JSON.stringify(games)); assert.ok(games.y >= 3 && games.x >= 4, JSON.stringify(games));
      assert.equal(players.cols, 30); assert.ok(players.bars >= 12);
      assert.ok(signups.empty, 'regisztráció nélkül üres-állapot szöveg: ' + JSON.stringify(signups));
      for (const c of info) assert.ok(c.maxBarW <= 24.5, c.sel + ' oszlopszélesség ≤ 24 px: ' + c.maxBarW);
    });
    await check('C) értékcímke: egérrel a rakott oszlop fölé → a nap + befejezett / megszakadt; billentyűvel (← →) is', async () => {
      const col = page.locator('#chGames .ch-col').last();
      await col.hover();
      await page.waitForSelector('.tip:not(.hidden)');
      const t = await page.textContent('.tip');
      assert.match(t, /\d{4}-\d\d-\d\d/); assert.match(t, /befejezett/); assert.match(t, /megszakadt/);
      await page.mouse.move(5, 5);
      await page.waitForSelector('.tip.hidden', { state: 'attached' });
      await page.focus('#chOnline .ch-plot');
      await page.keyboard.press('ArrowLeft');
      assert.match(await page.textContent('.tip'), /online játékos/);
      assert.equal(await page.$$eval('#chOnline .ch-col.focus', (e) => e.length), 1);
      await page.keyboard.press('Tab');
    });
    await check('C) élő szobák, ranglista-váltó, legutóbbi hibajelentés az Áttekintésen', async () => {
      assert.match(await page.textContent('#ovRooms'), new RegExp(code));
      assert.match(await page.textContent('#ovRooms'), /👑 Admin Aladár/);
      await page.click('#topAllBtn');
      assert.equal(await page.getAttribute('#topAllBtn', 'aria-pressed'), 'true');
      assert.equal(await page.getAttribute('#topWeekBtn', 'aria-pressed'), 'false');
      assert.match(await page.textContent('#ovBugs'), /BUG-1/);
      assert.match(await page.textContent('#ovServer'), /Memória/);
    });
    await check('C) a játékosnév és a hibaszöveg szövegként jelenik meg (nincs HTML-befecskendezés)', async () => {
      await page.click('#tabbtn-live'); await page.waitForSelector('#tab-live', { state: 'visible' });
      assert.equal(await page.textContent('#pageTitle'), 'Élő szobák');
      assert.equal(await page.$$eval('#liveRooms .room', (e) => e.length), 2);
      assert.ok((await page.textContent('#liveRooms')).includes(EVIL_NAME), 'a nyers név szövegként látszik');
      await page.click('#tabbtn-bugs'); await page.waitForSelector('#tab-bugs', { state: 'visible' });
      assert.match(await page.textContent('#bugList'), /A gomb eltűnt/);
      assert.ok((await page.textContent('#bugList')).includes(EVIL), 'a hibaszöveg nyersen, szövegként');
      const inj = await page.evaluate(() => ({ imgs: document.querySelectorAll('#panel img').length, pwned: !!window.__pwned, b: !!document.getElementById('pwn') }));
      assert.deepEqual(inj, { imgs: 0, pwned: false, b: false });
    });
    await check('C) hibajelentés-szűrő: Mind / Új; a választott chip lenyomva', async () => {
      const chips = await page.$$eval('#bugChips .chip', (e) => e.map((c) => c.textContent));
      assert.deepEqual(chips, ['Mind (1)', 'Új (1)']);
      await page.click('#bugChips .chip:nth-child(2)');
      assert.equal(await page.getAttribute('#bugChips .chip:nth-child(2)', 'aria-pressed'), 'true');
      assert.equal(await page.$$eval('#bugList .bug', (e) => e.length), 1);
    });
    await check('C) élő frissítés: egy új szoba a következő frissítéssel megjelenik (kézi Frissítés gomb)', async () => {
      const extra = await connect();
      await emit(extra, 'create_room', { name: 'Késő Kálmán', playerId: 'adK' });
      await page.click('#reload');
      await page.waitForFunction(() => document.querySelectorAll('#liveRooms .room').length === 3);
      assert.match(await page.textContent('#cntLive'), /^5$/);
    });
    await check('C) oldalsáv: a nyilakkal (↑ ↓) is lépkedhető, az utolsó fül megmarad újratöltés után', async () => {
      await page.click('#tabbtn-overview');
      await page.focus('#tabbtn-overview'); await page.keyboard.press('ArrowDown');
      assert.equal(await page.getAttribute('#tabbtn-live', 'aria-selected'), 'true');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#tab-live', { state: 'visible' });
    });
    await check('C) nincs konzol-hiba (CSP, szkript)', async () => { assert.deepEqual(errors, []); });
    await context.close();

    await check('C) mobilon (390×844): nincs vízszintes görgetés, a KPI-k és a grafikonok elférnek', async () => {
      const m = await open({ width: 390, height: 844 });
      const info = await m.page.evaluate(() => {
        const out = (el) => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > window.innerWidth + 1; };
        return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
          bad: [...document.querySelectorAll('#tab-overview .kpi, #tab-overview .card, .ch-plot')].filter(out).map((e) => e.className) };
      });
      assert.ok(info.scrollW <= info.innerW + 1, JSON.stringify(info));
      assert.deepEqual(info.bad, []);
      assert.deepEqual(m.errors, []);
      await m.context.close();
    });
  } finally {
    for (const s of sockets) { try { s.close(); } catch (_) { /* */ } }
    if (browser) await browser.close().catch(() => {});
    server.kill();
    await pause(150);
  }
}

main().catch((e) => { failed++; console.error(e && e.stack || e); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nAdmin műszerfal: ' + passed + ' sikeres, ' + failed + ' hibás ellenőrzés.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
