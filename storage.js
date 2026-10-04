'use strict';

// ============================================================
// KAMU BÍRÓSÁG – tartós tárolás külső (ingyenes) Postgres adatbázisban
//
// A Render ingyenes csomagján a fájlrendszer ideiglenes, ezért a fiókok,
// a statisztika és az avatárok minden újraindításkor elvesznének.
// Ha a DATABASE_URL be van állítva:
//   - indításkor (hydrate.js) az adatbázisból visszaíródnak a helyi fájlok,
//   - minden mentés után a fájl tartalma feltöltődik az adatbázisba (push).
// DATABASE_URL nélkül (helyi fejlesztés, tesztek) semmi nem változik: csak fájlok.
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function defaultFiles(env) {
  return {
    stats: path.join(ROOT, 'data', 'stats.json'),
    avatars: path.join(ROOT, 'data', 'avatars.json'),
    accounts: path.resolve(ROOT, env.AUTH_STORE_PATH || 'data/accounts.json')
  };
}

function createStorage(options = {}) {
  const env = options.env || process.env;
  const url = options.url !== undefined ? options.url : (env.DATABASE_URL || '');
  const files = options.files || defaultFiles(env);
  const log = options.log || console;
  const delayMs = options.delayMs !== undefined ? options.delayMs : 500;
  let pool = options.pool || null;
  let ready = false;
  const timers = new Map();   // név -> debounce időzítő
  const inflight = new Set(); // futó feltöltések

  const enabled = () => !!(pool || url);

  function getPool() {
    if (pool) return pool;
    if (!url) return null;
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
    pool.on('error', (e) => log.error('Adatbázis-kapcsolati hiba:', e.message));
    return pool;
  }

  async function ensureTable() {
    if (ready) return;
    const db = getPool();
    try {
      await db.query('SELECT 1 FROM kb_store LIMIT 1');
    } catch (e) {
      // Még nincs tábla (első indítás). Ha közben más folyamat létrehozta, az sem hiba.
      try {
        await db.query('CREATE TABLE kb_store (name text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz)');
      } catch (e2) {
        await db.query('SELECT 1 FROM kb_store LIMIT 1');
      }
    }
    ready = true;
  }

  async function upsert(name, text) {
    await ensureTable();
    await getPool().query(
      'INSERT INTO kb_store (name, value, updated_at) VALUES ($1, $2::jsonb, now()) ' +
      'ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
      [name, text]
    );
  }

  function writeLocal(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  }

  // Indításkor: az adatbázis tartalma a helyi fájlokba. Ha az adatbázisban még nincs
  // ilyen adat, de van helyi fájl, azt felvisszük (első migráció).
  async function hydrate() {
    if (!enabled()) return { enabled: false };
    await ensureTable();
    const result = {};
    for (const [name, file] of Object.entries(files)) {
      const res = await getPool().query('SELECT value FROM kb_store WHERE name = $1', [name]);
      if (res.rows.length) {
        writeLocal(file, res.rows[0].value);
        result[name] = 'adatbázisból';
      } else if (fs.existsSync(file)) {
        await upsert(name, fs.readFileSync(file, 'utf8'));
        result[name] = 'helyi fájl felvive';
      } else {
        result[name] = 'üres';
      }
    }
    return { enabled: true, result };
  }

  async function pushNow(name) {
    const file = files[name];
    if (!file) return;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
    JSON.parse(text); // sérült fájlt nem töltünk fel
    await upsert(name, text);
  }

  // Mentés után hívjuk: kis késleltetéssel feltölti a fájlt. Hiba esetén egyszer újrapróbálja.
  function push(name) {
    if (!enabled() || !files[name]) return;
    clearTimeout(timers.get(name));
    timers.set(name, setTimeout(() => {
      timers.delete(name);
      const job = pushNow(name).catch(async (e) => {
        log.error('Adatbázis-mentés sikertelen (' + name + '), újrapróbálom:', e.message);
        await new Promise((r) => setTimeout(r, 4000));
        await pushNow(name);
      }).catch((e) => log.error('Adatbázis-mentés végleg sikertelen (' + name + '):', e.message))
        .finally(() => inflight.delete(job));
      inflight.add(job);
    }, delayMs));
  }

  // Leállás előtt: a függő mentések azonnali elküldése.
  async function flush() {
    for (const [name, t] of Array.from(timers)) {
      clearTimeout(t);
      timers.delete(name);
      try { await pushNow(name); } catch (e) { log.error('Adatbázis-mentés sikertelen (' + name + '):', e.message); }
    }
    await Promise.allSettled(Array.from(inflight));
  }

  async function close() {
    if (pool && pool.end) await pool.end();
    pool = null;
    ready = false;
  }

  return { enabled, hydrate, push, flush, close, files };
}

module.exports = { createStorage, storage: createStorage() };
