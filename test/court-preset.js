'use strict';
// ============================================================
// KAMU BÍRÓSÁG – az előre sorsolt (Discord/web tárgyalás) első-köri szerepek a játékmotorban
// és a játékindulási / befejezési értesítések (lifecycle). A motor szokásos sorsolása változatlan marad.
// Futtatás: node test/court-preset.js
// ============================================================
const assert = require('assert/strict');
const { Game, PHASES } = require('../game');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.stack || e)); }
}
const io = { to: () => ({ emit: () => {} }), emit: () => {} };
function mk(n, settings = {}) {
  const g = new Game('PR', io);
  for (let i = 0; i < n; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  return { g, start: (preset) => { g.presetRoles = preset || null; g.startGame({ rounds: 2, witnessEnabled: true, challengesEnabled: false, modes: ['buli'], ...settings }, 'u0'); } };
}

test('4 játékos: az 1. kör bírója, ügyésze, vádlottja és tanúja a megadott', () => {
  const { g, start } = mk(4);
  start({ judge: 'u3', prosecutor: 'u2', defendant: 'u1', witness: 'u0' });
  const d = g.roundData;
  assert.equal(d.currentJudgeId, 'u3'); assert.equal(d.prosecutorId, 'u2'); assert.equal(d.defendantId, 'u1'); assert.equal(d.witnessId, 'u0');
  assert.equal(g.presetRoles, null, 'a beállítás felhasználódik');
});

test('5+ játékos: a védőügyvéd is a megadott; a motor forgatása tud róla (a 2. körben nem ismétlődik a bíró)', () => {
  const { g, start } = mk(6);
  start({ judge: 'u5', prosecutor: 'u4', defendant: 'u3', defender: 'u2', witness: 'u1' });
  const d = g.roundData;
  assert.deepEqual([d.currentJudgeId, d.prosecutorId, d.defendantId, d.defenderId, d.witnessId], ['u5', 'u4', 'u3', 'u2', 'u1']);
  assert.equal(g.judgeCounts.get('u5'), 1);
  assert.equal(g.roleHistory.get('u3').defendant, 1);
  g.nextRound();
  assert.notEqual(g.roundData.currentJudgeId, 'u5', 'egymás után nem ugyanaz a bíró');
});

test('érvénytelen megadás (ismeretlen vagy ismétlődő játékos) → a szokásos sorsolás fut, nincs összeomlás', () => {
  for (const bad of [{ judge: 'u9', prosecutor: 'u2', defendant: 'u1' }, { judge: 'u1', prosecutor: 'u1', defendant: 'u2' }, { judge: 'u1' }, {}]) {
    const { g, start } = mk(4);
    start(bad);
    const d = g.roundData;
    assert.equal(new Set([d.currentJudgeId, d.prosecutorId, d.defendantId]).size, 3);
    assert.notEqual(g.phase, PHASES.LOBBY);
  }
});

test('preset nélkül a viselkedés változatlan; a preset csak az 1. körre érvényes', () => {
  const { g, start } = mk(4);
  start(null);
  assert.notEqual(g.phase, PHASES.LOBBY);
  g.presetRoles = { judge: 'u0', prosecutor: 'u1', defendant: 'u2' };
  g.nextRound(); // 2. kör: a preset ignorálva, majd törölve
  assert.equal(g.presetRoles, null);
});

test('lifecycle: indulás után „started”, lobbiba törés „aborted”, megszüntetés „disposed”', () => {
  const seen = [];
  Game.setLifecycleHook((game, ev) => seen.push(ev + ':' + game.code));
  const { g, start } = mk(4);
  start(null);
  g.abortToLobby('teszt');
  g.dispose();
  Game.setLifecycleHook(null);
  assert.deepEqual(seen, ['started:PR', 'aborted:PR', 'disposed:PR']);
});

test('lifecycle: a játék vége (GAME_OVER) „finished” értesítést ad; a horog hibája nem állítja meg a játékot', () => {
  const seen = [];
  Game.setLifecycleHook((game, ev) => { seen.push(ev); if (ev === 'finished') throw new Error('hiba a horogban'); });
  const { g, start } = mk(4);
  start(null);
  g.settings.rounds = 1;
  g.nextRound(); // a 2. hívás: round(1) >= rounds(1) → GAME_OVER
  Game.setLifecycleHook(null);
  assert.equal(g.phase, PHASES.GAME_OVER);
  assert.ok(seen.includes('finished'));
});

console.log(`\nSzerep-előbeállítás: ${passed} sikeres, ${failed} hibás teszt.`);
process.exit(failed ? 1 : 0);
