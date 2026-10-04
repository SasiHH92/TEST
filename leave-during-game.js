'use strict';
// ============================================================
// KAMU BÍRÓSÁG – kilépés játék közben: logikateszt
// 1) Beszélő kilépése: a játék megy tovább (fázis lép)
// 2) Host kilépése: házigazda-átadás + jelölés
// 3) A kilépő pontja megmarad, visszajövetelkor visszakapja
// 4) 3-nál kevesebb játékos: vissza lobbyba + lobbyNotice
// 5) A körbíró kiesése: új bíró sorsolódik (judge_changed esemény)
// Futtatás: node test/leave-during-game.js
// ============================================================

const { Game } = require('../game');

let fails = 0;
let emitted = [];
function ok(cond, label) {
  if (cond) { console.log('  OK  ' + label); }
  else { fails++; console.log('  HIBA ' + label); }
}

function mkGame(n, spy) {
  const io = {
    to: () => ({ emit: (ev, data) => { if (spy) emitted.push({ ev, data }); } }),
    emit: (ev, data) => { if (spy) emitted.push({ ev, data }); },
  };
  const g = new Game('LV', io);
  for (let i = 0; i < n; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  return g;
}

console.log('1) Beszélő (ügyész) kilépése: a játék továbbmegy');
{
  const g = mkGame(4);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const pros = g.roundData.prosecutorId;
  const phaseBefore = g.phase;
  g.handleLeave(pros);
  ok(!g.getPlayer(pros), 'a kilépő kikerült a szobából');
  ok(g.phase !== phaseBefore || g.phase !== 'prosecution', 'a fázis továbblépett (nem ragadt bent)');
  ok(['defense', 'prep', 'accusation', 'verdict_vote', 'game_over'].includes(g.phase) || g.phase === 'lobby',
    'új fázis: ' + g.phase);
  // A játék NEM akadt el: a következő fázis aktív (vagy lobbyba lépett, ha <3 maradt).
}

console.log('2) Host kilépése: házigazda-átadás + host_changed esemény');
{
  emitted = [];
  const g = mkGame(4, true);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  ok(g.hostId() === 'u0', 'u0 a házigazda induláskor');
  g.handleLeave('u0');
  const newHost = g.hostId();
  ok(newHost && newHost !== 'u0', 'új házigazda: ' + newHost);
  ok(g.getPlayer(newHost).isHost === true, 'az új házigazda jelölve');
  const ev = emitted.find((e) => e.ev === 'host_changed' && e.data.reason === 'lept');
  ok(!!ev, 'host_changed esemény kiment (reason: lept)');
  ok(ev && ev.data.newHostId === newHost, 'az esemény az új hostot nevezi meg');
}

console.log('3) A kilépő pontja megmarad, visszajövetelkor visszakapja');
{
  const g = mkGame(4);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const def = g.roundData.defendantId;
  g.getPlayer(def).score = 7;
  g.handleLeave(def);
  ok(g.scoreList().find((p) => p.id === def)?.score === 7, 'pont megmaradt a kilépő nevén');
  g.addPlayer(def, 'Játékos' + def.slice(1), 'bírói kalap', false); // visszacsatlakozás (ugyanaz a playerId)
  ok(g.getPlayer(def).connected === true, 'visszacsatlakozott');
  ok(g.getPlayer(def).score === 7, 'a pontja a helyén van visszajövetelkor');
}

console.log('4) 3-nál kevesebb játékos: vissza lobbyba üzenettel');
{
  const g = mkGame(3);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  ok(g.phase !== 'lobby', 'elindult a játék');
  g.handleLeave('u1');
  ok(g.phase === 'lobby', '2 játékossal a játék VISSZATÉRT A LOBBYBA');
  ok(typeof g.lobbyNotice === 'string' && g.lobbyNotice.includes('lobby'), 'lobbyNotice üzenet beállt: ' + g.lobbyNotice);
  const st = g.publicState('u0');
  ok(st.lobbyNotice === g.lobbyNotice, 'a state-ben is továbbítódik az üzenet');
}

console.log('5) A körbíró kiesése: új bíró sorsolódik + judge_changed');
{
  emitted = [];
  const g = mkGame(5, true);
  g.startGame({ rounds: 1, witnessEnabled: false, challengeMode: 'judge', modes: ['buli'] }, 'u0');
  const oldJudge = g.roundData.currentJudgeId;
  g.handleLeave(oldJudge);
  ok(g.roundData.currentJudgeId !== oldJudge, 'új körbíró: ' + g.roundData.currentJudgeId);
  ok(Object.values(g.roundData.challengeJudges).every((j) => j === g.roundData.currentJudgeId),
    'a kihívások bírója is az új bíróra mutat');
  const ev = emitted.find((e) => e.ev === 'judge_changed');
  ok(!!ev, 'judge_changed esemény kiment');
  ok(ev && ev.data.judgeId === g.roundData.currentJudgeId, 'az esemény az új bírót nevezi meg');
}

console.log(fails === 0 ? '\nÖSSZES ALTERSZT ZÖLD ✔' : '\n' + fails + ' TESZT PIROS ✘');
process.exit(fails === 0 ? 0 : 1);
