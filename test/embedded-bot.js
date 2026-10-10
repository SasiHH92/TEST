'use strict';
// ============================================================
// KAMU BÍRÓSÁG – beágyazott Discord bot: a szerver a bottal együtt indul, de a bot hibája (pl. rossz token) a játékot
// nem állítja le; token nélkül / kikapcsolva a bot el sem indul. Futtatás: node test/embedded-bot.js
// (nem ér el valódi Discord-szervert érvényes tokennel: a hamis token elutasítása a cél)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(port, env, ms) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-embedded-'));
  const f = (n) => path.join(tmp, n);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AUTH_BASE_URL: 'http://127.0.0.1:' + port,
      AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('st.json'), KB_COURTS_FILE: f('c.json'),
      KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'),
      DISCORD_BOT_TOKEN: '', BOT_SERVICE_TOKEN: '', DISCORD_BOT_EMBEDDED: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  let exited = null;
  child.once('exit', (code) => { exited = code; });
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { try { ok = (await fetch('http://127.0.0.1:' + port + '/health')).ok; } catch (_) { await pause(100); } }
  await pause(ms);
  let healthy = false;
  try { healthy = (await fetch('http://127.0.0.1:' + port + '/health')).ok; } catch (_) { /* */ }
  child.kill('SIGKILL');
  await pause(200);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { out, err, exited, healthy, started: ok };
}

(async () => {
  await test('Rossz bot-tokennel a szerver (a játék) tovább fut, a bot hibát naplóz, a token nem kerül a naplóba', async () => {
    const r = await run(3193, { DISCORD_BOT_TOKEN: 'hamis.token.nemlehetervenyes', BOT_SERVICE_TOKEN: 'x'.repeat(40) }, 6000);
    assert.ok(r.started && r.healthy && r.exited === null, 'a szerver él: ' + r.err.slice(0, 300));
    assert.match(r.out, /beágyazva indul/);
    assert.ok(!(r.out + r.err).includes('hamis.token.nemlehetervenyes'), 'a token nem kerülhet a naplóba');
  });
  await test('Kikapcsolva (DISCORD_BOT_EMBEDDED=0) vagy token nélkül a bot nem indul', async () => {
    const off = await run(3194, { DISCORD_BOT_TOKEN: 'hamis.token.x', BOT_SERVICE_TOKEN: 'y'.repeat(40), DISCORD_BOT_EMBEDDED: '0' }, 500);
    assert.ok(off.healthy); assert.ok(!/beágyazva/.test(off.out));
    const none = await run(3195, {}, 500);
    assert.ok(none.healthy); assert.ok(!/beágyazva/.test(none.out));
  });
  console.log(`\nBeágyazott bot: ${passed} sikeres, ${failed} hibás teszt.`);
  process.exit(failed ? 1 : 0);
})();
