'use strict';

// ============================================================
// KAMU BÍRÓSÁG – üzemeltetői (admin) felület
//
// Csak akkor él, ha az ADMIN_TOKEN környezeti változó legalább 24 karakteres; egyébként minden útvonal 404.
// A kéréseket `Authorization: Bearer <ADMIN_TOKEN>` fejléc hitelesíti (böngészőből a /admin oldal küldi), a token
// sosem szerepel URL-ben. Rossz tokennel IP-nként 10 próba / 10 perc, utána 429.
//
//   GET  /api/admin/status        – áttekintés (hibák összesítése, mentések, levélküldés állapota)
//   GET  /api/admin/errors        – a hibanapló bejegyzései
//   POST /api/admin/errors/clear  – a napló törlése
//   GET  /api/admin/backups       – a mentések listája
//   POST /api/admin/backups       – azonnali mentés
//   POST /api/admin/mail-test     – próbalevél {to}
//   POST /api/admin/reset-link    – kézi jelszó-visszaállító link {email} (ha nincs levélküldés)
// ============================================================

const crypto = require('crypto');
const express = require('express');

const MIN_TOKEN = 24;
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

function createAdmin({ token = '', errors, storage, auth, now = () => Date.now(), startedAt = Date.now() }) {
  const router = express.Router();
  const enabled = typeof token === 'string' && token.length >= MIN_TOKEN;
  const expected = enabled ? crypto.createHash('sha256').update(token).digest() : null;
  const failures = new Map(); // ip -> [időbélyegek]

  const matches = (given) => {
    const digest = crypto.createHash('sha256').update(String(given || '')).digest();
    return crypto.timingSafeEqual(digest, expected);
  };

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!enabled) return res.status(404).json({ error: 'Nincs ilyen oldal.' });
    const t = now();
    const recent = (failures.get(req.ip) || []).filter((x) => t - x < FAIL_WINDOW_MS);
    if (recent.length >= FAIL_LIMIT) return res.status(429).json({ error: 'Túl sok hibás próba. Várj pár percet.' });
    const header = req.get('authorization') || '';
    const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!given || !matches(given)) {
      recent.push(t);
      failures.set(req.ip, recent);
      if (failures.size > 2000) failures.delete(failures.keys().next().value);
      return res.status(401).json({ error: 'Hibás vagy hiányzó admin token.' });
    }
    failures.delete(req.ip);
    next();
  });
  router.use(express.json({ limit: '4kb' }));

  const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((e) => {
    const status = e && Number.isInteger(e.status) ? e.status : 500;
    if (status >= 500) errors.record('http', e, { path: '/api/admin' + req.path });
    res.status(status).json({ error: status >= 500 ? 'Belső hiba: ' + (e && e.message ? String(e.message).slice(0, 200) : 'ismeretlen') : e.message });
  });

  router.get('/status', wrap(async (req, res) => {
    let backups = [];
    let backupError = '';
    try { backups = await storage.listBackups(); } catch (e) { backupError = String(e && e.message || e).slice(0, 200); }
    res.json({
      time: now(),
      uptimeSeconds: Math.round(process.uptime()),
      errors: errors.summary(),
      database: storage.enabled(),
      backups: { count: backups.length, latest: backups[0] || null, error: backupError },
      mail: auth.admin.mailStatus()
    });
  }));

  router.get('/errors', (req, res) => res.json({ errors: errors.list(), summary: errors.summary() }));
  router.post('/errors/clear', (req, res) => { errors.clear(); res.json({ ok: true }); });

  router.get('/backups', wrap(async (req, res) => res.json({ database: storage.enabled(), backups: await storage.listBackups() })));
  router.post('/backups', wrap(async (req, res) => {
    if (!storage.enabled()) return res.status(409).json({ error: 'Nincs adatbázis (DATABASE_URL), nincs mit menteni.' });
    const result = await storage.backupNow('kezi');
    if (!result) return res.status(409).json({ error: 'Az adatbázis üres, mentés nem készült.' });
    res.json({ ok: true, backup: result });
  }));

  router.post('/mail-test', wrap(async (req, res) => {
    const to = req.body && req.body.to;
    try {
      await auth.admin.sendTestMail(to);
    } catch (e) {
      if (!(e && e.mail)) throw e; // hibás cím / nincs beállítva: a saját üzenetével megy vissza
      // A levélszolgáltató elutasítása (pl. nem hitelesített feladó) pontosan ide tartozik: az üzemeltető lássa az okát.
      errors.record('mail', e);
      return res.status(502).json({ error: 'A levél küldése nem sikerült: ' + String(e && e.message || e).slice(0, 240) });
    }
    res.json({ ok: true });
  }));

  router.post('/reset-link', wrap(async (req, res) => {
    res.json(auth.admin.resetLinkFor(req.body && req.body.email));
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Érvénytelen kérés.' });
    res.status(500).json({ error: 'Belső hiba.' });
  });

  return { router, enabled };
}

module.exports = { createAdmin, MIN_TOKEN };
