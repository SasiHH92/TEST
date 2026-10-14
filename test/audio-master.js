'use strict';
// ============================================================
// KAMU BÍRÓSÁG – hangok mesterelése (scripts/master-audio.js) + a csevegő-hangjelzés fájl-első bekötése
//  A) a hangszint-táblázat lefedi mind a 30 hangot; csúcs-célok a -1 dBFS alatt; a halk hangok kisebb szintet kapnak, mint az esemény-hangok
//  B) trim: a csend le van vágva, a hang megmarad; lecsengés a végén; az erősítés a csúcs- és az RMS-korláthoz is igazodik, -1 dBFS fölé nem megy
//  C) a szkript valódi MP3-fájlokon: eredetik az _original mappába, a hangos / halk fájl a célszintre kerül, a hangtalan érintetlen marad, a második futás ugyanazt adja
//  D) a böngészőben a kbSound.chat() / kbSound.ping() előbb a chat.* / dm.* fájlt játssza; fájl nélkül a szintetizált tartalék szól; némítva egyik sem
// Futtatás: node test/audio-master.js       Böngésző (C, D): CHROMIUM_PATH / Edge / Chrome; ha nincs: SKIP
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const M = require('../scripts/master-audio');
const { SOUNDS } = require('../scripts/generate-audio');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }
const root = path.resolve(__dirname, '..');
let passed = 0, failed = 0, skipped = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + (e && e.stack || e)); }
}
const skip = (name, why) => { skipped++; console.log('SKIP: ' + name + ' – ' + why); };
const SR = 44100;

// Tesztjel: hirtelen indul, exponenciálisan cseng le; előtte és utána csend.
function burst({ amp, freq = 440, lead = 0.4, body = 0.3, tail = 0.6 }) {
  const n = Math.round((lead + body + tail) * SR), s = new Float32Array(n), a = Math.round(lead * SR), b = Math.round((lead + body) * SR);
  for (let i = a; i < b; i++) { const t = (i - a) / SR; s[i] = amp * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 6); }
  return s;
}
async function launch() {
  if (!chromium) return null;
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const options of attempts) { try { return await chromium.launch({ headless: true, ...options }); } catch (_) { /* a következőt próbáljuk */ } }
  return null;
}
const run = (args, env) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(root, 'scripts', 'master-audio.js'), ...args], { env: { ...process.env, ...env } });
  let out = '', err = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
  c.on('close', (code) => resolve({ code, out, err }));
});

(async () => {
  await test('A) a hangszint-táblázat lefedi mind a 30 hangot, a célok érvényesek, és a hangosság-sorrend ésszerű', () => {
    assert.deepEqual(Object.keys(M.LEVELS).sort(), Object.keys(SOUNDS).sort());
    for (const [n, [peak, rms]] of Object.entries(M.LEVELS)) {
      assert.ok(peak <= -3 && peak >= -24, n + ' csúcs-cél'); assert.ok(rms < peak && rms >= -40, n + ' RMS-korlát');
    }
    for (const quiet of ['card-hover', 'ui-click', 'paper', 'card-new']) for (const loud of ['gavel', 'victory', 'reveal', 'verdict-guilty']) assert.ok(M.LEVELS[quiet][0] < M.LEVELS[loud][0], quiet + ' halkabb, mint ' + loud);
  });

  await test('B) trim + lecsengés + erősítés: a csend le van vágva, a hang megvan, a csúcs -1 dBFS alatt marad', () => {
    const src = burst({ amp: 0.5 });
    const t = M.trim(src, SR);
    assert.ok(t.length < src.length * 0.45, 'a csend le van vágva (' + (t.length / SR).toFixed(2) + ' s)');
    assert.ok(t.length > 0.2 * SR, 'a hang megmaradt');
    assert.ok(Math.abs(M.peakOf(t) - M.peakOf(src)) < 1e-6, 'a csúcs nem sérült');
    const f = M.fades(t, SR);
    assert.equal(f[f.length - 1], 0); assert.equal(f[0], 0); assert.ok(Math.abs(f[Math.round(f.length / 2)] - t[Math.round(t.length / 2)]) < 1e-9, 'a közepe érintetlen');
    // erősítés: csúcs-cél / RMS-korlát / -1 dBFS plafon
    const quiet = burst({ amp: 0.02 });
    const gQuiet = M.normalizeGain(M.trim(quiet, SR), -12, -24);
    assert.ok(gQuiet > 1, 'a halk jel erősödik');
    const after = M.trim(quiet, SR).map((v) => v * gQuiet);
    assert.ok(M.db(M.peakOf(after)) <= -12 + 0.01 && M.db(M.rmsOf(after)) <= -24 + 0.01, 'a cél- és az RMS-korlát betartva');
    const loud = M.trim(burst({ amp: 0.99 }), SR);
    const gLoud = M.normalizeGain(loud, -0.5, -3);
    assert.ok(M.db(M.peakOf(loud.map((v) => v * gLoud))) <= -1 + 0.01, 'a plafon -1 dBFS');
    assert.equal(M.normalizeGain(new Float32Array(100), -12, -24), 1, 'a néma jel nem robban fel');
    const r = M.processOne('gavel', burst({ amp: 0.9 }), SR);
    assert.ok(r.after.peakDb <= -3 && r.after.rmsDb <= -17.9 && r.after.sec < 0.6, JSON.stringify(r.after));
    // toInt16: nincs túlcsordulás
    const i16 = M.toInt16(Float32Array.from([2, -2, 0.5]));
    assert.deepEqual([...i16], [32767, -32768, 16384]);
  });

  const browser = await launch();
  if (!browser) {
    skip('C) a szkript valódi MP3-fájlokon', 'nincs böngésző');
    skip('D) a csevegő-hangjelzés fájl-első bekötése', 'nincs böngésző');
  } else {
    try {
      await test('C) a szkript valódi MP3-fájlokon: eredetik mentve, a célszint betartva, a hangtalan érintetlen, a második futás azonos', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-mst-'));
        const mk = (name, amp) => fs.writeFileSync(path.join(dir, name + '.mp3'), M.encodeMp3(M.toInt16(burst({ amp })), SR));
        mk('gavel', 0.9); mk('ready', 0.05); mk('challenge', 0.001);
        const silentBefore = fs.readFileSync(path.join(dir, 'challenge.mp3'));
        const original = { gavel: fs.readFileSync(path.join(dir, 'gavel.mp3')), hover: fs.readFileSync(path.join(dir, 'ready.mp3')) };
        const r = await run([], { KB_AUDIO_DIR: dir });
        assert.equal(r.code, 0, r.err + r.out); assert.match(r.out, /HANGTALAN/); assert.match(r.out, /1 hangtalan/);
        assert.deepEqual(fs.readdirSync(path.join(dir, '_original')).sort(), ['.mastered.json', 'gavel.mp3', 'ready.mp3'], 'csak a feldolgozott fájlok (és a nyilvántartás) kerülnek az _original-ba');
        assert.ok(fs.readFileSync(path.join(dir, '_original', 'gavel.mp3')).equals(original.gavel), 'az eredeti változatlanul mentve');
        assert.ok(fs.readFileSync(path.join(dir, 'challenge.mp3')).equals(silentBefore), 'a hangtalan fájl érintetlen');
        assert.ok(!fs.existsSync(path.join(dir, '_original', 'challenge.mp3')));
        const dec = await M.decodeAll([fs.readFileSync(path.join(dir, 'gavel.mp3')), fs.readFileSync(path.join(dir, 'ready.mp3')), original.hover, original.gavel]);
        const [g, h, h0, g0] = dec.map((d) => ({ peak: M.db(M.peakOf(d.samples)), rms: M.db(M.rmsOf(d.samples)), sec: d.samples.length / d.rate }));
        assert.ok(g.sec < g0.sec - 0.5, 'a gavel csendje levágva (' + g0.sec.toFixed(2) + ' → ' + g.sec.toFixed(2) + ' s)');
        assert.ok(g.peak <= -1, 'a gavel csúcsa a plafon alatt: ' + g.peak.toFixed(1)); assert.ok(g.peak < g0.peak, 'a túl hangos gavel halkabb lett');
        assert.ok(h.peak > h0.peak + 3, 'a halk hang hangosabb lett: ' + h0.peak.toFixed(1) + ' → ' + h.peak.toFixed(1));
        assert.ok(g.peak > h.peak + 3, 'a gavel hangosabb, mint a ready (a hangosság-sorrend megvan)');
        // második futás: ugyanabból az eredetiből ugyanaz a kimenet (nem halmozódik a vágás / erősítés)
        const firstG = fs.readFileSync(path.join(dir, 'gavel.mp3')), firstH = fs.readFileSync(path.join(dir, 'ready.mp3'));
        const r2 = await run([], { KB_AUDIO_DIR: dir });
        assert.equal(r2.code, 0, r2.err);
        assert.ok(fs.readFileSync(path.join(dir, 'gavel.mp3')).equals(firstG) && fs.readFileSync(path.join(dir, 'ready.mp3')).equals(firstH), 'a második futás azonos kimenetet ad');
        assert.ok(fs.readFileSync(path.join(dir, '_original', 'gavel.mp3')).equals(original.gavel), 'az eredeti nem íródott felül');
        // újragenerált / kézzel cserélt fájl: az új fájl lesz az eredeti (nem a régi mentésből dolgozik), és a korábban hangtalan hang is feldolgozódik
        const replacement = M.encodeMp3(M.toInt16(burst({ amp: 0.2, freq: 880 })), SR), regenerated = M.encodeMp3(M.toInt16(burst({ amp: 0.5, freq: 300 })), SR);
        fs.writeFileSync(path.join(dir, 'ready.mp3'), replacement); fs.writeFileSync(path.join(dir, 'challenge.mp3'), regenerated);
        const r3 = await run([], { KB_AUDIO_DIR: dir });
        assert.equal(r3.code, 0, r3.err + r3.out); assert.ok(!/HANGTALAN/.test(r3.out), 'már nincs hangtalan fájl');
        assert.ok(fs.readFileSync(path.join(dir, '_original', 'ready.mp3')).equals(replacement), 'a cserélt fájl lett az új eredeti');
        assert.ok(fs.readFileSync(path.join(dir, '_original', 'challenge.mp3')).equals(regenerated), 'az újragenerált hang eredetije mentve');
        const readyNew = fs.readFileSync(path.join(dir, 'ready.mp3')), challengeNew = fs.readFileSync(path.join(dir, 'challenge.mp3'));
        assert.ok(!readyNew.equals(firstH) && !challengeNew.equals(regenerated), 'az új hangból új kimenet készült');
        assert.ok(fs.readFileSync(path.join(dir, '_original', 'gavel.mp3')).equals(original.gavel) && fs.readFileSync(path.join(dir, 'gavel.mp3')).equals(firstG), 'a többi hang nem változott');
        // a nyilvántartás nélküli (régebbi) állapot is stabil: ilyenkor az _original-ból dolgozik
        fs.rmSync(path.join(dir, '_original', '.mastered.json'));
        assert.equal((await run([], { KB_AUDIO_DIR: dir })).code, 0);
        assert.ok(fs.readFileSync(path.join(dir, 'ready.mp3')).equals(readyNew) && fs.readFileSync(path.join(dir, 'challenge.mp3')).equals(challengeNew), 'nyilvántartás nélkül is azonos kimenet');
        // száraz futtatás nem ír (sem a hangot, sem az eredeti-mentést, sem a nyilvántartást)
        const dryNew = M.encodeMp3(M.toInt16(burst({ amp: 0.6, freq: 500 })), SR);
        fs.writeFileSync(path.join(dir, 'gavel.mp3'), dryNew);
        const recBefore = fs.readFileSync(path.join(dir, '_original', '.mastered.json'), 'utf8');
        const dry = await run(['--dry-run'], { KB_AUDIO_DIR: dir });
        assert.equal(dry.code, 0, dry.err); assert.match(dry.out, /Száraz futtatás/);
        assert.ok(fs.readFileSync(path.join(dir, 'gavel.mp3')).equals(dryNew), 'a hang érintetlen');
        assert.ok(fs.readFileSync(path.join(dir, '_original', 'gavel.mp3')).equals(original.gavel), 'az eredeti-mentés érintetlen');
        assert.equal(fs.readFileSync(path.join(dir, '_original', '.mastered.json'), 'utf8'), recBefore, 'a nyilvántartás érintetlen');
        // sérült fájl: kihagyva és jelezve, a többi hang feldolgozódik, a futás nem szakad meg
        fs.writeFileSync(path.join(dir, 'ready.mp3'), Buffer.from('ez nem hangfajl'));
        const bad = await run([], { KB_AUDIO_DIR: dir });
        assert.equal(bad.code, 0, bad.err + bad.out); assert.match(bad.out, /ready\s+\| NEM DEKÓDOLHATÓ/);
        assert.equal(fs.readFileSync(path.join(dir, 'ready.mp3')).toString(), 'ez nem hangfajl', 'a sérült fájl érintetlen');
        assert.ok(!fs.readFileSync(path.join(dir, 'gavel.mp3')).equals(dryNew), 'a jó fájl közben feldolgozódott');
      });

      await test('D) kbSound.chat() / ping(): fájl esetén a chat.* / dm.* szól, fájl nélkül a szintetizált tartalék, némítva egyik sem', async () => {
        const withDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-snd-a-')), emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-snd-b-'));
        const mp3 = M.encodeMp3(M.toInt16(burst({ amp: 0.3, lead: 0.01, body: 0.3, tail: 0.05 })), SR);
        fs.writeFileSync(path.join(withDir, 'chat.mp3'), mp3); fs.writeFileSync(path.join(withDir, 'dm.mp3'), mp3);
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-snd-s-'));
        const servers = [];
        const start = async (port, audioDir) => {
          const base = 'http://127.0.0.1:' + port, f = (x) => path.join(tmp, port + x);
          const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', DATABASE_URL: '', AUTH_BASE_URL: base, KB_AUDIO_DIR: audioDir,
            AUTH_STORE_PATH: f('a.json'), KB_STATS_FILE: f('s.json'), KB_AVATARS_FILE: f('v.json'), KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'), KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') } });
          servers.push(child);
          for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health', { headers: { Connection: 'close' } })).ok) return base; } catch (_) { await new Promise((r) => setTimeout(r, 100)); } }
          throw new Error('a szerver nem indult el');
        };
        // a lapon: a lejátszás- és a tartalék-hívások rögzítése, majd a két hangjelzés megszólaltatása
        const probe = async (base, preset) => {
          const page = await browser.newPage();
          const errors = []; page.on('pageerror', (e) => errors.push(String(e.message || e)));
          try {
            await page.goto(base, { waitUntil: 'load' });
            await page.evaluate(() => window.kbMedia.ready);
            return await page.evaluate((mode) => {
              const calls = [], fallback = [];
              const orig = window.kbMedia.playSound; window.kbMedia.playSound = (n, v) => { calls.push([n, Math.round(v * 100)]); return true; };
              const sc = SFX.chat, sd = SFX.dm; SFX.chat = () => { fallback.push('chat'); }; SFX.dm = () => { fallback.push('dm'); };
              if (mode === 'muted') volume = 0;
              if (mode === 'off') window.kbSound.setEnabled(false);
              window.kbSound.chat(); window.kbSound.ping();
              window.kbMedia.playSound = orig; SFX.chat = sc; SFX.dm = sd; volume = 70; window.kbSound.setEnabled(true);
              return { calls, fallback, files: window.kbMedia.state().audio.sort() };
            }, preset);
          } finally { await page.close(); assert.deepEqual(errors, [], 'nincs JS-hiba'); }
        };
        try {
          const a = await start(3230, withDir), b = await start(3231, emptyDir);
          const withFiles = await probe(a, 'normal');
          assert.deepEqual(withFiles.files, ['chat.mp3', 'dm.mp3']);
          assert.deepEqual(withFiles.calls, [['chat', 70], ['dm', 70]], 'a fájlok szólnak a mester-hangerővel'); assert.deepEqual(withFiles.fallback, [], 'nem szól mellette a szintetizált hang');
          const noFiles = await probe(b, 'normal');
          assert.deepEqual(noFiles.calls, []); assert.deepEqual(noFiles.fallback, ['chat', 'dm'], 'fájl nélkül a szintetizált tartalék szól');
          const muted = await probe(a, 'muted');
          assert.deepEqual(muted.calls, [], 'némítva (hangerő 0) a fájl sem szól');
          const off = await probe(a, 'off');
          assert.deepEqual(off.calls, []); assert.deepEqual(off.fallback, [], 'a csevegő-hangjelzés kikapcsolva: semmi nem szól');
        } finally { for (const c of servers) c.kill(); }
      });
    } finally { await browser.close(); }
  }
  console.log('\nHangok mesterelése: ' + passed + ' sikeres, ' + failed + ' hibás, ' + skipped + ' kihagyott teszt.');
  process.exitCode = failed ? 1 : 0;
})();
