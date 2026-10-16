'use strict';
// ============================================================
// KAMU BÍRÓSÁG – kártya-visszajelzés
// A játékosok 😂 / 👎 szavazata a körben kihirdetett vádra (az ítélet után). Név nélkül, összesítve tárolódik
// (nincs benne játékos- vagy fiókazonosító), és csak a beépített témák (data/cards.json) pontos szövegű vádjai kerülnek be:
// egyéni (házigazdai) vád, közösségi csomag vagy már lecserélt kártya nem. Az üzemeltető az admin felületen látja a leggyengébbeket.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SAVE_DELAY_MS = 2000;
const MAX_ENTRIES = 1000; // a beépített vádak száma ennél jóval kisebb; a határ csak védelem

function createCardFeedback({ file = null, persist = () => {}, cards = null, now = () => Date.now() } = {}) {
  const CARDS = cards || require('./data/cards.json');
  const known = (mode, text) => !!(CARDS[mode] && Array.isArray(CARDS[mode].vadak) && CARDS[mode].vadak.includes(text));
  const keyOf = (mode, text) => mode + '|' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
  const norm = (v) => (v === true ? true : v === false ? false : null);

  let data = { version: 1, cards: {} };
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.version === 1 && parsed.cards && typeof parsed.cards === 'object') {
        // a már lecserélt / átírt kártyák szavazatai nem számítanak: betöltéskor kihullanak
        for (const [k, e] of Object.entries(parsed.cards)) {
          if (e && known(e.m, e.t) && keyOf(e.m, e.t) === k) data.cards[k] = { m: e.m, t: e.t, y: Math.max(0, e.y | 0), n: Math.max(0, e.n | 0), u: e.u || 0 };
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('A kártya-visszajelzés fájlja nem olvasható, üresen indul:', e.message);
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
    try { persist(file); } catch (_) { /* a külső mentés hibája nem állíthatja meg a játékot */ }
  }
  function save() {
    if (!file || timer) return;
    timer = setTimeout(() => { try { saveNow(); } catch (e) { console.error('A kártya-visszajelzés mentése sikertelen:', e.message); } }, SAVE_DELAY_MS);
    if (timer.unref) timer.unref();
  }

  // Egy játékos szavazatának változása: prev -> next (true = 😂, false = 👎, null = nincs). Igaz, ha változott a tároló.
  function record(mode, text, prev, next) {
    if (typeof mode !== 'string' || typeof text !== 'string' || !known(mode, text)) return false;
    prev = norm(prev); next = norm(next);
    if (prev === next) return false;
    const k = keyOf(mode, text);
    let e = data.cards[k];
    if (!e) {
      if (next === null) return false; // nincs mit visszavonni (pl. az admin közben törölte a kártya szavazatait)
      if (Object.keys(data.cards).length >= MAX_ENTRIES) return false;
      e = data.cards[k] = { m: mode, t: text, y: 0, n: 0, u: 0 };
    }
    if (prev === true) e.y = Math.max(0, e.y - 1);
    if (prev === false) e.n = Math.max(0, e.n - 1);
    if (next === true) e.y += 1;
    if (next === false) e.n += 1;
    e.u = now();
    if (e.y === 0 && e.n === 0) delete data.cards[k];
    save();
    return true;
  }

  // Lista az üzemeltetőnek: min = legalább ennyi szavazat; sort = worst (legtöbb 👎-arány) | best (legtöbb 😂-arány) | votes (legtöbb szavazat).
  function list({ min = 1, sort = 'worst', limit = 100 } = {}) {
    const rows = Object.entries(data.cards).map(([key, e]) => {
      const total = e.y + e.n;
      return { key, mode: e.m, modeName: (CARDS[e.m] && CARDS[e.m].nev) || e.m, text: e.t, yes: e.y, no: e.n, total, noShare: total ? e.n / total : 0, updatedAt: e.u || 0 };
    }).filter((r) => r.total >= Math.max(1, min | 0));
    const cmp = {
      worst: (a, b) => b.noShare - a.noShare || b.total - a.total,
      best: (a, b) => (1 - b.noShare) - (1 - a.noShare) || b.total - a.total,
      votes: (a, b) => b.total - a.total || b.noShare - a.noShare
    }[sort] || ((a, b) => b.noShare - a.noShare || b.total - a.total);
    return rows.sort(cmp).slice(0, Math.max(1, Math.min(500, limit | 0 || 100)));
  }
  const summary = () => {
    const all = Object.values(data.cards);
    return { cards: all.length, votes: all.reduce((s, e) => s + e.y + e.n, 0) };
  };
  // Egy kártya szavazatainak törlése (pl. lecserélés után az újragyűjtéshez).
  function clear(key) {
    if (!Object.prototype.hasOwnProperty.call(data.cards, key)) return false;
    delete data.cards[key]; save(); return true;
  }

  return { record, list, summary, clear, flush: saveNow, _known: known };
}

module.exports = { createCardFeedback, MAX_ENTRIES };
