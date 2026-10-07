'use strict';
// ============================================================
// KAMU BÍRÓSÁG – játékállapot a bemutató réteghez (a pontozási szabályok VÁLTOZATLANOK)
//   - pontesemények (scoreEvents): minden jóváírt pont okkal, és a játékosonkénti összeg pontosan a tényleges pontszám,
//   - a szabályok: ügyész = bűnös szavazatok, vádlott/védő = ártatlan szavazatok, egyhangú +1, esküdt +1, kihívás +2/+4, kedvenc +1,
//   - lobbi "kész vagyok" jelzés (csak lobbiban, botok mindig készek, indításkor nullázódik),
//   - díjak csak ténylegesen mért adatból.
// Futtatás: node test/gamestate.js
// ============================================================

const assert = require('assert/strict');
const { Game } = require('../game');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.stack || e)); }
}

function mkGame(n, settings = {}) {
  const g = new Game('GS', { to: () => ({ emit: () => {} }), emit: () => {} });
  for (let i = 0; i < n; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  g.startGame({ rounds: 2, witnessEnabled: false, challengesEnabled: false, modes: ['buli'], ...settings }, 'u0');
  return g;
}
const sum = (events, pid) => events.filter((e) => e.pid === pid).reduce((n, e) => n + e.points, 0);
function vote(g, plan) { // plan: { playerId: 'guilty' | 'not_guilty' }
  g.startVerdictVote();
  for (const [id, v] of Object.entries(plan)) g.castVerdictVote(id, v);
  g.finishVerdictVote();
}
function checkInvariant(g, label) {
  const events = g.roundData.scoreEvents || [];
  for (const p of g.players.values()) assert.equal(sum(events, p.id), p.score, label + ': ' + p.name + ' összege az eseményekből');
  assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i + 1), label + ': az események sorszáma folytonos');
  for (const e of events) { assert.ok(e.points > 0 && Number.isInteger(e.points)); assert.ok(['prosecution', 'defense', 'defender', 'unanimous', 'juror', 'challenge', 'favorite'].includes(e.kind), e.kind); }
}

test('Bűnös ítélet (2:1): az ügyész a bűnös szavazatok számát kapja, az egyező szavazók +1-et; az események összege = a pontszám', () => {
  const g = mkGame(6);
  const d = g.roundData, voters = d.voters.slice(0, 3);
  assert.equal(voters.length, 3);
  const plan = { [voters[0]]: 'guilty', [voters[1]]: 'guilty', [voters[2]]: 'not_guilty' };
  vote(g, plan);
  const ev = d.scoreEvents;
  const pros = ev.filter((e) => e.kind === 'prosecution');
  assert.deepEqual(pros.map((e) => [e.pid, e.points]), [[d.prosecutorId, 2]], 'ügyész: 2 bűnös szavazat');
  assert.deepEqual(ev.filter((e) => e.kind === 'juror').map((e) => e.pid).sort(), [voters[0], voters[1]].sort(), 'csak az egyező szavazók kapnak esküdt-pontot');
  assert.ok(!ev.some((e) => e.kind === 'unanimous'), 'nem egyhangú');
  assert.equal(g.players.get(d.prosecutorId).prosecutionWins, 1);
  assert.equal(g.players.get(d.defendantId).convictions, 1);
  checkInvariant(g, 'bűnös');
});

test('Felmentés védőügyvéddel: a vádlott és a védő is az ártatlan szavazatok számát kapja; a védő győzelme számlálódik', () => {
  const g = mkGame(6);
  const d = g.roundData;
  assert.ok(d.defenderId, '6 játékosnál van védőügyvéd');
  const voters = d.voters.filter((v) => v !== d.defenderId).slice(0, 3);
  vote(g, { [voters[0]]: 'not_guilty', [voters[1]]: 'not_guilty', [voters[2]]: 'guilty' });
  const ev = d.scoreEvents;
  assert.deepEqual(ev.filter((e) => e.kind === 'defense').map((e) => [e.pid, e.points]), [[d.defendantId, 2]]);
  assert.deepEqual(ev.filter((e) => e.kind === 'defender').map((e) => [e.pid, e.points]), [[d.defenderId, 2]]);
  assert.equal(g.players.get(d.defenderId).defenseWins, 1);
  assert.equal(g.players.get(d.prosecutorId).prosecutionWins, 0);
  checkInvariant(g, 'felmentés');
});

test('Egyhangú ítélet: +1 bónusz a győztes oldalnak, külön eseményként', () => {
  const g = mkGame(5);
  const d = g.roundData;
  const voters = d.voters.filter((v) => v !== d.defenderId);
  const plan = {}; for (const v of voters) plan[v] = 'guilty';
  vote(g, plan);
  const bonus = d.scoreEvents.filter((e) => e.kind === 'unanimous');
  assert.deepEqual(bonus.map((e) => [e.pid, e.points]), [[d.prosecutorId, 1]]);
  assert.equal(d.scoreEvents.find((e) => e.kind === 'prosecution').points, voters.length);
  checkInvariant(g, 'egyhangú');
});

test('Döntetlen: minden szavazó +1 (a szabály változatlan), nincs ügyész/vádlott-pont a nulla szavazatra', () => {
  const g = mkGame(4);
  const d = g.roundData;
  const voters = d.voters;
  if (voters.length % 2 !== 0) return; // csak páros szavazószámnál értelmezett
  const plan = {}; voters.forEach((v, i) => { plan[v] = i % 2 ? 'guilty' : 'not_guilty'; });
  vote(g, plan);
  assert.equal(d.scoreEvents.filter((e) => e.kind === 'juror').length, voters.length);
  checkInvariant(g, 'döntetlen');
});

test('Közönségkedvenc: +1 a legtöbbet nevetett beszélőnek, külön eseményként; a szám a körös összesítőből jön', () => {
  const g = mkGame(5);
  const d = g.roundData;
  d.laughs.prosecutor = 3; d.laughs.defendant = 1;
  vote(g, Object.fromEntries(d.voters.filter((v) => v !== d.defenderId).map((v) => [v, 'guilty'])));
  g.buildRoundResults();
  assert.deepEqual(d.scoreEvents.filter((e) => e.kind === 'favorite').map((e) => [e.pid, e.points]), [[d.prosecutorId, 1]]);
  checkInvariant(g, 'kedvenc');
});

test('Kihívás (esküdtek módban): a teljesített kihívás +2 / nehezítés +4, eseményként', () => {
  const g = mkGame(5, { challengesEnabled: true, challengeMode: 'jury' });
  const d = g.roundData;
  d.challenges = [{ who: 'prosecutor', id: d.prosecutorId, text: 'T1', difficulty: false }, { who: 'defendant', id: d.defendantId, text: 'T2', difficulty: true }];
  d.challengeVoters = d.voters.filter((v) => v !== d.defenderId);
  g.phase = 'challenge_vote';
  for (const v of d.challengeVoters) { g.castChallengeVote(v, 'prosecutor', true); g.castChallengeVote(v, 'defendant', true); }
  g.revealVerdict();
  const ch = d.scoreEvents.filter((e) => e.kind === 'challenge');
  assert.deepEqual(ch.map((e) => [e.pid, e.points]).sort(), [[d.prosecutorId, 2], [d.defendantId, 4]].sort());
  checkInvariant(g, 'kihívás (esküdtek)');
});

test('Kihívás (bírói módban): a pont a bíró döntése UTÁN, az ellenőrzés végén íródik jóvá, eseményként', () => {
  const g = mkGame(5, { challengesEnabled: true, challengeMode: 'judge' });
  const d = g.roundData;
  d.challenges = [{ who: 'prosecutor', id: d.prosecutorId, text: 'T1', difficulty: true }];
  d.challengeJudges = { prosecutor: d.currentJudgeId };
  vote(g, Object.fromEntries(d.voters.filter((v) => v !== d.defenderId).map((v) => [v, 'guilty'])));
  const before = d.scoreEvents.filter((e) => e.kind === 'challenge').length;
  assert.equal(before, 0, 'az ellenőrzés előtt nincs kihívás-pont');
  g.phase = 'challenge_review'; d.reviewIdx = 0;
  assert.equal(g.resolveChallenge(d.currentJudgeId, 'prosecutor', true), true);
  g.advanceChallengeReview();
  assert.deepEqual(d.scoreEvents.filter((e) => e.kind === 'challenge').map((e) => [e.pid, e.points]), [[d.prosecutorId, 4]]);
  checkInvariant(g, 'kihívás (bíró)');
});

test('Állapot: a scoreEvents minden néző állapotában ott van (nyilvános információ), másolatként; a lobbiban nincs', () => {
  const g = mkGame(5);
  const d = g.roundData;
  vote(g, Object.fromEntries(d.voters.filter((v) => v !== d.defenderId).map((v) => [v, 'not_guilty'])));
  const a = g.publicState('u0'), b = g.publicState('u3');
  assert.ok(Array.isArray(a.scoreEvents) && a.scoreEvents.length > 0);
  assert.deepEqual(a.scoreEvents, b.scoreEvents, 'mindenki ugyanazt látja');
  a.scoreEvents[0].points = 999;
  assert.notEqual(d.scoreEvents[0].points, 999, 'a kliens-példány módosítása nem írja át a szerver állapotát');
  const lobby = new Game('L2', { to: () => ({ emit: () => {} }), emit: () => {} });
  lobby.addPlayer('x', 'X', 'bírói kalap', true);
  assert.equal(lobby.publicState('x').scoreEvents, undefined);
});

test('Új kör: a pontesemények nullázódnak, a pontszámok megmaradnak (a szabály változatlan)', () => {
  const g = mkGame(5);
  const d1 = g.roundData;
  vote(g, Object.fromEntries(d1.voters.filter((v) => v !== d1.defenderId).map((v) => [v, 'guilty'])));
  const scores = Object.fromEntries([...g.players.values()].map((p) => [p.id, p.score]));
  g.buildRoundResults(); g.phase = 'round_results';
  g.nextRound();
  assert.deepEqual(g.roundData.scoreEvents || [], [], 'az új körben üres');
  for (const p of g.players.values()) assert.equal(p.score, scores[p.id]);
});

test('"Kész vagyok": csak lobbiban, csak a saját jelzés, botok mindig készek, indításkor nullázódik', () => {
  const g = new Game('RD', { to: () => ({ emit: () => {} }), emit: () => {} });
  for (let i = 0; i < 3; i++) g.addPlayer('p' + i, 'P' + i, 'bírói kalap', i === 0);
  g.addBot();
  const ready = (id) => g.playerList().find((p) => p.id === id).ready;
  assert.equal(ready('p1'), false);
  assert.equal(g.setReady('p1', true), true); assert.equal(ready('p1'), true);
  assert.equal(g.setReady('p1', false), true); assert.equal(ready('p1'), false);
  assert.equal(g.setReady('nincs', true), false, 'ismeretlen játékos');
  const bot = [...g.players.values()].find((p) => p.isBot);
  assert.equal(ready(bot.id), true, 'a bot mindig kész');
  assert.equal(g.setReady(bot.id, false), false, 'a bot jelzése nem állítható');
  g.setReady('p1', true);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'p0');
  assert.equal(g.setReady('p2', true), false, 'játék közben nem');
  for (const p of g.players.values()) if (!p.isBot) assert.equal(p.ready, false, 'indításkor nullázva');
});

test('Díjak: csak ténylegesen mért adatból; nulla adatnál nincs díj; a legmeggyőzőbb ügyész / legjobb védő a számlálókból jön', () => {
  const g = mkGame(6);
  const empty = g.finalResults().awards;
  assert.equal(empty.bestProsecutor, null); assert.equal(empty.bestDefender, null); assert.equal(empty.sharpestJuror, null);
  g.awardsRecorded = true; // ne írjon nyilvántartást a teszt
  const d = g.roundData;
  g.players.get(d.prosecutorId).prosecutionWins = 2;
  g.players.get(d.defenderId).defenseWins = 3;
  const a = g.finalResults().awards;
  assert.equal(a.bestProsecutor.playerId, d.prosecutorId); assert.equal(a.bestProsecutor.value, 2);
  assert.equal(a.bestDefender.playerId, d.defenderId); assert.equal(a.bestDefender.value, 3);
  assert.equal(a.sharpestJuror, null, 'nincs esküdt-pont: nincs díj');
  assert.ok(!('worstLiar' in a) && !('suspiciousWitness' in a), 'nincs kitalált (nem mérhető) díj');
});

console.log('\nJátékállapot: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 50); // a játékmotor időzítői életben tartanák a folyamatot
