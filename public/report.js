'use strict';

// Böngészős hibák jelentése az üzemeltetőnek (/admin → Hibák). Oldalbetöltésenként legfeljebb 3 jelentés,
// azonos üzenet csak egyszer; csak az üzenet, a fájl neve és a sor megy el – se szöveg, se jelszó, se név.
(function () {
  const sent = new Set();
  function report(message, src, line) {
    try {
      const text = String(message || '').slice(0, 200);
      if (!text || sent.size >= 3 || sent.has(text)) return;
      sent.add(text);
      fetch('/api/client-error', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, src: String(src || '').slice(0, 120), line: line || 0 })
      }).catch(() => {});
    } catch (_) { /* a jelentés hibája nem okozhat újabb hibát */ }
  }
  window.addEventListener('error', (ev) => {
    if (ev.target && ev.target !== window) return; // képek / szkriptek betöltési hibái nem érdekesek
    report(ev.message, ev.filename, ev.lineno);
  });
  // A tartalom-biztonsági szabály (CSP) megsértése: valami betöltődne, amit nem engedünk – ez hiba vagy támadási kísérlet.
  // Csak a direktíva és a tiltott cím eleje megy el (lekérdezés-paraméter nélkül).
  document.addEventListener('securitypolicyviolation', (ev) => {
    report('CSP: ' + ev.violatedDirective + ' – ' + String(ev.blockedURI || '').replace(/[?#].*$/, '').slice(0, 80), ev.sourceFile, ev.lineNumber);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    report('Elkapatlan ígéret: ' + (r && r.message ? r.message : r), '', 0);
  });
})();
