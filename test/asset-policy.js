'use strict';
// ============================================================
// KAMU BÍRÓSÁG – asset-first szabályok (a grafika raszter-asset, nem SVG/CSS-rajz)
//   - 50 alap avatár, 50 × 5 szerep-kép elérési út (átmeneti placeholderek is), a raszter tárgyalótermek megvannak,
//   - a futó kód nem hivatkozik régi karakter-SVG-kre, és nem rajzol SVG-karaktert / SVG-tárgyalótermet (SVG csak egyszerű UI-elemen),
//   - a játék jelenete a magyar tárgyalóterem-képet használja (nem az amerikai zászlós régit).
// Futtatás: node test/asset-policy.js
// ============================================================
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let ok = 0, bad = 0;
function test(name, fn) { try { fn(); console.log('PASS:', name); ok++; } catch (e) { console.error('FAIL:', name, '\n ', e.message); bad++; } }
function assert(v, m) { if (!v) throw new Error(m); }
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const runtime = ['public/index.html', 'public/client.js', 'public/court.js', 'public/avatar-roles.js', 'public/style.css', 'public/court.css', 'server.js'];
const forbidden = ['targyalotterem.svg', 'biro.svg', 'biro_beszel.svg', 'ugyesz.svg', 'ugyesz_beszel.svg', 'vadlott.svg', 'vadlott_beszel.svg', 'tanu.svg', 'tanu_beszel.svg', 'eskudt.svg', 'eskudt_beszel.svg', 'vedougyved.svg', 'vedougyved_beszel.svg'];
const ROLES = ['judge', 'prosecutor', 'defendant', 'witness', 'juror'];
const num = (i) => String(i).padStart(2, '0');

test('runtime nem hivatkozik legacy SVG artworkre', () => { for (const f of runtime) { const s = read(f); for (const x of forbidden) assert(!s.includes(x), `${f} -> ${x}`); } });
test('50 base avatar megvan', () => { for (let i = 1; i <= 50; i++) assert(fs.existsSync(path.join(root, 'assets', 'avatars', `avatar_${num(i)}.webp`)), `avatar_${num(i)}.webp`); });
test('250 role asset elérési út megvan (50 avatar × 5 szerep), nem üres fájlokkal', () => {
  let n = 0;
  for (let i = 1; i <= 50; i++) for (const r of ROLES) {
    const f = path.join(root, 'assets', 'roles', `avatar_${num(i)}_${r}.webp`);
    assert(fs.existsSync(f), `hiányzik: avatar_${num(i)}_${r}.webp`);
    assert(fs.statSync(f).size > 500, `üres / túl kicsi: avatar_${num(i)}_${r}.webp`);
    n++;
  }
  assert(n === 250, 'darabszám: ' + n);
});
test('role manifest egyezik a mappa tartalmával', () => {
  const m = JSON.parse(read('assets/roles/ROLE_ASSET_MANIFEST.json'));
  assert(m.count === 250 && m.avatars === 50 && m.roles_per_avatar === 5, 'a manifest darabszámai: ' + JSON.stringify({ c: m.count, a: m.avatars, r: m.roles_per_avatar }));
  assert(JSON.stringify(m.roles) === JSON.stringify(ROLES), 'a manifest szerepei: ' + JSON.stringify(m.roles));
  const onDisk = fs.readdirSync(path.join(root, 'assets', 'roles')).filter((f) => /^avatar_\d\d_[a-z]+\.webp$/.test(f));
  assert(onDisk.length === 250, 'a mappában ' + onDisk.length + ' szerep-kép van, a manifest szerint 250');
});
test('raszter courtroom assetek megvannak', () => { for (const f of ['targyalotterem.jpg', 'targyalotterem.png', 'terem-hatter.webp']) assert(fs.existsSync(path.join(root, 'assets', f)), f); });
test('vizuális target referencia megvan', () => assert(fs.existsSync(path.join(root, 'assets', 'KAMU_UI_TARGET_REFERENCE.png')), 'target reference'));
test('role mappa és handoff szerződés megvan', () => { assert(fs.existsSync(path.join(root, 'assets', 'roles', 'README.md')), 'roles README'); assert(fs.existsSync(path.join(root, 'ASSET_FIRST_HANDOFF.md')), 'handoff'); });

test('a futó kód nem rajzol SVG-karaktert vagy SVG-tárgyalótermet: SVG csak egyszerű UI-elem (időzítő-gyűrű, kis ikon)', () => {
  for (const f of ['public/court.js', 'public/avatar-roles.js', 'public/chat.js', 'public/friends.js', 'public/shop.js', 'public/ranking.js']) {
    const s = read(f);
    assert(!/<svg|createElementNS|data:image\/svg/i.test(s), f + ' SVG-t tartalmaz');
  }
  const client = read('public/client.js');
  const lines = client.split('\n').filter((l) => /<svg|createElementNS/.test(l));
  for (const l of lines) assert(/viewBox="0 0 118 118"|createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/.test(l), 'nem engedett SVG a client.js-ben: ' + l.trim().slice(0, 100));
  // az index.html-ben csak a favicon (data URI, egy kis ikon) lehet SVG
  const html = read('public/index.html').replace(/<link rel="icon"[^>]*>/i, '');
  assert(!/<svg/i.test(html), 'az index.html-ben inline <svg> van');
  assert(!/<path\b[^>]*\bd="/i.test(read('public/court.js')) && !/<path\b[^>]*\bd="/i.test(read('public/avatar-roles.js')), 'SVG-útvonal a court.js / avatar-roles.js-ben');
});

test('a játék jelenete a magyar terem-képet használja (terem-hatter.webp), nem az amerikai zászlós régit', () => {
  const client = read('public/client.js'), html = read('public/index.html');
  assert(/scene: 'hu'|'hu'\)/.test(read('public/court.js')) && client.includes("src: '/assets/terem-hatter.webp'"), 'a hu profil nem a terem-hatter.webp-t használja');
  assert(/<div class="stage-bg-wrap" id="stageBgWrap"><img class="stage-bg" src="\/assets\/terem-hatter\.webp"/.test(html), 'az index.html háttere nem a magyar terem-kép');
  assert(!/<img class="stage-bg" src="\/assets\/targyalotterem/.test(html), 'a régi (amerikai zászlós) kép az alapértelmezett háttér');
});

console.log(`\nAsset policy: ${ok} sikeres, ${bad} hibás.`); process.exitCode = bad ? 1 : 0;
