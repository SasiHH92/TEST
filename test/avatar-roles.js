'use strict';
// ============================================================
// KAMU BÍRÓSÁG – avatár × szerep megfeleltetés
//   - a névkonvenció (avatar_17_judge.webp), a hiányzó képek tartaléka, a vegyes (részleges) készlet,
//   - minden szerepnek van jelmez-tartaléka, a megfeleltetés érvénytelen bemenetre is biztonságos,
//   - a szerver csak a ténylegesen feltöltött, érvényes nevű képeket sorolja fel (/api/role-sprites).
// Futtatás: node test/avatar-roles.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const roles = require('../public/avatar-roles');

const PORT = 3197, BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-roles-'));
const spriteDir = path.join(tmp, 'roles');
let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}

async function main() {
  await test('Névkonvenció: avatar_<sorszám>_<szerep>.webp, az azonosító nem változik', () => {
    assert.equal(roles.fileName('av17', 'judge'), 'avatar_17_judge.webp');
    assert.equal(roles.fileName('av05', 'juror'), 'avatar_05_juror.webp');
    assert.equal(roles.fileName('av50', 'defendant'), 'avatar_50_defendant.webp');
    assert.deepEqual(roles.CORE_ROLES, ['judge', 'prosecutor', 'defendant', 'witness', 'juror']);
    assert.ok(roles.ROLES.includes('defender'));
  });

  await test('Képek nélkül minden szerep tartalékra (null) esik; minden szerephez egyszerű HTML jelvény fallback van', () => {
    roles.setAvailable({});
    for (const role of roles.ROLES) {
      assert.equal(roles.spriteFor('av17', role), null, role);
      const html = roles.costumeHtml(role);
      assert.match(html, /^<span class="role-fallback-badge role-fallback-/, role);
      assert.match(html, /aria-hidden="true"/);
      assert.ok(!/<svg|<script|on\w+=/i.test(html), 'nincs SVG/szkript a fallbackban: ' + role);
    }
    assert.equal(roles.costumeHtml('nincs-ilyen-szerep'), '');
    assert.equal(roles.count(), 0);
  });

  await test('Részleges készlet: csak a feltöltött avatár × szerep használ képet, a többi tartalék; érvénytelen bemenet kimarad', () => {
    const n = roles.setAvailable({ av17: ['judge', 'witness', 'ismeretlen'], av05: ['juror'], av99: ['judge'], valami: ['judge'], av08: 'judge' });
    assert.equal(n, 3, 'csak az érvényes bejegyzések: ' + n);
    assert.equal(roles.spriteFor('av17', 'judge'), '/assets/roles/avatar_17_judge.webp');
    assert.equal(roles.spriteFor('av17', 'witness'), '/assets/roles/avatar_17_witness.webp');
    assert.equal(roles.spriteFor('av17', 'prosecutor'), null, 'más szerep ugyanannak az avatárnak: tartalék');
    assert.equal(roles.spriteFor('av06', 'judge'), null, 'más avatár: tartalék');
    assert.equal(roles.spriteFor('av05', 'juror'), '/assets/roles/avatar_05_juror.webp');
    for (const bad of [undefined, null, '', 'av00', 'av51', 'avatar_17', '../etc/passwd', 'av17/../x', 5, {}]) assert.equal(roles.spriteFor(bad, 'judge'), null);
    assert.equal(roles.spriteFor('av17', 'bohoc'), null);
    assert.equal(roles.spriteFor('av17', '__proto__'), null);
    assert.equal(roles.has('av17', 'constructor'), false);
  });

  await test('Lefedettség: az 50 × 5 alapkészlet hányada van meg, a hiányzók fájlnevekkel; a védő külön számolódik', () => {
    roles.setAvailable({ av01: ['judge', 'prosecutor', 'defendant', 'witness', 'juror', 'defender'], av02: ['judge'] });
    const c = roles.coverage();
    assert.equal(c.total, 250); assert.equal(c.have, 6); assert.equal(c.defender, 1);
    assert.equal(c.missing.length, 244);
    assert.ok(c.missing.includes('avatar_02_prosecutor.webp') && !c.missing.includes('avatar_02_judge.webp'));
    assert.deepEqual(roles.coverage(['av01']), { have: 5, total: 5, missing: [], defender: 1 });
    roles.setAvailable({});
  });

  // ---------- szerver ----------
  fs.mkdirSync(spriteDir, { recursive: true });
  for (const name of ['avatar_17_judge.webp', 'avatar_17_witness.webp', 'avatar_05_juror.webp', 'avatar_50_defender.webp',
    'avatar_99_judge.webp', 'avatar_17_boss.webp', 'avatar_1_judge.webp', 'avatar_17_judge.png', 'jegyzet.txt', 'avatar_17_judge.webp.tmp']) fs.writeFileSync(path.join(spriteDir, name), 'x');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DATABASE_URL: '', KB_ROLE_SPRITES_DIR: spriteDir,
      AUTH_STORE_PATH: path.join(tmp, 'accounts.json'), KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_STATS_FILE: path.join(tmp, 'stats.json'),
      KB_DMS_FILE: path.join(tmp, 'dms.json'), KB_ERRORS_FILE: path.join(tmp, 'errors.json'), KB_MODERATION_FILE: path.join(tmp, 'moderation.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { await pause(100); } }

    await test('GET /api/role-sprites: csak a feltöltött, érvény nevű képek, szerepenként, a roles/ mappa tartalma alapján', async () => {
      const r = await fetch(BASE + '/api/role-sprites');
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'no-cache');
      const d = await r.json();
      assert.equal(d.version, 1);
      assert.deepEqual(Object.keys(d.available).sort(), ['av05', 'av17', 'av50']);
      assert.deepEqual(d.available.av17.sort(), ['judge', 'witness']);
      assert.deepEqual(d.available.av05, ['juror']); assert.deepEqual(d.available.av50, ['defender']);
      assert.ok(!JSON.stringify(d).includes('boss') && !JSON.stringify(d).includes('99'), 'érvénytelen nevek kimaradnak');
      // a kliens-modul ezt közvetlenül be tudja olvasni
      assert.equal(roles.setAvailable(d.available), 4);
      assert.equal(roles.spriteFor('av50', 'defender'), '/assets/roles/avatar_50_defender.webp');
      roles.setAvailable({});
    });

    await test('Alapértelmezett mappa (nincs kép): üres lista, nem hiba; a statikus mappa elérhető', async () => {
      const d = await (await fetch(BASE + '/api/role-sprites')).json();
      assert.ok(d.available && typeof d.available === 'object');
      assert.equal((await fetch(BASE + '/assets/roles/README.md')).status, 200, 'a névkonvenció leírása kiszolgálódik');
    });

    await test('A szerver nem naplózott belső hibát', () => {
      assert.ok(!/HIBA a\(z\)|uncaughtException|unhandledRejection/.test(stderr), stderr.slice(0, 400));
    });
  } finally {
    child.kill();
    await pause(150);
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nAvatár × szerep: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
