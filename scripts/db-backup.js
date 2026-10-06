'use strict';

// Az adatbázis (kb_store) teljes tartalmának letöltése egyetlen JSON-fájlba – saját, helyi másolatnak.
//   $env:DATABASE_URL = '<a Neon kapcsolati sztring>'; node scripts/db-backup.js [kimeneti-fájl]
// A fájl jelszó-hash-eket és privát üzeneteket is tartalmaz: ne oszd meg, ne töltsd fel a repóba (a backups/ mappa .gitignore-ban van).
// A szerver `/admin` oldala és a napi automatikus mentés az adatbázison BELÜL készít pillanatképet; ez a script ezen kívüli másolat.

const fs = require('fs');
const path = require('path');
const { createStorage } = require('../storage');

async function main() {
  const storage = createStorage();
  if (!storage.enabled()) {
    console.error('Hiányzik a DATABASE_URL környezeti változó.');
    process.exit(1);
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  try {
    const rows = (await pool.query('SELECT name, value, updated_at FROM kb_store ORDER BY name')).rows;
    const out = { exportedAt: new Date().toISOString(), docs: {} };
    for (const r of rows) out.docs[r.name] = { updatedAt: r.updated_at, value: r.value };
    const stamp = out.exportedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const target = path.resolve(process.argv[2] || path.join('backups', 'kb-' + stamp + '.json'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
    console.log('Mentve: ' + target + ' (' + rows.length + ' dokumentum: ' + rows.map((r) => r.name).join(', ') + ')');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('A mentés nem sikerült:', e.message); process.exit(1); });
