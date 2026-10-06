'use strict';

// ============================================================
// KAMU BÍRÓSÁG – privát üzenetek a barátok között (tároló)
// Beszélgetésenként az utolsó KEEP üzenet, fiókonként "olvasva eddig" jelölő. Fájlban él (data/dms.json), a mentés
// után a külső adatbázisba is feltöltődik (persist), így a Render újraindítása nem viszi el az üzeneteket.
// Ha a barátság megszűnik (eltávolítás / letiltás), a beszélgetés törlődik.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP = 60;
const SAVE_DELAY_MS = 800;

function createDms({ file, persist = () => {}, now = () => Date.now() }) {
  let data = { version: 1, threads: {}, reads: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.version === 1 && parsed.threads && parsed.reads) data = parsed;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('A privát üzenetek fájlja nem olvasható, üresen indul:', e.message);
  }
  let timer = null;

  const key = (a, b) => [a, b].sort().join(':');

  function saveNow() {
    clearTimeout(timer); timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    try { persist(file); } catch (_) { /* a külső mentés hibája nem állíthatja meg az üzenetküldést */ }
  }
  function save() {
    if (timer) return;
    timer = setTimeout(() => { try { saveNow(); } catch (e) { console.error('A privát üzenetek mentése sikertelen:', e.message); } }, SAVE_DELAY_MS);
    if (timer.unref) timer.unref();
  }

  const threadOf = (a, b) => data.threads[key(a, b)];

  return {
    // Az utolsó üzenetek (régi → új).
    messages(a, b) {
      const t = threadOf(a, b);
      return t ? t.msgs.slice(-KEEP) : [];
    },
    add(from, to, text) {
      const k = key(from, to);
      const t = data.threads[k] || (data.threads[k] = { seq: 0, msgs: [] });
      t.seq += 1;
      const entry = { id: t.seq, from, text, ts: now() };
      t.msgs.push(entry);
      if (t.msgs.length > KEEP) t.msgs.splice(0, t.msgs.length - KEEP);
      save();
      return entry;
    },
    // Olvasatlan üzenetek száma barátonként ({ barátId: darab }).
    unread(userId) {
      const out = {};
      const mine = data.reads[userId] || {};
      for (const [k, t] of Object.entries(data.threads)) {
        const [a, b] = k.split(':');
        if (a !== userId && b !== userId) continue;
        const other = a === userId ? b : a;
        const seen = mine[other] || 0;
        const n = t.msgs.filter((m) => m.from === other && m.id > seen).length;
        if (n) out[other] = n;
      }
      return out;
    },
    markRead(userId, otherId) {
      const t = threadOf(userId, otherId);
      if (!t) return;
      const reads = data.reads[userId] || (data.reads[userId] = {});
      const last = t.msgs.length ? t.msgs[t.msgs.length - 1].id : 0;
      if (reads[otherId] !== last) { reads[otherId] = last; save(); }
    },
    // A barátság megszűnt: a beszélgetés és az olvasási jelölők törlődnek.
    drop(a, b) {
      let changed = !!data.threads[key(a, b)];
      delete data.threads[key(a, b)];
      for (const [x, y] of [[a, b], [b, a]]) if (data.reads[x] && y in data.reads[x]) { delete data.reads[x][y]; changed = true; }
      if (changed) save();
    },
    flush() { if (timer) saveNow(); }
  };
}

module.exports = { createDms, KEEP };
