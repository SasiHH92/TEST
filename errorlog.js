'use strict';

// ============================================================
// KAMU BÍRÓSÁG – egyszerű hibanapló
//
// A rossz (váratlan) hibákat tartja számon: azonos hibát egyetlen bejegyzésbe von össze (darabszám + első/utolsó
// előfordulás), fajtánként legfeljebb MAX_PER_KIND bejegyzést őriz, és fájlba menti (a storage.js ezt is feltölti
// a külső adatbázisba, így az újraindítások és a Render alvása után is megvan).
// A bejegyzések szövegéből eltávolítjuk az e-mail címeket, hosszú tokeneket és adatbázis-címeket, a jelszavak,
// sütik és kérés-törzsek soha nem kerülnek bele. A rögzítés sosem dob hibát.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_PER_KIND = 50;
const MAX_MESSAGE = 400;
const MAX_STACK_LINES = 6;
const SAVE_DELAY_MS = 2000;
const KINDS = ['server', 'socket', 'http', 'process', 'storage', 'mail', 'client'];

function scrub(value, max = MAX_MESSAGE) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '<adatbázis-cím>')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<e-mail>')
    .replace(/[A-Za-z0-9_-]{32,}/g, '<token>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stackOf(error) {
  const text = error && typeof error.stack === 'string' ? error.stack : '';
  return text.split('\n').slice(1, 1 + MAX_STACK_LINES).map((line) => scrub(line.replace(/^\s*at\s+/, ''), 160)).filter(Boolean);
}

function createErrorLog(options = {}) {
  const file = options.file || null;
  const persist = options.persist || null;
  const now = options.now || Date.now;
  const log = options.log || console;
  const saveDelayMs = options.saveDelayMs !== undefined ? options.saveDelayMs : SAVE_DELAY_MS;
  const maxPerKind = options.maxPerKind || MAX_PER_KIND;
  let entries = [];
  let timer = null;

  if (file) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && data.version === 1 && Array.isArray(data.entries)) entries = data.entries.filter((e) => e && typeof e.id === 'string');
    } catch (_) { /* nincs vagy sérült fájl: üres naplóval indulunk */ }
  }

  function save() {
    timer = null;
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, entries }, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, file);
      if (persist) persist();
    } catch (e) {
      log.error('A hibanapló mentése nem sikerült:', e && e.message);
    }
  }
  function schedule() {
    if (!file || timer) return;
    timer = setTimeout(save, saveDelayMs);
    if (timer.unref) timer.unref();
  }

  // kind: KINDS egyike; err: Error vagy szöveg; ctx: rövid, nem érzékeny adatok (pl. {event, path})
  function record(kind, err, ctx) {
    try {
      const k = KINDS.includes(kind) ? kind : 'server';
      const message = scrub(err && err.message !== undefined ? err.message : err);
      const stack = stackOf(err);
      const id = crypto.createHash('sha1').update(k + '|' + message + '|' + (stack[0] || '')).digest('hex').slice(0, 12);
      const t = now();
      const safeCtx = {};
      for (const [key, value] of Object.entries(ctx || {}).slice(0, 6)) safeCtx[scrub(key, 20)] = scrub(value, 120);
      const existing = entries.find((e) => e.id === id);
      if (existing) {
        existing.count++;
        existing.last = t;
        if (Object.keys(safeCtx).length) existing.ctx = safeCtx;
      } else {
        entries.push({ id, kind: k, message, stack, ctx: safeCtx, count: 1, first: t, last: t });
        const same = entries.filter((e) => e.kind === k);
        if (same.length > maxPerKind) {
          const oldest = same.reduce((a, b) => (a.last <= b.last ? a : b));
          entries = entries.filter((e) => e !== oldest);
        }
      }
      schedule();
      return id;
    } catch (_) {
      return null;
    }
  }

  const list = () => entries.slice().sort((a, b) => b.last - a.last);
  function summary() {
    const byKind = {};
    for (const e of entries) byKind[e.kind] = (byKind[e.kind] || 0) + e.count;
    return { distinct: entries.length, total: entries.reduce((n, e) => n + e.count, 0), byKind, latest: entries.reduce((m, e) => Math.max(m, e.last), 0) };
  }
  function clear() { entries = []; if (timer) { clearTimeout(timer); timer = null; } save(); }
  function flush() { if (timer) { clearTimeout(timer); save(); } }

  return { record, list, summary, clear, flush };
}

module.exports = { createErrorLog, scrub, KINDS, MAX_PER_KIND };
