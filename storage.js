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
    accounts: path.resolve(ROOT, env.AUTH_STORE_PATH || 'data/accounts.json'),
    dms: path.resolve(ROOT, env.KB_DMS_FILE || 'data/dms.json'), // privát üzenetek a barátok között
    errors: path.resolve(ROOT, env.KB_ERRORS_FILE || 'data/errors.json'), // hibanapló (errorlog.js)
    moderation: path.resolve(ROOT, env.KB_MODERATION_FILE || 'data/moderation.json'), // jelentések és némítások (moderation.js)
    courts: path.resolve(ROOT, env.KB_COURTS_FILE || 'data/courts.json') // tárgyalások, Discord-kapcsolatok (courts.js)
  };
}

const BACKUP_KEEP = 14;                    // ennyi mentést őrzünk meg (a régebbiek törlődnek)
const BACKUP_EVERY_MS = 23 * 60 * 60 * 1000; // legfeljebb ilyen régi lehet a legutóbbi mentés
const BACKUP_SKIP = ['errors'];            // a hibanapló nem része a mentésnek

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

  // A végleg sikertelen mentéseket a hibanapló is megkapja (server.js köti be). A hibanapló hibája nem állíthat meg semmit.
  let errorHook = options.onError || null;
  const setErrorHook = (fn) => { errorHook = typeof fn === 'function' ? fn : null; };
  function report(e, name) {
    try { if (errorHook) errorHook(e, name); } catch (_) { /* */ }
  }

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
      }).catch((e) => {
        log.error('Adatbázis-mentés végleg sikertelen (' + name + '):', e.message);
        report(e, name);
      }).finally(() => inflight.delete(job));
      inflight.add(job);
    }, delayMs));
  }

  // Leállás előtt: a függő mentések azonnali elküldése.
  async function flush() {
    for (const [name, t] of Array.from(timers)) {
      clearTimeout(t);
      timers.delete(name);
      try { await pushNow(name); } catch (e) { log.error('Adatbázis-mentés sikertelen (' + name + '):', e.message); report(e, name); }
    }
    await Promise.allSettled(Array.from(inflight));
  }

  // ---------- rendszeres mentés (pillanatkép) ----------
  // A kb_store összes dokumentumáról (fiókok, statisztika, avatárok, privát üzenetek) egy-egy teljes pillanatkép
  // készül a kb_backup táblába; naponta legfeljebb egy automatikus, a legutóbbi BACKUP_KEEP marad meg.
  // A pillanatkép az adatbázis tartalmából készül (nem a szerver memóriájából), így független a futó állapottól.
  let backupReady = false;
  async function ensureBackupTable() {
    if (backupReady) return;
    await ensureTable();
    await getPool().query('CREATE TABLE IF NOT EXISTS kb_backup (id text PRIMARY KEY, taken_at timestamptz NOT NULL, bytes integer, docs jsonb NOT NULL)');
    backupReady = true;
  }

  async function listBackups() {
    if (!enabled()) return [];
    await ensureBackupTable();
    const res = await getPool().query('SELECT id, taken_at, bytes FROM kb_backup ORDER BY taken_at DESC');
    return res.rows.map((r) => ({ id: r.id, takenAt: new Date(r.taken_at).toISOString(), bytes: r.bytes }));
  }

  async function backupNow(label) {
    if (!enabled()) return null;
    await ensureBackupTable();
    const db = getPool();
    const rows = (await db.query('SELECT name, value FROM kb_store')).rows.filter((r) => !BACKUP_SKIP.includes(r.name));
    if (!rows.length) return null; // üres adatbázisról nem készül mentés
    const docs = {};
    for (const r of rows) docs[r.name] = r.value;
    const text = JSON.stringify(docs);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const id = stamp + (label ? '-' + String(label).replace(/[^a-z0-9]/gi, '').slice(0, 12) : '');
    await db.query('INSERT INTO kb_backup (id, taken_at, bytes, docs) VALUES ($1, now(), $2, $3::jsonb) ON CONFLICT (id) DO NOTHING', [id, text.length, text]);
    const all = await listBackups();
    for (const old of all.slice(BACKUP_KEEP)) await db.query('DELETE FROM kb_backup WHERE id = $1', [old.id]);
    return { id, bytes: text.length, docs: Object.keys(docs), kept: Math.min(all.length, BACKUP_KEEP) };
  }

  // Ha a legutóbbi mentés régebbi, mint BACKUP_EVERY_MS (vagy még nincs), újat készít.
  async function backupIfDue(nowMs = Date.now()) {
    if (!enabled()) return null;
    const latest = (await listBackups())[0];
    if (latest && nowMs - Date.parse(latest.takenAt) < BACKUP_EVERY_MS) return null;
    return backupNow('auto');
  }

  // Visszaállítás: a mentés dokumentumai felülírják a kb_store megfelelő sorait. Előtte biztonsági mentés készül
  // a mostani állapotról. FIGYELEM: a futó szerver a saját memóriájából mentene vissza, ezért csak leállított
  // játék mellett használd (lásd TAROLAS.md).
  async function restoreBackup(id) {
    if (!enabled()) throw new Error('Nincs adatbázis (DATABASE_URL).');
    await ensureBackupTable();
    const res = await getPool().query('SELECT docs FROM kb_backup WHERE id = $1', [id]);
    if (!res.rows.length) throw new Error('Nincs ilyen mentés: ' + id);
    const docs = res.rows[0].docs;
    await backupNow('prerestore');
    const restored = [];
    for (const [name, value] of Object.entries(docs)) {
      if (BACKUP_SKIP.includes(name)) continue;
      await upsert(name, JSON.stringify(value));
      restored.push(name);
    }
    return { restored };
  }

  // Háttérfeladat: indulás után és óránként ellenőrzi, kell-e új mentés. A hibát a `onError` kapja, a szerver fut tovább.
  function scheduleBackups(onError, intervalMs = 60 * 60 * 1000, firstDelayMs = 60 * 1000) {
    if (!enabled()) return () => {};
    const tick = () => backupIfDue().catch((e) => { log.error('Automatikus mentés sikertelen:', e.message); if (onError) onError(e); });
    const first = setTimeout(tick, firstDelayMs);
    const every = setInterval(tick, intervalMs);
    if (first.unref) first.unref();
    if (every.unref) every.unref();
    return () => { clearTimeout(first); clearInterval(every); };
  }

  async function close() {
    if (pool && pool.end) await pool.end();
    pool = null;
    ready = false;
    backupReady = false;
  }

  return { enabled, hydrate, push, flush, close, files, setErrorHook, listBackups, backupNow, backupIfDue, restoreBackup, scheduleBackups };
}

module.exports = { createStorage, storage: createStorage(), BACKUP_KEEP, BACKUP_EVERY_MS };
