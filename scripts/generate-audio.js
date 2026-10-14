'use strict';

// ============================================================
// KAMU BÍRÓSÁG – hangeffektek generálása az ElevenLabs Sound Effects API-val
//
// A játék a assets/audio/<hang-név>.mp3 fájlt automatikusan a szintetizált hang helyett játssza (lásd assets/audio/README.md és public/media.js).
// Ez a szkript a hiányzó hangokat legenerálja. A saját gépeden futtasd, a saját API-kulcsoddal (a kulcs csak környezeti változó, sehová nem íródik ki):
//
//   PowerShell:   $env:ELEVENLABS_API_KEY="..."; node scripts/generate-audio.js --dry-run       (csak a terv, nem költ kreditet)
//                 node scripts/generate-audio.js                                              (a hiányzó hangok legenerálása)
//                 node scripts/generate-audio.js --only gavel,victory --variants 3            (3 változat hangonként, a _candidates mappába)
//                 node scripts/generate-audio.js --use gavel=2                                (a 2. változat legyen az éles gavel.mp3)
//
// Kapcsolók: --only a,b   csak ezek      --force   a már meglévőt is újragenerálja     --variants N   hangonként N változat (1–4; N>1 esetén
//            assets/audio/_candidates/<név>-<i>.mp3, és az 1. változat kerül az éles helyre, ha még nincs)     --dry-run   nem hív API-t
// Költség: kb. 15–50 kredit / hang (a hang hosszától függ); a teljes készlet 1 változattal pár cent.
// ============================================================

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..', process.env.KB_AUDIO_DIR || 'assets/audio');
const API = String(process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io').replace(/\/+$/, '');

// hang-név -> [prompt, hossz másodpercben, prompt-befolyás]. A promptok rövidek, konkrét hangot neveznek meg (az ElevenLabs útmutatója szerint).
// A hangnevek a public/media.js CATEGORIES listájából jönnek (+ a két csevegő-hangjelzés).
const SOUNDS = {
  'ui-click': ['Soft dry wooden button click, short crisp tick', 0.5, 0.5],
  'ready': ['Bright short two-note chime, light and clean notification', 0.8, 0.5],
  'join': ['Soft double bell chime, gentle two quick notes', 1.0, 0.5],
  'card-hover': ['Very quiet paper rustle, tiny card brush on felt', 0.5, 0.5],
  'card-select': ['Soft card tap on a felt table, gentle click', 0.5, 0.5],
  'card-open': ['Deck of playing cards fanned open, quick paper riffle', 1.0, 0.5],
  'card-new': ['Single playing card sliding onto a table, soft paper slide', 0.8, 0.5],
  'card-play': ['Playing card swished through the air and landing with a soft thud', 0.8, 0.5],
  'paper': ['Paper documents rustling on a desk, folder shuffle', 1.0, 0.5],
  'evidence': ['Manila folder slapped onto a wooden table, firm flat smack', 1.0, 0.5],
  'challenge': ['Heavy rubber stamp slammed down on a stack of papers, loud thump and slap', 0.8, 0.5],
  'challenge-success': ['Bright ascending glockenspiel bell arpeggio, triumphant sparkle', 1.5, 0.5],
  'challenge-fail': ['Low dull thud followed by a descending sad trombone wah-wah, comedic fail', 1.5, 0.5],
  'reaction': ['Short bubbly pop, single cartoon bubble pop', 0.5, 0.5],
  'objection': ['Short punchy brass stab, loud trumpet accent', 1.5, 0.5],
  'vote': ['Wooden ballot dropped into a box, soft knock', 0.5, 0.5],
  'stinger': ['Short brass fanfare sting with a rising whoosh, game show transition', 1.5, 0.5],
  'reveal': ['Deep rumbling boom followed by a rising major chord swell, dramatic reveal', 2.5, 0.5],
  'intro': ['Tense low horns slowly building, short suspense buildup', 2.5, 0.5],
  'intro-open': ['Short triumphant trumpet fanfare, game show opening', 2.0, 0.5],
  'countdown': ['Single crisp mechanical clock tick', 0.5, 0.6],
  'ding': ['Single clear small service bell ding', 1.0, 0.5],
  'gavel': ["A wooden judge's gavel striking a sound block twice in quick succession, deep hollow wooden knocks, dry acoustics, no reverb tail", 1.0, 0.5],
  'verdict-guilty': ['Somber descending minor brass chord with a heavy low drum hit, ominous', 2.5, 0.5],
  'verdict-acquitted': ['Bright rising major chord with sparkling chimes, joyful relief', 2.5, 0.5],
  'points': ['Quick bright coin jingle, a few coins clinking', 0.8, 0.5],
  'score': ['Short two-coin chime, small cash register ding', 0.8, 0.5],
  'victory': ['Triumphant orchestral fanfare followed by cheering crowd applause', 5.0, 0.5],
  'chat': ['Soft subtle message pop notification, gentle bubble', 0.6, 0.5],
  'dm': ['Gentle two-tone message notification chime, soft and friendly', 0.8, 0.5]
};

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(key, name, variantNo) {
  const [prompt, duration, influence] = SOUNDS[name];
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(API + '/v1/sound-generation?output_format=mp3_44100_128', {
        method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: prompt, duration_seconds: duration, prompt_influence: influence, model_id: 'eleven_text_to_sound_v2' }),
        signal: AbortSignal.timeout(90000)
      });
    } catch (e) { if (attempt === 3) throw new Error('hálózati hiba: ' + e.message); await sleep(1500 * attempt); continue; }
    if (res.status === 429 || res.status >= 500) { if (attempt === 3) throw new Error('HTTP ' + res.status + ' (túl sok kérés / szolgáltatói hiba)'); await sleep(2000 * attempt); continue; }
    if (!res.ok) {
      let detail = ''; try { detail = String((await res.text()) || '').replace(/\s+/g, ' ').slice(0, 200); } catch (_) { /* nincs törzs */ }
      throw new Error('HTTP ' + res.status + (detail ? ': ' + detail.split(key).join('***') : ''));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) throw new Error('a válasz túl kicsi (' + buf.length + ' bájt), nem hangfájl');
    return buf;
  }
  throw new Error('ismeretlen hiba (' + variantNo + '. változat)');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // --use név=N: a kiválasztott változat az éles hang (nincs API-hívás)
  const use = opt('--use', '');
  if (use) {
    const m = /^([a-z0-9-]+)=(\d)$/.exec(use);
    if (!m || !SOUNDS[m[1]]) { console.error('Használat: --use hangnév=változat (pl. --use gavel=2)'); process.exit(1); }
    const src = path.join(OUT_DIR, '_candidates', m[1] + '-' + m[2] + '.mp3');
    if (!fs.existsSync(src)) { console.error('Nincs ilyen változat: ' + src); process.exit(1); }
    fs.copyFileSync(src, path.join(OUT_DIR, m[1] + '.mp3'));
    console.log('Kész: ' + m[1] + '.mp3 <- ' + m[2] + '. változat');
    return;
  }

  const only = (opt('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of only) if (!SOUNDS[n]) { console.error('Ismeretlen hangnév: ' + n + '. Lehetséges: ' + Object.keys(SOUNDS).join(', ')); process.exit(1); }
  const variants = Math.max(1, Math.min(4, parseInt(opt('--variants', '1'), 10) || 1));
  const force = flag('--force');
  const names = (only.length ? only : Object.keys(SOUNDS));
  const existing = (n) => ['mp3', 'ogg', 'm4a', 'wav'].some((e) => fs.existsSync(path.join(OUT_DIR, n + '.' + e)));
  const todo = names.filter((n) => force || variants > 1 || !existing(n));

  console.log('Terv: ' + todo.length + ' hang × ' + variants + ' változat = ' + todo.length * variants + ' generálás (' + (names.length - todo.length) + ' már megvan, kihagyva).');
  if (flag('--dry-run')) { for (const n of todo) console.log('  ' + n + '  (' + SOUNDS[n][1] + ' mp)  ' + SOUNDS[n][0]); console.log('Száraz futtatás: nem hívtam az API-t.'); return; }
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) { console.error('Hiányzik az ELEVENLABS_API_KEY környezeti változó. (Ne írd be a parancsba / a tárolóba; csak a saját terminálodban állítsd be.)'); process.exit(1); }

  let ok = 0, failed = 0;
  for (const name of todo) {
    for (let v = 1; v <= variants; v++) {
      try {
        const buf = await generate(key, name, v);
        if (variants > 1) {
          fs.mkdirSync(path.join(OUT_DIR, '_candidates'), { recursive: true });
          fs.writeFileSync(path.join(OUT_DIR, '_candidates', name + '-' + v + '.mp3'), buf);
          if (v === 1 && (force || !existing(name))) fs.writeFileSync(path.join(OUT_DIR, name + '.mp3'), buf);
        } else fs.writeFileSync(path.join(OUT_DIR, name + '.mp3'), buf);
        ok++; console.log('OK    ' + name + (variants > 1 ? ' #' + v : '') + '  (' + Math.round(buf.length / 1024) + ' KB)');
      } catch (e) { failed++; console.error('HIBA  ' + name + (variants > 1 ? ' #' + v : '') + ': ' + e.message); }
      await sleep(300);
    }
  }
  console.log('\nKész: ' + ok + ' sikeres, ' + failed + ' hibás.' + (variants > 1 ? ' A változatok: ' + path.join(OUT_DIR, '_candidates') + ' (kiválasztás: --use hangnév=sorszám).' : ''));
  process.exit(failed ? 1 : 0);
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { SOUNDS };
