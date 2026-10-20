'use strict';
// ============================================================
// KAMU BÍRÓSÁG – böngészős "hibák", amik nem a játékból jönnek (nincs mit javítani rajtuk), ezért nem kerülnek a hibanaplóba
// (POST /api/client-error, public/report.js):
//  - "Script error." fájl és sor nélkül: egy MÁS eredetű, beszúrt szkript hibája, a böngésző elrejti a részleteit
//    (a játék minden szkriptje saját címről jön, ezeknél mindig van fájl és sor) – pl. az alkalmazásbeli böngészők (Messenger, Instagram) vagy bővítmények
//  - CSP-sértés, amit a játékos gépén futó program okoz: a víruskereső (Kaspersky) vagy egy böngésző-bővítmény beszúrt stílusa / szkriptje,
//    vagy egy helyi (localhost) cím – a CSP ezeket helyesen letiltja
//  - hiba egy böngésző-bővítmény fájljából
// Minden más (a játék saját hibái és a többi CSP-sértés) továbbra is bekerül.
// ============================================================
const EXT = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i;
const INJECTED = /kaspersky-labs\.com|(chrome|moz|safari|safari-web|ms-browser)-extension:|\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/\s]|$)/i;

function isClientNoise(message, src) {
  const m = String(message || '').trim(), s = String(src || '').trim();
  if (/^(uncaught )?script error\.?$/i.test(m) && !s) return true;
  if (/^CSP: /.test(m) && INJECTED.test(m)) return true;
  if (EXT.test(s)) return true;
  return false;
}

module.exports = { isClientNoise };
