'use strict';

// Indítás előtt lefut (npm start): ha van DATABASE_URL, az adatbázisból visszaírja
// a fiókokat, a statisztikát és az avatárokat a helyi fájlokba.
// Ha az adatbázis nem érhető el, NEM indítjuk el a játékot üres adattal, különben
// az első mentés felülírná az adatbázis tartalmát. Hibakóddal kilépünk, a Render újrapróbálja.

const { storage } = require('./storage');

async function main() {
  if (!storage.enabled()) {
    console.log('[hydrate] DATABASE_URL nincs megadva: az adatok csak helyi fájlokban élnek (újraindításkor elveszhetnek a Renderen).');
    return;
  }
  const attempts = 5;
  for (let i = 1; i <= attempts; i++) {
    try {
      const out = await storage.hydrate();
      console.log('[hydrate] adatbázis rendben:', JSON.stringify(out.result));
      await storage.close();
      return;
    } catch (e) {
      console.error('[hydrate] ' + i + '/' + attempts + ' sikertelen:', e.message);
      if (i === attempts) {
        console.error('[hydrate] Az adatbázis nem érhető el, a játék nem indul el (adatvesztés elkerülése).');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

main();
