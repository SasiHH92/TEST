'use strict';
// ============================================================
// KAMU BÍRÓSÁG – legendás kártya igénylése (egyszer használható link)
// - érvényes kóddal a legenda pontos nevén fiók jön létre, a legenda adataival; érvénytelen / hiányzó kóddal nem,
// - egy legendát egyszer lehet igényelni, igénylés nélkül a legenda neve foglalt marad,
// - az igényelt kártyát csak a gazdája használhatja bejelentkezve (keret + háttér + LEGENDA rajta),
// - a név nem módosítható, a link-generáló szkript ugyanazt a kódot adja, mint a szerver.
// A teszt-titok csak ehhez a teszthez való (a szerver ideiglenes fájlokkal fut).
// Futtatás: node test/claims.js
// ============================================================

const assert = require('assert/strict');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const io = require('socket.io-client');
const { legendCode } = require('../legend-claims');

const root = path.resolve(__dirname, '..');
const PORT = 3190, BASE = 'http://127.0.0.1:' + PORT;
const SECRET = 'csak-teszthez-valo-titok-0123456789';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-claims-'));
const sockets = [];
let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}

async function http(method, route, body, jar) {
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
const password = 'Egy hosszú titok 123!';
const claim = (jar, legend, code, email) => http('POST', '/api/auth/register', { username: 'bármi', legend, claim: code, email, password, confirmPassword: password }, jar);
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

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, LEGEND_SECRET: SECRET,
      AUTH_STORE_PATH: path.join(tmp, 'accounts.json'), KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_STATS_FILE: path.join(tmp, 'stats.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; child.stderr.on('data', (d) => { errors += d; });
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');

    await test('A link-generáló szkript ugyanazt a kódot adja, mint a szerver (és titok nélkül nem működik)', async () => {
      const run = (env) => spawnSync(process.execPath, [path.join(root, 'scripts', 'legend-links.js'), BASE], { env: { ...process.env, ...env }, encoding: 'utf8' });
      const ok = run({ LEGEND_SECRET: SECRET });
      assert.equal(ok.status, 0, ok.stderr);
      const players = JSON.parse(fs.readFileSync(path.join(root, 'data', 'players.json'), 'utf8')).players;
      for (const p of players) {
        const line = ok.stdout.split('\n').find((l) => l.includes('legend=' + encodeURIComponent(p.nev) + '&'));
        assert.ok(line, p.nev + ': nincs link');
        assert.ok(line.includes('claim=' + legendCode(SECRET, p.nev)), p.nev + ': a link kódja eltér');
      }
      assert.equal(new Set(players.map((p) => legendCode(SECRET, p.nev))).size, players.length, 'minden legendának más a kódja');
      assert.notEqual(run({ LEGEND_SECRET: '' }).status, 0, 'titok nélkül nem készül link');
      assert.notEqual(run({ LEGEND_SECRET: 'rovid' }).status, 0, 'túl rövid titokkal sem');
    });

    await test('Érvénytelen vagy hiányzó kóddal nincs igénylés; igénylés nélkül a legenda neve foglalt', async () => {
      assert.equal((await claim(new Map(), 'Kyrashi', 'x'.repeat(22), 'a@example.invalid')).status, 403, 'hamis kód');
      assert.equal((await claim(new Map(), 'Kyrashi', legendCode('masik-titok-0123456789abcdef', 'Kyrashi'), 'a@example.invalid')).status, 403, 'másik titokból számolt kód');
      assert.equal((await claim(new Map(), 'Kyrashi', legendCode(SECRET, 'Izsván'), 'a@example.invalid')).status, 403, 'másik legenda kódja');
      assert.equal((await claim(new Map(), 'Kyrashi', undefined, 'a@example.invalid')).status, 403, 'kód nélkül');
      assert.equal((await claim(new Map(), 'Nincs Ilyen', legendCode(SECRET, 'Nincs Ilyen'), 'a@example.invalid')).status, 403, 'nem legenda');
      const plain = await http('POST', '/api/auth/register', { username: 'Kyrashi', email: 'p@example.invalid', password, confirmPassword: password }, new Map());
      assert.equal(plain.status, 409, 'kód nélkül a legenda neve továbbra is foglalt');
    });

    const kyrashiJar = new Map();
    await test('Érvényes kóddal a fiók a legenda pontos nevén jön létre, a legenda adataival', async () => {
      const r = await claim(kyrashiJar, 'Kyrashi', legendCode(SECRET, 'Kyrashi'), 'kyrashi@example.invalid');
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.user.username, 'Kyrashi', 'a kliens által küldött név nem számít');
      assert.equal(r.data.user.legend, 'Kyrashi');
      assert.equal(r.data.user.profile.titulus, 'A szörny');
      assert.equal(r.data.user.profile.jelveny, 'ROGUE');
      const status = await http('GET', '/api/auth/status', undefined, kyrashiJar);
      assert.equal(status.data.user.legend, 'Kyrashi', 'be is van jelentkezve');
    });

    await test('A "/" jeles nevű legenda (Sanyi/Sasi) is igényelhető', async () => {
      const r = await claim(new Map(), 'Sanyi/Sasi', legendCode(SECRET, 'Sanyi/Sasi'), 'sasi@example.invalid');
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.user.username, 'Sanyi/Sasi');
    });

    await test('Egy legendát egyszer lehet igényelni', async () => {
      const again = await claim(new Map(), 'Kyrashi', legendCode(SECRET, 'Kyrashi'), 'masik@example.invalid');
      assert.equal(again.status, 409);
      assert.match(again.data.error, /már igényelték/);
    });

    await test('A név nem módosítható, a szövegek igen', async () => {
      const rename = await http('POST', '/api/auth/profile', { username: 'Valami Mas', titulus: 'x', priusz: 'y', jelveny: '', avatar: '' }, kyrashiJar);
      assert.equal(rename.status, 400); assert.match(rename.data.error, /nem módosítható/);
      const edit = await http('POST', '/api/auth/profile', { username: 'Kyrashi', titulus: 'A szörny, aki fiókot kapott', priusz: 'Most már hivatalosan is itt van.', jelveny: 'ROGUE', avatar: 'av07' }, kyrashiJar);
      assert.equal(edit.status, 200, JSON.stringify(edit.data));
      assert.equal(edit.data.user.profile.titulus, 'A szörny, aki fiókot kapott');
    });

    await test('Az igényelt kártyát csak a gazdája használhatja; a névválasztó jelzi a zárolást', async () => {
      const guest = await connect();
      const reg = await emit(guest, 'get_registry', {});
      assert.equal(reg.registry.find((r) => r.nev === 'Kyrashi').claimed, true);
      assert.equal(reg.registry.find((r) => r.nev === 'Izsván').claimed, false, 'a nem igényelt szabad');
      assert.match((await emit(guest, 'create_room', { name: 'Kyrashi', playerId: 'g1' })).error, /regisztrált/, 'vendég nem használhatja');
      assert.ok((await emit(guest, 'create_room', { name: 'Izsván', playerId: 'g2' })).code, 'a nem igényelt legenda továbbra is szabad');
      guest.disconnect();
      // a gazda: jegy + azonosítás után használhatja, rajta a legenda keret/háttér/felirat
      const owner = await connect();
      const ticket = (await http('POST', '/api/friends/ticket', {}, kyrashiJar)).data.ticket;
      assert.equal((await emit(owner, 'identify', { ticket })).account, true);
      const created = await emit(owner, 'create_room', { name: 'Kyrashi', playerId: 'k1' });
      assert.ok(created.code, JSON.stringify(created));
      const me = created.state.players.find((p) => p.name === 'Kyrashi').profile;
      assert.equal(me.acct, true);
      assert.equal(me.cosm.frame, 'frame_monster'); assert.equal(me.cosm.bg, 'bg_monster'); assert.equal(me.cosm.labelText, 'LEGENDA');
      owner.disconnect();
    });

    await test('Szerver-hibák nélkül lefutott', async () => {
      assert.ok(!/HIBA|Error|uncaught/i.test(errors), errors.slice(0, 800));
    });
  } finally {
    for (const s of sockets) s.disconnect();
    child.kill();
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nLegenda-igénylés: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
