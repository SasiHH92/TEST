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
      KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') },
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
          await page.click('#bugSend');
          assert.match(await page.textContent('#bugMsg'), /pár szót/);
          await page.fill('#bugText', 'Teszt: a gomb nem csinál semmit');
          await page.selectOption('#bugKind', 'sound');
          await page.click('#bugSend');
          await page.waitForFunction(() => /BUG-7/.test(document.querySelector('#bugMsg').textContent));
          assert.equal(seen.length, 1); assert.equal(seen[0].kind, 'sound'); assert.ok(seen[0].where);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
          assert.equal(overflow, false);
        } finally { await browser.close(); }
      });
    }
  } finally { if (child) child.kill(); }
  console.log(`\n${passed} sikeres, ${failed} sikertelen`);
  process.exit(failed ? 1 : 0);
})();
