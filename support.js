'use strict';

// ============================================================
// KAMU BÍRÓSÁG – önkéntes támogatás (szerver-oldal)
//
// ALAPBÓL KIKAPCSOLT: a támogatási oldal felülete működik, de fizetést NEM kezdeményez, amíg az üzemeltető külön, kifejezetten
// be nem kapcsolja (SUPPORT_ENABLED=1 + egy jóváhagyott szolgáltató-adapter + annak titkai). Nincs bejegyzett szolgáltató-adapter:
// éles szolgáltató (Ko-fi, PayPal, Buy Me a Coffee, Stripe…) csak az üzemeltető jóváhagyása és a szolgáltatói feltételek
// ellenőrzése UTÁN kerül be (lásd TAMOGATAS.md). Addig a SUPPORT_PROVIDER=ismeretlen érték is "kikapcsolt".
//
// Elvek:
//  - A támogatásért semmilyen ellenszolgáltatás / játékbeli előny nem jár: ez a modul nem ír semmit a fiókokba, a bolt egyenlegébe
//    vagy a tárgyakba.
//  - A "KÖSZÖNJÜK" üzenet kizárólag a szolgáltató SZERVEROLDALON, aláírással ellenőrzött visszaigazolása alapján jelenik meg
//    (webhook → ellenőrzés → a kliens a /verify végponton kérdezi le). A kliens állítására sosem hagyatkozunk.
//  - Minimális adat: nem tárolunk adományozói adatot (se nevet, se e-mailt, se kártyaadatot); csak egy rövid életű, memóriabeli
//    hivatkozás-azonosítót (ref) és az összeget, ami néhány óra után törlődik.
// Végpontok (/api/support): GET /config · POST /intent · POST /webhook/:provider · GET /verify?ref=
// ============================================================

const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const MIN_CENTS = 100;     // 1 €
const MAX_CENTS = 50000;   // 500 €
const PENDING_MS = 2 * 60 * 60 * 1000;
const VERIFIED_MS = 24 * 60 * 60 * 1000;
const TIERS = [
  { id: 'kis', icon: '❤️', name: 'Egy kis segítség', amountCents: 100 },
  { id: 'kave', icon: '☕', name: 'Kávé a fejlesztőnek', amountCents: 300 },
  { id: 'birosag', icon: '⚖️', name: 'A bíróság támogatása', amountCents: 500 },
  { id: 'nagylelku', icon: '👑', name: 'Nagylelkű támogatás', amountCents: 1000 },
  { id: 'egyedi', icon: '💎', name: 'Egyedi támogatás', custom: true }
];

// Szolgáltató-adapterek. Csak a "simulated" létezik: teszthez és a "KÖSZÖNJÜK" folyamat bemutatásához (HMAC-aláírt, a saját
// szerverünkre mutat, SOHA nem érint valódi pénzt). Éles adaptert csak az üzemeltető jóváhagyása után adunk hozzá.
const ADAPTERS = {
  simulated: (env, base) => {
    const secret = String(env.SUPPORT_SIM_SECRET || '');
    if (secret.length < 16) return null;
    return {
      checkoutUrl: ({ ref }) => base + '/tamogatas?szimulalt=' + ref,
      verify: (raw, headers) => {
        const given = String(headers['x-signature'] || '');
        const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        const a = Buffer.from(given), b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
        let body; try { body = JSON.parse(raw.toString('utf8')); } catch (_) { return null; }
        return body && typeof body === 'object' ? { ref: String(body.ref || ''), amountCents: Number(body.amountCents), txnId: String(body.txnId || '') } : null;
      }
    };
  }
};

// "12", "12,5", "12.50" → cent (egész); érvénytelen → null
function parseAmountCents(value) {
  if (typeof value === 'number') value = String(value);
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(',', '.');
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(parseFloat(t) * 100);
  return Number.isFinite(cents) ? cents : null;
}

function createSupport({ env = process.env, now = () => Date.now(), expectedOrigin = null, baseUrl = '' } = {}) {
  const base = String(baseUrl || env.AUTH_BASE_URL || '').replace(/\/+$/, '');
  const provider = String(env.SUPPORT_PROVIDER || '').trim().toLowerCase();
  const adapter = env.SUPPORT_ENABLED === '1' && ADAPTERS[provider] ? ADAPTERS[provider](env, base) : null;
  const enabled = !!adapter;
  const pending = new Map();   // ref -> { amountCents, tierId, at }
  const verified = new Map();  // ref -> { amountCents, at }
  const seenTxn = new Set();
  const calls = new Map();     // ip -> időbélyegek (egyszerű korlát)

  const sweep = () => {
    const t = now();
    for (const [k, v] of pending) if (t - v.at > PENDING_MS) pending.delete(k);
    for (const [k, v] of verified) if (t - v.at > VERIFIED_MS) { verified.delete(k); }
    if (seenTxn.size > 5000) seenTxn.clear();
  };
  const limited = (ip) => {
    const t = now();
    const list = (calls.get(ip) || []).filter((x) => t - x < 10 * 60 * 1000);
    if (list.length >= 12) return true;
    list.push(t); calls.set(ip, list);
    if (calls.size > 2000) calls.clear();
    return false;
  };

  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/config', (req, res) => {
    // a külön "bíró kávéval" kép (ha az üzemeltető feltöltötte): assets/support/biro-kave.webp
    const hero = fs.existsSync(path.join(__dirname, 'assets', 'support', 'biro-kave.webp')) ? '/assets/support/biro-kave.webp' : null;
    res.json({
      heroImage: hero,
      enabled, currency: 'EUR', tiers: TIERS, minCents: MIN_CENTS, maxCents: MAX_CENTS,
      simulated: enabled && provider === 'simulated',
      preview: env.SUPPORT_PREVIEW === '1' // a "KÖSZÖNJÜK" képernyő megtekintése tervezéshez (jelölt előnézet, nem valódi támogatás)
    });
  });

  router.post('/intent', express.json({ limit: '1kb' }), (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON-kérés szükséges.' });
    const origin = req.get('origin');
    if (origin && expectedOrigin && origin !== expectedOrigin(req)) return res.status(403).json({ error: 'A kérés másik oldalról érkezett.' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    // az összeg szerver-oldali ellenőrzése: a kliens csak a lehetőséget választja, az összeget mi számoljuk
    let cents = null, tierId = null;
    if (typeof body.tierId === 'string') {
      const tier = TIERS.find((t) => t.id === body.tierId);
      if (!tier) return res.status(400).json({ error: 'Ismeretlen támogatási lehetőség.', code: 'bad_tier' });
      tierId = tier.id;
      cents = tier.custom ? parseAmountCents(body.amount) : tier.amountCents;
    }
    if (cents === null || cents < MIN_CENTS || cents > MAX_CENTS) {
      return res.status(400).json({ error: 'Az összeg legalább 1 €, legfeljebb 500 € lehet (két tizedesig).', code: 'bad_amount' });
    }
    if (!enabled) return res.status(503).json({ error: 'A támogatás indítása még nincs aktiválva. Hamarosan!', code: 'disabled' });
    if (limited(req.ip || '')) return res.status(429).json({ error: 'Túl sok kérés. Próbáld újra később.' });
    sweep();
    const ref = crypto.randomBytes(16).toString('hex');
    pending.set(ref, { amountCents: cents, tierId, at: now() });
    res.json({ ref, amountCents: cents, checkoutUrl: adapter.checkoutUrl({ ref, amountCents: cents }) });
  });

  // A szolgáltató visszaigazolása. Nyers törzs kell az aláírás-ellenőrzéshez; kikapcsolt állapotban a végpont "nem létezik".
  router.post('/webhook/:provider', express.raw({ type: '*/*', limit: '16kb' }), (req, res) => {
    if (!enabled || req.params.provider !== provider) return res.status(404).json({ error: 'Nincs ilyen végpont.' });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const evt = adapter.verify(raw, req.headers);
    if (!evt) return res.status(401).json({ error: 'Érvénytelen aláírás.' });
    sweep();
    const rec = pending.get(evt.ref);
    if (!rec) return res.status(202).json({ ok: true, ignored: 'ismeretlen vagy lejárt hivatkozás' });
    if (evt.txnId && seenTxn.has(evt.txnId)) return res.json({ ok: true, duplicate: true }); // idempotens
    if (!Number.isInteger(evt.amountCents) || evt.amountCents < rec.amountCents) {
      return res.status(202).json({ ok: true, ignored: 'az összeg nem egyezik' }); // kevesebb érkezett, mint a kért: nem igazoljuk vissza
    }
    if (evt.txnId) seenTxn.add(evt.txnId);
    pending.delete(evt.ref);
    verified.set(evt.ref, { amountCents: evt.amountCents, at: now() });
    res.json({ ok: true });
  });

  router.get('/verify', (req, res) => {
    const ref = String(req.query.ref || '');
    if (!/^[a-f0-9]{32}$/.test(ref)) return res.status(400).json({ verified: false });
    sweep();
    const v = verified.get(ref);
    res.json(v ? { verified: true, amountCents: v.amountCents } : { verified: false, pending: pending.has(ref) });
  });

  return { router, enabled, tiers: TIERS, _state: { pending, verified } };
}

module.exports = { createSupport, parseAmountCents, TIERS, MIN_CENTS, MAX_CENTS };
