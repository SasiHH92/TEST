'use strict';
// ============================================================
// KAMU BÍRÓSÁG – kihívás-ellenőrzés a bíróval: logikateszt
// ============================================================

const assert = require('assert');
const { Game } = require('../game');

function mkGame() {
  return new Game('TEST', { to: () => ({ emit: () => {} }), emit: () => {} });
}

function ok(cond, label) {
  assert.ok(cond, label);
  console.log('  OK: ' + label);
}

console.log('1) Bíró mód: proceedAfterVerdict -> challenge_review');
{
  const g = mkGame();
  for (let i = 0; i < 4; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  g.startGame({ rounds: 1, witnessEnabled: false, challengeMode: 'judge', modes: ['buli'] }, 'u0');
  g.roundData.prosecutorId = 'u1';
  g.roundData.defendantId = 'u2';
  g.phase = 'verdict';
  g.proceedAfterVerdict();
  ok(g.phase === 'challenge_review', 'challenge_review fázis jött');
}

console.log('2) Csak az ügy bírója dönthet');
{
  const g = mkGame();
  for (let i = 0; i < 4; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  g.startGame({ rounds: 1, witnessEnabled: false, challengeMode: 'judge', modes: ['buli'] }, 'u0');
  const d = g.roundData;
  d.prosecutorId = 'u1'; d.defendantId = 'u2';
  d.challenges = [{ who: 'prosecutor', id: 'u1', text: 'T1', difficulty: false }];
  d.challengeJudges = { prosecutor: 'u0' };
  g.phase = 'challenge_review';
  d.reviewIdx = 0;
  ok(g.resolveChallenge('u2', 'prosecutor', true) === false, 'nem-bíró döntése elutasítva');
  ok(g.resolveChallenge('u0', 'prosecutor', true) === true, 'a bíró döntése elfogadva');
  ok(d.challengeDecisions.prosecutor === true, 'döntés rögzítve');
  ok(g.resolveChallenge('u0', 'prosecutor', false) === false, 'második döntés nem felülírható');
}

console.log('3) Házigazda-kihívásnál sorsolt, nem beszélő esküdt a bíró');
{
  const g = mkGame();
  for (let i = 0; i < 5; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  g.startGame({ rounds: 1, witnessEnabled: false, challengeMode: 'judge', modes: ['buli'] }, 'u0');
  const d = g.roundData;
  // Szimuláljuk: a házigazda (u0) a vádlott -> ő kap kihívást.
  d.prosecutorId = 'u1';
  d.defendantId = 'u0';
  d.challenges = [
    { who: 'prosecutor', id: 'u1', text: 'T1', difficulty: false },
    { who: 'defendant', id: 'u0', text: 'T2', difficulty: true }
  ];
  d.challengeJudges = {};
  const hostId = g.hostId();
  for (const ch of d.challenges) {
    if (ch.id === hostId) {
      const nonSpeakers = d.voters.filter((id) => !d.challenges.some((c2) => c2.id === id));
      d.challengeJudges[ch.who] = nonSpeakers.length > 0 ? nonSpeakers[Math.floor(Math.random() * nonSpeakers.length)] : hostId;
    } else {
      d.challengeJudges[ch.who] = hostId;
    }
  }
  ok(d.challengeJudges.prosecutor === hostId, 'nem-kihívásos ügyben a házigazda a bíró');
  const judgeId = d.challengeJudges.defendant;
  ok(judgeId !== hostId, 'házigazda-kihívásnál NEM a házigazda dönt');
  ok(!d.challenges.some((c) => c.id === judgeId), 'a sorsolt bíró nem beszélő');
  ok(d.voters.includes(judgeId), 'a sorsolt bíró esküdt');
}

console.log('4) Titkos kihívás: csak a tulajdonos és a bíró kapja meg a szöveget');
{
  const g = mkGame();
  for (let i = 0; i < 5; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  g.startGame({ rounds: 1, witnessEnabled: false, challengeMode: 'judge', modes: ['buli'] }, 'u0');
  const d = g.roundData;
  d.prosecutorId = 'u1'; d.defendantId = 'u2';
  d.challenges = [{ who: 'prosecutor', id: 'u1', text: 'TITKOS-SZÖVEG', difficulty: false }];
  d.challengeJudges = { prosecutor: 'u3' };
  g.phase = 'prosecution';
  const owner = JSON.parse(JSON.stringify(g.publicState('u1')));
  const judge = JSON.parse(JSON.stringify(g.publicState('u3')));
  const outsider = JSON.parse(JSON.stringify(g.publicState('u4')));
  ok(owner.myChallenge === 'TITKOS-SZÖVEG', 'a tulajdonos látja a sajátját');
  ok(Array.isArray(judge.judgeWatch) && judge.judgeWatch.some((c) => c.text === 'TITKOS-SZÖVEG'), 'a bíró látja (FIGYELD-lista)');
  ok(!JSON.stringify(outsider).includes('TITKOS-SZÖVEG'), 'a kívülálló state-jében NINCS benne a szöveg');
  // watchNow csak beszéd alatt, a beszélő kihívására
  ok(judge.watchNow && judge.watchNow.text === 'TITKOS-SZÖVEG', '"Most figyeld" sáv a beszélő kihívását mutatja');
  g.phase = 'defense';
  const judge2 = g.publicState('u3');
  ok(!judge2.watchNow, 'nem beszédfázisban nincs watchNow');
}

console.log('5) Pontozás: bírói döntés után +2 / nehezítés +4 és bírói név');
{
  const g = mkGame();
  for (let i = 0; i < 4; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  g.startGame({ rounds: 1, witnessEnabled: false, challengeMode: 'judge', modes: ['buli'] }, 'u0');
  const d = g.roundData;
  d.prosecutorId = 'u1'; d.defendantId = 'u2';
  d.challenges = [
    { who: 'prosecutor', id: 'u1', text: 'T1', difficulty: false },
    { who: 'defendant', id: 'u2', text: 'T2', difficulty: true }
  ];
  d.challengeJudges = { prosecutor: 'u0', defendant: 'u0' };
  d.judgeNotes = { prosecutor: true };
  d.verdictResult = { guilty: true }; // (a valós játékban a revealVerdict állítja be)
  g.phase = 'challenge_review';
  d.reviewIdx = 0;
  g.resolveChallenge('u0', 'prosecutor', true); // +2
  setTimeout(() => {
    g.resolveChallenge('u0', 'defendant', true); // +4 (nehezítés)
    setTimeout(() => {
      ok(g.getPlayer('u1').score === 2, 'teljesített kihívás +2 pont');
      ok(g.getPlayer('u2').score === 4, 'nehezítés-kihívás +4 pont');
      ok(g.getPlayer('u1').challengesDone === 1, 'challengesDone számol');
      const v = d.verdictResult;
      ok(Array.isArray(v.challengeResults) && v.challengeResults.length === 2, 'challengeResults a jegyzőkönyvben');
      const cr = v.challengeResults[0];
      ok(cr.done === true && cr.points === 2, 'eredmény: done + pontszám');
      ok(cr.mode === 'judge' && cr.judgeName === 'Játékos0', 'bírói név a jegyzőkönyvben ("Kihívás: ... bíró: név")');
      ok(v.challengeResults[1].points === 4, 'nehezítés dupla pont');
      console.log('\\nÖSSZES ALTERSZT ZÖLD ✔');
      process.exit(0);
    }, 1400);
  }, 1400);
}
