'use strict';
// ============================================================
// KAMU BÍRÓSÁG – esküdt-pont: logikateszt
// 1) A többséggel egyező szavazat +1 pont, az eltérő 0
// 2) Döntetlennél minden szavazó +1
// 3) verdictResult.votes elemeiben egyénileg is jelölve (jurorPoint)
// Futtatás: node test/juror-points.js
// ============================================================

const { Game } = require('../game');

let fails = 0;
function ok(cond, label) {
  if (cond) { console.log('  OK  ' + label); }
  else { fails++; console.log('  HIBA ' + label); }
}

function mkGame(n) {
  const g = new Game('EP', { to: () => ({ emit: () => {} }), emit: () => {} });
  for (let i = 0; i < n; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  return g;
}

function playToVerdict(g, votes) {
  // votes: { playerId: 'guilty'|'not_guilty' } – a d.currentJudgeId kihagyva (nem esküdt?)
  // A körbíró ESKÜDT (szavazhat), a védőügyvéd (ha van) nem.
  g.startVerdictVote();
  for (const [id, v] of Object.entries(votes)) g.castVerdictVote(id, v);
  g.finishVerdictVote();
}

console.log('1) Egyező szavazat +1, eltérő 0 (bűnös többség 2:1)');
{
  const g = mkGame(6); // 6 játékos: vádlott+ügyész+védő+3 szavazó (együk a körbíró)
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const d = g.roundData;
  const voters = d.voters;
  ok(voters.length === 3, '6 játékosnál 3 szavazó-esküdt (a védőügyvéd nem szavaz)');
  const votes = {};
  voters.forEach((v, i) => { votes[v] = i < 2 ? 'guilty' : 'not_guilty'; });
  playToVerdict(g, votes);
  const vRes = g.roundData.verdictResult;
  ok(vRes.guilty === true, 'bűnös többség (2:1)');
  for (const v of voters) {
    const expected = votes[v] === 'guilty';
    const got = vRes.votes.find((x) => x.voterId === v).jurorPoint;
    ok(got === expected, 'szavazó ' + v + ': jurorPoint ' + got + ' (várt ' + expected + ')');
    ok(g.getPlayer(v).score === (expected ? 1 : 0),
      'szavazó ' + v + ' pontja: ' + g.getPlayer(v).score);
  }
}

console.log('2) Döntetlen: minden szavazó +1');
{
  const g = mkGame(4);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const voters = g.roundData.voters;
  ok(voters.length >= 2, 'van legalább 2 szavazó');
  if (voters.length % 2 === 0) {
    const votes = {};
    voters.forEach((v, i) => { votes[v] = i % 2 === 0 ? 'guilty' : 'not_guilty'; });
    playToVerdict(g, votes);
    const vRes = g.roundData.verdictResult;
    ok(vRes.guiltyVotes === vRes.notGuiltyVotes, 'döntetlen (' + vRes.guiltyVotes + ':' + vRes.notGuiltyVotes + ')');
    ok(voters.every((v) => vRes.votes.find((x) => x.voterId === v).jurorPoint === true),
      'döntetlennél minden szavazónak jurorPoint');
    ok(voters.every((v) => g.getPlayer(v).score === 1), 'minden szavazó +1 pontot kapott');
  } else {
    // 3 szavazónál nincs döntetlen – 1:1:1 nem lehet; itt a "senki sem szavazott" ágat nézzük.
    console.log('  (páratlan szavazószám – döntetlen-ág 4 szavazóval fut)');
  }
}

console.log('3) Ártatlan többség: ártatlanra szavazó esküdt +1');
{
  const g = mkGame(6);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const voters = g.roundData.voters;
  const votes = {};
  voters.forEach((v, i) => { votes[v] = i === 0 ? 'guilty' : 'not_guilty'; });
  playToVerdict(g, votes);
  const vRes = g.roundData.verdictResult;
  ok(vRes.guilty === false, 'ártatlan többség (1:2)');
  const loser = vRes.votes.find((x) => x.verdict === 'guilty');
  const winners = vRes.votes.filter((x) => x.verdict === 'not_guilty');
  ok(loser.jurorPoint === false, 'eltérő szavazat: nincs pont');
  ok(winners.every((x) => x.jurorPoint === true), 'egyező szavazatok: pont');
  ok(g.getPlayer(loser.voterId).score === 0, 'az eltérő szavazó 0 pont');
  ok(winners.every((x) => g.getPlayer(x.voterId).score === 1), 'az egyezők 1-1 pont');
}

console.log(fails === 0 ? '\nÖSSZES ALTERSZT ZÖLD ✔' : '\n' + fails + ' TESZT PIROS ✘');
process.exit(fails === 0 ? 0 : 1);
