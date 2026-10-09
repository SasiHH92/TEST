'use strict';
// ============================================================
// KAMU BÍRÓSÁG – szerep-karakter asset-feldolgozás (OpenArt ZIP -> assets/roles/avatar_NN_<szerep>.webp)
//
//   node scripts/build-role-assets.js <kicsomagolt-zip-mappa> [--out <mappa>] [--only av03,av04] [--no-manifest]
//
// Bemenet: a kicsomagolt OpenArt-képek (1792x2400 PNG, #00FF00 háttér) + az assets/roles/SOURCE_MAP.json (melyik kép melyik avatár × szerep).
// Kimenet: átlátszó WebP, mind ugyanazon a vásznon (720x960, 3:4), AZONOS fejmérettel és fej-helyzettel (hogy a courtroomban egységes legyen):
//   1. zöld háttér eltávolítása (scripts/lib/chroma-key.js): a széllel összefüggő háttér + a zárt zöld zsebek, puha él, zöld-szivárgás csökkentés;
//      a zöld ruhák (tanú zakója) nem sérülnek;
//   2. fejméret-normalizálás: az ARC (bőr-folt) szélessége – a haj / paróka / konty / sapka nem számít bele – a vászon FACE_W_TARGET része
//      (a bőr-folt mérése: measureFace); az áll (SOURCE_MAP "chin", kézi mérés) a vászon CHIN_Y magasságában, az arc vízszintesen középen áll;
//   3. az alsó szél puha elhalása (a derékban levágott kép ne ,,lebegjen'' kemény éllel);
//   4. WebP (alfa), a ROLE_ASSET_MANIFEST.json "real" listájának frissítése (a placeholderek maradnak, de nem számítanak szerep-képnek).
// A "sharp" csak ehhez kell: npm install --no-save sharp
// Az eredeti ZIP-et nem módosítja és nem része a repónak (a hely: lásd docs/ROLE-ASSETS.md).
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let sharp;
try { sharp = require('sharp'); } catch (_) { console.error('Az asset-feldolgozáshoz a "sharp" csomag kell (a projekt futásához nem): npm install --no-save sharp'); process.exit(1); }
const { load, keyOut } = require('./lib/chroma-key');

const ROOT = path.resolve(__dirname, '..');
const ROLES_DIR = path.join(ROOT, 'assets', 'roles');
// A kimeneti vászon és a normalizálás paraméterei (a public/avatar-roles.js ROLE_LAYOUT értékei ezekre épülnek).
const OUT_W = 720, OUT_H = 960;
const FACE_W_TARGET = 0.30; // az arc (bőr-folt) szélessége a vászon szélességének ennyi része
const CHIN_Y = 0.42;      // az áll a vászon tetejétől ennyi arányban áll (alatta a törzs)
const TOP_MARGIN = 10;    // a figura teteje és a vászon teteje közti minimális ráhagyás (px)
const FADE = 0.07;        // az alsó szél elhalása (a vászon magasságának hányada)
const WEBP = { quality: 82, alphaQuality: 92, effort: 5, smartSubsample: true };

function arg(name) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; }
const flag = (name) => process.argv.includes('--' + name);

function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0;
  if (d) { if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
  return [hh, mx ? d / mx : 0, mx];
}
// Az arc bőr-foltjának szélessége (forrás-pixel). Bőr: meleg árnyalat, közepes telítettség (a narancs rabruha és a bordó öltöny túl telített, a haj túl sötét).
// A fej-középvonalat tartalmazó, legnagyobb bőr-folt legnagyobb vízszintes szakasza az arc felső 70%-ában (fül is beleszámít; a szemüveg / szemöldök hézagait áthidalja).
function measureFace(rgba, w, h, top, chinPx, cx) {
  const W = w >> 1, H = h >> 1, sk = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = ((y * 2) * w + (x * 2)) * 4;
    if (rgba[p + 3] < 200) continue;
    const [hh, sat, v] = hsv(rgba[p], rgba[p + 1], rgba[p + 2]);
    if ((hh <= 36 || hh >= 350) && sat >= 0.14 && sat <= 0.66 && v >= 0.5) sk[y * W + x] = 1;
  }
  const t = top >> 1, chin = chinPx >> 1, c = Math.round(cx / 2);
  const lab = new Int32Array(W * H), comps = []; let n = 0;
  for (let y = t; y < Math.min(H, chin + Math.round(H * 0.04)); y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (!sk[p] || lab[p]) continue;
    n++; const st = [p]; lab[p] = n; let cnt = 0, x0 = x, x1 = x, y0 = y, y1 = y;
    while (st.length) {
      const q = st.pop(); cnt++; const qx = q % W, qy = (q / W) | 0;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = qx + ddx, ny = qy + ddy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const np = ny * W + nx; if (sk[np] && !lab[np]) { lab[np] = n; st.push(np); } }
    }
    comps.push({ id: n, cnt, x0, x1, y0, y1 });
  }
  comps.sort((a, b) => b.cnt - a.cnt);
  const face = comps.find((q) => q.x0 < c && q.x1 > c && q.y0 < chin && q.cnt > 2000) || comps[0];
  if (!face) return 0;
  let best = 0; const yEnd = face.y0 + Math.round((face.y1 - face.y0) * 0.7);
  for (let y = face.y0; y <= yEnd; y++) {
    let xl = c, xr = c;
    if (lab[y * W + c] !== face.id) { let f = -1; for (let d = 1; d < 40; d++) { if (lab[y * W + c - d] === face.id) { f = c - d; break; } if (lab[y * W + c + d] === face.id) { f = c + d; break; } } if (f < 0) continue; xl = xr = f; }
    while (xl > 0 && lab[y * W + xl - 1] === face.id) xl--; while (xr < W - 1 && lab[y * W + xr + 1] === face.id) xr++;
    for (let g = 0; g < 14 && xl > 0; g++) { if (lab[y * W + xl - 1 - g] === face.id) { xl = xl - 1 - g; while (xl > 0 && lab[y * W + xl - 1] === face.id) xl--; g = -1; } }
    for (let g = 0; g < 14 && xr < W - 1; g++) { if (lab[y * W + xr + 1 + g] === face.id) { xr = xr + 1 + g; while (xr < W - 1 && lab[y * W + xr + 1] === face.id) xr++; g = -1; } }
    best = Math.max(best, xr - xl + 1);
  }
  return best * 2;
}

async function processImage(srcFile, entry) {
  const { rgb, w, h } = await load(srcFile);
  const k = keyOut(rgb, w, h);
  const alphaAt = (x, y) => k.rgba[(y * w + x) * 4 + 3];
  // a kontúr teteje és az arc középpontja (a fej legfelső sávjának tömegközéppontja – a felemelt kéz / mutató kar nem zavar)
  let top = -1;
  for (let y = 0; y < h && top < 0; y++) for (let x = 0; x < w; x += 2) if (alphaAt(x, y) > 40) { top = y; break; }
  if (top < 0) throw new Error('üres kép (nincs előtér)');
  const chinPx = Math.round(entry.chin * h);
  const headPx = chinPx - top;
  if (headPx < h * 0.1) throw new Error('hibás áll-érték: ' + entry.chin);
  let sx = 0, sn = 0;
  const bandEnd = Math.min(h, top + Math.round(headPx * 0.35));
  for (let y = top; y < bandEnd; y += 2) for (let x = 0; x < w; x += 2) { const a = alphaAt(x, y); if (a > 40) { sx += x; sn++; } }
  const cx = sn ? sx / sn : w / 2;
  const faceW = entry.faceW || measureFace(k.rgba, w, h, top, chinPx, cx);
  if (!faceW || faceW < w * 0.08) throw new Error('az arc-szélesség nem mérhető (add meg kézzel: faceW a SOURCE_MAP-ben)');
  const s = (FACE_W_TARGET * OUT_W) / faceW * (entry.headScale || 1);

  // átméretezés a célra (alfa-prémultiplikált Lanczos), majd a vászonra illesztés
  const rw = Math.round(w * s), rh = Math.round(h * s);
  const resized = await sharp(k.rgba, { raw: { width: w, height: h, channels: 4 } }).resize(rw, rh, { kernel: 'lanczos3' }).raw().toBuffer();
  const dx = Math.round(OUT_W / 2 - cx * s + (entry.dx || 0));
  let dy = Math.round(CHIN_Y * OUT_H - chinPx * s + (entry.dy || 0));
  // a haj / konty / sapka teteje sosem lóghat ki a vászon tetején (nincs levágott fej): ha kilógna, a figura lejjebb kerül (TOP_MARGIN px ráhagyás)
  let shiftedDown = 0;
  if (dy + top * s < TOP_MARGIN) { shiftedDown = Math.round(TOP_MARGIN - (dy + top * s)); dy += shiftedDown; }
  const canvas = Buffer.alloc(OUT_W * OUT_H * 4);
  let clipL = 0, clipR = 0, clipT = 0, total = 0, bottomY = -1;
  for (let y = 0; y < rh; y++) {
    const oy = y + dy;
    for (let x = 0; x < rw; x++) {
      const p = (y * rw + x) * 4, a = resized[p + 3];
      if (a <= 40) continue;
      total++;
      const ox = x + dx;
      if (oy < 0) { clipT++; continue; }
      if (ox < 0) { clipL++; continue; }
      if (ox >= OUT_W) { clipR++; continue; }
      if (oy < OUT_H && oy > bottomY) bottomY = oy;
    }
    if (oy < 0 || oy >= OUT_H) continue;
    for (let x = 0; x < rw; x++) {
      const ox = x + dx; if (ox < 0 || ox >= OUT_W) continue;
      const p = (y * rw + x) * 4, q = (oy * OUT_W + ox) * 4;
      canvas[q] = resized[p]; canvas[q + 1] = resized[p + 1]; canvas[q + 2] = resized[p + 2]; canvas[q + 3] = resized[p + 3];
    }
  }
  // az alsó szél: ha a figura a vásznon belül ér véget (derékban levágott kép), a vége elhal; ha a vászon aljáig tart, a legalsó sáv halványodik
  const figureEnds = dy + rh - 1 < OUT_H - 1;
  const endY = figureEnds ? Math.min(OUT_H - 1, dy + rh - 1) : OUT_H - 1;
  const fadeLen = Math.round(OUT_H * FADE);
  for (let y = Math.max(0, endY - fadeLen); y <= endY; y++) {
    const m = figureEnds ? (endY - y) / fadeLen : (OUT_H - 1 - y) / fadeLen * 0.5 + 0.5;
    const f = Math.max(0, Math.min(1, figureEnds ? m : m));
    // vászon-alj esetén csak enyhe (50%-ig) halványítás: a láb / asztal ne tűnjön el teljesen, de ne legyen kemény vágás
    for (let x = 0; x < OUT_W; x++) { const q = (y * OUT_W + x) * 4 + 3; canvas[q] = Math.round(canvas[q] * f); }
  }
  const buf = await sharp(canvas, { raw: { width: OUT_W, height: OUT_H, channels: 4 } }).webp(WEBP).toBuffer();
  const pct = (n) => +(100 * n / Math.max(1, total)).toFixed(2);
  return { buf, info: { shiftedDown, faceW, headPx, scale: +s.toFixed(4), cx: Math.round(cx), clipLeftPct: pct(clipL), clipRightPct: pct(clipR), clipTopPct: pct(clipT), figureEndsAt: figureEnds ? +(endY / OUT_H).toFixed(3) : 1, gkKey: k.gkKey } };
}

(async () => {
  const dir = process.argv[2];
  if (!dir || dir.startsWith('--')) { console.error('Használat: node scripts/build-role-assets.js <kicsomagolt-zip-mappa> [--out <mappa>] [--only av03,av04] [--no-manifest]'); process.exit(1); }
  const out = path.resolve(arg('out') || ROLES_DIR);
  const only = arg('only') ? new Set(arg('only').split(',')) : null;
  const map = JSON.parse(fs.readFileSync(path.join(ROLES_DIR, 'SOURCE_MAP.json'), 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const report = [], problems = [];
  for (const entry of map.images) {
    if (entry.skip) { problems.push(entry.avatar + ' ' + entry.role + ': kihagyva – ' + entry.skipReason); continue; }
    if (only && !only.has(entry.avatar)) continue;
    const src = path.join(dir, entry.file);
    if (!fs.existsSync(src)) { problems.push(entry.avatar + ' ' + entry.role + ': hiányzik a forrás (' + entry.file + ')'); continue; }
    const name = 'avatar_' + entry.avatar.slice(2) + '_' + entry.role + '.webp';
    try {
      const { buf, info } = await processImage(src, entry);
      fs.writeFileSync(path.join(out, name), buf);
      const row = { file: name, source: entry.file, bytes: buf.length, ...info };
      report.push(row);
      const warn = [];
      if (info.clipLeftPct > 1 || info.clipRightPct > 1) warn.push('oldalt levágódik: ' + info.clipLeftPct + '% / ' + info.clipRightPct + '%');
      if (info.clipTopPct > 0.2) warn.push('felül levágódik: ' + info.clipTopPct + '%');
      if (info.shiftedDown > 0) problems.push(name + ': a feje a vászon tetejéhez ért, ' + info.shiftedDown + ' px-szel lejjebb került (az arc-vonal eltér a többitől)');
      if (warn.length) problems.push(name + ': ' + warn.join(', '));
      process.stdout.write('.');
    } catch (e) { problems.push(name + ': HIBA – ' + e.message); }
  }
  console.log('\nelkészült: ' + report.length + ' kép, összesen ' + Math.round(report.reduce((s, r) => s + r.bytes, 0) / 1024) + ' KB');
  for (const p of problems) console.log(' ! ' + p);
  fs.writeFileSync(path.join(out === ROLES_DIR ? ROLES_DIR : out, 'BUILD_REPORT.json'), JSON.stringify({ built: report.length, canvas: [OUT_W, OUT_H], faceWTarget: FACE_W_TARGET, chinY: CHIN_Y, problems, images: report }, null, 1) + '\n');

  if (!flag('no-manifest') && out === ROLES_DIR) {
    // a ROLE_ASSET_MANIFEST.json "real" listája: csak ezek számítanak szerep-képnek (a placeholderek ugyanúgy megvannak a mappában, de nem jelennek meg a játékban)
    const mp = path.join(ROLES_DIR, 'ROLE_ASSET_MANIFEST.json');
    const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
    const real = {};
    for (const e of map.images) { if (e.skip) continue; (real[e.avatar] = real[e.avatar] || []).push(e.role); }
    for (const id of Object.keys(real)) real[id].sort((a, b) => manifest.roles.indexOf(a) - manifest.roles.indexOf(b));
    const realCount = Object.values(real).reduce((n, l) => n + l.length, 0);
    const hash = crypto.createHash('sha1').update(JSON.stringify(report.map((r) => r.file + r.bytes))).digest('hex').slice(0, 8);
    Object.assign(manifest, {
      status: 'PARTIAL_REAL_ROLE_ASSETS',
      real_count: realCount, placeholder_count: manifest.count - realCount, version: hash, real,
      warning: 'The listed "real" files are final role artwork (OpenArt, chroma-keyed, head-normalized). All other avatar_NN_<role>.webp files intentionally reuse the original avatar artwork: they keep the 50 x 5 file contract alive but are NOT served as role sprites (the game falls back to the avatar portrait + role badge). Replace them with real role artwork, then add them to "real". Never replace them with SVG characters.'
    });
    fs.writeFileSync(mp, JSON.stringify(manifest, null, 2) + '\n');
    console.log('manifest frissítve: real ' + realCount + ' / ' + manifest.count + ' (verzió ' + hash + ')');
  }
})().catch((e) => { console.error(e); process.exit(1); });
