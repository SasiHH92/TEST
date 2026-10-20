'use strict';
// ============================================================
// KAMU BÍRÓSÁG – a játékos valódi IP-címe a címenkénti korlátokhoz (client-ip.js) + a socket-üzenet méretkorlátja
//  A) a Cloudflare-tartományok felismerése (IPv4, IPv6, ::ffff:), a CF-Connecting-IP csak Cloudflare-ről jövő kérésnél számít, máshonnan nem hamisítható
//  B) helyi szerver, Cloudflare-fejlécekkel: két különböző játékos ugyanazon a Cloudflare-gépen át NEM osztozik a szoba-korláton;
//     ugyanaz a játékos igen; a hamisított CF-Connecting-IP (nem Cloudflare-ről) nem számít
//  C) a belépés-korlát (20 / 10 perc) játékosonként számol, nem Cloudflare-gépenként
//  D) a 64 KB-nál nagyobb socket-üzenet nem megy át (a kapcsolat bontva), a kisebb igen
// Futtatás: node test/client-ip.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { fromHeaders, isCloudflare, normalize } = require('../client-ip');
let ioClient;
try { ioClient = require('socket.io-client'); } catch (_) { /* lent */ }

const PORT = Number(process.env.CIP_PORT || 3291), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-cip-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };
const CF_HOP = '104.16.1.1'; // a Render-hez kapcsolódó Cloudflare-gép
const viaCf = (real) => ({ 'x-forwarded-for': real + ', ' + CF_HOP, 'cf-connecting-ip': real });

(async () => {
  // ---------- A) egység ----------
  await check('A) Cloudflare-tartományok: IPv4, IPv6, ::ffff: alak; idegen cím nem', async () => {
    for (const ip of ['104.16.1.1', '172.64.5.5', '162.159.200.1', '141.101.70.2', '2606:4700::1111', '2a06:98c1::5', '::ffff:104.16.1.1']) assert.equal(isCloudflare(ip), true, ip);
    for (const ip of ['8.8.8.8', '1.1.1.1', '192.168.1.10', '2001:db8::1', 'nem-ip', '']) assert.equal(isCloudflare(ip), false, ip);
    assert.equal(normalize('::ffff:10.0.0.1'), '10.0.0.1'); assert.equal(normalize('[2606:4700::1]'), '2606:4700::1'); assert.equal(normalize('hamis'), '');
  });
  await check('A) cím kiválasztása: Cloudflare-ről a CF-Connecting-IP; máshonnan az utolsó X-Forwarded-For elem (a hamis CF-fejléc nem számít)', async () => {
    assert.equal(fromHeaders(viaCf('203.0.113.5'), '10.0.0.2'), '203.0.113.5');
    assert.equal(fromHeaders({ 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': '203.0.113.5' }, '10.0.0.2'), '198.51.100.7', 'nem Cloudflare-ről: a hamis fejléc nem számít');
    assert.equal(fromHeaders({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }, '10.0.0.2'), '198.51.100.7', 'az utolsó (a proxy által írt) elem');
    assert.equal(fromHeaders({}, '::ffff:127.0.0.1'), '127.0.0.1', 'proxy nélkül a kapcsolat címe');
    assert.equal(fromHeaders({ 'x-forwarded-for': CF_HOP, 'cf-connecting-ip': 'szemét' }, ''), CF_HOP, 'érvénytelen CF-fejléc: marad a gép címe');
  });
  if (!ioClient) { console.log('SKIP: B–D (nincs socket.io-client)'); console.log('\nValódi IP: ' + passed + ' sikeres, ' + failed + ' hibás.'); process.exit(failed ? 1 : 0); }

  const f = (x) => path.join(tmp, x);
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '1', AUTH_TRUST_PROXY: '1', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  const sockets = [];
  const connect = (headers) => new Promise((resolve, reject) => {
    const s = ioClient(BASE, { transports: ['websocket'], reconnection: false, extraHeaders: headers || {} });
    sockets.push(s); s.once('connect', () => resolve(s)); s.once('connect_error', reject);
  });
  const ask = (s, ev, payload) => new Promise((resolve) => { s.emit(ev, payload, resolve); setTimeout(() => resolve({ timeout: true }), 4000); });
  let n = 0; const create = (s) => ask(s, 'create_room', { name: 'Ipteszt ' + (++n), avatar: 'av01', playerId: 'ipt-' + n + '-' + Date.now().toString(36) });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { /* */ } await pause(150); }
    await check('B) szoba-korlát (1 / cím) Cloudflare mögött: két különböző játékos egyaránt nyithat; ugyanaz a játékos a másodikat nem; hamis CF-fejléccel sem kerülhető meg', async () => {
      const a1 = await connect(viaCf('203.0.113.5')), b1 = await connect(viaCf('203.0.113.6'));
      const ra = await create(a1), rb = await create(b1);
      assert.ok(ra.code && !ra.error, 'A szobát nyit: ' + JSON.stringify(ra));
      assert.ok(rb.code && !rb.error, 'B (másik játékos, ugyanaz a Cloudflare-gép) is nyithat: ' + JSON.stringify(rb));
      const a2 = await connect(viaCf('203.0.113.5'));
      const ra2 = await create(a2);
      assert.ok(ra2.error, 'A második szobája elutasítva (a korlát a játékost fogja): ' + JSON.stringify(ra2));
      const d = await connect({ 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': '203.0.113.6' }); // nem Cloudflare-ről, B-nek adja ki magát
      const rd = await create(d);
      assert.ok(rd.code && !rd.error, 'a hamisító a saját címén számít (nem B-én): ' + JSON.stringify(rd));
    });
    await check('C) belépés-korlát: az egyik játékos 21. próbálkozása 429, a másik játékos (ugyanazon a Cloudflare-gépen) nincs kizárva', async () => {
      const login = (real) => fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, ...viaCf(real) }, body: JSON.stringify({ email: 'nincs@example.invalid', password: 'rossz jelszo 123' }) }).then((r) => r.status);
      const codes = []; for (let i = 0; i < 21; i++) codes.push(await login('203.0.113.50'));
      assert.equal(codes[20], 429, 'a 21. kérés korlátozva: ' + codes.join(','));
      assert.ok(codes.slice(0, 20).every((c) => c === 401), 'az első 20 normál hibás belépés: ' + codes.join(','));
      assert.equal(await login('203.0.113.51'), 401, 'a másik játékos továbbra is próbálkozhat');
    });
    await check('D) socket-üzenet: 30 KB átmegy, 100 KB-tól a kapcsolat bontva', async () => {
      const s = await connect(viaCf('203.0.113.70'));
      const small = await ask(s, 'check_name', { name: 'x'.repeat(30 * 1024), guest: true });
      assert.ok(!small.timeout && s.connected, '30 KB: válasz jött, a kapcsolat él');
      const gone = new Promise((r) => s.once('disconnect', (why) => r(why)));
      s.emit('check_name', { name: 'x'.repeat(100 * 1024), guest: true }, () => {});
      const why = await Promise.race([gone, pause(4000).then(() => 'nem bontott')]);
      assert.notEqual(why, 'nem bontott', 'a túl nagy üzenet után a szerver bontja a kapcsolatot');
    });
  } finally { for (const s of sockets) try { s.close(); } catch (_) { /* */ } server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nValódi IP + üzenetméret: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
