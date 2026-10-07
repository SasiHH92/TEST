'use strict';

// ============================================================
// KAMU BÍRÓSÁG – biztonsági HTTP-fejlécek az egész oldalra
//
//   - Content-Security-Policy: csak a saját szkriptek futnak (script-src 'self', nincs inline szkript és eval), így egy esetleges
//     beszúrt HTML sem tud kódot futtatni; a stílus inline is lehet (a kliens sok helyen állít stílust), a betűtípus a Google Fontsról jön;
//     a képek a saját oldalról és data:/blob: címről; a kapcsolat (fetch / socket.io) a saját oldalra.
//   - frame-ancestors 'none' + X-Frame-Options: az oldal nem ágyazható be másik oldalba (clickjacking ellen).
//   - X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy (nincs kamera / mikrofon / helymeghatározás / fizetés).
//   - Strict-Transport-Security: csak HTTPS-en (Render proxy mögött is), fél évre; aldomain-ekre nem terjed ki.
// ============================================================

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  // a socket.io websocketje (ws/wss) a saját oldalra megy; a régebbi Safari a 'self'-et nem terjeszti ki rá, ezért a séma is szerepel
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';

function securityHeaders() {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', PERMISSIONS);
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}

module.exports = { securityHeaders, CSP, PERMISSIONS };
