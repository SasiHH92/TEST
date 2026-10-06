'use strict';
// ============================================================
// KAMU BÍRÓSÁG – a legendás tesztelők egyedi kerete
// - a 12 nyilvántartott játékos mindegyikének más a kerete, a stíluslapban mind definiálva van (mozgással),
// - a keretek a boltban nem kaphatók, és fiókkal sem hamisíthatók,
// - a szerver a nyilvántartási névre rárakja a keretet és a LEGENDA feliratot (lobbi, tárgyalás, ponttábla ugyanazt kapja),
// - a kliens a ponttáblán is megjeleníti a keretet és a névhatást.
// Futtatás: node test/legends.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const io = require('socket.io-client');

const root = path.resolve(__dirname, '..');
const PORT = 3188, BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-legends-'));
const sockets = [];
let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}
function emit(s, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Ack timeout: ' + event)), 4000);
    s.emit(event, payload, (res) => { clearTimeout(t); resolve(res); });
  });
}
async function connect() {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  sockets.push(s);
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
}

const players = JSON.parse(fs.readFileSync(path.join(root, 'data', 'players.json'), 'utf8')).players;
const shop = JSON.parse(fs.readFileSync(path.join(root, 'data', 'shop.json'), 'utf8'));
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public', 'client.js'), 'utf8');

async function main() {
  await test('12 legendás tesztelő van, mindegyiknek más a kerete', async () => {
    assert.equal(players.length, 12);
    const frames = players.map((p) => p.keret);
    assert.ok(frames.every((f) => /^frame_[a-z]+$/.test(f)), 'minden keret frame_<betűk> alakú: ' + frames.join(', '));
    assert.equal(new Set(frames).size, 12, 'a keretek mind különbözőek');
  });

  await test('A legenda-keretek nem kaphatók a boltban (nem hamisíthatók fiókkal)', async () => {
    const shopIds = new Set(shop.targyak.map((i) => i.id));
    for (const p of players) assert.ok(!shopIds.has(p.keret), p.nev + ': a keret nem lehet bolti tárgy');
  });

  await test('Minden legenda-keretnek van saját, mozgó stílusa a stíluslapban', async () => {
    const defs = new Set();
    for (const p of players) {
      const cls = '.cos-frame-' + p.keret.replace(/^frame_/, '');
      assert.ok(css.includes(cls + ' {'), p.nev + ': hiányzik a(z) ' + cls + ' szabály');
      assert.ok(css.includes(cls + '::after {'), p.nev + ': hiányzik a(z) ' + cls + '::after (a körbefutó fénycsík)');
      const line = css.split('\n').find((l) => l.startsWith(cls + ' {'));
      assert.match(line, /--frame-c:/); assert.match(line, /--frame-g:/);
      assert.ok(/--frame-anim: cos-[a-z]+/.test(line), p.nev + ': nincs ragyogás-animáció');
      const sig = line.replace(/\s+/g, ' ').replace(cls, '');
      assert.ok(!defs.has(sig), p.nev + ': ugyanaz a stílus, mint egy másiknak');
      defs.add(sig);
    }
    // a hivatkozott animációk léteznek
    for (const name of new Set([...css.matchAll(/--frame-anim: (cos-[a-z-]+)/g)].map((m) => m[1]))) {
      assert.ok(css.includes('@keyframes ' + name + ' '), 'hiányzó @keyframes: ' + name);
    }
  });

  await test('A kliens a ponttáblán is megjeleníti a keretet és a névhatást, a nyilvántartási kártyán LEGENDA áll', async () => {
    assert.match(client, /sb-row' \+ \(p\.id === MY\.playerId[^;]*cosmeticClasses\(cos && \{ frame: cos\.frame, nameFx: cos\.nameFx \}\)/s);
    assert.ok(css.includes(".sb-row[class*='cos-frame-']::after"), 'a ponttábla-sor kerete kapja a körbefutó fénycsíkot');
    for (const fx of ['gold', 'fire', 'ice', 'royal']) assert.ok(css.includes('.sb-row.cos-name-' + fx + ' .sb-name'), 'ponttábla névhatás: ' + fx);
    assert.match(client, /labelText: 'LEGENDA'/);
  });

  // ---------------- szerver ----------------
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE,
      AUTH_STORE_PATH: path.join(tmp, 'accounts.json'), KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_STATS_FILE: path.join(tmp, 'stats.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; child.stderr.on('data', (d) => { errors += d; });
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');

    await test('A nyilvántartás a keretet is elküldi a névválasztónak', async () => {
      const s = await connect();
      const res = await emit(s, 'get_registry', {});
      assert.equal(res.registry.length, 12);
      for (const p of players) assert.equal(res.registry.find((r) => r.nev === p.nev).keret, p.keret, p.nev);
      s.disconnect();
    });

    await test('Szobában a legenda neve alatt a szerver rárakja a keretet + LEGENDA feliratot (más név alatt nem)', async () => {
      const host = await connect();
      const created = await emit(host, 'create_room', { name: 'Sanyi/Sasi', playerId: 'sasi',
        profile: { titulus: 'x', cosm: { frame: 'frame_rainbow', nameFx: 'name_fire' }, acct: true } });
      assert.ok(created.code);
      const me = created.state.players.find((p) => p.name === 'Sanyi/Sasi').profile;
      assert.deepEqual(me.cosm, { frame: 'frame_founder', labelText: 'LEGENDA' }, 'a kliens által küldött cosm nem számít');
      assert.ok(!me.acct, 'az acct jelzőt sem lehet hamisítani');
      // egy másik legenda, és egy nem legenda
      const marci = await connect(), Marci = await connect(), other = await connect();
      const cosmIn = (st, name) => st.players.find((p) => p.name === name)?.profile?.cosm;
      const a = await emit(marci, 'join_room', { code: created.code, name: 'marci', playerId: 'm1' });
      assert.ok(!a.error, a.error);
      assert.equal(cosmIn(a.state, 'marci')?.frame, 'frame_lazy');
      assert.equal(cosmIn(a.state, 'marci')?.labelText, 'LEGENDA');
      // (a szobában a nevek kis/nagybetű nélkül egyediek: a másik Marci csak az első kilépése után jöhet)
      assert.match((await emit(Marci, 'join_room', { code: created.code, name: 'Marci', playerId: 'm2' })).error, /ŐRIZETBEN/);
      await emit(marci, 'leave_room');
      const b = await emit(Marci, 'join_room', { code: created.code, name: 'Marci', playerId: 'm2' });
      assert.ok(!b.error, b.error);
      assert.equal(cosmIn(b.state, 'Marci')?.frame, 'frame_twin', 'a másik Marci másik legenda, más kerettel');
      assert.notEqual(cosmIn(a.state, 'marci').frame, cosmIn(b.state, 'Marci').frame);
      const c = await emit(other, 'join_room', { code: created.code, name: 'Valaki Mas', playerId: 'v1', profile: { cosm: { frame: 'frame_glitch' } } });
      assert.ok(!c.error, c.error);
      assert.ok(!cosmIn(c.state, 'Valaki Mas'), 'nem legenda: a kliens nem adhat magának keretet');
      assert.equal(cosmIn(c.state, 'Marci')?.frame, 'frame_twin', 'a többiek is ugyanazt a keretet látják');
      for (const s of [host, marci, Marci, other]) s.disconnect();
    });

    await test('Szerver-hibák nélkül lefutott', async () => {
      assert.ok(!/HIBA|Error|uncaught/i.test(errors), errors.slice(0, 600));
    });
  } finally {
    for (const s of sockets) s.disconnect();
    child.kill();
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nLegendák: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
