'use strict';
// ============================================================
// KAMU BÍRÓSÁG – hanggeneráló szkript (scripts/generate-audio.js), hamis ElevenLabs-szerverrel (valódi kredit nem fogy)
//  - a hangnevek lefedik a játék összes hangját (public/media.js CATEGORIES) + a csevegő-hangjelzéseket
//  - kulcs nélkül nem hív API-t, száraz futtatásnál sem; a kulcs csak a fejlécben megy ki, hibaüzenetben nem szerepel
//  - kérés: végpont, fejléc, hossz (0,5–30 mp), modell; fájlok: meglévő kihagyva, --force, --variants + --use, ismeretlen hangnév
//  - a meglévő /api/media a legenerált mp3-akat felismeri (a játék ezeket játssza majd)
// Futtatás: node test/audio-gen.js
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SOUNDS } = require('../scripts/generate-audio');

const root = path.resolve(__dirname, '..');
const SCRIPT = path.join(root, 'scripts', 'generate-audio.js');
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}
const fake = Buffer.alloc(900, 7);

(async () => {
  await test('a hangnevek lefedik a játék összes hangját (media.js) és a csevegő-hangjelzéseket; a hossz és a prompt érvényes', () => {
    const src = fs.readFileSync(path.join(root, 'public', 'media.js'), 'utf8');
    const block = /const CATEGORIES = \{([\s\S]*?)\n  \};/.exec(src)[1];
    const names = [...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).filter((n) => !['ui', 'card', 'paper', 'challenge', 'reaction', 'stinger', 'gavel', 'verdict', 'score', 'victory'].includes(n) || block.includes("'" + n + "',") || block.includes("'" + n + "']"));
    const required = ['ui-click', 'ready', 'join', 'card-hover', 'card-select', 'card-open', 'card-new', 'card-play', 'paper', 'evidence', 'challenge', 'challenge-success', 'challenge-fail', 'reaction', 'objection', 'vote',
      'stinger', 'reveal', 'intro', 'intro-open', 'countdown', 'ding', 'gavel', 'verdict-guilty', 'verdict-acquitted', 'points', 'score', 'victory'];
    for (const n of required) { assert.ok(block.includes("'" + n + "'"), n + ' nincs a media.js-ben'); assert.ok(SOUNDS[n], n + ' nincs a szkriptben'); }
    assert.ok(SOUNDS.chat && SOUNDS.dm, 'csevegő-hangjelzések');
    assert.equal(Object.keys(SOUNDS).length, required.length + 2);
    void names;
    for (const [n, [prompt, dur, infl]] of Object.entries(SOUNDS)) {
      assert.match(n, /^[a-z0-9-]+$/, n); assert.ok(prompt.length > 10 && prompt.length < 250, n + ' prompt');
      assert.ok(dur >= 0.5 && dur <= 30, n + ' hossz'); assert.ok(infl >= 0 && infl <= 1, n + ' befolyás');
    }
  });

  const requests = [];
  let n429 = 0;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const j = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, key: req.headers['xi-api-key'], j });
      if (req.headers['xi-api-key'] === 'rossz-kulcs') { res.writeHead(401, { 'Content-Type': 'application/json', Connection: 'close' }); return res.end(JSON.stringify({ detail: 'invalid api key rossz-kulcs' })); }
      if (/two-coin/.test(j.text) && n429++ < 1) { res.writeHead(429, { Connection: 'close' }); return res.end('slow down'); }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', Connection: 'close' }); res.end(fake);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const run = (args, env = {}) => new Promise((resolve) => {
    const { spawn } = require('child_process');
    const c = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ELEVENLABS_API_BASE: base, ...env } });
    let out = '', err = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, out, err }));
  });
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-aud-'));
  try {
    await test('száraz futtatás és hiányzó kulcs: nincs API-hívás, nincs fájl', async () => {
      const d = dir(); const before = requests.length;
      const dry = await run(['--dry-run'], { KB_AUDIO_DIR: d });
      assert.equal(dry.code, 0); assert.match(dry.out, /Terv: 30 hang/); assert.match(dry.out, /gavel/);
      const nokey = await run([], { KB_AUDIO_DIR: d, ELEVENLABS_API_KEY: '' });
      assert.equal(nokey.code, 1); assert.match(nokey.err, /ELEVENLABS_API_KEY/);
      assert.equal(requests.length, before); assert.deepEqual(fs.readdirSync(d), []);
    });

    await test('generálás: helyes végpont, fejléc, hossz és modell; a fájlok megvannak; a meglévő kihagyva, --force újraírja; a 429-et újrapróbálja', async () => {
      const d = dir(); requests.length = 0;
      const r = await run(['--only', 'gavel,score,ui-click'], { KB_AUDIO_DIR: d, ELEVENLABS_API_KEY: 'teszt-kulcs' });
      assert.equal(r.code, 0, r.err + r.out); assert.match(r.out, /3 sikeres/);
      assert.deepEqual(fs.readdirSync(d).sort(), ['gavel.mp3', 'score.mp3', 'ui-click.mp3']);
      const g = requests.find((q) => /gavel/i.test(q.j.text));
      assert.equal(g.url, '/v1/sound-generation?output_format=mp3_44100_128'); assert.equal(g.key, 'teszt-kulcs');
      assert.equal(g.j.model_id, 'eleven_text_to_sound_v2'); assert.equal(g.j.duration_seconds, 1.0); assert.ok(g.j.prompt_influence > 0);
      assert.ok(requests.filter((q) => /two-coin/.test(q.j.text)).length === 2, 'a 429 után újrapróbált');
      // második futás: minden megvan, nincs új kérés
      requests.length = 0;
      const again = await run(['--only', 'gavel,score'], { KB_AUDIO_DIR: d, ELEVENLABS_API_KEY: 'teszt-kulcs' });
      assert.match(again.out, /0 hang/); assert.equal(requests.length, 0);
      const forced = await run(['--only', 'gavel', '--force'], { KB_AUDIO_DIR: d, ELEVENLABS_API_KEY: 'teszt-kulcs' });
      assert.equal(forced.code, 0); assert.equal(requests.length, 1);
    });

    await test('változatok: a _candidates mappába, az 1. az éles; --use a kiválasztottat éles hanggá teszi', async () => {
      const d = dir();
      const r = await run(['--only', 'victory', '--variants', '3'], { KB_AUDIO_DIR: d, ELEVENLABS_API_KEY: 'teszt-kulcs' });
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(fs.readdirSync(path.join(d, '_candidates')).sort(), ['victory-1.mp3', 'victory-2.mp3', 'victory-3.mp3']);
      assert.ok(fs.existsSync(path.join(d, 'victory.mp3')));
      fs.writeFileSync(path.join(d, '_candidates', 'victory-2.mp3'), Buffer.from('MASODIK'));
      const use = await run(['--use', 'victory=2'], { KB_AUDIO_DIR: d });
      assert.equal(use.code, 0); assert.equal(fs.readFileSync(path.join(d, 'victory.mp3')).toString(), 'MASODIK');
      assert.equal((await run(['--use', 'victory=4'], { KB_AUDIO_DIR: d })).code, 1);
      assert.equal((await run(['--use', 'nincs=1'], { KB_AUDIO_DIR: d })).code, 1);
    });

    await test('hibakezelés: rossz kulcs érthető hiba, a kulcs nem szerepel a kimenetben; ismeretlen hangnév elutasítva', async () => {
      const d = dir();
      const r = await run(['--only', 'gavel'], { KB_AUDIO_DIR: d, ELEVENLABS_API_KEY: 'rossz-kulcs' });
      assert.equal(r.code, 1); assert.match(r.err, /HTTP 401/);
      assert.ok(!(r.out + r.err).includes('rossz-kulcs'), 'a kulcs nem íródik ki');
      assert.deepEqual(fs.readdirSync(d), []);
      const bad = await run(['--only', 'nincs-ilyen'], { KB_AUDIO_DIR: d, ELEVENLABS_API_KEY: 'x' });
      assert.equal(bad.code, 1); assert.match(bad.err, /Ismeretlen hangnév/);
    });

    await test('a /api/media felismeri a legenerált mp3-akat (a játék ezeket játssza), a _candidates mappát nem', async () => {
      const d = dir();
      await run(['--only', 'gavel,victory', '--variants', '2'], { KB_AUDIO_DIR: d, ELEVENLABS_API_KEY: 'teszt-kulcs' });
      const PORT = 3226, BASE = 'http://127.0.0.1:' + PORT;
      const f = (x) => path.join(os.tmpdir(), 'kamu-aud-srv-' + x);
      const { spawn } = require('child_process');
      const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore',
        env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', AUTH_BASE_URL: BASE, KB_AUDIO_DIR: d, AUTH_STORE_PATH: f('a.json'), KB_STATS_FILE: f('s.json'), KB_AVATARS_FILE: f('v.json'),
          KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') } });
      try {
        let m = null;
        for (let i = 0; i < 80 && !m; i++) { try { m = await (await fetch(BASE + '/api/media', { headers: { Connection: 'close' } })).json(); } catch (_) { await new Promise((r) => setTimeout(r, 100)); } }
        assert.deepEqual(Object.keys(m.audio).sort(), ['gavel.mp3', 'victory.mp3']);
      } finally { child.kill(); }
    });
  } finally { server.close(); }
  console.log('\nHanggenerálás: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exit(failed ? 1 : 0);
})();
