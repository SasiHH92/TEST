'use strict';

// ============================================================
// Igénylő-linkek a legendás tesztelőknek: minden tesztelőnek egy egyszer használható link.
// A link megnyitásakor a tesztelő a SAJÁT e-mail címével és jelszavával regisztrál, és a fiókja a legendás
// kártyájához kötődik (a név, a keret és a háttér az övé lesz, a statisztikája is megmarad).
//
// Használat (a titkot ugyanaz kell legyen, mint a tárhelyen a LEGEND_SECRET környezeti változó):
//   PowerShell:  $env:LEGEND_SECRET = '<a titok>'; node scripts/legend-links.js https://test-1-ndkt.onrender.com
//   bash:        LEGEND_SECRET='<a titok>' node scripts/legend-links.js https://test-1-ndkt.onrender.com
// A titkot ne oszd meg és ne commitold. A linkek csak azzal együtt érvényesek, amivel a szerver fut.
// ============================================================

const fs = require('fs');
const path = require('path');
const { legendCode } = require('../legend-claims');

const secret = process.env.LEGEND_SECRET || '';
const base = String(process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

if (!secret) {
  console.error('Hiányzik a LEGEND_SECRET környezeti változó.\nPélda (PowerShell): $env:LEGEND_SECRET = \'<a titok>\'; node scripts/legend-links.js ' + base);
  process.exit(1);
}
if (secret.length < 16) {
  console.error('A LEGEND_SECRET túl rövid (legalább 16 karakter kell, véletlenszerű legyen).');
  process.exit(1);
}

const players = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'players.json'), 'utf8')).players;
console.log('Igénylő-linkek (' + base + '), egy tesztelő = egy egyszer használható link:\n');
for (const p of players) {
  const link = base + '/?legend=' + encodeURIComponent(p.nev) + '&claim=' + legendCode(secret, p.nev);
  console.log(p.nev.padEnd(14) + ' ' + link);
}
console.log('\nA tesztelő megnyitja a linket, regisztrál (e-mail + jelszó), és a legendás kártya az övé lesz.');
