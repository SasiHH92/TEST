'use strict';

// ============================================================
// KAMU BÍRÓSÁG – bolt és napi küldetések
// A pénznem a pogácsa: napi küldetésekből jár. A pogácsát a bolt tárgyaira lehet költeni
// (kártyakeret, háttér, névhatás, pecsét, felirat). A fiók pénztárcája és tárgyai a fiókfájlban
// (és a külső adatbázisban) élnek: user.shop = { wallet, owned, equipped, claims, earned, offered }.
// Feloldható tárgy ("feloldas" a katalógusban, pl. a Discord-háttér): nem vásárolható és nem ajándékozható, a fiók ELLENŐRZÖTT állapota adja
// (az összekapcsolt szolgáltatók a fiókban: user.providers). Ezek nem kerülnek a tárolt "owned" listába, így az összekapcsolással együtt járnak.
// Végpontok (mind bejelentkezést kér): GET /state, POST /claim, /claim-bonus, /buy, /equip.
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const { questsForDate, budapestDate, addDays, msUntilReset, BONUS } = require('./quests');

const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'shop.json'), 'utf8'));
const ITEMS = new Map(CATALOG.targyak.map((i) => [i.id, i]));
const SLOTS = new Set(CATALOG.slotok.map((s) => s.id));
const SEASONS = new Map((CATALOG.szezonok || []).map((s) => [s.id, s]));
const GIFTS_PER_DAY = 5; // egy játékos naponta legfeljebb ennyi ajándékot küldhet
const UNLOCKS = { discord: (user) => !!(user && user.providers && user.providers.discord) };
const UNLOCK_NAMES = { discord: 'a Discord-fiókod összekapcsolásával' };
// A fiók állapota alapján most feloldott tárgyak azonosítói.
const grantedIds = (user) => CATALOG.targyak.filter((i) => i.feloldas && UNLOCKS[i.feloldas] && UNLOCKS[i.feloldas](user)).map((i) => i.id);

// Egy szezonális tárgy állapota a megadott napra ("ÉÉÉÉ-HH-NN"): kapható-e most, meddig / mikortól.
// A szezon minden évben ismétlődik (tol/ig: "HH-NN"); az évhatáron átnyúló szezon (pl. 12-15 … 01-06) is jó.
function seasonInfo(item, date) {
  const s = item.szezon && SEASONS.get(item.szezon);
  if (!s) return null;
  const year = Number(date.slice(0, 4));
  const wraps = s.tol > s.ig;
  const windows = [year - 1, year, year + 1].map((y) => ({ start: y + '-' + s.tol, end: (wraps ? y + 1 : y) + '-' + s.ig }));
  const current = windows.find((w) => date >= w.start && date <= w.end);
  const base = { id: s.id, nev: s.nev, emoji: s.emoji };
  if (current) return { ...base, aktiv: true, zar: current.end };
  const next = windows.find((w) => w.start > date);
  return { ...base, aktiv: false, kezdodik: next ? next.start : null };
}

class ShopError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new ShopError(status, message); };

// A fiók bolt-adatai normalizálva (hiányzó mezők alapértékkel).
function shopOf(user) {
  const s = (user && user.shop) || {};
  return {
    wallet: Number.isFinite(s.wallet) && s.wallet > 0 ? Math.floor(s.wallet) : 0,
    earned: Number.isFinite(s.earned) && s.earned > 0 ? Math.floor(s.earned) : 0,
    owned: [...new Set([...(Array.isArray(s.owned) ? s.owned.filter((id) => ITEMS.has(id)) : []), ...grantedIds(user)])],
    equipped: s.equipped && typeof s.equipped === 'object' ? s.equipped : {},
    claims: s.claims && typeof s.claims === 'object' ? s.claims : {},
    offered: Array.isArray(s.offered) ? s.offered.filter((id) => ITEMS.has(id)) : [] // a feloldott tárgyak, amiket már egyszer automatikusan felvettünk
  };
}
// Mentés előtt: a feloldott tárgyak nem kerülnek a tárolt tulajdon-listába (a fiók állapota adja őket, nem a bolt).
function storable(user, s) {
  const granted = new Set(grantedIds(user));
  return { ...s, owned: s.owned.filter((id) => !granted.has(id)) };
}

// A felvett, tényleg megvásárolt tárgyak (slot -> azonosító): ez kerül a többi játékos elé is.
function cosmeticsFor(user) {
  const s = shopOf(user);
  const out = {};
  for (const [slot, id] of Object.entries(s.equipped)) {
    const item = ITEMS.get(id);
    if (item && item.slot === slot && s.owned.includes(id)) out[slot] = id;
  }
  if (out.stamp) out.stampText = ITEMS.get(out.stamp).text;
  if (out.label) out.labelText = ITEMS.get(out.label).text;
  return Object.keys(out).length ? out : null;
}

function createShop({ auth, dailyCounts, today = () => budapestDate(), areFriends = () => false, onGift = () => {}, onError = () => {} }) {
  const router = express.Router();
  const calls = new Map(); // userId -> időbélyegek (egyszerű sebességkorlát)
  const giftsToday = new Map(); // userId -> { date, count } (memóriában: újraindításkor nullázódik)

  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(express.json({ limit: '4kb' }));

  const requireUser = (req) => {
    const user = auth.session(req);
    if (!user) fail(401, 'Előbb jelentkezz be.');
    return user;
  };

  router.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON-kérés szükséges.' });
    const origin = req.get('origin');
    if (origin && origin !== auth.expectedOrigin(req)) return res.status(403).json({ error: 'A kérés másik oldalról érkezett.' });
    if (!req.body || Array.isArray(req.body)) return res.status(400).json({ error: 'Hiányzó adatok.' });
    next();
  });

  function throttle(user) {
    const now = Date.now();
    const list = (calls.get(user.id) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (list.length >= 120) fail(429, 'Túl sok kérés. Próbáld újra pár perc múlva.');
    list.push(now);
    calls.set(user.id, list);
  }

  function stateFor(user) {
    const date = today();
    const shop = shopOf(user);
    const counts = dailyCounts(user.username) || {};
    const claimed = Array.isArray(shop.claims[date]) ? shop.claims[date] : [];
    const quests = questsForDate(date).map((q) => {
      const progress = counts[q.stat] || 0;
      return { id: q.id, tier: q.tier, tierName: q.tierName, text: q.text, target: q.target, reward: q.reward,
        progress: Math.min(progress, q.target), done: progress >= q.target, claimed: claimed.includes(q.id) };
    });
    const allClaimed = quests.every((q) => q.claimed);
    return {
      date, resetsInMs: msUntilReset(), currency: CATALOG.penznem,
      wallet: shop.wallet, earned: shop.earned, owned: shop.owned, equipped: shop.equipped,
      quests,
      bonus: { reward: BONUS, claimed: claimed.includes('bonus'), available: allClaimed && !claimed.includes('bonus') },
      // a szezonális tárgyaknál a mai állapot (kapható-e, meddig / mikortól) is jön
      catalog: {
        slotok: CATALOG.slotok, ritkasagok: CATALOG.ritkasagok, szezonok: CATALOG.szezonok || [],
        targyak: CATALOG.targyak.map((i) => (i.szezon ? { ...i, szezon: seasonInfo(i, date) } : i))
      }
    };
  }

  // Egy módosítás a fiók bolt-adatain; közben a régi napok jutalom-jegyzetét kitakarítjuk.
  function change(user, edit) {
    return auth.mutate(user.id, (u) => {
      const s = shopOf(u);
      const date = today();
      for (const d of Object.keys(s.claims)) if (d < addDays(date, -10)) delete s.claims[d];
      edit(s, date);
      u.shop = storable(u, s);
      return u;
    });
  }

  router.get('/state', (req, res) => {
    const user = requireUser(req);
    res.json(stateFor(user));
  });

  router.post('/claim', (req, res) => {
    const user = requireUser(req); throttle(user);
    const quest = questsForDate(today()).find((q) => q.id === req.body.questId);
    if (!quest) fail(404, 'Ilyen küldetés ma nincs.');
    const progress = (dailyCounts(user.username) || {})[quest.stat] || 0;
    if (progress < quest.target) fail(400, 'Ez a küldetés még nincs kész.');
    const updated = change(user, (s, date) => {
      const list = Array.isArray(s.claims[date]) ? s.claims[date] : (s.claims[date] = []);
      if (list.includes(quest.id)) fail(409, 'Ennek a küldetésnek a jutalmát már átvetted.');
      list.push(quest.id);
      s.wallet += quest.reward;
      s.earned += quest.reward;
    });
    res.json(stateFor(updated));
  });

  router.post('/claim-bonus', (req, res) => {
    const user = requireUser(req); throttle(user);
    const updated = change(user, (s, date) => {
      const list = Array.isArray(s.claims[date]) ? s.claims[date] : (s.claims[date] = []);
      const all = questsForDate(date).every((q) => list.includes(q.id));
      if (!all) fail(400, 'A bónuszhoz előbb vedd át mind a három küldetés jutalmát.');
      if (list.includes('bonus')) fail(409, 'A napi bónuszt már átvetted.');
      list.push('bonus');
      s.wallet += BONUS;
      s.earned += BONUS;
    });
    res.json(stateFor(updated));
  });

  router.post('/buy', (req, res) => {
    const user = requireUser(req); throttle(user);
    const item = ITEMS.get(String(req.body.itemId || ''));
    if (!item) fail(404, 'Ilyen tárgy nincs a boltban.');
    if (item.feloldas) fail(403, 'Ez a tárgy nem vásárolható: ' + (UNLOCK_NAMES[item.feloldas] || 'különleges módon') + ' kapod meg.');
    assertAvailable(item);
    const updated = change(user, (s) => {
      if (s.owned.includes(item.id)) fail(409, 'Ez a tárgy már a tiéd.');
      if (s.wallet < item.ar) fail(402, 'Nincs elég pogácsád ehhez (' + item.ar + ' kell, ' + s.wallet + ' van).');
      s.wallet -= item.ar;
      s.owned.push(item.id);
    });
    res.json(stateFor(updated));
  });

  // Szezonális tárgy csak a szezonban vehető (és ajándékozható); a már megvett tárgyak szezonon kívül is felvehetők.
  function assertAvailable(item) {
    const season = seasonInfo(item, today());
    if (season && !season.aktiv) {
      fail(403, 'A(z) ' + item.nev + ' ' + season.nev + '-tárgy, most nem kapható' + (season.kezdodik ? ' (' + season.kezdodik + '-tól újra)' : '') + '.');
    }
  }

  // Ajándék egy barátnak: a küldő fizet, a tárgy a barát tulajdonába kerül (egyetlen mentésben).
  router.post('/gift', (req, res) => {
    const user = requireUser(req); throttle(user);
    const item = ITEMS.get(String(req.body.itemId || ''));
    if (!item) fail(404, 'Ilyen tárgy nincs a boltban.');
    if (item.feloldas) fail(403, 'Ez a tárgy nem ajándékozható: ' + (UNLOCK_NAMES[item.feloldas] || 'különleges módon') + ' lehet megkapni.');
    const friendId = typeof req.body.friendId === 'string' ? req.body.friendId.slice(0, 64) : '';
    if (!friendId || friendId === user.id) fail(400, 'Magadnak nem ajándékozhatsz, válassz egy barátot.');
    if (!areFriends(user.id, friendId)) fail(403, 'Ajándékot csak a barátaidnak küldhetsz.');
    assertAvailable(item);
    const date = today();
    const sent = giftsToday.get(user.id);
    if (sent && sent.date === date && sent.count >= GIFTS_PER_DAY) fail(429, 'Ma már ' + GIFTS_PER_DAY + ' ajándékot küldtél. Holnap újra lehet.');
    let recipient = null;
    const updated = auth.mutate(user.id, (me, data) => {
      const other = data.users.find((u) => u.id === friendId);
      if (!other) fail(404, 'Nincs ilyen felhasználó.');
      const mine = shopOf(me), theirs = shopOf(other);
      if (theirs.owned.includes(item.id)) fail(409, 'Neki ez a tárgy már megvan.');
      if (mine.wallet < item.ar) fail(402, 'Nincs elég pogácsád ehhez (' + item.ar + ' kell, ' + mine.wallet + ' van).');
      mine.wallet -= item.ar;
      theirs.owned.push(item.id);
      me.shop = storable(me, mine); other.shop = storable(other, theirs);
      recipient = { id: other.id, username: other.username };
      return me;
    });
    giftsToday.set(user.id, { date, count: sent && sent.date === date ? sent.count + 1 : 1 });
    if (giftsToday.size > 5000) giftsToday.delete(giftsToday.keys().next().value);
    try { onGift(user, recipient, item); } catch (_) { /* az értesítés hibája nem teheti semmissé az ajándékot */ }
    res.json({ ...stateFor(updated), gift: { to: recipient.username, item: item.nev } });
  });

  router.post('/equip', (req, res) => {
    const user = requireUser(req); throttle(user);
    const slot = String(req.body.slot || '');
    if (!SLOTS.has(slot)) fail(400, 'Ismeretlen hely.');
    const itemId = req.body.itemId === null || req.body.itemId === undefined || req.body.itemId === '' ? null : String(req.body.itemId);
    const updated = change(user, (s) => {
      if (itemId === null) { delete s.equipped[slot]; return; }
      const item = ITEMS.get(itemId);
      if (!item || item.slot !== slot) fail(400, 'Ez a tárgy ide nem vehető fel.');
      if (!s.owned.includes(itemId)) fail(403, 'Ezt a tárgyat még nem vetted meg.');
      s.equipped[slot] = itemId;
    });
    res.json(stateFor(updated));
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && error.status) return res.status(error.status).json({ error: error.message });
    if (error && error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Érvénytelen kérés.' });
    console.error('Bolt hiba:', error && (error.code || error.name));
    try { onError('http', error, { path: '/api/shop' + req.path }); } catch (_) { /* a naplózás hibája nem számít */ }
    res.status(503).json({ error: 'A bolt most nem elérhető. Próbáld újra később.' });
  });

  // Egy szolgáltatót épp most kapcsolt össze a fiókkal (vagy belépett vele): a hozzá tartozó feloldott tárgyat EGYSZER automatikusan felveszi,
  // ha az adott hely (pl. kártyahát) még üres. Utána a játékos szabadon levehet / cserélhet, nem vesszük vissza. A hívó a mentés (commit) belsejéből hívja.
  function onProviderLinked(user, provider) {
    const s = shopOf(user);
    let changed = false;
    for (const item of CATALOG.targyak) {
      if (item.feloldas !== provider || s.offered.includes(item.id) || !s.owned.includes(item.id)) continue;
      s.offered.push(item.id); changed = true;
      if (!s.equipped[item.slot]) s.equipped[item.slot] = item.id;
    }
    if (changed) user.shop = storable(user, s);
    return changed;
  }

  return { router, cosmeticsFor, onProviderLinked };
}

module.exports = { createShop, cosmeticsFor, shopOf, seasonInfo, CATALOG, ITEMS, GIFTS_PER_DAY };
