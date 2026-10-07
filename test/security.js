'use strict';
// ============================================================
// KAMU BÍRÓSÁG – visszaélés-védelem
//   - a szerver a játékos kilétét a saját munkamenetéből veszi, nem a kliens szavából (ülés-átvétel, botok, token),
//   - szoba-spam és kapcsolat-spam korlátozása, elhagyott lobbi-szoba azonnali megszűnése,
//   - igényelt legenda-kártya avatárját csak a gazdája írhatja át,
//   - a szavazat végleges, a Közönségkedvenc-pont nem hajtható fel kinevetéssel,
//   - a QR-generálás sebességkorlátos.
// Valódi szerver (ideiglenes fájlokkal), valódi socket.io + HTTP kérésekkel, és a játékmotor közvetlen tesztje.
// Futtatás: node test/security.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const io = require('socket.io-client');
const { Game } = require('../game');
const { legendCode } = require('../legend-claims');

const PORT = 3194, BASE = 'http://127.0.0.1:' + PORT;
const SECRET = 'csak-teszthez-valo-titok-0123456789';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-security-'));
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
// A kapcsolat-korlát miatt a tesztek a fölösleges kapcsolatokat lezárják: cleanup(megtartandók).
async function cleanup(keep = []) {
  for (const s of [...sockets]) if (!keep.includes(s)) { s.disconnect(); sockets.splice(sockets.indexOf(s), 1); }
  await pause(200);
}
// Egyszeri kérés egy külön kapcsolatról, utána azonnal lezárja.
async function once(event, payload) {
  const s = await connect();
  try { return await emit(s, event, payload); } finally { s.disconnect(); sockets.splice(sockets.indexOf(s), 1); }
}
const avatarFile = path.join(tmp, 'avatars.json');
const savedAvatars = () => (fs.existsSync(avatarFile) ? JSON.parse(fs.readFileSync(avatarFile, 'utf8')) : {});

// ---------- játékmotor (nincs hálózat) ----------
function mkGame(n) {
  const g = new Game('SEC', { to: () => ({ emit: () => {} }), emit: () => {} });
  for (let i = 0; i < n; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  return g;
}

async function engine() {
  await test('Szavazat: egyszer adható le, nem módosítható; nem szavazó és érvénytelen érték elutasítva', () => {
    const g = mkGame(6);
    g.startVerdictVote();
    const d = g.roundData, voter = d.voters[0], other = d.voters[1];
    assert.equal(g.castVerdictVote(voter, 'guilty'), true);
    assert.equal(g.castVerdictVote(voter, 'not_guilty'), false, 'a második szavazat nem érvényes');
    assert.equal(d.votes[voter].verdict, 'guilty', 'az első szavazat marad');
    assert.equal(g.castVerdictVote(other, 'igen'), false, 'érvénytelen érték');
    const nonVoter = [...g.players.keys()].find((id) => !d.voters.includes(id));
    assert.equal(g.castVerdictVote(nonVoter, 'guilty'), false, 'aki nem esküdt, nem szavazhat (pl. a védő)');
    assert.equal(d.votes[nonVoter], undefined);
    g.dispose();
  });

  await test('Közönségkedvenc: a beszélő saját nevetése nem számít, játékosonként korlátos, és a reakciók gyorsasága is', () => {
    const g = mkGame(6);
    const d = g.roundData;
    g.phase = 'prosecution';
    const clock = Date.now;
    let now = 1_000_000;
    Date.now = () => (now += 300); // minden hívás 300 ms-mal későbbi: a gyorsaság-korlát nem zavar
    try {
      const juror = d.voters.find((id) => id !== d.prosecutorId && id !== d.defendantId);
      for (let i = 0; i < 20; i++) g.handleReaction(d.prosecutorId, '😂'); // a vádló saját magát nevetné
      assert.equal(d.laughs.prosecutor, 0, 'a beszélő saját nevetése nem számít');
      for (let i = 0; i < 20; i++) g.handleReaction(juror, '😂');
      assert.equal(d.laughs.prosecutor, Game.LAUGH_CAP, 'egy játékos legfeljebb ' + Game.LAUGH_CAP + '-öt számíthat be');
      g.phase = 'defense';
      for (let i = 0; i < 20; i++) g.handleReaction(d.defendantId, '😂');
      for (let i = 0; i < 20; i++) g.handleReaction(d.defenderId, '😂');
      assert.equal(d.laughs.defendant, 0, 'a vádlott és a védő nem nevetheti fel a saját oldalát');
      g.handleReaction(juror, '😂');
      assert.equal(d.laughs.defendant, 1, 'másik beszélőnek külön keret van');
    } finally { Date.now = clock; }
    // gyorsaság: azonos pillanatban érkező reakciók közül csak az első megy át
    let sent = 0;
    g.io = { to: () => ({ emit: () => { sent++; } }), emit: () => {} };
    g.phase = 'prosecution';
    const juror2 = d.voters.find((id) => id !== d.prosecutorId && id !== d.defendantId && id !== 'x');
    g.reactionAt = new Map();
    const fixed = Date.now;
    Date.now = () => 5_000_000;
    try {
      g.handleReaction(juror2, '🔥'); g.handleReaction(juror2, '🔥'); g.handleReaction(juror2, '🔥');
    } finally { Date.now = fixed; }
    assert.equal(sent / g.players.size, 1, 'a gyors ismétlések eldobódnak');
    g.dispose();
  });

  await test('Reakció: ismeretlen emoji és lecsatlakozott / ismeretlen játékos nem számít', () => {
    const g = mkGame(6);
    const d = g.roundData;
    g.phase = 'prosecution';
    const juror = d.voters.find((id) => id !== d.prosecutorId && id !== d.defendantId);
    g.handleReaction(juror, '<script>');
    g.handleReaction('nincs-ilyen', '😂');
    g.players.get(juror).connected = false;
    g.handleReaction(juror, '😂');
    assert.equal(d.laughs.prosecutor, 0);
    g.dispose();
  });
}

async function main() {
  await engine();

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DATABASE_URL: '', LEGEND_SECRET: SECRET,
      MAX_ROOMS_PER_IP: '3', MAX_SOCKETS_PER_IP: '12',
      AUTH_STORE_PATH: path.join(tmp, 'accounts.json'), KB_AVATARS_FILE: avatarFile, KB_STATS_FILE: path.join(tmp, 'stats.json'),
      KB_DMS_FILE: path.join(tmp, 'dms.json'), KB_ERRORS_FILE: path.join(tmp, 'errors.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');

    let code, hostToken, botId;
    const host = await connect();
    await test('Ülés-átvétel: a gazda és a bot ülését token nélkül senki nem veheti át, a botok azonosítója nem használható', async () => {
      const created = await emit(host, 'create_room', { name: 'Gazda Teszt', playerId: 'host-1' });
      code = created.code; hostToken = created.sessionToken;
      assert.ok(code && hostToken);
      await emit(host, 'add_bot');
      await pause(200);
      const state = (await emit(host, 'join_room', { code, name: 'Gazda Teszt', playerId: 'host-1', sessionToken: hostToken })).state;
      const bot = state.players.find((p) => p.isBot);
      botId = bot.id;
      assert.ok(botId.startsWith('bot_'));

      const takeBot = await once('join_room', { code, name: 'Rosszarc', playerId: botId });
      const afterBot = (takeBot.state ? takeBot.state : (await emit(host, 'join_room', { code, name: 'Gazda Teszt', playerId: 'host-1', sessionToken: hostToken })).state);
      assert.equal(afterBot.players.find((p) => p.id === botId).name, bot.name, 'a bot ülése nem lett átvéve');
      if (takeBot.state) assert.notEqual(takeBot.playerId, botId, 'a bot azonosítóját a szerver nem adja ki másnak');

      const stealHost = await once('join_room', { code, name: 'Rosszarc2', playerId: 'host-1' });
      assert.match(stealHost.error || '', /másik munkamenethez/, 'token nélkül a gazda ülése védett');
      const wrong = await once('join_room', { code, name: 'Rosszarc3', playerId: 'host-1', sessionToken: 'hamis-token' });
      assert.match(wrong.error || '', /másik munkamenethez/, 'rossz tokennel is védett');
      const back = await once('join_room', { code, name: 'Gazda Teszt', playerId: 'host-1', sessionToken: hostToken });
      assert.ok(back.state, 'a jó tokennel visszatérhet (újratöltés / újracsatlakozás)');
    });

    await test('Gazda-jogok: nem gazda nem indíthat, nem állíthat be, nem rúghat ki, nem adhat hozzá botot', async () => {
      const guest = await connect();
      const joined = await emit(guest, 'join_room', { code, name: 'Vendég Pista', playerId: 'guest-1' });
      assert.ok(joined.state, 'a vendég csatlakozott');
      assert.ok((await emit(guest, 'add_bot')).error);
      assert.ok((await emit(guest, 'update_settings', { settings: { rounds: 12 } })).error);
      assert.ok((await emit(guest, 'start_game', { settings: { modes: ['buli'] } })).error);
      assert.ok((await emit(guest, 'kick_player', { playerId: 'host-1' })).error);
    });

    await test('Szoba-spam: egy kapcsolat egyszerre egy szobát tarthat, az elhagyott üres lobbi azonnal megszűnik', async () => {
      const spam = await connect();
      const codes = [];
      for (let i = 0; i < 12; i++) {
        const r = await emit(spam, 'create_room', { name: 'Spam ' + i, playerId: 'sp-' + i });
        assert.ok(r.code, 'mindig sikerül: ' + (r.error || ''));
        codes.push(r.code);
      }
      const alive = [];
      for (const c of codes) {
        const r = await once('join_room', { code: c, name: 'Néző ' + c, playerId: 'peek-' + c });
        if (r.state) alive.push(c);
      }
      assert.deepEqual(alive, [codes[codes.length - 1]], 'csak az utolsó szoba él');
    });

    await test('Szobák címenként: a keret betelte után a (3.) új szoba elutasítva, kilépés után újra lehet', async () => {
      // a host-szoba már él (1), a spam-szoba is (2): még egy fér, a következő nem
      const a = await connect(), b = await connect(), c = await connect();
      const r1 = await emit(a, 'create_room', { name: 'Egy', playerId: 'a1' });
      assert.ok(r1.code, 'a 3. szoba még fér');
      const r2 = await emit(b, 'create_room', { name: 'Kettő', playerId: 'b1' });
      assert.match(r2.error || '', /Túl sok szobád/, 'a 4. szoba már nem');
      await emit(a, 'leave_room');
      const r3 = await emit(c, 'create_room', { name: 'Három', playerId: 'c1' });
      assert.ok(r3.code, 'kilépés után újra lehet');
      await emit(c, 'leave_room');
    });

    await test('Bot-only lobbi nem tart életben szobát: a gazda kilépésekor megszűnik', async () => {
      const h = await connect();
      const r = await emit(h, 'create_room', { name: 'Bot Gazda', playerId: 'bh-1' });
      await emit(h, 'add_bot');
      await pause(150);
      await emit(h, 'leave_room');
      const peek = await once('join_room', { code: r.code, name: 'Néző', playerId: 'peek-x' });
      assert.match(peek.error || '', /megszűnt/, 'a szoba megszűnt');
    });

    await test('A kliens nem adhat magának "bot_" azonosítót', async () => {
      const s = await connect();
      const r = await emit(s, 'create_room', { name: 'Álbot', playerId: 'bot_hamis1' });
      assert.ok(r.code);
      assert.ok(!r.playerId.startsWith('bot_'), 'kapott azonosító: ' + r.playerId);
      await emit(s, 'leave_room');
    });

    // ---------- avatár ----------
    const password = 'Egy hosszú titok 123!';
    await test('Avatár: igényelt legenda kártyáját csak a gazdája írhatja át (bejelentkezve); az igényeletlen szabad, de korlátozott', async () => {
      // igénylés: Alexhh fiókot kap
      const jar = new Map();
      const claim = await http('POST', '/api/auth/register', { username: 'x', legend: 'Alexhh', claim: legendCode(SECRET, 'Alexhh'), email: 'alex@example.invalid', password, confirmPassword: password }, jar);
      assert.equal(claim.status, 201, 'a legenda igénylése sikerült');

      const stranger = await connect();
      stranger.emit('set_avatar', { name: 'Alexhh', avatar: 'av33' });
      await pause(800);
      assert.notEqual(savedAvatars().Alexhh, 'av33', 'idegen nem írhatja át az igényelt legenda avatárját');

      const owner = await connect();
      const ticket = (await http('POST', '/api/friends/ticket', {}, jar)).data.ticket;
      const idr = await emit(owner, 'identify', { ticket });
      assert.equal(idr.account, true, 'a fiók azonosítva');
      owner.emit('set_avatar', { name: 'Alexhh', avatar: 'av34' });
      await pause(800);
      assert.equal(savedAvatars().Alexhh, 'av34', 'a gazdája átírhatja');

      // igényeletlen legenda: szabad, de egy kapcsolatról nem sűrűn
      const guest = await connect();
      guest.emit('set_avatar', { name: 'Izsván', avatar: 'av05' });
      await pause(800);
      assert.equal(savedAvatars().Izsván, 'av05');
      guest.emit('set_avatar', { name: 'Izsván', avatar: 'av06' });
      await pause(800);
      assert.equal(savedAvatars().Izsván, 'av05', 'a sűrű ismétlés eldobódik');
      guest.emit('set_avatar', { name: 'Nincs Ilyen Kártya', avatar: 'av07' });
      guest.emit('set_avatar', { name: 'Izsván', avatar: '../../etc/passwd' });
      await pause(800);
      assert.equal(savedAvatars()['Nincs Ilyen Kártya'], undefined);
      assert.equal(savedAvatars().Izsván, 'av05', 'érvénytelen avatár-azonosító nem mentődik');
    });

    await test('QR-generálás: percenként legfeljebb 30 kérés címenként', async () => {
      let limited = 0;
      for (let i = 0; i < 36; i++) if ((await fetch(BASE + '/qr?room=ABCD')).status === 429) limited++;
      assert.ok(limited >= 5, 'a korlát működik (' + limited + ' elutasított)');
    });

    await test('Kapcsolatok címenként: a keret fölött új kapcsolat nem épül fel, a lezárt hely felszabadul', async () => {
      for (const s of sockets) s.disconnect();
      sockets.length = 0;
      await pause(500);
      const open = [];
      let refused = 0;
      for (let i = 0; i < 16; i++) {
        try { open.push(await connect()); } catch (_) { refused++; }
      }
      assert.equal(open.length, 12, 'legfeljebb 12 nyitott kapcsolat');
      assert.equal(refused, 4);
      open[0].disconnect();
      await pause(300);
      assert.ok(await connect(), 'felszabadult hely után újra lehet');
    });

    await test('A szerver nem naplózott belső hibát a támadási próbálkozások alatt', () => {
      assert.ok(!/HIBA a\(z\)|uncaughtException|unhandledRejection/.test(stderr), stderr.slice(0, 500));
    });
  } finally {
    for (const s of sockets) s.disconnect();
    child.kill();
    await pause(150);
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nVisszaélés-védelem: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});

