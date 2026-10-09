'use strict';
// ============================================================
// KAMU BÍRÓSÁG – szerep-karakter képek (assets/roles): fájlok, manifest, kiszolgálás, megfeleltetés (böngésző nélkül)
//  - minden "real" kép megvan, érvényes átlátszó WebP, egységes 720 × 960 vásznon, ésszerű méretben; a SOURCE_MAP és a manifest egyezik
//  - (ha a "sharp" elérhető) pixel-ellenőrzés: átlátszó sarkok / felső sor, nincs zöld halo az éleken, nincs túl nagy levágás oldalt
//  - a szerver CSAK a manifest "real" listáját hirdeti (a placeholder fájlok nem szerep-képek), a verzióval; a képek hosszú gyorsítótárral jönnek
//  - megfeleltetés: getRoleAvatar (szerep-kép vagy az eredeti avatár, soha nem törött kép), markMissing, ?v= verzió, layoutFor (mód + avatáronkénti finomhangolás)
// Futtatás: node test/role-sprites.js        (a pixel-ellenőrzéshez: NODE_PATH=<mappa a sharp-pal> node test/role-sprites.js)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roles = require('../public/avatar-roles');

const root = path.resolve(__dirname, '..');
const DIR = path.join(root, 'assets', 'roles');
const CORE = ['judge', 'prosecutor', 'defendant', 'witness', 'juror'];
const W = 720, H = 960;
let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* a pixel-ellenőrzés kimarad */ }
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'ROLE_ASSET_MANIFEST.json'), 'utf8'));
const sourceMap = JSON.parse(fs.readFileSync(path.join(DIR, 'SOURCE_MAP.json'), 'utf8'));
const realPairs = [];
for (const [id, list] of Object.entries(manifest.real || {})) for (const r of list) realPairs.push([id, r]);
const fileOf = (id, role) => path.join(DIR, 'avatar_' + id.slice(2) + '_' + role + '.webp');

let passed = 0, failed = 0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}

// WebP-fejléc (RIFF / VP8X): alfa-jelző és vászonméret dekódolás nélkül
function webpInfo(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF'); assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { alpha: !!(buf[20] & 0x10), width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), kind };
  return { alpha: false, width: 0, height: 0, kind };
}

async function startServer(port, extraEnv) {
  const base = 'http://127.0.0.1:' + port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-rs-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', AUTH_BASE_URL: base, DATABASE_URL: '',
    AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'), KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json'), ...extraEnv } });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return { base, child, tmp, errors: () => stderr }; } catch (_) { await pause(100); } }
  child.kill(); throw new Error('a szerver nem indult el');
}

async function main() {
  await test('Manifest + SOURCE_MAP: a "real" lista egyezik a forrás-térképpel és a mappával; a verzió megvan', () => {
    assert.equal(manifest.status, 'PARTIAL_REAL_ROLE_ASSETS');
    assert.ok(/^[0-9a-f]{8}$/.test(manifest.version), 'verzió: ' + manifest.version);
    assert.equal(manifest.real_count, realPairs.length); assert.equal(manifest.real_count + manifest.placeholder_count, manifest.count);
    assert.ok(realPairs.length >= 70, 'legalább 70 igazi szerep-kép: ' + realPairs.length);
    const mapPairs = sourceMap.images.filter((e) => !e.skip).map((e) => e.avatar + ':' + e.role).sort();
    assert.deepEqual(realPairs.map(([a, r]) => a + ':' + r).sort(), mapPairs, 'a "real" lista = a SOURCE_MAP nem kihagyott bejegyzései');
    const files = sourceMap.images.map((e) => e.file); assert.equal(new Set(files).size, files.length, 'egy forrás-kép csak egyszer szerepel');
    for (const e of sourceMap.images) { assert.ok(CORE.includes(e.role), e.role); assert.ok(roles.AVATAR_RE.test(e.avatar), e.avatar); assert.ok(typeof e.chin === 'number' && e.chin > 0.15 && e.chin < 0.65, e.file + ' chin'); }
    for (const e of sourceMap.images.filter((x) => x.skip)) assert.ok(e.skipReason, 'a kihagyásnak oka van: ' + e.avatar + ' ' + e.role);
    // minden avatár × szerep pár legfeljebb egyszer
    assert.equal(new Set(sourceMap.images.map((e) => e.avatar + ':' + e.role)).size, sourceMap.images.length, 'avatár × szerep páros duplikáció');
    // a nem-real fájlok (placeholderek) továbbra is megvannak (50 × 5 szerződés)
    for (let i = 1; i <= 50; i++) for (const r of CORE) assert.ok(fs.existsSync(path.join(DIR, 'avatar_' + String(i).padStart(2, '0') + '_' + r + '.webp')), 'hiányzik: ' + i + ' ' + r);
  });

  await test('Minden igazi szerep-kép érvényes átlátszó WebP, egységes 720 × 960 vásznon, ésszerű fájlmérettel', () => {
    let total = 0;
    for (const [id, role] of realPairs) {
      const buf = fs.readFileSync(fileOf(id, role)), info = webpInfo(buf);
      assert.equal(info.kind, 'VP8X', id + ' ' + role + ': alfa-képes (VP8X) WebP kell');
      assert.ok(info.alpha, id + ' ' + role + ': nincs alfa-csatorna');
      assert.equal(info.width, W, id + ' ' + role + ' szélesség'); assert.equal(info.height, H, id + ' ' + role + ' magasság');
      assert.ok(buf.length > 20 * 1024 && buf.length < 400 * 1024, id + ' ' + role + ': fájlméret ' + buf.length);
      total += buf.length;
    }
    assert.ok(total < 8 * 1024 * 1024, 'összméret: ' + total);
  });

  await test(sharp ? 'Pixel-ellenőrzés: átlátszó háttér (sarkok, felső sor), nincs zöld halo, nincs jelentős oldalsó levágás' : 'Pixel-ellenőrzés kimarad (a "sharp" nem elérhető): NODE_PATH-szal futtasd', async () => {
    if (!sharp) return;
    const worst = { halo: 0, haloFile: '', side: 0, sideFile: '' };
    for (const [id, role] of realPairs) {
      const { data } = await sharp(fileOf(id, role)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const a = (x, y) => data[(y * W + x) * 4 + 3];
      for (const [x, y] of [[0, 0], [W - 1, 0], [2, 2], [W - 3, 2]]) assert.equal(a(x, y), 0, id + ' ' + role + ': nem átlátszó sarok');
      let topOpaque = 0; for (let x = 0; x < W; x++) if (a(x, 0) > 8) topOpaque++;
      assert.equal(topOpaque, 0, id + ' ' + role + ': a felső sorban kép van (levágott fej)');
      // zöld halo: a látható él-pixelek zöldessége
      let edge = 0, green = 0, left = 0, right = 0, opaque = 0;
      for (let y = 2; y < H - 2; y += 1) for (let x = 2; x < W - 2; x += 1) {
        const al = a(x, y); if (al < 200) continue;
        opaque++;
        const p = (y * W + x) * 4, gdom = data[p + 1] - Math.max(data[p], data[p + 2]);
        if (a(x - 2, y) === 0 || a(x + 2, y) === 0 || a(x, y - 2) === 0) { edge++; if (gdom > 40) green++; }
      }
      // a zöld ruhás tanú ruházata NEM vágódott ki a zöld háttérrel: a törzs közepe (x 38–62%, y 50–66%) tömör (nincs lyuk / átlátszó folt)
      if (role === 'witness') {
        let solid = 0, total = 0;
        for (let y = Math.round(H * 0.50); y < Math.round(H * 0.66); y++) for (let x = Math.round(W * 0.38); x < Math.round(W * 0.62); x++) { total++; if (a(x, y) > 200) solid++; }
        assert.ok(solid / total > 0.97, id + ' witness: a ruházat kivágódott / lyukas (törzs-kitöltés ' + (100 * solid / total).toFixed(1) + '%)');
      }
      for (let y = 0; y < H; y++) { if (a(0, y) > 40) left++; if (a(W - 1, y) > 40) right++; }
      const halo = edge ? 100 * green / edge : 0, side = 100 * Math.max(left, right) / H;
      if (halo > worst.halo) { worst.halo = halo; worst.haloFile = id + ' ' + role; }
      if (side > worst.side) { worst.side = side; worst.sideFile = id + ' ' + role; }
      // (a tanú zöld zakójának éle jogosan zöld: ott a halo-mérés nem értelmezhető, a ruházat megléte fent van ellenőrizve)
      if (role !== 'witness') assert.ok(halo < 3, id + ' ' + role + ': zöld halo az éleken: ' + halo.toFixed(2) + '%');
      assert.ok(opaque / (W * H) > 0.12 && opaque / (W * H) < 0.9, id + ' ' + role + ': a figura aránya a vásznon: ' + (opaque / (W * H)).toFixed(2));
    }
    assert.ok(worst.side < 45, 'oldalt a képmagasság ' + worst.side.toFixed(0) + '%-án nyúlik a szélig (' + worst.sideFile + ')');
  });

  await test('Szerver: /api/role-sprites CSAK a "real" listát adja (a placeholderek nem), verzióval; a kép hosszú gyorsítótárral, ?v=-vel is jön', async () => {
    const s = await startServer(Number(process.env.RS_PORT || 3186));
    try {
      const r = await (await fetch(s.base + '/api/role-sprites')).json();
      const got = []; for (const [id, list] of Object.entries(r.available)) for (const role of list) got.push(id + ':' + role);
      assert.deepEqual(got.sort(), realPairs.map(([a, rl]) => a + ':' + rl).sort(), 'a hirdetett lista = a manifest "real" listája');
      assert.equal(r.v, manifest.version);
      assert.ok(fs.existsSync(path.join(DIR, 'avatar_08_judge.webp')) && !r.available.av08, 'az av08 placeholder-képe létezik, de nem szerep-kép');
      assert.equal((await fetch(s.base + '/api/role-sprites')).headers.get('cache-control'), 'no-cache');
      const img = await fetch(s.base + '/assets/roles/avatar_01_judge.webp?v=' + manifest.version);
      assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/webp');
      assert.match(img.headers.get('cache-control') || '', /max-age=\d+/); assert.match(img.headers.get('cache-control') || '', /immutable/);
      assert.ok(!/HIBA|uncaught/i.test(s.errors()), s.errors().slice(0, 300));
    } finally { s.child.kill(); try { fs.rmSync(s.tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  });

  await test('Szerver: más mappa manifest nélkül minden érvényes nevű képet felsorol; "real" listával csak azokat (a szűrő a mappa saját manifestjét követi)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-rs-dir-'));
    fs.writeFileSync(path.join(dir, 'avatar_03_judge.webp'), 'x'); fs.writeFileSync(path.join(dir, 'avatar_03_juror.webp'), 'x'); fs.writeFileSync(path.join(dir, 'avatar_04_witness.webp'), 'x'); fs.writeFileSync(path.join(dir, 'nem-kep.txt'), 'x');
    let s = await startServer(Number(process.env.RS_PORT || 3186) + 1, { KB_ROLE_SPRITES_DIR: dir });
    try {
      const all = await (await fetch(s.base + '/api/role-sprites')).json();
      assert.deepEqual(all.available, { av03: ['judge', 'juror'], av04: ['witness'] }); assert.equal(all.v, '');
    } finally { s.child.kill(); }
    fs.writeFileSync(path.join(dir, 'ROLE_ASSET_MANIFEST.json'), JSON.stringify({ version: 'teszt1', real: { av03: ['judge'] } }));
    s = await startServer(Number(process.env.RS_PORT || 3186) + 2, { KB_ROLE_SPRITES_DIR: dir });
    try {
      const some = await (await fetch(s.base + '/api/role-sprites')).json();
      assert.deepEqual(some.available, { av03: ['judge'] }); assert.equal(some.v, 'teszt1');
    } finally { s.child.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* */ } }
  });

  await test('Megfeleltetés: getRoleAvatar a választott avatár + a mostani szerep alapján – szerep-kép, ennek hiányában az eredeti avatár; soha nem üres hivatkozás érvényes avatárra', () => {
    roles.setAvailable({ av01: ['judge', 'witness'], av02: ['juror'] }, 'v1');
    assert.deepEqual(roles.getRoleAvatar('av01', 'judge'), { kind: 'sprite', src: '/assets/roles/avatar_01_judge.webp?v=v1' });
    assert.deepEqual(roles.getRoleAvatar('av01', 'witness'), { kind: 'sprite', src: '/assets/roles/avatar_01_witness.webp?v=v1' });
    assert.deepEqual(roles.getRoleAvatar('av01', 'prosecutor'), { kind: 'portrait', src: '/assets/avatars/avatar_01.webp' }, 'hiányzó szerep-kép: az eredeti avatár');
    assert.deepEqual(roles.getRoleAvatar('av33', 'judge'), { kind: 'portrait', src: '/assets/avatars/avatar_33.webp' }, 'hiányzó avatár-szerep: az eredeti avatár');
    for (const bad of [undefined, null, '', 'av00', 'av51', '../x', 7, {}]) assert.deepEqual(roles.getRoleAvatar(bad, 'judge'), { kind: 'generic', src: '' });
    assert.equal(roles.spriteFor('av01', 'defender'), null);
    // verzió: ?v= csak érvényes alakban
    roles.setAvailable({ av01: ['judge'] }, 'rossz verzió!');
    assert.equal(roles.spriteFor('av01', 'judge'), '/assets/roles/avatar_01_judge.webp?v=v1', 'érvénytelen verzió nem írja felül a régit');
    roles.setAvailable({ av01: ['judge'] }, '');
    assert.equal(roles.spriteFor('av01', 'judge'), '/assets/roles/avatar_01_judge.webp');
  });

  await test('markMissing: a nem betöltődő kép kikerül a készletből (a következő rajzolásnál az avatár portréja áll helyette); ismeretlenre nem csinál semmit', () => {
    roles.setAvailable({ av05: ['defendant', 'juror'], av06: ['judge'] }, '');
    assert.equal(roles.markMissing('av05', 'defendant'), true);
    assert.equal(roles.spriteFor('av05', 'defendant'), null); assert.ok(roles.spriteFor('av05', 'juror'), 'a másik szerep marad');
    assert.equal(roles.markMissing('av05', 'defendant'), false, 'másodszor már nincs mit');
    assert.equal(roles.markMissing('av06', 'judge'), true); assert.equal(roles.has('av06', 'judge'), false);
    assert.equal(roles.markMissing('av99', 'judge'), false); assert.equal(roles.markMissing('av05', '__proto__'), false);
    assert.equal(roles.getRoleAvatar('av05', 'defendant').kind, 'portrait');
  });

  await test('Elrendezés: minden szerepnek van alap-elrendezése (scale / x / y / z / depth); mód szerinti felülírás; avatáronkénti finomhangolás szorozza / adja; érvénytelen bemenet biztonságos', () => {
    for (const role of roles.ROLES) {
      const l = roles.ROLE_LAYOUT[role]; assert.ok(l, role);
      for (const k of ['scale', 'x', 'y', 'z', 'depth']) assert.ok(Number.isFinite(l[k]), role + '.' + k);
      assert.ok(l.scale > 0.5 && l.scale < 4, role + ' scale: ' + l.scale);
    }
    const base = roles.layoutFor('av01', 'prosecutor', 'desktop');
    assert.deepEqual(base, { scale: roles.ROLE_LAYOUT.prosecutor.scale, x: 0, y: 0, z: 0, depth: 1 });
    const narrow = roles.layoutFor('av01', 'prosecutor', 'narrow');
    assert.equal(narrow.x, roles.NARROW_LAYOUT.prosecutor.x); assert.equal(narrow.scale, base.scale, 'a nem felülírt mező az alap');
    const mobile = roles.layoutFor('av01', 'judge', true);
    assert.equal(mobile.scale, roles.MOBILE_LAYOUT.judge.scale); assert.deepEqual(roles.layoutFor('av01', 'judge', 'mobile'), mobile, 'true = mobile');
    assert.equal(roles.layoutFor('av01', 'bohoc', 'desktop').scale, roles.ROLE_LAYOUT.juror.scale, 'ismeretlen szerep: biztonságos alap');
    // avatáronkénti finomhangolás
    roles.AVATAR_ROLE_ADJUSTMENTS.av01 = { prosecutor: { scale: 0.5, x: 3, y: -2, z: 1 } };
    try {
      const adj = roles.layoutFor('av01', 'prosecutor', 'desktop');
      assert.equal(adj.scale, base.scale * 0.5); assert.equal(adj.x, 3); assert.equal(adj.y, -2); assert.equal(adj.z, 1);
      assert.deepEqual(roles.layoutFor('av02', 'prosecutor', 'desktop'), base, 'másik avatárt nem érint');
      assert.deepEqual(roles.layoutFor('av01', 'judge', 'desktop'), roles.layoutFor('av02', 'judge', 'desktop'), 'másik szerepet nem érint');
      roles.AVATAR_ROLE_ADJUSTMENTS.av01 = { prosecutor: { scale: 'nagy', x: NaN } };
      assert.deepEqual(roles.layoutFor('av01', 'prosecutor', 'desktop'), base, 'érvénytelen szám nem rontja el');
    } finally { delete roles.AVATAR_ROLE_ADJUSTMENTS.av01; }
    assert.deepEqual(roles.layoutFor('constructor', 'prosecutor', 'desktop'), base);
  });

  await test('Forrás-szabályok: a kliens a szerep-képet a resolveren át kapja (nincs kézi útvonal-építés), a CSS-ben nincs téglalap-háttér a karakter mögött, a kép betöltésig rejtett, a mozgáscsökkentés támogatott', () => {
    const client = fs.readFileSync(path.join(root, 'public', 'client.js'), 'utf8'), css = fs.readFileSync(path.join(root, 'public', 'court.css'), 'utf8');
    assert.ok(!/assets\/roles\//.test(client), 'a client.js nem épít kézzel /assets/roles/ útvonalat');
    const block = css.slice(css.indexOf('Szerep-képek (átlátszó'));
    assert.ok(block.length > 500, 'megvan a szerep-kép CSS szakasz');
    assert.match(block, /\.st-art\.role-sprite \.st-base\s*\{[^}]*opacity:\s*0/, 'betöltésig rejtve (nincs villanás)');
    assert.match(block, /\.st-art\.role-sprite\.sprite-ready\s*\{[^}]*animation:/, 'belépő animáció (a burkolón, backwards kitöltéssel)');
    assert.match(block, /sprite-ready\s*\{\s*animation:[^}]*backwards/, 'a belépő nem tartja meg a végállapotot (nem ütközik a beszélő-kiemeléssel)');
    assert.match(block, /prefers-reduced-motion/, 'mozgáscsökkentés');
    const spriteRules = block.match(/\.stage-slot\.sprite-slot[^{]*\{[^}]*\}/g) || [];
    for (const rule of spriteRules) assert.ok(!/background(?!-)\s*:\s*(?!none|transparent)/.test(rule.replace(/radial-gradient[^;]*;/g, '')) || /::before/.test(rule), 'a karakter mögött nincs háttér-téglalap: ' + rule.slice(0, 80));
    for (const dur of block.match(/animation:\s*spr-[a-z]+\s+(\d+)ms/g) || []) assert.ok(Number(dur.match(/(\d+)ms/)[1]) >= 250 && Number(dur.match(/(\d+)ms/)[1]) <= 450, 'a belépő 250–450 ms: ' + dur);
  });
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  console.log('\nSzerep-karakter képek: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
