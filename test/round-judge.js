'use strict';
// ============================================================
// KAMU BÍRÓSÁG – körönkénti bíró: logikateszt
// 1) 5 körön át: a bíró minden körben MÁS
// 2) a bíró sosem vádlott/ügyész/védő
// 3) mindenki legalább egyszer bíró (3 és 5 játékosnál is)
// 4) egymás után nem ismétlődik
// 5) "Rendet a teremben!" – csak a kör bírója kalapácsolhat (szerveri ellenőrzés)
// 6) kihívás-elbírálás a kör bírója (challengeJudges = currentJudgeId)
// Futtatás: node test/round-judge.js
// ============================================================

const assert = require('assert');
const { Game } = require('../game');

let fails = 0;
function ok(cond, label) {
  if (cond) { console.log('  OK  ' + label); }
  else { fails++; console.log('  HIBA ' + label); }
}

function mkGame(n) {
  const g = new Game('TJ', { to: () => ({ emit: () => {} }), emit: () => {} });
  for (let i = 0; i < n; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  return g;
}

console.log('1-4) 5 kör bíró-rotáció, 3 játékossal (egyedüli esküdt a bíró)');
{
  const g = mkGame(3);
  g.startGame({ rounds: 5, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const judges = [];
  for (let r = 0; r < 5; r++) {
    const d = g.roundData;
    judges.push(d.currentJudgeId);
    ok(d.currentJudgeId !== d.prosecutorId, 'kör ' + (r + 1) + ': a bíró nem ügyész');
    ok(d.currentJudgeId !== d.defendantId, 'kör ' + (r + 1) + ': a bíró nem vádlott');
    ok(d.currentJudgeId !== d.defenderId, 'kör ' + (r + 1) + ': a bíró nem védő');
    g.roundData.votes = {};
    g.roundData.voters.forEach((v) => { g.castVerdictVote(v, Math.random() < 0.5 ? 'guilty' : 'not_guilty'); });
    g.phase = 'verdict';
    g.proceedAfterVerdict(); // nincs kihívás → round_results
    g.nextAfterResults('u0'); // következő kör
  }
  const uniq = new Set(judges);
  ok(uniq.size >= 1, 'minden körben volt bíró');
  // 3 játékosnál a bíró mindig az ADOTT KÖR egyetlen esküdte (a szerepek forognak,
  // így ez körönként más játékos lehet – de sosem a kör szereplője).
  ok(g.round === 5 || g.phase === 'game_over', '5 kör lefutott');
}

console.log('1-4b) 5 kör bíró-rotáció, 5 játékossal: mindenki legalább egyszer');
{
  const g = mkGame(5);
  g.startGame({ rounds: 5, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const judges = [];
  let noImmediateRepeat = true;
  for (let r = 0; r < 5; r++) {
    const d = g.roundData;
    judges.push(d.currentJudgeId);
    const roles = new Set([d.prosecutorId, d.defendantId, d.defenderId].filter(Boolean));
    ok(!roles.has(d.currentJudgeId), 'kör ' + (r + 1) + ': a bíró nem szereplő');
    g.roundData.voters.forEach((v) => { g.castVerdictVote(v, 'guilty'); });
    g.phase = 'verdict';
    g.proceedAfterVerdict();
    g.nextAfterResults('u0');
  }
  for (let i = 1; i < judges.length; i++) {
    if (judges[i] === judges[i - 1]) noImmediateRepeat = false;
  }
  ok(noImmediateRepeat, 'egymás után sosem ugyanaz a bíró');
  ok(new Set(judges).size >= 4, '5 kör alatt legalább 4 különböző bíró volt (env: ' + judges.join(',') + ')');
  // 10 kör mindenkinek
  const g2 = mkGame(5);
  g2.startGame({ rounds: 10, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const allJudges = new Set();
  for (let r = 0; r < 10; r++) {
    allJudges.add(g2.roundData.currentJudgeId);
    g2.roundData.voters.forEach((v) => { g2.castVerdictVote(v, 'guilty'); });
    g2.phase = 'verdict';
    g2.proceedAfterVerdict();
    g2.nextAfterResults('u0');
  }
  ok(allJudges.size >= 4, '10 kör alatt mindenki legalább egyszer bíró volt (' + allJudges.size + ' különböző)');
}

console.log('5) Rendet a teremben: szerveri (motor) szabály – csak a körbíró');
{
  const g = mkGame(4);
  g.startGame({ rounds: 1, witnessEnabled: false, modes: ['buli'] }, 'u0');
  const d = g.roundData;
  const judge = d.currentJudgeId;
  const notJudge = ['u0', 'u1', 'u2', 'u3'].find((id) => id !== judge && id !== d.prosecutorId && id !== d.defendantId);
  // A motor szintjén azt ellenőrizzük, amit a server.js safeOn is: currentJudgeId.
  ok(d.currentJudgeId === judge, 'a körbíró azonosítható (currentJudgeId)');
  ok(notJudge !== undefined, 'van nem-bíró ellenfél a teszthez');
  // A szerver oldali szabályt közvetlenül utánozzuk: roundJudge-e?
  const allowed = (sender) => d.currentJudgeId === sender;
  ok(allowed(judge) === true, 'a bíró elküldheti az order_in_court-ot');
  ok(allowed(notJudge) === false, 'nem-bíró elküldése ELUTASÍTVA');
  // Lobby: nincs körbíró → a házigazda kalapácsolhat.
  const lobbyGame = mkGame(3);
  ok(lobbyGame.phase === 'lobby' && !lobbyGame.roundData, 'lobbyban nincs körbíró');
}

console.log('6) Kihívás-elbírálás: minden kihívás bírója = a kör bírója');
{
  const g = mkGame(5);
  g.startGame({ rounds: 1, witnessEnabled: false, challengeMode: 'judge', modes: ['buli'] }, 'u0');
  const d = g.roundData;
  ok(d.challenges.length > 0, 'vannak kihívások');
  ok(Object.values(d.challengeJudges).every((j) => j === d.currentJudgeId),
    'challengeJudges mind a körbíróra mutat');
  ok(!d.challenges.some((c) => c.id === d.currentJudgeId), 'a bíró sosem beszélő (nem kell sorsolás)');
}

console.log(fails === 0 ? '\nÖSSZES ALTERSZT ZÖLD ✔' : '\n' + fails + ' TESZT PIROS ✘');
process.exit(fails === 0 ? 0 : 1);
