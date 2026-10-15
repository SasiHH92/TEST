'use strict';

// ============================================================
// KAMU BÍRÓSÁG – közös játékos-határok (szoba, Discord-tárgyalás, hirdetés, botok)
// A felső határ 12: ennyi játékossal van a színpad (esküdt-helyek + "+N" jelzés), a lobbi és a pontlista ellenőrizve (test/twelve-players.js).
// Szűkíthető a KB_MAX_PLAYERS környezeti változóval (3–12), ha a tárhely teljesítménye indokolná; 12 fölé nem emelhető.
// ============================================================

const MIN_PLAYERS = 3;
const ABSOLUTE_MAX = 12;
const parsed = parseInt(process.env.KB_MAX_PLAYERS, 10);
const MAX_PLAYERS = Number.isFinite(parsed) ? Math.max(MIN_PLAYERS, Math.min(ABSOLUTE_MAX, parsed)) : ABSOLUTE_MAX;

module.exports = { MIN_PLAYERS, MAX_PLAYERS, ABSOLUTE_MAX };
