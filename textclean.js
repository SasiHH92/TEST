'use strict';

// ============================================================
// KAMU BÍRÓSÁG – üzenetek tisztítása (szobai csevegő, közös tér, privát üzenetek)
// ============================================================

// Tiltott karakterek: vezérlőkarakterek, zéró-szélességű és irány-átíró (bidi) jelek, sor-elválasztók.
// (A tartományokat futásidőben építjük, így a forrásfájlban nincs kódolási csapda.)
const BAD = new RegExp('[' + [[0, 31], [127, 127], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]]
  .map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']+', 'g');

// Egy sorba rendezett, tiltott karakterektől mentes, legfeljebb `max` hosszú szöveg (üres, ha nincs mit megtartani).
function cleanText(value, max) {
  return String(value == null ? '' : value).replace(BAD, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = { cleanText };
