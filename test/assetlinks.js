'use strict';
// ============================================================
// KAMU BÍRÓSÁG – Android-alkalmazás azonosítása (/.well-known/assetlinks.json)
//  Az Android ebből ellenőrzi, hogy a com.kamubirosag.app csomag az oldalhoz tartozik (teljes képernyős TWA).
//  Ellenőrzi: 200 + JSON, átirányítás nélkül; a csomagnév; az ujjlenyomatok szabályos SHA-256 alakúak; más rejtett mappa nem érhető el.
//  Futtatás: npm run test:assetlinks
// ============================================================
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const PORT = 3254;
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + (e && e.stack || e)); }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (urlPath) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET', headers: { Connection: 'close' } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject); req.end();
});

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-assetlinks-')), f = (x) => path.join(tmp, x);
  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', DATABASE_URL: '',
    AUTH_STORE_PATH: f('a.json'), KB_STATS_FILE: f('s.json'), KB_AVATARS_FILE: f('v.json'), KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'),
    KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await get('/health')).status === 200) break; } catch (_) { /* még indul */ } await pause(250); }

    await test('assetlinks.json: 200, JSON, átirányítás nélkül', async () => {
      const r = await get('/.well-known/assetlinks.json');
      assert.equal(r.status, 200); assert.match(r.headers['content-type'], /application\/json/); assert.ok(!r.headers.location, 'nincs átirányítás');
      assert.ok(Array.isArray(JSON.parse(r.body)));
    });
    await test('a com.kamubirosag.app csomag szerepel, szabályos SHA-256 ujjlenyomattal', async () => {
      const list = JSON.parse((await get('/.well-known/assetlinks.json')).body);
      const entry = list.find((e) => e.target && e.target.package_name === 'com.kamubirosag.app');
      assert.ok(entry, 'csomag megvan'); assert.equal(entry.target.namespace, 'android_app');
      assert.ok(entry.relation.includes('delegate_permission/common.handle_all_urls'));
      assert.ok(entry.target.sha256_cert_fingerprints.length >= 1);
      for (const fp of entry.target.sha256_cert_fingerprints) assert.match(fp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, 'ujjlenyomat alakja: ' + fp);
    });
    await test('más rejtett fájl nem érhető el (/.well-known/ egyéb, /.env)', async () => {
      assert.equal((await get('/.well-known/secret.txt')).status, 404);
      assert.equal((await get('/.env')).status, 404);
      assert.equal((await get('/well-known/assetlinks.json')).status, 404, 'a forrásmappa nem publikus');
    });
  } finally {
    child.kill(); await pause(200);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* nem baj */ }
  }
  console.log('\n' + passed + ' sikeres, ' + failed + ' hibás');
  process.exit(failed ? 1 : 0);
})();
