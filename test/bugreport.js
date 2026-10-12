'use strict';
// Hibajelentés: web űrlap -> /api/bugreport -> /api/bot/bugreports (bot) -> késznek jelölés. Plusz UI: gomb, űrlap, küldés.
// Futtatás: node test/bugreport.js
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* böngésző nélkül az UI-rész kimarad */ }

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-bug-'));
const f = (n) => path.join(tmp, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'teszt-szolgaltatas-token';
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}
let child = null;
async function start(port) {
  const base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AUTH_BASE_URL: base, DISCORD_BOT_TOKEN: '', BOT_SERVICE_TOKEN: TOKEN,
      AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('st.json'), KB_COURTS_FILE: f('c.json'),
      KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json'), KB_BUGREPORT_LIMIT: '14', KB_BUGIMAGES_DIR: f('bugimg') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return base; } catch (_) { await pause(100); } }
  throw new Error('a szerver nem indult el');
}
const post = (base, body) => fetch(base + '/api/bugreport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const bot = (base, p, opt = {}) => fetch(base + '/api/bot' + p, { ...opt, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } });

(async () => {
  const BASE = await start(3207);
  try {
    await test('jelentés beküldése: elmentődik, a bot lekérdezheti, késznek jelölhető', async () => {
      let r = await post(BASE, { kind: 'ui', text: 'Nem jelent meg az ítélet a szavazás után', name: 'Tesztelő Tamás', where: 'game', room: 'ABCD' });
      assert.equal(r.status, 200);
      const { id } = await r.json();
      assert.match(id, /^BUG-\d+$/);
      const list = await (await bot(BASE, '/bugreports')).json();
      const it = list.reports.find((x) => x.id === id);
      assert.ok(it, 'a jelentés várakozik');
      assert.equal(it.name, 'Tesztelő Tamás'); assert.equal(it.room, 'ABCD'); assert.equal(it.kind, 'ui');
      assert.equal((await bot(BASE, '/bugreports/' + id + '/posted', { method: 'POST', body: JSON.stringify({ ref: '123' }) })).status, 200);
      const after = await (await bot(BASE, '/bugreports')).json();
      assert.ok(!after.reports.some((x) => x.id === id), 'kiposztolás után nem várakozik');
      assert.equal((await bot(BASE, '/bugreports/BUG-99999/posted', { method: 'POST', body: '{}' })).status, 404);
    });
    await test('új jelentésnél a bot eseményfolyama azonnal kap jelzést (nem kell az időzítőt kivárni)', async () => {
      const ac = new AbortController();
      const res = await fetch(BASE + '/api/bot/stream', { headers: { Authorization: 'Bearer ' + TOKEN }, signal: ac.signal });
      assert.equal(res.status, 200);
      const reader = res.body.getReader();
      const got = (async () => { let buf = ''; const dec = new TextDecoder(); for (;;) { const { value, done } = await reader.read(); if (done) return ''; buf += dec.decode(value); if (/"type":"bug"/.test(buf)) return buf; } })();
      await pause(150);
      assert.equal((await post(BASE, { text: 'azonnali jelzés teszt' })).status, 200);
      const out = await Promise.race([got, pause(3000).then(() => 'IDŐTÚLLÉPÉS')]);
      ac.abort();
      assert.match(out, /"type":"bug"/);
    });
    await test('teljes út: weboldali jelentés -> szerver -> bot (valódi kliens + SSE) -> Discord-csatorna, másodpercen belül', async () => {
      const { ChannelType } = require('discord.js');
      const { makeGuild } = require('../discord-bot/test/fake-guild');
      const { runSetup, findChannel } = require('../discord-bot/src/setup');
      const { createBackend } = require('../discord-bot/src/backend');
      const { createBugSync } = require('../discord-bot/src/bugs');
      const guild = makeGuild();
      await runSetup(guild);
      const backend = createBackend({ baseUrl: BASE, token: TOKEN, log: { error() {}, log() {} } });
      const sync = createBugSync({ client: { guilds: { cache: new Map([[guild.id, guild]]) } }, backend, everyMs: 600000, log: { error() {}, log() {} } });
      await sync.drain(); // az eddigi (előző tesztekből maradt) jelentések kiürítése
      const stop = backend.subscribe((evt) => { if (evt && evt.type === 'bug') sync.drain(); });
      try {
        await pause(400);
        const ch = findChannel(guild, '🐛・hibajelentés', [ChannelType.GuildText], null);
        const before = ch.messageStore.size;
        assert.equal((await post(BASE, { kind: 'room', text: 'teljes út teszt: a szoba nem nyílik meg', name: 'Út Teszt', where: 'lobby', room: 'WXYZ' })).status, 200);
        for (let i = 0; i < 30 && ch.messageStore.size === before; i++) await pause(100);
        assert.equal(ch.messageStore.size, before + 1, 'a jelentés megjelent a Discord-csatornában');
        assert.match(JSON.stringify([...ch.messageStore.values()].pop().embeds), /teljes út teszt/);
        assert.equal((await (await bot(BASE, '/bugreports')).json()).reports.filter((r) => /teljes út/.test(r.text)).length, 0, 'késznek jelölve');
      } finally { stop(); }
    });
    await test('állapot: alapból új; a bot módosíthatja; ismeretlen állapot / azonosító elutasítva', async () => {
      const id = (await (await post(BASE, { text: 'állapot teszt jelentés' })).json()).id;
      assert.equal((await (await bot(BASE, '/bugreports/' + id)).json()).report.status, 'new');
      const ok = await bot(BASE, '/bugreports/' + id + '/status', { method: 'POST', body: JSON.stringify({ status: 'ice', by: 'Sanyi' }) });
      assert.equal(ok.status, 200);
      const rep = (await ok.json()).report;
      assert.equal(rep.status, 'ice'); assert.equal(rep.statusBy, 'Sanyi');
      assert.equal((await (await bot(BASE, '/bugreports/' + id)).json()).report.status, 'ice', 'tartósan tárolva');
      assert.equal((await bot(BASE, '/bugreports/' + id + '/status', { method: 'POST', body: JSON.stringify({ status: 'valami' }) })).status, 400);
      assert.equal((await bot(BASE, '/bugreports/BUG-99999/status', { method: 'POST', body: JSON.stringify({ status: 'done' }) })).status, 400);
      assert.equal((await fetch(BASE + '/api/bot/bugreports/' + id + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"status":"done"}' })).status, 401);
    });
    await test('kép csatolása: ellenőrzött képfájl, a bot lekérheti, a kiposztolás után törlődik; hamis/túl nagy kép elutasítva', async () => {
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
      const url = (mime, buf) => 'data:' + mime + ';base64,' + buf.toString('base64');
      const r = await post(BASE, { text: 'képes jelentés teszt', image: url('image/png', png) });
      assert.equal(r.status, 200);
      const { id, image } = await r.json();
      assert.equal(image, true);
      const pend = (await (await bot(BASE, '/bugreports')).json()).reports.find((x) => x.id === id);
      assert.equal(pend.image, 'png');
      const got = await bot(BASE, '/bugreports/' + id + '/image');
      assert.equal(got.status, 200);
      assert.ok((got.headers.get('content-type') || '').includes('image/png'), 'tartalomtípus: image/png');
      assert.ok(Buffer.from(await got.arrayBuffer()).equals(png), 'ugyanazok a bájtok');
      assert.equal((await fetch(BASE + '/api/bot/bugreports/' + id + '/image')).status, 401, 'token nélkül nem érhető el');
      assert.equal((await bot(BASE, '/bugreports/' + id + '/posted', { method: 'POST', body: JSON.stringify({ ref: '1', image: true }) })).status, 200);
      assert.equal((await bot(BASE, '/bugreports/' + id + '/image')).status, 404, 'a kiposztolás után a helyi másolat törlődik');
      assert.equal((await (await bot(BASE, '/bugreports/' + id)).json()).report.imageOk, true);
      // hibás esetek: nem kép, hamis típus, túl nagy, nem base64
      assert.equal((await post(BASE, { text: 'rossz kép teszt', image: url('text/html', Buffer.from('<script>alert(1)</script>'.repeat(10))) })).status, 400);
      assert.equal((await post(BASE, { text: 'rossz kép teszt', image: url('image/png', Buffer.from('ez nem kép, csak szöveg'.repeat(10))) })).status, 400, 'a fájl első bájtjai számítanak, nem a megadott típus');
      assert.equal((await post(BASE, { text: 'rossz kép teszt', image: 'data:image/png;base64,%%%' })).status, 400);
      const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1700 * 1024, 1)]);
      assert.equal((await post(BASE, { text: 'nagy kép teszt', image: url('image/jpeg', big) })).status, 400);
    });
    await test('túl rövid leírás és hibás típus kezelése; szobakód csak érvényes alakban', async () => {
      assert.equal((await post(BASE, { text: 'x' })).status, 400);
      const r = await post(BASE, { kind: '<script>', text: 'rendes hosszú leírás', room: '../../x' });
      assert.equal(r.status, 200);
      const it = (await (await bot(BASE, '/bugreports')).json()).reports.pop();
      assert.equal(it.kind, 'bug'); assert.equal(it.room, '');
    });
    await test('a bot végpont token nélkül tiltott; a küldés korlátozott', async () => {
      assert.equal((await fetch(BASE + '/api/bot/bugreports')).status, 401);
      let last = 200;
      for (let i = 0; i < 6; i++) last = (await post(BASE, { text: 'ismételt jelentés ' + i })).status;
      assert.equal(last, 429);
    });
    if (chromium) {
      await test('UI: lebegő gomb, űrlap, küldés, visszajelzés', async () => {
        const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
        const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'msedge' });
        try {
          const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
          const seen = [];
          await page.route('**/api/bugreport', (route) => { seen.push(JSON.parse(route.request().postData())); route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"BUG-7"}' }); });
          await page.goto(BASE + '/');
          await page.waitForSelector('#bugFab');
          await page.click('#bugFab');
          await page.waitForSelector('#bugDialog[open]');
          const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
          await page.setInputFiles('#bugImage', { name: 'kep.png', mimeType: 'image/png', buffer: png1 });
          await page.waitForSelector('#bugImgPrev:not([hidden])');
          await page.click('#bugImgRemove');
          assert.equal(await page.isHidden('#bugImgPrev'), true, 'eltávolítás után nincs előnézet');
          await page.setInputFiles('#bugImage', { name: 'kep.png', mimeType: 'image/png', buffer: png1 });
          await page.waitForSelector('#bugImgPrev:not([hidden])');
          await page.setInputFiles('#bugImage', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('nem kép') });
          await page.waitForFunction(() => /Csak kép/.test(document.querySelector('#bugMsg').textContent));
          await page.setInputFiles('#bugImage', { name: 'kep.png', mimeType: 'image/png', buffer: png1 });
          await page.waitForSelector('#bugImgPrev:not([hidden])');
          await page.click('#bugSend');
          assert.match(await page.textContent('#bugMsg'), /pár szót/);
          await page.fill('#bugText', 'Teszt: a gomb nem csinál semmit');
          await page.selectOption('#bugKind', 'sound');
          await page.click('#bugSend');
          await page.waitForFunction(() => /BUG-7/.test(document.querySelector('#bugMsg').textContent));
          assert.equal(seen.length, 1); assert.equal(seen[0].kind, 'sound'); assert.ok(seen[0].where);
          assert.ok((seen[0].image || '').startsWith('data:image/jpeg;base64,'), 'a kép kicsinyítve, JPEG-ként megy el');
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
          assert.equal(overflow, false);
        } finally { await browser.close(); }
      });
    }
  } finally { if (child) child.kill(); }
  console.log(`\n${passed} sikeres, ${failed} sikertelen`);
  process.exit(failed ? 1 : 0);
})();
