'use strict';

// Tartós tárolás (storage.js): fájl -> adatbázis -> új, üres lemez körforgás.
// A Postgres helyett pg-mem emulátort használ, így semmilyen külső szolgáltatás nem kell.
// Futtatás: npm run test:storage

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { newDb } = require('pg-mem');
const { createStorage, BACKUP_KEEP } = require('../storage');

const quiet = { error() {}, log() {} };
let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS: ' + name); }
  catch (e) { console.error('FAIL: ' + name + '\n  ' + (e && e.stack || e)); process.exitCode = 1; }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function tmpFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-storage-'));
  return { dir, files: { stats: path.join(dir, 'stats.json'), avatars: path.join(dir, 'avatars.json'), accounts: path.join(dir, 'sub', 'accounts.json') } };
}
function memPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

(async () => {
  await check('DATABASE_URL nélkül kikapcsolt, a hydrate nem csinál semmit', async () => {
    const s = createStorage({ url: '', files: tmpFiles().files, log: quiet });
    assert.equal(s.enabled(), false);
    assert.deepEqual(await s.hydrate(), { enabled: false });
    s.push('stats'); // nem dob hibát
  });

  const pool = memPool();
  const A = tmpFiles();

  await check('első indítás: a meglévő helyi fájl bekerül az adatbázisba, a hiányzó üres marad', async () => {
    fs.writeFileSync(A.files.stats, JSON.stringify({ Alexhh: { vadlott: 1, bunos: 1, artatlan: 0, dijak: 0 } }));
    const s = createStorage({ pool, files: A.files, log: quiet, delayMs: 10 });
    const out = await s.hydrate();
    assert.equal(out.enabled, true);
    assert.equal(out.result.stats, 'helyi fájl felvive');
    assert.equal(out.result.accounts, 'üres');
    const rows = (await pool.query("SELECT value FROM kb_store WHERE name = 'stats'")).rows;
    assert.equal(rows[0].value.Alexhh.bunos, 1);
  });

  await check('mentés után a változás feltöltődik (push + flush)', async () => {
    const s = createStorage({ pool, files: A.files, log: quiet, delayMs: 10 });
    fs.writeFileSync(A.files.avatars, JSON.stringify({ Izsván: 'av07' }));
    fs.mkdirSync(path.dirname(A.files.accounts), { recursive: true });
    fs.writeFileSync(A.files.accounts, JSON.stringify({ version: 1, users: [{ id: 'u1', username: 'teszt' }], sessions: [], resets: [] }));
    s.push('avatars');
    s.push('accounts');
    await s.flush();
    const get = async (n) => (await pool.query('SELECT value FROM kb_store WHERE name = $1', [n])).rows[0].value;
    assert.equal((await get('avatars')).Izsván, 'av07');
    assert.equal((await get('accounts')).users[0].username, 'teszt');
  });

  await check('újraindítás üres lemezzel: az adatok az adatbázisból visszajönnek', async () => {
    const B = tmpFiles(); // friss, üres "Render lemez"
    const s = createStorage({ pool, files: B.files, log: quiet });
    const out = await s.hydrate();
    assert.equal(out.result.stats, 'adatbázisból');
    assert.equal(JSON.parse(fs.readFileSync(B.files.stats, 'utf8')).Alexhh.bunos, 1);
    assert.equal(JSON.parse(fs.readFileSync(B.files.avatars, 'utf8')).Izsván, 'av07');
    assert.equal(JSON.parse(fs.readFileSync(B.files.accounts, 'utf8')).users[0].id, 'u1');
  });

  await check('az adatbázis tartalma elsőbbséget élvez az elavult helyi fájllal szemben', async () => {
    const C = tmpFiles();
    fs.writeFileSync(C.files.stats, JSON.stringify({ regi: true }));
    const s = createStorage({ pool, files: C.files, log: quiet });
    await s.hydrate();
    assert.ok(JSON.parse(fs.readFileSync(C.files.stats, 'utf8')).Alexhh);
  });

  await check('sérült helyi fájlt nem tölt fel az adatbázisba', async () => {
    const s = createStorage({ pool, files: A.files, log: quiet, delayMs: 10 });
    fs.writeFileSync(A.files.stats, '{nem json');
    s.push('stats');
    await s.flush();
    await wait(30);
    const v = (await pool.query("SELECT value FROM kb_store WHERE name = 'stats'")).rows[0].value;
    assert.equal(v.Alexhh.bunos, 1);
  });

  await check('adatbázis-hiba nem dönti le a folyamatot (push hibája naplózódik)', async () => {
    const broken = { query: async () => { throw new Error('nincs kapcsolat'); }, end: async () => {} };
    const s = createStorage({ pool: broken, files: A.files, log: quiet, delayMs: 5 });
    fs.writeFileSync(A.files.stats, JSON.stringify({ ok: 1 }));
    s.push('stats');
    await s.flush(); // nem dob
  });

  await check('hydrate hibája kivételt dob (a hydrate.js ilyenkor nem indítja el a játékot)', async () => {
    const broken = { query: async () => { throw new Error('nincs kapcsolat'); }, end: async () => {} };
    const s = createStorage({ pool: broken, files: tmpFiles().files, log: quiet });
    await assert.rejects(() => s.hydrate(), /nincs kapcsolat/);
  });

  // ---------- rendszeres mentés (pillanatképek) ----------
  const bpool = memPool();
  const BF = tmpFiles();
  const bstore = createStorage({ pool: bpool, files: BF.files, log: quiet, delayMs: 5 });
  const getDocs = async (id) => (await bpool.query('SELECT docs FROM kb_backup WHERE id = $1', [id])).rows[0].docs;

  await check('mentés: üres adatbázisról nem készül, egyébként minden dokumentumot tartalmaz (a hibanaplót nem)', async () => {
    assert.equal(await bstore.backupNow('a'), null, 'üres adatbázis');
    assert.deepEqual(await bstore.listBackups(), []);
    fs.writeFileSync(BF.files.stats, JSON.stringify({ Anna: { bunos: 2 } }));
    fs.mkdirSync(path.dirname(BF.files.accounts), { recursive: true });
    fs.writeFileSync(BF.files.accounts, JSON.stringify({ version: 1, users: [{ id: 'u1' }], sessions: [], resets: [] }));
    await bstore.hydrate(); // a helyi fájlok felkerülnek a kb_store-ba
    await bpool.query("INSERT INTO kb_store (name, value, updated_at) VALUES ('errors', '{\"version\":1,\"entries\":[]}'::jsonb, now())");
    const made = await bstore.backupNow('proba');
    assert.match(made.id, /^\d{8}-\d{6}-proba$/);
    assert.ok(made.docs.includes('stats') && made.docs.includes('accounts'));
    assert.ok(!made.docs.includes('errors'), 'a hibanapló nem része');
    const docs = await getDocs(made.id);
    assert.equal(docs.stats.Anna.bunos, 2); assert.equal(docs.accounts.users[0].id, 'u1');
    const list = await bstore.listBackups();
    assert.equal(list.length, 1); assert.equal(list[0].id, made.id); assert.ok(list[0].bytes > 10);
  });

  await check('napi ütemezés: friss mentés mellett nem készül újabb, egy nap múlva igen', async () => {
    assert.equal(await bstore.backupIfDue(), null, 'friss van');
    const created = await bstore.backupIfDue(Date.now() + 25 * 60 * 60 * 1000);
    assert.ok(created && /-auto$/.test(created.id), 'esedékes');
  });

  let probaId = '';
  await check('visszaállítás: a mentés tartalma visszakerül, előtte biztonsági mentés készül a mostani állapotról', async () => {
    probaId = (await bstore.listBackups()).find((x) => x.id.endsWith('-proba')).id;
    await bpool.query("UPDATE kb_store SET value = '{\"Anna\":{\"bunos\":99}}'::jsonb WHERE name = 'stats'"); // elromlott adat
    const out = await bstore.restoreBackup(probaId);
    assert.ok(out.restored.includes('stats') && out.restored.includes('accounts') && !out.restored.includes('errors'));
    const stats = (await bpool.query("SELECT value FROM kb_store WHERE name = 'stats'")).rows[0].value;
    assert.equal(stats.Anna.bunos, 2, 'az eredeti adat áll vissza');
    const pre = (await bstore.listBackups()).find((x) => /prerestore$/.test(x.id));
    assert.ok(pre, 'biztonsági mentés előtte');
    assert.equal((await getDocs(pre.id)).stats.Anna.bunos, 99, 'a biztonsági mentés a visszaállítás ELŐTTI állapotot őrzi');
    await assert.rejects(() => bstore.restoreBackup('nincs-ilyen'), /Nincs ilyen mentés/);
  });

  await check('csak a legutóbbi BACKUP_KEEP mentés marad meg', async () => {
    for (const label of 'bcdefghijklmnopq') await bstore.backupNow(label);
    assert.equal((await bstore.listBackups()).length, BACKUP_KEEP);
  });

  await check('az ütemező hibája a hibakezelőhöz megy, nem dönti le a folyamatot; adatbázis nélkül nem indul', async () => {
    const broken = { query: async () => { throw new Error('nincs kapcsolat'); }, end: async () => {} };
    const failing = createStorage({ pool: broken, files: tmpFiles().files, log: quiet });
    const seen = [];
    const stop = failing.scheduleBackups((e) => seen.push(e.message), 1000000, 5);
    await wait(60);
    stop();
    assert.deepEqual(seen, ['nincs kapcsolat']);
    const off = createStorage({ url: '', files: tmpFiles().files, log: quiet });
    assert.equal(typeof off.scheduleBackups(() => {}), 'function');
    assert.equal(await off.backupNow(), null); assert.deepEqual(await off.listBackups(), []);
    await assert.rejects(() => off.restoreBackup('x'), /Nincs adatbázis/);
  });

  await check('a végleg sikertelen mentés a hibanaplónak is jelentődik (setErrorHook)', async () => {
    const broken = { query: async () => { throw new Error('leállt az adatbázis'); }, end: async () => {} };
    const s = createStorage({ pool: broken, files: A.files, log: quiet, delayMs: 5 });
    const seen = [];
    s.setErrorHook((e, name) => seen.push(name + ':' + e.message));
    fs.writeFileSync(A.files.stats, JSON.stringify({ ok: 2 }));
    s.push('stats');
    await s.flush();
    assert.ok(seen.some((x) => x === 'stats:leállt az adatbázis'), seen.join('|'));
  });

  console.log('\n' + passed + ' tárolási ellenőrzés sikeres.' + (process.exitCode ? ' (VAN HIBÁS)' : ''));
})();
