'use strict';

// ============================================================
// KAMU BÍRÓSÁG – hibajelentések (tároló)
// A weboldalról érkező jelentések itt várakoznak, amíg a Discord bot ki nem posztolja őket a 🐛・hibajelentés
// csatornába. Fájlban él (data/bugreports.json), a mentés után a külső adatbázisba is feltöltődik (persist).
// Csak a legutóbbi KEEP jelentés marad meg; a már kiposztoltak kikerülnek a "várakozó" listából.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP = 200;
// A fejlesztők által állítható állapotok (a Discordon a jelentés alatti választóból).
const STATUSES = ['new', 'progress', 'ice', 'done', 'wontfix', 'cantrepro'];
const KINDS = { bug: 'Hiba', sound: 'Hang / Voice', ui: 'Kinézet / UI', room: 'Szoba / Lobby', other: 'Egyéb' };

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

function createBugReports({ file, persist = () => {}, now = () => Date.now() }) {
  let data = { version: 1, seq: 0, items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.version === 1 && Array.isArray(parsed.items)) data = parsed;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('A hibajelentések fájlja nem olvasható, üresen indul:', e.message);
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    try { persist(file); } catch (_) { /* a külső mentés hibája nem akadályozhatja a jelentést */ }
  }

  return {
    KINDS,
    // Új jelentés. Az üres/túl rövid leírást elutasítja (hibakóddal).
    add({ name, kind, text, where, room, userAgent, account }) {
      const body = clean(text, 1200);
      if (body.length < 5) { const e = new Error('Írj le röviden, mi történt (legalább pár szó).'); e.status = 400; throw e; }
      const item = {
        id: 'BUG-' + (++data.seq),
        ts: now(),
        name: clean(name, 40) || 'vendég',
        account: !!account,
        kind: KINDS[kind] ? kind : 'bug',
        text: body,
        where: clean(where, 30),
        room: /^[A-Za-z0-9]{3,12}$/.test(String(room || '')) ? String(room) : '',
        userAgent: clean(userAgent, 160),
        status: 'new',
        posted: null
      };
      data.items.push(item);
      if (data.items.length > KEEP) data.items.splice(0, data.items.length - KEEP);
      save();
      return item;
    },
    pending() { return data.items.filter((i) => !i.posted); },
    markPosted(id, ref) {
      const it = data.items.find((i) => i.id === id);
      if (!it) return false;
      if (!it.posted) { it.posted = { at: now(), ref: clean(ref, 60) || 'ok' }; save(); }
      return true;
    },
    get(id) { return data.items.find((i) => i.id === id) || null; },
    // Állapot módosítása (a Discordon a stáb állítja). Ismeretlen azonosító / állapot: null.
    setStatus(id, status, by) {
      const it = data.items.find((i) => i.id === id);
      if (!it || !STATUSES.includes(status)) return null;
      it.status = status;
      it.statusBy = clean(by, 60);
      it.statusAt = now();
      save();
      return it;
    },
    all() { return data.items.slice(); }
  };
}

module.exports = { createBugReports, KINDS, STATUSES };
