'use strict';
// ============================================================
// KAMU BÍRÓSÁG – csak az az avatár választható, amelyiknek mind az 5 szerep-modellje megvan
//  - a közös lista (avatar-roles.js SELECTABLE) pontosan egyezik a ROLE_ASSET_MANIFEST.json "real" listájával (mind az 5 alap-szerep), a fájlok léteznek
//  - a szerver a kivett avatárt nem fogadja el (fiók-profil, szobába lépés, legenda-kártya), és a régi tárolt értéket sem adja ki
//  - a böngészőben az avatár-választók csak a választható avatárokat kínálják
// Futtatás: node test/avatar-select.js
// ============================================================
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const roles = require('../public/avatar-roles');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* böngésző nélkül a böngészős rész kimarad */ }

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-avsel-'));
const f = (n) => path.join(tmp, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}

(async () => {
  await test('a választható lista egyezik a manifesttel: pontosan azok az avatárok, amelyeknek mind az 5 szerep-modellje igazi; a fájlok léteznek', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/roles/ROLE_ASSET_MANIFEST.json'), 'utf8'));
    const complete = Object.entries(manifest.real).filter(([, rs]) => roles.CORE_ROLES.every((r) => rs.includes(r))).map(([id]) => id).sort();
    assert.deepEqual([...roles.selectable()].sort(), complete, 'a SELECTABLE lista eltér a manifesttől – frissítsd az avatar-roles.js-ben');
    assert.equal(complete.length, 12);
    for (const id of complete) {
      const n = id.slice(2);
      assert.ok(fs.existsSync(path.join(root, 'assets/avatars/avatar_' + n + '.webp')), id + ' portré');
      for (const r of roles.CORE_ROLES) assert.ok(fs.existsSync(path.join(root, 'assets/roles/avatar_' + n + '_' + r + '.webp')), id + ' ' + r);
    }
    for (const bad of ['av08', 'av20', 'av25', 'av29', 'av33', 'av50', 'av00', 'av51', '', null, undefined, 5]) assert.equal(roles.isSelectable(bad), false, String(bad));
  });

  const PORT = 3216, BASE = 'http://127.0.0.1:' + PORT;
  // egy régi, mára kivett avatárral mentett fiók előre elkészítve (bejelentkezett munkamenettel)
  const token = crypto.randomBytes(32).toString('base64url');
  const userId = crypto.randomUUID();
  fs.writeFileSync(f('acc.json'), JSON.stringify({ version: 1, users: [{ id: userId, username: 'Regi Rudi', email: 'regi@example.invalid', password: null, providers: {}, createdAt: Date.now(), profile: { titulus: 'x', priusz: 'y', jelveny: '', avatar: 'av33' } }],
    sessions: [{ hash: crypto.createHash('sha256').update(token).digest('hex'), userId, expiresAt: Date.now() + 3600000, persistent: false }], resets: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DISCORD_BOT_TOKEN: '', RESEND_API_KEY: '', EMAIL_FROM: '', AUTH_MAIL_API_KEY: '', AUTH_MAIL_FROM: '',
      AUTH_STORE_PATH: f('acc.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('st.json'), KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'),
      KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') }
  });
  const sockets = [];
  const http_ = async (method, p, body, cookie) => {
    const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...(cookie ? { Cookie: 'kb_account=' + cookie } : {}) };
    const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
    return { status: r.status, data, text };
  };
  const emit = (s, ev, payload = {}) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('Ack timeout: ' + ev)), 4000); s.emit(ev, payload, (res) => { clearTimeout(t); resolve(res); }); });
  const connect = async () => { const s = io(BASE, { transports: ['websocket'], reconnection: false }); sockets.push(s); await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); }); return s; };
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');

    await test('szerver: a régi, kivett avatárral mentett fióknál nem jelenik meg az avatár; a profilban csak választható avatár menthető', async () => {
      const st = await http_('GET', '/api/auth/status', undefined, token);
      assert.equal(st.data.user.username, 'Regi Rudi'); assert.equal(st.data.user.profile.avatar, '', 'a kivett avatár nem adódik ki');
      const base = { username: 'Regi Rudi', titulus: 'x', priusz: 'y', jelveny: '' };
      assert.equal((await http_('POST', '/api/auth/profile', { ...base, avatar: 'av33' }, token)).status, 400, 'kivett avatár nem menthető');
      assert.equal((await http_('POST', '/api/auth/profile', { ...base, avatar: 'av08' }, token)).status, 400);
      assert.equal((await http_('POST', '/api/auth/profile', { ...base, avatar: 'av99' }, token)).status, 400);
      const ok = await http_('POST', '/api/auth/profile', { ...base, avatar: 'av10' }, token);
      assert.equal(ok.status, 200, ok.text); assert.equal((await http_('GET', '/api/auth/status', undefined, token)).data.user.profile.avatar, 'av10');
      assert.equal((await http_('POST', '/api/auth/profile', { ...base, avatar: '' }, token)).status, 200, 'az avatár törölhető');
    });

    await test('szerver: szobába lépéskor a kivett avatár nem kerül a játékosra (a választható igen)', async () => {
      const a = await connect(), b = await connect();
      const created = await emit(a, 'create_room', { name: 'Avatar Aladar', avatar: 'av33', playerId: 'a1' });
      assert.ok(created.code, JSON.stringify(created));
      assert.ok(!/^av\d\d$/.test(created.state.players[0].avatar), 'a kivett avatár nem marad: ' + created.state.players[0].avatar);
      const joined = await emit(b, 'join_room', { code: created.code, name: 'Avatar Bela', avatar: 'av10', playerId: 'b1' });
      assert.equal(joined.state.players.find((p) => p.name === 'Avatar Bela').avatar, 'av10');
    });

    await test('szerver: a legenda-kártya kivett avatárja nem jelenik meg a névválasztóban (a választható igen)', async () => {
      const s = await connect();
      s.emit('set_avatar', { name: 'Izsván', avatar: 'av33' }); // (nincs visszaigazolás)
      await pause(100);
      let reg = (await emit(s, 'get_registry', {})).registry.find((r) => r.nev === 'Izsván');
      assert.ok(!reg.avatar, 'kivett avatár: ' + reg.avatar);
      s.emit('set_avatar', { name: 'Izsván', avatar: 'av11' });
      await pause(150);
      reg = (await emit(s, 'get_registry', {})).registry.find((r) => r.nev === 'Izsván');
      assert.equal(reg.avatar, 'av11');
    });

    if (chromium) {
      await test('böngésző: a karakter-választó (modal) és a profil csak a 12 választható avatárt kínálja, a kivett nem látszik', async () => {
        const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
        const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'msedge' });
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          await page.addInitScript(() => { try { localStorage.setItem('kb_avatar', 'av33'); } catch (_) { /* */ } }); // régi, kivett avatár a tárolóban
          await page.goto(BASE + '/');
          await page.waitForFunction(() => !document.querySelector('#authGuest').disabled, null, { timeout: 15000 });
          await page.click('#authGuest');
          await page.waitForSelector('.mug-card', { timeout: 15000 });
          const info = await page.evaluate(() => ({ list: AVATARS.slice(), stored: localStorage.getItem('kb_avatar'), my: MY.avatar }));
          assert.deepEqual(info.list, ['av01', 'av02', 'av03', 'av04', 'av05', 'av06', 'av07', 'av09', 'av10', 'av11', 'av21', 'av22']);
          assert.equal(info.stored, null, 'a régi kivett avatár törlődött a tárolóból'); assert.ok(!info.my || info.list.includes(info.my), 'a kivett avatár nem marad kiválasztva: ' + info.my);
          // a legenda-kártya választójában is csak ennyi cella van
          await page.locator('.mug-card:not(.taken)').first().click();
          await page.waitForSelector('#avatarModalGrid .avatar-cell');
          const cells = await page.$$eval('#avatarModalGrid .avatar-cell', (els) => els.map((e) => e.dataset.avatar));
          assert.deepEqual(cells, info.list);
        } finally { await browser.close(); }
      });
    }
  } finally { for (const s of sockets) s.disconnect(); child.kill(); }
  console.log('\nAvatár-választás: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exit(failed ? 1 : 0);
})();
