'use strict';

// ============================================================
// KAMU BÍRÓSÁG – moderáció: jelentések és időzített némítások (tároló)
//
// Jelentés: egy üzenetet (szobai csevegő vagy közös tér) a játékosok jelenthetnek; azonos üzenetet ugyanaz a jelentő egyszer.
// A jelentés megőrzi az üzenet szövegét és a küldő kulcsait (fiók-azonosító, IP-lenyomat), hogy az üzemeltető később némíthassa.
// Némítás: kulcs -> lejárat. A fiókos küldőt fiók-azonosító szerint, a vendéget az IP-lenyomata szerint állítjuk meg
// (a közös IP mögötti másik fiók így nem sérül). Fájlban él (data/moderation.json), a mentés után a külső adatbázisba is
// feltöltődik, így a Render újraindítása nem oldja fel a némítást.
// A kulcsok sosem hagyják el a szervert (az admin lista is csak rövidített címkét kap).
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_REPORTS = 100;
const MAX_MUTE_MINUTES = 7 * 24 * 60;
const SAVE_DELAY_MS = 1000;

const ipKey = (ip) => 'ip:' + crypto.createHash('sha256').update('kb-ip:' + String(ip || '')).digest('hex').slice(0, 16);
const userKey = (userId) => (userId ? 'u:' + userId : '');

function createModeration({ file = null, persist = () => {}, now = () => Date.now() } = {}) {
  let data = { version: 1, seq: 0, reports: [], mutes: {} };
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.version === 1 && Array.isArray(parsed.reports) && parsed.mutes && typeof parsed.mutes === 'object') data = { seq: 0, ...parsed };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('A moderációs fájl nem olvasható, üresen indul:', e.message);
    }
  }
  let timer = null;

  function saveNow() {
    clearTimeout(timer); timer = null;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    try { persist(file); } catch (_) { /* a külső mentés hibája nem állíthatja meg a moderációt */ }
  }
  function save() {
    if (!file || timer) return;
    timer = setTimeout(() => { try { saveNow(); } catch (e) { console.error('A moderációs adatok mentése sikertelen:', e.message); } }, SAVE_DELAY_MS);
    if (timer.unref) timer.unref();
  }

  const label = (key) => (key.startsWith('u:') ? 'fiók …' + key.slice(-4) : key.startsWith('ip:') ? 'cím …' + key.slice(-4) : '?');
  function prune() {
    const t = now();
    for (const [k, m] of Object.entries(data.mutes)) if (m.until <= t) delete data.mutes[k];
  }

  return {
    // Jelentés rögzítése. Azonos üzenetet ugyanaz a jelentő (reporterKey) csak egyszer számít. Visszatérés: { entry, isNew, added }.
    report({ channel, code = '', msgId, name, text, reporter, reporterKey, senderKeys }) {
      let entry = data.reports.find((r) => r.channel === channel && r.code === code && r.msgId === msgId);
      let isNew = false, added = false;
      if (!entry) {
        data.seq += 1;
        entry = { id: data.seq, channel, code, msgId, name: String(name || '').slice(0, 40), text: String(text || '').slice(0, 300), ts: now(),
          reporters: [], reporterNames: [], senderKeys: [...new Set((senderKeys || []).filter(Boolean))], status: 'new' };
        data.reports.push(entry);
        if (data.reports.length > MAX_REPORTS) data.reports.splice(0, data.reports.length - MAX_REPORTS);
        isNew = true;
      }
      if (!entry.reporters.includes(reporterKey)) {
        entry.reporters.push(reporterKey);
        entry.reporterNames.push(String(reporter || '').slice(0, 40));
        added = true;
        save();
      }
      return { entry, isNew, added, count: entry.reporters.length };
    },
    // Az üzemeltető listája: a kulcsok nélkül.
    list() {
      return data.reports.slice().reverse().map((r) => ({
        id: r.id, channel: r.channel, code: r.code, name: r.name, text: r.text, ts: r.ts, status: r.status,
        count: r.reporters.length, reporters: r.reporterNames, senders: r.senderKeys.map(label)
      }));
    },
    get: (id) => data.reports.find((r) => r.id === id) || null,
    // Némítás a jelentés küldőjére (perc: 1 … 7 nap). Visszatérés: a némított kulcsok száma, vagy 0, ha nincs mit némítani.
    mute(reportId, minutes) {
      const r = data.reports.find((x) => x.id === reportId);
      if (!r) return -1;
      const mins = Math.max(1, Math.min(MAX_MUTE_MINUTES, Math.floor(Number(minutes)) || 60));
      const until = now() + mins * 60 * 1000;
      for (const k of r.senderKeys) data.mutes[k] = { until, reportId };
      r.status = 'muted';
      save();
      return r.senderKeys.length;
    },
    dismiss(reportId) {
      const r = data.reports.find((x) => x.id === reportId);
      if (!r) return false;
      r.status = 'dismissed';
      save();
      return true;
    },
    clearReports() { data.reports = []; save(); },
    // Aktuális némítások az üzemeltetőnek (rövidített címke, hátralévő perc).
    mutes() {
      prune();
      return Object.entries(data.mutes).map(([k, m]) => ({ id: crypto.createHash('sha256').update(k).digest('hex').slice(0, 10), label: label(k), minutesLeft: Math.ceil((m.until - now()) / 60000), reportId: m.reportId }));
    },
    unmute(id) {
      prune();
      const key = Object.keys(data.mutes).find((k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 10) === id);
      if (!key) return false;
      delete data.mutes[key];
      save();
      return true;
    },
    // Némított-e a küldő? uid: bejelentkezett fiók azonosítója (vagy null), ip: a kapcsolat címe.
    // A fiókost a fiók-azonosítója, a vendéget az IP-lenyomata szerint állítjuk meg. Visszatérés: hátralévő ms, vagy 0.
    mutedFor(uid, ip) {
      prune();
      const m = uid ? data.mutes[userKey(uid)] : data.mutes[ipKey(ip)];
      return m ? m.until - now() : 0;
    },
    // A küldő kulcsai egy üzenethez (a jelentés ezekkel némítható).
    keysFor(uid, ip) { return [userKey(uid), ipKey(ip)].filter(Boolean); },
    reporterKey(uid, ip) { return userKey(uid) || ipKey(ip); },
    flush() { if (timer) saveNow(); }
  };
}

module.exports = { createModeration, MAX_MUTE_MINUTES, ipKey };
