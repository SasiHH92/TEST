'use strict';

// Visszaállítás az adatbázison belüli pillanatképből (kb_backup).
//   $env:DATABASE_URL = '<a Neon kapcsolati sztring>'
//   node scripts/db-restore.js                 → felsorolja a mentéseket
//   node scripts/db-restore.js <mentés-azonosító> --apply   → visszaállítja (előtte biztonsági mentés készül a mostani állapotról)
//
// FONTOS: előbb állítsd le a játékot (Render → Suspend), mert a futó szerver a saját memóriájából mentene vissza,
// és felülírná a visszaállított adatot. A visszaállítás után indítsd újra (Resume).

const { createStorage } = require('../storage');

async function main() {
  const storage = createStorage();
  if (!storage.enabled()) {
    console.error('Hiányzik a DATABASE_URL környezeti változó.');
    process.exit(1);
  }
  const id = process.argv[2];
  const apply = process.argv.includes('--apply');
  try {
    const list = await storage.listBackups();
    if (!id || id.startsWith('--')) {
      if (!list.length) console.log('Még nincs mentés.');
      for (const b of list) console.log(b.id + '   ' + b.takenAt + '   ' + Math.round((b.bytes || 0) / 1024) + ' KB');
      console.log('\nVisszaállítás: node scripts/db-restore.js <azonosító> --apply');
      return;
    }
    if (!list.some((b) => b.id === id)) throw new Error('Nincs ilyen mentés: ' + id);
    if (!apply) {
      console.log('Ez visszaállítaná a(z) ' + id + ' mentést. Futtasd újra --apply kapcsolóval, ha biztos vagy benne (a játék legyen leállítva).');
      return;
    }
    const result = await storage.restoreBackup(id);
    console.log('Visszaállítva: ' + result.restored.join(', ') + '. A korábbi állapot "prerestore" mentésként megmaradt.');
  } finally {
    await storage.close();
  }
}

main().catch((e) => { console.error('Hiba:', e.message); process.exit(1); });
