'use strict';

// ============================================================
// KAMU BÍRÓSÁG – legendás kártya igénylése (egyszer használható link)
// A kód egy HMAC a legenda nevéből és egy titokból (LEGEND_SECRET, csak a szerveren és a link-generáló szkript
// futtatásakor van meg). Nincs tárolt kód: a szerver újraszámolja és összeveti. Egy legendát egyszer lehet igényelni:
// az igénylés a legenda nevén létrehoz egy fiókot, utána a név foglalt (más nem regisztrálhatja).
// ============================================================

const crypto = require('crypto');

const CODE_LENGTH = 22;

// A titokból és a (pontos) legenda-névből számolt kód. Üres titokkal nincs igénylés.
function legendCode(secret, name) {
  if (!secret || typeof secret !== 'string') return '';
  return crypto.createHmac('sha256', secret).update('legend:' + String(name)).digest('base64url').slice(0, CODE_LENGTH);
}

// Érvényes-e a kód ehhez a névhez (időzítés-biztos összehasonlítás).
function verifyLegendCode(secret, name, code) {
  const expected = legendCode(secret, name);
  if (!expected || typeof code !== 'string' || code.length !== CODE_LENGTH) return false;
  const a = Buffer.from(expected), b = Buffer.from(code);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { legendCode, verifyLegendCode, CODE_LENGTH };
