'use strict';
// Chroma-key (zöld háttér) eltávolítás (a scripts/build-role-assets.js használja): a kép széléhez kapcsolódó háttér + a zárt, tiszta kulcsszínű lyukak; puha él (alfa), zöld-szivárgás (spill) csökkentés.
// A ruházat zöldje (pl. tanú zöld zakója) nem sérül: a kulcs "zöldsége" (g - max(r,b)) sokkal nagyobb, mint bármelyik ruhadarabé.
// A "sharp" csak az asset-feldolgozáshoz kell (a játék futásához nem): npm install --no-save sharp
let sharp;
try { sharp = require('sharp'); } catch (_) { throw new Error('Az asset-feldolgozáshoz a "sharp" csomag kell (a projekt futásához nem): npm install --no-save sharp'); }

const T_HI = 88;   // ennyi zöldségtől biztosan háttér (kulcs)
const T_LO = 56;   // a kapcsolódó terjedés alsó küszöbe
const FG_G = 42;   // ennyi zöldségig a pixel biztosan előtér (zöld ruha is ide fér)
const BAND = 4;    // a puha él szélessége (px, teljes felbontáson)

async function load(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgb: data, w: info.width, h: info.height };
}

function keyOut(rgb, w, h) {
  const n = w * h;
  const gk = new Int16Array(n); // zöldség
  for (let i = 0, p = 0; i < n; i++, p += 3) { const r = rgb[p], g = rgb[p + 1], b = rgb[p + 2]; gk[i] = g - (r > b ? r : b); }
  // a kulcs zöldsége: a szélsáv erősen zöld pixeleinek mediánja
  const samples = [];
  const edge = (x, y) => { const v = gk[y * w + x]; if (v > T_HI) samples.push(v); };
  for (let x = 0; x < w; x += 7) { for (let y = 0; y < 6; y++) { edge(x, y); edge(x, h - 1 - y); } }
  for (let y = 0; y < h; y += 7) { for (let x = 0; x < 6; x++) { edge(x, y); edge(w - 1 - x, y); } }
  samples.sort((a, b) => a - b);
  const gkKey = samples.length ? samples[samples.length >> 1] : 255;

  // 1) a széllel összefüggő háttér: magok a szélen (gk > T_HI), terjedés T_LO fölött
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n); let sp = 0;
  const push = (i) => { if (!bg[i] && gk[i] > T_LO) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { if (gk[x] > T_HI) push(x); if (gk[(h - 1) * w + x] > T_HI) push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { if (gk[y * w] > T_HI) push(y * w); if (gk[y * w + w - 1] > T_HI) push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp], x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  // 2) zárt lyukak (pl. kar és törzs között): tiszta kulcsszínű, elég nagy összefüggő foltok
  const seen = new Uint8Array(n);
  const MIN_HOLE = 5; // a hajtincsek közti apró zárt zöld zsebek is háttérnek számítanak
  for (let i0 = 0; i0 < n; i0++) {
    if (bg[i0] || seen[i0] || gk[i0] <= T_HI) continue;
    const comp = []; sp = 0; stack[sp++] = i0; seen[i0] = 1;
    while (sp) {
      const i = stack[--sp]; comp.push(i); const x = i % w, y = (i / w) | 0;
      const tryp = (j) => { if (!bg[j] && !seen[j] && gk[j] > T_HI) { seen[j] = 1; stack[sp++] = j; } };
      if (x > 0) tryp(i - 1); if (x < w - 1) tryp(i + 1); if (y > 0) tryp(i - w); if (y < h - 1) tryp(i + w);
    }
    if (comp.length >= MIN_HOLE) for (const i of comp) bg[i] = 1;
  }
  // 3) puha él: a háttér BAND sugarú környezetében alfa a zöldségből; a távolabbi pixelek maradnak (előtér)
  const alpha = new Float32Array(n);
  const dist = new Uint8Array(n).fill(255); // távolság a háttértől (max BAND+1)
  // távolság-térkép: többkörös tágítás
  let frontier = [];
  for (let i = 0; i < n; i++) if (bg[i]) { dist[i] = 0; frontier.push(i); }
  for (let d = 1; d <= BAND + 1; d++) {
    const next = [];
    for (const i of frontier) {
      const x = i % w, y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) if (j >= 0 && dist[j] === 255) { dist[j] = d; next.push(j); }
    }
    frontier = next;
  }
  // előtér-sűrűség 11x11 ablakban (a vékony, szabadon álló hajszálak sűrűsége kicsi, a ruhaszélé nagy)
  const W1 = w + 1, sat = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += bg[y * w + x] ? 0 : 1; sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row; } }
  const density = (x, y) => { const R = 5, x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    return (sat[y1 * W1 + x1] - sat[y0 * W1 + x1] - sat[y1 * W1 + x0] + sat[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0)); };
  const out = Buffer.alloc(n * 4);
  const span = Math.max(40, gkKey - FG_G);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    let a = 1, r = rgb[p], g = rgb[p + 1], b = rgb[p + 2];
    if (bg[i]) a = 0;
    else if (dist[i] <= BAND) {
      // vegyes pixel: minél zöldebb, annál átlátszóbb
      const v = gk[i];
      a = v <= FG_G ? 1 : Math.pow(Math.max(0, 1 - (v - FG_G) / span), 1.4); // a legvékonyabb, zöldbe oldódó szálak eltűnnek (nincs zöldes fátyol)
      // zöld-szivárgás: az él közelében a zöld nem lehet több, mint a piros/kék nagyobbika (a tiszta zöld ruházat az élen is megtartja a színét, mert távolabb nem nyúlunk hozzá)
      const m = r > b ? r : b;
      if (g > m) { const k = (BAND + 1 - dist[i]) / (BAND + 1); const full = a < 0.98 || dist[i] <= 1; g = Math.round(g - (g - m) * (full ? 1 : Math.min(1, 0.55 + 0.6 * k))); }
    }
    // a zöldbe oldódó, még mindig sárgászöld árnyalatú szál-maradványok (a hajtincsek szélén) eltűnnek; csak a vékony, szabadon álló szálak (alacsony sűrűség)
    if (a > 0 && dist[i] <= BAND + 1 && (a < 0.95 || density(i % w, (i / w) | 0) < 0.42)) {
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx - mn > 0.25 * mx) {
        let hue = 0; const d = mx - mn;
        if (mx === r) hue = (((g - b) / d) % 6) * 60; else if (mx === g) hue = ((b - r) / d + 2) * 60; else hue = ((r - g) / d + 4) * 60;
        if (hue < 0) hue += 360;
        if (hue >= 58 && hue <= 165 && density(i % w, (i / w) | 0) < 0.45) a *= 0.12;
      }
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = Math.round(a * 255);
    alpha[i] = a;
  }
  // 4) záró zöld-szivárgás csökkentés: a végleges átlátszóság szélének 7 forrás-px-es környezetében a maradék zöldes árnyalat (hajszál-szélek) a piros / kék szintjére vágva.
  //    A zöld ruhák (tanú zakója) szélét ez nem érinti: ott a környező pixelek többsége maga is zöld-domináns (sűrűség-teszt), tehát nem szivárgás.
  const SAT = (mask) => { const t = new Int32Array(W1 * (h + 1)); for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += mask[y * w + x]; t[(y + 1) * W1 + x + 1] = t[y * W1 + x + 1] + row; } } return t; };
  const box = (t, x, y, R) => { const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1); return t[y1 * W1 + x1] - t[y0 * W1 + x1] - t[y1 * W1 + x0] + t[y0 * W1 + x0]; };
  const zero = new Uint8Array(n), gdom = new Uint8Array(n), solid = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) { if (out[p + 3] < 8) zero[i] = 1; else { solid[i] = 1; if (out[p + 1] - Math.max(out[p], out[p + 2]) > 18) gdom[i] = 1; } }
  const zSat = SAT(zero), gSat = SAT(gdom), sSat = SAT(solid);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4;
    if (out[p + 3] < 8 || !gdom[i]) continue;
    if (box(zSat, x, y, 7) === 0) continue;                       // nem a szélen (7 forrás-px ≈ 3 px a kimeneti méreten)
    const sol = box(sSat, x, y, 10);
    if (sol > 0 && box(gSat, x, y, 10) > 0.55 * sol) continue;    // zöld ruha széle (a környező szilárd pixelek többsége zöld): marad
    const m = out[p] > out[p + 2] ? out[p] : out[p + 2];
    out[p + 1] = Math.min(out[p + 1], m + 4);
  }
  return { rgba: out, w, h, gkKey, bgShare: bg.reduce((s, v) => s + v, 0) / n };
}
module.exports = { load, keyOut };
