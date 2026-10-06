'use strict';

// ============================================================
// KAMU BÍRÓSÁG – bolt és napi küldetések
// A pénznem a pogácsa: napi küldetésekből jár. A pogácsát a bolt tárgyaira lehet költeni
// (kártyakeret, háttér, névhatás, pecsét, felirat). A fiók pénztárcája és tárgyai a fiókfájlban
// (és a külső adatbázisban) élnek: user.shop = { wallet, owned, equipped, claims, earned }.
// Végpontok (mind bejelentkezést kér): GET /state, POST /claim, /claim-bonus, /buy, /equip.
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const { questsForDate, budapestDate, addDays, msUntilReset, BONUS } = require('./quests');

const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'shop.json'), 'utf8'));
const ITEMS = new Map(CATALOG.targyak.map((i) => [i.id, i]));
const SLOTS = new Set(CATALOG.slotok.map((s) => s.id));

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
    owned: Array.isArray(s.owned) ? s.owned.filter((id) => ITEMS.has(id)) : [],
    equipped: s.equipped && typeof s.equipped === 'object' ? s.equipped : {},
    claims: s.claims && typeof s.claims === 'object' ? s.claims : {}
  };
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

function createShop({ auth, dailyCounts, today = () => budapestDate() }) {
  const router = express.Router();
  const calls = new Map(); // userId -> időbélyegek (egyszerű sebességkorlát)

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
      catalog: { slotok: CATALOG.slotok, ritkasagok: CATALOG.ritkasagok, targyak: CATALOG.targyak }
    };
  }

  // Egy módosítás a fiók bolt-adatain; közben a régi napok jutalom-jegyzetét kitakarítjuk.
  function change(user, edit) {
    return auth.mutate(user.id, (u) => {
      const s = shopOf(u);
      const date = today();
      for (const d of Object.keys(s.claims)) if (d < addDays(date, -10)) delete s.claims[d];
      edit(s, date);
      u.shop = s;
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
    const updated = change(user, (s) => {
      if (s.owned.includes(item.id)) fail(409, 'Ez a tárgy már a tiéd.');
      if (s.wallet < item.ar) fail(402, 'Nincs elég pogácsád ehhez (' + item.ar + ' kell, ' + s.wallet + ' van).');
      s.wallet -= item.ar;
      s.owned.push(item.id);
    });
    res.json(stateFor(updated));
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
    res.status(503).json({ error: 'A bolt most nem elérhető. Próbáld újra később.' });
  });

  return { router, cosmeticsFor };
}

module.exports = { createShop, cosmeticsFor, shopOf, CATALOG, ITEMS };
