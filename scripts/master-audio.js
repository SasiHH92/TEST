'use strict';

// ============================================================
// KAMU BÍRÓSÁG – a legenerált hangok "mesterelése": csend levágása, hangerő-kiegyenlítés, finom lecsengés, MP3 újrakódolás
//
// A generált hangok hangereje nagyon különböző (a leghalkabb ~35 dB-lel halkabb a leghangosabbnál), és sok hang elején-végén csend van, a játék viszont
// minden fájlt ugyanazzal a mester-hangerővel játszik le. Ez a szkript az assets/audio/*.mp3 fájlokat kategóriánként beállított hangerőre hozza:
//   - levágja az elejéről / végéről a csendet (a vég 25 ms-es lecsengéssel, hogy ne pattanjon),
//   - a hangot a kijelölt csúcs-szintre (dBFS) normalizálja, a hosszan szóló hangoknál az átlagos (RMS) szintet is korlátozza,
//   - 128 kbps mono MP3-ba kódolja vissza. Az eredeti fájlok az assets/audio/_original mappába kerülnek (onnan dolgozik újra, így többször is futtatható).
//     Ha egy hangot újragenerálsz vagy kézzel lecserélsz, a szkript felismeri (a saját kimenetének ujjlenyomata alapján), és az új fájlt veszi eredetinek.
//
// Futtatás:  node scripts/master-audio.js [--only gavel,victory] [--dry-run]
// A dekódoláshoz a gépen lévő Edge / Chrome kell (playwright-core, a tesztekhez már telepítve van); a kódolót (lamejs) a fejlesztői csomagok adják.
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.resolve(ROOT, process.env.KB_AUDIO_DIR || 'assets/audio');
const SR = 44100;
const SILENT_DB = -30; // ennél halkabb csúcsú fájl "hangtalan" (generálási hiba): nem erősítjük fel, hanem újragenerálásra jelöljük (a halk, de jó hangok csúcsa ~ -22 dB)

// hang-név -> [csúcs-cél dBFS, átlagos (RMS) felső korlát dBFS]
const LEVELS = {
  'ui-click': [-16, -30], 'card-hover': [-22, -36], 'card-select': [-16, -30], 'countdown': [-14, -28], 'vote': [-14, -28], 'reaction': [-12, -26],
  'ready': [-12, -24], 'join': [-12, -24], 'ding': [-12, -24], 'chat': [-14, -26], 'dm': [-12, -24],
  'card-open': [-12, -26], 'card-new': [-14, -28], 'card-play': [-10, -24], 'paper': [-14, -28], 'evidence': [-8, -22], 'challenge': [-6, -20],
  'points': [-12, -24], 'score': [-12, -24], 'challenge-success': [-8, -20], 'challenge-fail': [-8, -18],
  'objection': [-6, -18], 'stinger': [-6, -18], 'intro': [-6, -18], 'intro-open': [-6, -18], 'reveal': [-4, -16], 'gavel': [-4, -18],
  'verdict-guilty': [-4, -17], 'verdict-acquitted': [-5, -18], 'victory': [-3, -16]
};

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const lin = (d) => Math.pow(10, d / 20);
const peakOf = (s) => { let p = 0; for (let i = 0; i < s.length; i++) { const v = Math.abs(s[i]); if (v > p) p = v; } return p; };
const rmsOf = (s) => { if (!s.length) return 0; let a = 0; for (let i = 0; i < s.length; i++) a += s[i] * s[i]; return Math.sqrt(a / s.length); };

// Csend levágása a csúcshoz képest (kis előfutással és lecsengéssel); a nagyon rövid maradék (< 40 ms) nem vágódik tovább.
function trim(samples, sr = SR, { leadDb = -40, tailDb = -48, preRollMs = 3, tailMs = 25 } = {}) {
  const peak = peakOf(samples);
  if (peak <= 0) return samples;
  const lt = peak * lin(leadDb), tt = peak * lin(tailDb);
  let a = 0; while (a < samples.length && Math.abs(samples[a]) < lt) a++;
  let b = samples.length - 1; while (b > a && Math.abs(samples[b]) < tt) b--;
  a = Math.max(0, a - Math.round(preRollMs * sr / 1000));
  b = Math.min(samples.length - 1, b + Math.round(tailMs * sr / 1000));
  const minLen = Math.round(0.04 * sr);
  if (b - a + 1 < minLen) b = Math.min(samples.length - 1, a + minLen - 1);
  return samples.slice(a, b + 1);
}

// Lecsengés a végén (hogy a vágás ne pattanjon) és 1 ms-os felfutás az elején.
function fades(samples, sr = SR, { outMs = 25, inMs = 1 } = {}) {
  const out = Float32Array.from(samples);
  const o = Math.min(out.length, Math.round(outMs * sr / 1000)), i = Math.min(out.length, Math.round(inMs * sr / 1000));
  for (let k = 0; k < o; k++) out[out.length - 1 - k] *= k / o;
  for (let k = 0; k < i; k++) out[k] *= k / i;
  return out;
}

// A erősítés: a csúcs-célhoz és az RMS-korláthoz is igazodik (a kisebbik érvényes), a csúcs soha nem lépi túl a -1 dBFS-t.
function normalizeGain(samples, peakTargetDb, rmsCapDb) {
  const peak = peakOf(samples), rms = rmsOf(samples);
  if (peak <= 0) return 1;
  let g = lin(peakTargetDb) / peak;
  if (rms > 0) g = Math.min(g, lin(rmsCapDb) / rms);
  return Math.min(g, lin(-1) / peak);
}

const toInt16 = (s) => { const o = new Int16Array(s.length); for (let i = 0; i < s.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))); return o; };

function loadEncoder() {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve('lamejs/lame.all.js'), 'utf8') + ';this.lamejs=lamejs;', ctx); // a csomag CommonJS-betöltése hibás: a csomagolt fájlt töltjük be
  return ctx.lamejs;
}
function encodeMp3(int16, sr = SR, kbps = 128) {
  const lame = loadEncoder();
  const enc = new lame.Mp3Encoder(1, sr, kbps), parts = [];
  for (let i = 0; i < int16.length; i += 1152) { const b = enc.encodeBuffer(int16.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush(); if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

// Dekódolás a böngészővel (Edge / Chrome): fájl-puffer -> mono Float32 (44,1 kHz).
async function decodeAll(buffers) {
  const { chromium } = require('playwright-core');
  const exe = process.env.CHROMIUM_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'msedge' });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    const out = [];
    for (const buf of buffers) {
      let b64;
      try {
      b64 = await page.evaluate(async ({ data, sr }) => {
        const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const ctx = new OfflineAudioContext(1, sr, sr);
        const a = await ctx.decodeAudioData(bin.buffer);
        const ch = a.numberOfChannels > 1 ? (() => { const m = new Float32Array(a.length); for (let c = 0; c < a.numberOfChannels; c++) { const d = a.getChannelData(c); for (let i = 0; i < m.length; i++) m[i] += d[i] / a.numberOfChannels; } return m; })() : a.getChannelData(0);
        const i16 = new Int16Array(ch.length); for (let i = 0; i < ch.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767)));
        let s = ''; const u = new Uint8Array(i16.buffer); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        return { rate: a.sampleRate, b64: btoa(s) };
      }, { data: buf.toString('base64'), sr: SR });
      } catch (e) { out.push({ error: String(e && e.message || e).split('\n')[0].slice(0, 120) }); continue; } // egy sérült fájl ne akassza meg a többit
      const raw = Buffer.from(b64.b64, 'base64');
      const i16 = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
      const f = new Float32Array(i16.length); for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32767;
      out.push({ samples: f, rate: b64.rate });
    }
    return out;
  } finally { await browser.close(); }
}

function processOne(name, samples, sr = SR) {
  const [peakDb, rmsDb] = LEVELS[name];
  const trimmed = trim(samples, sr);
  const g = normalizeGain(trimmed, peakDb, rmsDb);
  const mastered = fades(trimmed.map((v) => v * g), sr);
  return { mastered, gainDb: db(g), before: { peakDb: db(peakOf(samples)), sec: samples.length / sr }, after: { peakDb: db(peakOf(mastered)), rmsDb: db(rmsOf(mastered)), sec: mastered.length / sr } };
}

async function main() {
  const args = process.argv.slice(2);
  const only = (args.includes('--only') ? args[args.indexOf('--only') + 1] : '').split(',').map((s) => s.trim()).filter(Boolean);
  const dry = args.includes('--dry-run');
  const names = Object.keys(LEVELS).filter((n) => !only.length || only.includes(n));
  const backup = path.join(DIR, '_original'), recordFile = path.join(backup, '.mastered.json');
  // A mesterelt kimenet ujjlenyomata: ebből látszik, hogy a assets/audio-beli fájl még a mi kimenetünk-e, vagy újragenerált / kézzel cserélt (új eredeti).
  const record = (() => { try { return JSON.parse(fs.readFileSync(recordFile, 'utf8')) || {}; } catch (_) { return {}; } })();
  const sha = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  const jobs = [];
  for (const n of names) {
    const cur = path.join(DIR, n + '.mp3'), orig = path.join(backup, n + '.mp3');
    const hasCur = fs.existsSync(cur), hasOrig = fs.existsSync(orig);
    const fresh = hasCur && (record[n] ? sha(cur) !== record[n] : !hasOrig); // új fájl: újragenerált vagy kézzel cserélt (vagy még sosem mesterelt)
    const src = fresh ? cur : (hasOrig ? orig : (hasCur ? cur : null));
    if (!src) { console.log('KIHAGYVA  ' + n + ' (nincs fájl)'); continue; }
    jobs.push({ n, src, cur, orig, fresh });
  }
  if (!jobs.length) { console.log('Nincs feldolgozandó fájl.'); return; }
  const decoded = await decodeAll(jobs.map((j) => fs.readFileSync(j.src)));
  console.log('hang                  | előtte csúcs / hossz | utána csúcs / RMS / hossz | erősítés | méret');
  let skipped = 0;
  jobs.forEach((j, i) => {
    const d = decoded[i];
    if (d.error) { skipped++; console.log(j.n.padEnd(21) + ' | NEM DEKÓDOLHATÓ (' + d.error + '): sérült fájl, kihagyva'); return; }
    if (db(peakOf(d.samples)) < SILENT_DB) { skipped++; console.log(j.n.padEnd(21) + ' | HANGTALAN (csúcs ' + db(peakOf(d.samples)).toFixed(0) + ' dB): generáld újra, kihagyva'); return; }
    const r = processOne(j.n, d.samples, d.rate);
    const mp3 = encodeMp3(toInt16(r.mastered), d.rate);
    console.log(j.n.padEnd(21) + ' | ' + r.before.peakDb.toFixed(1).padStart(6) + ' dB / ' + r.before.sec.toFixed(2) + ' s | ' + r.after.peakDb.toFixed(1).padStart(6) + ' dB / ' + r.after.rmsDb.toFixed(1).padStart(6) + ' dB / ' + r.after.sec.toFixed(2) + ' s | ' + (r.gainDb >= 0 ? '+' : '') + r.gainDb.toFixed(1) + ' dB | ' + Math.round(mp3.length / 1024) + ' KB');
    if (!dry) {
      fs.mkdirSync(backup, { recursive: true });
      if (j.fresh || !fs.existsSync(j.orig)) fs.copyFileSync(j.cur, j.orig); // az új eredeti felváltja a régi mentést
      fs.writeFileSync(j.cur, mp3);
      record[j.n] = crypto.createHash('sha1').update(mp3).digest('hex');
    }
  });
  if (!dry && Object.keys(record).length) fs.writeFileSync(recordFile, JSON.stringify(record, null, 1) + '\n');
  console.log(dry ? '\nSzáraz futtatás: a fájlok nem módosultak.' : '\nKész. Az eredetik: ' + backup + (skipped ? ' (' + skipped + ' hangtalan / sérült fájl kihagyva)' : ''));
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { LEVELS, SILENT_DB, trim, fades, normalizeGain, peakOf, rmsOf, toInt16, encodeMp3, decodeAll, processOne, db, lin };
