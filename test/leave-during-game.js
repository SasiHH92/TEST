'use strict';
// ============================================================
// KAMU BÍRÓSÁG – kilépés játék közben: logikateszt
// 1) Beszélő kilépése: a játék megy tovább (fázis lép)
// 2) Host kilépése: házigazda-átadás + jelölés
// 3) A kilépő pontja megmarad, visszajövetelkor visszakapja
// 4) 3-nál kevesebb játékos: vissza lobbyba + lobbyNotice
// 5) A körbíró kiesése: új bíró sorsolódik (judge_changed esemény)
// 6–8) A beszédek után nincs szerepátadás: a leadott szavazat megmarad, a kör nem marad ki; KERESZTKÉRDÉS: kilépő megszólított
// 9) A szavazás késleltetett lezárása nem fut le a megszűnt szobán; 10) a szavazás alatt kiesett, visszatérő esküdt újra szavazhat
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

console.log('6) A szavazás alatt kilépő ügyész helyére NEM lép esküdt: a leadott szavazat megmarad, a kör nem marad ki');
{
  emitted = [];
  const g = mkGame(6, true);
  g.startGame({ rounds: 2, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  g.startVerdictVote();
  const d = g.roundData, pros = d.prosecutorId, voter = d.voters[0];
  g.castVerdictVote(voter, 'guilty');
  g.handleLeave(pros);
  ok(g.phase === 'verdict_vote', 'a szavazás folytatódik (fázis: ' + g.phase + ')');
  ok(g.roundData === d && d.prosecutorId === pros, 'az ügyész-hely nem adódott át');
  ok(d.voters.includes(voter) && d.votes[voter] && d.votes[voter].verdict === 'guilty', 'az esküdt szavazata megmaradt');
  ok(!emitted.some((e) => e.ev === 'role_handed_over'), 'nincs szerepátadás a beszédek után');
}

console.log('7) Hálózati kiesés a szavazás után (lejárt kegyelem): a már leadott szavazat számít');
{
  const g = mkGame(6);
  g.startGame({ rounds: 2, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  g.startVerdictVote();
  const d = g.roundData, [a, b] = d.voters;
  g.castVerdictVote(a, 'not_guilty');
  g.handleDisconnect(a);
  g.afterDeparture(a, false); // a 20 mp-es kegyelem lejárta
  ok(d.voters.includes(a) && d.votes[a], 'a kiesett esküdt szavazata megmaradt');
  g.castVerdictVote(b, 'not_guilty');
  for (const v of d.voters) if (!d.votes[v]) g.castVerdictVote(v, 'guilty');
  g.finishVerdictVote();
  ok(g.phase === 'verdict', 'ítélet');
  ok(d.verdictResult.notGuiltyVotes >= 2, 'a kiesett esküdt szavazata is beszámított (nem bűnös: ' + d.verdictResult.notGuiltyVotes + ')');
}

console.log('8) KERESZTKÉRDÉS: ha a megszólított kilép, nem vár a játék, jön a szavazás');
{
  const g = mkGame(6);
  g.startGame({ rounds: 2, witnessEnabled: false, challengesEnabled: false, juryQuestions: true, modes: ['buli'] }, 'u0');
  g.accusationRead(); g.startSpeech('prosecution');
  const d = g.roundData;
  ok(g.askJuryQuestion(d.voters[0], 'defendant', 'Hol voltál tegnap este?').ok === true, 'kérdés beküldve');
  g.startJuryQuestion();
  ok(g.phase === 'jury_question', 'KERESZTKÉRDÉS fázis');
  g.handleLeave(d.defendantId);
  ok(g.phase === 'verdict_vote', 'a megszólított kilépett: rögtön jön a szavazás (fázis: ' + g.phase + ')');
}

console.log('10) A szavazás alatt rövid időre kiesett esküdt (frissítés / hálózatváltás) visszatérve újra szavazhat');
{
  const g = mkGame(6);
  g.startGame({ rounds: 2, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  g.startVerdictVote();
  const d = g.roundData, juror = d.voters[0];
  g.handleDisconnect(juror);
  ok(!d.voters.includes(juror), 'kieséskor a szavazás nem vár rá');
  g.handleReconnect(juror);
  ok(g.publicState(juror).verdictVote.canVote === true, 'visszatérve újra szavazhat');
  ok(g.castVerdictVote(juror, 'guilty') === true && d.votes[juror], 'a szavazata bekerült');
  g.clearDepartureTimers(juror);
}

(async () => {
  console.log('9) Minden szavazat leadva, majd a szoba megszűnik: a késleltetett lezárás nem fut le a megszűnt szobán');
  const g = mkGame(4);
  g.startGame({ rounds: 2, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  g.startVerdictVote();
  for (const v of g.roundData.voters) g.castVerdictVote(v, 'guilty');
  g.dispose();
  await new Promise((r) => setTimeout(r, 1700));
  ok(g.phase === 'verdict_vote', 'a megszűnt szobában nem lépett tovább a fázis');

  console.log(fails === 0 ? '\nÖSSZES ALTERSZT ZÖLD ✔' : '\n' + fails + ' TESZT PIROS ✘');
  process.exit(fails === 0 ? 0 : 1);
})();
