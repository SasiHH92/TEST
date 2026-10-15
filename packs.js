'use strict';

// ============================================================
// KAMU BÍRÓSÁG – közösségi kártyacsomagok ("Kártyaműhely")
//
// A bejelentkezett játékosok saját játékmódot (csomagot) készíthetnek: vádak, bizonyítékok, alibik, trükkök, tanúk, kihívások és büntetések.
// A csomag lehet NYILVÁNOS (a könyvtárban böngészhető) vagy PRIVÁT (csak a 6 jegyű kódot ismerők érik el). Bárki használhat bármilyen elérhető csomagot a saját tárgyalásában;
// a bejelentkezett játékos a számára kedveset a saját gyűjteményébe is mentheti (ott a lobbiban is mindig kéznél van).
//
// Védelem: csomag-limit fiókonként, hosszkorlátok, szigorú szövegellenőrzés (nincs HTML-jel, link, meghívó, @, ismeretlen [helyőrző]), írási sebességkorlát,
// jelentés gomb (3 különböző jelentő után a csomag elbújik a könyvtárból és kóddal sem elérhető, az üzemeltető törölheti vagy visszaállíthatja).
// A már futó szobák a csomag pillanatfelvételével játszanak, ezért egy későbbi szerkesztés / elrejtés / törlés nem szakítja meg a tárgyalást.
//
// Tárolás: data/packs.json (a moderációhoz hasonlóan fájlban él, és a külső adatbázisba is feltöltődik).
// Végpontok (/api/packs): GET /limits, /library, /mine, /:code · POST / · PUT /:code · DELETE /:code · POST|DELETE /:code/save · POST /:code/report
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleanText } = require('./textclean');

const DECKS = ['vadak', 'bizonyitekok', 'alibik', 'trukkok', 'tanuk', 'kihivasok', 'buntetesek'];
const LABELS = { vadak: 'Vádak', bizonyitekok: 'Bizonyítékok', alibik: 'Alibik', trukkok: 'Trükkök', tanuk: 'Tanúk', kihivasok: 'Kihívások', buntetesek: 'Büntetések' };
const MIN = { vadak: 6, bizonyitekok: 4, alibik: 3, trukkok: 3, tanuk: 3, kihivasok: 3, buntetesek: 3 };
const MAX = { vadak: 60, bizonyitekok: 40, alibik: 40, trukkok: 40, tanuk: 40, kihivasok: 40, buntetesek: 40 };
const NAME_MIN = 3, NAME_MAX = 40, DESC_MAX = 140, CARD_MIN = 4, CARD_MAX = 130;
const SAVED_MAX = 30;           // ennyi csomag lehet a gyűjteményben
const REPORTS_TO_HIDE = 3;      // ennyi különböző jelentő után a csomag elbújik
const WRITES_PER_HOUR = 30;     // fiókonként óránként legfeljebb ennyi írás (létrehozás, szerkesztés, mentés, jelentés…)
const SAVE_DELAY_MS = 1000;
const MISSES_PER_WINDOW = 30;  // egy cím ennyi sikertelen kód-keresést tehet 10 percen belül (a privát csomag kódjának találgatása ellen)
const MISS_WINDOW_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // nincs 0/O/1/I: diktálva sem téveszthető
const CODE_RE = /^[A-Z2-9]{6}$/;
const PLACEHOLDER_RE = /\[[^\]]*\]/g;
const URL_RE = /(https?:|www\.|discord\.gg|discord(?:app)?\.com\/invite|[a-z0-9-]{2,}\.(?:com|hu|net|org|gg|io|me|tv|xyz|ru|cn|ly)\b)/i;
const NAME_RE = /^[\p{L}\p{N} .,!?:;()+\-'’"&/#]+$/u;

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A beküldött csomag ellenőrzése és tisztítása. Visszatérés: { ok, errors: [szöveg…], value: { name, desc, visibility, decks } }
function cleanPackInput(input) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};
  const add = (msg) => { if (errors.length < 14) errors.push(msg); };

  const name = cleanText(src.name, 300);
  if (name.length < NAME_MIN) add('A csomag neve legalább ' + NAME_MIN + ' karakter legyen.');
  else if (name.length > NAME_MAX) add('A csomag neve legfeljebb ' + NAME_MAX + ' karakter lehet.');
  else if (!NAME_RE.test(name)) add('A csomag neve csak betűt, számot és egyszerű írásjeleket tartalmazhat.');
  else if (URL_RE.test(name)) add('A csomag neve nem tartalmazhat linket.');

  const desc = cleanText(src.desc, 600);
  if (desc.length > DESC_MAX) add('A leírás legfeljebb ' + DESC_MAX + ' karakter lehet.');
  else if (/[<>@]/.test(desc) || URL_RE.test(desc)) add('A leírás nem tartalmazhat linket, @ jelet vagy < > jelet.');

  const visibility = src.visibility === 'public' ? 'public' : 'private';

  const decks = {};
  const rawDecks = src.decks && typeof src.decks === 'object' ? src.decks : {};
  const seen = new Set();
  for (const deck of DECKS) {
    const raw = rawDecks[deck];
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split('\n') : []);
    const out = [];
    let hadLineError = false; // ha egy sor hibás, a "kevés kártya" üzenet felesleges (a hibás sor kiesik a számlálásból)
    const lineErr = (msg) => { hadLineError = true; add(msg); };
    list.slice(0, MAX[deck] + 50).forEach((item, i) => {
      const text = cleanText(item, 600);
      if (!text) return; // az üres sor nem számít
      const where = LABELS[deck] + ', ' + (i + 1) + '. sor: ';
      if (text.length < CARD_MIN) return lineErr(where + 'túl rövid (legalább ' + CARD_MIN + ' karakter).');
      if (text.length > CARD_MAX) return lineErr(where + 'túl hosszú (' + text.length + ' > ' + CARD_MAX + ' karakter).');
      if (/[<>]/.test(text)) return lineErr(where + 'nem tartalmazhat < vagy > jelet.');
      if (text.includes('@')) return lineErr(where + 'nem tartalmazhat @ jelet.');
      if (URL_RE.test(text)) return lineErr(where + 'nem tartalmazhat linket vagy meghívót.');
      if (!/\p{L}{2}/u.test(text)) return lineErr(where + 'értelmes szöveget írj.');
      if (/(.)\1{9,}/u.test(text)) return lineErr(where + 'túl sok ismétlődő karakter.');
      const marks = text.match(PLACEHOLDER_RE) || [];
      const stripped = text.replace(PLACEHOLDER_RE, '');
      if (/[[\]]/.test(stripped)) return lineErr(where + 'a szögletes zárójel csak [vádlott] vagy [játékos] helyőrző lehet.');
      if (marks.some((m) => m !== '[vádlott]' && m !== '[játékos]')) return lineErr(where + 'ismeretlen helyőrző (csak [vádlott] és [játékos] használható).');
      if (marks.length && deck !== 'vadak') return lineErr(where + 'helyőrző ([vádlott], [játékos]) csak a vádakban használható.');
      const key = norm(text);
      if (seen.has(key)) return lineErr(where + 'ez a kártya már szerepel a csomagban.');
      seen.add(key);
      out.push(text);
    });
    if (out.length > MAX[deck]) add(LABELS[deck] + ': legfeljebb ' + MAX[deck] + ' kártya lehet (most ' + out.length + ').');
    else if (out.length < MIN[deck] && !hadLineError) add(LABELS[deck] + ': legalább ' + MIN[deck] + ' kártya kell (most ' + out.length + ').');
    decks[deck] = out.slice(0, MAX[deck]);
  }
  return { ok: errors.length === 0, errors, value: { name, desc, visibility, decks } };
}

function createPacks({ file = null, persist = () => {}, now = () => Date.now(), perAccount = Number(process.env.PACKS_PER_ACCOUNT) || 5 } = {}) {
  let data = { version: 1, packs: {}, saved: {} };
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.version === 1 && parsed.packs && typeof parsed.packs === 'object') data = { saved: {}, ...parsed };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('A csomag-fájl nem olvasható, üresen indul:', e.message);
    }
  }
  let timer = null;
  const misses = new Map(); // cím -> sikertelen kód-keresések időbélyegei

  function saveNow() {
    clearTimeout(timer); timer = null;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    try { persist(file); } catch (_) { /* a külső mentés hibája nem állíthatja meg a csomagokat */ }
  }
  function save() {
    if (!file || timer) return;
    timer = setTimeout(() => { try { saveNow(); } catch (e) { console.error('A csomagok mentése sikertelen:', e.message); } }, SAVE_DELAY_MS);
    if (timer.unref) timer.unref();
  }

  const savedOf = (userId) => (userId && Array.isArray(data.saved[userId]) ? data.saved[userId] : []);
  const ownedBy = (userId) => Object.values(data.packs).filter((p) => p.ownerId === userId);
  function newCode() {
    for (let i = 0; i < 50; i++) {
      let c = ''; const bytes = crypto.randomBytes(6);
      for (let k = 0; k < 6; k++) c += CODE_ALPHABET[bytes[k] % CODE_ALPHABET.length];
      if (!data.packs[c]) return c;
    }
    return '';
  }
  function meta(p, user) {
    const counts = {}; let total = 0;
    for (const d of DECKS) { counts[d] = p.decks[d].length; total += counts[d]; }
    const uid = user && user.id;
    return { code: p.code, name: p.name, desc: p.desc, owner: p.ownerName, visibility: p.visibility, counts, total, saves: p.saves || 0, uses: p.uses || 0, updatedAt: p.updatedAt,
      mine: !!uid && p.ownerId === uid, saved: !!uid && savedOf(uid).includes(p.code), hidden: !!p.hidden };
  }
  // Elérhető-e: elrejtett csomagot csak a készítője lát; minden más (nyilvános és privát is) elérhető, aki ismeri a kódot.
  const visibleTo = (p, user) => !!p && (!p.hidden || (!!user && p.ownerId === user.id));
  const get = (code) => (CODE_RE.test(String(code || '').toUpperCase()) ? data.packs[String(code).toUpperCase()] || null : null);

  return {
    DECKS, LABELS, MIN, MAX, limits() { return { decks: DECKS.map((d) => ({ key: d, label: LABELS[d], min: MIN[d], max: MAX[d] })), name: [NAME_MIN, NAME_MAX], desc: DESC_MAX, card: [CARD_MIN, CARD_MAX], perAccount, savedMax: SAVED_MAX }; },
    cleanPackInput,

    create(user, input) {
      const check = cleanPackInput(input);
      if (!check.ok) return { ok: false, errors: check.errors };
      if (ownedBy(user.id).length >= perAccount) return { ok: false, errors: ['Legfeljebb ' + perAccount + ' saját csomagod lehet. Törölj egyet, mielőtt újat készítesz.'] };
      if (ownedBy(user.id).some((p) => norm(p.name) === norm(check.value.name))) return { ok: false, errors: ['Már van ilyen nevű csomagod.'] };
      const code = newCode();
      if (!code) return { ok: false, errors: ['Nem sikerült kódot generálni, próbáld újra.'] };
      const t = now();
      const pack = { code, ownerId: user.id, ownerName: String(user.username || '').slice(0, 40), ...check.value, createdAt: t, updatedAt: t, saves: 0, uses: 0, reporters: [], hidden: false, hiddenBy: '' };
      data.packs[code] = pack;
      save();
      return { ok: true, pack: { ...meta(pack, user), decks: pack.decks } };
    },
    update(user, code, input) {
      const p = get(code);
      if (!p || p.ownerId !== user.id) return { ok: false, status: 404, errors: ['Nincs ilyen saját csomagod.'] };
      const check = cleanPackInput(input);
      if (!check.ok) return { ok: false, errors: check.errors };
      if (ownedBy(user.id).some((o) => o.code !== p.code && norm(o.name) === norm(check.value.name))) return { ok: false, errors: ['Már van ilyen nevű csomagod.'] };
      Object.assign(p, check.value, { updatedAt: now(), ownerName: String(user.username || p.ownerName).slice(0, 40) });
      save();
      return { ok: true, pack: { ...meta(p, user), decks: p.decks } };
    },
    remove(user, code) {
      const p = get(code);
      if (!p || p.ownerId !== user.id) return false;
      this._delete(p.code);
      return true;
    },
    _delete(code) {
      delete data.packs[code];
      for (const [uid, list] of Object.entries(data.saved)) { const i = list.indexOf(code); if (i >= 0) list.splice(i, 1); if (!list.length) delete data.saved[uid]; }
      save();
    },
    // Egy csomag megtekintése (a kódot ismerők mind láthatják). null, ha nincs vagy el van rejtve előled.
    view(code, user) {
      const p = get(code);
      return visibleTo(p, user) ? { ...meta(p, user), decks: p.decks } : null;
    },
    // A nyilvános könyvtár: nem rejtett, nyilvános csomagok. q: névre / leírásra / készítőre; sort: 'new' | 'popular'.
    listPublic({ q = '', sort = 'new', limit = 30, offset = 0 } = {}, user = null) {
      const needle = norm(q);
      let list = Object.values(data.packs).filter((p) => p.visibility === 'public' && !p.hidden);
      if (needle) list = list.filter((p) => norm(p.name + ' ' + p.desc + ' ' + p.ownerName).includes(needle));
      list.sort(sort === 'popular' ? (a, b) => ((b.saves || 0) * 3 + (b.uses || 0)) - ((a.saves || 0) * 3 + (a.uses || 0)) || b.updatedAt - a.updatedAt : (a, b) => b.updatedAt - a.updatedAt);
      const lim = Math.max(1, Math.min(60, Number(limit) || 30)), off = Math.max(0, Number(offset) || 0);
      return { total: list.length, packs: list.slice(off, off + lim).map((p) => meta(p, user)) };
    },
    // A saját csomagok és a gyűjtemény (a mentett csomagok közül az elérhetők).
    mine(user) {
      const owned = ownedBy(user.id).sort((a, b) => b.updatedAt - a.updatedAt).map((p) => meta(p, user));
      const saved = savedOf(user.id).map((c) => data.packs[c]).filter((p) => p && p.ownerId !== user.id && !p.hidden).map((p) => meta(p, user));
      return { owned, saved };
    },
    save(user, code) {
      const p = get(code);
      if (!visibleTo(p, user)) return { ok: false, status: 404, error: 'Nincs ilyen csomag.' };
      if (p.ownerId === user.id) return { ok: false, error: 'A saját csomagod úgyis a gyűjteményedben van.' };
      const list = (data.saved[user.id] = savedOf(user.id));
      if (list.includes(p.code)) return { ok: true, already: true };
      if (list.length >= SAVED_MAX) return { ok: false, error: 'Legfeljebb ' + SAVED_MAX + ' csomag lehet a gyűjteményedben.' };
      list.push(p.code); p.saves = (p.saves || 0) + 1; save();
      return { ok: true };
    },
    unsave(user, code) {
      const list = savedOf(user.id), i = list.indexOf(String(code || '').toUpperCase());
      if (i < 0) return false;
      list.splice(i, 1); if (!list.length) delete data.saved[user.id];
      const p = get(code); if (p) p.saves = Math.max(0, (p.saves || 0) - 1);
      save();
      return true;
    },
    // Jelentés: egy fiók egyszer jelenthet egy csomagot (a sajátját nem). REPORTS_TO_HIDE különböző jelentő után a csomag elbújik.
    report(user, code) {
      const p = get(code);
      if (!visibleTo(p, user)) return { ok: false, status: 404, error: 'Nincs ilyen csomag.' };
      if (p.ownerId === user.id) return { ok: false, error: 'A saját csomagodat nem jelentheted.' };
      p.reporters = Array.isArray(p.reporters) ? p.reporters : [];
      if (p.reporters.includes(user.id)) return { ok: true, already: true, count: p.reporters.length, hidden: !!p.hidden };
      p.reporters.push(user.id);
      if (p.reporters.length >= REPORTS_TO_HIDE && !p.hidden) { p.hidden = true; p.hiddenBy = 'reports'; }
      save();
      return { ok: true, count: p.reporters.length, hidden: !!p.hidden };
    },
    // A szobába kerülő pillanatfelvétel a motor formátumában (nev + paklik). null, ha nincs / el van rejtve.
    modeFor(code, user) {
      const p = get(code);
      if (!p || p.hidden) return null; // elrejtett csomag senkinek (a készítőnek sem) nem használható, amíg az üzemeltető vissza nem állítja
      void user;
      const snap = { nev: p.name, owner: p.ownerName, code: p.code };
      for (const d of DECKS) snap[d] = p.decks[d].slice();
      return snap;
    },
    // Találgatás-védelem: a sikertelen kód-keresések (ismeretlen vagy elrejtett csomag) címenként korlátozottak.
    lookupAllowed(key) { const t = now(); const list = (misses.get(key) || []).filter((x) => t - x < MISS_WINDOW_MS); if (list.length) misses.set(key, list); else misses.delete(key); return list.length < MISSES_PER_WINDOW; },
    lookupMiss(key) { const t = now(); const list = (misses.get(key) || []).filter((x) => t - x < MISS_WINDOW_MS); list.push(t); misses.set(key, list); if (misses.size > 5000) misses.delete(misses.keys().next().value); },
    noteUse(code) { const p = get(code); if (p) { p.uses = (p.uses || 0) + 1; save(); } },

    // ---- fiók-életciklus ----
    renameByName(oldName, newName) { let n = 0; for (const p of Object.values(data.packs)) if (p.ownerName === oldName) { p.ownerName = String(newName || '').slice(0, 40); n++; } if (n) save(); return n; },
    renameOwner(userId, username) { let n = 0; for (const p of ownedBy(userId)) { p.ownerName = String(username || '').slice(0, 40); n++; } if (n) save(); return n; },
    removeOwner(userId) { const mine = ownedBy(userId).map((p) => p.code); for (const c of mine) this._delete(c); if (data.saved[userId]) { for (const c of data.saved[userId]) { const p = data.packs[c]; if (p) p.saves = Math.max(0, (p.saves || 0) - 1); } delete data.saved[userId]; save(); } return mine.length; },
    exportFor(userId) { return { owned: ownedBy(userId).map((p) => ({ code: p.code, name: p.name, desc: p.desc, visibility: p.visibility, decks: p.decks, createdAt: p.createdAt, updatedAt: p.updatedAt })), saved: savedOf(userId).slice() }; },

    // ---- üzemeltetői felület ----
    adminList() {
      return Object.values(data.packs).sort((a, b) => (b.reporters || []).length - (a.reporters || []).length || b.updatedAt - a.updatedAt).map((p) => ({
        ...meta(p, null), reports: (p.reporters || []).length, hiddenBy: p.hiddenBy || '', createdAt: p.createdAt,
        sample: DECKS.flatMap((d) => p.decks[d].slice(0, 1)).slice(0, 4) }));
    },
    adminHide(code) { const p = get(code); if (!p) return false; p.hidden = true; p.hiddenBy = 'admin'; save(); return true; },
    adminUnhide(code) { const p = get(code); if (!p) return false; p.hidden = false; p.hiddenBy = ''; p.reporters = []; save(); return true; },
    adminDelete(code) { const p = get(code); if (!p) return false; this._delete(p.code); return true; },
    count() { return Object.keys(data.packs).length; },
    flush: saveNow
  };
}

class PackError extends Error { constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; } }
const fail = (status, message, errors) => { throw new PackError(status, message, errors); };

function createPacksApi({ packs, auth, onError = () => {} }) {
  const router = express.Router();
  const writes = new Map(); // userId -> időbélyegek (óránkénti írási korlát)

  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(express.json({ limit: '64kb' }));
  router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    if ((req.method === 'POST' || req.method === 'PUT') && !req.is('application/json')) return res.status(415).json({ error: 'JSON-kérés szükséges.' });
    const origin = req.get('origin');
    if (origin && origin !== auth.expectedOrigin(req)) return res.status(403).json({ error: 'A kérés másik oldalról érkezett.' });
    next();
  });

  const optionalUser = (req) => auth.session(req) || null;
  const requireUser = (req) => { const u = auth.session(req); if (!u) fail(401, 'Előbb jelentkezz be.'); return u; };
  function throttle(user) {
    const t = Date.now();
    const list = (writes.get(user.id) || []).filter((x) => t - x < 60 * 60 * 1000);
    if (list.length >= WRITES_PER_HOUR) fail(429, 'Túl sok módosítás. Próbáld újra egy kicsit később.');
    list.push(t); writes.set(user.id, list);
  }
  const codeOf = (req) => { const c = String(req.params.code || '').toUpperCase(); if (!CODE_RE.test(c)) fail(404, 'Nincs ilyen csomag.'); return c; };
  const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

  router.get('/limits', wrap((req, res) => res.json(packs.limits())));
  router.get('/library', wrap((req, res) => res.json(packs.listPublic({ q: String(req.query.q || '').slice(0, 60), sort: req.query.sort === 'popular' ? 'popular' : 'new', limit: req.query.limit, offset: req.query.offset }, optionalUser(req)))));
  router.get('/mine', wrap((req, res) => res.json(packs.mine(requireUser(req)))));
  router.get('/:code', wrap((req, res) => {
    if (!packs.lookupAllowed(req.ip)) fail(429, 'Túl sok sikertelen kód. Próbáld újra pár perc múlva.');
    const view = packs.view(codeOf(req), optionalUser(req));
    if (!view) { packs.lookupMiss(req.ip); fail(404, 'Nincs ilyen csomag (vagy elrejtették).'); }
    res.json({ pack: view });
  }));
  router.post('/', wrap((req, res) => {
    const user = requireUser(req); throttle(user);
    const r = packs.create(user, req.body);
    if (!r.ok) fail(400, r.errors[0], r.errors);
    res.status(201).json({ pack: r.pack });
  }));
  router.put('/:code', wrap((req, res) => {
    const user = requireUser(req); throttle(user);
    const r = packs.update(user, codeOf(req), req.body);
    if (!r.ok) fail(r.status || 400, r.errors[0], r.errors);
    res.json({ pack: r.pack });
  }));
  router.delete('/:code', wrap((req, res) => {
    const user = requireUser(req); throttle(user);
    if (!packs.remove(user, codeOf(req))) fail(404, 'Nincs ilyen saját csomagod.');
    res.json({ ok: true });
  }));
  router.post('/:code/save', wrap((req, res) => {
    const user = requireUser(req); throttle(user);
    const r = packs.save(user, codeOf(req));
    if (!r.ok) fail(r.status || 400, r.error);
    res.json({ ok: true, already: !!r.already });
  }));
  router.delete('/:code/save', wrap((req, res) => {
    const user = requireUser(req); throttle(user);
    if (!packs.unsave(user, codeOf(req))) fail(404, 'Ez a csomag nincs a gyűjteményedben.');
    res.json({ ok: true });
  }));
  router.post('/:code/report', wrap((req, res) => {
    const user = requireUser(req); throttle(user);
    const r = packs.report(user, codeOf(req));
    if (!r.ok) fail(r.status || 400, r.error);
    res.json({ ok: true, already: !!r.already });
  }));

  router.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    if (error instanceof PackError) return res.status(error.status).json({ error: error.message, ...(error.errors && error.errors.length > 1 ? { errors: error.errors } : {}) });
    if (error && (error.type === 'entity.too.large' || error.status === 413)) return res.status(413).json({ error: 'Túl nagy a csomag.' });
    if (error && error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Hibás kérés.' });
    try { onError('http', error, { path: '/api/packs' + req.path }); } catch (_) { /* a naplózás hibája nem számít */ }
    res.status(503).json({ error: 'A kártyaműhely most nem elérhető. Próbáld újra később.' });
  });

  return { router };
}

module.exports = { createPacks, createPacksApi, cleanPackInput, DECKS, LABELS, MIN, MAX, CODE_RE, REPORTS_TO_HIDE, WRITES_PER_HOUR, MISSES_PER_WINDOW };
